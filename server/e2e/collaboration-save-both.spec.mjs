import { test, expect } from '@playwright/test';
import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';

const API = 'http://127.0.0.1:55000/api';
const PASSWORD = 'Collaboration-local-123!';

test('coverage Save both reports partial success without resaving its committed source or losing the test draft', async ({ browser, request }, testInfo) => {
    if (process.env.COLLABORATION_E2E_ENABLED !== 'true') throw new Error('Use the isolated collaboration runner');
    const suffix = randomUUID().slice(0, 8);
    const email = `save-both-${suffix}@covai.test`;
    const registered = await request.post(`${API}/auth/register`, { data: { name: `Save Both ${suffix}`, email, password: PASSWORD } });
    expect(registered.ok()).toBe(true);
    const token = (await registered.json()).accessToken;
    const headers = { Authorization: `Bearer ${token}` };
    const api = (method, path, data) => request.fetch(`${API}${path}`, { method, headers, ...(data ? { data } : {}) });
    const ok = async response => { expect(response.ok(), `HTTP ${response.status()}`).toBe(true); return response.json(); };
    const projectId = (await ok(await api('POST', '/projects', { name: `Save both ${suffix}` }))).data.id;
    const source = 'function sum(a,b){return a+b;}\nmodule.exports={sum};\n';
    const testCode = "const {sum}=require('../src/sum');\ntest('adds values',()=>expect(sum(2,3)).toBe(5));\n";
    const zip = new AdmZip();
    zip.addFile('package.json', Buffer.from(JSON.stringify({ name: `save-both-${suffix}`, version: '1.0.0', scripts: { test: 'jest --runInBand --coverage' }, devDependencies: { jest: '29.7.0' }, jest: { testEnvironment: 'node', collectCoverageFrom: ['src/**/*.js'] } })));
    zip.addFile('src/sum.js', Buffer.from(source));
    zip.addFile('tests/sum.test.js', Buffer.from(testCode));
    await ok(await request.post(`${API}/projects/${projectId}/upload-zip`, { headers, multipart: { file: { name: 'save-both.zip', mimeType: 'application/zip', buffer: zip.toBuffer() } } }));
    let snapshotId;
    await expect.poll(async () => {
        const response = await api('GET', `/projects/${projectId}/tree`);
        if (!response.ok()) return false;
        const tree = await response.json(); snapshotId = tree.snapshotId;
        return !!snapshotId && tree.data.some(row => row.name === 'src');
    }, { timeout: 60000 }).toBe(true);
    const started = await ok(await api('POST', `/projects/${projectId}/run-analysis`, { snapshotId, requestId: randomUUID() }));
    const jobId = started.data?.job?.id || started.job?.id;
    expect(jobId).toBeTruthy();
    let job;
    await expect.poll(async () => {
        const response = await ok(await api('GET', `/job/${jobId}`));
        job = response.data || response.job || response;
        return ['SUCCESS', 'FAILED', 'CANCELED'].includes(job.status);
    }, { timeout: 180000, intervals: [1000, 2000, 3000] }).toBe(true);
    expect(job.status).toBe('SUCCESS');

    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:55173', viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    try {
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto('/login');
        await page.locator('#auth-email').fill(email);
        await page.locator('#auth-password').fill(PASSWORD);
        await page.locator('#auth-submit-btn').click();
        await expect(page).toHaveURL(/\/projects$/);
        await page.goto(`/main-editor?projectId=${projectId}&tab=coverage&type=unit`);
        await page.getByTitle('Click to filter by Statement coverage', { exact: true }).click();
        await page.getByText('src/sum.js', { exact: true }).first().click();
        await page.getByRole('button', { name: 'Edit Code', exact: true }).click();
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        const editors = page.getByRole('textbox', { name: 'Editor content', exact: true });
        await expect(editors).toHaveCount(2);
        const originalTest = (await ok(await api('GET', `/projects/${projectId}/file-content?snapshotId=${snapshotId}&path=tests/sum.test.js`))).data;
        const sourceDraft = `${source}// committed source draft ${suffix}\n`;
        const testDraft = `${testCode}// preserved local test draft ${suffix}\n`;
        const remoteTest = `${testCode}// remote test edit ${suffix}\n`;
        for (const [index, content] of [[0, sourceDraft], [1, testDraft]]) {
            await editors.nth(index).focus();
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.insertText(content);
        }
        await ok(await api('PUT', `/projects/${projectId}/file-content`, { snapshotId, path: 'tests/sum.test.js', content: remoteTest, expectedVersion: originalTest.version, requestId: randomUUID() }));
        const writes = [];
        page.on('request', item => { if (item.method() === 'PUT' && item.url().includes('/file-content')) writes.push(item.postDataJSON()); });
        const savedSource = page.waitForResponse(item => item.request().method() === 'PUT' && item.url().includes('/file-content') && item.request().postDataJSON().path === 'src/sum.js');
        const conflictingTest = page.waitForResponse(item => item.request().method() === 'PUT' && item.url().includes('/file-content') && item.request().postDataJSON().path === 'tests/sum.test.js');
        await page.getByTitle('Save source file & test file to disk (Ctrl+S)', { exact: true }).click();
        expect((await savedSource).status()).toBe(200);
        expect((await conflictingTest).status()).toBe(409);
        await expect(page.getByText(/Source file saved\. The test file was not saved; its draft is preserved\./)).toBeVisible();
        const sourceAfter = (await ok(await api('GET', `/projects/${projectId}/file-content?snapshotId=${snapshotId}&path=src/sum.js`))).data;
        expect(sourceAfter.content).toBe(sourceDraft);
        expect((await ok(await api('GET', `/projects/${projectId}/file-content?snapshotId=${snapshotId}&path=tests/sum.test.js`))).data.content).toBe(remoteTest);
        await expect(page.locator('.monaco-editor').filter({ visible: true }).nth(1)).toContainText(`preserved local test draft ${suffix}`);

        const retry = page.waitForResponse(item => item.request().method() === 'PUT' && item.url().includes('/file-content') && item.request().postDataJSON().path === 'tests/sum.test.js');
        await page.getByTitle('Save source file & test file to disk (Ctrl+S)', { exact: true }).click();
        expect((await retry).status()).toBe(409);
        expect(writes.filter(item => item.path === 'src/sum.js')).toHaveLength(1);
        expect(writes.filter(item => item.path === 'tests/sum.test.js')).toHaveLength(2);
        expect(writes.filter(item => item.path === 'tests/sum.test.js').every(item => item.expectedVersion.revision === originalTest.version.revision)).toBe(true);
        expect((await ok(await api('GET', `/projects/${projectId}/file-content?snapshotId=${snapshotId}&path=src/sum.js`))).data.version).toEqual(sourceAfter.version);
        await page.screenshot({ path: testInfo.outputPath('save-both-partial-conflict.png'), fullPage: true });
        expect(pageErrors).toEqual([]);
    } finally {
        await context.close();
    }
});
