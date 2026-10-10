import fs from "fs";
import path from "path";
import { cleanStoragePath, cleanStorageText } from "../utils/pathSanitizer.js";

/**
 * Helper to find a file by candidate names in either dir or dir's parent
 */
const findExistingFile = (dir, names) => {
    for (const name of names) {
        const p1 = path.join(dir, name);
        if (fs.existsSync(p1)) return p1;
        const p2 = path.join(path.dirname(dir), name);
        if (fs.existsSync(p2)) return p2;
    }
    return null;
};

/**
 * Parse Jest JSON output file
 * @param {string} coverageDir 
 * @returns {Object|null}
 */
export const parseJestResults = (coverageDir) => {
    const resultsPath = findExistingFile(coverageDir, ["jest-results.json", "test-results.json", "test-result.json"]);
    console.log(`[TEST-RESULT] parsing Jest results from: ${resultsPath || coverageDir}`);

    if (!resultsPath) {
        console.error(`[TEST-RESULT] File not found in ${coverageDir}`);
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

        // Calculate duration
        const duration = raw.testResults ? raw.testResults.reduce((acc, suite) => acc + (suite.endTime - suite.startTime), 0) : 0;

        const scenarios = [];
        if (raw.testResults) {
            raw.testResults.forEach(suite => {
                const cleanedSuiteFile = cleanStoragePath(suite.name);
                if (suite.assertionResults && suite.assertionResults.length > 0) {
                    suite.assertionResults.forEach(assertion => {
                        scenarios.push({
                            title: assertion.title,
                            suiteName: assertion.ancestorTitles ? assertion.ancestorTitles.join(" > ") : "",
                            status: assertion.status, // "passed", "failed", "pending"
                            duration: assertion.duration || 0,
                            failureMessages: (assertion.failureMessages || []).map(m => cleanStorageText(m)),
                            testFile: cleanedSuiteFile
                        });
                    });
                } else if (suite.status === "failed" || suite.message) {
                    // Test suite failed at module load or syntax phase
                    scenarios.push({
                        title: path.basename(cleanedSuiteFile || suite.name || "Test Suite"),
                        suiteName: path.basename(cleanedSuiteFile || suite.name || "Test Suite"),
                        status: "failed",
                        duration: (suite.endTime && suite.startTime) ? (suite.endTime - suite.startTime) : 0,
                        failureMessages: suite.message ? [cleanStorageText(suite.message)] : ["Test suite failed to run"],
                        testFile: cleanedSuiteFile || null
                    });
                }
            });
        }

        const totalTests = raw.numTotalTests || 0;
        const failedTests = raw.numFailedTests || 0;

        const results = {
            totalTests,
            passedTests: raw.numPassedTests || 0,
            failedTests,
            skippedTests: raw.numPendingTests || 0,
            durationMs: duration,
            status: raw.success ? "PASSED" : "FAILED",
            scenarios
        };

        const scenariosPath = path.join(coverageDir, "integration-scenarios.json");
        fs.writeFileSync(scenariosPath, JSON.stringify(scenarios, null, 2), "utf8");

        console.log(`[TEST-RESULT] parsed ${scenarios.length} scenarios.`, {
            total: results.totalTests,
            status: results.status
        });
        return results;
    } catch (err) {
        console.error(`[TEST-RESULT] Error parsing ${resultsPath}:`, err);
        throw new Error(`Jest execution result was not available for TestRun persistence. Path: ${resultsPath}. Error: ${err.message}`);
    }
};

/**
 * Helper to convert raw scenario list to Prisma relation create input
 * @param {Array} scenarios 
 * @returns {Object|undefined}
 */
export const formatScenariosForPrisma = (scenarios) => {
    if (!Array.isArray(scenarios) || scenarios.length === 0) {
        return undefined;
    }
    return {
        create: scenarios.map(s => ({
            title: s.title || s.name || "Untitled Scenario",
            suiteName: s.suiteName || (Array.isArray(s.ancestorTitles) ? s.ancestorTitles.join(" > ") : null),
            status: s.status || "UNKNOWN",
            durationMs: typeof s.duration === "number" ? s.duration : (typeof s.durationMs === "number" ? s.durationMs : 0),
            failureMessages: (Array.isArray(s.failureMessages) ? s.failureMessages : (s.failureMessages ? [String(s.failureMessages)] : [])).map(m => cleanStorageText(m)),
            testFile: cleanStoragePath(s.testFile) || null
        }))
    };
};

