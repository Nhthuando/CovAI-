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
    "PARSE_COVERAGE",
    "BUILD_CFG",
    "AI_SUGGEST",
    "AI_TESTS",
]);

/** Terminal statuses — a job in one of these states cannot be mutated. */
const TERMINAL_STATUSES = Object.freeze(["SUCCESS", "FAILED", "CANCELED"]);

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @param {string}  fieldName
 * @throws {ServiceError} 400 when value is absent or not a non-empty string
 */
const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};

/**
 * @param {unknown} value
 * @param {string}  fieldName
 * @throws {ServiceError} 400 when value is not a finite number
 */
const assertNumberField = (value, fieldName) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ServiceError(`${fieldName} must be a number`, 400);
    }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalises any thrown value into a proper Error so `error.message` is safe
 * to read.
 *
 * @param {unknown} error
 * @returns {Error}
 */
const normalizeJobError = (error) => {
    if (error instanceof Error) return error;
    return new Error(typeof error === "string" ? error : JSON.stringify(error));
};

/**
 * Appends a log entry to a job, optionally inside an existing Prisma
 * transaction client.
 *
 * @param {string}                                       jobId
 * @param {"INFO" | "WARN" | "ERROR"}                   level
 * @param {string}                                       message
 * @param {import("@prisma/client").PrismaClient}        [client]
 */
export const addJobLog = async (jobId, level, message, client = prisma) => {
    return client.jobLog.create({ data: { jobId, level, message } });
};

/**
 * Shared guard: throws 409 when a job of the given type is already active for
 * the project.
 *
 * @param {string} projectId
 * @param {string} type
 * @param {import("@prisma/client").PrismaClient} [client]
 */
