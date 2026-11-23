import { describe, test, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { evaluationDatabase } from './helpers/aiEvaluationDatabase.js';

process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.AI_EVALUATION_ENABLED = 'true';
process.env.ENCRYPTION_KEY = '33'.repeat(32);

const {
    clearAllEphemeralSecrets,
    __vaultSizeForTest,
} = await import('../services/aiEvaluation/ephemeralSecret.service.js');
const {
    validateEndpoint,
    createManagedLoopbackLease,
    requestManagedLoopbackJson,
    executeTurn,
} = await import('../services/aiEvaluation/httpJson.adapter.js');
const { runChatbotDesignAudit } = await import('../services/aiEvaluation/designAudit.service.js');
const { processEvaluation, cancelRun } = await import('../services/aiEvaluation/runner.service.js');
const { getRunReport } = await import('../services/aiEvaluation/report.service.js');
const { isPortInUse } = await import('../services/autLifecycle.service.js');
const management = await import('../services/aiEvaluation/management.service.js');
const { parse, caseSchema, definitionSchema } = await import('../services/aiEvaluation/contracts.js');

async function collectAllFilesRecursively(dirPath) {
    const found = [];
    async function walk(current) {
        let entries = [];
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile()) {
                found.push(full);
            }
        }
    }
    await walk(dirPath);
    return found;
}

async function assertNoFileContainsSecret(rootDir, secretValue) {
    const files = await collectAllFilesRecursively(rootDir);
    for (const file of files) {
        const content = await fs.readFile(file, 'utf8').catch(() => '');
        expect(content).not.toContain(secretValue);
        expect(path.basename(file)).not.toBe('.env');
    }
}

function isPidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function assertPortCanBind(port) {
    const probeServer = net.createServer();
    await new Promise((resolve, reject) => {
        probeServer.once('error', reject);
        probeServer.listen({ host: '127.0.0.1', port }, resolve);
    });
    await new Promise(resolve => probeServer.close(resolve));
}

