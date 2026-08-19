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
import { detectCypressMetadata as detectCypress } from "./cypressDetection.service.js";
import { parseCypressResults } from "./testResultParser.service.js";
import prisma from "../config/prisma.js";
import { dockerRunner } from "./dockerRunner.service.js";

export const processCypressSystemCoverageJob = async (jobId) => {
    try {
        await markJobRunning(jobId);
        const job = await getJobById(jobId);
        if (!job?.snapshot?.rootDir) {
            throw new ServiceError("Snapshot is not ready to run Cypress.", 409);
        }
        const { rootDir } = job.snapshot;
        const snapshotId = job.snapshotId;
        const projectId = job.projectId;
        const userId = job.userId;

        const cypressInfo = await detectCypress(rootDir);
        if (!cypressInfo.detected) {
            throw new ServiceError("No Cypress configuration found in this snapshot.", 422);
        }

        await saveJobOutput(jobId, { stdout: "", stderr: "" }).catch(() => { });
        await updateJobProgress(jobId, 10);
        await addJobLog(jobId, "INFO", "[CYPRESS] Starting Cypress system coverage pipeline...");

        // 1. Execute Cypress with coverage
        // Note: This assumes the project is already instrumented or we need to inject instrumentation.
        // For now, we follow the existing pattern of running via dockerRunner.
        const resultsPath = path.join(rootDir, "cypress-results.json");
        const coverageDir = path.join(rootDir, "coverage");

        // Ensure coverage directory is clean
        if (fs.existsSync(coverageDir)) {
            fs.rmSync(coverageDir, { recursive: true, force: true });
        }

        const cypressCmd = `npx --no-install cypress run --browser chrome --headless --reporter json --reporter-options outputFile=${resultsPath}`;

        await updateJobProgress(jobId, 20);
        await addJobLog(jobId, "INFO", "[CYPRESS] Running Cypress tests...");

        const runResult = await dockerRunner.run({
            snapshotPath: rootDir,
            command: cypressCmd,
            jobId
        });

        await saveJobOutput(jobId, {
            stdout: runResult.stdout ?? "",
            stderr: runResult.stderr ?? "",
        }).catch(() => { });

        if (runResult.exitCode !== 0) {
            throw new ServiceError(`Cypress execution failed with exit code ${runResult.exitCode}`, 500);
        }

        await updateJobProgress(jobId, 60);
        await addJobLog(jobId, "INFO", "[COVERAGE] Searching for coverage output...");

        // 2. Collect and Parse coverage
        const summaryPath = path.join(coverageDir, "coverage-summary.json");
        const finalPath = path.join(coverageDir, "coverage-final.json");

        if (!fs.existsSync(summaryPath) || !fs.existsSync(finalPath)) {
            throw new ServiceError("Cypress tests completed but no coverage report was generated.", 422);
        }

        const summaryResult = await parseCoverageSummary(coverageDir, snapshotId);

        // 3. Parse test results
        const cypressResults = parseCypressResults(rootDir);
        if (cypressResults) {
            await prisma.testRun.create({
                data: {
                    snapshotId,
                    type: "CYPRESS",
                    totalTests: cypressResults.totalTests,
                    passedTests: cypressResults.passedTests,
                    failedTests: cypressResults.failedTests,
                    skippedTests: cypressResults.skippedTests,
                    durationMs: cypressResults.durationMs,
                    status: cypressResults.status,
                    startedAt: new Date(),
                    finishedAt: new Date()
                }
            });
            await addJobLog(jobId, "INFO", `[CYPRESS] Saved TestRun: ${cypressResults.totalTests} tests.`);
        }

        // 4. Parse details
        const { parseCoverageFilesForSnapshot } = await import("./coverageFileParser.service.js");
        const { parseCoverageFunctionsForSnapshot } = await import("./coverageFunctionParser.service.js");

        const coverageReport = JSON.parse(fs.readFileSync(finalPath, "utf8"));
        await parseCoverageFilesForSnapshot({ projectId, snapshotId, coverageReport, userId });
        await parseCoverageFunctionsForSnapshot({ projectId, snapshotId, coverageReport, userId });

        await updateJobProgress(jobId, 90);

        // 5. Store artifacts
        const storageResult = await storeCoverageOutputs(snapshotId, projectId, coverageDir);

        await markJobSuccess(jobId, {
            coverage: {
                lines: summaryResult.total.lines.pct,
                branches: summaryResult.total.branches.pct,
                functions: summaryResult.total.functions.pct,
                statements: summaryResult.total.statements.pct,
            },
            cypress: {
                testFileCount: cypressInfo.cypressFiles?.length || 0,
                totalTests: cypressResults?.totalTests || 0,
                passedTests: cypressResults?.passedTests || 0,
                failedTests: cypressResults?.failedTests || 0,
            },
            storageBasePath: storageResult.baseStoragePath,
            snapshotId
        });

        await addJobLog(jobId, "INFO", "[COVERAGE] Coverage stored for snapshot " + snapshotId);
    } catch (error) {
        console.error(`[CypressSystemCoverageJob ${jobId}] Error:`, error);
        await markJobFailed(jobId, error).catch(() => { });
    }
};