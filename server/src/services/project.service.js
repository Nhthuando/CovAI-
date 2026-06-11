import prisma from "../config/prisma.js";
import { detectJest } from "../utils/jestDetector.js";
import { detectAndSaveProject } from "./jestDetection.service.js";
import { createSnapshotIngestJob, createSnapshotJob } from "./job.service.js";
import { getBucket } from "../config/firebase.js";
import { scanZipBomb } from "../middlewares/upload.middleware.js";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { ServiceError } from "../utils/serviceError.js";

export { ServiceError };

export const createProject = async ({ input, currentUserId }) => {
    const {
        ownerId,
        name,
        description,
        repoUrl,
        defaultBranch,
        rootDir,
        jestConfigPath,
    } = input;

    const effectiveOwnerId = currentUserId || ownerId;
    if (!effectiveOwnerId) {
        throw new ServiceError("ownerId is required", 400);
    }

    const user = await prisma.user.findUnique({ where: { id: effectiveOwnerId } });
    if (!user) {
        throw new ServiceError("User not found", 404);
    }

    const existingProject = await prisma.project.findFirst({
        where: { ownerId: effectiveOwnerId, name },
    });
    if (existingProject) {
        throw new ServiceError("Project already exists", 409);
    }

    const totalProjects = await prisma.project.count({
        where: { ownerId: effectiveOwnerId },
    });
    if (totalProjects >= 20) {
        throw new ServiceError("Maximum number of projects reached", 400);
    }

    let hasJest = false;
    let detectedJestConfig = jestConfigPath || null;
    let detectedJestCommand = null;

    if (rootDir) {
        const detection = detectJest(rootDir);
        hasJest = detection.hasJest;
        detectedJestConfig = detection.configPath || jestConfigPath;
        detectedJestCommand = detection.jestCommand;
    }

    const project = await prisma.project.create({
        data: {
            ownerId: effectiveOwnerId,
            name,
            description,
            repoUrl,
            defaultBranch,
            rootDir,
            hasJest,
            jestConfigPath: detectedJestConfig,
            jestCommand: detectedJestCommand,
        },
    });

    return project;
};

export const listProjects = async (userId) => {
    return prisma.project.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            name: true,
            description: true,
            repoUrl: true,
            defaultBranch: true,
            rootDir: true,
            jestConfigPath: true,
            storageBasePath: true,
            createdAt: true,
            updatedAt: true,
            _count: {
                select: {
                    snapshots: true,
                },
            },
        },
    });
};

export const getProjectById = async (projectId) => {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            owner: {
                select: {
                    id: true,
                    email: true,
                    name: true,
                },
            },
            _count: {
                select: {
                    snapshots: true,
                    jobs: true,
                    aiTests: true,
                    aiSuggestions: true,
                },
            },
        },
    });

    if (!project) {
        throw new ServiceError("Project not found", 404);
    }

    return project;
};

export const uploadProjectZip = async ({ projectId, file, userId }) => {
    if (!file) {
        throw new ServiceError("No file uploaded", 400);
    }

    const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: userId },
    });
    if (!project) {
        throw new ServiceError("Project not found or you don't have permission", 404);
    }

    try {
        await scanZipBomb(file.buffer);
    } catch (scanError) {
        throw new ServiceError(scanError.message, 400);
    }

    const checksum = createHash("sha256").update(file.buffer).digest("hex");
    const duplicateSnapshot = await prisma.projectSnapshot.findFirst({
        where: { projectId, checksum },
    });
    if (duplicateSnapshot) {
        throw new ServiceError("Duplicate snapshot already exists", 409);
    }

    const safeOriginalName = path
        .basename(file.originalname)
        .replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueFileName = `${randomUUID()}-${safeOriginalName}`;
    const storagePath = `projects/${projectId}/${uniqueFileName}`;
    const blob = getBucket().file(storagePath);

    await new Promise((resolve, reject) => {
        const blobStream = blob.createWriteStream({
            metadata: { contentType: file.mimetype },
        });

        blobStream.on("error", reject);
        blobStream.on("finish", resolve);
        blobStream.end(file.buffer);
    });

    try {
        const { snapshot, job } = await createSnapshotIngestJob({
            projectId,
            userId,
            checksum,
            storagePath,
        });

        return {
            snapshot,
            job,
            file: {
                originalName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                storagePath,
            },
        };
    } catch (error) {
        await blob.delete().catch(() => { });
        throw error;
    }
};

export const detectJestConfig = async (projectId) => {
    return detectAndSaveProject(projectId);
};

export const createAnalysisJob = async ({
    projectId,
    snapshotId,
    userId,
}) => {
    if (!projectId || typeof projectId !== "string") {
        throw new ServiceError("projectId is required", 400);
    }

    if (!snapshotId || typeof snapshotId !== "string") {
        throw new ServiceError("snapshotId is required", 400);
    }

    if (!userId || typeof userId !== "string") {
        throw new ServiceError("userId is required", 400);
    }

    const project = await prisma.project.findFirst({
        where: {
            id: projectId,
            ownerId: userId,
        },
    });
    console.log("projectId =", projectId);
    console.log("userId =", userId);
    if (!project) {
        throw new ServiceError(
            "Project not found or you don't have permission",
            404
        );
    }

    const snapshot = await prisma.projectSnapshot.findFirst({
        where: {
            id: snapshotId,
            projectId,
        },
    });

    if (!snapshot) {
        throw new ServiceError(
            "Snapshot not found",
            404
        );
    }

    return createSnapshotJob({
        projectId,
        snapshotId,
        userId,
        type: "BUILD_CFG",
    });
};

export const deleteProject = async (projectId, userId) => {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
        throw new ServiceError("Project not found", 404);
    }
    if (project.ownerId !== userId) {
        throw new ServiceError("You are not allowed to delete this project", 403);
    }

    const runningJobs = await prisma.job.count({
        where: { projectId, status: "RUNNING" },
    });
    if (runningJobs > 0) {
        throw new ServiceError("Cannot delete project while jobs are running", 409);
    }

    await prisma.project.delete({ where: { id: projectId } });
};
