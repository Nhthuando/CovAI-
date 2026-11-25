import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { evaluationDatabase } from './helpers/aiEvaluationDatabase.js';

process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.AI_EVALUATION_ENABLED = 'true';
process.env.ENCRYPTION_KEY = '55'.repeat(32);

const runtime = await import('../services/aiEvaluation/chatbotRuntime.service.js');
let runtimeStop = async () => {};
jest.unstable_mockModule('../services/aiEvaluation/chatbotRuntime.service.js', () => ({
    ...runtime,
    startManagedChatbotRuntime: async () => ({
        pid: 1234, port: 4567, workspaceDirName: 'mvp4-test-runtime',
        stop: () => runtimeStop(),
    }),
}));

const evaluator = await import('../services/aiEvaluation/evaluator.service.js');
const evaluateCase = jest.fn(evaluator.evaluateCase);
jest.unstable_mockModule('../services/aiEvaluation/evaluator.service.js', () => ({
    ...evaluator,
    evaluateCase,
}));

const management = await import('../services/aiEvaluation/management.service.js');
const { processEvaluation, emitEvaluationEvent, LEASE_RENEW_MS, LEASE_TTL_MS } = await import('../services/aiEvaluation/runner.service.js');
const { getBlindReviewQueue, EVALUATION_DISCLAIMER } = await import('../services/aiEvaluation/report.service.js');
const { exportDesignAuditReport } = await import('../services/aiEvaluation/designAuditReport.service.js');
const { runChatbotDesignAudit } = await import('../services/aiEvaluation/designAudit.service.js');
const { parse, definitionSchema } = await import('../services/aiEvaluation/contracts.js');
const { createEvaluationRouter } = await import('../routes/aiEvaluation.route.js');
const { isSerializationConflict, safeError, serial } = await import('../services/aiEvaluation/common.js');
const { publicJudgeErrorReason } = await import('../services/aiEvaluation/evaluator.service.js');

describe('Evaluation public errors, quota, and progress', () => {
    test.each([
        [{ status: 503 }, 'Judge model unavailable (HTTP 503)'],
        [{ status: 429 }, 'Judge model rate-limited (HTTP 429)'],
        [{ status: 500 }, 'Judge model unavailable (HTTP 500)'],
        [{ code: 'AI_REQUEST_TIMEOUT' }, 'Judge model timed out'],
        [new Error('Gemini request deadline exceeded. Retry this job later.'), 'Judge model timed out'],
        [{ code: 'JUDGE_INVALID_JSON' }, 'Judge returned invalid output after retries'],
        [{ code: 'AI_APP_QUOTA_EXCEEDED', status: 429 }, 'Daily AI quota exhausted'],
        [new Error('https://generativelanguage.googleapis.com/... secret'), 'Judge failed (UNKNOWN)'],
        [{ code: 'SAFE_CODE' }, 'Judge failed (SAFE_CODE)'],
        [{ code: 'https://googleapis.com/secret' }, 'Judge failed (UNKNOWN)'],
        [{ code: 'A'.repeat(41) }, 'Judge failed (UNKNOWN)'],
    ])('publicJudgeErrorReason sanitizes %p', (error, expected) => {
        const reason = publicJudgeErrorReason(error);
        expect(reason).toBe(expected);
        expect(reason).not.toContain('http');
        expect(reason).not.toContain('googleapis');
    });

    test('quota estimate accounts for format and transport retries', () => {
        const estimate = management.buildRunQuotaEstimate();
        expect(estimate).toMatchObject({ min: 18, max: 20 });
        expect(estimate.worstCase).toBe(estimate.max * 4);
        expect(estimate.worstCase).toBeGreaterThan(estimate.max);
    });

    test('emitEvaluationEvent targets project and user rooms once', () => {
        const previousIo = global.io;
        const emit = jest.fn();
        global.io = { to: jest.fn(() => ({ emit })) };
        try {
            const payload = { projectId: 'p1' };
            emitEvaluationEvent('evaluation:progress', payload, 'u1');
            expect(global.io.to).toHaveBeenCalledWith(['project:p1', 'user:u1']);
            expect(emit).toHaveBeenCalledTimes(1);
            expect(emit).toHaveBeenCalledWith('evaluation:progress', payload);
        } finally {
            global.io = previousIo;
        }
    });
});

