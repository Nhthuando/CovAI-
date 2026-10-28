import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};

/**
 * Create a job log linked to a job.
 */
export const createJobLog = async (jobId, level, message) => {
    assertStringField(jobId, "jobId");
    assertStringField(level, "level");
    assertStringField(message, "message");

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
        throw new ServiceError("Job not found", 404);
    }

    return prisma.jobLog.create({
        data: {
            jobId,
            level,
            message,
        },
    });
};

export const info = async (jobId, message) => {
    return createJobLog(jobId, "INFO", message);
};

/**
 * Get logs for a job with optional pagination and order.
 */
export const getLogsByJob = async (jobId, { limit = 100, offset = 0, order = "desc" } = {}) => {
    assertStringField(jobId, "jobId");

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
        throw new ServiceError("Job not found", 404);
    }

    const take = Math.min(1000, Math.max(1, Number(limit) || 100));
    const skip = Math.max(0, Number(offset) || 0);
    const sort = order === "asc" ? "asc" : "desc";

    return prisma.jobLog.findMany({
        where: { jobId },
        orderBy: { createdAt: sort },
        take,
        skip,
    });
};
