import { operationAbortReason } from './systemOperationError.service.js';
import { persistAssessmentRuns } from './systemAssessmentPersistence.service.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import prisma from '../config/prisma.js';
import { currentProjectOperation,withOperationPublishGuard,stagePreparedPublication } from './projectOperationWorkspace.service.js';
import { deliverScopedProjectTransport } from './projectSubscription.service.js';
import { createAssessmentWorkspace, snapshotIdentity } from './systemAssessmentWorkspace.service.js';
import { prepareSystemCoverage } from './systemCoverageInstrumentation.service.js';
import { collectSystemCoverage, readRuntimeCoverage } from './systemCoverageCollector.service.js';
import { readAssertionEvents, verifyAssertionEvents } from './systemAssertionEvidence.service.js';
import { analyzeSystemTestFile, digest } from './systemTestStaticAnalysis.service.js';
import { buildSystemAssessment } from './systemAssessment.service.js';
import { runSystemTests } from './systemTestRunner.service.js';
import { parseSystemTestResult } from './systemTestResultParser.service.js';
import { containedPath } from './fullSystemConfig.service.js';
import { getJobById, markJobRunning, markJobSuccess, markJobFailed, updateJobProgress, addJobLog } from './job.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { enumerateMutations } from './systemMutation.service.js';
import { storeScenarioScreenshot } from './systemTestEvidence.service.js';
import { prepareAutomaticAssessment } from './systemAssessmentPreparation.service.js';
import { runtimeDependencyFingerprint } from './projectRuntimePlan.service.js';
import { createSystemEventPublisher } from './systemLiveEvent.service.js';
import { persistRunArtifacts } from './systemRunArtifact.service.js';
import { deriveScenarioVerdict, buildSystemGaps, scoreSystemSuite } from './systemScenarioVerdict.service.js';
import { syncSystemScenarioCatalog } from './systemScenarioCatalog.service.js';

