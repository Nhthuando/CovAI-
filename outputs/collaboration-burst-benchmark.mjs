import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from '../server/node_modules/socket.io/dist/index.js';
import * as Y from '../server/node_modules/yjs/dist/yjs.mjs';
import { chromium } from '../server/node_modules/playwright/index.mjs';
const http = createServer(), io = new Server(http, { cors: { origin: 'http://localhost:5173' } });
const legacy = process.argv.includes('--legacy');
let writes = 0;
const docs = new Map(), roles = new Map([['pm', ['files.write']], ['dev', ['files.write']], ['viewer', []]]);
const namespace = io.of('/editor');
namespace.on('connection', socket => {
  const user = JSON.parse(Buffer.from(socket.handshake.auth.token.split('.')[1], 'base64').toString()).userId;
  socket.on('editor:open', (input, ack) => {
    let row = docs.get(input.path);
    if (!row) { const doc = new Y.Doc(); doc.getText('content').insert(0, '<html>shared baseline</html>\n'); row = { doc, revision: 0 }; docs.set(input.path, row); }
    socket.data.path = input.path;
    socket.join(input.path);
    ack({ ok: true, documentId: input.path, generation: 1, projectId: 'project', snapshotId: 'snapshot', path: input.path, revision: row.revision, checkpointRevision: 0, stateBytes: Buffer.from(Y.encodeStateAsUpdate(row.doc)), capabilities: roles.get(user), workspaceRevision: 0 });
  });
  socket.on('editor:update', async (input, ack) => {
    await new Promise(resolve => setTimeout(resolve, 300)); writes++;
    if (!roles.get(user).includes('files.write')) return ack({ ok: false, code: 'CAPABILITY_DENIED', message: 'View only' });
    const row = docs.get(input.documentId); Y.applyUpdate(row.doc, input.updateBytes); row.revision++;
    socket.to(input.documentId).emit('editor:update', { documentId: input.documentId, generation: 1, revision: row.revision, updateBytes: input.updateBytes });
    ack({ ok: true, requestId: input.requestId, revision: row.revision });
  });
});
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const port = http.address().port;
const browser = await chromium.launch({ executablePath: 'C:/Users/thuan/.agent-browser/browsers/chrome-153.0.8010.47/chrome.exe', headless: true });
try {
  const pages = [];
  for (const userId of ['viewer', 'pm', 'dev']) {
    
    const context = await browser.newContext();
    await context.addInitScript(user => localStorage.setItem('token', `test.${btoa(JSON.stringify({ userId: user }))}.test`), userId);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    for (const pattern of ['**/src/lib/editor/ProjectEditorProvider*', '**/src/lib/editor/editorTransport*']) await page.route(pattern, async route => {
      const response = await route.fetch();
      let body = (await response.text()).replaceAll('http://localhost:5000', `http://127.0.0.1:${port}`);
      if (legacy && route.request().url().includes('ProjectEditorProvider')) {
        const marker = 'enqueueEditorUpdate(this.queue,';
        assert(body.includes(marker), 'Legacy patch must find the real queue call');
        body = body.replace(/enqueueEditorUpdate\(this\.queue,[\s\S]*?\n\s*\}\);/, "this.queue.push({ requestId: crypto.randomUUID(), bytes: encodeBytes(bytes) });");
        body = body.replace('if (!this.batchTimer) this.batchTimer = setTimeout', 'clearTimeout(this.batchTimer); this.batchTimer = setTimeout').replace('}, EDITOR_LIMITS.batchMs);', '}, 150);');
        assert(!body.includes(marker), 'Legacy queue replacement must apply');
      }
      await route.fulfill({ response, body });
    });
    await page.route('**/api/projects/project/access', route => route.fulfill({ json: { success: true, data: { role: userId === 'pm' ? 'OWNER' : userId === 'dev' ? 'EDITOR' : 'VIEWER', capabilities: ['project.read', ...roles.get(userId)], features: { liveEditing: true } } } }));
    await page.goto('http://localhost:5173/.evidence-review/collaboration-live.html', { waitUntil: 'domcontentloaded' });
    try { await page.waitForFunction(() => window.reviewEditor, null, { timeout: 30000 }); }
    catch (error) { console.log(JSON.stringify({ userId, text: await page.locator('body').innerText(), errors, serverDocuments: docs.size })); throw error; }
    
    try {
      await page.waitForFunction(expected => document.querySelector('.covai-live-status')?.textContent === expected, userId === 'viewer' ? 'View only' : 'Changes saved', { timeout: 15000 });
    } catch (error) {
      console.log(JSON.stringify({ userId, text: await page.locator('body').innerText(), errors, serverDocuments: docs.size })); throw error;
    }
    const readOnly = await page.evaluate(() => window.reviewEditor.getOption(window.reviewMonaco.editor.EditorOption.readOnly));
    assert.equal(readOnly, userId === 'viewer', `${userId} readOnly`);
    assert.deepEqual(errors, []);
    if (userId === 'viewer') await context.close(); else pages.push(page);
  }
  const marker = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ01234567';
  for (const page of pages) await page.evaluate(marker => {
    window.samples = [];
    window.reviewEditor.onDidChangeModelContent(() => {
      const value = window.reviewEditor.getValue();
      let count = 0; while (count < marker.length && value[count] === marker[count]) count++;
      window.samples.push({ count, at: Date.now() });
    });
  }, marker);
  await pages[0].evaluate(() => { window.reviewEditor.focus(); window.reviewEditor.setPosition({ lineNumber: 1, column: 1 }); });
  await pages[0].keyboard.type(marker, { delay: 10 });
  const typingFinished = Date.now();
  await pages[1].waitForFunction(marker => window.reviewEditor.getValue().startsWith(marker), marker, { timeout: 30000 });
  await pages[0].waitForFunction(() => document.querySelector('.covai-live-status')?.textContent === 'Changes saved');
  const local = await pages[0].evaluate(() => window.samples), remote = await pages[1].evaluate(() => window.samples);
  const latencies = local.filter(row => row.count > 0).map(row => remote.find(received => received.count >= row.count).at - row.at).sort((a,b) => a-b);
  const result = { mode: legacy ? 'legacy per-key FIFO' : 'merged pending batches', injectedDurableDelayMs: 300, characters: marker.length, databaseWrites: writes,
    remoteLatencyP50Ms: latencies[Math.floor(latencies.length * .5)], remoteLatencyP95Ms: latencies[Math.floor(latencies.length * .95)],
    lagAfterTypingMs: Math.max(0, remote.find(row => row.count === marker.length).at - typingFinished) };
  console.log(JSON.stringify(result));
  assert.equal(docs.get('index.html').doc.getText('content').toString(), await pages[0].evaluate(() => window.reviewEditor.getValue()));
  if (!legacy) { assert(writes <= 10); assert(result.lagAfterTypingMs < 1200); }

} finally { await browser.close(); await new Promise(resolve => io.close(resolve)); for (const row of docs.values()) row.doc.destroy(); }
