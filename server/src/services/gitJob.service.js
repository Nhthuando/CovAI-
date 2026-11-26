import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveActiveProjectSnapshot } from "./projectFileVersion.service.js";
import { GitService } from "./git.service.js";
import { markJobFailed, markJobRunning, markJobSuccess } from "./job.service.js";
import { addJobToQueue } from "./queue.service.js";

const SUPPORTED_GIT_JOB_TYPES = new Set([
  "GIT_FETCH",
  "GIT_PULL",
  "GIT_PUSH",
  "GIT_PUBLISH_REPO",
]);

/**
 * Enqueues a remote Git operation (`GIT_FETCH`, `GIT_PULL`, `GIT_PUSH`, `GIT_PUBLISH_REPO`)
 * into BullMQ and returns `{ jobId, type, status: "QUEUED" }`.
 */
export async function enqueueGitRemoteJob({ type, projectId, userId, payload = {} }) {
  if (!SUPPORTED_GIT_JOB_TYPES.has(type)) {
    throw new ServiceError("Unsupported Git job type", 400);
  }
  const activeSnapshot = await resolveActiveProjectSnapshot(prisma, projectId);
  if (!activeSnapshot) {
    throw new ServiceError("Active project snapshot not found", 404);
  }

  const job = await prisma.job.create({
    data: {
      projectId,
      snapshotId: activeSnapshot.id,
      userId,
      type,
      status: "QUEUED",
      payloadJson: JSON.stringify(payload),
    },
    select: { id: true, type: true, status: true },
  });

  await addJobToQueue(type, job.id, { projectId, userId, payload });
  return { jobId: job.id, type: job.type, status: job.status };
}

/**
 * Worker executor for asynchronous BullMQ Git remote operations.
 */
export async function processGitRemoteJob(type, jobId, customData = {}) {
  const dbJob = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, projectId: true, userId: true, payloadJson: true, status: true },
  });
  if (!dbJob) {
    throw new ServiceError("Git job not found", 404);
  }

  let payload = customData.payload || {};
  if ((!payload || Object.keys(payload).length === 0) && dbJob.payloadJson) {
    try {
      payload = JSON.parse(dbJob.payloadJson);
    } catch {
      payload = {};
    }
  }

  const projectId = customData.projectId || dbJob.projectId;
  const userId = customData.userId || dbJob.userId;

  await markJobRunning(jobId);

  try {
    let result;
    if (type === "GIT_FETCH") {
      result = await GitService.fetch(projectId, userId, payload);
    } else if (type === "GIT_PULL") {
      result = await GitService.pull(projectId, userId, payload);
    } else if (type === "GIT_PUSH") {
      result = await GitService.push(projectId, userId, payload);
    } else if (type === "GIT_PUBLISH_REPO") {
      result = await GitService.publishToGitHub(projectId, userId, payload);
    } else {
      throw new ServiceError(`Unsupported Git job type: ${type}`, 400);
    }

    await markJobSuccess(jobId, result);
    return result;
  } catch (error) {
    await markJobFailed(jobId, error).catch(() => {});
    throw error;
  }
}
