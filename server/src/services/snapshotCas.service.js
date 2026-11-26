import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { projectEditableWorkspaceRoot } from "./projectFileVersion.service.js";
import { detectBinaryBuffer } from "./gitPorcelainParser.service.js";
import { withProjectVcsLock } from "./vcsLock.service.js";
import { deliverScopedProjectTransport } from "./projectSubscription.service.js";
import { isVcsIgnoredRelativePath } from "../../../shared/versionControlMode.js";
import {
  SNAPSHOT_SOCKET_EVENTS,
  SNAPSHOT_VCS_LIMITS,
} from "../../../shared/snapshotVcsProtocol.js";

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export function validateSafeId(value, label = "identifier") {
  if (typeof value !== "string" || !SAFE_ID_RE.test(value)) {
    throw new ServiceError(`Invalid ${label}`, 400, "INVALID_IDENTIFIER");
  }
  return value;
}

export function validateSha256(value) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new ServiceError("Invalid SHA-256 object digest", 400, "INVALID_BLOB_HASH");
  }
  return value;
}

/**
 * Normalizes and validates a project-relative POSIX path for Snapshot CAS & manifests.
 */
export function sanitizeVcsRelativePath(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ServiceError("A project-relative path is required", 400, "INVALID_FILE_PATH");
  }
  if (/[\0\r\n"]/.test(raw) || /^[a-z]:/i.test(raw) || raw.startsWith("\\")) {
    throw new ServiceError("A project-relative path is required", 400, "INVALID_FILE_PATH");
  }
  const posix = raw.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!posix || path.isAbsolute(posix) || path.posix.isAbsolute(posix)) {
    throw new ServiceError("A project-relative path is required", 400, "INVALID_FILE_PATH");
  }
  const parts = posix.split("/").filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some(
      (part) =>
        part === "." ||
        part === ".." ||
        part.toLowerCase() === ".git" ||
        WINDOWS_RESERVED_NAME_RE.test(part),
    )
  ) {
    throw new ServiceError("Invalid or reserved project path", 400, "INVALID_FILE_PATH");
  }
  return parts.join("/");
}

export function getCasObjectsDir(projectId, baseDir = process.cwd()) {
  const safeId = validateSafeId(projectId, "projectId");
  return path.resolve(baseDir, "storage", "projects", safeId, "vcs", "objects");
}

export function getBlobDiskPath(projectId, sha256, baseDir = process.cwd()) {
  const safeSha = validateSha256(sha256);
  return path.join(getCasObjectsDir(projectId, baseDir), safeSha.slice(0, 2), `${safeSha}.gz`);
}

/**
 * Atomically writes content bytes as a deduplicated gzipped CAS object (`temp -> rename`).
 */
export function writeCasBlob(projectId, contentInput, baseDir = process.cwd()) {
  const buf = Buffer.isBuffer(contentInput)
    ? contentInput
    : Buffer.from(String(contentInput ?? ""), "utf8");
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const isBinary = detectBinaryBuffer(buf);
  const targetPath = getBlobDiskPath(projectId, sha256, baseDir);

  if (fs.existsSync(targetPath)) {
    return {
      sha256,
      byteSize: buf.length,
      isBinary,
      compressed: true,
      created: false,
      path: targetPath,
    };
  }

  const shardDir = path.dirname(targetPath);
  fs.mkdirSync(shardDir, { recursive: true });
  const compressedBuf = gzipSync(buf, { level: 6 });
  const tmpPath = path.join(shardDir, `.${sha256}.tmp.${randomUUID()}`);

  try {
    fs.writeFileSync(tmpPath, compressedBuf);
    try {
      fs.renameSync(tmpPath, targetPath);
    } catch (renameErr) {
      if (!fs.existsSync(targetPath)) throw renameErr;
      fs.rmSync(tmpPath, { force: true });
    }
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }

  return {
    sha256,
    byteSize: buf.length,
    isBinary,
    compressed: true,
    created: true,
    path: targetPath,
  };
}

/**
 * Reads and decompresses a CAS blob buffer.
 */
export function readCasBlob(projectId, sha256, baseDir = process.cwd()) {
  const targetPath = getBlobDiskPath(projectId, sha256, baseDir);
  if (!fs.existsSync(targetPath)) {
    throw new ServiceError(
      `Snapshot object '${sha256.slice(0, 12)}' is missing from Content-Addressable Storage`,
      404,
      "CAS_BLOB_MISSING",
    );
  }
  const compressed = fs.readFileSync(targetPath);
  return gunzipSync(compressed);
}