describe('Evaluation serialization conflicts', () => {
    test('exported lease constants allow at least three renewal intervals', () => {
        expect(LEASE_RENEW_MS).toBe(10_000);
        expect(LEASE_TTL_MS).toBe(60_000);
        expect(LEASE_TTL_MS).toBeGreaterThanOrEqual(3 * LEASE_RENEW_MS);
    });

    test('isSerializationConflict recognizes conflict shapes and rejects unrelated errors', () => {
        const conflicts = [
            { code: 'P2034' },
            { code: 'P2010', meta: { code: '40001' } },
            { code: 'P2010', message: 'Raw query failed. Code: 40001' },
            { meta: { driverAdapterError: { name: 'TransactionWriteConflict' } } },
            { meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } } },
            { cause: { kind: 'TransactionWriteConflict' } },
            new Error('could not serialize access due to concurrent update'),
            { code: '40001' },
        ];
        for (const error of conflicts) expect(isSerializationConflict(error)).toBe(true);
        expect(isSerializationConflict({ code: 'P2002' })).toBe(false);
        expect(isSerializationConflict(new Error('unrelated failure'))).toBe(false);
    });

    test.each([
        'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
        'deadlock detected',
    ])('reports a database conflict as busy: %s', message => {
        const error = new Error(message);
        expect(isSerializationConflict(error)).toBe(true);
        expect(safeError(error)).toEqual({
            code: 'DATABASE_BUSY',
            message: 'The database was busy saving results. Run the evaluation again.',
        });
    });

    test('serial retries twice and returns the transaction callback result', async () => {
        const conflict = { code: 'P2034' };
        const db = { $transaction: jest.fn(async (cb, opts) => {
            expect(opts).toEqual({ isolationLevel: 'Serializable', maxWait: 10000, timeout: 20000 });
            if (db.$transaction.mock.calls.length <= 2) throw conflict;
            return cb(db);
        }) };
        const operation = jest.fn(async tx => {
            expect(tx).toBe(db);
            return 'completed';
        });
        await expect(serial(db, operation)).resolves.toBe('completed');
        expect(db.$transaction).toHaveBeenCalledTimes(3);
        expect(operation).toHaveBeenCalledTimes(1);
    });

    test('serial rethrows the last conflict after eight transaction attempts', async () => {
        const conflict = { code: 'P2034' };
        const db = { $transaction: jest.fn(async (cb, opts) => {
            expect(typeof cb).toBe('function');
            expect(opts).toEqual({ isolationLevel: 'Serializable', maxWait: 10000, timeout: 20000 });
            throw conflict;
        }) };
        await expect(serial(db, async () => 'unreachable')).rejects.toBe(conflict);
        expect(db.$transaction).toHaveBeenCalledTimes(8);
    }, 15000);
});

