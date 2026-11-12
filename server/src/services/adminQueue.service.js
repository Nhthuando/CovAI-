import { jobQueue, QUEUE_NAME } from "./queue.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { recordAudit } from "./adminAudit.service.js";

const DEFAULT_TIMEOUT_MS = 2500;

/**
 * Helper to race any BullMQ promise against a timeout
 */
function withTimeout(promise, ms = DEFAULT_TIMEOUT_MS, operationName = "Queue operation") {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${operationName} timed out after ${ms}ms (Redis may be offline)`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Service for BullMQ Worker and Queue Orchestration
 */
export class AdminQueueService {
  /**
   * Get overall queues status, job counts, and recent failed jobs
   */
  async getQueuesStatus() {
    try {
      const countsPromise = jobQueue.getJobCounts(
        "active",
        "completed",
        "failed",
        "delayed",
        "waiting",
        "paused"
      );
      const isPausedPromise = jobQueue.isPaused();
      const failedJobsPromise = jobQueue.getFailed(0, 15);

      const [counts, isPaused, failedJobs] = await withTimeout(
        Promise.all([countsPromise, isPausedPromise, failedJobsPromise]),
        DEFAULT_TIMEOUT_MS,
        "Fetch queue status"
      );

      const formattedFailed = (failedJobs || []).map((j) => ({
        id: j.id,
        name: j.name,
        attemptsMade: j.attemptsMade,
        failedReason: j.failedReason,
        timestamp: j.timestamp,
        processedOn: j.processedOn,
        finishedOn: j.finishedOn,
        data: j.data ? { type: j.data.type, jobId: j.data.jobId, projectId: j.data.projectId } : null,
      }));

      return {
        queues: [
          {
            name: QUEUE_NAME,
            status: "ONLINE",
            isPaused,
            counts: {
              active: counts?.active || 0,
              waiting: counts?.waiting || 0,
              completed: counts?.completed || 0,
              failed: counts?.failed || 0,
              delayed: counts?.delayed || 0,
              paused: counts?.paused || 0,
              total:
                (counts?.active || 0) +
                (counts?.waiting || 0) +
                (counts?.completed || 0) +
                (counts?.failed || 0) +
                (counts?.delayed || 0),
            },
            recentFailed: formattedFailed,
          },
        ],
      };
    } catch (err) {
      console.warn("[AdminQueueService.getQueuesStatus Error]:", err.message);
      return {
        queues: [
          {
            name: QUEUE_NAME,
            status: "OFFLINE",
            isPaused: false,
            error: err.message,
            counts: { active: 0, waiting: 0, completed: 0, failed: 0, delayed: 0, paused: 0, total: 0 },
            recentFailed: [],
          },
        ],
      };
    }
  }

  /**
   * Retry all failed jobs in queue
   */
  async retryAllFailedJobs(queueName = QUEUE_NAME, { user, req } = {}) {
    const failedJobs = await withTimeout(jobQueue.getFailed(0, 100), DEFAULT_TIMEOUT_MS, "Get failed jobs");
    let retriedCount = 0;

    for (const job of failedJobs) {
      try {
        await withTimeout(job.retry(), 1000, `Retry job ${job.id}`);
        retriedCount++;
      } catch (err) {
        console.warn(`[AdminQueueService] Failed to retry job ${job.id}:`, err.message);
      }
    }

    await recordAudit({
      actorId: user?.id || null,
      action: "RETRY_FAILED_JOBS",
      targetModel: "Queue",
      targetId: queueName,
      afterSnapshot: { retriedCount, totalFound: failedJobs.length },
      req,
    });

    return {
      queueName,
      retriedCount,
      totalFailedFound: failedJobs.length,
    };
  }

  /**
   * Purge old or failed jobs from queue
   */
  async purgeQueue(queueName = QUEUE_NAME, { type = "failed", grace = 0 }, { user, req } = {}) {
    const validTypes = ["completed", "failed", "delayed", "wait"];
    if (!validTypes.includes(type)) {
      throw new ServiceError(
        `Invalid purge type '${type}'. Supported types: ${validTypes.join(", ")}`,
        400,
        "INVALID_PURGE_TYPE"
      );
    }

    const removedIds = await withTimeout(jobQueue.clean(grace, 1000, type), DEFAULT_TIMEOUT_MS, "Clean queue");

    await recordAudit({
      actorId: user?.id || null,
      action: "PURGE_QUEUE",
      targetModel: "Queue",
      targetId: queueName,
      afterSnapshot: { type, purgedCount: (removedIds || []).length },
      req,
    });

    return {
      queueName,
      type,
      purgedCount: (removedIds || []).length,
    };
  }

  /**
   * Pause queue
   */
  async pauseQueue(queueName = QUEUE_NAME, { user, req } = {}) {
    await withTimeout(jobQueue.pause(), DEFAULT_TIMEOUT_MS, "Pause queue");

    await recordAudit({
      actorId: user?.id || null,
      action: "PAUSE_QUEUE",
      targetModel: "Queue",
      targetId: queueName,
      req,
    });

    return { queueName, isPaused: true };
  }

  /**
   * Resume queue
   */
  async resumeQueue(queueName = QUEUE_NAME, { user, req } = {}) {
    await withTimeout(jobQueue.resume(), DEFAULT_TIMEOUT_MS, "Resume queue");

    await recordAudit({
      actorId: user?.id || null,
      action: "RESUME_QUEUE",
      targetModel: "Queue",
      targetId: queueName,
      req,
    });

    return { queueName, isPaused: false };
  }
}

export const adminQueueService = new AdminQueueService();
