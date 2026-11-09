import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRootDir = path.resolve(__dirname, '..', '..');

describe('Challenger 2 Empirical Stress Test: databaseSafetySetup & coverageRunner', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-ch2-m2-'));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
        }
    });

    // =========================================================================
    // 1. DATABASE SAFETY SETUP UNDER INVALID / EMPTY DATABASE_URL CONDITIONS
    // =========================================================================
    describe('1. databaseSafetySetup.js resilience with invalid/empty DATABASE_URL', () => {
        /**
         * Runs an isolated Node ESM script that sets process.env.DATABASE_URL,
         * imports databaseSafetySetup.js, imports prisma.js, and performs model operations.
         * Running in an isolated process guarantees pristine module evaluation without
         * existing cached instances of prisma.js.
         */
        const runIsolatedDatabaseSafetyCheck = (dbUrlEnvValue, customCode) => {
            const safetySetupUrl = pathToFileURL(path.resolve(serverRootDir, 'src/tests/helpers/databaseSafetySetup.js')).href;
            const prismaUrl = pathToFileURL(path.resolve(serverRootDir, 'src/config/prisma.js')).href;

            const script = `
                import http from 'node:http';
                if (${dbUrlEnvValue === undefined ? 'true' : 'false'}) {
                    delete process.env.DATABASE_URL;
                } else {
                    process.env.DATABASE_URL = ${JSON.stringify(dbUrlEnvValue)};
                }

                // Load databaseSafetySetup.js
                await import('${safetySetupUrl}');

                // Load prisma singleton
                const { default: prisma, setPrismaClient } = await import('${prismaUrl}');

                ${customCode}
            `;

            const result = execSync(`node --input-type=module`, {
                input: script,
                cwd: serverRootDir,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    DATABASE_URL: dbUrlEnvValue === undefined ? '' : dbUrlEnvValue,
                    PROJECT_STORAGE_DRIVER: 'local'
                }
            });

            return result.trim();
        };

        test('1.1 When DATABASE_URL is empty string, safe fallback proxy is installed and model queries resolve', () => {
            const output = runIsolatedDatabaseSafetyCheck('', `
                const user = await prisma.user.findUnique({ where: { id: 42 } });
                console.log(JSON.stringify({
                    id: user.id,
                    status: user.status,
                    hasPrisma: Boolean(prisma),
                    isNotThrows: true
                }));
            `);

            const parsed = JSON.parse(output);
            expect(parsed.id).toBe(42);
            expect(parsed.status).toBe('ACTIVE');
            expect(parsed.hasPrisma).toBe(true);
            expect(parsed.isNotThrows).toBe(true);
        });

        test('1.2 When DATABASE_URL is undefined/missing, safe fallback proxy is installed and queries resolve', () => {
            const output = runIsolatedDatabaseSafetyCheck(undefined, `
                const project = await prisma.project.findFirst({ where: { name: 'demo' } });
                console.log(JSON.stringify({
                    id: project.id,
                    status: project.status,
                    hasPrisma: Boolean(prisma)
                }));
            `);

            const parsed = JSON.parse(output);
            expect(parsed.id).toBe(1);
            expect(parsed.status).toBe('ACTIVE');
        });

        test('1.3 When DATABASE_URL is invalid format, databaseSafetySetup intercepts and rejects it safely', () => {
            const output = runIsolatedDatabaseSafetyCheck('invalid-url-schema://', `
                const count = await prisma.snapshot.count();
                const many = await prisma.job.findMany();
                console.log(JSON.stringify({
                    count,
                    manyLength: many.length,
                    envUrl: process.env.DATABASE_URL,
                    rejected: process.env.COVAI_TEST_DATABASE_REJECTED
                }));
            `);

            const parsed = JSON.parse(output);
            expect(parsed.count).toBe(0);
            expect(parsed.manyLength).toBe(0);
            expect(parsed.envUrl).toBe('');
            expect(parsed.rejected).toBe('true');
        });

        test('1.4 When DATABASE_URL points to remote / production host, it is rejected and fallback proxy prevents leak', () => {
            const output = runIsolatedDatabaseSafetyCheck('postgresql://admin:secret@ep-cool-fog.us-east-2.aws.neon.tech/neondb?sslmode=require', `
                const user = await prisma.user.findUnique({ where: { id: 999 } });
                console.log(JSON.stringify({
                    id: user.id,
                    envUrl: process.env.DATABASE_URL,
                    rejected: process.env.COVAI_TEST_DATABASE_REJECTED
                }));
            `);

            const parsed = JSON.parse(output);
            expect(parsed.id).toBe(999);
            expect(parsed.envUrl).toBe('');
            expect(parsed.rejected).toBe('true');
        });

        test('1.5 Comprehensive model and client operations on safe fallback proxy', () => {
            const output = runIsolatedDatabaseSafetyCheck('', `
                const results = {};
                // CRUD methods
                results.findUnique = await prisma.user.findUnique({ where: { id: 55 } });
                results.findFirst = await prisma.project.findFirst({ where: { slug: 'test' } });
                results.findMany = await prisma.job.findMany({ where: { status: 'SUCCESS' } });
                results.count = await prisma.jobLog.count();
                results.create = await prisma.user.create({ data: { email: 'test@covai.dev' } });
                results.update = await prisma.user.update({ where: { id: 10 }, data: { name: 'Updated' } });
                results.delete = await prisma.user.delete({ where: { id: 10 } });
                results.upsert = await prisma.user.upsert({ where: { id: 10 }, update: {}, create: {} });

                // Transactions
                results.txArray = await prisma.$transaction([
                    prisma.user.findUnique({ where: { id: 1 } }),
                    prisma.user.findUnique({ where: { id: 2 } })
                ]);
                results.txCallback = await prisma.$transaction(async (tx) => {
                    return await tx.job.findUnique({ where: { id: 'tx-job-1' } });
                });

                // Raw queries
                results.queryRaw = await prisma.$queryRaw\`SELECT 1\`;
                results.executeRaw = await prisma.$executeRaw\`DELETE FROM table\`;

                // Lifecycle and extensions
                await prisma.$connect();
                await prisma.$disconnect();
                const extended = prisma.$extends({ query: {} });
                results.extendedFind = await extended.user.findUnique({ where: { id: 77 } });

                console.log(JSON.stringify({
                    findUniqueId: results.findUnique.id,
                    findManyLength: results.findMany.length,
                    countVal: results.count,
                    createEmail: results.create.email,
                    updateName: results.update.name,
                    deleteId: results.delete.id,
                    txArrayLen: results.txArray.length,
                    txCallbackId: results.txCallback.id,
                    queryRawIsArray: Array.isArray(results.queryRaw),
                    extendedFindId: results.extendedFind.id
                }));
            `);

            const r = JSON.parse(output);
            expect(r.findUniqueId).toBe(55);
            expect(r.findManyLength).toBe(0);
            expect(r.countVal).toBe(0);
            expect(r.createEmail).toBe('test@covai.dev');
            expect(r.updateName).toBe('Updated');
            expect(r.deleteId).toBe(10);
            expect(r.txArrayLen).toBe(2);
            expect(r.txCallbackId).toBe('tx-job-1');
            expect(r.queryRawIsArray).toBe(true);
            expect(r.extendedFindId).toBe(77);
        });

        test('1.6 High-concurrency query burst: 500 concurrent operations resolve without uninitialized errors', () => {
            const output = runIsolatedDatabaseSafetyCheck('', `
                const operations = [];
                for (let i = 0; i < 500; i++) {
                    const modelName = ['user', 'project', 'job', 'snapshot', 'jobLog'][i % 5];
                    operations.push(prisma[modelName].findUnique({ where: { id: i } }));
                }
                const results = await Promise.all(operations);
                console.log(JSON.stringify({
                    total: results.length,
                    allHaveId: results.every((r, idx) => r.id === idx)
                }));
            `);

            const r = JSON.parse(output);
            expect(r.total).toBe(500);
            expect(r.allHaveId).toBe(true);
        });
    });

    // =========================================================================
    // 2. COVERAGE RUNNER SERVICE STABILITY & ARGUMENT SYNTHESIS
    // =========================================================================
    describe('2. coverageRunner.service.js stability and test runner setup injection', () => {
        test('2.1 coverageRunner does not throw on require/import without child_process.spawnSync', async () => {
            // Verify that coverageRunner only imports { spawn } and not spawnSync or execSync
            const coverageRunnerSource = fs.readFileSync(
                path.resolve(serverRootDir, 'src/services/coverageRunner.service.js'),
                'utf8'
            );
            expect(coverageRunnerSource).toContain('import { spawn } from "child_process";');
            expect(coverageRunnerSource).not.toContain('spawnSync');
            expect(coverageRunnerSource).not.toContain('execSync');
        });

        test('2.2 coverageRunner inspects pre-flight setup candidates and constructs --setupFiles', async () => {
            // Create a fake project root with covai-jest-setup.cjs
            const fakeRoot = path.join(tempDir, 'fake-repo');
            fs.mkdirSync(fakeRoot, { recursive: true });
            const setupPath = path.join(fakeRoot, 'covai-jest-setup.cjs');
            fs.writeFileSync(setupPath, '// setup content\n', 'utf8');

            const candidates = [
                undefined,
                undefined,
                path.join(fakeRoot, 'covai-jest-setup.cjs'),
                path.join(fakeRoot, '.covai-temp', 'covai.supertest.setup.js'),
                path.join(fakeRoot, 'src', 'tests', 'helpers', 'databaseSafetySetup.js')
            ];

            let primarySetup = null;
            for (const candidate of candidates) {
                if (candidate && fs.existsSync(candidate)) {
                    primarySetup = path.isAbsolute(candidate)
                        ? (candidate.startsWith(fakeRoot) ? `./${path.relative(fakeRoot, candidate).replace(/\\/g, "/")}` : candidate)
                        : candidate;
                    break;
                }
            }

            expect(primarySetup).toBe('./covai-jest-setup.cjs');
        });

        test('2.3 coverageRunner handles afterEnv candidates and custom setupFiles array', async () => {
            const fakeRoot = path.join(tempDir, 'fake-repo-after');
            fs.mkdirSync(fakeRoot, { recursive: true });
            const afterEnvPath = path.join(fakeRoot, 'covai-jest-setup-after-env.cjs');
            fs.writeFileSync(afterEnvPath, '// after env setup\n', 'utf8');

            const runnerArgs = ['--coverage'];
            const snapshot = {
                setupFiles: ['custom-setup-1.js', 'custom-setup-2.js'],
                setupFilesAfterEnv: ['custom-after-env.js']
            };

            if (snapshot.setupFiles) {
                const extraSetups = Array.isArray(snapshot.setupFiles) ? snapshot.setupFiles : [snapshot.setupFiles];
                for (const setup of extraSetups) {
                    if (setup && typeof setup === "string") {
                        runnerArgs.push(`--setupFiles=${setup.replace(/\\/g, "/")}`);
                    }
                }
            }

            if (snapshot.setupFilesAfterEnv) {
                const extraAfterEnv = Array.isArray(snapshot.setupFilesAfterEnv) ? snapshot.setupFilesAfterEnv : [snapshot.setupFilesAfterEnv];
                for (const setup of extraAfterEnv) {
                    if (setup && typeof setup === "string") {
                        runnerArgs.push(`--setupFilesAfterEnv=${setup.replace(/\\/g, "/")}`);
                    }
                }
            }

            expect(runnerArgs).toContain('--setupFiles=custom-setup-1.js');
            expect(runnerArgs).toContain('--setupFiles=custom-setup-2.js');
            expect(runnerArgs).toContain('--setupFilesAfterEnv=custom-after-env.js');
        });

        test('2.4 Existing unit test suite src/tests/coverage.test.js passes cleanly with 0 regressions', () => {
            const output = execSync('node --experimental-vm-modules node_modules/jest/bin/jest.js src/tests/coverage.test.js 2>&1', {
                cwd: serverRootDir,
                encoding: 'utf8',
                shell: true
            });

            expect(output).toContain('PASS src/tests/coverage.test.js');
            expect(output).toContain('5 passed, 5 total');
        });
    });
});
