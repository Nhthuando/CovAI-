import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { detectPlaywright } from "../utils/playwrightDetector.js";

export async function detectPlaywrightMetadata(projectId) {
    if (!projectId || typeof projectId !== "string") {
        throw new ServiceError("projectId is required", 400);
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId },
    });

    if (!project) {
        throw new ServiceError("Project not found", 404);
    }

    return detectPlaywright(project.rootDir);
}

export async function detectAndSaveProject(projectId) {
    const detection = await detectPlaywrightMetadata(projectId);

    await prisma.project.update({
        where: { id: projectId },
        data: {
            hasPlaywright: detection.hasPlaywright,
            playwrightConfigPath: detection.configPath,
            playwrightCommand: detection.playwrightCommand,
            playwrightTestDir: detection.testDir,
            playwrightBrowsers: detection.browsers
        },
    });

    return detection;
}
