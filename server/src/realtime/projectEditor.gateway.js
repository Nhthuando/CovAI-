import jwt from 'jsonwebtoken';
// Native VarUint decoding (eliminates hard external dependency on lib0)
const decoding = {
    createDecoder: uint8Array => ({ arr: uint8Array, pos: 0 }),
    readVarUint: decoder => {
        let num = 0, mult = 1;
        const len = decoder.arr.length;
        while (decoder.pos < len) {
            const r = decoder.arr[decoder.pos++];
            num = num + (r & 127) * mult;
            mult *= 128;
            if (r < 128) return num;
            if (num > Number.MAX_SAFE_INTEGER) throw new Error('Integer overflow');
        }
        return num;
    }
};
import { modifyAwarenessUpdate } from 'y-protocols/awareness';
import prisma from '../config/prisma.js';
import { withProjectGuard, resolveProjectAccess } from '../services/projectAccess.service.js';
import { openEditorDocument, applyEditorUpdate, syncEditorDocument } from '../services/projectEditorDocument.service.js';
import { EDITOR_LIMITS } from '../../../shared/editorProtocol.js';
import * as Y from 'yjs';
import { rememberEditorCommit, catchUpEditorOpen } from '../services/projectEditorDeliveryCache.service.js';

let namespace;
const colors = ['#a78bfa', '#38bdf8', '#fbbf24', '#34d399', '#fb7185', '#f472b6'];
const identity = socket => {
    let claims;
    try { claims = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET); }
    catch { throw Object.assign(new Error('Authentication required. Sign in again.'), { statusCode: 401, code: 'AUTH_REQUIRED' }); }
    if (typeof claims.userId !== 'string' || !claims.userId) throw new Error('Invalid identity');
    return claims.userId;
};
const errorDto = error => ({ ok: false, code: error.code || 'EDITOR_ERROR', message: error.statusCode ? error.message : 'The editor request could not be completed.' });
const projectRoom = projectId => `editor:project:${projectId}`;
const projectPeers = projectId => [...(namespace?.adapter.rooms.get(projectRoom(projectId)) || [])].map(id => namespace.sockets.get(id)).filter(Boolean);
function presence(projectId) {
    return projectPeers(projectId).flatMap(socket => [...socket.data.documents.values()].filter(doc => doc.projectId === projectId && Date.now() - socket.data.seen < EDITOR_LIMITS.expiryMs)
        .map(doc => ({ documentId: doc.documentId, clientId: doc.clientId, userId: socket.data.userId, name: socket.data.name, color: socket.data.color, disciplineRole: doc.disciplineRole, path: doc.path })));
}
async function deliver(projectId, event, data, predicate = () => true) {
    const candidates = projectPeers(projectId).filter(socket => predicate(socket));
    if (!candidates.length) return;
    if (prisma.$queryRaw) {
        const current = candidates.filter(socket => { try { identity(socket); return true; } catch { socket.disconnect(true); return false; } });
        if (!current.length) return;
        await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${projectId}, 0))`;
            const rows = await tx.$queryRaw`
                SELECT readers.id, p."accessRevision" FROM "Project" p CROSS JOIN unnest(${[...new Set(current.map(socket => socket.data.userId))]}::text[]) AS readers(id)
                WHERE p.id = ${projectId} AND (p."ownerId" = readers.id OR (${process.env.PROJECT_COLLABORATION_ENABLED !== 'false'} AND EXISTS (
                    SELECT 1 FROM "ProjectMember" m WHERE m."projectId" = p.id AND m."userId" = readers.id AND m.role IN ('EDITOR', 'VIEWER'))))`;
            const allowed = new Set(rows.map(row => row.id));
            for (const socket of current) {
                if (allowed.has(socket.data.userId) && predicate(socket)) {
                    for (const doc of socket.data.documents.values()) if (doc.projectId === projectId) doc.accessRevision = rows.find(row => row.id === socket.data.userId)?.accessRevision;
                    socket.emit(event, data);
                }
                else { socket.emit('editor:access-changed', { projectId, revoked: true }); socket.disconnect(true); }
            }
        }, { maxWait: 10000, timeout: 15000 });
        return;
    }
    await Promise.all(candidates.map(async socket => {
        if (![...socket.data.documents.values()].some(doc => doc.projectId === projectId) || !predicate(socket)) return;
        try { await withProjectGuard({ projectId, userId: identity(socket), capability: 'project.read' }, async (_tx, access) => {
            for (const doc of socket.data.documents.values()) if (doc.projectId === projectId) doc.accessRevision = access.project.accessRevision;
            socket.emit(event, data);
        }); }
        catch { socket.emit('editor:access-changed', { projectId, revoked: true }); socket.disconnect(true); }
    }));
}
function deliverEphemeral(projectId, event, data, predicate = () => true) {
    for (const socket of projectPeers(projectId)) {
        if (socket.data.suspendedProjects?.has(projectId) || ![...socket.data.documents.values()].some(doc => doc.projectId === projectId) || !predicate(socket)) continue;
        try { identity(socket); socket.volatile.emit(event, data); } catch { socket.disconnect(true); }
    }
}
const broadcastPresence = projectId => deliverEphemeral(projectId, 'editor:presence', { projectId, users: presence(projectId) });
export async function revokeEditorAccess({ projectId, userId }) {
    for (const socket of [...(namespace?.sockets.values() || [])]) {
        if (socket.data.userId !== userId) continue;
        socket.data.suspendedProjects.add(projectId);
        let access;
        try { access = await resolveProjectAccess({ projectId, userId, capability: 'project.read' }); } catch { /* revoked */ }
        socket.emit('editor:access-changed', { projectId, revoked: !access, capabilities: access?.capabilities || [] });
        if (!access) socket.disconnect(true);
        else {
            for (const doc of socket.data.documents.values()) if (doc.projectId === projectId) { doc.capabilities = access.capabilities; doc.disciplineRole = access.disciplineRole; doc.accessRevision = access.project.accessRevision; }
            socket.data.suspendedProjects.delete(projectId);
        }
    }
    await broadcastPresence(projectId);
}
export async function notifyEditorProjectChange(projectId) {
    for (const socket of projectPeers(projectId)) {
        for (const doc of [...socket.data.documents.values()].filter(value => value.projectId === projectId)) {
            try {
                await withProjectGuard({ projectId, userId: identity(socket), capability: 'project.read' }, async tx => {
                    const row = await tx.projectEditorDocument.findUnique({ where: { id: doc.documentId } });
                    const latest = await tx.projectSnapshot.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
                    if (!row?.active || row.generation !== doc.generation || latest?.id !== doc.snapshotId) socket.emit('editor:reset', { documentId: doc.documentId, path: row?.relativePath, generation: row?.generation, closed: !row?.active || latest?.id !== doc.snapshotId });
                    else socket.emit('editor:saved', { documentId: doc.documentId, checkpointRevision: row.checkpointRevision, revision: row.revision });
                });
            } catch { socket.emit('editor:access-changed', { projectId, revoked: true }); socket.disconnect(true); }
        }
    }
}
export function attachProjectEditorGateway(io, services = {}) {
    namespace = io.of('/editor');
    const open = services.open || openEditorDocument, apply = services.apply || applyEditorUpdate, sync = services.sync || syncEditorDocument;
    namespace.use(async (socket, next) => {
        try {
            const userId = identity(socket), user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
            if (!user) throw new Error('Missing account');
            socket.data = { userId, name: user.name || user.email, color: colors[[...userId].reduce((n, char) => n + char.charCodeAt(0), 0) % colors.length], documents: new Map(), suspendedProjects: new Set(), seen: Date.now(), rates: new Map() };
            next();
        } catch { next(new Error('Authentication required.')); }
    });
    namespace.on('connection', socket => {
        const bind = (event, run, limit = 20) => socket.on(event, async (input = {}, ack) => {
            try {
                identity(socket);
                const second = Math.floor(Date.now() / 1000), rate = socket.data.rates.get(event);
                const count = rate?.second === second ? rate.count + 1 : 1;
                socket.data.rates.set(event, { second, count }); socket.data.seen = Date.now();
                if (count > limit) throw Object.assign(new Error('Too many editor updates. Please wait.'), { code: 'EDITOR_RATE_LIMIT', statusCode: 429 });
                const result = await run(input);
                if (typeof ack === 'function') ack({ ok: true, ...result });
            } catch (error) { if (typeof ack === 'function') ack(errorDto(error)); else socket.emit('editor:error', errorDto(error)); }
        });
        const entry = input => {
            const doc = socket.data.documents.get(input.documentId);
            if (!doc || doc.generation !== input.generation) throw Object.assign(new Error('Open the file again before editing.'), { statusCode: 409, code: 'EDITOR_GENERATION_CHANGED' });
            return doc;
        };
        bind('editor:open', async input => {
            const reopening = [...socket.data.documents.values()].some(doc => doc.projectId === input.projectId && doc.snapshotId === input.snapshotId && doc.path === input.path);
            if (!Number.isSafeInteger(input.clientId) || input.clientId < 0 || input.clientId > 4294967295 || (socket.data.documents.size >= 10 && !reopening)) throw Object.assign(new Error('Invalid editor session.'), { statusCode: 400 });
            const caughtUp = catchUpEditorOpen(await open({ ...input, userId: socket.data.userId }));
            let state = caughtUp.state;
            if (caughtUp.needsSync) {
                const missing = await sync({ documentId: state.documentId, generation: state.generation, stateVector: Y.encodeStateVectorFromUpdate(state.stateBytes), userId: socket.data.userId });
                state = { ...state, stateBytes: Y.mergeUpdates([state.stateBytes, missing.updateBytes]), revision: missing.revision, contentHash: missing.contentHash };
            }
            for (const other of projectPeers(state.projectId)) {
                if (other !== socket && other.data.documents.get(state.documentId)?.clientId === input.clientId) throw Object.assign(new Error('This editor identity is already connected. Reopen the file.'), { code: 'EDITOR_CLIENT_ID_CONFLICT', statusCode: 409 });
            }
            socket.data.documents.set(state.documentId, { ...state, stateBytes: undefined, clientId: input.clientId });
            await socket.join(projectRoom(state.projectId));
            void broadcastPresence(state.projectId);
            for (const other of projectPeers(state.projectId)) {
                const peer = other.data.documents.get(state.documentId);
                if (other !== socket && peer?.awareness) socket.emit('editor:awareness', { documentId: state.documentId, generation: state.generation, updateBytes: peer.awareness });
            }
            return state;
        });
        bind('editor:update', async input => {
            const doc = entry(input);
            const readerIds = [...new Set(projectPeers(doc.projectId).filter(peer => peer.data.documents.get(doc.documentId)?.generation === doc.generation).map(peer => peer.data.userId))];
            const result = await apply({ ...input, projectId: doc.projectId, readerIds, userId: socket.data.userId });
            const payload = { documentId: doc.documentId, generation: doc.generation, ...result.receipt, updateBytes: result.committedUpdate };
            if (result.changed) rememberEditorCommit({ ...payload, projectId: doc.projectId });
            if (result.changed && result.authorizedReaderIds) {
                const readers = new Set(result.authorizedReaderIds);
                const unverified = new Set();
                for (const peer of projectPeers(doc.projectId)) {
                    const scope = peer.data.documents.get(doc.documentId);
                    if (peer === socket || peer.data.suspendedProjects.has(doc.projectId) || scope?.generation !== doc.generation) continue;
                    // A peer opening during this write was absent from the SQL reader
                    // set. Recheck it below; cached scope alone cannot authorize source.
                    if (readers.has(peer.data.userId)) { try { identity(peer); peer.emit('editor:update', payload); } catch { peer.disconnect(true); } }
                    else unverified.add(peer.id);
                }
                if (unverified.size) void deliver(doc.projectId, 'editor:update', payload, peer => unverified.has(peer.id)).catch(() => deliverEphemeral(doc.projectId, 'editor:sync-required', { documentId: doc.documentId, generation: doc.generation }));
            } else if (result.changed) void deliver(doc.projectId, 'editor:update', payload, peer => peer !== socket && peer.data.documents.get(doc.documentId)?.generation === doc.generation).catch(() => {
                deliverEphemeral(doc.projectId, 'editor:sync-required', { documentId: doc.documentId, generation: doc.generation });
            });
            return result.receipt;
        }, 60);
        bind('editor:sync', input => { entry(input); return sync({ ...input, userId: socket.data.userId }); });
        bind('editor:awareness', async input => {
            const doc = entry(input);
            if (socket.data.suspendedProjects.has(doc.projectId)) return {};
            if (!(input.updateBytes instanceof Uint8Array) || input.updateBytes.length > EDITOR_LIMITS.awarenessBytes) throw Object.assign(new Error('Invalid cursor update.'), { statusCode: 400 });
            const decoder = decoding.createDecoder(input.updateBytes), count = decoding.readVarUint(decoder);
            if (count !== 1 || decoding.readVarUint(decoder) !== doc.clientId) throw Object.assign(new Error('Cursor identity does not match the session.'), { statusCode: 403 });
            const validPosition = value => value && value.tname === 'content' && (!value.item || (Number.isSafeInteger(value.item.client) && Number.isSafeInteger(value.item.clock))) && (!value.type || (Number.isSafeInteger(value.type.client) && Number.isSafeInteger(value.type.clock))) && (value.assoc === undefined || Number.isSafeInteger(value.assoc));
            const bytes = modifyAwarenessUpdate(input.updateBytes, state => state === null ? null : ({ selection: validPosition(state.selection?.anchor) && validPosition(state.selection?.head) ? state.selection : null, user: { name: socket.data.name, color: socket.data.color } }));
            doc.awareness = bytes;
            deliverEphemeral(doc.projectId, 'editor:awareness', { documentId: doc.documentId, generation: doc.generation, updateBytes: bytes }, peer => peer !== socket && peer.data.documents.get(doc.documentId)?.generation === doc.generation);
            return {};
        }, 100);
        bind('editor:presence', async () => {
            for (const projectId of new Set([...socket.data.documents.values()].map(doc => doc.projectId))) {
                try {
                    const access = await resolveProjectAccess({ projectId, userId: socket.data.userId, capability: 'project.read' });
                    for (const doc of socket.data.documents.values()) if (doc.projectId === projectId) doc.accessRevision = access.project.accessRevision;
                    broadcastPresence(projectId);
                }
                catch { socket.emit('editor:access-changed', { projectId, revoked: true }); socket.disconnect(true); }
            }
            return {};
        });
        bind('editor:leave', async input => {
            const doc = socket.data.documents.get(input.documentId); socket.data.documents.delete(input.documentId);
            if (doc && ![...socket.data.documents.values()].some(value => value.projectId === doc.projectId)) await socket.leave(projectRoom(doc.projectId));
            if (doc) { deliverEphemeral(doc.projectId, 'editor:peer-left', { documentId: doc.documentId, clientId: doc.clientId }); broadcastPresence(doc.projectId); }
            return {};
        });
        socket.on('disconnect', () => {
            for (const doc of socket.data.documents.values()) {
                deliverEphemeral(doc.projectId, 'editor:peer-left', { documentId: doc.documentId, clientId: doc.clientId }); broadcastPresence(doc.projectId);
            }
        });
    });
    const timer = setInterval(() => { for (const socket of namespace.sockets.values()) if (Date.now() - socket.data.seen > EDITOR_LIMITS.expiryMs) socket.disconnect(true); }, EDITOR_LIMITS.heartbeatMs);
    timer.unref(); io.engine.on('close', () => clearInterval(timer));
}
