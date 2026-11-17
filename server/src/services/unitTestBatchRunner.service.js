import fs from 'node:fs';
import path from 'node:path';
import { runJestCoverage, mergeCoverageFinal, mergeCoverageSummaries } from './runTestsJob.service.js';
import { runVitestCoverage } from './vitestRunner.service.js';
import { classifyTestFile } from '../utils/testingFrameworkDetector.js';
import { measureUnitTestPhase } from './unitTestWork.service.js';
import { dockerRunner } from './dockerRunner.service.js';

function readFirst(directory, names) {
    const directories = (Array.isArray(directory) ? directory : [directory]).filter(Boolean);
    for (const dir of directories) {
        for (const name of names) {
            const file = path.join(dir, name);
            if (fs.existsSync(file)) {
                try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* next candidate */ }
            }
        }
    }
    return null;
}

const artifacts = [
    'jest-results.json',
    'vitest-results.json',
    'test-results.json',
    'test-result.json',
    'coverage-final.json',
    'coverage-summary.json',
    'vitest-coverage-final.json',
    'vitest-coverage-summary.json',
    'jest-coverage-final.json',
    'jest-coverage-summary.json'
];

function clearArtifacts(directory) {
    if (!directory) return;
    fs.mkdirSync(directory, { recursive: true });
    for (const name of artifacts) {
        const file = path.join(directory, name);
        if (fs.existsSync(file)) {
            try { fs.unlinkSync(file); } catch { }
        }
    }
    const subCov = path.join(directory, 'coverage');
    if (fs.existsSync(subCov)) {
        try {
            if (fs.statSync(subCov).isDirectory()) {
                for (const name of artifacts) {
                    const file = path.join(subCov, name);
                    if (fs.existsSync(file)) {
                        try { fs.unlinkSync(file); } catch { }
                    }
                }
            }
        } catch { }
    }
}

/** Preserve the framework of every file. A mixed batch must never be converted
 * wholesale to whichever runner happened to be selected first. */
export const runUnitTestBatch = input => measureUnitTestPhase('batchExecution', () => runUnitTestBatchInternal(input));

