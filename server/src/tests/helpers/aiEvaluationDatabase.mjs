import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/** Disposable, in-memory PostgreSQL engine. Never reads or connects to DATABASE_URL. */
export async function evaluationDatabase() {
    const serverDir = fileURLToPath(new URL('../../../', import.meta.url));
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-evaluation-test-'));
    const schema = await fs.readFile(path.join(serverDir, 'prisma/schema.prisma'), 'utf8');
    const before = schema.replace(/^model AiEvaluation\w+ \{[\s\S]*?^\}\r?\n/gm, '').replace(/^.*AiEvaluation.*\r?\n/gm, '').replace(/^  AI_EVALUATION(?:_PREPARE)?\r?\n/gm, '');
    const baselinePath = path.join(temporary, 'baseline.prisma');
    await fs.writeFile(baselinePath, before);
    const sql = execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema', baselinePath, '--script'], { cwd: serverDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const engine = await PGlite.create();
    await engine.exec(sql);
    await engine.exec(await fs.readFile(path.join(serverDir, 'prisma/migrations/20261030120000_ai_evaluation/migration.sql'), 'utf8'));
    const socket = new PGLiteSocketServer({ db: engine, host: '127.0.0.1', port: 0 });
    await socket.start();
    const connection = socket.getServerConn();
    const pool = new Pool({ connectionString: connection.startsWith('postgres') ? connection : `postgresql://postgres:postgres@${connection}/postgres`, max: 1 });
    const db = new PrismaClient({ adapter: new PrismaPg(pool) });
    return { db, engine, close: async () => { await db.$disconnect(); await pool.end().catch(() => {}); await socket.stop(); await engine.close(); if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('covai-evaluation-test-')) throw new Error('Unsafe temporary cleanup path'); await fs.rm(temporary, { recursive: true, force: true }); } };
}
