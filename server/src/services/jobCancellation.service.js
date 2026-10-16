/**
 * Job Cancellation Registry Service
 * Manages AbortControllers and cancellation flags for running background workers.
 * Ensures external processes (e.g. Jest via dockerRunner) and iterative pipelines
 * can be immediately aborted upon user cancellation.
 */

const controllers = new Map();
const canceledJobs = new Set();

/**
 * Register an AbortController for an active job execution.
 * @param {string} jobId
 * @param {AbortController} controller
 */
export const registerJobAbortController = (jobId, controller) => {
  if (!jobId || !controller) return;
  controllers.set(jobId, controller);
};

/**
 * Unregister an AbortController for a finished, failed, or canceled job.
 * @param {string} jobId
 */
export const unregisterJobAbortController = (jobId) => {
  if (!jobId) return;
  controllers.delete(jobId);
};

/**
 * Get the active AbortController for a job if available.
 * @param {string} jobId
 * @returns {AbortController|undefined}
 */
export const getJobAbortController = (jobId) => {
  return controllers.get(jobId);
};

/**
 * Get the active AbortSignal for a job if registered.
 * @param {string} jobId
 * @returns {AbortSignal|undefined}
 */
export const getJobAbortSignal = (jobId) => {
  return controllers.get(jobId)?.signal;
};

/**
 * Mark a job as canceled and trigger its registered AbortController.
 * Idempotent: repeated calls safely return true if canceled.
 * @param {string} jobId
 * @returns {boolean} Whether an active controller was aborted
 */
export const abortJob = (jobId) => {
  if (!jobId) return false;
  canceledJobs.add(jobId);
  const controller = controllers.get(jobId);
  if (controller) {
    try {
      controller.abort();
    } catch (err) {
      console.warn(`[JobCancellation] Error aborting controller for job ${jobId}:`, err.message);
    }
    controllers.delete(jobId);
    return true;
  }
  return false;
};

/**
 * Check whether a job has received a cancellation signal.
 * Checks both in-memory canceled set and any attached signal.
 * @param {string} jobId
 * @param {AbortSignal} [signal]
 * @returns {boolean}
 */
export const isJobCanceled = (jobId, signal) => {
  if (signal?.aborted) return true;
  if (!jobId) return false;
  if (canceledJobs.has(jobId)) return true;
  const controller = controllers.get(jobId);
  if (controller?.signal?.aborted) return true;
  return false;
};

/**
 * Reset cancellation tracking state for a job (useful in test teardown).
 * @param {string} jobId
 */
export const resetJobCancellation = (jobId) => {
  if (!jobId) {
    canceledJobs.clear();
    controllers.clear();
    return;
  }
  canceledJobs.delete(jobId);
  controllers.delete(jobId);
};
