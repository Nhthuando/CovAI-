import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma.js';
import { resolveProjectAccess } from './projectAccess.service.js';
import { projectFileError } from './projectFileVersion.service.js';
import { publishPreparedWorkspace } from './projectWorkspacePublish.service.js';
import { editorDocumentsFor } from './projectEditorBridge.service.js';
import { readCheckpointInput } from './projectEditorCheckpointStore.service.js';

export async function editorSnapshotStatus({ projectId, snapshotId, userId, db = prisma }) {
    if (!userId) throw projectFileError('AUTH_REQUIRED', 'Authentication required', 401);
    if (db.$queryRaw) {
        const [row] = await db.$queryRaw`
            SELECT p."workspaceRevision", COALESCE((SELECT jsonb_agg(jsonb_build_object('documentId',d.id,'path',d."relativePath",
                'generation',d.generation,'revision',d.revision,'dirty',d.revision <> d."checkpointRevision"))
                FROM "ProjectEditorDocument" d WHERE d."projectId" = p.id AND d."snapshotId" = ${snapshotId} AND d.active), '[]'::jsonb) AS documents
            FROM "Project" p WHERE p.id = ${projectId} AND (p."ownerId" = ${userId} OR (${process.env.PROJECT_COLLABORATION_ENABLED !== 'false'} AND EXISTS (
                SELECT 1 FROM "ProjectMember" m WHERE m."projectId" = p.id AND m."userId" = ${userId} AND m.role IN ('EDITOR','VIEWER'))))`;
        if (!row) throw projectFileError('PROJECT_NOT_FOUND', 'Project not found', 404);
        return row;
    }
    const access = await resolveProjectAccess({ projectId, userId, capability: 'project.read', db });
    const rows = await editorDocumentsFor(db, { projectId, snapshotId, active: true });
    return { workspaceRevision: access.project.workspaceRevision, documents: rows.map(row => ({ documentId: row.id,
        path: row.relativePath, generation: row.generation, revision: row.revision, dirty: row.revision !== row.checkpointRevision })) };
}
export async function checkpointEditorDocuments({ projectId, snapshotId, userId, documents, expectedWorkspaceRevision, requestId = randomUUID(), db = prisma }) {
    if (!Array.isArray(documents) || documents.length > 100) throw projectFileError('EDITOR_LIMIT_EXCEEDED', 'Save shared files in groups of at most 100.', 413);
    const input = db.$queryRaw ? await readCheckpointInput(db, { projectId, snapshotId, userId, ids: documents.map(item => item.documentId) }) : null;
    const access = input?.access || await resolveProjectAccess({ projectId, userId, capability: 'files.write', db });
    const rows = input?.rows || await editorDocumentsFor(db, { projectId, snapshotId, active: true, id: { in: documents.map(item => item.documentId) } });
    if (rows.length !== documents.length) throw projectFileError('EDITOR_SYNC_REQUIRED', 'One or more shared files are unavailable. Refresh before saving.');
    const check = current => {
        for (const requested of documents) {
            const row = current.find(item => item.id === requested.documentId);
            if (!row || row.generation !== requested.generation || row.revision !== requested.revision) throw projectFileError('EDITOR_SYNC_REQUIRED', 'Shared changes arrived while saving. Please save again.');
        }
    };
    check(rows);
    const dirty = rows.filter(row => row.revision !== row.checkpointRevision);
    if (!dirty.length) return { checkpointId: requestId, workspaceRevision: access.project.workspaceRevision, documents: rows.map(row => ({ documentId: row.id, revision: row.revision })) };
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-editor-checkpoint-'));
    try {
        const beforeFiles = new Map();
        let bytes = 0;
        for (const row of dirty) {
            bytes += Buffer.byteLength(row.text);
            if (bytes > 16 * 1024 * 1024) throw projectFileError('EDITOR_LIMIT_EXCEEDED', 'Save shared files in smaller groups.', 413);
            const target = path.join(root, row.relativePath);
            await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, row.text);
            beforeFiles.set(row.relativePath, { sha256: row.baseFileHash });
        }
        const result = await publishPreparedWorkspace({ projectId, snapshotId, userId, expectedWorkspaceRevision,
            beforeFiles, preparedRoot: root, requestId, db, editorCheckpoint: true, checkpointRows: dirty, checkpointDocumentIds: rows.map(row => row.id),
            beforeMutation: async (tx, guardedAccess) => {
                const current = tx.$queryRaw ? guardedAccess.checkpointCurrent
                    : await editorDocumentsFor(tx, { id: { in: rows.map(row => row.id) }, projectId, snapshotId, active: true });
                check(current);
                for (const row of dirty) {
                    const joined = current.find(item => item.id === row.id);
                    const version = tx.$queryRaw ? (joined?.versionId ? { deleted: joined.versionDeleted, revision: joined.versionRevision, sha256: joined.versionHash } : null)
                        : await tx.projectFileVersion.findUnique({ where: { snapshotId_relativePath: { snapshotId, relativePath: row.relativePath } } });
                    if (!version || version.deleted || version.revision !== row.baseFileRevision || version.sha256 !== row.baseFileHash) throw projectFileError('FILE_VERSION_CONFLICT', 'The workspace changed outside the shared draft. Recover it before saving.');
                }
            },
            afterMutation: async tx => {
                for (const row of dirty) {
                    const version = await tx.projectFileVersion.findUnique({ where: { snapshotId_relativePath: { snapshotId, relativePath: row.relativePath } } });
                    await tx.projectFileVersion.update({ where: { id: version.id }, data: { lineAttributionJson: row.lineAttributionJson } });
                    await tx.projectEditorDocument.update({ where: { id: row.id }, data: { baseFileRevision: version.revision, baseFileHash: version.sha256, checkpointRevision: row.revision } });
                }
            },
        });
        return { checkpointId: requestId, workspaceRevision: result.workspaceRevision, documents: rows.map(row => ({ documentId: row.id, revision: row.revision })) };
    } finally { await fs.rm(root, { recursive: true, force: true }); }
}
