import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '../server/node_modules/@playwright/test/index.mjs';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const project = { id: 'demo-project', name: 'Context demo', latestSnapshotId: 'snapshot-new' };
  let settings = { automaticMemory: false, guidance: '', revision: 0 };
  let notes = [];
  let branchCount = 0;
  let failSettings = false;
  const session = { id: 'session-old', title: 'Todo decisions', useMemory: true, snapshotId: 'snapshot-old', updatedAt: new Date().toISOString(), _count: { messages: 2 }, messages: [{ content: 'Completed items cannot be edited' }] };
  const transcript = [{ id: 'm1', role: 'user', content: 'Completed items cannot be edited', createdAt: new Date().toISOString() }, { id: 'm2', role: 'assistant', content: 'I will follow that rule.', createdAt: new Date().toISOString() }];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const input = route.request().postDataJSON();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    const send = data => route.fulfill({ headers, json: { success: true, data } });
    if (method === 'OPTIONS') return route.fulfill({ headers, status: 204 });
    if (path.endsWith('/ai-context')) { if (failSettings) return route.fulfill({ headers, status: 503, json: { message: 'Context temporarily unavailable' } }); if (method === 'PUT') settings = { ...input, revision: settings.revision + 1 }; return send(settings); }
    if (path.endsWith('/ai-context/preview')) return send({ snapshot: { id: 'snapshot-new', commitSha: 'abc123' }, memoryEnabled: settings.automaticMemory && input?.useMemory !== false, memories: notes, recentTurnCount: input?.sessionId ? 2 : 0, warnings: input?.sessionId === 'session-old' ? ['This conversation started on another snapshot. Historical code claims may be outdated.'] : [], guidance: settings.guidance });
    if (path.endsWith('/ai-context/memories')) {
      if (method === 'POST') notes.push({ id: 'note-1', ...input, status: 'ACTIVE', revision: 0 });
      if (method === 'DELETE') notes = [];
      return send(method === 'POST' ? notes.at(-1) : notes);
    }
    if (path.endsWith('/branch')) { branchCount++; return send({ ...session, id: 'branch-new', sourceSessionId: session.id }); }
    if (/\/chat\/sessions\/[^/]+$/.test(path)) return send({ session: { ...session, id: path.split('/').at(-1), ...(path.includes('branch-new') ? { sourceSessionId: session.id } : {}) }, messages: transcript });
    if (path.endsWith('/chat/sessions')) return send([session]);
    if (path.endsWith('/projects')) return route.fulfill({ headers, json: { success: true, projects: [project] } });
    if (path.endsWith('/tree')) return send([]);
    if (path.endsWith('/snapshots')) return send([{ id: 'snapshot-new', source: 'GITHUB', isCurrent: true, createdAt: new Date().toISOString() }]);
    if (path.endsWith('/structure-analysis') || path.endsWith('/quality-report')) return send(null);
    return route.fulfill({ headers, json: { success: true, data: [], jobs: [], notifications: [], unreadCount: 0, count: 0 } });
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', `e30.${btoa(JSON.stringify({ userId: 'demo-user', userName: 'Context reviewer', exp: 2000000000 }))}.test`);
    localStorage.setItem('covai_theme', 'light');
  });
  await page.goto(`${process.env.CONTEXT_UI_URL || 'http://127.0.0.1:5175'}/main-editor?projectId=demo-project`);
  const open = async () => { await page.getByRole('button', { name: 'Choose AI conversation context' }).click(); await page.getByRole('tab', { name: 'Memory & rules' }).waitFor(); await page.getByText('Loading saved context...').waitFor({ state: 'hidden' }); };
  await open();
  await page.getByRole('tab', { name: 'Memory & rules' }).click();
  await page.getByLabel('Automatic project memory', { exact: true }).check();
  await page.getByLabel('Approved project rules', { exact: true }).fill('Use Jest and reply concisely.');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByText('Settings saved', { exact: true }).waitFor();
  await page.getByLabel('Memory note', { exact: true }).fill('Completed items cannot be edited');
  await page.getByLabel('Pin this note for future chats').check();
  await page.getByRole('button', { name: 'Add memory', exact: true }).click();
  await page.getByRole('heading', { name: 'Saved memories (1)' }).waitFor();
  await fs.mkdir('output/context-preview', { recursive: true });
  await page.screenshot({ path: 'output/context-preview/memory-desktop.png' });
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
  }
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByText('I will follow that rule.', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('I will follow that rule.', { exact: true }).waitFor();
  await open();
  await page.getByRole('button', { name: 'Create branch', exact: true }).click();
  await page.getByText(/Historical code claims may be outdated/).waitFor();
  await page.getByRole('button', { name: 'Confirm branch', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(branchCount, 1);
  await open();
  await page.getByLabel('Use saved project memory', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.getByText('I will follow that rule.', { exact: true }).count(), 0);
  await page.reload();
  await open();
  assert.equal(await page.getByLabel('Use saved project memory', { exact: true }).isChecked(), false);
  await page.getByRole('tab', { name: 'Memory & rules' }).click();
  await page.getByRole('button', { name: 'Clear all memory', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm clear memory', exact: true }).click();
  await page.getByRole('heading', { name: 'Saved memories (0)' }).waitFor();
  await page.getByRole('button', { name: 'Close context dialog' }).click();
  failSettings = true;
  await open();
  await page.getByRole('alert').filter({ hasText: 'Context temporarily unavailable' }).waitFor();
  failSettings = false;
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await page.getByText('Loading saved context...').waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: 'Memory & rules' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/context-preview/memory-mobile.png' });
  assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS settings, notes, focus trap, resume/refresh, branch, new/refresh, memory off, clear, error recovery, mobile and browser errors');
} finally { await browser.close(); }
