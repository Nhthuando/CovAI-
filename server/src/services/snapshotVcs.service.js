import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import {
  invalidateProjectAccessCache,
  resolveProjectAccess,
  withProjectGuard,
} from "./projectAccess.service.js";
import {
  hashFileContent,
  projectEditableWorkspaceRoot,
  resolveActiveProjectSnapshot,
  VCS_SNAPSHOT_LEAN_SELECT,
} from "./projectFileVersion.service.js";
import {
  getProjectRequestContext,
  invalidateProjectRequestContext,
  updateProjectRequestContext,
} from "./vcsRequestContext.service.js";
import {
  assertEditorReplacementAllowed,
  assertEditorSnapshotChangeAllowed,
  reconcileEditorReplacement,
} from "./projectEditorBridge.service.js";
import { deliverProjectEvent, publishProjectEvent } from "./projectEvent.service.js";
import { deliverScopedProjectTransport } from "./projectSubscription.service.js";
import { detectJest } from "../utils/jestDetector.js";
import {
  clearProjectTreeCache,
  computeSnapshotContentHash,
  rebaseSnapshotConfigPath,
} from "./project.service.js";
import {
  clearPortfolioCache,
} from "./portfolioDashboard.service.js";
import { clearUnifiedDashboardCache } from "./unifiedQualityDashboard.service.js";
import { withProjectVcsLock } from "./vcsLock.service.js";
import {
  computeManifestHash,
  ensureProjectCasBaseline,
  getBlobDiskPath,
  readCasBlob,
  runSnapshotCasGc,
  sanitizeVcsRelativePath,
  scanWorkingTree,
  syncWorkspaceFromManifest,
  validateSafeId,
  writeCasBlob,
} from "./snapshotCas.service.js";
import {
  buildDiffPairResult,
  diffManifests,
  findLowestCommonAncestor,
  resolveConflictMarkersKeepBoth,
  threeWayMergeText,
} from "./snapshotDiff3.service.js";
import { generateSnapshotAiSummary } from "./snapshotVcsAi.service.js";
import {
  SNAPSHOT_RESTORE_POLICIES,
  SNAPSHOT_SOCKET_EVENTS,
  SNAPSHOT_VCS_LIMITS,
  validateSnapshotBranchName,
  validateSnapshotTagName,
} from "../../../shared/snapshotVcsProtocol.js";
import { detectBinaryBuffer } from "./gitPorcelainParser.service.js";

function emitSnapshotVcsUpdated(projectId, payload = {}) {
  if (!projectId) return;
  void deliverScopedProjectTransport({
    projectId,
    event: SNAPSHOT_SOCKET_EVENTS.UPDATED,
    payload: { projectId, ...payload },
  }).catch(() => {});
}

function normalizeDirtyPolicy(rawPolicy, defaultPolicy = SNAPSHOT_RESTORE_POLICIES.AUTO_BACKUP, autoBackupFlag) {
  if (autoBackupFlag === false && !rawPolicy) {
    return SNAPSHOT_RESTORE_POLICIES.DISCARD_DIRTY;
  }
  const normalized = String(rawPolicy || "").trim().toUpperCase();
  if (normalized === "AUTO_BACKUP" || normalized === "AUTO-BACKUP") {
    return SNAPSHOT_RESTORE_POLICIES.AUTO_BACKUP;
  }
  if (normalized === "DISCARD_DIRTY" || normalized === "DISCARD") {
    return SNAPSHOT_RESTORE_POLICIES.DISCARD_DIRTY;
  }
  if (normalized === "FAIL_IF_DIRTY" || normalized === "FAIL") {
    return SNAPSHOT_RESTORE_POLICIES.FAIL_IF_DIRTY;
  }
  return defaultPolicy;
}

function formatCheckpointSummary(row, activeSnapshotId, branchHeadIds = new Set()) {
  if (!row) return null;
  const coverageSummary = row.coverageSummaries
    ? {
        linePct: row.coverageSummaries.linesPct ?? 0,
        branchPct: row.coverageSummaries.branchesPct ?? 0,
        stmtPct: row.coverageSummaries.stmtsPct ?? 0,
        funcPct: row.coverageSummaries.funcsPct ?? 0,
      }
    : null;

  return {
    id: row.id,
    projectId: row.projectId,
    source: row.source,
    versionNumber: row.versionNumber ?? null,
    shortHash: row.contentHash ? row.contentHash.slice(0, 8) : row.id.slice(0, 8),
    contentHash: row.contentHash || null,
    label: row.label || `Snapshot #${row.versionNumber || "?"}`,
    commitMessage: row.commitMessage || "",
    parentSnapshotId: row.parentSnapshotId || null,
    secondParentSnapshotId: row.statsJson?.secondParentSnapshotId || null,
    parents: [
      row.parentSnapshotId,
      row.statsJson?.secondParentSnapshotId,
    ].filter(Boolean),
    restoredFromSnapshotId: row.restoredFromSnapshotId || null,
    vcsBranchId: row.vcsBranchId || null,
    vcsBranch: row.vcsBranch
      ? {
          id: row.vcsBranch.id,
          name: row.vcsBranch.name,
          isDefault: Boolean(row.vcsBranch.isDefault),
        }
      : null,
    author: row.author
      ? {
          id: row.author.id,
          name: row.author.name,
          email: row.author.email,
          avatarUrl: row.author.avatarUrl || null,
        }
      : null,
    tags: Array.isArray(row.vcsTags)
      ? row.vcsTags.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description || null,
          color: t.color || "indigo",
          createdAt: t.createdAt,
        }))
      : [],
    statsJson: row.statsJson || null,
    isPinned: Boolean(row.isPinned),
    isAutoBackup: Boolean(row.isAutoBackup),
    casMaterialized: Boolean(row.casMaterialized),
    isCurrent: row.id === activeSnapshotId,
    isBranchHead: branchHeadIds.has(row.id),
    coverageSummary,
    createdAt: row.createdAt,
  };
}

async function loadSnapshotManifestMap(db, snapshotId) {
  const entries = await db.snapshotVcsEntry.findMany({
    where: { snapshotId },
    select: {
      relativePath: true,
      blobSha256: true,
      byteSize: true,
      isBinary: true,
      mode: true,
    },
    orderBy: { relativePath: "asc" },
  });
  const map = new Map();
  for (const e of entries) {
    map.set(e.relativePath, {
      relativePath: e.relativePath,
      blobSha256: e.blobSha256,
      sha256: e.blobSha256,
      byteSize: e.byteSize,
      isBinary: e.isBinary,
      mode: e.mode,
    });
  }
  return map;
}

async function syncFileVersionsForChanges(tx, { snapshotId, userId, changedFiles }) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return;
  const normalized = changedFiles.map((change) => {
    const deleted = change.content === null;
    const sha256 = deleted
      ? null
      : hashFileContent(
          Buffer.isBuffer(change.content)
            ? change.content
            : Buffer.from(String(change.content || ""), "utf8"),
        );
    return { path: change.path, deleted, sha256 };
  });

  const existingRows = await tx.projectFileVersion.findMany({
    where: {
      snapshotId,
      relativePath: { in: normalized.map((c) => c.path) },
    },
    select: { relativePath: true },
  });
  const existingSet = new Set(existingRows.map((r) => r.relativePath));

  const toCreate = normalized
    .filter((c) => !existingSet.has(c.path))
    .map((c) => ({
      snapshotId,
      relativePath: c.path,
      sha256: c.sha256,
      deleted: c.deleted,
      revision: 1,
      updatedByUserId: userId,
    }));

  const toUpdate = normalized.filter((c) => existingSet.has(c.path));

  const ops = [];
  if (toCreate.length > 0) {
    ops.push(
      tx.projectFileVersion.createMany({
        data: toCreate,
        skipDuplicates: true,
      }),
    );
  }
  for (const c of toUpdate) {
    ops.push(
      tx.projectFileVersion.update({
        where: {
          snapshotId_relativePath: {
            snapshotId,
            relativePath: c.path,
          },
        },
        data: {
          sha256: c.sha256,
          deleted: c.deleted,
          revision: { increment: 1 },
          updatedByUserId: userId,
        },
      }),
    );
  }
  if (ops.length > 0) {
    await Promise.all(ops);
  }
}

function snapshotInheritedFields(sourceSnap, targetWorkspace, nextStorage, nextRoot) {
  return {
    storagePath: nextStorage,
    rootDir: nextRoot,
    hasJest: Boolean(sourceSnap?.hasJest),
    jestConfigPath: sourceSnap?.jestConfigPath
      ? rebaseSnapshotConfigPath(sourceSnap.jestConfigPath, targetWorkspace, nextStorage)
      : null,
    jestCommand: sourceSnap?.jestCommand || null,
    hasVitest: Boolean(sourceSnap?.hasVitest),
    vitestCommand: sourceSnap?.vitestCommand || null,
    vitestConfigPath: sourceSnap?.vitestConfigPath
      ? rebaseSnapshotConfigPath(sourceSnap.vitestConfigPath, targetWorkspace, nextStorage)
      : null,
    hasPlaywright: Boolean(sourceSnap?.hasPlaywright),
    playwrightBrowsers: sourceSnap?.playwrightBrowsers || null,
    playwrightCommand: sourceSnap?.playwrightCommand || null,
    playwrightConfigPath: sourceSnap?.playwrightConfigPath
      ? rebaseSnapshotConfigPath(sourceSnap.playwrightConfigPath, targetWorkspace, nextStorage)
      : null,
    playwrightTestDir: sourceSnap?.playwrightTestDir
      ? rebaseSnapshotConfigPath(sourceSnap.playwrightTestDir, targetWorkspace, nextStorage)
      : null,
    hasCypress: Boolean(sourceSnap?.hasCypress),
    cypressCommand: sourceSnap?.cypressCommand || null,
    cypressConfigPath: sourceSnap?.cypressConfigPath
      ? rebaseSnapshotConfigPath(sourceSnap.cypressConfigPath, targetWorkspace, nextStorage)
      : null,
    cypressTestDir: sourceSnap?.cypressTestDir
      ? rebaseSnapshotConfigPath(sourceSnap.cypressTestDir, targetWorkspace, nextStorage)
      : null,
    cypressVersion: sourceSnap?.cypressVersion || null,
    testingFrameworksJson: sourceSnap?.testingFrameworksJson || null,
    frameworkRecommendationJson: sourceSnap?.frameworkRecommendationJson || null,
    selectedTestingFramework: sourceSnap?.selectedTestingFramework || null,
  };
}

function invalidateCachesAfterMutation({ projectId, ownerId, snapshotId }) {
  clearProjectTreeCache();
  invalidateProjectAccessCache(projectId);
  if (ownerId) clearPortfolioCache(ownerId);
  if (snapshotId) clearUnifiedDashboardCache(snapshotId);
}

const BRANCH_SELECT = {
  id: true,
  name: true,
  description: true,
  headSnapshotId: true,
  baseSnapshotId: true,
  isDefault: true,
  createdAt: true,
};

const SNAPSHOT_DETAIL_SELECT = {
  ...VCS_SNAPSHOT_LEAN_SELECT,
  vcsTags: {
    select: { id: true, name: true, description: true, color: true, createdAt: true },
  },
  author: { select: { id: true, name: true, email: true, avatarUrl: true } },
  vcsBranch: { select: { id: true, name: true, isDefault: true } },
};

function readContainedWorkingFile(workspaceRoot, relativePath) {
  try {
    const realRoot = fs.realpathSync(workspaceRoot);
    const target = path.resolve(realRoot, relativePath);
    const check = path.relative(realRoot, target);
    if (!check || check.startsWith("..") || path.isAbsolute(check)) {
      return Buffer.alloc(0);
    }
    let current = realRoot;
    for (const part of relativePath.split("/")) {
      current = path.join(current, part);
      if (!fs.existsSync(current)) return Buffer.alloc(0);
      if (fs.lstatSync(current).isSymbolicLink()) return Buffer.alloc(0);
    }
    if (fs.statSync(target).isFile()) {
      return fs.readFileSync(target);
    }
  } catch {
    return Buffer.alloc(0);
  }
  return Buffer.alloc(0);
}

