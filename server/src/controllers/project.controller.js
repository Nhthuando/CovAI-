import prisma from "../config/prisma.js";
import { parseCreateProject } from "../validators/project.validation.js";
import { detectJest } from "../utils/jestDetector.js";
import { detectAndSaveProject } from "../services/jestDetection.service.js";
import crypto from "crypto";
import path from "path";
import { getBucket } from "../config/firebase.js";
import { scanZipBomb } from "../middlewares/upload.middleware.js";

class ProjectController {
    /**
     * POST /projects
     */
    async createProject(req, res) {
        try {
            const validation = parseCreateProject(req.body);
            if (!validation.success) {
                return res.status(400).json({
                    success: false,
                    message: validation.error.message,
                });
            }

            const {
                ownerId,
                name,
                description,
                repoUrl,
                defaultBranch,
                rootDir,
                jestConfigPath,
            } = validation.data;

            // Determine ownerId: prefer authenticated user if present
            const effectiveOwnerId = req.user?.id || ownerId;
            if (!effectiveOwnerId) {
                return res.status(400).json({
                    success: false,
                    message: "ownerId is required",
                });
            }

            // Validate owner exists
            const user = await prisma.user.findUnique({
                where: { id: effectiveOwnerId },
            });
            if (!user) {
                return res
                    .status(404)
                    .json({ success: false, message: "User not found" });
            }

            // Business rules: unique name per user
            const existingProject = await prisma.project.findFirst({
                where: { ownerId: effectiveOwnerId, name },
            });
            if (existingProject) {
                return res
                    .status(409)
                    .json({ success: false, message: "Project already exists" });
            }

            // Business rules: limit number of projects per user (20)
            const totalProjects = await prisma.project.count({
                where: { ownerId: effectiveOwnerId },
            });
            if (totalProjects >= 20) {
                return res.status(400).json({
                    success: false,
                    message: "Maximum number of projects reached",
                });
            }

            // Auto-detect Jest if rootDir is provided
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

            return res.status(201).json({ success: true, data: project });
        } catch (error) {
            console.error(error);

            // Prisma specific errors
            if (error && error.code === "P2002") {
                return res
                    .status(409)
                    .json({ success: false, message: "Duplicate data" });
            }

            if (error && error.code === "P2025") {
                return res
                    .status(404)
                    .json({ success: false, message: "Record not found" });
            }

            return res
                .status(500)
                .json({ success: false, message: "Internal server error" });
        }
    }

    /**
     * GET /projects
     */
    async listProjects(req, res) {
        try {
            const projects = await prisma.project.findMany({
                where: { ownerId: req.user.id },
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

            return res.status(200).json({
                projects: projects.map((p) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    repoUrl: p.repoUrl,
                    defaultBranch: p.defaultBranch,
                    rootDir: p.rootDir,
                    jestConfigPath: p.jestConfigPath,
                    storageBasePath: p.storageBasePath,
                    createdAt: p.createdAt,
                    updatedAt: p.updatedAt,
                    snapshotCount: p._count.snapshots,
                })),
            });
        } catch (error) {
            console.error(error);
            return res
                .status(500)
                .json({ success: false, message: "Failed to get projects" });
        }
    }

    /**
     * GET /projects/:id
     */
    async getProjectById(req, res) {
        try {
            const { id } = req.params;

            const project = await prisma.project.findUnique({
                where: {
                    id,
                },
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
                return res.status(404).json({
                    success: false,
                    message: "Project not found",
                });
            }

            return res.status(200).json({
                success: true,
                data: project,
            });
        } catch (error) {
            console.error(error);

            return res.status(500).json({
                success: false,
                message: "Failed to get project",
            });
        }
    }

    /**
     * POST /projects/:id/upload-zip
     */
    async uploadZip(req, res) {
        try {
            const { id: projectId } = req.params;
            const file = req.file;

            // Verify project ID from route params
            if (!projectId || projectId.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "Project ID is required",
                });
            }

            // Verify authenticated user
            if (!req.user?.id) {
                return res.status(401).json({
                    success: false,
                    message: "Unauthorized",
                });
            }

            // Verify file exists
            if (!file) {
                return res.status(400).json({
                    success: false,
                    message: "No file uploaded",
                });
            }

            // Verify file extension
            const ext = path.extname(file.originalname).toLowerCase();
            if (ext !== ".zip") {
                return res.status(400).json({
                    success: false,
                    message: "Only .zip files are accepted",
                });
            }

            // Verify file size
            const MAX_FILE_SIZE = 20 * 1024 * 1024;
            if (file.size > MAX_FILE_SIZE) {
                return res.status(400).json({
                    success: false,
                    message: "File size exceeds limit (20MB)",
                });
            }

            // Verify project exists and user is owner
            const project = await prisma.project.findFirst({
                where: { id: projectId, ownerId: req.user.id },
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found or you don't have permission",
                });
            }

