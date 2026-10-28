import { createHash, randomBytes } from 'node:crypto';
import prisma from '../config/prisma.js';
import { encrypt } from '../utils/crypto.js';
import { ServiceError } from '../utils/serviceError.js';
import { resolveProjectAccess, withProjectGuard } from './projectAccess.service.js';
import { publishProjectEvent } from './projectEvent.service.js';

const hash = token => createHash('sha256').update(token).digest('hex');
const expiry = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);
const projection = {
    id: true, canonicalEmail: true, role: true, status: true, revision: true,
    expiresAt: true, createdAt: true, invitedBy: { select: { name: true } },
    deliveries: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, lastErrorCode: true, attempts: true } },
};
const publicInvitation = row => ({ ...row, email: row.canonicalEmail, deliveryStatus: row.deliveries?.[0]?.status ?? 'QUEUED' });
async function delivery(tx, invitation, token) {
    await tx.invitationDelivery.create({ data: {
        invitationId: invitation.id, invitationRevision: invitation.revision,
        encryptedPayload: encrypt(JSON.stringify({ token, email: invitation.canonicalEmail })),
    } });
}
export async function listProjectInvitations({ projectId, userId, cursor, limit = 50 }) {
    await resolveProjectAccess({ projectId, userId, capability: 'members.manage' });
    const where = { projectId, status: 'PENDING', expiresAt: { gt: new Date() } };
    const [invitations, total] = await Promise.all([
        prisma.projectInvitation.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: projection }),
        prisma.projectInvitation.count({ where }),
    ]);
    return { invitations: invitations.slice(0, limit).map(publicInvitation), total, nextCursor: invitations.length > limit ? invitations[limit - 1].id : null };
}
export async function createProjectInvitation({ projectId, userId, email, role, requestId }) {
    const canonicalEmail = email.trim().toLowerCase();
    return withProjectGuard({ projectId, userId, capability: 'members.manage' }, async (tx, access) => {
        if (requestId) {
            const previous = await tx.projectInvitation.findUnique({ where: { projectId_invitedByUserId_requestId: { projectId, invitedByUserId: userId, requestId } }, select: projection });
            if (previous) {
                if (previous.canonicalEmail !== canonicalEmail || previous.role !== role) throw new ServiceError('Request ID reused with different invitation', 409, 'IDEMPOTENCY_CONFLICT');
                return publicInvitation(previous);
            }
        }
        const owner = await tx.user.findUnique({ where: { id: access.project.ownerId }, select: { email: true } });
        const member = await tx.projectMember.findFirst({ where: { projectId, user: { email: { equals: canonicalEmail, mode: 'insensitive' } } } });
        if (owner.email.toLowerCase() === canonicalEmail || member) throw new ServiceError('This account is already a project member', 409, 'ALREADY_MEMBER');
        await tx.projectInvitation.updateMany({ where: { projectId, canonicalEmail, status: 'PENDING', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED', revision: { increment: 1 } } });
        if (await tx.projectInvitation.findFirst({ where: { projectId, canonicalEmail, status: 'PENDING' } })) throw new ServiceError('An invitation is already pending for this email', 409, 'INVITATION_PENDING');
        const token = randomBytes(32).toString('hex');
        const row = await tx.projectInvitation.create({ data: { projectId, canonicalEmail, role, tokenHash: hash(token), expiresAt: expiry(), invitedByUserId: userId, requestId }, select: projection });
        await delivery(tx, row, token);
        await publishProjectEvent({ tx, projectId, actorId: userId, type: 'invitation.changed', resourceId: row.id });
        return publicInvitation(row);
    });
}
export async function changeProjectInvitation({ projectId, userId, invitationId, expectedRevision, revoke = false }) {
    return withProjectGuard({ projectId, userId, capability: 'members.manage' }, async tx => {
        const row = await tx.projectInvitation.findFirst({ where: { id: invitationId, projectId } });
        if (!row || row.revision !== expectedRevision || row.status !== 'PENDING') throw new ServiceError('Invitation changed; reload and try again', 409, 'MEMBERSHIP_CHANGED');
        const token = randomBytes(32).toString('hex');
        const updated = await tx.projectInvitation.update({ where: { id: row.id }, data: {
            revision: { increment: 1 }, ...(revoke ? { status: 'REVOKED' } : { tokenHash: hash(token), expiresAt: expiry() }),
        }, select: projection });
        await tx.invitationDelivery.updateMany({ where: { invitationId, status: { in: ['QUEUED', 'FAILED', 'SENDING'] } }, data: { status: 'CANCELED', encryptedPayload: null } });
        if (!revoke) await delivery(tx, updated, token);
        await publishProjectEvent({ tx, projectId, actorId: userId, type: 'invitation.changed', resourceId: row.id });
        return publicInvitation(updated);
    });
}
async function matchedInvitation({ token, userId, db = prisma }) {
    const [row, user] = await Promise.all([
        db.projectInvitation.findUnique({ where: { tokenHash: hash(token) }, include: { project: { select: { id: true, name: true } }, invitedBy: { select: { name: true } } } }),
        db.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    // Read the current DB email: a stale JWT email cannot accept an invitation.
    if (!row || !user || row.canonicalEmail !== user.email.toLowerCase()) throw new ServiceError('Invitation unavailable for this account', 404, 'INVITATION_NOT_FOUND');
    if (row.status === 'REVOKED') throw new ServiceError('Invitation was revoked', 410, 'INVITATION_REVOKED');
    if (row.status === 'EXPIRED' || row.expiresAt <= new Date()) throw new ServiceError('Invitation has expired', 410, 'INVITATION_EXPIRED');
    if (row.status === 'DECLINED') throw new ServiceError('Invitation is no longer available', 410, 'INVITATION_REVOKED');
    return row;
}
export async function inspectProjectInvitation({ token, userId }) {
    const row = await matchedInvitation({ token, userId });
    return { id: row.id, projectId: row.projectId, projectName: row.project.name, project: row.project, role: row.role, email: row.canonicalEmail, status: row.status, expiresAt: row.expiresAt, invitedBy: row.invitedBy };
}
export async function consumeProjectInvitation({ token, userId, decline = false }) {
    const preview = await matchedInvitation({ token, userId });
    // Invitee is not a member yet: use the same lock, with recipient authorization below.
    return prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${preview.projectId}, 0))`;
        const row = await matchedInvitation({ token, userId, db: tx });
        if (row.status === 'ACCEPTED') {
            const active = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId: row.projectId, userId } } });
            if (decline || row.acceptedByUserId !== userId || !active) throw new ServiceError('Invitation already consumed', 409, 'INVITATION_CONSUMED');
            return { projectId: row.projectId, role: active.role, accepted: true };
        }
        if (!decline) await tx.projectMember.upsert({ where: { projectId_userId: { projectId: row.projectId, userId } },
            create: { projectId: row.projectId, userId, role: row.role, addedByUserId: row.invitedByUserId }, update: {} });
        await tx.projectInvitation.update({ where: { id: row.id }, data: { status: decline ? 'DECLINED' : 'ACCEPTED', acceptedByUserId: userId, acceptedAt: new Date(), revision: { increment: 1 } } });
        await tx.invitationDelivery.updateMany({ where: { invitationId: row.id, status: { in: ['QUEUED', 'FAILED', 'SENDING'] } }, data: { status: 'CANCELED', encryptedPayload: null } });
        const project = await tx.project.update({ where: { id: row.projectId }, data: { accessRevision: { increment: 1 } } });
        await publishProjectEvent({ tx, projectId: row.projectId, actorId: userId, type: decline ? 'invitation.changed' : 'member.joined', resourceId: userId, revision: project.accessRevision });
        return { projectId: row.projectId, role: row.role, accepted: !decline };
    }, { maxWait: 10000, timeout: 15000 });
}
