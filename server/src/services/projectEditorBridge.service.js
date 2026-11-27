import fs from 'node:fs/promises';
import path from 'node:path';
import * as Y from 'yjs';
import prisma from '../config/prisma.js';
import { EDITOR_LIMITS, editorEnabled } from '../../../shared/editorProtocol.js';
import { hashFileContent, projectFileError } from './projectFileVersion.service.js';
import { advanceLineAttribution, logicalLines } from './projectLineAttribution.service.js';
import { notifyEditorProjectChange } from '../realtime/projectEditor.gateway.js';

export const seededEditorState = text => {
    const doc = new Y.Doc(); doc.getText('content').insert(0, text);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc)); doc.destroy(); return state;
};
export const EDITOR_DOC_REVISION_SELECT = {
    id: true,
    relativePath: true,
    revision: true,
    checkpointRevision: true,
};

export async function editorDocumentsFor(tx, where, select = null) {
    if (!tx.projectEditorDocument) return [];
    try { return await tx.projectEditorDocument.findMany({ where, ...(select ? { select } : {}) }); }
    catch (error) { if (!editorEnabled() && error.code === 'P2021') return []; throw error; }
}
export async function assertEditorReplacementAllowed({ tx, projectId, snapshotId, paths }) {
    const rows = await editorDocumentsFor(tx, { projectId, snapshotId, active: true }, EDITOR_DOC_REVISION_SELECT);
    const affected = rows.filter(row => paths.some(name => row.relativePath === name || row.relativePath.startsWith(`${name}/`)));
    const dirty = affected.filter(row => row.revision !== row.checkpointRevision);
    if (dirty.length) throw projectFileError('EDITOR_DRAFT_CONFLICT', 'Shared changes have not been saved to the workspace. Open the file and save or recover them first.', 409, { paths: dirty.map(row => row.relativePath) });
    return affected;
}
export async function assertEditorSnapshotChangeAllowed(tx, projectId) {
    const rows = await editorDocumentsFor(tx, { projectId, active: true }, EDITOR_DOC_REVISION_SELECT);
    if (rows.some(row => row.revision !== row.checkpointRevision)) throw projectFileError('EDITOR_DRAFT_CONFLICT', 'Save or recover shared changes before replacing the active snapshot.', 409);
}
export async function reconcileEditorReplacement({ tx, projectId, snapshotId, changes, actorId, source = 'HUMAN_EDIT' }) {
    for (const change of changes.filter(entry => !entry.path.startsWith('.git/'))) {
        const rows = await editorDocumentsFor(tx, { projectId, snapshotId, active: true,
            OR: [{ relativePath: change.path }, { relativePath: { startsWith: `${change.path}/` } }] });
        if (change.content === null || change.newPath) {
            for (const row of rows) {
                if (change.newPath) {
                    const relativePath = `${change.newPath}${row.relativePath.slice(change.path.length)}`;
                    await tx.projectFileVersion.upsert({ where: { snapshotId_relativePath: { snapshotId, relativePath } },
                        create: { snapshotId, relativePath, revision: 1, sha256: row.contentHash, deleted: false, updatedByUserId: actorId, lineAttributionJson: row.lineAttributionJson },
                        update: { sha256: row.contentHash, deleted: false, lineAttributionJson: row.lineAttributionJson },
                    });
                }
                await tx.projectEditorDocument.update({ where: { id: row.id }, data: { generation: { increment: 1 }, active: false } });
            }
            continue;
        }
        const text = Buffer.isBuffer(change.content) ? change.content.toString('utf8') : change.content;
        if (typeof text !== 'string') continue;
        const version = await tx.projectFileVersion.findUnique({ where: { snapshotId_relativePath: { snapshotId, relativePath: change.path } } });
        let lineMap = version?.lineAttributionJson || [];
        if (typeof change.before === 'string' && change.before !== text && source !== 'GIT_UPDATE') {
            const event = await tx.projectCodeChange?.create({ data: { projectId, snapshotId, actorId, source } });
            if (event) lineMap = advanceLineAttribution({ before: change.before, after: text, ranges: lineMap, changeId: event.id });
        } else if (source === 'GIT_UPDATE') lineMap = [];
        if (version && tx.projectCodeChange) await tx.projectFileVersion.update({ where: { id: version.id }, data: { lineAttributionJson: lineMap } });
        for (const row of rows) {
            if (row.text === text && row.baseFileHash === hashFileContent(text)) continue;
            await tx.projectEditorDocument.update({ where: { id: row.id }, data: {
                stateBytes: seededEditorState(text), text, contentHash: hashFileContent(text), generation: { increment: 1 },
                revision: 0, checkpointRevision: 0, baseFileRevision: version?.revision ?? 0,
                baseFileHash: hashFileContent(text), lineAttributionJson: lineMap,
            } });
        }
    }
}