export const assessSystemWorkspace = async ({ rootDir, environmentRoot = rootDir, input, jobId, revision, bindings = [], catalog = [], dependencies = {}, onProgress = async () => {}, onEvent = async () => {}, signal, stopOnFailure = false }) => {
    const deadline = Date.now() + 20 * 60 * 1000;
    const initial = snapshotIdentity(rootDir);
    const identity = { sourceHash: initial.sourceHash, testHash: initial.testHash, scopeHash: digest(input.coverageScope), configHash: initial.configHash, runner: input.runner, browser: 'chromium', executionMode: input.executionMode, adapterVersion: 'istanbul-source-v1', seed: 'fresh-database', requirementRevisionId: revision?.id || null };
    const staticAnalysis = input.testFiles.map(filePath => {
        const content = fs.readFileSync(containedPath(rootDir, filePath), 'utf8');
        if (Buffer.byteLength(content) > 256 * 1024) throw new ServiceError('Test file exceeds 256 KiB', 413);
        return { filePath, testHash: digest(content), ...analyzeSystemTestFile({ content, filePath, framework: input.runner }) };
    });
    const runs = [], artifacts = [], preparations = [], evidenceArtifacts = [];
    for (let index = 0; index < input.repeatRuns; index++) {
        if(signal?.aborted) throw operationAbortReason(signal);
        if (Date.now() > deadline) throw new ServiceError('Assessment resource budget exceeded', 408);
        const baseProgress = 5 + index * 45;
        await onProgress(`Preparing independent run ${index + 1}/${input.repeatRuns}`, baseProgress);
        await onEvent({ runIndex: index + 1, type: 'RUN_STARTED' });
        const workspace = createAssessmentWorkspace({ rootDir });
        workspace.originalRoot = environmentRoot;
        try {
            const measurementId = crypto.randomUUID();
            const preparation = prepareSystemCoverage({ workspace, coverageScope: input.coverageScope, measurementId });
            if (input.runner !== 'playwright') throw new ServiceError('Managed evidence execution currently supports Playwright only; Cypress needs a verified adapter', 422);
            const reportDirectory = path.join(workspace.rootDir, '.covai-system-test');
            fs.mkdirSync(reportDirectory, { recursive: true });
            const execution = { runner: 'playwright', rootDir: workspace.rootDir, testDirectory: 'tests', selectedFiles: input.testFiles.map(file => containedPath(workspace.rootDir, file)), selectedTitles: input.reviewMode === 'scenario' ? catalog.map(scenario => scenario.title) : undefined, command: 'npx playwright test --reporter=json', reportDirectory, reportPath: path.join(reportDirectory, 'results.json'), headed: Boolean(input.headed) };
            const startedAt = new Date();
            const result = await (dependencies.run || runSystemTests)({ rootDir: workspace.rootDir, jobId, execution, executionMode: input.executionMode, measurementPreparation: preparation, assertionBindings: bindings, signal, onEvent: event => onEvent({ runIndex: index + 1, ...event }), onPreparing: (progress, message) => onProgress(`Run ${index + 1}/${input.repeatRuns}: ${message}`, baseProgress + Math.min(25, progress * 0.7)), onReady: () => onProgress(`Run ${index + 1}/${input.repeatRuns}: executing ${input.testFiles.length} test file(s)`, baseProgress + 30) });
            const testRun = parseSystemTestResult({ runner: 'playwright', resultPath: result.reportPath, startedAt, finishedAt: new Date(), rootDir: workspace.rootDir });
            if (result.exitCode !== 0 && testRun.status === 'PASSED') throw new ServiceError('Runner report and exit code disagree', 422);
            const mapping = JSON.parse(fs.readFileSync(path.join(path.dirname(result.reportPath), 'source-map.json'), 'utf8'));
            testRun.scenarios = testRun.scenarios.map(s => ({ ...s, testFile: mapping[path.basename(s.testFile || '')] || s.testFile, screenshotPath: storeScenarioScreenshot({ rootDir:environmentRoot, source: typeof s.screenshotSource === 'string' && fs.existsSync(s.screenshotSource) ? {body: fs.readFileSync(containedPath(workspace.rootDir, path.relative(workspace.rootDir, s.screenshotSource))).toString('base64')} : s.screenshotSource, runKey: measurementId }), screenshotSource: undefined }));
            for (const scenario of testRun.scenarios) if (scenario.screenshotPath) evidenceArtifacts.push({ runIndex: index + 1, filePath: scenario.testFile, title: scenario.title, kind: 'SCREENSHOT', relativePath: scenario.screenshotPath });
            const events = readAssertionEvents(preparation);
            const criterionEvidence = verifyAssertionEvents({ bindings, events, testRun, measurementId });
            const raw = readRuntimeCoverage(preparation);
            if(raw.some(artifact=>artifact.incompleteReasons?.includes('AUT_IDENTITY_MISMATCH'))) throw new ServiceError('The backend response came from a different AUT instance',422);
            await onProgress(`Run ${index + 1}/${input.repeatRuns}: collecting runtime coverage and assertion results`, baseProgress + 40);
            artifacts.push(...raw.map(artifact => ({ ...artifact, measurementId: 'aggregate', sourceHash: initial.sourceHash })));
            preparations.push(preparation);
            const runtimeHash = runtimeDependencyFingerprint(workspace.rootDir);
            runs.push({ index: index + 1, testRun, criterionEvidence, measurement: collectSystemCoverage({ preparation, runtimeArtifacts: raw }), measurementId, runtimeHash, mutationActivations: [...new Set(raw.flatMap(artifact => artifact.activeMutations || []))] });
            await onEvent({ runIndex: index + 1, type: 'RUN_ENDED', status: testRun.status });
            // Preserve raw evidence outside the temporary AUT; never interpret pre-existing artifacts as this run.
            const evidenceRoot = containedPath(environmentRoot, `.covai-system-test/assessment/${measurementId}`);
            fs.mkdirSync(evidenceRoot, { recursive: true });
            fs.copyFileSync(result.reportPath, path.join(evidenceRoot, 'results.json'));
            fs.writeFileSync(path.join(evidenceRoot, 'measurement.json'), JSON.stringify({ manifest: { ...preparation.manifest, directory: undefined }, zeroMaps: Object.fromEntries(Object.entries(preparation.tiers).map(([tier, value]) => [tier, value.zeroMaps])), artifacts: raw, events }), 'utf8');
            const rawReport = JSON.parse(fs.readFileSync(result.reportPath, 'utf8'));
            const visitSuite = suite => {
                const filePath = mapping[path.basename(suite.file || '')] || null;
                for (const spec of suite.specs || []) for (const test of spec.tests || []) for (const attempt of test.results || []) for (const attachment of attempt.attachments || []) {
                    if (attachment.name !== 'trace' || !attachment.path || evidenceArtifacts.length >= 500) continue;
                    try {
                        const source = containedPath(workspace.rootDir, path.relative(workspace.rootDir, attachment.path));
                        if (!fs.statSync(source).isFile() || fs.statSync(source).size > 25 * 1024 * 1024) continue;
                        const relativePath = path.posix.join('.covai-system-test', 'evidence', measurementId, `trace-${crypto.randomUUID()}.zip`);
                        fs.copyFileSync(source, containedPath(environmentRoot, relativePath));
                        evidenceArtifacts.push({ runIndex: index + 1, filePath, title: spec.title, kind: 'TRACE', relativePath });
                    } catch { /* Missing trace must not replace the scenario verdict. */ }
                }
                for (const child of suite.suites || []) visitSuite(child);
            };
            for (const suite of rawReport.suites || []) visitSuite(suite);
        } finally { workspace.release(); }
        if (stopOnFailure && (runs.at(-1).testRun.status !== 'PASSED' || runs.at(-1).testRun.skippedTests > 0 || runs.at(-1).testRun.flakyTests > 0)) break;
    }
    const current = snapshotIdentity(rootDir);
    if (current.sourceHash !== initial.sourceHash || current.testHash !== initial.testHash) throw new ServiceError('Snapshot changed during assessment', 409);
    const aggregate = preparations[0];
    aggregate.manifest.measurementId = 'aggregate';
    const coverage = collectSystemCoverage({ preparation: aggregate, runtimeArtifacts: artifacts });
    // Every run must have complete evidence before aggregate coverage is presented as measured.
    for (const tier of ['frontend', 'backend']) {
        const states = runs.map(run=>run.measurement.tiers[tier]);
        if(states.every(value=>['MEASURED','PARTIAL'].includes(value.status))) continue;
        const sameStatus=states.every(value=>value.status === states[0].status);
        coverage.tiers[tier] = {schemaVersion:1,status:sameStatus ? states[0].status : 'INVALID',counters:null,reasonCodes:[...new Set(states.flatMap(value=>value.reasonCodes)), 'INCOMPLETE_REPEAT_EVIDENCE']};
    }
    coverage.status = Object.values(coverage.tiers).every(tier => tier.status === 'MEASURED') ? 'MEASURED' : 'PARTIAL';
    const report = buildSystemAssessment({ identity, coverage, revision, bindings, staticAnalysis, runs });
    report.runtimeHash = runs[0].runtimeHash;
    if (runs.some(run => run.runtimeHash !== report.runtimeHash)) throw new ServiceError('Dependency/runtime versions changed between independent runs', 409);
    const backend = input.coverageScope.backend;
    report.mutationTargets = backend ? initial.files.filter(file => file.path.startsWith(backend.root + '/' + backend.sourceDirectory + '/') && /\.[cm]?js$/.test(file.path) && !/\.(test|spec)\./.test(file.path)).flatMap(file => enumerateMutations({ content: fs.readFileSync(containedPath(rootDir, file.path), 'utf8'), filePath: file.path })).slice(0, 100) : [];
    report.input = input;
    report.evidenceArtifacts = evidenceArtifacts;
    report.scenarioVerdicts = catalog.filter(item => item.filePath).map(scenario => deriveScenarioVerdict({ scenario, runs, requirements: report.requirements }));
    report.workflowGaps = buildSystemGaps({ report, verdicts: report.scenarioVerdicts });
    report.qualityScore = scoreSystemSuite({ report, catalog, verdicts: report.scenarioVerdicts, artifacts: evidenceArtifacts });
    return report;
};

