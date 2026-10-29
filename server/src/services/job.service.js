import { validateSelectedAiModel } from '../utils/selectedAiModel.js';
/**
 * @file job.service.js
 * @description Core job lifecycle service — create, progress, state transitions,
 *   cancellation, retry, and read operations for all job types.
 */

import prisma from "../config/prisma.js";
import { admitProjectOperation } from "./projectOperation.service.js";
import { operationSnapshot, currentProjectOperation, withOperationPublishGuard, stagePreparedPublication, deferPreparedCommit } from "./projectOperationWorkspace.service.js";
import { resolveProjectAccess, withProjectGuard } from "./projectAccess.service.js";
import { deliverProjectEvent, publishProjectEvent } from "./projectEvent.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { notificationService } from "./notification.service.js";
import { reuseSnapshotHistory } from "./snapshotReuse.service.js";
import { abortJob, isJobCanceled } from "./jobCancellation.service.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Keep in sync with the JobType enum in schema.prisma */
const JOB_TYPES = Object.freeze([
  "INGEST",
  "INSTALL_DEPS",
  "RUN_TESTS",
  "SUPERTEST_COVERAGE",
  "PARSE_COVERAGE",
  "BUILD_CFG",
  "PERFORMANCE_ANALYSIS",
  "AI_SUGGEST",
  "AI_TESTS",
  "ANALYSIS",
  "QUALITY_ANALYSIS",
  "SECURITY_ANALYSIS",
  "CODE_HYGIENE",
  "RUN_VITEST_TESTS",
  "SYSTEM_TEST_ANALYSIS",
  "SYSTEM_TEST_ASSESSMENT",
  "SYSTEM_TEST_IMPROVEMENT",
  "SYSTEM_TEST_MUTATION",
  "VITEST_COVERAGE",
  "CYPRESS_SYSTEM_TEST",
  "CYPRESS_SYSTEM_COVERAGE",
  "PLAYWRIGHT_SYSTEM_COVERAGE",
]);

/** Terminal statuses — a job in one of these states cannot be mutated. */
const TERMINAL_STATUSES = Object.freeze(["SUCCESS", "FAILED", "CANCELED"]);

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

const assertStringField = (value, fieldName) => {
  if (!value || typeof value !== "string" || value.trim().length === 0) {
    throw new ServiceError(`${fieldName} is required`, 400);
  }
};

const assertNumberField = (value, fieldName) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ServiceError(`${fieldName} must be a number`, 400);
  }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const normalizeJobError = (error) => {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : JSON.stringify(error));
};

const emitSharedJobState = async job => {
  if (!job?.projectId || !job.userId) return;
  try {
    const event = await withProjectGuard({projectId:job.projectId,userId:job.userId,capability:'project.read'}, tx =>
      publishProjectEvent({tx,projectId:job.projectId,type:'job.updated',actorId:job.userId,resourceId:job.id,
        payload:{status:job.status,progress:job.progress}}));
    await deliverProjectEvent(event);
  } catch { /* Persisted job status remains authoritative if delivery fails. */ }
};

export const addJobLog = async (jobId, level, message, client = prisma) => {
  return client.jobLog.create({ data: { jobId, level, message } });
};

export const STALE_JOB_TIMEOUT_MS = 25 * 60 * 1000; // 25 minutes for large test suites and AI batch generation
const INACTIVE_HEARTBEAT_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes of zero logs/activity

const LONG_RUNNING_JOB_TYPES = [
  "AI_TESTS",
  "RUN_TESTS",
  "VITEST_COVERAGE",
  "RUN_VITEST_TESTS",
  "SUPERTEST_COVERAGE",
  "SYSTEM_TEST",
  "CYPRESS_SYSTEM_TEST",
  "CYPRESS_SYSTEM_COVERAGE",
  "PLAYWRIGHT_SYSTEM_TEST",
  "PLAYWRIGHT_SYSTEM_COVERAGE",
  "SYSTEM_TEST_ANALYSIS",
  "SYSTEM_TEST_ASSESSMENT",
  "SYSTEM_TEST_IMPROVEMENT",
  "SYSTEM_TEST_MUTATION",
  "INSTALL_DEPS",
];

