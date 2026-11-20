import prisma from '../config/prisma.js';
import * as service from '../services/aiEvaluation/management.service.js';
import { getChatbotDesignAudit, runChatbotDesignAudit } from '../services/aiEvaluation/designAudit.service.js';
import { exportDesignAuditReport } from '../services/aiEvaluation/designAuditReport.service.js';
import { cancelProjectRun } from '../services/aiEvaluation/runner.service.js';
import { requestRegrade } from '../services/aiEvaluation/regrade.service.js';
import { getRunReport, compareRuns, calibration, getBlindReviewQueue, exportRunReport } from '../services/aiEvaluation/report.service.js';

export function createEvaluationController({ db = prisma, enqueue = service.enqueueStrict, transport } = {}) {
    const json = (handler, status = 200) => async (req, res, next) => {
        try {
            const data = await handler(req, res);
            if (!res.headersSent) {
                res.status(status).json({ success: true, data });
            }
        } catch (error) {
            next(error);
        }
    };

    return {
        getCapabilities: json(req => service.getCapabilities(db, req.params.projectId, req.user.id)),
        getWorkspace: json(req => service.workspace(db, req.params.projectId, req.user.id)),
        getDesignAudit: json(req => getChatbotDesignAudit(db, req.params.projectId, {
            snapshotId: typeof req.query.snapshotId === 'string' ? req.query.snapshotId : undefined,
        })),
        scanDesignAudit: json(req => runChatbotDesignAudit(db, req.params.projectId, {
            snapshotId: typeof req.body?.snapshotId === 'string' ? req.body.snapshotId : undefined,
        })),
        listTargets: json(async req => (await service.workspace(db, req.params.projectId, req.user.id)).targets),
        createTarget: json(req => service.saveTarget(db, req.params.projectId, req.body), 201),
        createTargetVersion: json(req => service.saveTarget(db, req.params.projectId, req.body, req.params.id), 201),
        testTargetConnection: json(req => service.testConnection(db, req.params.projectId, req.params.id, {
            transport,
            ephemeralCredential: req.body?.credential,
            ephemeralLlmApiKey: req.body?.llmApiKey,
            snapshotId: typeof req.body?.snapshotId === 'string' ? req.body.snapshotId : undefined,
        })),
        deleteTargetCredentials: json(req => service.revokeTargetCredentials(db, req.params.projectId, req.params.id)),
        updateTargetCredentials: json(req => service.rotateTargetCredential(db, req.params.projectId, req.params.id, req.body?.credential)),
        archiveTarget: json(req => service.archiveTarget(db, req.params.projectId, req.params.id, req.body?.archived)),
        listSources: json(async req => (await service.workspace(db, req.params.projectId, req.user.id)).sources),
        getSource: json(req => service.getKnowledgeSource(db, req.params.projectId, req.params.id)),
        uploadSource: json(req => service.uploadKnowledgeSource(db, req.params.projectId, req.user.id, req.file, enqueue), 202),
        createSource: json(req => service.createKnowledgeSourceFromInput(db, req.params.projectId, req.body), 201),
        listProfiles: json(async req => (await service.workspace(db, req.params.projectId, req.user.id)).profiles),
        createProfile: json(req => service.createProfile(db, req.params.projectId, req.body?.name), 201),
        getProfile: json(req => service.getProfileWithVersions(db, req.params.projectId, req.params.id)),
        archiveProfile: json(req => service.archiveProfile(db, req.params.projectId, req.params.id, req.body?.archived)),
        cloneProfileVersion: json(req => service.cloneProfile(db, req.params.projectId, req.params.id), 201),
        getProfileVersion: json(req => service.versionWithPreparation(db, req.params.projectId, req.params.id)),
        saveProfileVersion: json(req => service.saveProfile(db, req.params.projectId, req.params.id, req.body)),
        approveProfileVersion: json(req => service.approveProfile(db, req.params.projectId, req.params.id, req.body?.revision, req.user.id)),
        proposeBenchmark: json(req => service.requestBenchmarkProposal(db, req.params.projectId, req.user.id, req.params.id, enqueue), 202),
        getPreparation: json(req => service.getPreparationStatus(db, req.params.projectId, req.params.id)),
        createRun: json(req => service.createRun(db, req.params.projectId, req.user.id, req.body, { enqueue }), 202),
        listRuns: json(async req => (await service.workspace(db, req.params.projectId, req.user.id)).runs),
        getRun: json(req => getRunReport(db, req.params.projectId, req.params.id)),
        listRunCases: json(async req => (await getRunReport(db, req.params.projectId, req.params.id)).cases),
        getCaseResult: json(req => service.getCaseResultDetail(db, req.params.projectId, req.params.id)),
        getEvidence: json(req => service.getEvidenceDetail(db, req.params.projectId, req.params.id)),
        cancelRun: json(req => cancelProjectRun(db, req.params.projectId, req.params.id)),
        rerun: json(req => service.rerunEvaluation(db, req.params.projectId, req.user.id, req.params.id, req.body, { enqueue }), 202),
        regrade: json(req => requestRegrade(db, req.params.projectId, req.user.id, req.params.id, { enqueue }), 202),
        deleteRun: json(req => service.deleteEvaluationRun(db, req.params.projectId, req.params.id)),
        exportDesignAuditReport: async (req, res, next) => {
            try {
                const exported = await exportDesignAuditReport(db, req.params.projectId, req.user.id, req.query.format);
                res.type(exported.contentType).attachment(exported.filename).send(exported.body);
            } catch (error) {
                next(error);
            }
        },
        exportReport: async (req, res, next) => {
            try {
                const exported = await exportRunReport(db, req.params.projectId, req.params.id, req.query.format);
                res.type(exported.contentType)
                    .attachment(exported.filename)
                    .send(exported.body);
            } catch (error) {
                next(error);
            }
        },
        compareRuns: json(req => compareRuns(db, req.params.projectId, req.body?.runIds)),
        addHumanReview: json(req => service.addReview(db, req.params.projectId, req.params.id, req.user.id, req.body), 201),
        getCalibration: json(req => calibration(db, req.params.projectId, req.params.id)),
        getBlindReviews: json(req => getBlindReviewQueue(db, req.params.projectId, req.params.id, {
            limit: req.query.limit,
        })),
    };
}
