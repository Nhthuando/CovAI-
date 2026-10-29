import fs from "node:fs/promises";
import { withProjectGuard } from "./projectAccess.service.js";
import { findEditableSnapshot, resolveContainedProjectPath, hashFileContent, fileVersion, MAX_PROJECT_FILE_BYTES } from "./projectFileVersion.service.js";
import { ServiceError } from "../utils/serviceError.js";

// Capture BEFORE the model is called. The model never supplies trusted versions.
export const captureProjectProposalBase = ({ projectId, snapshotId, userId, path }) =>
    withProjectGuard({ projectId, userId, capability: "ai.use" }, async (tx, access) => {
        const snapshot = await findEditableSnapshot(tx, projectId, snapshotId);
        const resolved = await resolveContainedProjectPath(snapshot, path);
        const { recoverProjectMutationMarkers } = await import("./projectMutationRecovery.service.js");
        await recoverProjectMutationMarkers({ tx, project: access.project, snapshot, root: resolved.root });
        const stat = await fs.stat(resolved.target).catch(error => { if (error.code === "ENOENT") return null; throw error; });
        const identity = { snapshotId: snapshot.id, workspaceRevision: access.project.workspaceRevision };
        if (!stat) return { ...identity, baseVersion: null, isExisting: false, existingContent: "" };
        if (!stat.isFile() || stat.size > MAX_PROJECT_FILE_BYTES) throw new ServiceError("Proposal target must be a text file no larger than 1 MiB", 413);
        const existingContent = await fs.readFile(resolved.target, "utf8");
        const sha256 = hashFileContent(existingContent);
        const row = await tx.projectFileVersion.upsert({
            where: { snapshotId_relativePath: { snapshotId: snapshot.id, relativePath: resolved.relativePath } },
            create: { snapshotId: snapshot.id, relativePath: resolved.relativePath, revision: 0, sha256, deleted: false },
            update: {},
        });
        if (row.deleted || row.sha256 !== sha256) throw Object.assign(new ServiceError("Proposal target changed outside its versioned workspace; reload the file first", 409), { code: "FILE_VERSION_CONFLICT" });
        return { ...identity, baseVersion: fileVersion(row), isExisting: true, existingContent };
    });
