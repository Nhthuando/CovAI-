import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startProjectSandbox } from '../services/aiEvaluation/projectSandbox.service.js';
import { discoverProjectChatbot } from '../services/aiEvaluation/projectDiscovery.service.js';
import { selectProjectAdapter } from '../services/aiEvaluation/projectAdapterRegistry.service.js';

const fixtures = [
    { protocol: 'HTTP_SSE', files: {
        'package.json': JSON.stringify({ name: 'sse-transport-fixture', type: 'module', scripts: { start: 'node app.js' }, dependencies: { express: '5.1.0' } }),
        'app.js': `import express from 'express';
const app=express();app.use(express.json());
app.post('/assistant', async(req,res)=>{const {messages}=req.body;res.setHeader('Content-Type','text/event-stream');res.write('data: '+JSON.stringify({choices:[{delta:{content:'observed:'+messages.map(m=>m.content).join('|')}}]})+'\\n\\n');await new Promise(r=>setTimeout(r,10));res.end('data: [DONE]\\n\\n');});
app.listen(Number(process.env.PORT),'0.0.0.0');`,
    } },
    { protocol: 'HTTP_NDJSON', files: {
        'requirements.txt': 'fastapi==0.115.12\nuvicorn==0.34.2\n',
        'app.py': `import json
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
app = FastAPI()
@app.post('/assistant')
def chat(body: dict):
    async def tokens():
        yield json.dumps({'message': {'content': 'observed:' + '|'.join(m['content'] for m in body['messages'])}, 'done': False}) + '\\n'
        yield json.dumps({'message': {'content': ''}, 'done': True}) + '\\n'
    return StreamingResponse(tokens(), media_type='application/x-ndjson')
`,
    } },
];

for (const fixture of fixtures) test(`registry boots an unrelated ${fixture.protocol} project and verifies real streamed answers`, { skip: process.env.RUN_CHATBOT_SANDBOX_TEST !== 'true', timeout: 300000 }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-streaming-'));
    let runtime;
    try {
        for (const [file, content] of Object.entries(fixture.files)) await fs.writeFile(path.join(root, file), content);
        const discovery = await discoverProjectChatbot(root);
        assert.equal(discovery.candidates.length, 1);
        assert.deepEqual(discovery.environmentNames.filter(name => !['PORT', 'HOST'].includes(name)), []);
        const candidate = discovery.candidates[0];
        const adapter = selectProjectAdapter(candidate);
        runtime = await startProjectSandbox({ root, candidate });
        const contract = await adapter.probe(runtime);
        assert.equal(contract.protocol, fixture.protocol);
        const messages = [{ role: 'user', content: 'nonce-First' }, { role: 'assistant', content: 'prior' }, { role: 'user', content: 'nonce-Next' }];
        const response = await adapter.executor(runtime, contract)({}, { messages });
        assert.equal(response.answer, 'observed:nonce-First|prior|nonce-Next');
        assert.equal(response.protocolEvidence.completed, true);
    } finally {
        await runtime?.cleanup();
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('covai-streaming-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});