export const cleanupStaleJobsForProject = async (projectId, client = prisma) => {
  const activeJobs = await client.job.findMany({
    where: {
      projectId,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    select: { id: true, type: true, status: true, startedAt: true, createdAt: true, updatedAt: true },
  });

  const now = Date.now();
  for (const job of activeJobs) {
    const startTime = job.startedAt || job.createdAt;
    const elapsedMs = startTime ? now - new Date(startTime).getTime() : 0;
    const isLongRunning = LONG_RUNNING_JOB_TYPES.includes(job.type);
    const maxLimit = isLongRunning ? STALE_JOB_TIMEOUT_MS : 8 * 60 * 1000;
    // Long-running jobs like RUN_TESTS have 10m runner timeouts, so allow at least 12 minutes of inactivity before cancelling
    const inactiveLimit = isLongRunning ? 12 * 60 * 1000 : INACTIVE_HEARTBEAT_TIMEOUT_MS;

    if (elapsedMs > inactiveLimit) {
      const [latestLog, latestOutput] = await Promise.all([
        client.jobLog.findFirst({
          where: { jobId: job.id },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        client.jobOutput.findUnique({
          where: { jobId: job.id },
          select: { updatedAt: true },
        }).catch(() => null),
      ]);

      const logTime = latestLog?.createdAt ? new Date(latestLog.createdAt).getTime() : 0;
      const outputTime = latestOutput?.updatedAt ? new Date(latestOutput.updatedAt).getTime() : 0;
      const updateTime = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
      const startMs = startTime ? new Date(startTime).getTime() : 0;

      const lastActiveMs = Math.max(logTime, outputTime, updateTime, startMs);
      const inactiveMs = now - lastActiveMs;

      const isDead = inactiveMs > inactiveLimit;
      const isHardTimeout = elapsedMs > maxLimit;

      if (isDead || isHardTimeout) {
        const reason = isHardTimeout
          ? `Job execution timed out after ${Math.round(elapsedMs / 1000)}s and was automatically stopped.`
          : `Job became inactive for ${Math.round(inactiveMs / 1000)}s without any progress and was automatically stopped.`;

        await client.job.update({
          where: { id: job.id },
          data: {
            status: "CANCELED",
            finishedAt: new Date(),
            errorMessage: reason,
          },
        });
        await addJobLog(
          job.id,
          "WARN",
          reason,
          client,
        ).catch(() => { });
      }
    }
  }
};

export const cleanupAllStaleJobs = async (userId = null, client = prisma) => {
  const where = {
    status: { in: ["QUEUED", "RUNNING"] },
    ...(userId && { userId }),
  };
  const activeJobs = await client.job.findMany({
    where,
    select: { id: true, type: true, status: true, startedAt: true, createdAt: true, updatedAt: true },
  });

  const now = Date.now();
  for (const job of activeJobs) {
    const startTime = job.startedAt || job.createdAt;
    const elapsedMs = startTime ? now - new Date(startTime).getTime() : 0;
    const isLongRunning = LONG_RUNNING_JOB_TYPES.includes(job.type);
    const maxLimit = isLongRunning ? STALE_JOB_TIMEOUT_MS : 8 * 60 * 1000;
    // Long-running jobs like RUN_TESTS have 10m runner timeouts, so allow at least 12 minutes of inactivity before cancelling
    const inactiveLimit = isLongRunning ? 12 * 60 * 1000 : INACTIVE_HEARTBEAT_TIMEOUT_MS;

    if (elapsedMs > inactiveLimit) {
      const [latestLog, latestOutput] = await Promise.all([
        client.jobLog.findFirst({
          where: { jobId: job.id },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        client.jobOutput.findUnique({
          where: { jobId: job.id },
          select: { updatedAt: true },
        }).catch(() => null),
      ]);

      const logTime = latestLog?.createdAt ? new Date(latestLog.createdAt).getTime() : 0;
      const outputTime = latestOutput?.updatedAt ? new Date(latestOutput.updatedAt).getTime() : 0;
      const updateTime = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
      const startMs = startTime ? new Date(startTime).getTime() : 0;

      const lastActiveMs = Math.max(logTime, outputTime, updateTime, startMs);
      const inactiveMs = now - lastActiveMs;

      const isDead = inactiveMs > inactiveLimit;
      const isHardTimeout = elapsedMs > maxLimit;

      if (isDead || isHardTimeout) {
        const reason = isHardTimeout
          ? `Job execution timed out after ${Math.round(elapsedMs / 1000)}s and was automatically stopped.`
          : `Job became inactive for ${Math.round(inactiveMs / 1000)}s without any progress and was automatically stopped.`;

        await client.job.update({
          where: { id: job.id },
          data: {
            status: "CANCELED",
            finishedAt: new Date(),
            errorMessage: reason,
          },
        });
        await addJobLog(
          job.id,
          "WARN",
          reason,
          client,
        ).catch(() => { });
      }
    }
  }
};

const assertNoActiveJob = async (projectId, type, client = prisma, extraFilters = {}) => {
  await cleanupStaleJobsForProject(projectId, client).catch(() => { });

  const where = { projectId, type, status: { in: ["QUEUED", "RUNNING"] }, ...extraFilters };
  const running = await client.job.findFirst({
    where,
    select: { id: true },
  });

  if (running) {
    throw new ServiceError(
      `A ${type} job is already queued or running for this project`,
      409,
    );
  }
};

// ---------------------------------------------------------------------------
// Typed convenience creators
// ---------------------------------------------------------------------------

const createTypedJob =
  (type) =>
    ({ projectId, snapshotId, userId, payloadJson, requestId }) =>
      createSnapshotJob({
        projectId,
        snapshotId,
        userId,
        type,
        payloadJson: { snapshotId, ...payloadJson },
        requestId,
      });

export const createInstallDepsJob = createTypedJob("INSTALL_DEPS");

export const createRunTestsJob = ({ projectId, snapshotId, userId, mode = "FULL", testType, requestId, chainBuildCfg = false }) =>
  createSnapshotJob({
    projectId,
    snapshotId,
    userId,
    type: "RUN_TESTS",
    payloadJson: { snapshotId, mode, ...(testType ? { testType } : {}), ...(chainBuildCfg ? { chainBuildCfg: true } : {}) },
    requestId,
  });

/** Creates a queued RUN_VITEST_TESTS job for a snapshot. */
export const createVitestJob = createTypedJob("RUN_VITEST_TESTS");

/** Creates a queued browser system-test analysis job for a snapshot. */
export const createSystemTestAnalysisJob = ({
  projectId,
  snapshotId,
  userId,
  runner = null,
  executionMode = "frontend",
  testFile = null,
}) => {
  const normalizedMode = String(executionMode || "frontend").toLowerCase().trim();
  if (!["full", "frontend"].includes(normalizedMode)) {
    throw new ServiceError("executionMode must be frontend or full", 400);
  }
  if (runner !== null && !["playwright", "cypress"].includes(String(runner).toLowerCase().trim())) {
    throw new ServiceError("runner must be playwright or cypress", 400);
  }
  const normalizedRunner = runner ? String(runner).toLowerCase().trim() : null;

  return createSnapshotJob({
    projectId,
    snapshotId,
    userId,
    type: "SYSTEM_TEST_ANALYSIS",
    payloadJson: {
      snapshotId,
      runner: normalizedRunner,
      executionMode: normalizedMode,
      testFile: testFile ? String(testFile).trim() : null,
    },
  });
};

export const createVitestCoverageJob = createTypedJob("VITEST_COVERAGE");

/** Creates a queued Supertest integration-coverage job for a snapshot. */
export const createSupertestCoverageJob = createTypedJob("SUPERTEST_COVERAGE");
/** @deprecated Use createSystemTestAnalysisJob instead */
export const createCypressSystemCoverageJob = ({ projectId, snapshotId, userId }) =>
  createSystemTestAnalysisJob({ projectId, snapshotId, userId, runner: "cypress" });

/** @deprecated Use createSystemTestAnalysisJob instead */
export const createCypressSystemTestJob = ({ projectId, snapshotId, userId }) =>
  createSystemTestAnalysisJob({ projectId, snapshotId, userId, runner: "cypress" });
export const createBuildCfgJob = createTypedJob("BUILD_CFG");
export const createPerformanceAnalysisJob = createTypedJob("PERFORMANCE_ANALYSIS");
export const createAiSuggestJob = createTypedJob("AI_SUGGEST");
export const createCodeHygieneJob = createTypedJob("CODE_HYGIENE");

export const createAiTestsJob = async ({ projectId, snapshotId, userId, mode = "SKELETON", executionMode = "full", targetEndpoints = null, model, aiTestId, scenarioId, expectedVersion, requestId }) => {
  validateSelectedAiModel(model);
  if (["PLAYWRIGHT_E2E","PLAYWRIGHT"].includes(mode) && executionMode !== "full") throw new ServiceError("System Test generation requires full-system execution.",400);
  if (!["frontend", "full"].includes(executionMode)) throw new ServiceError("Invalid executionMode", 400);
  return createSnapshotJob({
    projectId,
    snapshotId,
    userId,
    type: "AI_TESTS",
    payloadJson: { snapshotId, mode, executionMode, targetEndpoints, model:model || process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      ...(aiTestId ? { aiTestId } : {}), ...(scenarioId ? { scenarioId } : {}), ...(expectedVersion ? { expectedVersion } : {}) },
    ...(requestId ? { requestId } : {}),
  });
};

export const createAnalysisJob = async ({ projectId, snapshotId, userId, requestId }) => {
  assertStringField(projectId,'projectId');
  assertStringField(snapshotId,'snapshotId');
  assertStringField(userId,'userId');
  const admitted = await admitProjectOperation({projectId,snapshotId,userId,type:'ANALYSIS',input:{snapshotId},requestId});
  return {...admitted.job,reused:admitted.reused,operationId:admitted.operationId};
};

// ---------------------------------------------------------------------------
// Create jobs
// ---------------------------------------------------------------------------

export const createSnapshotIngestJob = async ({
  projectId,
  userId,
  checksum,
  storagePath,
}) => {
  assertStringField(projectId, "projectId");
  assertStringField(userId, "userId");
  assertStringField(checksum, "checksum");
  assertStringField(storagePath, "storagePath");

  const cached = await reuseSnapshotHistory({
    projectId,
    checksum,
    commitSha: null,
  });
  if (cached) {
    return { reused: true, result: cached };
  }

  return prisma.$transaction(async (tx) => {
    const [project, user] = await Promise.all([
      tx.project.findUnique({ where: { id: projectId }, select: { id: true } }),
      tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
    ]);

    if (!project) throw new ServiceError("Project not found", 404);
    if (!user) throw new ServiceError("User not found", 404);

    await assertNoActiveJob(projectId, "INGEST", tx);

    const snapshot = await tx.projectSnapshot.create({
      data: { projectId, source: "ZIP", checksum, storagePath },
    });

    const job = await tx.job.create({
      data: {
        projectId,
        snapshotId: snapshot.id,
        userId,
        type: "INGEST",
        status: "QUEUED",
        progress: 0,
        payloadJson: JSON.stringify({ checksum, storagePath }),
      },
    });

    await addJobLog(job.id, "INFO", "Job created", tx);

    return { reused: false, snapshot, job };
  });
};

export const createIngestJobForSnapshot = async ({
  projectId,
  snapshotId,
  userId,
  payloadJson = null,
}) => {
  assertStringField(projectId, "projectId");
  assertStringField(snapshotId, "snapshotId");
  assertStringField(userId, "userId");

  const [snapshot, user] = await Promise.all([
    prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: { id: true, projectId: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);

  if (!snapshot) throw new ServiceError("Snapshot not found", 404);
  if (snapshot.projectId !== projectId)
    throw new ServiceError("Snapshot does not belong to project", 400);
  if (!user) throw new ServiceError("User not found", 404);

  await assertNoActiveJob(projectId, "INGEST");

  const job = await prisma.job.create({
    data: {
      projectId,
      snapshotId,
      userId,
      type: "INGEST",
      status: "QUEUED",
      progress: 0,
      payloadJson: payloadJson != null ? JSON.stringify(payloadJson) : null,
    },
  });

  await addJobLog(job.id, "INFO", "Job created");

  return job;
};

export const createSnapshotJob = async ({
  projectId,
  snapshotId,
  userId,
  type,
  payloadJson = null,
  requestId,
}) => {
  assertStringField(projectId, "projectId");
  assertStringField(snapshotId, "snapshotId");
  assertStringField(userId, "userId");
  assertStringField(type, "type");

  if (!JOB_TYPES.includes(type)) {
    throw new ServiceError(
      `Invalid job type. Must be one of: ${JOB_TYPES.join(", ")}`,
      400,
    );
  }

  if (['RUN_TESTS','ANALYSIS','AI_TESTS','AI_SUGGEST','SUPERTEST_COVERAGE','INSTALL_DEPS','RUN_VITEST_TESTS','VITEST_COVERAGE','BUILD_CFG','PERFORMANCE_ANALYSIS','CODE_HYGIENE','QUALITY_ANALYSIS','SECURITY_ANALYSIS','SYSTEM_TEST_ANALYSIS','SYSTEM_TEST_ASSESSMENT','SYSTEM_TEST_IMPROVEMENT','SYSTEM_TEST_MUTATION'].includes(type)) {
    const admitted = await admitProjectOperation({projectId,snapshotId,userId,type,input:payloadJson || {},requestId});
    return {...admitted.job,reused:admitted.reused,operationId:admitted.operationId};
  }
  await resolveProjectAccess({projectId,userId,capability:type.startsWith('AI_') ? 'ai.use' : 'tests.run'});

  const [snapshot, user] = await Promise.all([
    prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: { id: true, projectId: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);

  if (!snapshot) throw new ServiceError("Snapshot not found", 404);
  if (snapshot.projectId !== projectId)
    throw new ServiceError("Snapshot does not belong to project", 400);
  if (!user) throw new ServiceError("User not found", 404);

  await assertNoActiveJob(projectId, type, prisma, { snapshotId });

  let job;
  try {
    job = await prisma.job.create({
      data: {
        projectId,
        snapshotId,
        userId,
        type,
        status: "QUEUED",
        progress: 0,
        payloadJson: payloadJson != null ? JSON.stringify(payloadJson) : null,
      },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      throw new ServiceError(
        `A ${type} job is already queued or running for this project/snapshot`,
        409,
      );
    }
    throw error;
  }

  await addJobLog(job.id, "INFO", `Job created (${type})`);

  return job;
};

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

export const updateJobProgress = async (jobId, progress) => {
  assertStringField(jobId, "jobId");
  assertNumberField(progress, "progress");

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true },
  });

  if (!currentJob) throw new ServiceError("Job not found", 404);
  if (TERMINAL_STATUSES.includes(currentJob.status)) {
    throw new ServiceError("Cannot update progress for a completed job", 400);
  }

  const clamped = Math.max(0, Math.min(100, progress));

  const job = await prisma.job.update({
    where: { id: jobId },
    data: { progress: clamped },
  });

  await addJobLog(jobId, "INFO", `Progress ${clamped}%`);
  await emitSharedJobState(job);
  return job;
};

export const markJobRunning = async (jobId) => {
  assertStringField(jobId, "jobId");

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true },
  });

  if (!currentJob) throw new ServiceError("Job not found", 404);
  if (currentJob.status === "CANCELED")
    throw new ServiceError("Cannot start a canceled job", 400);
  if (currentJob.status !== "QUEUED")
    throw new ServiceError("Only queued jobs can be started", 400);

  const job = await prisma.job.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  await addJobLog(jobId, "INFO", "Job started");
  return job;
};

export const markJobSuccess = async (jobId,resultJson) => {
  if (currentProjectOperation()?.preparedPublications) {
    const current = await prisma.job.findUnique({where:{id:jobId}});
    await stagePreparedPublication(async tx => {
      const completed = await markJobSuccessInternal(jobId,resultJson,tx,false);
      deferPreparedCommit(async()=>{
        await notificationService.createJobFinishedNotification(jobId);
      });
    });
    return {...current,status:'SUCCESS'};
  }
  const job = await withOperationPublishGuard(tx => markJobSuccessInternal(jobId,resultJson,tx,false));
  await emitSharedJobState(job);
  try { await notificationService.createJobFinishedNotification(jobId); }
  catch (error) { console.error(`[job.service] Notification failed for job ${jobId}:`,error); }
  return job;
};

const markJobSuccessInternal = async (jobId, resultJson, db = prisma, notify = true) => {
  assertStringField(jobId, "jobId");

  const currentJob = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, userId: true, projectId: true, startedAt: true },
  });

  if (!currentJob) throw new ServiceError("Job not found", 404);
  if (isJobCanceled(jobId) || currentJob.status === "CANCELED") {
    throw new ServiceError("Cannot mark a canceled job as succeeded", 400);
  }
  if (currentJob.status !== "RUNNING")
    throw new ServiceError("Only running jobs can be marked as succeeded", 400);

  const resultString = JSON.stringify(resultJson ?? {});

  const finishedAt = new Date();
  const computeTimeMs = currentJob.startedAt
    ? finishedAt.getTime() - currentJob.startedAt.getTime()
    : 0;

  const [job] = await Promise.all([
    db.job.update({
      where: { id: jobId },
      data: {
        status: "SUCCESS",
        progress: 100,
        finishedAt,
        computeTimeMs,
        resultJson: resultString,
      },
    }),
    // Runners stream their output while a job is running. Keep that diagnostic
    // output intact; only use the result JSON as output when nothing was streamed.
    db.jobOutput.upsert({
      where: { jobId },
      create: { jobId, stdout: resultString },
      update: {},
    }),
  ]);

  await addJobLog(jobId, "INFO", "Job succeeded", db);

  try {
    if (notify) await notificationService.createJobFinishedNotification(jobId);
  } catch (err) {
    console.error(`[job.service] Notification failed for job ${jobId}:`, err);
  }

  return job;
};

export const markJobFailed = async (jobId, error) => {
  assertStringField(jobId, "jobId");

  const normalizedError = normalizeJobError(error);

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, startedAt: true },
  });

  if (!currentJob) throw new ServiceError("Job not found", 404);
  if (currentJob.status !== "RUNNING")
    throw new ServiceError("Only running jobs can be marked as failed", 400);

  const finishedAt = new Date();
  const computeTimeMs = currentJob.startedAt
    ? finishedAt.getTime() - currentJob.startedAt.getTime()
    : 0;

  const job = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      finishedAt,
      computeTimeMs,
      errorMessage: normalizedError.message,
    },
  });

  await addJobLog(job.id, "ERROR", `Job failed: ${normalizedError.message}`);
  return job;
};