const workingTreeStatCache = new Map();
const MAX_STAT_CACHE_ENTRIES = 50_000;
const RACY_STAT_GUARD_MS = 1000;

/**
 * Clears cached `(mtimeMs, size) -> { sha256, isBinary }` file metadata for a workspace
 * root (or all roots when omitted).
 */
export function clearWorkingTreeStatCache(rootDirPrefix = null) {
  if (!rootDirPrefix) {
    workingTreeStatCache.clear();
    return;
  }
  const resolvedPrefix = path.resolve(rootDirPrefix);
  const withSep = resolvedPrefix.endsWith(path.sep)
    ? resolvedPrefix
    : `${resolvedPrefix}${path.sep}`;
  for (const key of workingTreeStatCache.keys()) {
    if (key === resolvedPrefix || key.startsWith(withSep)) {
      workingTreeStatCache.delete(key);
    }
  }
}

/**
 * Recursively scans a workspace working tree while strictly skipping symlinks,
 * CovAI test-runner artifacts, `.git/`, `node_modules/`, and secret files.
 * Uses an in-memory `(mtimeMs, size)` cache guarded against same-second writes (`> 1s`).
 */
export function scanWorkingTree(
  rootDir,
  { maxFiles = SNAPSHOT_VCS_LIMITS.MAX_FILES_PER_CHECKPOINT, useCache = true } = {},
) {
  const manifest = new Map();
  if (!rootDir || !fs.existsSync(rootDir)) return manifest;

  const now = Date.now();

  const visit = (dirPath, relPrefix = "") => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (isVcsIgnoredRelativePath(relPath)) continue;

      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath, relPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        const cacheKey = path.resolve(fullPath);
        const isStatSafe = now - stat.mtimeMs > RACY_STAT_GUARD_MS;
        const cached =
          useCache && isStatSafe ? workingTreeStatCache.get(cacheKey) : null;

        if (
          cached &&
          cached.mtimeMs === stat.mtimeMs &&
          cached.size === stat.size
        ) {
          manifest.set(relPath, {
            sha256: cached.sha256,
            byteSize: stat.size,
            isBinary: cached.isBinary,
            fullPath,
          });
        } else {
          const buf = fs.readFileSync(fullPath);
          const sha256 = createHash("sha256").update(buf).digest("hex");
          const isBinary = detectBinaryBuffer(buf);
          if (useCache && isStatSafe) {
            if (workingTreeStatCache.size >= MAX_STAT_CACHE_ENTRIES) {
              const oldestKey = workingTreeStatCache.keys().next().value;
              if (oldestKey !== undefined) workingTreeStatCache.delete(oldestKey);
            }
            workingTreeStatCache.set(cacheKey, {
              mtimeMs: stat.mtimeMs,
              size: stat.size,
              sha256,
              isBinary,
            });
          }
          manifest.set(relPath, {
            sha256,
            byteSize: buf.length,
            isBinary,
            fullPath,
          });
        }
        if (manifest.size > maxFiles) {
          throw new ServiceError(
            `Workspace exceeds ${maxFiles} tracked snapshot files limit`,
            413,
            "WORKSPACE_TOO_LARGE",
          );
        }
      }
    }
  };

  visit(rootDir, "");
  return manifest;
}

/**
 * Computes a deterministic manifest Merkle hash from a file-to-SHA map or entry list.
 */
export function computeManifestHash(entriesInput) {
  const items = [];
  if (entriesInput instanceof Map) {
    for (const [relPath, info] of entriesInput.entries()) {
      const sha = info?.sha256 || info?.blobSha256;
      if (sha) items.push({ path: relPath.replaceAll("\\", "/"), sha256: sha });
    }
  } else if (Array.isArray(entriesInput)) {
    for (const item of entriesInput) {
      const relPath = item?.relativePath || item?.path;
      const sha = item?.sha256 || item?.blobSha256;
      if (relPath && sha) items.push({ path: relPath.replaceAll("\\", "/"), sha256: sha });
    }
  }

  items.sort((a, b) => a.path.localeCompare(b.path));
  const hash = createHash("sha256");
  for (const item of items) {
    hash.update(`${item.path}\0${item.sha256}\n`);
  }
  return hash.digest("hex");
}

