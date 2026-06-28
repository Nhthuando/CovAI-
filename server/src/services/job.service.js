import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

const assertStringField = (value, fieldName) => {
  if (!value || typeof value !== "string" || value.trim().length === 0) {
    throw new ServiceError(`${fieldName} is required`, 400);
  }
};

const assertNumberField = (value, fieldName) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ServiceError(`${fieldName} must be a number`, 400);
  }
};

const normalizeJobError = (error) => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" ? error : JSON.stringify(error));
};

export const addJobLog = async (jobId, level, message, client = prisma) => {
  return client.jobLog.create({
    data: {
      jobId,
      level,
      message,
    },
  });
};

/**
 * Create a new snapshot and a queued ingest job in a single transaction.
 */
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

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new ServiceError("Project not found", 404);
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new ServiceError("User not found", 404);
    }

    const runningJob = await tx.job.findFirst({
      where: {
        projectId,
        type: "INGEST",
        status: {
          in: ["QUEUED", "RUNNING"],
        },
      },
    });

    if (runningJob) {
      throw new ServiceError("An ingest job is already running", 409);
    }

    const snapshot = await tx.projectSnapshot.create({
      data: {
        projectId,
        source: "ZIP",
        checksum,
        storagePath,
      },
    });
    const job = await tx.job.create({
      data: {
        projectId,
        snapshotId: snapshot.id,
        userId,
        type: "INGEST",
        status: "QUEUED",
        progress: 0,
        payloadJson: JSON.stringify({
          checksum,
          storagePath,
        }),
      },
    });

    await addJobLog(job.id, "INFO", "Job created", tx);

    return { snapshot, job };
  });
};

/**
 * Create a standalone job for an existing snapshot.
 */
const JOB_TYPES = [
  "INGEST",
  "INSTALL_DEPS",
  "RUN_TESTS",
  "PARSE_COVERAGE",
  "BUILD_CFG",
  "AI_SUGGEST",
  "AI_TESTS",
];

export const createIngestJobForSnapshot = async ({
  projectId,
  snapshotId,
  userId,
  payloadJson = null,
}) => {
  assertStringField(projectId, "projectId");
  assertStringField(snapshotId, "snapshotId");
  assertStringField(userId, "userId");

  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
  });

  if (!snapshot) {
    throw new ServiceError("Snapshot not found", 404);
  }

  if (snapshot.projectId !== projectId) {
    throw new ServiceError("Snapshot does not belong to project", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new ServiceError("User not found", 404);
  }

  const runningJob = await prisma.job.findFirst({
    where: {
      projectId,
      type: "INGEST",
      status: {
        in: ["QUEUED", "RUNNING"],
      },
    },
  });

  if (runningJob) {
    throw new ServiceError("An ingest job is already running", 409);
  }

  const job = await prisma.job.create({
    data: {
      projectId,
      snapshotId,
      userId,
      type: "INGEST",
      status: "QUEUED",
      progress: 0,
      payloadJson,
    },
  });

  await addJobLog(job.id, "INFO", "Job created");

  return job;
};

/**
 * Create a generic job for a snapshot based on valid JOB_TYPES.
 */
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
    throw new ServiceError("Invalid job type", 400);
  }

  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
  });

  if (!snapshot) {
    throw new ServiceError("Snapshot not found", 404);
  }

  if (snapshot.projectId !== projectId) {
    throw new ServiceError("Snapshot does not belong to project", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new ServiceError("User not found", 404);
  }

  const runningJob = await prisma.job.findFirst({
    where: {
      projectId,
      type,
      status: {
        in: ["QUEUED", "RUNNING"],
      },
    },
  });

  if (runningJob) {
    throw new ServiceError("A similar job is already queued or running", 409);
  }

  const job = await prisma.job.create({
    data: {
      projectId,
      snapshotId,
      userId,
      type,
      status: "QUEUED",
      progress: 0,
      payloadJson,
    },
  });

  await addJobLog(job.id, "INFO", `Job created (${type})`);

  return job;
};

export const updateJobProgress = async (jobId, progress) => {
  assertStringField(jobId, "jobId");
  assertNumberField(progress, "progress");

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!currentJob) {
    throw new ServiceError("Job not found", 404);
  }

  if (["SUCCESS", "FAILED", "CANCELED"].includes(currentJob.status)) {
    throw new ServiceError("Cannot update progress for completed job", 400);
  }

  progress = Math.max(0, Math.min(100, progress));

  const job = await prisma.job.update({
    where: { id: jobId },
    data: { progress },
  });

  await addJobLog(jobId, "INFO", `Progress ${progress}%`);
  return job;
};

