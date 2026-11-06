import { editorEnabled } from '../../../shared/editorProtocol.js';
import { editorSnapshotStatus, checkpointEditorDocuments } from '../services/projectEditorCheckpoint.service.js';
import { withEditorCheckpoint } from '../services/projectEditorRequestContext.service.js';
import { editorDocumentsFor } from '../services/projectEditorBridge.service.js';
import prisma from "../config/prisma.js";
import { resolveProjectAccess, resolveSnapshotAccess } from "../services/projectAccess.service.js";
import { ServiceError } from "../utils/serviceError.js";

const readMethods = new Set(["GET", "HEAD"]);
const segment = value => {
    try { return decodeURIComponent(value || ""); }
    catch { throw new ServiceError("Invalid resource path", 400); }
};

const sanitizeId = (val) => {
    if (val === undefined || val === null) return undefined;
    const str = String(val).trim();
    if (!str || str === "undefined" || str === "null") return undefined;
    return str;
};

// This is the HTTP capability boundary, independent of controller implementations.
// Services still resolve resource ancestry and recheck final mutation authority.
export const projectEndpointRule = (family, method, path, input = {}) => {
    const parts = path.split("/").filter(Boolean).map(segment);
    const read = readMethods.has(method);
    let projectId = sanitizeId(input.projectId);
    let snapshotId = sanitizeId(input.snapshotId);
    let capability = read ? "project.read" : "tests.run";
    if (family === "projects") {
        if (!parts.length || parts[0] === "validate-archive") return null;
        projectId = sanitizeId(parts[0]) || projectId;
        if (parts[1] === "snapshots" && parts[2]) snapshotId = sanitizeId(parts[2]) || snapshotId;
        if (parts[1] === "export") capability = "project.export";
        if (!read) {
            if (parts.length === 1 && method === "DELETE") capability = "project.delete";
            else if (/\/restore$/.test(path)) capability = "snapshot.restore";
            else if (["upload-zip", "import-github", "snapshots"].includes(parts[1])) capability = "integrations.write";
            else if (["file-content", "files", "folders", "entries"].includes(parts[1])) capability = "files.write";
            else if (parts[1] === "status") capability = "files.write";
            else if (parts[1] === "ai-context") capability = parts[2] === "preview" ? "project.read" : method === "DELETE" && parts.length === 3 ? "chat.delete" : "memory.write";
            else if (parts[1] === "chat") capability = method === "DELETE" ? "chat.delete" : "chat.write";
            else if (parts[1] === "integration" && parts[2] === "install-dependencies") capability = "integrations.write";
            else if (/ai-|\/ai\//.test(path)) capability = "ai.use";
        }
    } else if (family === "coverage") {
        if (parts[0] === "project") {
            projectId = sanitizeId(parts[1]) || projectId;
            snapshotId = undefined;
        } else {
            snapshotId = sanitizeId(parts[0]) || snapshotId;
        }
        if (!read && /\/install-dependencies$/.test(path)) capability = "integrations.write";
        else if (!read && /\/apply-tests$/.test(path)) capability = "files.write";
        else if (!read && (/\/(approve|confirm|confirm-expected|review)(?:\/|$)/.test(path) || /\/system\/proposals\/[^/]+\/apply$/.test(path) || /\/system\/versions\/[^/]+\/restore$/.test(path) || /\/system\/generation-drafts\/[^/]+\/apply$/.test(path) || /\/system\/setup\/apply$/.test(path) || (method === "POST" && /\/system\/versions$/.test(path)))) capability = "evidence.approve";
        else if (!read && /\/(apply|apply-suggestion|save-ai-test|materialize)(?:\/|$)/.test(path)) capability = "files.write";
        else if (!read && /generate|suggest|optimize|regenerate|improvements/.test(path)) capability = "ai.use";
        else if (method === "PUT" || method === "PATCH" || method === "DELETE") capability = "files.write";
    } else if (family === "code-hygiene") {
        if (parts[0] === "snapshot") snapshotId = sanitizeId(parts[1]) || snapshotId;
        else if (parts[0] === "project") projectId = sanitizeId(parts[1]) || projectId;
    } else if (family === "reports") {
        projectId = sanitizeId(parts[1]) || projectId;
        capability = "project.export";
    } else if (family === "cyclomatic") {
        if (parts[0] && parts[0] !== "calculate") snapshotId = sanitizeId(parts[0]) || snapshotId;
    } else if (family === "ai-tests" || family === "ai-suggestions") {
        if (family === "ai-suggestions" && parts[0] === "refresh") projectId = sanitizeId(parts[1]) || projectId;
        capability = read ? "project.read" : "ai.use";
    } else if (family === "git") capability = read ? "project.read" : "integrations.write";
    else if (family === "github") { projectId = sanitizeId(parts[1]) || projectId; capability = "integrations.write"; }
    else if (family === "pipeline") { projectId = sanitizeId(parts[0]) || projectId; capability = "tests.run"; }
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
        if (editorEnabled() && !["GET", "HEAD"].includes(req.method)) {
            const projectId = req.projectAccess.project.id;
            if (family === 'git' || /upload-zip|import-github|\/restore$|\/snapshots$/.test(req.path)) {
                const rows = await editorDocumentsFor(db, { projectId, active: true });
                if (rows.some(row => row.revision !== row.checkpointRevision)) throw new ServiceError('Save shared changes before changing the workspace or Git state.',409,'EDITOR_DRAFT_CONFLICT');
            }
            if (['tests.run', 'ai.use'].includes(rule.capability) && /run|analysis|generate|suggest|optimize|improvements|mutations|calculate|refresh|cfg\/build/i.test(req.path)) {
                const snapshotId = req.projectAccess.snapshot?.id || (await db.projectSnapshot.findFirst({where:{projectId},orderBy:{createdAt:'desc'},select:{id:true}}))?.id;
                if (snapshotId) {
                    const state = await editorSnapshotStatus({projectId,snapshotId,userId:req.user.id,db});
                    const documents = state.documents.filter(doc=>doc.dirty);
                    const checkpoint = documents.length ? await checkpointEditorDocuments({projectId,snapshotId,userId:req.user.id,db,documents,expectedWorkspaceRevision:state.workspaceRevision}) : state;
                    return withEditorCheckpoint(checkpoint.workspaceRevision,()=>next());
                }
            }
        }
        return next();
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, code: error.code || "PROJECT_POLICY_ERROR", message: error.statusCode ? error.message : "Project access could not be verified" });
    }
};
