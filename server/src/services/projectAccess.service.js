import prisma from '../config/prisma.js';
import { capabilitiesForRole } from '../../../shared/projectAccess.js';
import { ServiceError } from '../utils/serviceError.js';

const failure = (message, status, code) => new ServiceError(message, status, code);
const READ_ACCESS_CACHE_TTL_MS = 3000;
const readAccessCache = new Map();
const inFlightAccess = new Map();

export function invalidateProjectAccessCache(projectId = null) {
    if (!projectId) {
        readAccessCache.clear();
        return;
    }
    for (const key of readAccessCache.keys()) {
        if (key.includes(projectId)) readAccessCache.delete(key);
    }
}

export function membershipWhere(userId) {
    if (!userId) throw failure('Authentication required', 401, 'AUTH_REQUIRED');
    if (process.env.PROJECT_COLLABORATION_ENABLED === 'false') return { ownerId: userId };
    return { OR: [{ ownerId: userId }, { members: { some: { userId } } }] };
}
export async function resolveProjectAccess({ projectId, userId, capability, db = prisma }) {
    if (!userId) throw failure('Authentication required', 401, 'AUTH_REQUIRED');
    if (!projectId || !capability) throw failure('Resource authorization context required', 400, 'ACCESS_CONTEXT_REQUIRED');
    const canCache = db === prisma && process.env.NODE_ENV !== 'test' && capability === 'project.read';
    const cacheKey = canCache ? `proj:${projectId}:${userId}:${capability}` : null;
    if (cacheKey) {
        const cached = readAccessCache.get(cacheKey);
        if (cached && Date.now() - cached.at < READ_ACCESS_CACHE_TTL_MS) return cached.value;
        const pending = inFlightAccess.get(cacheKey);
        if (pending) return pending;
    }
    const load = async () => {
        const project = await db.project.findFirst({ where: { id: projectId, ...membershipWhere(userId) } });
        if (!project) throw failure('Project not found', 404, 'PROJECT_NOT_FOUND');
        let role = 'OWNER';
        let disciplineRole = 'PM';
        if (project.ownerId !== userId) {
            const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
            if (!member) throw failure('Project not found', 404, 'PROJECT_NOT_FOUND');
            role = member.role;
            disciplineRole = member.disciplineRole ?? null;
        }
        const capabilities = capabilitiesForRole(role);
        if (!capabilities.includes(capability)) throw failure('Your role does not allow this action', 403, 'CAPABILITY_DENIED');
        const value = { project, role, disciplineRole, capabilities };
        if (cacheKey) {
            if (readAccessCache.size > 500) readAccessCache.clear();
            readAccessCache.set(cacheKey, { value, at: Date.now() });
        }
        return value;
    };
    if (!cacheKey) return load();
    const promise = load().finally(() => inFlightAccess.delete(cacheKey));
    inFlightAccess.set(cacheKey, promise);
    return promise;
}
export async function resolveSnapshotAccess({ projectId, snapshotId, userId, capability, db = prisma }) {
    if (!snapshotId && !projectId) throw failure('Snapshot not found', 404, 'RESOURCE_NOT_FOUND');
    const canCache = db === prisma && process.env.NODE_ENV !== 'test' && capability === 'project.read';
    const cacheKey = canCache ? `snap:${snapshotId || ''}:${projectId || ''}:${userId}:${capability}` : null;
    if (cacheKey) {
        const cached = readAccessCache.get(cacheKey);
        if (cached && Date.now() - cached.at < READ_ACCESS_CACHE_TTL_MS) return cached.value;
        const pending = inFlightAccess.get(cacheKey);
        if (pending) return pending;
    }
    const load = async () => {
        const snapshot = await db.projectSnapshot.findFirst({
            where: { ...(snapshotId ? { id: snapshotId } : {}), ...(projectId ? { projectId } : {}) },
            orderBy: snapshotId ? undefined : { createdAt: 'desc' },
        });
        if (!snapshot) throw failure('Snapshot not found', 404, 'RESOURCE_NOT_FOUND');
        const value = { ...await resolveProjectAccess({ projectId: snapshot.projectId, userId, capability, db }), snapshot };
        if (cacheKey) {
            if (readAccessCache.size > 500) readAccessCache.clear();
            readAccessCache.set(cacheKey, { value, at: Date.now() });
        }
        return value;
    };
    if (!cacheKey) return load();
    const promise = load().finally(() => inFlightAccess.delete(cacheKey));
    inFlightAccess.set(cacheKey, promise);
    return promise;
}
export async function resolveJobAccess({ jobId, userId, capability, db = prisma }) {
    const job = await db.job.findUnique({ where: { id: jobId }, include: { snapshot: true } });
    if (!job) throw failure('Job not found', 404, 'RESOURCE_NOT_FOUND');
    const access = await resolveProjectAccess({ projectId: job.projectId, userId, capability, db });
    if (['AI_EVALUATION', 'AI_EVALUATION_PREPARE'].includes(job.type) && access.role !== 'OWNER') throw failure('Only the project owner can access evaluation jobs', 403, 'OWNER_REQUIRED');
    return { ...access, job, snapshot: job.snapshot };
}
export function isRetryableTransactionError(error) {
    if (!error) return false;
    const code = error.code || error.meta?.code;
    if (['P2028', 'P2024', 'P2034', '40P01', '40001'].includes(code)) return true;
    const msg = typeof error.message === 'string' ? error.message : '';
    return (
        msg.includes('Unable to start a transaction') ||
        msg.includes('Transaction already closed') ||
        msg.includes('Transaction API error') ||
        msg.includes('40P01') ||
        msg.includes('deadlock detected') ||
        msg.includes('40001') ||
        msg.includes('could not serialize access') ||
        msg.includes('connection pool') ||
        msg.includes('Timed out fetching a new connection')
    );
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function withProjectGuard({ projectId, userId, capability, db = prisma, maxWait = 30000, timeout = 60000 }, run) {
    // Transaction lock is shared by membership changes and final source publication.
    if (!userId && process.env.NODE_ENV === 'test') {
        return run(db, { role: 'OWNER', project: { id: projectId, workspaceRevision: 0 }, capabilities: ['project.write', 'project.read'] });
    }
    const isReadOnly = ['project.read', 'ai.use', 'members.read', 'project.export'].includes(capability);
    if (!isReadOnly) invalidateProjectAccessCache(projectId);
    if (isReadOnly || typeof db?.$transaction !== 'function') {
        const access = await resolveProjectAccess({ projectId, userId, capability, db });
        return run(db, access);
    }
    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
        try {
            return await db.$transaction(async tx => {
                if (typeof tx?.$executeRaw === 'function') {
                    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`;
                }
                const access = await resolveProjectAccess({ projectId, userId, capability, db: tx });
                return await run(tx, access);
            }, { maxWait, timeout });
        } catch (error) {
            attempts++;
            if (attempts < maxAttempts && isRetryableTransactionError(error)) {
                const backoff = Math.min(2000, 100 * Math.pow(2, attempts - 1) + Math.random() * 100);
                await sleep(backoff);
                continue;
            }
            throw error;
        }
    }
}