/**
 * Reconciles active collaborative editor documents with on-disk files after working-tree Git operations.
 * Clean documents are refreshed in-place (keeping `active: true` so connected clients reload seamlessly),
 * deleted files are closed, and documents with unsaved shared changes are never overwritten.
 */
export async function reconcileEditorDocumentsAfterGitChange({ projectId, snapshotId, rootDir, updatedFiles = null, db = prisma }) {
    const summary = { reconciled: 0, closed: 0, skippedDirty: [] };
    if (!editorEnabled() || !db?.projectEditorDocument || !rootDir || !projectId) {
        return summary;
    }

    const rows = await editorDocumentsFor(
        db,
        { projectId, ...(snapshotId ? { snapshotId } : {}), active: true },
        {
            id: true,
            snapshotId: true,
            relativePath: true,
            revision: true,
            checkpointRevision: true,
            generation: true,
            baseFileHash: true,
            text: true,
        },
    );
    if (!rows.length) return summary;

    const normalizedFilter = Array.isArray(updatedFiles) && updatedFiles.length > 0
        ? new Set(updatedFiles.map(entry => String(entry || '').replaceAll('\\', '/').replace(/^\/+/, '')).filter(Boolean))
        : null;
    const resolvedRoot = path.resolve(rootDir);

    for (const row of rows) {
        const cleanRel = String(row.relativePath || '').replaceAll('\\', '/').replace(/^\/+/, '');
        if (normalizedFilter && !normalizedFilter.has(cleanRel)) continue;

        if (row.revision !== row.checkpointRevision) {
            summary.skippedDirty.push(cleanRel);
            continue;
        }

        const target = path.resolve(resolvedRoot, cleanRel);
        const relCheck = path.relative(resolvedRoot, target);
        if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
            continue;
        }

        let stat = null;
        try {
            stat = await fs.stat(target);
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }

        if (!stat || !stat.isFile()) {
            await db.projectEditorDocument.update({
                where: { id: row.id },
                data: { active: false, generation: { increment: 1 } },
            });
            if (db.projectFileVersion) {
                await db.projectFileVersion.updateMany({
                    where: { snapshotId: row.snapshotId, relativePath: cleanRel },
                    data: { deleted: true, revision: { increment: 1 } },
                });
            }
            summary.closed += 1;
            continue;
        }

        if (stat.size > EDITOR_LIMITS.fileBytes) {
            await db.projectEditorDocument.update({
                where: { id: row.id },
                data: { active: false, generation: { increment: 1 } },
            });
            summary.closed += 1;
            continue;
        }

        const bytes = await fs.readFile(target);
        const sha256 = hashFileContent(bytes);
        if (sha256 === row.baseFileHash) continue;

        const text = bytes.toString('utf8');
        if (text.includes('\0') || logicalLines(text).length > EDITOR_LIMITS.lines) {
            await db.projectEditorDocument.update({
                where: { id: row.id },
                data: { active: false, generation: { increment: 1 } },
            });
            summary.closed += 1;
            continue;
        }

        let baseFileRevision = 1;
        if (db.projectFileVersion) {
            const existingVersion = await db.projectFileVersion.findUnique({
                where: { snapshotId_relativePath: { snapshotId: row.snapshotId, relativePath: cleanRel } },
                select: { id: true, revision: true },
            });
            if (existingVersion) {
                const updatedVersion = await db.projectFileVersion.update({
                    where: { id: existingVersion.id },
                    data: { revision: { increment: 1 }, sha256, deleted: false, lineAttributionJson: [], attributionStatus: 'UNKNOWN' },
                    select: { revision: true },
                });
                baseFileRevision = updatedVersion.revision;
            } else {
                const createdVersion = await db.projectFileVersion.create({
                    data: { snapshotId: row.snapshotId, relativePath: cleanRel, revision: 0, sha256, deleted: false },
                    select: { revision: true },
                });
                baseFileRevision = createdVersion.revision;
            }
        }

        await db.projectEditorDocument.update({
            where: { id: row.id },
            data: {
                active: true,
                generation: { increment: 1 },
                stateBytes: seededEditorState(text),
                text,
                contentHash: sha256,
                baseFileHash: sha256,
                baseFileRevision,
                revision: 0,
                checkpointRevision: 0,
                lineAttributionJson: [],
            },
        });
        summary.reconciled += 1;
    }

    if (summary.reconciled > 0 || summary.closed > 0) {
        try {
            await notifyEditorProjectChange(projectId);
        } catch (error) {
            console.error('[reconcileEditorDocumentsAfterGitChange] notifyEditorProjectChange failed:', error?.message || error);
        }
    }

    return summary;
}
