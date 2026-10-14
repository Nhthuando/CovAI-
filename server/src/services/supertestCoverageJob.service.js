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
import { dockerRunner } from "./dockerRunner.service.js";
import babel from "@babel/core";
import transformCommonJsPlugin from "@babel/plugin-transform-modules-commonjs";
import prisma from "../config/prisma.js";

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
const transformTestCodeForProject = async (code, rootDir) => {
    try {
        let transformedCode = code;

        // Automatically resolve relative app import if pointing to non-existent ../../index when ../../server/index.js exists
        if (
            (transformedCode.includes('"../../index"') || transformedCode.includes("'../../index'") || transformedCode.includes('"../../index.js"') || transformedCode.includes("'../../index.js'")) &&
            !fs.existsSync(path.join(rootDir, "index.js")) &&
            fs.existsSync(path.join(rootDir, "server", "index.js"))
        ) {
            transformedCode = transformedCode.replace(/(['"])\.\.\/\.\.\/index(\.js)?(['"])/g, '$1../../server/index.js$3');
        }

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
        console.warn("[SupertestCoverageJob] Babel transform fallback:", err.message);
    }
    return code;
};

/**
 * Pipeline cho Supertest Coverage:
 * 1. Run Supertest (runSupertest)
 * 2. Parse coverage (reuse existing parsers)
 * 3. Save results to DB & Firebase
 */
export const processSupertestCoverageJob = async (jobId) => {
    try {
        await markJobRunning(jobId);
        const job = await getJobById(jobId);
        if (!job?.snapshot?.rootDir) {
            throw new ServiceError("Snapshot is not ready to run Supertest.", 409);
        }
        const { rootDir, jestConfigPath } = job.snapshot;
        const snapshotId = job.snapshotId;
        const projectId = job.projectId;
        const userId = job.userId;

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
            if (meta.framework !== "SUPERTEST" || meta.status !== "APPROVED") continue;
            
            const filePath = path.join(rootDir, t.filePath);
            
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
                    const isApproved = approvedScenarios.has(r.scenarioId) || approvedScenarios.has(r.testName);
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
            const executableCode = await transformTestCodeForProject(finalCode, rootDir);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, executableCode, 'utf8');
            supertestFiles.push(filePath);
        }

        if (supertestFiles.length === 0) {
            throw new ServiceError("No valid AI-generated Supertest files were found in this snapshot.", 422);
        }

        await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });
        await updateJobProgress(jobId, 10);
        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'PREPARE_ENV', label: "Starting Supertest coverage pipeline...", progress: 10 }));

        // Ensure dependencies exist (e.g. server/node_modules) before starting test suite
        await ensureProjectDependencies(jobId, rootDir);

        // 1. Run Supertest
        await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'RUN_JEST', label: "Running Supertest test suite...", progress: 20 }));
        const runResult = await runSupertest(
            jobId,
            rootDir,
            jestConfigPath ?? supertestInfo.configPath,
            supertestFiles,
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
        const summaryResult = await parseCoverageSummary(coverageDir, snapshotId);

        // Parse test results
        const supertestResults = parseJestResults(coverageDir);
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
                startedAt: new Date(), // TODO: Get actual start time
                finishedAt: new Date() // TODO: Get actual finish time
            };
            if (formattedScenarios) {
                dataPayload.scenarios = formattedScenarios;
            }
            const createdTestRun = await prisma.testRun.create({
                data: dataPayload,
                include: { scenarios: true }
            });
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
        await parseCoverageFilesForSnapshot({ projectId, snapshotId, coverageReport, userId });
        await parseCoverageFunctionsForSnapshot({ projectId, snapshotId, coverageReport, userId });

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
        console.error(`[SupertestCoverageJob ${jobId}] Error:`, error);
        await markJobFailed(jobId, error).catch(() => { });
    }
};
