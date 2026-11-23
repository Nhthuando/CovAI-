import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { evaluationDatabase } from './helpers/aiEvaluationDatabase.js';

process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.AI_EVALUATION_ENABLED = 'true';
process.env.ENCRYPTION_KEY = '66'.repeat(32);

const { computeRetryDelayMs, runGeminiRequest } = await import('../services/geminiRequestPolicy.service.js');
const { VERSIONS } = await import('../services/aiEvaluation/common.js');
const management = await import('../services/aiEvaluation/management.service.js');
const { processEvaluation } = await import('../services/aiEvaluation/runner.service.js');
const { getRunReport } = await import('../services/aiEvaluation/report.service.js');
const { requestRegrade } = await import('../services/aiEvaluation/regrade.service.js');
const { parse, definitionSchema } = await import('../services/aiEvaluation/contracts.js');

const todayInHoChiMinh = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const noJitter = () => 0;

describe('Gemini retry policy', () => {
    test('a daily-quota 429 is not retried', async () => {
        const error = Object.assign(new Error('429 generate_content_free_tier_requests: GenerateRequestsPerDay'), { status: 429 });
        let calls = 0;
        await expect(runGeminiRequest(async () => { calls++; throw error; }, { retryBaseDelayMs: 0 })).rejects.toBe(error);
        expect(calls).toBe(1);
    });

    test('a per-minute 429 waits the provider-suggested delay plus one second', () => {
        const error = Object.assign(new Error('429 Too Many Requests. Please retry in 3s.'), { status: 429 });
        expect(computeRetryDelayMs(error, 1, 1000, noJitter)).toBe(4000);
    });

    test('structured RetryInfo takes priority over the message', () => {
        const error = Object.assign(new Error('429 quota; retry in 3s'), {
            status: 429,
            errorDetails: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }],
        });
        expect(computeRetryDelayMs(error, 1, 1000, noJitter)).toBe(13000);
    });

    test('429 without a hint backs off from 5 s; 503 backs off from 2 s and is capped', () => {
        const rateLimited = Object.assign(new Error('rate limited'), { status: 429 });
        expect(computeRetryDelayMs(rateLimited, 1, 1000, noJitter)).toBe(5000);
        expect(computeRetryDelayMs(rateLimited, 2, 1000, noJitter)).toBe(10000);
        const busy = Object.assign(new Error('provider busy'), { status: 503 });
        expect(computeRetryDelayMs(busy, 1, 1000, noJitter)).toBe(2000);
        expect(computeRetryDelayMs(busy, 2, 1000, noJitter)).toBe(4000);
        expect(computeRetryDelayMs(busy, 10, 1000, noJitter)).toBe(20000);
        expect(computeRetryDelayMs(busy, 1, 0, noJitter)).toBe(0);
    });
});

describe('Judge prompt version', () => {
    test('the reasoning-first judge prompt has its own version', () => {
        expect(VERSIONS.judge).toBe('judge-v3');
    });
});

