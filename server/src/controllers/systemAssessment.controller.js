import { membershipWhere } from '../services/projectAccess.service.js';
import { IMPROVEMENT_LIMITS as improvementLimits } from '../../../shared/systemImprovement.js';
import { requestedAiModel } from '../utils/selectedAiModel.js';
import fs from 'node:fs';
import prisma from '../config/prisma.js';
import { createSnapshotJob, markQueuedJobFailed } from '../services/job.service.js';
import { snapshotIdentity, acquireSnapshotLease, purgeExpiredAssessmentArtifacts } from '../services/systemAssessmentWorkspace.service.js';
import { containedPath, resolveSystemRepositoryRoot } from '../services/fullSystemConfig.service.js';
import { digest, analyzeSystemTestFile } from '../services/systemTestStaticAnalysis.service.js';
import { createRequirementRevision, confirmRequirementRevision, createAssertionBinding, approveAssertionBinding } from '../services/systemRequirement.service.js';
import { applySystemProposal } from '../services/systemTestImprovementJob.service.js';
import { assessmentRequest, automaticAssessmentRequest, requirementsRequest, bindingRequest, improvementRequest, parseRequest } from '../validators/systemAssessment.validator.js';
import { ServiceError } from '../utils/serviceError.js';
import { summarizeImprovementVerification } from '../services/systemImprovementFeedback.service.js';
import { proposalProgress } from '../services/systemImprovementProgress.service.js';
import { publishAppliedAssessment } from '../services/systemAssessmentPersistence.service.js';
import { syncSystemScenarioCatalog, createManualScenario, materializeManualScenario, updateScenarioDraft, reviewScenario, confirmScenarioExpected, evaluateRunReadiness } from '../services/systemScenarioCatalog.service.js';
import { scenarioDraftRequest, scenarioUpdateRequest, scenarioReviewRequest, scenarioExpectedConfirmationRequest, proposalReviewRequest } from '../validators/systemAssessment.validator.js';
import { discoverScenarioFeatures } from '../services/systemScenarioFeatures.service.js';
import { renderSystemTestPdf } from '../services/systemTestPdf.service.js';
import { discoverSystemAssessment } from '../services/systemAssessmentDiscovery.service.js';
import { replaySystemEvents } from '../services/systemLiveEvent.service.js';
import { readOwnedRunArtifact } from '../services/systemRunArtifact.service.js';
import { reviewSystemProposal, registerAppliedProposalReview, proposalReviewHash } from '../services/systemProposalReview.service.js';