/**
 * Parse Vitest JSON output file
 * @param {string} coverageDir
 * @return {Object|null}
 */
export const parseVitestResults = (coverageDir) => {
    const resultsPath = findExistingFile(coverageDir, ["vitest-results.json", "test-results.json", "test-result.json"]);
    console.log(`[TEST-RESULT] parsing Vitest results from: ${resultsPath || coverageDir}`);

    if (!resultsPath) {
        console.error(`[TEST-RESULT] File not found in ${coverageDir}`);
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

        // Vitest JSON output format is highly compatible with Jest
        const duration = raw.testResults ? raw.testResults.reduce((acc, suite) => acc + (suite.endTime - suite.startTime), 0) : 0;

        const scenarios = [];
        if (raw.testResults) {
            raw.testResults.forEach(suite => {
                const cleanedSuiteFile = cleanStoragePath(suite.name);
                if (suite.assertionResults) {
                    suite.assertionResults.forEach(assertion => {
                        scenarios.push({
                            title: assertion.title,
                            suiteName: assertion.ancestorTitles ? assertion.ancestorTitles.join(" > ") : "",
                            status: assertion.status,
                            duration: assertion.duration || 0,
                            failureMessages: (assertion.failureMessages || []).map(m => cleanStorageText(m)),
                            testFile: cleanedSuiteFile
                        });
                    });
                }
            });
        }

        const results = {
            totalTests: raw.numTotalTests || 0,
            passedTests: raw.numPassedTests || 0,
            failedTests: raw.numFailedTests || 0,
            skippedTests: raw.numPendingTests || 0,
            durationMs: duration,
            status: raw.success ? "PASSED" : "FAILED",
            scenarios
        };

        console.log(`[TEST-RESULT] parsed:`, results);
        return results;
    } catch (err) {
        console.error(`[TEST-RESULT] Error parsing ${resultsPath}:`, err);
        throw new Error(`Vitest execution result was not available for TestRun persistence. Path: ${resultsPath}. Error: ${err.message}`);
    }
};

/**
 * Parse Cypress JSON output file
 * @param {string} rootDir
 * @returns {Object|null}
 */
export const parseCypressResults = (rootDir) => {
    const resultsPath = path.join(rootDir, "cypress-results.json");
    console.log(`[TEST-RESULT] parsing Cypress results from: ${resultsPath}`);

    if (!fs.existsSync(resultsPath)) {
        console.error(`[TEST-RESULT] File not found: ${resultsPath}`);
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

        const results = {
            totalTests: raw.stats?.tests || 0,
            passedTests: raw.stats?.passes || 0,
            failedTests: raw.stats?.failures || 0,
            skippedTests: raw.stats?.pending || 0,
            durationMs: raw.stats?.duration || 0,
            status: (raw.stats?.failures || 0) === 0 ? "PASSED" : "FAILED"
        };

        console.log(`[TEST-RESULT] parsed:`, results);
        return results;
    } catch (err) {
        console.error(`[TEST-RESULT] Error parsing ${resultsPath}:`, err);
        throw new Error(`Cypress execution result was not available for TestRun persistence. Path: ${resultsPath}. Error: ${err.message}`);
    }
};

/**
 * Parse Playwright JSON output file
 * @param {string} rootDir
 * @returns {Object|null}
 */
export const parsePlaywrightResults = (rootDir) => {
    const resultsPath = path.join(rootDir, "playwright-results.json");
    console.log(`[TEST-RESULT] parsing Playwright results from: ${resultsPath}`);

    if (!fs.existsSync(resultsPath)) {
        console.error(`[TEST-RESULT] File not found: ${resultsPath}`);
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

        const passed = raw.stats?.expected || 0;
        const failed = (raw.stats?.unexpected || 0) + (raw.stats?.flaky || 0);
        const skipped = raw.stats?.skipped || 0;
        const total = passed + failed + skipped;

        const results = {
            totalTests: total,
            passedTests: passed,
            failedTests: failed,
            skippedTests: skipped,
            durationMs: raw.stats?.duration || 0,
            status: failed === 0 ? "PASSED" : "FAILED"
        };

        console.log(`[TEST-RESULT] parsed:`, results);
        return results;
    } catch (err) {
        console.error(`[TEST-RESULT] Error parsing ${resultsPath}:`, err);
        throw new Error(`Playwright execution result was not available for TestRun persistence. Path: ${resultsPath}. Error: ${err.message}`);
    }
};