describe('Chatbot Evaluation MVP-4 backend', () => {
    let harness, db, owner, project, app;
    const enqueue = async () => {};

    beforeAll(async () => {
        harness = await evaluationDatabase();
        db = harness.db;
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: process.env.AI_QUOTA_TIMEZONE || 'Asia/Ho_Chi_Minh',
            year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());
        owner = await db.user.create({
            data: { email: 'mvp4-owner@evaluation.invalid', aiUsageCount: 0, aiUsageDate: today },
            select: { id: true },
        });
        project = await db.project.create({
            data: { ownerId: owner.id, name: 'MVP-4 Backend' }, select: { id: true },
        });
        app = express();
        app.use(express.json());
        app.use('/api/projects/:projectId/ai-evaluations', createEvaluationRouter({
            db, enqueue,
            auth: (req, _res, next) => { req.user = { id: owner.id }; next(); },
        }));
    }, 120000);

    afterAll(async () => { await harness?.close(); });

    async function createRuleRun(name, count = 1, repetitions = 1, withTools = false, skipKnowledgeProbe = true) {
        const profile = await management.createProfile(db, project.id, name);
        const versionId = profile.versions[0].id;
        const definition = parse(definitionSchema, {
            limits: { requestMs: 5000, caseMs: 10000, delayMs: 0, latencySlaMs: 5000, maxToolCalls: 5 },
            scoring: { confirmed: true, threshold: 70 }, judge: { enabled: false },
        });
        const saved = await management.saveProfile(db, project.id, versionId, {
            revision: 0,
            definition,
            cases: Array.from({ length: count }, (_, index) => ({
                caseKey: `case-${index}`, title: `Case ${index}`, taskType: 'KNOWLEDGE_QA',
                turns: [{ content: 'Question' }], repetitions,
                criteria: [{
                    key: 'answer', method: 'rule', enabled: true, required: true, blocking: false,
                    weight: 1, rule: { type: 'containsAll', expected: ['OK'] }, sourceIds: [],
                }],
            })),
        });
        const approved = await management.approveProfile(db, project.id, versionId, saved.revision, owner.id);
        const target = await management.saveTarget(db, project.id, {
            name,
            config: { executionMode: 'EXTERNAL_URL', endpoint: 'https://mvp4.example.com/chat', auth: { type: 'none', header: 'X-API-Key' } },
        });
        const run = await management.createRun(db, project.id, owner.id, {
            targetVersionId: target.versionId, profileVersionId: approved.id,
            idempotencyKey: name, skipKnowledgeProbe,
        }, { enqueue });
        if (withTools) {
            // These rule cases never invoke tools. The definition flag selects the sequential runner.
            await db.aiEvaluationProfileVersion.update({
                where: { id: approved.id },
                data: { definition: { ...definition, tools: [{}] } },
            });
        }
        return { profile, target, run };
    }

    test.each([3, 1])('writes criteria for every case at concurrency %i', async concurrency => {
        const previous = process.env.AI_EVALUATION_CASE_CONCURRENCY;
        process.env.AI_EVALUATION_CASE_CONCURRENCY = String(concurrency);
        try {
            const { run } = await createRuleRun(`mvp4-concurrency-${concurrency}`, 4);
            let inFlight = 0;
            let maxInFlight = 0;
            await processEvaluation(run.jobId, {
                db,
                transport: async () => {
                    inFlight++;
                    maxInFlight = Math.max(maxInFlight, inFlight);
                    await new Promise(resolve => setTimeout(resolve, 50));
                    inFlight--;
                    return { answer: 'OK' };
                },
            });
            expect(maxInFlight).toBeGreaterThan(concurrency === 1 ? 0 : 1);
            expect(maxInFlight).toBeLessThanOrEqual(concurrency);
            const rows = await db.aiEvaluationCriterionResult.findMany({
                where: { caseResult: { runId: run.id }, criterionKey: 'answer' },
                select: { caseResultId: true, status: true },
            });
            expect(new Set(rows.map(row => row.caseResultId)).size).toBe(4);
            expect(rows.every(row => row.status === 'PASSED')).toBe(true);
        } finally {
            if (previous === undefined) delete process.env.AI_EVALUATION_CASE_CONCURRENCY;
            else process.env.AI_EVALUATION_CASE_CONCURRENCY = previous;
        }
    }, 60000);

    test.each([false, true])('orders chatbot turns and judges with tools=%s', async withTools => {
        const { run } = await createRuleRun(`mvp4-judge-pipeline-${withTools}`, 4, 1, withTools);
        const previousConcurrency = process.env.AI_EVALUATION_CASE_CONCURRENCY;
        const previousIo = global.io;
        const order = [];
        const emit = jest.fn();
        process.env.AI_EVALUATION_CASE_CONCURRENCY = '1';
        global.io = { to: () => ({ emit }) };
        evaluateCase.mockImplementation(async (...args) => {
            order.push('judge-start');
            await new Promise(resolve => setTimeout(resolve, 60));
            order.push('judge-end');
            return evaluator.evaluateCase(...args);
        });
        try {
            await processEvaluation(run.jobId, {
                db,
                transport: async () => {
                    order.push('turn-start');
                    await new Promise(resolve => setTimeout(resolve, 20));
                    return { answer: 'OK' };
                },
            });
            const secondTurn = order.indexOf('turn-start', 1);
            const firstJudgeEnd = order.indexOf('judge-end');
            expect(order.filter(event => event === 'turn-start')).toHaveLength(4);
            expect(order.filter(event => event === 'judge-end')).toHaveLength(4);
            expect(order.indexOf('judge-start')).toBeLessThan(secondTurn);
            if (withTools) expect(secondTurn).toBeGreaterThan(firstJudgeEnd);
            else expect(secondTurn).toBeLessThan(firstJudgeEnd);
            const rows = await db.aiEvaluationCriterionResult.findMany({
                where: { caseResult: { runId: run.id }, criterionKey: 'answer' },
                select: { status: true },
            });
            expect(rows).toEqual(Array.from({ length: 4 }, () => ({ status: 'PASSED' })));
            expect(emit).toHaveBeenCalledWith('evaluation:progress', expect.objectContaining({
                runId: run.id, phase: 'SCENARIO_COMPLETED', completed: 4,
            }));
        } finally {
            evaluateCase.mockReset().mockImplementation(evaluator.evaluateCase);
            global.io = previousIo;
            if (previousConcurrency === undefined) delete process.env.AI_EVALUATION_CASE_CONCURRENCY;
            else process.env.AI_EVALUATION_CASE_CONCURRENCY = previousConcurrency;
        }
    }, 60000);

    test.each(['RUNNING', 'CANCELED'])('handles a zero evidence update for a %s run', async executionStatus => {
        const { run } = await createRuleRun(`mvp4-evidence-${executionStatus}`);
        const executeRaw = jest.fn(async (...args) => {
            await db.aiEvaluationRun.update({
                where: { id: run.id },
                data: executionStatus === 'RUNNING' ? { evidenceBytes: 64 * 1024 * 1024 } : { executionStatus },
            });
            return db.$executeRaw(...args);
        });
        const trackedDb = new Proxy(db, {
            get(target, property) {
                return property === '$executeRaw' ? executeRaw : Reflect.get(target, property);
            },
        });
        evaluateCase.mockClear();

        await processEvaluation(run.jobId, { db: trackedDb, transport: async () => ({ answer: 'OK' }) });

        expect(executeRaw).toHaveBeenCalledTimes(1);
        await expect(executeRaw.mock.results[0].value).resolves.toBe(0);
        expect(await db.aiEvaluationEvidence.count({ where: { runId: run.id } })).toBe(0);
        const saved = await db.aiEvaluationRun.findUnique({ where: { id: run.id } });
        if (executionStatus === 'RUNNING') {
            expect(saved).toMatchObject({ executionStatus: 'ERROR', errorCode: 'EVIDENCE_LIMIT' });
            expect(evaluateCase).not.toHaveBeenCalled();
        } else {
            expect(saved).toMatchObject({ executionStatus: 'CANCELED', errorCode: null });
            expect(evaluateCase).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), [], expect.anything());
        }
        evaluateCase.mockClear();
    }, 60000);

    describe('chatbot turn concurrency and retries', () => {
        let previousCaseConcurrency;
        let previousTargetConcurrency;

        beforeEach(() => {
            previousCaseConcurrency = process.env.AI_EVALUATION_CASE_CONCURRENCY;
            previousTargetConcurrency = process.env.AI_EVALUATION_TARGET_CONCURRENCY;
            process.env.AI_EVALUATION_CASE_CONCURRENCY = '4';
            process.env.AI_EVALUATION_TARGET_CONCURRENCY = '4';
        });

        afterEach(() => {
            if (previousCaseConcurrency === undefined) delete process.env.AI_EVALUATION_CASE_CONCURRENCY;
            else process.env.AI_EVALUATION_CASE_CONCURRENCY = previousCaseConcurrency;
            if (previousTargetConcurrency === undefined) delete process.env.AI_EVALUATION_TARGET_CONCURRENCY;
            else process.env.AI_EVALUATION_TARGET_CONCURRENCY = previousTargetConcurrency;
        });

        test('runs repetitions in parallel and keeps their verdicts and evidence in order', async () => {
            const { run } = await createRuleRun('mvp4-parallel-repetitions', 1, 2);
            let inFlight = 0;
            let maxInFlight = 0;
            await processEvaluation(run.jobId, {
                db,
                transport: async ({ body }) => {
                    inFlight++;
                    maxInFlight = Math.max(maxInFlight, inFlight);
                    const { repetition } = await db.aiEvaluationAttempt.findFirst({
                        where: { requestId: body.requestId.slice(0, -2) }, select: { repetition: true },
                    });
                    await new Promise(resolve => setTimeout(resolve, repetition === 0 ? 150 : 50));
                    inFlight--;
                    return { answer: repetition === 0 ? 'OK' : 'Incorrect' };
                },
            });
            expect(maxInFlight).toBe(2);
            const criterion = await db.aiEvaluationCriterionResult.findFirst({
                where: { caseResult: { runId: run.id }, criterionKey: 'answer' },
            });
            expect(criterion.details.repetitionVerdicts).toEqual(['PASSED', 'FAILED']);
            const attempts = await db.aiEvaluationAttempt.findMany({
                where: { caseResultId: criterion.caseResultId }, orderBy: { repetition: 'asc' },
            });
            const evidence = await db.aiEvaluationEvidence.findMany({ where: { runId: run.id, kind: 'CONVERSATION' } });
            expect(evidence).toHaveLength(2);
            expect(criterion.evidenceRefs).toEqual(attempts.map(attempt => evidence.find(row => row.attemptId === attempt.id)?.id));
        }, 60000);

        test('serializes run writes while capping concurrent turns across cases and repetitions', async () => {
            process.env.AI_EVALUATION_TARGET_CONCURRENCY = '2';
            const { run } = await createRuleRun('mvp4-target-concurrency', 4, 2);
            let transactionsInFlight = 0;
            let maxTransactionsInFlight = 0;
            const trackedDb = new Proxy(db, {
                get(target, property) {
                    if (property !== '$transaction') return Reflect.get(target, property);
                    return async (...args) => {
                        transactionsInFlight++;
                        maxTransactionsInFlight = Math.max(maxTransactionsInFlight, transactionsInFlight);
                        try {
                            // Give competing writes time to reach the database wrapper.
                            await new Promise(resolve => setTimeout(resolve, 20));
                            return await target.$transaction(...args);
                        } finally {
                            transactionsInFlight--;
                        }
                    };
                },
            });
            let inFlight = 0;
            let maxInFlight = 0;
            const transport = jest.fn(async () => {
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise(resolve => setTimeout(resolve, 50));
                inFlight--;
                return { answer: 'OK' };
            });
            await processEvaluation(run.jobId, { db: trackedDb, transport });
            expect(transport).toHaveBeenCalledTimes(8);
            expect(maxInFlight).toBe(2);
            expect(maxTransactionsInFlight).toBe(1);
        }, 60000);

        test('retries a rate limit once and measures only the successful call', async () => {
            const { run } = await createRuleRun('mvp4-rate-limit-retry');
            const transport = jest.fn(async () => ({ answer: 'OK' }));
            transport.mockImplementationOnce(async () => {
                await new Promise(resolve => setTimeout(resolve, 40));
                throw Object.assign(new Error('Rate limited'), { code: 'TARGET_RATE_LIMIT' });
            });
            await processEvaluation(run.jobId, { db, transport });
            expect(transport).toHaveBeenCalledTimes(2);
            const caseResult = await db.aiEvaluationCaseResult.findFirst({ where: { runId: run.id } });
            expect(caseResult).toMatchObject({ executionStatus: 'COMPLETED', errorCode: null });
            const { payload } = await db.aiEvaluationEvidence.findFirst({ where: { runId: run.id, kind: 'CONVERSATION' } });
            expect(payload.errorCode).toBeNull();
            expect(Math.abs(payload.latencyMs - payload.responses[0].latencyMs)).toBeLessThan(10);
        }, 60000);

        test.each([
            ['with the knowledge probe bypassed', 'mvp4-wrapped-rate-limit', true],
            ['for an external target without sources', 'mvp4-wrapped-rate-limit-no-sources', false],
        ])('recovers evaluation cases after three chatbot HTTP 500 quota errors %s', async (_scenario, name, skipKnowledgeProbe) => {
            const { run } = await createRuleRun(name, 3, 1, false, skipKnowledgeProbe);
            const targetBody = JSON.stringify({
                success: false,
                error: '[GoogleGenerativeAI Error]: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. [{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaValue":"15"},{"retryDelay":"37s"}]',
            });
            const turnExecutor = jest.fn(async () => ({ answer: 'OK', latencyMs: 0 }));
            for (let hit = 0; hit < 3; hit++) {
                turnExecutor.mockImplementationOnce(async () => {
                    const error = Object.assign(new Error('Your chatbot returned HTTP 500'), {
                        code: 'TARGET_HTTP_ERROR',
                        details: { targetStatus: 500 },
                    });
                    throw Object.defineProperty(error, 'targetBody', { value: targetBody });
                });
            }

            await processEvaluation(run.jobId, { db, turnExecutor });

            expect(turnExecutor).toHaveBeenCalledTimes(6);
            const cases = await db.aiEvaluationCaseResult.findMany({
                where: { runId: run.id }, select: { executionStatus: true },
            });
            expect(cases.map(result => result.executionStatus)).toEqual(Array(3).fill('COMPLETED'));
            const { executionStatus, summary } = await db.aiEvaluationRun.findUnique({ where: { id: run.id }, select: { executionStatus: true, summary: true } });
            expect(executionStatus).toBe('COMPLETED');
            expect(summary.rateLimit.hits).toBe(3);
            expect(summary.rateLimit.waitedMs).toBeGreaterThanOrEqual(38_500);
            expect(summary.rateLimit.dailyQuota).toBe(false);
        }, 60000);

        test('does not retry target timeouts', async () => {
            const { run } = await createRuleRun('mvp4-target-timeout');
            const transport = jest.fn(async () => {
                throw Object.assign(new Error('Target timed out'), { code: 'TARGET_TIMEOUT', statusCode: 502 });
            });
            await processEvaluation(run.jobId, { db, transport });
            expect(transport).toHaveBeenCalledTimes(1);
            const caseResult = await db.aiEvaluationCaseResult.findFirst({ where: { runId: run.id } });
            expect(caseResult).toMatchObject({ executionStatus: 'ERROR', errorCode: 'TARGET_TIMEOUT' });
        }, 60000);
    });

    test('blind review queue is stratified across scenario groups', async () => {
        const { profile, run } = await createRuleRun('mvp4-stratified', 10);
        await processEvaluation(run.jobId, { db, transport: async () => ({ answer: 'OK' }) });
        const rows = await db.aiEvaluationCriterionResult.findMany({
            where: { caseResult: { runId: run.id } }, orderBy: { id: 'asc' },
            select: { id: true, caseResult: { select: { testCaseId: true } } },
        });
        expect(rows).toHaveLength(10);
        const types = [...Array(6).fill('HAPPY_PATH'), 'MULTI_TURN', 'OUT_OF_SCOPE', 'OUT_OF_SCOPE', 'ADVERSARIAL'];
        for (const [index, row] of rows.entries()) {
            await db.aiEvaluationTestCase.update({
                where: { id: row.caseResult.testCaseId }, data: { taskType: types[index] }, select: { id: true },
            });
            await db.aiEvaluationCriterionResult.update({
                where: { id: row.id }, data: { status: index % 2 ? 'FAILED' : 'PASSED' }, select: { id: true },
            });
        }
        const four = await getBlindReviewQueue(db, project.id, profile.id, { limit: 4 });
        expect(four.map(item => item.taskType)).toEqual(['HAPPY_PATH', 'MULTI_TURN', 'OUT_OF_SCOPE', 'ADVERSARIAL']);
        const six = await getBlindReviewQueue(db, project.id, profile.id, { limit: 6 });
        expect(six.reduce((counts, item) => ({ ...counts, [item.taskType]: (counts[item.taskType] || 0) + 1 }), {}))
            .toEqual({ HAPPY_PATH: 2, MULTI_TURN: 1, OUT_OF_SCOPE: 2, ADVERSARIAL: 1 });
        for (const item of [...four, ...six]) {
            for (const key of ['status', 'score', 'reason', 'evaluator']) expect(item).not.toHaveProperty(key);
        }
    });

    test('design audit export returns JSON and PDF with the disclaimer', async () => {
        const fixture = fileURLToPath(new URL('./fixtures/sample-chatbots/shop-assistant-sloppy/', import.meta.url));
        const snapshot = await db.projectSnapshot.create({
            data: { projectId: project.id, source: 'ZIP', storagePath: path.resolve(fixture), rootDir: path.resolve(fixture) },
            select: { id: true },
        });
        await db.project.update({ where: { id: project.id }, data: { activeSnapshotId: snapshot.id }, select: { id: true } });
        expect((await runChatbotDesignAudit(db, project.id)).status).toBe('READY');
        const base = `/api/projects/${project.id}/ai-evaluations/design-audit/report`;
        const json = await request(app).get(base);
        expect(json.status).toBe(200);
        expect(json.headers['content-disposition']).toContain(`chatbot-design-audit-${project.id}.json`);
        expect(json.body.findings.length).toBeGreaterThan(0);
        expect(json.body.disclaimer).toBe(EVALUATION_DISCLAIMER);
        for (const finding of json.body.findings) {
            expect(finding.snippet || '').not.toContain('haidang@2026');
            expect(finding.snippet || '').not.toContain('NV-HAIDANG-50');
        }
        const pdf = await request(app).get(`${base}?format=pdf`).buffer(true).parse((res, callback) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => callback(null, Buffer.concat(chunks)));
            res.on('error', callback);
        });
        expect(pdf.status).toBe(200);
        expect(pdf.headers['content-type']).toContain('application/pdf');
        expect(Buffer.isBuffer(pdf.body)).toBe(true);
        expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    });

    test('design audit export refuses when no scan exists', async () => {
        const fresh = await db.project.create({
            data: { ownerId: owner.id, name: 'No audit' }, select: { id: true },
        });
        await expect(exportDesignAuditReport(db, fresh.id, owner.id)).rejects.toMatchObject({
            code: 'DESIGN_AUDIT_NOT_READY', statusCode: 409,
        });
        const response = await request(app).get(`/api/projects/${fresh.id}/ai-evaluations/design-audit/report`);
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('DESIGN_AUDIT_NOT_READY');
    });

    test('runner emits SHUTTING_DOWN before cleanup', async () => {
        const { target, run } = await createRuleRun('mvp4-shutdown');
        const version = await db.aiEvaluationTargetVersion.findUnique({
            where: { id: target.versionId }, select: { config: true },
        });
        await db.aiEvaluationTargetVersion.update({
            where: { id: target.versionId },
            data: { config: { ...version.config, executionMode: 'MANAGED_PROJECT' } }, select: { id: true },
        });
        const events = [];
        const previousIo = global.io;
        global.io = { to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) };
        runtimeStop = async () => { events.push({ cleanup: true }); };
        try {
            await processEvaluation(run.jobId, { db, transport: async () => ({ answer: 'OK' }) });
            const shutdown = events.findIndex(e => e.payload?.phase === 'SHUTTING_DOWN');
            const scenarios = events.map((e, i) => ['RUNNING_SCENARIO', 'JUDGING_SCENARIO'].includes(e.payload?.phase) ? i : -1);
            expect(Math.max(...scenarios)).toBeGreaterThanOrEqual(0);
            expect(shutdown).toBeGreaterThan(Math.max(...scenarios));
            expect(events[shutdown]).toMatchObject({
                room: [`project:${project.id}`, `user:${owner.id}`], event: 'evaluation:progress',
                payload: { projectId: project.id, runId: run.id, jobId: run.jobId, executionStatus: 'RUNNING' },
            });
            expect(events.filter(e => e.payload?.phase === 'SHUTTING_DOWN')).toHaveLength(1);
            expect(events.findIndex(e => e.cleanup)).toBeGreaterThan(shutdown);
            expect(events.findIndex(e => e.payload?.executionStatus === 'COMPLETED')).toBeGreaterThan(events.findIndex(e => e.cleanup));
        } finally {
            global.io = previousIo;
            runtimeStop = async () => {};
        }
    });
});