export const markQueuedJobFailed = async (jobId, error) => {
  assertStringField(jobId, "jobId");

  const normalizedError = normalizeJobError(error);

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true },
  });

  if (!currentJob) throw new ServiceError("Job not found", 404);
  if (currentJob.status !== "QUEUED")
    throw new ServiceError(
      "Only queued jobs can be marked as failed via this method",
      400,
    );

  const finishedAt = new Date();

  const job = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      finishedAt,
      computeTimeMs: 0,
      errorMessage: normalizedError.message,
    },
  });

  await addJobLog(
    job.id,
    "ERROR",
    `Job failed (from QUEUED): ${normalizedError.message}`,
  );
  return job;
};

export const cancelJob = async (jobId) => {
  assertStringField(jobId, "jobId");

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, userId: true, projectId: true },
  });

  if (!currentJob) throw new ServiceError("Job not found", 404);

  // Idempotent: repeated cancel requests return the canceled job safely
  if (currentJob.status === "CANCELED") {
    abortJob(jobId);
    return currentJob;
  }

  // Finished jobs cannot be canceled
  if (currentJob.status === "SUCCESS") {
    throw new ServiceError("Cannot cancel a job that has already completed successfully", 400);
  }

  if (!["QUEUED", "RUNNING"].includes(currentJob.status)) {
    throw new ServiceError("Only queued or running jobs can be canceled", 400);
  }

  const job = await prisma.job.update({
    where: { id: jobId },
    data: { status: "CANCELED", finishedAt: new Date() },
  });

  await prisma.projectOperation.updateMany({where:{primaryJobId:jobId,status:{in:['ADMITTED','QUEUED','RUNNING','PUBLISHING']}},data:{status:'CANCELED'}});
  await addJobLog(jobId, "INFO", "Job canceled");
  abortJob(jobId);
  return job;
};

