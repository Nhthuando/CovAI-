import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { detectTestingFrameworks } from "../utils/testingFrameworkDetector.js";

/**
 * Priority order for recommending a single framework when multiple are detected.
 * Lower index = higher priority.
 */
const FRAMEWORK_PRIORITY = ["jest", "vitest"];

/**
 * Selects the recommended framework from a detection result.
 * Returns the highest-priority detected framework, or null when none are found.
 *
 * @param {string[]} detectedFrameworks
 * @returns {string|null}
 */
function resolveRecommendedFramework(detectedFrameworks) {
    for (const name of FRAMEWORK_PRIORITY) {
        if (detectedFrameworks.includes(name)) return name;
    }
    return detectedFrameworks[0] ?? null;
}

/**
 * Resolves the local rootDir for a project, verifying that the requesting user
 * owns the project and that at least one ingested snapshot with a rootDir exists.
 *
 * @param {string} projectId
 * @param {string} userId
 * @returns {Promise<string>} - Absolute path to the project root on disk.
 */
async function resolveOwnedProjectRoot(projectId, userId) {
    if (!projectId || typeof projectId !== "string") {
        throw new ServiceError("projectId is required", 400);
    }

    const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: userId },
        select: { id: true },
    });

    if (!project) {
        throw new ServiceError("Project not found or unauthorized", 404);
    }

    const snapshot = await prisma.projectSnapshot.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        select: { rootDir: true },
    });

    if (!snapshot?.rootDir) {
        throw new ServiceError("Project snapshot not ready", 404);
    }

    return snapshot.rootDir;
}

/**
 * Detects all unit-test frameworks present in a project and returns a unified
 * summary including test file information and a framework recommendation.
 *
 * Subtasks covered:
 *  - Verify project ownership     (resolveOwnedProjectRoot)
 *  - Return detected frameworks   (detectedFrameworks, frameworkType)
 *  - Return test file information (testFiles, testFileCount)
 *  - Return recommended framework (recommendedFramework)
 *  - Handle project without tests (frameworkType === "none", hasTests === false)
 *
 * @param {string} projectId
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function detectProjectFrameworks(projectId, userId) {
    const rootDir = await resolveOwnedProjectRoot(projectId, userId);

    const detection = detectTestingFrameworks(rootDir);

    const hasTests = detection.testFileCount > 0;
    const recommendedFramework = resolveRecommendedFramework(detection.detectedFrameworks);

    return {
        detectedFrameworks: detection.detectedFrameworks,
        primaryFramework: detection.primaryFramework,
        recommendedFramework,
        frameworkType: detection.frameworkType,
        hasMultipleFrameworks: detection.hasMultipleFrameworks,
        hasTests,
        testFiles: detection.testFiles,
        testFileCount: detection.testFileCount,
        frameworks: detection.frameworks,
        errors: detection.errors,
    };
}
