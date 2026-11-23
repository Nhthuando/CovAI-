import { randomUUID } from 'node:crypto';
import { roleAllows } from '../../../shared/projectAccess.js';
import { projectFileError } from './projectFileVersion.service.js';
import { withEditorUpdateStore } from './projectEditorUpdateStore.service.js';

const stores = new WeakMap();
const conflict = () => projectFileError('EDITOR_CACHE_STALE', 'Refresh the editor authority.');
function storeFor(db) {
    if (!stores.has(db)) stores.set(db, { rows: new Map(), locks: new Map() });
    return stores.get(db);
}

// Cache accepted document bytes, never permission decisions alone. Every write
// gates on current project access/workspace revisions and document generation/revision.
export async function withEditorFastStore(input, run) {
    const { db, projectId, documentId, userId, generation, requestId, readerIds = [] } = input;
    const store = storeFor(db), key = `${projectId}:${documentId}`;
    const previous = store.locks.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
        let entry = store.rows.get(key), grant = entry?.grants.get(userId);
        if (!entry || entry.row.generation !== generation || Date.now() - entry.used > 60000 || !grant || Date.now() - grant.checked > 15000) {
            const [row] = await db.$queryRaw`
                SELECT d.*, p."accessRevision", p."workspaceRevision",
                    CASE WHEN p."ownerId" = ${userId} THEN 'OWNER' ELSE m.role END AS "accessRole",
                    (SELECT s.id FROM "ProjectSnapshot" s WHERE s."projectId" = p.id ORDER BY s."createdAt" DESC LIMIT 1) AS "latestSnapshotId"
                FROM "ProjectEditorDocument" d JOIN "Project" p ON p.id = d."projectId"
                LEFT JOIN "ProjectMember" m ON m."projectId" = p.id AND m."userId" = ${userId}
                WHERE d.id = ${documentId} AND d."projectId" = ${projectId}`;
            if (!row?.accessRole) throw projectFileError('RESOURCE_NOT_FOUND', 'Editor document not found.', 404);
            const grants = entry?.grants || new Map();
            grant = { role: row.accessRole, accessRevision: row.accessRevision, workspaceRevision: row.workspaceRevision, checked: Date.now() };
            grants.set(userId, grant);
            if (grants.size > 128) grants.delete(grants.keys().next().value);
            entry = { row, grants, used: Date.now() };
            store.rows.delete(key); store.rows.set(key, entry);
        }
        if (!roleAllows(grant.role, 'files.write') || (process.env.PROJECT_COLLABORATION_ENABLED === 'false' && grant.role !== 'OWNER')) {
            store.rows.delete(key);
            throw projectFileError('CAPABILITY_DENIED', 'Your role does not allow this action', 403);
        }
        entry.used = Date.now();
        try {
            return await run({ row: entry.row, latestSnapshotId: entry.row.latestSnapshotId, prior: null,
                persist: async ({ state, text, contentHash, revision, lineMap, changeId, updateHash, changed }) => {
                    const [result] = await db.$queryRaw`
                        WITH gate AS MATERIALIZED (
                            SELECT p.id, p."ownerId" FROM "Project" p WHERE p.id = ${projectId}
                              AND pg_try_advisory_xact_lock_shared(hashtextextended(${projectId}, 0))
                              AND pg_try_advisory_xact_lock(hashtextextended(${'editor:' + documentId}, 0))
                              AND p."accessRevision" = ${grant.accessRevision} AND p."workspaceRevision" = ${grant.workspaceRevision}
                              AND (p."ownerId" = ${userId} OR (${process.env.PROJECT_COLLABORATION_ENABLED !== 'false'} AND EXISTS (
                                SELECT 1 FROM "ProjectMember" m WHERE m."projectId" = p.id AND m."userId" = ${userId} AND m.role = 'EDITOR')))
                            FOR SHARE
                        ), prior AS MATERIALIZED (
                            SELECT u.* FROM "ProjectEditorUpdate" u, gate WHERE u."documentId" = ${documentId}
                              AND u.generation = ${generation} AND u."actorId" = ${userId} AND u."requestId" = ${requestId}
                        ), updated AS (
                            UPDATE "ProjectEditorDocument" d SET "stateBytes" = ${state}, text = ${text}, "contentHash" = ${contentHash},
                              revision = ${revision}, "lineAttributionJson" = ${JSON.stringify(lineMap)}::jsonb, "updatedAt" = NOW()
                            FROM gate WHERE d.id = ${documentId} AND d."projectId" = gate.id AND d.active
                              AND d.generation = ${generation} AND d.revision = ${entry.row.revision} AND NOT EXISTS (SELECT 1 FROM prior)
                              AND d."snapshotId" = (SELECT s.id FROM "ProjectSnapshot" s WHERE s."projectId" = gate.id ORDER BY s."createdAt" DESC LIMIT 1)
                            RETURNING d.id
                        ), change AS (
                            INSERT INTO "ProjectCodeChange" (id,"projectId","snapshotId","actorId",source,"createdAt")
                            SELECT ${changeId},${projectId},${entry.row.snapshotId},${userId},'HUMAN_EDIT',NOW() FROM updated WHERE ${changeId !== null} RETURNING id
                        ), receipt AS (
                            INSERT INTO "ProjectEditorUpdate" (id,"documentId",generation,"actorId","requestId","updateHash","resultRevision","resultContentHash","createdAt")
                            SELECT ${randomUUID()},${documentId},${generation},${userId},${requestId},${updateHash},${revision},${contentHash},NOW() FROM updated RETURNING id
                        ) SELECT EXISTS(SELECT 1 FROM receipt) AS applied,
                            (SELECT "updateHash" FROM prior) AS "priorHash",
                            ARRAY(SELECT readers.id FROM gate CROSS JOIN unnest(${readerIds}::text[]) AS readers(id)
                              WHERE gate."ownerId" = readers.id OR (${process.env.PROJECT_COLLABORATION_ENABLED !== 'false'} AND EXISTS (
                                SELECT 1 FROM "ProjectMember" m WHERE m."projectId" = gate.id AND m."userId" = readers.id AND m.role IN ('EDITOR', 'VIEWER')))) AS "authorizedReaderIds"`;
                    if (!result?.applied) {
                        if (result?.priorHash && result.priorHash !== updateHash) throw projectFileError('REQUEST_ID_REUSED', 'Editor request ID was reused for different content.');
                        throw conflict(); // Retry/replay is resolved from the durable receipt in the slow path.
                    }
                    entry.row = { ...entry.row, stateBytes: state, text, contentHash, revision, lineAttributionJson: lineMap };
                    store.rows.delete(key); store.rows.set(key, entry);
                    // Bound retained state by bytes as well as entry count; evicted files reopen from PostgreSQL.
                    let retained = 0;
                    for (const item of store.rows.values()) retained += item.row.stateBytes.byteLength;
                    while (store.rows.size > 128 || retained > 32 * 1024 * 1024) {
                        const oldest = store.rows.keys().next().value;
                        retained -= store.rows.get(oldest).row.stateBytes.byteLength; store.rows.delete(oldest);
                    }
                    return { authorizedReaderIds: result.authorizedReaderIds, accessRevision: grant.accessRevision };
                },
            });
        } catch (error) {
            store.rows.delete(key);
            if (error.code !== 'EDITOR_CACHE_STALE') throw error;
            // Contention, membership changes, replay or another server's update:
            // resolve current authority under the full shared-project/document guard.
            return withEditorUpdateStore(input, run);
        }
    });
    store.locks.set(key, task);
    try { return await task; }
    finally { if (store.locks.get(key) === task) store.locks.delete(key); }
}
