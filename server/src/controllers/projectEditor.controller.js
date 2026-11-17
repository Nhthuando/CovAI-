import { z } from 'zod';
import prisma from '../config/prisma.js';
import { editorSnapshotStatus, checkpointEditorDocuments } from '../services/projectEditorCheckpoint.service.js';
import { loadEditorScope } from '../services/projectEditorDocument.service.js';
import { readVersionedProjectFile, resolveContainedProjectPath } from '../services/projectFileVersion.service.js';
import { resolveSnapshotAccess } from '../services/projectAccess.service.js';
import { readGitLineBlame } from '../services/projectGitBlame.service.js';
import { readEditorLineHistory } from '../services/projectLineHistory.service.js';

const id = z.string().regex(/^[\w-]{1,128}$/);
const scope = z.object({ snapshotId: id });
const checkpoint = scope.extend({ documents: z.array(z.object({ documentId: id, generation: z.number().int().positive(), revision: z.number().int().nonnegative() })).max(100), expectedWorkspaceRevision: z.number().int().nonnegative(), requestId: id.optional() });
const lineQuery = scope.extend({ path: z.string().min(1).max(1000), line: z.coerce.number().int().min(1).max(20000), documentId: id.optional(), generation: z.coerce.number().int().optional(), revision: z.coerce.number().int().optional() });
const parse = (schema, value) => { const result = schema.safeParse(value); if (!result.success) throw Object.assign(new Error('Invalid editor request.'), { statusCode: 400, code: 'VALIDATION_ERROR' }); return result.data; };
const handle = run => async (req, res) => {
    try { res.json({ success: true, data: await run(req) }); }
    catch (error) { res.status(error.statusCode || 500).json({ success: false, code: error.code || 'EDITOR_ERROR', message: error.statusCode ? error.message : 'The editor request could not be completed.', ...(error.details ? { details: error.details } : {}) }); }
};
const actor = req => ({ projectId: req.params.id, userId: req.user.id });
export const status = handle(req => editorSnapshotStatus({ ...actor(req), ...parse(scope, req.query) }));
export const save = handle(req => checkpointEditorDocuments({ ...actor(req), ...parse(checkpoint, req.body) }));
export const recovery = handle(async req => {
    const { row } = await loadEditorScope({ documentId: req.params.documentId, userId: req.user.id });
    if (row.projectId !== req.params.id) throw Object.assign(new Error('Document not found.'), { statusCode: 404 });
    return { path: row.relativePath, content: row.text, generation: row.generation, revision: row.revision };
});
export const history = handle(async req => {
    const input = parse(lineQuery, req.query), { projectId, userId } = actor(req);
    if (input.documentId) {
        const found = await readEditorLineHistory({ ...input, projectId, userId });
        if (found.history) return found.history;
        const resolved = await resolveContainedProjectPath(found.snapshot, input.path);
        const git = await readGitLineBlame({ root: resolved.root, path: resolved.relativePath, content: found.text, line: input.line });
        return { line: input.line, contentHash: found.contentHash, source: git ? 'GIT' : 'UNKNOWN', ...git, nearby: found.nearby };
    }
    let text, ranges, contentHash;
    const { snapshot } = await resolveSnapshotAccess({ projectId, snapshotId: input.snapshotId, userId, capability: 'project.read' });
    const resolved = await resolveContainedProjectPath(snapshot, input.path);
    {
        const file = await readVersionedProjectFile({ projectId, snapshotId: input.snapshotId, path: resolved.relativePath, userId });
        text = file.content; contentHash = file.version.sha256;
        ranges = (await prisma.projectFileVersion.findUnique({ where: { snapshotId_relativePath: { snapshotId: input.snapshotId, relativePath: file.path } } }))?.lineAttributionJson;
    }
    const range = (ranges || []).find(value => input.line >= value.start && input.line <= value.end);
    const change = range ? await prisma.projectCodeChange.findFirst({ where: { id: range.changeId, projectId, snapshotId: input.snapshotId }, include: { actor: { select: { name: true, email: true } } } }) : null;
    if (change) return { line: input.line, contentHash, source: change.source, actorName: change.actor?.name || change.actor?.email || 'Former member', timestamp: change.createdAt };
    const git = await readGitLineBlame({ root: resolved.root, path: resolved.relativePath, content: text, line: input.line });
    return { line: input.line, contentHash, source: git ? 'GIT' : 'UNKNOWN', ...git };
});
