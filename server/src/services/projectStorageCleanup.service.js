import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getBucket } from "../config/firebase.js";
import { ServiceError } from "../utils/serviceError.js";
import { clearManifestCache } from "./unitTestVersion.service.js";

const execFileAsync = promisify(execFile);
const validId = value => typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
const CLOUD_CLEANUP_TIMEOUT_MS = 12000;
const STORAGE_CLEANUP_TIMEOUT_MS = 60000;
const TRASH_DIR_NAME = ".trash";

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error(`${label} timed out after ${ms}ms`);
                err.code = "ETIMEDOUT";
                reject(err);
            }, ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

// Build deletion targets from owned database IDs, never from a stored rootDir.
// rootDir can point to only backend/ inside an uploaded monorepo, or be stale.
export function projectStorageTargets(projectId, snapshots, baseDir = process.cwd(), evaluationIds = [], operationIds = []) {
    if (!validId(projectId) || snapshots.some(snapshot => !validId(snapshot.id)) || evaluationIds.some(id => !validId(id)) || operationIds.some(id => !validId(id))) {
        throw new Error("Invalid project or snapshot ID in cleanup plan");
    }
    return [...new Set([
        path.resolve(baseDir, "storage", "projects", projectId),
        ...snapshots.map(snapshot => path.resolve(baseDir, "uploads", "snapshots", snapshot.id)),
        ...evaluationIds.map(id => path.resolve(baseDir, ".covai-temp", "chatbot-evaluations", id)),
        ...operationIds.map(id => path.resolve(baseDir, ".covai-temp", "collaboration-operations", id)),
    ])];
}

