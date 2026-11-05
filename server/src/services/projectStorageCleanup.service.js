import fs from "node:fs/promises";
import path from "node:path";
import { getBucket } from "../config/firebase.js";
import { ServiceError } from "../utils/serviceError.js";
import { clearManifestCache } from "./unitTestVersion.service.js";

const validId = value => typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);

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
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                await resetReadOnlyAttributes(fullPath);
            }
        } else {
            await fs.chmod(dirPath, 0o666).catch(() => {});
        }
    } catch (_) { }
}

async function forceRemoveDirectory(target) {
    try {
        await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (err) {
        if (err.code === "ENOENT") return;
        if (err.code === "EPERM" || err.code === "EACCES") {
            try {
                await resetReadOnlyAttributes(target);
                await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
                return;
            } catch (_) { }
        }
        throw err;
    }
}

async function deleteCloudFiles(projectId) {
    const bucket = getBucket();
    if (!bucket) throw new Error("Cloud storage is unavailable");
    const prefix = `projects/${projectId}/`;
    const [files] = await bucket.getFiles({ prefix });
    // storagePath can be a local GitHub clone path; do not send it to Firebase.
    if (files.some(file => typeof file.name !== "string" || !file.name.startsWith(prefix))) {
        throw new Error("Cloud cleanup returned a file outside the project's prefix");
    }
    const results = await Promise.allSettled(files.map(async file => {
        try {
            await file.delete({ ignoreNotFound: true });
        } catch (error) {
            if (Number(error.code) !== 404) throw error;
        }
    }));
    const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, "Some cloud files could not be deleted");
}

/** Await every deletion. The caller must keep database metadata if this fails. */
export async function cleanupProjectStorageAsync(projectId, snapshots = [], { baseDir = process.cwd(), evaluationIds = [], operationIds = [] } = {}) {
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

        // 2. Query Prisma for any additional project operations or evaluation runs if available
        let effectiveOperationIds = [...operationIds];
        if (effectiveOperationIds.length === 0) {
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
                    effectiveOperationIds = ops.map(o => o.id).filter(validId);
                }
            } catch (_) { }
        }

        const targets = projectStorageTargets(projectId, snapshots, canonicalBase, evaluationIds, effectiveOperationIds);

        // 3. Include .covai-system-test if present
        const systemTestDir = path.resolve(canonicalBase, ".covai-system-test");
        try {
            const stStat = await fs.stat(systemTestDir);
            if (stStat.isDirectory()) {
                targets.push(systemTestDir);
            }
        } catch (_) { }

        // 4. Also scan .covai-temp/collaboration-operations for matching operation folders
        const collabOpsDir = path.resolve(canonicalBase, ".covai-temp", "collaboration-operations");
        try {
            const entries = await fs.readdir(collabOpsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && validId(entry.name)) {
                    if (effectiveOperationIds.includes(entry.name)) {
                        targets.push(path.join(collabOpsDir, entry.name));
                    }
                }
            }
        } catch (_) { }

        const uniqueTargets = [...new Set(targets)];

        // Validate the entire plan before deleting any local or cloud data.
        await Promise.all(uniqueTargets.map(target => verifyTarget(canonicalBase, target)));

        const results = await Promise.allSettled([
            deleteCloudFiles(projectId),
            ...uniqueTargets.map(async target => {
                await verifyTarget(canonicalBase, target);
                await forceRemoveDirectory(target);
            }),
        ]);
        const failures = results.flatMap((result, index) => result.status === "rejected"
            ? [{ location: index === 0 ? "Firebase" : uniqueTargets[index - 1], error: result.reason }]
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