export const retryJob = async (jobId) => {
  assertStringField(jobId, "jobId");

  const oldJob = await prisma.job.findUnique({ where: { id: jobId } });

  if (!oldJob) throw new ServiceError("Job not found", 404);
  if (oldJob.status !== "FAILED")
    throw new ServiceError("Only failed jobs can be retried", 400);
  if (!oldJob.snapshotId)
    throw new ServiceError("Job has no associated snapshot", 400);
  if (!oldJob.userId) throw new ServiceError("Job has no owner", 400);
  if (oldJob.type !== "INGEST")
    throw new ServiceError("Only INGEST jobs can be retried", 400);

  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: oldJob.snapshotId },
    select: { id: true, projectId: true },
  });

  if (!snapshot) throw new ServiceError("Snapshot not found", 404);
  if (snapshot.projectId !== oldJob.projectId)
    throw new ServiceError("Snapshot does not belong to project", 400);

  await assertNoActiveJob(oldJob.projectId, "INGEST");

  const newJob = await createIngestJobForSnapshot({
    projectId: oldJob.projectId,
    snapshotId: oldJob.snapshotId,
    userId: oldJob.userId,
    payloadJson: oldJob.payloadJson ? JSON.parse(oldJob.payloadJson) : null,
  });

  await addJobLog(newJob.id, "INFO", `Retried from failed job ${jobId}`);
  return newJob;
};

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