export const assessmentCapabilities = () => ({ enabled: process.env.SYSTEM_ASSESSMENT_ENABLED === 'true', coverageEnabled: process.env.SYSTEM_MEASURED_COVERAGE_ENABLED === 'true', improvementEnabled: process.env.SYSTEM_AI_IMPROVEMENT_ENABLED === 'true', mutationEnabled: process.env.SYSTEM_MUTATION_ENABLED === 'true' && process.env.SYSTEM_MUTATION_TRUSTED_LOCAL === 'true', supported: { runners: ['playwright'], frontend: 'Vite JS/JSX/TS/TSX source instrumentation', backend: 'Node JS ESM/CJS source instrumentation', requirementEvidence: 'Owner-reviewed direct awaited Playwright assertions' } });
export const createAssessmentControllers = ({ client = prisma, queue = async () => import('../services/queue.service.js'), createJob = createSnapshotJob } = {}) => {
    const owned = async req => {
        const snapshot = await client.projectSnapshot.findFirst({ where: { id: req.params.snapshotId, project: membershipWhere(req.user.id) } });
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
    const admit = async ({ snapshot, userId, type, input, create, canonicalize = false }) => {
        const existing = await client.job.findFirst({ where: { snapshotId: snapshot.id, type: { in: ['SYSTEM_TEST_ASSESSMENT', 'SYSTEM_TEST_IMPROVEMENT', 'SYSTEM_TEST_MUTATION'] }, status: { in: ['QUEUED', 'RUNNING'] } } });
        if (existing) throw new ServiceError('Another system evidence operation is queued or running', 409);
        if (canonicalize) {
            const rootDir = resolveSystemRepositoryRoot(snapshot.rootDir);
            if (rootDir !== snapshot.rootDir) {
                await client.projectSnapshot.update({where:{id:snapshot.id},data:{rootDir}});
                snapshot.rootDir = rootDir;
            }
        }
        purgeExpiredAssessmentArtifacts(snapshot.rootDir);
        const identity = snapshotIdentity(snapshot.rootDir);
        const job = await createJob({ projectId: snapshot.projectId, snapshotId: snapshot.id, userId, type, payloadJson: input });
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
        catalog: handler(async (req, res) => { const snapshot = await owned(req); const scenarios = await client.systemScenario.findMany({ where: { snapshotId: snapshot.id }, orderBy: [{ filePath: 'asc' }, { title: 'asc' }] }); res.json({ success: true, data: { scenarios, discoveryStatus: scenarios.length ? 'DISCOVERED' : 'NOT_SCANNED' } }); }),
        catalogFeatures: handler(async (req, res) => { const snapshot = await owned(req); if (!snapshot.rootDir) throw new ServiceError('Snapshot source is not ready', 409); res.json({ success: true, data: { features: discoverScenarioFeatures(snapshot.rootDir) } }); }),
        syncCatalog: handler(async (req, res) => { enabled(); const snapshot = await owned(req); if (!snapshot.rootDir) throw new ServiceError('Snapshot source is not ready', 409); res.json({ success: true, data: await withLease(snapshot.id, () => syncSystemScenarioCatalog({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir })) }); }),
        prepareCatalog: handler(async (req, res) => {
            enabled('coverageEnabled');
            const snapshot = await owned(req);
            if (!snapshot.rootDir) throw new ServiceError('Snapshot source is not ready', 409);
            const requested = parseRequest(automaticAssessmentRequest, { autoDiscover: true, runner: 'playwright', executionMode: req.body?.executionMode || 'full', model: requestedAiModel(req) });
            const input = { ...requested, prepareOnly: true };
            const result = await withLease(snapshot.id, () => admit({ snapshot, canonicalize: true, userId: req.user.id, type: 'SYSTEM_TEST_ASSESSMENT', input, create: (job, identity) => client.systemTestAssessment.create({ data: { snapshotId: snapshot.id, jobId: job.id, sourceHash: identity.sourceHash, testHash: identity.testHash, scopeHash: digest({}), runner: 'playwright', executionMode: input.executionMode, reportJson: { input } } }) }));
            res.status(202).json({ success: true, data: { jobId: result.jobId, assessmentId: result.id } });
        }),
        createScenario: handler(async (req, res) => { enabled(); const snapshot = await owned(req); const input = parseRequest(scenarioDraftRequest, req.body); res.status(201).json({ success: true, data: await withLease(snapshot.id, () => createManualScenario({ client, snapshotId: snapshot.id, input })) }); }),
        materializeScenario: handler(async (req, res) => { enabled(); const snapshot = await owned(req); res.status(201).json({ success: true, data: await withLease(snapshot.id, () => materializeManualScenario({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir, scenarioId: req.params.scenarioId })) }); }),
        updateScenario: handler(async (req, res) => { enabled(); const snapshot = await owned(req); const input = parseRequest(scenarioUpdateRequest, req.body); res.json({ success: true, data: await withLease(snapshot.id, () => updateScenarioDraft({ client, snapshotId: snapshot.id, scenarioId: req.params.scenarioId, input })) }); }),
        reviewScenario: handler(async (req, res) => { enabled(); const snapshot = await owned(req); const input = parseRequest(scenarioReviewRequest, req.body); res.json({ success: true, data: await withLease(snapshot.id, () => reviewScenario({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir, scenarioId: req.params.scenarioId, expectedScenarioHash: input.expectedScenarioHash, revisionId: input.revisionId, expectedRequirementHash: input.expectedRequirementHash, assertionIds: input.assertionIds, userId: req.user.id })) }); }),
        confirmScenarioExpected: handler(async (req, res) => { enabled(); const snapshot = await owned(req); const input = parseRequest(scenarioExpectedConfirmationRequest, req.body); res.json({ success: true, data: await withLease(snapshot.id, () => confirmScenarioExpected({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir, scenarioId: req.params.scenarioId, expectedScenarioHash: input.expectedScenarioHash, userId: req.user.id })) }); }),
        readiness: handler(async (req, res) => { const snapshot = await owned(req); const testFiles = typeof req.query.testFiles === 'string' ? req.query.testFiles.split(',').filter(Boolean) : []; const scenarioIds = typeof req.query.scenarioIds === 'string' ? req.query.scenarioIds.split(',').filter(Boolean) : []; if (testFiles.length > 20 || testFiles.some(file => !/\.(spec|test)\.[cm]?[jt]s$/.test(file))) throw new ServiceError('Select supported Playwright JS/TS spec files', 400); if (scenarioIds.length > 100) throw new ServiceError('Select at most 100 scenarios', 400); const reviewMode = req.query.reviewMode === 'scenario' ? 'scenario' : 'legacy'; res.json({ success: true, data: await evaluateRunReadiness({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir, revisionId: req.query.revisionId, testFiles, reviewMode, scenarioIds }) }); }),
        discovery: handler(async (req, res) => { const snapshot = await owned(req); if (!snapshot.rootDir) throw new ServiceError('Snapshot source is not ready', 409); const executionMode = req.query.executionMode === 'full' ? 'full' : 'frontend'; res.json({ success: true, data: discoverSystemAssessment({ rootDir: snapshot.rootDir, executionMode }) }); }),
        latest: handler(async (req, res) => { await owned(req); const record = await client.systemTestAssessment.findFirst({ where: { snapshotId: req.params.snapshotId }, orderBy: { createdAt: 'desc' } }); res.json({ success: true, data: record }); }),
        assess: handler(async (req, res) => {
            enabled('coverageEnabled'); const snapshot = await owned(req);
            if (!snapshot.rootDir) throw new ServiceError('Snapshot source is not ready', 409);
            if (req.body.autoDiscover === true) throw new ServiceError('Prepare project tests in the scenario catalog, confirm requirements and review Input/Expected before running', 409);
            const input = parseRequest(assessmentRequest, req.body);
            if (input.runner !== 'playwright') throw new ServiceError('Cypress evidence adapter is not verified', 422);
            if (!snapshot.rootDir) throw new ServiceError('Snapshot source is not ready', 409);
            for (const file of input.testFiles || []) if (!/\.(spec|test)\.[cm]?[jt]s$/.test(file) || !fs.existsSync(containedPath(snapshot.rootDir, file))) throw new ServiceError('Selected test file not found or unsupported', 422);
            for (const tier of Object.values(input.coverageScope || {})) containedPath(snapshot.rootDir, tier.root + '/' + tier.sourceDirectory);
            if (input.requirementRevisionId && !await client.systemRequirementRevision.findFirst({ where: { id: input.requirementRevisionId, snapshotId: snapshot.id, status: 'CONFIRMED' } })) throw new ServiceError('Confirmed requirement revision not found', 404);
            const readiness = await evaluateRunReadiness({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir, revisionId: input.requirementRevisionId, testFiles: input.testFiles, reviewMode: input.reviewMode, scenarioIds: input.scenarioIds });
            if (!readiness.ready) throw new ServiceError(`Review required before run: ${readiness.blockers.slice(0, 3).map(blocker => blocker.message).join('; ')}`, 409);
            const result = await withLease(snapshot.id, () => admit({ snapshot, userId: req.user.id, type: 'SYSTEM_TEST_ASSESSMENT', input, create: (job, identity) => client.systemTestAssessment.create({ data: { snapshotId: snapshot.id, jobId: job.id, requirementRevisionId: input.requirementRevisionId || null, sourceHash: identity.sourceHash, testHash: identity.testHash, scopeHash: digest(input.coverageScope || {}), runner: input.runner, executionMode: input.executionMode, reportJson: { input } } }) }));
            res.status(202).json({ success: true, data: { ...result, assessmentId: result.id } });
        }),
        get: handler(async (req, res) => {
            const snapshot = await owned(req), record = await client.systemTestAssessment.findFirst({ where: { id: req.params.assessmentId, snapshotId: snapshot.id } });
            if (!record) throw new ServiceError('Assessment not found', 404);
            const identity = snapshotIdentity(resolveSystemRepositoryRoot(snapshot.rootDir));
            const latestRevision = await client.systemRequirementRevision.findFirst({where:{snapshotId:snapshot.id,status:'CONFIRMED'},orderBy:{revisionNumber:'desc'}});
            res.json({ success: true, data: { ...record, stale: identity.sourceHash !== record.sourceHash || identity.testHash !== record.testHash || (latestRevision?.id || null) !== record.requirementRevisionId } });
        }),
        reportPdf: handler(async (req, res) => {
            const snapshot = await owned(req);
            const assessment = await client.systemTestAssessment.findFirst({ where: { id: req.params.assessmentId, snapshotId: snapshot.id, status: 'COMPLETED' } });
            if (!assessment) throw new ServiceError('Completed assessment not found', 404);
            const artifacts = await client.systemRunArtifact.findMany({ where: { assessmentId: assessment.id }, orderBy: { createdAt: 'asc' }, take: 500 });
            const pdf = await renderSystemTestPdf({ assessment, artifacts });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="covai-system-test-${assessment.id.replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`);
            res.setHeader('Cache-Control', 'private, no-store');
            res.send(pdf);
        }),
        events: handler(async (req, res) => {
            const snapshot = await owned(req);
            const assessment = await client.systemTestAssessment.findFirst({ where: { id: req.params.assessmentId, snapshotId: snapshot.id }, select: { id: true } });
            if (!assessment) throw new ServiceError('Assessment not found', 404);
            const after = Number(req.query.after || 0), limit = Number(req.query.limit || 100);
            res.json({ success: true, data: await replaySystemEvents({ client, assessmentId: assessment.id, after, limit }) });
        }),
        scenarioEvidence: handler(async (req, res) => {
            const snapshot = await owned(req);
            const assessment = await client.systemTestAssessment.findFirst({ where: { id: req.params.assessmentId, snapshotId: snapshot.id }, select: { id: true } });
            if (!assessment) throw new ServiceError('Assessment not found', 404);
            const scenario = await client.systemScenario.findFirst({ where: { snapshotId: snapshot.id, scenarioKey: req.params.scenarioKey }, select: { scenarioKey: true } });
            if (!scenario) throw new ServiceError('Scenario not found', 404);
            const artifacts = await client.systemRunArtifact.findMany({ where: { assessmentId: assessment.id, scenarioKey: scenario.scenarioKey }, orderBy: { createdAt: 'asc' } });
            res.json({ success: true, data: { status: artifacts.length ? 'CAPTURED' : 'NOT_CAPTURED', artifacts: artifacts.map(({ id, kind, sha256, mimeType, byteSize, createdAt }) => ({ id, kind, sha256, mimeType, byteSize, createdAt })) } });
        }),
        artifact: handler(async (req, res) => {
            const snapshot = await owned(req);
            const artifact = await client.systemRunArtifact.findFirst({ where: { id: req.params.artifactId, assessment: { snapshotId: snapshot.id } } });
            if (!artifact) throw new ServiceError('Artifact not found', 404);
            const result = readOwnedRunArtifact({ rootDir: snapshot.rootDir, artifact });
            res.setHeader('Content-Type', result.mimeType);
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('Content-Disposition', `inline; filename="${artifact.id}.${artifact.kind === 'TRACE' ? 'zip' : 'png'}"`);
            res.send(result.bytes);
        }),
        requirements: handler(async (req, res) => { const snapshot = await owned(req); res.json({ success: true, data: await client.systemRequirementRevision.findMany({ where: { snapshotId: snapshot.id }, orderBy: { revisionNumber: 'desc' }, include: { bindings: true } }) }); }),
        createRequirements: handler(async (req, res) => { enabled(); const snapshot = await owned(req); const content = parseRequest(requirementsRequest, req.body); res.status(201).json({ success: true, data: await withLease(snapshot.id, () => createRequirementRevision({ client, snapshotId: snapshot.id, content })) }); }),
        confirmRequirements: handler(async (req, res) => { enabled(); const snapshot = await owned(req); res.json({ success: true, data: await withLease(snapshot.id, () => confirmRequirementRevision({ client, snapshotId: snapshot.id, revisionId: req.params.revisionId, contentHash: req.body.expectedContentHash, userId: req.user.id })) }); }),
        createBinding: handler(async (req, res) => { enabled(); const snapshot = await owned(req), input = parseRequest(bindingRequest, req.body); const binding = await withLease(snapshot.id, () => createAssertionBinding({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir, revisionId: req.params.revisionId, input })); res.status(201).json({ success: true, data: { ...binding, bindingHash: digest(binding.bindingJson) } }); }),
        approveBinding: handler(async (req, res) => { enabled(); const snapshot = await owned(req); res.json({ success: true, data: await withLease(snapshot.id, () => approveAssertionBinding({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir, bindingId: req.params.bindingId, testHash: req.body.expectedTestHash, bindingHash: req.body.expectedBindingHash, userId: req.user.id })) }); }),
        analyze: handler(async (req, res) => { const snapshot = await owned(req), filePath = req.query.filePath; if (typeof filePath !== 'string' || !/\.(spec|test)\.[cm]?[jt]s$/.test(filePath)) throw new ServiceError('Test file path required', 400); const target=containedPath(snapshot.rootDir,filePath);if(fs.statSync(target).size>256*1024)throw new ServiceError('Test file exceeds 256 KiB',413);const content = fs.readFileSync(target, 'utf8'); res.json({ success: true, data: { filePath, testHash: digest(content), ...analyzeSystemTestFile({ content, filePath }) } }); }),
        improve: handler(async (req, res) => {
            enabled('improvementEnabled'); const snapshot = await owned(req), input = parseRequest(improvementRequest, { ...req.body, model: requestedAiModel(req) });
            if (input.autoApply) throw new ServiceError('AI test changes require review and explicit apply in the System Test workflow', 409);
            const assessment = await client.systemTestAssessment.findFirst({ where: { id: input.assessmentId, snapshotId: snapshot.id, status: 'COMPLETED' } });
            if (!assessment || !assessment.reportJson.input.testFiles.includes(input.filePath)) throw new ServiceError('Completed assessment for the selected file required', 409);
            const result = await withLease(snapshot.id, () => admit({ snapshot, canonicalize:true, userId: req.user.id, type: 'SYSTEM_TEST_IMPROVEMENT', input, create: job => client.systemTestProposal.create({ data: { snapshotId: snapshot.id, assessmentId: assessment.id, jobId: job.id, filePath: input.filePath, baseTestHash: input.expectedTestHash, proposedContent: '', verificationJson: {goal:{target:improvementLimits.target,milestone:improvementLimits.milestone,maxRounds:improvementLimits.maxRounds}}  } }) }));
            res.status(202).json({ success: true, data: { ...result, proposalId: result.id } });
        }),
        latestProposal: handler(async (req, res) => {
            const snapshot = await owned(req);
            const job = await client.job.findFirst({where:{snapshotId:snapshot.id,type:'SYSTEM_TEST_IMPROVEMENT'},orderBy:{createdAt:'desc'},select:{id:true}});
            const record = job ? await client.systemTestProposal.findFirst({where:{jobId:job.id,snapshotId:snapshot.id}}) : null;
            const data = await proposalProgress({client,record,snapshotId:snapshot.id});
            res.json({success:true,data:data ? {...data,failureSummary:data.state === 'FAILED_VERIFICATION' ? summarizeImprovementVerification(data.verificationJson) : null} : null});
        }),
        proposal: handler(async (req, res) => {
            const snapshot = await owned(req);
            const record = await client.systemTestProposal.findFirst({where:{id:req.params.proposalId,snapshotId:snapshot.id}});
            if (!record) throw new ServiceError('Proposal not found',404);
            const data = await proposalProgress({client,record,snapshotId:snapshot.id});
            res.json({success:true,data:{...data,failureSummary:data.state === 'FAILED_VERIFICATION' ? summarizeImprovementVerification(data.verificationJson) : null}});
        }),
        analyzeProposal: handler(async (req, res) => {
            const snapshot = await owned(req);
            const proposal = await client.systemTestProposal.findFirst({ where: { id: req.params.proposalId, snapshotId: snapshot.id } });
            if (!proposal || !proposal.proposedContent || digest(proposal.proposedContent) !== proposal.candidateTestHash) throw new ServiceError('Verified proposal not found', 404);
            const before = fs.readFileSync(containedPath(snapshot.rootDir, proposal.filePath), 'utf8');
            const original = analyzeSystemTestFile({ content: before, filePath: proposal.filePath });
            const candidate = analyzeSystemTestFile({ content: proposal.proposedContent, filePath: proposal.filePath });
            const originalTitles = new Set(original.scenarioSites.map(site => site.title));
            res.json({ success: true, data: { filePath: proposal.filePath, candidateHash: proposal.candidateTestHash, requirementRevisionId: proposal.verificationJson?.baseline?.requirementRevisionId || null, addedScenarios: candidate.scenarioSites.filter(site => !originalTitles.has(site.title)).map(site => ({ title: site.title, assertionSites: candidate.assertionSites.filter(assertion => assertion.scenarioLine === site.line && assertion.supported).map(({ id, line, code }) => ({ id, line, code })) })) } });
        }),
        reviewProposal: handler(async (req, res) => {
            enabled('improvementEnabled');
            const snapshot = await owned(req);
            const input = parseRequest(proposalReviewRequest, req.body);
            res.json({ success: true, data: await withLease(snapshot.id, () => reviewSystemProposal({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir, proposalId: req.params.proposalId, input, userId: req.user.id })) });
        }),
        apply: handler(async (req, res) => {
            enabled('improvementEnabled');
            const snapshot = await owned(req);
            const reviewed = await client.systemTestProposal.findFirst({ where: { id: req.params.proposalId, snapshotId: snapshot.id }, select: { candidateTestHash: true, verificationJson: true } });
            const review = reviewed?.verificationJson?.review;
            if (!review || review.candidateHash !== reviewed.candidateTestHash || proposalReviewHash(review) !== review.reviewHash) throw new ServiceError('Review the exact new scenarios and Expected before applying the proposal', 409);
            const saved = await withLease(snapshot.id, async lease => {
                const result = await applySystemProposal({client,rootDir:snapshot.rootDir,snapshotId:snapshot.id,proposalId:req.params.proposalId,expectedCurrentTestHash:req.body.expectedCurrentTestHash,expectedCandidateTestHash:req.body.expectedCandidateTestHash,userId:req.user.id,lease});
                await registerAppliedProposalReview({ client, snapshotId: snapshot.id, rootDir: snapshot.rootDir, proposal: result });
                if (result.verificationJson?.publishedAssessmentId) return result;
                const report = result.verificationJson.candidate;
                const original = await client.systemTestAssessment.findFirst({where:{id:result.assessmentId,snapshotId:snapshot.id}});
                const current = snapshotIdentity(resolveSystemRepositoryRoot(snapshot.rootDir));
                if (report.sourceHash !== current.sourceHash || report.testHash !== current.testHash) throw new ServiceError('Tests were saved, but the snapshot changed. Run System Test to refresh measurements.',409);
                const published = await publishAppliedAssessment({client,job:{id:result.jobId,snapshotId:snapshot.id},report,input:original.reportJson.input,requirementRevisionId:original.requirementRevisionId});
                return client.systemTestProposal.update({where:{id:result.id},data:{verificationJson:{...result.verificationJson,publishedAssessmentId:published.id}}});
            });
            res.json({success:true,data:saved});
        }),
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
