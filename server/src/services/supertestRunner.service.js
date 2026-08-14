import fs from "fs";
import path from "path";
import { dockerRunner } from "./dockerRunner.service.js";
import { addJobLog } from "./job.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";

const SUPERTEST_TIMEOUT_MS = 5 * 60 * 1000;

const quoteForShell = (value) => `'${value.replaceAll("'", "'\\''")}'`;

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
export const runSupertest = async (jobId, rootDir, jestConfigPath, supertestFiles = []) => {
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
    const jestBinary = usesEsm ? "node --experimental-vm-modules ./node_modules/jest/bin/jest.js" : "npx --no-install jest";
    let jestCmd = `CI=true NODE_ENV=test ${jestBinary} --runInBand --coverage --coverageReporters=json-summary --coverageReporters=json --coverageReporters=lcov --json --outputFile=test-results.json --forceExit --testTimeout=30000`;
    jestCmd += ` --runTestsByPath ${testArgs}`;

    if (jestConfigPath) {
        const resolvedConfig = path.resolve(jestConfigPath);
        const relativeConfig = path.relative(resolvedRoot, resolvedConfig).replace(/\\/g, "/");
        if (relativeConfig && !relativeConfig.startsWith("../") && !path.isAbsolute(relativeConfig)) {
            jestCmd += ` --config=${quoteForShell(relativeConfig)}`;
        }
    }

    await addJobLog(jobId, "INFO", "[SUPERTEST] Starting isolated integration tests.").catch(() => { });
    const startedAt = Date.now();
    let result;
    try {
        result = await dockerRunner.run({ snapshotPath: resolvedRoot, command: jestCmd, timeoutMs: SUPERTEST_TIMEOUT_MS, jobId });
    } catch (error) {
        await addJobLog(jobId, "ERROR", `[SUPERTEST] Runner error: ${error.message}`).catch(() => { });
        throw error;
    }

    if (!result.success || result.exitCode !== 0) {
        const details = result.exitCode === null ? "process terminated unexpectedly" : `exit code ${result.exitCode}`;
        const message = `[SUPERTEST] Integration tests failed (${details}).`;
        await addJobLog(jobId, "ERROR", message).catch(() => { });
        throw new ServiceError(message, 422);
    }

    await addJobLog(jobId, "INFO", "[SUPERTEST] Integration tests completed successfully.").catch(() => { });
    return {
        exitCode: result.exitCode,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        executionTimeMs: Date.now() - startedAt,
        coverageDir: path.join(resolvedRoot, "coverage"),
    };
};
