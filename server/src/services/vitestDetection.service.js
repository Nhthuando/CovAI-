import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { detectVitest } from "../utils/vitestDetector.js";

/**
 * Retrieves the project and runs the Vitest detection utility.
 * @param {string} projectId - The ID of the project to scan.
 * @returns {Promise<object>} - The detection result object.
 */
export async function detectVitestMetadata(projectId) {
    if (!projectId || typeof projectId !== "string") {
        throw new ServiceError("projectId is required", 400);
    }

    const project = await prisma.project.findUnique({
        where: { id: projectId },
    });

    if (!project) {
        throw new ServiceError("Project not found", 404);
    }

    // Pass the root directory to our utility
    return detectVitest(project.rootDir);
}

/**
 * Runs the detection and immediately updates the Project record in the database.
 * @param {string} projectId - The ID of the project to scan and update.
 * @returns {Promise<object>} - The detection result object.
 */
export async function detectAndSaveProject(projectId) {
    const detection = await detectVitestMetadata(projectId);

    await prisma.project.update({
        where: { id: projectId },
        data: {
            hasVitest: detection.hasVitest,
            vitestConfigPath: detection.configPath,
            vitestCommand: detection.vitestCommand,
        },
    });

    return detection;
}
