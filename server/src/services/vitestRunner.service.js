import fs from "fs";
import path from "path";
import { addJobLog } from "./job.service.js";
import { dockerRunner } from "./dockerRunner.service.js";
import { classifyTestFile } from "../utils/testingFrameworkDetector.js";
import { ensureVitestCoverageRuntime, bindVitestCommand } from './vitestRuntime.service.js';
import {groupVitestProjects,discoverVitestFiles,findVitestConfig,runVitestProjectGroups,ensureVitestEnvironment,validateVitestSetupFiles} from './vitestProjectGroups.service.js';
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for npm install
const VITEST_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for testing

/**
 * Install dependencies
 */
export const installVitestDeps = async (jobId, rootDir) => {
    await addJobLog(
        jobId,
        "INFO",
        "Start installing dependencies (Vitest)...",
    ).catch(() => { });

    const result = await dockerRunner.run({
        snapshotPath: rootDir,
        command: "npm install --prefer-offline --legacy-peer-deps --no-audit --no-fund --progress=false",
        timeoutMs: INSTALL_TIMEOUT_MS,
        jobId,
    });

    if (!result.success) {
        await addJobLog(jobId, "WARN", `Install dependencies warning: ${result.stderr}`).catch(() => { });
    }
};

/**
 * Resolve the best vitest executable path
 */
/**
 * Detect the major version of Vitest installed in the project or container.
 */
export const resolveVitestMajorVersion = (dir) => {
    const candidates = [
        path.join(dir, "node_modules", "vitest", "package.json"),
        path.join(dir, "..", "node_modules", "vitest", "package.json"),
        "/app/node_modules/vitest/package.json",
    ];
    for (const cand of candidates) {
        if (fs.existsSync(cand)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(cand, "utf-8"));
                const major = parseInt(String(pkg.version).split(".")[0], 10);
                if (!isNaN(major)) return major;
            } catch { }
        }
    }

    // Check project package.json dependencies/devDependencies
    const projectPkgs = [
        path.join(dir, "package.json"),
        path.join(dir, "..", "package.json"),
    ];
    for (const p of projectPkgs) {
        if (fs.existsSync(p)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(p, "utf-8"));
                const vitestVer = pkg.devDependencies?.vitest || pkg.dependencies?.vitest;
                if (typeof vitestVer === "string") {
                    const match = vitestVer.match(/(\d+)\./);
                    if (match) return parseInt(match[1], 10);
                }
            } catch { }
        }
    }

    return 1; // Default to 1 if indeterminate
};

/**
 * Returns the appropriate concurrency/worker flags for Vitest.
 * In Vitest 2.0+, CAC parser rejects `--minWorkers` with CACError.
 * In Vitest 1.x, omitting `--minWorkers` when passing `--maxWorkers=2` triggers Tinypool RangeError.
 */
export const getVitestWorkerArgs = (dir) => {
    const major = resolveVitestMajorVersion(dir);
    if (major >= 2) {
        return "--maxWorkers=2";
    }
    return "--maxWorkers=2 --minWorkers=1";
};

/**
 * Run a Vitest command via dockerRunner with self-healing retry for CLI option discrepancies:
 * - Vitest 2.0+ CACError: Unknown option '--minWorkers'
 * - Vitest 1.x Tinypool RangeError: options.minThreads and options.maxThreads must not conflict
 */
