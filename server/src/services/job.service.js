/**
 * @file job.service.js
 * @description Core job lifecycle service — create, progress, state transitions,
 *   cancellation, retry, and read operations for all job types.
 */

import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { notificationService } from "./notification.service.js";
import { reuseSnapshotHistory } from "./snapshotReuse.service.js";

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
  "VITEST_COVERAGE",
  "CYPRESS_SYSTEM_TEST",
  "CYPRESS_SYSTEM_COVERAGE",
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

export const addJobLog = async (jobId, level, message, client = prisma) => {
  return client.jobLog.create({ data: { jobId, level, message } });
};

const assertNoActiveJob = async (projectId, type, client = prisma, extraFilters = {}) => {
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
    ({ projectId, snapshotId, userId }) =>
      createSnapshotJob({
        projectId,
        snapshotId,
        userId,
        type,
        payloadJson: { snapshotId },
      });

export const createInstallDepsJob = createTypedJob("INSTALL_DEPS");

export const createRunTestsJob = ({ projectId, snapshotId, userId, mode = "FULL" }) =>
  createSnapshotJob({
    projectId,
    snapshotId,
    userId,
    type: "RUN_TESTS",
    payloadJson: { snapshotId, mode },
  });

/** Creates a queued RUN_VITEST_TESTS job for a snapshot. */
export const createVitestJob = createTypedJob("RUN_VITEST_TESTS");

export const createVitestCoverageJob = createTypedJob("VITEST_COVERAGE");

/** Creates a queued Supertest integration-coverage job for a snapshot. */
export const createSupertestCoverageJob = createTypedJob("SUPERTEST_COVERAGE");
export const createCypressSystemCoverageJob = createTypedJob("CYPRESS_SYSTEM_COVERAGE");
export const createCypressSystemTestJob = createTypedJob("CYPRESS_SYSTEM_TEST");
export const createBuildCfgJob = createTypedJob("BUILD_CFG");
export const createPerformanceAnalysisJob = createTypedJob("PERFORMANCE_ANALYSIS");
export const createAiSuggestJob = createTypedJob("AI_SUGGEST");
export const createCodeHygieneJob = createTypedJob("CODE_HYGIENE");

export const createAiTestsJob = async ({ projectId, snapshotId, userId, mode = "SKELETON" }) => {
  const existing = await prisma.job.findFirst({
    where: {
      projectId,
      snapshotId,
      type: "AI_TESTS",
      status: { in: ["QUEUED", "RUNNING"] },
      payloadJson: { contains: `"mode":"${mode}"` }
    }
  });

  if (existing) {
    return { ...existing, existing: true };
  }

  return createSnapshotJob({
    projectId,
    snapshotId,
    userId,
    type: "AI_TESTS",
    payloadJson: { snapshotId, mode },
  });
};

export const createAnalysisJob = async ({ projectId, snapshotId, userId }) => {
  assertStringField(projectId, "projectId");
  assertStringField(snapshotId, "snapshotId");
  assertStringField(userId, "userId");

  const snapshot = await prisma.projectSnapshot.findFirst({
    where: { id: snapshotId, projectId, project: { ownerId: userId } },
  });
  if (!snapshot) throw new ServiceError("Project or snapshot not found", 404);
  if (!snapshot.rootDir)
    throw new ServiceError("Project snapshot is not ready for analysis", 409);

  const activeWhere = {
    projectId,
    snapshotId,
    type: "ANALYSIS",
    status: { in: ["QUEUED", "RUNNING"] },
  };
  const active = await prisma.job.findFirst({
    where: activeWhere,
    orderBy: { createdAt: "desc" },
  });
  if (active) return { ...active, reused: true };

  try {
    const job = await prisma.job.create({
      data: {
        projectId,
        snapshotId,
        userId,
        type: "ANALYSIS",
        status: "QUEUED",
        progress: 0,
        payloadJson: JSON.stringify({ snapshotId }),
      },
    });
    await addJobLog(job.id, "INFO", "Architecture analysis job created");
    return { ...job, reused: false };
  } catch (error) {
    if (error?.code === "P2002") {
      const concurrent = await prisma.job.findFirst({
        where: activeWhere,
        orderBy: { createdAt: "desc" },
      });
      if (concurrent) return { ...concurrent, reused: true };
    }
    throw error;
  }
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

  await assertNoActiveJob(projectId, type);

  const job = await prisma.job.create({
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

export const markJobSuccess = async (jobId, resultJson) => {
  assertStringField(jobId, "jobId");

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, userId: true, projectId: true, startedAt: true },
  });

  if (!currentJob) throw new ServiceError("Job not found", 404);
  if (currentJob.status !== "RUNNING")
    throw new ServiceError("Only running jobs can be marked as succeeded", 400);

  const resultString = JSON.stringify(resultJson ?? {});

  const finishedAt = new Date();
  const computeTimeMs = currentJob.startedAt
    ? finishedAt.getTime() - currentJob.startedAt.getTime()
    : 0;

  const [job] = await Promise.all([
    prisma.job.update({
      where: { id: jobId },
      data: {
        status: "SUCCESS",
        progress: 100,
        finishedAt,
        computeTimeMs,
        resultJson: resultString,
      },
    }),
    prisma.jobOutput.upsert({
      where: { jobId },
      create: { jobId, stdout: resultString },
      update: { stdout: resultString },
    }),
  ]);

  await addJobLog(jobId, "INFO", "Job succeeded");

  try {
    await notificationService.createJobFinishedNotification(jobId);
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
    select: { id: true, status: true },
  });

  if (!currentJob) throw new ServiceError("Job not found", 404);
  if (!["QUEUED", "RUNNING"].includes(currentJob.status)) {
    throw new ServiceError("Only queued or running jobs can be canceled", 400);
  }

  const job = await prisma.job.update({
    where: { id: jobId },
    data: { status: "CANCELED", finishedAt: new Date() },
  });

  await addJobLog(jobId, "INFO", "Job canceled");
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
  return job;
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