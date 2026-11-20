import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startProjectSandbox, dockerCommand } from '../services/aiEvaluation/projectSandbox.service.js';
import { discoverProjectChatbot } from '../services/aiEvaluation/projectDiscovery.service.js';
import { probeChainlitChatbot, chainlitTurnExecutor } from '../services/aiEvaluation/chainlitTransport.service.js';

// Transport fixtures exercise Chainlit itself, not the quality of a simulated LLM.
for (const mounted of [false, true]) test(`real Chainlit ${mounted ? 'authenticated FastAPI mount' : 'CLI'} streams correlated answers and isolates sessions`, { skip: process.env.RUN_CHATBOT_SANDBOX_TEST !== 'true', timeout: 360000 }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-chainlit-'));
    let runtime;
    try {
        await fs.writeFile(path.join(root, 'chat.py'), `import asyncio
import chainlit as cl
@cl.on_chat_start
async def start():
    await asyncio.sleep(0.2)
    cl.user_session.set('history', [])
    await cl.Message(content='GREETING_NOT_AN_ANSWER').send()
@cl.on_message
async def respond(message: cl.Message):
    if message.content == 'throw':
        raise ValueError('fixture failure')
    history = cl.user_session.get('history')
    history.append(message.content)
    msg = cl.Message(content='')
    await msg.send()
    for token in ['observed:', '|'.join(history)]:
        await msg.stream_token(token)
    await msg.update()
`);
        if (mounted) await fs.writeFile(path.join(root, 'app.py'), `from fastapi import FastAPI, Request
from chainlit.utils import mount_chainlit
from chainlit.user import User
from chainlit.server import _authenticate_user
app = FastAPI()
@app.get('/session/login')
async def custom_auth(request: Request):
    return await _authenticate_user(request, User(identifier='fixture-user'))
mount_chainlit(app=app, target='chat.py', path='/chainlit')
`);
        const discovery = await discoverProjectChatbot(root);
        assert.equal(discovery.candidates.length, 1);
        const candidate = discovery.candidates[0];
        runtime = await startProjectSandbox({ root, candidate, docker: async (args, options) => {
            try { return await dockerCommand(args, options); }
            catch (error) { if (args[0] === 'build') console.error('Fixture image build failure:', error.diagnostic || error.code); throw error; }
        } });
        assert.equal(runtime.dependencyProvenance.complete, false);
        const contract = await probeChainlitChatbot(runtime, candidate).catch(async error => { console.error('Chainlit fixture startup:', await runtime.logs()); throw error; });
        assert.equal(contract.protocol, 'CHAINLIT_SOCKET_IO');
        const execute = chainlitTurnExecutor(runtime);
        const first = await execute({}, { messages: [{ role: 'user', content: 'nonce-A' }] });
        assert.equal(first.answer, 'observed:nonce-A');
        assert.ok(first.protocolEvidence.events.some(event => event.event === 'stream_token'));
        const second = await execute({}, { conversationId: first.conversationId, messages: [{ role: 'user', content: 'nonce-A' }, { role: 'assistant', content: first.answer }, { role: 'user', content: 'nonce-B' }] });
        assert.equal(second.answer, 'observed:nonce-A|nonce-B');
        await execute.closeConversation(first.conversationId);
        const fresh = await execute({}, { messages: [{ role: 'user', content: 'nonce-C' }] });
        assert.equal(fresh.answer, 'observed:nonce-C');
        await assert.rejects(execute({}, { conversationId: fresh.conversationId, messages: [{ role: 'user', content: 'throw' }] }), { code: 'CHATBOT_RUNTIME_ERROR' });
        await assert.rejects(execute({}, { conversationId: fresh.conversationId, messages: [{ role: 'user', content: 'do-not-replay' }] }), { code: 'CHAINLIT_SESSION_CLOSED' });
        const config = JSON.parse(await dockerCommand(['inspect', runtime.id]));
        assert.deepEqual(config[0].Mounts, []);
        assert.equal(config[0].HostConfig.ReadonlyRootfs, true);
        assert.deepEqual(config[0].HostConfig.PortBindings, {});
    } finally {
        await runtime?.cleanup();
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('covai-chainlit-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});
