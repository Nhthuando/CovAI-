// Explicit opt-in: exercises the deployed API/Redis worker using a disposable project.
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma.js';

if (process.env.RUN_DEPLOYED_CHATBOT_SMOKE !== 'true') throw new Error('Set RUN_DEPLOYED_CHATBOT_SMOKE=true to create and clean a disposable smoke-test project');
const base = 'http://127.0.0.1:5000/api';
let user, project, workflow, directory, headers;
try {
    user = await prisma.user.create({ data: { email: `chatbot-smoke-${crypto.randomUUID()}@evaluation.invalid` } });
    project = await prisma.project.create({ data: { name: 'Disposable imported chatbot smoke fixture', ownerId: user.id } });
    directory = path.resolve('storage', 'projects', project.id);
    const source = path.join(directory, 'imported'); await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'chatbot-smoke', version: '1.0.0', type: 'module', scripts: { start: 'node index.js' } }));
    await fs.writeFile(path.join(source, 'index.js'), `import http from 'node:http';
const routes=new Map();const app={post:(path,handler)=>routes.set(path,handler)};
app.post('/chat',(req,res)=>{const {messages}=req.body;res.json({answer:messages[0]?.content.match(/COVAI-[a-f0-9]+/)?.[0]||'I answer application questions.'});});
http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const handler=routes.get(req.url);if(!handler){res.writeHead(404);res.end();return;}try{handler({body:JSON.parse(text)},{json:value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}});}catch{res.writeHead(422);res.end('{}');}}).listen(Number(process.env.PORT)||3000,'0.0.0.0');`);
    const snapshot = await prisma.projectSnapshot.create({ data: { projectId: project.id, source: 'GITHUB', storagePath: source, rootDir: source } });
    headers = { Authorization: `Bearer ${jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '10m' })}`, 'Content-Type': 'application/json' };
    const endpoint = `${base}/projects/${project.id}/ai-evaluations`;
    const started = await fetch(`${endpoint}/project-runs`, { method: 'POST', headers, body: JSON.stringify({ snapshotId: snapshot.id, idempotencyKey: crypto.randomUUID(), judgeConsent: false }) });
    assert.equal(started.status, 202); workflow = (await started.json()).data;
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
        const response = await fetch(`${endpoint}/project-runs/${workflow.id}`, { headers }); assert.equal(response.status, 200);
        workflow = (await response.json()).data;
        if (!['QUEUED', 'RUNNING'].includes(workflow.status)) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (workflow.status !== 'COMPLETED') console.error('Smoke workflow failed', { status: workflow.status, errorCode: workflow.errorCode, childStatus: workflow.report?.executionStatus, childError: workflow.report?.errorCode });
    assert.equal(workflow.status, 'COMPLETED', `${workflow.errorCode || ''}: ${workflow.errorMessage || ''}`);
    assert.equal(workflow.result.readiness.ready, true);
    assert.equal(workflow.report.verdict, 'INCOMPLETE');
    assert.equal(workflow.report.manifest.evidenceScope, 'IMPORTED_PROJECT_SANDBOX');
    for (const format of ['json', 'pdf']) {
        const response = await fetch(`${endpoint}/runs/${workflow.evaluationRunId}/report?format=${format}`, { headers });
        assert.equal(response.status, 200);
        const content = Buffer.from(await response.arrayBuffer());
        assert.ok(content.length > 500);
        if (format === 'pdf') assert.equal(content.subarray(0, 4).toString(), '%PDF');
    }
    const removed = await fetch(`${endpoint}/project-runs/${workflow.id}`, { method: 'DELETE', headers }); assert.equal(removed.status, 200);
    assert.equal(await prisma.aiEvaluationProjectRun.count({ where: { projectId: project.id } }), 0);
    console.log('PASS: deployed API → Redis worker → isolated imported chatbot → managed benchmark → JSON/PDF → deletion');
} finally {
    if (workflow && ['QUEUED', 'RUNNING'].includes(workflow.status)) await fetch(`${base}/projects/${project.id}/ai-evaluations/project-runs/${workflow.id}/cancel`, { method: 'POST', headers }).catch(() => {});
    if (project) await prisma.project.deleteMany({ where: { id: project.id, ownerId: user.id } });
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    if (directory) {
        assert.equal(path.dirname(directory), path.resolve('storage', 'projects'));
        assert.match(path.basename(directory), /^[\w-]+$/);
        await fs.rm(directory, { recursive: true, force: true });
    }
    await prisma.$disconnect();
}