export class SnapshotVcsService {
  /**
   * Resolves project membership, active snapshot, active VCS branch, and ensures
   * immutable CAS baseline has been materialized for legacy projects.
   */
  static async _ensureProjectContext(
    projectId,
    userId,
    capability = "project.read",
    { includeInheritedFields = false } = {},
  ) {
    validateSafeId(projectId, "projectId");
    const access = await resolveProjectAccess({ projectId, userId, capability });
    let project = access.project;
    if (!project) {
      throw new ServiceError("Project not found", 404, "PROJECT_NOT_FOUND");
    }

    const reqCtx = getProjectRequestContext();
    if (
      !includeInheritedFields &&
      reqCtx?.projectId === projectId &&
      reqCtx.activeSnapshot?.casMaterialized &&
      reqCtx.activeBranch &&
      project.activeVcsBranchId
    ) {
      const cachedRoot = projectEditableWorkspaceRoot(reqCtx.activeSnapshot);
      if (cachedRoot && fs.existsSync(cachedRoot)) {
        return {
          project,
          activeSnapshot: reqCtx.activeSnapshot,
          activeBranch: reqCtx.activeBranch,
          workspaceRoot: cachedRoot,
        };
      }
    }

    const snapSelect = includeInheritedFields ? undefined : VCS_SNAPSHOT_LEAN_SELECT;
    let [activeSnapshot, activeBranch] = await Promise.all([
      resolveActiveProjectSnapshot(prisma, projectId, project.activeSnapshotId, {
        select: snapSelect,
      }),
      project.activeVcsBranchId
        ? prisma.snapshotVcsBranch.findUnique({
            where: { id: project.activeVcsBranchId },
            select: BRANCH_SELECT,
          })
        : prisma.snapshotVcsBranch.findFirst({
            where: { projectId, isDefault: true },
            select: BRANCH_SELECT,
          }),
    ]);

    if (!activeSnapshot) {
      throw new ServiceError(
        "Project snapshot not ready or not extracted yet",
        404,
        "SNAPSHOT_NOT_READY",
      );
    }

    if (!activeSnapshot.casMaterialized || !project.activeVcsBranchId || !activeBranch) {
      await ensureProjectCasBaseline({
        projectId,
        snapshotId: activeSnapshot.id,
        userId,
        db: prisma,
      });
      invalidateProjectAccessCache(projectId);
      const [refetchedProj, refetchedSnap] = await Promise.all([
        prisma.project.findFirst({
          where: { id: projectId },
          select: {
            id: true,
            name: true,
            ownerId: true,
            activeSnapshotId: true,
            activeVcsBranchId: true,
            workspaceRevision: true,
          },
        }),
        resolveActiveProjectSnapshot(prisma, projectId, null, { select: snapSelect }),
      ]);
      if (refetchedProj) project = refetchedProj;
      if (refetchedSnap) activeSnapshot = refetchedSnap;
      activeBranch = project.activeVcsBranchId
        ? await prisma.snapshotVcsBranch.findUnique({
            where: { id: project.activeVcsBranchId },
            select: BRANCH_SELECT,
          })
        : await prisma.snapshotVcsBranch.findFirst({
            where: { projectId, isDefault: true },
            select: BRANCH_SELECT,
          });
    }

    const workspaceRoot = projectEditableWorkspaceRoot(activeSnapshot);
    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
      throw new ServiceError(
        "Project workspace directory not found on disk",
        404,
        "WORKSPACE_NOT_FOUND",
      );
    }

    if (reqCtx?.projectId === projectId) {
      updateProjectRequestContext({ project, activeSnapshot, activeBranch });
    }

