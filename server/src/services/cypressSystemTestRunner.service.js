import fs from "fs";
import path from "path";
import { dockerRunner } from "./dockerRunner.service.js";
import { addJobLog } from "./job.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";

const CYPRESS_TIMEOUT_MS = 10 * 60 * 500; // 5 minutes

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

export const runCypressSystemTest = async (jobId, rootDir) => {
    const resolvedRoot = assertValidRootDir(resolveProjectRoot(rootDir));

    // 1. Verify Cypress installation
    const pkgPath = path.join(resolvedRoot, "package.json");
    if (!fs.existsSync(pkgPath)) {
        throw new ServiceError("Cypress is not installed in the project dependencies.", 422);
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (!pkg.devDependencies?.cypress && !pkg.dependencies?.cypress) {
        throw new ServiceError("Cypress is not installed in the project dependencies.", 422);
    }

    await addJobLog(jobId, "INFO", "[CYPRESS] Starting system tests.").catch(() => { });

    const startedAt = Date.now();
    let result;

    try {
        // 2. Execute Cypress
        // Using npx --no-install to ensure we use local version
        const resultsPath = path.join(resolvedRoot, "cypress-results.json");
        const cypressCmd = `npx --no-install cypress run --browser chrome --headless --reporter json --reporter-options outputFile=${resultsPath}`;

        result = await dockerRunner.run({
            snapshotPath: resolvedRoot,
            command: cypressCmd,
            timeoutMs: CYPRESS_TIMEOUT_MS,
            jobId
        });

        // 3. Handle results
        const durationMs = Date.now() - startedAt;

        // Basic parsing of stdout for summary (simplified for now)
        const stdout = result.stdout || "";
        const stderr = result.stderr || "";

        const success = result.success && result.exitCode === 0;

        return {
            success,
            exitCode: result.exitCode,
            stdout,
            stderr,
            durationMs,
            status: success ? "PASSED" : "FAILED",
            screenshots: [] // TODO: Implement screenshot detection
        };

    } catch (error) {
        await addJobLog(jobId, "ERROR", `[CYPRESS] Runner error: ${error.message}`).catch(() => { });
        throw error;
    }
};