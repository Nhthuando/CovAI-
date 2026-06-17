import { parseCreateProject } from "../validators/project.validation.js";
import { processIngestJob } from "../services/ingestJob.service.js";
import { processRunTestsJob } from "../services/runTestsJob.service.js";
import { parseCoverageFilesForSnapshot } from "../services/coverageFileParser.service.js";
import { parseCoverageFunctionsForSnapshot } from "../services/coverageFunctionParser.service.js";
import { GitHubCloneService } from "../services/githubClone.service.js";
import prisma from "../config/prisma.js";
import {
  ServiceError,
  createProject,
  listProjects,
  getProjectById,
  uploadProjectZip,
  detectJestConfig,
  deleteProject,
  getProjectTree,
  getFileContent,
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
   * GET /projects/:id/tree
   */
  async getProjectTree(req, res) {
    try {
      const { id } = req.params;
      const tree = await getProjectTree(id, req.user.id);
      return res.status(200).json({ success: true, data: tree });
    } catch (error) {
      console.error(error);
      if (error instanceof ServiceError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      return res.status(500).json({
        success: false,
        message: "Failed to get project tree",
      });
    }
  }

  /**
   * GET /projects/:id/file-content?path=...
   */
  async getFileContent(req, res) {
    try {
      const { id } = req.params;
      const filePath = req.query.path;

      if (!filePath) {
        return res.status(400).json({
          success: false,
          message: "File path is required as a query parameter",
        });
      }

      const result = await getFileContent(id, req.user.id, filePath);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error(error);
      if (error instanceof ServiceError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      return res.status(500).json({
        success: false,
        message: "Failed to read file content",
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

  async runAnalysis(req, res) {
    try {
      const { id: projectId } = req.params;
      const { snapshotId } = req.body;

      if (!snapshotId || typeof snapshotId !== "string") {
        return res.status(400).json({
          success: false,
          message: "snapshotId is required and must be a string",
        });
      }

      const job = await createAnalysisJob({
        projectId,
        snapshotId,
        userId: req.user.id,
      });

      // SCRUM-138..144: Kick-off full pipeline bất đồng bộ (không await)
      processRunTestsJob(job.id).catch((err) => {
        console.error("Lỗi khi chạy RUN_TESTS pipeline ngầm:", err);
      });

      return res.status(201).json({
        success: true,
        data: {
          job: {
            id: job.id,
            type: job.type,
            snapshotId: job.snapshotId,
            status: job.status,
            progress: job.progress,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
          },
        },
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

  async parseCoverageFiles(req, res) {
    try {
      const { id: projectId } = req.params;
      const { snapshotId, coverageReport } = req.body;

      if (!snapshotId || typeof snapshotId !== "string") {
        return res.status(400).json({
          success: false,
          message: "snapshotId is required and must be a string",
        });
      }

      if (!coverageReport || typeof coverageReport !== "object") {
        return res.status(400).json({
          success: false,
          message: "coverageReport is required and must be an object",
        });
      }

      const coverageResult = await parseCoverageFilesForSnapshot({
        projectId,
        snapshotId,
        coverageReport,
        userId: req.user.id,
      });

      return res.status(200).json({
        success: true,
        data: coverageResult,
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

  async parseCoverageFunctions(req, res) {
    try {
      const { id: projectId } = req.params;
      const { snapshotId, coverageReport } = req.body;

      if (!snapshotId || typeof snapshotId !== "string") {
        return res.status(400).json({
          success: false,
          message: "snapshotId is required and must be a string",
        });
      }

      if (!coverageReport || typeof coverageReport !== "object") {
        return res.status(400).json({
          success: false,
          message: "coverageReport is required and must be an object",
        });
      }

      const coverageResult = await parseCoverageFunctionsForSnapshot({
        projectId,
        snapshotId,
        coverageReport,
        userId: req.user.id,
      });

      return res.status(201).json({
        success: true,
        data: coverageResult,
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

  async importGitHub(req, res) {
    try {
      const { id: projectId } = req.params;
      const { owner, repo } = req.body;

      if (!owner || !repo) {
        return res
          .status(400)
          .json({ success: false, message: "Owner and repo are required" });
      }

      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: req.user.id },
      });

      if (!project) {
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      }

      const { localPath, commitSha } = await GitHubCloneService.cloneRepository(
        req.user.id,
        projectId,
        owner,
        repo,
      );

      const duplicate = await prisma.projectSnapshot.findFirst({
        where: { projectId, commitSha },
      });

      if (duplicate) {
        return res
          .status(409)
          .json({ success: false, message: "Duplicate snapshot" });
      }

      const snapshot = await prisma.projectSnapshot.create({
        data: {
          projectId,
          source: "GITHUB",
          commitSha,
          storagePath: localPath,
        },
      });

      return res.status(201).json({
        message: "Repository imported successfully",
        snapshot: {
          id: snapshot.id,
          projectId: snapshot.projectId,
          source: snapshot.source,
          commitSha: snapshot.commitSha,
          storagePath: snapshot.storagePath,
          createdAt: snapshot.createdAt,
        },
      });
    } catch (error) {
      console.error(error);

      if (error instanceof ServiceError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }

      return res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  }
}

export default new ProjectController();
