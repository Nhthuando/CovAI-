import {
    markJobRunning,
    markJobSuccess,
    markJobFailed,
    getJobById,
    addJobLog,
    updateJobProgress,
} from "./job.service.js";
import { saveJobOutput } from "./jobOutput.service.js";
import {
    installVitestDeps,
    runVitestTests,
} from "./vitestRunner.service.js";
import prisma from "../config/prisma.js";

/**
 * Orchestrator for Vitest Test Pipeline
 */
export const processRunVitestJob = async (jobId) => {
    try {
        // Move the job to running status
        await markJobRunning(jobId);

        const job = await getJobById(jobId);
        const { rootDir } = job.snapshot;

        // Read vitestCommand from project 
        const project = await prisma.project.findUnique({
            where: { id: job.projectId }
        });
        const vitestCommand = project?.vitestCommand;

        if (!rootDir) {
            throw new Error("Snapshot rootDir not exist");
        }

        await saveJobOutput(jobId, { stdout: "", stderr: "" });
        await updateJobProgress(jobId, 10);
        await addJobLog(jobId, "INFO", "Pipline RUN_VITEST_TEST started.");

        // 1. Install dependencies
        await updateJobProgress(jobId, 30);
        await installVitestDeps(jobId, rootDir);

        // 2. Run test
        await updateJobProgress(jobId, 60);
        await addJobLog(jobId, "INFO", "Steps 2/2: Executed Vitest tests...");
        const result = await runVitestTests(jobId, rootDir, vitestCommand);

        await updateJobProgress(jobId, 100);

        // 3. Evaluate result
        if (result.success) {
            await markJobSuccess(jobId, { exitCode: result.exitCode });
            await addJobLog(jobId, "INFO", "Vitest tests complete successfully.");
        } else {
            await markJobFailed(
                jobId,
                new Error(`Vitest tests failed with exit code ${result.exitCode}`)
            );
            await addJobLog(
                jobId,
                "ERROR",
                `Vitest tests failed. Exit code: ${result.exitCode}`
            );
        }
    } catch (error) {
        console.error(`[RunVitestJob ${jobId}] Error:`, error);
        await addJobLog(jobId, "ERROR", `Error pipline ${error.message}`);
        await markJobFailed(jobId, error);
    }
};