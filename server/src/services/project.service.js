import prisma from "../config/prisma.js";
import { membershipWhere, resolveProjectAccess, withProjectGuard } from "./projectAccess.service.js";
import { publishProjectEvent, deliverProjectEvent } from './projectEvent.service.js';
import { readVersionedProjectFile,projectEditableWorkspaceRoot } from "./projectFileVersion.service.js";
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
import { snapshotWorkspaceRoot, resolveSnapshotFile } from "../utils/snapshotWorkspace.js";

export { ServiceError };

function buildTree(dirPath, rootPath = dirPath) {
  const result = [];
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return result;
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      if (
        item === "node_modules" ||
        item === ".git" ||
        item === "__MACOSX" ||
        item === ".DS_Store" ||
        item.startsWith(".covai-")
      )
        continue;

      const itemPath = path.join(dirPath, item);
      const stat = fs.lstatSync(itemPath);
      if (stat.isSymbolicLink()) continue;
      const relativePath = path
        .relative(rootPath, itemPath)
        .replace(/\\/g, "/");

      if (stat.isDirectory()) {
        const children = buildTree(itemPath, rootPath);
        result.push({
          id: relativePath,
          name: item,
          type: "folder",
          children,
        });
      } else {
        let lang = "file";
        const lowerName = item.toLowerCase();
        const ext = path.extname(item).toLowerCase();

        if (lowerName.includes(".test.") || lowerName.includes(".spec.")) lang = "test";
        else if (ext === ".jsx" || ext === ".tsx") lang = "react";
        else if (ext === ".js" || ext === ".mjs" || ext === ".cjs") lang = "js";
        else if (ext === ".ts") lang = "ts";
        else if (ext === ".json") lang = "json";
        else if (ext === ".css" || ext === ".scss" || ext === ".sass" || ext === ".less") lang = "css";
        else if (ext === ".html" || ext === ".htm") lang = "html";
        else if (ext === ".md") lang = "md";
        else if (
          ext === ".png" ||
          ext === ".jpg" ||
          ext === ".jpeg" ||
          ext === ".svg" ||
          ext === ".gif" ||
          ext === ".ico"
        )
          lang = "image";

        result.push({
          id: relativePath,
          name: item,
          type: "file",
          lang,
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

  return project;
};

export const listProjects = async (userId) => {
  return prisma.project.findMany({
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
      createdAt: true,
      updatedAt: true,
      snapshots: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
      _count: {
        select: {
          snapshots: true,
        },
      },
    },
  });
};

export const getProjectById = async (projectId, userId) => {
  await resolveProjectAccess({projectId,userId,capability:"project.read"});
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
      const validation = await validateNodeProject(resolvedRootDir, { autoCreate: true });

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
          hasJest: detection.hasJest,
          jestConfigPath: detection.configPath,
          jestCommand: detection.jestCommand,
        },
      });

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
    if (ignoreDirs.includes(entry.name) || entry.name === '.covai-collaboration') continue;

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

export const listProjectSnapshots = async ({ projectId, userId }) => {
  const { project } = await resolveProjectAccess({projectId,userId,capability:"project.read"});
  if (!project) throw new ServiceError("Project not found", 404);
  const snapshots = await prisma.projectSnapshot.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { ProjectStructureAnalysis: { select: { schemaVersion: true } } },
  });

  return snapshots.map((snapshot, idx) => {
    let meta = null;
    if (snapshot.rootDir && fs.existsSync(snapshot.rootDir)) {
      const metaPath = path.join(snapshotWorkspaceRoot(snapshot), ".covai-checkpoint.json");
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        } catch (_) {}
      }
    }

    const defaultLabel = snapshot.commitSha
      ? `Git: ${snapshot.commitSha.slice(0, 7)}`
      : idx === snapshots.length - 1
        ? "Initial Ingest"
        : `Checkpoint #${snapshots.length - idx}`;

    const defaultMessage =
      snapshot.source === "GITHUB"
        ? "Imported from GitHub repository"
        : "Uploaded from compressed archive";

    return {
      ...snapshotResponse({
        ...snapshot,
        structureAnalysis: snapshot.ProjectStructureAnalysis ?? null,
      }),
      label: meta?.label || defaultLabel,
      message: meta?.message || defaultMessage,
      fileCount: meta?.fileCount ?? null,
      sizeBytes: meta?.sizeBytes ?? null,
      isCurrent: idx === 0,
    };
  });
};

