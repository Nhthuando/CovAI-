import prisma from "../config/prisma.js";
import { detectJest } from "../utils/jestDetector.js";
import { detectAndSaveProject } from "./jestDetection.service.js";
import { createSnapshotIngestJob, createRunTestsJob } from "./job.service.js";
import { getBucket } from "../config/firebase.js";
import { scanArchiveBomb } from "../middlewares/upload.middleware.js";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { ServiceError } from "../utils/serviceError.js";
import fs from "fs";

export { ServiceError };

function buildTree(dirPath, rootPath = dirPath) {
    const result = [];
    try {
        if (!fs.existsSync(dirPath)) return result;
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
            if (item === "node_modules" || item === ".git") continue;

            const itemPath = path.join(dirPath, item);
            const stat = fs.statSync(itemPath);
            const relativePath = path.relative(rootPath, itemPath).replace(/\\/g, "/");

            if (stat.isDirectory()) {
                const children = buildTree(itemPath, rootPath);
                result.push({
                    id: relativePath,
                    name: item,
                    type: "folder",
                    children
                });
            } else {
                let lang = "file";
                const ext = path.extname(item).toLowerCase();
                if (ext === ".js" || ext === ".jsx") lang = "js";
                else if (ext === ".ts" || ext === ".tsx") lang = "ts";
                else if (ext === ".json") lang = "json";
                else if (ext === ".css") lang = "css";
                else if (ext === ".md") lang = "md";
                else if (ext.includes("test") || ext.includes("spec")) lang = "test";

                if (ext === ".jsx" || ext === ".tsx") lang = "react";

                result.push({
                    id: relativePath,
                    name: item,
                    type: "file",
                    lang
                });
            }
        }
    } catch (e) {
        console.error(e);
    }

    result.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === "folder" ? -1 : 1;
    });

    return result;
}

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
            snapshots: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { id: true }
            },
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
        await scanArchiveBomb(file.buffer, file.originalname);
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

    // ── Build the Firebase storage path (but don't upload yet) ────────
    const safeOriginalName = path
        .basename(file.originalname)
        .replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueFileName = `${randomUUID()}-${safeOriginalName}`;
    const storagePath = `projects/${projectId}/${uniqueFileName}`;

    // ── Create Snapshot + Job in DB FIRST so it appears in Job Queue ──
    const { snapshot, job } = await createSnapshotIngestJob({
        projectId,
        userId,
        checksum,
        storagePath,
    });

    const uploadAndProcess = async () => {
        try {
            // Update job to RUNNING immediately as we start processing
            const { markJobRunning, updateJobProgress, markJobSuccess, markJobFailed } = await import("./job.service.js");
            const { extractZipSnapshot } = await import("./zipExtraction.service.js");
            
            try { await markJobRunning(job.id); } catch (_) {}
            
            const blob = getBucket().file(storagePath);
            const uploadPromise = new Promise((resolve, reject) => {
                const blobStream = blob.createWriteStream({
                    metadata: { contentType: file.mimetype },
                    resumable: false,
                });
                blobStream.on("error", reject);
                blobStream.on("finish", resolve);
                blobStream.end(file.buffer);
            }).then(() => updateJobProgress(job.id, 50).catch(() => {}));

            const extractPromise = extractZipSnapshot(snapshot.id, storagePath, file.buffer).then((path) => {
                updateJobProgress(job.id, 90).catch(() => {});
                return path;
            });

            const [_, sourcePath] = await Promise.all([uploadPromise, extractPromise]);

            if (!sourcePath || typeof sourcePath !== "string") {
                throw new Error("Extracted source path is invalid");
            }

            await prisma.projectSnapshot.update({
                where: { id: snapshot.id },
                data: { rootDir: sourcePath },
            });

            // Sau khi giải nén, detect Jest metadata ngay
            const { detectJest } = await import("../utils/jestDetector.js");
            const detection = detectJest(sourcePath);
            
            await prisma.projectSnapshot.update({
                where: { id: snapshot.id },
                data: { 
                   hasJest: detection.hasJest,
                   jestCommand: detection.jestCommand
                },
            });

            await prisma.project.update({
                where: { id: projectId },
                data: {
                   hasJest: detection.hasJest,
                   jestConfigPath: detection.configPath,
                   jestCommand: detection.jestCommand
                },
            });

            await updateJobProgress(job.id, 100).catch(() => {});
            await markJobSuccess(job.id, { rootDir: sourcePath });
            console.log(`[Job ${job.id}] Pipeline upload & ingest hoàn thành: ${sourcePath}`);

        } catch (uploadErr) {
            console.error(`[UploadProjectZip] Firebase upload or ingest failed for Job ${job.id}:`, uploadErr);
            const { markJobFailed } = await import("./job.service.js");
            try { await markJobFailed(job.id, uploadErr); } catch (_) {}
            throw uploadErr;
        }
    };

    return {
        snapshot,
        job,
        file: {
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            storagePath,
        },
        // Expose the upload promise so the controller can chain processing after it
        _uploadPromise: uploadAndProcess(),
    };
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

    // SCRUM-138: Tạo RUN_TESTS job cho pipeline coverage analysis
    const runTestsJob = await createRunTestsJob({
        projectId,
        snapshotId,
        userId,
    });

    // Tạo BUILD_CFG job
    const { createSnapshotJob } = await import("./job.service.js");
    await createSnapshotJob({
        projectId,
        snapshotId,
        userId,
        type: "BUILD_CFG",
    });

    return runTestsJob;
};

