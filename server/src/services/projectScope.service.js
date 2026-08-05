import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

const notFound = () => new ServiceError("Project or snapshot not found", 404);

export const resolveOwnedProjectSnapshot = async ({ projectId, snapshotId, userId, requireRoot = false }) => {
    const project = await prisma.project.findFirst({ where: { id: projectId, ownerId: userId }, select: { id: true } });
    if (!project) throw notFound();
    const snapshot = await prisma.projectSnapshot.findFirst({
        where: { ...(snapshotId ? { id: snapshotId } : {}), projectId },
        orderBy: snapshotId ? undefined : { createdAt: "desc" },
    });
    if (!snapshot) throw notFound();
    if (requireRoot && !snapshot.rootDir) throw new ServiceError("Project snapshot is not ready for analysis", 409);
    return { project, snapshot };
};

export const resolveOwnedJob = async ({ jobId, userId }) => {
    const job = await prisma.job.findFirst({ where: { id: jobId, project: { ownerId: userId } }, include: { logs: { orderBy: { createdAt: "asc" } }, output: true } });
    if (!job) throw new ServiceError("Job not found", 404);
    return job;
};
