import { ServiceError } from "../utils/serviceError.js";
import { discoverSnapshotSourceFiles } from "./fileDiscovery.service.js";
import { resolveOwnedProjectSnapshot } from "./projectScope.service.js";

/**
 * The only file-list seam exposed to HTTP consumers. Callers select a project
 * snapshot; they never provide or receive a host filesystem path.
 */
export const listOwnedSnapshotSourceFiles = async ({ projectId, snapshotId, userId }) => {
    const { snapshot } = await resolveOwnedProjectSnapshot({ projectId, snapshotId, userId, requireRoot: true });
    const discovery = discoverSnapshotSourceFiles(snapshot.rootDir);
    return {
        snapshotId: snapshot.id,
        files: discovery.files.map(({ relativePath }) => relativePath),
        diagnostics: discovery.diagnostics,
    };
};

export const rejectLegacyRootDir = (query) => {
    if (query?.rootDir !== undefined) {
        throw new ServiceError("rootDir is not accepted; provide projectId and optional snapshotId", 400);
    }
};
