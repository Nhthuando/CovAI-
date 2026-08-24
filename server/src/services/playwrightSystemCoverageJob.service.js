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
import { parseCoverageSummary } from "./coverageSummaryParser.service.js";
import { storeCoverageOutputs } from "./coverageStorage.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { parsePlaywrightResults } from "./testResultParser.service.js";
import prisma from "../config/prisma.js";
import { runPlaywrightTests, installPlaywrightDeps } from "./playwrightRunner.service.js";

export const processPlaywrightSystemCoverageJob = async (jobId) => {
    try {
        await markJobRunning(jobId);
        const job = await getJobById(jobId);
        if (!job?.snapshot?.rootDir) {
            throw new ServiceError("Snapshot is not ready to run Playwright.", 409);
        }

        const { rootDir } = job.snapshot;
        const snapshotId = job.snapshotId;
        const projectId = job.projectId;
        const userId = job.userId;

        // Note: customData holds testDirectory if any
        const customData = job.payloadJson ? JSON.parse(job.payloadJson) : {};
        const testDirectory = customData.testDirectory || "";

        await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });
        await updateJobProgress(jobId, 5);
        await addJobLog(jobId, "INFO", "[PLAYWRIGHT] Starting Playwright system coverage pipeline...");

        // Ensure coverage directory is clean
        const coverageDir = path.join(rootDir, "coverage");
        if (fs.existsSync(coverageDir)) {
            fs.rmSync(coverageDir, { recursive: true, force: true });
        }

        // 1. Install dependencies
        await updateJobProgress(jobId, 15);
        await installPlaywrightDeps(jobId, rootDir);

        // 2. Execute Playwright tests
        await updateJobProgress(jobId, 30);
        await addJobLog(jobId, "INFO", "[PLAYWRIGHT] Running Playwright tests for coverage...");

        const runResult = await runPlaywrightTests(jobId, rootDir, testDirectory);

        if (runResult.exitCode !== 0 && runResult.exitCode !== 1) {
            console.warn(`[PLAYWRIGHT] Playwright tests returned exit code ${runResult.exitCode}`);
        }

        await updateJobProgress(jobId, 60);
        await addJobLog(jobId, "INFO", "[COVERAGE] Searching for coverage output...");

        // 3. Collect and Parse coverage
        const summaryPath = path.join(coverageDir, "coverage-summary.json");
        const finalPath = path.join(coverageDir, "coverage-final.json");

        if (!fs.existsSync(summaryPath) || !fs.existsSync(finalPath)) {
            throw new ServiceError("Playwright tests completed but no coverage report was generated. Make sure your Playwright project is configured to output Istanbul coverage to the 'coverage' directory.", 422);
        }

        const summaryResult = await parseCoverageSummary(coverageDir, snapshotId);

        // 4. Parse test results
        const playwrightResults = parsePlaywrightResults(rootDir);
        if (playwrightResults) {
            await prisma.testRun.create({
                data: {
                    snapshotId,
                    type: "PLAYWRIGHT",
                    totalTests: playwrightResults.totalTests,
                    passedTests: playwrightResults.passedTests,
                    failedTests: playwrightResults.failedTests,
                    skippedTests: playwrightResults.skippedTests,
                    durationMs: playwrightResults.durationMs,
                    status: playwrightResults.status,
                    startedAt: new Date(),
                    finishedAt: new Date()
                }
            });
            await addJobLog(jobId, "INFO", `[PLAYWRIGHT] Saved TestRun: ${playwrightResults.totalTests} tests.`);
        }

        // 5. Parse details
        const { parseCoverageFilesForSnapshot } = await import("./coverageFileParser.service.js");
        const { parseCoverageFunctionsForSnapshot } = await import("./coverageFunctionParser.service.js");

        const coverageReport = JSON.parse(fs.readFileSync(finalPath, "utf8"));
        await parseCoverageFilesForSnapshot({ projectId, snapshotId, coverageReport, userId });
        await parseCoverageFunctionsForSnapshot({ projectId, snapshotId, coverageReport, userId });

        await updateJobProgress(jobId, 90);

        // 6. Store artifacts
        const storageResult = await storeCoverageOutputs(snapshotId, projectId, coverageDir);

        await markJobSuccess(jobId, {
            coverage: {
                lines: summaryResult.total.lines.pct,
                branches: summaryResult.total.branches.pct,
                functions: summaryResult.total.functions.pct,
                statements: summaryResult.total.statements.pct,
            },
            playwright: {
                totalTests: playwrightResults?.totalTests || 0,
                passedTests: playwrightResults?.passedTests || 0,
                failedTests: playwrightResults?.failedTests || 0,
            },
            storageBasePath: storageResult.baseStoragePath,
            snapshotId
        });

        await addJobLog(jobId, "INFO", "[COVERAGE] Coverage stored for snapshot " + snapshotId);
    } catch (error) {
        console.error(`[PlaywrightSystemCoverageJob ${jobId}] Error:`, error);
        await markJobFailed(jobId, error).catch(() => { });
    }
};