import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import pg from "pg";
import { dockerRunner } from "./dockerRunner.service.js";
import { addJobLog } from "./job.service.js";

const DEFAULT_CONTAINER_NAME = "covai_virtual_test_db";
const DEFAULT_IMAGE = "postgres:17-alpine";
const DEFAULT_USER = "covai_test";
const DEFAULT_PASSWORD = "covai_test_password";
const DEFAULT_ADMIN_DB = "covai_virtual_test";

let cachedDockerAvailable = null;

/**
 * Checks if Docker CLI is functional on the host.
 */
export const isDockerAvailable = () => {
    if (cachedDockerAvailable !== null) return cachedDockerAvailable;
    try {
        const res = spawnSync("docker", ["--version"], { timeout: 3000, stdio: "pipe", shell: true });
        cachedDockerAvailable = res.status === 0;
    } catch {
        cachedDockerAvailable = false;
    }
    return cachedDockerAvailable;
};

/**
 * Detects whether the current process is running inside a Docker container.
 */
export const isInsideDocker = () => {
    try {
        if (fs.existsSync("/.dockerenv")) return true;
        if (process.env.VIRTUAL_DB_DOCKER_HOST && !["127.0.0.1", "localhost"].includes(process.env.VIRTUAL_DB_DOCKER_HOST)) {
            return true;
        }
    } catch { }
    return false;
};

/**
 * Returns host and port configuration for the virtual test database.
 */
export const getVirtualDatabaseHostConfig = () => {
    const inside = isInsideDocker();
    const host = inside
        ? (process.env.VIRTUAL_DB_DOCKER_HOST || "virtual_test_db")
        : (process.env.VIRTUAL_DB_HOST || "127.0.0.1");
    const port = inside
        ? Number(process.env.VIRTUAL_DB_DOCKER_PORT || 5432)
        : Number(process.env.VIRTUAL_DB_HOST_PORT || process.env.VIRTUAL_DB_PORT || 5433);
    const user = process.env.VIRTUAL_DB_USER || DEFAULT_USER;
    const password = process.env.VIRTUAL_DB_PASSWORD || DEFAULT_PASSWORD;
    const adminDb = process.env.VIRTUAL_DB_ADMIN_DB || DEFAULT_ADMIN_DB;

    return { host, port, user, password, adminDb, insideDocker: inside };
};

/**
 * Tests direct connection to the virtual PostgreSQL server using pg.Client.
 */
export const testDatabaseConnection = async ({ host, port, user, password, database, timeoutMs = 2000 }) => {
    const client = new pg.Client({
        host,
        port,
        user,
        password,
        database,
        connectionTimeoutMillis: timeoutMs,
    });
    try {
        await client.connect();
        const res = await client.query("SELECT 1 AS ready;");
        return res?.rows?.[0]?.ready === 1;
    } catch {
        return false;
    } finally {
        try { await client.end(); } catch { }
    }
};

/**
 * Ensures the Docker virtual test database container is running and healthy.
 * If container is not running and docker is available, starts or creates it.
 */
