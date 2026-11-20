import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import {
    detectIntegrationRuntimePlan,
    prepareIntegrationDatabase,
} from '../services/integrationRuntimeDatabase.service.js';
import { generateSupertestSetupScript } from '../services/databaseMockTemplate.service.js';

const tempDirs = [];
const makeTempProject = (files = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-int-db-'));
    tempDirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
        const target = path.join(dir, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
    }
    return dir;
};

afterEach(() => {
    while (tempDirs.length > 0) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
});

describe('integrationRuntimeDatabase.service', () => {
    it('returns null database/services when project uses no database or redis', () => {
        const root = makeTempProject({
            'package.json': JSON.stringify({ name: 'pure-api', dependencies: { express: '^5.0.0' } }),
        });
        expect(detectIntegrationRuntimePlan(root)).toEqual({
            database: null,
            services: null,
            backendDir: root,
        });
    });

    it('detects Prisma PostgreSQL + Redis in server/ subproject', () => {
        const root = makeTempProject({
            'package.json': JSON.stringify({ name: 'mono' }),
            'server/package.json': JSON.stringify({
                dependencies: { express: '^5.0.0', '@prisma/client': '^6.0.0', ioredis: '^5.0.0' },
            }),
            'server/prisma/schema.prisma': 'datasource db { provider = "postgresql"\n url = env("DATABASE_URL") }',
        });
        const plan = detectIntegrationRuntimePlan(root);
        expect(plan.database).toEqual({
            engine: 'postgres',
            prismaSchema: path.join(root, 'server', 'prisma', 'schema.prisma'),
            schemaStrategy: 'push',
        });
        expect(plan.services).toEqual({ redis: true });
        expect(plan.backendDir).toBe(path.join(root, 'server'));
    });

    it('detects MongoDB, MySQL with init.sql, and SQLite engines', () => {
        const mongoRoot = makeTempProject({
            'package.json': JSON.stringify({ dependencies: { mongoose: '^8.0.0' } }),
        });
        expect(detectIntegrationRuntimePlan(mongoRoot).database).toEqual({ engine: 'mongodb' });

        const mysqlRoot = makeTempProject({
            'package.json': JSON.stringify({ dependencies: { mysql2: '^3.0.0' } }),
            'schema.sql': 'CREATE TABLE users (id INT PRIMARY KEY);',
        });
        expect(detectIntegrationRuntimePlan(mysqlRoot).database).toEqual({
            engine: 'mysql',
            initSql: path.join(mysqlRoot, 'schema.sql'),
        });

        const sqliteRoot = makeTempProject({
            'package.json': JSON.stringify({ dependencies: { 'better-sqlite3': '^11.0.0' } }),
        });
        expect(detectIntegrationRuntimePlan(sqliteRoot).database).toEqual({ engine: 'sqlite' });
    });

    it('provisions isolated database, syncs schema, and cleans up on schema failure', async () => {
        const root = makeTempProject({
            'package.json': JSON.stringify({ dependencies: { mongoose: '^8.0.0' } }),
        });
        const cleanup = jest.fn().mockResolvedValue(undefined);
        const provision = jest.fn().mockResolvedValue({
            environment: { MONGODB_URI: 'mongodb://covai-system-mongodb-1:27017/covai_test' },
            sqlContainer: null,
            engine: 'mongodb',
            cleanup,
        });
        const syncSchema = jest.fn().mockResolvedValue({ synced: false, reason: 'NO_SCHEMA_SYNC_REQUIRED' });

        const session = await prepareIntegrationDatabase({
            jobId: 'job-int-1',
            rootDir: root,
            dependencies: { provision, syncSchema },
        });
        expect(session.active).toBe(true);
        expect(session.engine).toBe('mongodb');
        expect(session.environment.MONGODB_URI).toContain('covai-system-mongodb-1');
        await session.cleanup();
        expect(cleanup).toHaveBeenCalledTimes(1);

        const failingSync = jest.fn().mockRejectedValue(new Error('schema failed'));
        await expect(
            prepareIntegrationDatabase({
                jobId: 'job-int-2',
                rootDir: root,
                dependencies: { provision, syncSchema: failingSync },
            })
        ).rejects.toThrow('schema failed');
        expect(cleanup).toHaveBeenCalledTimes(2);
    });

    it('omits Prisma and Mongoose mocks while preserving runtime-evidence interceptor when disableDatabaseMock is true', () => {
        const script = generateSupertestSetupScript(
            { hasPrisma: true, hasMongoose: true },
            { disableDatabaseMock: true }
        );
        expect(script).toContain('runtime-evidence.json');
        expect(script).not.toContain("jest.mock('@prisma/client'");
        expect(script).not.toContain("jest.mock('mongoose'");
        expect(script).not.toContain('covai_test_db');
    });

    it('defaults prepareIntegrationDatabase to zero-Docker schema-aware mock mode when no Docker provisioner is injected', async () => {
        const root = makeTempProject({
            'package.json': JSON.stringify({ dependencies: { '@prisma/client': '^6.0.0', ioredis: '^5.0.0' } }),
            'prisma/schema.prisma': 'datasource db { provider = "postgresql"\n url = env("DATABASE_URL") }\nmodel Article { id Int @id @default(autoincrement())\n title String }',
        });

        const session = await prepareIntegrationDatabase({
            jobId: 'job-mock-1',
            rootDir: root,
        });
        expect(session.active).toBe(true);
        expect(session.mode).toBe('mock');
        expect(session.useLiveDatabase).toBe(false);
        expect(session.environment.COVAI_MOCK_DB).toBe('true');
        expect(session.dbInfo.hasPrisma).toBe(true);
        expect(session.dbInfo.prismaSeeds.article).toHaveLength(4);
        await session.cleanup();
    });
});
