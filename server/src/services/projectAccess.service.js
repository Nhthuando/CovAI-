import prisma from '../config/prisma.js';
import { capabilitiesForRole } from '../../../shared/projectAccess.js';
import { ServiceError } from '../utils/serviceError.js';

const failure = (message, status, code) => new ServiceError(message, status, code);
export function membershipWhere(userId) {
    if (!userId) throw failure('Authentication required', 401, 'AUTH_REQUIRED');
    if (process.env.PROJECT_COLLABORATION_ENABLED === 'false') return { ownerId: userId };
    return { OR: [{ ownerId: userId }, { members: { some: { userId } } }] };
}
export async function resolveProjectAccess({ projectId, userId, capability, db = prisma }) {
    if (!userId) throw failure('Authentication required', 401, 'AUTH_REQUIRED');
    if (!projectId || !capability) throw failure('Resource authorization context required', 400, 'ACCESS_CONTEXT_REQUIRED');
    const project = await db.project.findFirst({ where: { id: projectId, ...membershipWhere(userId) } });
    if (!project) throw failure('Project not found', 404, 'PROJECT_NOT_FOUND');
    let role = 'OWNER';
    if (project.ownerId !== userId) {
        const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
        if (!member) throw failure('Project not found', 404, 'PROJECT_NOT_FOUND');
        role = member.role;
    }
    const capabilities = capabilitiesForRole(role);
    if (!capabilities.includes(capability)) throw failure('Your role does not allow this action', 403, 'CAPABILITY_DENIED');
    return { project, role, capabilities };
}
export async function resolveSnapshotAccess({ projectId, snapshotId, userId, capability, db = prisma }) {
    if (!snapshotId && !projectId) throw failure('Snapshot not found', 404, 'RESOURCE_NOT_FOUND');
    const snapshot = await db.projectSnapshot.findFirst({
        where: { ...(snapshotId ? { id: snapshotId } : {}), ...(projectId ? { projectId } : {}) },
        orderBy: snapshotId ? undefined : { createdAt: 'desc' },
    });
    if (!snapshot) throw failure('Snapshot not found', 404, 'RESOURCE_NOT_FOUND');
    return { ...await resolveProjectAccess({ projectId: snapshot.projectId, userId, capability, db }), snapshot };
}
export async function resolveJobAccess({ jobId, userId, capability, db = prisma }) {
    const job = await db.job.findUnique({ where: { id: jobId }, include: { snapshot: true } });
    if (!job) throw failure('Job not found', 404, 'RESOURCE_NOT_FOUND');
    return { ...await resolveProjectAccess({ projectId: job.projectId, userId, capability, db }), job, snapshot: job.snapshot };
}
export async function withProjectGuard({ projectId, userId, capability, db = prisma, maxWait = 30000, timeout = 60000 }, run) {
    // Transaction lock is shared by membership changes and final source publication.
    // Never automatically retry a callback that may have filesystem side effects.
    return db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`;
        const access = await resolveProjectAccess({ projectId, userId, capability, db: tx });
        return run(tx, access);
    }, { maxWait, timeout });
}
