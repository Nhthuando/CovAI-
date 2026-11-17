import * as Y from 'yjs';
import prisma from '../config/prisma.js';
import { EDITOR_LIMITS, editorEnabled } from '../../../shared/editorProtocol.js';
import { resolveProjectAccess, withProjectGuard } from './projectAccess.service.js';
import { readVersionedProjectFile, readVersionedProjectFileInTransaction, normalizeProjectPath, hashFileContent, projectFileError } from './projectFileVersion.service.js';
import { seededEditorState } from './projectEditorBridge.service.js';
import { advanceLineAttribution, logicalLines } from './projectLineAttribution.service.js';
import { randomUUID } from 'node:crypto';
import { withEditorFastStore } from './projectEditorFastStore.service.js';
import { recentProjectFileRead } from './projectFileReadCache.service.js';
import { capabilitiesForRole } from '../../../shared/projectAccess.js';

const enabled = () => { if (!editorEnabled()) throw projectFileError('EDITOR_UNAVAILABLE', 'Live editing is unavailable.', 503); };
export function editorBytes(value, max = EDITOR_LIMITS.updateBytes) {
    if (!(value instanceof Uint8Array) || !value.byteLength || value.byteLength > max) throw projectFileError('EDITOR_LIMIT_EXCEEDED', 'Invalid or oversized editor update.', 413);
    return new Uint8Array(value);
}
export const editorIdentity = row => ({ documentId: row.id, projectId: row.projectId, snapshotId: row.snapshotId, path: row.relativePath, generation: row.generation });
const dto = (row, access) => ({ ...editorIdentity(row), revision: row.revision, contentHash: row.contentHash,
    stateBytes: row.stateBytes, checkpointRevision: row.checkpointRevision, fileVersion: { revision: row.baseFileRevision, sha256: row.baseFileHash },
    workspaceRevision: access.project.workspaceRevision, accessRevision: access.project.accessRevision, role: access.role, disciplineRole: access.disciplineRole, capabilities: access.capabilities });