export const markJobRunning = async (jobId) => {
  assertStringField(jobId, "jobId");

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!currentJob) {
    throw new ServiceError("Job not found", 404);
  }

  if (currentJob.status === "CANCELED") {
    throw new ServiceError("Cannot start a canceled job", 400);
  }

  if (currentJob.status !== "QUEUED") {
    throw new ServiceError("Only queued jobs can start", 400);
  }

  const job = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  await addJobLog(jobId, "INFO", "Job started");
  return job;
};

export const markJobSuccess = async (jobId, resultJson) => {
  assertStringField(jobId, "jobId");

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!currentJob) {
    throw new ServiceError("Job not found", 404);
  }

  if (currentJob.status !== "RUNNING") {
    throw new ServiceError("Job must be RUNNING", 400);
  }

  const resultString = JSON.stringify(resultJson ?? {});

  const job = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "SUCCESS",
      progress: 100,
      finishedAt: new Date(),
      resultJson: resultString,
    },
  });

  await prisma.jobOutput.upsert({
    where: { jobId },
    create: {
      jobId,
      stdout: resultString,
    },
    update: {
      stdout: resultString,
    },
  });

  await addJobLog(jobId, "INFO", "Job succeeded");
  return job;
};

export const markJobFailed = async (jobId, error) => {
  assertStringField(jobId, "jobId");
  const normalizedError = normalizeJobError(error);

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!currentJob) {
    throw new ServiceError("Job not found", 404);
  }

  if (currentJob.status !== "RUNNING") {
    throw new ServiceError("Job must be RUNNING", 400);
  }

  const job = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorMessage: normalizedError.message,
    },
  });

  await addJobLog(job.id, "ERROR", `Job failed: ${normalizedError.message}`);
  return job;
};

export const cancelJob = async (jobId) => {
  assertStringField(jobId, "jobId");

  const currentJob = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!currentJob) {
    throw new ServiceError("Job not found", 404);
  }

  if (!["QUEUED", "RUNNING"].includes(currentJob.status)) {
    throw new ServiceError("Only queued or running jobs can be canceled", 400);
  }

  const job = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "CANCELED",
      finishedAt: new Date(),
    },
  });

  await addJobLog(jobId, "INFO", "Job canceled");
  return job;
};

export const getJobById = async (jobId) => {
  assertStringField(jobId, "jobId");

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      snapshot: true,
      logs: true,
      output: true,
    },
  });

  if (!job) {
    throw new ServiceError("Job not found", 404);
  }

  return job;
};

export const getProjectJobs = async (projectId) => {
  assertStringField(projectId, "projectId");
  return prisma.job.findMany({
    where: { projectId },
    orderBy: {
      createdAt: "desc",
    },
  });
};

export const getRunningJobs = async (projectId) => {
  assertStringField(projectId, "projectId");
  return prisma.job.findMany({
    where: {
      projectId,
      status: {
        in: ["QUEUED", "RUNNING"],
      },
    },
  });
};

export const getJobStats = async (projectId) => {
  assertStringField(projectId, "projectId");
  const [queued, running, success, failed] = await Promise.all([
    prisma.job.count({
      where: { projectId, status: "QUEUED" },
    }),
    prisma.job.count({
      where: { projectId, status: "RUNNING" },
    }),
    prisma.job.count({
      where: { projectId, status: "SUCCESS" },
    }),
    prisma.job.count({
      where: { projectId, status: "FAILED" },
    }),
  ]);

  return {
    queued,
    running,
    success,
    failed,
  };
};

export const retryJob = async (jobId) => {
  assertStringField(jobId, "jobId");

  const oldJob = await prisma.job.findUnique({
    where: { id: jobId },
  });

  if (!oldJob) {
    throw new ServiceError("Job not found", 404);
  }

  if (oldJob.status !== "FAILED") {
    throw new ServiceError("Only failed jobs can be retried", 400);
  }

  if (!oldJob.snapshotId) {
    throw new ServiceError("Job has no snapshot", 400);
  }

  if (!oldJob.userId) {
    throw new ServiceError("Job has no owner", 400);
  }

  if (oldJob.type !== "INGEST") {
    throw new ServiceError("Only ingest jobs can be retried", 400);
  }

  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: oldJob.snapshotId },
  });

  if (!snapshot) {
    throw new ServiceError("Snapshot not found", 404);
  }

  if (snapshot.projectId !== oldJob.projectId) {
    throw new ServiceError("Snapshot does not belong to project", 400);
  }

  const runningJob = await prisma.job.findFirst({
    where: {
      projectId: oldJob.projectId,
      type: "INGEST",
      status: {
        in: ["QUEUED", "RUNNING"],
      },
    },
  });

  if (runningJob) {
    throw new ServiceError("An ingest job is already running", 409);
  }

  const newJob = await createIngestJobForSnapshot({
    projectId: oldJob.projectId,
    snapshotId: oldJob.snapshotId,
    userId: oldJob.userId,
    payloadJson: oldJob.payloadJson,
  });

  await addJobLog(newJob.id, "INFO", "Job retried from failed job");
  return newJob;
};

