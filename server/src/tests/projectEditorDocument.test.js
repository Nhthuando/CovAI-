import { jest, beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';

let root, data, serial = Promise.resolve();
const id = prefix => `${prefix}-${++data.seq}`;
const apply = (row, input) => { for (const [key, value] of Object.entries(input)) row[key] = value && typeof value === 'object' && 'increment' in value ? (row[key] || 0) + value.increment : value; return { ...row }; };
const db = {
    $executeRaw: async () => 1,
    $transaction: run => { const result = serial.then(() => run(db)); serial = result.catch(() => {}); return result; },
    user: { findUnique: async ({ where }) => ['owner', 'editor', 'viewer'].includes(where.id) ? { id: where.id, name: where.id, email: `${where.id}@example.test` } : null },
    project: {
        findFirst: async ({ where }) => where.id === 'project' && (where.OR?.[0]?.ownerId === 'owner' || data.members[where.OR?.[0]?.ownerId]) ? { ...data.project } : null,
        findUnique: async () => ({ ...data.project }),
        update: async ({ data: input }) => apply(data.project, input),
    },
    projectMember: { findUnique: async ({ where }) => data.members[where.projectId_userId.userId] ? { role: data.members[where.projectId_userId.userId] } : null },
    projectSnapshot: { findFirst: async ({ where }) => (!where.id || where.id === 'snapshot') && (!where.projectId || where.projectId === 'project') ? { id: 'snapshot', projectId: 'project', rootDir: root, storagePath: root, source: 'ZIP' } : null },
    projectFileVersion: {
        findUnique: async ({ where }) => where.id ? Object.values(data.versions).find(row => row.id === where.id) : data.versions[where.snapshotId_relativePath.relativePath] || null,
        create: async ({ data: input }) => { const row = { id: id('file'), ...input }; data.versions[row.relativePath] = row; return { ...row }; },
        update: async ({ where, data: input }) => apply(where.id ? Object.values(data.versions).find(row => row.id === where.id) : data.versions[where.snapshotId_relativePath.relativePath], input),
        upsert: async ({ where, create, update }) => { const key = where.snapshotId_relativePath.relativePath; return data.versions[key] ? apply(data.versions[key], update) : db.projectFileVersion.create({ data: create }); },
    },
    projectEditorDocument: {
        findUnique: async ({ where }) => where.id ? data.docs.find(row => row.id === where.id) : data.docs.find(row => row.snapshotId === where.snapshotId_relativePath.snapshotId && row.relativePath === where.snapshotId_relativePath.relativePath),
        findMany: async ({ where }) => data.docs.filter(row => (!where.projectId || row.projectId === where.projectId) && (!where.snapshotId || row.snapshotId === where.snapshotId) && (where.active === undefined || row.active === where.active) && (!where.id?.in || where.id.in.includes(row.id))),
        create: async ({ data: input }) => { const row = { id: id('doc'), generation: 1, revision: 0, checkpointRevision: 0, active: true, ...input }; data.docs.push(row); return { ...row }; },
        update: async ({ where, data: input }) => apply(data.docs.find(row => row.id === where.id), input),
    },
    projectEditorUpdate: {
        findUnique: async ({ where }) => data.receipts.find(row => Object.entries(where.documentId_generation_actorId_requestId).every(([key, value]) => row[key] === value)),
        create: async ({ data: input }) => { data.receipts.push(input); return input; },
    },
    projectCodeChange: { create: async ({ data: input }) => { const row = { id: id('change'), ...input }; data.changes.push(row); return row; } },
    projectMutation: {
        findUnique: async ({ where }) => data.mutations.find(row => row.requestId === where.projectId_requestId.requestId) || null,
        create: async ({ data: input }) => { const row = { id: id('mutation'), ...input }; data.mutations.push(row); return row; },
        update: async ({ where, data: input }) => apply(data.mutations.find(row => row.id === where.id), input),
    },
    projectEvent: { create: async ({ data: input }) => ({ id: id('event'), ...input }) },
};
await jest.unstable_mockModule('../config/prisma.js', () => ({ default: db }));
const { openEditorDocument, applyEditorUpdate, syncEditorDocument } = await import('../services/projectEditorDocument.service.js');
const { checkpointEditorDocuments } = await import('../services/projectEditorCheckpoint.service.js');
const { publishPreparedWorkspace } = await import('../services/projectWorkspacePublish.service.js');
const { assertEditorReplacementAllowed, assertEditorSnapshotChangeAllowed, reconcileEditorReplacement } = await import('../services/projectEditorBridge.service.js');
const { attachProjectEditorGateway, revokeEditorAccess } = await import('../realtime/projectEditor.gateway.js');
const previousFlag = process.env.PROJECT_EDITOR_ENABLED, previousSecret = process.env.JWT_SECRET;
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-editor-service-')); process.env.PROJECT_EDITOR_ENABLED = 'true'; process.env.JWT_SECRET = 'local-editor-protocol-test-only'; });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); if (previousFlag === undefined) delete process.env.PROJECT_EDITOR_ENABLED; else process.env.PROJECT_EDITOR_ENABLED = previousFlag; if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
beforeEach(async () => {
    await serial;
    data = { seq: 0, project: { id: 'project', ownerId: 'owner', workspaceRevision: 0, accessRevision: 0, eventSequence: 0 }, members: { editor: 'EDITOR', viewer: 'VIEWER' }, versions: {}, docs: [], receipts: [], changes: [], mutations: [] };
    await fs.writeFile(path.join(root, 'a.js'), 'alpha\nbeta\n');
});
const open = userId => openEditorDocument({ projectId: 'project', snapshotId: 'snapshot', path: 'a.js', userId });
const edit = (state, value, userId = 'editor', requestId = 'edit-one') => {
    const doc = new Y.Doc(); Y.applyUpdate(doc, state.stateBytes);
    const vector = Y.encodeStateVector(doc); doc.getText('content').insert(0, value);
    const packet = { documentId: state.documentId, generation: state.generation, requestId, updateBytes: Y.encodeStateAsUpdate(doc, vector), userId };
    doc.destroy(); return packet;
};
test('updates are durable, concurrent text converges and retries preserve authorship', async () => {
    const state = await open('editor');
    const a = edit(state, 'A\n', 'owner', 'a'), b = edit(state, 'B\n', 'editor', 'b');
    const [first] = await Promise.all([applyEditorUpdate(a), applyEditorUpdate(b)]);
    expect(data.docs[0].text).toContain('A\n'); expect(data.docs[0].text).toContain('B\n');
    expect((await applyEditorUpdate(a)).receipt).toEqual(first.receipt);
    expect(data.changes).toHaveLength(2); expect(data.receipts).toHaveLength(2);
    const reopened = await open('viewer'); expect(reopened.revision).toBe(2);
    const restored = new Y.Doc(); Y.applyUpdate(restored, reopened.stateBytes); expect(restored.getText('content').toString()).toBe(data.docs[0].text); restored.destroy();
    await expect(applyEditorUpdate({ ...a, updateBytes: b.updateBytes })).rejects.toMatchObject({ code: 'REQUEST_ID_REUSED' });
});
test('viewer, removed user, cross-project identity and old generation are denied', async () => {
    const state = await open('viewer');
    await expect(applyEditorUpdate(edit(state, 'bad', 'viewer'))).rejects.toMatchObject({ statusCode: 403 });
    delete data.members.editor;
    await expect(applyEditorUpdate(edit(state, 'bad'))).rejects.toMatchObject({ statusCode: 404 });
    await expect(openEditorDocument({ projectId: 'another', snapshotId: 'snapshot', path: 'a.js', userId: 'owner' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(applyEditorUpdate({ ...edit(state, 'bad', 'owner'), generation: 99 })).rejects.toMatchObject({ code: 'EDITOR_GENERATION_CHANGED' });
});
test('checkpoint saves all accepted authors and dirty external replacement is refused', async () => {
    const state = await open('editor'); await applyEditorUpdate(edit(state, 'new\n'));
    await expect(assertEditorReplacementAllowed({ tx: db, projectId: 'project', snapshotId: 'snapshot', paths: ['a.js'] })).rejects.toMatchObject({ code: 'EDITOR_DRAFT_CONFLICT' });
    const row = data.docs[0];
    const result = await checkpointEditorDocuments({ projectId: 'project', snapshotId: 'snapshot', userId: 'owner', documents: [{ documentId: row.id, generation: row.generation, revision: row.revision }], expectedWorkspaceRevision: 0 });
    expect(await fs.readFile(path.join(root, 'a.js'), 'utf8')).toBe(row.text);
    expect(row.checkpointRevision).toBe(1); expect(result.workspaceRevision).toBe(1);
    expect(data.versions['a.js'].lineAttributionJson[0].changeId).toBe(data.changes[0].id);
    expect(data.changes[0].actorId).toBe('editor');
    await applyEditorUpdate(edit(await open('editor'), 'later\n', 'editor', 'later'));
    expect(row.revision).toBeGreaterThan(row.checkpointRevision);
    await expect(assertEditorSnapshotChangeAllowed(db, 'project')).rejects.toMatchObject({ code: 'EDITOR_DRAFT_CONFLICT' });
});

test('checkpoint returns after durable publication without waiting for slow subscribers', async () => {
    const preparedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-save-notification-'));
    let release;
    const notification = new Promise(resolve => { release = resolve; });
    const emitCommittedEvent = jest.fn(() => notification);
    let timeout;
    try {
        await fs.writeFile(path.join(preparedRoot, 'a.js'), 'saved bytes\n');
        const { hashFileContent } = await import('../services/projectFileVersion.service.js');
        const saving = publishPreparedWorkspace({ projectId: 'project', snapshotId: 'snapshot', userId: 'owner',
            expectedWorkspaceRevision: 0, beforeFiles: new Map([['a.js', { sha256: hashFileContent('alpha\nbeta\n') }]]),
            preparedRoot, db, editorCheckpoint: true, emitCommittedEvent });
        const result = await Promise.race([saving, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Save waited for subscriber delivery')), 2000); })]);
        expect(result.workspaceRevision).toBe(1);
        expect(data.mutations[0].state).toBe('APPLIED');
        expect(await fs.readFile(path.join(root, 'a.js'), 'utf8')).toBe('saved bytes\n');
        expect(emitCommittedEvent).toHaveBeenCalledTimes(1);
    } finally {
        clearTimeout(timeout); release(); await serial;
        await fs.rm(preparedRoot, { recursive: true, force: true });
    }
});

test('clean external replacement changes generation and rejects delayed edits', async () => {
    const state = await open('editor');
    const content = 'replacement\n';
    await fs.writeFile(path.join(root, 'a.js'), content);
    data.versions['a.js'].sha256 = (await import('../services/projectFileVersion.service.js')).hashFileContent(content);
    data.versions['a.js'].revision++;
    await reconcileEditorReplacement({ tx: db, projectId: 'project', snapshotId: 'snapshot', actorId: 'owner', source: 'AI_APPLY', changes: [{ path: 'a.js', before: 'alpha\nbeta\n', content }] });
    expect(data.docs[0].generation).toBe(state.generation + 1);
    expect(data.docs[0].text).toBe(content);
    expect(data.changes[0].source).toBe('AI_APPLY');
    await expect(applyEditorUpdate(edit(state, 'stale'))).rejects.toMatchObject({ code: 'EDITOR_GENERATION_CHANGED' });
});

test('recreating a deleted file opens a new generation and preserves the old packet boundary', async () => {
    const state = await open('editor');
    await reconcileEditorReplacement({ tx: db, projectId: 'project', snapshotId: 'snapshot', actorId: 'owner', changes: [{ path: 'a.js', content: null }] });
    expect(data.docs[0].active).toBe(false);
    const reopened = await open('editor');
    expect(reopened.generation).toBeGreaterThan(state.generation);
    await expect(applyEditorUpdate(edit(state, 'obsolete'))).rejects.toMatchObject({ code: 'EDITOR_GENERATION_CHANGED' });
});
test('two real socket clients exchange committed updates and a downgrade blocks writing', async () => {
    const http = createServer(), server = new Server(http);
    attachProjectEditorGateway(server, { apply: async input => ({ ...await applyEditorUpdate(input), authorizedReaderIds: ['owner'], accessRevision: 0 }) });
    const clients = [];
    try {
        await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
        for (const userId of ['owner', 'editor']) {
            const client = connect(`http://127.0.0.1:${http.address().port}/editor`, { transports: ['websocket'], reconnection: false, auth: { token: jwt.sign({ userId }, process.env.JWT_SECRET) } });
            clients.push(client); await new Promise((resolve, reject) => { client.on('connect', resolve); client.on('connect_error', reject); });
        }
        const states = await Promise.all(clients.map((client, i) => client.timeout(2000).emitWithAck('editor:open', { projectId: 'project', snapshotId: 'snapshot', path: 'a.js', clientId: i + 1 })));
        expect(states.every(state => state.ok)).toBe(true);
        const peerUpdate = new Promise(resolve => clients[1].once('editor:update', resolve));
        const packet = edit(states[0], 'socket\n', 'owner');
        const receipt = await clients[0].timeout(2000).emitWithAck('editor:update', packet);
        expect(receipt.ok).toBe(true); expect((await peerUpdate).revision).toBe(receipt.revision);
        const missing = await syncEditorDocument({ documentId: states[0].documentId, generation: 1, stateVector: Y.encodeStateVector(new Y.Doc()), userId: 'editor' });
        expect(missing.revision).toBe(receipt.revision);
        const cursorDoc = new Y.Doc(); cursorDoc.clientID = 2;
        const awareness = new Awareness(cursorDoc);
        awareness.setLocalState({ user: { name: 'spoofed-name' } });
        const reads = jest.spyOn(db.project, 'findFirst');
        const cursorReceipt = await clients[1].timeout(2000).emitWithAck('editor:awareness', { documentId: states[1].documentId, generation: 1, updateBytes: encodeAwarenessUpdate(awareness, [2]) });
        expect(cursorReceipt.ok).toBe(true); expect(reads).not.toHaveBeenCalled();
        reads.mockRestore(); awareness.destroy(); cursorDoc.destroy();
        data.members.editor = 'VIEWER'; await revokeEditorAccess({ projectId: 'project', userId: 'editor' });
        const denied = await clients[1].timeout(2000).emitWithAck('editor:update', edit(states[1], 'denied', 'editor'));
        expect(denied.code).toBe('CAPABILITY_DENIED');
    } finally { clients.forEach(client => client.disconnect()); await new Promise(resolve => server.close(resolve)); }
});
