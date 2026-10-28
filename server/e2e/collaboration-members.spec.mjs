import { test, expect } from '@playwright/test';
import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';

const API = 'http://127.0.0.1:55000/api';
const SMTP = 'http://127.0.0.1:58025';
const PASSWORD = 'Collaboration-local-123!';

test('real users invite, share workspace/chat, enforce roles and preserve conflicts', async ({ browser, request }, testInfo) => {
    if (process.env.COLLABORATION_E2E_ENABLED !== 'true') throw new Error('Use the isolated collaboration runner');
    const accounts = {};
    const suffix = randomUUID().slice(0, 8);
    const contexts = [];
    const pageErrors = [];
    const api = async (actor, method, endpoint, options = {}) => request.fetch(`${API}${endpoint}`, {
        method, ...options, headers: { Authorization: `Bearer ${accounts[actor].token}`, ...options.headers },
    });
    async function jsonOK(response) {
        const body = await response.json();
        expect(response.ok(), JSON.stringify({ status: response.status(), body })).toBe(true);
        return body;
    }
    async function loginPage(actor, url = '/login') {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        contexts.push(context);
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(`http://127.0.0.1:55173${url}`);
        await page.locator('#auth-email').fill(accounts[actor].email);
        await page.locator('#auth-password').fill(PASSWORD);
        await page.locator('#auth-submit-btn').click();
        await expect(page.locator('#auth-submit-btn')).not.toBeVisible();
        return page;
    }
    async function invitationLink(email) {
        let id;
        await expect.poll(async () => {
            const messages = await (await request.get(`${SMTP}/api/v1/messages`)).json();
            const found = messages.messages.find(item => item.To?.some(to => to.Address === email));
            id = found?.ID;
            return !!id;
        }, { timeout: 30000 }).toBe(true);
        const message = await (await request.get(`${SMTP}/api/v1/message/${id}`)).json();
        const link = message.Text?.match(/http:\/\/127\.0\.0\.1:55173\/invitations\/[a-f0-9]{64}/)?.[0];
        expect(link).toBeTruthy();
        return link;
    }
    let projectId, snapshotId, ownerPage, editorPage, viewerPage;
    try {
        await test.step('register real accounts and sign Owner in through the UI', async () => {
            for (const actor of ['owner', 'editor', 'viewer', 'outsider']) {
                const email = `${actor}-${suffix}@covai.test`;
                const registered = await jsonOK(await request.post(`${API}/auth/register`, { data: { name: `${actor} ${suffix}`, email, password: PASSWORD } }));
                accounts[actor] = { email, token: registered.accessToken };
            }
            ownerPage = await loginPage('owner');
            const project = await jsonOK(await api('owner', 'POST', '/projects', { data: { name: `Collaboration ${suffix}` } }));
            projectId = project.data.id;
            await ownerPage.goto(`/main-editor?projectId=${projectId}&tab=settings&setting=members`);
            await expect(ownerPage.getByRole('heading', { name: 'Members & access' })).toBeVisible();
            await expect(ownerPage.getByRole('button', { name: /Profile/ }).first()).toBeVisible();
        });
        await test.step('send email invitations from actual Settings and accept as separate users', async () => {
            for (const [actor, role] of [['editor', 'EDITOR'], ['viewer', 'VIEWER']]) {
                await ownerPage.getByRole('textbox', { name: 'Email address', exact: true }).fill(accounts[actor].email);
                await ownerPage.getByRole('combobox', { name: 'Invitation role' }).selectOption(role);
                await ownerPage.getByRole('button', { name: 'Send invitation', exact: true }).click();
                await expect(ownerPage.getByRole('textbox', { name: 'Email address', exact: true })).toHaveValue('');
                const link = await invitationLink(accounts[actor].email);
                const page = await loginPage(actor, new URL(link).pathname);
                await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeVisible();
                await page.getByRole('button', { name: 'Accept invitation' }).click();
                await expect(page.getByRole('heading', { name: 'Members & access' })).toBeVisible();
                if (actor === 'editor') editorPage = page; else viewerPage = page;
            }
            await expect(ownerPage.getByRole('tab', { name: /Members \(3\)/ })).toBeVisible();
            await expect(viewerPage.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
            await ownerPage.screenshot({ path: testInfo.outputPath('members-owner.png'), fullPage: true });
            await viewerPage.screenshot({ path: testInfo.outputPath('members-viewer.png'), fullPage: true });
        });
        await test.step('actual multipart archive ingestion creates a usable snapshot', async () => {
            const zip = new AdmZip();
            zip.addFile('package.json', Buffer.from(JSON.stringify({ name: 'collaboration-sample', version: '1.0.0', scripts: { test: 'jest --runInBand' }, devDependencies: { jest: '29.7.0' }, jest: { testEnvironment: 'node', collectCoverageFrom: ['src/**/*.js'] } })));
            zip.addFile('src/sum.js', Buffer.from('function sum(a,b){return a+b;}\nmodule.exports={sum};\n'));
            zip.addFile('tests/sum.test.js', Buffer.from("const {sum}=require('../src/sum'); test('adds real values',()=>expect(sum(2,3)).toBe(5));\n"));
            await jsonOK(await api('owner', 'POST', `/projects/${projectId}/upload-zip`, { multipart: { file: { name: 'collaboration.zip', mimeType: 'application/zip', buffer: zip.toBuffer() } } }));
            await expect.poll(async () => {
                const response = await api('editor', 'GET', `/projects/${projectId}/tree`);
                if (!response.ok()) return false;
                const tree = await response.json();
                snapshotId = tree.snapshotId;
                return Boolean(snapshotId && tree.data?.some(row => row.name === 'src'));
            }, { timeout: 60000 }).toBe(true);
        });
        await test.step('real API concurrent save has one winner, Viewer and outsider cannot write/read', async () => {
            const base = (await jsonOK(await api('editor', 'GET', `/projects/${projectId}/file-content?snapshotId=${snapshotId}&path=src/sum.js`))).data;
            const saves = await Promise.all(['owner', 'editor'].map(actor => api(actor, 'PUT', `/projects/${projectId}/file-content`, { data: {
                snapshotId, path: 'src/sum.js', content: `function sum(a,b){return a+b;}\nmodule.exports={sum};\n// ${actor}\n`, expectedVersion: base.version, requestId: randomUUID(),
            } })));
            expect(saves.map(response => response.status()).sort()).toEqual([200, 409]);
            expect((await saves.find(response => response.status() === 409).json()).code).toBe('FILE_VERSION_CONFLICT');
            expect((await api('viewer', 'PUT', `/projects/${projectId}/file-content`, { data: { snapshotId, path: 'src/sum.js', content: 'forged', expectedVersion: base.version } })).status()).toBe(403);
            expect((await api('outsider', 'GET', `/projects/${projectId}/file-content?snapshotId=${snapshotId}&path=src/sum.js`)).status()).toBe(404);
            expect((await api('editor', 'POST', `/projects/${projectId}/invitations`, { data: { email: 'forged@covai.test', role: 'OWNER' } })).status()).toBe(400);
        });
        await test.step('actual Monaco save preserves the other user draft on a conflict', async () => {
            for (const page of [ownerPage, editorPage]) {
                await page.goto(`/main-editor?projectId=${projectId}&tab=explorer`);
                await expect(page.getByText('src', { exact: true }).first()).toBeVisible();
                if (!await page.getByText('sum.js', { exact: true }).first().isVisible()) {
                    await page.getByText('src', { exact: true }).first().click();
                }
                await page.getByText('sum.js', { exact: true }).first().click();
                await expect(page.locator('.monaco-editor').first()).toBeVisible();
            }
            for (const [page, label] of [[ownerPage, 'owner draft'], [editorPage, 'editor preserved draft']]) {
                await page.locator('.monaco-editor .view-lines').first().click({ position: { x: 160, y: 12 } });
                await page.keyboard.press('ControlOrMeta+A');
                await page.keyboard.insertText(`function sum(a,b){return a+b;}\nmodule.exports={sum};\n// ${label}\n`);
                await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
            }
            const ownerSaved = ownerPage.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/file-content'));
            await ownerPage.locator('.monaco-editor textarea').first().focus();
            await ownerPage.keyboard.press('ControlOrMeta+S');
            expect((await ownerSaved).status()).toBe(200);
            const savedOwner = await jsonOK(await api('owner', 'GET', `/projects/${projectId}/file-content?snapshotId=${snapshotId}&path=src/sum.js`));
            expect(savedOwner.data.content).toBe('function sum(a,b){return a+b;}\nmodule.exports={sum};\n// owner draft\n');
            const editorSaved = editorPage.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/file-content'));
            await editorPage.locator('.monaco-editor textarea').first().focus();
            await editorPage.keyboard.press('ControlOrMeta+S');
            expect((await editorSaved).status()).toBe(409);
            await expect(editorPage.getByRole('dialog', { name: 'File changed' })).toBeVisible();
            await expect(editorPage.getByRole('textbox', { name: 'Your unsaved draft' })).toHaveValue(/editor preserved draft/);
            await editorPage.screenshot({ path: testInfo.outputPath('conflict-preserved-draft.png'), fullPage: true });
            await editorPage.getByRole('button', { name: 'Reload latest', exact: true }).click();
        });
        await test.step('shared chat persists the sender and Viewer sees the same history', async () => {
            const chat = await jsonOK(await api('editor', 'POST', `/projects/${projectId}/chat`, { data: {
                message: `Shared collaboration message ${suffix}`, snapshotId, clientRequestId: randomUUID(), useMemory: false,
            } }));
            expect(chat.data?.reply || chat.reply).toContain('[LOCAL AI FIXTURE]');
            const sessionId = chat.data?.sessionId || chat.sessionId;
            const session = await jsonOK(await api('viewer', 'GET', `/projects/${projectId}/chat/sessions/${sessionId}`));
            expect(JSON.stringify(session)).toContain(`Shared collaboration message ${suffix}`);
            expect(JSON.stringify(session)).toContain(accounts.editor.email);
            expect((await api('viewer', 'POST', `/projects/${projectId}/chat`, { data: { message: 'forged', clientRequestId: randomUUID() } })).status()).toBe(403);
        });
        await test.step('Editor runs a real Jest job, Viewer reads result and exports report', async () => {
            const requestId = randomUUID();
            const [first, sameWork] = await Promise.all([
                api('editor', 'POST', `/projects/${projectId}/run-analysis`, { data: { snapshotId, requestId } }),
                api('owner', 'POST', `/projects/${projectId}/run-analysis`, { data: { snapshotId, requestId: randomUUID() } }),
            ]);
            const started = await jsonOK(first);
            const duplicateActive = await jsonOK(sameWork);
            const jobId = started.data?.job?.id || started.job?.id;
            expect(jobId).toBeTruthy();
            expect(duplicateActive.data?.job?.id || duplicateActive.job?.id).toBe(jobId);
            let job;
            await expect.poll(async () => {
                const result = await jsonOK(await api('viewer', 'GET', `/job/${jobId}`));
                job = result.data || result.job || result;
                return ['SUCCESS', 'FAILED', 'CANCELED'].includes(job.status);
            }, { timeout: 180000, intervals: [1000, 2000, 3000] }).toBe(true);
            expect(job.status, JSON.stringify(job)).toBe('SUCCESS');
            const detail = await jsonOK(await api('viewer', 'GET', `/job/${jobId}`));
            const detailedJob = detail.data || detail.job || detail;
            const resultValue = detailedJob.resultJson ?? detailedJob.result;
            const result = typeof resultValue === 'string' ? JSON.parse(resultValue) : resultValue;
            expect(result?.exitCode, JSON.stringify(detail)).toBe(0);
            expect(result?.hasTestFailures, JSON.stringify(detail)).toBe(false);
            const duplicateCompleted = await jsonOK(await api('editor', 'POST', `/projects/${projectId}/run-analysis`, { data: { snapshotId, requestId } }));
            expect(duplicateCompleted.data?.job?.id || duplicateCompleted.job?.id).toBe(jobId);
            for (const type of ['BUILD_CFG', 'PERFORMANCE_ANALYSIS']) {
                await expect.poll(async () => {
                    const listed = await jsonOK(await api('viewer', 'GET', `/job/${projectId}/jobs`));
                    return listed.jobs?.find(item => item.snapshotId === snapshotId && item.type === type)?.status;
                }, { timeout: 60000, intervals: [500, 1000, 2000] }).toBe('SUCCESS');
            }
            const exported = await api('viewer', 'GET', `/projects/${projectId}/export?format=json`);
            expect(exported.ok(), await exported.text()).toBe(true);
        });
        await test.step('existing coverage endpoint still executes a complete guarded Jest run', async () => {
            const queued = await jsonOK(await api('editor', 'POST', `/coverage/${snapshotId}/run`, { data: {} }));
            expect(queued.jobId).toBeTruthy();
            expect(queued.installJobId).toBe(queued.jobId);
            let legacyJob;
            await expect.poll(async () => {
                const detail = await jsonOK(await api('viewer', 'GET', `/job/${queued.jobId}`));
                legacyJob = detail.data || detail.job || detail;
                return ['SUCCESS', 'FAILED', 'CANCELED'].includes(legacyJob.status);
            }, { timeout: 180000, intervals: [1000, 2000, 3000] }).toBe(true);
            expect(legacyJob.status, JSON.stringify(legacyJob)).toBe('SUCCESS');
            const value = legacyJob.resultJson ?? legacyJob.result;
            const result = typeof value === 'string' ? JSON.parse(value) : value;
            expect(result.exitCode).toBe(0);
            expect(result.hasTestFailures).toBe(false);
        });
        await test.step('Owner changes role/removes member; open Editor loses write/read rights', async () => {
            const members = (await jsonOK(await api('owner', 'GET', `/projects/${projectId}/members`))).data.members;
            const editor = members.find(row => row.user.email === accounts.editor.email);
            await ownerPage.goto(`/main-editor?projectId=${projectId}&tab=settings&setting=members`);
            await ownerPage.getByRole('button', { name: `Manage editor ${suffix}` }).click();
            await ownerPage.getByRole('menuitem', { name: 'Change to Viewer' }).click();
            await expect.poll(async () => (await (await api('editor', 'GET', `/projects/${projectId}/access`)).json()).data?.role).toBe('VIEWER');
            const currentMembers = (await jsonOK(await api('owner', 'GET', `/projects/${projectId}/members`))).data.members;
            const updated = currentMembers.find(row => row.id === editor.id);
            await jsonOK(await api('owner', 'DELETE', `/projects/${projectId}/members/${editor.id}`, { headers: { 'If-Match': String(updated.revision) } }));
            expect((await api('editor', 'GET', `/projects/${projectId}/members`)).status()).toBe(404);
            await expect(editorPage.getByText(/access.*removed|no longer.*access|Project access unavailable/i).first()).toBeVisible({ timeout: 20000 });
        });
        expect(pageErrors).toEqual([]);
    } finally {
        await testInfo.attach('browser-page-errors', { body: JSON.stringify(pageErrors), contentType: 'application/json' });
        for (const context of contexts) await context.close();
        // Preserve the scoped project as evidence on failure; never clear shared DB tables.
    }
});
