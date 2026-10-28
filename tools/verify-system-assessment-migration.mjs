import { execFileSync } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from '../server/node_modules/pg/lib/index.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const container = 'covai-assessment-migration-' + crypto.randomUUID();
const password = crypto.randomBytes(16).toString('hex');
const docker = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
let pool;
try {
    docker(['run', '-d', '--name', container, '--label', 'covai.assessment-validation=true', '-p', '127.0.0.1::5432', '-e', 'POSTGRES_DB=covai_test', '-e', 'POSTGRES_USER=covai', '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:17']);
    const port = Number(docker(['port', container, '5432/tcp']).trim().split(':').at(-1));
    let ready = false;
    for (let i = 0; i < 60; i++) { try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'covai', '-d', 'covai_test']); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); } }
    assert(ready);
    const url = `postgresql://covai:${password}@127.0.0.1:${port}/covai_test`;
    pool = new pg.Pool({ connectionString: url });
    // The repository's historical migrations lack a complete initial TestType baseline.
    // Validate this additive migration against the actual pre-change schema, never repair historical production migrations here.
    const baselineSql = execFileSync(process.execPath, [path.join(repository, 'server/node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema', path.join(repository, 'temp/system-assessment-before.prisma'), '--script'], { cwd: path.join(repository, 'server'), env: { ...process.env, DATABASE_URL: url }, windowsHide: true, timeout: 120000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    await pool.query(baselineSql);
    await pool.query(fs.readFileSync(path.join(repository, 'server/prisma/migrations/20261013090000_system_assessment_evidence/migration.sql'), 'utf8'));
    const result = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='TestRun' AND column_name='systemMeasurement'");
    assert.equal(result.rows.length, 1);
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('SystemTestAssessment','SystemTestProposal','SystemRequirementRevision','SystemAssertionBinding','SystemMutationRun')");
    assert.equal(tables.rows.length, 5);
    console.log('Additive migration applies to the pre-change schema on disposable PostgreSQL; evidence column and five models verified. Historical migration baseline remains a separate limitation.');
} finally { await pool?.end(); docker(['rm', '-f', container]); }
