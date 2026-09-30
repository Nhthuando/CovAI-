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
  installPlaywrightDeps,
  runPlaywrightTests,
} from "./playwrightRunner.service.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * Orchestrator cho Playwright Integration Test Pipeline
 */
export const processRunPlaywrightJob = async (jobId) => {
  try {
    await markJobRunning(jobId);

    const job = await getJobById(jobId);
    const { rootDir } = job.snapshot;
    const { testDirectory } = job.metadata || {};

    if (!rootDir) {
      throw new Error("Snapshot rootDir does not exist");
    }

    await saveJobOutput(jobId, { stdout: "", stderr: "" });
    await updateJobProgress(jobId, 10);
    await addJobLog(jobId, "INFO", "PLAYWRIGHT_TESTS pipeline started.");

    // 1. Install dependencies
    await updateJobProgress(jobId, 30);
    await installPlaywrightDeps(jobId, rootDir);

    // 2. Run tests
    await updateJobProgress(jobId, 60);
    await addJobLog(jobId, "INFO", "Step 2/2: Executing Playwright tests...");
    const result = await runPlaywrightTests(jobId, rootDir, testDirectory);

    await updateJobProgress(jobId, 100);

    if (result.success) {
      await markJobSuccess(jobId, { exitCode: result.exitCode });
      await addJobLog(jobId, "INFO", "Playwright tests completed successfully.");
    } else {
      await markJobFailed(
        jobId,
        new Error(`Playwright tests failed with exit code ${result.exitCode}`),
      );
      await addJobLog(
        jobId,
        "ERROR",
        `Playwright tests failed. Exit code: ${result.exitCode}`,
      );
    }
  } catch (error) {
    console.error(`[RunPlaywrightJob ${jobId}] Error:`, error);
    await addJobLog(jobId, "ERROR", `Pipeline error: ${error.message}`);
    await markJobFailed(jobId, error);
  }
};
