import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { evaluationDatabase } from './helpers/aiEvaluationDatabase.mjs';
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.AI_EVALUATION_ENABLED = 'true';
process.env.ENCRYPTION_KEY = '11'.repeat(32);
const { startProjectEvaluation, processProjectEvaluation, getProjectEvaluation, cancelProjectEvaluation, deleteProjectEvaluation, reconcileProjectEvaluations } = await import('../services/aiEvaluation/projectEvaluation.service.js');

test('unsupported Socket.IO chat is reported before sandbox startup and legacy variable lists are not requirements', { timeout: 120000 }, async () => {
    const database = await evaluationDatabase();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-socket-diagnostic-'));
    try {
        await fs.writeFile(path.join(root, 'chat.js'), `const {Server}=require('socket.io');const {GoogleGenAI}=require('@google/genai');io.on('connection',socket=>{socket.on('user_message',msg=>socket.emit('bot_reply',msg));}); const key=process.env.GEMINI_API_KEY; const port=process.env.PORT; const smtp=process.env.SMTP_KEY;`);
        const db = database.db;
        const owner = await db.user.create({ data: { email: 'socket-diagnostic@evaluation.invalid' } });
        const project = await db.project.create({ data: { name: 'Custom socket chatbot', ownerId: owner.id } });
        const snapshot = await db.projectSnapshot.create({ data: { projectId: project.id, source: 'GITHUB', rootDir: root, storagePath: root } });
        const workflow = await startProjectEvaluation(db, project.id, owner.id, { snapshotId: snapshot.id, idempotencyKey: 'socket' }, { enqueue: async () => {} });
        await processProjectEvaluation(workflow.jobId, { db, sandbox: async () => assert.fail('Unsupported protocol must not start the project') });
        const result = await getProjectEvaluation(db, project.id, workflow.id);
        assert.equal(result.errorCode, 'CHATBOT_ADAPTER_REQUIRED');
        assert.equal(result.evaluationRunId, null);
        assert.deepEqual(result.discovery.environmentAssessment.providerReferences, ['GEMINI_API_KEY']);
        assert.deepEqual(result.discovery.environmentAssessment.requiredNames, []);
        await db.aiEvaluationProjectRun.update({ where: { id: workflow.id }, data: { discovery: { environmentNames: ['GEMINI_API_KEY', 'SMTP_KEY', 'PORT'] } } });
        const legacy = await getProjectEvaluation(db, project.id, workflow.id);
        assert.deepEqual(legacy.discovery.environmentAssessment.runtimeManaged, ['PORT']);
        assert.deepEqual(legacy.discovery.environmentAssessment.requiredNames, []);
    } finally {
        await database.close();
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('covai-socket-diagnostic-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('streaming project workflow selects a protocol adapter and freezes its own business benchmark', { timeout: 120000 }, async () => {
    const database = await evaluationDatabase();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-stream-workflow-'));
    try {
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node app.js' } }));
        await fs.writeFile(path.join(root, 'app.js'), `app.post('/assistant', (req,res)=>{const {messages}=req.body;res.setHeader('Content-Type','text/event-stream');});`);
        await fs.writeFile(path.join(root, 'README.md'), '# Return Policy\nUsers can return orders within 7 days of receipt.\n');
        const db = database.db;
        const owner = await db.user.create({ data: { email: 'stream@evaluation.invalid' } });
        const project = await db.project.create({ data: { name: 'Streaming business chatbot', ownerId: owner.id } });
        const snapshot = await db.projectSnapshot.create({ data: { projectId: project.id, source: 'GITHUB', rootDir: root, storagePath: root } });
        const workflow = await startProjectEvaluation(db, project.id, owner.id, { snapshotId: snapshot.id, idempotencyKey: 'stream' }, { enqueue: async () => {} });
        let cleaned = false;
        await processProjectEvaluation(workflow.jobId, { db, sandbox: async () => ({ cleanup: async () => { cleaned = true; }, request: async body => {
            assert.ok(body.messages);
            return { status: 200, contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ token: 'Observed answer', done: true }) + '\n\n' };
        } }) });
        const result = await getProjectEvaluation(db, project.id, workflow.id);
        assert.equal(result.status, 'COMPLETED', result.errorMessage);
        assert.equal(result.result.runtime.protocol, 'HTTP_SSE');
        assert.equal(result.result.runtime.adapter.id, 'http-chat');
        assert.equal(result.result.businessAnalysis.groundedCaseCount, 1);
        assert.equal(result.report.manifest.sourceReferences[0].sourceFile, 'README.md');
        assert.equal(result.report.manifest.sourceReferences[0].sourceLine, 1);
        assert.equal(result.report.manifest.versions.adapter, 'http-chat-v2');
        assert.equal(result.report.verdict, 'INCOMPLETE'); // Consent-free semantic judgments remain unavailable.
        assert.ok(result.report.evidence.some(item => item.payload.responses?.some(response => response.protocolEvidence?.protocol === 'HTTP_SSE')));
        assert.ok(cleaned);
    } finally {
        await database.close();
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('covai-stream-workflow-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('Chainlit workflow stores native evidence and prevents passing with inferred dependencies', { timeout: 120000 }, async () => {
    const database = await evaluationDatabase();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-chainlit-workflow-'));
    try {
        await fs.writeFile(path.join(root, 'app.py'), 'import chainlit as cl\n@cl.on_message\nasync def respond(message): pass\n');
        const db = database.db;
        const owner = await db.user.create({ data: { email: 'chainlit@evaluation.invalid' } });
        const project = await db.project.create({ data: { name: 'Chainlit', ownerId: owner.id } });
        const snapshot = await db.projectSnapshot.create({ data: { projectId: project.id, source: 'GITHUB', rootDir: root, storagePath: root } });
        const workflow = await startProjectEvaluation(db, project.id, owner.id, { snapshotId: snapshot.id, idempotencyKey: 'native' }, { enqueue: async () => {} });
        let opened = 0, closed = 0, cleaned = false;
        await processProjectEvaluation(workflow.jobId, { db, sandbox: async () => ({
            request: async (_body, options) => { assert.equal(options.method, 'GET'); return { status: 200 }; },
            dependencyProvenance: { kind: 'COVAI_COMPATIBILITY_PROFILE', complete: false },
            generatedSecrets: ['fixture-generated-auth-secret'],
            openChainlitSession: async () => { opened++; let disposed = false; return {
                turn: async () => ({ answer: 'Observed fixture response.', trace: { protocol: 'CHAINLIT_SOCKET_IO', completed: true } }),
                close: async () => { if (!disposed) closed++; disposed = true; },
            }; },
            cleanup: async () => { cleaned = true; },
        }) });
        const result = await getProjectEvaluation(db, project.id, workflow.id);
        assert.equal(result.status, 'COMPLETED', result.errorMessage);
        assert.equal(result.report.manifest.projectRuntime.protocol, 'CHAINLIT_SOCKET_IO');
        assert.equal(result.report.manifest.versions.adapter, 'chainlit-socketio-v1');
        assert.equal(result.report.verdict, 'INCOMPLETE');
        assert.ok(result.report.summary.missingRequired.some(item => item.criterionKey === 'runtime-dependency-fidelity'));
        assert.ok(result.report.evidence.some(item => item.payload.responses?.some(response => response.protocolEvidence?.completed)));
        assert.equal(opened, closed); assert.ok(opened > 1); assert.ok(cleaned);
        assert.ok(!JSON.stringify(result).includes('fixture-generated-auth-secret'));
    } finally {
        await database.close();
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('covai-chainlit-workflow-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('snapshot workflow discovers, probes, scores and reports without user endpoint or benchmark', { timeout: 120000 }, async () => {
    const database = await evaluationDatabase();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-project-workflow-'));
    try {
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'chatbot', scripts: { start: 'node index.js' } }));
        await fs.writeFile(path.join(root, 'index.js'), `app.post('/chat',(req,res)=>{ const {messages}=req.body; res.json({answer:'Hello'}); });`);
        const db = database.db;
        const owner = await db.user.create({ data: { email: 'workflow@evaluation.invalid' } });
        const project = await db.project.create({ data: { name: 'Imported chatbot', ownerId: owner.id } });
        const snapshot = await db.projectSnapshot.create({ data: { projectId: project.id, source: 'GITHUB', rootDir: root, storagePath: root } });
        const jobs = [];
        const input = { snapshotId: snapshot.id, idempotencyKey: 'first', environment: { OPENAI_API_KEY: 'fixture-secret' } };
        const workflow = await startProjectEvaluation(db, project.id, owner.id, input, { enqueue: async (_type, id) => jobs.push(id) });
        assert.equal(jobs.length, 1);
        assert.ok(!JSON.stringify(workflow).includes('fixture-secret'));
        assert.ok(!JSON.stringify(workflow).includes('requestFingerprint'));
        assert.equal((await startProjectEvaluation(db, project.id, owner.id, input, { enqueue: async () => assert.fail('Duplicate enqueue') })).id, workflow.id);
        let probes = 0, cleaned = false;
        await processProjectEvaluation(workflow.jobId, { db, sandbox: async options => {
            assert.equal(options.environment.OPENAI_API_KEY, 'fixture-secret');
            assert.notEqual(options.root, root);
            return { cleanup: async () => { cleaned = true; }, request: async body => {
                probes++;
                const messages = body.messages;
                const nonce = messages?.[0]?.content.match(/COVAI-[a-f0-9]+/)?.[0];
                return { status: 200, body: JSON.stringify({ answer: `${nonce || 'I can help with this application.'} fixture-secret` }) };
            } };
        } });
        const result = await getProjectEvaluation(db, project.id, workflow.id);
        assert.equal(result.status, 'COMPLETED', result.errorMessage);
        assert.equal(result.phase, 'RESULTS');
        assert.equal(result.result.readiness.ready, true);
        assert.equal(result.report.manifest.evidenceScope, 'IMPORTED_PROJECT_SANDBOX');
        assert.equal(result.report.verdict, 'FAILED'); // Observed credential disclosure blocks passing despite missing semantic evidence.
        assert.ok(result.report.summary.missingRequired.some(r => r.criterionKey === 'project-correctness'));
        assert.ok(probes > 3); assert.equal(cleaned, true);
        assert.ok(result.report.evidence.length > 0);
        assert.ok(!JSON.stringify(result).includes('fixture-secret'), 'Environment values must be redacted in readiness, target manifest and conversation evidence');
        await assert.rejects(getProjectEvaluation(db, 'another-project', workflow.id), { statusCode: 404 });
        const outsider = await db.user.create({ data: { email: 'outsider@evaluation.invalid' } });
        await assert.rejects(startProjectEvaluation(db, project.id, outsider.id, { idempotencyKey: 'forbidden' }, { enqueue: async () => assert.fail('Must not enqueue another owner project') }), { statusCode: 404 });
        const second = await startProjectEvaluation(db, project.id, owner.id, { idempotencyKey: 'second' }, { enqueue: async () => {} });
        await assert.rejects(deleteProjectEvaluation(db, project.id, second.id), { statusCode: 409 });
        await cancelProjectEvaluation(db, project.id, second.id);
        await processProjectEvaluation(second.jobId, { db, sandbox: async () => assert.fail('Canceled workflow must not start') });
        assert.equal((await getProjectEvaluation(db, project.id, second.id)).status, 'CANCELED');
        const interrupted = await startProjectEvaluation(db, project.id, owner.id, { idempotencyKey: 'interrupted' }, { enqueue: async () => {} });
        await db.aiEvaluationProjectRun.update({ where: { id: interrupted.id }, data: { status: 'RUNNING', leaseUntil: new Date(0), leaseToken: 'expired' } });
        const cleanedOwners = [];
        await reconcileProjectEvaluations(db, { cleanup: async id => cleanedOwners.push(id), sweep: async () => {} });
        await processProjectEvaluation(interrupted.jobId, { db, sandbox: async () => assert.fail('Ambiguous requests must not be replayed') });
        assert.equal((await getProjectEvaluation(db, project.id, interrupted.id)).status, 'INDETERMINATE');
        assert.deepEqual(cleanedOwners, [interrupted.id]);
        await fs.writeFile(path.join(root, 'README.md'), 'Q: When can I return an order?\nA: Returns are allowed within seven days.\n');
        process.env.AI_EVALUATION_JUDGE_MODEL = 'gemini-fixture';
        const judged = await startProjectEvaluation(db, project.id, owner.id, { idempotencyKey: 'with-judge', judgeConsent: true }, { enqueue: async () => {} });
        let judgments = 0;
        await processProjectEvaluation(judged.jobId, { db, sandbox: async () => ({ cleanup: async () => {}, request: async body => ({ status: 200, body: JSON.stringify({ answer: body.messages?.[0]?.content.match(/COVAI-[a-f0-9]+/)?.[0] || 'Returns are allowed within seven days.' }) }) }), provider: async prompt => {
            judgments++; assert.ok(prompt.data.evidence.length > 0);
            return { text: JSON.stringify({ score: 100, reason: 'Fixture judge agrees with the supplied ground truth.', evidenceRefs: [prompt.data.evidence[0].id] }), actualModel: 'gemini-fixture' };
        } });
        const judgedReport = (await getProjectEvaluation(db, project.id, judged.id)).report;
        assert.equal(judgedReport.verdict, 'PASSED');
        assert.equal(judgedReport.summary.partial, false);
        assert.ok(judgments >= 4);
        assert.ok(judgedReport.manifest.sourceReferences.some(source => source.sourceFile === 'README.md'));
        await deleteProjectEvaluation(db, project.id, workflow.id);
        assert.equal(await db.aiEvaluationRun.count({ where: { id: result.evaluationRunId } }), 0);
        assert.equal(await db.job.count({ where: { id: workflow.jobId } }), 0);
        await db.project.delete({ where: { id: project.id } });
        assert.equal(await db.aiEvaluationProjectRun.count({ where: { projectId: project.id } }), 0);
    } finally {
        await database.close();
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('covai-project-workflow-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});