function assertContainedTargetPath(rootDir, relPath) {
  const safeRel = sanitizeVcsRelativePath(relPath);
  const realRoot = fs.realpathSync(rootDir);
  const target = path.resolve(realRoot, safeRel);
  const relCheck = path.relative(realRoot, target);
  if (!relCheck || relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new ServiceError("Path escapes workspace root", 400, "INVALID_FILE_PATH");
  }

  let current = realRoot;
  const parts = safeRel.split("/");
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new ServiceError("Symbolic links are not permitted in workspace", 400, "INVALID_FILE_PATH");
      }
    }
  }
  return { safeRel, realRoot, target };
}

/**
 * Synchronizes a live workspace directory on disk to match `targetEntries`,
 * updating only changed files, deleting obsolete tracked files, and strictly
 * preserving ignored directories (`node_modules/`, `.git/`, `coverage/`, `.env*`).
 */
export function syncWorkspaceFromManifest({
  projectId,
  rootDir,
  targetEntries,
  baseDir = process.cwd(),
}) {
  validateSafeId(projectId, "projectId");
  fs.mkdirSync(rootDir, { recursive: true });

  const targetMap = new Map();
  if (targetEntries instanceof Map) {
    for (const [k, v] of targetEntries.entries()) {
      const safeRel = sanitizeVcsRelativePath(k);
      targetMap.set(safeRel, {
        blobSha256: v.blobSha256 || v.sha256,
        isBinary: Boolean(v.isBinary),
      });
    }
  } else if (Array.isArray(targetEntries)) {
    for (const entry of targetEntries) {
      const safeRel = sanitizeVcsRelativePath(entry.relativePath || entry.path);
      targetMap.set(safeRel, {
        blobSha256: entry.blobSha256 || entry.sha256,
        isBinary: Boolean(entry.isBinary),
      });
    }
  }

  const currentFiles = scanWorkingTree(rootDir);
  const changedFiles = [];
  let writtenCount = 0;
  let deletedCount = 0;

  for (const [relPath, entry] of targetMap.entries()) {
    const existing = currentFiles.get(relPath);
    if (existing && existing.sha256 === entry.blobSha256) {
      continue;
    }

    const { target } = assertContainedTargetPath(rootDir, relPath);
    const nextBuf = readCasBlob(projectId, entry.blobSha256, baseDir);
    let beforeText = "";
    if (existing && !existing.isBinary && existing.byteSize <= SNAPSHOT_VCS_LIMITS.MAX_DIFF_FILE_BYTES) {
      beforeText = fs.readFileSync(existing.fullPath, "utf8");
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmpTarget = `${target}.vcs-tmp.${randomUUID()}`;
    fs.writeFileSync(tmpTarget, nextBuf);
    fs.renameSync(tmpTarget, target);

    writtenCount += 1;
    changedFiles.push({
      path: relPath,
      before: beforeText,
      content: entry.isBinary || detectBinaryBuffer(nextBuf) ? "" : nextBuf.toString("utf8"),
    });
  }

  const realRoot = fs.realpathSync(rootDir);
  for (const [relPath, existing] of currentFiles.entries()) {
    if (targetMap.has(relPath)) continue;
    if (isVcsIgnoredRelativePath(relPath)) continue;

    let beforeText = "";
    if (!existing.isBinary && existing.byteSize <= SNAPSHOT_VCS_LIMITS.MAX_DIFF_FILE_BYTES) {
      beforeText = fs.readFileSync(existing.fullPath, "utf8");
    }
    fs.rmSync(existing.fullPath, { force: true });
    deletedCount += 1;
    changedFiles.push({
      path: relPath,
      before: beforeText,
      content: null,
    });

    // Prune newly emptied non-ignored parent directories safely
    let dir = path.dirname(existing.fullPath);
    while (dir.startsWith(realRoot + path.sep)) {
      const entriesLeft = fs.readdirSync(dir);
      if (entriesLeft.length > 0) break;
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  }

  clearWorkingTreeStatCache(rootDir);
  return { changedFiles, writtenCount, deletedCount };
}

/**
 * Materializes a snapshot's workspace files into immutable CAS storage and
 * initializes the default `"main"` SnapshotVcsBranch if missing.
 */
export async function materializeSnapshotToCas({
  projectId,
  snapshotId = null,
  userId = null,
  rootDir = null,
  db = prisma,
  baseDir = process.cwd(),
}) {
  if (
    !db?.snapshotVcsBranch ||
    !db?.snapshotVcsEntry ||
    !db?.snapshotVcsBlobRef ||
    !db?.$transaction
  ) {
    return null;
  }

  const project = await db.project.findFirst({
    where: { id: projectId },
    select: {
      id: true,
      ownerId: true,
      activeSnapshotId: true,
      activeVcsBranchId: true,
    },
  });
  if (!project) return null;

  const targetSnapId = snapshotId || project.activeSnapshotId;
  const snapshot = targetSnapId
    ? await db.projectSnapshot.findFirst({
        where: { id: targetSnapId, projectId },
      })
    : await db.projectSnapshot.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      });

  if (!snapshot) return null;

  if (snapshot.casMaterialized && project.activeVcsBranchId) {
    return { snapshot, branchId: project.activeVcsBranchId, alreadyMaterialized: true };
  }

  const workspaceRoot = rootDir || projectEditableWorkspaceRoot(snapshot);
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return null;

  const scanned = scanWorkingTree(workspaceRoot);
  const blobMetaList = [];
  const uniqueBlobMap = new Map();
  let totalBytes = 0;

  for (const [relPath, info] of scanned.entries()) {
    const buf = fs.readFileSync(info.fullPath);
    const stored = writeCasBlob(projectId, buf, baseDir);
    totalBytes += stored.byteSize;

    blobMetaList.push({
      snapshotId: snapshot.id,
      relativePath: relPath,
      blobSha256: stored.sha256,
      byteSize: stored.byteSize,
      isBinary: stored.isBinary,
      mode: "100644",
    });

    if (!uniqueBlobMap.has(stored.sha256)) {
      uniqueBlobMap.set(stored.sha256, {
        projectId,
        sha256: stored.sha256,
        byteSize: stored.byteSize,
        isBinary: stored.isBinary,
        compressed: true,
      });
    }
  }

  const contentHash = computeManifestHash(blobMetaList);
  const statsJson = {
    filesTotal: blobMetaList.length,
    totalBytes,
    filesAdded: blobMetaList.length,
    filesModified: 0,
    filesDeleted: 0,
    insertions: 0,
    deletions: 0,
  };

  const result = await db.$transaction(async (tx) => {
    const freshSnapshot = await tx.projectSnapshot.findUnique({
      where: { id: snapshot.id },
      select: {
        id: true,
        casMaterialized: true,
        vcsBranchId: true,
        versionNumber: true,
        label: true,
        commitMessage: true,
        authorId: true,
      },
    });

    let branch = await tx.snapshotVcsBranch.findFirst({
      where: { projectId, isDefault: true },
    });
    if (!branch) {
      branch = await tx.snapshotVcsBranch.findUnique({
        where: { projectId_name: { projectId, name: SNAPSHOT_VCS_LIMITS.DEFAULT_BRANCH } },
      });
    }
    if (!branch) {
      branch = await tx.snapshotVcsBranch.create({
        data: {
          projectId,
          name: SNAPSHOT_VCS_LIMITS.DEFAULT_BRANCH,
          description: "Default snapshot timeline",
          headSnapshotId: snapshot.id,
          baseSnapshotId: snapshot.id,
          isDefault: true,
          createdById: userId || project.ownerId,
        },
      });
    } else if (!branch.headSnapshotId) {
      branch = await tx.snapshotVcsBranch.update({
        where: { id: branch.id },
        data: {
          headSnapshotId: snapshot.id,
          baseSnapshotId: branch.baseSnapshotId || snapshot.id,
        },
      });
    }

    if (!freshSnapshot?.casMaterialized) {
      const blobRows = [...uniqueBlobMap.values()];
      if (blobRows.length > 0) {
        await tx.snapshotVcsBlobRef.createMany({
          data: blobRows,
          skipDuplicates: true,
        });
      }

      await tx.snapshotVcsEntry.deleteMany({ where: { snapshotId: snapshot.id } });
      if (blobMetaList.length > 0) {
        await tx.snapshotVcsEntry.createMany({ data: blobMetaList });
      }
    }

    const updatedSnapshot = await tx.projectSnapshot.update({
      where: { id: snapshot.id },
      data: {
        casMaterialized: true,
        vcsBranchId: freshSnapshot?.vcsBranchId || branch.id,
        contentHash,
        versionNumber: freshSnapshot?.versionNumber ?? 1,
        label: freshSnapshot?.label || "Initial Ingest",
        commitMessage: freshSnapshot?.commitMessage || "Initial workspace baseline",
        authorId: freshSnapshot?.authorId || userId || project.ownerId,
        statsJson,
      },
    });

    const latestProject = await tx.project.findUnique({
      where: { id: projectId },
      select: { activeSnapshotId: true, activeVcsBranchId: true },
    });

    await tx.project.update({
      where: { id: projectId },
      data: {
        activeSnapshotId: latestProject?.activeSnapshotId || snapshot.id,
        activeVcsBranchId: latestProject?.activeVcsBranchId || branch.id,
      },
    });

    return { snapshot: updatedSnapshot, branchId: branch.id, alreadyMaterialized: false };
  });

  return result;
}

