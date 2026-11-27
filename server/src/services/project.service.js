import crypto from "node:crypto";
import { captureWorkspaceFiles } from "./projectWorkspacePublish.service.js";
import prisma from "../config/prisma.js";
import {
  membershipWhere,
  resolveProjectAccess,
  withProjectGuard,
  invalidateProjectAccessCache,
} from "./projectAccess.service.js";
import * as projectAccessModule from "./projectAccess.service.js";
import { assertEditorSnapshotChangeAllowed } from "./projectEditorBridge.service.js";
import {
  publishProjectEvent,
  deliverProjectEvent,
} from "./projectEvent.service.js";
import {
  readVersionedProjectFile,
  projectEditableWorkspaceRoot,
} from "./projectFileVersion.service.js";
import { mutateProjectWorkspace } from "./projectMutation.service.js";
import { detectJest } from "../utils/jestDetector.js";
import { detectAndSaveProject } from "./jestDetection.service.js";
import { detectFrameworks } from "./testDetection.service.js";
import { detectAndSaveProject as detectVitestAndSave } from "./vitestDetection.service.js";
import { detectCypressMetadata } from "./cypressDetection.service.js";
import {
  createAnalysisJob as createArchitectureAnalysisJob,
  createSnapshotIngestJob,
  createRunTestsJob,
} from "./job.service.js";
import {
  analysisResultResponse,
  snapshotResponse,
} from "./analysisResponse.service.js";
import {
  resolveLatestOwnedProjectSnapshot,
  resolveOwnedProjectSnapshot,
} from "./projectScope.service.js";
import { getBucket } from "../config/firebase.js";
import { scanArchiveBomb } from "../middlewares/upload.middleware.js";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { ServiceError } from "../utils/serviceError.js";
import fs from "fs";
import {
  validateNodeProject,
  validateArchiveContainsPackageJson,
} from "../utils/nodeProjectValidator.js";
import { validateArchiveLanguage } from "../utils/languageDetector.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
import {
  snapshotWorkspaceRoot,
  resolveSnapshotFile,
} from "../utils/snapshotWorkspace.js";
import { cleanupProjectStorageAsync } from "./projectStorageCleanup.service.js";
import {
  LIFECYCLE_MANAGE_CAPABILITY,
  validateLifecycleTransition,
} from "../../../shared/portfolioGovernance.js";

export { ServiceError };
export { cleanupProjectStorageAsync, buildTree };

const TREE_EXCLUDED_NAMES = new Set([
  "node_modules",
  ".git",
  "__MACOSX",
  ".DS_Store",
  ".covai_test_versions",
]);

function shouldSkipTreeEntry(item) {
  return (
    TREE_EXCLUDED_NAMES.has(item) ||
    item.startsWith(".covai-") ||
    item.startsWith(".covai_")
  );
}

function resolveFileLang(item) {
  const lowerName = item.toLowerCase();
  const ext = path.extname(item).toLowerCase();

  if (lowerName.includes(".test.") || lowerName.includes(".spec.")) return "test";
  if (ext === ".jsx" || ext === ".tsx") return "react";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "js";
  if (ext === ".ts") return "ts";
  if (ext === ".json") return "json";
  if (ext === ".css" || ext === ".scss" || ext === ".sass" || ext === ".less")
    return "css";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".md") return "md";
  if (
    ext === ".png" ||
    ext === ".jpg" ||
    ext === ".jpeg" ||
    ext === ".svg" ||
    ext === ".gif" ||
    ext === ".ico"
  )
    return "image";
  return "file";
}

function sortTreeNodes(nodes) {
  nodes.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === "folder" ? -1 : 1;
  });
  return nodes;
}

function buildTree(dirPath, rootPath = dirPath) {
  const result = [];
  if (!dirPath) return result;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const item = entry.name;
      if (shouldSkipTreeEntry(item) || entry.isSymbolicLink()) continue;

      const itemPath = path.join(dirPath, item);
      const relativePath = path
        .relative(rootPath, itemPath)
        .replace(/\\/g, "/");

      if (entry.isDirectory()) {
        const children = buildTree(itemPath, rootPath);
        result.push({
          id: relativePath,
          name: item,
          type: "folder",
          children,
        });
      } else {
        result.push({
          id: relativePath,
          name: item,
          type: "file",
          lang: resolveFileLang(item),
        });
      }
    }
  } catch (e) {
    if (e?.code !== "ENOENT" && e?.code !== "ENOTDIR") {
      console.error(e);
    }
  }

  return sortTreeNodes(result);
}

async function buildTreeAsync(dirPath, rootPath = dirPath) {
  if (!dirPath) return [];
  let entries;
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (e) {
    if (e?.code !== "ENOENT" && e?.code !== "ENOTDIR") {
      console.error(e);
    }
    return [];
  }

  const folderTasks = [];
  const files = [];

  for (const entry of entries) {
    const item = entry.name;
    if (shouldSkipTreeEntry(item) || entry.isSymbolicLink()) continue;

    const itemPath = path.join(dirPath, item);
    const relativePath = path.relative(rootPath, itemPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      folderTasks.push(
        buildTreeAsync(itemPath, rootPath).then((children) => ({
          id: relativePath,
          name: item,
          type: "folder",
          children,
        })),
      );
    } else {
      files.push({
        id: relativePath,
        name: item,
        type: "file",
        lang: resolveFileLang(item),
      });
    }
  }

  const folders = await Promise.all(folderTasks);
  return sortTreeNodes([...folders, ...files]);
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

  const user = await prisma.user.findUnique({
    where: { id: effectiveOwnerId },
  });
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

  // A new project must show up in the portfolio immediately, not after the
  // overview cache expires.
  try {
    const { clearPortfolioCache } =
      await import("./portfolioDashboard.service.js");
    clearPortfolioCache(effectiveOwnerId);
  } catch (error) {
    console.error(
      "[createProject] Portfolio cache invalidation failed:",
      error,
    );
  }
  return project;
};

/**
 * Read-time self-healing for Project.lifecycleStatus:
 * If a project is currently marked "NOT_STARTED" (or null) in the DB,
 * but already has activity (TestRuns, CoverageSummary, AiTests, AiSuggestions,
 * SystemScenarios, IntegrationScenarios, or >1 snapshots), automatically
 * heals the DB state to "DOING" and returns "DOING".
 * Explicit user overrides ("PAUSED", "COMPLETED", "CANCELLED") are never overwritten.
 */
export const healProjectLifecycleStatusIfNeeded = async (
  project,
  options = {},
) => {
  if (!project || typeof project !== "object") return "NOT_STARTED";

  const currentStatus = project.lifecycleStatus || "NOT_STARTED";
  if (currentStatus !== "NOT_STARTED") {
    return currentStatus;
  }

  const snapshots = Array.isArray(project.snapshots) ? project.snapshots : [];
  const hasSnapshotActivity = snapshots.some(
    (s) =>
      (s?._count?.testRuns || 0) > 0 ||
      (s?._count?.systemScenarios || 0) > 0 ||
      Boolean(s?.coverageSummaries || s?.coverageSummary),
  );

  const hasActivity =
    Boolean(options.hasActivity) ||
    (project._count?.snapshots || 0) > 1 ||
    (project._count?.aiTests || 0) > 0 ||
    (project._count?.aiSuggestions || 0) > 0 ||
    hasSnapshotActivity;

  if (!hasActivity) {
    project.lifecycleStatus = "NOT_STARTED";
    return "NOT_STARTED";
  }

  const now = new Date();
  project.lifecycleStatus = "DOING";
  project.lifecycleUpdatedAt = now;

  if (project.id) {
    prisma.project
      .updateMany({
        where: { id: project.id, lifecycleStatus: "NOT_STARTED" },
        data: {
          lifecycleStatus: "DOING",
          lifecycleUpdatedAt: now,
        },
      })
      .catch((err) => {
        console.error(
          "[healProjectLifecycleStatusIfNeeded] Failed to update project lifecycle:",
          err?.message || err,
        );
      });
  }

  return "DOING";
};