describe('Chatbot Evaluation MVP-2: Isolated Auto-Start Runtime, ManagedLoopbackLease & Knowledge Probe', () => {
    let harness, db, owner, editor, project, tempDirs = [];
    const queued = [];
    const enqueue = async (type, jobId) => { queued.push({ type, jobId }); };

    async function makeTempDir(prefix = 'covai-mvp2-fixture-') {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
        tempDirs.push(dir);
        return dir;
    }

    async function createFixtureChatbotRepo({ mode = 'healthy' } = {}) {
        const repoDir = await makeTempDir(`covai-bot-${mode}-`);
        await fs.mkdir(path.join(repoDir, 'docs'), { recursive: true });
        await fs.writeFile(
            path.join(repoDir, 'package.json'),
            JSON.stringify({
                name: `fixture-chatbot-${mode}`,
                type: 'module',
                scripts: { start: 'node server.js' },
                dependencies: {},
            }, null, 2),
            'utf8',
        );
        await fs.writeFile(
            path.join(repoDir, 'docs/refund-policy.md'),
            '# Chính sách hoàn tiền\nKhách hàng được hoàn tiền 100% trong vòng 14 ngày làm việc nếu sản phẩm lỗi kỹ thuật.\nHotline hỗ trợ bảo hành: 1900-6868.\n',
            'utf8',
        );

        // Zero-dependency Node HTTP chatbot.
        // Intentionally calls server.listen(3099) with a hardcoded port to prove autPortOverride.cjs + COVAI_AUT_PORT
        // rebinds it onto the isolated 127.0.0.1:<leasedPort>, and reads CUSTOM_BOT_LLM_KEY discovered by Design Audit.
        const serverSource = `
import http from 'node:http';

const LLM_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const llmKey = process.env.CUSTOM_BOT_LLM_KEY || '';
const MODE = ${JSON.stringify(mode)};
let requestCounter = 0;

if (MODE === 'startup-crash') {
    console.error('Fatal startup failure with key=' + llmKey + ' against ' + LLM_ENDPOINT);
    process.exit(1);
}

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pid: process.pid }));
        return;
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            requestCounter += 1;
            if (!llmKey) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing CUSTOM_BOT_LLM_KEY in spawn env' }));
                return;
            }
            if (MODE === 'slow') {
                setTimeout(() => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        answer: 'Hoàn tiền 100% trong vòng 14 ngày làm việc qua tổng đài 1900-6868.',
                        metadata: { pid: process.pid, port: Number(process.env.COVAI_AUT_PORT || process.env.PORT), reqCount: requestCounter },
                    }));
                }, 4000);
                return;
            }
            if (MODE === 'unseeded') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    answer: 'Xin lỗi, hiện tại tôi không tìm thấy thông tin nào trong cơ sở dữ liệu.',
                    metadata: { pid: process.pid, port: Number(process.env.COVAI_AUT_PORT || process.env.PORT), reqCount: requestCounter },
                }));
                return;
            }
            const parsed = JSON.parse(raw || '{}');
            const lastMsg = Array.isArray(parsed.messages) ? String(parsed.messages.at(-1)?.content || '') : '';
            const answer = /hoàn tiền|14|bảo hành|refund|policy/i.test(lastMsg)
                ? 'Khách hàng được hoàn tiền 100% trong vòng 14 ngày làm việc (liên hệ 1900-6868). Debug trace: ' + llmKey
                : 'Tôi chỉ hỗ trợ thông tin theo chính sách hoàn tiền nội bộ.';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                answer,
                metadata: { pid: process.pid, port: Number(process.env.COVAI_AUT_PORT || process.env.PORT), reqCount: requestCounter },
            }));
        });
        return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

// Hardcoded port 3099 must be overridden by autPortOverride.cjs to COVAI_AUT_PORT
server.listen(3099, '127.0.0.1');
`;
        await fs.writeFile(path.join(repoDir, 'server.js'), serverSource, 'utf8');
        return repoDir;
    }

    beforeAll(async () => {
        harness = await evaluationDatabase();
        db = harness.db;
        owner = await db.user.create({ data: { email: 'mvp2-owner@evaluation.invalid' } });
        editor = await db.user.create({ data: { email: 'mvp2-editor@evaluation.invalid' } });
        project = await db.project.create({ data: { ownerId: owner.id, name: 'MVP-2 Managed Chatbot Project' } });
        await db.projectMember.create({
            data: { projectId: project.id, userId: editor.id, role: 'EDITOR' },
        });
    }, 120000);

    afterEach(() => {
        clearAllEphemeralSecrets();
    });

    afterAll(async () => {
        for (const dir of tempDirs) {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
        await fs.rm(path.resolve('storage/projects', project?.id || '__none__'), { recursive: true, force: true }).catch(() => {});
        await harness?.close();
    });

    test('ManagedLoopbackLease strictly allows only 127.0.0.1:<leasedPort>, blocks forged leases, other hosts/ports, 3xx redirects, and revokes on completion', async () => {
        let serverBHits = 0;
        let redirectTargetHits = 0;

        const serverA = http.createServer((req, res) => {
            if (req.url === '/api/redirect') {
                res.writeHead(302, { Location: `http://127.0.0.1:${portB}/stolen` });
                res.end();
                return;
            }
            if (req.url === '/api/sse') {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write('data: {"delta":"Xin "}\n\n');
                res.write('data: {"delta":"chào SSE"}\n\n');
                res.write('data: [DONE]\n\n');
                res.end();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answer: 'Allowed from leased port A' }));
        });

        const serverB = http.createServer((_req, res) => {
            serverBHits += 1;
            redirectTargetHits += 1;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answer: 'Forbidden server B' }));
        });

        await new Promise(resolve => serverA.listen(0, '127.0.0.1', resolve));
        await new Promise(resolve => serverB.listen(0, '127.0.0.1', resolve));
        const portA = serverA.address().port;
        const portB = serverB.address().port;

        try {
            // General External URL validation STILL blocks 127.0.0.1 and localhost
            expect(() => validateEndpoint(`http://127.0.0.1:${portA}/api/chat`)).toThrow(/HTTPS endpoint/);
            expect(() => validateEndpoint('https://localhost/api/chat')).toThrow(/public HTTPS/);

            const leaseA = createManagedLoopbackLease({
                port: portA,
                pid: process.pid,
                isProcessAlive: () => true,
            });

            // 1. Exact leased 127.0.0.1:portA succeeds (JSON + SSE)
            const okRes = await executeTurn(
                { executionMode: 'MANAGED_PROJECT', endpointPath: '/api/chat' },
                { messages: [{ role: 'user', content: 'Hello' }] },
                { lease: leaseA },
            );
            expect(okRes.answer).toBe('Allowed from leased port A');

            const sseRes = await executeTurn(
                { executionMode: 'MANAGED_PROJECT', endpointPath: '/api/sse', response: { format: 'sse', answer: '/answer' } },
                { messages: [{ role: 'user', content: 'Stream' }] },
                { lease: leaseA },
            );
            expect(sseRes.answer).toBe('Xin chào SSE');

            // 2. Forged plain object without private Symbol is rejected
            await expect(
                requestManagedLoopbackJson({
                    lease: { host: '127.0.0.1', port: portA, pid: process.pid, isActive: () => true },
                    endpointPath: '/api/chat',
                    body: {},
                }),
            ).rejects.toMatchObject({ code: 'LOOPBACK_LEASE_INVALID' });

            // 3. Calling another port (portB) or another host ('localhost' / external domain) is rejected before sending
            await expect(
                requestManagedLoopbackJson({
                    lease: leaseA,
                    targetPort: portB,
                    endpointPath: '/api/chat',
                    body: {},
                }),
            ).rejects.toMatchObject({ code: 'LOOPBACK_PORT_MISMATCH' });

            await expect(
                requestManagedLoopbackJson({
                    lease: leaseA,
                    endpoint: `http://127.0.0.1:${portB}/api/chat`,
                    body: {},
                }),
            ).rejects.toMatchObject({ code: 'LOOPBACK_PORT_MISMATCH' });

            await expect(
                requestManagedLoopbackJson({
                    lease: leaseA,
                    endpoint: `http://localhost:${portA}/api/chat`,
                    body: {},
                }),
            ).rejects.toMatchObject({ code: 'LOOPBACK_PORT_MISMATCH' });

            await expect(
                requestManagedLoopbackJson({
                    lease: leaseA,
                    targetHost: '192.168.1.1',
                    endpointPath: '/api/chat',
                    body: {},
                }),
            ).rejects.toMatchObject({ code: 'LOOPBACK_PORT_MISMATCH' });

            // 4. 3xx redirect from leased port is immediately rejected and NEVER followed to server B
            await expect(
                executeTurn(
                    { executionMode: 'MANAGED_PROJECT', endpointPath: '/api/redirect' },
                    { messages: [{ role: 'user', content: 'Try redirect' }] },
                    { lease: leaseA },
                ),
            ).rejects.toMatchObject({ code: 'TARGET_REDIRECT_BLOCKED' });

            expect(serverBHits).toBe(0);
            expect(redirectTargetHits).toBe(0);

            // 5. Once lease is revoked at the end of a run, further calls are rejected
            leaseA.revoke();
            await expect(
                executeTurn(
                    { executionMode: 'MANAGED_PROJECT', endpointPath: '/api/chat' },
                    { messages: [{ role: 'user', content: 'After revoke' }] },
                    { lease: leaseA },
                ),
            ).rejects.toMatchObject({ code: 'LOOPBACK_LEASE_INVALID' });
        } finally {
            await new Promise(resolve => serverA.close(resolve));
            await new Promise(resolve => serverB.close(resolve));
        }
    });

    test('Managed Project auto-starts on 127.0.0.1:<port>, injects Design-Audit-detected LLM key via spawn RAM only (zero key on disk or logs), and cleans up process/port/temp/vault on success & failure', async () => {
        // --- Part A: Successful Managed Evaluation Run ---
        const healthyRepo = await createFixtureChatbotRepo({ mode: 'healthy' });
        const healthySnapshot = await db.projectSnapshot.create({
            data: { projectId: project.id, source: 'ZIP', storagePath: healthyRepo, rootDir: healthyRepo },
        });
        await db.project.update({ where: { id: project.id }, data: { activeSnapshotId: healthySnapshot.id } });

        // Design Audit discovers CUSTOM_BOT_LLM_KEY directly from AST (not guessed)
        const audit = await runChatbotDesignAudit(db, project.id, { snapshotId: healthySnapshot.id });
        expect(audit.detected).toBe(true);
        expect(audit.summary.launchability.ready).toBe(true);
        expect(audit.summary.launchability.requiredLlmEnvVars).toEqual(['CUSTOM_BOT_LLM_KEY']);

        const source = await management.createKnowledgeSourceFromInput(db, project.id, {
            name: 'docs/refund-policy.md',
            snapshotId: healthySnapshot.id,
            filePath: 'docs/refund-policy.md',
        });

        const managedTarget = await management.saveTarget(db, project.id, {
            name: 'Auto-Started Fixture Bot',
            config: {
                executionMode: 'MANAGED_PROJECT',
                endpointPath: '/api/chat',
                response: { format: 'json', answer: '/answer', metadata: '/metadata' },
            },
        });

        const profile = await management.createProfile(db, project.id, 'Managed Auto-Start Suite');
        const happyCase = parse(caseSchema, {
            caseKey: 'refund-happy-1',
            title: 'Hỏi thời hạn hoàn tiền',
            taskType: 'HAPPY_PATH',
            turns: [{ content: 'Chính sách hoàn tiền trong bao nhiêu ngày?' }],
            expectedFacts: ['14 ngày', '100%'],
            sourceQuote: 'Khách hàng được hoàn tiền 100% trong vòng 14 ngày làm việc nếu sản phẩm lỗi kỹ thuật.',
            criteria: [
                {
                    key: 'faithfulness',
                    method: 'rule',
                    rule: { type: 'containsAll', expected: ['14 ngày', '100%'] },
                    sourceIds: [source.id],
                },
            ],
        });
        const savedVersion = await management.saveProfile(db, project.id, profile.versions[0].id, {
            revision: 0,
            definition: parse(definitionSchema, {
                sourceIds: [source.id],
                scoring: { confirmed: true, threshold: 80 },
            }),
            cases: [happyCase],
        });
        const approved = await management.approveProfile(db, project.id, savedVersion.id, savedVersion.revision, editor.id);

        const secretLlmKey = 'AIzaSyManagedRamOnlySecretKeyNeverWriteToDisk777';
        const run = await management.createRun(
            db,
            project.id,
            editor.id,
            {
                targetVersionId: managedTarget.versionId,
                profileVersionId: approved.id,
                snapshotId: healthySnapshot.id,
                idempotencyKey: crypto.randomUUID(),
                llmApiKey: secretLlmKey,
            },
            { enqueue },
        );

        let inspectedTempWorkspace = null;
        await processEvaluation(run.jobId, {
            db,
            onBeforeWorkspaceCleanup: async workspaceDir => {
                inspectedTempWorkspace = workspaceDir;
                // Scan EVERY file inside temporary workspace while it still exists on disk
                await assertNoFileContainsSecret(workspaceDir, secretLlmKey);
            },
        });

        expect(inspectedTempWorkspace).toBeTruthy();
        // Temporary workspace directory must be completely removed in finally
        await expect(fs.stat(inspectedTempWorkspace)).rejects.toMatchObject({ code: 'ENOENT' });

        // Scan original snapshot directory and this project's artifact storage
        await assertNoFileContainsSecret(healthyRepo, secretLlmKey);
        await assertNoFileContainsSecret(path.resolve('storage/projects', project.id), secretLlmKey);

        const report = await getRunReport(db, project.id, run.id);
        expect(report.executionStatus).toBe('COMPLETED');
        expect(report.verdict).toBe('PASSED');
        expect(report.summary.knowledgeProbe?.status).toBe('KNOWLEDGE_READY');

        // Extract child PID and leased port reported by the child chatbot before teardown
        const convEvidence = report.evidence.find(e => e.kind === 'CONVERSATION');
        const observedMeta = convEvidence.payload.responses[0].metadata;
        expect(observedMeta.port).not.toBe(3099); // Hardcoded 3099 was overridden to leased port!
        expect(await isPortInUse(observedMeta.port, '127.0.0.1')).toBe(false);
        await assertPortCanBind(observedMeta.port);
        expect(isPidAlive(observedMeta.pid)).toBe(false);

        // Scan ALL DB records & logs: secret key must NEVER appear anywhere (even though bot echoed it!)
        const [jobRow, jobLogs, jobOut] = await Promise.all([
            db.job.findUnique({ where: { id: run.jobId } }),
            db.jobLog.findMany({ where: { jobId: run.jobId } }),
            db.jobOutput.findUnique({ where: { jobId: run.jobId } }),
        ]);
        expect(jobLogs.length).toBeGreaterThan(0);
        expect(JSON.stringify({ report, jobRow, jobLogs, jobOut })).not.toContain(secretLlmKey);
        expect(__vaultSizeForTest()).toBe(0);

        // --- Part B: Startup Crash Run (bot prints secret key to stderr and exits 1) ---
        const crashRepo = await createFixtureChatbotRepo({ mode: 'startup-crash' });
        const crashSnapshot = await db.projectSnapshot.create({
            data: { projectId: project.id, source: 'ZIP', storagePath: crashRepo, rootDir: crashRepo },
        });
        await runChatbotDesignAudit(db, project.id, { snapshotId: crashSnapshot.id });

        const crashSecretKey = 'AIzaSyCrashRunSecretKeyMustNeverLeakInLogsOrFiles888';
        const crashRun = await management.createRun(
            db,
            project.id,
            editor.id,
            {
                targetVersionId: managedTarget.versionId,
                profileVersionId: approved.id,
                snapshotId: crashSnapshot.id,
                idempotencyKey: crypto.randomUUID(),
                llmApiKey: crashSecretKey,
            },
            { enqueue },
        );

        let crashTempWorkspace = null;
        await processEvaluation(crashRun.jobId, {
            db,
            onBeforeWorkspaceCleanup: async workspaceDir => {
                crashTempWorkspace = workspaceDir;
                await assertNoFileContainsSecret(workspaceDir, crashSecretKey);
            },
        });

        expect(crashTempWorkspace).toBeTruthy();
        await expect(fs.stat(crashTempWorkspace)).rejects.toMatchObject({ code: 'ENOENT' });
        await assertNoFileContainsSecret(crashRepo, crashSecretKey);

        const crashReport = await getRunReport(db, project.id, crashRun.id);
        expect(crashReport.executionStatus).toBe('ERROR');
        expect(crashReport.errorCode).toBe('CHATBOT_START_FAILED');

        const [crashJob, crashLogs] = await Promise.all([
            db.job.findUnique({ where: { id: crashRun.jobId } }),
            db.jobLog.findMany({ where: { jobId: crashRun.jobId } }),
        ]);
        expect(crashLogs.length).toBeGreaterThan(0);
        expect(JSON.stringify({ crashReport, crashJob, crashLogs })).not.toContain(crashSecretKey);
        expect(__vaultSizeForTest()).toBe(0);
    }, 90000);

    test('Knowledge Readiness Probe aborts early with English KNOWLEDGE_NOT_READY error when chatbot lacks document knowledge, creating zero scenario attempts and cleaning up runtime', async () => {
        const unseededRepo = await createFixtureChatbotRepo({ mode: 'unseeded' });
        const unseededSnapshot = await db.projectSnapshot.create({
            data: { projectId: project.id, source: 'ZIP', storagePath: unseededRepo, rootDir: unseededRepo },
        });
        await runChatbotDesignAudit(db, project.id, { snapshotId: unseededSnapshot.id });

        const source = await management.createKnowledgeSourceFromInput(db, project.id, {
            name: 'docs/refund-policy.md',
            snapshotId: unseededSnapshot.id,
            filePath: 'docs/refund-policy.md',
        });
        const managedTarget = await management.saveTarget(db, project.id, {
            name: 'Unseeded RAG Bot',
            config: {
                executionMode: 'MANAGED_PROJECT',
                endpointPath: '/api/chat',
                response: { format: 'json', answer: '/answer', metadata: '/metadata' },
            },
        });

        const profile = await management.createProfile(db, project.id, 'Probe Gate 4-Case Suite');
        const fourCases = [1, 2, 3, 4].map(idx => parse(caseSchema, {
            caseKey: `probe-gate-case-${idx}`,
            title: `Scenario ${idx}`,
            taskType: idx <= 2 ? 'HAPPY_PATH' : 'OUT_OF_SCOPE',
            turns: [{ content: `Câu hỏi kiểm thử số ${idx}: Chính sách hoàn tiền trong bao nhiêu ngày?` }],
            expectedFacts: idx <= 2 ? ['14 ngày', '100%'] : [],
            criteria: [{
                key: idx <= 2 ? 'faithfulness' : 'appropriateRefusal',
                method: 'rule',
                rule: { type: 'containsAll', expected: idx <= 2 ? ['14 ngày'] : ['không'] },
            }],
        }));
        const savedVersion = await management.saveProfile(db, project.id, profile.versions[0].id, {
            revision: 0,
            definition: parse(definitionSchema, {
                sourceIds: [source.id],
                scoring: { confirmed: true, threshold: 75 },
            }),
            cases: fourCases,
        });
        const approved = await management.approveProfile(db, project.id, savedVersion.id, savedVersion.revision, editor.id);

        const probeSecretKey = 'AIzaSyProbeGateSecretKeyNeverPersisted555';
        const run = await management.createRun(
            db,
            project.id,
            editor.id,
            {
                targetVersionId: managedTarget.versionId,
                profileVersionId: approved.id,
                snapshotId: unseededSnapshot.id,
                idempotencyKey: crypto.randomUUID(),
                llmApiKey: probeSecretKey,
            },
            { enqueue },
        );

        let unseededTempDir = null;
        await processEvaluation(run.jobId, {
            db,
            onBeforeWorkspaceCleanup: async dir => {
                unseededTempDir = dir;
                await assertNoFileContainsSecret(dir, probeSecretKey);
            },
        });

        const report = await getRunReport(db, project.id, run.id);
        expect(report.executionStatus).toBe('ERROR');
        expect(report.errorCode).toBe('KNOWLEDGE_NOT_READY');
        expect(report.summary.failureMessage).toMatch(/Knowledge readiness probe failed.*business documents/i);
        expect(report.summary.knowledgeProbe).toMatchObject({
            status: 'KNOWLEDGE_EMPTY_OR_UNSEEDED',
        });
        expect(report.summary.knowledgeProbe.probes).toHaveLength(2);

        // Zero benchmark scenario attempts were created (saved all 4 x 2 = 8 scenario turns & judge quota!)
        const attemptCount = await db.aiEvaluationAttempt.count({ where: { caseResult: { runId: run.id } } });
        expect(attemptCount).toBe(0);

        // Temp directory deleted and vault empty
        await expect(fs.stat(unseededTempDir)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(__vaultSizeForTest()).toBe(0);
    }, 90000);

    test('canceling an active RUNNING Managed Project run kills child process, releases port, removes temp workspace, and wipes vault', async () => {
        const slowRepo = await createFixtureChatbotRepo({ mode: 'slow' });
        const slowSnapshot = await db.projectSnapshot.create({
            data: { projectId: project.id, source: 'ZIP', storagePath: slowRepo, rootDir: slowRepo },
        });
        await runChatbotDesignAudit(db, project.id, { snapshotId: slowSnapshot.id });

        const managedTarget = await management.saveTarget(db, project.id, {
            name: 'Slow Canceled Bot',
            config: {
                executionMode: 'MANAGED_PROJECT',
                endpointPath: '/api/chat',
                response: { format: 'json', answer: '/answer', metadata: '/metadata' },
            },
        });

        const profile = await management.createProfile(db, project.id, 'Cancel Active Managed Run Suite');
        const slowCase = parse(caseSchema, {
            caseKey: 'slow-case-1',
            title: 'Slow turn for cancel test',
            taskType: 'HAPPY_PATH',
            turns: [{ content: 'Chính sách hoàn tiền?' }],
            expectedFacts: ['14 ngày'],
            criteria: [{ key: 'faithfulness', method: 'rule', rule: { type: 'containsAll', expected: ['14 ngày'] } }],
        });
        const savedVersion = await management.saveProfile(db, project.id, profile.versions[0].id, {
            revision: 0,
            definition: parse(definitionSchema, { scoring: { confirmed: true, threshold: 75 } }),
            cases: [slowCase],
        });
        const approved = await management.approveProfile(db, project.id, savedVersion.id, savedVersion.revision, editor.id);

        const cancelSecretKey = 'AIzaSyCanceledLiveRunKeyMustBeWiped333';
        const run = await management.createRun(
            db,
            project.id,
            editor.id,
            {
                targetVersionId: managedTarget.versionId,
                profileVersionId: approved.id,
                snapshotId: slowSnapshot.id,
                idempotencyKey: crypto.randomUUID(),
                llmApiKey: cancelSecretKey,
                skipKnowledgeProbe: true,
            },
            { enqueue },
        );

        let canceledTempDir = null;
        const evalPromise = processEvaluation(run.jobId, {
            db,
            onBeforeWorkspaceCleanup: async dir => {
                canceledTempDir = dir;
                await assertNoFileContainsSecret(dir, cancelSecretKey);
            },
        });

        // Poll until the child chatbot process has started and logged its port/PID in JobLog
        let spawnedPort = null;
        let spawnedPid = null;
        const waitDeadline = Date.now() + 25000;
        while (Date.now() < waitDeadline) {
            const logs = await db.jobLog.findMany({ where: { jobId: run.jobId } });
            const bootLog = logs.find(l => /Isolated chatbot started on http:\/\/127\.0\.0\.1:(\d+) \(PID (\d+)/.test(l.message));
            if (bootLog) {
                const match = bootLog.message.match(/127\.0\.0\.1:(\d+) \(PID (\d+)/);
                spawnedPort = Number(match[1]);
                spawnedPid = Number(match[2]);
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        expect(spawnedPort).toBeGreaterThan(0);
        expect(spawnedPid).toBeGreaterThan(0);

        // Cancel the active run while the 4-second slow turn is in flight
        await cancelRun(db, run.id);
        await evalPromise;

        const finalRun = await db.aiEvaluationRun.findUnique({ where: { id: run.id } });
        expect(finalRun.executionStatus).toBe('CANCELED');

        // Child process must be dead, port free & re-bindable, temp workspace gone, vault empty
        expect(await isPortInUse(spawnedPort, '127.0.0.1')).toBe(false);
        await assertPortCanBind(spawnedPort);
        expect(isPidAlive(spawnedPid)).toBe(false);
        expect(canceledTempDir).toBeTruthy();
        await expect(fs.stat(canceledTempDir)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(__vaultSizeForTest()).toBe(0);

        const allLogs = await db.jobLog.findMany({ where: { jobId: run.jobId } });
        expect(JSON.stringify(allLogs)).not.toContain(cancelSecretKey);
    }, 90000);
});
