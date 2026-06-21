import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { addJobLog } from "./job.service.js";

const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};

/**
 * Save or replace job output (stdout/stderr).
 */
export const saveJobOutput = async (jobId, { stdout = null, stderr = null } = {}) => {
    assertStringField(jobId, "jobId");

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
        throw new ServiceError("Job not found", 404);
    }

    const data = {};
    if (typeof stdout === "string") data.stdout = stdout;
    if (typeof stderr === "string") data.stderr = stderr;

    if (Object.keys(data).length === 0) {
        throw new ServiceError("No output provided", 400);
    }

    const result = await prisma.jobOutput.upsert({
        where: { jobId },
        create: { jobId, ...data },
        update: { ...data },
    });

    await addJobLog(jobId, "INFO", "Job output saved").catch(() => { });
    return result;
};

/**
 * Append text to existing stdout/stderr (creates record if missing).
 */
export const appendJobOutput = async (jobId, { stdout = null, stderr = null } = {}) => {
    assertStringField(jobId, "jobId");

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
        throw new ServiceError("Job not found", 404);
    }

    const existing = await prisma.jobOutput.findUnique({ where: { jobId } });

    const newStdout = (existing?.stdout || "") + (typeof stdout === "string" ? stdout : "");
    const newStderr = (existing?.stderr || "") + (typeof stderr === "string" ? stderr : "");

    const result = await prisma.jobOutput.upsert({
        where: { jobId },
        create: { jobId, stdout: newStdout, stderr: newStderr },
        update: { stdout: newStdout, stderr: newStderr },
    });

    await addJobLog(jobId, "INFO", "Job output appended").catch(() => { });
    return result;
};

/**
 * Get output for a job.
 */
export const getOutputByJob = async (jobId) => {
    assertStringField(jobId, "jobId");

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
        throw new ServiceError("Job not found", 404);
    }

    const out = await prisma.jobOutput.findUnique({ where: { jobId } });
    return out || { jobId, stdout: null, stderr: null };
};
