/**
 * "Grade again": re-runs the AI judge only for criteria that ended as ERROR
 * (for example because the judge model was overloaded), using the chatbot
 * answers already stored as CONVERSATION evidence. The chatbot is not called
 * again and PASSED / FAILED / NOT_APPLICABLE / INSUFFICIENT_EVIDENCE results
 * are left untouched.
 *
 * The JobType enum lives in a shared database, so regrade jobs reuse the
 * AI_EVALUATION job type and are recognised by their payload
 * ({ mode: 'REGRADE', regradeRunId }). processEvaluation() hands them here.
 */
import prisma from '../../config/prisma.js';
import { ServiceError } from '../../utils/serviceError.js';
import { fail, requireEnabled, serial, redact } from './common.js';
import { evaluateCase, aggregationInputs } from './evaluator.service.js';
import { readEvaluatorFallbackConfig } from './judge.service.js';
import { aggregateTrustProfile } from './scoring.service.js';
import { readEvidencePayload } from './artifactStore.service.js';

export const REGRADE_MODE = 'REGRADE';
const STALE_REGRADE_MS = 15 * 60 * 1000;

export function parseRegradePayload(payloadJson) {
    if (!payloadJson || typeof payloadJson !== 'string') return null;
    try {
        const parsed = JSON.parse(payloadJson);
        return parsed?.mode === REGRADE_MODE && typeof parsed.regradeRunId === 'string' ? parsed : null;
    } catch (error) {
        console.error('[Evaluation] Unreadable job payload while checking for regrade:', String(error?.message || error).slice(0, 200));
        return null;
    }
}

const RUN_INCLUDE = {
    profileVersion: true,
    cases: {
        orderBy: { id: 'asc' },
        include: {
            testCase: { select: { id: true, caseKey: true, taskType: true, definition: true } },
            criteria: true,
        },
    },
    evidence: {
        where: { kind: { in: ['CONVERSATION', 'GATEWAY_TRACE', 'GATEWAY_VIOLATION'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, caseResultId: true, attemptId: true, kind: true, payload: true, createdAt: true },
    },
};

async function loadRun(db, runId) {
    const run = await db.aiEvaluationRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE });
    if (!run) return null;
    run.evidence = await Promise.all(
        run.evidence.map(async e => ({ ...e, payload: await readEvidencePayload(run.projectId, run.id, e.payload) })),
    );
    return run;
}

/**
 * A case can be graded again when it has at least one ERROR semantic criterion
 * and every repetition's answer was stored without a chatbot error.
 */
export function regradeCandidates(run) {
    const candidates = [];
    for (const caseResult of run.cases) {
        const errored = caseResult.criteria.filter(r => r.status === 'ERROR' && r.method === 'semantic');
        if (!errored.length) continue;
        const conversations = run.evidence.filter(e => e.caseResultId === caseResult.id && e.kind === 'CONVERSATION');
        const expected = Number(caseResult.testCase?.definition?.repetitions) || conversations.length;
        const complete = conversations.length > 0
            && conversations.length === expected
            && conversations.every(e => !e.payload?.errorCode && Array.isArray(e.payload?.responses) && e.payload.responses.length > 0);
        if (complete) candidates.push({ caseResult, conversations, erroredKeys: errored.map(r => r.criterionKey) });
    }
    return candidates;
}

async function activeRegradeJob(db, projectId, runId) {
    return db.job.findFirst({
        where: {
            projectId,
            type: 'AI_EVALUATION',
            status: { in: ['QUEUED', 'RUNNING'] },
            payloadJson: { contains: `"regradeRunId":"${runId}"` },
        },
        select: { id: true },
    });
}

