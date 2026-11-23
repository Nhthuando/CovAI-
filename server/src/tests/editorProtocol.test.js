import * as Y from 'yjs';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { memberChangeSchema, invitationCreateSchema } from '../validators/projectMember.validation.js';
import { advanceLineAttribution } from '../services/projectLineAttribution.service.js';
import { roleAllows } from '../../../shared/projectAccess.js';
import { editorBinaryBytes } from '../../../shared/editorProtocol.js';
import { enqueueEditorUpdate, compactRecoveredEditorQueue } from '../../../shared/editorBatchQueue.js';
import { rememberEditorCommit, catchUpEditorOpen } from '../services/projectEditorDeliveryCache.service.js';

test('opening a file catches commits during the open query and detects missing history', () => {
    const source = new Y.Doc(); source.getText('content').insert(0, 'base');
    const seed = Y.encodeStateAsUpdate(source), vector = Y.encodeStateVector(source);
    source.getText('content').insert(0, 'new');
    const scope = { documentId: 'catchup-fixture', projectId: 'catchup-project', generation: 1 };
    rememberEditorCommit({ ...scope, revision: 1, updateBytes: Y.encodeStateAsUpdate(source, vector) });
    const caught = catchUpEditorOpen({ ...scope, revision: 0, stateBytes: seed });
    const restored = new Y.Doc(); Y.applyUpdate(restored, caught.state.stateBytes);
    expect(restored.getText('content').toString()).toBe('newbase'); expect(caught.needsSync).toBe(false);
    rememberEditorCommit({ ...scope, revision: 3, updateBytes: Y.encodeStateAsUpdate(source) });
    expect(catchUpEditorOpen({ ...scope, revision: 0, stateBytes: seed }).needsSync).toBe(true);
    expect(catchUpEditorOpen({ ...scope, generation: 2, revision: 0, stateBytes: seed }).state.revision).toBe(0);
    source.destroy(); restored.destroy();
});

test('typing coalesces unsent updates without changing in-flight or recovered request identities', () => {
    const source = new Y.Doc(), received = new Y.Doc(), queue = [], legacy = [];
    let sequence = 0;
    const options = { merge: Y.mergeUpdates, encode: bytes => Buffer.from(bytes).toString('base64'), decode: text => Buffer.from(text, 'base64'), makeId: () => `batch-${++sequence}`, maxBytes: 100000 };
    source.on('update', bytes => enqueueEditorUpdate(queue, bytes, options));
    source.on('update', bytes => legacy.push({ requestId: `legacy-${legacy.length}`, bytes: options.encode(bytes) }));
    source.getText('content').insert(0, 'a');
    queue[0].sent = true;
    const first = { ...queue[0] };
    for (let i = 0; i < 100; i++) source.getText('content').insert(source.getText('content').length, 'b');
    expect(queue).toHaveLength(2);
    expect(queue[0]).toEqual(first);
    const recovered = JSON.parse(JSON.stringify(queue));
    for (const item of recovered) Y.applyUpdate(received, options.decode(item.bytes));
    expect(received.getText('content').toString()).toBe(source.getText('content').toString());
    expect(recovered[0].requestId).toBe(first.requestId);
    const compact = compactRecoveredEditorQueue(recovered, options);
    expect(compact[0]).toEqual(first);
    expect(compact).toHaveLength(2);
    const upgraded = compactRecoveredEditorQueue(legacy, options);
    expect(upgraded).toHaveLength(2); expect(upgraded[0].requestId).toBe('legacy-0');
    const restoredLegacy = new Y.Doc();
    for (const item of upgraded) Y.applyUpdate(restoredLegacy, options.decode(item.bytes));
    expect(restoredLegacy.getText('content').toString()).toBe(source.getText('content').toString());
    restoredLegacy.destroy();
    queue.shift(); expect(queue).toHaveLength(1); expect(queue[0].requestId).not.toBe(first.requestId);
    source.destroy(); received.destroy();
});

