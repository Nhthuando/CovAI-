import fs from "node:fs/promises";
import path from "node:path";
import { getBucket } from "../config/firebase.js";
import { ServiceError } from "../utils/serviceError.js";

const validId = value => typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);

// Build deletion targets from owned database IDs, never from a stored rootDir.
// rootDir can point to only backend/ inside an uploaded monorepo, or be stale.
export function projectStorageTargets(projectId, snapshots, baseDir = process.cwd()) {
    if (!validId(projectId) || snapshots.some(snapshot => !validId(snapshot.id))) {
        throw new Error("Invalid project or snapshot ID in cleanup plan");
    }
    return [...new Set([
        path.resolve(baseDir, "storage", "projects", projectId),
        ...snapshots.map(snapshot => path.resolve(baseDir, "uploads", "snapshots", snapshot.id)),
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
export async function cleanupProjectStorageAsync(projectId, snapshots = [], { baseDir = process.cwd() } = {}) {
    try {
        const canonicalBase = await fs.realpath(baseDir);
        const targets = projectStorageTargets(projectId, snapshots, canonicalBase);
        // Validate the entire plan before deleting any local or cloud data.
        await Promise.all(targets.map(target => verifyTarget(canonicalBase, target)));
        const results = await Promise.allSettled([
            deleteCloudFiles(projectId),
            ...targets.map(async target => {
                await verifyTarget(canonicalBase, target);
                await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            }),
        ]);
        const failures = results.flatMap((result, index) => result.status === "rejected"
            ? [{ location: index === 0 ? "Firebase" : targets[index - 1], error: result.reason }]
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
