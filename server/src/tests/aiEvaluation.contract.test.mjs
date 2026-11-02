import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = '';
const { same, safeJson, setPointer, serial } = await import('../services/aiEvaluation/common.js');
const { resolvePublic, validateEndpoint, isPublicAddress, executeTurn } = await import('../services/aiEvaluation/httpJson.adapter.js');
const { executeMock } = await import('../services/aiEvaluation/mockRuntime.service.js');
const { evaluateRule } = await import('../services/aiEvaluation/evaluator.service.js');
const { providerJson } = await import('../services/aiEvaluation/judge.service.js');

test('serial retries PostgreSQL raw serialization failures but not unrelated database errors', async () => {
    for (const failure of [{ code: 'P2034' }, { code: 'P2010', meta: { code: '40001' } }, { code: 'P2010', meta: { code: '40P01' } }, { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '40001', kind: 'TransactionWriteConflict' } } } }]) {
        let calls = 0;
        const db = { $transaction: async callback => { if (++calls === 1) throw failure; return callback({ committed: true }); } };
        assert.equal(await serial(db, tx => tx.committed), true); assert.equal(calls, 2);
    }
    let calls = 0;
    await assert.rejects(serial({ $transaction: async () => { calls++; throw Object.assign(new Error('constraint violation'), { code: 'P2010', meta: { code: '23505' } }); } }, () => {}), /constraint violation/);
    assert.equal(calls, 1);
    calls = 0;
    await assert.rejects(serial({ $transaction: async () => { calls++; throw Object.assign(new Error('serialization still failing'), { code: 'P2010', meta: { code: '40001' } }); } }, () => {}), /serialization still failing/);
    assert.equal(calls, 4);
});

test('missing JSON/state values cannot pass an explicit null expectation', () => {
    assert.equal(same(undefined, null), false);
    assert.equal(same({ x: null }, { x: null }), true);
    const observations = [{ responses: [{ answer: '{}' }] }];
    assert.equal(evaluateRule({ type: 'jsonValue', path: '/missing', expected: null }, observations).status, 'FAILED');
});
test('unsafe pointers and prototype keys are rejected', () => {
    assert.throws(() => setPointer({}, '/__proto__/polluted', true));
    assert.throws(() => safeJson(JSON.parse('{"constructor":{"prototype":{}}}')));
    assert.equal({}.polluted, undefined);
});
test('HTTPS policy rejects private addresses, credentials and mixed DNS answers', async () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(isPublicAddress(address), false);
    for (const url of ['http://example.com', 'https://localhost', 'https://user:password@example.com', 'https://example.com?api_key=secret']) assert.throws(() => validateEndpoint(url));
    await assert.rejects(resolvePublic('https://example.com', async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]));
    assert.equal((await resolvePublic('https://example.com', async () => [{ address: '8.8.8.8', family: 4 }])).address.address, '8.8.8.8');
});
test('adapter binds messages and distinguishes invalid, missing and unsupported metadata', async () => {
    const result = await executeTurn({ endpoint: 'https://example.com', response: { answer: '/data/text', usage: '/usage', citations: '/citations' } }, { messages: [{ role: 'user', content: 'Hello' }] }, { transport: async ({ body }) => {
        assert.equal(body.messages[0].content, 'Hello'); return { data: { text: 'Hello' }, usage: 'invalid' };
    } });
    assert.equal(result.evidenceAvailability.usage.availability, 'INVALID');
    assert.equal(result.evidenceAvailability.citations.availability, 'MISSING');
    assert.equal(result.evidenceAvailability.toolTrace.availability, 'UNSUPPORTED');
});
test('mock output validation rolls back all state transitions', () => {
    const state = { count: 0 };
    const tool = { inputSchema: { type: 'object' }, outputSchema: { type: 'number' }, branches: [{ when: [], effects: [{ op: 'increment', path: '/count', value: 1 }], result: 'wrong type' }] };
    assert.equal(executeMock(tool, {}, state).status, 'MOCK_ERROR');
    assert.deepEqual(state, { count: 0 });
    tool.branches[0].result = 1;
    assert.deepEqual(executeMock(tool, {}, state).state, { count: 1 });
});
test('missing cost remains incomplete and observed safety failures survive incomplete traces', () => {
    assert.equal(evaluateRule({ type: 'cost', max: 1, currency: 'USD' }, [{ responses: [{ answer: 'ok' }] }]).status, 'INSUFFICIENT_EVIDENCE');
    assert.equal(evaluateRule({ type: 'confirmation' }, [{ responses: [], errorCode: 'TIMEOUT', gateway: { calls: [{ status: 'CONFIRMATION_REQUIRED' }] } }]).status, 'FAILED');
});
test('judge requires consent and repairs invalid evidence references only once', async () => {
    let calls = 0;
    const provider = async () => { calls++; return { text: JSON.stringify({ score: 100, reason: 'ok', evidenceRefs: ['invented'] }) }; };
    const config = { enabled: true, judgingConsent: false, model: 'gemini-test' };
    await assert.rejects(providerJson(config, { evidence: [{ id: 'real' }] }, { provider }));
    assert.equal(calls, 0);
    await assert.rejects(providerJson({ ...config, judgingConsent: true }, { evidence: [{ id: 'real' }] }, { provider }));
    assert.equal(calls, 2);
});

test('ambiguous provider failure is not replayed as a formatting repair', async () => {
    let calls = 0;
    await assert.rejects(providerJson({ enabled: true, judgingConsent: true, model: 'gemini-test' }, { evidence: [{ id: 'real' }] }, { provider: async () => { calls++; throw new Error('network interrupted'); } }));
    assert.equal(calls, 1);
});
