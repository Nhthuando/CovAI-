import prisma from "../config/prisma.js";
import { parseCreateProject } from "../validators/project.validation.js";
import { detectJest } from "../utils/jestDetector.js";
import { detectAndSaveProject } from "../services/jestDetection.service.js";

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
            const user = await prisma.user.findUnique({ where: { id: effectiveOwnerId } });
            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // Business rules: unique name per user
            const existingProject = await prisma.project.findFirst({
                where: { ownerId: effectiveOwnerId, name },
            });
            if (existingProject) {
                return res.status(409).json({ success: false, message: "Project already exists" });
            }

            // Business rules: limit number of projects per user (20)
            const totalProjects = await prisma.project.count({ where: { ownerId: effectiveOwnerId } });
            if (totalProjects >= 20) {
                return res.status(400).json({ success: false, message: "Maximum number of projects reached" });
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
                return res.status(409).json({ success: false, message: "Duplicate data" });
            }

            if (error && error.code === "P2025") {
                return res.status(404).json({ success: false, message: "Record not found" });
            }

            return res.status(500).json({ success: false, message: "Internal server error" });
        }
    }

    /**
     * GET /projects
     */
    async listProjects(req, res) {
        try {
            // Require authenticated user for listing projects
            if (!req.user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const projects = await prisma.project.findMany({
                where: { ownerId: req.user.id },
                orderBy: { createdAt: "desc" },
                include: {
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

            return res.status(200).json({ success: true, count: projects.length, data: projects });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ success: false, message: "Failed to get projects" });
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
            console.log("REQ USER:", req.user);
            console.log("PROJECT OWNER:", project.ownerId);
            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found",
                });
            }
            if (!req.user || project.ownerId !== req.user.id) {
                return res.status(403).json({ success: false, message: "You are not allowed to delete this project" });
            }

            // Check running jobs
            const runningJobs = await prisma.job.count({ where: { projectId: id, status: "RUNNING" } });
            if (runningJobs > 0) {
                return res.status(409).json({ success: false, message: "Cannot delete project while jobs are running" });
            }

            await prisma.project.delete({ where: { id } });

            return res.status(200).json({ success: true, message: "Project deleted successfully" });
        } catch (error) {
            console.error(error);

            if (error && error.code === "P2025") {
                return res.status(404).json({ success: false, message: "Record not found" });
            }

            return res.status(500).json({ success: false, message: "Internal server error" });
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
}

export default new ProjectController();