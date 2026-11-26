import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveActiveProjectSnapshot } from "./projectFileVersion.service.js";
import { runSnapshotCasGc } from "./snapshotCas.service.js";
import { markJobFailed, markJobRunning, markJobSuccess } from "./job.service.js";
import { addJobToQueue } from "./queue.service.js";

/**
 * Enqueues a `SNAPSHOT_CAS_GC` BullMQ job for safe deferred blob cleanup.
 */
export async function enqueueSnapshotCasGcJob({
  projectId,
  userId = null,
  graceWindowMs = 10 * 60 * 1000,
}) {
  const activeSnapshot = await resolveActiveProjectSnapshot(prisma, projectId);
  const job = await prisma.job.create({
    data: {
      projectId,
      snapshotId: activeSnapshot?.id || null,
      userId,
      type: "SNAPSHOT_CAS_GC",
      status: "QUEUED",
      payloadJson: JSON.stringify({ graceWindowMs }),
    },
    select: { id: true, type: true, status: true },
  });

  await addJobToQueue("SNAPSHOT_CAS_GC", job.id, { projectId, graceWindowMs });
  return { jobId: job.id, type: job.type, status: job.status };
}

/**
 * Worker handler executing `runSnapshotCasGc` for a queued `SNAPSHOT_CAS_GC` job.
 */
export async function processSnapshotCasGcJob(jobId, customData = {}) {
  const dbJob = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, projectId: true, payloadJson: true },
  });
  if (!dbJob) {
    throw new ServiceError("Snapshot CAS GC job not found", 404);
  }

  let payload = {};
  if (dbJob.payloadJson) {
    try {
      payload = JSON.parse(dbJob.payloadJson);
    } catch {
      payload = {};
    }
  }

  const projectId = customData.projectId || dbJob.projectId;
  const graceWindowMs = customData.graceWindowMs ?? payload.graceWindowMs;

  await markJobRunning(jobId);
  try {
    const result = await runSnapshotCasGc(projectId, { graceWindowMs });
    await markJobSuccess(jobId, result);
    return result;
  } catch (error) {
    await markJobFailed(jobId, error).catch(() => {});
    throw error;
  }
}