export async function requestRegrade(db, projectId, userId, runId, { enqueue } = {}) {
    requireEnabled();
    const { runFor, getRemainingAiQuota, enqueueStrict } = await import('./management.service.js');
    const summary = await runFor(db, projectId, runId);
    if (summary.executionStatus !== 'COMPLETED') fail('RUN_NOT_COMPLETED', 'Only finished evaluations can be graded again', 409);
    const run = await loadRun(db, runId);
    const candidates = regradeCandidates(run);
    if (!candidates.length) fail('NOTHING_TO_REGRADE', 'There are no ungraded checks with complete chatbot answers in this run', 409);
    if (await activeRegradeJob(db, projectId, runId)) fail('REGRADE_ACTIVE', 'This run is already being graded again', 409);
    if (userId && !readEvaluatorFallbackConfig()) {
        const quota = await getRemainingAiQuota(db, userId);
        if (quota.remaining < candidates.length) {
            throw new ServiceError(
                `Not enough AI quota left today to grade ${candidates.length} questions again (${quota.remaining} of ${quota.limit} left).`,
                429,
                'AI_QUOTA_INSUFFICIENT',
                { required: candidates.length, remaining: quota.remaining, limit: quota.limit, resetAt: quota.resetAt },
            );
        }
    }
    const job = await db.job.create({
        data: {
            projectId,
            userId,
            type: 'AI_EVALUATION',
            payloadJson: JSON.stringify({ mode: REGRADE_MODE, regradeRunId: runId }),
        },
        select: { id: true },
    });
    try {
        await (enqueue || enqueueStrict)('AI_EVALUATION', job.id);
    } catch (error) {
        await db.job.updateMany({
            where: { id: job.id },
            data: { status: 'FAILED', errorMessage: 'ENQUEUE_FAILED', finishedAt: new Date() },
        });
        throw error;
    }
    return { jobId: job.id, runId, cases: candidates.length };
}

function observationsFor(run, conversations) {
    return conversations.map(conversation => {
        const trace = run.evidence.find(e => e.kind === 'GATEWAY_TRACE' && e.attemptId === conversation.attemptId);
        const violations = run.evidence
            .filter(e => e.kind === 'GATEWAY_VIOLATION' && e.attemptId === conversation.attemptId)
            .map(e => e.payload);
        return {
            responses: conversation.payload.responses,
            gateway: trace?.payload || null,
            violations,
            latencyMs: conversation.payload.latencyMs,
        };
    });
}

