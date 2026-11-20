import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverProjectChatbot } from '../services/aiEvaluation/projectDiscovery.service.js';

async function fixture(files, action) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-chatbot-discovery-'));
    try {
        for (const [name, contents] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), contents); }
        await action(root);
    } finally {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('covai-chatbot-discovery-'));
        await fs.rm(root, { recursive: true, force: true });
    }
}

test('discovers imported Express chatbot without executing source or reading secrets', async () => {
    await fixture({
        'backend/package.json': JSON.stringify({ scripts: { start: 'node index.js' }, dependencies: { express: '*', openai: '*' } }),
        'backend/index.js': `import OpenAI from 'openai'; const key=process.env.OPENAI_API_KEY; const app=express(); app.post('/chat',async(req,res)=>{const {message}=req.body;res.json({answer:message});}); throw new Error('must never execute');`,
        '.env': 'TOP_SECRET=must-not-be-read',
        'README.md': '# Returns\nReturn orders within seven days.',
        'node_modules/fake/chat.js': `app.post('/fake',handler)`,
    }, async root => {
        const result = await discoverProjectChatbot(root);
        assert.equal(result.status, 'CHATBOT_DETECTED');
        assert.equal(result.runtimeVerified, false);
        assert.equal(result.candidates[0].path, '/chat');
        assert.equal(result.candidates[0].requestField, 'message');
        assert.equal(result.candidates[0].answerField, 'answer');
        assert.equal(result.candidates[0].startScript, 'start');
        assert.deepEqual(result.environmentNames, ['OPENAI_API_KEY']);
        assert.ok(!JSON.stringify(result).includes('must-not-be-read'));
        assert.equal(result.knowledgeSources.length, 1);
    });
});
test('resolves literal router prefix but does not claim ambiguous projects runnable', async () => {
    await fixture({ 'index.js': `router.post('/chat', handler); app.use('/api', router); app.post('/assistant', handler);` }, async root => {
        const result = await discoverProjectChatbot(root);
        assert.equal(result.status, 'MULTIPLE_CANDIDATES');
        assert.equal(result.candidates[0].path, '/api/chat');
    });
});
test('recognizes Next and Python routes without treating docs or tests as running chatbots', async () => {
    await fixture({ 'app/api/chat/route.ts': 'export async function POST(request: Request) { return Response.json({answer:"hello"}); }', 'tests/fake.test.js': "app.post('/chat', fn)", 'README.md': "app.post('/chat', fn)" }, async root => {
        const result = await discoverProjectChatbot(root); assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].framework, 'NEXT');
    });
    await fixture({ 'main.py': 'from fastapi import FastAPI\napp=FastAPI()\n@app.post("/chat")\ndef chat(): return {"answer":"Hi"}' }, async root => {
        assert.equal((await discoverProjectChatbot(root)).candidates[0].framework, 'FASTAPI');
    });
});
test('no chatbot and scan budget are explicit outcomes', async () => {
    await fixture({ 'index.js': 'export const add=(a,b)=>a+b;' }, async root => {
        assert.equal((await discoverProjectChatbot(root)).status, 'CHATBOT_NOT_FOUND');
        await assert.rejects(discoverProjectChatbot(root, { maxFiles: 0 }), /file limit/);
    });
});

test('follows a conventional imported Express router mount and literal listening port', async () => {
    await fixture({ 'index.js': `const chatRouter=require('./routes/chat'); app.use('/api',chatRouter); app.listen(process.env.PORT||4000);`, 'routes/chat.js': `router.post('/chat',(req,res)=>res.json({answer:req.body.message}));` }, async root => {
        const result = await discoverProjectChatbot(root);
        assert.equal(result.candidates[0].path, '/api/chat');
        assert.ok(result.candidates[0].portHints.includes(4000));
    });
});

test('selects Python requirements in a mixed repository and Next dev without a production build', async () => {
    await fixture({ 'package.json': JSON.stringify({ scripts: { start: 'next start', dev: 'next dev' } }), 'app/api/chat/route.ts': 'export async function POST() { return Response.json({answer:"hello"}); }', 'backend/requirements.txt': 'fastapi\n', 'backend/main.py': 'from fastapi import FastAPI\napp=FastAPI()\n@app.post("/chat")\ndef chat(): return {"answer":"Hi"}' }, async root => {
        const result = await discoverProjectChatbot(root);
        assert.equal(result.candidates.find(c => c.framework === 'FASTAPI').packageDirectory, 'backend');
        assert.equal(result.candidates.find(c => c.framework === 'NEXT').startScript, 'dev');
    });
});

