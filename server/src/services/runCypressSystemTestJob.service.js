import {
    markJobRunning,
    markJobSuccess,
    markJobFailed,
    updateJobProgress,
    getJobById,
    addJobLog,
} from "./job.service.js";
import { saveJobOutput } from "./jobOutput.service.js";
import { runCypressSystemTest } from "./cypressSystemTestRunner.service.js";
import { parseCypressResults, formatScenariosForPrisma } from "./testResultParser.service.js";
import prisma from "../config/prisma.js";

export const processCypressSystemTestJob = async (jobId) => {
    try {
        await markJobRunning(jobId);
        const job = await getJobById(jobId);
        const rootDir = job.snapshot.rootDir;
        const snapshotId = job.snapshotId;

        await saveJobOutput(jobId, { stdout: "", stderr: "" });
        await updateJobProgress(jobId, 10);
        await addJobLog(jobId, "INFO", "Cypress system test pipeline started.");

        const result = await runCypressSystemTest(jobId, rootDir);

        // Parse results
        const cypressResults = parseCypressResults(rootDir);
        if (cypressResults) {
            const { scenarios, ...testRunData } = cypressResults;
            const formattedScenarios = formatScenariosForPrisma(scenarios);
            const dataPayload = {
                snapshotId,
                type: "CYPRESS",
                totalTests: cypressResults.totalTests || 0,
                passedTests: cypressResults.passedTests || 0,
                failedTests: cypressResults.failedTests || 0,
                skippedTests: cypressResults.skippedTests || 0,
                durationMs: cypressResults.durationMs || 0,
                status: cypressResults.status || "PASSED",
                startedAt: new Date(),
                finishedAt: new Date()
            };
            if (formattedScenarios) {
                dataPayload.scenarios = formattedScenarios;
            }
            await prisma.testRun.create({ data: dataPayload });
            await addJobLog(jobId, "INFO", `[CYPRESS] Saved TestRun: ${cypressResults.totalTests} tests.`);
        }

        await updateJobProgress(jobId, 100);
        await markJobSuccess(jobId, result);

        await addJobLog(jobId, "INFO", "Cypress system test pipeline completed successfully.");
    } catch (error) {
        await addJobLog(jobId, "ERROR", `Cypress system test pipeline failed: ${error.message}`);
        await markJobFailed(jobId, error);
    }
};