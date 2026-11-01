import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { evaluationDatabase } from './helpers/aiEvaluationDatabase.mjs';

process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.AI_EVALUATION_ENABLED = 'true';
process.env.AI_EVALUATION_ACTION_ENABLED = 'true';
process.env.AI_EVALUATION_GATEWAY_URL = 'https://gateway.example.com/api/ai-evaluation-gateway';
process.env.ENCRYPTION_KEY = '11'.repeat(32);
const management = await import('../services/aiEvaluation/management.service.js');
const { processEvaluation, cancelRun, reconcileEvaluations, processEvaluationPrepare } = await import('../services/aiEvaluation/runner.service.js');
const { createEvaluationRouter } = await import('../routes/aiEvaluation.route.js');
const { createGatewayRouter } = await import('../routes/aiEvaluationGateway.route.js');
const { gatewayRequest } = await import('../services/aiEvaluation/gateway.service.js');
const { getRunReport, compareRuns, renderEvaluationPdf, calibration } = await import('../services/aiEvaluation/report.service.js');
const { parse, caseSchema, definitionSchema } = await import('../services/aiEvaluation/contracts.js');
const { hash } = await import('../services/aiEvaluation/common.js');
let harness, db, owner, outsider, project, secondProject, target, app;
const queued = [];
const enqueue = async (type, jobId) => { queued.push({ type, jobId }); };
const rule = (key, type, expected, extra = {}) => ({ key, method: 'rule', rule: { type, ...(expected !== undefined ? { expected } : {}) }, ...extra });
const qaCase = (overrides = {}) => parse(caseSchema, { caseKey: 'qa', title: 'Return policy', taskType: 'KNOWLEDGE_QA', turns: [{ content: 'What is the return period?' }], criteria: [rule('correctness', 'containsAll', ['7 days'])], ...overrides });
async function benchmark(cases, changes = {}) {
    const profile = await management.createProfile(db, project.id, `Benchmark ${crypto.randomUUID()}`);
    const definition = parse(definitionSchema, { scoring: { confirmed: true, threshold: 80 }, ...changes });
    const saved = await management.saveProfile(db, project.id, profile.versions[0].id, { revision: 0, definition, cases });
    return management.approveProfile(db, project.id, saved.id, saved.revision, owner.id);
}
async function runFor(profile, targetId = target.versionId, customEnqueue = enqueue) {
    return management.createRun(db, project.id, owner.id, { targetVersionId: targetId, profileVersionId: profile.id, idempotencyKey: crypto.randomUUID() }, { enqueue: customEnqueue });
}
before(async () => {
    harness = await evaluationDatabase(); db = harness.db;
    owner = await db.user.create({ data: { email: 'owner@evaluation.invalid' } }); outsider = await db.user.create({ data: { email: 'outsider@evaluation.invalid' } });
    project = await db.project.create({ data: { ownerId: owner.id, name: 'Evaluation fixture' } }); secondProject = await db.project.create({ data: { ownerId: outsider.id, name: 'Unrelated' } });
    target = await management.saveTarget(db, project.id, { name: 'Fixture', config: { endpoint: 'https://chatbot.example.com/chat' } });
    app = express(); app.use('/gateway', createGatewayRouter({ db })); app.use(express.json());
    app.use('/api/projects/:projectId/ai-evaluations', createEvaluationRouter({ db, enqueue, auth: (req, _res, next) => { req.user = { id: req.headers['x-test-user'] || owner.id }; next(); }, transport: async () => ({ answer: 'OK' }) }));
}, { timeout: 120000 });
after(async () => { await harness?.close(); });

test('migrated persistence, approval, QA and Guidance run, reports and human review', async () => {
    const profile = await benchmark([qaCase(), qaCase({ caseKey: 'guide', taskType: 'USAGE_GUIDANCE', turns: [{ content: 'Show orders' }], criteria: [rule('steps', 'orderedSteps', ['Account', 'Orders'])] })]);
    await assert.rejects(() => management.saveProfile(db, project.id, profile.id, { revision: profile.revision, definition: profile.definition, cases: [] }), /cannot be edited/);
    const run = await runFor(profile);
    await processEvaluation(run.jobId, { db, transport: async ({ body }) => ({ answer: body.messages.at(-1).content === 'Show orders' ? 'Account then Orders' : 'Returns within 7 days' }) });
    const report = await getRunReport(db, project.id, run.id);
    assert.equal(report.executionStatus, 'COMPLETED'); assert.equal(report.verdict, 'PASSED'); assert.equal(report.summary.score, 100); assert.equal(report.evidence.length, 2);
    const criterion = report.cases[0].criteria[0];
    await management.addReview(db, project.id, criterion.id, owner.id, { verdict: 'FAILED', score: 0, rationale: 'Human disagrees with literal matching' });
    assert.equal((await db.aiEvaluationCriterionResult.findUnique({ where: { id: criterion.id } })).status, 'PASSED');
    assert.equal((await calibration(db, project.id, profile.profileId)).agreementRate, 0);
    const pdf = await renderEvaluationPdf(report); assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    const response = await request(app).get(`/api/projects/${project.id}/ai-evaluations/runs/${run.id}/report?format=json`); assert.equal(response.status, 200);
});

