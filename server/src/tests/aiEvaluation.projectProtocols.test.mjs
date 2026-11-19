import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeProjectStream } from '../services/aiEvaluation/projectStream.service.js';
import { selectProjectAdapter, projectAdapterCatalog } from '../services/aiEvaluation/projectAdapterRegistry.service.js';

const sse = value => `data: ${JSON.stringify(value)}\n\n`;
test('SSE decoder collects answer deltas and requires completion, rejecting errors and reasoning-only streams', () => {
    const wire = ': heartbeat\r\n\r\n' + sse({ choices: [{ delta: { content: 'Hello ' } }] }) + sse({ choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
    assert.equal(decodeProjectStream(wire, 'HTTP_SSE').answer, 'Hello world');
    assert.throws(() => decodeProjectStream(sse({ token: 'partial' }), 'HTTP_SSE'), { code: 'CHATBOT_STREAM_INCOMPLETE' });
    assert.throws(() => decodeProjectStream('data: {"token":"truncated","done":true}', 'HTTP_SSE'), { code: 'CHATBOT_STREAM_INCOMPLETE' });
    assert.throws(() => decodeProjectStream(sse({ token: 'partial' }) + sse({ error: 'private provider diagnostic' }), 'HTTP_SSE'), { code: 'CHATBOT_STREAM_ERROR' });
    assert.throws(() => decodeProjectStream(sse({ reasoning: 'secret analysis', done: true }), 'HTTP_SSE'), { code: 'CHATBOT_ANSWER_MISSING' });
    assert.throws(() => decodeProjectStream(sse({ type: 'reasoning', delta: 'private reasoning' }) + sse({ type: 'finish' }), 'HTTP_SSE'), { code: 'CHATBOT_ANSWER_MISSING' });
    assert.throws(() => decodeProjectStream(sse({ type: 'tool-call', token: 'delete' }) + sse({ type: 'finish' }), 'HTTP_SSE'), { code: 'CHATBOT_ANSWER_MISSING' });
});
test('NDJSON supports Ollama-shaped assistant responses without requesting a model-provider API key', () => {
    const wire = [{ message: { content: 'A' }, done: false }, { message: { content: 'B' }, done: true }].map(JSON.stringify).join('\n');
    assert.equal(decodeProjectStream(wire, 'HTTP_NDJSON').answer, 'AB');
    assert.throws(() => decodeProjectStream('{broken}\n', 'HTTP_NDJSON'), { code: 'CHATBOT_INVALID_STREAM' });
});
test('registry negotiates observed HTTP protocol and enforces it for benchmark requests', async () => {
    const adapter = selectProjectAdapter({ framework: 'FASTAPI', path: '/support', requestField: 'messages' });
    let calls = 0;
    const runtime = { request: async () => ({ status: 200, contentType: ++calls < 3 ? 'text/event-stream' : 'application/json', body: calls < 3 ? sse({ token: 'Observed', done: true }) : '{"answer":"changed"}' }) };
    const contract = await adapter.probe(runtime, { attempts: 1 });
    assert.equal(contract.protocol, 'HTTP_SSE');
    assert.equal(contract.adapter.id, 'http-chat');
    const execute = adapter.executor(runtime, contract);
    assert.equal((await execute({}, { messages: [{ role: 'user', content: 'help' }] })).answer, 'Observed');
    await assert.rejects(execute({}, { messages: [{ role: 'user', content: 'help' }] }), { code: 'CHATBOT_PROTOCOL_CHANGED' });
    assert.throws(() => selectProjectAdapter({ framework: 'UNKNOWN' }), { code: 'CHATBOT_ADAPTER_UNSUPPORTED' });
    assert.ok(projectAdapterCatalog().some(item => item.protocols.includes('HTTP_NDJSON')));
});
test('AI SDK UI adapter sends text parts and retains its client conversation ID', async () => {
    const bodies = [];
    const runtime = { request: async body => { bodies.push(body); return { status: 200, contentType: 'text/event-stream', body: sse({ type: 'text-delta', delta: 'answer' }) + sse({ type: 'finish' }) }; } };
    const adapter = selectProjectAdapter({ framework: 'NEXT', path: '/api/chat', requestField: 'messages', requestShape: 'AI_SDK_UI_MESSAGES' });
    const contract = await adapter.probe(runtime, { attempts: 1 });
    const execute = adapter.executor(runtime, contract);
    const first = await execute({}, { messages: [{ role: 'user', content: 'hello' }] });
    await execute({}, { conversationId: first.conversationId, messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: first.answer }, { role: 'user', content: 'next' }] });
    assert.deepEqual(bodies.at(-1).messages.at(-1).parts, [{ type: 'text', text: 'next' }]);
    assert.equal(bodies.at(-1).id, first.conversationId);
});
test('uncertain HTTP failure is not retried or tried with another request shape', async () => {
    let calls = 0;
    const runtime = { request: async () => { calls++; throw Object.assign(new Error('uncertain dispatch'), { code: 'LOCAL_REQUEST_FAILED' }); } };
    await assert.rejects(selectProjectAdapter({ framework: 'NODE_HTTP', path: '/chat' }).probe(runtime, { attempts: 3, wait: async () => {} }), { code: 'LOCAL_REQUEST_FAILED' });
    assert.equal(calls, 1);
});