const rebaseSnapshotConfigPath = (value, originalRoot, targetRoot) => {
  if (!value || !path.isAbsolute(value)) return value;
  const relative = path.relative(originalRoot, value);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ServiceError('Snapshot configuration must stay inside its project workspace', 422);
  }
  return path.join(targetRoot, relative);
};

export const createProjectCheckpoint = async ({
  projectId,
  userId,
  label,
  message,
}) => {
  const { project } = await resolveProjectAccess({ projectId, userId, capability: 'integrations.write' });
  if (!project)
    throw new ServiceError("Project not found or unauthorized", 404);

  const activeSnapshot = await prisma.projectSnapshot.findFirst({
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

  const newSnapshotId = `snap_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const baseStorage = path.resolve(
    "storage/projects",
    projectId,
    "snapshots",
    newSnapshotId,
  );
  fs.mkdirSync(baseStorage, { recursive: true });

  const workspaceRoot = projectEditableWorkspaceRoot(activeSnapshot);
  const analysisRelative = path.relative(workspaceRoot, activeSnapshot.rootDir);
  const checkpointAnalysisRoot = path.join(baseStorage, analysisRelative);
  const { fileCount, sizeBytes } = copyDirRecursive(workspaceRoot, baseStorage);

  const checkpointMeta = {
    id: newSnapshotId,
    label:
      label?.trim() ||
      `Checkpoint ${new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`,
    message: message?.trim() || "Manual snapshot checkpoint",
    createdAt: new Date().toISOString(),
    source: activeSnapshot.source,
    fileCount,
    sizeBytes,
  };

  const metaPath = path.join(baseStorage, ".covai-checkpoint.json");
  fs.writeFileSync(metaPath, JSON.stringify(checkpointMeta, null, 2), "utf8");

  let detection = {
    hasJest: activeSnapshot.hasJest,
    configPath: rebaseSnapshotConfigPath(activeSnapshot.jestConfigPath, workspaceRoot, baseStorage),
    jestCommand: activeSnapshot.jestCommand,
  };
  try {
    detection = detectJest(checkpointAnalysisRoot);
  } catch (_) {}

  const checksum = `cp_${Date.now()}_${randomUUID().slice(0, 8)}`;

  const committed = await withProjectGuard({ projectId, userId, capability: 'integrations.write' }, async (tx, access) => {
    if (access.project.workspaceRevision !== project.workspaceRevision) throw new ServiceError('Workspace changed while preparing checkpoint; try again', 409, 'SNAPSHOT_CHANGED');
    const newSnapshot = await tx.projectSnapshot.create({
    data: {
      projectId,
      source: activeSnapshot.source,
      checksum,
      commitSha: null,
      storagePath: baseStorage,
      rootDir: checkpointAnalysisRoot,
      hasJest: detection.hasJest,
      jestConfigPath: detection.configPath,
      jestCommand: detection.jestCommand,
      hasVitest: activeSnapshot.hasVitest,
      vitestCommand: activeSnapshot.vitestCommand,
      vitestConfigPath: rebaseSnapshotConfigPath(activeSnapshot.vitestConfigPath, workspaceRoot, baseStorage),
      hasPlaywright: activeSnapshot.hasPlaywright,
      playwrightBrowsers: activeSnapshot.playwrightBrowsers,
      playwrightCommand: activeSnapshot.playwrightCommand,
      playwrightConfigPath: rebaseSnapshotConfigPath(activeSnapshot.playwrightConfigPath, workspaceRoot, baseStorage),
      playwrightTestDir: rebaseSnapshotConfigPath(activeSnapshot.playwrightTestDir, workspaceRoot, baseStorage),
      hasCypress: activeSnapshot.hasCypress,
      cypressCommand: activeSnapshot.cypressCommand,
      cypressConfigPath: rebaseSnapshotConfigPath(activeSnapshot.cypressConfigPath, workspaceRoot, baseStorage),
      cypressTestDir: rebaseSnapshotConfigPath(activeSnapshot.cypressTestDir, workspaceRoot, baseStorage),
      cypressVersion: activeSnapshot.cypressVersion,
      testingFrameworksJson: activeSnapshot.testingFrameworksJson,
      frameworkRecommendationJson: activeSnapshot.frameworkRecommendationJson,
      selectedTestingFramework: activeSnapshot.selectedTestingFramework,
    },
    });
    const updated = await tx.project.update({ where: { id: projectId }, data: { workspaceRevision: { increment: 1 } } });
    const event = await publishProjectEvent({ tx, projectId, actorId: userId, type: 'workspace.changed', resourceId: newSnapshot.id, revision: updated.workspaceRevision });
    return { newSnapshot, event };
  });
  const { newSnapshot } = committed;
  await deliverProjectEvent(committed.event).catch(() => {});

  return {
    ...snapshotResponse(newSnapshot),
    label: checkpointMeta.label,
    message: checkpointMeta.message,
    fileCount,
    sizeBytes,
    isCurrent: true,
  };
};

export const restoreProjectCheckpoint = async ({
  projectId,
  snapshotId,
  userId,
}) => {
  const { project } = await resolveProjectAccess({ projectId, userId, capability: 'snapshot.restore' });
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
  const targetAnalysisRelative = path.relative(targetWorkspace, targetSnapshot.rootDir);

  // Stage the target before changing the working tree, including when restoring
  // the active snapshot itself.
  const restoreCheckpointId = `snap_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const restoreStorage = path.resolve("storage/projects", projectId, "snapshots", restoreCheckpointId);
  fs.mkdirSync(restoreStorage, { recursive: true });
  const { fileCount, sizeBytes } = copyDirRecursive(targetWorkspace, restoreStorage, [".git", "node_modules"]);
  // A restore publishes a new active snapshot. Never erase a workspace that
  // another member or worker may still be reading from the historical snapshot.

  let targetLabel = targetSnapshot.id.slice(0, 8);
  const targetMetaPath = path.join(
    restoreStorage,
    ".covai-checkpoint.json",
  );
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

  const committed = await withProjectGuard({ projectId, userId, capability: 'snapshot.restore' }, async (tx, access) => {
    if (access.project.workspaceRevision !== project.workspaceRevision) throw new ServiceError('Workspace changed while preparing restore; try again', 409, 'SNAPSHOT_CHANGED');
    const newSnapshot = await tx.projectSnapshot.create({
    data: {
      projectId,
      source: targetSnapshot.source,
      checksum,
      commitSha: null,
      storagePath: restoreStorage,
      rootDir: path.join(restoreStorage, targetAnalysisRelative),
      hasJest: targetSnapshot.hasJest,
      jestConfigPath: rebaseSnapshotConfigPath(targetSnapshot.jestConfigPath, targetWorkspace, restoreStorage),
      jestCommand: targetSnapshot.jestCommand,
      hasVitest: targetSnapshot.hasVitest,
      vitestCommand: targetSnapshot.vitestCommand,
      vitestConfigPath: rebaseSnapshotConfigPath(targetSnapshot.vitestConfigPath, targetWorkspace, restoreStorage),
      hasPlaywright: targetSnapshot.hasPlaywright,
      playwrightBrowsers: targetSnapshot.playwrightBrowsers,
      playwrightCommand: targetSnapshot.playwrightCommand,
      playwrightConfigPath: rebaseSnapshotConfigPath(targetSnapshot.playwrightConfigPath, targetWorkspace, restoreStorage),
      playwrightTestDir: rebaseSnapshotConfigPath(targetSnapshot.playwrightTestDir, targetWorkspace, restoreStorage),
      hasCypress: targetSnapshot.hasCypress,
      cypressCommand: targetSnapshot.cypressCommand,
      cypressConfigPath: rebaseSnapshotConfigPath(targetSnapshot.cypressConfigPath, targetWorkspace, restoreStorage),
      cypressTestDir: rebaseSnapshotConfigPath(targetSnapshot.cypressTestDir, targetWorkspace, restoreStorage),
      cypressVersion: targetSnapshot.cypressVersion,
      testingFrameworksJson: targetSnapshot.testingFrameworksJson,
      frameworkRecommendationJson: targetSnapshot.frameworkRecommendationJson,
      selectedTestingFramework: targetSnapshot.selectedTestingFramework,
    },
    });
    const updated = await tx.project.update({ where: { id: projectId }, data: { workspaceRevision: { increment: 1 } } });
    const event = await publishProjectEvent({ tx, projectId, actorId: userId, type: 'workspace.changed', resourceId: newSnapshot.id, revision: updated.workspaceRevision });
    return { newSnapshot, event };
  });
  const { newSnapshot } = committed;
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
  try {
    return analysisResultResponse(analysis);
  } catch {
    throw new ServiceError("Stored architecture analysis is invalid", 500);
  }
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

  await resolveProjectAccess({projectId,userId,capability:'tests.run'});
  const snapshot = await prisma.projectSnapshot.findFirst({where:{id:snapshotId,projectId}});
  if (!snapshot) throw new ServiceError('Snapshot not found',404);

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

/**
 * Asynchronously clean up Firebase storage and local disk files in the background.
 * Uses non-blocking fs.promises.rm and parallel Firebase file deletions
 * so that it doesn't block the HTTP request or freeze the Node.js event loop.
 */
export const cleanupProjectStorageAsync = (projectId, snapshots = []) => {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(projectId)) return;
  setImmediate(async () => {
    // 1. Firebase storage cleanup (parallelized)
    try {
      const bucket = getBucket();
      if (bucket) {
        const deletePromises = [];
        for (const snap of snapshots) {
          if (typeof snap?.storagePath === 'string' && snap.storagePath.startsWith(`projects/${projectId}/`)) {
            deletePromises.push(
              bucket
                .file(snap.storagePath)
                .delete()
                .catch((fbErr) => {
                  if (fbErr?.code !== 404) {
                    console.warn(
                      `[DeleteProject] Failed to delete Firebase file ${snap.storagePath}:`,
                      fbErr?.message,
                    );
                  }
                }),
            );
          }
        }
        await Promise.all(deletePromises);

        try {
          const [files] = await bucket.getFiles({
            prefix: `projects/${projectId}/`,
          });
          if (files && files.length > 0) {
            await Promise.all(files.map((file) => file.delete().catch(() => {})));
          }
        } catch (prefixErr) {
          console.warn(
            `[DeleteProject] Failed to cleanup Firebase prefix for ${projectId}:`,
            prefixErr?.message,
          );
        }
      }
    } catch (fbCleanupErr) {
      console.error(
        "[DeleteProject] Firebase cleanup error:",
        fbCleanupErr?.message || fbCleanupErr,
      );
    }

    // 2. Physical local disk cleanup (asynchronous & non-blocking via fs.promises.rm)
    try {
      for (const snap of snapshots) {
        if (snap?.rootDir) {
          const managedRoots = [path.resolve('storage/projects', projectId),
            ...(typeof snap.id === 'string' && /^[A-Za-z0-9_-]+$/.test(snap.id) ? [path.resolve('uploads/snapshots', snap.id)] : [])];
          const candidate = path.resolve(snap.rootDir);
          const managed = managedRoots.find(base => candidate === base || candidate.startsWith(base + path.sep));
          if (!managed) continue;
          let real;
          try { real = await fs.promises.realpath(candidate); } catch { continue; }
          if (real !== managed && !real.startsWith(managed + path.sep)) continue;
          await fs.promises
            .rm(snap.rootDir, {
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 100,
            })
            .catch(() => {});
        }
      }
      const projectStoragePath = path.resolve("storage/projects", projectId);
      await fs.promises
        .rm(projectStoragePath, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        })
        .catch(() => {});
    } catch (cleanupError) {
      console.error(
        "[DeleteProject] Error deleting physical files of project:",
        cleanupError?.message || cleanupError,
      );
    }
  });
};

export const deleteProject = async (projectId, userId) => {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(projectId)) throw new ServiceError('Invalid project ID', 400);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new ServiceError("Project not found", 404);
  }
  if (project.ownerId !== userId) {
    throw new ServiceError("You are not allowed to delete this project", 403);
  }

  // Pre-fetch snapshots before project deletion so we can clean up files in background
  const snapshots = await prisma.projectSnapshot.findMany({
    where: { projectId },
    select: { id: true, rootDir: true, storagePath: true },
  });

  // Fast DB deletion:
  // Primary attempt: Native PostgreSQL ON DELETE CASCADE via prisma.project.delete.
  // Takes only 1 single SQL query (~10-50ms) instead of 14 separate slow queries.
  try {
    await withProjectGuard({ projectId, userId, capability: 'project.delete' }, tx => tx.project.delete({ where: { id: projectId } }));
  } catch (error) {
    if (error.code !== 'P2003') throw error;
    console.warn(
      `[DeleteProject] Direct cascade delete failed for project ${projectId}, falling back to manual cascade transaction:`,
      error?.message,
    );
    await withProjectGuard({ projectId, userId, capability: 'project.delete' }, async tx => {
        await tx.coverageSummary.deleteMany({ where: { snapshot: { projectId } } });
        await tx.coverageFile.deleteMany({ where: { snapshot: { projectId } } });
        await tx.coverageFunction.deleteMany({
          where: { snapshot: { projectId } },
        });
        await tx.cyclomatic.deleteMany({ where: { snapshot: { projectId } } });
        await tx.cfg.deleteMany({ where: { snapshot: { projectId } } });
        await tx.aiContextCache.deleteMany({ where: { snapshot: { projectId } } });
        await tx.aiSuggestion.deleteMany({ where: { projectId } });
        await tx.aiTest.deleteMany({ where: { projectId } });
        await tx.jobLog.deleteMany({ where: { job: { projectId } } });
        await tx.jobOutput.deleteMany({ where: { job: { projectId } } });
        await tx.job.deleteMany({ where: { projectId } });
        await tx.notification.deleteMany({ where: { projectId } });
        await tx.projectSnapshot.deleteMany({ where: { projectId } });
        await tx.project.delete({ where: { id: projectId } });
    });
  }

  // Dispatch background cleanup for cloud storage and disk files.
  // Returns immediately without blocking the client response!
  cleanupProjectStorageAsync(projectId, snapshots);
};

