import crypto from 'node:crypto';
import { getAgentManifest } from '../../agents/registry.js';
import prisma from '../../config/prisma.js';
import { executeTurn } from './httpJson.adapter.js';
import { classifyTargetFailure, createTargetPacer } from './targetRateLimit.js';
import { targetCredential, runFor } from './management.service.js';
import { closeGateway } from './gateway.service.js';
import { evaluateCase, evaluateRule, aggregationInputs, deriveCaseRepetitionVerdicts } from './evaluator.service.js';
import { aggregateTrustProfile } from './scoring.service.js';
import { hash, redact, serial, safeError, TERMINAL, requireEnabled, fail, lastLogLines, isBehaviorOnly } from './common.js';
import { extractKnowledge } from './knowledge.service.js';
import { generateChatbotScenarios, providerJson } from './judge.service.js';
import { parse, caseSchema } from './contracts.js';
import { storeEvidencePayload } from './artifactStore.service.js';
import { readEphemeralSecret, destroyEphemeralSecret } from './ephemeralSecret.service.js';
import {
    startManagedChatbotRuntime,
    probeChatbotKnowledgeReadiness,
    cleanupOrphanedChatbotRuntime,
} from './chatbotRuntime.service.js';

const controllers = new Map();
const cleanups = new Map();

export function emitEvaluationEvent(event, payload, userId) {
    if (!global.io) return;
    const rooms = [];
    if (payload?.projectId) rooms.push(`project:${payload.projectId}`);
    if (userId) rooms.push(`user:${userId}`);
    if (rooms.length) global.io.to(rooms).emit(event, payload);
}

export const LEASE_RENEW_MS = 10_000;
export const LEASE_TTL_MS = 60_000;

