import prisma from '../config/prisma.js';
import { resolveProjectAccess, withProjectGuard } from './projectAccess.service.js';
import { publishProjectEvent, deliverProjectEvent } from './projectEvent.service.js';
import { revokeProjectSubscriptions } from './projectSubscription.service.js';
import { ServiceError } from '../utils/serviceError.js';

const userProjection = { id: true, name: true, email: true, avatarUrl: true };
const conflict = () => new ServiceError('Member changed; reload and try again', 409, 'MEMBERSHIP_CHANGED');
export async function listProjectMembers({ projectId, userId, cursor, limit = 50 }) {
    const { project } = await resolveProjectAccess({ projectId, userId, capability: 'members.read' });
    const [owner, rows] = await Promise.all([
        prisma.user.findUnique({ where: { id: project.ownerId }, select: userProjection }),
        prisma.projectMember.findMany({ where: { projectId }, include: { user: { select: userProjection } }, orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }] }),
    ]);
    const all = [{ id: `owner:${owner.id}`, userId: owner.id, user: owner, role: 'OWNER', revision: 0 }, ...rows];
    const start = cursor ? all.findIndex(row => row.id === cursor) + 1 : 0;
    if (cursor && start === 0) throw new ServiceError('Invalid cursor', 400, 'INVALID_CURSOR');
    return { members: all.slice(start, start + limit), total: all.length, nextCursor: start + limit < all.length ? all[start + limit - 1].id : null, accessRevision: project.accessRevision };
}
async function changeMember({ projectId, userId, memberId, role, expectedRevision, leave = false }) {
    let event, affectedUserId;
    const result = await withProjectGuard({ projectId, userId, capability: leave ? 'project.read' : 'members.manage' }, async (tx, access) => {
        if (memberId?.startsWith('owner:') || (leave && access.role === 'OWNER')) throw new ServiceError('Project owner cannot leave or change their own role', 403, 'OWNER_REQUIRED');
        const row = leave
            ? await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } })
            : await tx.projectMember.findFirst({ where: { id: memberId, projectId } });
        if (!row || (!leave && row.revision !== expectedRevision)) throw conflict();
        affectedUserId = row.userId;
        if (role) await tx.projectMember.update({ where: { id: row.id }, data: { role, revision: { increment: 1 } } });
        else await tx.projectMember.delete({ where: { id: row.id } });
        const project = await tx.project.update({ where: { id: projectId }, data: { accessRevision: { increment: 1 } } });
        event = await publishProjectEvent({ tx, projectId, actorId: userId, type: role ? 'member.updated' : 'member.removed', resourceId: row.userId, revision: project.accessRevision });
        return { accessRevision: project.accessRevision };
    });
    await revokeProjectSubscriptions({ projectId, userId: affectedUserId, accessRevision: result.accessRevision });
    await deliverProjectEvent(event);
    return result;
}
export const changeProjectMemberRole = input => changeMember(input);
export const removeProjectMember = input => changeMember({ ...input, role: null });
export const leaveProject = input => changeMember({ ...input, leave: true, role: null });
