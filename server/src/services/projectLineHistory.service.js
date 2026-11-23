import prisma from '../config/prisma.js';
import { normalizeProjectPath, projectFileError } from './projectFileVersion.service.js';
import { assertEditorGeneration } from './projectEditorDocument.service.js';

// One permission-scoped query. Do not fetch Yjs bytes, or source text when
// application provenance already answers the requested line.
export async function readEditorLineHistory({ projectId, userId, snapshotId, documentId, generation, revision, path, line, db = prisma }) {
    if (!userId) throw projectFileError('AUTH_REQUIRED', 'Authentication required', 401);
    const relativePath = normalizeProjectPath(path);
    const [row] = await db.$queryRaw`
        SELECT d.active,d.generation,d.revision,d."contentHash", to_jsonb(s) AS snapshot, h.nearby,
          CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(h.nearby) n WHERE (n->>'start')::int <= ${line} AND (n->>'end')::int >= ${line}) THEN NULL ELSE d.text END AS text
        FROM "ProjectEditorDocument" d JOIN "Project" p ON p.id=d."projectId"
        JOIN "ProjectSnapshot" s ON s.id=d."snapshotId" AND s."projectId"=p.id
        LEFT JOIN LATERAL (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('start',r.start,'end',r.end,'source',c.source,
            'actorName',COALESCE(NULLIF(u.name,''),u.email,'Former member'),'timestamp',c."createdAt")), '[]'::jsonb) AS nearby
          FROM jsonb_to_recordset(COALESCE(d."lineAttributionJson",'[]'::jsonb)) AS r(start int,"end" int,"changeId" text)
          JOIN "ProjectCodeChange" c ON c.id=r."changeId" AND c."projectId"=p.id AND c."snapshotId"=s.id
          LEFT JOIN "User" u ON u.id=c."actorId"
          WHERE r.start <= ${line + 20} AND r.end >= ${Math.max(1, line - 20)}
        ) h ON true
        WHERE d.id=${documentId} AND d."projectId"=${projectId} AND d."snapshotId"=${snapshotId} AND d."relativePath"=${relativePath}
          AND (p."ownerId"=${userId} OR (${process.env.PROJECT_COLLABORATION_ENABLED !== 'false'} AND EXISTS (
            SELECT 1 FROM "ProjectMember" m WHERE m."projectId"=p.id AND m."userId"=${userId} AND m.role IN ('EDITOR','VIEWER'))))`;
    if (!row) throw projectFileError('RESOURCE_NOT_FOUND', 'Document not found.', 404);
    assertEditorGeneration(row, generation);
    if (row.revision !== revision) throw projectFileError('EDITOR_SYNC_REQUIRED', 'Line history changed. Try again.');
    const nearby = row.nearby.map(range => ({ ...range, start: Math.max(range.start, line - 20, 1), end: Math.min(range.end, line + 20, 20000) }));
    const attributed = nearby.find(range => range.start <= line && range.end >= line);
    return { snapshot: row.snapshot, text: row.text, contentHash: row.contentHash, nearby,
        history: attributed ? { line, contentHash: row.contentHash, source: attributed.source, actorName: attributed.actorName, timestamp: attributed.timestamp, nearby } : null };
}
