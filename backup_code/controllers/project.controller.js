import { parseCreateProject } from "../validators/project.validation.js";
import { processIngestJob } from "../services/ingestJob.service.js";
import { processRunTestsJob } from "../services/runTestsJob.service.js";
import { parseCoverageFilesForSnapshot } from "../services/coverageFileParser.service.js";
import { parseCoverageFunctionsForSnapshot } from "../services/coverageFunctionParser.service.js";
import { GitHubCloneService } from "../services/githubClone.service.js";
import { createAiSuggestJob } from "../services/job.service.js";
import { processAiSuggestJob } from "../services/aiSuggestJob.service.js";
import { generateText } from "../services/gemini.service.js";
import { checkAndIncrementQuota } from "../services/aiQuota.service.js";
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
  createAnalysisJob,
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
      if (error instanceof ServiceError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      console.error(error);
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
      if (error instanceof ServiceError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      console.error(error);
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

      // The Firebase upload and ZIP extraction run fully in the background inside uploadProjectZip.
      // The response is sent immediately below.
      result._uploadPromise
        .catch((err) => {
          console.error("[UploadZip] Background pipeline error:", err);
        });

      // Respond immediately — the job already exists in DB with QUEUED status
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

  async runAiSuggest(req, res) {
    try {
      const { id: projectId } = req.params;
      const { snapshotId } = req.body;

      if (!snapshotId || typeof snapshotId !== "string") {
        return res.status(400).json({
          success: false,
          message: "snapshotId is required and must be a string",
        });
      }

      const job = await createAiSuggestJob({
        projectId,
        snapshotId,
        userId: req.user.id,
      });

      // Kick-off full pipeline bất đồng bộ (không await)
      processAiSuggestJob(job.id).catch((err) => {
        console.error("Lỗi khi chạy AI_SUGGEST pipeline ngầm:", err);
      });

      return res.status(202).json({
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

  async chat(req, res) {
    try {
      const { id: projectId } = req.params;
      const { message, history } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({
          success: false,
          message: "Message is required and must be a string",
        });
      }

      // Check and increment AI daily quota
      await checkAndIncrementQuota(req.user.id);

      // We just ensure project exists to provide context
      const project = await getProjectById(projectId);

      let prompt = `You are a helpful AI coding assistant named TestCovAI Agent. You assist users with code coverage, testing, and general programming questions.
The user is working on project: ${project.name}.
`;

      if (history && Array.isArray(history) && history.length > 0) {
        prompt += "\n--- Conversation History ---\n";
        history.forEach((msg) => {
          prompt += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n`;
        });
        prompt += "----------------------------\n";
      }

      prompt += `\nUser: ${message}\nAssistant:`;

      const reply = await generateText(prompt);

      return res.status(200).json({
        success: true,
        data: {
          reply,
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

  async getCfg(req, res) {
    try {
      const { id: projectId } = req.params;
      let { snapshotId } = req.query;

      // Verify project ownership
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: req.user.id }
      });
      if (!project) {
        return res.status(404).json({ success: false, message: "Project not found or unauthorized" });
      }

      if (!snapshotId) {
        const latestSnapshot = await prisma.projectSnapshot.findFirst({
          where: { projectId },
          orderBy: { createdAt: 'desc' }
        });
        if (!latestSnapshot) {
           return res.status(404).json({ success: false, message: "No snapshot found for this project" });
        }
        snapshotId = latestSnapshot.id;
      }

      const cfgs = await prisma.cfg.findMany({
        where: { snapshotId }
      });

      return res.status(200).json({
        success: true,
        data: cfgs,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }

  async getCc(req, res) {
    try {
      const { id: projectId } = req.params;
      let { snapshotId } = req.query;

      // Verify project ownership
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: req.user.id }
      });
      if (!project) {
        return res.status(404).json({ success: false, message: "Project not found or unauthorized" });
      }

      if (!snapshotId) {
        const latestSnapshot = await prisma.projectSnapshot.findFirst({
          where: { projectId },
          orderBy: { createdAt: 'desc' }
        });
        if (!latestSnapshot) {
           return res.status(404).json({ success: false, message: "No snapshot found for this project" });
        }
        snapshotId = latestSnapshot.id;
      }

      const ccs = await prisma.cyclomatic.findMany({
        where: { snapshotId },
        orderBy: { value: 'desc' }
      });

      return res.status(200).json({
        success: true,
        data: ccs,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
}

export default new ProjectController();
