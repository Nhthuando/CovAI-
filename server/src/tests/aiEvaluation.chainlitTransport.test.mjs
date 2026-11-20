import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chainlitTransport, chainlitTurnExecutor } from '../services/aiEvaluation/chainlitTransport.service.js';

function fixture() {
    const child = new EventEmitter();
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => child.emit('close', 0) });
    const commands = [];
    child.stdin.on('data', data => commands.push(JSON.parse(data.toString())));
    return { child, commands, transport: chainlitTransport('covai-chatbot-12345678901234567890', { spawnProcess: () => child }) };
}

test('Chainlit JSONL preserves split UTF-8 and only resolves matching requests', async () => {
    const { child, commands, transport } = fixture();
    const pending = transport.request({ op: 'turn', content: 'test' });
    child.stdout.write(JSON.stringify({ id: 'unrelated', ok: true, answer: 'wrong' }) + '\n');
    const wire = Buffer.from(JSON.stringify({ id: commands[0].id, ok: true, answer: 'Evaluation' }) + '\n');
    const offset = wire.indexOf(Buffer.from('E')) + 1;
    child.stdout.write(wire.subarray(0, offset)); child.stdout.write(wire.subarray(offset));
    assert.equal((await pending).answer, 'Evaluation');
    await transport.close(); child.emit('close', 0);
});

test('canceling a dispatched Chainlit turn closes the session without replay', async () => {
    const { child, commands, transport } = fixture();
    const controller = new AbortController();
    const result = transport.request({ op: 'turn', content: 'once' }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(result, { code: 'RUN_CANCELED' });
    await assert.rejects(transport.request({ op: 'turn', content: 'retry' }), { code: 'CHAINLIT_SESSION_CLOSED' });
    assert.equal(commands.filter(item => item.op === 'turn').length, 1);
    child.emit('close', 0);
});

test('native executor reuses a conversation but closes failed attempts and starts fresh cases', async () => {
    const sessions = [];
    const execute = chainlitTurnExecutor({ openChainlitSession: async () => {
        const state = { turns: [], closed: false }; sessions.push(state);
        return { turn: async text => { if (text === 'error') throw Object.assign(new Error('disconnect'), { code: 'CHAINLIT_DISCONNECTED' }); state.turns.push(text); return { answer: state.turns.join('|') }; }, close: async () => { state.closed = true; } };
    } });
    const first = await execute({}, { messages: [{ content: 'A' }] });
    const second = await execute({}, { conversationId: first.conversationId, messages: [{ content: 'A' }, { content: 'B' }] });
    assert.equal(second.answer, 'A|B');
    await execute.closeConversation(first.conversationId);
    const fresh = await execute({}, { messages: [{ content: 'C' }] });
    assert.equal(fresh.answer, 'C');
    await assert.rejects(execute({}, { conversationId: fresh.conversationId, messages: [{ content: 'error' }] }), { code: 'CHAINLIT_DISCONNECTED' });
    assert.ok(sessions.every(item => item.closed));
    await assert.rejects(execute({}, { conversationId: fresh.conversationId, messages: [{ content: 'retry' }] }), { code: 'CHAINLIT_SESSION_CLOSED' });
    assert.equal(sessions.length, 2);
});