export const listProjects = async (userId) => {
  const projects = await prisma.project.findMany({
    where: membershipWhere(userId),
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
      activeSnapshotId: true,
      lifecycleStatus: true,
      lifecycleUpdatedAt: true,
      isPinned: true,
      createdAt: true,
      updatedAt: true,
      snapshots: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          coverageSummaries: { select: { id: true } },
          _count: {
            select: {
              testRuns: true,
              systemScenarios: true,
            },
          },
        },
      },
      _count: {
        select: {
          snapshots: true,
          aiTests: true,
          aiSuggestions: true,
        },
      },
    },
  });

  for (const p of projects) {
    healProjectLifecycleStatusIfNeeded(p);
  }
  return projects;
};

export const getProjectById = async (projectId, userId) => {
  const [, project] = await Promise.all([
    resolveProjectAccess({ projectId, userId, capability: "project.read" }),
    prisma.project.findUnique({
      where: { id: projectId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        snapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            coverageSummaries: { select: { id: true } },
            _count: {
              select: {
                testRuns: true,
                systemScenarios: true,
              },
            },
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
    }),
  ]);

  if (!project) {
    throw new ServiceError("Project not found", 404);
  }

  healProjectLifecycleStatusIfNeeded(project);

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
    if (file.path && fs.existsSync(file.path)) {
      try {
        fs.unlinkSync(file.path);
      } catch (_) {}
    }
    throw new ServiceError(
      "Project not found or you don't have permission",
      404,
    );
  }

  const filePath = file.path;
  const fileSource = filePath || file.buffer;

  try {
    await scanArchiveBomb(fileSource, file.originalname);
    await validateArchiveLanguage(fileSource, file.originalname);
  } catch (scanError) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {}
    }
    throw new ServiceError(scanError.message, 400);
  }

  let checksum;
  if (filePath && fs.existsSync(filePath)) {
    checksum = await new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  } else {
    checksum = createHash("sha256").update(file.buffer).digest("hex");
  }

  const duplicateSnapshot = await prisma.projectSnapshot.findFirst({
    where: { projectId, checksum },
  });
  if (duplicateSnapshot) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {}
    }
    throw new ServiceError("Duplicate snapshot already exists", 409);
  }

  const safeOriginalName = path
    .basename(file.originalname)
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueFileName = `${randomUUID()}-${safeOriginalName}`;
  const storagePath = `projects/${projectId}/${uniqueFileName}`;

  const { snapshot, job } = await createSnapshotIngestJob({
    projectId,
    userId,
    checksum,
    storagePath,
  });

  const uploadAndProcess = async () => {
    const { markJobRunning, updateJobProgress, markJobSuccess, markJobFailed } =
      await import("./job.service.js");
    const { extractZipSnapshot } = await import("./zipExtraction.service.js");

    try {
      await markJobRunning(job.id);
      const blob = getBucket().file(storagePath);
      const uploadPromise = new Promise((resolve, reject) => {
        const blobStream = blob.createWriteStream({
          metadata: { contentType: file.mimetype },
          resumable: false,
        });
        blobStream.on("error", reject);
        blobStream.on("finish", resolve);

        if (filePath && fs.existsSync(filePath)) {
          fs.createReadStream(filePath).pipe(blobStream);
        } else {
          blobStream.end(file.buffer);
        }
      }).then(() => updateJobProgress(job.id, 50).catch(() => {}));

      const extractPromise = extractZipSnapshot(
        snapshot.id,
        storagePath,
        fileSource,
      ).then((path) => {
        updateJobProgress(job.id, 90).catch(() => {});
        return path;
      });

      const [_, sourcePath] = await Promise.all([
        uploadPromise,
        extractPromise,
      ]);

      // Clean up temporary disk upload file after extraction & Firebase upload
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (_) {}
      }

      if (!sourcePath || typeof sourcePath !== "string") {
        throw new Error("Extracted source path is invalid");
      }

      const resolvedRootDir = resolveProjectRoot(sourcePath);
      const validation = await validateNodeProject(resolvedRootDir, {
        autoCreate: true,
      });

      await prisma.projectSnapshot.update({
        where: { id: snapshot.id },
        data: { rootDir: validation.rootDir },
      });

      const { detectJest } = await import("../utils/jestDetector.js");
      const detection = detectJest(validation.rootDir);

      await prisma.projectSnapshot.update({
        where: { id: snapshot.id },
        data: {
          hasJest: detection.hasJest,
          jestConfigPath: detection.configPath,
          testingFrameworksJson: detection.testingFrameworks
            ? JSON.stringify(detection.testingFrameworks)
            : null,
          jestCommand: detection.jestCommand,
        },
      });

      await prisma.project.update({
        where: { id: projectId },
        data: {
          activeSnapshotId: snapshot.id,
          hasJest: detection.hasJest,
          jestConfigPath: detection.configPath,
          jestCommand: detection.jestCommand,
        },
      });
      invalidateProjectTreeMetaCache(projectId);

      try {
        const { ensureProjectCasBaseline } = await import("./snapshotCas.service.js");
        await ensureProjectCasBaseline({
          projectId,
          snapshotId: snapshot.id,
          userId: userId || null,
          rootDir: validation.rootDir,
        });
      } catch (casErr) {
        console.warn("[UploadProjectZip] Initial CAS baseline warning:", casErr?.message || casErr);
      }

      await updateJobProgress(job.id, 100).catch(() => {});
      await markJobSuccess(job.id, { rootDir: validation.rootDir });
      console.log(
        `[Job ${job.id}] Pipeline upload & ingest completed: ${validation.rootDir}`,
      );
    } catch (uploadErr) {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (_) {}
      }
      console.error(
        `[UploadProjectZip] Firebase upload or ingest failed for Job ${job.id}:`,
        uploadErr,
      );
      const { markJobFailed } = await import("./job.service.js");
      try {
        await markJobFailed(job.id, uploadErr);
      } catch (_) {}
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
    _uploadPromise: uploadAndProcess(),
  };
};

export const detectJestConfig = async (projectId) => {
  return detectAndSaveProject(projectId);
};

export const detectPlaywrightConfig = async (projectId, userId) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: userId },
  });
  if (!project)
    throw new ServiceError("Project not found or unauthorized", 404);

  const snapshot = await prisma.projectSnapshot.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

  if (!snapshot || !snapshot.rootDir)
    throw new ServiceError("Project snapshot not ready", 404);

  return await detectFrameworks(snapshot.rootDir);
};

export const detectVitestConfig = async (projectId) => {
  return detectVitestAndSave(projectId);
};

export const detectCypressConfig = async (projectId) => {
  return detectCypressMetadata(projectId);
};

function copyDirRecursive(
  src,
  dest,
  ignoreDirs = [
    "node_modules",
    ".git",
    ".coverage",
    "dist",
    "build",
    "coverage",
    ".nyc_output",
  ],
) {
  if (!fs.existsSync(src)) return { fileCount: 0, sizeBytes: 0 };
  fs.mkdirSync(dest, { recursive: true });

  let fileCount = 0;
  let sizeBytes = 0;

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (
      ignoreDirs.includes(entry.name) ||
      entry.name === ".covai-collaboration"
    )
      continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      const sub = copyDirRecursive(srcPath, destPath, ignoreDirs);
      fileCount += sub.fileCount;
      sizeBytes += sub.sizeBytes;
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      try {
        const stat = fs.statSync(destPath);
        fileCount += 1;
        sizeBytes += stat.size;
      } catch (_) {}
    }
  }

  return { fileCount, sizeBytes };
}

const COVAI_ADDITIONAL_IGNORED = new Set([
  ".covai-checkpoint.json",
  "playwright-report",
  ".playwright",
  "cypress/videos",
  "cypress/screenshots",
]);

