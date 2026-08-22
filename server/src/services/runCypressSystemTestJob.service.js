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
import { parseCypressResults } from "./testResultParser.service.js";
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
            await prisma.testRun.create({
                data: {
                    snapshotId,
                    type: "CYPRESS",
                    ...cypressResults,
                    startedAt: new Date(),
                    finishedAt: new Date()
                }
            });
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