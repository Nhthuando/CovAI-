import fs from "fs";
import path from "path";
import { dockerRunner } from "./dockerRunner.service.js";
import { addJobLog } from "./job.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
import { getJobAbortSignal } from "./jobCancellation.service.js";

const PLAYWRIGHT_TIMEOUT_MS = 10 * 60 * 1000;

const quoteForShell = (value) => {
    if (!value) return '""';
    const str = String(value);
    if (/^[a-zA-Z0-9_\-./\\]+$/.test(str)) return str;
    if (process.platform === "win32") {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return `'${str.replaceAll("'", "'\\''")}'`;
};

/**
 * Parses raw Playwright test runner JSON output into standardized test scenarios.
 *
 * @param {Object} rawJson - Raw Playwright JSON report
 * @returns {Array<Object>} Normalized scenario records
 */
export const parsePlaywrightApiJsonResults = (rawJson = {}) => {
    if (!rawJson || typeof rawJson !== "object") {
        return {
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            skippedTests: 0,
            scenarios: []
        };
    }
    const scenarios = [];

    const suites = rawJson.suites || [];

    const walkSuite = (suite, parentName = "") => {
        const suiteTitle = parentName ? `${parentName} > ${suite.title}` : suite.title;

        for (const spec of suite.specs || []) {
            const specTitle = spec.title || "API Test Scenario";
            const fullTitle = `${suiteTitle ? suiteTitle + " " : ""}${specTitle}`.trim();

            for (const test of spec.tests || []) {
                const result = test.results?.[0] || {};
                const status = result.status === "passed" ? "PASSED" : result.status === "skipped" ? "SKIPPED" : "FAILED";
                const durationMs = result.duration || 0;

                const failureMessages = [];
                if (result.error) {
                    failureMessages.push(result.error.message || result.error.value || "Test failed");
                    if (result.error.stack) failureMessages.push(result.error.stack);
                }

                for (const err of result.errors || []) {
                    failureMessages.push(err.message || String(err));
                    if (err.stack) failureMessages.push(err.stack);
                }

                scenarios.push({
                    title: fullTitle,
                    suiteName: suiteTitle || spec.file || "API Test Suite",
                    status,
                    durationMs,
                    failureMessages,
                    testFile: spec.file ? spec.file.replace(/\\/g, "/") : null,
                    line: spec.line || null,
                });
            }
        }

        for (const sub of suite.suites || []) {
            walkSuite(sub, suiteTitle);
        }
    };

    for (const rootSuite of suites) {
        walkSuite(rootSuite);
    }

    const passedTests = scenarios.filter((s) => s.status === "PASSED" || s.status === "passed").length;
    const failedTests = scenarios.filter((s) => s.status === "FAILED" || s.status === "failed").length;
    const skippedTests = scenarios.filter((s) => s.status === "SKIPPED" || s.status === "skipped").length;

    return {
        totalTests: scenarios.length,
        passedTests,
        failedTests,
        skippedTests,
        scenarios
    };
};

/**
 * Runs Playwright API integration tests in an isolated project workspace.
 *
 * @param {string} jobId - Job tracking ID
 * @param {string} rootDir - Project root directory
 * @param {Array<string>} [testFiles] - Specific Playwright API test files
 * @param {Object} [options] - Options (baseUrl, databaseUrl, port, signal)
 * @returns {Promise<Object>} Execution report
 */
export const runPlaywrightApiTests = async (
    jobId,
    rootDir,
    testFiles = [],
    options = {}
) => {
    const effectiveRootDir = resolveProjectRoot(rootDir);
    if (!effectiveRootDir || !fs.existsSync(effectiveRootDir)) {
        throw new ServiceError("Project root directory does not exist", 400);
    }

    const coverageDir = path.join(effectiveRootDir, "coverage");
    if (!fs.existsSync(coverageDir)) {
        fs.mkdirSync(coverageDir, { recursive: true });
    }

    const resultsPath = path.join(coverageDir, "playwright-api-results.json");
    if (fs.existsSync(resultsPath)) {
        try { fs.unlinkSync(resultsPath); } catch (_) {}
    }

    const relativeResultsPath = path.relative(effectiveRootDir, resultsPath).replace(/\\/g, "/");

    let testArgs = "";
    if (Array.isArray(testFiles) && testFiles.length > 0) {
        const normFiles = testFiles.map((f) => {
            const rel = path.relative(effectiveRootDir, path.resolve(f)).replace(/\\/g, "/");
            return quoteForShell(rel);
        });
        testArgs = normFiles.join(" ");
    }

    const baseUrl = options.baseUrl || process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${options.port || 3000}`;
    const databaseUrl = options.databaseUrl || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test_db";

    const env = {
        CI: "true",
        NODE_ENV: "test",
        COVAI_JOB_ID: jobId || "",
        PLAYWRIGHT_BASE_URL: baseUrl,
        BASE_URL: baseUrl,
        DATABASE_URL: databaseUrl,
        PORT: options.port ? String(options.port) : "0",
    };

    const command = `npx playwright test ${testArgs} --reporter=json > ${quoteForShell(relativeResultsPath)}`;

    await addJobLog(jobId, "INFO", `[PLAYWRIGHT_API] Executing Playwright API tests against ${baseUrl}`).catch(() => {});
    const startedAt = Date.now();

    const abortSignal = options.signal || getJobAbortSignal(jobId);
    let execResult;

    try {
        execResult = await dockerRunner.run({
            snapshotPath: effectiveRootDir,
            command,
            timeoutMs: PLAYWRIGHT_TIMEOUT_MS,
            jobId,
            env,
            signal: abortSignal,
        });
    } catch (err) {
        await addJobLog(jobId, "ERROR", `[PLAYWRIGHT_API] Execution error: ${err.message}`).catch(() => {});
        throw err;
    }

    let reportJson = null;
    let scenarios = [];

    if (fs.existsSync(resultsPath)) {
        try {
            reportJson = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
            const parsed = parsePlaywrightApiJsonResults(reportJson);
            scenarios = parsed.scenarios || [];
        } catch (_) {}
    }

    const executionTimeMs = Date.now() - startedAt;

    return {
        exitCode: execResult.exitCode,
        stdout: execResult.stdout ?? "",
        stderr: execResult.stderr ?? "",
        executionTimeMs,
        coverageDir,
        resultsPath,
        reportJson,
        scenarios,
        passedCount: scenarios.filter((s) => s.status === "PASSED").length,
        failedCount: scenarios.filter((s) => s.status === "FAILED").length,
    };
};
