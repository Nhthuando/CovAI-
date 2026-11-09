import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveSnapshotRootDir } from "../utils/projectRootResolver.js";
import { snapshotWorkspaceRoot } from "../utils/snapshotWorkspace.js";

export const VERSIONS_DIR_NAME = ".covai_test_versions";
export const MANIFEST_FILE_NAME = "manifest.json";
export const MAX_VERSIONS_PER_FILE = 20;

// In-memory cache for fast lookups across requests: snapshotId -> manifest
const snapshotVersionsCache = new Map();

/**
 * Clears in-memory manifest cache for a snapshot or all snapshots.
 */
export function clearManifestCache(snapshotId = null) {
    if (snapshotId) {
        for (const key of snapshotVersionsCache.keys()) if (key.startsWith(`${snapshotId}:`)) snapshotVersionsCache.delete(key);
    } else {
        snapshotVersionsCache.clear();
    }
}

/**
 * Calculates a SHA256 hex digest of file content.
 */
export function hashContent(content = "") {
    return crypto.createHash("sha256").update(String(content || "")).digest("hex");
}

/**
 * Resolves the absolute directory path where test versions are stored for a project workspace.
 */
export function resolveActualPath(rootDir) {
    if (!rootDir) return null;
    let candidate = rootDir;
    if (fs.existsSync(candidate)) return candidate;
    if (candidate.startsWith("/app/")) {
        const hostCandidate = path.resolve(process.cwd(), candidate.replace(/^\/app\//, ""));
        if (fs.existsSync(hostCandidate)) return hostCandidate;
    }
    const resolved = resolveSnapshotRootDir(candidate);
    return resolved || candidate;
}

/**
 * Returns the storage directory for versions inside a project workspace.
 */
export function getVersionsDir(rootDir) {
    const actualRoot = resolveActualPath(rootDir);
    if (!actualRoot) return null;
    return path.join(actualRoot, VERSIONS_DIR_NAME);
}

/**
 * Atomically writes a JSON file to disk.
 */
function atomicWriteJsonSync(filePath, data) {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }
    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmpPath, content, "utf8");
    fs.renameSync(tmpPath, filePath);
}

/**
 * Sanitizes any legacy Vietnamese strings in manifest labels and summaries
 */
function sanitizeManifestObject(manifest) {
    if (!manifest || typeof manifest !== 'object') return manifest;
    if (manifest.files) {
        for (const fKey of Object.keys(manifest.files)) {
            const f = manifest.files[fKey];
            if (Array.isArray(f.versions)) {
                for (const v of f.versions) {
                    if (v.label && typeof v.label === "string") {
                        v.label = v.label
                            .replace("Version 1 (G\u1ed1c - Ch\u01b0a c\u00f3 file)", "Version 1 (Baseline - File not present)")
                            .replace("Version 1 (G\u1ed1c)", "Version 1 (Baseline)")
                            .replace("Version 2 (\u0110\u00e3 \u00e1p d\u1ee5ng)", "Version 2 (Applied)");
                    }
                    if (v.summary && typeof v.summary === "string") {
                        v.summary = v.summary
                            .replace("File ch\u01b0a t\u1ed3n t\u1ea1i tr\u01b0\u1edbc khi AI suggest", "Test file did not exist prior to AI test generation")
                            .replace("B\u1ed9 unit tests \u0111\u01b0\u1ee3c AI t\u1ea1o cho c\u00e1c nh\u00e1nh v\u00e0 logic ch\u01b0a ph\u1ee7", "AI-generated unit test suite covering untested branches and logic");
                    }
                }
            }
        }
    }
    return manifest;
}

/**
 * Loads the version manifest for a snapshot from cache or disk.
 */