export const getJobById = async (jobId) => {
  assertStringField(jobId, "jobId");

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      snapshot: true,
      logs: { orderBy: { createdAt: "asc" } },
      output: true,
    },
  });

  if (!job) throw new ServiceError("Job not found", 404);
  return {...job,snapshot:operationSnapshot(job.snapshot)};
};

export const getProjectJobs = async (projectId) => {
  assertStringField(projectId, "projectId");
  return prisma.job.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
};

export const getRunningJobs = async (projectId) => {
  assertStringField(projectId, "projectId");
  return prisma.job.findMany({
    where: { projectId, status: { in: ["QUEUED", "RUNNING"] } },
  });
};

export const getJobStats = async (projectId) => {
  assertStringField(projectId, "projectId");

  const [queued, running, success, failed] = await Promise.all([
    prisma.job.count({ where: { projectId, status: "QUEUED" } }),
    prisma.job.count({ where: { projectId, status: "RUNNING" } }),
    prisma.job.count({ where: { projectId, status: "SUCCESS" } }),
    prisma.job.count({ where: { projectId, status: "FAILED" } }),
  ]);

  return { queued, running, success, failed };
};

/**
 * Create a job to run Playwright System Tests
 */
export const createPlaywrightJob = async ({ projectId, snapshotId, userId, testDirectory }) => {
  if (!projectId || !snapshotId) {
    throw new Error("projectId and snapshotId are required");
  }

  const job = await prisma.job.create({
    data: {
      type: "PLAYWRIGHT_SYSTEM_TEST",
      status: "QUEUED",
      projectId,
      snapshotId,
      // Store testDirectory (if any) as a stringified JSON in payloadJson
      payloadJson: testDirectory ? JSON.stringify({ testDirectory }) : null,
      ...(userId ? { userId } : {}),
    },
  });

  return job;
};

/** @deprecated Use createSystemTestAnalysisJob instead */
export const createPlaywrightSystemCoverageJob = async ({ projectId, snapshotId, userId, testDirectory }) => {
  return createSystemTestAnalysisJob({
    projectId,
    snapshotId,
    userId,
    runner: "playwright",
  });
};

