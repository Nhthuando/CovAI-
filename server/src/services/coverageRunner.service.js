import { spawn } from "child_process";
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
import { appendJobOutput, saveJobOutput } from "./jobOutput.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { storeCoverageOutputs } from "./coverageStorage.service.js";
import { parseCoverageSummary } from "./coverageSummaryParser.service.js";
import { detectTestingFrameworks } from "../utils/testingFrameworkDetector.js";
import { terminateProcessTree, trackProcessTree } from "./processTree.service.js";

const RUN_TESTS_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};



/**
 * RUN_TESTS pipeline — SCRUM-107..SCRUM-112:
 *  1. markJobRunning
 *  2. spawn jest --coverage with reporters json-summary, json, lcov
 *  3. Capture stdout/stderr (SCRUM-111)
 *  4. Timeout 5 minutes (SCRUM-112)
 *  5. Parse coverage-summary.json → DB (SCRUM-108)
 *  6. Parse coverage-final.json → DB (SCRUM-109)
 *  7. Verify lcov.info (SCRUM-110)
 *  8. markJobSuccess
 */
export const processCoverageJob = async (jobId) => {
    assertStringField(jobId, "jobId");

    // ── Transition to RUNNING ──────────────────────────────────────────────
    try {
        await markJobRunning(jobId);
    } catch (error) {
        if (
            error.message === "Job not found" ||
            error.message === "Only queued jobs can start" ||
            error.message === "Cannot start a canceled job"
        ) {
            console.log(`[CoverageRunner ${jobId}] Skipped: ${error.message}`);
            return;
        }
        console.error(`[CoverageRunner ${jobId}] Error transitioning to RUNNING:`, error);
        return;
    }

    // ── Fetch Job + Snapshot info ────────────────────────────────────────
    let job;
    try {
        job = await getJobById(jobId);
    } catch (error) {
        console.error(`[CoverageRunner ${jobId}] Unable to fetch Job:`, error);
        return;
    }

    if (!job.snapshot?.rootDir) {
        const msg = "Snapshot does not have rootDir — INGEST job pending.";
        console.error(`[CoverageRunner ${jobId}] ${msg}`);
        await markJobFailed(jobId, new Error(msg));
        return;
    }

    const rootDir = job.snapshot.rootDir;
    const snapshotId = job.snapshotId;
    const coverageDir = path.join(rootDir, "coverage");

    // Initialize output
    await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });
    await updateJobProgress(jobId, 10);

    // Detect framework
    let primaryFramework = null;
    try {
        const detection = detectTestingFrameworks(rootDir);
        primaryFramework = detection?.primaryFramework || null;
    } catch (detectErr) {
        console.warn(`[CoverageRunner ${jobId}] Framework detection warning:`, detectErr.message);
    }
    const isVitest = job.type === "VITEST_COVERAGE" || primaryFramework === "vitest" || (Boolean(job.snapshot?.vitestCommand) && !job.snapshot?.jestCommand);
    const runnerName = isVitest ? "vitest" : "jest";

    await addJobLog(jobId, "INFO", `Starting ${runnerName} --coverage at: ${rootDir}`);

    let runnerArgs = [];
    if (isVitest) {
        runnerArgs = [
            "run",
            "--coverage",
            "--coverage.enabled=true",
            "--coverage.reporter=json-summary",
            "--coverage.reporter=json",
            "--coverage.reporter=lcov",
            "--coverage.reportOnFailure=true",
            "--reporter=default",
            "--reporter=json",
            `--outputFile=${path.join(coverageDir, "vitest-results.json").replace(/\\/g, "/")}`,
            "--passWithNoTests",
            "--testTimeout=30000",
        ];
        if (job.snapshot?.vitestConfigPath) {
            runnerArgs.push(`--config=${job.snapshot.vitestConfigPath}`);
        }
    } else {
        runnerArgs = [
            "--coverage",
            "--coverageReporters=json-summary",
            "--coverageReporters=json",
            "--coverageReporters=lcov",
            "--forceExit",
            "--testTimeout=30000",
        ];
        if (job.snapshot?.jestConfigPath) {
            runnerArgs.push(`--config=${job.snapshot.jestConfigPath}`);
        }

        // Pre-flight setup files and options injection (SCRUM / M2)
        const setupFileCandidates = [
            job.snapshot?.setupFilePath,
            job.snapshot?.jestSetupPath,
            path.join(rootDir, "covai-jest-setup.cjs"),
            path.join(rootDir, ".covai-temp", "covai.supertest.setup.js"),
            path.join(rootDir, "src", "tests", "helpers", "databaseSafetySetup.js")
        ];

        let primarySetup = null;
        for (const candidate of setupFileCandidates) {
            if (candidate && fs.existsSync(candidate)) {
                primarySetup = path.isAbsolute(candidate)
                    ? (candidate.startsWith(rootDir) ? `./${path.relative(rootDir, candidate).replace(/\\/g, "/")}` : candidate)
                    : candidate;
                break;
            }
        }

        if (primarySetup) {
            runnerArgs.push(`--setupFiles=${primarySetup}`);
        }

        if (job.snapshot?.setupFiles) {
            const extraSetups = Array.isArray(job.snapshot.setupFiles) ? job.snapshot.setupFiles : [job.snapshot.setupFiles];
            for (const setup of extraSetups) {
                if (setup && typeof setup === "string") {
                    runnerArgs.push(`--setupFiles=${setup.replace(/\\/g, "/")}`);
                }
            }
        }

        const afterEnvCandidate = path.join(rootDir, "covai-jest-setup-after-env.cjs");
        if (job.snapshot?.setupFilesAfterEnv) {
            const extraAfterEnv = Array.isArray(job.snapshot.setupFilesAfterEnv) ? job.snapshot.setupFilesAfterEnv : [job.snapshot.setupFilesAfterEnv];
            for (const setup of extraAfterEnv) {
                if (setup && typeof setup === "string") {
                    runnerArgs.push(`--setupFilesAfterEnv=${setup.replace(/\\/g, "/")}`);
                }
            }
        } else if (fs.existsSync(afterEnvCandidate)) {
            runnerArgs.push(`--setupFilesAfterEnv=./covai-jest-setup-after-env.cjs`);
        }
    }

    return new Promise((resolve) => {
        let timedOut = false;

        const child = spawn("npx", [runnerName, ...runnerArgs], {
            cwd: rootDir,
            shell: true,
            env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
        });

        trackProcessTree(child);

        // Timeout handler
        const timer = setTimeout(async () => {
            timedOut = true;
            try {
                terminateProcessTree(child);
            } catch (_) {
                try { child.kill("SIGKILL"); } catch { }
            }
            const msg = `${runnerName} --coverage exceeded timeout ${RUN_TESTS_TIMEOUT_MS / 1000}s`;
            console.error(`[CoverageRunner ${jobId}] ${msg}`);
            await addJobLog(jobId, "ERROR", msg);
            await markJobFailed(jobId, new Error(msg)).catch(() => { });
            resolve();
        }, RUN_TESTS_TIMEOUT_MS);

        // Capture stdout line-by-line
        child.stdout.on("data", async (chunk) => {
            const text = chunk.toString();
            process.stdout.write(`[${runnerName} ${jobId}] ${text}`);
            await appendJobOutput(jobId, { stdout: text }).catch(() => { });
        });

        // Capture stderr
        child.stderr.on("data", async (chunk) => {
            const text = chunk.toString();
            process.stderr.write(`[${runnerName} ${jobId}] ${text}`);
            await appendJobOutput(jobId, { stderr: text }).catch(() => { });
        });

        // When runner exits
        child.on("close", async (code) => {
            clearTimeout(timer);
            if (timedOut) return;

            // Runner exits with code 1 when tests fail, but coverage is still generated.
            // Only treat as an error if exit code >= 2 (configuration/execution error)
            if (code !== null && code >= 2) {
                const msg = `${runnerName} exited with code ${code} (fatal error)`;
                await addJobLog(jobId, "ERROR", msg);
                await markJobFailed(jobId, new Error(msg));
                console.error(`[CoverageRunner ${jobId}] ${msg}`);
                return resolve();
            }

            await updateJobProgress(jobId, 70);
            await addJobLog(jobId, "INFO", `${runnerName} finished (exit ${code}), parsing coverage...`);

            try {
                // SCRUM-85: Parse coverage-summary.json → DB (lines/branches/functions/statements)
                const { total, fileCount } = await parseCoverageSummary(coverageDir, snapshotId);
                await addJobLog(jobId, "INFO",
                    `Coverage parsed: lines=${total.lines.pct}%, branches=${total.branches.pct}%, ` +
                    `functions=${total.functions.pct}%, statements=${total.statements.pct}% | files=${fileCount}`
                );

                // Verify lcov.info
                const lcovPath = path.join(coverageDir, "lcov.info");
                const hasLcov = fs.existsSync(lcovPath);
                await addJobLog(jobId, "INFO", `lcov.info: ${hasLcov ? "found" : "not found"}`);

                await updateJobProgress(jobId, 85);

                // SCRUM-84: Upload coverage files to Firebase Storage
                let storageResult = {};
                try {
                    storageResult = await storeCoverageOutputs(
                        snapshotId,
                        job.projectId,
                        coverageDir
                    );
                    await addJobLog(jobId, "INFO", `Uploaded coverage files to Firebase: ${storageResult.baseStoragePath}`);
                } catch (storageErr) {
                    console.warn(`[CoverageRunner ${jobId}] Warning: unable to upload coverage files:`, storageErr.message);
                    await addJobLog(jobId, "WARN", `Unable to upload coverage files: ${storageErr.message}`);
                }

                await updateJobProgress(jobId, 95);

                await markJobSuccess(jobId, {
                    jestExitCode: code,
                    exitCode: code,
                    runner: runnerName,
                    coverage: {
                        lines: total.lines.pct,
                        branches: total.branches.pct,
                        functions: total.functions.pct,
                        statements: total.statements.pct,
                    },
                    fileCount,
                    hasLcov,
                    storageBasePath: storageResult.baseStoragePath ?? null,
                });

                console.log(`[CoverageRunner ${jobId}] Pipeline completed successfully.`);

            } catch (parseError) {
                console.error(`[CoverageRunner ${jobId}] Coverage parsing error:`, parseError);
                await addJobLog(jobId, "ERROR", `Coverage parsing error: ${parseError.message}`);
                await markJobFailed(jobId, parseError).catch(() => { });
            }

            resolve();
        });

        child.on("error", async (err) => {
            clearTimeout(timer);
            if (timedOut) return;
            console.error(`[CoverageRunner ${jobId}] Process error:`, err);
            await addJobLog(jobId, "ERROR", `Process error: ${err.message}`);
            await markJobFailed(jobId, err).catch(() => { });
            resolve();
        });
    });
};