export function loadManifest({ snapshotId, rootDir }) {
    if (!snapshotId) return null;
    let actualRoot = resolveActualPath(rootDir);
    if (!actualRoot) return null;
    const cacheKey = `${snapshotId}:${path.resolve(actualRoot)}`;
    if (snapshotVersionsCache.has(cacheKey)) return sanitizeManifestObject(snapshotVersionsCache.get(cacheKey));

    const manifestPath = path.join(actualRoot, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME);
    if (fs.existsSync(manifestPath)) {
        try {
            const raw = fs.readFileSync(manifestPath, "utf8");
            const parsed = sanitizeManifestObject(JSON.parse(raw));
            snapshotVersionsCache.set(cacheKey, parsed);
            return parsed;
        } catch (err) {
            console.warn(`[unitTestVersion] Error reading manifest for ${snapshotId}:`, err.message);
        }
    }

    return null;
}

/**
 * Persists the version manifest to cache and disk.
 */
export function persistManifest({ snapshotId, rootDir, manifest }) {
    if (!snapshotId || !manifest) return;
    const actualRoot = resolveActualPath(rootDir);
    if (!actualRoot) return;

    try {
        const versionsDir = path.join(actualRoot, VERSIONS_DIR_NAME);
        const manifestPath = path.join(versionsDir, MANIFEST_FILE_NAME);
        atomicWriteJsonSync(manifestPath, manifest);
        snapshotVersionsCache.set(`${snapshotId}:${path.resolve(actualRoot)}`, manifest);
    } catch (err) {
        console.warn(`[unitTestVersion] Warning writing manifest for ${snapshotId}:`, err.message);
    }
}

/**
 * Normalizes relative file paths for consistent version key indexing.
 */
