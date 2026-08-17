import fs from "fs";
import path from "path";

/**
 * Parse Jest JSON output file
 * @param {string} coverageDir 
 * @returns {Object|null}
 */
export const parseJestResults = (coverageDir) => {
    const resultsPath = path.join(coverageDir, "test-results.json");
    console.log(`[TEST-RESULT] parsing Jest results from: ${resultsPath}`);

    if (!fs.existsSync(resultsPath)) {
        console.error(`[TEST-RESULT] File not found: ${resultsPath}`);
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

        // Calculate duration
        const duration = raw.testResults ? raw.testResults.reduce((acc, suite) => acc + (suite.endTime - suite.startTime), 0) : 0;

        const results = {
            totalTests: raw.numTotalTests || 0,
            passedTests: raw.numPassedTests || 0,
            failedTests: raw.numFailedTests || 0,
            skippedTests: raw.numPendingTests || 0,
            durationMs: duration,
            status: raw.success ? "PASSED" : "FAILED"
        };

        console.log(`[TEST-RESULT] parsed:`, results);
        return results;
    } catch (err) {
        console.error(`[TEST-RESULT] Error parsing ${resultsPath}:`, err);
        throw new Error(`Jest execution result was not available for TestRun persistence. Path: ${resultsPath}. Error: ${err.message}`);
    }
};

/**
 * Parse Vitest JSON output file
 * @param {string} coverageDir
 * @return {Object|null}
 */
export const parseVitestResults = (coverageDir) => {
    const resultsPath = path.join(coverageDir, "test-result.json");
    console.log(`[TEST-RESULT] parsing Vitest results from: ${resultsPath}`);

    if (!fs.existsSync(resultsPath)) {
        console.error(`[TEST-RESULT] File not found: ${resultsPath}`);
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

        // Vitest JSON output format is highly compatible with Jest
        const duration = raw.testResults ? raw.testResults.reduce((acc, suite) => acc + (suite.endTime - suite.startTime), 0) : 0;

        const results = {
            totalTests: raw.numTotalTests || 0,
            passedTests: raw.numPassedTests || 0,
            failedTests: raw.numFailedTests || 0,
            skippedTests: raw.numPendingTests || 0,
            durationMs: duration,
            status: raw.success ? "PASSED" : "FAILED"
        };

        console.log(`[TEST-RESULT] parsed:`, results);
        return results;
    } catch (err) {
        console.error(`[TEST-RESULT] Error parsing ${resultsPath}:`, err);
        throw new Error(`Vitest execution result was not available for TestRun persistence. Path: ${resultsPath}. Error: ${err.message}`);
    }
};