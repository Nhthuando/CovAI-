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
            const errDetail = (runResult.stderr || runResult.stdout || "").trim();
            const detailSnippet = errDetail ? ` (${errDetail.split("\n").slice(0, 3).join(" ")})` : "";
            throw new ServiceError(`Vitest completed without producing the required coverage JSON files. Missing @vitest/coverage-v8 or configuration error.${detailSnippet}`, 422);
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
                    failedTests: vitestResults.failedTests,
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
        let storageResult = {};
        try {
            storageResult = await storeCoverageOutputs(snapshotId, projectId, coverageDir);
            await addJobLog(
                jobId,
                "INFO",
                `[VitestCoverage] Uploaded coverage files: ${storageResult.baseStoragePath}`
            ).catch(() => { });
        } catch (storageErr) {
            await addJobLog(
                jobId,
                "WARN",
                `[VitestCoverage] Could not upload coverage files: ${storageErr.message}`
            ).catch(() => { });
        }

        // 7. Complete Job
        await markJobSuccess(jobId, {
            coverage: {
                lines: summaryResult.total.lines.pct,
                branches: summaryResult.total.branches.pct,
                functions: summaryResult.total.functions.pct,
                statements: summaryResult.total.statements.pct,
            },
            storageBasePath: storageResult.baseStoragePath ?? null,
        });

        await addJobLog(jobId, "INFO", "Vitest coverage pipline completed successfully.");

        // Chain to BUILD_CFG
        try {
            const { default: prisma } = await import("../config/prisma.js");
            const buildCfgJob = await prisma.job.findFirst({
                where: { snapshotId, type: "BUILD_CFG", status: "QUEUED" },
                orderBy: { createdAt: "desc" }
            });
            if (buildCfgJob) {
                const { addJobToQueue } = await import("./queue.service.js");
                await addJobToQueue("BUILD_CFG", buildCfgJob.id);
                console.log(`[VitestCoverageJob ${jobId}] Auto-triggered BUILD_CFG job: ${buildCfgJob.id}`);
            }
        } catch (chainErr) {
            console.error(`[VitestCoverageJob ${jobId}] Error triggering BUILD_CFG:`, chainErr);
        }
    } catch (error) {
        console.error(`[VitestCoverageJob ${jobId}] Error:`, error);
        await markJobFailed(jobId, error).catch(() => { });
    }
};