const assertNoActiveJob = async (projectId, type, client = prisma) => {
    const running = await client.job.findFirst({
        where: { projectId, type, status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
    });

    if (running) {
        throw new ServiceError(
            `A ${type} job is already queued or running for this project`,
            409
        );
    }
};

// ---------------------------------------------------------------------------
// Create jobs
// ---------------------------------------------------------------------------

/**
 * Creates a new snapshot record and a queued INGEST job within a single
 * transaction.  Short-circuits if an identical snapshot already has fully
 * processed artefacts.
 *
 * @param {{
 *   projectId:   string,
 *   userId:      string,
 *   checksum:    string,
 *   storagePath: string,
 * }} params
 * @returns {Promise<
 *   | { reused: true;  result: import("./snapshotReuse.service.js").CachedResult }
 *   | { reused: false; snapshot: object; job: object }
 * >}
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

    // Short-circuit: reuse a previously processed snapshot with same checksum.
    const cached = await reuseSnapshotHistory({ projectId, checksum, commitSha: null });
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

/**
 * Creates a standalone INGEST job for an already-existing snapshot.
 *
 * @param {{
 *   projectId:    string,
 *   snapshotId:   string,
 *   userId:       string,
 *   payloadJson?: object | null,
 * }} params
 * @returns {Promise<object>} The created Job record
 */
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
        prisma.projectSnapshot.findUnique({ where: { id: snapshotId }, select: { id: true, projectId: true } }),
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

/**
 * Creates a generic job for any valid job type.
 *
 * @param {{
 *   projectId:    string,
 *   snapshotId:   string,
 *   userId:       string,
 *   type:         string,
 *   payloadJson?: object | null,
 * }} params
 * @returns {Promise<object>} The created Job record
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
        throw new ServiceError(`Invalid job type. Must be one of: ${JOB_TYPES.join(", ")}`, 400);
    }

    const [snapshot, user] = await Promise.all([
        prisma.projectSnapshot.findUnique({ where: { id: snapshotId }, select: { id: true, projectId: true } }),
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
// Typed convenience creators (thin wrappers to avoid repetition at call sites)
// ---------------------------------------------------------------------------

const createTypedJob = (type) =>
    ({ projectId, snapshotId, userId }) =>
        createSnapshotJob({
            projectId,
            snapshotId,
            userId,
            type,
            payloadJson: { snapshotId },
        });

/** Creates a queued INSTALL_DEPS job for a snapshot. */
export const createInstallDepsJob = createTypedJob("INSTALL_DEPS");

/** Creates a queued RUN_TESTS job for a snapshot. */
export const createRunTestsJob = createTypedJob("RUN_TESTS");

/** Creates a queued AI_SUGGEST job for a snapshot. */
export const createAiSuggestJob = createTypedJob("AI_SUGGEST");

/** Creates a queued AI_TESTS job for a snapshot. */
export const createAiTestsJob = createTypedJob("AI_TESTS");

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Updates the numeric progress of a running job (clamped 0–100).
 *
 * @param {string} jobId
 * @param {number} progress  0–100
 * @returns {Promise<object>} Updated Job record
 */
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

/**
 * Transitions a QUEUED job to RUNNING.
 *
 * @param {string} jobId
 * @returns {Promise<object>} Updated Job record
 */
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

/**
 * Transitions a RUNNING job to SUCCESS, persisting the result payload.
 * Also upserts a JobOutput record and fires a finish notification.
 *
 * @param {string}  jobId
 * @param {object}  [resultJson={}]
 * @returns {Promise<object>} Updated Job record
 */
export const markJobSuccess = async (jobId, resultJson) => {
    assertStringField(jobId, "jobId");

    const currentJob = await prisma.job.findUnique({
        where: { id: jobId },
        select: { id: true, status: true, userId: true, projectId: true },
    });

    if (!currentJob) throw new ServiceError("Job not found", 404);
    if (currentJob.status !== "RUNNING")
        throw new ServiceError("Only running jobs can be marked as succeeded", 400);

    const resultString = JSON.stringify(resultJson ?? {});

    const [job] = await Promise.all([
        prisma.job.update({
            where: { id: jobId },
            data: {
                status: "SUCCESS",
                progress: 100,
                finishedAt: new Date(),
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

    // Non-critical — failure must not roll back the job status update.
    try {
        await notificationService.createJobFinishedNotification(
            currentJob.userId,
            currentJob.projectId
        );
    } catch (err) {
        console.error(`[job.service] Notification failed for job ${jobId}:`, err);
    }

    return job;
};

/**
 * Transitions a RUNNING job to FAILED, storing the error message.
 *
 * @param {string}          jobId
 * @param {unknown}         error  Any thrown value
 * @returns {Promise<object>} Updated Job record
 */
export const markJobFailed = async (jobId, error) => {
    assertStringField(jobId, "jobId");

    const normalizedError = normalizeJobError(error);

    const currentJob = await prisma.job.findUnique({
        where: { id: jobId },
        select: { id: true, status: true },
    });

    if (!currentJob) throw new ServiceError("Job not found", 404);
    if (currentJob.status !== "RUNNING")
        throw new ServiceError("Only running jobs can be marked as failed", 400);

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

/**
 * Cancels a QUEUED or RUNNING job.
 *
 * @param {string} jobId
 * @returns {Promise<object>} Updated Job record
 */
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

/**
 * Retries a FAILED INGEST job by creating a new job for the same snapshot.
 *
 * @param {string} jobId  ID of the failed job to retry
 * @returns {Promise<object>} The newly created Job record
 */
export const retryJob = async (jobId) => {
    assertStringField(jobId, "jobId");

    const oldJob = await prisma.job.findUnique({ where: { id: jobId } });

    if (!oldJob) throw new ServiceError("Job not found", 404);
    if (oldJob.status !== "FAILED")
        throw new ServiceError("Only failed jobs can be retried", 400);
    if (!oldJob.snapshotId) throw new ServiceError("Job has no associated snapshot", 400);
    if (!oldJob.userId) throw new ServiceError("Job has no owner", 400);
    if (oldJob.type !== "INGEST")
        throw new ServiceError("Only INGEST jobs can be retried", 400);

    // Verify the snapshot still exists and belongs to the project.
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

/**
 * Fetches a single job with its snapshot, logs, and output.
 *
 * @param {string} jobId
 * @returns {Promise<object>}
 */
export const getJobById = async (jobId) => {
    assertStringField(jobId, "jobId");

    const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: { snapshot: true, logs: { orderBy: { createdAt: "asc" } }, output: true },
    });

    if (!job) throw new ServiceError("Job not found", 404);
    return job;
};

/**
 * Returns all jobs for a project, newest first.
 *
 * @param {string} projectId
 * @returns {Promise<object[]>}
 */
export const getProjectJobs = async (projectId) => {
    assertStringField(projectId, "projectId");
    return prisma.job.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
    });
};

/**
 * Returns all QUEUED or RUNNING jobs for a project.
 *
 * @param {string} projectId
 * @returns {Promise<object[]>}
 */
export const getRunningJobs = async (projectId) => {
    assertStringField(projectId, "projectId");
    return prisma.job.findMany({
        where: { projectId, status: { in: ["QUEUED", "RUNNING"] } },
    });
};

/**
 * Returns aggregated job status counts for a project.
 *
 * @param {string} projectId
 * @returns {Promise<{ queued: number, running: number, success: number, failed: number }>}
 */
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