/**
 * Concurrency-safe entry point ensuring a project's baseline snapshot is
 * frozen in immutable CAS before edits or Version Control reads/writes proceed.
 */
export async function ensureProjectCasBaseline({
  projectId,
  snapshotId = null,
  userId = null,
  rootDir = null,
  db = prisma,
  baseDir = process.cwd(),
}) {
  if (!projectId) return null;
  return withProjectVcsLock(projectId, () =>
    materializeSnapshotToCas({
      projectId,
      snapshotId,
      userId,
      rootDir,
      db,
      baseDir,
    }),
  );
}

/**
 * Safely collects unreferenced CAS blobs for a project only when:
 * 1. SHA-256 has zero references across all `SnapshotVcsEntry` rows in the project.
 * 2. SHA-256 does not match any file currently staged in `SnapshotVcsStaging`.
 * 3. `SnapshotVcsBlobRef.createdAt` is older than `graceWindowMs` (default 10 minutes).
 */
export async function runSnapshotCasGc(
  projectId,
  {
    graceWindowMs = 10 * 60 * 1000,
    db = prisma,
    baseDir = process.cwd(),
  } = {},
) {
  validateSafeId(projectId, "projectId");
  const safeGraceMs = Number.isFinite(graceWindowMs)
    ? Math.max(0, graceWindowMs)
    : 10 * 60 * 1000;

  return withProjectVcsLock(projectId, async () => {
    const [entries, stagedRows, project] = await Promise.all([
      db.snapshotVcsEntry.findMany({
        where: { snapshot: { projectId } },
        select: { blobSha256: true },
      }),
      db.snapshotVcsStaging.findMany({
        where: { projectId },
        select: { relativePath: true },
      }),
      db.project.findFirst({
        where: { id: projectId },
        select: { activeSnapshotId: true },
      }),
    ]);

    const referencedShas = new Set(entries.map((e) => e.blobSha256));

    // Protect blobs matching currently staged working tree files
    if (stagedRows.length > 0 && project?.activeSnapshotId) {
      const activeSnap = await db.projectSnapshot.findFirst({
        where: { id: project.activeSnapshotId, projectId },
      });
      if (activeSnap) {
        try {
          const workspaceRoot = projectEditableWorkspaceRoot(activeSnap);
          for (const staged of stagedRows) {
            try {
              const { target } = assertContainedTargetPath(
                workspaceRoot,
                staged.relativePath,
              );
              if (fs.existsSync(target) && fs.statSync(target).isFile()) {
                const sha = createHash("sha256")
                  .update(fs.readFileSync(target))
                  .digest("hex");
                referencedShas.add(sha);
              }
            } catch {
              // Skip invalid or missing staged file
            }
          }
        } catch {
          // Non-fatal if active workspace missing on disk
        }
      }
    }

    const cutoffDate = new Date(Date.now() - safeGraceMs);
    const allRefs = await db.snapshotVcsBlobRef.findMany({
      where: {
        projectId,
        createdAt: { lte: cutoffDate },
      },
      select: { sha256: true, byteSize: true },
    });

    const unreferenced = allRefs.filter((ref) => !referencedShas.has(ref.sha256));
    let deletedCount = 0;
    let freedBytes = 0;
    const deletedShas = [];

    for (const ref of unreferenced) {
      const diskPath = getBlobDiskPath(projectId, ref.sha256, baseDir);
      try {
        if (fs.existsSync(diskPath)) {
          freedBytes += fs.statSync(diskPath).size;
          fs.rmSync(diskPath, { force: true });
        }
      } catch {
        // Continue DB cleanup if file already absent
      }
      deletedShas.push(ref.sha256);
      deletedCount += 1;
    }

    if (deletedShas.length > 0) {
      await db.snapshotVcsBlobRef.deleteMany({
        where: {
          projectId,
          sha256: { in: deletedShas },
        },
      });
    }

    const result = {
      projectId,
      scannedCount: allRefs.length,
      referencedCount: referencedShas.size,
      deletedCount,
      freedBytes,
    };

    void deliverScopedProjectTransport({
      projectId,
      event: SNAPSHOT_SOCKET_EVENTS.GC_COMPLETED,
      payload: result,
    }).catch(() => {});

    return result;
  });
}