async function runUnitTestBatchInternal({ rootDir, snapshot, testFiles, targetSourceFiles, coverageDir, frameworkByFile = {}, hermeticMocks = {}, useHermeticMock = true, virtualDbEnv, requireDocker = false }) {
    if (requireDocker) {
        const availability = typeof dockerRunner.checkAvailability === 'function'
            ? dockerRunner.checkAvailability()
            : {
                available: Boolean(dockerRunner.containerEnabled),
                code: dockerRunner.containerEnabled ? 'RUNNER_AVAILABLE' : 'RUNNER_UNAVAILABLE',
                reason: 'Docker runner is unavailable.',
            };
        if (!availability.available) {
            const err = new Error(`Docker is required for generated unit test verification and is unavailable [${availability.code}]: ${availability.reason}`);
            err.code = availability.code;
            err.dockerDiagnostics = availability;
            throw err;
        }
    }
    clearArtifacts(coverageDir);
    const isE2EOrIntegrationTest = (filePath) => {
        if (!filePath || typeof filePath !== 'string') return false;
        const norm = filePath.replace(/\\/g, '/').toLowerCase();
        return (
            /(?:^|\/)(?:e2e|system|cypress|playwright|integration)(?:[-_a-z0-9]*)?(?:\/|$)/i.test(norm) ||
            /\b(?:e2e|system|cypress|playwright|supertest|integration)\.(?:test|spec)\.[cm]?[jt]s$/i.test(norm) ||
            /(?:^|[._-])(?:e2e|system|cypress|playwright|supertest|integration)(?:[._-]|$)/i.test(path.basename(norm)) ||
            /(?:^|\/)tier\d+[-_].*\.(?:test|spec)\.[cm]?[jt]s$/i.test(norm)
        );
    };

    const unitTestFiles = (testFiles || []).filter(file => !isE2EOrIntegrationTest(file));
    const groups = new Map();
    const unsupported = [];
    for (const file of unitTestFiles) {
        const framework = frameworkByFile[file] || classifyTestFile(fs.readFileSync(path.join(rootDir, file), 'utf8'), file);
        if (!['jest', 'vitest'].includes(framework)) { unsupported.push(file); continue; }
        if (!groups.has(framework)) groups.set(framework, []);
        groups.get(framework).push(file);
    }
    let exitCode = groups.size && !unsupported.length ? 0 : 1;
    const output = unsupported.map(file => `Unsupported unit test framework: ${file}`);
    let final = {};
    let summary = {};
    const suites = [];
    const createdHarnessFiles = new Set();
    try {
        for (const [framework, files] of groups) {
            const directory = path.join(coverageDir, framework);
            clearArtifacts(directory);
            const options = {
                coverageDir: directory,
                targetSourceFiles,
                hermeticMocks: hermeticMocks || {},
                useHermeticMock: useHermeticMock !== false,
                virtualDbEnv: virtualDbEnv || (hermeticMocks?.DATABASE_URL ? { DATABASE_URL: hermeticMocks.DATABASE_URL } : {}),
                createdHarnessFiles,
                cleanupStubs: true,
                requireDocker,
                autoHeal: !requireDocker,
                allowUninstrumentedFallback: !requireDocker,
            };
            let result;
            try {
                result = framework === 'vitest'
                    ? await runVitestCoverage(null, rootDir, snapshot?.vitestCommand, files, options)
                    : await runJestCoverage(null, rootDir, snapshot?.jestConfigPath, files, snapshot?.jestCommand, options);
            } catch (error) {
                exitCode = 1;
                output.push(`[${framework}] ${error.message}`);
                continue;
            }
            if (result.exitCode !== 0) exitCode = result.exitCode ?? 1;
            output.push(result.stderr || '', result.stdout || '');
            const candidateDirs = [
                directory,
                result?.coverageDir,
                path.join(directory, 'coverage'),
                result?.coverageDir ? path.join(result.coverageDir, 'coverage') : null
            ].filter(Boolean);
            const report = readFirst(candidateDirs, ['jest-results.json', 'vitest-results.json', 'test-results.json', 'test-result.json']);
            if (!Array.isArray(report?.testResults)) {
                exitCode = 1;
                output.push(`[${framework}] The runner did not produce a fresh JSON test report.`);
            }
            else suites.push(...report.testResults);
            const nextFinal = readFirst(candidateDirs, ['coverage-final.json', 'vitest-coverage-final.json', 'jest-coverage-final.json']);
            const nextSummary = readFirst(candidateDirs, ['coverage-summary.json', 'vitest-coverage-summary.json', 'jest-coverage-summary.json']);
            const allTestsPassed = Array.isArray(report?.testResults) &&
                report.testResults.length > 0 &&
                report.testResults.every(r => r.status === 'passed' || !r.numFailingTests);
            if (!nextFinal || !nextSummary?.total) {
                if (!allTestsPassed) {
                    exitCode = 1;
                    output.push(`[${framework}] The runner did not produce fresh coverage JSON reports.`);
                } else {
                    output.push(`[${framework}] Notice: Coverage JSON reports were not produced, but all tests passed.`);
                }
            }
            final = mergeCoverageFinal(final, nextFinal || {}, { rootDir });
            summary = mergeCoverageSummaries(summary, nextSummary || {}, { rootDir, mergedFinal: final });
        }
    } finally {
        if (createdHarnessFiles.size > 0) {
            for (const file of createdHarnessFiles) {
                try {
                    if (fs.existsSync(file)) fs.unlinkSync(file);
                } catch { }
            }
        }
    }
    fs.writeFileSync(path.join(coverageDir,'test-results.json'), JSON.stringify({ success: exitCode === 0,
        numFailedTestSuites: suites.filter(suite => suite.status === 'failed').length, testResults: suites }));
    if (Object.keys(final).length) fs.writeFileSync(path.join(coverageDir,'coverage-final.json'), JSON.stringify(final));
    if (summary.total) fs.writeFileSync(path.join(coverageDir,'coverage-summary.json'), JSON.stringify(summary));
    return { exitCode, stdout: output.join('\n'), stderr: '' };
}
