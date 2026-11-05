import { randomUUID } from 'node:crypto';
import { capabilitiesForRole } from '../../../shared/projectAccess.js';
import { projectFileError } from './projectFileVersion.service.js';

// These queries run only in the checkpoint publisher, under the existing
// exclusive project lock. Filesystem journaling remains in the publisher.
export async function withCheckpointGuard({ projectId, snapshotId, userId, documentIds, db }, run) {
    if (!userId) throw projectFileError('AUTH_REQUIRED', 'Authentication required', 401);
    return db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`;
        // Separate from lock acquisition: use a fresh READ COMMITTED snapshot
        // after waiting for any preceding writer or membership change.
        const [row] = await tx.$queryRaw`
            SELECT p.*, to_jsonb(s) AS "checkpointSnapshot",
                (SELECT id FROM "ProjectSnapshot" WHERE "projectId" = p.id ORDER BY "createdAt" DESC LIMIT 1) AS "latestSnapshotId",
                CASE WHEN p."ownerId" = ${userId} THEN 'OWNER' ELSE m.role END AS "accessRole"
                , COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'generation',d.generation,'revision',d.revision,
                    'versionId',v.id,'versionRevision',v.revision,'versionHash',v.sha256,'versionDeleted',v.deleted))
                    FROM "ProjectEditorDocument" d LEFT JOIN "ProjectFileVersion" v ON v."snapshotId" = d."snapshotId" AND v."relativePath" = d."relativePath"
                    WHERE d."projectId" = p.id AND d."snapshotId" = ${snapshotId} AND d.active AND d.id = ANY(${documentIds}::text[])), '[]'::jsonb) AS "checkpointCurrent"
            FROM "Project" p LEFT JOIN "ProjectMember" m ON m."projectId" = p.id AND m."userId" = ${userId}
            LEFT JOIN "ProjectSnapshot" s ON s.id = ${snapshotId} AND s."projectId" = p.id
            WHERE p.id = ${projectId}`;
        if (!row?.accessRole || (process.env.PROJECT_COLLABORATION_ENABLED === 'false' && row.accessRole !== 'OWNER')) throw projectFileError('PROJECT_NOT_FOUND', 'Project not found', 404);
        const capabilities = capabilitiesForRole(row.accessRole);
        if (!capabilities.includes('files.write')) throw projectFileError('CAPABILITY_DENIED', 'Your role does not allow this action', 403);
        return run(tx, { project: row, role: row.accessRole, capabilities, checkpointSnapshot: row.checkpointSnapshot, latestSnapshotId: row.latestSnapshotId, checkpointCurrent: row.checkpointCurrent });
    }, { maxWait: 10000, timeout: 15000 });
}

export async function readCheckpointInput(db, { projectId, snapshotId, userId, ids }) {
    if (!userId) throw projectFileError('AUTH_REQUIRED', 'Authentication required', 401);
    const rows = await db.$queryRaw`
        SELECT d.id,d."projectId",d."snapshotId",d."relativePath",d.generation,d.revision,d."checkpointRevision",d.text,d."contentHash",
            d."lineAttributionJson",d."baseFileRevision",d."baseFileHash",p."workspaceRevision",CASE WHEN p."ownerId" = ${userId} THEN 'OWNER' ELSE m.role END AS "accessRole"
        FROM "Project" p LEFT JOIN "ProjectMember" m ON m."projectId" = p.id AND m."userId" = ${userId}
        LEFT JOIN "ProjectEditorDocument" d ON d."projectId" = p.id AND d."snapshotId" = ${snapshotId} AND d.active AND d.id = ANY(${ids}::text[])
        WHERE p.id = ${projectId}`;
    const scope = rows[0];
    if (!scope?.accessRole || (process.env.PROJECT_COLLABORATION_ENABLED === 'false' && scope.accessRole !== 'OWNER')) throw projectFileError('PROJECT_NOT_FOUND', 'Project not found', 404);
    if (!capabilitiesForRole(scope.accessRole).includes('files.write')) throw projectFileError('CAPABILITY_DENIED', 'Your role does not allow this action', 403);
    return { rows: rows.filter(row => row.id), access: { project: { workspaceRevision: scope.workspaceRevision } } };
}

export async function commitCheckpointFiles(tx, { snapshotId, userId, rows, changes, publication }) {
    const data = rows.map(row => ({ id: row.id, path: row.relativePath, revision: row.revision,
        lineMap: row.lineAttributionJson, changed: changes.some(change => change.path === row.relativePath) }));
    const [result] = await tx.$queryRaw`
        WITH input AS MATERIALIZED (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(data)}::jsonb)
              AS x(id text, path text, revision int, "lineMap" jsonb, changed boolean)
        ), versions AS (
            UPDATE "ProjectFileVersion" v SET revision = v.revision + CASE WHEN i.changed THEN 1 ELSE 0 END,
                sha256 = d."contentHash", deleted = false, "updatedByUserId" = CASE WHEN i.changed THEN ${userId} ELSE v."updatedByUserId" END,
                "lineAttributionJson" = i."lineMap", "updatedAt" = NOW()
            FROM input i JOIN "ProjectEditorDocument" d ON d.id = i.id
            WHERE v."snapshotId" = ${snapshotId} AND v."relativePath" = i.path
            RETURNING v."relativePath", v.revision, v.sha256
        ), documents AS (
          UPDATE "ProjectEditorDocument" d SET "checkpointRevision" = i.revision,
            "baseFileRevision" = v.revision, "baseFileHash" = v.sha256, "updatedAt" = NOW()
          FROM input i JOIN versions v ON v."relativePath" = i.path WHERE d.id = i.id RETURNING d.id
        ), project AS (
            UPDATE "Project" SET "workspaceRevision" = "workspaceRevision" + 1, "eventSequence" = "eventSequence" + 1, "updatedAt" = NOW()
            WHERE id = ${publication?.projectId || null} AND (SELECT COUNT(*) FROM documents) = ${rows.length} RETURNING "workspaceRevision", "eventSequence"
        ), mutation AS (
            UPDATE "ProjectMutation" SET state = 'APPLIED' WHERE id = ${publication?.mutationId || null} AND EXISTS (SELECT 1 FROM project) RETURNING id
        ), event AS (
          INSERT INTO "ProjectEvent" (id,"projectId",sequence,type,"actorId","resourceId",revision,payload,"createdAt")
          SELECT ${randomUUID()},${publication?.projectId || null},"eventSequence",'workspace.changed',${userId},${snapshotId},"workspaceRevision",
              ${JSON.stringify({ kind: 'BULK_APPLY', paths: publication?.changedPaths || [] })}::jsonb,NOW() FROM project CROSS JOIN mutation RETURNING *
        ) SELECT (SELECT COUNT(*)::int FROM documents) AS count, (SELECT to_jsonb(event) FROM event) AS event`;
    if (result.count !== rows.length) throw projectFileError('FILE_VERSION_CONFLICT', 'Shared file versions changed while saving.');
    if (publication && !result.event) throw projectFileError('EDITOR_SYNC_REQUIRED', 'Shared changes could not be checkpointed.');
    return result.event;
}
