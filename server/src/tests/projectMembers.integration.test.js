import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma.js';
import { decrypt } from '../utils/crypto.js';
import { assertCollaborationTestDatabase } from './helpers/collaborationDb.js';
import { createProjectInvitation, consumeProjectInvitation, inspectProjectInvitation, changeProjectInvitation, listProjectInvitations } from '../services/projectInvitation.service.js';
import { changeProjectMemberRole, removeProjectMember, listProjectMembers } from '../services/projectMember.service.js';
import { resolveProjectAccess } from '../services/projectAccess.service.js';

const suite = process.env.COLLABORATION_INTEGRATION === 'true' ? describe : describe.skip;
suite('real database membership and invitation transactions', () => {
    let users, projectId;
    beforeAll(() => assertCollaborationTestDatabase(process.env.DATABASE_URL));
    beforeEach(async () => {
        users = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(name => prisma.user.create({ data: { name, email: `${name}-${randomUUID()}@covai.test` } })));
        projectId = (await prisma.project.create({ data: { name: 'Collaboration transaction test', ownerId: users[0].id } })).id;
    });
    afterEach(async () => {
        if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
        if (users) await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    });
    afterAll(async () => prisma.$disconnect());
    async function invite(user = users[1], role = 'EDITOR') {
        const row = await createProjectInvitation({ projectId, userId: users[0].id, email: user.email.toUpperCase(), role, requestId: randomUUID() });
        const pending = await prisma.invitationDelivery.findUnique({ where: { invitationId_invitationRevision: { invitationId: row.id, invitationRevision: row.revision } } });
        return { row, token: JSON.parse(decrypt(pending.encryptedPayload)).token };
    }
    test('invitation acceptance is recipient-bound and idempotent under races', async () => {
        const { row, token } = await invite();
        expect(JSON.stringify(row)).not.toContain(token);
        await expect(consumeProjectInvitation({ token, userId: users[3].id })).rejects.toMatchObject({ statusCode: 404 });
        const accepted = await Promise.all([1, 2].map(() => consumeProjectInvitation({ token, userId: users[1].id })));
        expect(accepted.every(result => result.accepted)).toBe(true);
        expect(await prisma.projectMember.count({ where: { projectId } })).toBe(1);
        expect((await resolveProjectAccess({ projectId, userId: users[1].id, capability: 'files.write' })).role).toBe('EDITOR');
        await expect(createProjectInvitation({ projectId, userId: users[1].id, email: users[2].email, role: 'VIEWER' })).rejects.toMatchObject({ statusCode: 403 });
    });
    test('resend rotates secrets and revoke immediately makes the new link unusable', async () => {
        const { row, token } = await invite();
        const updated = await changeProjectInvitation({ projectId, userId: users[0].id, invitationId: row.id, expectedRevision: row.revision });
        await expect(inspectProjectInvitation({ token, userId: users[1].id })).rejects.toMatchObject({ statusCode: 404 });
        const payload = await prisma.invitationDelivery.findUnique({ where: { invitationId_invitationRevision: { invitationId: row.id, invitationRevision: updated.revision } } });
        const rotated = JSON.parse(decrypt(payload.encryptedPayload)).token;
        await changeProjectInvitation({ projectId, userId: users[0].id, invitationId: row.id, expectedRevision: updated.revision, revoke: true });
        await expect(consumeProjectInvitation({ token: rotated, userId: users[1].id })).rejects.toMatchObject({ statusCode: 410 });
        expect((await listProjectInvitations({ projectId, userId: users[0].id })).total).toBe(0);
    });
    test('role and removal race on one membership revision has exactly one winner', async () => {
        const { token } = await invite();
        await consumeProjectInvitation({ token, userId: users[1].id });
        const member = (await listProjectMembers({ projectId, userId: users[0].id })).members.find(row => row.userId === users[1].id);
        const input = { projectId, userId: users[0].id, memberId: member.id, expectedRevision: member.revision };
        const results = await Promise.allSettled([changeProjectMemberRole({ ...input, role: 'VIEWER' }), removeProjectMember(input)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ code: 'MEMBERSHIP_CHANGED' });
        await expect(removeProjectMember({ ...input, memberId: `owner:${users[0].id}` })).rejects.toMatchObject({ statusCode: 403 });
    });
});
