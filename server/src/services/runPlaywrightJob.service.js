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
      throw new Error("Snapshot rootDir không tồn tại");
    }

    await saveJobOutput(jobId, { stdout: "", stderr: "" });
    await updateJobProgress(jobId, 10);
    await addJobLog(jobId, "INFO", "Pipeline PLAYWRIGHT_TESTS bắt đầu.");

    // 1. Cài đặt dependencies
    await updateJobProgress(jobId, 30);
    await installPlaywrightDeps(jobId, rootDir);

    // 2. Chạy test
    await updateJobProgress(jobId, 60);
    await addJobLog(jobId, "INFO", "Bước 2/2: Thực thi Playwright tests...");
    const result = await runPlaywrightTests(jobId, rootDir, testDirectory);

    await updateJobProgress(jobId, 100);

    if (result.success) {
      await markJobSuccess(jobId, { exitCode: result.exitCode });
      await addJobLog(jobId, "INFO", "Playwright tests hoàn thành thành công.");
    } else {
      await markJobFailed(
        jobId,
        new Error(`Playwright tests thất bại với exit code ${result.exitCode}`),
      );
      await addJobLog(
        jobId,
        "ERROR",
        `Playwright tests thất bại. Exit code: ${result.exitCode}`,
      );
    }
  } catch (error) {
    console.error(`[RunPlaywrightJob ${jobId}] Lỗi:`, error);
    await addJobLog(jobId, "ERROR", `Lỗi pipeline: ${error.message}`);
    await markJobFailed(jobId, error);
  }
};