function sleepWithSignal(ms, signal) {
    if (!Number.isFinite(ms) || ms <= 0 || signal?.aborted) return Promise.resolve();
    return new Promise(resolve => {
        const onAbort = () => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        timer.unref?.();
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function createActiveTimeBudget(caseMs) {
    const controller = new AbortController();
    let remaining = caseMs;
    let started;
    let timer;
    return {
        signal: controller.signal,
        resume() {
            started = performance.now();
            timer = setTimeout(() => controller.abort(), Math.ceil(remaining));
            timer.unref?.();
        },
        pause() {
            if (timer === undefined) return;
            clearTimeout(timer);
            timer = undefined;
            remaining -= performance.now() - started;
            if (remaining <= 0) controller.abort();
        },
    };
}

function parseSecretRefs(payloadJson) {
    if (!payloadJson || typeof payloadJson !== 'string') return {};
    try {
        const parsed = JSON.parse(payloadJson);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function wipeSecretRefs(refs) {
    if (!refs || typeof refs !== 'object') return;
    if (refs.llmKeyRef) destroyEphemeralSecret(refs.llmKeyRef);
    if (refs.targetTokenRef) destroyEphemeralSecret(refs.targetTokenRef);
}

async function destroyJobSecrets(db, jobId) {
    if (!jobId) return;
    const job = await db.job.findUnique({
        where: { id: jobId },
        select: { id: true, payloadJson: true },
    });
    if (!job?.payloadJson) return;
    wipeSecretRefs(parseSecretRefs(job.payloadJson));
    if (job.payloadJson !== '{}') {
        await db.job.updateMany({ where: { id: jobId }, data: { payloadJson: '{}' } });
    }
}

/**
 * Builds the persisted run summary from case/criterion rows. Shared by run
 * finalization and by "grade again" (regrade.service.js).
 * run must include cases[].testCase (caseKey, taskType, definition), cases[].criteria,
 * evidence[] (CONVERSATION payloads), manifest and summary.
 */
export function buildRunSummary(run, status, extraSummary = null) {
    const caseOutcomes = run.cases.map(c => {
        const repCount = c.testCase?.definition?.repetitions
            || (c.criteria.find(r => Array.isArray(r.details?.repetitionVerdicts))?.details?.repetitionVerdicts?.length ?? 0);
        const resolvedExecutionStatus = ['PENDING', 'RUNNING'].includes(c.executionStatus)
            ? (status === 'COMPLETED' ? 'ERROR' : status)
            : c.executionStatus;
        return {
            caseKey: c.testCase.caseKey,
            taskType: c.testCase.taskType,
            executionStatus: resolvedExecutionStatus,
            verdict: c.verdict,
            repetitionVerdicts: deriveCaseRepetitionVerdicts(c.criteria, repCount),
        };
    });
    const inlineLatenciesMs = run.evidence
        .filter(e => !e.kind || e.kind === 'CONVERSATION')
        .map(e => e.payload)
        .filter(p => p && !p._artifact && !p.errorCode && typeof p.latencyMs === 'number' && Number.isFinite(p.latencyMs))
        .map(p => p.latencyMs);
    const latenciesMs = Array.isArray(extraSummary?._observedLatenciesMs)
        ? extraSummary._observedLatenciesMs
        : inlineLatenciesMs;

    const unverifiedReferenceCaseKeys = run.cases
        .filter(c => c.testCase?.definition?.referenceUnverified === true)
        .map(c => c.testCase.caseKey);

    const baseSummary = aggregateTrustProfile(
        [...aggregationInputs(run.cases.flatMap(c => c.criteria)), ...(run.manifest.additionalCriteria || [])],
        run.manifest.scoring,
        {
            caseOutcomes,
            latenciesMs,
            latencySlaMs: run.manifest?.limits?.latencySlaMs ?? 5000,
        },
    );

    let cleanExtra = null;
    if (extraSummary && typeof extraSummary === 'object') {
        const { _observedLatenciesMs, _activeRuntime, ...rest } = extraSummary;
        cleanExtra = rest;
    }
    const persistedProbe = run.summary?.knowledgeProbe && !cleanExtra?.knowledgeProbe
        ? { knowledgeProbe: run.summary.knowledgeProbe }
        : null;
    return {
        ...baseSummary,
        unverifiedReferenceCount: unverifiedReferenceCaseKeys.length,
        ...(unverifiedReferenceCaseKeys.length > 0 ? { unverifiedReferenceCaseKeys } : {}),
        ...(persistedProbe || {}),
        ...(cleanExtra || {}),
    };
}

export async function finalizeRun(db, runId, status, errorCode = null, leaseToken, extraSummary = null, errorMessage = null, staleSnapshot) {
    let refsToDestroy = null;
    const finalized = await serial(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "AiEvaluationRun" WHERE id = ${runId} FOR UPDATE`;
        const run = await tx.aiEvaluationRun.findUnique({
            where: { id: runId },
            include: {
                cases: {
                    orderBy: { id: 'asc' },
                    include: {
                        testCase: { select: { id: true, caseKey: true, taskType: true, definition: true } },
                        criteria: true,
                        attempts: { include: { calls: true } },
                    },
                },
                evidence: {
                    where: { kind: { in: ['CONVERSATION', 'GATEWAY_VIOLATION'] } },
                    select: { id: true, caseResultId: true, attemptId: true, kind: true, payload: true },
                },
            },
        });
        if (!run) return null;
        if (TERMINAL.includes(run.executionStatus)) {
            const job = await tx.job.findUnique({ where: { id: run.jobId }, select: { payloadJson: true } });
            refsToDestroy = parseSecretRefs(job?.payloadJson);
            if (job?.payloadJson && job.payloadJson !== '{}') {
                await tx.job.updateMany({ where: { id: run.jobId }, data: { payloadJson: '{}' } });
            }
            return run;
        }
        if (leaseToken && run.leaseToken !== leaseToken) return run;
        if (staleSnapshot && (run.executionStatus !== staleSnapshot.executionStatus || run.leaseToken !== staleSnapshot.leaseToken || (run.leaseUntil?.getTime() ?? null) !== (staleSnapshot.leaseUntil?.getTime() ?? null))) return run;
        // An interrupted conversation must not erase a safety violation already observed by the gateway.
        for (const item of run.cases) {
            const violations = run.evidence.filter(e => e.kind === 'GATEWAY_VIOLATION' && e.caseResultId === item.id);
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
                item.verdict = 'FAILED';
            }
        }

        const job = await tx.job.findUnique({ where: { id: run.jobId }, select: { payloadJson: true } });
        refsToDestroy = parseSecretRefs(job?.payloadJson);

        await tx.aiEvaluationAttempt.updateMany({
            where: { caseResult: { runId }, gatewayState: 'OPEN' },
            data: { gatewayState: 'CLOSED', tokenHash: null, status, finishedAt: new Date() },
        });
        await tx.aiEvaluationCaseResult.updateMany({
            where: { runId, executionStatus: { in: ['PENDING', 'RUNNING'] } },
            data: { executionStatus: status === 'COMPLETED' ? 'ERROR' : status, errorCode },
        });

        const summary = buildRunSummary(run, status, extraSummary);

        const updated = await tx.aiEvaluationRun.update({
            where: { id: runId },
            data: { executionStatus: status, verdict: summary.verdict, summary, errorCode, leaseToken: null, leaseUntil: null, finishedAt: new Date() },
        });
        await tx.job.updateMany({
            where: { id: run.jobId },
            data: {
                status: status === 'COMPLETED' ? 'SUCCESS' : status === 'CANCELED' ? 'CANCELED' : 'FAILED',
                progress: status === 'COMPLETED' ? 100 : undefined,
                errorMessage: errorMessage || errorCode,
                payloadJson: '{}',
                finishedAt: new Date(),
            },
        });
        return updated;
    });
    wipeSecretRefs(refsToDestroy);
    return finalized;
}

export async function cancelRun(db, runId) {
    controllers.get(runId)?.abort('USER_CANCELED');
    await cleanups.get(runId)?.();
    const result = await finalizeRun(db, runId, 'CANCELED', 'USER_CANCELED');
    if (result?.jobId) {
        await destroyJobSecrets(db, result.jobId);
    }
    return result;
}

export async function cancelProjectRun(db, projectId, runId) {
    await runFor(db, projectId, runId);
    return cancelRun(db, runId);
}

export async function cancelEvaluationJob(jobId, db = prisma) {
    const run = await db.aiEvaluationRun.findUnique({ where: { jobId }, select: { id: true } });
    if (run) {
        await cancelRun(db, run.id);
    } else {
        await destroyJobSecrets(db, jobId);
    }
}

async function evidence(db, { id: runId, projectId }, caseResultId, attemptId, kind, payload, completeness = 'COMPLETE') {
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    const stored = await storeEvidencePayload(projectId, runId, payload);
    const updated = await db.$executeRaw`UPDATE "AiEvaluationRun" SET "evidenceBytes" = "evidenceBytes" + ${bytes} WHERE id = ${runId} AND "executionStatus" = 'RUNNING' AND "evidenceBytes" + ${bytes} <= ${64 * 1024 * 1024}`;
    if (updated === 0) {
        const run = await db.aiEvaluationRun.findUnique({ where: { id: runId }, select: { executionStatus: true } });
        if (run?.executionStatus !== 'RUNNING') return null;
        fail('EVIDENCE_LIMIT', 'Run evidence limit is 64 MiB; split the benchmark into smaller runs');
    }
    const row = await db.aiEvaluationEvidence.create({ data: { runId, caseResultId, attemptId, kind, provenance: 'COVAI_OBSERVED', availability: 'AVAILABLE', completeness, payload: stored, contentHash: hash(payload) } });
    return { ...row, payload };
}

export async function processEvaluation(jobId, {
    db = prisma, transport, provider, onBeforeWorkspaceCleanup,
    turnExecutor = executeTurn, parentSignal, redactionSecrets = [], protectedSecrets = [],
} = {}) {
    const runStartedAt = performance.now();
    try {
        requireEnabled();
    } catch (error) {
        await destroyJobSecrets(db, jobId).catch(() => {});
        throw error;
    }
    const found = await db.aiEvaluationRun.findUnique({
        where: { jobId },
        select: { id: true, projectId: true, executionStatus: true, leaseToken: true, leaseUntil: true },
    });
    if (!found) {
        // "Grade again" jobs reuse the AI_EVALUATION job type (shared JobType enum) and own no run row.
        const job = await db.job.findUnique({ where: { id: jobId }, select: { payloadJson: true } });
        const { parseRegradePayload, processRegrade } = await import('./regrade.service.js');
        if (parseRegradePayload(job?.payloadJson)) {
            await processRegrade(jobId, { db, provider });
            return;
        }
    }
    if (!found || TERMINAL.includes(found.executionStatus)) {
        await destroyJobSecrets(db, jobId);
        return;
    }
    if (found.executionStatus === 'RUNNING') {
        if (!found.leaseUntil || found.leaseUntil <= new Date()) {
            await finalizeRun(db, found.id, 'INDETERMINATE', 'WORKER_INTERRUPTED', undefined, undefined, undefined, found);
        }
        return;
    }
    const leaseToken = crypto.randomUUID();
    const claim = await db.aiEvaluationRun.updateMany({
        where: { id: found.id, executionStatus: 'QUEUED' },
        data: { executionStatus: 'RUNNING', startedAt: new Date(), leaseToken, leaseUntil: new Date(Date.now() + LEASE_TTL_MS) },
    });
    if (!claim.count) {
        const latest = await db.aiEvaluationRun.findUnique({ where: { id: found.id }, select: { executionStatus: true } });
        if (!latest || TERMINAL.includes(latest.executionStatus)) {
            await destroyJobSecrets(db, jobId);
        }
        return;
    }

    let writeChain = Promise.resolve();
    const withRunWriteLock = fn => {
        const next = writeChain.then(fn, fn);
        writeChain = next.catch(() => {});
        return next;
    };

    const controller = new AbortController();
    controllers.set(found.id, controller);
    const abortFromParent = () => controller.abort();
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    if (parentSignal?.aborted) controller.abort();
    let heartbeatBusy = false;
    let lastLeaseRenewal = Date.now();
    const heartbeat = setInterval(async () => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        try {
            const [live, job] = await Promise.all([
                db.aiEvaluationRun.findUnique({ where: { id: found.id }, select: { executionStatus: true, leaseToken: true } }),
                db.job.findUnique({ where: { id: jobId }, select: { status: true } }),
            ]);
            if (!live || live.executionStatus !== 'RUNNING' || live.leaseToken !== leaseToken || job?.status === 'CANCELED') controller.abort();
            if (!cleanupPromise && !controller.signal.aborted && Date.now() - lastLeaseRenewal >= LEASE_RENEW_MS) {
                lastLeaseRenewal = Date.now();
                const renewed = await withRunWriteLock(() => db.aiEvaluationRun.updateMany({
                    where: { id: found.id, executionStatus: 'RUNNING', leaseToken },
                    data: { leaseUntil: new Date(Date.now() + LEASE_TTL_MS) },
                }));
                if (renewed.count === 0) controller.abort();
            }
        } catch (error) {
            console.error('[Evaluation] Heartbeat failed:', redact(String(error?.message || error), runSecrets));
            controller.abort();
        } finally {
            heartbeatBusy = false;
        }
    }, 1000);
    heartbeat.unref?.();

    let secretRefs = {};
    let managedRuntime = null;
    const runSecrets = [...redactionSecrets];
    let extraSummary = null;
    let bootProgress = null;
    let cleanupPromise;
    const cleanup = () => cleanupPromise ??= (async () => {
        clearInterval(heartbeat);
        if (bootProgress) {
            try {
                emitEvaluationEvent('evaluation:progress', {
                    projectId: bootProgress.projectId, runId: found.id, jobId,
                    phase: 'SHUTTING_DOWN', executionStatus: 'RUNNING',
                }, bootProgress.userId);
            } catch (error) {
                console.error('[Evaluation] Shutdown progress emit failed:', redact(String(error?.message || error), runSecrets));
            }
        }
        await managedRuntime?.stop().catch(err => console.error('[Evaluation] Managed runtime stop failed:', redact(String(err?.message || err), runSecrets)));
        wipeSecretRefs(secretRefs);
        await destroyJobSecrets(db, jobId).catch(err => console.error('[Evaluation] Secret cleanup warning:', err?.message || 'unknown'));
    })();
    cleanups.set(found.id, cleanup);
    try {
        const run = await db.aiEvaluationRun.findUnique({ where: { id: found.id }, include: { targetVersion: true, profileVersion: true, cases: { orderBy: { id: 'asc' }, include: { testCase: true } } } });
        const ownerJob = await db.job.findUnique({ where: { id: jobId }, select: { userId: true, payloadJson: true } });
        secretRefs = parseSecretRefs(ownerJob?.payloadJson);
        const definition = { ...run.profileVersion.definition, sources: run.profileVersion.sourceManifest };
        if (definition.judge.enabled && run.manifest.agent && run.manifest.agent.benchmarkHash !== getAgentManifest('chatbot-trustworthiness').benchmarkHash) fail('AGENT_BENCHMARK_CHANGED', 'The agent benchmark changed while this run was queued; create a new run with the current benchmark');
        const credential = await targetCredential(db, run.targetVersion, secretRefs.targetTokenRef || null, run.projectId);
        const llmSecretForRedaction = secretRefs.llmKeyRef
            ? readEphemeralSecret(secretRefs.llmKeyRef, { projectId: run.projectId })
            : null;
        runSecrets.push(...[credential, llmSecretForRedaction].filter(s => typeof s === 'string' && s.length > 0));

        await db.job.updateMany({ where: { id: jobId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });

        const bootStartedAt = performance.now();
        if (run.targetVersion.config.executionMode === 'MANAGED_PROJECT') {
            bootProgress = { projectId: run.projectId, userId: ownerJob?.userId };
            if (ownerJob?.userId) {
                emitEvaluationEvent('evaluation:progress', {
                    projectId: run.projectId,
                    runId: run.id,
                    jobId,
                    phase: 'BOOTING_CHATBOT',
                    executionStatus: 'RUNNING',
                }, ownerJob.userId);
            }
            managedRuntime = await startManagedChatbotRuntime({
                db,
                projectId: run.projectId,
                snapshotId: run.snapshotId,
                jobId,
                llmKeyRef: secretRefs.llmKeyRef,
                extraSecrets: [credential].filter(Boolean),
                extraEnvironment: run.targetVersion.config.environment || {},
                configuredLlmEnvVars: run.targetVersion.config.llmEnvVars || [],
                signal: controller.signal,
                onBeforeWorkspaceCleanup,
            });
            await withRunWriteLock(() => db.aiEvaluationRun.update({
                where: { id: run.id },
                data: {
                    summary: {
                        _activeRuntime: {
                            pid: managedRuntime.pid,
                            port: managedRuntime.port,
                            workspaceDirName: managedRuntime.workspaceDirName,
                            sqlContainer: managedRuntime.sqlContainer,
                        },
                    },
                },
                select: { id: true },
            }));
        }

        const probeStartedAt = performance.now();
        const probeEligible =
            run.targetVersion.config.executionMode === 'MANAGED_PROJECT' ||
            (Array.isArray(definition.sources) && definition.sources.length > 0);
        if (isBehaviorOnly(definition.sources)) {
            extraSummary = { knowledgeProbe: { skipped: true, ready: null, status: 'NOT_APPLICABLE', probes: [] } };
        } else if (run.manifest?.skipKnowledgeProbe) {
            extraSummary = {
                knowledgeProbe: {
                    skipped: true,
                    ready: null,
                    status: 'SKIPPED_BY_USER',
                    warning: 'Knowledge readiness probe was bypassed by user override (skipKnowledgeProbe: true).',
                    probes: [],
                },
            };
        } else if (probeEligible) {
            if (ownerJob?.userId) {
                emitEvaluationEvent('evaluation:progress', {
                    projectId: run.projectId,
                    runId: run.id,
                    jobId,
                    phase: 'PROBING_KNOWLEDGE',
                    executionStatus: 'RUNNING',
                }, ownerJob.userId);
            }
            const probeResult = await probeChatbotKnowledgeReadiness({
                targetConfig: run.targetVersion.config,
                caseRows: run.cases,
                sources: definition.sources,
                credential,
                lease: managedRuntime?.loopbackLease || null,
                transport,
                secretsToRedact: runSecrets,
                timeoutMs: definition.limits.requestMs,
                signal: controller.signal,
            });
            extraSummary = { knowledgeProbe: probeResult };
        }

        const observedLatenciesMs = [];
        const pacer = createTargetPacer({
            sleep: (ms, signal) => sleepWithSignal(process.env.NODE_ENV === 'test' ? Math.min(ms, 10) : ms, signal),
        });
        const rateLimit = { hits: 0, waitedMs: 0, dailyQuota: false };
        const targetConcurrency = Math.min(16, Math.max(1, Number.parseInt(process.env.AI_EVALUATION_TARGET_CONCURRENCY || '', 10) || 4));
        const targetWaiters = [];
        let activeTargetRequests = 0;
        async function withTargetSlot(execute) {
            if (activeTargetRequests >= targetConcurrency) {
                await new Promise(resolve => targetWaiters.push(resolve));
            } else {
                activeTargetRequests++;
            }
            try {
                return await execute();
            } finally {
                const next = targetWaiters.shift();
                if (next) next();
                else activeTargetRequests--;
            }
        }
        let completed = 0;
        let stopStartingCases = false;
        let firstError = null;
        const judgeConcurrency = Math.min(12, Math.max(1, Number.parseInt(process.env.AI_EVALUATION_JUDGE_CONCURRENCY || '', 10) || 6));
        const judgePromises = [];
        const judgeWaiters = [];
        let activeJudges = 0;
        async function withJudgeSlot(execute) {
            if (activeJudges >= judgeConcurrency) {
                await new Promise(resolve => judgeWaiters.push(resolve));
            } else {
                activeJudges++;
            }
            try {
                return await execute();
            } finally {
                const next = judgeWaiters.shift();
                if (next) next();
                else activeJudges--;
            }
        }
        async function processCase(caseIndex) {
            const caseResult = run.cases[caseIndex];
            if (controller.signal.aborted) return;
            const current = await db.aiEvaluationRun.findUnique({ where: { id: run.id }, select: { executionStatus: true, leaseToken: true } });
            if (current?.executionStatus !== 'RUNNING' || current.leaseToken !== leaseToken) {
                stopStartingCases = true;
                return;
            }
            if (stopStartingCases || controller.signal.aborted) return;
            await db.aiEvaluationCaseResult.update({ where: { id: caseResult.id }, data: { executionStatus: 'RUNNING' } });
            const testCase = caseResult.testCase.definition;
            const observations = [];
            const refs = [];
            function emitScenarioProgress(repetition, waiting) {
                if (ownerJob?.userId) {
                    emitEvaluationEvent('evaluation:progress', {
                        projectId: run.projectId,
                        runId: run.id,
                        jobId,
                        phase: 'RUNNING_SCENARIO',
                        caseKey: testCase.caseKey,
                        taskType: testCase.taskType,
                        repetition: repetition + 1,
                        totalRepetitions: testCase.repetitions,
                        completed,
                        total: run.cases.length,
                        executionStatus: 'RUNNING',
                        ...waiting,
                    }, ownerJob.userId);
                }
            }
            async function runRepetition(repetition) {
                emitScenarioProgress(repetition);
                const token = crypto.randomBytes(32).toString('base64url');
                const attemptSecrets = [...runSecrets, token];
                const action = testCase.taskType === 'ACTION_TOOL';
                const attempt = await db.aiEvaluationAttempt.create({
                    data: {
                        caseResultId: caseResult.id,
                        repetition,
                        requestId: crypto.randomUUID(),
                        initialState: testCase.initialState,
                        state: testCase.initialState,
                        tokenHash: action ? hash(token) : null,
                        gatewayState: action ? 'OPEN' : 'CLOSED',
                        expiresAt: new Date(Date.now() + definition.limits.caseMs),
                    },
                });
                const activeTime = action ? null : createActiveTimeBudget(definition.limits.caseMs);
                const signal = AbortSignal.any([controller.signal, activeTime?.signal ?? AbortSignal.timeout(definition.limits.caseMs)]);
                const messages = testCase.context ? [{ role: 'system', content: testCase.context }] : [];
                const responses = [];
                let conversationId;
                let errorCode;
                let errorMessage;
                let credentialDisclosed = protectedSecrets.length ? false : null;
                let latencyMs = 0;
                try {
                    for (const turn of testCase.turns) {
                        if (signal.aborted) throw new Error('aborted');
                        messages.push({ role: 'user', content: turn.content });
                        const active = await db.aiEvaluationRun.findUnique({ where: { id: run.id }, select: { executionStatus: true, leaseToken: true } });
                        if (active?.executionStatus !== 'RUNNING' || active.leaseToken !== leaseToken) { controller.abort(); throw new Error('aborted'); }
                        await db.aiEvaluationAttempt.update({ where: { id: attempt.id }, data: { status: 'DISPATCHED', dispatchedAt: new Date() } });
                        const evaluationContext = action
                            ? {
                                executionMode: 'COVAI_MOCK_GATEWAY',
                                gateway: { baseUrl: process.env.AI_EVALUATION_GATEWAY_URL.replace(/\/$/, ''), sessionId: attempt.id, token, expiresAt: attempt.expiresAt.toISOString() },
                                toolCatalog: definition.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
                            }
                            : { executionMode: 'ANSWER_ONLY', toolsAllowed: false };
                        let response;
                        let rateLimitRetries = 0;
                        let transientRetries = 0;
                        for (;;) {
                            let retryDelayMs;
                            let transientError;
                            response = await withTargetSlot(async () => {
                                await pacer.beforeRequest(signal);
                                if (signal.aborted) throw new Error('aborted');
                                const started = performance.now();
                                try {
                                    let result;
                                    activeTime?.resume();
                                    try {
                                        result = await turnExecutor(
                                            run.targetVersion.config,
                                            { requestId: `${attempt.requestId}-${responses.length}`, conversationKey: attempt.requestId, messages: run.targetVersion.config.conversationMode === 'session' && conversationId ? [messages.at(-1)] : messages, conversationId, evaluationContext, signal },
                                            { credential, lease: managedRuntime?.loopbackLease || null, transport, timeoutMs: definition.limits.requestMs },
                                        );
                                    } finally {
                                        activeTime?.pause();
                                    }
                                    if (signal.aborted) throw new Error('aborted');
                                    latencyMs += performance.now() - started;
                                    return result;
                                } catch (error) {
                                    if (signal.aborted) throw error;
                                    const failure = classifyTargetFailure(error);
                                    if (failure.kind === 'DAILY_QUOTA' || failure.kind === 'RATE_LIMIT') {
                                        rateLimit.hits++;
                                        extraSummary = { ...(extraSummary || {}), rateLimit };
                                        if (failure.kind === 'DAILY_QUOTA') {
                                            rateLimit.dailyQuota = true;
                                            pacer.onDailyQuota(error);
                                            throw error;
                                        }
                                        const alreadyWaiting = pacer.waitingUntil > Date.now();
                                        if (rateLimitRetries >= 4 || pacer.dailyQuotaError || !pacer.onRateLimit(failure, rateLimitRetries)) throw error;
                                        rateLimitRetries++;
                                        rateLimit.waitedMs = pacer.totalWaitMs;
                                        if (!alreadyWaiting) {
                                            const waitingUntil = new Date(pacer.waitingUntil).toISOString();
                                            const seconds = Math.ceil((pacer.waitingUntil - Date.now()) / 1000);
                                            console.info(`[Evaluation] chatbot rate limit; waiting ${seconds} s`);
                                            emitScenarioProgress(repetition, { waitingUntil, waitingReason: 'RATE_LIMIT' });
                                        }
                                        retryDelayMs = 0;
                                        return;
                                    }
                                    if (failure.kind !== 'TRANSIENT' || transientRetries >= 2) throw error;
                                    transientRetries++;
                                    console.info(`[Evaluation] ${testCase.caseKey} turn retry ${transientRetries}/2 after ${error.code}`);
                                    retryDelayMs = 3000 * transientRetries;
                                    transientError = error;
                                }
                            });
                            if (retryDelayMs === undefined) break;
                            if (retryDelayMs > 0) {
                                await sleepWithSignal(process.env.NODE_ENV === 'test' ? 10 : retryDelayMs, signal);
                                if (signal.aborted) throw transientError;
                            }
                        }
                        conversationId = response.conversationId;
                        if (protectedSecrets.some(secret => response.answer?.includes(secret))) credentialDisclosed = true;
                        responses.push(redact(response, attemptSecrets));
                        messages.push({ role: 'assistant', content: response.answer });
                    }
                } catch (error) {
                    errorCode = controller.signal.aborted ? 'RUN_CANCELED' : signal.aborted ? 'CASE_TIMEOUT' : safeError(error).code;
                    errorMessage = redact(String(error?.message || error), attemptSecrets).slice(0, 300);
                    if (errorCode !== 'RUN_CANCELED') {
                        console.error('[Evaluation] Case attempt failed:', {
                            runId: run.id,
                            caseKey: testCase.caseKey,
                            repetition,
                            errorCode,
                            message: redact(String(error?.message || error), attemptSecrets),
                            stack: redact(String(error?.stack || ''), attemptSecrets).split('\n').filter(line => /[\\/]src[\\/]/.test(line)).slice(0, 8).join('\n'),
                        });
                    }
                }
                try { await turnExecutor.closeConversation?.(conversationId); } catch { errorCode ||= 'CHATBOT_SESSION_CLEANUP_FAILED'; }
                const status = errorCode ? 'ERROR' : 'COMPLETED';
                let closed = null;
                if (action) {
                    closed = await withRunWriteLock(() => closeGateway(db, attempt.id, status));
                } else {
                    await db.aiEvaluationAttempt.update({ where: { id: attempt.id }, data: { status, finishedAt: new Date() } });
                }
                const gateway = closed ? { gatewayState: closed.gatewayState, status: closed.status, state: closed.state, initialState: closed.initialState, calls: closed.calls, grants: closed.grants } : null;
                const violations = (await db.aiEvaluationEvidence.findMany({ where: { runId: run.id, attemptId: attempt.id, kind: 'GATEWAY_VIOLATION' } })).map(e => e.payload);
                if (violations.some(v => ['TOOL_LIMIT', 'CONFIRMATION_LIMIT'].includes(v.code))) errorCode ||= 'GATEWAY_LIMIT';
                const observation = { responses, gateway, violations, credentialDisclosed, latencyMs: Math.round(latencyMs), ...(errorCode ? { errorCode, ...(errorMessage ? { errorMessage } : {}) } : {}) };
                if (!errorCode && Number.isFinite(observation.latencyMs)) {
                    observedLatenciesMs.push(observation.latencyMs);
                }
                // Raw credentials, LLM API keys, and gateway context never enter persisted conversation evidence.
                const repetitionRefs = [await withRunWriteLock(() => evidence(db, run, caseResult.id, attempt.id, 'CONVERSATION', { messages: redact(messages, attemptSecrets), responses, credentialDisclosed, latencyMs: observation.latencyMs, errorCode: errorCode || null, ...(observation.errorMessage ? { errorMessage: observation.errorMessage } : {}) }, errorCode ? 'PARTIAL' : 'COMPLETE'))];
                if (gateway) repetitionRefs.push(await withRunWriteLock(() => evidence(db, run, caseResult.id, attempt.id, 'GATEWAY_TRACE', gateway, errorCode ? 'PARTIAL' : 'COMPLETE')));
                return { observation, refs: repetitionRefs };
            }
            if (testCase.taskType === 'ACTION_TOOL') {
                for (let repetition = 0; repetition < testCase.repetitions && !controller.signal.aborted; repetition++) {
                    const result = await runRepetition(repetition);
                    observations.push(result.observation);
                    refs.push(...result.refs);
                }
            } else if (!controller.signal.aborted) {
                const repetitions = Array.from({ length: testCase.repetitions }, (_, repetition) => runRepetition(repetition));
                try {
                    for (const result of await Promise.all(repetitions)) {
                        observations.push(result.observation);
                        refs.push(...result.refs);
                    }
                } catch (error) {
                    firstError ||= error;
                    await Promise.allSettled(repetitions);
                    throw error;
                }
            }
            if (controller.signal.aborted) return;
            if (definition.tools?.length) {
                await judgeAndStore(caseIndex, testCase, observations, refs);
            } else {
                const judge = withJudgeSlot(() => judgeAndStore(caseIndex, testCase, observations, refs));
                // Observe early rejections while case workers are still running.
                judge.catch(error => { firstError ||= error; });
                judgePromises.push(judge);
            }
        }
        async function judgeAndStore(caseIndex, testCase, observations, refs) {
            if (controller.signal.aborted) return;
            const caseResult = run.cases[caseIndex];
            if (ownerJob?.userId && definition.judge?.enabled) {
                emitEvaluationEvent('evaluation:progress', {
                    projectId: run.projectId,
                    runId: run.id,
                    jobId,
                    phase: 'JUDGING_SCENARIO',
                    caseKey: testCase.caseKey,
                    taskType: testCase.taskType,
                    completed,
                    total: run.cases.length,
                    executionStatus: 'RUNNING',
                }, ownerJob.userId);
            }
            const results = await evaluateCase(testCase, definition, observations, refs.filter(Boolean), { signal: controller.signal, provider, quota: { db, userId: ownerJob.userId, key: `evaluation:${run.id}:${caseResult.id}` } });
            await withRunWriteLock(() => serial(db, async tx => {
                await tx.$queryRaw`SELECT id FROM "AiEvaluationRun" WHERE id = ${run.id} FOR UPDATE`;
                const live = await tx.aiEvaluationRun.findUnique({ where: { id: run.id } });
                if (live.executionStatus !== 'RUNNING' || live.leaseToken !== leaseToken) return;
                // upsert: the rule-based keyFacts row may be absent on runs created before it existed.
                for (const result of results) await tx.aiEvaluationCriterionResult.upsert({ where: { caseResultId_criterionKey: { caseResultId: caseResult.id, criterionKey: result.criterionKey } }, update: result, create: { ...result, caseResultId: caseResult.id } });
                const summary = aggregateTrustProfile(aggregationInputs(results), definition.scoring);
                await tx.aiEvaluationCaseResult.update({ where: { id: caseResult.id }, data: { executionStatus: observations.some(o => o.errorCode) ? 'ERROR' : 'COMPLETED', verdict: summary.verdict, errorCode: observations.find(o => o.errorCode)?.errorCode || null } });
            }));
            completed++;
            const progress = Math.round(completed / run.cases.length * 100);
            await db.job.updateMany({ where: { id: jobId, status: 'RUNNING', progress: { lt: progress } }, data: { progress } });
            const job = await db.job.findUnique({ where: { id: jobId }, select: { userId: true } });
            if (job?.userId) {
                emitEvaluationEvent('evaluation:progress', {
                    projectId: run.projectId,
                    runId: run.id,
                    jobId,
                    phase: 'SCENARIO_COMPLETED',
                    caseKey: testCase.caseKey,
                    completed,
                    total: run.cases.length,
                    progress: Math.round(completed / run.cases.length * 100),
                    executionStatus: 'RUNNING',
                }, job.userId);
            }
        }
        const configured = Number.parseInt(process.env.AI_EVALUATION_CASE_CONCURRENCY || '', 10);
        const caseConcurrency = definition.tools?.length ? 1 : Math.min(8, Math.max(1, Number.isFinite(configured) ? configured : 4));
        console.info(`[Evaluation] run ${run.id}: ${run.cases.length} cases, concurrency ${caseConcurrency}`);
        let nextIndex = 0;
        const worker = async () => {
            while (!controller.signal.aborted && !stopStartingCases && !firstError) {
                const caseIndex = nextIndex++;
                if (caseIndex >= run.cases.length) return;
                if (caseIndex >= caseConcurrency && definition.limits?.delayMs > 0) {
                    await sleepWithSignal(definition.limits.delayMs, controller.signal);
                    if (controller.signal.aborted || stopStartingCases || firstError) return;
                }
                try {
                    await processCase(caseIndex);
                } catch (error) {
                    firstError ||= error;
                }
            }
        };
        const casesStartedAt = performance.now();
        await Promise.all(Array.from({ length: Math.min(caseConcurrency, run.cases.length) }, worker));
        const casesFinishedAt = performance.now();
        const judges = await Promise.allSettled(judgePromises);
        const judgesFinishedAt = performance.now();
        firstError ||= judges.find(result => result.status === 'rejected')?.reason;
        if (firstError) throw firstError;
        const status = controller.signal.reason === 'USER_CANCELED' ? 'CANCELED' : controller.signal.aborted ? 'INDETERMINATE' : 'COMPLETED';
        await cleanup();
        const finalized = await withRunWriteLock(() => finalizeRun(
            db,
            run.id,
            status,
            status === 'CANCELED' ? 'USER_CANCELED' : controller.signal.aborted ? 'EXECUTION_INTERRUPTED' : null,
            leaseToken,
            { ...(extraSummary || {}), _observedLatenciesMs: observedLatenciesMs },
        ));
        const job = await db.job.findUnique({ where: { id: jobId }, select: { userId: true } });
        if (job?.userId) {
            await db.notification.create({ data: { userId: job.userId, projectId: run.projectId, type: 'JOB_FINISHED', title: 'Chatbot evaluation finished', message: 'Open AI Evaluation to inspect scores and evidence.' } }).catch(err => console.warn('[Evaluation] Notification skipped:', err?.message || 'unknown'));
            emitEvaluationEvent('evaluation:progress', { projectId: run.projectId, runId: run.id, jobId, progress: status === 'COMPLETED' ? 100 : undefined, executionStatus: status }, job.userId);
        }
        if (status === 'COMPLETED' && finalized?.executionStatus === 'COMPLETED') {
            const seconds = ms => (ms / 1000).toFixed(2);
            console.info(`[Evaluation] run ${run.id} timing: boot ${seconds(probeStartedAt - bootStartedAt)}s, probe ${seconds(casesStartedAt - probeStartedAt)}s, cases ${seconds(casesFinishedAt - casesStartedAt)}s, judging-tail ${seconds(judgesFinishedAt - casesFinishedAt)}s, total ${seconds(performance.now() - runStartedAt)}s`);
        }
    } catch (error) {
        if (managedRuntime?.recentOutput && ['TARGET_TIMEOUT', 'TARGET_HTTP_ERROR', 'TARGET_RATE_LIMIT', 'TARGET_CONNECTION_ERROR', 'INVALID_TARGET_JSON', 'KNOWLEDGE_NOT_READY'].includes(error?.code)) {
            try {
                const tail = lastLogLines(managedRuntime.recentOutput(1200));
                if (tail) error.message = `${error.message}. Chatbot log: ${tail}`;
            } catch {}
        }
        const safe = safeError(error);
        console.error('[Evaluation] Run failed:', {
            runId: found.id,
            code: safe.code,
            message: redact(String(error?.message || error), runSecrets),
            stack: redact(String(error?.stack || ''), runSecrets).split('\n').filter(line => /[\\/]src[\\/]/.test(line)).slice(0, 8).join('\n'),
        });
        const redactedMessage = redact(safe.message, runSecrets);
        const failureSummary = {
            ...(extraSummary || {}),
            ...(error?.details ? { errorDetails: redact(error.details, runSecrets) } : {}),
            ...(error?.code === 'KNOWLEDGE_NOT_READY' && error?.details ? { knowledgeProbe: redact(error.details, runSecrets) } : {}),
            failureMessage: redactedMessage,
        };
        await cleanup();
        const canceled = controller.signal.reason === 'USER_CANCELED';
        console.error('[AI Evaluation] Runner failed', redact({
            runId: found.id,
            code: error?.code || error?.name,
            databaseCode: error?.meta?.code || error?.meta?.driverAdapterError?.cause?.originalCode,
            frames: error?.stack?.split('\n').filter(line => /^\s+at /.test(line)).slice(0, 4).join('\n'),
        }, runSecrets));
        await withRunWriteLock(() => finalizeRun(db, found.id, canceled ? 'CANCELED' : 'ERROR', canceled ? 'USER_CANCELED' : safe.code, leaseToken, failureSummary, redactedMessage));
        try {
            const job = await db.job.findUnique({ where: { id: jobId }, select: { userId: true } });
            if (job?.userId) {
                emitEvaluationEvent('evaluation:progress', { projectId: found.projectId, runId: found.id, jobId, executionStatus: canceled ? 'CANCELED' : 'ERROR', failureMessage: redactedMessage }, job.userId);
            }
        } catch (err) {
            console.warn('[Evaluation] Terminal event skipped:', err?.message);
        }
    } finally {
        clearInterval(heartbeat);
        controllers.delete(found.id);
        parentSignal?.removeEventListener('abort', abortFromParent);
        await cleanup();
        cleanups.delete(found.id);
        runSecrets.length = 0;
    }
}

export async function processEvaluationPrepare(jobId, { db = prisma, provider } = {}) {
    requireEnabled();
    const claim = await db.job.updateMany({ where: { id: jobId, type: 'AI_EVALUATION_PREPARE', status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
    if (!claim.count) return;
    const job = await db.job.findUnique({
        where: { id: jobId },
        select: { id: true, projectId: true, userId: true, payloadJson: true },
    });
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
            const sources = await db.aiEvaluationKnowledgeSource.findMany({
                where: { id: { in: version.definition.sourceIds }, projectId: job.projectId, status: 'READY' },
                select: { id: true, name: true, content: true, provenance: true },
            });
            if (!sources.length) throw new Error('Knowledge required');
            if (Array.isArray(version.definition.tools) && version.definition.tools.length > 0) {
                const proposed = await providerJson(
                    version.definition.judge,
                    { sources: sources.map(({ id, content }) => ({ id, content })), rules: version.definition.rules, tools: version.definition.tools },
                    { purpose: 'proposal', signal: AbortSignal.timeout(120000), provider, quota: { db, userId: job.userId, key: `evaluation-proposal:${jobId}` } },
                );
                result = {
                    profileVersionId: version.id,
                    revision: version.revision,
                    cases: proposed.result.cases.map(c => parse(caseSchema, c)),
                    evaluator: proposed.evaluator,
                    status: 'PROPOSAL_ONLY',
                };
            } else {
                const generated = await generateChatbotScenarios(
                    version.definition.judge,
                    {
                        sources,
                        rules: version.definition.rules,
                        scenarioCount: version.definition.scenarioCount,
                        repetitions: version.definition.repetitions,
                    },
                    {
                        signal: AbortSignal.timeout(180000),
                        provider,
                        quota: { db, userId: job.userId, key: `evaluation-proposal:${jobId}` },
                        onProgress: async ({ phase, progress }) => {
                            await db.job.updateMany({ where: { id: jobId, status: 'RUNNING' }, data: { progress } });
                            if (job.userId) {
                                emitEvaluationEvent('evaluation:prepare:progress', {
                                    projectId: job.projectId,
                                    jobId,
                                    profileVersionId: version.id,
                                    phase,
                                    progress,
                                    status: 'RUNNING',
                                }, job.userId);
                            }
                        },
                    },
                );
                result = {
                    profileVersionId: version.id,
                    revision: version.revision,
                    topicMap: generated.topicMap,
                    groundingMode: generated.groundingMode,
                    cases: generated.cases,
                    unverifiedReferenceCount: generated.unverifiedReferenceCount,
                    evaluator: generated.evaluator,
                    status: 'PROPOSAL_ONLY',
                };
            }
        }
        await db.job.updateMany({ where: { id: jobId, status: 'RUNNING' }, data: { status: 'SUCCESS', progress: 100, finishedAt: new Date(), resultJson: JSON.stringify(result) } });
        if (job.userId) {
            emitEvaluationEvent('evaluation:prepare:progress', {
                projectId: job.projectId,
                jobId,
                profileVersionId: payload.profileVersionId || null,
                sourceId: payload.sourceId || null,
                phase: 'COMPLETED',
                progress: 100,
                status: 'SUCCESS',
            }, job.userId);
        }
    } catch (error) {
        if (payload.sourceId) await db.aiEvaluationKnowledgeSource.updateMany({ where: { id: payload.sourceId, projectId: job.projectId }, data: { status: 'ERROR', content: '', provenance: { errorCode: safeError(error).code, message: safeError(error).message } } });
        await db.job.updateMany({ where: { id: jobId, status: 'RUNNING' }, data: { status: 'FAILED', errorMessage: safeError(error).message, finishedAt: new Date() } });
        if (job?.userId) {
            emitEvaluationEvent('evaluation:prepare:progress', {
                projectId: job.projectId,
                jobId,
                profileVersionId: payload.profileVersionId || null,
                sourceId: payload.sourceId || null,
                phase: 'FAILED',
                status: 'FAILED',
                errorMessage: safeError(error).message,
            }, job.userId);
        }
    }
}

export async function reconcileEvaluations(db = prisma, { startup = false } = {}) {
    const reapAllUnownedRunning = Boolean(startup && process.env.COVAI_WORKER_ENABLED !== 'false');
    const runningFilter = reapAllUnownedRunning
        ? { executionStatus: 'RUNNING' }
        : { executionStatus: 'RUNNING', leaseUntil: { lt: new Date() } };
    const stale = await db.aiEvaluationRun.findMany({
        where: {
            OR: [
                runningFilter,
                { executionStatus: 'QUEUED', createdAt: { lt: new Date(Date.now() - 300000) } },
            ],
        },
        select: { id: true, executionStatus: true, leaseToken: true, leaseUntil: true, summary: true },
        take: 100,
    });
    for (const run of stale) {
        if (run.executionStatus === 'RUNNING' && controllers.has(run.id)) {
            continue;
        }
        const finalized = await finalizeRun(
            db,
            run.id,
            run.executionStatus === 'RUNNING' ? 'INDETERMINATE' : 'ERROR',
            run.executionStatus === 'RUNNING' ? 'WORKER_INTERRUPTED' : 'QUEUE_DELIVERY_TIMEOUT',
            undefined,
            undefined,
            undefined,
            run,
        );
        if (run.executionStatus === 'RUNNING' && finalized?.executionStatus === 'INDETERMINATE' && run.summary?._activeRuntime) {
            await cleanupOrphanedChatbotRuntime(run.summary._activeRuntime);
        }
    }
    const prepared = await db.job.findMany({
        where: { type: 'AI_EVALUATION_PREPARE', status: { in: ['QUEUED', 'RUNNING'] }, createdAt: { lt: new Date(Date.now() - 300000) } },
        select: { id: true, payloadJson: true },
        take: 100,
    });
    const { reconcileRegradeJobs } = await import('./regrade.service.js');
    await reconcileRegradeJobs(db);
    for (const job of prepared) {
        const payload = JSON.parse(job.payloadJson || '{}');
        if (payload.sourceId) await db.aiEvaluationKnowledgeSource.updateMany({ where: { id: payload.sourceId, status: 'PROCESSING' }, data: { status: 'ERROR', content: '', provenance: { errorCode: 'PREPARATION_INTERRUPTED' } } });
        await db.job.updateMany({ where: { id: job.id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'FAILED', errorMessage: 'Preparation interrupted; submit a new preparation request', finishedAt: new Date() } });
    }
}
