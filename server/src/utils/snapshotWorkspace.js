import fs from "fs";
import path from "path";
import { ServiceError } from "./serviceError.js";

const inside = (root, target) => {
    const relative = path.relative(root, target);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

// rootDir remains the package used by analysis runners. Git snapshots also
// retain the complete cloned repository in storagePath.
export const snapshotWorkspaceRoot = (snapshot) => {
    if (!snapshot?.rootDir) return null;
    const analysisRoot = path.resolve(snapshot.rootDir);
    if (snapshot.source !== "GITHUB" || !snapshot.storagePath) return analysisRoot;
    const workspace = path.resolve(snapshot.storagePath);
    try {
        if (fs.statSync(workspace).isDirectory() && inside(workspace, analysisRoot)
            && inside(fs.realpathSync(workspace), fs.realpathSync(analysisRoot))) return workspace;
    } catch { /* Older snapshots may no longer have their clone directory. */ }
    return analysisRoot;
};

export const resolveSnapshotFile = (snapshot, filePath) => {
    if (typeof filePath !== "string" || !filePath.trim() || path.isAbsolute(filePath)
        || filePath.split(/[\\/]/).includes("..")) throw new ServiceError("Invalid file path", 400);
    const workspace = snapshotWorkspaceRoot(snapshot);
    let candidate = path.resolve(workspace, filePath);
    // Saved analysis links from before workspace paths were introduced are
    // relative to the analysis package (for example db.js).
    if (!fs.existsSync(candidate)) candidate = path.resolve(snapshot.rootDir, filePath);
    if (!inside(workspace, candidate)) throw new ServiceError("Invalid file path", 400);
    if (fs.existsSync(candidate) && !inside(fs.realpathSync(workspace), fs.realpathSync(candidate)))
        throw new ServiceError("Invalid file path", 400);
    return candidate;
};
