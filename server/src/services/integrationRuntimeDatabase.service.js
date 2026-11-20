import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ServiceError } from '../utils/serviceError.js';
import { addJobLog } from './job.service.js';
import { dockerRunner } from './dockerRunner.service.js';
import { provisionSystemResources } from './systemRuntimeResources.service.js';
import { detectProjectDatabase } from './databaseMockTemplate.service.js';
import { scanRuntimePackages } from './projectRuntimePlan.service.js';
import { resolveProjectPrismaCli } from '../utils/projectPrismaCli.js';

const PACKAGE_PRIORITY_DIRS = ['.', 'server', 'backend', 'api'];

const readPrismaProvider = (schemaPath) => {
    try {
        const content = fs.readFileSync(schemaPath, 'utf8');
        const provider = content.match(/datasource\s+\w+\s*\{[^}]*\bprovider\s*=\s*"(mysql|postgresql|sqlite|mongodb)"/)?.[1];
        if (!provider) return null;
        return provider === 'postgresql' ? 'postgres' : provider;
    } catch {
        return null;
    }
};

const readPrismaDatasourceEnvName = (schemaPath) => {
    try {
        const content = fs.readFileSync(schemaPath, 'utf8');
        const datasource = content.match(/datasource\s+\w+\s*\{([\s\S]*?)\}/)?.[1] || '';
        return datasource.match(/\burl\s*=\s*env\("([A-Za-z_]\w*)"\)/)?.[1] || null;
    } catch {
        return null;
    }
};

const findSqlInitFile = (dir) => {
    const candidates = [
        path.join(dir, 'init.sql'),
        path.join(dir, 'schema.sql'),
        path.join(dir, 'db', 'init.sql'),
        path.join(dir, 'db', 'schema.sql'),
        path.join(dir, 'sql', 'init.sql'),
        path.join(dir, 'sql', 'schema.sql'),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
};

const findPrismaSchemaFile = (rootDir, pkgDir) => {
    const candidates = [
        path.join(pkgDir, 'prisma', 'schema.prisma'),
        path.join(pkgDir, 'schema.prisma'),
        path.join(rootDir, 'prisma', 'schema.prisma'),
        path.join(rootDir, 'schema.prisma'),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
};

/**
 * Inspects an imported repository to determine which ephemeral database and
 * cache services Integration Tests (Supertest) require.
 */
export const detectIntegrationRuntimePlan = (rootDir) => {
    if (!rootDir || typeof rootDir !== 'string' || !fs.existsSync(rootDir)) {
        return { database: null, services: null, backendDir: null };
    }

    let packages = [];
    try {
        packages = scanRuntimePackages(rootDir);
    } catch {
        packages = [];
    }

    // Order candidate packages so backend/server/api are inspected cleanly alongside root.
    const sortedPackages = [...packages].sort((a, b) => {
        const idxA = PACKAGE_PRIORITY_DIRS.indexOf(a.relative);
        const idxB = PACKAGE_PRIORITY_DIRS.indexOf(b.relative);
        const rankA = idxA === -1 ? 99 : idxA;
        const rankB = idxB === -1 ? 99 : idxB;
        return rankA - rankB;
    });

    let database = null;
    let backendDir = rootDir;
    let usesRedis = false;

    for (const { directory, pkg } of sortedPackages) {
        const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
        if (['redis', 'ioredis', 'bullmq', 'bull'].some((name) => Boolean(deps[name]))) {
            usesRedis = true;
        }
        if (database) continue;

        const prismaSchema = findPrismaSchemaFile(rootDir, directory);
        if ((deps['@prisma/client'] || deps.prisma) && prismaSchema) {
            const engine = readPrismaProvider(prismaSchema);
            if (engine) {
                database = { engine, prismaSchema, schemaStrategy: 'push' };
                backendDir = directory;
                continue;
            }
        }

        if (deps.mongoose || deps.mongodb) {
            database = { engine: 'mongodb' };
            backendDir = directory;
            continue;
        }

        if (deps['better-sqlite3'] || deps.sqlite3) {
            const initSql = findSqlInitFile(directory) || findSqlInitFile(rootDir);
            database = { engine: 'sqlite', ...(initSql ? { initSql } : {}) };
            backendDir = directory;
            continue;
        }

        const hasMysql = Boolean(deps.mysql || deps.mysql2);
        const hasPostgres = Boolean(deps.pg || deps.postgres);
        if (hasMysql && !hasPostgres) {
            const initSql = findSqlInitFile(directory) || findSqlInitFile(rootDir);
            database = { engine: 'mysql', ...(initSql ? { initSql } : {}) };
            backendDir = directory;
            continue;
        }
        if (hasPostgres && !hasMysql) {
            const initSql = findSqlInitFile(directory) || findSqlInitFile(rootDir);
            database = { engine: 'postgres', ...(initSql ? { initSql } : {}) };
            backendDir = directory;
            continue;
        }
    }

    // Fallback: schema.prisma exists at root even if package.json lacks @prisma/client explicitly
    if (!database) {
        const rootSchema = findPrismaSchemaFile(rootDir, rootDir);
        if (rootSchema) {
            const engine = readPrismaProvider(rootSchema);
            if (engine) {
                database = { engine, prismaSchema: rootSchema, schemaStrategy: 'push' };
            }
        }
    }

    return {
        database,
        services: usesRedis ? { redis: true } : null,
        backendDir,
    };
};

const writeSqlToContainer = (container, engine, password, sql) => new Promise((resolve, reject) => {
    const args = engine === 'mysql'
        ? ['exec', '-i', '-e', `MYSQL_PWD=${password}`, container, 'mysql', '-ucovai', 'covai_test']
        : ['exec', '-i', '-e', `PGPASSWORD=${password}`, container, 'psql', '-U', 'covai', '-d', 'covai_test', '-v', 'ON_ERROR_STOP=1'];
    const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', (chunk) => { error += chunk.toString(); });
    child.once('error', reject);
    child.stdin.on('error', () => { });
    child.stdin.end(sql);
    const timer = setTimeout(() => {
        child.kill();
        reject(new ServiceError('Integration test database initialization timed out', 408));
    }, 30000);
    child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new ServiceError(`Integration test database initialization failed: ${error.replaceAll(password || '', '[redacted]')}`, 422));
    });
});

