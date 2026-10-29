import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import prisma from '../config/prisma.js';
import { assertCollaborationTestDatabase } from './helpers/collaborationDb.js';

// Requires the real isolated API/Redis/SMTP stack; ordinary unit runs skip it.
const suite = process.env.COVAI_RUN_REAL_SUPERTEST === 'true' ? describe : describe.skip;
suite('collaborative Supertest pipeline against real localhost workers', () => {
    const api = 'http://127.0.0.1:55000/api';
    const actors = {};
    let projectId;
    beforeAll(() => assertCollaborationTestDatabase(process.env.DATABASE_URL));
    afterAll(async () => prisma.$disconnect());
    async function request(actor, endpoint, { method = 'GET', data, body } = {}) {
        const response = await fetch(`${api}${endpoint}`, {
            method,
            headers: { ...(actors[actor] ? { Authorization: `Bearer ${actors[actor].token}` } : {}),
                ...(data ? { 'Content-Type': 'application/json' } : {}) },
            body: data ? JSON.stringify(data) : body,
        });
        const json = await response.json();
        if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${JSON.stringify(json)}`);
        return json;
    }
    test('Editor executes approved HTTP tests; Viewer reads atomic coverage without changing source storage', async () => {
        const suffix = randomUUID();
        for (const actor of ['owner', 'editor', 'viewer']) {
            const email = `supertest-${actor}-${suffix}@covai.test`;
            const password = 'Collaboration-local-123!';
            await request(null, '/auth/register', { method: 'POST', data: { name: actor, email, password } });
            const login = await request(null, '/auth/login', { method: 'POST', data: { email, password } });
            actors[actor] = { token: login.accessToken, email };
        }
        const created = await request('owner', '/projects', { method: 'POST', data: { name: `Supertest collaboration ${suffix}` } });
        projectId = created.data.id;
        // Seed only membership/approved proposal state. Authentication, upload,
        // admission, Redis dependency flow, npm/Jest and result APIs remain real.
        for (const [actor, role] of [['editor', 'EDITOR'], ['viewer', 'VIEWER']]) {
            const user = await prisma.user.findUniqueOrThrow({ where: { email: actors[actor].email } });
            await prisma.projectMember.create({ data: { projectId, userId: user.id, role } });
        }
        const code = "const request = require('supertest');\nconst app = require('../src/app');\ntest('GET health', async () => { const response = await request(app).get('/health'); expect(response.status).toBe(200); expect(response.body.ok).toBe(true); });\n";
        const zip = new AdmZip();
        zip.addFile('package.json', Buffer.from(JSON.stringify({ name: 'collaboration-http-fixture', version: '1.0.0',
            scripts: { test: 'jest' }, dependencies: { express: '4.21.2', supertest: '7.1.1' },
            devDependencies: { jest: '29.7.0' }, jest: { testEnvironment: 'node', collectCoverageFrom: ['src/**/*.js'] } })));
        zip.addFile('src/app.js', Buffer.from("const express = require('express');\nconst app = express();\napp.get('/health', (_req, res) => res.json({ ok: true }));\nmodule.exports = app;\n"));
        zip.addFile('tests/api.test.js', Buffer.from(code));
        const form = new FormData();
        form.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'supertest-fixture.zip');
        await request('owner', `/projects/${projectId}/upload-zip`, { method: 'POST', body: form });
        const snapshot = await prisma.projectSnapshot.findFirstOrThrow({ where: { projectId }, orderBy: { createdAt: 'desc' } });
        await prisma.aiTest.create({ data: { projectId, snapshotId: snapshot.id, mode: 'FULL', filePath: 'tests/api.test.js', content: code,
            metaJson: JSON.stringify({ framework: 'SUPERTEST', status: 'APPROVED', requests: [{ scenarioId: 'health', testName: 'GET health', enabled: true }], approvedScenarios: ['health'] }) } });
        const queued = await request('editor', `/coverage/${snapshot.id}/supertest/run`, { method: 'POST', data: {} });
        expect(queued.jobId).toBeTruthy();
        let job;
        const deadline = Date.now() + 180000;
        while (Date.now() < deadline) {
            const result = await request('viewer', `/job/${queued.jobId}`);
            job = result.data || result.job || result;
            if (['SUCCESS', 'FAILED', 'CANCELED'].includes(job.status)) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        expect(job?.status).toBe('SUCCESS');
        const resultValue = job.resultJson ?? job.result;
        const result = typeof resultValue === 'string' ? JSON.parse(resultValue) : resultValue;
        expect(result.supertest.exitCode).toBe(0);
        expect(result.coverage.lines).toBeGreaterThan(0);
        expect((await prisma.projectOperation.findUniqueOrThrow({ where: { primaryJobId: queued.jobId } })).status).toBe('SUCCESS');
        expect((await prisma.projectSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).storagePath).toBe(snapshot.storagePath);
        expect(await prisma.testRun.count({ where: { snapshotId: snapshot.id, type: 'SUPERTEST', passedTests: 1, failedTests: 0 } })).toBe(1);
        expect(await prisma.coverageFile.count({ where: { snapshotId: snapshot.id } })).toBeGreaterThan(0);
        const files = await request('viewer', `/coverage/${snapshot.id}/files`);
        expect(JSON.stringify(files)).toContain('app.js');
        // Preserve this uniquely named project and logs as diagnostic evidence;
        // never use broad teardown against a shared database.
    }, 240000);
});
