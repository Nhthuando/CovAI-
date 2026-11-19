import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ServiceError } from "./serviceError.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRootDir = path.resolve(__dirname, "../../");

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

    // Normalize forward slashes and strip any Windows drive letter prefix (e.g. D:\, C:/)
    const normalized = rawPath.replace(/\\/g, "/");
    const strippedDrive = normalized.replace(/^[a-zA-Z]:(?:\/|$)/, "/");

    // On Linux/Docker, always use strippedDrive to prevent any Windows drive letter leak
    const effectivePath = process.platform !== "win32" ? strippedDrive : rawPath;

    // Direct check if effectivePath or strippedDrive already exists on this machine
    if (fs.existsSync(effectivePath)) return path.resolve(effectivePath);
    if (fs.existsSync(strippedDrive)) return path.resolve(strippedDrive);

    // Match standard CovAI storage/upload paths
    const match = strippedDrive.match(/(?:^|\/)((?:uploads\/snapshots|storage\/projects)\/[^/]+.*)$/);
    if (match) {
        // Priority 1: Check relative to server root directory (always accurate regardless of cwd)
        const serverCandidate = path.resolve(serverRootDir, match[1]);
        if (fs.existsSync(serverCandidate)) return serverCandidate;

        // Priority 2: Check repo root (parent of server/)
        const repoCandidate = path.resolve(serverRootDir, "..", match[1]);
        if (fs.existsSync(repoCandidate)) return repoCandidate;

        // Priority 3: Check process.cwd()
        const cwdCandidate = path.resolve(process.cwd(), match[1]);
        if (fs.existsSync(cwdCandidate)) return cwdCandidate;

        const cwdServerCandidate = path.resolve(process.cwd(), "server", match[1]);
        if (fs.existsSync(cwdServerCandidate)) return cwdServerCandidate;

        const parentCandidate = path.resolve(process.cwd(), "..", match[1]);
        if (fs.existsSync(parentCandidate)) return parentCandidate;

        // Priority 4: Check /app candidate (in Docker)
        if (process.platform !== "win32") {
            const appCandidate = path.posix.resolve("/app", match[1]);
            if (fs.existsSync(appCandidate)) return appCandidate;
            return appCandidate;
        }

        // On Windows fallback to serverCandidate
        return serverCandidate;
    }

    // Clean up phantom /app/... paths regardless of OS platform
    if (/^\/?app\//i.test(strippedDrive)) {
        const withoutApp = strippedDrive.replace(/^\/?app\//i, "");
        if (process.platform !== "win32") {
            const appFallback = path.posix.resolve("/app", withoutApp);
            if (fs.existsSync(appFallback)) return appFallback;
            return appFallback;
        }
        const fallback = path.resolve(serverRootDir, withoutApp);
        if (fs.existsSync(fallback)) return fallback;
        return fallback;
    }

    // If platform is not Windows and path had a drive letter, never return raw Windows path on Linux
    if (process.platform !== "win32") {
        return path.resolve(strippedDrive);
    }

    // On Windows, if path is rooted without drive letter (e.g. /app or /something), resolve from serverRootDir
    if (rawPath.startsWith("/") || rawPath.startsWith("\\")) {
        const clean = strippedDrive.replace(/^\/+/, "");
        return path.resolve(serverRootDir, clean);
    }

    return path.resolve(rawPath);
};

export const resolveSnapshotRootDir = normalizeDiskPath;

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
                if (inside(candidateStorage, analysisRoot)) {
                    let realStorage = candidateStorage;
                    let realAnalysis = analysisRoot;
                    try { realStorage = fs.realpathSync(candidateStorage); } catch (_) {}
                    try { realAnalysis = fs.realpathSync(analysisRoot); } catch (_) {}
                    if (inside(realStorage, realAnalysis)) {
                        return candidateStorage;
                    }
                }
            }
        } catch (_) { /* Overwritten or remote cloud storage paths fall through */ }
    }

    const normAnalysisRoot = analysisRoot.replace(/\\/g, "/");

    // 2. If GITHUB clone, locate cloned 'repo' directory (even if storagePath was overwritten by coverage)
    const githubMatch = normAnalysisRoot.match(/(.*\/storage\/projects\/[^/]+\/github\/[^/]+\/repo)(?:\/|$)/);
    if (githubMatch) {
        const repoDir = normalizeDiskPath(githubMatch[1]) || path.resolve(githubMatch[1]);
        if (repoDir && fs.existsSync(repoDir) && inside(repoDir, analysisRoot)) {
            return repoDir;
        }
    }

    // 3. If ZIP snapshot, locate extracted project directory in uploads/snapshots/<snapshotId>
    const snapMatch = normAnalysisRoot.match(/(.*\/uploads\/snapshots\/[^/]+)(?:\/|$)/);
    if (snapMatch) {
        const snapDir = normalizeDiskPath(snapMatch[1]) || path.resolve(snapMatch[1]);
        if (snapDir && fs.existsSync(snapDir)) {
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
