import * as Y from 'yjs';
import { editorEnabled } from '../../../shared/editorProtocol.js';
import { hashFileContent, projectFileError } from './projectFileVersion.service.js';
import { advanceLineAttribution } from './projectLineAttribution.service.js';

export const seededEditorState = text => {
    const doc = new Y.Doc(); doc.getText('content').insert(0, text);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc)); doc.destroy(); return state;
};
export async function editorDocumentsFor(tx, where) {
    if (!tx.projectEditorDocument) return [];
    try { return await tx.projectEditorDocument.findMany({ where }); }
    catch (error) { if (!editorEnabled() && error.code === 'P2021') return []; throw error; }
}
export async function assertEditorReplacementAllowed({ tx, projectId, snapshotId, paths }) {
    const rows = await editorDocumentsFor(tx, { projectId, snapshotId, active: true });
    const affected = rows.filter(row => paths.some(name => row.relativePath === name || row.relativePath.startsWith(`${name}/`)));
    const dirty = affected.filter(row => row.revision !== row.checkpointRevision);
    if (dirty.length) throw projectFileError('EDITOR_DRAFT_CONFLICT', 'Shared changes have not been saved to the workspace. Open the file and save or recover them first.', 409, { paths: dirty.map(row => row.relativePath) });
    return affected;
}
export async function assertEditorSnapshotChangeAllowed(tx, projectId) {
    const rows = await editorDocumentsFor(tx, { projectId, active: true });
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