export async function computeSnapshotContentHash(root) {
  if (!root || !fs.existsSync(root)) return null;
  const files = await captureWorkspaceFiles(root);

  const entries = [];
  for (const [relPath, info] of files.entries()) {
    const normalized = relPath.replace(/\\/g, "/");
    const isIgnored = [...COVAI_ADDITIONAL_IGNORED].some(
      (ign) => normalized === ign || normalized.startsWith(`${ign}/`),
    );
    if (!isIgnored) {
      entries.push({ path: normalized, sha256: info.sha256 });
    }
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const hash = crypto.createHash("sha256");
  for (const item of entries) {
    hash.update(`${item.path}\0${item.sha256}\n`);
  }
  return hash.digest("hex");
}

export const resolveWorkingSnapshot = async (projectId) => {
  if (!projectId) return null;
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { activeSnapshotId: true },
  });
  if (project?.activeSnapshotId) {
    const active = await prisma.projectSnapshot.findFirst({
      where: { id: project.activeSnapshotId, projectId },
    });
    if (active && active.rootDir && fs.existsSync(active.rootDir)) {
      return active;
    }
  }
  return prisma.projectSnapshot.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
};

export const activateProjectSnapshot = async ({
  projectId,
  snapshotId,
  userId,
}) => {
  const { project } = await resolveProjectAccess({
    projectId,
    userId,
    capability: "integrations.write",
  });
  if (!project)
    throw new ServiceError("Project not found or unauthorized", 404);

  const snapshot = await prisma.projectSnapshot.findFirst({
    where: { id: snapshotId, projectId },
  });
  if (!snapshot) {
    throw new ServiceError("Target snapshot not found in this project", 404);
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      activeSnapshotId: snapshotId,
      workspaceRevision: { increment: 1 },
    },
  });
  invalidateProjectAccessCache(projectId);
  invalidateProjectTreeMetaCache(projectId);

  try {
    const { clearPortfolioCache } =
      await import("./portfolioDashboard.service.js");
    clearPortfolioCache(project.ownerId);
  } catch (_) {}
  try {
    const { clearUnifiedDashboardCache } =
      await import("./unifiedQualityDashboard.service.js");
    clearUnifiedDashboardCache(snapshotId);
  } catch (_) {}
  try {
    const { emitPortfolioProjectUpdated } =
      await import("../realtime/portfolioSocket.emitter.js");
    emitPortfolioProjectUpdated({
      projectId,
      userId: project.ownerId,
      action: "SNAPSHOT_ACTIVATED",
    });
  } catch (_) {}
  try {
    const { emitDashboardMetricsUpdated } =
      await import("./dashboardEvents.service.js");
    emitDashboardMetricsUpdated(projectId, {
      snapshotId,
      reason: "snapshot-activated",
    }).catch(() => {});
  } catch (_) {}

  return {
    success: true,
    projectId,
    activeSnapshotId: snapshotId,
    snapshot: {
      id: snapshot.id,
      versionNumber: snapshot.versionNumber,
      label: snapshot.label,
      createdAt: snapshot.createdAt,
    },
  };
};

export const listProjectSnapshots = async ({ projectId, userId }) => {
  const { project } = await resolveProjectAccess({
    projectId,
    userId,
    capability: "project.read",
  });
  if (!project) throw new ServiceError("Project not found", 404);
  const snapshots = await prisma.projectSnapshot.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { ProjectStructureAnalysis: { select: { schemaVersion: true } } },
  });

  return snapshots.map((snapshot, idx) => {
    let meta = null;
    if (snapshot.rootDir && fs.existsSync(snapshot.rootDir)) {
      const metaPath = path.join(
        snapshotWorkspaceRoot(snapshot),
        ".covai-checkpoint.json",
      );
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        } catch (_) {}
      }
    }

    const defaultLabel = snapshot.commitSha
      ? `Git: ${snapshot.commitSha.slice(0, 7)}`
      : snapshot.versionNumber != null
        ? `#${snapshot.versionNumber} Snapshot`
        : idx === snapshots.length - 1
          ? "Initial Ingest"
          : `Checkpoint #${snapshots.length - idx}`;

    const defaultMessage =
      snapshot.source === "GITHUB"
        ? "Imported from GitHub repository"
        : "Uploaded from compressed archive";

    const isActive = project.activeSnapshotId
      ? snapshot.id === project.activeSnapshotId
      : idx === 0;

    return {
      ...snapshotResponse({
        ...snapshot,
        structureAnalysis: snapshot.ProjectStructureAnalysis ?? null,
      }),
      versionNumber: snapshot.versionNumber,
      contentHash: snapshot.contentHash
        ? snapshot.contentHash.slice(0, 12)
        : null,
      isActive,
      label: snapshot.label || meta?.label || defaultLabel,
      message: meta?.message || defaultMessage,
      fileCount: meta?.fileCount ?? null,
      sizeBytes: meta?.sizeBytes ?? null,
      isCurrent: isActive,
    };
  });
};

export const rebaseSnapshotConfigPath = (value, originalRoot, targetRoot) => {
  if (!value || !path.isAbsolute(value)) return value;
  const relative = path.relative(originalRoot, value);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new ServiceError(
      "Snapshot configuration must stay inside its project workspace",
      422,
    );
  }
  return path.join(targetRoot, relative);
};

