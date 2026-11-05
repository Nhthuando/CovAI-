import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from '../server/node_modules/socket.io/dist/index.js';
import * as Y from '../server/node_modules/yjs/dist/yjs.mjs';
import { chromium } from '../server/node_modules/playwright/index.mjs';
const http = createServer(), io = new Server(http, { cors: { origin: 'http://localhost:5173' } });
let connections = 0, workspaceRevision = 0;
const checkpointed = new Map();
const docs = new Map(), roles = new Map([['pm', ['files.write']], ['dev', ['files.write']], ['viewer', []]]);
let earlySent = false;
const namespace = io.of('/editor');
namespace.on('connection', socket => {
  connections++;
  const user = JSON.parse(Buffer.from(socket.handshake.auth.token.split('.')[1], 'base64').toString()).userId;
  socket.on('editor:open', (input, ack) => {
    let row = docs.get(input.path);
    if (!row) { const doc = new Y.Doc(); doc.getText('content').insert(0, '<html>shared baseline</html>\n'); row = { doc, revision: 0 }; docs.set(input.path, row); }
    socket.data.path = input.path;
    socket.join(input.path);
    const opened = { ok: true, documentId: input.path, generation: 1, projectId: 'project', snapshotId: 'snapshot', path: input.path, revision: row.revision, checkpointRevision: 0, stateBytes: Buffer.from(Y.encodeStateAsUpdate(row.doc)), capabilities: roles.get(user), workspaceRevision: 0 };
    if (process.argv.includes('--early') && !earlySent) {
      earlySent = true;
      const vector = Y.encodeStateVector(row.doc); row.doc.getText('content').insert(0, '<!-- during join -->'); row.revision++;
      socket.emit('editor:update', { documentId: input.path, generation: 1, revision: row.revision, updateBytes: Y.encodeStateAsUpdate(row.doc, vector) });
    }
    ack(opened);
  });
  socket.on('editor:update', (input, ack) => {
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
    console.log(`Opening ${userId}`);
    const context = await browser.newContext();
    await context.addInitScript(user => localStorage.setItem('token', `test.${btoa(JSON.stringify({ userId: user }))}.test`), userId);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    for (const pattern of ['**/src/lib/editor/ProjectEditorProvider*', '**/src/lib/editor/editorTransport*']) await page.route(pattern, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replaceAll('http://localhost:5000', `http://127.0.0.1:${port}`) });
    });
    await page.route('**/api/projects/project/access', route => route.fulfill({ json: { success: true, data: { role: userId === 'pm' ? 'OWNER' : userId === 'dev' ? 'EDITOR' : 'VIEWER', capabilities: ['project.read', ...roles.get(userId)], features: { liveEditing: true } } } }));
    await page.route('**/api/projects/project/editor/status?*', route => route.fulfill({json:{success:true,data:{workspaceRevision,documents:[...docs].map(([path,row])=>({documentId:path,path,generation:1,revision:row.revision,dirty:row.revision !== (row.checkpointRevision || 0)}))}}}));
    await page.route('**/api/projects/project/editor/checkpoint', async route => {
      const input = route.request().postDataJSON();
      assert.equal(input.expectedWorkspaceRevision,workspaceRevision);
      await new Promise(resolve => setTimeout(resolve,100));
      for (const requested of input.documents) {
        const row = docs.get(requested.documentId); assert.equal(requested.revision,row.revision);
        checkpointed.set(requested.documentId,row.doc.getText('content').toString()); row.checkpointRevision=row.revision;
      }
      workspaceRevision++;
      await route.fulfill({json:{success:true,data:{workspaceRevision,documents:input.documents.map(row=>({documentId:row.documentId,revision:row.revision}))}}});
    });
    await page.goto('http://localhost:5173/.evidence-review/collaboration-live.html', { waitUntil: 'domcontentloaded' });
    try { await page.waitForFunction(() => window.reviewEditor, null, { timeout: 30000 }); }
    catch (error) { console.log(JSON.stringify({ userId, text: await page.locator('body').innerText(), errors, serverDocuments: docs.size })); throw error; }
    console.log(`Mounted ${userId}`);
    try {
      await page.waitForFunction(expected => document.querySelector('.covai-live-status')?.textContent === expected, userId === 'viewer' ? 'View only' : 'Changes saved', { timeout: 15000 });
    } catch (error) {
      console.log(JSON.stringify({ userId, text: await page.locator('body').innerText(), errors, serverDocuments: docs.size })); throw error;
    }
    const readOnly = await page.evaluate(() => window.reviewEditor.getOption(window.reviewMonaco.editor.EditorOption.readOnly));
    assert.equal(readOnly, userId === 'viewer', `${userId} readOnly`);
    if (process.argv.includes('--early')) assert((await page.evaluate(() => window.reviewEditor.getValue())).includes('<!-- during join -->'));
    assert.deepEqual(errors, []);
    if (userId === 'viewer') await context.close(); else pages.push(page);
  }
  for (let i = 0; i < 2; i++) {
    await pages[i].evaluate(() => { window.reviewEditor.focus(); window.reviewEditor.setPosition({ lineNumber: 1, column: 1 }); });
    await pages[i].keyboard.insertText(i ? '<!-- dev -->' : '<!-- pm -->');
    await pages[i].waitForFunction(() => document.querySelector('.covai-live-status')?.textContent === 'Changes saved');
  }
  for (const page of pages) await page.waitForFunction(() => ['<!-- pm -->', '<!-- dev -->'].every(text => window.reviewEditor.getValue().includes(text)));
  assert(docs.get('index.html').doc.getText('content').toString().includes('<!-- dev -->'));
  const save = await pages[0].evaluate(async () => {
    const hookSource = await (await fetch('/src/hooks/useCollaborativeFile.js')).text();
    const registryUrl = hookSource.match(/from "([^"]*editorModelRegistry[^"]*)"/)[1];
    const registry = await import(registryUrl);
    return registry.saveActiveCollaborativeFile('project','snapshot','index.html',window.reviewEditor.getValue());
  });
  assert.equal(save.success,true);
  assert.equal(checkpointed.get('index.html'),await pages[0].evaluate(()=>window.reviewEditor.getValue()));
  await pages[0].waitForFunction(()=>document.querySelector('.covai-live-status')?.textContent === 'Saved to workspace');
  const beforeSwitch = connections;
  await pages[0].getByRole('button', { name: 'Switch file' }).click();
  await pages[0].waitForFunction(() => window.reviewEditor.getValue().includes('shared baseline') && !window.reviewEditor.getValue().includes('<!-- pm -->'));
  await pages[0].getByRole('button', { name: 'Switch file' }).click();
  await pages[0].waitForFunction(() => window.reviewEditor.getValue().includes('<!-- pm -->') && window.reviewEditor.getValue().includes('<!-- dev -->'));
  assert.equal(connections, beforeSwitch, 'File switching should reuse the authenticated socket');
  console.log('PASS: Save checkpoints current shared bytes and reports Saved to workspace; file switching reuses connection; actual Monaco + provider + hook under StrictMode; PM and Dev can type and sync; Viewer remains read-only. Isolated Socket.IO server; no Railway data modified.');
} finally { await browser.close(); await new Promise(resolve => io.close(resolve)); for (const row of docs.values()) row.doc.destroy(); }

