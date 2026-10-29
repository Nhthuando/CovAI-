import { test, expect } from '@playwright/test';
import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';

const API = 'http://127.0.0.1:55000/api';
const UI = 'http://127.0.0.1:55173';
const SMTP = 'http://127.0.0.1:58025';
const PASSWORD = 'Collaboration-local-123!';

test('real Viewer hotkeys are read-only, shared AI is visible, and Owner manages pending email links', async ({ browser, request }, testInfo) => {
    if (process.env.COLLABORATION_E2E_ENABLED !== 'true') throw new Error('Use the isolated collaboration runner');
    const suffix = randomUUID().slice(0, 8);
    const actors = {};
    const contexts = [];
    const pageErrors = [];
    const api = (actor, method, path, data) => request.fetch(`${API}${path}`, {
        method, headers: { Authorization: `Bearer ${actors[actor].token}` }, ...(data ? { data } : {}),
    });
    const ok = async response => {
        expect(response.ok(), `HTTP ${response.status()}`).toBe(true);
        return response.json();
    };
    async function emailLink(email, previousId) {
        let messageId;
        await expect.poll(async () => {
            const inbox = await (await request.get(`${SMTP}/api/v1/messages`)).json();
            messageId = inbox.messages?.find(message => message.ID !== previousId && message.To?.some(recipient => recipient.Address === email))?.ID;
            return !!messageId;
        }, { timeout: 30000 }).toBe(true);
        const message = await (await request.get(`${SMTP}/api/v1/message/${messageId}`)).json();
        const link = message.Text?.match(/http:\/\/127\.0\.0\.1:55173\/invitations\/([a-f0-9]{64})/);
        expect(link).toBeTruthy();
        return { id: messageId, token: link[1] };
    }
    async function login(actor) {
        const context = await browser.newContext({ baseURL: UI, viewport: { width: 1440, height: 900 } });
        contexts.push(context);
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto('/login');
        await page.locator('#auth-email').fill(actors[actor].email);
        await page.locator('#auth-password').fill(PASSWORD);
        await page.locator('#auth-submit-btn').click();
        await expect(page).toHaveURL(/\/projects$/);
        return page;
    }
    let projectId, snapshotId;
    try {
        for (const actor of ['owner', 'editor', 'viewer', 'pending']) {
            const name = `UI ${actor} ${suffix}`;
            const email = `ui-${actor}-${suffix}@covai.test`;
            const registered = await ok(await request.post(`${API}/auth/register`, { data: { name, email, password: PASSWORD } }));
            actors[actor] = { name, email, token: registered.accessToken };
        }
        projectId = (await ok(await api('owner', 'POST', '/projects', { name: `Permissions UI ${suffix}` }))).data.id;
        for (const [actor, role] of [['editor', 'EDITOR'], ['viewer', 'VIEWER']]) {
            await ok(await api('owner', 'POST', `/projects/${projectId}/invitations`, { email: actors[actor].email, role }));
            const link = await emailLink(actors[actor].email);
            await ok(await api(actor, 'POST', '/invitations/accept', { token: link.token }));
        }
        const zip = new AdmZip();
        zip.addFile('package.json', Buffer.from(JSON.stringify({ name: `ui-permissions-${suffix}`, version: '1.0.0', scripts: { test: 'jest --runInBand --coverage' }, devDependencies: { jest: '29.7.0' }, jest: { testEnvironment: 'node', collectCoverageFrom: ['src/**/*.js'] } })));
        zip.addFile('src/sum.js', Buffer.from('function sum(a,b){return a+b;}\nmodule.exports={sum};\n'));
        zip.addFile('tests/sum.test.js', Buffer.from("const {sum}=require('../src/sum');test('adds',()=>expect(sum(2,3)).toBe(5));\n"));
        await ok(await request.post(`${API}/projects/${projectId}/upload-zip`, { headers: { Authorization: `Bearer ${actors.owner.token}` }, multipart: { file: { name: 'ui-permissions.zip', mimeType: 'application/zip', buffer: zip.toBuffer() } } }));
        await expect.poll(async () => {
            const response = await api('owner', 'GET', `/projects/${projectId}/tree`);
            if (!response.ok()) return false;
            const tree = await response.json();
            snapshotId = tree.snapshotId;
            return !!snapshotId && tree.data.some(row => row.name === 'src');
        }, { timeout: 60000 }).toBe(true);

        const ownerPage = await login('owner');
        const editorPage = await login('editor');
        const viewerPage = await login('viewer');
        for (const page of [ownerPage, editorPage, viewerPage]) await page.goto(`/main-editor?projectId=${projectId}&tab=explorer`);

        await test.step('Viewer cannot edit or save through Monaco keyboard shortcuts', async () => {
            await expect(viewerPage.getByText('src', { exact: true }).first()).toBeVisible();
            if (!await viewerPage.getByText('sum.js', { exact: true }).first().isVisible()) await viewerPage.getByText('src', { exact: true }).first().click();
            await viewerPage.getByText('sum.js', { exact: true }).first().click();
            const editor = viewerPage.locator('.monaco-editor textarea').first();
            await expect(editor).toBeVisible();
            const original = (await ok(await api('viewer', 'GET', `/projects/${projectId}/file-content?snapshotId=${snapshotId}&path=src/sum.js`))).data;
            const writes = [];
            viewerPage.on('request', event => { if (event.method() === 'PUT' && event.url().includes('/file-content')) writes.push(event.url()); });
            await editor.focus();
            await viewerPage.keyboard.press('ControlOrMeta+A');
            await viewerPage.keyboard.insertText('forged viewer source edit');
            await viewerPage.keyboard.press('ControlOrMeta+S');
            await viewerPage.keyboard.press('Escape');
            await expect(viewerPage.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
            await expect(viewerPage.getByRole('textbox', { name: 'Ask COV', exact: true })).toBeDisabled();
            const after = (await ok(await api('viewer', 'GET', `/projects/${projectId}/file-content?snapshotId=${snapshotId}&path=src/sum.js`))).data;
            expect(after.content).toBe(original.content);
            expect(after.version).toEqual(original.version);
            expect(writes).toEqual([]);
        });

        await test.step('Editor sends through COV and Owner and Viewer read the same attributed message', async () => {
            const text = `Shared COV UI message ${suffix}`;
            const composer = editorPage.getByRole('textbox', { name: 'Ask COV', exact: true });
            await expect(composer).toBeEnabled();
            await composer.fill(text);
            const response = editorPage.waitForResponse(item => item.request().method() === 'POST' && item.url().endsWith(`/projects/${projectId}/chat`));
            await composer.press('Enter');
            expect((await response).ok()).toBe(true);
            await expect(composer).toHaveValue('');
            for (const page of [ownerPage, viewerPage]) {
                await expect(page.getByRole('paragraph').filter({ hasText: text }).last()).toBeVisible();
                await expect(page.getByText(actors.editor.name, { exact: true })).toBeVisible();
                await expect(page.getByText(/\[LOCAL AI FIXTURE\]/).first()).toBeVisible();
            }
            await viewerPage.screenshot({ path: testInfo.outputPath('viewer-shared-chat-readonly.png'), fullPage: true });
        });

        await test.step('Shared memory is editable by Editor and read-only for Viewer', async () => {
            const note = `Shared project memory ${suffix}`;
            const ownerGuidance = `Unsaved Owner guidance ${suffix}`;
            const ownerDraft = `Unsaved Owner memory draft ${suffix}`;
            await ownerPage.getByRole('button', { name: 'What AI knows', exact: true }).click();
            const ownerDialog = ownerPage.getByRole('dialog', { name: 'What AI knows' });
            await ownerDialog.getByRole('tab', { name: 'Memory (optional)', exact: true }).click();
            await ownerDialog.getByRole('textbox', { name: 'Additional instructions', exact: true }).fill(ownerGuidance);
            await ownerDialog.getByRole('textbox', { name: 'Memory note', exact: true }).fill(ownerDraft);
            await editorPage.getByRole('button', { name: 'What AI knows', exact: true }).click();
            let dialog = editorPage.getByRole('dialog', { name: 'What AI knows' });
            await dialog.getByRole('tab', { name: 'Memory (optional)', exact: true }).click();
            await dialog.getByRole('textbox', { name: 'Memory note', exact: true }).fill(note);
            const savedMemory = editorPage.waitForResponse(item => item.request().method() === 'POST' && item.url().endsWith(`/projects/${projectId}/ai-context/memories`));
            await dialog.getByRole('button', { name: 'Add memory', exact: true }).click();
            expect((await savedMemory).status()).toBe(201);
            await expect(dialog.getByRole('textbox', { name: 'Memory note', exact: true })).toHaveValue('');
            await expect(dialog.locator('article').getByText(note, { exact: true })).toBeVisible();
            for (const page of [ownerPage, viewerPage]) {
                if (page === viewerPage) await page.getByRole('button', { name: 'What AI knows', exact: true }).click();
                dialog = page.getByRole('dialog', { name: 'What AI knows' });
                await dialog.getByRole('tab', { name: 'Memory (optional)', exact: true }).click();
                await expect(dialog.locator('article').getByText(note, { exact: true })).toBeVisible();
                if (page === viewerPage) {
                    await expect(dialog.getByRole('textbox', { name: 'Memory note', exact: true })).toBeDisabled();
                    await expect(dialog.getByRole('button', { name: 'Clear all memory', exact: true })).toBeDisabled();
                } else {
                    await expect(dialog.getByRole('textbox', { name: 'Additional instructions', exact: true })).toHaveValue(ownerGuidance);
                    await expect(dialog.getByRole('textbox', { name: 'Memory note', exact: true })).toHaveValue(ownerDraft);
                }
                await dialog.getByRole('button', { name: 'Close context dialog' }).click();
                if (page === ownerPage) await dialog.getByRole('button', { name: 'Discard and close', exact: true }).click();
            }
        });

        await test.step('Owner resends and revokes a real pending email invitation from Settings', async () => {
            await ownerPage.goto(`/main-editor?projectId=${projectId}&tab=settings&setting=members`);
            await ownerPage.getByRole('textbox', { name: 'Email address', exact: true }).fill(actors.pending.email);
            await ownerPage.getByRole('button', { name: 'Send invitation', exact: true }).click();
            await expect(ownerPage.getByRole('textbox', { name: 'Email address', exact: true })).toHaveValue('');
            const first = await emailLink(actors.pending.email);
            await ownerPage.getByRole('tab', { name: /Pending invitations/ }).click();
            await expect(ownerPage.getByText(actors.pending.email, { exact: true })).toBeVisible();
            await ownerPage.getByRole('button', { name: 'Resend invitation', exact: true }).click();
            const resent = await emailLink(actors.pending.email, first.id);
            expect(resent.token).not.toBe(first.token);
            await ownerPage.getByRole('button', { name: 'Revoke invitation', exact: true }).click();
            await ownerPage.getByRole('dialog', { name: 'Revoke invitation' }).getByRole('button', { name: 'Revoke invitation', exact: true }).click();
            await expect(ownerPage.getByText('No pending invitations. Invite a collaborator using their email address.', { exact: true })).toBeVisible();
            const revoked = await api('pending', 'POST', '/invitations/accept', { token: resent.token });
            expect(revoked.status()).toBe(410);
        });
        expect(pageErrors).toEqual([]);
    } finally {
        for (const context of contexts) await context.close();
    }
});
