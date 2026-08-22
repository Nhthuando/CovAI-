import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { detectCypress } from "../utils/cypressDetector.js";

export async function detectCypressMetadata(projectId) {
    if (!projectId || typeof projectId !== "string") {
        throw new ServiceError("projectId is required", 400);
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId },
    });

    if (!project) {
        throw new ServiceError("Project not found", 404);
    }

    const snapshot = await prisma.projectSnapshot.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" },
    });

    const rootDir = snapshot?.rootDir || project.rootDir;
    if (!rootDir) {
        throw new ServiceError("Project directory is not ready.", 400);
    }

    return detectCypress(rootDir);
}