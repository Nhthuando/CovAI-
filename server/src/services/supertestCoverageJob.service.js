import fs from "fs";
import path from "path";
import {
    markJobRunning,
    markJobSuccess,
    markJobFailed,
    updateJobProgress,
    getJobById,
    addJobLog,
} from "./job.service.js";
import { saveJobOutput } from "./jobOutput.service.js";
import { runSupertest } from "./supertestRunner.service.js";
import { parseCoverageSummary } from "./coverageSummaryParser.service.js";
import { storeCoverageOutputs } from "./coverageStorage.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { detectSupertest } from "./supertestDetection.service.js";
import { parseJestResults, formatScenariosForPrisma } from "./testResultParser.service.js";
import { resolveAppImportPath } from "./aiTestStorage.service.js";
import { dockerRunner } from "./dockerRunner.service.js";
import babel from "@babel/core";
import transformCommonJsPlugin from "@babel/plugin-transform-modules-commonjs";
import prisma from "../config/prisma.js";
import { randomUUID } from 'node:crypto';
import { currentProjectOperation, withOperationPublishGuard, stagePreparedPublication } from './projectOperationWorkspace.service.js';
import { resolveContainedProjectPath } from './projectFileVersion.service.js';
import { resolveProjectRoot, ensureMinimalPackageJson } from '../utils/projectRootResolver.js';
import {
    registerJobAbortController,
    unregisterJobAbortController,
    isJobCanceled,
} from "./jobCancellation.service.js";

/**
 * Ensure project and subproject dependencies (e.g. server/node_modules) are installed.
 */
const ensureProjectDependencies = async (jobId, rootDir) => {
    const candidates = [
        rootDir,
        path.join(rootDir, "server"),
        path.join(rootDir, "backend"),
        path.join(rootDir, "api"),
    ];

    for (const dir of candidates) {
        const pkgPath = path.join(dir, "package.json");
        if (fs.existsSync(pkgPath)) {
            const modulesPath = path.join(dir, "node_modules");
            const needsInstall = !fs.existsSync(modulesPath) || fs.readdirSync(modulesPath).length <= 2;
            if (needsInstall) {
                const rel = path.relative(rootDir, dir).replace(/\\/g, "/");
                const label = rel ? rel : "root";
                await addJobLog(jobId, "INFO", `[SUPERTEST] Installing dependencies for ${label}...`).catch(() => { });
                const prefixFlag = rel ? ` --prefix ${rel}` : "";
                const installCmd = `npm install${prefixFlag} --prefer-offline --legacy-peer-deps --no-audit --no-fund --progress=false`;
                await dockerRunner.run({
                    snapshotPath: rootDir,
                    command: installCmd,
                    timeoutMs: 5 * 60 * 1000,
                    jobId
                });
            }
        }
    }
};

/**
 * Automatically transform ESM test code to CommonJS if the project is CommonJS.
 */
