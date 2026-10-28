import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';
import { assertCollaborationTestDatabase } from '../src/utils/collaborationDatabase.js';

const API = 'http://127.0.0.1:55000/api';
const PASSWORD = 'Collaboration-local-123!';

test('scenario editor preserves its draft when another member saves the same artifact first', async ({ browser, request }, testInfo) => {
    if (process.env.COLLABORATION_E2E_ENABLED !== 'true') throw new Error('Use the isolated collaboration runner');
    assertCollaborationTestDatabase(process.env.DATABASE_URL);
    // Explicit adapter plus the disposable DB guard prevent dotenv fallback.
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    const suffix = randomUUID().slice(0, 8);
    const actors = {};
    const ok = async response => { expect(response.ok(), `HTTP ${response.status()}`).toBe(true); return response.json(); };
    const api = (actor, method, path, data) => request.fetch(`${API}${path}`, {
        method, headers: { Authorization: `Bearer ${actors[actor].token}` }, ...(data ? { data } : {}),
    });
    let context;
    try {
        for (const actor of ['owner', 'editor']) {
            const email = `scenario-${actor}-${suffix}@covai.test`;
            const registered = await ok(await request.post(`${API}/auth/register`, { data: { name: actor, email, password: PASSWORD } }));
            actors[actor] = { email, token: registered.accessToken };
        }
        const projectId = (await ok(await api('owner', 'POST', '/projects', { name: `Scenario CAS ${suffix}` }))).data.id;
        await ok(await api('owner', 'POST', `/projects/${projectId}/invitations`, { email: actors.editor.email, role: 'EDITOR' }));
        let messageId;
        await expect.poll(async () => {
            const inbox = await (await request.get('http://127.0.0.1:58025/api/v1/messages')).json();
            messageId = inbox.messages?.find(message => message.To?.some(recipient => recipient.Address === actors.editor.email))?.ID;
            return !!messageId;
        }).toBe(true);
        const message = await (await request.get(`http://127.0.0.1:58025/api/v1/message/${messageId}`)).json();
        const inviteToken = message.Text.match(/\/invitations\/([a-f0-9]{64})/)[1];
        await ok(await api('editor', 'POST', '/invitations/accept', { token: inviteToken }));

        const code = "const request = require('supertest');\nconst app = require('../src/app');\ntest('GET health', async () => { const response = await request(app).get('/health'); expect(response.status).toBe(200); });\n";
        const zip = new AdmZip();
        zip.addFile('package.json', Buffer.from(JSON.stringify({ name: `scenario-${suffix}`, version: '1.0.0', dependencies: { express: '4.21.2', supertest: '7.1.1' } })));
        zip.addFile('src/app.js', Buffer.from("const express=require('express');const app=express();app.get('/health',(_req,res)=>res.json({ok:true}));module.exports=app;\n"));
        zip.addFile('tests/api.test.js', Buffer.from(code));
        await ok(await request.post(`${API}/projects/${projectId}/upload-zip`, { headers: { Authorization: `Bearer ${actors.owner.token}` }, multipart: { file: { name: 'scenario.zip', mimeType: 'application/zip', buffer: zip.toBuffer() } } }));
        let snapshotId;
        await expect.poll(async () => {
            const response = await api('owner', 'GET', `/projects/${projectId}/tree`);
            if (!response.ok()) return false;
            const tree = await response.json(); snapshotId = tree.snapshotId;
            return !!snapshotId && tree.data.some(row => row.name === 'src');
        }, { timeout: 60000 }).toBe(true);
        // Only generated proposal state is seeded; actors, membership, upload,
        // reads and both competing writes use actual authenticated HTTP APIs.
        const artifact = await prisma.aiTest.create({ data: { projectId, snapshotId, mode: 'FULL', filePath: 'tests/api.test.js', content: code,
            metaJson: JSON.stringify({ framework: 'SUPERTEST', status: 'DRAFT', requests: [{ scenarioId: 'health', testName: 'GET health', enabled: true }] }) } });
        const path = `/coverage/${snapshotId}/integration/ai-test/${artifact.id}/scenario/health`;
        const base = (await ok(await api('editor', 'GET', path))).data;

        context = await browser.newContext({ baseURL: 'http://127.0.0.1:55173', viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto('/login');
        await page.locator('#auth-email').fill(actors.owner.email);
        await page.locator('#auth-password').fill(PASSWORD);
        await page.locator('#auth-submit-btn').click();
        await expect(page).toHaveURL(/\/projects$/);
        await page.goto(`/main-editor?projectId=${projectId}&tab=coverage&type=integration&stage=GENERATE`);
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        const modal = page.getByRole('dialog', { name: 'Edit Scenario: GET health' });
        await expect(modal).toBeVisible();
        const editor = modal.getByRole('textbox', { name: 'Editor content', exact: true });
        const draft = `test('GET health', async () => { /* preserved draft ${suffix} */ expect(true).toBe(true); });`;
        await editor.focus();
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.insertText(draft);
        const remote = `test('GET health', async () => { /* other member ${suffix} */ expect(2).toBe(2); });`;
        await ok(await api('editor', 'PUT', path, { code: remote, expectedVersion: base.version }));
        const savedRemote = (await ok(await api('editor', 'GET', path))).data;
        const rejected = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(path));
        await modal.getByRole('button', { name: /Save/ }).click();
        const response = await rejected;
        expect(response.status()).toBe(409);
        expect(response.request().postDataJSON().expectedVersion).toBe(base.version);
        expect((await response.json()).code).toBe('ARTIFACT_VERSION_CONFLICT');
        await expect(modal).toBeVisible();
        await expect(modal.locator('.monaco-editor')).toContainText(`preserved draft ${suffix}`);
        await expect(page.getByText(/Your draft is preserved\./).first()).toBeVisible();
        const after = (await ok(await api('editor', 'GET', path))).data;
        expect(after.version).toBe(savedRemote.version);
        expect(after.code).toContain(`other member ${suffix}`);
        expect(after.code).not.toContain(`preserved draft ${suffix}`);
        expect(pageErrors).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath('scenario-cas-preserved-draft.png'), fullPage: true });
    } finally {
        await context?.close();
        await prisma.$disconnect();
        // Preserve this unique fixture for diagnosis; never delete project data.
    }
});
