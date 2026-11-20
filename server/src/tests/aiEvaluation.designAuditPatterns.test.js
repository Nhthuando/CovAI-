import { describe, test, expect, afterAll } from '@jest/globals';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const { analyzeChatbotWorkspace } = await import('../services/aiEvaluation/designAudit.service.js');
const { executeTurn, createManagedLoopbackLease } = await import('../services/aiEvaluation/httpJson.adapter.js');

// A small real-world pattern: the system prompt is built by a helper function,
// the request body is { message, history }, and error details are shown only in development.
const helperPromptChatbot = `
import express from 'express';
import { GoogleGenAI } from '@google/genai';
const app = express();
app.use(express.json());
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function buildSystemInstruction(knowledgeBaseText) {
  return \`You are the shop assistant. Answer ONLY based on the provided documentation below.
If the answer is not in the documentation, say you do not have that information. Refuse out-of-scope requests.
=== DOCUMENTATION ===
\${knowledgeBaseText}\`;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || message.length > 2000) return res.status(400).json({ error: 'Invalid message' });
    const systemInstruction = buildSystemInstruction('FAQ');
    const contents = (history || []).map(turn => ({ role: turn.role === 'user' ? 'user' : 'model', parts: [{ text: turn.text }] }));
    contents.push({ role: 'user', parts: [{ text: message }] });
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents, config: { systemInstruction } });
    return res.json({ reply: response.text });
  } catch (error) {
    return res.status(500).json({
      error: 'Something went wrong.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});
app.listen(process.env.PORT || 3000);
`;

const tempDirs = [];
async function makeWorkspace(files) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-audit-patterns-'));
    tempDirs.push(dir);
    for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(dir, name), content);
    return dir;
}

afterAll(async () => {
    await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('Design audit: helper-built prompts, { message, history } bodies and dev-only error details', () => {
    test('finds a system prompt returned by a local helper and does not report CB-SEC-02', async () => {
        const dir = await makeWorkspace({
            'package.json': JSON.stringify({ name: 'shop', type: 'module', dependencies: { express: '^4.21.2', '@google/genai': '^2.0.0' } }),
            'server.js': helperPromptChatbot,
        });
        const audit = await analyzeChatbotWorkspace(dir);
        expect(audit.detected).toBe(true);
        expect(audit.summary.systemPrompts.length).toBeGreaterThan(0);
        const ruleIds = audit.findings.map(f => f.ruleId);
        expect(ruleIds).not.toContain('CB-SEC-02');
        expect(ruleIds).not.toContain('CB-REL-03');
    });

    test('auto-fills { message, history } bindings for that request shape', async () => {
        const dir = await makeWorkspace({
            'package.json': JSON.stringify({ name: 'shop', type: 'module', dependencies: { express: '^4.21.2', '@google/genai': '^2.0.0' } }),
            'server.js': helperPromptChatbot,
        });
        const audit = await analyzeChatbotWorkspace(dir);
        expect(audit.autoFillConfig).toMatchObject({
            conversationMode: 'messages',
            bindings: { '/message': 'latestUserMessage', '/history': 'history' },
            responsePointer: '/reply',
        });
        expect(audit.summary.endpoints.find(e => e.endpointPath === '/api/chat').requestFormat).toBe('message + history');
    });

    test('still reports CB-REL-03 when raw error details are always returned', async () => {
        const leaky = helperPromptChatbot.replace(
            "details: process.env.NODE_ENV === 'development' ? error.message : undefined,",
            'details: error.message,',
        );
        const dir = await makeWorkspace({
            'package.json': JSON.stringify({ name: 'shop', type: 'module', dependencies: { express: '^4.21.2', '@google/genai': '^2.0.0' } }),
            'server.js': leaky,
        });
        const audit = await analyzeChatbotWorkspace(dir);
        expect(audit.findings.map(f => f.ruleId)).toContain('CB-REL-03');
    });

    test('executeTurn sends the latest message and only the prior turns as history', async () => {
        const bodies = [];
        const server = http.createServer((req, res) => {
            let raw = '';
            req.on('data', chunk => { raw += chunk; });
            req.on('end', () => {
                bodies.push(JSON.parse(raw));
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ reply: 'ok' }));
            });
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const lease = createManagedLoopbackLease({ port: server.address().port, pid: process.pid });
            const config = {
                executionMode: 'MANAGED_PROJECT',
                endpointPath: '/api/chat',
                bindings: { '/message': 'latestUserMessage', '/history': 'history' },
                response: { format: 'json', answer: '/reply' },
            };
            const result = await executeTurn(config, {
                messages: [
                    { role: 'user', content: 'How much is shipping?' },
                    { role: 'assistant', content: 'Shipping is $6.99.' },
                    { role: 'user', content: 'And for orders over $60?' },
                ],
            }, { lease });
            expect(result.answer).toBe('ok');
            expect(bodies[0]).toEqual({
                message: 'And for orders over $60?',
                history: [
                    { role: 'user', content: 'How much is shipping?', text: 'How much is shipping?' },
                    { role: 'assistant', content: 'Shipping is $6.99.', text: 'Shipping is $6.99.' },
                ],
            });

            await executeTurn(config, { messages: [{ role: 'user', content: 'Hi' }] }, { lease });
            expect(bodies[1]).toEqual({ message: 'Hi', history: [] });
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
});
