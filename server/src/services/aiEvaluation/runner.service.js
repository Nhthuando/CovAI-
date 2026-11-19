import crypto from 'node:crypto';
import { getAgentManifest } from '../../agents/registry.js';
import prisma from '../../config/prisma.js';
import { executeTurn } from './httpJson.adapter.js';
import { targetCredential } from './management.service.js';
import { closeGateway } from './gateway.service.js';
import { evaluateCase, evaluateRule, aggregationInputs } from './evaluator.service.js';
import { aggregateTrustProfile } from './scoring.service.js';
import { hash, redact, serial, safeError, TERMINAL, requireEnabled, fail } from './common.js';
import { extractKnowledge } from './knowledge.service.js';
import { providerJson } from './judge.service.js';
import { parse, caseSchema } from './contracts.js';
import { storeEvidencePayload } from './artifactStore.service.js';

const controllers = new Map();
export async function finalizeRun(db, runId, status, errorCode = null, leaseToken, staleSnapshot) {
    return serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "AiEvaluationRun" WHERE id = ${runId} FOR UPDATE`;
        const run = await tx.aiEvaluationRun.findUnique({ where: { id: runId }, include: { cases: { include: { criteria: true, attempts: { include: { calls: true } } } }, evidence: { where: { kind: 'GATEWAY_VIOLATION' } } } });
        if (!run || TERMINAL.includes(run.executionStatus) || (leaseToken && run.leaseToken !== leaseToken)) return run;
        if (staleSnapshot && (run.executionStatus !== staleSnapshot.executionStatus || run.leaseToken !== staleSnapshot.leaseToken || (run.leaseUntil?.getTime() ?? null) !== (staleSnapshot.leaseUntil?.getTime() ?? null))) return run;
        // An interrupted conversation must not erase a safety violation already observed by the gateway.
        for (const item of run.cases) {
            const violations = run.evidence.filter(e => e.caseResultId === item.id);
            const observations = item.attempts.map(attempt => ({ responses: [], errorCode: 'INTERRUPTED', gateway: { calls: attempt.calls }, violations: violations.filter(e => e.attemptId === attempt.id).map(e => e.payload) }));
            for (const criterion of item.criteria) {
                if (criterion.method !== 'rule' || criterion.status !== 'NOT_EVALUATED' || !criterion.details.blocking || !['confirmation', 'forbiddenActions', 'duplicates'].includes(criterion.details.expected?.type)) continue;
                const result = evaluateRule(criterion.details.expected, observations);
                if (result.status !== 'FAILED') continue;
                const payload = { calls: item.attempts.flatMap(a => a.calls.map(c => ({ id: c.id, callId: c.callId, toolName: c.toolName, status: c.status }))), violations: violations.map(e => e.payload) };
                const proof = await tx.aiEvaluationEvidence.create({ data: { runId, caseResultId: item.id, kind: 'INTERRUPTED_SAFETY_TRACE', provenance: 'COVAI_OBSERVED', availability: 'AVAILABLE', completeness: 'PARTIAL', payload, contentHash: hash(payload) } });
                Object.assign(criterion, result);
                await tx.aiEvaluationCriterionResult.update({ where: { id: criterion.id }, data: { ...result, evidenceRefs: [proof.id] } });
                await tx.aiEvaluationCaseResult.update({ where: { id: item.id }, data: { verdict: 'FAILED' } });
            }
        }
        await tx.aiEvaluationAttempt.updateMany({ where: { caseResult: { runId }, gatewayState: 'OPEN' }, data: { gatewayState: 'CLOSED', tokenHash: null, status, finishedAt: new Date() } });
        await tx.aiEvaluationCaseResult.updateMany({ where: { runId, executionStatus: { in: ['PENDING', 'RUNNING'] } }, data: { executionStatus: status === 'COMPLETED' ? 'ERROR' : status, errorCode } });
        const summary = aggregateTrustProfile([...aggregationInputs(run.cases.flatMap(c => c.criteria)), ...(run.manifest.additionalCriteria || [])], run.manifest.scoring);
        const updated = await tx.aiEvaluationRun.update({ where: { id: runId }, data: { executionStatus: status, verdict: summary.verdict, summary, errorCode, leaseToken: null, leaseUntil: null, finishedAt: new Date() } });
        await tx.job.updateMany({ where: { id: run.jobId }, data: { status: status === 'COMPLETED' ? 'SUCCESS' : status === 'CANCELED' ? 'CANCELED' : 'FAILED', progress: status === 'COMPLETED' ? 100 : undefined, errorMessage: errorCode, finishedAt: new Date() } });
        return updated;
    });
}
export async function cancelRun(db, runId) {
    const result = await finalizeRun(db, runId, 'CANCELED', 'USER_CANCELED');
    controllers.get(runId)?.abort();
    return result;
}
export async function cancelEvaluationJob(jobId, db = prisma) {
    const run = await db.aiEvaluationRun.findUnique({ where: { jobId } });
    if (run) await cancelRun(db, run.id);
}
async function evidence(db, runId, caseResultId, attemptId, kind, payload, completeness = 'COMPLETE') {
    return serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "AiEvaluationRun" WHERE id = ${runId} FOR UPDATE`;
        const run = await tx.aiEvaluationRun.findUnique({ where: { id: runId } });
        if (run?.executionStatus !== 'RUNNING') return null;
        const bytes = Buffer.byteLength(JSON.stringify(payload));
        if (run.evidenceBytes + bytes > 64 * 1024 * 1024) fail('EVIDENCE_LIMIT', 'Run evidence limit is 64 MiB; split the benchmark into smaller runs');
        await tx.aiEvaluationRun.update({ where: { id: runId }, data: { evidenceBytes: { increment: bytes } } });
        const stored = await storeEvidencePayload(run.projectId, runId, payload);
        const row = await tx.aiEvaluationEvidence.create({ data: { runId, caseResultId, attemptId, kind, provenance: 'COVAI_OBSERVED', availability: 'AVAILABLE', completeness, payload: stored, contentHash: hash(payload) } });
        return { ...row, payload };
    });
}

