import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startProjectSandbox, dockerCommand } from '../services/aiEvaluation/projectSandbox.service.js';
import { discoverProjectChatbot } from '../services/aiEvaluation/projectDiscovery.service.js';
import { probeProjectChatbot, projectTurnExecutor } from '../services/aiEvaluation/projectAdapter.service.js';

test('real Docker boots an imported chatbot and obtains answers over its local HTTP route', { skip: process.env.RUN_CHATBOT_SANDBOX_TEST !== 'true', timeout: 300000 }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-chatbot-docker-'));
    let runtime;
    try {
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'isolated-chatbot-fixture', version: '1.0.0', type: 'module', scripts: { start: 'node index.js' }, dependencies: { express: '5.1.0' } }));
        await fs.writeFile(path.join(root, 'index.js'), `import express from 'express';
const app=express(); app.use(express.json());
app.post('/chat',(req,res)=>{const {messages}=req.body;res.json({answer:messages.at(-1).content.includes('return')?'Returns within seven days.':'I can answer application questions.'});});
app.listen(Number(process.env.PORT)||3000,'0.0.0.0');`);
        const discovery = await discoverProjectChatbot(root);
        assert.equal(discovery.status, 'CHATBOT_DETECTED');
        runtime = await startProjectSandbox({ root, candidate: discovery.candidates[0], docker: async (args, options) => { try { return await dockerCommand(args, options); } catch (error) { console.error('Fixture Docker failure:', args[0], error.diagnostic || error.code); throw error; } } });
        const contract = await probeProjectChatbot(runtime, discovery.candidates[0]);
        const result = await projectTurnExecutor(runtime, contract)({}, { messages: [{ role: 'user', content: 'When can I return an order?' }] });
        assert.equal(result.answer, 'Returns within seven days.');
        assert.equal(contract.ready, true);
        const ip = await dockerCommand(['inspect', runtime.id, '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}']);
        const gateway = ip.replace(/\.\d+$/, '.1');
        const probes = JSON.parse(await dockerCommand(['exec', runtime.id, 'node', '--input-type=module', '-e', `import net from 'node:net';const hosts=${JSON.stringify([gateway, 'host.docker.internal'])};console.log(JSON.stringify(await Promise.all(hosts.flatMap(host=>[5000,6379].map(port=>new Promise(resolve=>{const socket=net.connect({host,port});const done=reachable=>{socket.destroy();resolve({host,port,reachable});};socket.setTimeout(1000,()=>done(false));socket.on('connect',()=>done(true));socket.on('error',()=>done(false));}))))));`]));
        assert.ok(probes.every(probe => !probe.reachable), `Sandbox reached a host service: ${JSON.stringify(probes)}`);
    } finally {
        await runtime?.cleanup();
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('covai-chatbot-docker-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('real Docker installs a Python chatbot and verifies its FastAPI response', { skip: process.env.RUN_CHATBOT_SANDBOX_TEST !== 'true', timeout: 300000 }, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-chatbot-python-'));
    let runtime;
    try {
        await fs.writeFile(path.join(root, 'requirements.txt'), 'fastapi==0.115.12\nuvicorn==0.34.2\n');
        await fs.writeFile(path.join(root, 'main.py'), `from fastapi import FastAPI\napp = FastAPI()\n@app.post('/chat')\ndef chat(body: dict):\n    return {'answer': 'Application help is available.'}\n`);
        const discovery = await discoverProjectChatbot(root);
        assert.equal(discovery.candidates[0].framework, 'FASTAPI');
        runtime = await startProjectSandbox({ root, candidate: discovery.candidates[0] });
        const contract = await probeProjectChatbot(runtime, discovery.candidates[0]).catch(async error => { console.error('Python fixture startup:', await runtime.logs()); throw error; });
        assert.equal(contract.probe.answer, 'Application help is available.');
    } finally {
        await runtime?.cleanup();
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('covai-chatbot-python-'));
        await fs.rm(root, { recursive: true, force: true });
    }
});
