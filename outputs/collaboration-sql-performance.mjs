import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import dotenv from '../server/node_modules/dotenv/lib/main.js';
import pg from '../server/node_modules/pg/lib/index.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as Y from '../server/node_modules/yjs/dist/yjs.mjs';
dotenv.config({ path: 'server/.env', quiet: true });
process.env.PROJECT_EDITOR_ENABLED = 'true';
const { applyEditorUpdate } = await import('../server/src/services/projectEditorDocument.service.js');
const { withEditorUpdateStore } = await import('../server/src/services/projectEditorUpdateStore.service.js');
const { readVersionedProjectFile } = await import('../server/src/services/projectFileVersion.service.js');
const { recoverProjectMutationMarkers } = await import('../server/src/services/projectMutationRecovery.service.js');
const { readEditorLineHistory } = await import('../server/src/services/projectLineHistory.service.js');
const { checkpointEditorDocuments, editorSnapshotStatus } = await import('../server/src/services/projectEditorCheckpoint.service.js');
const { openEditorDocument } = await import('../server/src/services/projectEditorDocument.service.js');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const probe = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
await client.connect(); await probe.connect();
const projectId = `perf-${randomUUID()}`, documentId = 'doc', snapshotId = 'snapshot';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-performance-'));
let queries = 0;
const query = async (strings, ...values) => {
  queries++;
  return (await client.query(strings.reduce((sql, part, i) => sql + (i ? `$${i}` : '') + part, ''), values)).rows;
};
const db = { $queryRaw: query, $executeRaw: query, $transaction: async run => {
  queries++; await client.query('BEGIN');
  try { const result = await run(db); queries++; await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
} };
try {
  const samples = [];
  for (let i = 0; i < 8; i++) { const started = performance.now(); await client.query('SELECT 1'); samples.push(Math.round(performance.now() - started)); }
  // Connection-private temporary tables shadow names only in this session.
  // Nothing is inserted into, updated in, or deleted from the user's public tables.
  await client.query(`
    CREATE TEMP TABLE "Project" (id text PRIMARY KEY, "ownerId" text, "accessRevision" int DEFAULT 0, "workspaceRevision" int DEFAULT 0, "eventSequence" int DEFAULT 0, "updatedAt" timestamp DEFAULT NOW());
    CREATE TEMP TABLE "User" (id text PRIMARY KEY,name text,email text);
    CREATE TEMP TABLE "ProjectMember" ("projectId" text, "userId" text, role text, "disciplineRole" text);
    CREATE TEMP TABLE "ProjectSnapshot" (id text PRIMARY KEY, "projectId" text, "createdAt" timestamp DEFAULT NOW(), "rootDir" text, "storagePath" text, source text);
    CREATE TEMP TABLE "ProjectEditorDocument" (id text PRIMARY KEY, "projectId" text, "snapshotId" text, "relativePath" text, generation int, revision int, "checkpointRevision" int, "stateBytes" bytea, text text, "contentHash" text, "lineAttributionJson" jsonb, active boolean, "updatedAt" timestamp DEFAULT NOW(), "baseFileHash" text, "baseFileRevision" int DEFAULT 0, "createdAt" timestamp DEFAULT NOW(), UNIQUE("snapshotId","relativePath"));
    CREATE TEMP TABLE "ProjectFileVersion" (id text PRIMARY KEY,"snapshotId" text,"relativePath" text,revision int,sha256 text,deleted boolean,"updatedByUserId" text,"lineAttributionJson" jsonb,"updatedAt" timestamp DEFAULT NOW(),UNIQUE("snapshotId","relativePath"));
    CREATE TEMP TABLE "ProjectEditorUpdate" (id text PRIMARY KEY, "documentId" text, generation int, "actorId" text, "requestId" text, "updateHash" text NOT NULL, "resultRevision" int, "resultContentHash" text, "createdAt" timestamp, UNIQUE("documentId",generation,"actorId","requestId"));
    CREATE TEMP TABLE "ProjectMutation" (id text PRIMARY KEY,"projectId" text,"snapshotId" text,"requestId" text,"actorId" text,kind text,"inputHash" text,"expectedWorkspaceRevision" int,"nextWorkspaceRevision" int,"journalPath" text,state text);
    CREATE TEMP TABLE "ProjectEvent" (id text PRIMARY KEY,"projectId" text,sequence int,type text,"actorId" text,"resourceId" text,revision int,payload jsonb,"createdAt" timestamp, UNIQUE("projectId",sequence));
    CREATE TEMP TABLE "ProjectCodeChange" (id text PRIMARY KEY, "projectId" text, "snapshotId" text, "actorId" text, source text, "createdAt" timestamp);
  `);
  const seed = new Y.Doc(); seed.getText('content').insert(0, 'baseline\n');
  const bytes = Buffer.from(Y.encodeStateAsUpdate(seed));
  const hash = createHash('sha256').update('baseline\n').digest('hex');
  await client.query("INSERT INTO \"User\" VALUES ('owner','Owner','owner@example.test'),('dev','Developer','dev@example.test')");
  await client.query('INSERT INTO "Project" (id,"ownerId") VALUES ($1,$2)', [projectId, 'owner']);
  await client.query('INSERT INTO "ProjectMember" ("projectId","userId",role) VALUES ($1,$2,$3),($1,$4,$5)', [projectId, 'dev', 'EDITOR', 'viewer', 'VIEWER']);
  await client.query('INSERT INTO "ProjectSnapshot" (id,"projectId","rootDir","storagePath",source) VALUES ($1,$2,$3,$3,$4)', [snapshotId, projectId, root, 'ZIP']);
  await fs.writeFile(path.join(root, 'a.js'), 'baseline\n');
  await client.query('INSERT INTO "ProjectFileVersion" (id,"snapshotId","relativePath",revision,sha256,deleted,"lineAttributionJson") VALUES ($1,$2,$3,0,$4,false,$5)', ['file', snapshotId, 'a.js', hash, '[]']);
  await client.query('INSERT INTO "ProjectEditorDocument" (id,"projectId","snapshotId","relativePath",generation,revision,"checkpointRevision","stateBytes",text,"contentHash","lineAttributionJson",active,"baseFileHash") VALUES ($1,$2,$3,$4,1,0,0,$5,$6,$7,$8,true,$7)', [documentId, projectId, snapshotId, 'a.js', bytes, 'baseline\n', hash, '[]']);
  const local = new Y.Doc(); Y.applyUpdate(local, bytes);
  let vector = Y.encodeStateVector(local); local.getText('content').insert(0, 'owner\n');
  const packet = { projectId, documentId, generation: 1, requestId: 'one', updateBytes: Y.encodeStateAsUpdate(local, vector), userId: 'owner', db };
  queries = 0; let start = performance.now(); const result = await applyEditorUpdate(packet);
  const durableMs = Math.round(performance.now() - start), roundtrips = queries;
  assert.equal(result.receipt.revision, 1);
  assert.equal((await applyEditorUpdate(packet)).receipt.revision, 1);
  vector = Y.encodeStateVector(local); local.getText('content').insert(0, 'dev\n');
  const next = { ...packet, userId: 'dev', requestId: 'two', updateBytes: Y.encodeStateAsUpdate(local, vector) };
  assert.equal((await applyEditorUpdate(next)).receipt.revision, 2);
  vector = Y.encodeStateVector(local); local.getText('content').insert(0, 'warm\n');
  const warm = { ...next, requestId: 'three', updateBytes: Y.encodeStateAsUpdate(local, vector), readerIds: ['owner', 'dev', 'viewer', 'outsider'] };
  queries = 0; start = performance.now(); const warmResult = await applyEditorUpdate(warm);
  const warmMs = Math.round(performance.now() - start), warmRoundtrips = queries;
  assert.equal(warmResult.receipt.revision, 3);
  assert.deepEqual(warmResult.authorizedReaderIds.sort(), ['dev', 'owner', 'viewer']);
  queries=0; start=performance.now();
  const historyInput={projectId,snapshotId,documentId,generation:1,revision:3,path:'a.js',line:1,userId:'viewer',db};
  const history=await readEditorLineHistory(historyInput);
  const lineHistoryMs=Math.round(performance.now()-start),lineHistoryQueries=queries;
  assert.equal(lineHistoryQueries,1); assert.equal(history.history.actorName,'Developer'); assert.equal(history.text,null);
  assert(history.history.nearby.length>0);
  await assert.rejects(readEditorLineHistory({...historyInput,userId:'outsider'}),{code:'RESOURCE_NOT_FOUND'});
  await assert.rejects(readEditorLineHistory({...historyInput,revision:2}),{code:'EDITOR_SYNC_REQUIRED'});
  await assert.rejects(readEditorLineHistory({...historyInput,generation:2}),{code:'EDITOR_GENERATION_CHANGED'});
  await assert.rejects(readEditorLineHistory({...historyInput,path:'other.js'}),{code:'RESOURCE_NOT_FOUND'});
  await client.query('UPDATE "ProjectMember" SET role = $1 WHERE "userId" = $2', ['VIEWER', 'dev']);
  await assert.rejects(applyEditorUpdate({ ...warm, requestId: 'downgrade-without-stamp' }), { code: 'CAPABILITY_DENIED' });
  await client.query('UPDATE "Project" SET "accessRevision" = "accessRevision" + 1');
  await assert.rejects(applyEditorUpdate({ ...warm, requestId: 'after-downgrade' }), { code: 'CAPABILITY_DENIED' });
  await client.query('UPDATE "ProjectMember" SET role = $1 WHERE "userId" = $2', ['EDITOR', 'dev']);
  await client.query('UPDATE "Project" SET "accessRevision" = "accessRevision" + 1');
  await assert.rejects(applyEditorUpdate({ ...next, userId: 'viewer' }), { code: 'CAPABILITY_DENIED' });
  await assert.rejects(applyEditorUpdate({ ...next, projectId: 'wrong-project' }), { code: 'RESOURCE_NOT_FOUND' });
  await assert.rejects(applyEditorUpdate({ ...next, generation: 99 }), { code: 'EDITOR_GENERATION_CHANGED' });
  const [row] = (await client.query('SELECT text,"lineAttributionJson" FROM "ProjectEditorDocument"')).rows;
  assert(row.text.includes('owner\n') && row.text.includes('dev\n'));
  assert.equal((await client.query('SELECT count(*)::int AS n FROM "ProjectCodeChange"')).rows[0].n, 3);
  await assert.rejects(withEditorUpdateStore({ projectId, documentId, userId: 'owner', generation: 1, requestId: 'fail', db }, async ({ persist }) => {
    await persist({ state: bytes, text: 'must rollback', contentHash: hash, revision: 3, lineMap: [], changeId: null, updateHash: null, changed: true });
  }));
  assert.equal((await client.query('SELECT text FROM "ProjectEditorDocument"')).rows[0].text, row.text);
  await withEditorUpdateStore({ projectId, documentId, userId: 'owner', generation: 1, requestId: 'lock-probe', db }, async () => {
    await probe.query('BEGIN');
    const result = await probe.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS exclusive, pg_try_advisory_xact_lock_shared(hashtextextended($1,0)) AS shared', [projectId]);
    assert.equal(result.rows[0].exclusive, false); assert.equal(result.rows[0].shared, true);
    await probe.query('ROLLBACK');
  });
  queries = 0; start = performance.now();
  const file = await readVersionedProjectFile({ projectId, snapshotId, userId: 'owner', path: 'a.js', db });
  const fileReadMs = Math.round(performance.now() - start), fileReadQueries = queries;
  assert.equal(file.content, 'baseline\n');
  queries = 0; start = performance.now();
  const opened = await openEditorDocument({ projectId, snapshotId, userId: 'owner', path: 'a.js', db });
  const openMs = Math.round(performance.now() - start), openQueries = queries;
  assert(opened.capabilities.includes('files.write')); assert.equal(opened.revision, 3);
  await fs.writeFile(path.join(root, 'new.js'), 'brand new file\n');
  queries = 0; start = performance.now();
  const firstFile = await readVersionedProjectFile({ projectId, snapshotId, userId: 'owner', path: 'new.js', db });
  const firstReadMs = Math.round(performance.now() - start), firstReadQueries = queries;
  queries = 0; start = performance.now();
  const firstOpen = await openEditorDocument({ projectId, snapshotId, userId: 'owner', path: 'new.js', db });
  const firstOpenMs = Math.round(performance.now() - start), firstOpenQueries = queries;
  assert.equal(firstFile.content, 'brand new file\n'); assert.equal(firstOpen.revision, 0);
  // Minimal model facade for the shared preflight and mutation journal creation.
  // Checkpoint fast path itself executes the real production tagged SQL.
  db.project = { findFirst: async ({where}) => {
    const actor = where.OR?.[0]?.ownerId || where.ownerId;
    return (await db.$queryRaw`SELECT p.* FROM "Project" p LEFT JOIN "ProjectMember" m ON m."projectId" = p.id AND m."userId" = ${actor} WHERE p.id = ${where.id} AND (p."ownerId" = ${actor} OR m.role IN ('EDITOR','VIEWER'))`)[0];
  } };
  db.projectMember = { findUnique: async ({where}) => (await db.$queryRaw`SELECT * FROM "ProjectMember" WHERE "projectId" = ${where.projectId_userId.projectId} AND "userId" = ${where.projectId_userId.userId}`)[0] };
  db.projectEditorDocument = { findMany: async ({where}) => db.$queryRaw`SELECT * FROM "ProjectEditorDocument" WHERE "projectId" = ${where.projectId} AND "snapshotId" = ${where.snapshotId} AND active AND id = ANY(${where.id.in}::text[])` };
  db.projectMutation = {
    create: async ({data: m}) => (await db.$queryRaw`INSERT INTO "ProjectMutation" (id,"projectId","snapshotId","requestId","actorId",kind,"inputHash","expectedWorkspaceRevision","nextWorkspaceRevision","journalPath",state) VALUES (${randomUUID()},${m.projectId},${m.snapshotId},${m.requestId},${m.actorId},${m.kind},${m.inputHash},${m.expectedWorkspaceRevision},${m.nextWorkspaceRevision},${m.journalPath},${m.state}) RETURNING *`)[0],
    findUnique: async ({where}) => (await db.$queryRaw`SELECT * FROM "ProjectMutation" WHERE "projectId" = ${where.projectId_requestId.projectId} AND "requestId" = ${where.projectId_requestId.requestId}`)[0],
  };
  queries = 0; start = performance.now();
  const status = await editorSnapshotStatus({ projectId, snapshotId, userId: 'owner', db });
  const statusMs = Math.round(performance.now() - start), statusQueries = queries;
  const checkpointInput = { projectId, snapshotId, userId: 'dev', db, documents: status.documents.filter(d => d.dirty), expectedWorkspaceRevision: status.workspaceRevision };
  queries = 0; start = performance.now();
  const checkpointResult = await checkpointEditorDocuments(checkpointInput);
  const checkpointMs = Math.round(performance.now() - start), checkpointQueries = queries;
  assert.equal(checkpointResult.workspaceRevision, 1);
  assert.equal(await fs.readFile(path.join(root,'a.js'),'utf8'), row.text);
  const saved = (await client.query('SELECT "checkpointRevision","baseFileHash","baseFileRevision","lineAttributionJson" FROM "ProjectEditorDocument" WHERE id = $1',[documentId])).rows[0];
  assert.equal(saved.checkpointRevision, 3); assert.equal(saved.baseFileRevision, 1);
  assert.deepEqual(saved.lineAttributionJson, row.lineAttributionJson);
  assert.equal((await client.query('SELECT state FROM "ProjectMutation"')).rows[0].state, 'APPLIED');
  assert.equal((await client.query('SELECT sequence FROM "ProjectEvent"')).rows[0].sequence, 1);
  await assert.rejects(checkpointEditorDocuments({...checkpointInput,userId:'viewer'}), {code:'CAPABILITY_DENIED'});
  const noOp = await checkpointEditorDocuments({...checkpointInput,expectedWorkspaceRevision:1});
  assert.equal(noOp.workspaceRevision,1);
  // Edit then undo to identical canonical bytes: checkpoint metadata must still advance.
  await client.query('UPDATE "ProjectEditorDocument" SET revision = 4 WHERE id = $1',[documentId]);
  const unchanged = await checkpointEditorDocuments({...checkpointInput,documents:[{documentId,generation:1,revision:4}],expectedWorkspaceRevision:1});
  assert.equal(unchanged.workspaceRevision,1);
  assert.equal((await client.query('SELECT "checkpointRevision" FROM "ProjectEditorDocument" WHERE id=$1',[documentId])).rows[0].checkpointRevision,4);
  const failedText = row.text + '// retry after interrupted save\n';
  const failedHash = createHash('sha256').update(failedText).digest('hex');
  await client.query('UPDATE "ProjectEditorDocument" SET revision=5,text=$1,"contentHash"=$2 WHERE id=$3',[failedText,failedHash,documentId]);
  await client.query('ALTER TABLE "ProjectEvent" ADD CONSTRAINT fixture_failure CHECK (sequence < 2)');
  const retryInput = {...checkpointInput,documents:[{documentId,generation:1,revision:5}],expectedWorkspaceRevision:1};
  await assert.rejects(checkpointEditorDocuments(retryInput));
  assert.equal((await client.query('SELECT "checkpointRevision" FROM "ProjectEditorDocument" WHERE id=$1',[documentId])).rows[0].checkpointRevision,4);
  assert.equal((await client.query('SELECT "workspaceRevision" FROM "Project"')).rows[0].workspaceRevision,1);
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectId},0))`;
    await recoverProjectMutationMarkers({tx,project:{id:projectId,workspaceRevision:1},snapshot:{id:snapshotId,projectId,rootDir:root,storagePath:root,source:'ZIP'},root});
  });
  assert.equal(await fs.readFile(path.join(root,'a.js'),'utf8'),row.text);
  await client.query('ALTER TABLE "ProjectEvent" DROP CONSTRAINT fixture_failure');
  assert.equal((await checkpointEditorDocuments(retryInput)).workspaceRevision,2);
  assert.equal(await fs.readFile(path.join(root,'a.js'),'utf8'),failedText);
  const grouped = (await client.query('SELECT id,text,"relativePath" FROM "ProjectEditorDocument" WHERE id = ANY($1::text[])',[[documentId,firstOpen.documentId]])).rows;
  for (const item of grouped) {
    item.text += '// grouped checkpoint\n';
    await client.query('UPDATE "ProjectEditorDocument" SET revision=revision+1,text=$1,"contentHash"=$2 WHERE id=$3',[item.text,createHash('sha256').update(item.text).digest('hex'),item.id]);
  }
  const groupedStatus = await editorSnapshotStatus({projectId,snapshotId,userId:'owner',db});
  queries=0; start=performance.now();
  assert.equal((await checkpointEditorDocuments({...checkpointInput,documents:groupedStatus.documents.filter(d=>d.dirty),expectedWorkspaceRevision:2})).workspaceRevision,3);
  const groupedCheckpointMs=Math.round(performance.now()-start), groupedCheckpointQueries=queries;
  assert.equal(groupedCheckpointQueries,checkpointQueries,'Checkpoint query count must not grow per file');
  for (const item of grouped) assert.equal(await fs.readFile(path.join(root,item.relativePath),'utf8'),item.text);
  local.destroy(); seed.destroy();
  console.log(JSON.stringify({ remoteSelectMs: samples, coldUpdateMs: durableMs, coldRoundtrips: roundtrips, warmUpdateMs: warmMs, warmRoundtrips, fileReadMs, fileReadQueries, openMs, openQueries, firstReadMs, firstReadQueries, firstOpenMs, firstOpenQueries, statusMs, statusQueries, checkpointMs, checkpointQueries, groupedCheckpointMs, groupedCheckpointQueries, lineHistoryMs, lineHistoryQueries, checks: 'owner/dev update, replay, viewer, recipient filter, downgrade invalidation, forged project, stale generation, atomic rollback, shared project versus exclusive checkpoint lock, file read/open, checkpoint bytes/attribution/event, viewer save denied, repeated save, unchanged bytes checkpoint, failed publication rollback and journal recovery/retry, two-file atomic checkpoint with constant query count: passed', publicTablesChanged: false }));
} finally { await client.end(); await probe.end(); assert.equal(path.dirname(root), os.tmpdir()); await fs.rm(root, { recursive: true, force: true }); }
