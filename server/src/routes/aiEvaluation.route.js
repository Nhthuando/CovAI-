import express from 'express';
import multer from 'multer';
import prisma from '../config/prisma.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { requireEnabled, safeError } from '../services/aiEvaluation/common.js';
import * as service from '../services/aiEvaluation/management.service.js';
import { createEvaluationController } from '../controllers/aiEvaluation.controller.js';

export function createEvaluationRouter({ db = prisma, auth = authMiddleware, enqueue = service.enqueueStrict, transport } = {}) {
    const router = express.Router({ mergeParams: true });
    const controller = createEvaluationController({ db, enqueue, transport });
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 } }).single('file');

    const requireRead = async (req, _res, next) => {
        try {
            req.evaluationAccess = await service.readAccess(db, req.params.projectId, req.user.id);
            next();
        } catch (error) {
            next(error);
        }
    };

    const requireExport = async (req, _res, next) => {
        try {
            req.evaluationAccess = await service.exportAccess(db, req.params.projectId, req.user.id);
            next();
        } catch (error) {
            next(error);
        }
    };

    const requireRun = async (req, _res, next) => {
        try {
            req.evaluationAccess = await service.runAccess(db, req.params.projectId, req.user.id);
            next();
        } catch (error) {
            next(error);
        }
    };

    router.use(auth);
    router.get('/capabilities', requireRead, controller.getCapabilities);

    router.use((_req, _res, next) => {
        try {
            requireEnabled();
            next();
        } catch (error) {
            next(error);
        }
    });

    router.use((req, _res, next) => {
        if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > 2 * 1024 * 1024) {
            return next(Object.assign(new Error('Evaluation request exceeds 2 MiB'), { statusCode: 413, code: 'BODY_TOO_LARGE' }));
        }
        return next();
    });

    // Read-only endpoints (OWNER, EDITOR, VIEWER)
    router.get('/', requireRead, controller.getWorkspace);
    router.get('/design-audit', requireRead, controller.getDesignAudit);
    router.get('/design-audit/report', requireExport, controller.exportDesignAuditReport);
    router.get('/targets', requireRead, controller.listTargets);
    router.get('/sources', requireRead, controller.listSources);
    router.get('/sources/:id', requireRead, controller.getSource);
    router.get('/profiles', requireRead, controller.listProfiles);
    router.get('/profiles/:id', requireRead, controller.getProfile);
    router.get('/profile-versions/:id', requireRead, controller.getProfileVersion);
    router.get('/preparations/:id', requireRead, controller.getPreparation);
    router.get('/runs', requireRead, controller.listRuns);
    router.get('/runs/:id', requireRead, controller.getRun);
    router.get('/runs/:id/cases', requireRead, controller.listRunCases);
    router.get('/case-results/:id', requireRead, controller.getCaseResult);
    router.get('/evidence/:id', requireRead, controller.getEvidence);
    router.get('/runs/:id/report', requireExport, controller.exportReport);
    router.post('/comparisons', requireRead, controller.compareRuns);
    router.get('/profiles/:id/calibration', requireRead, controller.getCalibration);
    router.get('/profiles/:id/blind-reviews', requireRead, controller.getBlindReviews);

    // Execution & configuration endpoints (OWNER, EDITOR; VIEWER gets 403)
    router.post('/design-audit/scan', requireRun, controller.scanDesignAudit);
    router.post('/targets', requireRun, controller.createTarget);
    router.post('/targets/:id/versions', requireRun, controller.createTargetVersion);
    router.post('/targets/:id/test-connection', requireRun, controller.testTargetConnection);
    router.delete('/targets/:id/credentials', requireRun, controller.deleteTargetCredentials);
    router.put('/targets/:id/credentials', requireRun, controller.updateTargetCredentials);
    router.patch('/targets/:id', requireRun, controller.archiveTarget);
    router.post('/sources/upload', requireRun, upload, controller.uploadSource);
    router.post('/sources', requireRun, controller.createSource);
    router.post('/profiles', requireRun, controller.createProfile);
    router.patch('/profiles/:id', requireRun, controller.archiveProfile);
    router.post('/profiles/:id/versions', requireRun, controller.cloneProfileVersion);
    router.patch('/profile-versions/:id', requireRun, controller.saveProfileVersion);
    router.post('/profile-versions/:id/approve', requireRun, controller.approveProfileVersion);
    router.post('/profile-versions/:id/propose', requireRun, controller.proposeBenchmark);
    router.post('/runs', requireRun, controller.createRun);
    router.post('/runs/:id/cancel', requireRun, controller.cancelRun);
    router.post('/runs/:id/rerun', requireRun, controller.rerun);
    router.post('/runs/:id/regrade', requireRun, controller.regrade);
    router.delete('/runs/:id', requireRun, controller.deleteRun);
    router.post('/criterion-results/:id/reviews', requireRun, controller.addHumanReview);

    router.use((error, _req, res, _next) => {
        res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : error.statusCode || 500)
            .json({ success: false, ...safeError(error) });
    });
    return router;
}

export default createEvaluationRouter();