test('owner scoping, cross-project IDs, draft revision conflict and encrypted credentials', async () => {
    const base = `/api/projects/${project.id}/ai-evaluations`;
    assert.equal((await request(app).get(base).set('x-test-user', outsider.id)).status, 404);
    await db.projectMember.create({ data: { projectId: project.id, userId: outsider.id, role: 'EDITOR' } });
    assert.equal((await request(app).get(base).set('x-test-user', outsider.id)).status, 403);
    const profile = await management.createProfile(db, project.id, 'Concurrent draft');
    const input = { revision: 0, definition: parse(definitionSchema, {}), cases: [qaCase()] };
    assert.equal((await request(app).patch(`${base}/profile-versions/${profile.versions[0].id}`).send(input)).status, 200);
    assert.equal((await request(app).patch(`${base}/profile-versions/${profile.versions[0].id}`).send(input)).status, 409);
    assert.equal((await request(app).get(`/api/projects/${secondProject.id}/ai-evaluations/profile-versions/${profile.versions[0].id}`).set('x-test-user', outsider.id)).status, 404);
    const secretTarget = await management.saveTarget(db, project.id, { name: 'Secret fixture', credential: 'credential-do-not-leak', config: { endpoint: 'https://chatbot.example.com/chat', auth: { type: 'bearer' } } });
    const stored = await db.aiEvaluationCredential.findFirst({ where: { targetId: secretTarget.targetId } }); assert.notEqual(stored.ciphertext, 'credential-do-not-leak');
    const publicData = await request(app).get(base); assert.ok(!JSON.stringify(publicData.body).includes(stored.ciphertext)); assert.ok(!JSON.stringify(publicData.body).includes('credential-do-not-leak'));
});

test('missing metadata and failed target remain incomplete; failed case does not erase prior evidence', async () => {
    const profile = await benchmark([qaCase(), qaCase({ caseKey: 'missing', criteria: [rule('cost', 'cost', undefined, { rule: { type: 'cost', max: 1, currency: 'USD' } })] })]);
    const run = await runFor(profile); await processEvaluation(run.jobId, { db, transport: async () => ({ answer: '7 days' }) });
    const report = await getRunReport(db, project.id, run.id); assert.equal(report.verdict, 'INCOMPLETE'); assert.equal(report.summary.score, 100); assert.equal(report.summary.partial, true);
    const run2 = await runFor(profile); let calls = 0;
    await processEvaluation(run2.jobId, { db, transport: async () => { if (++calls === 2) throw new Error('connection lost'); return { answer: '7 days' }; } });
    const report2 = await getRunReport(db, project.id, run2.id); assert.equal(report2.evidence.length, 2); assert.equal(report2.verdict, 'INCOMPLETE');
    assert.equal((await compareRuns(db, project.id, [run.id, run2.id])).rankable, false);
});

const mockTool = { name: 'renameTask', description: 'Rename a test task', requiresConfirmation: true, duplicateKey: ['/taskId'], inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, name: { type: 'string' } }, required: ['taskId', 'name'], additionalProperties: false }, outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, branches: [{ when: [], result: { ok: true }, effects: [{ op: 'set', path: '/name', value: { $from: 'args', path: '/name' } }, { op: 'increment', path: '/changes', value: 1 }] }] };
const actionArgs = { taskId: 'task-1', name: 'Done' };
const actionCase = () => qaCase({ caseKey: 'action', taskType: 'ACTION_TOOL', initialState: { name: 'Before', changes: 0 }, confirmationScript: [{ toolName: 'renameTask', arguments: actionArgs, decision: 'APPROVED' }], criteria: [rule('confirmation', 'confirmation', undefined, { blocking: true }), rule('forbidden', 'forbiddenActions', undefined, { blocking: true }), rule('duplicates', 'duplicates', undefined, { blocking: true }), rule('state', 'state', 1, { rule: { type: 'state', path: '/changes', expected: 1 } })] });
test('stateful action gateway consumes one grant and concurrent replay executes once', async () => {
    const profile = await benchmark([actionCase()], { tools: [mockTool] });
    const actionTarget = await management.saveTarget(db, project.id, { name: 'Action fixture', config: { endpoint: 'https://chatbot.example.com/chat', mockGateway: true, testEnvironmentConfirmed: true } });
    const run = await runFor(profile, actionTarget.versionId);
    let session;
    await processEvaluation(run.jobId, { db, transport: async ({ body }) => {
        session = body.evaluationContext.gateway;
        assert.ok(!JSON.stringify(body).includes('confirmationScript')); assert.ok(!JSON.stringify(body).includes('expected'));
        const grant = await gatewayRequest(session.sessionId, session.token, 'confirmation', { requestId: 'confirm-1', toolName: 'renameTask', arguments: actionArgs, prompt: 'Rename this task?' }, db);
        const input = { callId: 'call-1', toolName: 'renameTask', arguments: actionArgs, confirmationGrantId: grant.body.grantId };
        const responses = await Promise.all([gatewayRequest(session.sessionId, session.token, 'tool', input, db), gatewayRequest(session.sessionId, session.token, 'tool', input, db)]);
        assert.equal(responses[0].body.status, 'EXECUTED'); assert.equal(responses[1].body.status, 'EXECUTED');
        return { answer: 'Done' };
    } });
    const report = await getRunReport(db, project.id, run.id); assert.equal(report.verdict, 'PASSED');
    const trace = report.evidence.find(e => e.kind === 'GATEWAY_TRACE'); assert.equal(trace.payload.state.changes, 1); assert.equal(trace.payload.calls.length, 1); assert.ok(trace.payload.grants[0].consumedAt);
    assert.ok(!JSON.stringify(report).includes(session.token));
    await assert.rejects(() => gatewayRequest(session.sessionId, session.token, 'tool', { callId: 'late', toolName: 'renameTask', arguments: actionArgs }, db));
});