export async function openEditorDocument({ projectId, snapshotId, path, userId, db = prisma }) {
    enabled();
    const relativePath = normalizeProjectPath(path);
    if (db.$queryRaw) {
        const file = recentProjectFileRead({ projectId, snapshotId, path: relativePath, userId }) || await readVersionedProjectFile({ projectId, snapshotId, path: relativePath, userId, db });
        if (file.content.includes('\0') || hashFileContent(file.content) !== file.version.sha256 || logicalLines(file.content).length > EDITOR_LIMITS.lines) throw projectFileError('EDITOR_LIMIT_EXCEEDED', 'Live editing supports UTF-8 text files within the line limit only.', 413);
        const seed = seededEditorState(file.content);
        const [row] = await db.$queryRaw`
            WITH gate AS MATERIALIZED (
                SELECT p.id, p."workspaceRevision", p."accessRevision", v.sha256, v.revision, v."lineAttributionJson",
                    CASE WHEN p."ownerId" = ${userId} THEN 'OWNER' ELSE m.role END AS "accessRole",
                    CASE WHEN p."ownerId" = ${userId} THEN 'PM' ELSE m."disciplineRole" END AS "disciplineRole"
                FROM "Project" p JOIN "ProjectFileVersion" v ON v."snapshotId" = ${snapshotId} AND v."relativePath" = ${file.path}
                LEFT JOIN "ProjectMember" m ON m."projectId" = p.id AND m."userId" = ${userId}
                WHERE p.id = ${projectId} AND v.sha256 = ${file.version.sha256} AND v.revision = ${file.version.revision} AND NOT v.deleted
                    AND p."workspaceRevision" = ${file.workspaceRevision} AND p."accessRevision" = ${file.accessRevision}
                    AND pg_try_advisory_xact_lock_shared(hashtextextended(${projectId}, 0))
                    AND ${snapshotId} = (SELECT s.id FROM "ProjectSnapshot" s WHERE s."projectId" = p.id ORDER BY s."createdAt" DESC LIMIT 1)
                    AND (p."ownerId" = ${userId} OR (${process.env.PROJECT_COLLABORATION_ENABLED !== 'false'} AND m.role IN ('EDITOR', 'VIEWER')))
                FOR SHARE OF p
            ), created AS (
                INSERT INTO "ProjectEditorDocument" (id,"projectId","snapshotId","relativePath",generation,revision,"checkpointRevision",
                    "stateBytes",text,"contentHash","baseFileHash","baseFileRevision","lineAttributionJson",active,"createdAt","updatedAt")
                SELECT ${randomUUID()},${projectId},${snapshotId},${file.path},1,0,0,${seed},${file.content},${file.version.sha256},
                    gate.sha256,gate.revision,COALESCE(gate."lineAttributionJson",'[]'::jsonb),true,NOW(),NOW() FROM gate
                ON CONFLICT ("snapshotId","relativePath") DO NOTHING RETURNING *
            ), documents AS (
                SELECT * FROM "ProjectEditorDocument" d WHERE d."projectId" = ${projectId} AND d."snapshotId" = ${snapshotId} AND d."relativePath" = ${file.path}
                UNION ALL SELECT * FROM created
            ) SELECT d.*,gate."workspaceRevision",gate."accessRevision",gate."accessRole",gate."disciplineRole" FROM documents d, gate
                WHERE d.active AND d."baseFileHash" = gate.sha256`;
        if (row && logicalLines(row.text).length <= EDITOR_LIMITS.lines) return dto(row, {
            project: { workspaceRevision: row.workspaceRevision, accessRevision: row.accessRevision }, role: row.accessRole, disciplineRole: row.disciplineRole, capabilities: capabilitiesForRole(row.accessRole),
        });
    }
    return withProjectGuard({ projectId, userId, capability: 'project.read', db }, async (tx, access) => {
        const file = await readVersionedProjectFileInTransaction({ tx, access, projectId, snapshotId, path });
        if (file.content.includes('\0') || hashFileContent(file.content) !== file.version.sha256) throw projectFileError('EDITOR_LIMIT_EXCEEDED', 'Live editing supports UTF-8 text files only.', 413);
        if (logicalLines(file.content).length > EDITOR_LIMITS.lines) throw projectFileError('EDITOR_LIMIT_EXCEEDED', 'This file exceeds the live editing line limit.', 413);
        const latest = await tx.projectSnapshot.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (latest?.id !== snapshotId) throw projectFileError('EDITOR_DOCUMENT_CLOSED', 'Live editing is only available for the active snapshot.');
        const version = await tx.projectFileVersion.findUnique({ where: { snapshotId_relativePath: { snapshotId, relativePath: file.path } } });
        if (version.revision !== file.version.revision || version.sha256 !== file.version.sha256) throw projectFileError('EDITOR_SYNC_REQUIRED', 'The file changed. Open it again.');
        let row = await tx.projectEditorDocument.findUnique({ where: { snapshotId_relativePath: { snapshotId, relativePath: file.path } } });
        if (!row) row = await tx.projectEditorDocument.create({ data: {
            projectId, snapshotId, relativePath: file.path, stateBytes: seededEditorState(file.content), text: file.content,
            contentHash: file.version.sha256, baseFileHash: file.version.sha256, baseFileRevision: file.version.revision,
            lineAttributionJson: version.lineAttributionJson || [],
        } });
        if (!row.active || row.baseFileHash !== version.sha256) {
            if (row.revision !== row.checkpointRevision) throw projectFileError('EDITOR_SYNC_REQUIRED', 'The workspace changed outside this session. Recover shared changes before continuing.');
            row = await tx.projectEditorDocument.update({ where: { id: row.id }, data: {
                active: true, generation: row.generation + 1, stateBytes: seededEditorState(file.content), text: file.content,
                contentHash: version.sha256, baseFileHash: version.sha256, baseFileRevision: version.revision,
                lineAttributionJson: version.lineAttributionJson || [],
            } });
        }
        return dto(row, access);
    });
}
export async function loadEditorScope({ documentId, userId, capability = 'project.read', db = prisma }) {
    if (typeof documentId !== 'string' || documentId.length > 128) throw projectFileError('RESOURCE_NOT_FOUND', 'Editor document not found.', 404);
    const row = await db.projectEditorDocument.findUnique({ where: { id: documentId } });
    if (!row) throw projectFileError('RESOURCE_NOT_FOUND', 'Editor document not found.', 404);
    const access = await resolveProjectAccess({ projectId: row.projectId, userId, capability, db });
    return { row, access };
}
export function assertEditorGeneration(row, generation) {
    if (!row.active) throw projectFileError('EDITOR_DOCUMENT_CLOSED', 'This editor session is closed.');
    if (row.generation !== generation) throw projectFileError('EDITOR_GENERATION_CHANGED', 'The file was replaced or moved. Your pending draft has been preserved.');
}
export async function applyEditorUpdate({ documentId, generation, requestId, updateBytes, userId, projectId: trustedProjectId, readerIds = [], db = prisma }) {
    enabled();
    if (typeof requestId !== 'string' || !/^[\w-]{1,128}$/.test(requestId)) throw projectFileError('INVALID_REQUEST_ID', 'Invalid editor request ID.', 400);
    const bytes = editorBytes(updateBytes), updateHash = hashFileContent(bytes);
    const projectId = trustedProjectId || (await loadEditorScope({ documentId, userId, capability: 'files.write', db })).row.projectId;
    const update = async ({ row, prior, latestSnapshotId, persist }) => {
        assertEditorGeneration(row, generation);
        if (row.projectId !== projectId || latestSnapshotId !== row.snapshotId) throw projectFileError('EDITOR_DOCUMENT_CLOSED', 'The active snapshot changed.');
        if (prior) {
            if (prior.updateHash !== updateHash) throw projectFileError('REQUEST_ID_REUSED', 'Editor request ID was reused for different content.');
            return { receipt: { requestId, updateHash, revision: prior.resultRevision, contentHash: prior.resultContentHash }, ...editorIdentity(row), changed: false };
        }
        const doc = new Y.Doc();
        let state, text;
        try {
            Y.applyUpdate(doc, row.stateBytes); doc.getText('content');
            Y.applyUpdate(doc, bytes);
            if ([...doc.share.keys()].some(key => key !== 'content') || !(doc.getText('content') instanceof Y.Text)) throw new Error('Unsupported shared type');
            state = Buffer.from(Y.encodeStateAsUpdate(doc)); text = doc.getText('content').toString();
            if (state.length > EDITOR_LIMITS.stateBytes || Buffer.byteLength(text) > EDITOR_LIMITS.fileBytes || logicalLines(text).length > EDITOR_LIMITS.lines) throw projectFileError('EDITOR_LIMIT_EXCEEDED', 'This change exceeds the live editing limit.', 413);
        } catch (error) { if (error.statusCode) throw error; throw projectFileError('INVALID_EDITOR_UPDATE', 'The editor update could not be decoded.', 400); }
        finally { doc.destroy(); }
        const changed = !Buffer.from(row.stateBytes).equals(state), revision = row.revision + (changed ? 1 : 0);
        let lineMap = row.lineAttributionJson;
        let changeId = null;
        if (text !== row.text) {
            changeId = randomUUID();
            lineMap = advanceLineAttribution({ before: row.text, after: text, ranges: lineMap, changeId });
        }
        const contentHash = hashFileContent(text);
        const delivery = await persist({ state, text, contentHash, revision, lineMap, changeId, updateHash, changed });
        return { receipt: { requestId, updateHash, revision, contentHash }, ...editorIdentity(row), committedUpdate: bytes, changed, ...delivery };
    };
    if (db.$queryRaw) return withEditorFastStore({ projectId, documentId, userId, generation, requestId, readerIds, db }, update);
    // Model-only adapters used by focused tests retain the same transform and contract.
    return withProjectGuard({ projectId, userId, capability: 'files.write', db }, async tx => {
        const row = await tx.projectEditorDocument.findUnique({ where: { id: documentId } });
        const latest = await tx.projectSnapshot.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        const where = { documentId_generation_actorId_requestId: { documentId, generation, actorId: userId, requestId } };
        return update({ row, prior: await tx.projectEditorUpdate.findUnique({ where }), latestSnapshotId: latest?.id,
            persist: async ({ state, text, contentHash, revision, lineMap, changeId, updateHash, changed }) => {
                if (changeId) await tx.projectCodeChange.create({ data: { id: changeId, projectId, snapshotId: row.snapshotId, actorId: userId, source: 'HUMAN_EDIT' } });
                if (changed) await tx.projectEditorDocument.update({ where: { id: documentId }, data: { stateBytes: state, text, contentHash, revision, lineAttributionJson: lineMap } });
                await tx.projectEditorUpdate.create({ data: { documentId, generation, actorId: userId, requestId, updateHash, resultRevision: revision, resultContentHash: contentHash } });
            },
        });
    });
}
export async function syncEditorDocument({ documentId, generation, stateVector, userId, db = prisma }) {
    enabled();
    let row;
    if (db.$queryRaw) {
        if (typeof documentId !== 'string' || documentId.length > 128) throw projectFileError('RESOURCE_NOT_FOUND', 'Editor document not found.', 404);
        [row] = await db.$queryRaw`
            SELECT d.* FROM "ProjectEditorDocument" d JOIN "Project" p ON p.id = d."projectId"
            LEFT JOIN "ProjectMember" m ON m."projectId" = p.id AND m."userId" = ${userId}
            WHERE d.id = ${documentId} AND (p."ownerId" = ${userId} OR (${process.env.PROJECT_COLLABORATION_ENABLED !== 'false'} AND m.role IN ('EDITOR', 'VIEWER')))`;
        if (!row) throw projectFileError('RESOURCE_NOT_FOUND', 'Editor document not found.', 404);
    } else ({ row } = await loadEditorScope({ documentId, userId, db }));
    assertEditorGeneration(row, generation);
    const doc = new Y.Doc();
    try { Y.applyUpdate(doc, row.stateBytes); return { ...editorIdentity(row), revision: row.revision, checkpointRevision: row.checkpointRevision, contentHash: row.contentHash,
        updateBytes: Y.encodeStateAsUpdate(doc, editorBytes(stateVector, 65536)) }; }
    finally { doc.destroy(); }
}