/**
 * Synchronizes schema (Prisma or init.sql) onto the newly provisioned ephemeral database.
 */
export const syncIntegrationDatabaseSchema = async ({
    jobId,
    rootDir,
    backendDir,
    database,
    resources,
    signal,
    dependencies = {},
}) => {
    if (!database) return { synced: false, reason: 'NO_DATABASE' };

    const env = { ...(resources?.environment || {}) };
    if (database.prismaSchema && fs.existsSync(database.prismaSchema)) {
        const customEnvVar = readPrismaDatasourceEnvName(database.prismaSchema);
        if (customEnvVar && env.DATABASE_URL) {
            env[customEnvVar] = env.DATABASE_URL;
        }

        const relSchema = path.relative(rootDir, database.prismaSchema).replace(/\\/g, '/');
        let prismaCommand = 'npx --no-install prisma';
        try {
            const cliAbs = resolveProjectPrismaCli(backendDir || rootDir, rootDir);
            const relCli = path.relative(rootDir, cliAbs).replace(/\\/g, '/');
            prismaCommand = `node "${relCli}"`;
        } catch {
            // Fall back to npx --no-install prisma if CLI path resolution fails
        }

        const runPrisma = dependencies.run || ((cmd) => dockerRunner.run({
            snapshotPath: rootDir,
            command: cmd,
            timeoutMs: 60000,
            jobId,
            signal,
            env: {
                ...env,
                NODE_ENV: 'development',
                PRISMA_TELEMETRY_INFORMATION: 'false',
            },
        }));

        const genRes = await runPrisma(`${prismaCommand} generate --schema "${relSchema}"`);
        if (!genRes.success) {
            throw new ServiceError(`Prisma Client generation failed: ${(genRes.stderr || genRes.stdout || '').slice(0, 1000)}`, 422);
        }

        const migrationsDir = path.join(path.dirname(database.prismaSchema), 'migrations');
        const hasMigrations = fs.existsSync(migrationsDir) && fs.readdirSync(migrationsDir, { withFileTypes: true })
            .some((item) => item.isDirectory() && fs.existsSync(path.join(migrationsDir, item.name, 'migration.sql')));

        const pushFlag = hasMigrations && database.schemaStrategy !== 'push'
            ? 'migrate deploy'
            : 'db push --accept-data-loss';
        const syncRes = await runPrisma(`${prismaCommand} ${pushFlag} --schema "${relSchema}"`);
        if (!syncRes.success) {
            throw new ServiceError(`Integration test database schema setup failed: ${(syncRes.stderr || syncRes.stdout || '').slice(0, 1000)}`, 422);
        }

        return { synced: true, method: 'prisma' };
    }

    if (database.initSql && fs.existsSync(database.initSql)) {
        const sql = fs.readFileSync(database.initSql, 'utf8');
        if (database.engine === 'sqlite') {
            if (/\b(?:ATTACH|DETACH|VACUUM|load_extension)\b/i.test(sql)) {
                throw new ServiceError('SQLite initialization cannot access files outside its owned test database', 422);
            }
            const { DatabaseSync } = await import('node:sqlite');
            const db = new DatabaseSync(env.SQLITE_DB_PATH);
            try {
                db.exec(sql);
            } finally {
                db.close();
            }
            return { synced: true, method: 'sqlite-init-sql' };
        }

        if (resources?.sqlContainer && (database.engine === 'mysql' || database.engine === 'postgres')) {
            await writeSqlToContainer(resources.sqlContainer, database.engine, env.DB_PASSWORD, sql);
            return { synced: true, method: 'container-init-sql' };
        }
    }

    return { synced: false, reason: 'NO_SCHEMA_SYNC_REQUIRED' };
};

