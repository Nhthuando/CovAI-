import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
import { assertCollaborationTestDatabase } from '../src/tests/helpers/collaborationDb.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const server = path.join(root, 'server');
const work = path.join(root, 'tmp/collaboration-evidence');
fs.mkdirSync(work, { recursive: true });
const envFile = path.join(work, 'runtime-env.json');
let settings;
if (fs.existsSync(envFile)) settings = JSON.parse(fs.readFileSync(envFile, 'utf8'));
else {
    settings = {
        DATABASE_URL: 'postgresql://covai_test:collaboration-local-only@127.0.0.1:55432/covai_collaboration_test',
        REDIS_URL: 'redis://127.0.0.1:56379', JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        PORT: '55000', CLIENT_URL: 'http://127.0.0.1:55173', VITE_API_URL: 'http://127.0.0.1:55000/api',
        VITE_SOCKET_URL: 'http://127.0.0.1:55000', VITE_PROXY_TARGET: 'http://127.0.0.1:55000',
        PROJECT_COLLABORATION_ENABLED: 'true', COLLABORATION_E2E_ENABLED: 'true',
        PROJECT_STORAGE_DRIVER: 'local', PROJECT_STORAGE_ROOT: path.join(work, 'storage'),
        SMTP_HOST: '127.0.0.1', SMTP_PORT: '51025', SMTP_SECURE: 'false', EMAIL_FROM: 'CovAI <test@covai.test>',
        AI_PROVIDER_MODE: 'fixture', DISABLE_DOCKER_RUNNER: 'true',
    };
    fs.writeFileSync(envFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
}
assertCollaborationTestDatabase(settings.DATABASE_URL);
const env = { ...process.env, ...settings };
const compose = ['compose', '-f', path.join(root, 'docker-compose.collaboration-test.yml')];
export function run(command, args, cwd = root, logName) {
    return new Promise((resolve, reject) => {
        const out = logName ? fs.openSync(path.join(work, logName), 'w') : null;
        const proc = spawn(command, args, { cwd, env, stdio: out === null ? 'inherit' : ['ignore', out, out], windowsHide: true });
        proc.on('error', reject);
        proc.on('exit', code => { if (out !== null) fs.closeSync(out); code === 0 ? resolve(code) : reject(new Error(`${path.basename(command)} exited ${code}; ${logName || 'see output'}`)); });
    });
}
const prisma = args => run(process.execPath, ['node_modules/prisma/build/index.js', ...args], server);
async function prepare() {
    await run('docker', [...compose, 'up', '-d', '--wait']);
    await run('docker', [...compose, 'images', '--format', 'json'], root, 'docker-images.json');
    await prisma(['migrate', 'deploy']);
    await prisma(['generate']);
}
async function bootstrapExistingSchema() {
    // Historical migrations in the source repository cannot replay on a fresh DB
    // (20260822090000 references TestType before creation). This explicit command
    // bootstraps ONLY an empty, named disposable DB; never an existing user DB.
    assertCollaborationTestDatabase(settings.DATABASE_URL);
    const db = new Pool({ connectionString: settings.DATABASE_URL });
    try {
        const exists = await db.query(`SELECT to_regclass('public."User"') AS users, to_regclass('public."Project"') AS projects`);
        for (const [field, table] of [['users', 'User'], ['projects', 'Project']]) {
            if (exists.rows[0][field]) {
                const count = await db.query(`SELECT COUNT(*) AS n FROM "${table}"`);
                if (Number(count.rows[0].n) !== 0) throw new Error('Bootstrap requires an empty disposable DB; preserving existing test data');
            }
        }
        await db.query('BEGIN');
        await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
        await db.query(fs.readFileSync(path.join(server, 'scripts/fixtures/collaboration-prefeature.sql'), 'utf8'));
        await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { await db.end(); }
    const migrations = fs.readdirSync(path.join(server, 'prisma/migrations'), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name < '20261028090000_project_collaboration').map(entry => entry.name).sort();
    for (const migration of migrations) await prisma(['migrate', 'resolve', '--applied', migration]);
    await prisma(['migrate', 'deploy']);
}
async function background(name, args, cwd) {
    const pidFile = path.join(work, `${name}.pid`);
    if (fs.existsSync(pidFile)) {
        const pid = Number(fs.readFileSync(pidFile, 'utf8'));
        try { process.kill(pid, 0); throw new Error(`${name} already running with pid ${pid}`); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    const out = fs.openSync(path.join(work, `${name}.log`), 'a');
    const proc = spawn(process.execPath, args, { cwd, env, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
    await new Promise((resolve, reject) => { proc.once('spawn', resolve); proc.once('error', reject); });
    fs.writeFileSync(pidFile, String(proc.pid));
    proc.unref();
    fs.closeSync(out);
}
async function start() {
    await background('server', ['index.js'], server);
    await background('client', ['node_modules/vite/bin/vite.js', ...(process.argv.includes('--preview') ? ['preview'] : []), '--host', '127.0.0.1', '--port', '55173', '--strictPort'], path.join(root, 'client'));
    for (let attempt = 0; attempt < 90; attempt++) {
        try {
            const [api, ui] = await Promise.all([fetch('http://127.0.0.1:55000/api/health'), fetch('http://127.0.0.1:55173')]);
            if (api.ok && ui.ok) { console.log('CovAI test stack ready: http://127.0.0.1:55173'); return; }
        } catch { /* server is starting */ }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Local stack did not become ready; inspect server.log/client.log');
}
async function stop() {
    await stopProcesses();
    await run('docker', [...compose, 'stop']);
}
async function stopProcesses() {
    for (const name of ['server', 'client']) {
        const pidFile = path.join(work, `${name}.pid`);
        if (!fs.existsSync(pidFile)) continue;
        const pid = Number(fs.readFileSync(pidFile, 'utf8'));
        try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        fs.rmSync(pidFile);
    }
}
async function baseline() {
    isolateProviderTests();
    const stamp = new Date().toISOString().replaceAll(':', '-');
    const checks = [
        ['build', process.execPath, ['node_modules/vite/bin/vite.js', 'build'], path.join(root, 'client')],
        ['lint', process.execPath, ['node_modules/eslint/bin/eslint.js', '.'], path.join(root, 'client')],
        ['jest', process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--runInBand', '--json', `--outputFile=${path.join(work, `jest-${stamp}.json`)}`], server],
    ];
    const results = {};
    for (const [name, command, args, cwd] of checks) {
        try { await run(command, args, cwd, `${name}-${stamp}.log`); results[name] = 'PASS'; }
        catch (error) { results[name] = error.message; }
    }
    fs.writeFileSync(path.join(work, `checks-${stamp}.json`), JSON.stringify(results, null, 2));
    console.log(results);
    if (Object.values(results).some(value => value !== 'PASS')) process.exitCode = 1;
}
const command = process.argv[2];
function isolateProviderTests() {
    // Tests exercise SDK mocks. Never inherit a real provider key through dotenv.
    env.AI_PROVIDER_MODE = '';
    env.GEMINI_API_KEY = '';
    env.GOOGLE_API_KEY = '';
    env.COVAI_OFFLINE_TESTS = 'true';
}
if (command === 'prepare') await prepare();
else if (command === 'bootstrap-empty') await bootstrapExistingSchema();
else if (command === 'start') await start();
else if (command === 'restart') { await stopProcesses(); await start(); }
else if (command === 'build') await run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], path.join(root, 'client'));
else if (command === 'stop') await stop();
else if (command === 'baseline') await baseline();
else if (command === 'test') await run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'e2e/collaboration.config.mjs'], server);
else if (command === 'prisma') await prisma(process.argv.slice(3));
else if (command === 'exec') { isolateProviderTests(); await run(process.execPath, process.argv.slice(3), server); }
else throw new Error('Use prepare|start|stop|baseline|test|prisma <args>|exec <node args>');
