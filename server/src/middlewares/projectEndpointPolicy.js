import prisma from "../config/prisma.js";
import { resolveProjectAccess, resolveSnapshotAccess } from "../services/projectAccess.service.js";
import { ServiceError } from "../utils/serviceError.js";

const readMethods = new Set(["GET", "HEAD"]);
const segment = value => {
    try { return decodeURIComponent(value || ""); }
    catch { throw new ServiceError("Invalid resource path", 400); }
};

// This is the HTTP capability boundary, independent of controller implementations.
// Services still resolve resource ancestry and recheck final mutation authority.
export const projectEndpointRule = (family, method, path, input = {}) => {
    const parts = path.split("/").filter(Boolean).map(segment);
    const read = readMethods.has(method);
    let projectId = input.projectId;
    let snapshotId = input.snapshotId;
    let capability = read ? "project.read" : "tests.run";
    if (family === "projects") {
        if (!parts.length || parts[0] === "validate-archive") return null;
        projectId = parts[0];
        if (parts[1] === "snapshots" && parts[2]) snapshotId = parts[2];
        if (parts[1] === "export") capability = "project.export";
        if (!read) {
            if (parts.length === 1 && method === "DELETE") capability = "project.delete";
            else if (/\/restore$/.test(path)) capability = "snapshot.restore";
            else if (["upload-zip", "import-github", "snapshots"].includes(parts[1])) capability = "integrations.write";
            else if (["file-content", "files", "folders", "entries"].includes(parts[1])) capability = "files.write";
            else if (parts[1] === "ai-context") capability = parts[2] === "preview" ? "project.read" : method === "DELETE" && parts.length === 3 ? "chat.delete" : "memory.write";
            else if (parts[1] === "chat") capability = method === "DELETE" ? "chat.delete" : "chat.write";
            else if (/ai-|\/ai\//.test(path)) capability = "ai.use";
        }
    } else if (family === "coverage") {
        snapshotId = parts[0];
        if (!read && /\/(approve|confirm|confirm-expected|review)(?:\/|$)/.test(path)) capability = "evidence.approve";
        else if (!read && /\/(apply|apply-suggestion|save-ai-test|materialize)(?:\/|$)/.test(path)) capability = "files.write";
        else if (!read && /generate|suggest|optimize|regenerate|improvements/.test(path)) capability = "ai.use";
        else if (method === "PUT" || method === "PATCH" || method === "DELETE") capability = "files.write";
    } else if (family === "code-hygiene") {
        if (parts[0] === "snapshot") snapshotId = parts[1];
        else if (parts[0] === "project") projectId = parts[1];
    } else if (family === "reports") {
        projectId = parts[1];
        capability = "project.export";
    } else if (family === "cyclomatic") {
        if (parts[0] && parts[0] !== "calculate") snapshotId = parts[0];
    } else if (family === "ai-tests" || family === "ai-suggestions") {
        if (family === "ai-suggestions" && parts[0] === "refresh") projectId = parts[1];
        capability = read ? "project.read" : "ai.use";
    } else if (family === "git") capability = read ? "project.read" : "integrations.write";
    else if (family === "github") { projectId = parts[1]; capability = "integrations.write"; }
    else if (family === "pipeline") { projectId = parts[0]; capability = "tests.run"; }
    else if (family === "upload") capability = "integrations.write";
    else if (family === "files") capability = read ? "project.read" : "files.write";
    else if (family === "file-manager") {
        if (input.rootDir || input.filePath) throw new ServiceError("Use a project-relative path with projectId and snapshotId.", 400);
        capability = read || parts[0] === "read" ? "project.read" : "files.write";
    } else throw new ServiceError("Unknown project route family", 500);
    if (!projectId && !snapshotId) throw new ServiceError("projectId or snapshotId is required", 400);
    for (const id of [projectId, snapshotId]) {
        if (id !== undefined && (typeof id !== "string" || !/^[\w-]{1,128}$/.test(id))) throw new ServiceError("Invalid resource identifier", 400);
    }
    return { projectId, snapshotId, capability };
};

export const enforceProjectEndpointPolicy = (family, dependencies = {}) => async (req, res, next) => {
    try {
        if (!req.user?.id) throw new ServiceError("Authentication required", 401);
        const rule = projectEndpointRule(family, req.method, req.path, { ...req.query, ...req.body });
        if (!rule) return next();
        const db = dependencies.db || prisma;
        const projectAccess = dependencies.resolveProjectAccess || resolveProjectAccess;
        const snapshotAccess = dependencies.resolveSnapshotAccess || resolveSnapshotAccess;
        if (rule.snapshotId) {
            // The central resolver loads the snapshot with BOTH supplied IDs,
            // then checks membership against its stored projectId. Avoid a
            // redundant prefetch that can diverge from the actual resolver.
            req.projectAccess = await snapshotAccess({ ...rule, userId: req.user.id, db });
        } else req.projectAccess = await projectAccess({ ...rule, userId: req.user.id, db });
        return next();
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, code: error.code || "PROJECT_POLICY_ERROR", message: error.statusCode ? error.message : "Project access could not be verified" });
    }
};
