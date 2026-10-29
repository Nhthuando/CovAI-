import fs from "fs";
import path from "path";
import { dockerRunner } from "./dockerRunner.service.js";
import { addJobLog } from "./job.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
import { ensureSupertestDatabaseSetupFile } from "./databaseMockTemplate.service.js";
import { getJobAbortSignal } from "./jobCancellation.service.js";

const SUPERTEST_TIMEOUT_MS = 10 * 60 * 1000;

const quoteForShell = (value) => {
    if (!value) return '""';
    const str = String(value);
    // Safe alphanumeric path with no spaces doesn't need quotes
    if (/^[a-zA-Z0-9_\-./\\]+$/.test(str)) {
        return str;
    }
    // On Windows cmd.exe, single quotes are NOT stripped and get passed as literal characters into filename.
    // Use double quotes on Windows.
    if (process.platform === "win32") {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return `'${str.replaceAll("'", "'\\''")}'`;
};

const readProjectPackageJson = (rootDir) => {
    const packageJsonPath = path.join(rootDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    } catch (error) {
        return null;
    }
};

const shouldUseNodeJestDirect = (rootDir) => {
    const pkg = readProjectPackageJson(rootDir);
    if (!pkg) return false;
    if (pkg.type === "module") return true;

    return ["jest.config.mjs", "jest.config.js", "jest.config.cjs", "jest.config.ts"].some((name) =>
        fs.existsSync(path.join(rootDir, name)) && name.endsWith(".mjs")
    );
};

const assertValidRootDir = (rootDir) => {
    if (!rootDir || typeof rootDir !== "string" || rootDir.trim().length === 0) {
        throw new ServiceError("Project root directory is required", 400);
    }

    const resolvedRoot = path.resolve(rootDir);
    if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
        throw new ServiceError("Project root directory does not exist or is not a directory", 400);
    }

    return resolvedRoot;
};

