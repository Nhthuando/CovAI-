import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startProjectSandbox, freezeProjectSource, reconcileProjectSandboxResources } from '../services/aiEvaluation/projectSandbox.service.js';
import { probeProjectChatbot, projectTurnExecutor } from '../services/aiEvaluation/projectAdapter.service.js';

test('sandbox refuses host execution when Docker is unavailable', async () => {
    const commands = [];
    await assert.rejects(startProjectSandbox({ root: '.', candidate: {}, docker: async args => { commands.push(args); throw new Error('no Docker'); } }), /Docker sandbox is unavailable/);
    assert.ok(commands.every(args => ['version', 'network'].includes(args[0])));
});
test('runtime has no host mounts, public ports or platform environment, and cleanup removes owned resources', async () => {
    const commands = [];
    const runtime = await startProjectSandbox({ root: '.', candidate: { packageDirectory: '.', startScript: 'start', file: 'index.js', path: '/chat' }, environment: { OPENAI_API_KEY: 'fixture-only-key' }, archive: async () => Buffer.from('fixture'), docker: async args => { commands.push(args); return ''; } });
    const application = commands.find(args => args[0] === 'create' && args.includes('--memory=768m'));
    assert.ok(application.includes('--read-only'));
    assert.ok(!application.some(arg => arg.includes('fixture-only-key')));
    assert.ok(!application.includes('-v') && !application.includes('-p') && !application.includes('--privileged'));
    assert.ok(commands.find(args => args[0] === 'network' && args.includes('--internal')));
    assert.ok(commands.find(args => args.includes('ci') || args.includes('install')).includes('--ignore-scripts'));
    await runtime.cleanup();
    assert.equal(commands.filter(args => args[0] === 'rm').length, 2);
});

test('source freezing excludes credentials and fails closed at its byte budget', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-freeze-'));
    try {
        const source = path.join(root, 'source'); await fs.mkdir(source);
        await fs.writeFile(path.join(source, '.env'), 'SECRET=never-copy');
        await fs.writeFile(path.join(source, '.npmrc'), 'token=never-copy');
        await fs.writeFile(path.join(source, 'index.js'), 'console.log("fixture")');
        await freezeProjectSource(source, path.join(root, 'frozen'));
        assert.deepEqual(await fs.readdir(path.join(root, 'frozen')), ['index.js']);
        await assert.rejects(freezeProjectSource(source, path.join(root, 'limited'), { maxBytes: 1 }), { code: 'PROJECT_SOURCE_LIMIT' });
    } finally {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('covai-freeze-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('cleanup retries failed removals, while orphan sweep preserves active runs', async () => {
    let failOnce = true, removals = 0;
    const runtime = await startProjectSandbox({ root: '.', candidate: { packageDirectory: '.', startScript: 'start', file: 'index.js', path: '/chat' }, archive: async () => Buffer.from('fixture'), docker: async args => {
        if (args[0] === 'rm') { removals++; if (failOnce) { failOnce = false; throw new Error('daemon temporarily unavailable'); } }
        return '';
    } });
    await assert.rejects(runtime.cleanup(), { code: 'SANDBOX_CLEANUP_FAILED' });
    await runtime.cleanup(); assert.equal(removals, 3);
    const removed = [], terminal = `covai-chatbot-${'a'.repeat(20)}`;
    await reconcileProjectSandboxResources({ aiEvaluationProjectRun: { findUnique: async ({ where }) => ({ status: where.id === 'active' ? 'RUNNING' : 'CANCELED' }) } }, async args => {
        if (args[0] === 'ps' && args.includes('{{.Label "covai.evaluationId"}}')) return 'active\nterminal';
        if (args[0] === 'ps') { assert.ok(args.includes('label=covai.evaluationId=terminal')); return terminal; }
        if (args[0] === 'rm') removed.push(args.at(-1));
        return '';
    });
    assert.deepEqual(removed, [terminal]);
});
test('probe must receive an actual answer and the verified adapter preserves messages', async () => {
    const seen = [];
    const runtime = { request: async body => { seen.push(body); return body.messages ? { status: 200, body: JSON.stringify({ answer: 'Hello' }) } : { status: 422, body: '{}' }; } };
    const contract = await probeProjectChatbot(runtime, { path: '/chat', requestField: 'messages' }, { attempts: 1, wait: async () => {} });
    assert.equal(contract.ready, true);
    const messages = [{ role: 'user', content: 'First' }, { role: 'assistant', content: 'Reply' }, { role: 'user', content: 'Second' }];
    assert.equal((await projectTurnExecutor(runtime, contract)({}, { messages })).answer, 'Hello');
    assert.deepEqual(seen.at(-1).messages, messages);
});
test('an HTTP health page or startup error cannot masquerade as a runnable chatbot', async () => {
    await assert.rejects(probeProjectChatbot({ request: async () => ({ status: 200, body: '{"healthy":true}' }) }, { path: '/chat' }, { attempts: 1, wait: async () => {} }), /nonempty chatbot answer/);
    await assert.rejects(probeProjectChatbot({ request: async () => ({ status: 500, body: '{}' }) }, { path: '/chat' }, { attempts: 1 }), /failed while generating/);
});