export const ensureVirtualDatabaseServer = async ({ timeoutMs = 15000, jobId = null } = {}) => {
    const config = getVirtualDatabaseHostConfig();

    // 1. Check if already accepting connections
    const isReadyNow = await testDatabaseConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.adminDb,
        timeoutMs: 1500,
    });
    if (isReadyNow) {
        return { ready: true, ...config, method: "active" };
    }

    // 2. If not ready, check if Docker is available to spawn / start container
    if (!isDockerAvailable()) {
        const msg = `[VirtualDB] Database container is not accessible at ${config.host}:${config.port} and Docker CLI is unavailable.`;
        if (jobId) await addJobLog(jobId, "WARN", msg).catch(() => { });
        throw new Error(msg);
    }

    if (jobId) {
        await addJobLog(jobId, "INFO", `[VirtualDB] Probing or launching virtual database container (${DEFAULT_CONTAINER_NAME})...`).catch(() => { });
    }

    try {
        // Check if container already exists
        const inspectRes = spawnSync("docker", ["inspect", DEFAULT_CONTAINER_NAME, "--format", "{{.State.Running}}"], {
            timeout: 5000,
            stdio: "pipe",
            shell: true,
            encoding: "utf8",
        });

        const stdout = (inspectRes.stdout || "").trim();
        if (stdout === "true") {
            // Container running according to Docker, wait for Postgres engine to accept sockets
        } else if (stdout === "false") {
            // Container exists but stopped -> start it
            spawnSync("docker", ["start", DEFAULT_CONTAINER_NAME], { timeout: 10000, stdio: "pipe", shell: true });
        } else {
            // Container does not exist -> run it with tmpfs for RAM-speed execution
            const runArgs = [
                "run",
                "-d",
                "--name", DEFAULT_CONTAINER_NAME,
                "-p", "127.0.0.1:5433:5432",
                "-e", `POSTGRES_USER=${DEFAULT_USER}`,
                "-e", `POSTGRES_PASSWORD=${DEFAULT_PASSWORD}`,
                "-e", `POSTGRES_DB=${DEFAULT_ADMIN_DB}`,
                "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m",
                DEFAULT_IMAGE,
            ];
            spawnSync("docker", runArgs, { timeout: 30000, stdio: "pipe", shell: true });
        }
    } catch (err) {
        if (jobId) {
            await addJobLog(jobId, "WARN", `[VirtualDB] Docker launch command warning: ${err.message}`).catch(() => { });
        }
    }

    // 3. Poll connection until ready or timeout
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const ready = await testDatabaseConnection({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.adminDb,
            timeoutMs: 1000,
        });
        if (ready) {
            if (jobId) {
                await addJobLog(jobId, "INFO", `[VirtualDB] Virtual PostgreSQL 17 engine online and ready on port ${config.port}.`).catch(() => { });
            }
            return { ready: true, ...config, method: "launched" };
        }
        await new Promise(r => setTimeout(r, 400));
    }

    throw new Error(`[VirtualDB] Timed out waiting for virtual test database server on ${config.host}:${config.port} after ${timeoutMs}ms.`);
};

/**
 * Sanitizes a jobId to form a valid PostgreSQL database catalog name.
 */
export const sanitizeDatabaseCatalogName = (jobId) => {
    const raw = String(jobId || "default")
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .toLowerCase();
    const truncated = raw.slice(0, 48).replace(/^_+|_+$/g, "") || "default";
    return `covai_unit_${truncated}`;
};

/**
 * Creates an isolated database catalog (CREATE DATABASE covai_unit_<jobId>)
 * and returns the dynamic connection string and env mapping.
 */
export const provisionIsolatedDatabase = async (jobId, options = {}) => {
    const config = getVirtualDatabaseHostConfig();
    const dbName = sanitizeDatabaseCatalogName(jobId);

    await ensureVirtualDatabaseServer({ timeoutMs: options.timeoutMs || 15000, jobId });

    const client = new pg.Client({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.adminDb,
        connectionTimeoutMillis: 5000,
    });

    try {
        await client.connect();

        // Check if database already exists
        const checkRes = await client.query(
            "SELECT 1 FROM pg_database WHERE datname = $1;",
            [dbName]
        );

        if (checkRes.rows.length === 0) {
            await client.query(`CREATE DATABASE "${dbName}";`);
        }
    } finally {
        try { await client.end(); } catch { }
    }

    const dbUrl = `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${dbName}`;
    const env = getVirtualDatabaseEnv(dbUrl, dbName, config);

    if (jobId) {
        await addJobLog(jobId, "INFO", `[VirtualDB] Provisioned isolated catalog "${dbName}" in virtual PostgreSQL.`).catch(() => { });
    }

    return {
        jobId,
        dbName,
        databaseUrl: dbUrl,
        dbUrl,
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        env,
    };
};