export const transformTestCodeForProject = async (code, rootDir, filePath) => {
    try {
        let transformedCode = resolveAppImportPath(code, rootDir, filePath);

        const checkIsEsm = (dir) => {
            const pkgPath = path.join(dir, "package.json");
            if (fs.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
                    if (pkg.type === "module") return true;
                } catch (_) { }
            }
            return false;
        };

        const isEsm = checkIsEsm(rootDir) || checkIsEsm(path.join(rootDir, "server")) || checkIsEsm(path.join(rootDir, "backend"));

        if (!isEsm && (/\bimport\s+[\s\S]*?from\s+['"]/.test(transformedCode) || /\bexport\s+(default|\{)/.test(transformedCode))) {
            const result = babel.transformSync(transformedCode, {
                plugins: [transformCommonJsPlugin],
                sourceType: "module"
            });
            if (result?.code) {
                return result.code;
            }
        }
        return transformedCode;
    } catch (err) {
        if (err.statusCode || err.name === "ServiceError") throw err;
        console.warn("[SupertestCoverageJob] Babel transform fallback:", err.message);
        throw err;
    }
};

/**
 * Pipeline cho Supertest Coverage:
 * 1. Run Supertest (runSupertest)
 * 2. Parse coverage (reuse existing parsers)
 * 3. Save results to DB & Firebase
 */
export const processSupertestCoverageJob = async (jobId) => {
    const abortController = new AbortController();
    registerJobAbortController(jobId, abortController);

    try {
        if (isJobCanceled(jobId, abortController.signal)) return;

        await markJobRunning(jobId);
        const job = await getJobById(jobId);
        if (isJobCanceled(jobId, abortController.signal) || job?.status === "CANCELED") return;

        if (!job?.snapshot?.rootDir) {
            throw new ServiceError("Snapshot is not ready to run Supertest.", 409);
        }
        const { jestConfigPath } = job.snapshot;
        const rootDir = resolveProjectRoot(job.snapshot.rootDir) || job.snapshot.rootDir;
        const snapshotId = job.snapshotId;
        const projectId = job.projectId;
        const userId = job.userId;
        if (currentProjectOperation()) {
            ensureMinimalPackageJson(rootDir);
            const { runNpmInstall } = await import('./runTestsJob.service.js');
            await runNpmInstall(jobId, rootDir);
        }

        const supertestInfo = await detectSupertest(rootDir);
        
        // Use ONLY generated AI tests to avoid running broken user tests
        const aiTests = await prisma.aiTest.findMany({
            where: { snapshotId }
        });
        
        const supertestFiles = [];
        const { parseCode, findScenarioPath, getScenarioIdentity } = await import("./scenarioManager.service.js");
        const _genModule = await import('@babel/generator');
        const generate = _genModule.default?.default || _genModule.default || _genModule;

        for (const t of aiTests) {
            if (!t.metaJson) continue;
            let meta;
            try { meta = typeof t.metaJson === 'string' ? JSON.parse(t.metaJson) : t.metaJson; } catch(e) { continue; }
            if (meta.framework && String(meta.framework).toUpperCase() !== "SUPERTEST") continue;
            if (meta.status === "REJECTED" || meta.status === "DISABLED") continue;
            
            const filePath = (await resolveContainedProjectPath(job.snapshot, t.filePath)).target;
            
            const testCode = t.content || (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');
            if (!testCode) continue;

            // Sync DB content to disk and enforce approval & toggle semantics
            const ast = parseCode(testCode);
            const requests = Array.isArray(meta.requests) ? meta.requests : [];
            const approvedScenarios = new Set(meta.approvedScenarios || []);
            
            for (const r of requests) {
                const { testName, nameIndex } = getScenarioIdentity(t, r.scenarioId);
                const scenarioPath = findScenarioPath(ast, testName, nameIndex);
                if (scenarioPath) {
                    const isExplicitlyApproved = approvedScenarios.has(r.scenarioId) || approvedScenarios.has(r.testName);
                    const isApproved = approvedScenarios.size === 0 || isExplicitlyApproved;
                    const isEnabled = r.enabled !== false;
                    const shouldRun = isApproved && isEnabled;

                    const callee = scenarioPath.node.callee;
                    if (shouldRun) {
                        if (callee.type === 'MemberExpression' && (callee.object.name === 'it' || callee.object.name === 'test')) {
                            scenarioPath.node.callee = callee.object;
                        }
                    } else {
                        if (callee.type === 'Identifier' && (callee.name === 'it' || callee.name === 'test')) {
                            scenarioPath.node.callee = {
                                type: 'MemberExpression',
                                object: callee,
                                property: { type: 'Identifier', name: 'skip' },
                                computed: false
                            };
                        }
                    }
                }
            }
            
            const { code: finalCode } = generate(ast);
            const executableCode = await transformTestCodeForProject(finalCode, rootDir, filePath);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, executableCode, 'utf8');
            supertestFiles.push(filePath);
        }

        if (supertestFiles.length === 0) {
            const projectTestFiles = (supertestInfo.supertestFiles && supertestInfo.supertestFiles.length > 0)
                ? supertestInfo.supertestFiles
                : (supertestInfo.testFiles || []);
            for (const f of projectTestFiles) {
                const fullF = path.isAbsolute(f) ? f : path.join(rootDir, f);
                if (fs.existsSync(fullF)) {
                    supertestFiles.push(fullF);
                }
            }
        }

        if (supertestFiles.length === 0) {
            throw new ServiceError("Không tìm thấy tệp kiểm thử Supertest hợp lệ trong snapshot này. Vui lòng bấm 'Sinh test AI' để tạo kịch bản kiểm thử API.", 422);
        }

        await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });
        await updateJobProgress(jobId, 10);
        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'PREPARE_ENV', label: "Starting Supertest coverage pipeline...", progress: 10 }));

        if (isJobCanceled(jobId, abortController.signal)) return;

        // Ensure dependencies exist (e.g. server/node_modules) before starting test suite
        await ensureProjectDependencies(jobId, rootDir);

        if (isJobCanceled(jobId, abortController.signal)) return;

        // 1. Run Supertest
        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'RUN_JEST', label: "Running Supertest test suite...", progress: 20 }));
        const runResult = await runSupertest(
            jobId,
            rootDir,
            jestConfigPath ?? supertestInfo.configPath,
            supertestFiles
        );
        // DockerRunner streams output live. Saving the final buffers also covers
        // alternative runners and guarantees a complete output record.
        await saveJobOutput(jobId, {
            stdout: runResult.stdout ?? "",
            stderr: runResult.stderr ?? "",
        }).catch(() => { });
        const { coverageDir } = runResult;
        await updateJobProgress(jobId, 50);

        // 2. Parse coverage
        const summaryPath = path.join(coverageDir, "coverage-summary.json");
        const finalPath = path.join(coverageDir, "coverage-final.json");
        if (!fs.existsSync(summaryPath) || !fs.existsSync(finalPath)) {
            const errorSnippet = (runResult.stderr || runResult.stdout || "").trim();
            const reason = errorSnippet ? `: ${errorSnippet.slice(-300)}` : "";
            throw new ServiceError(`Supertest completed without producing the required coverage JSON files${reason}`, 422);
        }
        const summaryResult = await withOperationPublishGuard(() => parseCoverageSummary(coverageDir, snapshotId, { skipSummaryUpsert: true }));

        // Parse test results
        const supertestResults = parseJestResults(coverageDir, { aiTests, rootDir });
        // SCRUM-141: Persist Supertest test results
        if (supertestResults) {
            const formattedScenarios = formatScenariosForPrisma(supertestResults.scenarios);
            const dataPayload = {
                snapshotId,
                type: "SUPERTEST",
                totalTests: supertestResults.totalTests,
                passedTests: supertestResults.passedTests,
                failedTests: supertestResults.failedTests,
                skippedTests: supertestResults.skippedTests,
                durationMs: supertestResults.durationMs,
                status: supertestResults.status, // PASSED or FAILED
                startedAt: job.startedAt || new Date(),
                finishedAt: new Date()
            };
            if (formattedScenarios) {
                dataPayload.scenarios = formattedScenarios;
            }
            dataPayload.id = randomUUID();
            if (dataPayload.scenarios?.create) dataPayload.scenarios.create = dataPayload.scenarios.create.map(row=>({...row,id:row.id || randomUUID()}));
            let createdTestRun = {...dataPayload,scenarios:dataPayload.scenarios?.create || []};
            await stagePreparedPublication(async tx => { const stored = await tx.testRun.create({data:dataPayload,include:{scenarios:true}});if(stored?.id)createdTestRun=stored; });
            await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'PARSE_COVERAGE', label: `[SCRUM-141] Saved TestRun (SUPERTEST): ${supertestResults.totalTests} tests.`, progress: 60 })).catch(() => { });

            // Enrich runtime evidence with testRunId and scenarioId
            try {
                const evidencePath = path.join(coverageDir, "runtime-evidence.json");
                const tempEvidencePath = path.join(rootDir, ".covai-temp", "runtime-evidence.json");
                const targetEvidencePath = fs.existsSync(evidencePath) ? evidencePath : (fs.existsSync(tempEvidencePath) ? tempEvidencePath : null);
                if (targetEvidencePath) {
                    const rawEv = JSON.parse(fs.readFileSync(targetEvidencePath, "utf8"));
                    if (Array.isArray(rawEv)) {
                        const scenarioMap = new Map((createdTestRun.scenarios || []).map(s => [s.title, s]));
                        const enriched = rawEv.map(ev => {
                            const sc = scenarioMap.get(ev.testTitle) || (createdTestRun.scenarios || []).find(s =>
                                (ev.testTitle && s.title && (ev.testTitle.includes(s.title) || s.title.includes(ev.testTitle)))
                            );
                            return {
                                ...ev,
                                testRunId: createdTestRun.id,
                                scenarioId: sc?.id || null,
                                runnerVerdict: sc ? (sc.status === 'passed' ? 'PASS' : (sc.status === 'failed' ? 'FAIL' : 'SKIPPED')) : (ev.actualStatusFromRuntime ? 'PASS' : 'UNKNOWN'),
                                statusAssertionResult: sc ? (sc.status === 'passed' ? 'PASS' : (sc.status === 'failed' ? 'FAIL' : 'NOT_EVALUATED')) : (ev.actualStatusFromRuntime ? 'PASS' : 'NOT_EVALUATED')
                            };
                        });
                        fs.writeFileSync(evidencePath, JSON.stringify(enriched, null, 2), "utf8");
                        try { fs.writeFileSync(tempEvidencePath, JSON.stringify(enriched, null, 2), "utf8"); } catch (_) {}
                    }
                }
            } catch (evErr) {
                console.warn("[SupertestCoverageJob] Failed to enrich runtime evidence:", evErr.message);
            }
        }

        // Parse details (reuse logic from runTestsJob)
        const { parseCoverageFilesForSnapshot } = await import("./coverageFileParser.service.js");
        const { parseCoverageFunctionsForSnapshot } = await import("./coverageFunctionParser.service.js");

        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'MAP_RESULTS', label: "Parsing coverage files and functions...", progress: 70 }));
        const coverageReport = JSON.parse(fs.readFileSync(finalPath, "utf8"));
        await withOperationPublishGuard(() => parseCoverageFilesForSnapshot({ projectId, snapshotId, coverageReport, userId }));
        await withOperationPublishGuard(() => parseCoverageFunctionsForSnapshot({ projectId, snapshotId, coverageReport, userId }));

        await updateJobProgress(jobId, 80);

        // 3. Save results
        const storageResult = await storeCoverageOutputs(snapshotId, projectId, coverageDir);

        await markJobSuccess(jobId, {
            coverage: {
                lines: summaryResult.total.lines.pct,
                branches: summaryResult.total.branches.pct,
                functions: summaryResult.total.functions.pct,
                statements: summaryResult.total.statements.pct,
            },
            supertest: {
                version: supertestInfo.version,
                testFileCount: supertestFiles.length,
                configFile: supertestInfo.configFile,
                exitCode: runResult.exitCode,
            },
            storageBasePath: storageResult.baseStoragePath,
        });

        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'COMPLETE', label: "Supertest coverage pipeline completed.", progress: 100 }));
    } catch (error) {
        if (isJobCanceled(jobId, abortController.signal) || error?.message?.includes("canceled") || error?.message?.includes("cancelled") || error?.statusCode === 409) {
            await addJobLog(jobId, "INFO", "[SUPERTEST] Run Tests canceled by user. Preserving partial execution evidence.").catch(() => {});

            // Safely stage partial evidence without overwriting previous successful run
            try {
                const job = await getJobById(jobId).catch(() => null);
                const snapshotId = job?.snapshotId;
                const rootDir = job?.snapshot?.rootDir;

                if (snapshotId && rootDir) {
                    const coverageDir = path.join(rootDir, "coverage");
                    let scenarios = [];

                    // 1. Try to read partial Jest results if Jest managed to output before abort
                    try {
                        const partialJest = parseJestResults(coverageDir, { rootDir });
                        if (partialJest && Array.isArray(partialJest.scenarios)) {
                            scenarios = partialJest.scenarios;
                        }
                    } catch (_) {}

                    // 2. Read runtime evidence from coverage or temp dir
                    const evidenceCandidates = [
                        path.join(coverageDir, "runtime-evidence.json"),
                        path.join(rootDir, ".covai-temp", "runtime-evidence.json")
                    ];
                    let rawEv = [];
                    let foundEvPath = null;
                    for (const p of evidenceCandidates) {
                        if (fs.existsSync(p)) {
                            try {
                                rawEv = JSON.parse(fs.readFileSync(p, "utf8"));
                                if (Array.isArray(rawEv) && rawEv.length > 0) {
                                    foundEvPath = p;
                                    break;
                                }
                            } catch (_) {}
                        }
                    }

                    // If no Jest scenarios were parsed, but runtime evidence has captured tests:
                    if (scenarios.length === 0 && rawEv.length > 0) {
                        scenarios = rawEv.map(ev => ({
                            title: ev.testTitle || "Executed Scenario",
                            suiteName: "Integration Tests",
                            status: ev.actualStatusFromRuntime ? "passed" : "failed",
                            duration: 0,
                            failureMessages: [],
                            testFile: null
                        }));
                    }

                    // Create a CANCELED TestRun record preserving evidence without fabricating unrun tests
                    const formattedScenarios = formatScenariosForPrisma(scenarios);
                    const passed = scenarios.filter(s => s.status === "passed").length;
                    const failed = scenarios.filter(s => s.status === "failed").length;
                    const skipped = scenarios.filter(s => s.status === "pending" || s.status === "skipped").length;

                    const canceledTestRun = await prisma.testRun.create({
                        data: {
                            snapshotId,
                            type: "SUPERTEST",
                            totalTests: scenarios.length,
                            passedTests: passed,
                            failedTests: failed,
                            skippedTests: skipped,
                            durationMs: 0,
                            status: "CANCELED",
                            startedAt: new Date(),
                            finishedAt: new Date(),
                            ...(formattedScenarios ? { scenarios: formattedScenarios } : {})
                        },
                        include: { scenarios: true }
                    });

                    // Enrich runtime evidence with this canceled TestRun ID
                    if (foundEvPath && rawEv.length > 0) {
                        const scenarioMap = new Map((canceledTestRun.scenarios || []).map(s => [s.title, s]));
                        const enriched = rawEv.map(ev => {
                            const sc = scenarioMap.get(ev.testTitle) || (canceledTestRun.scenarios || []).find(s =>
                                (ev.testTitle && s.title && (ev.testTitle.includes(s.title) || s.title.includes(ev.testTitle)))
                            );
                            return {
                                ...ev,
                                testRunId: canceledTestRun.id,
                                scenarioId: sc?.id || null,
                                runnerVerdict: sc ? (sc.status === 'passed' ? 'PASS' : (sc.status === 'failed' ? 'FAIL' : 'SKIPPED')) : (ev.actualStatusFromRuntime ? 'PASS' : 'UNKNOWN'),
                                statusAssertionResult: sc ? (sc.status === 'passed' ? 'PASS' : (sc.status === 'failed' ? 'FAIL' : 'NOT_EVALUATED')) : (ev.actualStatusFromRuntime ? 'PASS' : 'NOT_EVALUATED')
                            };
                        });
                        fs.writeFileSync(foundEvPath, JSON.stringify(enriched, null, 2), "utf8");
                    }
                }
            } catch (stageErr) {
                console.warn("[SupertestCoverageJob] Error saving partial canceled run evidence:", stageErr.message);
            }
            return;
        }
        console.error(`[SupertestCoverageJob ${jobId}] Error:`, error);
        await markJobFailed(jobId, error).catch(() => { });
    } finally {
        unregisterJobAbortController(jobId);
    }
};