export function normalizePathKey(filePath = "") {
    if (!filePath || typeof filePath !== "string") return "";
    return filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Records and saves unit test file versions for a snapshot.
 * Maintains Version 1 (Baseline / Original) and Version 2+ (AI Suggestion / Applied).
 *
 * @param {Object} params
 * @param {string} params.snapshotId
 * @param {string} params.rootDir
 * @param {string} params.projectId
 * @param {string} params.sourceFile
 * @param {string} params.testFile
 * @param {string} params.originalContent
 * @param {string} params.updatedContent
 * @param {string} params.framework
 * @param {string} params.summary
 * @param {boolean} params.isExisting
 * @param {string} params.status - "GENERATED" | "APPLIED"
 * @returns {Object} The updated file version record
 */
export function saveUnitTestFileVersions({
    snapshotId,
    rootDir,
    projectId,
    sourceFile,
    testFile,
    originalContent = "",
    updatedContent = "",
    framework = "jest",
    summary = null,
    isExisting = false,
    status = "GENERATED"
}) {
    if (!snapshotId || !testFile) {
        return null;
    }

    const cleanTestFile = normalizePathKey(testFile);
    const cleanSourceFile = sourceFile ? normalizePathKey(sourceFile) : null;
    const nowIso = new Date().toISOString();

    let manifest = loadManifest({ snapshotId, rootDir });
    if (!manifest) {
        manifest = {
            snapshotId,
            projectId: projectId || null,
            updatedAt: nowIso,
            files: {}
        };
    } else {
        manifest.updatedAt = nowIso;
        if (projectId && !manifest.projectId) {
            manifest.projectId = projectId;
        }
        if (!manifest.files) {
            manifest.files = {};
        }
    }

    const existingFileRecord = manifest.files[cleanTestFile];
    const isActuallyNew = Boolean(!isExisting || !originalContent || originalContent.trim().length === 0);

    if (!existingFileRecord) {
        // First time recording versions for this test file:
        // Version 1 = Baseline / Original
        const v1 = {
            version: 1,
            versionId: `v1_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
            type: "ORIGINAL",
            label: isActuallyNew ? "Version 1 (Baseline - No test file)" : "Version 1 (Baseline / Original)",
            summary: isActuallyNew ? "File did not exist before AI suggestions" : "Original content prior to AI suggestions",
            content: originalContent || "",
            sha256: hashContent(originalContent || ""),
            createdAt: nowIso,
            status: "BASELINE",
            isActive: false,
            isNewFile: isActuallyNew
        };

        // Version 2 = AI Suggestion / Applied
        const v2 = {
            version: 2,
            versionId: `v2_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
            type: status === "APPLIED" ? "APPLIED" : "SUGGESTED",
            label: status === "APPLIED" ? "Version 2 (Applied)" : "Version 2 (AI Suggest)",
            summary: summary || "AI-generated unit test suite covering untested branches and logic",
            content: updatedContent || "",
            sha256: hashContent(updatedContent || ""),
            createdAt: nowIso,
            status: status || "GENERATED",
            isActive: true,
            isNewFile: false
        };

        manifest.files[cleanTestFile] = {
            sourceFile: cleanSourceFile,
            testFile: cleanTestFile,
            framework: framework || "jest",
            currentVersion: 2,
            isNewFile: isActuallyNew,
            versions: [v1, v2]
        };
    } else {
        // File already has version history
        const fileRecord = existingFileRecord;
        const versions = fileRecord.versions || [];
        const latestVersion = versions[versions.length - 1];
        const updatedHash = hashContent(updatedContent || "");

        if (latestVersion && latestVersion.sha256 === updatedHash) {
            // Same content as latest version: update metadata/status only
            if (status === "APPLIED" && latestVersion.status !== "APPLIED") {
                latestVersion.status = "APPLIED";
                latestVersion.label = `Version ${latestVersion.version} (Applied)`;
            }
            if (summary) latestVersion.summary = summary;
            latestVersion.isActive = true;
            fileRecord.currentVersion = latestVersion.version;
            // Ensure older versions are marked inactive
            versions.forEach(v => {
                if (v.version !== latestVersion.version) v.isActive = false;
            });
        } else {
            // Different content: create new incremental version (v3, v4, ...)
            const nextVersionNum = versions.reduce((max, v) => Math.max(max, v.version || 0), 0) + 1;
            const newVersion = {
                version: nextVersionNum,
                versionId: `v${nextVersionNum}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
                type: status === "APPLIED" ? "APPLIED" : "SUGGESTED",
                label: status === "APPLIED" ? `Version ${nextVersionNum} (Applied)` : `Version ${nextVersionNum} (AI Suggest)`,
                summary: summary || `Incremental test suggestions cycle ${nextVersionNum}`,
                content: updatedContent || "",
                sha256: updatedHash,
                createdAt: nowIso,
                status: status || "GENERATED",
                isActive: true,
                isNewFile: false
            };

            // Deactivate previous versions
            versions.forEach(v => { v.isActive = false; });
            versions.push(newVersion);

            // Cap at MAX_VERSIONS_PER_FILE (preserving Version 1)
            if (versions.length > MAX_VERSIONS_PER_FILE) {
                const v1 = versions[0];
                const recent = versions.slice(-(MAX_VERSIONS_PER_FILE - 1));
                fileRecord.versions = [v1, ...recent];
            }

            fileRecord.currentVersion = nextVersionNum;
            if (cleanSourceFile && !fileRecord.sourceFile) fileRecord.sourceFile = cleanSourceFile;
            if (framework) fileRecord.framework = framework;
        }
    }

    persistManifest({ snapshotId, rootDir, manifest });
    return manifest.files[cleanTestFile];
}

/** Publishes every file's active pointer with one manifest rename. Called only
 * after the server has verified the entire batch, inside the prepared workspace.
 * The outer workspace publisher journals this manifest together with test files. */
export function saveVerifiedUnitTestBatch({ snapshotId, rootDir, projectId, runId, files, verification, coverage }) {
    if (!verification?.valid || !runId || !files?.length) throw new ServiceError('The complete test batch must pass before creating a version', 409);
    const previous = loadManifest({ snapshotId, rootDir });
    const manifest = structuredClone(previous || { snapshotId, projectId, files: {} });
    const now = new Date().toISOString();
    const contentKey = hashContent(JSON.stringify(files.map(file => [normalizePathKey(file.testFile), hashContent(file.updatedContent)]).sort()));
    const active = manifest.batches?.find(batch => batch.batchId === manifest.activeBatchId);
    const unchanged = files.every(file => manifest.files[normalizePathKey(file.testFile)]?.versions?.find(version => version.isActive)?.sha256 === hashContent(file.updatedContent));
    if (active && (active.contentKey === contentKey || unchanged)) return { ...active, reused: true };
    const version = Math.max(1, ...(manifest.batches || []).map(batch => batch.version || 0),
        ...Object.values(manifest.files).flatMap(file => (file.versions || []).map(item => item.version || 0))) + 1;
    const batchId = `batch_${runId}`;
    const batch = { batchId, runId, version, contentKey, createdAt: now, status: 'APPLIED', verified: true,
        files: files.map(file => normalizePathKey(file.testFile)), coverage };
    for (const file of files) {
        const key = normalizePathKey(file.testFile);
        const isActuallyNew = file.originalContent === null || file.originalContent === undefined;
        let record = manifest.files[key];
        if (!record) {
            const v1 = {
                version: 1,
                versionId: `v1_${hashContent(key).slice(0, 12)}`,
                type: 'ORIGINAL',
                status: 'BASELINE',
                label: 'Version 1: Baseline / Initial State',
                summary: isActuallyNew ? 'Pre-suggestion empty baseline state' : 'Original pre-existing test suite before AI generation',
                content: file.originalContent || '',
                sha256: hashContent(file.originalContent || ''),
                createdAt: now,
                isActive: false,
                isNewFile: isActuallyNew
            };
            record = {
                sourceFile: file.sourceFile,
                testFile: key,
                framework: file.framework || 'jest',
                currentVersion: version,
                isNewFile: isActuallyNew,
                baseline: { exists: !isActuallyNew, content: file.originalContent || '', sha256: hashContent(file.originalContent || '') },
                versions: [v1]
            };
        } else {
            record.versions.forEach(item => { item.isActive = false; });
        }
        record.versions.push({ version, versionId: `${batchId}_${hashContent(key).slice(0, 12)}`, batchId, runId,
            type: 'APPLIED', status: 'APPLIED', verified: true, label: `Version ${version} (Applied)`,
            content: file.updatedContent, sha256: hashContent(file.updatedContent), createdAt: now, isActive: true, isNewFile: false });
        record.currentVersion = version;
        record.versions = record.versions.slice(-MAX_VERSIONS_PER_FILE);
        manifest.files[key] = record;
    }
    manifest.schemaVersion = 2;
    batch.fileVersions = Object.fromEntries(Object.entries(manifest.files).map(([key,record]) => [key,record.versions.find(item => item.isActive)?.versionId]).filter(([,id]) => id));
    manifest.activeBatchId = batchId;
    manifest.batches = [...(manifest.batches || []), batch];
    manifest.updatedAt = now;
    // Do not update the cache before the durable write succeeds.
    atomicWriteJsonSync(path.join(resolveActualPath(rootDir), VERSIONS_DIR_NAME, MANIFEST_FILE_NAME), manifest);
    snapshotVersionsCache.set(`${snapshotId}:${path.resolve(resolveActualPath(rootDir))}`, manifest);
    return batch;
}

export function persistVerifiedManifest({ snapshotId, rootDir, manifest }) {
    const actualRoot = resolveActualPath(rootDir);
    atomicWriteJsonSync(path.join(actualRoot,VERSIONS_DIR_NAME,MANIFEST_FILE_NAME),manifest);
    snapshotVersionsCache.set(`${snapshotId}:${path.resolve(actualRoot)}`,manifest);
}

/**
 * Retrieves unit test versions for a snapshot or a specific file.
 *
 * @param {Object} params
 * @param {string} params.snapshotId
 * @param {string} params.rootDir
 * @param {string} params.filePath
 * @returns {Object} All versions or specific file version record
 */
export function getUnitTestVersions({ snapshotId, rootDir, filePath = null }) {
    if (!snapshotId) return {};

    const manifest = loadManifest({ snapshotId, rootDir });
    if (!manifest || !manifest.files) {
        return filePath ? null : {};
    }

    if (!filePath) {
        return manifest.schemaVersion === 2 ? Object.fromEntries(Object.entries(manifest.files).map(([key,record]) => [key,{...record,activeBatchId:manifest.activeBatchId}])) : manifest.files;
    }

    const cleanPath = normalizePathKey(filePath);
    // Direct match by key
    if (manifest.files[cleanPath]) {
        return manifest.files[cleanPath];
    }

    // Fuzzy match by sourceFile, testFile, or path suffix
    for (const [key, record] of Object.entries(manifest.files)) {
        if (
            key === cleanPath ||
            record.sourceFile === cleanPath ||
            record.testFile === cleanPath ||
            key.endsWith(cleanPath) ||
            cleanPath.endsWith(key) ||
            (record.sourceFile && (cleanPath.endsWith(record.sourceFile) || record.sourceFile.endsWith(cleanPath))) ||
            (record.testFile && (cleanPath.endsWith(record.testFile) || record.testFile.endsWith(cleanPath)))
        ) {
            return record;
        }
    }

    return null;
}

// Readers take the same project guard as publication and recover an interrupted
// filesystem/DB commit before exposing an active pointer from the manifest.
export async function getCommittedUnitTestVersions({ snapshot, userId, filePath = null }) {
    const { withProjectGuard } = await import('./projectAccess.service.js');
    const { recoverProjectMutationMarkers } = await import('./projectMutationRecovery.service.js');
    const { projectEditableWorkspaceRoot } = await import('./projectFileVersion.service.js');
    return withProjectGuard({ projectId:snapshot.projectId,userId,capability:'project.read' }, async (tx,access) => {
        await recoverProjectMutationMarkers({tx,project:access.project,snapshot,root:projectEditableWorkspaceRoot(snapshot)});
        clearManifestCache(snapshot.id);
        return getUnitTestVersions({snapshotId:snapshot.id,rootDir:snapshot.rootDir,filePath});
    });
}

/**
 * Switches a unit test file (or all test files in snapshot) to a target version.
 * Restores file content on disk and triggers automated test execution.
 *
 * @param {Object} params
/**
 * Recursively deletes empty parent directories up to any of the specified stop directories.
 */
export function removeEmptyParentsRecursively(filePath, stopDirs = []) {
    let dir = path.dirname(filePath);
    const resolvedStopDirs = (stopDirs || [])
        .filter(Boolean)
        .map(s => path.resolve(s).toLowerCase());

    while (dir && path.dirname(dir) !== dir) {
        const resolvedDir = path.resolve(dir).toLowerCase();
        if (resolvedStopDirs.includes(resolvedDir)) {
            break;
        }
        if (fs.existsSync(dir)) {
            try {
                const remaining = fs.readdirSync(dir);
                if (remaining.length === 0) {
                    fs.rmdirSync(dir);
                    console.log(`[switchUnitTestVersion] Cleaned up empty directory: ${dir}`);
                    dir = path.dirname(dir);
                } else {
                    break;
                }
            } catch (_) {
                break;
            }
        } else {
            dir = path.dirname(dir);
        }
    }
}

/**
 * Switches the active unit test version for a file or all files in a snapshot.
 * When reverting to Version 1 (Baseline):
 * - If the file did not exist originally (isRevertingToNonExistent: true), deletes test file from disk
 * - If the file existed originally (isRevertingToNonExistent: false), restores original baseline content
 * - Auto-triggers a background RUN_TESTS job to recompute coverage from disk
 *
 * @param {Object} params
 * @param {string} params.snapshotId
 * @param {string} params.projectId
 * @param {string} params.userId
 * @param {string} params.filePath
 * @param {string} params.targetVersionId
 * @param {number} params.targetVersion
 * @param {boolean} params.allFiles
 * @param {string} params.targetVersionType
 * @param {boolean} params.runTests
 * @returns {Promise<Object>} Switch result and triggered background job
 */
export async function switchUnitTestVersion({
    snapshotId,
    projectId,
    userId,
    filePath = null,
    targetVersionId = null,
    targetVersion = null,
    allFiles = false,
    targetVersionType = null,
    runTests = true
}) {
    if (!snapshotId) {
        throw new ServiceError("snapshotId is required", 400);
    }

    // Resolve snapshot from database if rootDir or projectId is needed
    const snapshot = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        select: { id: true, projectId: true, rootDir: true, storagePath: true, source: true }
    });

    if (!snapshot) {
        throw new ServiceError("Project snapshot not found", 404);
    }

    const actualProjectId = projectId || snapshot.projectId;
    const actualRootDir = resolveActualPath(snapshot.rootDir);
    if (!actualRootDir) {
        throw new ServiceError("Project snapshot workspace root is unavailable", 409);
    }

    const resolvedWorkspace = snapshotWorkspaceRoot(snapshot);
    const workspaceRoot = resolveActualPath(resolvedWorkspace) || actualRootDir;

    const manifest = loadManifest({ snapshotId, rootDir: actualRootDir });
    if (!manifest || !manifest.files || Object.keys(manifest.files).length === 0) {
        throw new ServiceError("No unit test versions found for this snapshot", 404);
    }

    if (!filePath && !allFiles) {
        throw new ServiceError("Either filePath or allFiles: true is required", 400);
    }

    if (manifest.schemaVersion === 2) {
        const { switchVerifiedUnitTestBatch } = await import('./unitTestVersionRollback.service.js');
        return switchVerifiedUnitTestBatch({
            snapshot,
            projectId: actualProjectId,
            userId,
            filePath,
            targetVersionId,
            targetVersion,
            allFiles: Boolean(allFiles),
            targetVersionType,
            runTests: Boolean(runTests)
        });
    }

    // Determine target files to switch
    let filesToProcess = [];
    if (allFiles) {
        filesToProcess = Object.values(manifest.files);
    } else if (filePath) {
        const cleanPath = normalizePathKey(filePath);
        let foundRecord = manifest.files[cleanPath];
        if (!foundRecord) {
            for (const [key, record] of Object.entries(manifest.files)) {
                if (
                    key === cleanPath ||
                    record.sourceFile === cleanPath ||
                    record.testFile === cleanPath ||
                    key.endsWith(cleanPath) ||
                    cleanPath.endsWith(key) ||
                    (record.sourceFile && (cleanPath.endsWith(record.sourceFile) || record.sourceFile.endsWith(cleanPath))) ||
                    (record.testFile && (cleanPath.endsWith(record.testFile) || record.testFile.endsWith(cleanPath)))
                ) {
                    foundRecord = record;
                    break;
                }
            }
        }
        if (!foundRecord) {
            throw new ServiceError(`No version record found for file: ${filePath}`, 404);
        }
        filesToProcess = [foundRecord];
    } else {
        throw new ServiceError("Either filePath or allFiles: true is required", 400);
    }

    let switchedCount = 0;
    const switchedFiles = [];

    for (const fileRecord of filesToProcess) {
        const versions = fileRecord.versions || [];
        if (versions.length === 0) continue;

        let target = null;
        if (targetVersion != null) {
            target = versions.find(v => Number(v.version) === Number(targetVersion));
        } else if (targetVersionId) {
            target = versions.find(v => v.versionId === targetVersionId);
        } else if (targetVersionType) {
            target = versions.find(v => v.type === targetVersionType || v.status === targetVersionType);
        } else {
            // Toggle fallback: if currently on version > 1, go to v1; if at v1, go to highest version
            if (fileRecord.currentVersion > 1) {
                target = versions.find(v => v.version === 1);
            } else {
                target = versions[versions.length - 1];
            }
        }

        if (!target) {
            console.warn(`[switchUnitTestVersion] Target version not found for ${fileRecord.testFile}, skipping.`);
            continue;
        }

        // Check if target version represents a non-existent / empty baseline test file that should be removed from disk
        const isRevertingToNonExistent = (target.version === 1 || target.type === "ORIGINAL") &&
            (!target.content || target.content.trim().length === 0 || fileRecord.isNewFile || target.isNewFile);

        const cleanRel = fileRecord.testFile.replace(/\\/g, "/");
        const strippedRel = cleanRel.replace(/^(?:server|client|frontend|backend)\//, "");

        // Build all candidate paths across actualRootDir and workspaceRoot (monorepo & subpackage support)
        const candidatePaths = new Set();
        const addCandidate = (base, rel) => {
            if (!base || !rel) return;
            try {
                const resolved = path.resolve(base, rel);
                const relToBase = path.relative(base, resolved);
                if (!relToBase.startsWith("..") && !path.isAbsolute(relToBase)) {
                    candidatePaths.add(resolved);
                }
            } catch (_) {}
        };

        addCandidate(actualRootDir, cleanRel);
        addCandidate(actualRootDir, strippedRel);

        if (workspaceRoot && workspaceRoot !== actualRootDir) {
            addCandidate(workspaceRoot, cleanRel);
            addCandidate(workspaceRoot, strippedRel);
            ["server", "client", "frontend", "backend"].forEach(pkg => {
                addCandidate(path.join(workspaceRoot, pkg), strippedRel);
            });
        }

        if (isRevertingToNonExistent) {
            // Version 1 had no test file or was a newly created test file that didn't exist originally.
            // Completely unlink all matching candidate files on disk so they disappear from explorer and test suites.
            for (const cPath of candidatePaths) {
                if (fs.existsSync(cPath)) {
                    try {
                        fs.unlinkSync(cPath);
                        console.log(`[switchUnitTestVersion] Cleanly unlinked reverted test file: ${cPath}`);
                        removeEmptyParentsRecursively(cPath, [actualRootDir, workspaceRoot]);
                    } catch (unlinkErr) {
                        console.warn(`[switchUnitTestVersion] Warning removing test file ${cPath}:`, unlinkErr.message);
                    }
                }
            }
        } else {
            // Write target version content to disk
            // When restoring pre-existing baseline test files, locate existing file among candidate paths across actualRootDir and workspaceRoot, ensuring correct path writing in monorepos.
            let targetDiskPath = null;
            for (const cPath of candidatePaths) {
                if (fs.existsSync(cPath)) {
                    targetDiskPath = cPath;
                    break;
                }
            }
            if (!targetDiskPath) {
                targetDiskPath = path.resolve(actualRootDir, cleanRel);
            }

            const allowedRoots = [actualRootDir, workspaceRoot].filter(Boolean);
            const isSafe = allowedRoots.some(base => {
                const rel = path.relative(base, targetDiskPath);
                return !rel.startsWith("..") && !path.isAbsolute(rel);
            });
            if (!isSafe) {
                throw new ServiceError(`Path escapes workspace root: ${fileRecord.testFile}`, 400);
            }

            const parentDir = path.dirname(targetDiskPath);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }
            fs.writeFileSync(targetDiskPath, target.content || "", "utf8");
        }

        // Update active flags
        versions.forEach(v => {
            v.isActive = (v.version === target.version);
        });
        fileRecord.currentVersion = target.version;
        switchedCount++;
        switchedFiles.push({
            testFile: fileRecord.testFile,
            sourceFile: fileRecord.sourceFile,
            switchedToVersion: target.version,
            label: target.label
        });
    }

    manifest.updatedAt = new Date().toISOString();
    persistManifest({ snapshotId, rootDir: actualRootDir, manifest });

    // Auto-trigger background test runner to recalculate coverage
    let backgroundJob = null;
    if (runTests && actualProjectId) {
        try {
            const { createRunTestsJob } = await import("./job.service.js");
            const { addJobToQueue } = await import("./queue.service.js");
            const runJob = await createRunTestsJob({
                projectId: actualProjectId,
                snapshotId: snapshot.id,
                userId
            });
            await addJobToQueue("RUN_TESTS", runJob.id);
            backgroundJob = { id: runJob.id, type: "RUN_TESTS", status: "QUEUED" };
            console.log(`[switchUnitTestVersion] Auto-triggered background RUN_TESTS job ${runJob.id} after switching ${switchedCount} file(s).`);
        } catch (jobErr) {
            console.warn("[switchUnitTestVersion] Warning auto-triggering background RUN_TESTS job:", jobErr.message);
        }
    }

    return {
        success: true,
        switchedCount,
        files: switchedFiles,
        targetVersion: targetVersion != null ? Number(targetVersion) : null,
        backgroundJob
    };
}
