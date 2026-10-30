import express from 'express';
import multer from 'multer';
import prisma from '../config/prisma.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { enabled, requireEnabled, fail, safeError, hash, TERMINAL } from '../services/aiEvaluation/common.js';
import * as service from '../services/aiEvaluation/management.service.js';
import { saveKnowledge, snapshotKnowledge } from '../services/aiEvaluation/knowledge.service.js';
import { cancelRun } from '../services/aiEvaluation/runner.service.js';
import { getRunReport, compareRuns, calibration, renderEvaluationPdf } from '../services/aiEvaluation/report.service.js';
import { readEvidencePayload, removeRunArtifacts } from '../services/aiEvaluation/artifactStore.service.js';

export function createEvaluationRouter({ db = prisma, auth = authMiddleware, enqueue = service.enqueueStrict, transport } = {}) {
    const router = express.Router({ mergeParams: true });
    router.use(auth);
    router.use(async (req, _res, next) => { try { await service.ownerAccess(db, req.params.projectId, req.user.id); next(); } catch (error) { next(error); } });
    router.get('/capabilities', (_req, res) => res.json({ success: true, data: { enabled: enabled(), actionEnabled: process.env.AI_EVALUATION_ACTION_ENABLED === 'true' } }));
    router.use((_req, _res, next) => { try { requireEnabled(); next(); } catch (error) { next(error); } });
    router.use((req, _res, next) => { if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > 2 * 1024 * 1024) return next(Object.assign(new Error('Evaluation request exceeds 2 MiB'), { statusCode: 413, code: 'BODY_TOO_LARGE' })); next(); });
    const route = (method, path, action, status = 200) => router[method](path, async (req, res, next) => { try { const data = await action(req, res); if (!res.headersSent) res.status(status).json({ success: true, data }); } catch (error) { next(error); } });
    route('get', '/', req => service.workspace(db, req.params.projectId));
    route('get', '/targets', async req => (await service.workspace(db, req.params.projectId)).targets);
    route('post', '/targets', req => service.saveTarget(db, req.params.projectId, req.body), 201);
    route('post', '/targets/:id/versions', req => service.saveTarget(db, req.params.projectId, req.body, req.params.id), 201);
    route('post', '/targets/:id/test-connection', req => service.testConnection(db, req.params.projectId, req.params.id, { transport }));
    route('delete', '/targets/:id/credentials', async req => { await service.targetFor(db, req.params.projectId, req.params.id); await db.aiEvaluationCredential.updateMany({ where: { targetId: req.params.id }, data: { revokedAt: new Date() } }); return { configured: false }; });
    route('put', '/targets/:id/credentials', async req => { const target = await service.targetFor(db, req.params.projectId, req.params.id); const latest = await db.aiEvaluationTargetVersion.findFirst({ where: { targetId: target.id }, orderBy: { version: 'desc' } }); return service.saveTarget(db, req.params.projectId, { name: target.name, config: latest.config, credential: req.body.credential }, target.id); });
    route('patch', '/targets/:id', async req => { await service.targetFor(db, req.params.projectId, req.params.id); if (req.body.archived !== true) fail('INVALID_ARCHIVE', 'Use versions to change target configuration'); return db.aiEvaluationTarget.update({ where: { id: req.params.id }, data: { archivedAt: new Date() } }); });
    route('get', '/sources', async req => (await service.workspace(db, req.params.projectId)).sources);
    route('get', '/sources/:id', async req => service.must(await db.aiEvaluationKnowledgeSource.findFirst({ where: { id: req.params.id, projectId: req.params.projectId, status: { not: 'PROCESSING' } } })));
    async function prepare(req, metadata) {
        const job = await db.job.create({ data: { projectId: req.params.projectId, userId: req.user.id, type: 'AI_EVALUATION_PREPARE', payloadJson: JSON.stringify(metadata) } });
        try { await enqueue('AI_EVALUATION_PREPARE', job.id); }
        catch { await db.job.updateMany({ where: { id: job.id, status: 'QUEUED' }, data: { status: 'FAILED', errorMessage: 'Enqueue failed', finishedAt: new Date() } }); if (metadata.sourceId) await db.aiEvaluationKnowledgeSource.updateMany({ where: { id: metadata.sourceId, status: 'PROCESSING' }, data: { status: 'ERROR', content: '' } }); fail('QUEUE_UNAVAILABLE', 'Preparation could not be queued. Restore Redis and retry.', 503); }
        return { jobId: job.id, ...metadata };
    }
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 } }).single('file');
    router.post('/sources/upload', upload, async (req, res, next) => {
        try {
            if (!req.file) fail('FILE_REQUIRED', 'Choose a knowledge file');
            const source = await saveKnowledge(db, req.params.projectId, { name: req.file.originalname.slice(0, 200), format: 'PENDING', status: 'PROCESSING', content: req.file.buffer.toString('base64'), contentHash: hash(req.file.buffer.toString('base64')), provenance: { type: 'UPLOAD' } });
            res.status(202).json({ success: true, data: await prepare(req, { sourceId: source.id }) });
        } catch (error) { next(error); }
    });
    route('post', '/sources', async req => {
        const { name, content, snapshotId, filePath } = req.body;
        if (typeof name !== 'string' || !name.trim() || name.length > 200) fail('INVALID_NAME', 'Enter a source name');
        if (snapshotId) return saveKnowledge(db, req.params.projectId, { name, ...await snapshotKnowledge(db, req.params.projectId, snapshotId, filePath) });
        if (typeof content !== 'string' || !content.trim() || content.length > 200000) fail('INVALID_SOURCE_SIZE', 'Enter 1 to 200,000 characters');
        return saveKnowledge(db, req.params.projectId, { name, content, format: 'text', contentHash: hash(content), provenance: { type: 'USER_PROVIDED' } });
    }, 201);
    route('get', '/profiles', async req => (await service.workspace(db, req.params.projectId)).profiles);
    route('post', '/profiles', req => service.createProfile(db, req.params.projectId, req.body.name), 201);
    route('get', '/profiles/:id', async req => { const profile = await service.profileFor(db, req.params.projectId, req.params.id); return { ...profile, versions: await db.aiEvaluationProfileVersion.findMany({ where: { profileId: profile.id }, orderBy: { version: 'desc' } }) }; });
    route('patch', '/profiles/:id', async req => { await service.profileFor(db, req.params.projectId, req.params.id); if (req.body.archived !== true) fail('INVALID_ARCHIVE', 'Use draft versions to edit benchmarks'); return db.aiEvaluationProfile.update({ where: { id: req.params.id }, data: { archivedAt: new Date() } }); });
    route('post', '/profiles/:id/versions', req => service.cloneProfile(db, req.params.projectId, req.params.id), 201);
    route('get', '/profile-versions/:id', req => service.versionFor(db, req.params.projectId, req.params.id));
    route('patch', '/profile-versions/:id', req => service.saveProfile(db, req.params.projectId, req.params.id, req.body));
    route('post', '/profile-versions/:id/approve', req => service.approveProfile(db, req.params.projectId, req.params.id, req.body.revision, req.user.id));
    route('post', '/profile-versions/:id/propose', async req => { const version = await service.versionFor(db, req.params.projectId, req.params.id); if (version.status !== 'DRAFT' || !version.definition.judge.generationConsent) fail('PROPOSAL_CONSENT_REQUIRED', 'Save a draft with benchmark-generation consent before requesting a proposal'); return prepare(req, { profileVersionId: version.id, revision: version.revision }); }, 202);
    route('get', '/preparations/:id', async req => { const job = service.must(await db.job.findFirst({ where: { id: req.params.id, projectId: req.params.projectId, type: 'AI_EVALUATION_PREPARE' } })); return { id: job.id, status: job.status, errorMessage: job.errorMessage, result: job.resultJson ? JSON.parse(job.resultJson) : null }; });
    route('post', '/runs', req => service.createRun(db, req.params.projectId, req.user.id, req.body, { enqueue }), 202);
    route('get', '/runs', async req => (await service.workspace(db, req.params.projectId)).runs);
    route('get', '/runs/:id', req => getRunReport(db, req.params.projectId, req.params.id));
    route('get', '/runs/:id/cases', async req => (await getRunReport(db, req.params.projectId, req.params.id)).cases);
    route('get', '/case-results/:id', async req => { const c = service.must(await db.aiEvaluationCaseResult.findFirst({ where: { id: req.params.id, run: { projectId: req.params.projectId } } })); return (await getRunReport(db, req.params.projectId, c.runId)).cases.find(row => row.id === c.id); });
    route('get', '/evidence/:id', async req => { const row = service.must(await db.aiEvaluationEvidence.findFirst({ where: { id: req.params.id, run: { projectId: req.params.projectId } } })); return { ...row, payload: await readEvidencePayload(req.params.projectId, row.runId, row.payload) }; });
    route('post', '/runs/:id/cancel', async req => { await service.runFor(db, req.params.projectId, req.params.id); return cancelRun(db, req.params.id); });
    route('post', '/runs/:id/rerun', async req => { const run = await service.runFor(db, req.params.projectId, req.params.id); if (!TERMINAL.includes(run.executionStatus)) fail('RUN_ACTIVE', 'Wait for the original run or cancel it before rerunning'); return service.createRun(db, req.params.projectId, req.user.id, { targetVersionId: run.targetVersionId, profileVersionId: run.profileVersionId, snapshotId: run.snapshotId, idempotencyKey: req.body.idempotencyKey }, { enqueue, parentRunId: run.id }); }, 202);
    route('delete', '/runs/:id', async req => { const run = await service.runFor(db, req.params.projectId, req.params.id); if (!TERMINAL.includes(run.executionStatus)) fail('RUN_ACTIVE', 'Cancel the run before deleting it'); const evidence = await db.aiEvaluationEvidence.findMany({ where: { runId: run.id } }); await removeRunArtifacts(req.params.projectId, run.id, evidence); await db.$transaction(async tx => { await tx.aiEvaluationRun.delete({ where: { id: run.id } }); await tx.job.deleteMany({ where: { id: run.jobId } }); }); return { deleted: true }; });
    route('get', '/runs/:id/report', async (req, res) => {
        const report = await getRunReport(db, req.params.projectId, req.params.id);
        if (!TERMINAL.includes(report.executionStatus)) fail('RUN_ACTIVE', 'Wait for a terminal run before exporting');
        if (req.query.format === 'pdf') { res.type('application/pdf').attachment(`chatbot-evaluation-${report.id}.pdf`).send(await renderEvaluationPdf(report)); return; }
        res.type('application/json').attachment(`chatbot-evaluation-${report.id}.json`).send(JSON.stringify(report, null, 2));
    });
    route('post', '/comparisons', req => compareRuns(db, req.params.projectId, req.body.runIds));
    route('post', '/criterion-results/:id/reviews', req => service.addReview(db, req.params.projectId, req.params.id, req.user.id, req.body), 201);
    route('get', '/profiles/:id/calibration', req => calibration(db, req.params.projectId, req.params.id));
    router.use((error, _req, res, _next) => res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : error.statusCode || 500).json({ success: false, ...safeError(error) }));
    return router;
}
export default createEvaluationRouter();