    return {
      project,
      activeSnapshot,
      activeBranch,
      workspaceRoot,
    };
  }

  static async _loadStatusState(
    projectId,
    userId,
    { capability = "project.read", includeUnchanged = false } = {},
  ) {
    validateSafeId(projectId, "projectId");
    const access = await resolveProjectAccess({ projectId, userId, capability });
    let project = access.project;
    if (!project) {
      throw new ServiceError("Project not found", 404, "PROJECT_NOT_FOUND");
    }

    let activeSnapshot = null;
    let activeBranch = null;
    let headSnapDetail = null;
    let headMap = null;
    let stagedRows = null;
    let branchesCount = null;
    let checkpointsCount = null;

    if (project.activeSnapshotId && project.activeVcsBranchId) {
      const [
        snapRow,
        branchRow,
        manifestRows,
        stagedList,
        bCount,
        cCount,
      ] = await Promise.all([
        prisma.projectSnapshot.findFirst({
          where: { id: project.activeSnapshotId, projectId },
          select: SNAPSHOT_DETAIL_SELECT,
        }),
        prisma.snapshotVcsBranch.findUnique({
          where: { id: project.activeVcsBranchId },
          select: BRANCH_SELECT,
        }),
        loadSnapshotManifestMap(prisma, project.activeSnapshotId),
        prisma.snapshotVcsStaging.findMany({
          where: { projectId, userId },
          select: { relativePath: true },
        }),
        prisma.snapshotVcsBranch.count({ where: { projectId } }),
        prisma.projectSnapshot.count({ where: { projectId } }),
      ]);

      if (snapRow?.casMaterialized && snapRow?.rootDir && branchRow) {
        activeSnapshot = snapRow;
        activeBranch = branchRow;
        stagedRows = stagedList;
        branchesCount = bCount;
        checkpointsCount = cCount;

        const headId = branchRow.headSnapshotId || snapRow.id;
        if (headId === snapRow.id) {
          headMap = manifestRows;
          headSnapDetail = snapRow;
        } else {
          [headMap, headSnapDetail] = await Promise.all([
            loadSnapshotManifestMap(prisma, headId),
            prisma.projectSnapshot.findUnique({
              where: { id: headId },
              select: SNAPSHOT_DETAIL_SELECT,
            }),
          ]);
        }
      }
    }

    if (!activeSnapshot || !activeBranch || !headMap) {
      const ctx = await this._ensureProjectContext(projectId, userId, capability);
      project = ctx.project;
      activeSnapshot = ctx.activeSnapshot;
      activeBranch = ctx.activeBranch;
      const headSnapshotId = activeBranch?.headSnapshotId || activeSnapshot.id;
      [headMap, stagedRows, branchesCount, checkpointsCount, headSnapDetail] =
        await Promise.all([
          loadSnapshotManifestMap(prisma, headSnapshotId),
          prisma.snapshotVcsStaging.findMany({
            where: { projectId, userId },
            select: { relativePath: true },
          }),
          prisma.snapshotVcsBranch.count({ where: { projectId } }),
          prisma.projectSnapshot.count({ where: { projectId } }),
          prisma.projectSnapshot.findUnique({
            where: { id: headSnapshotId },
            select: SNAPSHOT_DETAIL_SELECT,
          }),
        ]);
    }

    const workspaceRoot = projectEditableWorkspaceRoot(activeSnapshot);
    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
      throw new ServiceError(
        "Project workspace directory not found on disk",
        404,
        "WORKSPACE_NOT_FOUND",
      );
    }

    const headSnapshotId = activeBranch?.headSnapshotId || activeSnapshot.id;
    const workingMap = scanWorkingTree(workspaceRoot);
    const { changes, unchangedPaths, stats } = diffManifests(headMap, workingMap);

    const stagedSet = new Set(stagedRows.map((r) => r.relativePath));
    const dirtyPathsSet = new Set(changes.map((c) => c.path));

    const stalePaths = [...stagedSet].filter((p) => !dirtyPathsSet.has(p));
    if (stalePaths.length > 0) {
      void prisma.snapshotVcsStaging
        .deleteMany({
          where: { projectId, userId, relativePath: { in: stalePaths } },
        })
        .catch(() => {});
      stalePaths.forEach((p) => stagedSet.delete(p));
    }

    const staged = changes.filter((c) => stagedSet.has(c.path));
    const unstaged = changes.filter((c) => !stagedSet.has(c.path));

    const status = {
      initialized: true,
      activeBranch: activeBranch || null,
      headCheckpoint: formatCheckpointSummary(
        headSnapDetail,
        project.activeSnapshotId,
        new Set([headSnapshotId]),
      ),
      activeSnapshotId: project.activeSnapshotId || activeSnapshot.id,
      branchesCount,
      checkpointsCount,
      staged,
      unstaged,
      unchangedCount: unchangedPaths.length,
      ...(includeUnchanged
        ? {
            unchangedFiles: unchangedPaths.map((p) => ({
              path: p,
              status: " ",
              statusText: "Unchanged",
            })),
          }
        : {}),
      clean: changes.length === 0,
      stats,
      workspaceRevision: project.workspaceRevision,
    };

    const reqCtx = getProjectRequestContext();
    if (reqCtx?.projectId === projectId) {
      updateProjectRequestContext({ project, activeSnapshot, activeBranch });
    }

    return {
      project,
      activeSnapshot,
      activeBranch,
      workspaceRoot,
      headMap,
      workingMap,
      changes,
      unchangedPaths,
      stats,
      stagedSet,
      branchesCount,
      checkpointsCount,
      headSnapDetail,
      status,
    };
  }

  /**
   * Returns live working tree changes vs active checkpoint HEAD, split by user staging.
   */
  static async getStatus(projectId, userId, { includeUnchanged = false } = {}) {
    const state = await this._loadStatusState(projectId, userId, {
      capability: "project.read",
      includeUnchanged,
    });
    return state.status;
  }

  /**
   * Stages selected changed files, a folder prefix, or `"all"`.
   */
  static async stageFiles(projectId, userId, { files, folder } = {}) {
    await resolveProjectAccess({ projectId, userId, capability: "vcs.local" });

    return withProjectVcsLock(projectId, async () => {
      const { changes, stagedSet, status } = await this._loadStatusState(
        projectId,
        userId,
        { capability: "vcs.local" },
      );
      let targetPaths = [];

      if (folder) {
        const cleanFolder = sanitizeVcsRelativePath(folder).replace(/\/+$/, "");
        targetPaths = changes
          .filter(
            (c) => c.path === cleanFolder || c.path.startsWith(`${cleanFolder}/`),
          )
          .map((c) => c.path);
      } else if (files === "all" || !files) {
        targetPaths = changes.map((c) => c.path);
      } else {
        const requested = new Set(
          (Array.isArray(files) ? files : [files]).map(sanitizeVcsRelativePath),
        );
        targetPaths = changes
          .filter((c) => requested.has(c.path))
          .map((c) => c.path);
      }

      if (targetPaths.length > 0) {
        await prisma.snapshotVcsStaging.createMany({
          data: targetPaths.map((relativePath) => ({
            projectId,
            userId,
            relativePath,
          })),
          skipDuplicates: true,
        });
        targetPaths.forEach((p) => stagedSet.add(p));
      }

      const nextStatus = {
        ...status,
        staged: changes.filter((c) => stagedSet.has(c.path)),
        unstaged: changes.filter((c) => !stagedSet.has(c.path)),
      };
      emitSnapshotVcsUpdated(projectId, { reason: "stage", actorId: userId });
      return nextStatus;
    });
  }

  /**
   * Unstages selected files, a folder prefix, or `"all"`.
   */
  static async unstageFiles(projectId, userId, { files, folder } = {}) {
    await resolveProjectAccess({ projectId, userId, capability: "vcs.local" });

    return withProjectVcsLock(projectId, async () => {
      const { changes, stagedSet, status } = await this._loadStatusState(
        projectId,
        userId,
        { capability: "vcs.local" },
      );

      if (folder) {
        const cleanFolder = sanitizeVcsRelativePath(folder).replace(/\/+$/, "");
        await prisma.snapshotVcsStaging.deleteMany({
          where: {
            projectId,
            userId,
            OR: [
              { relativePath: cleanFolder },
              { relativePath: { startsWith: `${cleanFolder}/` } },
            ],
          },
        });
        for (const p of [...stagedSet]) {
          if (p === cleanFolder || p.startsWith(`${cleanFolder}/`)) {
            stagedSet.delete(p);
          }
        }
      } else if (files === "all" || !files) {
        await prisma.snapshotVcsStaging.deleteMany({
          where: { projectId, userId },
        });
        stagedSet.clear();
      } else {
        const cleanPaths = (Array.isArray(files) ? files : [files]).map(
          sanitizeVcsRelativePath,
        );
        if (cleanPaths.length > 0) {
          await prisma.snapshotVcsStaging.deleteMany({
            where: { projectId, userId, relativePath: { in: cleanPaths } },
          });
          cleanPaths.forEach((p) => stagedSet.delete(p));
        }
      }

      const nextStatus = {
        ...status,
        staged: changes.filter((c) => stagedSet.has(c.path)),
        unstaged: changes.filter((c) => !stagedSet.has(c.path)),
      };
      emitSnapshotVcsUpdated(projectId, { reason: "unstage", actorId: userId });
      return nextStatus;
    });
  }

  /**
   * Discards working-tree edits back to HEAD CAS blobs (restores modified/deleted files
   * and removes newly added files cleanly).
   */
  static async discardChanges(projectId, userId, { files } = {}) {
    const { project, activeSnapshot, activeBranch, workspaceRoot } =
      await this._ensureProjectContext(projectId, userId, "vcs.local");

    return withProjectVcsLock(projectId, async () => {
      const headSnapshotId = activeBranch?.headSnapshotId || activeSnapshot.id;
      const headMap = await loadSnapshotManifestMap(prisma, headSnapshotId);
      const workingMap = scanWorkingTree(workspaceRoot);
      const { changes } = diffManifests(headMap, workingMap);

      let targetChanges = changes;
      let renameOrigsToRestore = [];
      if (files && files !== "all") {
        const requested = new Set(
          (Array.isArray(files) ? files : [files]).map(sanitizeVcsRelativePath),
        );
        targetChanges = changes.filter(
          (c) => requested.has(c.path) || (c.origPath && requested.has(c.origPath)),
        );
        renameOrigsToRestore = targetChanges
          .filter((c) => c.origPath)
          .map((c) => c.origPath);
      }

      if (targetChanges.length === 0) {
        return this.getStatus(projectId, userId);
      }

      const targetMap = new Map();
      for (const [k, v] of workingMap.entries()) {
        targetMap.set(k, { blobSha256: v.sha256, isBinary: v.isBinary });
      }
      const discardedPaths = new Set();

      for (const ch of targetChanges) {
        discardedPaths.add(ch.path);
        if (ch.origPath) discardedPaths.add(ch.origPath);

        if (ch.status === "A") {
          targetMap.delete(ch.path);
        } else if (ch.status === "R") {
          targetMap.delete(ch.path);
          if (ch.origPath && headMap.has(ch.origPath)) {
            const origEntry = headMap.get(ch.origPath);
            targetMap.set(ch.origPath, {
              blobSha256: origEntry.blobSha256,
              isBinary: origEntry.isBinary,
            });
          }
        } else if (headMap.has(ch.path)) {
          const headEntry = headMap.get(ch.path);
          targetMap.set(ch.path, {
            blobSha256: headEntry.blobSha256,
            isBinary: headEntry.isBinary,
          });
        }
      }
      for (const orig of renameOrigsToRestore) {
        if (headMap.has(orig) && !targetMap.has(orig)) {
          targetMap.set(orig, headMap.get(orig));
        }
      }

      const affectedPaths = [...discardedPaths];

      await withProjectGuard(
        { projectId, userId, capability: "vcs.local" },
        async (tx, access) => {
          await assertEditorReplacementAllowed({
            tx,
            projectId,
            snapshotId: activeSnapshot.id,
            paths: affectedPaths,
          });

          const { changedFiles } = syncWorkspaceFromManifest({
            projectId,
            rootDir: workspaceRoot,
            targetEntries: targetMap,
          });

          await syncFileVersionsForChanges(tx, {
            snapshotId: activeSnapshot.id,
            userId,
            changedFiles,
          });

          await reconcileEditorReplacement({
            tx,
            projectId,
            snapshotId: activeSnapshot.id,
            actorId: userId,
            source: "HUMAN_EDIT",
            changes: changedFiles,
          });

          await tx.snapshotVcsStaging.deleteMany({
            where: { projectId, userId, relativePath: { in: affectedPaths } },
          });

          const updatedProj = await tx.project.update({
            where: { id: projectId },
            data: { workspaceRevision: { increment: 1 } },
            select: { workspaceRevision: true },
          });

          const event = await publishProjectEvent({
            tx,
            projectId,
            type: "workspace.changed",
            actorId: userId,
            resourceId: activeSnapshot.id,
            revision: updatedProj.workspaceRevision,
            payload: { kind: "SNAPSHOT_DISCARD", paths: affectedPaths },
          });
          return { event };
        },
      ).then(({ event }) => deliverProjectEvent(event).catch(() => {}));

      invalidateCachesAfterMutation({
        projectId,
        ownerId: project.ownerId,
        snapshotId: activeSnapshot.id,
      });

      const nextStatus = await this.getStatus(projectId, userId);
      emitSnapshotVcsUpdated(projectId, { reason: "discard", actorId: userId });
      return nextStatus;
    });
  }

  /**
   * Returns before/after pair + hunks for Monaco `DiffEditor`.
   */
  static async getDiffPair(
    projectId,
    userId,
    { filePath, baseSnapshotId, targetSnapshotId = "WORKING_TREE", origPath } = {},
  ) {
    const safePath = sanitizeVcsRelativePath(filePath);
    const safeOrigPath = origPath ? sanitizeVcsRelativePath(origPath) : safePath;
    const { activeSnapshot, activeBranch, workspaceRoot } =
      await this._ensureProjectContext(projectId, userId, "project.read");

    const resolvedBaseId =
      !baseSnapshotId || baseSnapshotId === "HEAD"
        ? activeBranch?.headSnapshotId || activeSnapshot.id
        : baseSnapshotId;

    const lookupPaths = safeOrigPath !== safePath ? [safeOrigPath, safePath] : [safePath];
    const isWorkingTarget = !targetSnapshotId || targetSnapshotId === "WORKING_TREE";

    const [baseSnap, baseEntries, targetSnap, targetEntry] = await Promise.all([
      resolvedBaseId === activeSnapshot.id
        ? Promise.resolve(activeSnapshot)
        : prisma.projectSnapshot.findFirst({
            where: { id: resolvedBaseId, projectId },
            select: { id: true, label: true, versionNumber: true, casMaterialized: true },
          }),
      prisma.snapshotVcsEntry.findMany({
        where: {
          snapshotId: resolvedBaseId,
          relativePath: { in: lookupPaths },
        },
        select: { relativePath: true, blobSha256: true },
      }),
      isWorkingTarget
        ? Promise.resolve(null)
        : prisma.projectSnapshot.findFirst({
            where: { id: targetSnapshotId, projectId },
            select: { id: true, label: true, versionNumber: true },
          }),
      isWorkingTarget
        ? Promise.resolve(null)
        : prisma.snapshotVcsEntry.findUnique({
            where: {
              snapshotId_relativePath: {
                snapshotId: targetSnapshotId,
                relativePath: safePath,
              },
            },
            select: { blobSha256: true },
          }),
    ]);

    if (!baseSnap) {
      throw new ServiceError("Base checkpoint not found", 404, "SNAPSHOT_NOT_FOUND");
    }

    const baseEntry =
      baseEntries.find((e) => e.relativePath === safeOrigPath) ||
      baseEntries.find((e) => e.relativePath === safePath);
    const originalBuf = baseEntry
      ? readCasBlob(projectId, baseEntry.blobSha256)
      : Buffer.alloc(0);

    let modifiedBuf = Buffer.alloc(0);
    let modifiedLabel = "Working Tree";

    if (isWorkingTarget) {
      modifiedBuf = readContainedWorkingFile(workspaceRoot, safePath);
    } else {
      if (!targetSnap) {
        throw new ServiceError("Target checkpoint not found", 404, "SNAPSHOT_NOT_FOUND");
      }
      modifiedLabel = targetSnap.label || `#v${targetSnap.versionNumber || "?"}`;
      if (targetEntry) {
        modifiedBuf = readCasBlob(projectId, targetEntry.blobSha256);
      }
    }

    return buildDiffPairResult({
      filePath: safePath,
      origPath: safeOrigPath !== safePath ? safeOrigPath : null,
      originalBuf,
      modifiedBuf,
      originalLabel: baseSnap.label || `#v${baseSnap.versionNumber || "?"}`,
      modifiedLabel,
    });
  }

  /**
   * Compares two checkpoints (or a checkpoint vs `"WORKING_TREE"`).
   */
  static async compareCheckpoints(
    projectId,
    userId,
    { baseSnapshotId, targetSnapshotId = "WORKING_TREE" },
  ) {
    const { project, activeSnapshot, workspaceRoot } =
      await this._ensureProjectContext(projectId, userId, "project.read");

    const baseSnap = await prisma.projectSnapshot.findFirst({
      where: { id: baseSnapshotId, projectId },
      select: {
        id: true,
        projectId: true,
        source: true,
        versionNumber: true,
        contentHash: true,
        label: true,
        commitMessage: true,
        casMaterialized: true,
        createdAt: true,
      },
    });
    if (!baseSnap) {
      throw new ServiceError("Base checkpoint not found", 404, "SNAPSHOT_NOT_FOUND");
    }
    if (!baseSnap.casMaterialized) {
      await ensureProjectCasBaseline({ projectId, snapshotId: baseSnap.id, userId });
    }

    const baseMap = await loadSnapshotManifestMap(prisma, baseSnap.id);
    let targetMap;
    let targetSummary = null;

    if (!targetSnapshotId || targetSnapshotId === "WORKING_TREE") {
      targetMap = scanWorkingTree(workspaceRoot);
      targetSummary = { id: "WORKING_TREE", label: "Working Tree" };
    } else {
      const targetSnap = await prisma.projectSnapshot.findFirst({
        where: { id: targetSnapshotId, projectId },
        select: {
          id: true,
          projectId: true,
          source: true,
          versionNumber: true,
          contentHash: true,
          label: true,
          commitMessage: true,
          casMaterialized: true,
          createdAt: true,
        },
      });
      if (!targetSnap) {
        throw new ServiceError("Target checkpoint not found", 404, "SNAPSHOT_NOT_FOUND");
      }
      if (!targetSnap.casMaterialized) {
        await ensureProjectCasBaseline({ projectId, snapshotId: targetSnap.id, userId });
      }
      targetMap = await loadSnapshotManifestMap(prisma, targetSnap.id);
      targetSummary = formatCheckpointSummary(targetSnap, project.activeSnapshotId);
    }

    const { changes, unchangedPaths, stats } = diffManifests(baseMap, targetMap);

    return {
      base: formatCheckpointSummary(baseSnap, activeSnapshot.id),
      target: targetSummary,
      changes,
      unchangedCount: unchangedPaths.length,
      stats,
    };
  }

  /**
   * Lists checkpoints with pagination, branch/tag/pinned/search filtering, and coverage scores.
   */
  static async listCheckpoints(
    projectId,
    userId,
    { branchId, search, tag, pinnedOnly = false, page = 1, limit = 50 } = {},
  ) {
    const { project } = await this._ensureProjectContext(
      projectId,
      userId,
      "project.read",
    );

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
    const where = { projectId };

    if (branchId) where.vcsBranchId = branchId;
    if (pinnedOnly) where.isPinned = true;
    if (tag) {
      where.vcsTags = { some: { name: tag.trim() } };
    }
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { label: { contains: q, mode: "insensitive" } },
        { commitMessage: { contains: q, mode: "insensitive" } },
        { contentHash: { startsWith: q, mode: "insensitive" } },
      ];
    }

    const [total, rows, branches] = await Promise.all([
      prisma.projectSnapshot.count({ where }),
      prisma.projectSnapshot.findMany({
        where,
        orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: {
          id: true,
          projectId: true,
          source: true,
          versionNumber: true,
          contentHash: true,
          label: true,
          commitMessage: true,
          parentSnapshotId: true,
          restoredFromSnapshotId: true,
          vcsBranchId: true,
          statsJson: true,
          isPinned: true,
          isAutoBackup: true,
          casMaterialized: true,
          createdAt: true,
          author: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          vcsBranch: {
            select: { id: true, name: true, isDefault: true },
          },
          vcsTags: {
            select: { id: true, name: true, description: true, color: true, createdAt: true },
          },
          coverageSummaries: {
            select: { linesPct: true, branchesPct: true, stmtsPct: true, funcsPct: true },
          },
        },
      }),
      prisma.snapshotVcsBranch.findMany({
        where: { projectId },
        select: { headSnapshotId: true },
      }),
    ]);

    const branchHeadIds = new Set(branches.map((b) => b.headSnapshotId).filter(Boolean));
    const checkpoints = rows.map((row) =>
      formatCheckpointSummary(row, project.activeSnapshotId, branchHeadIds),
    );

    return {
      checkpoints,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  }

  /**
   * Captures a new immutable checkpoint (Commit) from staged changes (or all changes),
   * storing only newly changed file blobs into CAS.
   */
  static async captureCheckpoint(
    projectId,
    userId,
    { label, message, tag, stageAll, branchId, isAutoBackup = false } = {},
  ) {
    if (tag && !validateSnapshotTagName(tag)) {
      throw new ServiceError("Invalid tag name", 400, "INVALID_TAG_NAME");
    }

    const context = await this._ensureProjectContext(projectId, userId, "vcs.local", {
      includeInheritedFields: true,
    });
    return withProjectVcsLock(projectId, () =>
      this._captureCheckpointUnlocked(context, userId, {
        label,
        message,
        tag,
        stageAll,
        branchId,
        isAutoBackup,
      }),
    );
  }

  static async _captureCheckpointUnlocked(
    { project, activeSnapshot, activeBranch, workspaceRoot },
    userId,
    { label, message, tag, stageAll, branchId, isAutoBackup = false } = {},
  ) {
    const projectId = project.id;
    const requestedHeadId =
      !branchId && activeBranch ? activeBranch.headSnapshotId || activeSnapshot.id : null;

    const [
      targetBranch,
      initialHeadMap,
      stagedRows,
      maxAgg,
      authorUser,
      branchesCount,
      checkpointsCount,
    ] = await Promise.all([
      branchId
        ? prisma.snapshotVcsBranch.findFirst({
            where: { id: branchId, projectId },
            select: BRANCH_SELECT,
          })
        : Promise.resolve(activeBranch),
      requestedHeadId
        ? loadSnapshotManifestMap(prisma, requestedHeadId)
        : Promise.resolve(null),
      prisma.snapshotVcsStaging.findMany({
        where: { projectId, userId },
        select: { relativePath: true },
      }),
      prisma.projectSnapshot.aggregate({
        where: { projectId },
        _max: { versionNumber: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, avatarUrl: true },
      }),
      prisma.snapshotVcsBranch.count({ where: { projectId } }),
      prisma.projectSnapshot.count({ where: { projectId } }),
    ]);

    if (!targetBranch) {
      throw new ServiceError("Target VCS branch not found", 404, "BRANCH_NOT_FOUND");
    }

    const headSnapshotId = targetBranch.headSnapshotId || activeSnapshot.id;
    const headMap =
      initialHeadMap && headSnapshotId === requestedHeadId
        ? initialHeadMap
        : await loadSnapshotManifestMap(prisma, headSnapshotId);
    const workingMap = scanWorkingTree(workspaceRoot);

    const stagedSet = new Set(stagedRows.map((s) => s.relativePath));
    const useAll = stageAll === true || (stageAll !== false && stagedSet.size === 0);

    const selectedPaths = new Set();
    let finalManifest;
    let totalBytes = 0;

    if (useAll) {
      finalManifest = workingMap;
      for (const k of workingMap.keys()) selectedPaths.add(k);
      for (const k of headMap.keys()) selectedPaths.add(k);
    } else {
      const { changes: allWorkingChanges } = diffManifests(headMap, workingMap);
      const renameOrigByNewPath = new Map(
        allWorkingChanges
          .filter((c) => c.status === "R" && c.origPath)
          .map((c) => [c.path, c.origPath]),
      );

      finalManifest = new Map();
      for (const [k, v] of headMap.entries()) {
        finalManifest.set(k, v);
      }
      for (const p of stagedSet) {
        selectedPaths.add(p);
        const renameOrig = renameOrigByNewPath.get(p);
        if (renameOrig) {
          selectedPaths.add(renameOrig);
          finalManifest.delete(renameOrig);
        }
        if (workingMap.has(p)) {
          finalManifest.set(p, workingMap.get(p));
        } else {
          finalManifest.delete(p);
        }
      }
    }

    const { changes, stats } = diffManifests(headMap, finalManifest);
    if (changes.length === 0) {
      throw new ServiceError(
        "No changes detected to capture a new checkpoint",
        409,
        "SNAPSHOT_UNCHANGED",
      );
    }

    const uniqueBlobMap = new Map();
    const entryRows = [];
    for (const [relPath, info] of finalManifest.entries()) {
      const sha = info.sha256 || info.blobSha256;
      const diskInfo = workingMap.get(relPath);
      const headEntry = headMap.get(relPath);
      const alreadyInCas =
        headEntry &&
        headEntry.blobSha256 === sha &&
        fs.existsSync(getBlobDiskPath(projectId, sha));

      if (
        !alreadyInCas &&
        diskInfo &&
        diskInfo.sha256 === sha &&
        (useAll || stagedSet.has(relPath) || !headMap.has(relPath))
      ) {
        const buf = fs.readFileSync(diskInfo.fullPath);
        const stored = writeCasBlob(projectId, buf);
        uniqueBlobMap.set(stored.sha256, {
          projectId,
          sha256: stored.sha256,
          byteSize: stored.byteSize,
          isBinary: stored.isBinary,
          compressed: true,
        });
      }

      const byteSize = info.byteSize ?? 0;
      totalBytes += byteSize;
      entryRows.push({
        relativePath: relPath,
        blobSha256: sha,
        byteSize,
        isBinary: Boolean(info.isBinary),
        mode: "100644",
      });
    }

    const nextContentHash = computeManifestHash(entryRows);
    const statsJson = {
      filesTotal: entryRows.length,
      totalBytes,
      filesAdded: stats.added,
      filesModified: stats.modified,
      filesDeleted: stats.deleted,
      filesRenamed: stats.renamed,
      insertions: 0,
      deletions: 0,
    };

    const detection = (() => {
      try {
        return detectJest(activeSnapshot.rootDir);
      } catch {
        return {
          hasJest: activeSnapshot.hasJest,
          configPath: activeSnapshot.jestConfigPath,
          jestCommand: activeSnapshot.jestCommand,
        };
      }
    })();

    const newVersionNumber = (maxAgg?._max?.versionNumber ?? 0) + 1;
    const cleanLabel = label?.trim() || `#${newVersionNumber} Checkpoint`;
    const cleanMessage = message?.trim() || "Manual checkpoint capture";
    const checksum = `cas_${Date.now()}_${randomUUID().slice(0, 8)}`;

    const committed = await withProjectGuard(
      { projectId, userId, capability: "vcs.local" },
      async (tx, access) => {
        if (!isAutoBackup) {
          await assertEditorSnapshotChangeAllowed(tx, projectId);
        }
        if (access.project.workspaceRevision !== project.workspaceRevision) {
          throw new ServiceError(
            "Workspace changed while capturing checkpoint; please retry",
            409,
            "SNAPSHOT_CHANGED",
          );
        }

        const newSnapshot = await tx.projectSnapshot.create({
          data: {
            projectId,
            source: activeSnapshot.source,
            checksum,
            contentHash: nextContentHash,
            versionNumber: newVersionNumber,
            label: cleanLabel,
            commitMessage: cleanMessage,
            parentSnapshotId: headSnapshotId,
            authorId: userId,
            vcsBranchId: targetBranch.id,
            statsJson,
            isAutoBackup: Boolean(isAutoBackup),
            casMaterialized: true,
            commitSha: null,
            ...snapshotInheritedFields(
              activeSnapshot,
              workspaceRoot,
              activeSnapshot.storagePath,
              activeSnapshot.rootDir,
            ),
            hasJest: detection.hasJest,
            jestConfigPath: detection.configPath,
            jestCommand: detection.jestCommand,
          },
        });

        let createdTag = null;
        const dbWrites = [];
        const blobRows = [...uniqueBlobMap.values()];
        if (blobRows.length > 0) {
          dbWrites.push(
            tx.snapshotVcsBlobRef.createMany({
              data: blobRows,
              skipDuplicates: true,
            }),
          );
        }
        if (entryRows.length > 0) {
          dbWrites.push(
            tx.snapshotVcsEntry.createMany({
              data: entryRows.map((row) => ({
                snapshotId: newSnapshot.id,
                ...row,
              })),
            }),
          );
        }
        dbWrites.push(
          tx.snapshotVcsBranch.update({
            where: { id: targetBranch.id },
            data: { headSnapshotId: newSnapshot.id },
          }),
        );
        if (useAll) {
          dbWrites.push(
            tx.snapshotVcsStaging.deleteMany({ where: { projectId, userId } }),
          );
        } else if (selectedPaths.size > 0) {
          dbWrites.push(
            tx.snapshotVcsStaging.deleteMany({
              where: { projectId, userId, relativePath: { in: [...selectedPaths] } },
            }),
          );
        }
        if (tag && tag.trim()) {
          dbWrites.push(
            tx.snapshotVcsTag
              .create({
                data: {
                  projectId,
                  snapshotId: newSnapshot.id,
                  name: tag.trim(),
                  createdById: userId,
                },
                select: {
                  id: true,
                  name: true,
                  description: true,
                  color: true,
                  createdAt: true,
                },
              })
              .then((row) => {
                createdTag = row;
              }),
          );
        }

        const updatedProjPromise = tx.project.update({
          where: { id: projectId },
          data: {
            activeSnapshotId: newSnapshot.id,
            activeVcsBranchId: targetBranch.id,
            workspaceRevision: { increment: 1 },
          },
          select: { workspaceRevision: true },
        });
        dbWrites.push(updatedProjPromise);

        await Promise.all(dbWrites);
        const updatedProj = await updatedProjPromise;

        const event = await publishProjectEvent({
          tx,
          projectId,
          actorId: userId,
          type: "workspace.changed",
          resourceId: newSnapshot.id,
          revision: updatedProj.workspaceRevision,
          payload: {
            kind: "SNAPSHOT_CAPTURED",
            snapshotId: newSnapshot.id,
            versionNumber: newVersionNumber,
          },
        });

        return {
          newSnapshot,
          createdTag,
          nextWorkspaceRevision: updatedProj.workspaceRevision,
          event,
        };
      },
    );

    void deliverProjectEvent(committed.event).catch(() => {});
    invalidateCachesAfterMutation({
      projectId,
      ownerId: project.ownerId,
      snapshotId: committed.newSnapshot.id,
    });

    const fullSnap = {
      ...committed.newSnapshot,
      author: authorUser || null,
      vcsBranch: {
        id: targetBranch.id,
        name: targetBranch.name,
        isDefault: Boolean(targetBranch.isDefault),
      },
      vcsTags: committed.createdTag ? [committed.createdTag] : [],
    };
    const checkpoint = formatCheckpointSummary(
      fullSnap,
      committed.newSnapshot.id,
      new Set([committed.newSnapshot.id]),
    );

    const remainingDiff = diffManifests(finalManifest, workingMap);
    const remainingStagedSet = useAll
      ? new Set()
      : new Set([...stagedSet].filter((p) => !selectedPaths.has(p)));

    const nextStatus = {
      initialized: true,
      activeBranch: {
        ...targetBranch,
        headSnapshotId: committed.newSnapshot.id,
      },
      headCheckpoint: checkpoint,
      activeSnapshotId: committed.newSnapshot.id,
      branchesCount,
      checkpointsCount: checkpointsCount + 1,
      staged: remainingDiff.changes.filter((c) => remainingStagedSet.has(c.path)),
      unstaged: remainingDiff.changes.filter((c) => !remainingStagedSet.has(c.path)),
      unchangedCount: remainingDiff.unchangedPaths.length,
      clean: remainingDiff.changes.length === 0,
      stats: remainingDiff.stats,
      workspaceRevision: committed.nextWorkspaceRevision,
    };

    emitSnapshotVcsUpdated(projectId, {
      reason: "capture",
      snapshotId: committed.newSnapshot.id,
      actorId: userId,
    });

    return {
      checkpoint,
      status: nextStatus,
    };
  }

  /**
   * Edits checkpoint metadata (label, commitMessage, pin flag).
   */
  static async updateCheckpoint(projectId, userId, snapshotId, updates = {}) {
    await this._ensureProjectContext(projectId, userId, "vcs.local");
    const existing = await prisma.projectSnapshot.findFirst({
      where: { id: snapshotId, projectId },
      select: { id: true },
    });
    if (!existing) {
      throw new ServiceError("Checkpoint not found", 404, "SNAPSHOT_NOT_FOUND");
    }

    const data = {};
    if (updates.label !== undefined) data.label = updates.label.trim();
    if (updates.commitMessage !== undefined) {
      data.commitMessage = updates.commitMessage.trim();
    }
    if (updates.isPinned !== undefined) data.isPinned = Boolean(updates.isPinned);

    const updated = await prisma.projectSnapshot.update({
      where: { id: snapshotId },
      data,
      select: {
        id: true,
        projectId: true,
        source: true,
        versionNumber: true,
        contentHash: true,
        label: true,
        commitMessage: true,
        parentSnapshotId: true,
        restoredFromSnapshotId: true,
        vcsBranchId: true,
        statsJson: true,
        isPinned: true,
        isAutoBackup: true,
        casMaterialized: true,
        createdAt: true,
        author: { select: { id: true, name: true, email: true, avatarUrl: true } },
        vcsBranch: { select: { id: true, name: true, isDefault: true } },
        vcsTags: {
          select: { id: true, name: true, description: true, color: true, createdAt: true },
        },
      },
    });

    emitSnapshotVcsUpdated(projectId, {
      reason: "update_checkpoint",
      snapshotId,
      actorId: userId,
    });

    const proj = await prisma.project.findFirst({
      where: { id: projectId },
      select: { activeSnapshotId: true },
    });
    return formatCheckpointSummary(updated, proj?.activeSnapshotId);
  }

  /**
   * Deletes a non-active, non-pinned, non-branch-head checkpoint and optionally
   * schedules CAS GC.
   */
  static async deleteCheckpoint(projectId, userId, snapshotId, { scheduleGc = true } = {}) {
    const { project } = await this._ensureProjectContext(
      projectId,
      userId,
      "snapshot.restore",
    );

    return withProjectVcsLock(projectId, async () => {
      const target = await prisma.projectSnapshot.findFirst({
        where: { id: snapshotId, projectId },
        select: {
          id: true,
          isPinned: true,
          parentSnapshotId: true,
        },
      });
      if (!target) {
        throw new ServiceError("Checkpoint not found", 404, "SNAPSHOT_NOT_FOUND");
      }
      if (snapshotId === project.activeSnapshotId) {
        throw new ServiceError(
          "Cannot delete the currently active checkpoint",
          409,
          "CANNOT_DELETE_ACTIVE_CHECKPOINT",
        );
      }
      if (target.isPinned) {
        throw new ServiceError(
          "Unpin this checkpoint before deleting it",
          409,
          "CHECKPOINT_PINNED",
        );
      }

      const branchHead = await prisma.snapshotVcsBranch.findFirst({
        where: { projectId, headSnapshotId: snapshotId },
        select: { id: true, name: true },
      });
      if (branchHead) {
        throw new ServiceError(
          `Cannot delete the latest checkpoint on branch '${branchHead.name}'`,
          409,
          "CANNOT_DELETE_BRANCH_HEAD",
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.projectSnapshot.updateMany({
          where: { projectId, parentSnapshotId: snapshotId },
          data: { parentSnapshotId: target.parentSnapshotId || null },
        });
        await tx.projectSnapshot.updateMany({
          where: { projectId, restoredFromSnapshotId: snapshotId },
          data: { restoredFromSnapshotId: null },
        });
        await tx.projectSnapshot.delete({ where: { id: snapshotId } });
      });

      let gcJob = null;
      if (scheduleGc && process.env.NODE_ENV !== "test") {
        try {
          const { enqueueSnapshotCasGcJob } = await import(
            "./snapshotCasGcJob.service.js"
          );
          gcJob = await enqueueSnapshotCasGcJob({ projectId, userId });
        } catch {
          // Non-fatal if Redis queue is offline
        }
      }

      invalidateCachesAfterMutation({
        projectId,
        ownerId: project.ownerId,
        snapshotId,
      });

      emitSnapshotVcsUpdated(projectId, {
        reason: "delete_checkpoint",
        snapshotId,
        actorId: userId,
      });

      return { deleted: true, snapshotId, gcJob };
    });
  }

  /**
   * Returns immutable file tree for any historical checkpoint directly from CAS.
   */
  static async getCheckpointTree(projectId, userId, snapshotId) {
    await this._ensureProjectContext(projectId, userId, "project.read");
    const snap = await prisma.projectSnapshot.findFirst({
      where: { id: snapshotId, projectId },
      select: { id: true, casMaterialized: true, versionNumber: true, label: true },
    });
    if (!snap) {
      throw new ServiceError("Checkpoint not found", 404, "SNAPSHOT_NOT_FOUND");
    }
    if (!snap.casMaterialized) {
      await ensureProjectCasBaseline({ projectId, snapshotId, userId });
    }

    const entries = await prisma.snapshotVcsEntry.findMany({
      where: { snapshotId },
      select: {
        relativePath: true,
        blobSha256: true,
        byteSize: true,
        isBinary: true,
        mode: true,
      },
      orderBy: { relativePath: "asc" },
    });

    return {
      snapshotId: snap.id,
      versionNumber: snap.versionNumber,
      label: snap.label,
      files: entries,
    };
  }

  /**
   * Reads a single file from an immutable historical checkpoint in CAS.
   */
  static async getCheckpointFile(projectId, userId, snapshotId, filePath) {
    const safePath = sanitizeVcsRelativePath(filePath);
    await this._ensureProjectContext(projectId, userId, "project.read");

    const entry = await prisma.snapshotVcsEntry.findUnique({
      where: {
        snapshotId_relativePath: { snapshotId, relativePath: safePath },
      },
      select: { blobSha256: true, byteSize: true, isBinary: true },
    });
    if (!entry) {
      throw new ServiceError(
        `File '${safePath}' does not exist in this checkpoint`,
        404,
        "RESOURCE_NOT_FOUND",
      );
    }

    const buf = readCasBlob(projectId, entry.blobSha256);
    const isBinary = entry.isBinary || detectBinaryBuffer(buf);
    const isTooLarge = buf.length > SNAPSHOT_VCS_LIMITS.MAX_DIFF_FILE_BYTES;

    return {
      snapshotId,
      filePath: safePath,
      sha256: entry.blobSha256,
      byteSize: buf.length,
      isBinary,
      isTooLarge,
      content: isBinary || isTooLarge ? "" : buf.toString("utf8"),
    };
  }

  /**
   * Restores a single file from a historical checkpoint into the active working tree.
   */
  static async restoreSingleFile(projectId, userId, snapshotId, { filePath }) {
    const safePath = sanitizeVcsRelativePath(filePath);
    const { project, activeSnapshot, workspaceRoot } =
      await this._ensureProjectContext(projectId, userId, "vcs.local");

    return withProjectVcsLock(projectId, async () => {
      const entry = await prisma.snapshotVcsEntry.findUnique({
        where: {
          snapshotId_relativePath: { snapshotId, relativePath: safePath },
        },
        select: { blobSha256: true, isBinary: true },
      });
      if (!entry) {
        throw new ServiceError(
          `File '${safePath}' not found in source checkpoint`,
          404,
          "RESOURCE_NOT_FOUND",
        );
      }

      const workingMap = scanWorkingTree(workspaceRoot);
      const targetMap = new Map();
      for (const [k, v] of workingMap.entries()) {
        targetMap.set(k, { blobSha256: v.sha256, isBinary: v.isBinary });
      }
      targetMap.set(safePath, {
        blobSha256: entry.blobSha256,
        isBinary: entry.isBinary,
      });

      await withProjectGuard(
        { projectId, userId, capability: "vcs.local" },
        async (tx) => {
          await assertEditorReplacementAllowed({
            tx,
            projectId,
            snapshotId: activeSnapshot.id,
            paths: [safePath],
          });

          const { changedFiles } = syncWorkspaceFromManifest({
            projectId,
            rootDir: workspaceRoot,
            targetEntries: targetMap,
          });

          await syncFileVersionsForChanges(tx, {
            snapshotId: activeSnapshot.id,
            userId,
            changedFiles,
          });

          await reconcileEditorReplacement({
            tx,
            projectId,
            snapshotId: activeSnapshot.id,
            actorId: userId,
            source: "HUMAN_EDIT",
            changes: changedFiles,
          });

          const updatedProj = await tx.project.update({
            where: { id: projectId },
            data: { workspaceRevision: { increment: 1 } },
            select: { workspaceRevision: true },
          });

          const event = await publishProjectEvent({
            tx,
            projectId,
            actorId: userId,
            type: "workspace.changed",
            resourceId: activeSnapshot.id,
            revision: updatedProj.workspaceRevision,
            payload: {
              kind: "SNAPSHOT_RESTORE_FILE",
              fromSnapshotId: snapshotId,
              paths: [safePath],
            },
          });
          return { event };
        },
      ).then(({ event }) => deliverProjectEvent(event).catch(() => {}));

      invalidateCachesAfterMutation({
        projectId,
        ownerId: project.ownerId,
        snapshotId: activeSnapshot.id,
      });

      const status = await this.getStatus(projectId, userId);
      emitSnapshotVcsUpdated(projectId, {
        reason: "restore_file",
        filePath: safePath,
        fromSnapshotId: snapshotId,
        actorId: userId,
      });
      return { restoredFile: safePath, status };
    });
  }

  /**
   * Full Rollback to a historical checkpoint (Bug C3 fixed):
   * - Creates automatic safety backup if working tree is dirty and policy === AUTO_BACKUP.
   * - Materializes target CAS manifest onto live workspace (preserving `node_modules/`).
   * - Updates `Project.activeSnapshotId` & `SnapshotVcsBranch.headSnapshotId` atomically.
   */
  static async restoreCheckpoint(
    projectId,
    userId,
    targetSnapshotId,
    { dirtyPolicy, autoBackup = true, customLabel } = {},
  ) {
    const context = await this._ensureProjectContext(
      projectId,
      userId,
      "snapshot.restore",
      { includeInheritedFields: true },
    );
    const effectivePolicy = normalizeDirtyPolicy(
      dirtyPolicy,
      SNAPSHOT_RESTORE_POLICIES.AUTO_BACKUP,
      autoBackup,
    );

    return withProjectVcsLock(projectId, async () => {
      const targetSnap = await prisma.projectSnapshot.findFirst({
        where: { id: targetSnapshotId, projectId },
      });
      if (!targetSnap) {
        throw new ServiceError("Target checkpoint not found", 404, "SNAPSHOT_NOT_FOUND");
      }
      if (!targetSnap.casMaterialized) {
        await ensureProjectCasBaseline({ projectId, snapshotId: targetSnap.id, userId });
      }

      const preStatus = await this.getStatus(projectId, userId);
      let backupCheckpoint = null;

      if (!preStatus.clean) {
        if (effectivePolicy === SNAPSHOT_RESTORE_POLICIES.FAIL_IF_DIRTY) {
          throw new ServiceError(
            "Working tree has uncommitted changes. Capture a checkpoint or discard changes before rolling back.",
            409,
            "DIRTY_WORKSPACE",
            {
              dirtyCount: preStatus.staged.length + preStatus.unstaged.length,
              changes: [...preStatus.staged, ...preStatus.unstaged],
            },
          );
        }
        if (effectivePolicy === SNAPSHOT_RESTORE_POLICIES.AUTO_BACKUP) {
          const freshCtx = await this._ensureProjectContext(
            projectId,
            userId,
            "snapshot.restore",
          );
          const backupRes = await this._captureCheckpointUnlocked(freshCtx, userId, {
            label: `Auto-backup before rollback to #${targetSnap.versionNumber || targetSnap.id.slice(0, 7)}`,
            message: "Automatic safety backup before checkpoint rollback",
            stageAll: true,
            isAutoBackup: true,
          });
          backupCheckpoint = backupRes.checkpoint;
        }
      }

      const freshCtx = await this._ensureProjectContext(
        projectId,
        userId,
        "snapshot.restore",
        { includeInheritedFields: true },
      );
      const targetMap = await loadSnapshotManifestMap(prisma, targetSnap.id);
      const entryRows = [...targetMap.values()];
      const totalBytes = entryRows.reduce((sum, e) => sum + (e.byteSize || 0), 0);
      const targetHash = computeManifestHash(entryRows);

      const maxAgg = await prisma.projectSnapshot.aggregate({
        where: { projectId },
        _max: { versionNumber: true },
      });
      const nextVersion = (maxAgg?._max?.versionNumber ?? 0) + 1;
      const targetTitle = targetSnap.label || `#${targetSnap.versionNumber || targetSnap.id.slice(0, 7)}`;
      const restoredLabel = customLabel?.trim() || `Restored: ${targetTitle}`;
      const checksum = `restore_${Date.now()}_${randomUUID().slice(0, 8)}`;

      const committed = await withProjectGuard(
        { projectId, userId, capability: "snapshot.restore" },
        async (tx) => {
          if (effectivePolicy !== SNAPSHOT_RESTORE_POLICIES.DISCARD_DIRTY) {
            await assertEditorSnapshotChangeAllowed(tx, projectId);
          }

          const { changedFiles } = syncWorkspaceFromManifest({
            projectId,
            rootDir: freshCtx.workspaceRoot,
            targetEntries: targetMap,
          });

          const newSnap = await tx.projectSnapshot.create({
            data: {
              projectId,
              source: targetSnap.source,
              checksum,
              contentHash: targetHash,
              versionNumber: nextVersion,
              label: restoredLabel,
              commitMessage: `Rolled back workspace to ${targetTitle}`,
              parentSnapshotId: freshCtx.activeBranch?.headSnapshotId || freshCtx.activeSnapshot.id,
              restoredFromSnapshotId: targetSnap.id,
              authorId: userId,
              vcsBranchId: freshCtx.activeBranch?.id || null,
              statsJson: {
                filesTotal: entryRows.length,
                totalBytes,
                filesAdded: 0,
                filesModified: changedFiles.length,
                filesDeleted: 0,
                insertions: 0,
                deletions: 0,
              },
              casMaterialized: true,
              commitSha: null,
              ...snapshotInheritedFields(
                freshCtx.activeSnapshot,
                freshCtx.workspaceRoot,
                freshCtx.activeSnapshot.storagePath,
                freshCtx.activeSnapshot.rootDir,
              ),
            },
          });

          if (entryRows.length > 0) {
            await tx.snapshotVcsEntry.createMany({
              data: entryRows.map((e) => ({
                snapshotId: newSnap.id,
                relativePath: e.relativePath,
                blobSha256: e.blobSha256,
                byteSize: e.byteSize,
                isBinary: e.isBinary,
                mode: e.mode || "100644",
              })),
            });
          }

          if (freshCtx.activeBranch?.id) {
            await tx.snapshotVcsBranch.update({
              where: { id: freshCtx.activeBranch.id },
              data: { headSnapshotId: newSnap.id },
            });
          }

          await tx.snapshotVcsStaging.deleteMany({ where: { projectId } });

          await syncFileVersionsForChanges(tx, {
            snapshotId: newSnap.id,
            userId,
            changedFiles,
          });

          await reconcileEditorReplacement({
            tx,
            projectId,
            snapshotId: freshCtx.activeSnapshot.id,
            actorId: userId,
            source: "HUMAN_EDIT",
            changes: changedFiles,
          });

          const updatedProj = await tx.project.update({
            where: { id: projectId },
            data: {
              activeSnapshotId: newSnap.id,
              workspaceRevision: { increment: 1 },
            },
            select: { workspaceRevision: true },
          });

          const event = await publishProjectEvent({
            tx,
            projectId,
            actorId: userId,
            type: "workspace.changed",
            resourceId: newSnap.id,
            revision: updatedProj.workspaceRevision,
            payload: {
              kind: "SNAPSHOT_RESTORED",
              restoredFromSnapshotId: targetSnap.id,
              snapshotId: newSnap.id,
            },
          });

          return { newSnap, event };
        },
      );

      await deliverProjectEvent(committed.event).catch(() => {});
      invalidateCachesAfterMutation({
        projectId,
        ownerId: context.project.ownerId,
        snapshotId: committed.newSnap.id,
      });

      const restoredRow = await prisma.projectSnapshot.findUnique({
        where: { id: committed.newSnap.id },
        select: {
          id: true,
          projectId: true,
          source: true,
          versionNumber: true,
          contentHash: true,
          label: true,
          commitMessage: true,
          parentSnapshotId: true,
          restoredFromSnapshotId: true,
          vcsBranchId: true,
          statsJson: true,
          isPinned: true,
          isAutoBackup: true,
          casMaterialized: true,
          createdAt: true,
          author: { select: { id: true, name: true, email: true, avatarUrl: true } },
          vcsBranch: { select: { id: true, name: true, isDefault: true } },
          vcsTags: {
            select: { id: true, name: true, description: true, color: true, createdAt: true },
          },
        },
      });

      emitSnapshotVcsUpdated(projectId, {
        reason: "restore",
        snapshotId: committed.newSnap.id,
        restoredFromSnapshotId: targetSnap.id,
        actorId: userId,
      });

      return {
        restoredCheckpoint: formatCheckpointSummary(
          restoredRow,
          committed.newSnap.id,
          new Set([committed.newSnap.id]),
        ),
        backupCheckpoint,
        status: await this.getStatus(projectId, userId),
      };
    });
  }

  /**
   * Streams/builds an in-memory ZIP archive directly from CAS entries for any version.
   */
  static async exportCheckpointZip(projectId, userId, snapshotId) {
    const { project } = await this._ensureProjectContext(
      projectId,
      userId,
      "project.export",
    );

    const snap = await prisma.projectSnapshot.findFirst({
      where: { id: snapshotId, projectId },
      select: { id: true, label: true, versionNumber: true, casMaterialized: true },
    });
    if (!snap) {
      throw new ServiceError("Checkpoint not found", 404, "SNAPSHOT_NOT_FOUND");
    }
    if (!snap.casMaterialized) {
      await ensureProjectCasBaseline({ projectId, snapshotId: snap.id, userId });
    }

    const entries = await prisma.snapshotVcsEntry.findMany({
      where: { snapshotId: snap.id },
      select: { relativePath: true, blobSha256: true, byteSize: true },
      orderBy: { relativePath: "asc" },
    });

    const MAX_EXPORT_ZIP_BYTES = 200 * 1024 * 1024;
    const totalExportBytes = entries.reduce(
      (sum, entry) => sum + (Number(entry.byteSize) || 0),
      0,
    );
    if (totalExportBytes > MAX_EXPORT_ZIP_BYTES) {
      throw new ServiceError(
        "Checkpoint archive exceeds the 200 MiB export size limit.",
        413,
        "EXPORT_SIZE_LIMIT_EXCEEDED",
        { totalBytes: totalExportBytes, maxBytes: MAX_EXPORT_ZIP_BYTES },
      );
    }

    const zip = new AdmZip();
    for (const entry of entries) {
      const contentBuf = readCasBlob(projectId, entry.blobSha256);
      zip.addFile(entry.relativePath, contentBuf);
    }

    const slug = (project.name || "project").replace(/[^A-Za-z0-9._-]+/g, "-");
    const verLabel = snap.versionNumber ? `v${snap.versionNumber}` : snap.id.slice(0, 8);
    return {
      buffer: zip.toBuffer(),
      filename: `${slug}-${verLabel}.zip`,
      fileCount: entries.length,
    };
  }

  // ---- Branches & 3-Way Merge ----

  static async listBranches(projectId, userId) {
    const { project } = await this._ensureProjectContext(
      projectId,
      userId,
      "project.read",
    );

    const rows = await prisma.snapshotVcsBranch.findMany({
      where: { projectId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        projectId: true,
        name: true,
        description: true,
        headSnapshotId: true,
        baseSnapshotId: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
        headSnapshot: {
          select: {
            id: true,
            versionNumber: true,
            label: true,
            contentHash: true,
            createdAt: true,
          },
        },
        _count: { select: { snapshots: true } },
      },
    });

    return {
      activeBranchId: project.activeVcsBranchId,
      branches: rows.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description || "",
        headSnapshotId: b.headSnapshotId,
        baseSnapshotId: b.baseSnapshotId,
        isDefault: Boolean(b.isDefault),
        isActive: b.id === project.activeVcsBranchId,
        checkpointsCount: b._count?.snapshots ?? 0,
        headCheckpoint: b.headSnapshot
          ? {
              id: b.headSnapshot.id,
              versionNumber: b.headSnapshot.versionNumber,
              label: b.headSnapshot.label,
              shortHash: b.headSnapshot.contentHash?.slice(0, 8) || null,
              createdAt: b.headSnapshot.createdAt,
            }
          : null,
        createdAt: b.createdAt,
      })),
    };
  }

  static async createBranch(
    projectId,
    userId,
    { name, fromSnapshotId, description = "", checkout = false } = {},
  ) {
    if (!validateSnapshotBranchName(name)) {
      throw new ServiceError("Invalid branch name", 400, "INVALID_BRANCH_NAME");
    }
    if (checkout) {
      await resolveProjectAccess({
        projectId,
        userId,
        capability: "snapshot.restore",
      });
    }

    const { project, activeSnapshot, activeBranch } =
      await this._ensureProjectContext(projectId, userId, "vcs.local");

    const cleanName = name.trim();
    const baseId = fromSnapshotId || activeBranch?.headSnapshotId || activeSnapshot.id;
    const baseSnap = await prisma.projectSnapshot.findFirst({
      where: { id: baseId, projectId },
      select: { id: true, casMaterialized: true },
    });
    if (!baseSnap) {
      throw new ServiceError("Base checkpoint not found", 404, "SNAPSHOT_NOT_FOUND");
    }

    const existing = await prisma.snapshotVcsBranch.findUnique({
      where: { projectId_name: { projectId, name: cleanName } },
      select: { id: true },
    });
    if (existing) {
      throw new ServiceError(
        `Branch '${cleanName}' already exists`,
        409,
        "BRANCH_ALREADY_EXISTS",
      );
    }

    const branch = await prisma.snapshotVcsBranch.create({
      data: {
        projectId,
        name: cleanName,
        description: description?.trim() || null,
        headSnapshotId: baseSnap.id,
        baseSnapshotId: baseSnap.id,
        isDefault: false,
        createdById: userId,
      },
      select: { id: true, name: true, headSnapshotId: true, baseSnapshotId: true },
    });

    if (checkout) {
      await this.checkoutBranch(projectId, userId, branch.id, {
        dirtyPolicy: SNAPSHOT_RESTORE_POLICIES.FAIL_IF_DIRTY,
      });
    } else {
      emitSnapshotVcsUpdated(projectId, {
        reason: "branch_created",
        branchId: branch.id,
        actorId: userId,
      });
    }

    return this.listBranches(project.id, userId);
  }

  /**
   * Switches active VCS branch cleanly, guarding uncommitted working tree edits.
   */
  static async checkoutBranch(
    projectId,
    userId,
    branchId,
    { dirtyPolicy = SNAPSHOT_RESTORE_POLICIES.FAIL_IF_DIRTY } = {},
  ) {
    const context = await this._ensureProjectContext(
      projectId,
      userId,
      "snapshot.restore",
      { includeInheritedFields: true },
    );
    const effectivePolicy = normalizeDirtyPolicy(
      dirtyPolicy,
      SNAPSHOT_RESTORE_POLICIES.FAIL_IF_DIRTY,
    );

    return withProjectVcsLock(projectId, async () => {
      const targetBranch = await prisma.snapshotVcsBranch.findFirst({
        where: { id: branchId, projectId },
      });
      if (!targetBranch) {
        throw new ServiceError("Branch not found", 404, "BRANCH_NOT_FOUND");
      }

      if (targetBranch.id === context.project.activeVcsBranchId) {
        return {
          branches: await this.listBranches(projectId, userId),
          status: await this.getStatus(projectId, userId),
          backupCheckpoint: null,
        };
      }

      const preStatus = await this.getStatus(projectId, userId);
      let backupCheckpoint = null;

      if (!preStatus.clean) {
        if (effectivePolicy === SNAPSHOT_RESTORE_POLICIES.FAIL_IF_DIRTY) {
          throw new ServiceError(
            "Working tree has uncommitted changes. Choose auto_backup or discard before switching branches.",
            409,
            "DIRTY_WORKSPACE",
            {
              dirtyCount: preStatus.staged.length + preStatus.unstaged.length,
              changes: [...preStatus.staged, ...preStatus.unstaged],
            },
          );
        }
        if (effectivePolicy === SNAPSHOT_RESTORE_POLICIES.AUTO_BACKUP) {
          const backupRes = await this._captureCheckpointUnlocked(context, userId, {
            label: `Auto-backup before switching to ${targetBranch.name}`,
            message: `Safety backup on ${context.activeBranch?.name || "current"} branch`,
            stageAll: true,
            isAutoBackup: true,
          });
          backupCheckpoint = backupRes.checkpoint;
        }
      }

      const freshCtx = await this._ensureProjectContext(
        projectId,
        userId,
        "snapshot.restore",
        { includeInheritedFields: true },
      );
      const targetSnapId = targetBranch.headSnapshotId || targetBranch.baseSnapshotId;
      const targetMap = await loadSnapshotManifestMap(prisma, targetSnapId);

      const committed = await withProjectGuard(
        { projectId, userId, capability: "snapshot.restore" },
        async (tx) => {
          if (effectivePolicy !== SNAPSHOT_RESTORE_POLICIES.DISCARD_DIRTY) {
            await assertEditorSnapshotChangeAllowed(tx, projectId);
          }

          const { changedFiles } = syncWorkspaceFromManifest({
            projectId,
            rootDir: freshCtx.workspaceRoot,
            targetEntries: targetMap,
          });

          await tx.projectSnapshot.update({
            where: { id: targetSnapId },
            data: {
              ...snapshotInheritedFields(
                freshCtx.activeSnapshot,
                freshCtx.workspaceRoot,
                freshCtx.activeSnapshot.storagePath,
                freshCtx.activeSnapshot.rootDir,
              ),
            },
          });

          await syncFileVersionsForChanges(tx, {
            snapshotId: targetSnapId,
            userId,
            changedFiles,
          });

          await reconcileEditorReplacement({
            tx,
            projectId,
            snapshotId: freshCtx.activeSnapshot.id,
            actorId: userId,
            source: "HUMAN_EDIT",
            changes: changedFiles,
          });

          await tx.snapshotVcsStaging.deleteMany({ where: { projectId } });

          const updatedProj = await tx.project.update({
            where: { id: projectId },
            data: {
              activeVcsBranchId: targetBranch.id,
              activeSnapshotId: targetSnapId,
              workspaceRevision: { increment: 1 },
            },
            select: { workspaceRevision: true },
          });

          const event = await publishProjectEvent({
            tx,
            projectId,
            actorId: userId,
            type: "workspace.changed",
            resourceId: targetSnapId,
            revision: updatedProj.workspaceRevision,
            payload: {
              kind: "SNAPSHOT_BRANCH_CHECKOUT",
              branchId: targetBranch.id,
              branchName: targetBranch.name,
            },
          });

          return { event };
        },
      );

      await deliverProjectEvent(committed.event).catch(() => {});
      invalidateCachesAfterMutation({
        projectId,
        ownerId: freshCtx.project.ownerId,
        snapshotId: targetSnapId,
      });

      emitSnapshotVcsUpdated(projectId, {
        reason: "checkout_branch",
        branchId: targetBranch.id,
        actorId: userId,
      });

      return {
        backupCheckpoint,
        branches: await this.listBranches(projectId, userId),
        status: await this.getStatus(projectId, userId),
      };
    });
  }

  static async updateBranch(projectId, userId, branchId, { name, description } = {}) {
    await this._ensureProjectContext(projectId, userId, "snapshot.restore");
    const existing = await prisma.snapshotVcsBranch.findFirst({
      where: { id: branchId, projectId },
      select: { id: true, name: true },
    });
    if (!existing) {
      throw new ServiceError("Branch not found", 404, "BRANCH_NOT_FOUND");
    }

    const data = {};
    if (name !== undefined) {
      if (!validateSnapshotBranchName(name)) {
        throw new ServiceError("Invalid branch name", 400, "INVALID_BRANCH_NAME");
      }
      const nextName = name.trim();
      if (nextName !== existing.name) {
        const dup = await prisma.snapshotVcsBranch.findUnique({
          where: { projectId_name: { projectId, name: nextName } },
          select: { id: true },
        });
        if (dup) {
          throw new ServiceError(
            `Branch '${nextName}' already exists`,
            409,
            "BRANCH_ALREADY_EXISTS",
          );
        }
      }
      data.name = nextName;
    }
    if (description !== undefined) data.description = description?.trim() || null;

    await prisma.snapshotVcsBranch.update({ where: { id: branchId }, data });
    emitSnapshotVcsUpdated(projectId, { reason: "update_branch", branchId, actorId: userId });
    return this.listBranches(projectId, userId);
  }

  static async deleteBranch(projectId, userId, branchId) {
    const { project } = await this._ensureProjectContext(
      projectId,
      userId,
      "snapshot.restore",
    );
    const target = await prisma.snapshotVcsBranch.findFirst({
      where: { id: branchId, projectId },
      select: { id: true, isDefault: true, name: true },
    });
    if (!target) {
      throw new ServiceError("Branch not found", 404, "BRANCH_NOT_FOUND");
    }
    if (target.isDefault) {
      throw new ServiceError("Cannot delete the default branch", 409, "PROTECTED_BRANCH");
    }
    if (target.id === project.activeVcsBranchId) {
      throw new ServiceError(
        "Switch away from the active branch before deleting it",
        409,
        "CANNOT_DELETE_ACTIVE_BRANCH",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectSnapshot.updateMany({
        where: { projectId, vcsBranchId: branchId },
        data: { vcsBranchId: null },
      });
      await tx.snapshotVcsBranch.delete({ where: { id: branchId } });
    });

    emitSnapshotVcsUpdated(projectId, { reason: "delete_branch", branchId, actorId: userId });
    return this.listBranches(projectId, userId);
  }

  /**
   * Performs LCA-based 3-way merge of `sourceBranchId` into `targetBranchId`.
   * Returns 409 SNAPSHOT_MERGE_CONFLICT with { base, ours, theirs } unless all
   * conflicting paths are supplied in `resolutions`.
   */
  static async mergeBranch(
    projectId,
    userId,
    {
      sourceBranchId,
      targetBranchId,
      message,
      dirtyPolicy,
      dirtyStrategy,
      resolutions = {},
    } = {},
  ) {
    const resolvedDirtyPolicy = normalizeDirtyPolicy(
      dirtyPolicy || dirtyStrategy,
      SNAPSHOT_RESTORE_POLICIES.FAIL_IF_DIRTY,
    );
    const context = await this._ensureProjectContext(
      projectId,
      userId,
      "snapshot.restore",
      { includeInheritedFields: true },
    );

    return withProjectVcsLock(projectId, async () => {
      const targetId = targetBranchId || context.project.activeVcsBranchId;
      const [sourceBranch, targetBranch, allSnapshots] = await Promise.all([
        prisma.snapshotVcsBranch.findFirst({
          where: { id: sourceBranchId, projectId },
        }),
        prisma.snapshotVcsBranch.findFirst({
          where: { id: targetId, projectId },
        }),
        prisma.projectSnapshot.findMany({
          where: { projectId },
          select: { id: true, parentSnapshotId: true, statsJson: true },
        }),
      ]);

      if (!sourceBranch || !targetBranch) {
        throw new ServiceError("Source or target branch not found", 404, "BRANCH_NOT_FOUND");
      }
      if (sourceBranch.id === targetBranch.id) {
        throw new ServiceError("Cannot merge a branch into itself", 400);
      }

      const isTargetActive = targetBranch.id === context.project.activeVcsBranchId;
      let oursSnapId = targetBranch.headSnapshotId;
      let backupCheckpoint = null;

      if (isTargetActive) {
        const currentHeadMap = await loadSnapshotManifestMap(
          prisma,
          context.activeSnapshot.id,
        );
        const workingMap = scanWorkingTree(context.workspaceRoot);
        const { changes: dirtyChanges } = diffManifests(currentHeadMap, workingMap);

        if (dirtyChanges.length > 0) {
          if (resolvedDirtyPolicy === SNAPSHOT_RESTORE_POLICIES.FAIL_IF_DIRTY) {
            throw new ServiceError(
              `Workspace has ${dirtyChanges.length} uncommitted change(s). Auto-backup or discard before merging.`,
              409,
              "DIRTY_WORKSPACE",
              {
                dirtyCount: dirtyChanges.length,
                changes: dirtyChanges.slice(0, 20),
              },
            );
          }

          if (resolvedDirtyPolicy === SNAPSHOT_RESTORE_POLICIES.AUTO_BACKUP) {
            const backupRes = await this._captureCheckpointUnlocked(
              context,
              userId,
              {
                label: `Auto-backup before merge '${sourceBranch.name}'`,
                message: `Automatic safety backup before merging '${sourceBranch.name}' into '${targetBranch.name}'`,
                stageAll: true,
                isAutoBackup: true,
              },
            );
            backupCheckpoint = backupRes.checkpoint;
            oursSnapId = backupRes.checkpoint.id;
            context.activeSnapshot.id = oursSnapId;
            context.project.workspaceRevision =
              backupRes.workspaceRevision ?? context.project.workspaceRevision + 1;
            const snapIndexEntry = allSnapshots.find(
              (s) => s.id === targetBranch.headSnapshotId,
            );
            allSnapshots.push({
              id: oursSnapId,
              parentSnapshotId:
                snapIndexEntry?.id || targetBranch.headSnapshotId || null,
              statsJson: null,
            });
          }
        }
      }

      const theirsSnapId = sourceBranch.headSnapshotId;
      const snapById = new Map(allSnapshots.map((s) => [s.id, s]));
      const baseSnapId = findLowestCommonAncestor(snapById, oursSnapId, theirsSnapId);

      const [baseMap, oursMap, theirsMap] = await Promise.all([
        baseSnapId ? loadSnapshotManifestMap(prisma, baseSnapId) : Promise.resolve(new Map()),
        loadSnapshotManifestMap(prisma, oursSnapId),
        loadSnapshotManifestMap(prisma, theirsSnapId),
      ]);

      const allPaths = [
        ...new Set([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()]),
      ].sort();

      const mergedEntries = new Map();
      const newBlobMap = new Map();
      const conflicts = [];
      let autoMergedCount = 0;

      for (const relPath of allPaths) {
        const baseEntry = baseMap.get(relPath);
        const oursEntry = oursMap.get(relPath);
        const theirsEntry = theirsMap.get(relPath);

        const baseSha = baseEntry?.blobSha256 || null;
        const oursSha = oursEntry?.blobSha256 || null;
        const theirsSha = theirsEntry?.blobSha256 || null;

        if (oursSha === theirsSha) {
          if (oursEntry) mergedEntries.set(relPath, oursEntry);
          continue;
        }
        if (oursSha === baseSha) {
          if (theirsEntry) {
            mergedEntries.set(relPath, theirsEntry);
            autoMergedCount += 1;
          }
          continue;
        }
        if (theirsSha === baseSha) {
          if (oursEntry) mergedEntries.set(relPath, oursEntry);
          continue;
        }

        // Check caller resolution override first
        const resChoice = resolutions?.[relPath];
        if (resChoice !== undefined) {
          const mode = typeof resChoice === "string" ? "manual" : resChoice?.resolution;
          if (mode === "ours") {
            if (oursEntry) mergedEntries.set(relPath, oursEntry);
            continue;
          }
          if (mode === "theirs") {
            if (theirsEntry) mergedEntries.set(relPath, theirsEntry);
            continue;
          }
          if (mode === "manual") {
            const text =
              typeof resChoice === "string" ? resChoice : resChoice?.manualContent;
            if (typeof text !== "string") {
              throw new ServiceError(
                `Manual conflict content missing for '${relPath}'`,
                400,
              );
            }
            const stored = writeCasBlob(projectId, Buffer.from(text, "utf8"));
            newBlobMap.set(stored.sha256, {
              projectId,
              sha256: stored.sha256,
              byteSize: stored.byteSize,
              isBinary: stored.isBinary,
              compressed: true,
            });
            mergedEntries.set(relPath, {
              relativePath: relPath,
              blobSha256: stored.sha256,
              byteSize: stored.byteSize,
              isBinary: stored.isBinary,
              mode: "100644",
            });
            continue;
          }
        }

        const isAnyBinary = Boolean(
          baseEntry?.isBinary || oursEntry?.isBinary || theirsEntry?.isBinary,
        );
        const baseText =
          baseEntry && !isAnyBinary
            ? readCasBlob(projectId, baseEntry.blobSha256).toString("utf8")
            : "";
        const oursText =
          oursEntry && !isAnyBinary
            ? readCasBlob(projectId, oursEntry.blobSha256).toString("utf8")
            : "";
        const theirsText =
          theirsEntry && !isAnyBinary
            ? readCasBlob(projectId, theirsEntry.blobSha256).toString("utf8")
            : "";

        if (!isAnyBinary && resChoice?.resolution === "both") {
          const mergeForBoth = threeWayMergeText(baseText, oursText, theirsText, {
            oursLabel: targetBranch.name,
            theirsLabel: sourceBranch.name,
          });
          const combined = resolveConflictMarkersKeepBoth(
            mergeForBoth.mergedText,
            { ours: oursText, theirs: theirsText },
          );
          const stored = writeCasBlob(projectId, Buffer.from(combined, "utf8"));
          newBlobMap.set(stored.sha256, {
            projectId,
            sha256: stored.sha256,
            byteSize: stored.byteSize,
            isBinary: stored.isBinary,
            compressed: true,
          });
          mergedEntries.set(relPath, {
            relativePath: relPath,
            blobSha256: stored.sha256,
            byteSize: stored.byteSize,
            isBinary: stored.isBinary,
            mode: "100644",
          });
          continue;
        }

        if (!isAnyBinary && oursEntry && theirsEntry) {
          const mergeRes = threeWayMergeText(baseText, oursText, theirsText, {
            oursLabel: targetBranch.name,
            theirsLabel: sourceBranch.name,
          });
          if (!mergeRes.conflicted) {
            const stored = writeCasBlob(
              projectId,
              Buffer.from(mergeRes.mergedText, "utf8"),
            );
            newBlobMap.set(stored.sha256, {
              projectId,
              sha256: stored.sha256,
              byteSize: stored.byteSize,
              isBinary: stored.isBinary,
              compressed: true,
            });
            mergedEntries.set(relPath, {
              relativePath: relPath,
              blobSha256: stored.sha256,
              byteSize: stored.byteSize,
              isBinary: stored.isBinary,
              mode: "100644",
            });
            autoMergedCount += 1;
            continue;
          }
          conflicts.push({
            path: relPath,
            isBinary: false,
            base: baseEntry ? baseText : null,
            ours: oursText,
            theirs: theirsText,
            working: mergeRes.mergedText,
          });
        } else {
          conflicts.push({
            path: relPath,
            isBinary: isAnyBinary,
            base: baseEntry ? (isAnyBinary ? null : baseText) : null,
            ours: oursEntry ? (isAnyBinary ? "[binary]" : oursText) : null,
            theirs: theirsEntry ? (isAnyBinary ? "[binary]" : theirsText) : null,
            working: isAnyBinary ? "" : oursText || theirsText,
          });
        }
      }

      if (conflicts.length > 0) {
        throw new ServiceError(
          `Merge conflicts in ${conflicts.length} file(s) require resolution`,
          409,
          "SNAPSHOT_MERGE_CONFLICT",
          {
            sourceBranch: { id: sourceBranch.id, name: sourceBranch.name },
            targetBranch: { id: targetBranch.id, name: targetBranch.name },
            baseSnapshotId: baseSnapId,
            conflicts,
            autoMergedCount,
          },
        );
      }

      const entryRows = [...mergedEntries.values()];
      const totalBytes = entryRows.reduce((s, e) => s + (e.byteSize || 0), 0);
      const mergedHash = computeManifestHash(entryRows);
      const { stats: mergeDiffStats } = diffManifests(oursMap, mergedEntries);
      const maxAgg = await prisma.projectSnapshot.aggregate({
        where: { projectId },
        _max: { versionNumber: true },
      });
      const nextVersion = (maxAgg?._max?.versionNumber ?? 0) + 1;
      const checksum = `merge_${Date.now()}_${randomUUID().slice(0, 8)}`;

      const committed = await withProjectGuard(
        { projectId, userId, capability: "snapshot.restore" },
        async (tx) => {
          let changedFiles = [];
          if (isTargetActive) {
            if (resolvedDirtyPolicy !== SNAPSHOT_RESTORE_POLICIES.DISCARD_DIRTY) {
              await assertEditorSnapshotChangeAllowed(tx, projectId);
            }
            const syncRes = syncWorkspaceFromManifest({
              projectId,
              rootDir: context.workspaceRoot,
              targetEntries: mergedEntries,
            });
            changedFiles = syncRes.changedFiles;
          }

          const mergedSnap = await tx.projectSnapshot.create({
            data: {
              projectId,
              source: context.activeSnapshot.source,
              checksum,
              contentHash: mergedHash,
              versionNumber: nextVersion,
              label: `Merge ${sourceBranch.name} into ${targetBranch.name}`,
              commitMessage:
                message?.trim() ||
                `Merged branch '${sourceBranch.name}' into '${targetBranch.name}'`,
              parentSnapshotId: oursSnapId,
              authorId: userId,
              vcsBranchId: targetBranch.id,
              statsJson: {
                filesTotal: entryRows.length,
                totalBytes,
                filesAdded: mergeDiffStats.added,
                filesModified: mergeDiffStats.modified,
                filesDeleted: mergeDiffStats.deleted,
                filesRenamed: mergeDiffStats.renamed,
                insertions: 0,
                deletions: 0,
                secondParentSnapshotId: theirsSnapId,
              },
              casMaterialized: true,
              commitSha: null,
              ...snapshotInheritedFields(
                context.activeSnapshot,
                context.workspaceRoot,
                context.activeSnapshot.storagePath,
                context.activeSnapshot.rootDir,
              ),
            },
          });

          const blobRows = [...newBlobMap.values()];
          if (blobRows.length > 0) {
            await tx.snapshotVcsBlobRef.createMany({
              data: blobRows,
              skipDuplicates: true,
            });
          }

          if (entryRows.length > 0) {
            await tx.snapshotVcsEntry.createMany({
              data: entryRows.map((e) => ({
                snapshotId: mergedSnap.id,
                relativePath: e.relativePath,
                blobSha256: e.blobSha256,
                byteSize: e.byteSize,
                isBinary: e.isBinary,
                mode: e.mode || "100644",
              })),
            });
          }

          await tx.snapshotVcsBranch.update({
            where: { id: targetBranch.id },
            data: { headSnapshotId: mergedSnap.id },
          });

          if (isTargetActive) {
            await syncFileVersionsForChanges(tx, {
              snapshotId: mergedSnap.id,
              userId,
              changedFiles,
            });
            await reconcileEditorReplacement({
              tx,
              projectId,
              snapshotId: context.activeSnapshot.id,
              actorId: userId,
              source: "HUMAN_EDIT",
              changes: changedFiles,
            });
            await tx.snapshotVcsStaging.deleteMany({ where: { projectId } });
          }

          const updatedProj = await tx.project.update({
            where: { id: projectId },
            data: {
              ...(isTargetActive ? { activeSnapshotId: mergedSnap.id } : {}),
              workspaceRevision: { increment: 1 },
            },
            select: { workspaceRevision: true },
          });

          const event = await publishProjectEvent({
            tx,
            projectId,
            actorId: userId,
            type: "workspace.changed",
            resourceId: mergedSnap.id,
            revision: updatedProj.workspaceRevision,
            payload: {
              kind: "SNAPSHOT_BRANCH_MERGED",
              sourceBranchId: sourceBranch.id,
              targetBranchId: targetBranch.id,
              snapshotId: mergedSnap.id,
            },
          });

          return { mergedSnap, event };
        },
      );

      await deliverProjectEvent(committed.event).catch(() => {});
      invalidateCachesAfterMutation({
        projectId,
        ownerId: context.project.ownerId,
        snapshotId: committed.mergedSnap.id,
      });

      emitSnapshotVcsUpdated(projectId, {
        reason: "merge_branch",
        snapshotId: committed.mergedSnap.id,
        actorId: userId,
      });

      return {
        merged: true,
        conflicted: false,
        autoMergedCount,
        backupCheckpoint,
        checkpointId: committed.mergedSnap.id,
        branches: await this.listBranches(projectId, userId),
        status: await this.getStatus(projectId, userId),
      };
    });
  }

  // ---- Tags & AI Summary & GC ----

  static async listTags(projectId, userId) {
    await this._ensureProjectContext(projectId, userId, "project.read");
    return prisma.snapshotVcsTag.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        snapshotId: true,
        name: true,
        description: true,
        color: true,
        createdAt: true,
        snapshot: {
          select: { id: true, versionNumber: true, label: true },
        },
      },
    });
  }

  static async createTag(
    projectId,
    userId,
    snapshotId,
    { name, description = "", color = "indigo" } = {},
  ) {
    if (!validateSnapshotTagName(name)) {
      throw new ServiceError("Invalid tag name", 400, "INVALID_TAG_NAME");
    }
    await this._ensureProjectContext(projectId, userId, "vcs.local");

    const snap = await prisma.projectSnapshot.findFirst({
      where: { id: snapshotId, projectId },
      select: { id: true },
    });
    if (!snap) {
      throw new ServiceError("Checkpoint not found", 404, "SNAPSHOT_NOT_FOUND");
    }

    const cleanName = name.trim();
    const dup = await prisma.snapshotVcsTag.findUnique({
      where: { projectId_name: { projectId, name: cleanName } },
      select: { id: true },
    });
    if (dup) {
      throw new ServiceError(
        `Tag '${cleanName}' already exists`,
        409,
        "TAG_ALREADY_EXISTS",
      );
    }

    const tag = await prisma.snapshotVcsTag.create({
      data: {
        projectId,
        snapshotId,
        name: cleanName,
        description: description?.trim() || null,
        color: color || "indigo",
        createdById: userId,
      },
      select: {
        id: true,
        snapshotId: true,
        name: true,
        description: true,
        color: true,
        createdAt: true,
      },
    });

    emitSnapshotVcsUpdated(projectId, { reason: "tag_created", snapshotId, actorId: userId });
    return tag;
  }

  static async deleteTag(projectId, userId, tagId) {
    await this._ensureProjectContext(projectId, userId, "snapshot.restore");
    const existing = await prisma.snapshotVcsTag.findFirst({
      where: { id: tagId, projectId },
      select: { id: true, snapshotId: true },
    });
    if (!existing) {
      throw new ServiceError("Tag not found", 404, "TAG_NOT_FOUND");
    }
    await prisma.snapshotVcsTag.delete({ where: { id: tagId } });
    emitSnapshotVcsUpdated(projectId, {
      reason: "tag_deleted",
      snapshotId: existing.snapshotId,
      actorId: userId,
    });
    return { deleted: true, tagId };
  }

  static async generateAiSummary(projectId, userId, { model } = {}) {
    await resolveProjectAccess({ projectId, userId, capability: "ai.use" });
    const status = await this.getStatus(projectId, userId);
    const targetChanges =
      status.staged.length > 0 ? status.staged : status.unstaged;
    if (targetChanges.length === 0) {
      throw new ServiceError(
        "No working tree changes available to summarize",
        409,
        "SNAPSHOT_UNCHANGED",
      );
    }

    const diffSections = [];
    for (const ch of targetChanges.slice(0, 12)) {
      if (ch.isBinary) {
        diffSections.push(`[${ch.status}] ${ch.path} (binary file)`);
        continue;
      }
      try {
        const pair = await this.getDiffPair(projectId, userId, {
          filePath: ch.path,
          origPath: ch.origPath,
        });
        diffSections.push(pair.unifiedDiff || `[${ch.status}] ${ch.path}`);
      } catch {
        diffSections.push(`[${ch.status}] ${ch.path}`);
      }
    }

    return generateSnapshotAiSummary({
      projectId,
      userId,
      changesSummaryText: diffSections.join("\n\n"),
      model,
    });
  }

  static async runGarbageCollection(projectId, userId, { graceWindowMs } = {}) {
    await this._ensureProjectContext(projectId, userId, "snapshot.restore");
    return runSnapshotCasGc(projectId, { graceWindowMs });
  }
}

export { computeSnapshotContentHash };