/**
 * Generates environment variable mappings for test runner processes targeting the virtual database.
 */
export const getVirtualDatabaseEnv = (dbUrl, dbName, hostConfig = {}) => {
    const host = hostConfig.host || "127.0.0.1";
    const port = hostConfig.port || 5433;
    const user = hostConfig.user || DEFAULT_USER;
    const password = hostConfig.password || DEFAULT_PASSWORD;

    return {
        DATABASE_URL: dbUrl,
        DIRECT_URL: dbUrl,
        SHADOW_DATABASE_URL: dbUrl,
        DB_URL: dbUrl,
        DB_URI: dbUrl,
        DB_CONNECTION_STRING: dbUrl,
        DB_HOST: String(host),
        DB_PORT: String(port),
        DB_USER: String(user),
        DB_USERNAME: String(user),
        DB_PASSWORD: String(password),
        DB_NAME: String(dbName),
        DB_DATABASE: String(dbName),
        POSTGRES_URL: dbUrl,
        POSTGRESQL_URL: dbUrl,
        PGHOST: String(host),
        PGPORT: String(port),
        PGUSER: String(user),
        PGPASSWORD: String(password),
        PGDATABASE: String(dbName),
    };
};

/**
 * Synchronizes Prisma schema against the isolated virtual database using prisma db push.
 */
export const syncDatabaseSchema = async (databaseUrl, schemaPath = null, rootDir = "") => {
    if (!databaseUrl) return { synced: false, reason: "NO_DATABASE_URL" };

    // Resolve schema path
    let resolvedSchema = schemaPath;
    if (!resolvedSchema || !fs.existsSync(resolvedSchema)) {
        const candidates = [
            path.join(rootDir, "prisma", "schema.prisma"),
            path.join(rootDir, "server", "prisma", "schema.prisma"),
            path.join(rootDir, "backend", "prisma", "schema.prisma"),
            path.join(rootDir, "src", "prisma", "schema.prisma"),
        ];
        for (const cand of candidates) {
            if (fs.existsSync(cand)) {
                resolvedSchema = cand;
                break;
            }
        }
    }

    if (!resolvedSchema || !fs.existsSync(resolvedSchema)) {
        return { synced: false, reason: "NO_SCHEMA_FOUND" };
    }

    const relSchema = rootDir ? path.relative(rootDir, resolvedSchema).replace(/\\/g, "/") : resolvedSchema;
    const schemaDir = path.dirname(resolvedSchema);
    const targetDir = rootDir || schemaDir;

    const hasLocalPrisma = fs.existsSync(path.join(targetDir, "node_modules", ".bin", "prisma")) ||
        fs.existsSync(path.join(targetDir, "node_modules", ".bin", "prisma.cmd")) ||
        fs.existsSync(path.join(rootDir, "node_modules", ".bin", "prisma")) ||
        fs.existsSync(path.join(rootDir, "node_modules", ".bin", "prisma.cmd"));

    const prismaBin = hasLocalPrisma ? "npx --no-install prisma" : "npx prisma";
    const cmd = `${prismaBin} db push --skip-generate --accept-data-loss --schema="${relSchema}"`;

    try {
        const res = await dockerRunner.run({
            snapshotPath: targetDir,
            command: cmd,
            timeoutMs: 45000,
            env: {
                DATABASE_URL: databaseUrl,
                DIRECT_URL: databaseUrl,
                NODE_ENV: "test",
                PRISMA_TELEMETRY_INFORMATION: "false",
            },
        });

        return {
            synced: res.success || res.exitCode === 0,
            exitCode: res.exitCode,
            stdout: res.stdout,
            stderr: res.stderr,
            schemaPath: resolvedSchema,
        };
    } catch (err) {
        return {
            synced: false,
            error: err.message,
            schemaPath: resolvedSchema,
        };
    }
};

