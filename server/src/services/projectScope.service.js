import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveProjectAccess } from './projectAccess.service.js';

const notFound = () => new ServiceError("Project or snapshot not found", 404);

export const resolveLatestOwnedProjectSnapshot = async ({ projectId, userId, requireRoot = false, capability = 'project.read' }) => {
    const { project } = await resolveProjectAccess({ projectId, userId, capability });

    const snapshot = await prisma.projectSnapshot.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" },
    });

    if (!snapshot || (requireRoot && !snapshot.rootDir)) {
        throw new ServiceError("Project upload is still processing; try again when a snapshot is ready", 409);
    }

    return { project, snapshot };
};

export const resolveOwnedProjectSnapshot = async ({ projectId, snapshotId, userId, requireRoot = false, capability = 'project.read' }) => {
    const { project } = await resolveProjectAccess({ projectId, userId, capability });
    const snapshot = await prisma.projectSnapshot.findFirst({
        where: { ...(snapshotId ? { id: snapshotId } : {}), projectId },
        orderBy: snapshotId ? undefined : { createdAt: "desc" },
    });
    if (!snapshot) throw notFound();
    if (requireRoot && !snapshot.rootDir) throw new ServiceError("Project snapshot is not ready for analysis", 409);
    return { project, snapshot };
};

export const resolveOwnedJob = async ({ jobId, userId }) => {
    const job = await prisma.job.findFirst({ where: { id: jobId }, include: { logs: { orderBy: { createdAt: "asc" } }, output: true } });
    if (!job) throw new ServiceError("Job not found", 404);
    await resolveProjectAccess({projectId:job.projectId,userId,capability:'project.read'});
    return job;
};