/**
 * Tạo Job INSTALL_DEPS cho một snapshot đã có rootDir.
 */
export const createInstallDepsJob = async ({
  projectId,
  snapshotId,
  userId,
}) => {
  assertStringField(projectId, "projectId");
  assertStringField(snapshotId, "snapshotId");
  assertStringField(userId, "userId");

  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
  });
  if (!snapshot) throw new ServiceError("Snapshot not found", 404);
  if (snapshot.projectId !== projectId)
    throw new ServiceError("Snapshot does not belong to project", 400);

  const running = await prisma.job.findFirst({
    where: {
      projectId,
      type: "INSTALL_DEPS",
      status: { in: ["QUEUED", "RUNNING"] },
    },
  });
  if (running)
    throw new ServiceError(
      "An INSTALL_DEPS job is already running for this project",
      409,
    );

  const job = await prisma.job.create({
    data: {
      projectId,
      snapshotId,
      userId,
      type: "INSTALL_DEPS",
      status: "QUEUED",
      progress: 0,
      payloadJson: JSON.stringify({ snapshotId }),
    },
  });

  await addJobLog(job.id, "INFO", "INSTALL_DEPS job created");
  return job;
};

/**
 * Tạo Job RUN_TESTS cho một snapshot.
 */
export const createRunTestsJob = async ({ projectId, snapshotId, userId }) => {
  assertStringField(projectId, "projectId");
  assertStringField(snapshotId, "snapshotId");
  assertStringField(userId, "userId");

  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
  });
  if (!snapshot) throw new ServiceError("Snapshot not found", 404);
  if (snapshot.projectId !== projectId)
    throw new ServiceError("Snapshot does not belong to project", 400);

  const running = await prisma.job.findFirst({
    where: {
      projectId,
      type: "RUN_TESTS",
      status: { in: ["QUEUED", "RUNNING"] },
    },
  });
  if (running)
    throw new ServiceError(
      "A RUN_TESTS job is already running for this project",
      409,
    );

  const job = await prisma.job.create({
    data: {
      projectId,
      snapshotId,
      userId,
      type: "RUN_TESTS",
      status: "QUEUED",
      progress: 0,
      payloadJson: JSON.stringify({ snapshotId }),
    },
  });

  await addJobLog(job.id, "INFO", "RUN_TESTS job created");
  return job;
};

/**
 * SCRUM-308: Create AI_SUGGEST job
 */
export const createAiSuggestJob = async ({ projectId, snapshotId, userId }) => {
  assertStringField(projectId, "projectId");
  assertStringField(snapshotId, "snapshotId");
  assertStringField(userId, "userId");

  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
  });
  if (!snapshot) throw new ServiceError("Snapshot not found", 404);
  if (snapshot.projectId !== projectId)
    throw new ServiceError("Snapshot does not belong to project", 400);

  const running = await prisma.job.findFirst({
    where: {
      projectId,
      type: "AI_SUGGEST",
      status: { in: ["QUEUED", "RUNNING"] },
    },
  });
  if (running)
    throw new ServiceError(
      "An AI_SUGGEST job is already running for this project",
      409,
    );

  const job = await prisma.job.create({
    data: {
      projectId,
      snapshotId,
      userId,
      type: "AI_SUGGEST",
      status: "QUEUED",
      progress: 0,
      payloadJson: JSON.stringify({ snapshotId }),
    },
  });

  await addJobLog(job.id, "INFO", "AI_SUGGEST job created");
  return job;
};

export const createBuildCfgJob = async ({ projectId, snapshotId, userId }) => {
  assertStringField(projectId, "projectId");
  assertStringField(snapshotId, "snapshotId");
  assertStringField(userId, "userId");

  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
  });
  if (!snapshot) throw new ServiceError("Snapshot not found", 404);
  if (snapshot.projectId !== projectId)
    throw new ServiceError("Snapshot does not belong to project", 400);

  const running = await prisma.job.findFirst({
    where: {
      projectId,
      type: "BUILD_CFG",
      status: { in: ["QUEUED", "RUNNING"] },
    },
  });
  if (running)
    throw new ServiceError(
      "A BUILD_CFG job is already running for this project",
      409,
    );

  const job = await prisma.job.create({
    data: {
      projectId,
      snapshotId,
      userId,
      type: "BUILD_CFG",
      status: "QUEUED",
      progress: 0,
      payloadJson: JSON.stringify({ snapshotId }),
    },
  });

  await addJobLog(job.id, "INFO", "BUILD_CFG job created");
  return job;
};
