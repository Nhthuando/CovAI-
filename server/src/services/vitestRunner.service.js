import { addJobLog } from "./job.service.js";
import { dockerRunner } from "./dockerRunner.service.js";

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for npm install
const VITEST_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for testing

/**
 * Install dependencies
 */
export const installVitestDeps = async (jobId, rootDir) => {
    await addJobLog(
        jobId,
        "INFO",
        "Start installing dependencies (Vitest)...",
    ).catch(() => { });

    const result = await dockerRunner.run({
        snapshotPath: rootDir,
        command: "npm install",
        timeoutMs: INSTALL_TIMEOUT_MS,
        jobId,
    });

    if (!result.success) {
        throw new Error(`Install dependencies fail: ${result.stderr}`);
    }
};

/**
 * Run Vitest test
 */
export const runVitestTests = async (jobId, rootDir, vitestCommand) => {
    // Get the test command from the project's config, if not available, use the default command
    const testCmd = vitestCommand ? vitestCommand : "npx vitest run";

    await addJobLog(jobId, "INFO", `Run command: ${testCmd}`).catch(() => { });

    const result = await dockerRunner.run({
        snapshotPath: rootDir,
        command: testCmd,
        timeoutMs: VITEST_TIMEOUT_MS,
        jobId,
    });

    return result;
};

/**
 * Run Vitest with Coverage
 */
export const runVitestCoverage = async (jobId, rootDir, vitestCommand) => {
    // Handle missing coverage provider by installing it explicitly if not already present
    const fs = await import("fs");
    const path = await import("path");
    const hasCoverageV8 = fs.existsSync(path.join(rootDir, "node_modules", "@vitest", "coverage-v8"));

    if (!hasCoverageV8) {
        await addJobLog(jobId, "INFO", `Installing coverage provider (@vitest/coverage-v8)...`).catch(() => { });
        await dockerRunner.run({
            snapshotPath: rootDir,
            command: "npm install -D @vitest/coverage-v8 --no-package-lock --legacy-peer-deps",
            timeoutMs: INSTALL_TIMEOUT_MS,
            jobId,
        });
    }

    // Vitest base command
    const baseCmd = vitestCommand ? vitestCommand : "npx vitest run";

    // Detect non-unit and Jest-specific test files (e.g. files importing @jest/globals which crash outside Jest)
    const excludes = ["**/*playwright*", "**/*supertest*", "**/*cypress*", "**/*.jest.*"];
    const testsDir = path.join(rootDir, "tests");
    if (fs.existsSync(testsDir)) {
        try {
            const scan = (dir) => {
                for (const item of fs.readdirSync(dir)) {
                    const full = path.join(dir, item);
                    if (fs.statSync(full).isDirectory()) {
                        scan(full);
                    } else if (/\.(test|spec)\.[a-z0-9]+$/i.test(item)) {
                        const content = fs.readFileSync(full, "utf8");
                        if (content.includes("@jest/globals") || content.includes("@jest/")) {
                            const rel = path.relative(rootDir, full).replace(/\\/g, "/");
                            excludes.push(`**/${rel}`);
                        }
                    }
                }
            };
            scan(testsDir);
        } catch (_) { }
    }

    const excludeFlags = excludes.map(e => `--exclude="${e}"`).join(" ");

    // Execute Vitest with coverage, globals enabled, generate JSON, LCOV, and test results
    const coverageCmd = `${baseCmd} --globals --coverage.enabled=true --coverage.provider=v8 --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=lcov --reporter=json --outputFile=coverage/test-results.json ${excludeFlags}`;

    await addJobLog(jobId, "INFO", `Run coverage command: ${coverageCmd}`).catch(() => { });

    const result = await dockerRunner.run({
        snapshotPath: rootDir,
        command: coverageCmd,
        timeoutMs: VITEST_TIMEOUT_MS,
        jobId,
        env: {
            NODE_OPTIONS: "--experimental-vm-modules",
        },
    });

    // Ensure test-results.json is synced to rootDir as well as vitest-results.json
    const covTestResults = path.join(rootDir, "coverage", "test-results.json");
    const rootTestResults = path.join(rootDir, "test-results.json");
    const vitestResultsPath = path.join(rootDir, "coverage", "vitest-results.json");
    if (fs.existsSync(covTestResults)) {
        try {
            fs.copyFileSync(covTestResults, rootTestResults);
            fs.copyFileSync(covTestResults, vitestResultsPath);
        } catch { }
    }

    return {
        ...result,
        coverageDir: `${rootDir}/coverage`,
    };
};