export const getProjectTree = async (projectId, userId, options = {}) => {
  return withProjectGuard({projectId,userId,capability:'project.read'}, async (tx,access) => {
    const snapshot = await tx.projectSnapshot.findFirst({where:{projectId,...(options.snapshotId ? {id:options.snapshotId} : {})},orderBy:options.snapshotId ? undefined : {createdAt:'desc'}});
    if (!snapshot?.rootDir) throw new ServiceError("Project snapshot not ready", 202);
    const workspaceRoot = projectEditableWorkspaceRoot(snapshot);
    const {recoverProjectMutationMarkers} = await import('./projectMutationRecovery.service.js');
    await recoverProjectMutationMarkers({tx,project:access.project,snapshot,root:workspaceRoot});
    const tree = buildTree(workspaceRoot);
    return options.withMetadata ? {tree,snapshotId:snapshot.id,workspaceRevision:access.project.workspaceRevision} : tree;
  });
};

export const getFileContent = (projectId, userId, filePath, options = {}) =>
  readVersionedProjectFile({projectId,userId,path:filePath,snapshotId:typeof options === "string" ? options : options?.snapshotId});

export const updateFileContent = (projectId, userId, filePath, content, options = {}) =>
  mutateProjectWorkspace({projectId,userId,path:filePath,content,kind:'WRITE_FILE',...options});

export const createProjectFile = (projectId, userId, filePath, content = '', options = {}) =>
  mutateProjectWorkspace({projectId,userId,path:filePath,content,kind:'CREATE_FILE',...options});

export const createProjectFolder = (projectId, userId, filePath, options = {}) =>
  mutateProjectWorkspace({projectId,userId,path:filePath,kind:'CREATE_FOLDER',...options});

export const renameProjectEntry = (projectId, userId, filePath, _content, newPath, options = {}) =>
  mutateProjectWorkspace({projectId,userId,path:filePath,newPath,kind:'RENAME_ENTRY',...options});

export const deleteProjectEntry = (projectId, userId, filePath, options = {}) =>
  mutateProjectWorkspace({projectId,userId,path:filePath,kind:'DELETE_ENTRY',...options});
