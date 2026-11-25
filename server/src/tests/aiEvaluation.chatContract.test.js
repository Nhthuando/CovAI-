import { test, expect, afterAll } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeChatbotWorkspace } from '../services/aiEvaluation/designAudit.service.js';

const tempDirs = [];

function fixture(files, dependencies = { express: '*', openai: '*' }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-chat-contract-'));
    tempDirs.push(dir);
    const entries = { 'package.json': JSON.stringify({ scripts: { start: 'node server.js' }, dependencies }), ...files };
    for (const [name, content] of Object.entries(entries)) {
        const destination = path.join(dir, name);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, content);
    }
    return dir;
}

afterAll(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const express = `import express from 'express';
const app = express();
app.use(express.json());
app.listen(process.env.PORT || 3000);`;
const openai = `import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });`;

async function expectContract(files, expected, dependencies) {
    const audit = await analyzeChatbotWorkspace(fixture(files, dependencies));
    expect(audit.autoFillConfig).toMatchObject(expected);
    expect(audit.autoFillConfig.bindings).toEqual(expected.bindings);
}

test('follows the sandbox controller and service through to the reply', async () => {
    const dependencies = { express: '*', '@google/generative-ai': '*' };
    await expectContract({
        'package.json': JSON.stringify({ scripts: { start: 'node src/index.js' }, dependencies }),
        'src/index.js': `${express}
import sandboxRoutes from './routes/sandbox.routes.js';
app.use('/api/sandbox', sandboxRoutes);`,
        'src/routes/sandbox.routes.js': `import { Router } from 'express';
import SandboxController from '../controllers/sandbox.controller.js';
const router = Router();
router.post('/chat', SandboxController.chat);
export default router;`,
        'src/controllers/sandbox.controller.js': `import SandboxService from '../services/sandbox.service.js';
class SandboxController {
    static async chat(req, res) {
        try { const data = await SandboxService.chatWithAI(req.body || {}); return res.status(200).json({ success: true, data }); }
        catch (err) { const status = err.message.includes("cannot be empty") ? 400 : 500; return res.status(status).json({ success: false, error: err.message }); }
    }
}
export default SandboxController;`,
        'src/services/sandbox.service.js': `import { GoogleGenerativeAI } from '@google/generative-ai';
const MODELS = ['gemini-2.0-flash'];
const generativeModel = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: MODELS[0] });
class SandboxService {
    async chatWithAI({ message, history = [], mode = "qa", model = MODELS[0], temperature = 0.3 }) {
        if (!message || typeof message !== "string" || !message.trim()) throw new Error("Message cannot be empty.");
        const normalizedHistory = Array.isArray(history) ? history.filter((item) => item && typeof item.text === "string" && (item.role === "user" || item.role === "model")).map((item) => ({ role: item.role, parts: [{ text: item.text }] })) : [];
        const chat = generativeModel.startChat({ history: normalizedHistory });
        const result = await chat.sendMessage(message.trim());
        const reply = result.response.text();
        return { reply, model, mode };
    }
}
export default new SandboxService();`,
    }, {
        endpointPath: '/api/sandbox/chat',
        bindings: { '/message': 'latestUserMessage', '/history': 'history' },
        responsePointer: '/data/reply',
        historyFormat: 'model',
        requiredBodyFields: [],
    });
});

test('follows CommonJS controller and service exports on an unhinted route', async () => {
    await expectContract({
        'server.js': `const app = require('express')();
const controller = require('./controller');
app.post('/api/support/send', controller.chat);
app.listen(process.env.PORT || 3000);`,
        'controller.js': `const svc = require('./service');
module.exports = { chat: async (req, res) => { const payload = req.body; const r = await svc.ask(payload); res.json(r); } };`,
        'service.js': `const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
exports.ask = async (data) => ({ answer: (await client.responses.create({ input: data.question })).output_text, sources: [] });`,
    }, {
        endpointPath: '/api/support/send',
        bindings: { '/question': 'latestUserMessage' },
        responsePointer: '/answer',
    });
});

test('resolves a wrapped instance arrow handler and an imported validation schema', async () => {
    await expectContract({
        'server.js': `${express}
import { controller } from './controllers.js';
const asyncHandler = (fn) => (req, res) => fn(req, res);
app.post('/api/chat', asyncHandler(controller.ask));`,
        'controllers.js': `export { default as controller } from './controller.js';`,
        'controller.ts': `${openai}
import { schema } from './schema.js';
class ChatController {
    ask = async (req, res) => {
        const { prompt } = schema.parse(req.body);
        const answer = await client.responses.create({ input: prompt });
        res.json({ reply: answer.output_text });
    };
}
export default new ChatController();`,
        'schema.ts': `import { z } from 'zod';
export const schema = z.object({ prompt: z.string(), locale: z.string().optional() });`,
    }, {
        endpointPath: '/api/chat',
        bindings: { '/prompt': 'latestUserMessage' },
        responsePointer: '/reply',
    });
});

test('composes prefixes across imported and local router mounts', async () => {
    await expectContract({
        'server.js': `${express}
import apiRouter from './routes.js';
app.use('/api', apiRouter);`,
        'routes.js': `${openai}
import { Router } from 'express';
const router = Router();
const chatRouter = Router();
router.use('/chat', chatRouter);
chatRouter.post('/send', async (req, res) => {
    const answer = await client.responses.create({ input: req.body.question });
    res.json({ output: answer.output_text });
});
export default router;`,
    }, {
        endpointPath: '/api/chat/send',
        bindings: { '/question': 'latestUserMessage' },
        responsePointer: '/output',
    });
});

test('infers a Next.js app route with a nested message payload', async () => {
    await expectContract({
        'app/api/chat/route.ts': `${openai}
import { NextResponse } from 'next/server';
export async function POST(req) {
    const { messages } = await req.json();
    const answer = await client.responses.create({ input: messages });
    const content = answer.output_text;
    return NextResponse.json({ message: { role: 'assistant', content } });
}`,
    }, {
        endpointPath: '/api/chat',
        bindings: { '/messages': 'messages' },
        responsePointer: '/message/content',
        historyFormat: 'chat',
    }, { next: '*', openai: '*' });
});

test('generates a required session ID while sending individual messages', async () => {
    await expectContract({
        'server.js': `${express}
${openai}
app.post('/api/chat', async (req, res) => {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) return res.status(400);
    const answer = await client.responses.create({ input: message });
    return res.json({ answer: answer.output_text });
});`,
    }, {
        endpointPath: '/api/chat',
        bindings: { '/message': 'latestUserMessage', '/sessionId': 'generatedConversationId' },
        responsePointer: '/answer',
        conversationMode: 'messages',
        requiredBodyFields: [],
    });
});

test('ranks the send endpoint above history and session endpoints', async () => {
    await expectContract({
        'server.js': `${express}
${openai}
app.post('/api/chat/history', (req, res) => res.json({ message: req.body.message }));
app.post('/api/chat/sessions', (req, res) => res.json({ message: req.body.message }));
app.post('/api/chat/send', async (req, res) => {
    const answer = await client.responses.create({ input: req.body.prompt });
    return res.json({ reply: answer.output_text });
});`,
    }, {
        endpointPath: '/api/chat/send',
        bindings: { '/prompt': 'latestUserMessage' },
        responsePointer: '/reply',
    });
});

test('recognizes a raw history field passed directly to startChat', async () => {
    await expectContract({
        'server.js': `${express}
import { GoogleGenerativeAI } from '@google/generative-ai';
const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: 'gemini-2.0-flash' });
app.post('/api/chat', async (req, res) => {
    const chat = model.startChat({ history: req.body.history });
    const result = await chat.sendMessage(req.body.message);
    res.json({ reply: result.response.text() });
});`,
    }, {
        endpointPath: '/api/chat',
        bindings: { '/message': 'latestUserMessage', '/history': 'history' },
        responsePointer: '/reply',
        historyFormat: 'gemini',
    }, { express: '*', '@google/generative-ai': '*' });
});

test('skips an earlier error response when choosing the reply pointer', async () => {
    await expectContract({
        'server.js': `${express}
${openai}
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: 'x' });
    const result = await client.responses.create({ input: message });
    const text = result.output_text;
    return res.status(200).json({ data: { text } });
});`,
    }, {
        endpointPath: '/api/chat',
        bindings: { '/message': 'latestUserMessage' },
        responsePointer: '/data/text',
    });
});

test('terminates inference through cyclic imports and a recursive return', async () => {
    await expectContract({
        'server.js': `${express}
import { ask } from './service.js';
app.post('/api/chat', async (req, res) => res.json(await ask(req.body)));`,
        'service.js': `${openai}
import { loop } from './loop.js';
export { loop };
export async function ask(payload) {
    if (payload.retry) return ask(payload);
    if (payload.loop) return loop(payload);
    const answer = await client.responses.create({ input: payload.question });
    return { answer: answer.output_text };
}`, 
        'loop.js': `export { loop } from './service.js';`,
    }, {
        endpointPath: '/api/chat',
        bindings: { '/question': 'latestUserMessage' },
        responsePointer: '/answer',
    });
});