/** Execute only Supertest test files in an isolated test environment. */
export const runSupertest = async (jobId, rootDir, jestConfigPath, supertestFiles = [], options = {}) => {
    if (!Array.isArray(supertestFiles)) {
        throw new ServiceError("supertestFiles must be an array", 400);
    }

    const resolvedRoot = assertValidRootDir(resolveProjectRoot(rootDir));
    if (supertestFiles.length === 0) {
        throw new ServiceError("No Supertest test files were supplied", 422);
    }

    const normalizedFiles = supertestFiles
        .map((file) => {
            if (!file || typeof file !== "string") {
                throw new ServiceError("Supertest file paths must be valid strings", 400);
            }
            const resolvedFile = path.resolve(file);
            const relativePath = path.relative(resolvedRoot, resolvedFile);
            if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
                throw new ServiceError(`Supertest file is outside the project root: ${file}`, 400);
            }
            return path.relative(resolvedRoot, resolvedFile).replace(/\\/g, "/");
        })
        .filter((file) => file && !file.startsWith("../") && !path.isAbsolute(file));

    if (normalizedFiles.length === 0) {
        throw new ServiceError("Supertest files must be inside the project root", 400);
    }

    const testArgs = normalizedFiles.map(quoteForShell).join(" ");
    const usesEsm = shouldUseNodeJestDirect(resolvedRoot);
    const nodePathCandidates = [
        path.join(resolvedRoot, "node_modules"),
        path.join(resolvedRoot, "server", "node_modules"),
        path.join(resolvedRoot, "backend", "node_modules"),
        path.join(resolvedRoot, "api", "node_modules")
    ].filter((p) => fs.existsSync(p));

    const env = {
        CI: "true",
        NODE_ENV: "test",
        COVAI_JOB_ID: jobId || "",
        DATABASE_URL: options?.databaseUrl || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test_db",
        PORT: options?.port ? String(options.port) : "0",
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "sk_test_covai_mock_secret_key_12345",
        STRIPE_API_KEY: process.env.STRIPE_API_KEY || "sk_test_covai_mock_api_key_12345",
        ...(nodePathCandidates.length > 0 ? { NODE_PATH: nodePathCandidates.join(path.delimiter) } : {}),
        ...(usesEsm ? { NODE_OPTIONS: "--experimental-vm-modules" } : {})
    };
    const jestBinary = "npx --no-install jest";

    const coverageDir = path.join(resolvedRoot, "coverage");
    if (!fs.existsSync(coverageDir)) {
        fs.mkdirSync(coverageDir, { recursive: true });
    }
    const resultsPath = path.join(coverageDir, "test-results.json");
    // Remove stale results and evidence files from previous runs so a failed run does not report false success
    if (fs.existsSync(resultsPath)) {
        try { fs.unlinkSync(resultsPath); } catch (_) {}
    }
    const evidencePath = path.join(coverageDir, "runtime-evidence.json");
    if (fs.existsSync(evidencePath)) {
        try { fs.unlinkSync(evidencePath); } catch (_) {}
    }
    const tempEvidencePath = path.join(resolvedRoot, ".covai-temp", "runtime-evidence.json");
    if (fs.existsSync(tempEvidencePath)) {
        try { fs.unlinkSync(tempEvidencePath); } catch (_) {}
    }
    const relativeResultsPath = path.relative(resolvedRoot, resultsPath).replace(/\\/g, "/");

    let setupArgs = "";
    try {
        const setupFileInfo = ensureSupertestDatabaseSetupFile(resolvedRoot);
        if (setupFileInfo?.relativePath) {
            const cleanRel = setupFileInfo.relativePath.replace(/\\/g, "/").replace(/^(\.\/)?/, "");
            setupArgs = ` --setupFilesAfterEnv="<rootDir>/${cleanRel}"`;
            await addJobLog(jobId, "INFO", `[SUPERTEST] Injected database mock setup: ${setupFileInfo.relativePath} (${setupFileInfo.dbInfo.primaryType})`).catch(() => { });
        }
    } catch (setupErr) {
        console.warn("[SupertestRunner] Could not create database setup file:", setupErr.message);
    }

    let jestCmd = `${jestBinary} --runInBand --testEnvironment=node --coverage --coverageReporters=json-summary --coverageReporters=json --coverageReporters=lcov --json --outputFile=${quoteForShell(relativeResultsPath)} --forceExit --testTimeout=30000${setupArgs}`;
    jestCmd += ` --runTestsByPath ${testArgs}`;

    if (jestConfigPath) {
        const resolvedConfig = path.isAbsolute(jestConfigPath)
            ? jestConfigPath
            : path.resolve(resolvedRoot, jestConfigPath);
        const relativeConfig = path.relative(resolvedRoot, resolvedConfig).replace(/\\/g, "/");
        const lowerConfig = relativeConfig.toLowerCase();

        let isFrontendConfig = lowerConfig.startsWith("client/") || lowerConfig.startsWith("frontend/") || lowerConfig.startsWith("ui/") || lowerConfig.startsWith("web/");
        if (!isFrontendConfig && fs.existsSync(resolvedConfig)) {
            try {
                const configContent = fs.readFileSync(resolvedConfig, "utf8");
                if (configContent.includes("jsdom") || configContent.includes("jest-environment-jsdom")) {
                    isFrontendConfig = true;
                }
            } catch (_) {}
        }

        if (isFrontendConfig) {
            await addJobLog(jobId, "WARN", `[SUPERTEST] Ignored client-side Jest config (${relativeConfig}) for server integration tests. Running with default Node test environment.`).catch(() => {});
        } else if (relativeConfig && !relativeConfig.startsWith("../") && !path.isAbsolute(relativeConfig)) {
            jestCmd += ` --config=${quoteForShell(relativeConfig)}`;
        }
    }

    await addJobLog(jobId, "INFO", "[SUPERTEST] Starting isolated integration tests.").catch(() => { });

    // Automatically generate Prisma Client if project uses Prisma
    try {
        const { detectAndRunPrismaGenerate } = await import("./runTestsJob.service.js");
        await detectAndRunPrismaGenerate(jobId, resolvedRoot);
    } catch (_) { }

    const startedAt = Date.now();
    let result;
    const abortSignal = options?.signal || getJobAbortSignal(jobId);
    try {
        result = await dockerRunner.run({ snapshotPath: resolvedRoot, command: jestCmd, timeoutMs: SUPERTEST_TIMEOUT_MS, jobId, env, signal: abortSignal });
    } catch (error) {
        await addJobLog(jobId, "ERROR", `[SUPERTEST] Runner error: ${error.message}`).catch(() => { });
        throw error;
    }

    if (!result.success && result.exitCode === null) {
        const message = `[SUPERTEST] Integration tests failed (process terminated unexpectedly).`;
        await addJobLog(jobId, "ERROR", message).catch(() => { });
        throw new ServiceError(message, 422);
    }

    if (result.exitCode !== 0) {
        await addJobLog(jobId, "WARN", `[SUPERTEST] Integration tests failed with exit code ${result.exitCode}. Proceeding to parse results.`).catch(() => { });
    } else {
        await addJobLog(jobId, "INFO", "[SUPERTEST] Integration tests completed successfully.").catch(() => { });
    }

    return {
        exitCode: result.exitCode,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        executionTimeMs: Date.now() - startedAt,
        coverageDir: path.join(resolvedRoot, "coverage"),
    };
};

export const runSupertestTests = runSupertest;

