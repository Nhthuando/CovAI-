import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { detectJest } from "../utils/jestDetector.js";

export async function detectJestMetadata(projectId) {
    if (!projectId || typeof projectId !== "string") {
        throw new ServiceError("projectId is required", 400);
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId },
    });

    if (!project) {
        throw new ServiceError("Project not found", 404);
    }

    return detectJest(project.rootDir);
}

export async function detectAndSaveProject(projectId) {
    const detection = await detectJestMetadata(projectId);

    await prisma.project.update({
        where: { id: projectId },
        data: {
            hasJest: detection.hasJest,
            jestConfigPath: detection.configPath,
            jestCommand: detection.jestCommand,
        },
    });

    return detection;
}