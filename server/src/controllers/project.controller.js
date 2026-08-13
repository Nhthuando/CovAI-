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
import { getAiTestById, listAiTests } from "../services/aiTest.service.js";
import prisma from "../config/prisma.js";
import {
  ServiceError,
  createProject,
  listProjects,
  getProjectById,
  uploadProjectZip,
  detectJestConfig,
  detectVitestConfig,
  detectPlaywrightConfig,
  deleteProject,
  getProjectTree,
  getFileContent,
  createCoverageAnalysisJob,
  getProjectStructureAnalysis,
  listProjectSnapshots,
  resolveCoverageAnalysisSnapshot,
  startProjectStructureAnalysis,
  updateFileContent,
  createProjectFile,
  createProjectFolder,
  renameProjectEntry,
  deleteProjectEntry,
} from "../services/project.service.js";
import { createBuildCfgJob } from "../services/job.service.js";
import { addJobToQueue } from "../services/queue.service.js";
import { analysisJobResponse } from "../services/analysisResponse.service.js";

const handleEntryMutation = async (req, res, operation, failureMessage) => {
  try {
    const result = await operation(
      req.params.id,
      req.user.id,
      req.body.path,
      req.body.content,
      req.body.newPath,
    );
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ServiceError)
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    console.error(error);
    return res.status(500).json({ success: false, message: failureMessage });
  }
};

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
          latestSnapshotId: p.snapshots?.[0]?.id || null,
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
   * GET /projects/:id/snapshots
   * Snapshot metadata is deliberately selector-safe: no host paths, source,
   * or storage locations can cross this controller boundary.
   */
  async listSnapshots(req, res) {
    try {
      const data = await listProjectSnapshots({
        projectId: req.params.id,
        userId: req.user.id,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      console.error(error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to get snapshots" });
    }
  }

  /**
   * GET /projects/:id/structure-analysis?snapshotId=...
   * Reads an existing architecture map only; it never starts background work.
   */
  async getStructureAnalysis(req, res) {
    try {
      const data = await getProjectStructureAnalysis({
        projectId: req.params.id,
        snapshotId: req.query.snapshotId,
        userId: req.user.id,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Failed to get architecture analysis",
      });
    }
  }

  /**
   * POST /projects/:id/structure-analysis
   * Starts snapshot-bound static architecture analysis.
   */
  async runStructureAnalysis(req, res) {
    try {
      const queuedJob = await startProjectStructureAnalysis({
        projectId: req.params.id,
        snapshotId: req.body?.snapshotId,
        userId: req.user.id,
      });
      const reused = queuedJob.reused === true;
      const { reused: _reused, ...job } = queuedJob;
      const safeJob = analysisJobResponse(job);

      if (!reused) {
        addJobToQueue("ANALYSIS", job.id).catch((queueError) => {
          console.error("Could not queue architecture analysis", queueError);
        });
      }

      return res.status(reused ? 200 : 201).json({
        success: true,
        reused,
        needsTests: false,
        snapshotId: job.snapshotId,
        job: safeJob,
        data: { job: safeJob },
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      }
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Failed to start architecture analysis",
      });
    }
  }

  /**
   * Legacy implementation retained temporarily for an explicit coverage route.
   */
  async listSnapshotsUnsafe(req, res) {
    try {
      const { id: projectId } = req.params;

      // Verify project ownership
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: req.user.id },
      });
      if (!project) {
        return res.status(404).json({
          success: false,
          message: "Project not found or unauthorized",
        });
      }

      const snapshots = await prisma.projectSnapshot.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          source: true,
          checksum: true,
          commitSha: true,
          storagePath: true,
          rootDir: true,
          hasJest: true,
          jestCommand: true,
          createdAt: true,
        },
      });

      return res.status(200).json({
        success: true,
        data: snapshots,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Failed to get snapshots",
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
   * PUT /projects/:id/file-content
   * Body: { path, content }
   */
  async updateFileContent(req, res) {
    try {
      const { id } = req.params;
      const { path: filePath, content } = req.body;

      if (!filePath || typeof content !== "string") {
        return res.status(400).json({
          success: false,
          message: "File path and text content are required",
        });
      }

      const result = await updateFileContent(
        id,
        req.user.id,
        filePath,
        content,
      );
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
        message: "Failed to save file content",
      });
    }
  }

  async createFile(req, res) {
    return handleEntryMutation(
      req,
      res,
      createProjectFile,
      "Failed to create file",
    );
  }

  async createFolder(req, res) {
    return handleEntryMutation(
      req,
      res,
      createProjectFolder,
      "Failed to create folder",
    );
  }

  async renameEntry(req, res) {
    return handleEntryMutation(
      req,
      res,
      renameProjectEntry,
      "Failed to rename entry",
    );
  }

  async deleteEntry(req, res) {
    try {
      const result = await deleteProjectEntry(
        req.params.id,
        req.user.id,
        req.query.path,
      );
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error instanceof ServiceError)
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      console.error(error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to delete entry" });
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
      result._uploadPromise.catch((err) => {
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

  async runCoverageAnalysis(req, res) {
    try {
      const { id: projectId } = req.params;
      const targetSnapshot = await resolveCoverageAnalysisSnapshot({
        projectId,
        snapshotId: req.body?.snapshotId,
        userId: req.user.id,
      });

      if (!targetSnapshot.hasJest) {
        return res.status(200).json({
          success: true,
          needsTests: true,
          snapshotId: targetSnapshot.id,
          message:
            "Dự án chưa có file test. Vui lòng tạo test trước khi chạy phân tích.",
        });
      }

      const queuedJob = await createCoverageAnalysisJob({
        projectId,
        snapshotId: targetSnapshot.id,
        userId: req.user.id,
      });
      const reused = queuedJob.reused === true;
      const { reused: _reused, ...job } = queuedJob;

      // SCRUM-138..144: Kick-off full pipeline bất đồng bộ qua Queue
      if (!reused)
        addJobToQueue("RUN_TESTS", job.id).catch((err) => {
          console.error("Lỗi khi thêm RUN_TESTS vào queue:", err);
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

  async buildCfg(req, res) {
    try {
      const { id: projectId } = req.params;
      let snapshotId = req.body?.snapshotId;

      // Auto-resolve to latest snapshot if not provided
      if (!snapshotId) {
        const latestSnapshot = await prisma.projectSnapshot.findFirst({
          where: { projectId },
          orderBy: { createdAt: "desc" },
        });
        if (!latestSnapshot) {
          return res.status(404).json({
            success: false,
            message:
              "No snapshot found for this project. Please upload a project first.",
          });
        }
        snapshotId = latestSnapshot.id;
      }

      const job = await createBuildCfgJob({
        projectId,
        snapshotId,
        userId: req.user.id,
      });

      addJobToQueue("BUILD_CFG", job.id).catch((err) => {
        console.error("Lỗi khi thêm BUILD_CFG vào queue:", err);
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
   * POST /project/:id/detect-vitest
   */
  async detectVitestConfig(req, res) {
    try {
      const { id } = req.params;
      const detection = await detectVitestConfig(id);
   * POST /projects/:id/detect-playwright
   */
  async detectPlaywrightConfig(req, res) {
    try {
      const { id } = req.params;
      const detection = await detectPlaywrightConfig(id);

      return res.status(200).json({ success: true, data: detection });
    } catch (error) {
      console.error(error);

      if (error.statusCode) {
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
   * POST /projects/:id/run-playwright
   */
  async runPlaywrightTests(req, res) {
    try {
      const { id: projectId } = req.params;
      const { testDirectory, snapshotId } = req.body;

      const { createPlaywrightJob } =
        await import("../services/job.service.js");

      const job = await createPlaywrightJob({
        projectId,
        snapshotId,
        testDirectory,
        userId: req.user.id,
      });

      addJobToQueue("RUN_PLAYWRIGHT_TESTS", job.id).catch((err) => {
        console.error("Lỗi khi thêm RUN_PLAYWRIGHT_TESTS vào queue:", err);
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

  /**
   * POST /projects/:id/run-integration-tests
   */
  async runIntegrationTests(req, res) {
    try {
      const { id: projectId } = req.params;
      const { snapshotId } = req.body;

      const { runIntegrationTestPipeline } =
        await import("../services/integrationTest.orchestrator.js");

      const result = await runIntegrationTestPipeline({
        projectId,
        snapshotId,
        userId: req.user.id,
      });

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
        message: "Internal server error",
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
      addJobToQueue("AI_SUGGEST", job.id).catch((err) => {
        console.error("Lỗi khi thêm AI_SUGGEST vào queue:", err);
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

  async runAiTests(req, res) {
    try {
      const { id: projectId } = req.params;
      let snapshotId = req.body?.snapshotId;

      if (!snapshotId) {
        const latestSnapshot = await prisma.projectSnapshot.findFirst({
          where: { projectId },
          orderBy: { createdAt: "desc" },
        });
        if (!latestSnapshot) {
          return res.status(404).json({
            success: false,
            message: "No snapshot found for this project",
          });
        }
        snapshotId = latestSnapshot.id;
      }

      const { createAiTestsJob } = await import("../services/job.service.js");
      const { processAiTestsJob } =
        await import("../services/aiTestsJob.service.js");

      const job = await createAiTestsJob({
        projectId,
        snapshotId,
        userId: req.user.id,
      });

      addJobToQueue("AI_TESTS", job.id).catch((err) => {
        console.error("Lỗi khi thêm AI_TESTS vào queue:", err);
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

      if (message.trim().toLowerCase() === "analyze coverage") {
        const latestSnapshot = await prisma.projectSnapshot.findFirst({
          where: { projectId },
          orderBy: { createdAt: "desc" },
        });

        if (latestSnapshot) {
          const summary = await prisma.coverageSummary.findUnique({
            where: { snapshotId: latestSnapshot.id },
          });
          const files = await prisma.coverageFile.findMany({
            where: { snapshotId: latestSnapshot.id },
          });

          if (summary && files.length > 0) {
            prompt += `\n--- Coverage Data for Analysis ---\n`;
            prompt += `Overall Coverage: Lines ${summary.linesPct}%, Branches ${summary.branchesPct}%, Functions ${summary.funcsPct}%, Statements ${summary.stmtsPct}%\n`;
            prompt += `File Coverage Details:\n`;
            files.forEach((f) => {
              prompt += `- ${f.filePath}: Lines ${f.linesPct}%, Branches ${f.branchesPct}%, Functions ${f.funcsPct}%\n`;
            });
            prompt += `----------------------------------\n`;
            prompt += `Please analyze this coverage data, point out any critical files lacking tests, and suggest which files/functions the user should write tests for next. Do not ask for the coverage report, as it is provided above.\n`;
          } else {
            prompt += `\n(System Note: User requested coverage analysis, but no coverage data was found in the database. Please inform the user they need to run tests to generate coverage first.)\n`;
          }
        }
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
        where: { id: projectId, ownerId: req.user.id },
      });
      if (!project) {
        return res.status(404).json({
          success: false,
          message: "Project not found or unauthorized",
        });
      }

      if (!snapshotId) {
        const latestSnapshot = await prisma.projectSnapshot.findFirst({
          where: { projectId },
          orderBy: { createdAt: "desc" },
        });
        if (!latestSnapshot) {
          return res.status(404).json({
            success: false,
            message: "No snapshot found for this project",
          });
        }
        snapshotId = latestSnapshot.id;
      }

      const cfgs = await prisma.cfg.findMany({
        where: { snapshotId },
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
        where: { id: projectId, ownerId: req.user.id },
      });
      if (!project) {
        return res.status(404).json({
          success: false,
          message: "Project not found or unauthorized",
        });
      }

      if (!snapshotId) {
        const latestSnapshot = await prisma.projectSnapshot.findFirst({
          where: { projectId },
          orderBy: { createdAt: "desc" },
        });
        if (!latestSnapshot) {
          return res.status(404).json({
            success: false,
            message: "No snapshot found for this project",
          });
        }
        snapshotId = latestSnapshot.id;
      }

      const ccs = await prisma.cyclomatic.findMany({
        where: { snapshotId },
        orderBy: { value: "desc" },
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

  async getAiTest(req, res) {
    try {
      const { id: projectId, testId } = req.params;

      const aiTest = await getAiTestById({
        projectId,
        testId,
        userId: req.user.id,
      });

      return res.status(200).json({ success: true, data: aiTest });
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

  async getAiTests(req, res) {
    try {
      const { id: projectId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const result = await listAiTests({
        projectId,
        userId: req.user.id,
        page,
        limit,
      });

      return res.status(200).json({ success: true, ...result });
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

  async generateIntegrationTest(req, res) {
    try {
      const { id: projectId } = req.params;
      const { snapshotId, framework } = req.body;

      if (!framework) {
        return res
          .status(400)
          .json({ success: false, message: "Framework is required" });
      }

      const { generateIntegrationTest } =
        await import("../services/aiTest.service.js");

      const aiTest = await generateIntegrationTest({
        projectId,
        snapshotId,
        userId: req.user.id,
        framework,
      });

      return res.status(201).json({ success: true, data: aiTest });
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
}

export default new ProjectController();
