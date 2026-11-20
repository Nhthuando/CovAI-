import { test, expect, afterAll } from '@jest/globals';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const { analyzeChatbotWorkspace } = await import('../services/aiEvaluation/designAudit.service.js');
const { executeTurn, createManagedLoopbackLease } = await import('../services/aiEvaluation/httpJson.adapter.js');

const grounded = 'Only answer based on the provided documents. If the answer is not in the documents, say you do not know. Refuse out-of-scope requests.';
const tempDirs = [];

async function makeWorkspace(files) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-audit-corpus-'));
    tempDirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
        const target = path.join(dir, name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
    }
    return dir;
}

afterAll(async () => {
    await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function auditBackend(body, reply = 'res.json({ answer: r.text });', extraFiles = {}) {
    const dir = await makeWorkspace({
        'backend/package.json': JSON.stringify({ dependencies: { express: '^4.21.2', openai: '^4.0.0' }, scripts: { start: 'node server.js' } }),
        'backend/server.js': `
const express = require('express');
const OpenAI = require('openai');
const app = express();
const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.post('/api/chat', async (req, res) => {
    ${body}
    const r = await ai.chat.completions.create({ messages: [{ role: 'system', content: ${JSON.stringify(grounded)} }] });
    ${reply}
});
`,
        ...extraFiles,
    });
    return analyzeChatbotWorkspace(dir);
}

test('CommonJS backend infers message and conversationHistory', async () => {
    const audit = await auditBackend('const { message, conversationHistory } = req.body;');
    expect(audit.autoFillConfig.bindings).toEqual({ '/message': 'latestUserMessage', '/conversationHistory': 'history' });
});

test('question body access uses messages mode with a latest question binding', async () => {
    const audit = await auditBackend('const question = req.body.question;');
    expect(audit.autoFillConfig.bindings).toEqual({ '/question': 'latestUserMessage' });
    expect(audit.autoFillConfig.conversationMode).toBe('messages');
});

test('prompt body and res.send infer a plain-text response', async () => {
    const audit = await auditBackend('const { prompt } = req.body;', 'res.send(r.text);');
    expect(audit.autoFillConfig.bindings).toEqual({ '/prompt': 'latestUserMessage' });
    expect(audit.autoFillConfig.responseFormat).toBe('text');
});

test('message and sessionId infer session input and output mappings', async () => {
    const audit = await auditBackend('const { message, sessionId } = req.body;');
    expect(audit.autoFillConfig.conversationMode).toBe('session');
    expect(audit.autoFillConfig.bindings).toEqual({ '/message': 'latestUserMessage', '/sessionId': 'conversationId' });
    expect(audit.autoFillConfig.responseConversationIdPointer).toBe('/sessionId');
});

test('resolves grounded prompts read from text files', async () => {
    const dir = await makeWorkspace({
        'server.js': `import fs from 'node:fs'; import OpenAI from 'openai';
const ai = new OpenAI();
const systemPrompt = fs.readFileSync('./prompts/system.txt', 'utf8');
ai.chat.completions.create({ messages: [{ role: 'system', content: systemPrompt }] });`,
        'prompts/system.txt': grounded,
    });
    const audit = await analyzeChatbotWorkspace(dir);
    expect(audit.findings.map(f => f.ruleId)).not.toContain('CB-SEC-02');
    expect(audit.summary.systemPrompts.length).toBeGreaterThan(0);
});

test('resolves imported grounded system prompts', async () => {
    const dir = await makeWorkspace({
        'prompt.js': `export const SYSTEM_PROMPT = ${JSON.stringify(grounded)};`,
        'server.js': `import OpenAI from 'openai'; import { SYSTEM_PROMPT } from './prompt.js';
const ai = new OpenAI();
ai.chat.completions.create({ messages: [{ role: 'system', content: SYSTEM_PROMPT }] });`,
    });
    const audit = await analyzeChatbotWorkspace(dir);
    expect(audit.findings.map(f => f.ruleId)).not.toContain('CB-SEC-02');
});

test('recognizes LangChain system tuples', async () => {
    const dir = await makeWorkspace({
        'server.js': `import { ChatOpenAI } from '@langchain/openai';
const llm = new ChatOpenAI();
llm.invoke([['system', ${JSON.stringify(grounded)}], ['human', message]]);`,
    });
    const audit = await analyzeChatbotWorkspace(dir);
    expect(audit.findings.map(f => f.ruleId)).not.toContain('CB-SEC-02');
});

test('Vercel Google SDK does not require an OpenAI key', async () => {
    const dir = await makeWorkspace({
        'package.json': JSON.stringify({ dependencies: { ai: '^4.0.0', '@ai-sdk/google': '^1.0.0' } }),
        'server.js': `import { generateText } from 'ai'; import { google } from '@ai-sdk/google';
generateText({ model: google('gemini'), prompt: 'Hello' });`,
    });
    const audit = await analyzeChatbotWorkspace(dir);
    expect(audit.autoFillConfig.llmEnvVars).not.toContain('OPENAI_API_KEY');
});

test('detects Next.js app route POST endpoints', async () => {
    const dir = await makeWorkspace({
        'app/api/chat/route.ts': `import { generateText } from 'ai';
export async function POST(request: Request) {
    const { prompt } = await request.json();
    const result = await generateText({ prompt });
    return Response.json({ answer: result.text });
}`,
    });
    const audit = await analyzeChatbotWorkspace(dir);
    expect(audit.summary.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'POST', endpointPath: '/api/chat' })]));
});

test('Python FastAPI with google-genai skips JS-only findings', async () => {
    const dir = await makeWorkspace({
        'requirements.txt': 'fastapi\ngoogle-genai\n',
        'main.py': `from fastapi import FastAPI
from google import genai
app = FastAPI()
client = genai.Client()
@app.post('/api/chat')
def chat(body: dict):
    return {'answer': client.models.generate_content(model='gemini', contents=body['message']).text}
`,
    });
    const audit = await analyzeChatbotWorkspace(dir);
    expect(audit.findings.map(f => f.ruleId)).not.toContain('CB-SEC-02');
    expect(audit.findings.map(f => f.ruleId)).not.toContain('CB-REL-01');
});

test('preserves OpenAI messages array bindings', async () => {
    const audit = await auditBackend('const { messages } = req.body;');
    expect(audit.autoFillConfig.bindings).toEqual({ '/messages': 'messages' });
});

test('executeTurn accepts text/plain responses', async () => {
    const server = http.createServer((req, res) => {
        req.resume();
        res.setHeader('Content-Type', 'text/plain');
        res.end('Hello');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const lease = createManagedLoopbackLease({ port: server.address().port, pid: process.pid });
        const result = await executeTurn({
            executionMode: 'MANAGED_PROJECT',
            endpointPath: '/api/chat',
            bindings: { '/messages': 'messages' },
            response: { format: 'text', answer: '/answer' },
        }, { messages: [{ role: 'user', content: 'Hi' }] }, { lease });
        expect(result.answer).toBe('Hello');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
