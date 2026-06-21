import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { addJobLog } from "./job.service.js";

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

const parseDate = (v) => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d;
};

const JOB_STATUSES = ["QUEUED", "RUNNING", "SUCCESS", "FAILED", "CANCELED"];

/**
 * Update multiple job fields atomically with validations.
 * Accepts any of: status, progress, startedAt, finishedAt, errorMessage
 */
export const updateJobStatus = async ({
    jobId,
    status, // optional
    progress, // optional number 0-100
    startedAt, // optional Date|string
    finishedAt, // optional Date|string
    errorMessage, // optional string
}) => {
    assertStringField(jobId, "jobId");

    const currentJob = await prisma.job.findUnique({ where: { id: jobId } });
    if (!currentJob) {
        throw new ServiceError("Job not found", 404);
    }

    const updates = {};
    const logs = [];

    // Status change validations
    if (typeof status !== "undefined" && status !== null) {
        if (!JOB_STATUSES.includes(status)) {
            throw new ServiceError("Invalid job status", 400);
        }

        if (status === "RUNNING") {
            if (currentJob.status !== "QUEUED") {
                throw new ServiceError("Only queued jobs can start", 400);
            }
            updates.status = "RUNNING";
            const d = parseDate(startedAt) || new Date();
            updates.startedAt = d;
            logs.push(`Status -> RUNNING; startedAt ${d.toISOString()}`);
        } else if (status === "SUCCESS") {
            if (currentJob.status !== "RUNNING") {
                throw new ServiceError("Only running jobs can be marked success", 400);
            }
            updates.status = "SUCCESS";
            updates.progress = 100;
            updates.finishedAt = parseDate(finishedAt) || new Date();
            logs.push(`Status -> SUCCESS; finishedAt ${updates.finishedAt.toISOString()}`);
        } else if (status === "FAILED") {
            if (currentJob.status !== "RUNNING") {
                throw new ServiceError("Only running jobs can be marked failed", 400);
            }
            updates.status = "FAILED";
            updates.finishedAt = parseDate(finishedAt) || new Date();
            if (typeof errorMessage === "string" && errorMessage.trim().length > 0) {
                updates.errorMessage = errorMessage;
            }
            logs.push(`Status -> FAILED; finishedAt ${updates.finishedAt.toISOString()}`);
        } else if (status === "CANCELED") {
            if (!["QUEUED", "RUNNING"].includes(currentJob.status)) {
                throw new ServiceError("Only queued or running jobs can be canceled", 400);
            }
            updates.status = "CANCELED";
            updates.finishedAt = parseDate(finishedAt) || new Date();
            logs.push(`Status -> CANCELED; finishedAt ${updates.finishedAt.toISOString()}`);
        } else if (status === "QUEUED") {
            // Allow resetting to QUEUED only if job is not running/finished
            if (currentJob.status !== "QUEUED") {
                throw new ServiceError("Cannot set status back to QUEUED", 400);
            }
        }
    }

    // Progress
    if (typeof progress !== "undefined" && progress !== null) {
        assertNumberField(progress, "progress");
        if (["SUCCESS", "FAILED", "CANCELED"].includes(currentJob.status) && typeof updates.status === "undefined") {
            throw new ServiceError("Cannot update progress for completed job", 400);
        }
        const clamped = Math.max(0, Math.min(100, progress));
        updates.progress = clamped;
        logs.push(`Progress -> ${clamped}%`);
    }

    // startedAt / finishedAt manual updates (if not handled above)
    if (typeof startedAt !== "undefined" && startedAt !== null) {
        const d = parseDate(startedAt);
        if (!d) throw new ServiceError("Invalid startedAt", 400);
        updates.startedAt = d;
        logs.push(`startedAt -> ${d.toISOString()}`);
    }

    if (typeof finishedAt !== "undefined" && finishedAt !== null) {
        const d = parseDate(finishedAt);
        if (!d) throw new ServiceError("Invalid finishedAt", 400);
        updates.finishedAt = d;
        logs.push(`finishedAt -> ${d.toISOString()}`);
    }

    if (typeof errorMessage !== "undefined" && errorMessage !== null) {
        if (typeof errorMessage !== "string") {
            throw new ServiceError("errorMessage must be a string", 400);
        }
        // allow setting/updating errorMessage only when job is failed or being set to failed
        const targetStatus = updates.status || currentJob.status;
        if (targetStatus !== "FAILED") {
            throw new ServiceError("errorMessage can only be set for failed jobs", 400);
        }
        updates.errorMessage = errorMessage;
        logs.push(`errorMessage -> ${errorMessage}`);
    }

    if (Object.keys(updates).length === 0) {
        throw new ServiceError("No updates provided", 400);
    }

    const updated = await prisma.job.update({
        where: { id: jobId },
        data: updates,
    });

    // write logs
    for (const l of logs) {
        await addJobLog(jobId, "INFO", l).catch(() => { });
    }

    return updated;
};
