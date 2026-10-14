import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import prisma from '../config/prisma.js';
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

export const assessSystemWorkspace = async ({ rootDir, environmentRoot = rootDir, input, jobId, revision, bindings = [], dependencies = {}, onProgress = async () => {}, signal }) => {
    const deadline = Date.now() + 20 * 60 * 1000;
    const initial = snapshotIdentity(rootDir);
    const identity = { sourceHash: initial.sourceHash, testHash: initial.testHash, scopeHash: digest(input.coverageScope), configHash: initial.configHash, runner: input.runner, browser: 'chromium', executionMode: input.executionMode, adapterVersion: 'istanbul-source-v1', seed: 'fresh-database', requirementRevisionId: revision?.id || null };
    const staticAnalysis = input.testFiles.map(filePath => {
        const content = fs.readFileSync(containedPath(rootDir, filePath), 'utf8');
        if (Buffer.byteLength(content) > 256 * 1024) throw new ServiceError('Test file exceeds 256 KiB', 413);
        return { filePath, testHash: digest(content), ...analyzeSystemTestFile({ content, filePath, framework: input.runner }) };
    });
    const runs = [], artifacts = [], preparations = [];
    for (let index = 0; index < input.repeatRuns; index++) {
        if(signal?.aborted) throw new ServiceError("Assessment canceled",409);
        if (Date.now() > deadline) throw new ServiceError('Assessment resource budget exceeded', 408);
        const baseProgress = 5 + index * 45;
        await onProgress(`Preparing independent run ${index + 1}/${input.repeatRuns}`, baseProgress);
        const workspace = createAssessmentWorkspace({ rootDir });
        workspace.originalRoot = environmentRoot;
        try {
            const measurementId = crypto.randomUUID();
            const preparation = prepareSystemCoverage({ workspace, coverageScope: input.coverageScope, measurementId });
            if (input.runner !== 'playwright') throw new ServiceError('Managed evidence execution currently supports Playwright only; Cypress needs a verified adapter', 422);
            const reportDirectory = path.join(workspace.rootDir, '.covai-system-test');
            fs.mkdirSync(reportDirectory, { recursive: true });
            const execution = { runner: 'playwright', rootDir: workspace.rootDir, testDirectory: 'tests', selectedFiles: input.testFiles.map(file => containedPath(workspace.rootDir, file)), command: 'npx playwright test --reporter=json', reportDirectory, reportPath: path.join(reportDirectory, 'results.json') };
            const startedAt = new Date();
            const result = await (dependencies.run || runSystemTests)({ rootDir: workspace.rootDir, jobId, execution, executionMode: input.executionMode, measurementPreparation: preparation, assertionBindings: bindings, signal, onPreparing: (progress, message) => onProgress(`Run ${index + 1}/${input.repeatRuns}: ${message}`, baseProgress + Math.min(25, progress * 0.7)), onReady: () => onProgress(`Run ${index + 1}/${input.repeatRuns}: executing ${input.testFiles.length} test file(s)`, baseProgress + 30) });
            const testRun = parseSystemTestResult({ runner: 'playwright', resultPath: result.reportPath, startedAt, finishedAt: new Date(), rootDir: workspace.rootDir });
            if (result.exitCode !== 0 && testRun.status === 'PASSED') throw new ServiceError('Runner report and exit code disagree', 422);
            const mapping = JSON.parse(fs.readFileSync(path.join(path.dirname(result.reportPath), 'source-map.json'), 'utf8'));
            testRun.scenarios = testRun.scenarios.map(s => ({ ...s, testFile: mapping[path.basename(s.testFile || '')] || s.testFile, screenshotPath: storeScenarioScreenshot({ rootDir, source: typeof s.screenshotSource === 'string' && fs.existsSync(s.screenshotSource) ? {body: fs.readFileSync(containedPath(workspace.rootDir, path.relative(workspace.rootDir, s.screenshotSource))).toString('base64')} : s.screenshotSource, runKey: measurementId }), screenshotSource: undefined }));
            const events = readAssertionEvents(preparation);
            const criterionEvidence = verifyAssertionEvents({ bindings, events, testRun, measurementId });
            const raw = readRuntimeCoverage(preparation);
            if(raw.some(artifact=>artifact.incompleteReasons?.includes('AUT_IDENTITY_MISMATCH'))) throw new ServiceError('The backend response came from a different AUT instance',422);
            await onProgress(`Run ${index + 1}/${input.repeatRuns}: collecting runtime coverage and assertion results`, baseProgress + 40);
            artifacts.push(...raw.map(artifact => ({ ...artifact, measurementId: 'aggregate', sourceHash: initial.sourceHash })));
            preparations.push(preparation);
            const runtimeHash = digest({ node: process.version, locks: Object.values(input.coverageScope).map(scope => { const lock = containedPath(workspace.rootDir, scope.root + '/package-lock.json'); return fs.existsSync(lock) ? digest(fs.readFileSync(lock)) : null; }) });
            runs.push({ index: index + 1, testRun, criterionEvidence, measurement: collectSystemCoverage({ preparation, runtimeArtifacts: raw }), measurementId, runtimeHash, mutationActivations: [...new Set(raw.flatMap(artifact => artifact.activeMutations || []))] });
            // Preserve raw evidence outside the temporary AUT; never interpret pre-existing artifacts as this run.
            const evidenceRoot = containedPath(rootDir, `.covai-system-test/assessment/${measurementId}`);
            fs.mkdirSync(evidenceRoot, { recursive: true });
            fs.copyFileSync(result.reportPath, path.join(evidenceRoot, 'results.json'));
            fs.writeFileSync(path.join(evidenceRoot, 'measurement.json'), JSON.stringify({ manifest: { ...preparation.manifest, directory: undefined }, zeroMaps: Object.fromEntries(Object.entries(preparation.tiers).map(([tier, value]) => [tier, value.zeroMaps])), artifacts: raw, events }), 'utf8');
        } finally { workspace.release(); }
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
    return report;
};

export const processSystemAssessmentJob = async (jobId, lease) => {
    await markJobRunning(jobId);
    const job = await getJobById(jobId);
    const input = JSON.parse(job.payloadJson);
    try {
        await prisma.systemTestAssessment.update({where:{jobId},data:{status:'RUNNING'}});
        const revision = input.requirementRevisionId ? await prisma.systemRequirementRevision.findFirst({ where: { id: input.requirementRevisionId, snapshotId: job.snapshotId, status: 'CONFIRMED' }, include: { bindings: true } }) : null;
        const report = await assessSystemWorkspace({ rootDir: job.snapshot.rootDir, input, jobId, signal:lease.signal, revision, bindings: revision?.bindings || [], onProgress: async (message, progress = 30) => { await lease.assertHeld(); const current = await getJobById(jobId); if (current.status !== 'RUNNING') throw new ServiceError('Assessment canceled', 409); await updateJobProgress(jobId, Math.max(current.progress || 0, progress)); await addJobLog(jobId, 'INFO', `Assessment stage: ${message}`); } });
        await lease.assertHeld();
        await updateJobProgress(jobId, 95);
        await addJobLog(jobId, 'INFO', 'Assessment stage: Saving coverage measurements and scenario results');
        let testRunId;
        for (const run of report.runs) {
            const value = run.testRun;
            const stored = await prisma.testRun.create({data:{snapshotId:job.snapshotId,type:'PLAYWRIGHT',executionMode:input.executionMode,totalTests:value.totalTests,passedTests:value.passedTests,failedTests:value.failedTests,flakyTests:value.flakyTests,skippedTests:value.skippedTests,durationMs:value.durationMs,status:value.status,startedAt:value.startedAt,finishedAt:value.finishedAt,systemMeasurement:run.measurement,scenarios:{create:(value.scenarios || []).map(s=>({title:s.title,suiteName:s.suiteName || null,status:s.status,durationMs:s.durationMs ?? null,failureMessages:s.failureMessages || [],testFile:s.testFile || null,screenshotPath:s.screenshotPath || null,failureStep:s.failureStep || null,failureCategory:s.failureCategory || null,failureCodeSnippet:s.failureCodeSnippet || null,domSnapshot:s.domSnapshot || null,...(s.executionDetails ? {executionDetails:JSON.parse(JSON.stringify(s.executionDetails))}: {})}))}}});
            run.testRunId = stored.id;
            testRunId = stored.id;
        }
        const storedAssessment = await prisma.systemTestAssessment.update({ where: { jobId }, data: { status: 'COMPLETED', sourceHash: report.sourceHash, testHash: report.testHash, scopeHash: report.scopeHash, testRunId, reportJson: JSON.parse(JSON.stringify(report)) } });
        await markJobSuccess(jobId, { assessmentId: storedAssessment.id });
    } catch (error) { await prisma.systemTestAssessment.updateMany({ where: { jobId }, data: { status: 'FAILED', reportJson:{input,error: error.statusCode ? error.message.replace(/[a-z]:[\\/][^\s"'<>]+/gi,'[internal path]') : 'Assessment failed; inspect the owned job log'} } }); await markJobFailed(jobId, error); throw error; }
};
