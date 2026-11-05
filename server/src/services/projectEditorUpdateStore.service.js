import { randomUUID } from 'node:crypto';
import { roleAllows } from '../../../shared/projectAccess.js';
import { projectFileError } from './projectFileVersion.service.js';

// Share the project lock with other live documents. Membership changes and
// workspace publication still acquire the existing exclusive project lock.
export async function withEditorUpdateStore({ projectId, documentId, userId, generation, requestId, db }, run) {
    return db.$transaction(async tx => {
        await tx.$executeRaw`
            WITH project_lock AS MATERIALIZED (
                SELECT pg_advisory_xact_lock_shared(hashtextextended(${projectId}, 0))
            ) SELECT pg_advisory_xact_lock(hashtextextended(${'editor:' + documentId}, 0)) FROM project_lock`;
        const [row] = await tx.$queryRaw`
            SELECT d.*, CASE WHEN p."ownerId" = ${userId} THEN 'OWNER' ELSE m.role END AS "accessRole",
                (SELECT s.id FROM "ProjectSnapshot" s WHERE s."projectId" = p.id ORDER BY s."createdAt" DESC LIMIT 1) AS "latestSnapshotId",
                (SELECT jsonb_build_object('updateHash', u."updateHash", 'resultRevision', u."resultRevision", 'resultContentHash', u."resultContentHash")
                 FROM "ProjectEditorUpdate" u WHERE u."documentId" = d.id AND u.generation = ${generation}
                    AND u."actorId" = ${userId} AND u."requestId" = ${requestId}) AS "priorReceipt"
            FROM "ProjectEditorDocument" d JOIN "Project" p ON p.id = d."projectId"
            LEFT JOIN "ProjectMember" m ON m."projectId" = p.id AND m."userId" = ${userId}
            WHERE d.id = ${documentId} AND d."projectId" = ${projectId}`;
        if (!row || !row.accessRole || (process.env.PROJECT_COLLABORATION_ENABLED === 'false' && row.accessRole !== 'OWNER')) throw projectFileError('RESOURCE_NOT_FOUND', 'Editor document not found.', 404);
        if (!roleAllows(row.accessRole, 'files.write')) throw projectFileError('CAPABILITY_DENIED', 'Your role does not allow this action', 403);
        return run({ row, prior: row.priorReceipt, latestSnapshotId: row.latestSnapshotId,
            persist: async ({ state, text, contentHash, revision, lineMap, changeId, updateHash, changed }) => {
                await tx.$queryRaw`
                    WITH change AS (
                        INSERT INTO "ProjectCodeChange" (id,"projectId","snapshotId","actorId",source,"createdAt")
                        SELECT ${changeId}, ${projectId}, ${row.snapshotId}, ${userId}, 'HUMAN_EDIT', NOW()
                        WHERE ${changeId !== null} RETURNING id
                    ), updated AS (
                        UPDATE "ProjectEditorDocument" SET "stateBytes" = ${state}, text = ${text},
                            "contentHash" = ${contentHash}, revision = ${revision}, "lineAttributionJson" = ${JSON.stringify(lineMap)}::jsonb, "updatedAt" = NOW()
                        WHERE id = ${documentId} AND ${changed} RETURNING id
                    ) INSERT INTO "ProjectEditorUpdate" (id,"documentId",generation,"actorId","requestId","updateHash","resultRevision","resultContentHash","createdAt")
                    VALUES (${randomUUID()},${documentId},${generation},${userId},${requestId},${updateHash},${revision},${contentHash},NOW()) RETURNING id`;
            },
        });
    }, { maxWait: 10000, timeout: 15000 });
}