export const createProjectCheckpoint = async ({
  projectId,
  userId,
  label,
  message,
}) => {
  const { project } = await resolveProjectAccess({
    projectId,
    userId,
    capability: "integrations.write",
  });
  if (!project)
    throw new ServiceError("Project not found or unauthorized", 404);

  const activeSnapshot = await resolveWorkingSnapshot(projectId);
  const latestSnapshot = await prisma.projectSnapshot.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

  if (
    !activeSnapshot ||
    !activeSnapshot.rootDir ||
    !fs.existsSync(activeSnapshot.rootDir)
  ) {
    throw new ServiceError(
      "Current project source code is not available to snapshot",
      400,
    );
  }

  const workspaceRoot = projectEditableWorkspaceRoot(activeSnapshot);

  // Compute Merkle content hash of current workspace
  const currentHash = await computeSnapshotContentHash(workspaceRoot);

  // Lazy compute contentHash for active & latest if missing
  if (activeSnapshot && !activeSnapshot.contentHash && activeSnapshot.rootDir) {
    const activeRoot = projectEditableWorkspaceRoot(activeSnapshot);
    activeSnapshot.contentHash = await computeSnapshotContentHash(activeRoot);
    if (activeSnapshot.contentHash) {
      await prisma.projectSnapshot
        .update({
          where: { id: activeSnapshot.id },
          data: { contentHash: activeSnapshot.contentHash },
        })
        .catch(() => {});
    }
  }

  if (latestSnapshot && !latestSnapshot.contentHash && latestSnapshot.rootDir) {
    const latestRoot = projectEditableWorkspaceRoot(latestSnapshot);
    latestSnapshot.contentHash = await computeSnapshotContentHash(latestRoot);
    if (latestSnapshot.contentHash) {
      await prisma.projectSnapshot
        .update({
          where: { id: latestSnapshot.id },
          data: { contentHash: latestSnapshot.contentHash },
        })
        .catch(() => {});
    }
  }

  // Check against both activeSnapshot AND latestSnapshot
  if (
    currentHash &&
    activeSnapshot &&
    currentHash === activeSnapshot.contentHash
  ) {
    throw new ServiceError(
      `The code hasn't changed compared to Snapshot #${activeSnapshot.versionNumber || 1}`,
      409,
      "SNAPSHOT_UNCHANGED",
    );
  }

  if (
    currentHash &&
    latestSnapshot &&
    currentHash === latestSnapshot.contentHash
  ) {
    throw new ServiceError(
      `The code hasn't changed compared to Snapshot #${latestSnapshot.versionNumber || 1}`,
      409,
      "SNAPSHOT_UNCHANGED",
    );
  }

  // Determine sequential version number: max + 1
  const maxVersionAgg = await prisma.projectSnapshot.aggregate({
    where: { projectId },
    _max: { versionNumber: true },
  });
  const maxVer = maxVersionAgg?._max?.versionNumber ?? 0;
  const newVersionNumber = maxVer + 1;
  const snapshotLabel = label?.trim() || `#${newVersionNumber} Snapshot`;

  const newSnapshotId = `snap_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const baseStorage = path.resolve(
    "storage/projects",
    projectId,
    "snapshots",
    newSnapshotId,
  );
  fs.mkdirSync(baseStorage, { recursive: true });

  const analysisRelative = path.relative(workspaceRoot, activeSnapshot.rootDir);
  const checkpointAnalysisRoot = path.join(baseStorage, analysisRelative);
  const { fileCount, sizeBytes } = copyDirRecursive(workspaceRoot, baseStorage);
  const srcGit = path.join(workspaceRoot, ".git");
  const destGit = path.join(baseStorage, ".git");
  if (fs.existsSync(srcGit) && !fs.existsSync(destGit)) {
    try {
      fs.cpSync(srcGit, destGit, { recursive: true });
    } catch (_) {}
  }

  const checkpointMeta = {
    id: newSnapshotId,
    versionNumber: newVersionNumber,
    label: snapshotLabel,
    message: message?.trim() || "Manual snapshot checkpoint",
    createdAt: new Date().toISOString(),
    source: activeSnapshot.source,
    contentHash: currentHash,
    fileCount,
    sizeBytes,
  };

  const metaPath = path.join(baseStorage, ".covai-checkpoint.json");
  fs.writeFileSync(metaPath, JSON.stringify(checkpointMeta, null, 2), "utf8");

  let detection = {
    hasJest: activeSnapshot.hasJest,
    configPath: rebaseSnapshotConfigPath(
      activeSnapshot.jestConfigPath,
      workspaceRoot,
      baseStorage,
    ),
    jestCommand: activeSnapshot.jestCommand,
  };
  try {
    detection = detectJest(checkpointAnalysisRoot);
  } catch (_) {}

  // Save contentHash in contentHash column and versioned unique string in checksum
  const checksum = `${currentHash || "snap"}_v${newVersionNumber}`;

  const committed = await withProjectGuard(
    { projectId, userId, capability: "integrations.write" },
    async (tx, access) => {
      await assertEditorSnapshotChangeAllowed(tx, projectId);
      if (access.project.workspaceRevision !== project.workspaceRevision)
        throw new ServiceError(
          "Workspace changed while preparing checkpoint; try again",
          409,
          "SNAPSHOT_CHANGED",
        );
      const newSnapshot = await tx.projectSnapshot.create({
        data: {
          projectId,
          source: activeSnapshot.source,
          checksum,
          contentHash: currentHash,
          versionNumber: newVersionNumber,
          label: snapshotLabel,
          commitSha: null,
          storagePath: baseStorage,
          rootDir: checkpointAnalysisRoot,
          hasJest: detection.hasJest,
          jestConfigPath: detection.configPath,
          jestCommand: detection.jestCommand,
          hasVitest: activeSnapshot.hasVitest,
          vitestCommand: activeSnapshot.vitestCommand,
          vitestConfigPath: rebaseSnapshotConfigPath(
            activeSnapshot.vitestConfigPath,
            workspaceRoot,
            baseStorage,
          ),
          hasPlaywright: activeSnapshot.hasPlaywright,
          playwrightBrowsers: activeSnapshot.playwrightBrowsers,
          playwrightCommand: activeSnapshot.playwrightCommand,
          playwrightConfigPath: rebaseSnapshotConfigPath(
            activeSnapshot.playwrightConfigPath,
            workspaceRoot,
            baseStorage,
          ),
          playwrightTestDir: rebaseSnapshotConfigPath(
            activeSnapshot.playwrightTestDir,
            workspaceRoot,
            baseStorage,
          ),
          hasCypress: activeSnapshot.hasCypress,
          cypressCommand: activeSnapshot.cypressCommand,
          cypressConfigPath: rebaseSnapshotConfigPath(
            activeSnapshot.cypressConfigPath,
            workspaceRoot,
            baseStorage,
          ),
          cypressTestDir: rebaseSnapshotConfigPath(
            activeSnapshot.cypressTestDir,
            workspaceRoot,
            baseStorage,
          ),
          cypressVersion: activeSnapshot.cypressVersion,
          testingFrameworksJson: activeSnapshot.testingFrameworksJson,
          frameworkRecommendationJson:
            activeSnapshot.frameworkRecommendationJson,
          selectedTestingFramework: activeSnapshot.selectedTestingFramework,
        },
      });
      const updated = await tx.project.update({
        where: { id: projectId },
        data: {
          workspaceRevision: { increment: 1 },
          activeSnapshotId: newSnapshot.id,
        },
      });
      const event = await publishProjectEvent({
        tx,
        projectId,
        actorId: userId,
        type: "workspace.changed",
        resourceId: newSnapshot.id,
        revision: updated.workspaceRevision,
      });
      return { newSnapshot, event };
    },
  );
  const { newSnapshot } = committed;
  invalidateProjectTreeMetaCache(projectId);
  await deliverProjectEvent(committed.event).catch(() => {});

  try {
    const { autoTransitionProjectToDoingIfNeeded } =
      await import("./job.service.js");
    void autoTransitionProjectToDoingIfNeeded(projectId);
  } catch (_) {}

  try {
    const { clearPortfolioCache } =
      await import("./portfolioDashboard.service.js");
    clearPortfolioCache(project.ownerId);
  } catch (_) {}
  try {
    const { clearUnifiedDashboardCache } =
      await import("./unifiedQualityDashboard.service.js");
    clearUnifiedDashboardCache(newSnapshot.id);
  } catch (_) {}
  try {
    const { emitPortfolioProjectUpdated } =
      await import("../realtime/portfolioSocket.emitter.js");
    emitPortfolioProjectUpdated({
      projectId,
      userId: project.ownerId,
      action: "SNAPSHOT_CREATED",
    });
  } catch (_) {}
  try {
    const { emitDashboardMetricsUpdated } =
      await import("./dashboardEvents.service.js");
    emitDashboardMetricsUpdated(projectId, {
      snapshotId: newSnapshot.id,
      reason: "snapshot-created",
    }).catch(() => {});
  } catch (_) {}

  return {
    ...snapshotResponse(newSnapshot),
    label: checkpointMeta.label,
    versionNumber: newVersionNumber,
    contentHash: currentHash,
    isActive: true,
  };
};

export const restoreProjectCheckpoint = async ({
  projectId,
  snapshotId,
  userId,
}) => {
  const { project } = await resolveProjectAccess({
    projectId,
    userId,
    capability: "snapshot.restore",
  });
  if (!project)
    throw new ServiceError("Project not found or unauthorized", 404);

  const targetSnapshot = await prisma.projectSnapshot.findFirst({
    where: { id: snapshotId, projectId },
  });
  if (
    !targetSnapshot ||
    !targetSnapshot.rootDir ||
    !fs.existsSync(targetSnapshot.rootDir)
  ) {
    throw new ServiceError(
      "Target snapshot not found or snapshot files missing on disk",
      404,
    );
  }

  const activeSnapshot = await prisma.projectSnapshot.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  if (!activeSnapshot || !activeSnapshot.rootDir) {
    throw new ServiceError("Current project working directory not found", 400);
  }

  const targetWorkspace = projectEditableWorkspaceRoot(targetSnapshot);
  const targetAnalysisRelative = path.relative(
    targetWorkspace,
    targetSnapshot.rootDir,
  );

  // Stage the target before changing the working tree, including when restoring
  // the active snapshot itself.
  const restoreCheckpointId = `snap_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const restoreStorage = path.resolve(
    "storage/projects",
    projectId,
    "snapshots",
    restoreCheckpointId,
  );
  fs.mkdirSync(restoreStorage, { recursive: true });
  const { fileCount, sizeBytes } = copyDirRecursive(
    targetWorkspace,
    restoreStorage,
    ["node_modules"],
  );
  const restoreGit = path.join(restoreStorage, ".git");
  if (!fs.existsSync(restoreGit)) {
    try {
      const targetGit = path.join(targetWorkspace, ".git");
      if (fs.existsSync(targetGit)) {
        fs.cpSync(targetGit, restoreGit, { recursive: true });
      } else {
        const priorWithGit = await prisma.projectSnapshot.findMany({
          where: { projectId },
          orderBy: { createdAt: "desc" },
        });
        for (const prior of priorWithGit) {
          const priorWs = snapshotWorkspaceRoot(prior);
          if (priorWs) {
            const priorGit = path.join(priorWs, ".git");
            if (fs.existsSync(priorGit)) {
              fs.cpSync(priorGit, restoreGit, { recursive: true });
              break;
            }
          }
        }
      }
    } catch (_) {}
  }
  // A restore publishes a new active snapshot. Never erase a workspace that
  // another member or worker may still be reading from the historical snapshot.

  let targetLabel = targetSnapshot.id.slice(0, 8);
  const targetMetaPath = path.join(restoreStorage, ".covai-checkpoint.json");
  if (fs.existsSync(targetMetaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(targetMetaPath, "utf8"));
      if (parsed.label) targetLabel = parsed.label;
    } catch (_) {}
  } else if (targetSnapshot.commitSha) {
    targetLabel = `Git: ${targetSnapshot.commitSha.slice(0, 7)}`;
  }

  const restoreMeta = {
    id: restoreCheckpointId,
    label: `Restored: ${targetLabel}`,
    message: `Rolled back to snapshot from ${new Date(targetSnapshot.createdAt).toLocaleString("vi-VN")}`,
    createdAt: new Date().toISOString(),
    source: targetSnapshot.source,
    fileCount,
    sizeBytes,
  };
  fs.writeFileSync(
    path.join(restoreStorage, ".covai-checkpoint.json"),
    JSON.stringify(restoreMeta, null, 2),
    "utf8",
  );

  const checksum = `cp_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const restoredContentHash = await computeSnapshotContentHash(restoreStorage).catch(
    () => targetSnapshot.contentHash || null,
  );
  const maxVersionAgg = await prisma.projectSnapshot.aggregate({
    where: { projectId },
    _max: { versionNumber: true },
  });
  const nextVersionNumber = (maxVersionAgg?._max?.versionNumber ?? 0) + 1;

  const committed = await withProjectGuard(
    { projectId, userId, capability: "snapshot.restore" },
    async (tx, access) => {
      await assertEditorSnapshotChangeAllowed(tx, projectId);
      if (access.project.workspaceRevision !== project.workspaceRevision)
        throw new ServiceError(
          "Workspace changed while preparing restore; try again",
          409,
          "SNAPSHOT_CHANGED",
        );
      const newSnapshot = await tx.projectSnapshot.create({
        data: {
          projectId,
          source: targetSnapshot.source,
          checksum,
          contentHash: restoredContentHash,
          versionNumber: nextVersionNumber,
          label: restoreMeta.label,
          commitMessage: restoreMeta.message,
          restoredFromSnapshotId: targetSnapshot.id,
          authorId: userId,
          commitSha: null,
          storagePath: restoreStorage,
          rootDir: path.join(restoreStorage, targetAnalysisRelative),
          hasJest: targetSnapshot.hasJest,
          jestConfigPath: rebaseSnapshotConfigPath(
            targetSnapshot.jestConfigPath,
            targetWorkspace,
            restoreStorage,
          ),
          jestCommand: targetSnapshot.jestCommand,
          hasVitest: targetSnapshot.hasVitest,
          vitestCommand: targetSnapshot.vitestCommand,
          vitestConfigPath: rebaseSnapshotConfigPath(
            targetSnapshot.vitestConfigPath,
            targetWorkspace,
            restoreStorage,
          ),
          hasPlaywright: targetSnapshot.hasPlaywright,
          playwrightBrowsers: targetSnapshot.playwrightBrowsers,
          playwrightCommand: targetSnapshot.playwrightCommand,
          playwrightConfigPath: rebaseSnapshotConfigPath(
            targetSnapshot.playwrightConfigPath,
            targetWorkspace,
            restoreStorage,
          ),
          playwrightTestDir: rebaseSnapshotConfigPath(
            targetSnapshot.playwrightTestDir,
            targetWorkspace,
            restoreStorage,
          ),
          hasCypress: targetSnapshot.hasCypress,
          cypressCommand: targetSnapshot.cypressCommand,
          cypressConfigPath: rebaseSnapshotConfigPath(
            targetSnapshot.cypressConfigPath,
            targetWorkspace,
            restoreStorage,
          ),
          cypressTestDir: rebaseSnapshotConfigPath(
            targetSnapshot.cypressTestDir,
            targetWorkspace,
            restoreStorage,
          ),
          cypressVersion: targetSnapshot.cypressVersion,
          testingFrameworksJson: targetSnapshot.testingFrameworksJson,
          frameworkRecommendationJson:
            targetSnapshot.frameworkRecommendationJson,
          selectedTestingFramework: targetSnapshot.selectedTestingFramework,
        },
      });
      const updated = await tx.project.update({
        where: { id: projectId },
        data: {
          activeSnapshotId: newSnapshot.id,
          workspaceRevision: { increment: 1 },
        },
      });
      const event = await publishProjectEvent({
        tx,
        projectId,
        actorId: userId,
        type: "workspace.changed",
        resourceId: newSnapshot.id,
        revision: updated.workspaceRevision,
      });
      return { newSnapshot, event };
    },
  );
  const { newSnapshot } = committed;
  invalidateProjectTreeMetaCache(projectId);
  await deliverProjectEvent(committed.event).catch(() => {});

  return {
    success: true,
    message: `Restored project code to snapshot '${targetLabel}' successfully.`,
    restoredSnapshot: {
      ...snapshotResponse(targetSnapshot),
      label: targetLabel,
    },
    newSnapshot: {
      ...snapshotResponse(newSnapshot),
      label: restoreMeta.label,
      message: restoreMeta.message,
      fileCount,
      sizeBytes,
      isCurrent: true,
    },
  };
};

const resolveAnalysisSnapshot = async ({ projectId, snapshotId, userId }) => {
  if (snapshotId) {
    return resolveOwnedProjectSnapshot({
      projectId,
      snapshotId,
      userId,
      requireRoot: true,
    });
  }
  return resolveLatestOwnedProjectSnapshot({
    projectId,
    userId,
    requireRoot: true,
  });
};

export const resolveCoverageAnalysisSnapshot = async ({
  projectId,
  snapshotId,
  userId,
}) => {
  const { snapshot } = await resolveAnalysisSnapshot({
    projectId,
    snapshotId,
    userId,
  });
  return snapshot;
};

export const startProjectStructureAnalysis = async ({
  projectId,
  snapshotId,
  userId,
}) => {
  const snapshot = await resolveCoverageAnalysisSnapshot({
    projectId,
    snapshotId,
    userId,
  });
  return createArchitectureAnalysisJob({
    projectId,
    snapshotId: snapshot.id,
    userId,
  });
};

export const getProjectStructureAnalysis = async ({
  projectId,
  snapshotId,
  userId,
}) => {
  const { snapshot } = await resolveOwnedProjectSnapshot({
    projectId,
    snapshotId,
    userId,
  });
  const analysis = await prisma.projectStructureAnalysis.findUnique({
    where: { snapshotId: snapshot.id },
  });
  if (!analysis) throw new ServiceError("Architecture analysis not found", 404);
  let parsed;
  try {
    parsed = analysisResultResponse(analysis);
  } catch {
    throw new ServiceError("Stored architecture analysis is invalid", 500);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.summary ||
    !parsed.graph ||
    !Array.isArray(parsed.graph.nodes)
  ) {
    throw new ServiceError("Architecture analysis not found", 404);
  }
  return parsed;
};

export const createCoverageAnalysisJob = async ({
  projectId,
  snapshotId,
  userId,
  mode = "FULL",
  testType,
  requestId,
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

  await resolveProjectAccess({ projectId, userId, capability: "tests.run" });
  const snapshot = await prisma.projectSnapshot.findFirst({
    where: { id: snapshotId, projectId },
  });
  if (!snapshot) throw new ServiceError("Snapshot not found", 404);

  const runTestsJob = await createRunTestsJob({
    projectId,
    snapshotId,
    userId,
    mode,
    testType,
    chainBuildCfg: true,
    ...(requestId ? { requestId } : {}),
  });

  // The dependent job is admitted only after RUN_TESTS publishes. Admitting it
  // here would let queue recovery start it before coverage is committed.
  return runTestsJob;
};

export const deleteProject = async (projectId, userId) => {
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId))
    throw new ServiceError("Invalid project ID", 400);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new ServiceError("Project not found", 404);
  }
  if (project.ownerId !== userId) {
    throw new ServiceError("You are not allowed to delete this project", 403);
  }

  // Fetch active job guard, snapshots, and evaluation runs in a single parallel roundtrip.
  const [initialActiveJob, snapshots, evaluations] = await Promise.all([
    prisma.job.findFirst({
      where: { projectId, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    }),
    prisma.projectSnapshot.findMany({
      where: { projectId },
      select: { id: true, rootDir: true, storagePath: true },
    }),
    prisma.aiEvaluationProjectRun?.findMany
      ? prisma.aiEvaluationProjectRun.findMany({ where: { projectId }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  let activeJob = initialActiveJob;
  if (activeJob && typeof prisma.job?.findMany === "function") {
    try {
      const { cleanupStaleJobsForProject } = await import("./job.service.js");
      await cleanupStaleJobsForProject(projectId, prisma);
      activeJob = await prisma.job.findFirst({
        where: { projectId, status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
      });
    } catch (err) {
      console.warn(`[DeleteProject] Stale job cleanup check failed for ${projectId}:`, err?.message);
    }
  }
  if (activeJob) {
    throw new ServiceError(
      "This project is still processing. Wait for its jobs to finish before deleting it.",
      409,
    );
  }

  // Run storage cleanup and Docker container reclamation in parallel;
  // storage errors must fail deletion so metadata stays retryable, while Docker errors warn only.
  const cleanupDockerPromise = (async () => {
    try {
      const { cleanupProjectRunnerContainers } = await import("./dockerRunner.service.js");
      await cleanupProjectRunnerContainers(projectId);
    } catch (err) {
      console.warn(`[DeleteProject] Warning cleaning up runner containers for ${projectId}:`, err?.message);
    }
  })();

  await Promise.all([
    cleanupProjectStorageAsync(projectId, snapshots, {
      evaluationIds: evaluations.map(row => row.id),
    }),
    cleanupDockerPromise,
  ]);

  // Invalidate in-memory manifest cache for deleted snapshots
  for (const snap of snapshots) {
    if (snap?.id) {
      try {
        const { clearManifestCache } = await import("./unitTestVersion.service.js");
        clearManifestCache(snap.id);
      } catch (_) { }
    }
  }

  // Fast DB deletion:
  // Primary attempt: Native PostgreSQL ON DELETE CASCADE via prisma.project.delete.
  try {
    await withProjectGuard(
      { projectId, userId, capability: "project.delete" },
      (tx) => tx.project.delete({ where: { id: projectId } }),
    );
  } catch (error) {
    if (error.code !== "P2003") throw error;
    console.warn(
      `[DeleteProject] Direct cascade delete failed for project ${projectId}, falling back to manual cascade transaction:`,
      error?.message,
    );
    const del = (model, where) =>
      typeof model?.deleteMany === "function" ? model.deleteMany({ where }) : Promise.resolve();

    await withProjectGuard({ projectId, userId, capability: 'project.delete' }, async tx => {
      // Tier 1: deepest leaves (run in parallel)
      await Promise.all([
        del(tx.systemRunArtifact, { assessment: { snapshot: { projectId } } }),
        del(tx.systemRunEvent, { assessment: { snapshot: { projectId } } }),
        del(tx.systemMutationRun, { assessment: { snapshot: { projectId } } }),
        del(tx.systemTestProposal, { snapshot: { projectId } }),
        del(tx.systemAssertionBinding, { revision: { snapshot: { projectId } } }),
        del(tx.systemTestFile, { testRun: { snapshot: { projectId } } }),
        del(tx.systemSuiteState, { snapshot: { projectId } }),
        del(tx.aiEvaluationEvidence, { run: { projectId } }),
        del(tx.aiEvaluationHumanReview, { criterionResult: { caseResult: { run: { projectId } } } }),
        del(tx.projectOperationRequest, { projectId }),
        del(tx.invitationDelivery, { invitation: { projectId } }),
        del(tx.projectEditorUpdate, { document: { projectId } }),
        del(tx.aiTestResult, { aiTest: { projectId } }),
        del(tx.jobLog, { job: { projectId } }),
        del(tx.jobOutput, { job: { projectId } }),
      ]);

      // Tier 2: assessment / evaluation criteria & attempts / chat requests & memory
      await Promise.all([
        del(tx.systemTestAssessment, { snapshot: { projectId } }),
        del(tx.systemScenario, { snapshot: { projectId } }),
        del(tx.aiEvaluationCriterionResult, { caseResult: { run: { projectId } } }),
        del(tx.aiEvaluationConfirmationGrant, { attempt: { caseResult: { run: { projectId } } } }),
        del(tx.aiEvaluationToolCall, { attempt: { caseResult: { run: { projectId } } } }),
        del(tx.projectMemory, { projectId }),
        del(tx.chatRequest, { session: { projectId } }),
        del(tx.testScenario, { testRun: { snapshot: { projectId } } }),
      ]);

      // Tier 3: suite versions (clear self-FKs first), evaluation runs/cases, chat messages
      if (typeof tx.systemSuiteVersion?.updateMany === "function") {
        await tx.systemSuiteVersion.updateMany({
          where: { snapshot: { projectId } },
          data: { parentVersionId: null, restoredFromVersionId: null },
        });
      }
      await Promise.all([
        del(tx.systemSuiteVersion, { snapshot: { projectId } }),
        del(tx.systemRequirementRevision, { snapshot: { projectId } }),
        del(tx.aiEvaluationAttempt, { caseResult: { run: { projectId } } }),
        del(tx.chatMessage, { session: { projectId } }),
        del(tx.testRun, { snapshot: { projectId } }),
        del(tx.projectOperation, { projectId }),
      ]);

      // Tier 4: evaluation mid-level & remaining snapshot/project children
      await Promise.all([
        del(tx.aiEvaluationCaseResult, { run: { projectId } }),
        del(tx.aiEvaluationTestCase, { profileVersion: { profile: { projectId } } }),
        del(tx.aiEvaluationDesignAudit, { projectId }),
        del(tx.projectEditorDocument, { projectId }),
        del(tx.projectCodeChange, { projectId }),
        del(tx.projectMutation, { projectId }),
        del(tx.projectFileVersion, { snapshot: { projectId } }),
        del(tx.snapshotVcsStaging, { projectId }),
        del(tx.snapshotVcsTag, { projectId }),
        del(tx.snapshotVcsEntry, { snapshot: { projectId } }),
        del(tx.snapshotVcsBlobRef, { projectId }),
        del(tx.projectEvent, { projectId }),
        del(tx.projectInvitation, { projectId }),
        del(tx.projectMember, { projectId }),
        del(tx.aiContextSettings, { projectId }),
        del(tx.chatSession, { projectId }),
        del(tx.qualityReport, { projectId }),
        del(tx.projectStructureAnalysis, { ProjectSnapshot: { projectId } }),
        del(tx.performanceMetric, { snapshot: { projectId } }),
        del(tx.vulnerability, { snapshot: { projectId } }),
        del(tx.coverageSummary, { snapshot: { projectId } }),
        del(tx.coverageFile, { snapshot: { projectId } }),
        del(tx.coverageFunction, { snapshot: { projectId } }),
        del(tx.cyclomatic, { snapshot: { projectId } }),
        del(tx.aiContextCache, { snapshot: { projectId } }),
        del(tx.aiTest, { projectId }),
        del(tx.aiSuggestion, { projectId }),
        del(tx.job, { projectId }),
        del(tx.notification, { projectId }),
      ]);

      // Tier 5: CFG, evaluation runs/versions/targets/profiles
      await Promise.all([
        del(tx.cfg, { snapshot: { projectId } }),
        del(tx.aiEvaluationRun, { projectId }),
        del(tx.aiEvaluationProjectRun, { projectId }),
        del(tx.aiEvaluationProjectSettings, { projectId }),
        del(tx.aiEvaluationProfileVersion, { profile: { projectId } }),
        del(tx.aiEvaluationKnowledgeSource, { projectId }),
        del(tx.aiEvaluationTargetVersion, { target: { projectId } }),
      ]);

      await Promise.all([
        del(tx.aiEvaluationProfile, { projectId }),
        del(tx.aiEvaluationCredential, { target: { projectId } }),
      ]);
      await del(tx.aiEvaluationTarget, { projectId });

      // Tier 6: snapshot VCS branches, snapshots & project root
      if (typeof tx.snapshotVcsBranch?.updateMany === "function") {
        await tx.snapshotVcsBranch.updateMany({
          where: { projectId },
          data: { headSnapshotId: null, baseSnapshotId: null },
        });
      }
      if (typeof tx.projectSnapshot?.updateMany === "function") {
        await tx.projectSnapshot.updateMany({
          where: { projectId },
          data: {
            parentSnapshotId: null,
            restoredFromSnapshotId: null,
            vcsBranchId: null,
          },
        });
      }
      await del(tx.snapshotVcsBranch, { projectId });
      await del(tx.projectSnapshot, { projectId });
      await tx.project.delete({ where: { id: projectId } });
    });
  }

  clearProjectTreeCache();
  invalidateProjectAccessCache(projectId);
  try {
    const { clearPortfolioCache } = await import("./portfolioDashboard.service.js");
    clearPortfolioCache(userId);
  } catch (error) {
    console.error("[deleteProject] Portfolio cache invalidation failed:", error);
  }
};

const projectTreeCache = new Map();
const projectTreeMetaCache = new Map();
const inFlightTreeRequests = new Map();
const TREE_CACHE_TTL_MS = 30_000;
const TREE_META_CACHE_TTL_MS = 15_000;
const TREE_CACHE_MAX_ENTRIES = 200;

const SNAPSHOT_TREE_SELECT = {
  id: true,
  rootDir: true,
  storagePath: true,
  source: true,
};

export function invalidateProjectTreeMetaCache(projectId = null) {
  projectAccessModule.invalidateProjectAccessCache?.(projectId);
  if (!projectId) {
    projectTreeMetaCache.clear();
    return;
  }
  const prefix = `${projectId}:`;
  for (const key of projectTreeMetaCache.keys()) {
    if (key.startsWith(prefix)) {
      projectTreeMetaCache.delete(key);
    }
  }
}

export const clearProjectTreeCache = (snapshotId = null) => {
  projectTreeMetaCache.clear();
  if (snapshotId) {
    for (const key of projectTreeCache.keys()) {
      if (key.startsWith(snapshotId)) {
        projectTreeCache.delete(key);
      }
    }
  } else {
    projectTreeCache.clear();
  }
};

export const getProjectTree = async (projectId, userId, options = {}) => {
  const initialInvalidationVersion =
    typeof projectAccessModule.getProjectInvalidationVersion === "function"
      ? projectAccessModule.getProjectInvalidationVersion(projectId)
      : 0;
  const dedupeKey = `${projectId}:${userId}:${options.snapshotId || "latest"}:${options.withMetadata ? "meta" : "raw"}:${initialInvalidationVersion}`;
  const existingFlight = inFlightTreeRequests.get(dedupeKey);
  if (existingFlight) {
    return existingFlight;
  }

  const run = async () => {
    const metaCacheKey = `${projectId}:${options.snapshotId || "latest"}`;
    const cachedMetaEntry = projectTreeMetaCache.get(metaCacheKey);
    const invalidationVersion = initialInvalidationVersion;
    const { readMutationMarkers, recoverProjectMutationMarkers } =
      await import("./projectMutationRecovery.service.js");

    let meta = null;
    if (
      cachedMetaEntry &&
      cachedMetaEntry.invalidationVersion === invalidationVersion &&
      Date.now() - cachedMetaEntry.cachedAt < TREE_META_CACHE_TTL_MS &&
      cachedMetaEntry.allowedUsers?.has(userId)
    ) {
      const markers = await readMutationMarkers(
        cachedMetaEntry.meta.workspaceRoot,
      );
      if (markers.length === 0) {
        meta = cachedMetaEntry.meta;
      }
    }

    if (!meta) {
      const access = await resolveProjectAccess({
        projectId,
        userId,
        capability: "project.read",
      });
      const targetSnapshotId =
        options.snapshotId || access.project?.activeSnapshotId || null;
      let snapshot = targetSnapshotId
        ? await prisma.projectSnapshot.findFirst({
            where: { projectId, id: targetSnapshotId },
            select: SNAPSHOT_TREE_SELECT,
          })
        : null;
      if (!snapshot && !options.snapshotId) {
        snapshot = await prisma.projectSnapshot.findFirst({
          where: { projectId },
          orderBy: { createdAt: "desc" },
          select: SNAPSHOT_TREE_SELECT,
        });
      }
      if (!snapshot?.rootDir)
        throw new ServiceError("Project snapshot not ready", 202);
      const workspaceRoot = projectEditableWorkspaceRoot(snapshot);
      const markers = await readMutationMarkers(workspaceRoot);

      if (markers.length > 0) {
        meta = await withProjectGuard(
          {
            projectId,
            userId,
            capability: "project.read",
            maxWait: 30000,
            timeout: 60000,
          },
          async (tx, guardedAccess) => {
            const guardedSnapshot = await tx.projectSnapshot.findFirst({
              where: {
                projectId,
                ...(options.snapshotId ? { id: options.snapshotId } : {}),
              },
              orderBy: options.snapshotId ? undefined : { createdAt: "desc" },
              select: SNAPSHOT_TREE_SELECT,
            });
            if (!guardedSnapshot?.rootDir)
              throw new ServiceError("Project snapshot not ready", 202);
            const guardedRoot = projectEditableWorkspaceRoot(guardedSnapshot);
            await recoverProjectMutationMarkers({
              tx,
              project: guardedAccess.project,
              snapshot: guardedSnapshot,
              root: guardedRoot,
            });
            return {
              snapshotId: guardedSnapshot.id,
              workspaceRevision: guardedAccess.project.workspaceRevision,
              workspaceRoot: guardedRoot,
            };
          },
        );
      } else {
        meta = {
          snapshotId: snapshot.id,
          workspaceRevision: access.project.workspaceRevision,
          workspaceRoot,
        };
      }

      const latestInvalidationVersion =
        typeof projectAccessModule.getProjectInvalidationVersion === "function"
          ? projectAccessModule.getProjectInvalidationVersion(projectId)
          : 0;
      if (latestInvalidationVersion === invalidationVersion) {
        if (projectTreeMetaCache.size >= TREE_CACHE_MAX_ENTRIES) {
          projectTreeMetaCache.clear();
        }
        projectTreeMetaCache.set(metaCacheKey, {
          meta,
          invalidationVersion,
          cachedAt: Date.now(),
          allowedUsers: new Set(
            [userId, access.project?.ownerId].filter(Boolean),
          ),
        });
      }
    }

    const cacheKey = `${meta.snapshotId}:${meta.workspaceRevision ?? 0}:${meta.workspaceRoot}`;
    let tree = null;
    const cached = projectTreeCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < TREE_CACHE_TTL_MS) {
      tree = cached.tree;
    } else {
      tree = await buildTreeAsync(meta.workspaceRoot);
      if (projectTreeCache.size >= TREE_CACHE_MAX_ENTRIES) {
        projectTreeCache.clear();
      }
      projectTreeCache.set(cacheKey, { tree, cachedAt: Date.now() });
    }

    return options.withMetadata
      ? {
          tree,
          snapshotId: meta.snapshotId,
          workspaceRevision: meta.workspaceRevision,
        }
      : tree;
  };

  const promise = run().finally(() => {
    inFlightTreeRequests.delete(dedupeKey);
  });
  inFlightTreeRequests.set(dedupeKey, promise);
  return promise;
};

export const getFileContent = (projectId, userId, filePath, options = {}) =>
  readVersionedProjectFile({
    projectId,
    userId,
    path: filePath,
    snapshotId: typeof options === "string" ? options : options?.snapshotId,
  });

export const updateFileContent = async (
  projectId,
  userId,
  filePath,
  content,
  options = {},
) => {
  const res = await mutateProjectWorkspace({
    projectId,
    userId,
    path: filePath,
    content,
    kind: "WRITE_FILE",
    ...options,
  });
  invalidateProjectTreeMetaCache(projectId);
  return res;
};

export const createProjectFile = async (
  projectId,
  userId,
  filePath,
  content = "",
  options = {},
) => {
  const res = await mutateProjectWorkspace({
    projectId,
    userId,
    path: filePath,
    content,
    kind: "CREATE_FILE",
    ...options,
  });
  invalidateProjectTreeMetaCache(projectId);
  return res;
};

export const createProjectFolder = async (
  projectId,
  userId,
  filePath,
  options = {},
) => {
  const res = await mutateProjectWorkspace({
    projectId,
    userId,
    path: filePath,
    kind: "CREATE_FOLDER",
    ...options,
  });
  invalidateProjectTreeMetaCache(projectId);
  return res;
};

export const renameProjectEntry = async (
  projectId,
  userId,
  filePath,
  _content,
  newPath,
  options = {},
) => {
  const res = await mutateProjectWorkspace({
    projectId,
    userId,
    path: filePath,
    newPath,
    kind: "RENAME_ENTRY",
    ...options,
  });
  invalidateProjectTreeMetaCache(projectId);
  return res;
};

export const deleteProjectEntry = async (
  projectId,
  userId,
  filePath,
  options = {},
) => {
  const res = await mutateProjectWorkspace({
    projectId,
    userId,
    path: filePath,
    kind: "DELETE_ENTRY",
    ...options,
  });
  invalidateProjectTreeMetaCache(projectId);
  return res;
};

export const hasProjectLifecycleActivity = async (projectId, db = prisma) => {
  if (!projectId) return false;
  const [run, cov, aiTest, sysScenario, evalRun, evalProjRun, snapshotCount] =
    await Promise.all([
      db.testRun.findFirst({
        where: { snapshot: { projectId } },
        select: { id: true },
      }),
      db.coverageSummary.findFirst({
        where: { snapshot: { projectId } },
        select: { id: true },
      }),
      db.aiTest.findFirst({
        where: { projectId },
        select: { id: true },
      }),
      typeof db.systemScenario?.findFirst === "function"
        ? db.systemScenario.findFirst({
            where: { snapshot: { projectId } },
            select: { id: true },
          })
        : Promise.resolve(null),
      typeof db.aiEvaluationRun?.findFirst === "function"
        ? db.aiEvaluationRun.findFirst({
            where: { projectId },
            select: { id: true },
          })
        : Promise.resolve(null),
      typeof db.aiEvaluationProjectRun?.findFirst === "function"
        ? db.aiEvaluationProjectRun.findFirst({
            where: { projectId },
            select: { id: true },
          })
        : Promise.resolve(null),
      db.projectSnapshot.count({ where: { projectId } }),
    ]);

  return Boolean(
    run ||
      cov ||
      aiTest ||
      sysScenario ||
      evalRun ||
      evalProjRun ||
      snapshotCount > 1,
  );
};

export const updateProjectLifecycleStatus = async ({
  projectId,
  userId,
  lifecycleStatus,
  isPinned,
  db = prisma,
}) => {
  const access = await resolveProjectAccess({
    projectId,
    userId,
    capability: LIFECYCLE_MANAGE_CAPABILITY,
    db,
  });

  if (lifecycleStatus !== undefined) {
    const hasActivity =
      lifecycleStatus === "NOT_STARTED"
        ? await hasProjectLifecycleActivity(projectId, db)
        : false;
    const validation = validateLifecycleTransition({
      currentStatus: access.project?.lifecycleStatus || "NOT_STARTED",
      nextStatus: lifecycleStatus,
      hasActivity,
    });
    if (!validation.allowed) {
      throw new ServiceError(
        validation.reason,
        validation.code === "CANNOT_REVERT_TO_NOT_STARTED" ? 409 : 400,
        validation.code,
      );
    }
  }

  const dataToUpdate = {};
  if (lifecycleStatus !== undefined) {
    dataToUpdate.lifecycleStatus = lifecycleStatus;
    dataToUpdate.lifecycleUpdatedAt = new Date();
  }
  if (isPinned !== undefined) {
    dataToUpdate.isPinned = Boolean(isPinned);
  }

  const updatedProject = await db.project.update({
    where: { id: projectId },
    data: dataToUpdate,
    select: {
      id: true,
      name: true,
      lifecycleStatus: true,
      lifecycleUpdatedAt: true,
      isPinned: true,
      updatedAt: true,
    },
  });

  let memberIds = [];
  try {
    if (typeof db.projectMember?.findMany === "function") {
      const members = await db.projectMember.findMany({
        where: { projectId },
        select: { userId: true },
      });
      memberIds = members.map((m) => m.userId).filter(Boolean);
    }
  } catch (memberErr) {
    console.warn(
      "[updateProjectLifecycleStatus] Failed to load project members:",
      memberErr?.message || memberErr,
    );
  }

  const affectedUserIds = [
    ...new Set([access.project?.ownerId, userId, ...memberIds].filter(Boolean)),
  ];

  try {
    const { clearPortfolioCache } =
      await import("./portfolioDashboard.service.js");
    for (const uid of affectedUserIds) {
      clearPortfolioCache(uid);
    }
  } catch (cacheErr) {
    console.warn(
      "[updateProjectLifecycleStatus] Portfolio cache invalidation failed:",
      cacheErr?.message || cacheErr,
    );
  }
  try {
    const { clearUnifiedDashboardCache } =
      await import("./unifiedQualityDashboard.service.js");
    clearUnifiedDashboardCache();
  } catch (unifiedErr) {
    console.warn(
      "[updateProjectLifecycleStatus] Unified cache invalidation failed:",
      unifiedErr?.message || unifiedErr,
    );
  }
  try {
    const { emitPortfolioProjectUpdated } =
      await import("../realtime/portfolioSocket.emitter.js");
    emitPortfolioProjectUpdated({
      projectId,
      userId,
      userIds: affectedUserIds,
      lifecycleStatus: updatedProject.lifecycleStatus,
      isPinned: updatedProject.isPinned,
      action: "STATUS_UPDATED",
    });
  } catch (emitErr) {
    console.warn(
      "[updateProjectLifecycleStatus] Portfolio socket emit failed:",
      emitErr?.message || emitErr,
    );
  }
  try {
    const { emitDashboardMetricsUpdated } =
      await import("./dashboardEvents.service.js");
    emitDashboardMetricsUpdated(projectId, {
      reason: "project-status-updated",
      lifecycleStatus: updatedProject.lifecycleStatus,
    }).catch((dashErr) => {
      console.warn(
        "[updateProjectLifecycleStatus] Dashboard metrics emit failed:",
        dashErr?.message || dashErr,
      );
    });
  } catch (dashImportErr) {
    console.warn(
      "[updateProjectLifecycleStatus] Dashboard events import failed:",
      dashImportErr?.message || dashImportErr,
    );
  }

  return updatedProject;
};