/**
 * Provisions an ephemeral Docker database (or SQLite file) for an Integration Test run
 * using the same isolated runtime adapter as System Tests, and ensures cleanup on exit.
 */
export const prepareIntegrationDatabase = async ({ jobId, rootDir, signal, dependencies = {} }) => {
    const plan = (dependencies.detectPlan || detectIntegrationRuntimePlan)(rootDir);
    if (!plan.database && !plan.services) {
        return {
            active: false,
            mode: 'none',
            useLiveDatabase: false,
            engine: null,
            hasRedis: false,
            prismaSynced: false,
            environment: {},
            cleanup: async () => { },
        };
    }

    const useLiveDockerDb =
        Boolean(dependencies.provision) ||
        process.env.COVAI_INTEGRATION_USE_DOCKER_DB === 'true' ||
        process.env.COVAI_USE_DOCKER_DB === 'true';

    if (!useLiveDockerDb) {
        const dbInfo = detectProjectDatabase(rootDir);
        const parts = [plan.database?.engine || dbInfo.primaryType, plan.services?.redis ? 'redis' : null]
            .filter((p) => p && p !== 'NONE')
            .join(' + ');
        if (jobId) {
            await addJobLog(
                jobId,
                'INFO',
                `[SUPERTEST] Using schema-aware in-memory mock database (${parts || 'auto'}) — zero Docker container overhead.`
            ).catch(() => { });
        }
        return {
            active: true,
            mode: 'mock',
            useLiveDatabase: false,
            engine: plan.database?.engine || null,
            hasRedis: Boolean(plan.services?.redis),
            prismaSynced: false,
            dbInfo,
            environment: {
                COVAI_MOCK_DB: 'true',
                DATABASE_URL: 'postgresql://covai:covai@localhost:5432/covai_test_db',
                MONGODB_URI: 'mongodb://localhost:27017/covai_mock_db',
                REDIS_URL: 'redis://127.0.0.1:6379',
            },
            cleanup: async () => { },
        };
    }

    if (jobId) {
        const parts = [plan.database?.engine, plan.services?.redis ? 'redis' : null].filter(Boolean).join(' + ');
        await addJobLog(jobId, 'INFO', `[SUPERTEST] Provisioning isolated ephemeral test service(s): ${parts}...`).catch(() => { });
    }

    const resources = await (dependencies.provision || provisionSystemResources)({
        rootDir,
        database: plan.database,
        services: plan.services,
        signal,
        dependencies: dependencies.resourceDeps,
    });

    try {
        const syncRes = await (dependencies.syncSchema || syncIntegrationDatabaseSchema)({
            jobId,
            rootDir,
            backendDir: plan.backendDir,
            database: plan.database,
            resources,
            signal,
            dependencies: dependencies.syncDeps,
        });

        if (jobId) {
            const syncMsg = syncRes?.synced ? ` (schema synced via ${syncRes.method})` : '';
            await addJobLog(jobId, 'INFO', `[SUPERTEST] Isolated ephemeral ${plan.database?.engine || 'redis'} ready${syncMsg}.`).catch(() => { });
        }

        return {
            active: true,
            mode: 'live',
            useLiveDatabase: true,
            engine: plan.database?.engine || null,
            hasRedis: Boolean(plan.services?.redis),
            prismaSynced: syncRes?.method === 'prisma',
            environment: resources.environment || {},
            cleanup: resources.cleanup,
        };
    } catch (err) {
        await resources.cleanup().catch(() => { });
        throw err;
    }
};
