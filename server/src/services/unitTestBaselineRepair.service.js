import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { runUnitTestBatch } from './unitTestBatchRunner.service.js';
import { repairGeneratedTestExpectations } from './generatedTestExpectationRepair.service.js';
import { testContentHash, applyTestRepairEdits } from './unitTestChangeSet.service.js';
import { detectTestingFrameworks } from '../utils/testingFrameworkDetector.js';
import { ensureWorkspaceNodeModulesLinked, cleanupWorkspaceNodeModulesLinks, listWorkspacePackageDirs } from './dependencyResolution.service.js';
import { measureUnitTestPhase, recordUnitTestWork } from './unitTestWork.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { localFile } from './generatedTestInputRepair.service.js';
import { resolveUnitTestDependency } from './unitTestPreflight.service.js';

const signingKey = process.env.TEST_PROPOSAL_SECRET || process.env.JWT_SECRET || randomBytes(32);
const sign = data => createHmac('sha256',signingKey).update(JSON.stringify(data)).digest('hex');
function verify(envelope) {
    if (!envelope || typeof envelope.signature !== 'string') return false;
    const {signature,...data} = envelope;
    const expected = Buffer.from(sign(data));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected,actual);
}
const failureName = item => item.fullName || [...(item.ancestorTitles || []),item.title].join(' ');
const baselineCache = new Map();
const require = createRequire(import.meta.url);

function baselineIdentity({rootDir,sourceFingerprint,snapshot,projectId,allOriginals,environment}) {
    if (!sourceFingerprint) return null;
    const fingerprint = createHmac('sha256',signingKey);
    fingerprint.update(JSON.stringify([projectId,snapshot.id,sourceFingerprint,snapshot.jestCommand,snapshot.jestConfigPath,snapshot.vitestCommand,process.env,environment]));
    for (const name of ['vitest','jest','@vitest/coverage-v8']) {
        try {fingerprint.update(name).update(fs.readFileSync(require.resolve(`${name}/package.json`)));} catch { /* No fallback runtime. */ }
    }
    for (const [file,content] of [...allOriginals].sort()) fingerprint.update(path.relative(rootDir,file)).update(content);
    for (const directory of listWorkspacePackageDirs(rootDir)) {
        for (const name of ['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock',
            'node_modules/vitest/package.json','node_modules/jest/package.json','node_modules/@vitest/coverage-v8/package.json']) {
            const file = path.join(directory,name);
            if (fs.existsSync(file)) fingerprint.update(path.relative(rootDir,file)).update(fs.readFileSync(file));
        }
    }
    return fingerprint.digest('hex');
}

/** Baseline failures are evidence, never authority to rewrite a suite. Only a
 * documented test defect can produce a signed, exact expected-value edit. */