export const processSystemAssessmentJob = async (jobId, lease) => {
    await markJobRunning(jobId);
    const job = await getJobById(jobId);
    let input = JSON.parse(job.payloadJson);
    const prepareOnly = input.prepareOnly === true;
    let preparationUsage;
    let emit;
    try {
        await withOperationPublishGuard(tx=>tx.systemTestAssessment.update({where:{jobId},data:{status:'RUNNING'}}));
        const onProgress = async (message, progress = 30) => { await lease.assertHeld(); const current = await getJobById(jobId); if (current.status !== 'RUNNING') throw new ServiceError('Assessment canceled', 409); await updateJobProgress(jobId, Math.max(current.progress || 0, progress)); await addJobLog(jobId, 'INFO', `Assessment stage: ${message}`); };
        if (input.autoDiscover) {
            const prepared = await prepareAutomaticAssessment({rootDir:job.snapshot.rootDir,input,onProgress,signal:lease.signal,jobId});
            input = prepared.input;
            preparationUsage=prepared.aiUsage;
            job.snapshot.rootDir = prepared.rootDir;
            const identity = snapshotIdentity(prepared.rootDir);
            await withOperationPublishGuard(tx=>tx.systemTestAssessment.update({where:{jobId},data:{sourceHash:identity.sourceHash,testHash:identity.testHash,scopeHash:digest(input.coverageScope),reportJson:{input}}}));
        }
        if (prepareOnly && currentProjectOperation()?.preparedPublications) {
            const existing = await prisma.systemTestAssessment.findUnique({where:{jobId},select:{id:true}});
            await stagePreparedPublication(async tx=>{
                const catalog = await syncSystemScenarioCatalog({client:tx,snapshotId:job.snapshotId,rootDir:job.snapshot.rootDir});
                await tx.systemTestAssessment.update({where:{jobId},data:{status:'PREPARED',reportJson:{input,catalog:{scenarioCount:catalog.scenarios.length,discoveryStatus:catalog.discoveryStatus,unsupportedFeatures:catalog.unsupportedFeatures},aiUsage:preparationUsage || null}}});
            });
            await markJobSuccess(jobId,{assessmentId:existing.id,prepared:true});
            return;
        }
        if (prepareOnly) {
            const catalog = await syncSystemScenarioCatalog({ client: prisma, snapshotId: job.snapshotId, rootDir: job.snapshot.rootDir });
            const stored = await withOperationPublishGuard(tx=>tx.systemTestAssessment.update({ where: { jobId }, data: { status: 'PREPARED', reportJson: { input, catalog: { scenarioCount: catalog.scenarios.length, discoveryStatus: catalog.discoveryStatus, unsupportedFeatures: catalog.unsupportedFeatures }, aiUsage: preparationUsage || null } } }));
            await markJobSuccess(jobId, { assessmentId: stored.id, prepared: true });
            return;
        }
        const revision = input.requirementRevisionId ? await prisma.systemRequirementRevision.findFirst({ where: { id: input.requirementRevisionId, snapshotId: job.snapshotId, status: 'CONFIRMED' }, include: { bindings: true } }) : null;
        const assessment = await prisma.systemTestAssessment.findUnique({ where: { jobId }, select: { id: true } });
        emit = await createSystemEventPublisher({ client: prisma, assessmentId: assessment.id, snapshotId: job.snapshotId, userId: job.userId });
        const catalog = await prisma.systemScenario.findMany({ where: { snapshotId: job.snapshotId, filePath: { in: input.testFiles }, ...(input.reviewMode === 'scenario' ? { id: { in: input.scenarioIds } } : {}) }, select: { id: true, scenarioKey: true, filePath: true, title: true } });
        if (input.reviewMode === 'scenario' && catalog.length !== input.scenarioIds.length) throw new ServiceError('Selected scenarios changed before execution; review the catalog and retry', 409);
        const onEvent = async ({ runIndex, type, screenshotBody, frame, ...payload }) => {
            if (type === 'LIVE_FRAME' && frame) {
                const payload = {
                    snapshotId: job.snapshotId,
                    assessmentId: assessment.id,
                    frame,
                };
                await withOperationPublishGuard(()=>global.io?.to?.(`user:${job.userId}`)?.emit?.('system-run:frame',payload));
                const operation = currentProjectOperation();
                if (operation) await deliverScopedProjectTransport({projectId:operation.projectId,event:'system-run:frame',payload});
                return;
            }
            const matches = catalog.filter(scenario => scenario.filePath === payload.filePath && scenario.title === payload.title);
            if (type === 'SCENARIO_ENDED' && matches.length === 1 && screenshotBody) {
                try {
                    const relativePath = storeScenarioScreenshot({ rootDir: job.snapshot.rootDir, source: { body: screenshotBody }, runKey: `live-${assessment.id}-${runIndex}` });
                    if (relativePath) {
                        const saved = await persistRunArtifacts({ client: prisma, assessmentId: assessment.id, rootDir: job.snapshot.rootDir, artifacts: [{ filePath: payload.filePath, title: payload.title, kind: 'SCREENSHOT', relativePath }], catalog });
                        if (saved[0]) payload.artifactId = saved[0].id;
                    }
                } catch { /* Checkpoint failure must not change the runner verdict. */ }
            }
            return emit({ runIndex, type, scenarioKey: matches.length === 1 ? matches[0].scenarioKey : null, payload });
        };
        const report = await assessSystemWorkspace({ rootDir: job.snapshot.rootDir, input, jobId, signal:lease.signal, revision, bindings: revision?.bindings || [], catalog, onProgress, onEvent });
        if(preparationUsage)report.aiUsage=preparationUsage;
        await lease.assertHeld();
        await updateJobProgress(jobId, 95);
        await addJobLog(jobId, 'INFO', 'Assessment stage: Saving coverage measurements and scenario results');
        const testRunId = await persistAssessmentRuns({report,snapshotId:job.snapshotId,executionMode:input.executionMode});
        const storedAssessment = await prisma.systemTestAssessment.findUnique({where:{jobId},select:{id:true}});
        await stagePreparedPublication(tx=>tx.systemTestAssessment.update({ where: { jobId }, data: { status: 'COMPLETED', sourceHash: report.sourceHash, testHash: report.testHash, scopeHash: report.scopeHash, testRunId, reportJson: JSON.parse(JSON.stringify(report)) } }));
        await persistRunArtifacts({ client: prisma, assessmentId: storedAssessment.id, rootDir: job.snapshot.rootDir, artifacts: report.evidenceArtifacts || [], catalog });
        await markJobSuccess(jobId, { assessmentId: storedAssessment.id });
    } catch (error) {
        const current = await getJobById(jobId);
        const canceled = current.status === 'CANCELED' || error.code === 'SYSTEM_OPERATION_CANCELED';
        await prisma.systemTestAssessment.updateMany({ where: { jobId }, data: { status: canceled ? 'CANCELED' : 'FAILED', reportJson: { input, error: canceled ? 'Assessment canceled' : error.statusCode ? error.message.replace(/[a-z]:[\\/][^\s"'<>]+/gi, '[internal path]') : 'Assessment failed; inspect the owned job log' } } });
        if (canceled) { try { await emit?.({ runIndex: 0, type: 'RUN_CANCELED' }); } catch { /* Job status remains the source of truth. */ } return; }
        await markJobFailed(jobId, error);
        throw error;
    }
};