test('recognizes a LangGraph frontend dependency instead of claiming a runnable chatbot backend', async () => {
    await fixture({ 'package.json': JSON.stringify({ dependencies: { '@langchain/langgraph-sdk': '1.0.0' }, scripts: { dev: 'next dev' } }), 'src/providers/Stream.tsx': "import {useStream} from '@langchain/langgraph-sdk/react'; const url=process.env.NEXT_PUBLIC_API_URL;", 'src/app/api/[..._path]/route.ts': "import {initApiPassthrough} from 'langgraph-nextjs-api-passthrough'; export const {GET,POST}=initApiPassthrough({apiUrl:process.env.LANGGRAPH_API_URL});" }, async root => {
        const result = await discoverProjectChatbot(root);
        assert.equal(result.status, 'CHATBOT_BACKEND_REQUIRED'); assert.equal(result.candidates.length, 0);
        assert.equal(result.chatClients[0].protocol, 'LANGGRAPH'); assert.equal(result.runtimeVerified, false);
    });
});

test('discovers the native mounted Chainlit entry point without duplicating its callback', async () => {
    await fixture({ 'backend/app.py': 'from chainlit.utils import mount_chainlit\nmount_chainlit(app=app,target="chat.py",path="/chainlit")', 'backend/chat.py': 'import chainlit as cl\n@cl.on_message\nasync def chat(message): pass' }, async root => {
        const result = await discoverProjectChatbot(root);
        assert.equal(result.status, 'CHATBOT_DETECTED');
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0].launchMode, 'FASTAPI_MOUNT');
        assert.equal(result.candidates[0].packageDirectory, 'backend');
        assert.equal(result.candidates[0].requestField, 'messages');
        assert.equal(result.chatProtocols[0].protocol, 'CHAINLIT'); assert.equal(result.runtimeVerified, false);
    });
});

test('discovers standalone Chainlit without requiring a provider API key', async () => {
    await fixture({ 'app.py': 'import chainlit as cl\n@cl.on_message\nasync def respond(message): pass' }, async root => {
        const result = await discoverProjectChatbot(root);
        assert.equal(result.candidates[0].launchMode, 'CHAINLIT_CLI');
        assert.deepEqual(result.environmentNames, []);
    });
});

test('discovers streaming SDK contracts and project-defined Chainlit cookie authentication paths', async () => {
    await fixture({ 'app/api/chat/route.ts': `import {convertToModelMessages,streamText} from 'ai'; export async function POST(req: Request) { const {messages}=await req.json(); return streamText({messages:await convertToModelMessages(messages)}).toUIMessageStreamResponse(); }` }, async root => {
        const route = (await discoverProjectChatbot(root)).candidates[0];
        assert.equal(route.requestField, 'messages');
        assert.equal(route.requestShape, 'AI_SDK_UI_MESSAGES');
        assert.ok(route.protocolHints.includes('HTTP_SSE'));
        assert.equal(route.adapterOptions[0].id, 'http-chat');
    });
    await fixture({ 'app.py': `from chainlit.utils import mount_chainlit\n@app.get('/session/login')\nasync def login(request: Request):\n    return await _authenticate_user(request, User(identifier='test'))\nmount_chainlit(app=app,target='chat.py',path='/assistant')`, 'chat.py': 'import chainlit as cl\n@cl.on_message\nasync def chat(message): pass' }, async root => {
        const route = (await discoverProjectChatbot(root)).candidates[0];
        assert.equal(route.path, '/assistant');
        assert.equal(route.authPath, '/session/login');
    });
});

test('detects authenticated custom Socket.IO chat and separates provider references from app configuration', async () => {
    await fixture({
        'socket/index.js': `const {Server}=require('socket.io'); const {ask}=require('../controllers/chat'); const {verify}=require('./auth'); io.on('connection',socket=>{socket.on('user_message',async message=>socket.emit('bot_reply',await ask(message)));});`,
        'socket/auth.js': `const verify=token=>jwt.verify(token,process.env.JWT_SECRET_KEY);`,
        'controllers/chat.js': `const {GoogleGenAI}=require('@google/genai');const ai=new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});`,
        'app.js': `const port=process.env.PORT;const db=process.env.MONGO_URI;const session=process.env.SESSION_KEY;`,
        'payment.js': 'const key=process.env.RZR_PAY_KEY;',
        'mail.js': 'const key=process.env.SMTP_KEY;',
    }, async root => {
        const result = await discoverProjectChatbot(root);
        assert.equal(result.status, 'CHATBOT_ADAPTER_REQUIRED');
        assert.equal(result.candidates.length, 0);
        assert.equal(result.chatProtocols[0].protocol, 'SOCKET_IO_CUSTOM');
        assert.equal(result.chatProtocols[0].inputEvents[0].event, 'user_message');
        assert.deepEqual(result.environmentAssessment.providerReferences, ['GEMINI_API_KEY']);
        assert.deepEqual(result.environmentAssessment.runtimeManaged, ['PORT']);
        assert.ok(result.environmentAssessment.chatbotDependencyReferences.includes('JWT_SECRET_KEY'));
        assert.ok(result.environmentAssessment.otherProjectReferences.includes('SMTP_KEY'));
        assert.ok(result.environmentAssessment.otherProjectReferences.includes('RZR_PAY_KEY'));
        assert.deepEqual(result.environmentAssessment.requiredNames, []);
    });
});
