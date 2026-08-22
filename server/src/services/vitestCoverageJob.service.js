import fs from "fs";
import path, { parse } from "path";
import prisma from "../config/prisma.js";
import {
    markJobRunning,
    markJobSuccess,
    markJobFailed,
    updateJobProgress,
    getJobById,
    addJobLog,
} from "./job.service.js";;
import { saveJobOutput } from "./jobOutput.service.js";
import { runVitestCoverage } from "./vitestRunner.service.js";
import { parseCoverageSummary } from "./coverageSummaryParser.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { storeCoverageOutputs } from "./coverageStorage.service.js";
import { parseVitestResults } from "./testResultParser.service.js";

/**
 * Pipline for Vitest Coverage
 * 1. Run Vitest with coverage flag (runVitestCoverage)
 * 2. Parse Coverage (reuse existing Istanbul parsers)
 * 3. Parse test results (Vitest JSON format)
 * 4. Save results to DB & Firebase
 */
export const processVitestCoverageJob = async (jobId) => {
    try {
        await markJobRunning(jobId);
        const job = await getJobById(jobId);
        if (!job?.snapshot?.rootDir) {
            throw new ServiceError("Snapshot is not ready to run Vitest.", 409);
        }

        const { rootDir } = job.snapshot;
        const snapshotId = job.snapshotId;
        const projectId = job.projectId;
        const userId = job.userId;

        await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });
        await updateJobProgress(jobId, 10);
        await addJobLog(jobId, "INFO", "Start Vitest coverage pipline...");

        // 1. Run Vitest
        const runResult = await runVitestCoverage(
            jobId,
            rootDir,
            null // Can pass custom vitest command here if needed
        );

        await saveJobOutput(jobId, {
            stdout: runResult.stdout ?? "",
            stderr: runResult.stderr ?? "",
        }).catch(() => { });

        const { coverageDir } = runResult;
        await updateJobProgress(jobId, 50);

        // 2. Ensure coverage files are generated
        const summaryPath = path.join(coverageDir, "coverage-summary.json");
        const finalPath = path.join(coverageDir, "coverage-final.json");

        console.log("=== VITEST STDOUT ===", runResult.stdout);
        console.log("=== VITEST STDERR ===", runResult.stderr);

        if (!fs.existsSync(summaryPath) || !fs.existsSync(finalPath)) {
            throw new ServiceError("Vitest completed without producing the required coverage JSON files. Missing @vitest/coverage-v8 or configuration error", 422);
        }

        // 3. Parse global coverage summary
        const summaryResult = await parseCoverageSummary(coverageDir, snapshotId);

        // 4. Parse test results
        const vitestResults = parseVitestResults(coverageDir);
        if (vitestResults) {
            await prisma.testRun.create({
                data: {
                    snapshotId,
                    type: "VITEST",
                    totalTests: vitestResults.totalTests,
                    passedTests: vitestResults.passedTests,
                    failedTest: vitestResults.failedTests,
                    skippedTests: vitestResults.skippedTests,
                    durationMs: vitestResults.durationMs,
                    status: vitestResults.status, // PASSED or FAILED
                    startedAt: new Date(),
                    finishedAt: new Date()
                }
            });
            await addJobLog(jobId, "INFO", `Saved TestRun (VITEST): ${vitestResults.totalTests} tests.`).catch(() => { });
        }

        // 5. Parse detailed file & function coverage (Reuse models)
        const { parseCoverageFilesForSnapshot } = await import("./coverageFileParser.service.js");
        const { parseCoverageFunctionsForSnapshot } = await import("./coverageFunctionParser.service.js");

        const coverageReport = JSON.parse(fs.readFileSync(finalPath, "utf8"));
        await parseCoverageFilesForSnapshot({ projectId, snapshotId, coverageReport, userId });
        await parseCoverageFunctionsForSnapshot({ projectId, snapshotId, coverageReport, userId });

        await updateJobProgress(jobId, 80);

        // 6. Save results to Firebase Storage
        const storageResult = await storeCoverageOutputs(snapshotId, projectId, coverageDir);

        // 7. Complete Job
        await markJobSuccess(jobId, {
            coverage: {
                lines: summaryResult.total.lines.pct,
                branches: summaryResult.total.branches.pct,
                functions: summaryResult.total.functions.pct,
                statements: summaryResult.total.statements.pct,
            },
            storageBasePath: storageResult.baseStoragePath,
        });

        await addJobLog(jobId, "INFO", "Vitest coverage pipline completed successfully.");
    } catch (error) {
        console.error(`[VitestCoverageJob ${jobId}] Error:`, error);
        await markJobFailed(jobId, error).catch(() => { });
    }
};