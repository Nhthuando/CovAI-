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
    // Handle missing coverage provider by installing it explicitly
    await addJobLog(jobId, "INFO", `Ensuring coverage provider (@vitest/coverage-v8) is installed...`).catch(() => { });
    await dockerRunner.run({
        snapshotPath: rootDir,
        command: "npm install -D @vitest/coverage-v8",
        timeoutMs: INSTALL_TIMEOUT_MS,
        jobId,
    });

    // Vitest base command
    const baseCmd = vitestCommand ? vitestCommand : "npx vitest run";

    // Execute Vitest with coverage, generate JSON, LCOV, and test results
    const coverageCmd = `${baseCmd} --coverage.enabled=true --coverage.provider=v8 --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=lcov --reporter=json --outputFile=coverage/test-results.json`;

    await addJobLog(jobId, "INFO", `Run coverage command: ${coverageCmd}`).catch(() => { });

    const result = await dockerRunner.run({
        snapshotPath: rootDir,
        command: coverageCmd,
        timeoutMs: VITEST_TIMEOUT_MS,
        jobId,
    });

    return {
        ...result,
        coverageDir: `${rootDir}/coverage`
    };
};