export async function processEvaluation(jobId, { db = prisma, transport, provider, turnExecutor = executeTurn, parentSignal, redactionSecrets = [], protectedSecrets = [] } = {}) {
    requireEnabled();
    const found = await db.aiEvaluationRun.findUnique({ where: { jobId } });
    if (!found || TERMINAL.includes(found.executionStatus)) return;
    if (found.executionStatus === 'RUNNING') {
        if (!found.leaseUntil || found.leaseUntil <= new Date()) await finalizeRun(db, found.id, 'INDETERMINATE', 'WORKER_INTERRUPTED', undefined, found);
        return;
    }
    const leaseToken = crypto.randomUUID();
    const claim = await db.aiEvaluationRun.updateMany({ where: { id: found.id, executionStatus: 'QUEUED' }, data: { executionStatus: 'RUNNING', startedAt: new Date(), leaseToken, leaseUntil: new Date(Date.now() + 30000) } });
    if (!claim.count) return;
    const controller = new AbortController(); controllers.set(found.id, controller);
    const abortFromParent = () => controller.abort();
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    if (parentSignal?.aborted) controller.abort();
    let heartbeatBusy = false;
    const heartbeat = setInterval(async () => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        try {
            const [renewed, job] = await Promise.all([db.aiEvaluationRun.updateMany({ where: { id: found.id, executionStatus: 'RUNNING', leaseToken }, data: { leaseUntil: new Date(Date.now() + 30000) } }), db.job.findUnique({ where: { id: jobId }, select: { status: true } })]);
            if (!renewed.count || job?.status === 'CANCELED') controller.abort();
        } catch { controller.abort(); }
        finally { heartbeatBusy = false; }
    }, 5000);
    heartbeat.unref?.();
    try {
        const run = await db.aiEvaluationRun.findUnique({ where: { id: found.id }, include: { targetVersion: true, profileVersion: true, cases: { orderBy: { id: 'asc' }, include: { testCase: true } } } });
        const definition = { ...run.profileVersion.definition, sources: run.profileVersion.sourceManifest };
        if (definition.judge.enabled && run.manifest.agent && run.manifest.agent.benchmarkHash !== getAgentManifest('chatbot-trustworthiness').benchmarkHash) fail('AGENT_BENCHMARK_CHANGED', 'The agent benchmark changed while this run was queued; create a new run with the current benchmark');
        const credential = await targetCredential(db, run.targetVersion);
        const ownerJob = await db.job.findUnique({ where: { id: jobId }, select: { userId: true } });
        await db.job.updateMany({ where: { id: jobId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
        let completed = 0;
        for (const caseResult of run.cases) {
            if (controller.signal.aborted) break;
            const current = await db.aiEvaluationRun.findUnique({ where: { id: run.id }, select: { executionStatus: true, leaseToken: true } });
            if (current?.executionStatus !== 'RUNNING' || current.leaseToken !== leaseToken) break;
            const startedCase = await serial(db, async tx => {
                await tx.$queryRaw`SELECT id FROM "AiEvaluationRun" WHERE id = ${run.id} FOR UPDATE`;
                const live = await tx.aiEvaluationRun.findUnique({ where: { id: run.id } });
                if (live?.executionStatus !== 'RUNNING' || live.leaseToken !== leaseToken) return false;
                await tx.aiEvaluationCaseResult.update({ where: { id: caseResult.id }, data: { executionStatus: 'RUNNING' } });
                return true;
            });
            if (!startedCase) break;
            const testCase = caseResult.testCase.definition;
            const observations = []; const refs = [];
            for (let repetition = 0; repetition < testCase.repetitions && !controller.signal.aborted; repetition++) {
                const token = crypto.randomBytes(32).toString('base64url');
                const action = testCase.taskType === 'ACTION_TOOL';
                const attempt = await serial(db, async tx => {
                    await tx.$queryRaw`SELECT id FROM "AiEvaluationRun" WHERE id = ${run.id} FOR UPDATE`;
                    const live = await tx.aiEvaluationRun.findUnique({ where: { id: run.id } });
                    if (live?.executionStatus !== 'RUNNING' || live.leaseToken !== leaseToken) return null;
                    return tx.aiEvaluationAttempt.create({ data: { caseResultId: caseResult.id, repetition, requestId: crypto.randomUUID(), initialState: testCase.initialState, state: testCase.initialState, tokenHash: action ? hash(token) : null, gatewayState: action ? 'OPEN' : 'CLOSED', expiresAt: new Date(Date.now() + definition.limits.caseMs) } });
                });
                if (!attempt) { controller.abort(); break; }
                const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(definition.limits.caseMs)]);
                const messages = testCase.context ? [{ role: 'system', content: testCase.context }] : [];
                const responses = []; let conversationId; let errorCode; let credentialDisclosed = protectedSecrets.length ? false : null; const started = performance.now();
                try {
                    for (const turn of testCase.turns) {
                        if (signal.aborted) throw new Error('aborted');
                        messages.push({ role: 'user', content: turn.content });
                        const active = await db.aiEvaluationRun.findUnique({ where: { id: run.id }, select: { executionStatus: true, leaseToken: true } });
                        if (active?.executionStatus !== 'RUNNING' || active.leaseToken !== leaseToken) { controller.abort(); throw new Error('aborted'); }
                        const dispatch = await serial(db, async tx => {
                            await tx.$queryRaw`SELECT id FROM "AiEvaluationRun" WHERE id = ${run.id} FOR UPDATE`;
                            const live = await tx.aiEvaluationRun.findUnique({ where: { id: run.id } });
                            if (live?.executionStatus !== 'RUNNING' || live.leaseToken !== leaseToken) return false;
                            await tx.aiEvaluationAttempt.update({ where: { id: attempt.id }, data: { status: 'DISPATCHED', dispatchedAt: new Date() } });
                            return true;
                        });
                        if (!dispatch) { controller.abort(); throw new Error('aborted'); }
                        const evaluationContext = action ? { executionMode: 'COVAI_MOCK_GATEWAY', gateway: { baseUrl: process.env.AI_EVALUATION_GATEWAY_URL.replace(/\/$/, ''), sessionId: attempt.id, token, expiresAt: attempt.expiresAt.toISOString() }, toolCatalog: definition.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } : { executionMode: 'ANSWER_ONLY', toolsAllowed: false };
                        if (run.targetVersion.config.adapter === 'PROJECT_SANDBOX' && turnExecutor === executeTurn) fail('PROJECT_SANDBOX_REQUIRED', 'Imported project runs require their isolated runtime');
                        const response = await turnExecutor(run.targetVersion.config, { requestId: `${attempt.requestId}-${responses.length}`, messages: run.targetVersion.config.conversationMode === 'session' && conversationId ? [messages.at(-1)] : messages, conversationId, evaluationContext, signal }, { credential, transport, timeoutMs: definition.limits.requestMs });
                        conversationId = response.conversationId;
                        if (protectedSecrets.some(secret => response.answer?.includes(secret))) credentialDisclosed = true;
                        responses.push(redact(response, [credential, token, ...redactionSecrets]));
                        messages.push({ role: 'assistant', content: response.answer });
                    }
                } catch (error) { errorCode = controller.signal.aborted ? 'RUN_CANCELED' : signal.aborted ? 'CASE_TIMEOUT' : safeError(error).code; }
                try { await turnExecutor.closeConversation?.(conversationId); } catch { errorCode ||= 'CHATBOT_SESSION_CLEANUP_FAILED'; }
                const closed = await closeGateway(db, attempt.id, errorCode ? 'ERROR' : 'COMPLETED');
                const gateway = action && closed ? { gatewayState: closed.gatewayState, status: closed.status, state: closed.state, initialState: closed.initialState, calls: closed.calls, grants: closed.grants } : null;
                const violations = (await db.aiEvaluationEvidence.findMany({ where: { runId: run.id, attemptId: attempt.id, kind: 'GATEWAY_VIOLATION' } })).map(e => e.payload);
                if (violations.some(v => ['TOOL_LIMIT', 'CONFIRMATION_LIMIT'].includes(v.code))) errorCode ||= 'GATEWAY_LIMIT';
                const observation = { responses, gateway, violations, credentialDisclosed, latencyMs: Math.round(performance.now() - started), ...(errorCode ? { errorCode } : {}) };
                observations.push(observation);
                // Raw credentials and gateway context never enter persisted conversation evidence.
                refs.push(await evidence(db, run.id, caseResult.id, attempt.id, 'CONVERSATION', { messages: redact(messages, [credential, token, ...redactionSecrets]), responses, credentialDisclosed, latencyMs: observation.latencyMs, errorCode: errorCode || null }, errorCode ? 'PARTIAL' : 'COMPLETE'));
                if (gateway) refs.push(await evidence(db, run.id, caseResult.id, attempt.id, 'GATEWAY_TRACE', gateway, errorCode ? 'PARTIAL' : 'COMPLETE'));
            }
            if (controller.signal.aborted) break;
            const results = await evaluateCase(testCase, definition, observations, refs.filter(Boolean), { signal: controller.signal, provider, quota: { db, userId: ownerJob.userId, key: `evaluation:${run.id}:${caseResult.id}` } });
            await serial(db, async tx => {
                await tx.$queryRaw`SELECT id FROM "AiEvaluationRun" WHERE id = ${run.id} FOR UPDATE`;
                const live = await tx.aiEvaluationRun.findUnique({ where: { id: run.id } });
                if (live.executionStatus !== 'RUNNING' || live.leaseToken !== leaseToken) return;
                for (const result of results) await tx.aiEvaluationCriterionResult.update({ where: { caseResultId_criterionKey: { caseResultId: caseResult.id, criterionKey: result.criterionKey } }, data: result });
                const summary = aggregateTrustProfile(aggregationInputs(results), definition.scoring);
                await tx.aiEvaluationCaseResult.update({ where: { id: caseResult.id }, data: { executionStatus: observations.some(o => o.errorCode) ? 'ERROR' : 'COMPLETED', verdict: summary.verdict, errorCode: observations.find(o => o.errorCode)?.errorCode || null } });
            });
            completed++;
            const progress = Math.round(completed / run.cases.length * 100);
            await db.job.updateMany({ where: { id: jobId, status: 'RUNNING' }, data: { progress } });
            const job = await db.job.findUnique({ where: { id: jobId }, select: { userId: true } });
            if (job?.userId) global.io?.to(`user:${job.userId}`).emit('evaluation:progress', { projectId: run.projectId, runId: run.id, jobId, completed, total: run.cases.length, executionStatus: 'RUNNING' });
        }
        const status = controller.signal.aborted ? 'INDETERMINATE' : 'COMPLETED';
        await finalizeRun(db, run.id, status, controller.signal.aborted ? 'EXECUTION_INTERRUPTED' : null, leaseToken);
        const job = await db.job.findUnique({ where: { id: jobId }, select: { userId: true } });
        if (job?.userId) {
            await db.notification.create({ data: { userId: job.userId, projectId: run.projectId, type: 'JOB_FINISHED', title: 'Chatbot evaluation finished', message: 'Open AI Evaluation to inspect scores and evidence.' } }).catch(() => {});
            global.io?.to(`user:${job.userId}`).emit('evaluation:progress', { projectId: run.projectId, runId: run.id, jobId, executionStatus: status });
        }
    } catch (error) {
        console.error('[AI Evaluation] Runner failed', { runId: found.id, code: error.code || error.name, databaseCode: error.meta?.code || error.meta?.driverAdapterError?.cause?.originalCode, frames: error.stack?.split('\n').filter(line => /^\s+at /.test(line)).slice(0, 4).join('\n') });
        await finalizeRun(db, found.id, 'ERROR', safeError(error).code, leaseToken);
    }
    finally { clearInterval(heartbeat); controllers.delete(found.id); parentSignal?.removeEventListener('abort', abortFromParent); }
}

