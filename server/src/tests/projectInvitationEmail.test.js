import { createProjectInvitationEmail } from '../utils/projectInvitationEmail.js';

const input = { projectName: 'CovAI Workspace', inviterName: 'Thuan Nguyen', role: 'EDITOR', email: 'member@example.test',
    invitationUrl: `https://covai.example/invitations/${'a'.repeat(64)}`, expiresAt: new Date('2026-11-04T08:30:00Z') };
describe('project invitation email', () => {
    test.each(['EDITOR','VIEWER'])('renders %s access, a functional CTA and a complete text alternative', role => {
        const email = createProjectInvitationEmail({ ...input, role });
        expect(email.subject).toContain('CovAI Workspace');
        for (const content of [email.html,email.message]) {
            expect(content).toContain('Thuan Nguyen');
            expect(content).toContain('member@example.test');
            expect(content).toContain(input.invitationUrl);
            expect(content).toContain('4 November 2026');
            expect(content).toContain('08:30 UTC');
            expect(content).toContain('AI memory');
        }
        expect(email.html).toContain('Accept invitation');
        expect(email.html).toContain('role="presentation"');
        expect(email.html).not.toMatch(/<script|<iframe|@import|<img/i);
        if (role === 'VIEWER') expect(email.message).toContain('export reports');
        else expect(email.message).toContain('Edit project files, run tests');
    });
    test('escapes untrusted names and addresses in HTML and removes subject line breaks', () => {
        const email = createProjectInvitationEmail({ ...input, projectName: '<img src=x onerror=alert(1)>\r\nBcc: hidden',
            inviterName: '<script>bad()</script>', email: 'member+"<unsafe>@example.test' });
        expect(email.html).toContain('&lt;img');
        expect(email.html).toContain('&lt;script&gt;');
        expect(email.html).toContain('&quot;&lt;unsafe&gt;');
        expect(email.html).not.toMatch(/<img|<script/i);
        expect(email.subject).not.toMatch(/[\r\n]/);
    });
    test.each(['javascript:alert(1)','https://user:password@example.test/invite'])('rejects unsafe URLs: %s', invitationUrl => {
        expect(() => createProjectInvitationEmail({ ...input, invitationUrl })).toThrow('Invalid invitation URL');
    });
    test('rejects invalid roles and expiry dates instead of issuing misleading invitations', () => {
        expect(() => createProjectInvitationEmail({ ...input, role: 'OWNER' })).toThrow('Invalid invitation role');
        expect(() => createProjectInvitationEmail({ ...input, expiresAt: 'not-a-date' })).toThrow('Invalid invitation expiry');
    });
    test('uses the actual expiry time and keeps the message usable without the inviter account', () => {
        const email = createProjectInvitationEmail({ ...input, inviterName: null, expiresAt: '2026-10-28T09:00:00Z' });
        expect(email.message).toContain('The project owner invited you');
        expect(email.message).toContain('28 October 2026 at 09:00 UTC');
        expect(email.message).not.toContain('expires in 7 days');
    });
});