async function verifyTarget(baseDir, target) {
    const relative = path.relative(baseDir, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Deletion target is outside the workspace: ${target}`);
    }
    // Reject symlink/junction ancestors so a directory name cannot redirect rm
    // into another project's files. rm does not follow links inside the target.
    let current = baseDir;
    for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        try {
            const stat = await fs.lstat(current);
            if (stat.isSymbolicLink()) throw new Error(`Cleanup path contains a symbolic link: ${current}`);
        } catch (error) {
            if (error.code === "ENOENT") return;
            throw error;
        }
    }
}

async function resetReadOnlyAttributes(dirPath) {
    try {
        const stat = await fs.lstat(dirPath);
        if (stat.isDirectory()) {
            await fs.chmod(dirPath, 0o777).catch(() => {});
            const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
            const BATCH_SIZE = 128;
            for (let i = 0; i < entries.length; i += BATCH_SIZE) {
                await Promise.all(
                    entries.slice(i, i + BATCH_SIZE).map((entry) =>
                        resetReadOnlyAttributes(path.join(dirPath, entry.name)),
                    ),
                );
            }
        } else {
            await fs.chmod(dirPath, 0o666).catch(() => {});
        }
    } catch (_) { }
}

async function clearWindowsReadOnlyFlags(target) {
    if (process.platform !== "win32") return false;
    try {
        // Clear read-only flags on the directory itself and recursively on all nested files/subdirs
        await execFileAsync("attrib", ["-R", path.join(target, "*"), "/S", "/D"], {
            windowsHide: true,
            timeout: 8000,
        });
        return true;
    } catch (_) {
        // Fallback to Node recursive chmod below
        return false;
    }
}

async function forceRemoveDirectory(target) {
    const rmOpts = { recursive: true, force: true, maxRetries: 2, retryDelay: 100 };
    try {
        await fs.rm(target, rmOpts);
    } catch (err) {
        if (err.code === "ENOENT") return;
        if (
            err.code === "EPERM" ||
            err.code === "EACCES" ||
            err.code === "EBUSY" ||
            err.code === "ENOTEMPTY"
        ) {
            const clearedViaAttrib = await clearWindowsReadOnlyFlags(target);
            if (clearedViaAttrib) {
                try {
                    await fs.rm(target, rmOpts);
                    return;
                } catch (retryErr) {
                    if (retryErr.code === "ENOENT") return;
                }
            }
            await resetReadOnlyAttributes(target);
            await fs.rm(target, rmOpts);
            return;
        }
        throw err;
    }
}

async function removeDirectoryFast(target, { stageRoot = null, bestEffort = false } = {}) {
    let stat;
    try {
        stat = await fs.lstat(target);
    } catch (err) {
        if (err.code === "ENOENT") return;
        throw err;
    }

    // In runtime (non-test), rename directories into an isolated trash folder in O(1)
    // and purge them asynchronously so large node_modules trees never stall the delete request.
    if (stageRoot && process.env.NODE_ENV !== "test" && stat.isDirectory()) {
        const stagedTarget = path.join(stageRoot, `${Date.now()}-${randomUUID()}`);
        try {
            await fs.mkdir(stageRoot, { recursive: true });
            await fs.rename(target, stagedTarget);
            void forceRemoveDirectory(stagedTarget).catch((err) => {
                console.warn(`[DeleteProject] Background trash purge warning for ${stagedTarget}:`, err?.message || err);
            });
            return;
        } catch (err) {
            if (err.code === "ENOENT") return;
            if (process.platform === "win32" && (err.code === "EPERM" || err.code === "EACCES" || err.code === "EBUSY")) {
                await clearWindowsReadOnlyFlags(target);
                await new Promise((resolve) => setTimeout(resolve, 120));
                try {
                    await fs.rename(target, stagedTarget);
                    void forceRemoveDirectory(stagedTarget).catch((bgErr) => {
                        console.warn(`[DeleteProject] Background trash purge warning for ${stagedTarget}:`, bgErr?.message || bgErr);
                    });
                    return;
                } catch (_) {
                    // Fall through to direct removal for accurate error reporting or fallback
                }
            }
        }
    }

    try {
        await forceRemoveDirectory(target);
    } catch (err) {
        if (bestEffort && (err.code === "EPERM" || err.code === "EACCES" || err.code === "EBUSY" || err.code === "ENOTEMPTY")) {
            console.warn(`[DeleteProject] Skipping busy shared directory ${target}:`, err.message);
            return;
        }
        throw err;
    }
}

async function deleteCloudFiles(projectId) {
    const bucket = getBucket();
    if (!bucket) throw new Error("Cloud storage is unavailable");
    const prefix = `projects/${projectId}/`;
    const [files] = await withTimeout(
        bucket.getFiles({ prefix }),
        CLOUD_CLEANUP_TIMEOUT_MS,
        "Cloud storage listFiles",
    );
    // storagePath can be a local GitHub clone path; do not send it to Firebase.
    if (files.some(file => typeof file.name !== "string" || !file.name.startsWith(prefix))) {
        throw new Error("Cloud cleanup returned a file outside the project's prefix");
    }
    const results = await withTimeout(
        Promise.allSettled(files.map(async file => {
            try {
                await file.delete({ ignoreNotFound: true });
            } catch (error) {
                if (Number(error.code) !== 404) throw error;
            }
        })),
        CLOUD_CLEANUP_TIMEOUT_MS,
        "Cloud storage deleteFiles",
    );
    const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, "Some cloud files could not be deleted");
}

async function resolveProjectOperationIds(projectId, snapshots, explicitOperationIds) {
    if (Array.isArray(explicitOperationIds)) {
        return explicitOperationIds;
    }
    try {
        const prismaModule = await import("../config/prisma.js");
        const db = prismaModule.default || prismaModule;
        if (typeof db?.projectOperation?.findMany === "function") {
            const ops = await db.projectOperation.findMany({
                where: {
                    OR: [
                        { projectId },
                        ...(snapshots.length > 0 ? [{ snapshotId: { in: snapshots.map(s => s.id) } }] : [])
                    ]
                },
                select: { id: true }
            }).catch(() => []);
            return ops.map(o => o.id).filter(validId);
        }
    } catch (_) { }
    return [];
}

/** Await every deletion. The caller must keep database metadata if this fails. */
export async function cleanupProjectStorageAsync(projectId, snapshots = [], { baseDir = process.cwd(), evaluationIds = [], operationIds } = {}) {
    try {
        const canonicalBase = await fs.realpath(baseDir);

        // 1. Invalidate in-memory manifest cache for all project snapshots
        for (const snapshot of snapshots) {
            if (snapshot?.id) {
                try {
                    clearManifestCache(snapshot.id);
                } catch (_) { }
            }
        }

        const initialOperationIds = Array.isArray(operationIds) ? operationIds : [];
        const baseTargets = projectStorageTargets(projectId, snapshots, canonicalBase, evaluationIds, initialOperationIds);

        // Include .covai-system-test if present
        const systemTestDir = path.resolve(canonicalBase, ".covai-system-test");
        let hasSystemTestDir = false;
        try {
            const stStat = await fs.stat(systemTestDir);
            if (stStat.isDirectory()) {
                baseTargets.push(systemTestDir);
                hasSystemTestDir = true;
            }
        } catch (_) { }

        const uniqueBaseTargets = [...new Set(baseTargets)];

        // Validate base targets BEFORE any cloud or local deletion runs.
        await Promise.all(uniqueBaseTargets.map(target => verifyTarget(canonicalBase, target)));

        const stageRoot = path.resolve(canonicalBase, ".covai-temp", TRASH_DIR_NAME);

        // Overlap DB operation lookup + cloud cleanup + base target removal
        const cloudCleanupPromise = deleteCloudFiles(projectId);
        const operationsCleanupPromise = (async () => {
            if (Array.isArray(operationIds)) return;
            const resolvedOpIds = await resolveProjectOperationIds(projectId, snapshots, operationIds);
            if (resolvedOpIds.length === 0) return;

            const opTargets = resolvedOpIds.map(id =>
                path.resolve(canonicalBase, ".covai-temp", "collaboration-operations", id),
            );
            const collabOpsDir = path.resolve(canonicalBase, ".covai-temp", "collaboration-operations");
            try {
                const entries = await fs.readdir(collabOpsDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory() && validId(entry.name) && resolvedOpIds.includes(entry.name)) {
                        opTargets.push(path.join(collabOpsDir, entry.name));
                    }
                }
            } catch (_) { }

            const uniqueOpTargets = [...new Set(opTargets)];
            await Promise.all(uniqueOpTargets.map(target => verifyTarget(canonicalBase, target)));
            await Promise.all(uniqueOpTargets.map(async target => {
                await verifyTarget(canonicalBase, target);
                await removeDirectoryFast(target, { stageRoot });
            }));
        })();

        const results = await withTimeout(
            Promise.allSettled([
                cloudCleanupPromise,
                operationsCleanupPromise,
                ...uniqueBaseTargets.map(async target => {
                    await verifyTarget(canonicalBase, target);
                    await removeDirectoryFast(target, {
                        stageRoot,
                        bestEffort: hasSystemTestDir && target === systemTestDir && process.env.NODE_ENV !== "test",
                    });
                }),
            ]),
            STORAGE_CLEANUP_TIMEOUT_MS,
            "Project storage cleanup",
        );
        const failures = results.flatMap((result, index) => result.status === "rejected"
            ? [{ location: index === 0 ? "Firebase" : index === 1 ? "CollaborationOperations" : uniqueBaseTargets[index - 2], error: result.reason }]
            : []);
        if (failures.length) {
            for (const failure of failures) console.error(`[DeleteProject] Cleanup failed for ${failure.location}:`, failure.error);
            throw new Error("Storage cleanup incomplete");
        }
    } catch (error) {
        console.error(`[DeleteProject] Project ${projectId} remains available for deletion retry:`, error);
        const failure = new ServiceError("Project deletion is incomplete: some stored files could not be removed. Please retry deleting the project.", 503);
        failure.code = "PROJECT_CLEANUP_FAILED";
        throw failure;
    }
}
