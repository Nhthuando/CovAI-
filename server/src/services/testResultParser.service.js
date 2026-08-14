import fs from "fs";
import path from "path";

/**
 * Parse Jest JSON output file
 * @param {string} coverageDir 
 * @returns {Object|null}
 */
export const parseJestResults = (coverageDir) => {
    const resultsPath = path.join(coverageDir, "test-results.json");
    if (!fs.existsSync(resultsPath)) {
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

        // Calculate duration
        const duration = raw.testResults ? raw.testResults.reduce((acc, suite) => acc + (suite.endTime - suite.startTime), 0) : 0;

        return {
            totalTests: raw.numTotalTests || 0,
            passedTests: raw.numPassedTests || 0,
            failedTests: raw.numFailedTests || 0,
            skippedTests: raw.numPendingTests || 0,
            durationMs: duration,
            status: raw.success ? "PASSED" : "FAILED"
        };
    } catch (err) {
        console.error("Error parsing test-results.json:", err);
        return null;
    }
};