export async function processRegrade(jobId, { db = prisma, provider } = {}) {
    const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true, userId: true, status: true, payloadJson: true } });
    const payload = parseRegradePayload(job?.payloadJson);
    if (!job || !payload || job.status !== 'QUEUED') return;
    const claimed = await db.job.updateMany({ where: { id: jobId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
    if (!claimed.count) return;

    const controller = new AbortController();
    let run = null;
    try {
        run = await loadRun(db, payload.regradeRunId);
        if (!run || run.executionStatus !== 'COMPLETED') fail('RUN_NOT_COMPLETED', 'Only finished evaluations can be graded again', 409);
        const candidates = regradeCandidates(run);
        const definition = { ...run.profileVersion.definition, sources: run.profileVersion.sourceManifest };
        const regradeCount = Number(run.summary?.regradeCount || 0) + 1;
        let completed = 0;
        let regraded = 0;

        for (const { caseResult, conversations, erroredKeys } of candidates) {
            const live = await db.job.findUnique({ where: { id: jobId }, select: { status: true } });
            if (live?.status === 'CANCELED') {
                controller.abort('USER_CANCELED');
                break;
            }
            const refs = run.evidence.filter(e => e.caseResultId === caseResult.id && ['CONVERSATION', 'GATEWAY_TRACE'].includes(e.kind));
            const results = await evaluateCase(
                caseResult.testCase.definition,
                definition,
                observationsFor(run, conversations),
                refs,
                {
                    signal: controller.signal,
                    provider,
                    quota: { db, userId: job.userId, key: `regrade:${run.id}:${caseResult.id}:${regradeCount}` },
                },
            );
            const replacements = results.filter(r => erroredKeys.includes(r.criterionKey));
            const merged = caseResult.criteria.map(row => replacements.find(r => r.criterionKey === row.criterionKey) || row);
            const caseSummary = aggregateTrustProfile(aggregationInputs(merged), definition.scoring);
            await serial(db, async tx => {
                for (const result of replacements) {
                    await tx.aiEvaluationCriterionResult.update({
                        where: { caseResultId_criterionKey: { caseResultId: caseResult.id, criterionKey: result.criterionKey } },
                        data: result,
                    });
                }
                await tx.aiEvaluationCaseResult.update({ where: { id: caseResult.id }, data: { verdict: caseSummary.verdict } });
            });
            regraded += replacements.filter(r => r.status !== 'ERROR').length;
            completed++;
            if (job.userId) {
                const { emitEvaluationEvent } = await import('./runner.service.js');
                emitEvaluationEvent('evaluation:progress', {
                    projectId: run.projectId,
                    runId: run.id,
                    jobId,
                    phase: 'REGRADING',
                    caseKey: caseResult.testCase.caseKey,
                    completed,
                    total: candidates.length,
                    executionStatus: 'COMPLETED',
                }, job.userId);
            }
        }

        const { buildRunSummary, emitEvaluationEvent } = await import('./runner.service.js');
        await serial(db, async tx => {
            await tx.$queryRaw`SELECT id FROM "AiEvaluationRun" WHERE id = ${run.id} FOR UPDATE`;
            const fresh = await tx.aiEvaluationRun.findUnique({
                where: { id: run.id },
                include: {
                    cases: {
                        orderBy: { id: 'asc' },
                        include: {
                            testCase: { select: { id: true, caseKey: true, taskType: true, definition: true } },
                            criteria: true,
                        },
                    },
                },
            });
            const latencies = run.evidence
                .filter(e => e.kind === 'CONVERSATION' && !e.payload?.errorCode && Number.isFinite(e.payload?.latencyMs))
                .map(e => e.payload.latencyMs);
            const summary = buildRunSummary(
                { ...fresh, evidence: [] },
                'COMPLETED',
                {
                    _observedLatenciesMs: latencies,
                    regradedAt: new Date().toISOString(),
                    regradeCount,
                },
            );
            await tx.aiEvaluationRun.update({ where: { id: run.id }, data: { verdict: summary.verdict, summary } });
        });
        await db.job.updateMany({
            where: { id: jobId },
            data: {
                status: controller.signal.aborted ? 'CANCELED' : 'SUCCESS',
                progress: 100,
                resultJson: JSON.stringify({ runId: run.id, cases: completed, regradedChecks: regraded }),
                finishedAt: new Date(),
            },
        });
        if (job.userId) {
            emitEvaluationEvent('evaluation:progress', {
                projectId: run.projectId,
                runId: run.id,
                jobId,
                phase: 'REGRADE_DONE',
                completed,
                total: candidates.length,
                progress: 100,
                executionStatus: 'COMPLETED',
            }, job.userId);
        }
    } catch (error) {
        const message = redact(String(error?.message || error)).slice(0, 300);
        console.error('[Evaluation] Regrade failed:', { jobId, runId: payload.regradeRunId, code: error?.code, message });
        await db.job.updateMany({
            where: { id: jobId },
            data: { status: 'FAILED', errorMessage: error?.code || 'REGRADE_FAILED', finishedAt: new Date() },
        });
        if (job.userId && run) {
            const { emitEvaluationEvent } = await import('./runner.service.js');
            emitEvaluationEvent('evaluation:progress', {
                projectId: run.projectId, runId: run.id, jobId, phase: 'REGRADE_FAILED', executionStatus: 'COMPLETED',
            }, job.userId);
        }
    }
}

/** Marks regrade jobs abandoned by a crashed worker as failed so the run can be graded again. */
export async function reconcileRegradeJobs(db = prisma) {
    const stale = await db.job.findMany({
        where: {
            type: 'AI_EVALUATION',
            status: { in: ['QUEUED', 'RUNNING'] },
            createdAt: { lt: new Date(Date.now() - STALE_REGRADE_MS) },
            payloadJson: { contains: `"mode":"${REGRADE_MODE}"` },
        },
        select: { id: true },
        take: 100,
    });
    for (const job of stale) {
        await db.job.updateMany({
            where: { id: job.id, status: { in: ['QUEUED', 'RUNNING'] } },
            data: { status: 'FAILED', errorMessage: 'REGRADE_INTERRUPTED', finishedAt: new Date() },
        });
    }
}