describe('Grade again (regrade) for ungraded checks', () => {
    let harness, db, user, project;
    const queued = [];
    const enqueue = async (type, jobId) => { queued.push({ type, jobId }); };

    beforeAll(async () => {
        harness = await evaluationDatabase();
        db = harness.db;
        user = await db.user.create({
            data: { email: 'regrade-owner@evaluation.invalid', aiUsageCount: 0, aiUsageDate: todayInHoChiMinh() },
        });
        project = await db.project.create({ data: { ownerId: user.id, name: 'Regrade suite' } });
    }, 120000);

    afterAll(async () => {
        await harness?.close();
    });

    async function incompleteRun(idempotencyKey) {
        const source = await management.createKnowledgeSourceFromInput(db, project.id, {
            name: `${idempotencyKey}-policy.md`,
            content: 'Warranty replacement is free within 12 months.',
        });
        const profile = await management.createProfile(db, project.id, `Regrade ${idempotencyKey}`);
        const versionId = profile.versions[0].id;
        const def = parse(definitionSchema, {
            sourceIds: [source.id],
            limits: { requestMs: 10000, caseMs: 20000, delayMs: 0, latencySlaMs: 5000, maxToolCalls: 5 },
            scoring: { confirmed: true, threshold: 75 },
            judge: { enabled: true, generatorModel: 'gemini-3.5-flash-lite', model: 'gemini-3.8-flash', generationConsent: true, judgingConsent: true },
        });
        const saved = await management.saveProfile(db, project.id, versionId, {
            revision: 0,
            definition: def,
            cases: [{
                caseKey: 'regrade-case-1',
                title: 'Warranty period',
                taskType: 'KNOWLEDGE_QA',
                turns: [{ content: 'How long is free warranty replacement?' }],
                context: '',
                expectedBehavior: 'State 12 months.',
                expectedFacts: ['12 months'],
                sourceQuote: 'Warranty replacement is free within 12 months.',
                risk: 'LOW',
                weight: 1,
                repetitions: 2,
                initialState: {},
                confirmationScript: [],
                criteria: [{
                    key: 'grounded-answer',
                    method: 'semantic',
                    enabled: true,
                    required: true,
                    blocking: false,
                    weight: 1,
                    rubric: 'Anchored 0 / 0.5 / 1 grounding check.',
                    threshold: 75,
                    groundTruth: 'Free replacement within 12 months.',
                    sourceIds: [source.id],
                }],
            }],
        });
        const approved = await management.approveProfile(db, project.id, versionId, saved.revision, user.id);
        const target = await management.saveTarget(db, project.id, {
            name: `${idempotencyKey} target`,
            config: { executionMode: 'EXTERNAL_URL', endpoint: 'https://regrade.example.com/api/chat', auth: { type: 'none', header: 'X-API-Key' } },
        });
        const run = await management.createRun(
            db, project.id, user.id,
            { targetVersionId: target.versionId, profileVersionId: approved.id, idempotencyKey },
            { enqueue },
        );
        await processEvaluation(run.jobId, {
            db,
            transport: async () => ({ answer: 'Warranty replacement is free within 12 months.' }),
            provider: async () => ({ text: '<<< overloaded judge >>>', actualModel: 'gemini-3.8-flash' }),
        });
        return run;
    }

    test('grades only the ERROR check again from stored answers and recomputes the verdict', async () => {
        const run = await incompleteRun('regrade-ok');
        const before = await getRunReport(db, project.id, run.id);
        expect(before.verdict).toBe('INCOMPLETE');
        expect(before.errorCriteriaCount).toBe(1);

        const requested = await requestRegrade(db, project.id, user.id, run.id, { enqueue });
        expect(requested.cases).toBe(1);
        await expect(requestRegrade(db, project.id, user.id, run.id, { enqueue }))
            .rejects.toMatchObject({ code: 'REGRADE_ACTIVE' });

        let chatbotCalls = 0;
        await processEvaluation(requested.jobId, {
            db,
            transport: async () => { chatbotCalls++; return { answer: 'should not be called' }; },
            provider: async promptPayload => {
                const evidenceIds = promptPayload.data.evidence.map(e => e.id);
                const criteria = {};
                for (const c of promptPayload.data.criteria) {
                    criteria[c.key] = { reason: 'Matches the policy.', repetitionScores: [1, 1], evidenceRefs: [evidenceIds[0]] };
                }
                return { text: JSON.stringify({ criteria }), actualModel: 'gemini-3.8-flash', usage: { totalTokenCount: 120 } };
            },
        });

        expect(chatbotCalls).toBe(0);
        const after = await getRunReport(db, project.id, run.id);
        expect(after.errorCriteriaCount).toBe(0);
        const judged = after.cases[0].criteria.find(c => c.criterionKey === 'grounded-answer');
        expect(judged.status).toBe('PASSED');
        expect(judged.evaluator.promptVersion).toBe('judge-v3');
        // The rule-based key-fact oracle ran on the stored answers without any AI call.
        const keyFacts = after.cases[0].criteria.find(c => c.criterionKey === 'keyFacts');
        expect(keyFacts).toMatchObject({ method: 'rule', status: 'PASSED' });
        expect(keyFacts.details.repetitionVerdicts).toEqual(['PASSED', 'PASSED']);
        // Reports carry the judge-correction block even without human reviews yet.
        expect(after.judgeCorrection.byCriterion['grounded-answer'].status).toBe('NOT_ENOUGH_CALIBRATION');
        expect(after.oracleAgreement).toHaveProperty('n');
        expect(after.verdict).toBe('PASSED');
        expect(after.summary.regradeCount).toBe(1);
        expect(typeof after.summary.regradedAt).toBe('string');
        const job = await db.job.findUnique({ where: { id: requested.jobId }, select: { status: true } });
        expect(job.status).toBe('SUCCESS');

        await expect(requestRegrade(db, project.id, user.id, run.id, { enqueue }))
            .rejects.toMatchObject({ code: 'NOTHING_TO_REGRADE' });
    }, 60000);
});
