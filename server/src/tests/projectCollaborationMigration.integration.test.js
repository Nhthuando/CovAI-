import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { assertCollaborationTestDatabase } from './helpers/collaborationDb.js';

const suite = process.env.COLLABORATION_INTEGRATION === 'true' ? describe : describe.skip;
suite('collaboration migration on the captured pre-feature schema', () => {
    let pool, connection, schema;
    beforeAll(async () => {
        assertCollaborationTestDatabase(process.env.DATABASE_URL);
        schema = `collaboration_migration_${randomUUID().replaceAll('-', '')}`;
        if (!/^collaboration_migration_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema');
        pool = new Pool({ connectionString: process.env.DATABASE_URL });
        connection = await pool.connect();
        await connection.query(`CREATE SCHEMA "${schema}"`);
        await connection.query(`SET search_path TO "${schema}"`);
        await connection.query(await fs.readFile(path.resolve('scripts/fixtures/collaboration-prefeature.sql'), 'utf8'));
    });
    afterAll(async () => {
        if (connection) { await connection.query('SET search_path TO public'); await connection.query(`DROP SCHEMA "${schema}" CASCADE`); connection.release(); }
        if (pool) await pool.end();
    });
    test('preserves chat history, retains forgotten-memory tombstone and remaps references', async () => {
        await connection.query(`INSERT INTO "User" (id,email,"updatedAt") VALUES ('owner','owner@migration.test',NOW()),('creator','creator@migration.test',NOW())`);
        await connection.query(`INSERT INTO "Project" (id,"ownerId",name,"updatedAt") VALUES ('project','owner','Legacy project',NOW())`);
        await connection.query(`INSERT INTO "ChatSession" (id,"projectId","userId","updatedAt") VALUES ('session','project','creator',NOW())`);
        await connection.query(`INSERT INTO "ChatMessage" (id,"sessionId",role,content) VALUES ('message','session','user','Retain this exact message'),('assistant','session','assistant','Legacy answer')`);
        await connection.query(`INSERT INTO "ProjectMemory" (id,"projectId","userId",content,fingerprint,status,"updatedAt") VALUES
            ('active','project','owner','Duplicate active note','same','ACTIVE',NOW()),
            ('forgotten','project','creator','','same','FORGOTTEN',NOW()),
            ('reference','project','owner','Other note','different','ACTIVE',NOW())`);
        await connection.query(`UPDATE "ProjectMemory" SET "conflictsWithId"='active' WHERE id='reference'`);
        await connection.query('BEGIN');
        try {
            await connection.query(await fs.readFile(path.resolve('prisma/migrations/20261028090000_project_collaboration/migration.sql'), 'utf8'));
            await connection.query('COMMIT');
        } catch (error) { await connection.query('ROLLBACK'); throw error; }
        await connection.query(`INSERT INTO "ProjectOperation" (id,"projectId","actorId",capability,type,"requestId","semanticKey","capturedWorkspaceRevision",status,"updatedAt")
            VALUES ('legacy-operation','project','creator','tests.run','RUN_TESTS','legacy-request','legacy-semantic',0,'SUCCESS',NOW())`);
        await connection.query(await fs.readFile(path.resolve('prisma/migrations/20261028163000_operation_request_aliases/migration.sql'), 'utf8'));
        expect((await connection.query(`SELECT "projectId","actorId","requestId","operationId" FROM "ProjectOperationRequest"`)).rows).toEqual([
            { projectId: 'project', actorId: 'creator', requestId: 'legacy-request', operationId: 'legacy-operation' },
        ]);
        const messages = (await connection.query(`SELECT id,content,"senderUserId" FROM "ChatMessage" ORDER BY id`)).rows;
        expect(messages).toEqual([
            { id: 'assistant', content: 'Legacy answer', senderUserId: null },
            { id: 'message', content: 'Retain this exact message', senderUserId: 'creator' },
        ]);
        const notes = (await connection.query(`SELECT id,status,"conflictsWithId" FROM "ProjectMemory" ORDER BY id`)).rows;
        expect(notes).toEqual([
            { id: 'forgotten', status: 'FORGOTTEN', conflictsWithId: null },
            { id: 'reference', status: 'ACTIVE', conflictsWithId: 'forgotten' },
        ]);
        expect((await connection.query(`SELECT COUNT(*) AS n FROM "ProjectMember"`)).rows[0].n).toBe('0');
        await connection.query(`DELETE FROM "User" WHERE id='creator'`);
        expect((await connection.query(`SELECT COUNT(*) AS n FROM "ProjectOperationRequest"`)).rows[0].n).toBe('0');
        expect((await connection.query(`SELECT "actorId" FROM "ProjectOperation" WHERE id='legacy-operation'`)).rows[0].actorId).toBeNull();
        expect((await connection.query(`SELECT "userId" FROM "ChatSession" WHERE id='session'`)).rows[0].userId).toBeNull();
        expect((await connection.query(`SELECT COUNT(*) AS n FROM "ChatMessage"`)).rows[0].n).toBe('2');
        await expect(connection.query(`INSERT INTO "ProjectMember" (id,"projectId","userId",role) VALUES ('illegal','project','owner','OWNER')`)).rejects.toMatchObject({ code: '23514' });
    });
});
