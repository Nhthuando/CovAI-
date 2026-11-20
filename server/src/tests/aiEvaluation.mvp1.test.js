import { describe, test, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import express from 'express';
import request from 'supertest';
import { evaluationDatabase } from './helpers/aiEvaluationDatabase.js';

process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.AI_EVALUATION_ENABLED = 'true';
process.env.ENCRYPTION_KEY = '22'.repeat(32);

const {
    storeEphemeralSecret,
    readEphemeralSecret,
    destroyEphemeralSecret,
    clearAllEphemeralSecrets,
    __inspectVaultBufferForTest,
    __vaultSizeForTest,
} = await import('../services/aiEvaluation/ephemeralSecret.service.js');
const { extractKnowledge } = await import('../services/aiEvaluation/knowledge.service.js');
const { analyzeChatbotWorkspace, maskSecretsInSnippet } = await import('../services/aiEvaluation/designAudit.service.js');
const { createEvaluationRouter } = await import('../routes/aiEvaluation.route.js');
const { processEvaluation, processEvaluationPrepare } = await import('../services/aiEvaluation/runner.service.js');
const management = await import('../services/aiEvaluation/management.service.js');
const { exportRunReport } = await import('../services/aiEvaluation/report.service.js');
const { parse, caseSchema, definitionSchema } = await import('../services/aiEvaluation/contracts.js');

function buildDocxBuffer(documentXml, headerXml = null) {
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>', 'utf8'));
    zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
    if (headerXml) {
        zip.addFile('word/header1.xml', Buffer.from(headerXml, 'utf8'));
    }
    return zip.toBuffer();
}

function buildSpoofedZipBombDocxBuffer() {
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>', 'utf8'));
    const hugeXml = `<w:document><w:body><w:p><w:r><w:t>${'A'.repeat(21 * 1024 * 1024)}</w:t></w:r></w:p></w:body></w:document>`;
    zip.addFile('word/document.xml', Buffer.from(hugeXml, 'utf8'));
    const buf = zip.toBuffer();
    const targetName = Buffer.from('word/document.xml', 'utf8');
    for (let i = 0; i <= buf.length - 30; i++) {
        const sig = buf.readUInt32LE(i);
        if (sig === 0x04034b50) {
            const nameLen = buf.readUInt16LE(i + 26);
            if (i + 30 + nameLen <= buf.length && buf.subarray(i + 30, i + 30 + nameLen).equals(targetName)) {
                buf.writeUInt32LE(64, i + 22);
            }
        } else if (sig === 0x02014b50 && i <= buf.length - 46) {
            const nameLen = buf.readUInt16LE(i + 28);
            if (i + 46 + nameLen <= buf.length && buf.subarray(i + 46, i + 46 + nameLen).equals(targetName)) {
                buf.writeUInt32LE(64, i + 24);
            }
        }
    }
    return buf;
}

function buildCorruptedDeflateDocxBuffer() {
    const buf = Buffer.from(buildDocxBuffer(`<w:document><w:body><w:p><w:r><w:t>${'Valid paragraph text '.repeat(60)}</w:t></w:r></w:p></w:body></w:document>`));
    const targetName = Buffer.from('word/document.xml', 'utf8');
    for (let i = 0; i <= buf.length - 30; i++) {
        if (buf.readUInt32LE(i) === 0x04034b50) {
            const nameLen = buf.readUInt16LE(i + 26);
            const extraLen = buf.readUInt16LE(i + 28);
            if (i + 30 + nameLen <= buf.length && buf.subarray(i + 30, i + 30 + nameLen).equals(targetName)) {
                const dataStart = i + 30 + nameLen + extraLen;
                for (let j = 0; j < 10 && dataStart + j < buf.length; j++) {
                    buf[dataStart + j] = 0xff;
                }
                break;
            }
        }
    }
    return buf;
}

describe('Chatbot Evaluation MVP-1: Ephemeral Vault, DOCX Extraction, Layer 1 Design Audit & RBAC', () => {
    let harness, db, app, owner, editor, viewer, outsider, project, tempDirs = [];
    const queued = [];
    const enqueue = async (type, jobId) => { queued.push({ type, jobId }); };

    async function makeTempDir(prefix = 'covai-mvp1-fixture-') {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
        tempDirs.push(dir);
        return dir;
    }

    beforeAll(async () => {
        harness = await evaluationDatabase();
        db = harness.db;
        owner = await db.user.create({ data: { email: 'mvp1-owner@evaluation.invalid', aiUsageCount: 7, aiUsageDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) } });
        editor = await db.user.create({ data: { email: 'mvp1-editor@evaluation.invalid' } });
        viewer = await db.user.create({ data: { email: 'mvp1-viewer@evaluation.invalid' } });
        outsider = await db.user.create({ data: { email: 'mvp1-outsider@evaluation.invalid' } });

        project = await db.project.create({ data: { ownerId: owner.id, name: 'MVP-1 Chatbot Project' } });
        await db.projectMember.createMany({
            data: [
                { projectId: project.id, userId: editor.id, role: 'EDITOR' },
                { projectId: project.id, userId: viewer.id, role: 'VIEWER' },
            ],
        });

        app = express();
        app.use(express.json());
        app.use(
            '/api/projects/:projectId/ai-evaluations',
            createEvaluationRouter({
                db,
                enqueue,
                auth: (req, _res, next) => { req.user = { id: req.headers['x-test-user'] || owner.id }; next(); },
                transport: async ({ headers }) => ({ answer: `Auth header received: ${Boolean(headers.Authorization)}` }),
            }),
        );
    }, 120000);

    afterEach(() => {
        clearAllEphemeralSecrets();
    });

    afterAll(async () => {
        for (const dir of tempDirs) {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
        await harness?.close();
    });

    test('ephemeralSecret stores Buffer in RAM, enforces TTL & project scope, zeroes bytes on destroy, and checks worker colocation', () => {
        const now = 1_700_000_000_000;
        const { vaultRefId } = storeEphemeralSecret({
            secret: 'sk-ephemeral-super-secret-value-999',
            projectId: 'proj-a',
            kind: 'llmApiKey',
            ttlMs: 5000,
            now,
        });

        const rawBuffer = __inspectVaultBufferForTest(vaultRefId);
        expect(Buffer.isBuffer(rawBuffer)).toBe(true);
        expect(readEphemeralSecret(vaultRefId, { projectId: 'proj-a', now: now + 1000 })).toBe('sk-ephemeral-super-secret-value-999');

        // Cross-project read is blocked
        expect(() => readEphemeralSecret(vaultRefId, { projectId: 'proj-b', now: now + 1000 })).toThrow(/does not belong/);

        // Destroy zeroes the underlying Buffer in-place
        expect(destroyEphemeralSecret(vaultRefId)).toBe(true);
        expect(rawBuffer.every(byte => byte === 0)).toBe(true);
        expect(() => readEphemeralSecret(vaultRefId, { projectId: 'proj-a', now: now + 1000 })).toThrow(/expired or was already cleared/);

        // TTL expiry also zeroes Buffer
        const second = storeEphemeralSecret({ secret: 'temporary-bearer-token', projectId: 'proj-a', ttlMs: 2000, now });
        const secondBuf = __inspectVaultBufferForTest(second.vaultRefId);
        expect(() => readEphemeralSecret(second.vaultRefId, { projectId: 'proj-a', now: now + 2001 })).toThrow(/expired/);
        expect(secondBuf.every(byte => byte === 0)).toBe(true);

        // Header injection (CRLF) is rejected
        expect(() => storeEphemeralSecret({ secret: 'bad\r\nX-Injected: 1', projectId: 'proj-a' })).toThrow(/single-line/);

        // Split-worker deployment fails fast with 503
        expect(() => storeEphemeralSecret({
            secret: 'valid-secret',
            projectId: 'proj-a',
            env: { COVAI_WORKER_ENABLED: 'false' },
        })).toThrow(/same server process/);
    });

    test('ephemeral targetAuthToken works end-to-end in run execution without persisting to DB, Job payload, or Evidence, and is wiped in finally', async () => {
        const target = await management.saveTarget(db, project.id, {
            name: 'Stateless Auth Bot',
            ephemeral: true,
            config: {
                executionMode: 'EXTERNAL_URL',
                endpoint: 'https://bot.example.com/api/chat',
                auth: { type: 'bearer' },
            },
        });
        expect(await db.aiEvaluationCredential.count({ where: { targetId: target.targetId } })).toBe(0);

        const profile = await management.createProfile(db, project.id, 'Ephemeral Run Suite');
        const qa = parse(caseSchema, {
            caseKey: 'ephemeral-qa-1',
            title: 'Check policy',
            taskType: 'HAPPY_PATH',
            turns: [{ content: 'What is the warranty?' }],
            criteria: [{ key: 'faithfulness', method: 'rule', rule: { type: 'containsAll', expected: ['12 months'] } }],
        });
        const saved = await management.saveProfile(db, project.id, profile.versions[0].id, {
            revision: 0,
            definition: parse(definitionSchema, { scoring: { confirmed: true, threshold: 70 } }),
            cases: [qa],
        });
        const approved = await management.approveProfile(db, project.id, saved.id, saved.revision, editor.id);

        const rawToken = 'ephemeral-bearer-token-never-persist-xyz123';
        const run = await management.createRun(
            db,
            project.id,
            editor.id,
            {
                targetVersionId: target.versionId,
                profileVersionId: approved.id,
                idempotencyKey: crypto.randomUUID(),
                targetAuthToken: rawToken,
            },
            { enqueue },
        );

        // Verify Job.payloadJson only stores a vault reference ID, never the raw token
        const dbJob = await db.job.findUnique({ where: { id: run.jobId } });
        expect(dbJob.payloadJson).not.toContain(rawToken);
        const parsedPayload = JSON.parse(dbJob.payloadJson);
        expect(parsedPayload.targetTokenRef).toBeTruthy();

        let observedAuthHeader = null;
        await processEvaluation(run.jobId, {
            db,
            transport: async ({ headers }) => {
                observedAuthHeader = headers.Authorization;
                return { answer: `Warranty is 12 months (echo ${rawToken})` };
            },
        });

        expect(observedAuthHeader).toBe(`Bearer ${rawToken}`);
        // Token must be destroyed from RAM immediately after processEvaluation finally block
        expect(() => readEphemeralSecret(parsedPayload.targetTokenRef, { projectId: project.id })).toThrow(/expired or was already cleared/);
        // Evidence must have redacted the echoed secret
        const allEvidence = await db.aiEvaluationEvidence.findMany({ where: { runId: run.id } });
        expect(JSON.stringify(allEvidence)).not.toContain(rawToken);
        expect(await db.aiEvaluationCredential.count({ where: { targetId: target.targetId } })).toBe(0);
    }, 60000);

    test('extractKnowledge & upload endpoint parse Vietnamese DOCX files cleanly and reject malformed DOCX archives', async () => {
        const docxBuf = buildDocxBuffer(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
              <w:body>
                <w:p><w:r><w:t>Quy định đổi trả &amp; bảo hành</w:t></w:r></w:p>
                <w:p><w:r><w:t>Khách hàng được đổi trả miễn phí trong vòng 7 ngày kể từ ngày nhận hàng.</w:t></w:r></w:p>
                <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Gói tiêu chuẩn</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Phí 0&#x20AC;</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
              </w:body>
            </w:document>`,
            `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Tài liệu Nghiệp vụ Nội bộ</w:t></w:r></w:p></w:hdr>`,
        );

        const extracted = await extractKnowledge(docxBuf, 'chinh-sach.docx');
        expect(extracted.format).toBe('docx');
        expect(extracted.content).toContain('Tài liệu Nghiệp vụ Nội bộ');
        expect(extracted.content).toContain('Quy định đổi trả & bảo hành');
        expect(extracted.content).toContain('Khách hàng được đổi trả miễn phí trong vòng 7 ngày');
        expect(extracted.content).toContain('Phí 0€');

        const uploadRes = await request(app)
            .post(`/api/projects/${project.id}/ai-evaluations/sources/upload`)
            .set('x-test-user', editor.id)
            .attach('file', docxBuf, 'chinh-sach.docx');
        expect(uploadRes.status).toBe(202);
        await processEvaluationPrepare(uploadRes.body.data.jobId, { db });

        const savedSource = await db.aiEvaluationKnowledgeSource.findUnique({ where: { id: uploadRes.body.data.sourceId } });
        expect(savedSource.status).toBe('READY');
        expect(savedSource.format).toBe('docx');
        expect(savedSource.content).toContain('7 ngày');

        await expect(extractKnowledge(Buffer.from('not-a-zip'), 'broken.docx')).rejects.toThrow(/corrupted|not a valid/i);
    }, 60000);

    test('Layer 1 Design Audit detects AI SDKs, routes, env vars, docs, and all static design flaws without leaking hardcoded keys', async () => {
        const vulnerableDir = await makeTempDir('covai-vuln-chatbot-');
        await fs.mkdir(path.join(vulnerableDir, 'src/routes'), { recursive: true });
        await fs.mkdir(path.join(vulnerableDir, 'docs'), { recursive: true });

        const fakeGeminiKey = 'AIzaSyD1234567890abcdefghijklmnopqrstuvwx';
        await fs.writeFile(path.join(vulnerableDir, 'package.json'), JSON.stringify({
            name: 'demo-chatbot',
            scripts: { start: 'node src/server.js' },
            dependencies: { express: '^4.19.0', '@google/generative-ai': '^0.24.0' },
        }, null, 2));
        await fs.writeFile(path.join(vulnerableDir, 'docs/faq.md'), '# FAQ\nHoàn tiền trong 7 ngày.');
        await fs.writeFile(path.join(vulnerableDir, 'src/server.js'), `
            import express from 'express';
            import { GoogleGenerativeAI } from '@google/generative-ai';
            const app = express();
            app.use(express.json());
            const genAI = new GoogleGenerativeAI("${fakeGeminiKey}");
            app.post('/api/chat', async (req, res) => {
                console.log(req.body);
                const { messages, question } = req.body;
                const model = genAI.getGenerativeModel({
                    model: 'gemini-2.5-flash',
                    systemInstruction: "You are a friendly store bot. User asked: " + question
                });
                const out = await model.generateContent({ contents: messages });
                res.json({ data: { reply: out.response.text() } });
            });
            app.listen(process.env.PORT || 3001);
        `);

        const snapshot = await db.projectSnapshot.create({
            data: {
                projectId: project.id,
                source: 'GITHUB',
                storagePath: vulnerableDir,
                rootDir: vulnerableDir,
            },
        });
        await db.project.update({ where: { id: project.id }, data: { activeSnapshotId: snapshot.id } });

        // Before scanning, GET /design-audit never auto-scans (even if ?autoScan=true is sent)
        const preScanViewerRes = await request(app)
            .get(`/api/projects/${project.id}/ai-evaluations/design-audit?snapshotId=${snapshot.id}&autoScan=true`)
            .set('x-test-user', viewer.id);
        expect(preScanViewerRes.status).toBe(200);
        expect(preScanViewerRes.body.data).toMatchObject({
            id: null,
            snapshotId: snapshot.id,
            status: 'NOT_SCANNED',
            detected: false,
        });
        expect(await db.aiEvaluationDesignAudit.count({ where: { projectId: project.id, snapshotId: snapshot.id } })).toBe(0);

        // Viewer cannot trigger POST scan
        const viewerScanAttempt = await request(app)
            .post(`/api/projects/${project.id}/ai-evaluations/design-audit/scan`)
            .set('x-test-user', viewer.id)
            .send({ snapshotId: snapshot.id });
        expect(viewerScanAttempt.status).toBe(403);

        // Editor triggers scan
        const scanRes = await request(app)
            .post(`/api/projects/${project.id}/ai-evaluations/design-audit/scan`)
            .set('x-test-user', editor.id)
            .send({ snapshotId: snapshot.id });
        expect(scanRes.status).toBe(200);
        const audit = scanRes.body.data;

        expect(audit.detected).toBe(true);
        expect(audit.summary.sdks.some(s => s.name === '@google/generative-ai')).toBe(true);
        expect(audit.summary.endpoints.some(e => e.endpointPath === '/api/chat' && e.method === 'POST')).toBe(true);
        expect(audit.summary.candidateDocs.some(d => d.path === 'docs/faq.md')).toBe(true);
        expect(audit.summary.launchability).toMatchObject({ mode: 'MANAGED_PROJECT', ready: true });

        const ruleIds = audit.findings.map(f => f.ruleId);
        expect(ruleIds).toEqual(expect.arrayContaining([
            'CB-SEC-01', // Hardcoded key
            'CB-SEC-02', // Ungrounded system prompt
            'CB-SEC-03', // Dynamic user input in systemInstruction
            'CB-PRIV-01', // console.log(req.body)
            'CB-REL-01', // Missing rate limit & length cap
            'CB-REL-02', // Missing try/catch around generateContent
            'CB-ARCH-01', // Unbounded messages array
        ]));

        // Hardcoded key value must NEVER be stored or returned unmasked
        expect(JSON.stringify(audit)).not.toContain(fakeGeminiKey);

        // Auto-fill config matches locked defaults (16 scenarios, K=2, 3.5-flash-lite / 3.8-flash, /data/reply)
        expect(audit.autoFillConfig).toMatchObject({
            executionMode: 'MANAGED_PROJECT',
            endpointPath: '/api/chat',
            conversationMode: 'messages',
            responsePointer: '/data/reply',
            scenarioCount: 16,
            repetitions: 2,
            generatorModel: 'gemini-3.5-flash-lite',
            judgeModel: 'gemini-3.8-flash',
        });

        // Viewer can read persisted audit and capabilities (including remaining quota)
        const getRes = await request(app)
            .get(`/api/projects/${project.id}/ai-evaluations/design-audit?snapshotId=${snapshot.id}`)
            .set('x-test-user', viewer.id);
        expect(getRes.status).toBe(200);
        expect(getRes.body.data.id).toBe(audit.id);

        const capRes = await request(app)
            .get(`/api/projects/${project.id}/ai-evaluations/capabilities`)
            .set('x-test-user', owner.id);
        expect(capRes.status).toBe(200);
        expect(capRes.body.data.quota).toMatchObject({
            limit: 50,
            used: 7,
            remaining: 43,
            bestCaseRunEstimate: { min: 18, max: 20 },
        });
    }, 60000);

    test('Layer 1 Design Audit scores clean chatbot at 100 and handles Python / non-AI projects accurately', async () => {
        const cleanDir = await makeTempDir('covai-clean-chatbot-');
        await fs.writeFile(path.join(cleanDir, 'package.json'), JSON.stringify({
            name: 'clean-bot',
            scripts: { start: 'node index.js' },
            dependencies: { express: '^4.19.0', 'express-rate-limit': '^7.0.0', openai: '^4.0.0' },
        }));
        await fs.writeFile(path.join(cleanDir, 'index.js'), `
            import express from 'express';
            import rateLimit from 'express-rate-limit';
            import OpenAI from 'openai';
            const app = express();
            app.use(rateLimit({ windowMs: 60000, max: 20 }));
            const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const SYSTEM_PROMPT = "Only answer based strictly on the provided context. Do not invent facts and politely refuse out-of-scope requests.";
            app.post('/api/chat', async (req, res) => {
                const rawMessages = Array.isArray(req.body.messages) ? req.body.messages : [];
                const last = String(rawMessages.at(-1)?.content || '');
                if (last.length > 2000) return res.status(400).json({ message: 'Too long' });
                try {
                    const completion = await client.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...rawMessages.slice(-10)],
                    });
                    res.json({ answer: completion.choices[0].message.content });
                } catch {
                    res.status(502).json({ message: 'Assistant temporarily unavailable' });
                }
            });
        `);
        const cleanAudit = await analyzeChatbotWorkspace(cleanDir);
        expect(cleanAudit.detected).toBe(true);
        expect(cleanAudit.findings).toEqual([]);
        expect(cleanAudit.designScore).toBe(100);
        expect(cleanAudit.autoFillConfig.llmEnvVars).toContain('OPENAI_API_KEY');

        const pyDir = await makeTempDir('covai-python-chatbot-');
        await fs.writeFile(path.join(pyDir, 'requirements.txt'), 'fastapi==0.115.0\nopenai==1.50.0\nuvicorn==0.30.0\n');
        await fs.writeFile(path.join(pyDir, 'main.py'), 'from openai import OpenAI\nclient = OpenAI()\n');
        const pyAudit = await analyzeChatbotWorkspace(pyDir);
        expect(pyAudit.detected).toBe(true);
        expect(pyAudit.summary.ecosystem).toBe('python');
        expect(pyAudit.summary.launchability.mode).toBe('EXTERNAL_URL');
        expect(pyAudit.summary.pythonParserLimitation).toMatch(/Express\/Node\.js/);

        const plainDir = await makeTempDir('covai-plain-crud-');
        await fs.writeFile(path.join(plainDir, 'package.json'), JSON.stringify({ name: 'todo-app', dependencies: { express: '^4.19.0' } }));
        await fs.writeFile(path.join(plainDir, 'server.js'), 'import express from "express"; const app = express(); app.get("/todos", (_req, res) => res.json([]));');
        const plainAudit = await analyzeChatbotWorkspace(plainDir);
        expect(plainAudit.detected).toBe(false);
        expect(plainAudit.findings).toEqual([]);
    });

    test('canceling a QUEUED run and early returns in processEvaluation wipe ephemeral vault secrets immediately', async () => {
        const managedTarget = await management.saveTarget(db, project.id, {
            name: 'Managed Bot Cancel Test',
            config: {
                executionMode: 'MANAGED_PROJECT',
                endpointPath: '/api/chat',
                auth: { type: 'bearer' },
            },
        });
        const profile = await management.createProfile(db, project.id, 'Cancel Vault Suite');
        const qa = parse(caseSchema, {
            caseKey: 'cancel-vault-1',
            title: 'Check cancel cleanup',
            taskType: 'HAPPY_PATH',
            turns: [{ content: 'Hello' }],
            criteria: [{ key: 'faithfulness', method: 'rule', rule: { type: 'containsAll', expected: ['Hi'] } }],
        });
        const saved = await management.saveProfile(db, project.id, profile.versions[0].id, {
            revision: 0,
            definition: parse(definitionSchema, { scoring: { confirmed: true, threshold: 70 } }),
            cases: [qa],
        });
        const approved = await management.approveProfile(db, project.id, saved.id, saved.revision, editor.id);

        const run = await management.createRun(
            db,
            project.id,
            editor.id,
            {
                targetVersionId: managedTarget.versionId,
                profileVersionId: approved.id,
                idempotencyKey: crypto.randomUUID(),
                llmApiKey: 'AIzaSyQueuedRunLlmKeyShouldBeWipedOnCancel99',
                targetAuthToken: 'bearer-queued-token-should-be-wiped-on-cancel',
            },
            { enqueue },
        );

        expect(run.executionStatus).toBe('QUEUED');
        expect(__vaultSizeForTest()).toBe(2);

        const queuedJob = await db.job.findUnique({ where: { id: run.jobId }, select: { payloadJson: true } });
        const { llmKeyRef, targetTokenRef } = JSON.parse(queuedJob.payloadJson);
        const llmBuf = __inspectVaultBufferForTest(llmKeyRef);
        const tokenBuf = __inspectVaultBufferForTest(targetTokenRef);
        expect(Buffer.isBuffer(llmBuf)).toBe(true);
        expect(Buffer.isBuffer(tokenBuf)).toBe(true);

        // Cancel while still QUEUED via HTTP endpoint
        const cancelRes = await request(app)
            .post(`/api/projects/${project.id}/ai-evaluations/runs/${run.id}/cancel`)
            .set('x-test-user', editor.id);
        expect(cancelRes.status).toBe(200);
        expect(cancelRes.body.data.executionStatus).toBe('CANCELED');

        // Vault must have zero entries and Buffers must be zeroized in-place
        expect(__vaultSizeForTest()).toBe(0);
        expect(llmBuf.every(b => b === 0)).toBe(true);
        expect(tokenBuf.every(b => b === 0)).toBe(true);
        expect(() => readEphemeralSecret(llmKeyRef, { projectId: project.id })).toThrow(/expired or was already cleared/);
        expect(() => readEphemeralSecret(targetTokenRef, { projectId: project.id })).toThrow(/expired or was already cleared/);
        expect((await db.job.findUnique({ where: { id: run.jobId }, select: { payloadJson: true } })).payloadJson).toBe('{}');

        // Also test processEvaluation early-return branch directly when a terminal run still had a lingering ref in Job.payloadJson
        const orphanSecret = storeEphemeralSecret({ secret: 'lingering-early-return-secret', projectId: project.id, kind: 'llmApiKey' });
        const orphanBuf = __inspectVaultBufferForTest(orphanSecret.vaultRefId);
        await db.job.update({
            where: { id: run.jobId },
            data: { payloadJson: JSON.stringify({ llmKeyRef: orphanSecret.vaultRefId }) },
        });
        expect(__vaultSizeForTest()).toBe(1);

        await processEvaluation(run.jobId, { db });
        expect(__vaultSizeForTest()).toBe(0);
        expect(orphanBuf.every(b => b === 0)).toBe(true);
    }, 60000);

    test('designAudit masks (a) unquoted keys, (b) masks before 220-char truncation, (c) masks console.warn errors, and enforces 20 MB async scan cap', async () => {
        // (a) Unquoted key assignments: GEMINI_API_KEY=xxx, apiKey: xxx
        const unquotedEnv = maskSecretsInSnippet('GEMINI_API_KEY=rawUnquotedGeminiValue123');
        expect(unquotedEnv).toBe('GEMINI_API_KEY=[REDACTED]');
        expect(unquotedEnv).not.toContain('rawUnquotedGeminiValue123');

        const unquotedObj = maskSecretsInSnippet('const cfg = { apiKey: myRawSecret999, timeout: 3000 };');
        expect(unquotedObj).toContain('apiKey: [REDACTED]');
        expect(unquotedObj).not.toContain('myRawSecret999');

        // Safe process.env reference stays readable
        expect(maskSecretsInSnippet('const cfg = { apiKey: process.env.OPENAI_API_KEY };')).toContain('process.env.OPENAI_API_KEY');

        // (b) Masking happens BEFORE slicing to 220 characters (secret straddling char 220 boundary never leaks prefix)
        const secretCrossingBoundary = 'AIzaSyBoundarySecretKey1234567890abcdefghijk';
        const quotedCrossingSecret = 'superQuotedBoundarySecret9876543210';
        const unquotedCrossingSecret = 'unquotedBoundarySecretValue9876543210';

        const paddedKeyLine = `${'x'.repeat(205)}${secretCrossingBoundary}`;
        const maskedKeyLine = maskSecretsInSnippet(paddedKeyLine);
        expect(maskedKeyLine.length).toBeLessThanOrEqual(220);
        expect(maskedKeyLine).not.toContain('AIzaSy');
        expect(maskedKeyLine).not.toContain('BoundarySecret');

        const paddedQuotedLine = `const pad = "${'y'.repeat(182)}"; const apiKey = "${quotedCrossingSecret}";`;
        const maskedQuotedLine = maskSecretsInSnippet(paddedQuotedLine);
        expect(maskedQuotedLine.length).toBe(220);
        expect(maskedQuotedLine).not.toContain('superQuoted');

        const paddedUnquotedLine = `const pad = "${'z'.repeat(182)}"; GEMINI_API_KEY=${unquotedCrossingSecret}`;
        const maskedUnquotedLine = maskSecretsInSnippet(paddedUnquotedLine);
        expect(maskedUnquotedLine.length).toBe(220);
        expect(maskedUnquotedLine).not.toContain('unquotedBoundary');

        // (c) console.warn on invalid package.json masks any raw secret present in err.message
        const brokenPkgDir = await makeTempDir('covai-warn-mask-');
        const rawPkgSecret = 'leakedPkgWarnSecret987654';
        await fs.writeFile(
            path.join(brokenPkgDir, 'package.json'),
            `{ GEMINI_API_KEY=${rawPkgSecret} }`,
            'utf8',
        );
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await analyzeChatbotWorkspace(brokenPkgDir);
            expect(warnSpy).toHaveBeenCalled();
            const warnOutput = warnSpy.mock.calls.flat().join(' ');
            expect(warnOutput).toContain('[DesignAudit] Invalid package.json');
            expect(warnOutput).not.toContain(rawPkgSecret);
        } finally {
            warnSpy.mockRestore();
        }

        // (d) ReDoS protection: adversarial long strings complete well under 50 ms each
        for (const adversarial of ['api_key'.repeat(20000), 'a'.repeat(200000), 'x-'.repeat(100000)]) {
            const startedAt = performance.now();
            const out = maskSecretsInSnippet(adversarial);
            const elapsedMs = performance.now() - startedAt;
            expect(out.length).toBeLessThanOrEqual(220);
            expect(elapsedMs).toBeLessThan(50);
        }

        // Bounded async scan stops reading once maxTotalBytes is reached
        const budgetDir = await makeTempDir('covai-scan-budget-');
        await fs.writeFile(path.join(budgetDir, 'a.js'), `const a = "${'a'.repeat(4000)}";`);
        await fs.writeFile(path.join(budgetDir, 'b.js'), `const b = "${'b'.repeat(4000)}";`);
        const boundedAudit = await analyzeChatbotWorkspace(budgetDir, { maxTotalBytes: 5000 });
        expect(boundedAudit.summary.scanBudget.truncated).toBe(true);
        expect(boundedAudit.summary.scanBudget.bytesRead).toBeLessThanOrEqual(5000);
    });

    test('extractKnowledge rejects spoofed-header DOCX zip-bombs (> 20 MB), entry-flood archives (> 2000 entries), and corrupted deflate streams with English errors', async () => {
        // 1. Zip-bomb: compressed ~22 KB, spoofed header.size = 64 bytes, real uncompressed > 20 MB
        const bombDocx = buildSpoofedZipBombDocxBuffer();
        expect(bombDocx.byteLength).toBeLessThan(200 * 1024);
        expect(new AdmZip(bombDocx).getEntry('word/document.xml').header.size).toBe(64);
        await expect(extractKnowledge(bombDocx, 'zip-bomb.docx')).rejects.toMatchObject({
            code: 'SOURCE_TOO_LARGE',
            message: expect.stringMatching(/20 MB safety limit/),
        });

        // 2. Entry-flood archive (> 2,000 entries) -> INVALID_DOCX in English
        const floodZip = new AdmZip();
        floodZip.addFile('word/document.xml', Buffer.from('<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>', 'utf8'));
        for (let i = 0; i < 2002; i++) {
            floodZip.addFile(`customXml/item${i}.txt`, Buffer.from('x', 'utf8'));
        }
        await expect(extractKnowledge(floodZip.toBuffer(), 'entry-flood.docx')).rejects.toMatchObject({
            code: 'INVALID_DOCX',
            message: expect.stringMatching(/maximum limit of 2,000 entries/),
        });

        // 3. Corrupted deflate payload inside a structurally valid ZIP -> INVALID_DOCX in English
        const corruptedDeflate = buildCorruptedDeflateDocxBuffer();
        await expect(extractKnowledge(corruptedDeflate, 'corrupted-stream.docx')).rejects.toMatchObject({
            code: 'INVALID_DOCX',
            message: expect.stringMatching(/corrupted|unreadable|failed CRC/i),
        });
    }, 60000);

    test('saveTarget rejects unpersisted inline credentials with 400 CREDENTIAL_NOT_PERSISTED (never dropping silently), prepare failure updates run in $transaction, and RUN_ACTIVE is enforced in report.service', async () => {
        // 1. Sending credential WITHOUT persistCredential: true fails fast with 400 CREDENTIAL_NOT_PERSISTED (never dropped silently)
        const rejectedTargetRes = await request(app)
            .post(`/api/projects/${project.id}/ai-evaluations/targets`)
            .set('x-test-user', editor.id)
            .send({
                name: 'Legacy UI Credential Attempt',
                credential: 'do-not-drop-silently-token',
                config: {
                    executionMode: 'EXTERNAL_URL',
                    endpoint: 'https://bot.example.com/chat',
                    auth: { type: 'bearer' },
                },
            });
        expect(rejectedTargetRes.status).toBe(400);
        expect(rejectedTargetRes.body).toMatchObject({
            success: false,
            code: 'CREDENTIAL_NOT_PERSISTED',
            message: expect.stringMatching(/ephemeral by default.*persistCredential:\s*true/i),
        });

        // 2. Saving target WITHOUT credential creates an ephemeral-ready target cleanly with 0 DB credential rows
        const defaultEphemeralRes = await request(app)
            .post(`/api/projects/${project.id}/ai-evaluations/targets`)
            .set('x-test-user', editor.id)
            .send({
                name: 'Default Ephemeral Target',
                config: {
                    executionMode: 'EXTERNAL_URL',
                    endpoint: 'https://bot.example.com/chat',
                    auth: { type: 'bearer' },
                },
            });
        expect(defaultEphemeralRes.status).toBe(201);
        expect(await db.aiEvaluationCredential.count({ where: { targetId: defaultEphemeralRes.body.data.targetId } })).toBe(0);

        // Creating a new target version with credential & without persistCredential: true also returns 400 CREDENTIAL_NOT_PERSISTED
        const rejectedVersionRes = await request(app)
            .post(`/api/projects/${project.id}/ai-evaluations/targets/${defaultEphemeralRes.body.data.targetId}/versions`)
            .set('x-test-user', editor.id)
            .send({
                name: 'Default Ephemeral Target',
                credential: 'version-credential-without-opt-in',
                config: {
                    executionMode: 'EXTERNAL_URL',
                    endpoint: 'https://bot.example.com/chat',
                    auth: { type: 'bearer' },
                },
            });
        expect(rejectedVersionRes.status).toBe(400);
        expect(rejectedVersionRes.body.code).toBe('CREDENTIAL_NOT_PERSISTED');
        expect(await db.aiEvaluationCredential.count({ where: { targetId: defaultEphemeralRes.body.data.targetId } })).toBe(0);

        // 3. Explicit persistCredential: true stores encrypted ciphertext
        const optInPersistedRes = await request(app)
            .post(`/api/projects/${project.id}/ai-evaluations/targets`)
            .set('x-test-user', editor.id)
            .send({
                name: 'Opt-in Persisted Target',
                credential: 'explicitly-persisted-token',
                persistCredential: true,
                config: {
                    executionMode: 'EXTERNAL_URL',
                    endpoint: 'https://bot.example.com/chat',
                    auth: { type: 'bearer' },
                },
            });
        expect(optInPersistedRes.status).toBe(201);
        expect(await db.aiEvaluationCredential.count({ where: { targetId: optInPersistedRes.body.data.targetId } })).toBe(1);

        // Prepare enqueue failure marks both Job and KnowledgeSource failed atomically
        await expect(
            management.uploadKnowledgeSource(
                db,
                project.id,
                editor.id,
                { originalname: 'faq.txt', buffer: Buffer.from('Warranty 12 months', 'utf8') },
                async () => { throw new Error('Redis down'); },
            ),
        ).rejects.toMatchObject({ code: 'QUEUE_UNAVAILABLE' });
        const erroredSource = await db.aiEvaluationKnowledgeSource.findFirst({
            where: { projectId: project.id, name: 'faq.txt', status: 'ERROR' },
            select: { id: true, content: true },
        });
        expect(erroredSource).toBeTruthy();
        expect(erroredSource.content).toBe('');

        // RUN_ACTIVE check lives in report.service (exportRunReport) and blocks exporting QUEUED runs
        const profile = await management.createProfile(db, project.id, 'Active Export Guard Suite');
        const qa = parse(caseSchema, {
            caseKey: 'export-guard-1',
            title: 'Guard active export',
            taskType: 'HAPPY_PATH',
            turns: [{ content: 'Ping' }],
            criteria: [{ key: 'faithfulness', method: 'rule', rule: { type: 'containsAll', expected: ['Pong'] } }],
        });
        const saved = await management.saveProfile(db, project.id, profile.versions[0].id, {
            revision: 0,
            definition: parse(definitionSchema, { scoring: { confirmed: true, threshold: 70 } }),
            cases: [qa],
        });
        const approved = await management.approveProfile(db, project.id, saved.id, saved.revision, editor.id);
        const activeRun = await management.createRun(
            db,
            project.id,
            editor.id,
            {
                targetVersionId: optInPersistedRes.body.data.versionId,
                profileVersionId: approved.id,
                idempotencyKey: crypto.randomUUID(),
            },
            { enqueue },
        );

        await expect(exportRunReport(db, project.id, activeRun.id, 'json')).rejects.toMatchObject({ code: 'RUN_ACTIVE' });
        const exportHttpRes = await request(app)
            .get(`/api/projects/${project.id}/ai-evaluations/runs/${activeRun.id}/report?format=json`)
            .set('x-test-user', viewer.id);
        expect(exportHttpRes.status).toBe(422);
        expect(exportHttpRes.body.code).toBe('RUN_ACTIVE');
    }, 60000);
});
