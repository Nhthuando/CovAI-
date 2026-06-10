import { parseCreateProject } from "../validators/project.validation.js";
import { processIngestJob } from "../services/ingestJob.service.js";
import {
    ServiceError,
    createProject,
    listProjects,
    getProjectById,
    uploadProjectZip,
    detectJestConfig,
    deleteProject,
} from "../services/project.service.js";

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

            const project = await createProject({
                input: validation.data,
                currentUserId: req.user?.id,
            });

            return res.status(201).json({ success: true, data: project });
        } catch (error) {
            console.error(error);

            if (error instanceof ServiceError) {
                return res
                    .status(error.statusCode)
                    .json({ success: false, message: error.message });
            }

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
            const projects = await listProjects(req.user.id);

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
            const project = await getProjectById(id);

            return res.status(200).json({ success: true, data: project });
        } catch (error) {
            console.error(error);

            if (error instanceof ServiceError) {
                return res
                    .status(error.statusCode)
                    .json({ success: false, message: error.message });
            }

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

            const result = await uploadProjectZip({
                projectId,
                file,
                userId: req.user.id,
            });

            processIngestJob(result.job.id).catch((err) => {
                console.error("Lỗi khi chạy Job ngầm:", err);
            });

            return res.status(201).json({
                success: true,
                message: "Snapshot và Job được tạo thành công",
                snapshot: {
                    id: result.snapshot.id,
                    projectId: result.snapshot.projectId,
                    source: result.snapshot.source,
                    checksum: result.snapshot.checksum,
                    storagePath: result.snapshot.storagePath,
                    createdAt: result.snapshot.createdAt,
                },
                job: {
                    id: result.job.id,
                    status: result.job.status,
                    progress: result.job.progress,
                },
                file: result.file,
            });
        } catch (error) {
            console.error(error);

            if (error instanceof ServiceError) {
                return res
                    .status(error.statusCode)
                    .json({ success: false, message: error.message });
            }

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
            const detection = await detectJestConfig(id);

            return res.status(200).json({ success: true, data: detection });
        } catch (error) {
            console.error(error);

            if (error instanceof ServiceError) {
                return res
                    .status(error.statusCode)
                    .json({ success: false, message: error.message });
            }

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
            await deleteProject(id, req.user.id);

            return res
                .status(200)
                .json({ success: true, message: "Project deleted successfully" });
        } catch (error) {
            console.error(error);

            if (error instanceof ServiceError) {
                return res
                    .status(error.statusCode)
                    .json({ success: false, message: error.message });
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
}

export default new ProjectController();