export const runVitestWithSelfHealing = async ({ snapshotPath, command, timeoutMs, jobId, env }) => {
    let currentCmd = command;
    let res = await dockerRunner.run({
        snapshotPath,
        command: currentCmd,
        timeoutMs,
        jobId,
        env,
    });

    const combinedOutput = `${res?.stderr || ""}\n${res?.stdout || ""}`;

    // Heal Vitest 2+ CACError for --minWorkers
    if (/CACError:\s*Unknown option ['`]?--minWorkers['`]?/i.test(combinedOutput) && currentCmd.includes("--minWorkers")) {
        const healedCmd = currentCmd.replace(/--minWorkers(?:=\S+|\s+\S+)?/g, "").replace(/\s+/g, " ").trim();
        await addJobLog(jobId, "WARN", `[VITEST] Detected CACError: Unknown option '--minWorkers'. Automatically stripping flag and retrying...`).catch(() => { });
        currentCmd = healedCmd;
        res = await dockerRunner.run({
            snapshotPath,
            command: currentCmd,
            timeoutMs,
            jobId,
            env,
        });
    }
    // Heal Vitest 1.x Tinypool RangeError: minThreads > maxThreads
    else if (/RangeError:\s*options\.minThreads and options\.maxThreads must not conflict/i.test(combinedOutput) && !currentCmd.includes("--minWorkers")) {
        const healedCmd = currentCmd.includes("--maxWorkers")
            ? currentCmd.replace(/--maxWorkers(?:=\S+|\s+\S+)?/g, "$& --minWorkers=1").replace(/\s+/g, " ").trim()
            : `${currentCmd} --minWorkers=1`.trim();
        await addJobLog(jobId, "WARN", `[VITEST] Detected Tinypool RangeError (minThreads conflict). Automatically adding '--minWorkers=1' and retrying...`).catch(() => { });
        currentCmd = healedCmd;
        res = await dockerRunner.run({
            snapshotPath,
            command: currentCmd,
            timeoutMs,
            jobId,
            env,
        });
    }

    return res;
};

/**
 * Run Vitest test
 */
export const runVitestTests = async (jobId, rootDir, vitestCommand) => {
    const testCmd = vitestCommand ? vitestCommand : "npx --yes vitest run --passWithNoTests";

    await addJobLog(jobId, "INFO", `Run command: ${testCmd}`).catch(() => { });

    const result = await runVitestWithSelfHealing({
        snapshotPath: rootDir,
        command: testCmd,
        timeoutMs: VITEST_TIMEOUT_MS,
        jobId,
    });

    return result;
};

const SHARED_ENV = {
    NODE_OPTIONS: "--experimental-vm-modules",
    NODE_PATH: "/app/node_modules:/usr/local/lib/node_modules:./node_modules:../node_modules",
    VITE_CJS_IGNORE_WARNING: "true",
};

/**
 * Run Vitest with Coverage
 */
export const runVitestCoverage = async (jobId, rootDir, vitestCommand, specificFiles = [], options = {}) => {
    const targetCovDir = options?.coverageDir ? path.resolve(rootDir, options.coverageDir) : path.join(rootDir, "coverage");
    if (!fs.existsSync(targetCovDir)) {
        try { fs.mkdirSync(targetCovDir, { recursive: true }); } catch { }
    }
    const rootCoverageDir = targetCovDir;
    const relCovDir = path.relative(rootDir, targetCovDir).replace(/\\/g, "/") || "coverage";
    for(const name of ['vitest-results.json','test-results.json','coverage-final.json','coverage-summary.json']) {
        const file=path.join(targetCovDir,name);
        if(fs.existsSync(file))fs.unlinkSync(file);
    }
    if(!options.executionDir) {
        const files=specificFiles?.length ? specificFiles : discoverVitestFiles(rootDir,classifyTestFile);
        const groups=groupVitestProjects(rootDir,files);
        if([...groups.keys()].some(directory=>directory!==path.resolve(rootDir))) {
            const {mergeCoverageFinal,mergeCoverageSummaries}=await import('./runTestsJob.service.js');
            const groupResult = await runVitestProjectGroups({rootDir,groups,coverageDir:targetCovDir,
                mergeFinal:mergeCoverageFinal,mergeSummaries:mergeCoverageSummaries,
                run:(directory,files,coverageDir)=>runVitestCoverage(jobId,rootDir,
                    directory===path.resolve(rootDir)?vitestCommand:null,files,{...options,executionDir:directory,coverageDir})});
            const covFinal = path.join(rootCoverageDir, "coverage-final.json");
            const covSummary = path.join(rootCoverageDir, "coverage-summary.json");
            if (fs.existsSync(covFinal) && !fs.existsSync(path.join(rootCoverageDir, "vitest-coverage-final.json"))) {
                try { fs.copyFileSync(covFinal, path.join(rootCoverageDir, "vitest-coverage-final.json")); } catch { }
            }
            if (fs.existsSync(covSummary) && !fs.existsSync(path.join(rootCoverageDir, "vitest-coverage-summary.json"))) {
                try { fs.copyFileSync(covSummary, path.join(rootCoverageDir, "vitest-coverage-summary.json")); } catch { }
            }
            return groupResult;
        }
    }

    const backendDir = path.join(rootDir, 'backend');
    const hasBackendDir = !options.executionDir && fs.existsSync(backendDir) &&
        (fs.existsSync(path.join(backendDir,'package.json')) || fs.existsSync(path.join(backendDir,'vitest.config.js'))) &&
        (!specificFiles?.length || specificFiles.every(file => file.replaceAll('\\','/').startsWith('backend/') || !/[\\/]/.test(file)));
    const executionDir = options.executionDir || (hasBackendDir ? backendDir : rootDir);
    const configuredCommand = bindVitestCommand(executionDir, vitestCommand, 'vitest');
    const tokens = configuredCommand.match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) || [];
    let explicitConfig;
    let hasRootOverride = false;
    for (let index = 2; index < tokens.length; index++) {
        const token = tokens[index];
        if (token === '--') break;
        if (/^(?:--root|-r)(?:=|$)/.test(token)) hasRootOverride = true;
        if (/^(?:--config|-c)(?:=|$)/.test(token)) {
            const equals = token.indexOf('=');
            const value = equals === -1 ? tokens[++index] : token.slice(equals + 1);
            explicitConfig = (value || '').replace(/^(["'])(.*)\1$/, '$2');
        }
    }
    const config = explicitConfig ?? (hasRootOverride ? null : findVitestConfig(executionDir) ??
        (!hasBackendDir ? ['examples/vitest/vitest.config.mts', 'examples/vitest/vitest.config.ts']
            .find(file => fs.existsSync(path.join(executionDir, file))) : null));
    const configArg = explicitConfig === undefined && config ? `--config "${config}"` : '';
    const createdHarnessFiles = options?.createdHarnessFiles || new Set();
    let setupValidation = null;
    try {
        setupValidation = !hasRootOverride
            ? validateVitestSetupFiles({
                rootDir,
                directory: executionDir,
                config: config ?? null,
                autoHeal: true,
                createdHarnessFiles,
            })
            : null;
    let runtime = await ensureVitestCoverageRuntime({rootDir,executionDir,jobId});
    if(await ensureVitestEnvironment({rootDir,directory:executionDir,config:config ?? null,jobId,runtime})) {
        runtime = await ensureVitestCoverageRuntime({rootDir,executionDir,jobId});
    }
    const baseCmd = runtime.command + configuredCommand.slice('vitest'.length);
    await addJobLog(jobId,'INFO',`[VITEST] Verified coverage runtime: vitest=${runtime.runner.version}, @vitest/coverage-v8=${runtime.provider.version}; runner=${runtime.runner.real}; provider=${runtime.provider.real}`).catch(()=>{});

    const fileCount = Array.isArray(specificFiles) && specificFiles.length > 0 ? specificFiles.length : 50;
    const effectiveTimeout = Math.min(10 * 60 * 1000, Math.max(180 * 1000, 60 * 1000 + fileCount * 25 * 1000));

    // 2. Resolve workspace root .env, .env.test, and hermetic RAM mocks
    let loadedWorkspaceEnv = {};
    let loadedTestEnv = {};
    let hermeticMocks = options?.hermeticMocks || {};
    try {
        const { loadWorkspaceEnv, generateHermeticMockEnvironment, detectProjectEnvironment, parseEnv } = await import("./environmentDetection.service.js");
        const rootEnvRes = await loadWorkspaceEnv(rootDir);
        loadedWorkspaceEnv = { ...(rootEnvRes?.variables || {}) };
        if(options.executionDir && path.resolve(executionDir)!==path.resolve(rootDir)) {
            const projectEnv=await loadWorkspaceEnv(executionDir);
            loadedWorkspaceEnv={...loadedWorkspaceEnv,...(projectEnv.variables||{})};
        }

        const backendDirCandidate = hasBackendDir ? backendDir : executionDir;
        if (fs.existsSync(backendDirCandidate)) {
            const backendEnvRes = await loadWorkspaceEnv(backendDirCandidate);
            loadedWorkspaceEnv = { ...loadedWorkspaceEnv, ...(backendEnvRes?.variables || {}) };
        }

        const testEnvPath = path.join(rootDir, ".env.test");
        if (fs.existsSync(testEnvPath)) {
            try {
                loadedTestEnv = { ...loadedTestEnv, ...(parseEnv(fs.readFileSync(testEnvPath, "utf8"))?.variables || {}) };
            } catch (_) { }
        }
        const backendTestEnvPath = path.join(backendDirCandidate, ".env.test");
        if (fs.existsSync(backendTestEnvPath)) {
            try {
                loadedTestEnv = { ...loadedTestEnv, ...(parseEnv(fs.readFileSync(backendTestEnvPath, "utf8"))?.variables || {}) };
            } catch (_) { }
        }

        const useHermeticMock = options?.useHermeticMock !== false;
        if (useHermeticMock && (!options?.hermeticMocks || Object.keys(options.hermeticMocks).length === 0)) {
            const detected = await detectProjectEnvironment(rootDir, { existingVariables: { ...loadedWorkspaceEnv, ...loadedTestEnv } });
            hermeticMocks = generateHermeticMockEnvironment(detected?.detectedVariables || [], { ...loadedWorkspaceEnv, ...loadedTestEnv });
        }
    } catch (_) { }

    // Requirement R2: Never inherit or load real database credentials from repository .env
    const isDbKey = k => /^(DATABASE_URL|DIRECT_URL|SHADOW_DATABASE_URL|POSTGRES_URL|POSTGRESQL_URL|DB_URL|DB_URI|DB_CONNECTION_STRING|MONGODB_URI|MYSQL_URL)$/i.test(k) || /^DATABASE_/i.test(k);
    for (const k of Object.keys(loadedWorkspaceEnv)) {
        if (isDbKey(k)) delete loadedWorkspaceEnv[k];
    }
    for (const k of Object.keys(loadedTestEnv)) {
        if (isDbKey(k)) delete loadedTestEnv[k];
    }

    const vitestMergedEnv = {
        ...SHARED_ENV,
        ...hermeticMocks,
        ...loadedWorkspaceEnv,
        ...loadedTestEnv,
        ...(options?.virtualDbEnv || {}),
        ...(options?.env || {}),
        NODE_PATH:[path.join(executionDir,'node_modules'),path.join(rootDir,'node_modules')].join(path.delimiter),
    };

    // 3. Determine execution mode:
    // If backend/ has vitest.config.* or package.json, run directly in backend/
    const coverageAllFlag = "--coverage.all=false";

    let result;
    if (hasBackendDir) {
        // Fast-path: Execute inside backend targeting unit tests
        let targetArg = "tests/unit";
        if (Array.isArray(specificFiles) && specificFiles.length > 0) {
            const backendSpecific = specificFiles
                .filter(f => f.startsWith("backend/") || !f.includes("/"))
                .map(f => `"${f.replace(/^backend\//, "").replace(/\\/g, "/")}"`);
            if (backendSpecific.length > 0) {
                targetArg = backendSpecific.join(" ");
            }
        }

        const backendBase = `${baseCmd} ${configArg}`;
        const workerArgs = runtime.major >= 2 ? '--maxWorkers=2' : '--maxWorkers=2 --minWorkers=1';
        const vitestCmd = `cd backend && ${backendBase} ${targetArg} --globals --coverage ${coverageAllFlag} --testTimeout=10000 ${workerArgs} --coverage.reportsDirectory=../${relCovDir} --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=lcov --coverage.reportOnFailure=true --reporter=default --reporter=json --outputFile=../${relCovDir}/vitest-results.json --passWithNoTests`;

        await addJobLog(jobId, "INFO", `[VITEST] Running Vitest in backend/ with command: ${vitestCmd} (timeout: ${Math.round(effectiveTimeout / 60000)}m)`).catch(() => { });

        result = await runVitestWithSelfHealing({
            snapshotPath: rootDir,
            command: vitestCmd,
            timeoutMs: effectiveTimeout,
            jobId,
            env: vitestMergedEnv,
        });

        // Copy backend coverage files into root coverage dir
        const backendCov = path.join(backendDir, "coverage");
        if (!options?.coverageDir && fs.existsSync(backendCov)) {
            const bFinal = path.join(backendCov, "coverage-final.json");
            const bSummary = path.join(backendCov, "coverage-summary.json");
            const bLcov = path.join(backendCov, "lcov.info");
            const bResults = path.join(backendCov, "vitest-results.json");

            if (fs.existsSync(bFinal)) {
                try { fs.copyFileSync(bFinal, path.join(rootCoverageDir, "vitest-coverage-final.json")); } catch { }
            }
            if (fs.existsSync(bSummary)) {
                try { fs.copyFileSync(bSummary, path.join(rootCoverageDir, "vitest-coverage-summary.json")); } catch { }
            }
            if (fs.existsSync(bLcov)) {
                try { fs.copyFileSync(bLcov, path.join(rootCoverageDir, "vitest-lcov.info")); } catch { }
            }
            if (fs.existsSync(bResults) && !fs.existsSync(path.join(rootCoverageDir, "vitest-results.json"))) {
                try { fs.copyFileSync(bResults, path.join(rootCoverageDir, "vitest-results.json")); } catch { }
            }
        }

        // Backend fallback: only retry without coverage if vitest-results.json was NOT written (e.g. coverage provider crash)
        const rootResultsPathCheck = path.join(rootCoverageDir, "vitest-results.json");
        const rootSummaryPathCheck = path.join(rootCoverageDir, "coverage-summary.json");
        const backendSummaryPathCheck = path.join(backendCov, "coverage-summary.json");
        const hasCoverage = fs.existsSync(rootSummaryPathCheck) || fs.existsSync(backendSummaryPathCheck);
        const combinedBackendOutput = `${result?.stderr || ""}\n${result?.stdout || ""}`;
        const isCoverageProviderCrash = /@vitest\/coverage|coverage provider|Failed to load coverage provider/i.test(combinedBackendOutput);
        const shouldFallback = (!fs.existsSync(rootResultsPathCheck) || (!hasCoverage && isCoverageProviderCrash)) && result.exitCode !== null;
        if (shouldFallback && options?.allowUninstrumentedFallback !== false) {
            await addJobLog(jobId, "WARN", `[VITEST] Vitest backend coverage failed (exit ${result.exitCode}), retrying basic test mode to collect test results...`).catch(() => { });
            // Keep retries in the same isolated run directory and test environment.
            if (fs.existsSync(rootResultsPathCheck)) fs.unlinkSync(rootResultsPathCheck);
            const fallbackCmd = `cd backend && ${backendBase} ${targetArg} --globals --coverage.enabled=false --testTimeout=10000 ${workerArgs} --passWithNoTests --reporter=default --reporter=json --outputFile=../${relCovDir}/vitest-results.json`;
            const fallbackResult = await runVitestWithSelfHealing({
                snapshotPath: rootDir,
                command: fallbackCmd,
                timeoutMs: effectiveTimeout,
                jobId,
                env: vitestMergedEnv,
            });
            result = fallbackResult;
        }

        // Sync candidate results
        const candidatePaths = [
            path.join(backendDir, "coverage", "vitest-results.json"),
            path.join(backendDir, "vitest-results.json"),
            path.join(rootDir, "vitest-results.json"),
            path.join(backendDir, "coverage", "test-results.json"),
            path.join(backendDir, "test-results.json"),
        ];
        for (const cand of candidatePaths) {
            if (!options?.coverageDir && fs.existsSync(cand) && !fs.existsSync(rootResultsPathCheck)) {
                try { fs.copyFileSync(cand, rootResultsPathCheck); break; } catch { }
            }
        }
    } else {
        // Root project execution
        let targetArg = "";
        if (Array.isArray(specificFiles) && specificFiles.length > 0) {
            targetArg = specificFiles.map(f => `"${path.relative(executionDir,path.resolve(rootDir,f)).replace(/\\/g, "/")}"`).join(" ");
        }

        const executionRelative=path.relative(rootDir,executionDir).replaceAll('\\','/');
        if(/["\r\n;&|`$]/.test(executionRelative))throw new Error('Unsupported shell characters in the Vitest project directory.');
        const prefix=executionRelative ? `cd "${executionRelative}" && ` : '';
        const projectCoverageDir=path.relative(executionDir,targetCovDir).replaceAll('\\','/');
        const rootWorkerArgs = runtime.major >= 2 ? '--maxWorkers=2' : '--maxWorkers=2 --minWorkers=1';

        const coverageCmd = `${prefix}${baseCmd} ${configArg} ${targetArg} --passWithNoTests --globals --testTimeout=10000 ${rootWorkerArgs} --coverage.enabled=true --coverage.provider=v8 ${coverageAllFlag} --coverage.reportsDirectory=${projectCoverageDir} --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=lcov --coverage.reportOnFailure=true --reporter=default --reporter=json --outputFile=${projectCoverageDir}/vitest-results.json`.replace(/\s+/g, " ").trim();

        await addJobLog(jobId, "INFO", `[VITEST] Running Vitest at rootDir: ${coverageCmd} (timeout: ${Math.round(effectiveTimeout / 60000)}m)`).catch(() => { });

        result = await runVitestWithSelfHealing({
            snapshotPath: rootDir,
            command: coverageCmd,
            timeoutMs: effectiveTimeout,
            jobId,
            env: vitestMergedEnv,
        });

        const vitestResultsPathCheck = path.join(rootCoverageDir, "vitest-results.json");
        const vitestSummaryPathCheck = path.join(rootCoverageDir, "coverage-summary.json");
        const hasCoverage = fs.existsSync(vitestSummaryPathCheck);
        const combinedRootOutput = `${result?.stderr || ""}\n${result?.stdout || ""}`;
        const isCoverageProviderCrash = /@vitest\/coverage|coverage provider|Failed to load coverage provider/i.test(combinedRootOutput);
        // Only retry without coverage if vitest-results.json was not written or coverage provider itself crashed
        const shouldFallback = (!fs.existsSync(vitestResultsPathCheck) || (!hasCoverage && isCoverageProviderCrash)) && result.exitCode !== null;
        if (shouldFallback && options?.allowUninstrumentedFallback !== false) {
            await addJobLog(jobId, "WARN", `[VITEST] Vitest coverage failed (exit ${result.exitCode}), retrying basic test mode to collect test results...`).catch(() => { });
            if (fs.existsSync(vitestResultsPathCheck)) fs.unlinkSync(vitestResultsPathCheck);
            const fallbackCmd = `${prefix}${baseCmd} ${configArg} ${targetArg} --globals --coverage.enabled=false --testTimeout=10000 ${rootWorkerArgs} --passWithNoTests --reporter=default --reporter=json --outputFile=${projectCoverageDir}/vitest-results.json`.replace(/\s+/g, " ").trim();
            const fallbackResult = await runVitestWithSelfHealing({
                snapshotPath: rootDir,
                command: fallbackCmd,
                timeoutMs: effectiveTimeout,
                jobId,
                env: vitestMergedEnv,
            });
            result = fallbackResult;
        }

        // Backup to vitest-*
        const covFinal = path.join(rootCoverageDir, "coverage-final.json");
        const covSummary = path.join(rootCoverageDir, "coverage-summary.json");
        if (fs.existsSync(covFinal)) {
            try { fs.copyFileSync(covFinal, path.join(rootCoverageDir, "vitest-coverage-final.json")); } catch { }
        }
        if (fs.existsSync(covSummary)) {
            try { fs.copyFileSync(covSummary, path.join(rootCoverageDir, "vitest-coverage-summary.json")); } catch { }
        }
    }

    // Ensure vitest-results.json exists in coverage dir
    const vitestResultsPath = path.join(rootCoverageDir, "vitest-results.json");
    const hasResults = fs.existsSync(vitestResultsPath);

    await addJobLog(jobId, "INFO", `[VITEST] Vitest completed (exit ${result.exitCode}, results: ${hasResults ? "found" : "not found"}).`).catch(() => { });

        return {
            ...result,
            coverageDir: rootCoverageDir,
            createdStubs: setupValidation?.createdStubs || [],
        };
    } finally {
        if (options?.cleanupStubs && createdHarnessFiles.size > 0) {
            for (const file of createdHarnessFiles) {
                try {
                    if (fs.existsSync(file)) fs.unlinkSync(file);
                } catch { }
            }
        }
    }
};
