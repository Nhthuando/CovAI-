import jwt from 'jsonwebtoken';
import { resolveProjectAccess, withProjectGuard } from './projectAccess.service.js';
import { closeProjectStreams } from './projectStreamRegistry.service.js';

const projectSockets = new Map();
const identity = socket => {
    const claims = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
    if (typeof claims.userId !== 'string' || !claims.userId) throw new Error('Missing socket identity');
    return claims.userId;
};

export const subscribeToProjectRoom = async (socket, {projectId} = {}) => {
    try {
        const userId = identity(socket);
        if (typeof projectId !== 'string' || !projectId || projectId.length > 200) return {ok:false,code:'PROJECT_NOT_FOUND'};
        return await withProjectGuard({projectId,userId,capability:'project.read'}, async (_tx, access) => {
            await socket.join(`project:${projectId}`);
            socket.data ||= {};
            socket.data.projectUserId = userId;
            if (!projectSockets.has(projectId)) projectSockets.set(projectId, new Set());
            projectSockets.get(projectId).add(socket);
            return {ok:true,projectId,role:access.role,accessRevision:access.project.accessRevision};
        });
    } catch (error) { return {ok:false,code:error.code || 'PROJECT_NOT_FOUND'}; }
};

export const unsubscribeFromProjectRoom = async (socket, {projectId} = {}) => {
    if (typeof projectId !== 'string') return;
    await socket.leave(`project:${projectId}`);
    const sockets = projectSockets.get(projectId);
    sockets?.delete(socket);
    if (!sockets?.size) projectSockets.delete(projectId);
};

export const revokeProjectSubscriptions = async ({projectId,userId,accessRevision}) => {
    let stillCanRead = false;
    try { await resolveProjectAccess({projectId,userId,capability:'project.read'}); stillCanRead = true; }
    catch { /* Missing member/disabled collaboration: revoke fail closed. */ }
    for (const socket of [...(projectSockets.get(projectId) || [])]) {
        if (socket.data?.projectUserId !== userId) continue;
        socket.emit('project:access-changed', {projectId,accessRevision,revoked:!stillCanRead});
        socket.emit('project_access_changed', {projectId,accessRevision,revoked:!stillCanRead});
        if (!stillCanRead) await unsubscribeFromProjectRoom(socket,{projectId});
    }
    if (!stillCanRead) closeProjectStreams({projectId,userId,accessRevision});
};

export const deliverToProjectSubscribers = async event => {
    // Only persisted invalidation metadata belongs on this channel. Full chat,
    // source, logs and provider responses are refetched through scoped HTTP.
    const safe = {id:event.id,projectId:event.projectId,sequence:event.sequence,type:event.type,
        actorId:event.actorId,resourceId:event.resourceId,revision:event.revision,createdAt:event.createdAt};
    await Promise.all([...projectSockets.get(event.projectId) || []].map(async socket => {
        try {
            await withProjectGuard({projectId:event.projectId,userId:socket.data?.projectUserId,capability:'project.read'}, async () => {
                socket.emit('project:event',safe);
                socket.emit('project_event',safe);
            });
        } catch {
            await unsubscribeFromProjectRoom(socket,{projectId:event.projectId});
        }
    }));
};

export const deliverScopedProjectTransport = async ({projectId,event,payload}) => {
    await Promise.all([...(projectSockets.get(projectId) || [])].map(async socket=>{
        try {
            await withProjectGuard({projectId,userId:socket.data?.projectUserId,capability:'project.read'},async()=>socket.emit(event,payload));
        } catch { await unsubscribeFromProjectRoom(socket,{projectId}); }
    }));
};

export const attachProjectSubscriptions = io => {
    io.on('connection', socket => {
        const subscribe = async (input, ack) => {
            const result = await subscribeToProjectRoom(socket,input);
            if (typeof ack === 'function') ack(result);
        };
        const unsubscribe = input => { void unsubscribeFromProjectRoom(socket,input); };
        socket.on('project:subscribe',subscribe);
        socket.on('subscribe_project',subscribe);
        socket.on('project:unsubscribe',unsubscribe);
        socket.on('unsubscribe_project',unsubscribe);
        socket.on('disconnect', () => {
            for (const [projectId,sockets] of projectSockets) {
                sockets.delete(socket);
                if (!sockets.size) projectSockets.delete(projectId);
            }
        });
    });
};