/**
 * Forcefully destroys an isolated database catalog (DROP DATABASE ... WITH (FORCE)).
 * Terminates all backend client connections before dropping.
 */
export const destroyIsolatedDatabase = async (jobId, options = {}) => {
    const config = getVirtualDatabaseHostConfig();
    const dbName = sanitizeDatabaseCatalogName(jobId);

    const client = new pg.Client({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.adminDb,
        connectionTimeoutMillis: 5000,
    });

    try {
        await client.connect();

        // 1. Forcefully terminate active connections to the isolated database
        try {
            await client.query(
                `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`,
                [dbName]
            );
        } catch (_) { }

        // 2. Drop the database
        await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);

        if (jobId && options.log !== false) {
            await addJobLog(jobId, "INFO", `[VirtualDB] Successfully dropped isolated catalog "${dbName}".`).catch(() => { });
        }

        return { success: true, dbName };
    } catch (err) {
        if (jobId && options.log !== false) {
            await addJobLog(jobId, "WARN", `[VirtualDB] Cleanup warning for ${dbName}: ${err.message}`).catch(() => { });
        }
        return { success: false, dbName, error: err.message };
    } finally {
        try { await client.end(); } catch { }
    }
};

/**
 * Inspects a repository to determine if it requires a database.
 * If pure logic/algorithmic or UI repository, returns false to bypass DB setup.
 */
export const isDatabaseRequiredForProject = (rootDir) => {
    if (!rootDir || typeof rootDir !== "string" || !fs.existsSync(rootDir)) {
        return false;
    }

    // 1. Check for Prisma schema files
    const prismaCandidates = [
        path.join(rootDir, "prisma", "schema.prisma"),
        path.join(rootDir, "server", "prisma", "schema.prisma"),
        path.join(rootDir, "backend", "prisma", "schema.prisma"),
        path.join(rootDir, "src", "prisma", "schema.prisma"),
    ];
    for (const cand of prismaCandidates) {
        if (fs.existsSync(cand)) return true;
    }

    // 2. Check package.json dependencies
    const packageFiles = [
        path.join(rootDir, "package.json"),
        path.join(rootDir, "server", "package.json"),
        path.join(rootDir, "backend", "package.json"),
    ];

    const dbPackages = [
        "@prisma/client",
        "prisma",
        "pg",
        "postgres",
        "mysql",
        "mysql2",
        "sqlite3",
        "better-sqlite3",
        "typeorm",
        "sequelize",
        "knex",
        "mongoose",
        "mongodb",
        "mikro-orm",
        "@mikro-orm/core",
        "drizzle-orm",
    ];

    for (const pkgFile of packageFiles) {
        if (fs.existsSync(pkgFile)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
                const allDeps = {
                    ...(pkg.dependencies || {}),
                    ...(pkg.devDependencies || {}),
                };
                for (const dbPkg of dbPackages) {
                    if (allDeps[dbPkg]) return true;
                }
            } catch (_) { }
        }
    }

    return false;
};

/**
 * Scavenges and drops any orphaned test databases matching `covai_unit_%`
 * to keep the virtual PostgreSQL tmpfs clean.
 */
export const scavengeStaleDatabases = async () => {
    const config = getVirtualDatabaseHostConfig();
    const client = new pg.Client({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.adminDb,
        connectionTimeoutMillis: 5000,
    });

    try {
        await client.connect();
        const res = await client.query(
            "SELECT datname FROM pg_database WHERE datname LIKE 'covai_unit_%';"
        );
        for (const row of res.rows) {
            const db = row.datname;
            try {
                await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`, [db]);
                await client.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE);`);
            } catch (_) { }
        }
        return { scavenged: res.rows.length };
    } catch (err) {
        return { scavenged: 0, error: err.message };
    } finally {
        try { await client.end(); } catch { }
    }
};