export async function prepareBaselineTestRepairs({rootDir,originalRootDir,snapshot,projectId,suggestions,review = false,runBatch = runUnitTestBatch,sourceFingerprint,environment}) {
    const originals = new Map();
    for (const item of suggestions) {
        const rel = item.testFile || item.targetTestFile;
        if (!rel) continue;
        const full = path.resolve(rootDir,rel);
        const relative = path.relative(rootDir,full);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new ServiceError('Invalid test repair target',400);
        if (fs.existsSync(full)) {
            if (!localFile(rootDir,full)) throw new ServiceError('Test repair target resolves outside the workspace',400);
            originals.set(full,fs.readFileSync(full,'utf8'));
        }
    }
    const requested = suggestions.some(item => item.testRepairs);
    if (!originals.size || (!review && !requested)) return {repairs:new Map(),baseline:null};
    const files = detectTestingFrameworks(rootDir).testFiles.filter(file => ['jest','vitest'].includes(file.framework));
    const allOriginals = new Map(files.map(file => {
        const full = localFile(rootDir,file.path);
        if (!full) throw new ServiceError('Regression test resolves outside the workspace',400);
        return [full,fs.readFileSync(full,'utf8')];
    }));
    const identity = baselineIdentity({rootDir,sourceFingerprint,snapshot,projectId,allOriginals,environment});
    const cached = identity && baselineCache.get(identity);
    const reusable = cached && Date.now() - cached.createdAt < 120000;
    const sourceHashes = new Map(suggestions.filter(item => item.sourceFile).map(item => {
        const full = path.resolve(rootDir,item.sourceFile);
        const relative = path.relative(rootDir,full);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !localFile(rootDir,full)) throw new ServiceError('Invalid source repair target',400);
        return [full,testContentHash(fs.readFileSync(full,'utf8'))];
    }));
    const coverageDir = path.join(rootDir,'coverage','baseline',randomUUID());
    fs.mkdirSync(coverageDir,{recursive:true});
    let linked = [];
    let report;
    try {
        if (reusable) {
            report = {...cached.report,testResults:cached.report.testResults.map(suite => ({...suite,name:path.resolve(rootDir,suite.name)}))};
            recordUnitTestWork('baselineCacheHits');
        } else {
            if (originalRootDir && path.resolve(originalRootDir) !== path.resolve(rootDir)) linked = ensureWorkspaceNodeModulesLinked(originalRootDir,rootDir);
            const attempted = new Set();
            for (let attempt = 0; attempt <= 5; attempt++) {
                const directory = path.join(coverageDir,`attempt-${attempt}`);
                fs.mkdirSync(directory,{recursive:true});
                let result;
                try { result = await measureUnitTestPhase('baselineExecution', () => runBatch({rootDir,snapshot,testFiles:files.map(file => file.path),targetSourceFiles:suggestions.map(item => item.sourceFile).filter(Boolean),
                    frameworkByFile:Object.fromEntries(files.map(file => [file.path,file.framework])),coverageDir:directory})); }
                catch (error) { result = {stderr:error.message}; }
                try { report = JSON.parse(fs.readFileSync(path.join(directory,'test-results.json'),'utf8')); }
                catch { report = null; }
                if (report?.success === true) break;
                const output = [result?.stdout,result?.stderr,JSON.stringify(report)].filter(Boolean).join('\n');
                if (attempt === 5 || !(await resolveUnitTestDependency({rootDir,output,attempted})).resolved) break;
            }
            if (identity && report?.testResults && baselineIdentity({rootDir,sourceFingerprint,snapshot,projectId,allOriginals,environment}) === identity && JSON.stringify(report).length < 1024 * 1024) {
                baselineCache.set(identity,{createdAt:Date.now(),runId:path.basename(coverageDir),report:{...report,testResults:report.testResults.map(suite => ({...suite,name:path.relative(rootDir,path.resolve(rootDir,suite.name))}))}});
                while (baselineCache.size > 8) baselineCache.delete(baselineCache.keys().next().value);
            }
        }
        if (!report?.testResults) throw new ServiceError('The unchanged test baseline could not be collected. Resolve its runner or environment error before repairing tests.',422);
    } finally {
        for (const [file,content] of allOriginals) fs.writeFileSync(file,content,'utf8');
        cleanupWorkspaceNodeModulesLinks(linked);
    }
    if ([...sourceHashes].some(([file,hash]) => !fs.existsSync(file) || testContentHash(fs.readFileSync(file,'utf8')) !== hash)) throw new ServiceError('Source changed during baseline execution. No test repair is allowed.',409);
    const proposals = review ? await repairGeneratedTestExpectations({rootDir,suggestions:suggestions.map(item => ({...item,
        fullUpdatedContent:originals.get(path.resolve(rootDir,item.testFile || item.targetTestFile)) || ''})),testResults:report,existingTestsByFile:originals,
        reviewExistingTests:true,proposalOnly:true}) : [];
    const repairs = new Map();
    for (const item of suggestions) {
        if (!review && !item.testRepairs) continue;
        const testFile = item.testFile || item.targetTestFile;
        const full = path.resolve(rootDir,testFile || '');
        if (!originals.has(full)) continue;
        const original = originals.get(full);
        const sourceHash = sourceHashes.get(path.resolve(rootDir,item.sourceFile));
        const binding = {projectId,snapshotId:snapshot.id,testFile,sourceHash,baseHash:testContentHash(original)};
        let envelope = item.testRepairs;
        if (review) {
            const edits = proposals.filter(proposal => proposal.testFile === testFile).map(proposal => ({...proposal,beforeHash:testContentHash(original.slice(proposal.start,proposal.end))}));
            if (!edits.length) continue;
            const data = {...binding,edits};
            envelope = {...data,signature:sign(data)};
        } else if (!verify(envelope) || JSON.stringify(Object.fromEntries(Object.keys(binding).map(key => [key,envelope[key]]))) !== JSON.stringify(binding)) {
            throw new ServiceError('Test repair evidence is stale or changed. Regenerate and review the proposal.',409);
        }
        const suite = report.testResults?.find(s => path.resolve(rootDir,s.name || '') === full);
        if (!suite || !envelope.edits.every(edit => suite.assertionResults?.some(result => result.status === 'failed' && failureName(result) === edit.testName))) throw new ServiceError('A selected test repair no longer matches a baseline failure. Regenerate the proposal.',409);
        applyTestRepairEdits(original,envelope.edits);
        repairs.set(full,envelope);
    }
    return {repairs,baseline:{runId:reusable ? cached.runId : path.basename(coverageDir),cached:Boolean(reusable),failedTests:report.numFailedTests ?? report.testResults?.flatMap(s => s.assertionResults || []).filter(a => a.status === 'failed').length}};
}
