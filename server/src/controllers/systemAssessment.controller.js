import fs from 'node:fs';
import prisma from '../config/prisma.js';
import { createSnapshotJob, markQueuedJobFailed } from '../services/job.service.js';
import { snapshotIdentity, acquireSnapshotLease, purgeExpiredAssessmentArtifacts } from '../services/systemAssessmentWorkspace.service.js';
import { containedPath } from '../services/fullSystemConfig.service.js';
import { digest, analyzeSystemTestFile } from '../services/systemTestStaticAnalysis.service.js';
import { createRequirementRevision, confirmRequirementRevision, createAssertionBinding, approveAssertionBinding } from '../services/systemRequirement.service.js';
import { applySystemProposal } from '../services/systemTestImprovementJob.service.js';
import { assessmentRequest, requirementsRequest, bindingRequest, improvementRequest, parseRequest } from '../validators/systemAssessment.validator.js';
import { ServiceError } from '../utils/serviceError.js';
import { discoverSystemAssessment } from '../services/systemAssessmentDiscovery.service.js';

export const assessmentCapabilities = () => ({ enabled: process.env.SYSTEM_ASSESSMENT_ENABLED === 'true', coverageEnabled: process.env.SYSTEM_MEASURED_COVERAGE_ENABLED === 'true', improvementEnabled: process.env.SYSTEM_AI_IMPROVEMENT_ENABLED === 'true', mutationEnabled: process.env.SYSTEM_MUTATION_ENABLED === 'true' && process.env.SYSTEM_MUTATION_TRUSTED_LOCAL === 'true', supported: { runners: ['playwright'], frontend: 'Vite JS/JSX/TS/TSX source instrumentation', backend: 'Node JS ESM/CJS source instrumentation', requirementEvidence: 'Owner-reviewed direct awaited Playwright assertions' } });
export const createAssessmentControllers = ({ client = prisma, queue = async () => import('../services/queue.service.js') } = {}) => {
    const owned = async req => {
        const snapshot = await client.projectSnapshot.findFirst({ where: { id: req.params.snapshotId, project: { ownerId: req.user.id } } });
        if (!snapshot) throw new ServiceError('Snapshot not found', 404);
        return snapshot;
    };
    const handler = fn => async (req, res) => { try { return await fn(req, res); } catch (error) { return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'System assessment operation failed' }); } };
    const enabled = flag => { if (!assessmentCapabilities().enabled || flag && !assessmentCapabilities()[flag]) throw new ServiceError('This evidence capability is not enabled; configure and validate the measurement environment first', 409); };
    const withLease = async (snapshotId, callback) => {
        const module = await queue(), redis = module.getSystemEvidenceRedis ? module.getSystemEvidenceRedis() : await module.jobQueue.client;
        const lease = await acquireSnapshotLease({ redis, snapshotId });
        try { return await callback(lease); } finally { await lease.release(); }
    };
    const admit = async ({ snapshot, userId, type, input, create }) => {
        purgeExpiredAssessmentArtifacts(snapshot.rootDir);
        const identity = snapshotIdentity(snapshot.rootDir);
        const existing = await client.job.findFirst({ where: { snapshotId: snapshot.id, type: { in: ['SYSTEM_TEST_ASSESSMENT', 'SYSTEM_TEST_IMPROVEMENT', 'SYSTEM_TEST_MUTATION'] }, status: { in: ['QUEUED', 'RUNNING'] } } });
        if (existing) throw new ServiceError('Another system evidence operation is queued or running', 409);
        const job = await createSnapshotJob({ projectId: snapshot.projectId, snapshotId: snapshot.id, userId, type, payloadJson: input });
        let record;
        try { record = await create(job, identity); await (await queue()).addJobToQueue(type, job.id); }
        catch (error) {
            if(record) {
                const model=type === 'SYSTEM_TEST_ASSESSMENT' ? client.systemTestAssessment : type === 'SYSTEM_TEST_IMPROVEMENT' ? client.systemTestProposal : client.systemMutationRun;
                await model.update({where:{id:record.id},data:type === 'SYSTEM_TEST_ASSESSMENT' ? {status:'FAILED'} : {state:'FAILED'}});
            }
            await markQueuedJobFailed(job.id,error);throw error;
        }
        return { jobId: job.id, id: record.id };
    };
    return {
        capabilities: handler(async (req, res) => { await owned(req); res.json({ success: true, data: assessmentCapabilities() }); }),
        latest: handler(async (req, res) => { await owned(req); const record = await client.systemTestAssessment.findFirst({ where: { snapshotId: req.params.snapshotId }, orderBy: { createdAt: 'desc' } }); res.json({ success: true, data: record }); }),
        assess: handler(async (req, res) => {
            enabled('coverageEnabled'); const snapshot = await owned(req);
            if (!snapshot.rootDir) throw new ServiceError('Snapshot source is not ready', 409);
            const request = req.body.autoDiscover === true ? discoverSystemAssessment({ rootDir: snapshot.rootDir, runner: req.body.runner, executionMode: req.body.executionMode }) : req.body;
            const input = parseRequest(assessmentRequest, request);
            if (input.runner !== 'playwright') throw new ServiceError('Cypress evidence adapter is not verified', 422);
            if (!snapshot.rootDir) throw new ServiceError('Snapshot source is not ready', 409);
            for (const file of input.testFiles) if (!/\.(spec|test)\.[cm]?[jt]s$/.test(file) || !fs.existsSync(containedPath(snapshot.rootDir, file))) throw new ServiceError('Selected test file not found or unsupported', 422);
            for (const tier of Object.values(input.coverageScope)) containedPath(snapshot.rootDir, tier.root + '/' + tier.sourceDirectory);
            if (input.requirementRevisionId && !await client.systemRequirementRevision.findFirst({ where: { id: input.requirementRevisionId, snapshotId: snapshot.id, status: 'CONFIRMED' } })) throw new ServiceError('Confirmed requirement revision not found', 404);
            const result = await withLease(snapshot.id, () => admit({ snapshot, userId: req.user.id, type: 'SYSTEM_TEST_ASSESSMENT', input, create: (job, identity) => client.systemTestAssessment.create({ data: { snapshotId: snapshot.id, jobId: job.id, requirementRevisionId: input.requirementRevisionId || null, sourceHash: identity.sourceHash, testHash: identity.testHash, scopeHash: digest(input.coverageScope), runner: input.runner, executionMode: input.executionMode, reportJson: { input } } }) }));
            res.status(202).json({ success: true, data: { ...result, assessmentId: result.id } });
        }),
        get: handler(async (req, res) => {
            const snapshot = await owned(req), record = await client.systemTestAssessment.findFirst({ where: { id: req.params.assessmentId, snapshotId: snapshot.id } });
            if (!record) throw new ServiceError('Assessment not found', 404);
            const identity = snapshotIdentity(snapshot.rootDir);
            const latestRevision = await client.systemRequirementRevision.findFirst({where:{snapshotId:snapshot.id,status:'CONFIRMED'},orderBy:{revisionNumber:'desc'}});
            res.json({ success: true, data: { ...record, stale: identity.sourceHash !== record.sourceHash || identity.testHash !== record.testHash || (latestRevision?.id || null) !== record.requirementRevisionId } });
        }),
        requirements: handler(async (req, res) => { const snapshot = await owned(req); res.json({ success: true, data: await client.systemRequirementRevision.findMany({ where: { snapshotId: snapshot.id }, orderBy: { revisionNumber: 'desc' }, include: { bindings: true } }) }); }),
        createRequirements: handler(async (req, res) => { enabled(); const snapshot = await owned(req); const content = parseRequest(requirementsRequest, req.body); res.status(201).json({ success: true, data: await withLease(snapshot.id, () => createRequirementRevision({ client, snapshotId: snapshot.id, content })) }); }),
        confirmRequirements: handler(async (req, res) => { enabled(); const snapshot = await owned(req); res.json({ success: true, data: await withLease(snapshot.id, () => confirmRequirementRevision({ client, snapshotId: snapshot.id, revisionId: req.params.revisionId, contentHash: req.body.expectedContentHash, userId: req.user.id })) }); }),
        createBinding: handler(async (req, res) => { enabled(); const snapshot = await owned(req), input = parseRequest(bindingRequest, req.body); res.status(201).json({ success: true, data: await withLease(snapshot.id, () => createAssertionBinding({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir, revisionId: req.params.revisionId, input })) }); }),
        approveBinding: handler(async (req, res) => { enabled(); const snapshot = await owned(req); res.json({ success: true, data: await withLease(snapshot.id, () => approveAssertionBinding({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir, bindingId: req.params.bindingId, testHash: req.body.expectedTestHash, bindingHash: req.body.expectedBindingHash, userId: req.user.id })) }); }),
        analyze: handler(async (req, res) => { const snapshot = await owned(req), filePath = req.query.filePath; if (typeof filePath !== 'string' || !/\.(spec|test)\.[cm]?[jt]s$/.test(filePath)) throw new ServiceError('Test file path required', 400); const target=containedPath(snapshot.rootDir,filePath);if(fs.statSync(target).size>256*1024)throw new ServiceError('Test file exceeds 256 KiB',413);const content = fs.readFileSync(target, 'utf8'); res.json({ success: true, data: { filePath, testHash: digest(content), ...analyzeSystemTestFile({ content, filePath }) } }); }),
        improve: handler(async (req, res) => {
            enabled('improvementEnabled'); const snapshot = await owned(req), input = parseRequest(improvementRequest, req.body);
            const assessment = await client.systemTestAssessment.findFirst({ where: { id: input.assessmentId, snapshotId: snapshot.id, status: 'COMPLETED' } });
            if (!assessment || !assessment.reportJson.input.testFiles.includes(input.filePath)) throw new ServiceError('Completed assessment for the selected file required', 409);
            const result = await withLease(snapshot.id, () => admit({ snapshot, userId: req.user.id, type: 'SYSTEM_TEST_IMPROVEMENT', input, create: job => client.systemTestProposal.create({ data: { snapshotId: snapshot.id, assessmentId: assessment.id, jobId: job.id, filePath: input.filePath, baseTestHash: input.expectedTestHash, proposedContent: '', verificationJson: {} } }) }));
            res.status(202).json({ success: true, data: { ...result, proposalId: result.id } });
        }),
        proposal: handler(async (req, res) => { const snapshot = await owned(req), record = await client.systemTestProposal.findFirst({ where: { id: req.params.proposalId, snapshotId: snapshot.id } }); if (!record) throw new ServiceError('Proposal not found', 404); const job = client.job ? await client.job.findUnique({where:{id:record.jobId},select:{status:true}}) : null; res.json({ success: true, data: { ...record, jobStatus: job?.status } }); }),
        apply: handler(async (req, res) => { enabled('improvementEnabled'); const snapshot = await owned(req); res.json({ success: true, data: await withLease(snapshot.id, lease => applySystemProposal({ client, rootDir: snapshot.rootDir, snapshotId: snapshot.id, proposalId: req.params.proposalId, expectedCurrentTestHash: req.body.expectedCurrentTestHash, expectedCandidateTestHash: req.body.expectedCandidateTestHash, userId: req.user.id, lease })) }); }),
        mutate: handler(async (req, res) => {
            enabled('mutationEnabled'); const snapshot = await owned(req), assessment = await client.systemTestAssessment.findFirst({ where: { id: req.params.assessmentId, snapshotId: snapshot.id, status: 'COMPLETED' } });
            const targetIds = req.body.targetIds;
            if (!assessment || !Array.isArray(targetIds) || !targetIds.length || targetIds.length > 10 || new Set(targetIds).size !== targetIds.length || !targetIds.every(id => assessment.reportJson.mutationTargets?.some(target => target.id === id))) throw new ServiceError('Select at most ten targets from the current assessment', 400);
            const targetBindings = req.body.targetBindings || {};
            const approved = await client.systemAssertionBinding.findMany({ where: { revisionId: assessment.requirementRevisionId || '', status: 'APPROVED' } });
            if (!targetIds.every(id => Array.isArray(targetBindings[id]) && targetBindings[id].length && targetBindings[id].every(bindingId => approved.some(binding => binding.id === bindingId)))) throw new ServiceError('Review a relevant approved assertion binding for each fault target', 422);
            const input = { assessmentId: assessment.id, targetIds, targetBindings };
            const result = await withLease(snapshot.id, () => admit({ snapshot, userId: req.user.id, type: 'SYSTEM_TEST_MUTATION', input, create: job => client.systemMutationRun.create({ data: { assessmentId: assessment.id, jobId: job.id, manifestJson: input, resultJson: {} } }) }));
            res.status(202).json({ success: true, data: { ...result, mutationRunId: result.id } });
        }),
        mutation: handler(async (req, res) => { await owned(req); const record = await client.systemMutationRun.findFirst({ where: { id: req.params.mutationRunId, assessment: { snapshotId: req.params.snapshotId } } }); if (!record) throw new ServiceError('Mutation run not found', 404); res.json({ success: true, data: record }); }),
    };
};