test('missing confirmation is a blocking failure even when gateway prevents the change', async () => {
    const profile = await benchmark([actionCase()], { tools: [mockTool] });
    const actionTarget = await management.saveTarget(db, project.id, { name: 'Unsafe fixture', config: { endpoint: 'https://chatbot.example.com/chat', mockGateway: true, testEnvironmentConfirmed: true } });
    const run = await runFor(profile, actionTarget.versionId);
    await processEvaluation(run.jobId, { db, transport: async ({ body }) => { const s = body.evaluationContext.gateway; const reply = await gatewayRequest(s.sessionId, s.token, 'tool', { callId: 'no-confirm', toolName: 'renameTask', arguments: actionArgs }, db); assert.equal(reply.body.status, 'CONFIRMATION_REQUIRED'); return { answer: 'Done' }; } });
    const report = await getRunReport(db, project.id, run.id); assert.equal(report.verdict, 'FAILED'); assert.equal(report.evidence.find(e => e.kind === 'GATEWAY_TRACE').payload.state.changes, 0);
});

test('queue failures are persisted, worker redelivery never repeats dispatched calls, cancellation is terminal', async () => {
    const profile = await benchmark([qaCase()]);
    await assert.rejects(() => runFor(profile, target.versionId, async () => { throw new Error('Redis unavailable'); }), /could not be queued/);
    const failed = await db.aiEvaluationRun.findFirst({ where: { projectId: project.id, errorCode: 'ENQUEUE_FAILED' } }); assert.ok(failed);
    const run = await runFor(profile);
    await db.aiEvaluationRun.update({ where: { id: run.id }, data: { executionStatus: 'RUNNING', leaseUntil: new Date(0), leaseToken: 'old' } });
    let dispatches = 0; await processEvaluation(run.jobId, { db, transport: async () => { dispatches++; return { answer: '7 days' }; } });
    assert.equal(dispatches, 0); assert.equal((await db.aiEvaluationRun.findUnique({ where: { id: run.id } })).executionStatus, 'INDETERMINATE');
    const canceled = await runFor(profile); await cancelRun(db, canceled.id); await processEvaluation(canceled.jobId, { db, transport: async () => { dispatches++; return { answer: '7 days' }; } }); assert.equal(dispatches, 0);
    await reconcileEvaluations(db);
});

test('knowledge upload is prepared asynchronously and project cleanup cascades only its evaluation records', async () => {
    const response = await request(app).post(`/api/projects/${project.id}/ai-evaluations/sources/upload`).attach('file', Buffer.from('Return policy: 7 days'), 'policy.txt');
    assert.equal(response.status, 202); await processEvaluationPrepare(response.body.data.jobId, { db });
    const source = await db.aiEvaluationKnowledgeSource.findUnique({ where: { id: response.body.data.sourceId } }); assert.equal(source.status, 'READY'); assert.equal(source.contentHash, hash('Return policy: 7 days'));
    const otherTarget = await management.saveTarget(db, secondProject.id, { name: 'Keep', config: { endpoint: 'https://other.example.com/chat' } });
    await db.project.delete({ where: { id: project.id } });
    assert.equal(await db.aiEvaluationRun.count({ where: { projectId: project.id } }), 0); assert.equal(await db.aiEvaluationCredential.count(), 0);
    assert.ok(await db.aiEvaluationTarget.findUnique({ where: { id: otherTarget.targetId } }));
});
