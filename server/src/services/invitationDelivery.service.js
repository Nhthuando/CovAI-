import prisma from '../config/prisma.js';
import { decrypt } from '../utils/crypto.js';
import { sendEmail } from '../utils/sendEmail.js';
import { createProjectInvitationEmail } from '../utils/projectInvitationEmail.js';

export async function dispatchInvitationDeliveries({ db = prisma, send = sendEmail } = {}) {
    const now = new Date();
    const candidates = await db.invitationDelivery.findMany({ where: {
        OR: [{ status: { in: ['QUEUED', 'FAILED'] }, nextAttemptAt: { lte: now } }, { status: 'SENDING', lockedUntil: { lt: now } }], attempts: { lt: 6 },
    }, orderBy: { createdAt: 'asc' }, take: 10 });
    for (const candidate of candidates) {
        const claim = await db.invitationDelivery.updateMany({ where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts, ...(candidate.status === 'SENDING' ? { lockedUntil: { lt: now } } : {}) },
            data: { status: 'SENDING', attempts: { increment: 1 }, lockedUntil: new Date(Date.now() + 120000) } });
        if (claim.count !== 1) continue;
        const row = await db.invitationDelivery.findUnique({ where: { id: candidate.id }, include: { invitation: { include: { project: { select: { name: true } }, invitedBy: { select: { name: true } } } } } });
        if (!row || row.status !== 'SENDING' || !row.encryptedPayload) continue;
        if (row.invitation.status !== 'PENDING' || row.invitation.revision !== row.invitationRevision || row.invitation.expiresAt <= new Date()) {
            await db.invitationDelivery.updateMany({ where: { id: row.id, status: 'SENDING', attempts: row.attempts }, data: { status: 'CANCELED', encryptedPayload: null, lockedUntil: null } });
            continue;
        }
        try {
            const { token, email } = JSON.parse(decrypt(row.encryptedPayload));
            const base = new URL(process.env.CLIENT_URL || 'http://localhost:5173');
            const link = new URL(`/invitations/${token}`, base).href;
            await send({ email, ...createProjectInvitationEmail({ projectName: row.invitation.project.name,
                inviterName: row.invitation.invitedBy?.name, role: row.invitation.role, email,
                invitationUrl: link, expiresAt: row.invitation.expiresAt }) });
            await db.invitationDelivery.updateMany({ where: { id: row.id, status: 'SENDING', attempts: row.attempts }, data: { status: 'SENT', encryptedPayload: null, lockedUntil: null, lastErrorCode: null } });
        } catch {
            // Never retain transport error strings containing credentials/email/token URLs.
            const delay = [60000, 300000, 1800000][Math.min(row.attempts - 1, 2)];
            await db.invitationDelivery.updateMany({ where: { id: row.id, status: 'SENDING', attempts: row.attempts }, data: { status: 'FAILED', lockedUntil: null, nextAttemptAt: new Date(Date.now() + delay), lastErrorCode: 'EMAIL_DELIVERY_FAILED' } });
        }
    }
}
export function startInvitationDeliveryWorker() {
    let active = false;
    const run = async () => {
        if (active) return;
        active = true;
        try { await dispatchInvitationDeliveries(); } catch { console.error('[invitation-delivery] Dispatch unavailable; retrying'); }
        finally { active = false; }
    };
    const timer = setInterval(run, 2000);
    timer.unref();
    void run();
    return () => clearInterval(timer);
}
