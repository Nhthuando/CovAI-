import { test, expect, afterAll } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeChatbotWorkspace } from '../services/aiEvaluation/designAudit.service.js';

const tempDirs = [];

function fixture(files, dependencies = { express: '*', openai: '*' }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-split-routes-'));
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

test('detects a mounted CommonJS router, imported handler and custom SDK key variable', async () => {
    const dir = fixture({
        'server.js': `const express = require('express');
const faqRoutes = require('./src/routes/faqRoutes');
const app = express();
app.use(express.json());
app.use('/api/faq', faqRoutes);
app.listen(process.env.PORT || 3000);`,
        'src/routes/faqRoutes.js': `const express = require('express');
const { askQuestion } = require('../controllers/faqController');
const router = express.Router();
router.post('/ask', askQuestion);
module.exports = router;`,
        'src/controllers/faqController.js': `const openai = require('../config/openConfig');
const askQuestion = async (req, res) => {
    const { question, model } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });
    if (!model) return res.status(400).json({ error: 'Model AI is required' });
    const completion = await openai.chat.completions.create({ model, messages: [{ role: 'user', content: question }] });
    const answer = completion.choices[0].message.content;
    res.json({ answer });
};
module.exports = { askQuestion };`,
        'src/config/openConfig.js': `const OpenAI = require('openai');
const openai = new OpenAI({ baseURL: process.env.BASE_URL, apiKey: process.env.API_KEY });
module.exports = openai;`,
    });
    const audit = await analyzeChatbotWorkspace(dir);
    expect(audit.autoFillConfig.endpointPath).toBe('/api/faq/ask');
    expect(audit.summary.endpoints.find(endpoint => endpoint.method === 'POST')?.endpointPath).toBe('/api/faq/ask');
    expect(audit.summary.launchability.requiredLlmEnvVars).toContain('API_KEY');
    expect(audit.autoFillConfig.llmEnvVars).toContain('API_KEY');
    expect(audit.autoFillConfig.llmEnvVars).not.toContain('BASE_URL');
    expect(audit.autoFillConfig.llmBaseUrlEnvVars).toEqual(['BASE_URL']);
    expect(audit.summary.launchability.llmBaseUrlEnvVars).toContain('BASE_URL');
    expect(audit.autoFillConfig.bindings).toEqual({ '/question': 'latestUserMessage' });
    expect(audit.autoFillConfig.responsePointer).toBe('/answer');
    expect(audit.autoFillConfig.requiredBodyFields).toEqual(['model']);
    expect(audit.autoFillConfig.requestTemplate).not.toHaveProperty('model');
});

test('resolves ES module mounts and handlers and scopes inference to the chosen handler', async () => {
    const dir = fixture({
        'server.js': `import express from 'express';
import routes from './src/routes';
const app = express();
app.use('/api/faq', routes);
app.listen(3000);`,
        'src/routes/index.js': `import express from 'express';
import ask from '../controllers/faq.mjs';
const router = express.Router();
router.post('/ask', ask);
export default router;`,
        'src/controllers/faq.mjs': `export function unrelated(req, res) {
    const { message, messages } = req.body;
    res.json({ answer: message || messages });
}
export default function ask(req, res) {
    const question = req.body.question;
    const history = req.body.history;
    if (!req.body.model) return res.status(400).json({ error: 'Model is required' });
    res.json({ reply: question, history });
}`,
        'src/config/openConfig.js': `import Client from 'openai';
const client = new Client({ apiKey: process.env['CUSTOM_CREDENTIAL'] });`,
    });
    const audit = await analyzeChatbotWorkspace(dir);
    expect(audit.autoFillConfig).toMatchObject({
        endpointPath: '/api/faq/ask',
        bindings: { '/question': 'latestUserMessage', '/history': 'history' },
        responsePointer: '/reply',
        requiredBodyFields: ['model'],
    });
    expect(audit.autoFillConfig.bindings).not.toHaveProperty('/messages');
    expect(audit.autoFillConfig.llmEnvVars).toContain('CUSTOM_CREDENTIAL');
});

test.each(['baseURL', 'baseUrl', 'basePath', 'baseUri', 'endpoint', 'apiBase', 'apiEndpoint', 'apiUrl', 'host', 'serverUrl'])('detects %s SDK base URL variables with literal fallbacks', async option => {
    const audit = await analyzeChatbotWorkspace(fixture({
        'server.js': `import Client from 'openai';
new Client({ ${option}: process.env['PROVIDER_URL'] || 'https://provider.example/v1' });`,
    }));
    expect(audit.autoFillConfig.llmBaseUrlEnvVars).toEqual(['PROVIDER_URL']);
    expect(audit.summary.launchability.llmBaseUrlEnvVars).toEqual(['PROVIDER_URL']);
});

test.each([
    ['@google/generative-ai', `import { GoogleGenerativeAI as Client } from '@google/generative-ai';
new Client(process.env['CUSTOM_CREDENTIAL']);`],
    ['openai', `import Client from 'openai';
Client({ key: process.env.CUSTOM_CREDENTIAL });`],
])('detects explicit key arguments for %s', async (sdk, content) => {
    const audit = await analyzeChatbotWorkspace(fixture({ 'server.js': content }, { [sdk]: '*' }));
    expect(audit.autoFillConfig.llmEnvVars).toContain('CUSTOM_CREDENTIAL');
    expect(audit.summary.launchability.requiredLlmEnvVars).toContain('CUSTOM_CREDENTIAL');
});