test('browser ArrayBuffer and sliced binary views decode the same Yjs state', () => {
    const seed = new Y.Doc(); seed.getText('content').insert(0, '<html>shared</html>');
    const bytes = Y.encodeStateAsUpdate(seed);
    const padded = new Uint8Array(bytes.length + 6); padded.set(bytes, 3);
    for (const input of [bytes, bytes.slice().buffer, new DataView(padded.buffer, 3, bytes.length), Buffer.from(bytes)]) {
        const restored = new Y.Doc();
        Y.applyUpdate(restored, editorBinaryBytes(input));
        expect(restored.getText('content').toString()).toBe('<html>shared</html>');
        restored.destroy();
    }
    expect(() => editorBinaryBytes({ data: [...bytes] })).toThrow('Invalid editor binary message');
    seed.destroy();
});

test('concurrent edits converge, replay is harmless and undo stays local', () => {
    const seed = new Y.Doc(); seed.getText('content').insert(0, 'ab');
    const a = new Y.Doc(), b = new Y.Doc();
    for (const doc of [a, b]) Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
    const undo = new Y.UndoManager(a.getText('content'), { trackedOrigins: new Set(['local']) });
    a.transact(() => a.getText('content').insert(1, 'A'), 'local');
    b.getText('content').insert(1, 'B');
    const ua = Y.encodeStateAsUpdate(a), ub = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, ub, 'remote'); Y.applyUpdate(b, ua, 'remote'); Y.applyUpdate(b, ua, 'remote');
    expect(a.getText('content').toString()).toBe(b.getText('content').toString());
    undo.undo(); expect(a.getText('content').toString()).toContain('B'); expect(a.getText('content').toString()).not.toContain('A');
    undo.destroy(); for (const doc of [seed, a, b]) doc.destroy();
});
test('job roles remain separate from access and legacy requests stay valid', () => {
    expect(memberChangeSchema.safeParse({ disciplineRole: 'TECH_LEAD', expectedRevision: 2 }).success).toBe(true);
    expect(memberChangeSchema.safeParse({ expectedRevision: 2 }).success).toBe(false);
    expect(invitationCreateSchema.safeParse({ email: 'dev@example.test', role: 'VIEWER' }).success).toBe(true);
    expect(invitationCreateSchema.safeParse({ email: 'dev@example.test', role: 'VIEWER', disciplineRole: 'ROOT' }).success).toBe(false);
    expect(roleAllows('VIEWER', 'members.manage')).toBe(false);
});
test('line attribution shifts unchanged authors and only changes edited lines', () => {
    const original = [{ start: 1, end: 2, changeId: 'a' }];
    const ranges = advanceLineAttribution({ before: 'alpha\nbeta\n', after: 'new\nalpha\nbeta\n', ranges: original, changeId: 'b' });
    expect(ranges).toEqual([{ start: 1, end: 1, changeId: 'b' }, { start: 2, end: 3, changeId: 'a' }]);
    expect(advanceLineAttribution({ before: 'alpha\nbeta\n', after: 'alpha\nbeta\n', ranges: original, changeId: 'c' })).toBe(original);
    expect(advanceLineAttribution({ before: 'alpha\nbeta\n', after: 'alpha\nchanged\n', ranges: original, changeId: 'c' })).toEqual([{ start: 1, end: 1, changeId: 'a' }, { start: 2, end: 2, changeId: 'c' }]);
});
test('Socket.IO carries binary updates and durable receipt acknowledgments', async () => {
    const http = createServer(), server = new Server(http);
    let client;
    try {
        server.on('connection', socket => socket.on('update', (bytes, ack) => ack({ bytes, durable: true })));
        await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
        client = connect(`http://127.0.0.1:${http.address().port}`, { transports: ['websocket'], reconnection: false });
        await new Promise((resolve, reject) => { client.on('connect', resolve); client.on('connect_error', reject); });
        const result = await client.timeout(2000).emitWithAck('update', new Uint8Array([1, 2, 3]));
        expect([...result.bytes]).toEqual([1, 2, 3]); expect(result.durable).toBe(true);
    } finally { client?.disconnect(); await new Promise(resolve => server.close(resolve)); }
});