export const deleteProject = async (projectId, userId) => {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
        throw new ServiceError("Project not found", 404);
    }
    if (project.ownerId !== userId) {
        throw new ServiceError("You are not allowed to delete this project", 403);
    }

    // Allow deletion even if there are zombie running jobs
    // The transaction below will clean up all jobs via cascading.

    // Fetch snapshots BEFORE they are deleted from DB so we can clean up local dirs + Firebase
    const snapshots = await prisma.projectSnapshot.findMany({
        where: { projectId },
        select: { rootDir: true, storagePath: true }
    });

    await prisma.$transaction(
        [
            prisma.coverageSummary.deleteMany({ where: { snapshot: { projectId } } }),
            prisma.coverageFile.deleteMany({ where: { snapshot: { projectId } } }),
            prisma.coverageFunction.deleteMany({ where: { snapshot: { projectId } } }),
            prisma.cyclomatic.deleteMany({ where: { snapshot: { projectId } } }),
            prisma.cfg.deleteMany({ where: { snapshot: { projectId } } }),
            prisma.aiContextCache.deleteMany({ where: { snapshot: { projectId } } }),
            prisma.aiSuggestion.deleteMany({ where: { projectId } }),
            prisma.aiTest.deleteMany({ where: { projectId } }),
            prisma.jobLog.deleteMany({ where: { job: { projectId } } }),
            prisma.jobOutput.deleteMany({ where: { job: { projectId } } }),
            prisma.job.deleteMany({ where: { projectId } }),
            prisma.notification.deleteMany({ where: { projectId } }),
            prisma.projectSnapshot.deleteMany({ where: { projectId } }),
            prisma.project.delete({ where: { id: projectId } })
        ],
        { timeout: 30000 } // 30 seconds — enough for large projects
    );

    // ── Cleanup Firebase Storage files ─────────────────────────────────
    try {
        const bucket = getBucket();

        // Delete individual snapshot files
        for (const snap of snapshots) {
            if (snap.storagePath) {
                try {
                    await bucket.file(snap.storagePath).delete();
                    console.log(`[DeleteProject] Deleted Firebase file: ${snap.storagePath}`);
                } catch (fbErr) {
                    // File may already be deleted or not exist — skip silently
                    if (fbErr.code !== 404) {
                        console.warn(`[DeleteProject] Failed to delete Firebase file ${snap.storagePath}:`, fbErr.message);
                    }
                }
            }
        }

        // Also try to delete the entire projects/{projectId}/ prefix
        try {
            const [files] = await bucket.getFiles({ prefix: `projects/${projectId}/` });
            if (files.length > 0) {
                await Promise.all(files.map(file => file.delete().catch(() => {})));
                console.log(`[DeleteProject] Deleted ${files.length} remaining Firebase files for project ${projectId}`);
            }
        } catch (prefixErr) {
            console.warn(`[DeleteProject] Failed to cleanup Firebase prefix for ${projectId}:`, prefixErr.message);
        }
    } catch (fbCleanupErr) {
        console.error("[DeleteProject] Firebase cleanup error:", fbCleanupErr);
        // Don't throw — DB deletion already succeeded
    }

    // ── Cleanup physical local storage directories ─────────────────────
    try {
        for (const snap of snapshots) {
            if (snap.rootDir && fs.existsSync(snap.rootDir)) {
                fs.rmSync(snap.rootDir, { recursive: true, force: true });
            }
        }

        // Clean up the base project storage dir if exists
        const projectStoragePath = path.resolve("storage/projects", projectId);
        if (fs.existsSync(projectStoragePath)) {
            fs.rmSync(projectStoragePath, { recursive: true, force: true });
        }
    } catch (cleanupError) {
        console.error("Lỗi xóa file vật lý của project:", cleanupError);
    }
};

export const getProjectTree = async (projectId, userId) => {
    const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: userId },
    });
    if (!project) throw new ServiceError("Project not found", 404);

    const snapshot = await prisma.projectSnapshot.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" }
    });

    if (!snapshot || !snapshot.rootDir) {
        throw new ServiceError("Project snapshot not ready", 404);
    }

    const tree = buildTree(snapshot.rootDir);
    return tree;
};

export const getFileContent = async (projectId, userId, filePath) => {
    const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: userId },
    });
    if (!project) throw new ServiceError("Project not found", 404);

    const snapshot = await prisma.projectSnapshot.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" },
    });

    if (!snapshot || !snapshot.rootDir) {
        throw new ServiceError("Project snapshot not ready", 404);
    }

    // Sanitize the file path to prevent directory traversal
    const normalizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
    const absolutePath = path.join(snapshot.rootDir, normalizedPath);

    // Ensure the resolved path is still within the snapshot rootDir
    const resolvedRoot = path.resolve(snapshot.rootDir);
    const resolvedFile = path.resolve(absolutePath);
    if (!resolvedFile.startsWith(resolvedRoot)) {
        throw new ServiceError("Invalid file path", 400);
    }

    if (!fs.existsSync(resolvedFile)) {
        throw new ServiceError("File not found", 404);
    }

    const stat = fs.statSync(resolvedFile);
    if (stat.isDirectory()) {
        throw new ServiceError("Path is a directory, not a file", 400);
    }

    // Limit file size to 1MB
    if (stat.size > 1024 * 1024) {
        throw new ServiceError("File too large to display", 413);
    }

    const content = fs.readFileSync(resolvedFile, "utf-8");
    return { content, size: stat.size };
};
