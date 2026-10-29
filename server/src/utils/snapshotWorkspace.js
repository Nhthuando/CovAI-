import fs from "fs";
import path from "path";
import { ServiceError } from "./serviceError.js";

export const inside = (root, target) => {
    const relative = path.relative(root, target);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

/**
 * Normalizes absolute or container-bound paths (e.g. /app/uploads/... stored in DB from Docker
 * running on host, or host absolute paths running in Docker) to current runtime environment.
 */
export const normalizeDiskPath = (rawPath) => {
    if (!rawPath || typeof rawPath !== "string") return null;
    const resolved = path.resolve(rawPath);
    if (fs.existsSync(resolved)) return resolved;

    const normalized = rawPath.replace(/\\/g, "/");
    // Match standard CovAI storage/upload paths
    const match = normalized.match(/(?:^|\/)((?:uploads\/snapshots|storage\/projects)\/[^/]+.*)$/);
    if (match) {
        const candidate = path.resolve(process.cwd(), match[1]);
        if (fs.existsSync(candidate)) return candidate;
    }
    return resolved;
};

// rootDir remains the package used by analysis runners. The workspace root
// is the full repository / project tree (including client, server, configs, etc.).
export const snapshotWorkspaceRoot = (snapshot) => {
    if (!snapshot?.rootDir) return null;
    const analysisRoot = normalizeDiskPath(snapshot.rootDir);
    if (!analysisRoot) return null;

    // 1. If Git or Checkpoint snapshot with a valid local storagePath directory containing analysisRoot
    if (snapshot.source !== "ZIP" && snapshot.storagePath) {
        const candidateStorage = normalizeDiskPath(snapshot.storagePath);
        try {
            if (candidateStorage && fs.existsSync(candidateStorage) && fs.statSync(candidateStorage).isDirectory()) {
                if (inside(candidateStorage, analysisRoot) && inside(fs.realpathSync(candidateStorage), fs.realpathSync(analysisRoot))) {
                    return candidateStorage;
                }
            }
        } catch (_) { /* Overwritten or remote cloud storage paths fall through */ }
    }

    const normAnalysisRoot = analysisRoot.replace(/\\/g, "/");

    // 2. If GITHUB clone, locate cloned 'repo' directory (even if storagePath was overwritten by coverage)
    const githubMatch = normAnalysisRoot.match(/(.*\/storage\/projects\/[^/]+\/github\/[^/]+\/repo)(?:\/|$)/);
    if (githubMatch) {
        const repoDir = path.resolve(githubMatch[1]);
        if (fs.existsSync(repoDir) && inside(repoDir, analysisRoot)) {
            return repoDir;
        }
    }

    // 3. If ZIP snapshot, locate extracted project directory in uploads/snapshots/<snapshotId>
    const snapMatch = normAnalysisRoot.match(/(.*\/uploads\/snapshots\/[^/]+)(?:\/|$)/);
    if (snapMatch) {
        const snapDir = path.resolve(snapMatch[1]);
        if (fs.existsSync(snapDir)) {
            try {
                const entries = fs.readdirSync(snapDir, { withFileTypes: true })
                    .filter((e) => e.name !== "__MACOSX" && e.name !== ".DS_Store");
                // If extracted archive has a single root wrapper directory (e.g. repo-main/):
                if (entries.length === 1 && entries[0].isDirectory()) {
                    const wrapper = path.join(snapDir, entries[0].name);
                    if (inside(wrapper, analysisRoot)) {
                        return wrapper;
                    }
                }
                if (inside(snapDir, analysisRoot)) {
                    return snapDir;
                }
            } catch (_) {}
        }
    }

    return analysisRoot;
};

export const resolveSnapshotFile = (snapshot, filePath) => {
    if (typeof filePath !== "string" || !filePath.trim() || path.isAbsolute(filePath)
        || filePath.split(/[\\/]/).includes("..")) throw new ServiceError("Invalid file path", 400);
    const workspace = snapshotWorkspaceRoot(snapshot);
    if (!workspace) throw new ServiceError("Workspace not available", 404);
    let candidate = path.resolve(workspace, filePath);
    // Saved analysis links from before workspace paths were introduced are
    // relative to the analysis package (for example db.js).
    if (!fs.existsSync(candidate) && snapshot.rootDir) {
        const analysisRoot = normalizeDiskPath(snapshot.rootDir);
        if (analysisRoot) {
            const fallbackCandidate = path.resolve(analysisRoot, filePath);
            if (fs.existsSync(fallbackCandidate)) candidate = fallbackCandidate;
        }
    }
    if (!inside(workspace, candidate)) throw new ServiceError("Invalid file path", 400);
    if (fs.existsSync(candidate) && !inside(fs.realpathSync(workspace), fs.realpathSync(candidate)))
        throw new ServiceError("Invalid file path", 400);
    return candidate;
};
