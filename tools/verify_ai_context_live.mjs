import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '../server/node_modules/@playwright/test/index.mjs';
const require = createRequire(new URL('../server/package.json', import.meta.url));
require('dotenv').config({ path: fileURLToPath(new URL('../server/.env', import.meta.url)), quiet: true });
const { default: prisma } = await import('../server/src/config/prisma.js');
const jwt = require('jsonwebtoken');
const base = process.env.CONTEXT_API_URL || 'http://127.0.0.1:5000/api';
const uiOnly = process.argv.includes('--ui-only');
let user;
let project;
try {
  user = await prisma.user.create({ data: { email: `context-check-${Date.now()}@example.invalid`, name: 'Context verification' } });
  project = await prisma.project.create({ data: { ownerId: user.id, name: `Context verification ${Date.now()}` } });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const call = async (suffix, method = 'GET', body, expected = 200) => {
    const response = await fetch(`${base}/projects/${project.id}${suffix}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
    const result = await response.json();
    assert.equal(response.status, expected, result.message || suffix);
    return result.data;
  };
  let settings = await call('/ai-context');
  assert.equal(settings.automaticMemory, false);
  const note = await call('/ai-context/memories', 'POST', { content: 'Use Jest for testing this project', pinned: true }, 201);
  const edited = await call(`/ai-context/memories/${note.id}`, 'PATCH', { content: note.content, pinned: false, revision: note.revision });
  assert.equal(edited.pinned, false);
  settings = await call('/ai-context', 'PUT', { automaticMemory: true, guidance: 'Reply concisely. Never claim tests were executed.', revision: settings.revision });
  const preview = await call('/ai-context/preview', 'POST', { useMemory: true });
  assert.equal(preview.memories[0].content, note.content);
  assert.equal((await call('/ai-context/preview', 'POST', { useMemory: false })).memories.length, 0);
  const original = await call('/chat/sessions', 'POST', { title: 'Original verification', useMemory: true }, 201);
  // Real model transport, server-side transcript persistence, queue and extraction.
  let reply;
  if (uiOnly) {
    const source = await prisma.chatMessage.create({ data: { sessionId: original.id, role: 'user', content: 'Completed todo items cannot be edited', createdAt: new Date(Date.now() - 10) } });
    await prisma.chatMessage.create({ data: { sessionId: original.id, role: 'assistant', content: 'Acknowledged', createdAt: new Date() } });
    const { memoryFingerprint } = await import('../server/src/services/projectMemory.service.js');
    await prisma.projectMemory.create({ data: { projectId: project.id, userId: user.id, content: source.content, fingerprint: memoryFingerprint(source.content), sourceMessageId: source.id } });
    reply = { reply: 'Acknowledged' };
  } else reply = await call('/chat', 'POST', { sessionId: original.id, useMemory: true, message: 'Remember this project rule: Completed todo items cannot be edited. Reply with one short acknowledgement.', attachments: [] });
  assert.ok(reply.reply.length > 0);
  console.log(uiOnly ? 'Seeded dedicated UI fixture (no model calls)' : 'PASS real Gemini chat and stored reply');
  const loaded = await call(`/chat/sessions/${original.id}`);
  assert.equal(loaded.messages.length, 2);
  const branch = await call(`/chat/sessions/${original.id}/branch`, 'POST', { useMemory: false }, 201);
  assert.equal((await call(`/chat/sessions/${branch.id}`)).messages.length, 2);
  assert.equal((await call('/ai-context/preview', 'POST', { sessionId: branch.id })).memoryEnabled, false);
  let status = 'PENDING';
  for (let attempts = 0; attempts < 30 && status === 'PENDING'; attempts++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    status = (await call(`/chat/sessions/${original.id}`)).session.contextStatus;
  }
  assert.equal(status, 'READY', 'Context maintenance must finish successfully');
  const memories = await call('/ai-context/memories');
  assert.ok(memories.some(row => row.sourceMessageId === loaded.messages[0].id && row.content.includes('Completed todo items cannot be edited')));
  console.log(uiOnly ? 'PASS stored source evidence' : 'PASS real queued extraction with source evidence');
  const newReply = uiOnly ? { sessionId: (await call('/chat/sessions', 'POST', { useMemory: true }, 201)).id,
    context: await call('/ai-context/preview', 'POST', { useMemory: true }), reply: 'cannot edit (fixture)' }
    : await call('/chat', 'POST', { useMemory: true, message: 'What is the rule for editing completed todo items? Answer in one sentence.', attachments: [] });
  assert.notEqual(newReply.sessionId, original.id);
  assert.ok(newReply.context.memories.some(row => row.content.includes('Completed todo items cannot be edited')));
  assert.match(newReply.reply, /cannot|can't|not|kh[oô]ng/i);
  console.log(uiOnly ? 'PASS new conversation context includes stored memory' : 'PASS new conversation recalls project memory');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.addInitScript(({ token, projectId, userId, sessionId }) => {
      localStorage.setItem('token', token);
      localStorage.setItem(`covai_chat_${userId}_${projectId}`, JSON.stringify({ id: sessionId, useMemory: true }));
    }, { token, projectId: project.id, userId: user.id, sessionId: original.id });
    // The API serves the production client; same origin avoids test-specific CORS changes.
    const uiBase = new URL(base); uiBase.hostname = 'localhost'; uiBase.pathname = '/main-editor';
    uiBase.searchParams.set('projectId', project.id);
    await page.goto(uiBase.toString());
    const openContext = async () => {
      await page.getByRole('button', { name: 'Choose AI conversation context' }).click();
      await page.getByText('Loading saved context...').waitFor({ state: 'hidden' });
    };
    await openContext();
    await page.getByRole('heading', { name: 'Original verification', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Memory & rules' }).click();
    await page.getByRole('button', { name: 'From: Original verification', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close context dialog' }).click();
    await page.reload();
    await openContext();
    await page.getByRole('tab', { name: 'Current context' }).click();
    await page.getByText('2 recent turns', { exact: true }).waitFor();
    console.log('PASS production UI with real API: sourced memory, conversation restore and reload');
  } finally { await browser.close(); }
  await call(`/chat/sessions/${original.id}`, 'DELETE');
  assert.equal((await call(`/chat/sessions/${branch.id}`)).messages.length, 2);
  assert.ok(!(await call('/ai-context/memories')).some(row => row.sourceMessageId === loaded.messages[0].id));
  await call('/ai-context/memories', 'DELETE');
  assert.equal((await call('/ai-context/memories')).length, 0);
  assert.equal((await call(`/chat/sessions/${branch.id}`)).messages.length, 2);
  console.log('PASS independent branch, deletion cascades, clear and disabled recall');
} finally {
  // Only this script's dedicated records; never touch an existing project or user.
  if (project) await prisma.project.deleteMany({ where: { id: project.id, ownerId: user.id, name: { startsWith: 'Context verification ' } } });
  if (user) await prisma.user.deleteMany({ where: { id: user.id, email: { startsWith: 'context-check-' } } });
  await prisma.$disconnect();
}
