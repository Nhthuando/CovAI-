import { buildCfgForSnapshot } from "./buildCfg.service.js";
import {
  markJobRunning,
  markJobSuccess,
  markJobFailed,
  createPerformanceAnalysisJob,
} from "./job.service.js";

export async function processBuildCfgJob(job) {
  // If job is just an ID (string), we treat it as an object for compatibility
  const jobObj = typeof job === "string" ? { id: job } : job;

  if (!jobObj || !jobObj.id) {
    console.error("Invalid job object passed to processBuildCfgJob:", job);
    return;
  }

  const jobId = jobObj.id;

  // Debug log to inspect the object received
  console.log("Processing job:", JSON.stringify(jobObj, null, 2));

  // If snapshotId is missing, try to parse it from payloadJson if it exists
  let snapshotId = jobObj.snapshotId;
  if (!snapshotId && jobObj.payloadJson) {
    try {
      const payload =
        typeof jobObj.payloadJson === "string"
          ? JSON.parse(jobObj.payloadJson)
          : jobObj.payloadJson;
      snapshotId = payload.snapshotId;
    } catch (e) {
      console.error("Failed to parse payloadJson for job", jobId, e);
    }
  }

  // Fallback: If still missing, attempt to fetch fresh from DB
  if (!snapshotId) {
    const jobFromDb = await import("./job.service.js")
      .then((s) => s.getJobById?.(jobId))
      .catch(() => null);
    if (jobFromDb?.snapshotId) {
      snapshotId = jobFromDb.snapshotId;
    } else if (jobFromDb?.payloadJson) {
      const payload =
        typeof jobFromDb.payloadJson === "string"
          ? JSON.parse(jobFromDb.payloadJson)
          : jobFromDb.payloadJson;
      snapshotId = payload.snapshotId;
    }
  }

  if (!snapshotId) {
    throw new Error(`Missing snapshotId for job ${jobId}`);
  }

  try {
    try {
      await markJobRunning(jobId);
    } catch (error) {
      if (
          error.message === "Job not found" ||
          error.message === "Only queued jobs can start" ||
          error.message === "Cannot start a canceled job"
      ) {
          console.log(`[BuildCfgJob ${jobId}] Bỏ qua vì Job không tồn tại hoặc không thể bắt đầu.`);
          return;
      }
      throw error;
    }

    const result = await buildCfgForSnapshot(snapshotId);
    await markJobSuccess(jobId, result);

    const performanceJob = await createPerformanceAnalysisJob({
      projectId: jobObj.projectId,
      snapshotId,
      userId: jobObj.userId,
    });
    const { addJobToQueue } = await import("./queue.service.js");
    await addJobToQueue("PERFORMANCE_ANALYSIS", performanceJob.id);
    console.log(`[BuildCfgJob ${jobId}] Queued PERFORMANCE_ANALYSIS job ${performanceJob.id}.`);
  } catch (error) {
    console.error(`Error processing job ${jobId}:`, error);
    // Only mark failed if we know it's a valid job
    await markJobFailed(jobId, error).catch((e) =>
      console.error("Failed to mark job as failed:", e),
    );
  }
}