export async function processEvaluationPrepare(jobId, { db = prisma, provider } = {}) {
    requireEnabled();
    const pending = await db.job.findUnique({ where: { id: jobId } });
    if (pending && JSON.parse(pending.payloadJson || '{}').projectEvaluationId) return (await import('./projectEvaluation.service.js')).processProjectEvaluation(jobId, { db, provider });
    const claim = await db.job.updateMany({ where: { id: jobId, type: 'AI_EVALUATION_PREPARE', status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
    if (!claim.count) return;
    const job = await db.job.findUnique({ where: { id: jobId } });
    const payload = JSON.parse(job.payloadJson);
    try {
        let result;
        if (payload.sourceId) {
            const source = await db.aiEvaluationKnowledgeSource.findFirst({ where: { id: payload.sourceId, projectId: job.projectId, status: 'PROCESSING' } });
            if (!source) throw new Error('Source unavailable');
            const extracted = await extractKnowledge(Buffer.from(source.content, 'base64'), source.name);
            await db.aiEvaluationKnowledgeSource.update({ where: { id: source.id }, data: { ...extracted, status: 'READY' } });
            result = { sourceId: source.id };
        } else {
            const version = await db.aiEvaluationProfileVersion.findFirst({ where: { id: payload.profileVersionId, profile: { projectId: job.projectId } } });
            if (!version || version.status !== 'DRAFT' || version.revision !== payload.revision) throw new Error('Draft changed');
            const sources = await db.aiEvaluationKnowledgeSource.findMany({ where: { id: { in: version.definition.sourceIds }, projectId: job.projectId, status: 'READY' } });
            if (!sources.length) throw new Error('Knowledge required');
            const proposed = await providerJson(version.definition.judge, { sources: sources.map(({ id, content }) => ({ id, content })), rules: version.definition.rules, tools: version.definition.tools }, { purpose: 'proposal', signal: AbortSignal.timeout(120000), provider, quota: { db, userId: job.userId, key: `evaluation-proposal:${jobId}` } });
            result = { profileVersionId: version.id, revision: version.revision, cases: proposed.result.cases.map(c => parse(caseSchema, c)), evaluator: proposed.evaluator, status: 'PROPOSAL_ONLY' };
        }
        await db.job.updateMany({ where: { id: jobId, status: 'RUNNING' }, data: { status: 'SUCCESS', progress: 100, finishedAt: new Date(), resultJson: JSON.stringify(result) } });
    } catch (error) {
        if (payload.sourceId) await db.aiEvaluationKnowledgeSource.updateMany({ where: { id: payload.sourceId, projectId: job.projectId }, data: { status: 'ERROR', content: '', provenance: { errorCode: safeError(error).code, message: safeError(error).message } } });
        await db.job.updateMany({ where: { id: jobId, status: 'RUNNING' }, data: { status: 'FAILED', errorMessage: safeError(error).message, finishedAt: new Date() } });
    }
}

export async function reconcileEvaluations(db = prisma) {
    await (await import('./projectEvaluation.service.js')).reconcileProjectEvaluations(db);
    const stale = await db.aiEvaluationRun.findMany({ where: { OR: [{ executionStatus: 'RUNNING', leaseUntil: { lt: new Date() } }, { executionStatus: 'QUEUED', createdAt: { lt: new Date(Date.now() - 300000) } }] }, take: 100 });
    for (const run of stale) await finalizeRun(db, run.id, run.executionStatus === 'RUNNING' ? 'INDETERMINATE' : 'ERROR', run.executionStatus === 'RUNNING' ? 'WORKER_INTERRUPTED' : 'QUEUE_DELIVERY_TIMEOUT', undefined, run);
    const prepared = await db.job.findMany({ where: { type: 'AI_EVALUATION_PREPARE', status: { in: ['QUEUED', 'RUNNING'] }, createdAt: { lt: new Date(Date.now() - 300000) } }, take: 100 });
    for (const job of prepared) {
        const payload = JSON.parse(job.payloadJson || '{}');
        if (payload.projectEvaluationId) continue;
        if (payload.sourceId) await db.aiEvaluationKnowledgeSource.updateMany({ where: { id: payload.sourceId, status: 'PROCESSING' }, data: { status: 'ERROR', content: '', provenance: { errorCode: 'PREPARATION_INTERRUPTED' } } });
        await db.job.updateMany({ where: { id: job.id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'FAILED', errorMessage: 'Preparation interrupted; submit a new preparation request', finishedAt: new Date() } });
    }
}
