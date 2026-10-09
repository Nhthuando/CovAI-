import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '../server/node_modules/@playwright/test/index.mjs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
const project = { id: 'demo-project', name: 'CovAI - Dự án kiểm thử', latestSnapshotId: 'snapshot-new' };
const snapshots = [
  { id: 'snapshot-new', source: 'GITHUB', label: 'Latest analysis', createdAt: '2026-10-09T06:30:00Z', isCurrent: true },
  { id: 'snapshot-old', source: 'ZIP', label: 'Initial import', createdAt: '2026-10-08T06:30:00Z', isCurrent: false },
];
const pdf = await fs.readFile('output/pdf/covai-analysis-report-demo.pdf');
const exportRequests = [];
let failExport = false;
let failNetwork = false;
let failSnapshots = false;
await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url());
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Disposition' };
  if (url.pathname.endsWith('/export')) {
    if (failNetwork) return route.abort('failed');
    exportRequests.push({ snapshotId: url.searchParams.get('snapshotId'), type: url.searchParams.get('type'), format: url.searchParams.get('format'), auth: route.request().headers().authorization });
    if (failExport) return route.fulfill({ status: 409, headers, json: { message: 'Snapshot source is unavailable; import or restore it before exporting' } });
    const format = url.searchParams.get('format') || 'zip';
    return route.fulfill({ headers: { ...headers, 'Content-Disposition': `attachment; filename="covai-demo.${format}"` }, contentType: format === 'pdf' ? 'application/pdf' : 'application/json', body: format === 'pdf' ? pdf : JSON.stringify({ snapshotId: url.searchParams.get('snapshotId') }) });
  }
  if (url.pathname.endsWith('/snapshots')) return route.fulfill({ headers, status: failSnapshots ? 500 : 200, json: failSnapshots ? { message: 'Could not load snapshots.' } : { success: true, data: snapshots } });
  if (url.pathname.endsWith('/projects')) return route.fulfill({ headers, json: { success: true, projects: [project] } });
  if (url.pathname.endsWith('/tree')) return route.fulfill({ headers, json: { data: [{ id: 'src', name: 'src', type: 'folder', children: [{ id: 'src/app.js', name: 'app.js', type: 'file' }] }] } });
  if (url.pathname.endsWith('/structure-analysis') || url.pathname.endsWith('/quality-report')) return route.fulfill({ headers, json: { success: true, data: null } });
  return route.fulfill({ headers, json: { success: true, data: [], jobs: [], notifications: [], unreadCount: 0, count: 0 } });
});
await page.addInitScript(() => {
  const payload = btoa(JSON.stringify({ userId: 'demo-user', userName: 'Export Reviewer', exp: 2000000000 }));
  localStorage.setItem('token', `e30.${payload}.demo-only`);
  localStorage.setItem('covai_theme', 'light');
});
await page.goto(`${process.env.EXPORT_UI_BASE_URL || 'http://127.0.0.1:5175'}/main-editor?projectId=demo-project`);
await fs.mkdir('output/export-preview', { recursive: true });
await page.screenshot({ path: 'output/export-preview/studio-before-export.png' });
console.log('Initial dialogs:', await page.locator('dialog').count());
await page.getByRole('button', { name: 'Export project and analysis' }).click();
const dialog = page.getByRole('dialog');
await dialog.waitFor();
await page.getByLabel('Snapshot', { exact: true }).selectOption('snapshot-new');
await fs.mkdir('output/export-preview', { recursive: true });
await page.screenshot({ path: 'output/export-preview/export-dialog-desktop.png' });
assert.equal(await page.getByRole('button', { name: 'Download PDF' }).isEnabled(), true);
// Native dialog keyboard focus cannot escape to the Studio toolbar.
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
}
await page.getByLabel('Snapshot', { exact: true }).selectOption('snapshot-old');
const pdfDownload = page.waitForEvent('download');
await page.getByRole('button', { name: 'Download PDF' }).click();
const downloadedPdf = await pdfDownload;
assert.equal(downloadedPdf.suggestedFilename(), 'covai-demo.pdf');
await dialog.waitFor({ state: 'detached' });
assert.equal(exportRequests[0].snapshotId, 'snapshot-old');
assert.equal(exportRequests[0].format, 'pdf');
assert.match(exportRequests[0].auth, /^Bearer /);

await page.getByRole('button', { name: 'Export project and analysis' }).click();
await page.getByRole('radio', { name: /Analysis data/ }).check();
const jsonDownload = page.waitForEvent('download');
await page.getByRole('button', { name: 'Download JSON' }).click();
assert.equal((await jsonDownload).suggestedFilename(), 'covai-demo.json');
await dialog.waitFor({ state: 'detached' });

// A transport failure must allow a clean retry; rapid submit events send one request.
failNetwork = true;
await page.getByRole('button', { name: 'Export project and analysis' }).click();
await page.getByRole('button', { name: 'Download PDF' }).click();
await page.getByRole('alert').filter({ hasText: /Connection interrupted/ }).waitFor();
failNetwork = false;
const retryDownload = page.waitForEvent('download');
const beforeRetry = exportRequests.length;
await dialog.locator('form').evaluate(form => {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
});
await retryDownload;
await dialog.waitFor({ state: 'detached' });
assert.equal(exportRequests.length, beforeRetry + 1);
assert.equal(await page.getByRole('alert').filter({ hasText: /Connection interrupted/ }).count(), 0);

await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Export project and analysis' }).click();
await page.getByRole('radio', { name: /Project source/ }).check();
await page.waitForTimeout(200);
await page.screenshot({ path: 'output/export-preview/export-dialog-mobile.png' });
const box = await dialog.boundingBox();
assert.ok(box.x >= 0 && box.x + box.width <= 391, 'dialog overflows mobile viewport');
failExport = true;
await page.getByRole('button', { name: 'Download ZIP' }).click();
await page.getByRole('alert').filter({ hasText: /Snapshot source is unavailable/ }).waitFor();
assert.equal(await page.getByRole('button', { name: 'Download ZIP' }).isEnabled(), true);
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached' });
assert.equal(await page.getByRole('button', { name: 'Export project and analysis' }).evaluate((button) => button === document.activeElement), true);

failSnapshots = true;
await page.getByRole('button', { name: 'Export project and analysis' }).click();
await page.getByRole('alert').filter({ hasText: /Could not load snapshots/ }).waitFor();
assert.equal(await page.getByRole('button', { name: 'Download PDF' }).isEnabled(), false);
failSnapshots = false;
await page.getByRole('button', { name: 'Retry' }).click();
await page.getByLabel('Snapshot', { exact: true }).selectOption('snapshot-new');
assert.equal(await page.getByRole('button', { name: 'Download PDF' }).isEnabled(), true);
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 1440, height: 960 });
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await page.getByRole('button', { name: 'Export project and analysis' }).click();
await page.getByLabel('Snapshot', { exact: true }).selectOption('snapshot-new');
await page.screenshot({ path: 'output/export-preview/export-dialog-dark.png' });
await page.keyboard.press('Escape');
await browser.close();
console.log('UI checks passed: desktop/mobile layout, focus trap, snapshot selection, PDF/JSON download, auth header, recoverable error, Escape and retry. API responses were mocked.');
