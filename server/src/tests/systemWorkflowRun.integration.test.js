import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from '@jest/globals';
import { assessSystemWorkspace } from '../services/systemAssessmentJob.service.js';
import { analyzeSystemTestFile, digest } from '../services/systemTestStaticAnalysis.service.js';

const realFixture = process.env.COVAI_RUN_REAL_SYSTEM_FIXTURE === 'true';

describe('managed System Test browser workflow', () => {
    (realFixture ? it : it.skip)('executes a reviewed imported web scenario twice against a real AUT', async () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-web-fixture-'));
        const jestWorkerId = process.env.JEST_WORKER_ID;
        delete process.env.JEST_WORKER_ID;
        try {
            fs.mkdirSync(path.join(rootDir, 'src'));
            fs.mkdirSync(path.join(rootDir, 'tests'));
            fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'covai-workflow-fixture', version: '1.0.0', type: 'module', scripts: { dev: 'node src/server.js' } }));
            fs.writeFileSync(path.join(rootDir, 'src/server.js'), "import http from 'node:http'; http.createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<h1>Welcome</h1>');}).listen(Number(process.env.PORT||4173),'127.0.0.1');");
            const filePath = 'tests/home.spec.js';
            const content = "import {test,expect} from '@playwright/test'; test('home',async({page})=>{await page.goto('/');await expect(page.getByText('Welcome')).toBeVisible();});";
            fs.writeFileSync(path.join(rootDir, filePath), content);
            const analysis = analyzeSystemTestFile({ content, filePath });
            const binding = { id: 'binding', revisionId: 'revision', criterionId: 'HOME', testFile: filePath, scenarioId: analysis.scenarioSites[0].id, assertionId: analysis.assertionSites[0].id, testHash: digest(content), status: 'APPROVED', bindingJson: { expectedOutcome: 'Welcome visible', assertionCode: analysis.assertionSites[0].code, assertionHash: analysis.assertionSites[0].hash, scenarioTitle: 'home' } };
            const revision = { id: 'revision', status: 'CONFIRMED', approvedByUserId: 'owner', contentJson: { criteria: [{ id: 'HOME', description: 'Home loads', expectedOutcome: 'Welcome visible' }] } };
            const input = { testFiles: [filePath], runner: 'playwright', executionMode: 'frontend', coverageScope: { frontend: { root: '.', sourceDirectory: 'src' } }, repeatRuns: 2 };
            const liveEvents = [];
            const report = await assessSystemWorkspace({ rootDir, input, jobId: null, revision, bindings: [binding], catalog: [{ scenarioKey: 'scenario', filePath, title: 'home', reviewState: 'REVIEWED', criterionIds: ['HOME'] }], onEvent: async event => { liveEvents.push(event); } });
            expect(report.runs).toHaveLength(2);
            expect(report.runs.map(run => run.testRun.status)).toEqual(['PASSED', 'PASSED']);
            expect(report.requirements.verified).toBe(1);
            expect(report.coverage.tiers.frontend.status).toBe('UNSUPPORTED');
            expect(report.scenarioVerdicts[0]).toMatchObject({ executionStatus: 'PASS', qualityStatus: 'STRONG' });
            expect(liveEvents.some(event => event.type === 'SCENARIO_ENDED' && event.screenshotBody?.startsWith('iVBORw0KGgo'))).toBe(true);
        } finally { if (jestWorkerId) process.env.JEST_WORKER_ID = jestWorkerId; fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    }, 180000);

    (realFixture ? it : it.skip)('preserves a failing test and its screenshot and trace evidence', async () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-web-bug-fixture-'));
        const jestWorkerId = process.env.JEST_WORKER_ID;
        delete process.env.JEST_WORKER_ID;
        try {
            fs.mkdirSync(path.join(rootDir, 'src'));
            fs.mkdirSync(path.join(rootDir, 'tests'));
            fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'covai-workflow-bug-fixture', version: '1.0.0', type: 'module', scripts: { dev: 'node src/server.js' } }));
            fs.writeFileSync(path.join(rootDir, 'src/server.js'), "import http from 'node:http'; http.createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<h1>Wrong</h1>');}).listen(Number(process.env.PORT||4173),'127.0.0.1');");
            const filePath = 'tests/home.spec.js';
            fs.writeFileSync(path.join(rootDir, filePath), "import {test,expect} from '@playwright/test'; test('home',async({page})=>{await page.goto('/');await expect(page.getByText('Welcome')).toBeVisible();});");
            const input = { testFiles: [filePath], runner: 'playwright', executionMode: 'frontend', coverageScope: { frontend: { root: '.', sourceDirectory: 'src' } }, repeatRuns: 2 };
            const report = await assessSystemWorkspace({ rootDir, input, jobId: null, catalog: [{ scenarioKey: 'home', filePath, title: 'home', reviewState: 'REVIEWED', criterionIds: ['HOME'] }] });
            expect(report.runs.map(run => run.testRun.status)).toEqual(['FAILED', 'FAILED']);
            expect(report.scenarioVerdicts[0].executionStatus).toBe('FAIL');
            expect(report.evidenceArtifacts.some(item => item.kind === 'TRACE')).toBe(true);
            expect(report.evidenceArtifacts.some(item => item.kind === 'SCREENSHOT')).toBe(true);
            expect(fs.existsSync(path.join(rootDir, filePath))).toBe(true);
        } finally { if (jestWorkerId) process.env.JEST_WORKER_ID = jestWorkerId; fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    }, 180000);

    (realFixture ? it : it.skip)('runs a configured Full Stack web project against its real Node API', async () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-full-web-fixture-'));
        const jestWorkerId = process.env.JEST_WORKER_ID;
        delete process.env.JEST_WORKER_ID;
        try {
            for (const directory of ['client/src', 'server/src', 'tests', '.covai']) fs.mkdirSync(path.join(rootDir, directory), { recursive: true });
            fs.writeFileSync(path.join(rootDir, 'client/package.json'), JSON.stringify({ name: 'fixture-client', version: '1.0.0', type: 'module', scripts: { dev: 'node src/server.js' } }));
            fs.writeFileSync(path.join(rootDir, 'server/package.json'), JSON.stringify({ name: 'fixture-server', version: '1.0.0', type: 'module', scripts: { dev: 'node src/server.js' } }));
            fs.writeFileSync(path.join(rootDir, 'client/src/server.js'), "import http from 'node:http';http.createServer((request,response)=>{response.setHeader('Content-Type','text/html');response.end('<h1>Real API test</h1><div id=\"answer\"></div><script>fetch(\"/api/value\").then(r=>r.json()).then(x=>document.getElementById(\"answer\").textContent=x.value)</script>');}).listen(Number(process.env.PORT||4173),'127.0.0.1');");
            fs.writeFileSync(path.join(rootDir, 'server/src/server.js'), "import http from 'node:http';http.createServer((request,response)=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify(request.url==='/health'?{ok:true}:{value:'Real backend'}));}).listen(Number(process.env.PORT||4174),'127.0.0.1');");
            fs.writeFileSync(path.join(rootDir, '.covai/system-test.json'), JSON.stringify({ frontend: { directory: 'client' }, backend: { directory: 'server', healthPath: '/health' }, database: null }));
            const filePath = 'tests/api.spec.js';
            fs.writeFileSync(path.join(rootDir, filePath), "import {test,expect} from '@playwright/test';test('real api',async({page})=>{await page.goto('/');await expect(page.getByText('Real backend')).toBeVisible();});");
            const input = { testFiles: [filePath], runner: 'playwright', executionMode: 'full', coverageScope: { frontend: { root: 'client', sourceDirectory: 'src' }, backend: { root: 'server', sourceDirectory: 'src' } }, repeatRuns: 2 };
            const report = await assessSystemWorkspace({ rootDir, input, jobId: null, catalog: [{ scenarioKey: 'real-api', filePath, title: 'real api', reviewState: 'REVIEWED', criterionIds: ['API'] }] });
            expect(report.runs.map(run => run.testRun.status)).toEqual(['PASSED', 'PASSED']);
            expect(report.runs.every(run => run.testRun.scenarios[0].apiCalls.some(call => call.path === '/api/value' && call.status === 200))).toBe(true);
        } finally { if (jestWorkerId) process.env.JEST_WORKER_ID = jestWorkerId; fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    }, 240000);
});