            // Scan for zip bombs
            try {
                await scanZipBomb(file.buffer);
            } catch (scanError) {
                return res.status(400).json({
                    success: false,
                    message: scanError.message,
                });
            }

            // Generate SHA256 checksum
            const checksum = crypto
                .createHash("sha256")
                .update(file.buffer)
                .digest("hex");

            // Check for duplicate snapshot
            const existingSnapshot = await prisma.projectSnapshot.findFirst({
                where: {
                    projectId,
                    checksum,
                },
            });

            if (existingSnapshot) {
                return res.status(409).json({
                    success: false,
                    message: "Duplicate snapshot already exists",
                });
            }

            // Generate unique filename
            const safeOriginalName = path
                .basename(file.originalname)
                .replace(/[^a-zA-Z0-9._-]/g, "_");
            const uniqueFileName = `${crypto.randomUUID()}-${safeOriginalName}`;
            const storagePath = `projects/${projectId}/${uniqueFileName}`;

            // Upload to Firebase
            const blob = getBucket().file(storagePath);
            const blobStream = blob.createWriteStream({
                metadata: { contentType: file.mimetype },
            });

            blobStream.on("error", (err) => {
                console.error("Firebase upload error:", err);
                return res.status(500).json({
                    success: false,
                    message: "Firebase upload failed: " + err.message,
                });
            });

            blobStream.on("finish", async () => {
                try {
                    // Create ProjectSnapshot
                    const snapshot = await prisma.projectSnapshot.create({
                        data: {
                            projectId,
                            source: "ZIP",
                            checksum,
                            storagePath,
                        },
                    });

                    return res.status(201).json({
                        success: true,
                        message: "Snapshot created successfully",
                        snapshot: {
                            id: snapshot.id,
                            projectId: snapshot.projectId,
                            source: snapshot.source,
                            checksum: snapshot.checksum,
                            storagePath: snapshot.storagePath,
                            createdAt: snapshot.createdAt,
                        },
                    });
                } catch (dbError) {
                    console.error("Database error:", dbError);
                    // Rollback Firebase upload on DB error
                    await blob.delete().catch(() => { });
                    return res.status(500).json({
                        success: false,
                        message: "Database error, uploaded file cleaned up",
                    });
                }
            });

            blobStream.end(file.buffer);
        } catch (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Internal server error",
            });
        }
    }

    /**
     * POST /projects/:id/detect-jest
     */
    async detectJestConfig(req, res) {
        try {
            const { id } = req.params;

            const detection = await detectAndSaveProject(id);

            return res.status(200).json({
                success: true,
                data: detection,
            });
        } catch (error) {
            console.error(error);

            return res.status(500).json({
                success: false,
                message: error.message,
            });
        }
    }

    /**
     * DELETE /projects/:id
     */
    async deleteProject(req, res) {
        try {
            const { id } = req.params;

            const project = await prisma.project.findUnique({
                where: {
                    id,
                },
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found",
                });
            }
            if (!req.user || project.ownerId !== req.user.id) {
                return res.status(403).json({
                    success: false,
                    message: "You are not allowed to delete this project",
                });
            }

            // Check running jobs
            const runningJobs = await prisma.job.count({
                where: { projectId: id, status: "RUNNING" },
            });
            if (runningJobs > 0) {
                return res.status(409).json({
                    success: false,
                    message: "Cannot delete project while jobs are running",
                });
            }

            await prisma.project.delete({ where: { id } });

            return res
                .status(200)
                .json({ success: true, message: "Project deleted successfully" });
        } catch (error) {
            console.error(error);

            if (error && error.code === "P2025") {
                return res
                    .status(404)
                    .json({ success: false, message: "Record not found" });
            }

            return res
                .status(500)
                .json({ success: false, message: "Internal server error" });
        }
    }
}

export default new ProjectController();
