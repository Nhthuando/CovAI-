import prisma from "../config/prisma.js";
import { detectJest } from "../utils/jestDetector.js";

export async function detectAndSaveProject(projectId) {

    const project = await prisma.project.findUnique({
        where: { id: projectId },
    });

    if (!project) {
        throw new Error("Project not found");
    }

    const detection = detectJest(project.rootDir);

    await prisma.project.update({
        where: {
            id: projectId,
        },
        data: {
            hasJest: detection.hasJest,
            jestConfigPath: detection.configPath,
            jestCommand: detection.jestCommand,
        },
    });

    return detection;
}