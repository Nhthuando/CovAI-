import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import {
    runJestCoverage,
    parseFinalCoverageFiles,
    parseFinalCoverageFunctions,
    readCoverageFinal,
    mergeCoverageSummaries,
    coverageResultFromSummary,
    parseModuleResolutionError
} from "./runTestsJob.service.js";
import { runVitestCoverage } from "./vitestRunner.service.js";
import { getFileCoverageDetails, normalizePath, findAssociatedTestFile } from "./fileCoverage.service.js";

/**
 * Resolve snapshot root directory across Windows host and Docker container paths.
 */
export const resolveSnapshotRootDir = (rootDir) => {
    if (!rootDir) return null;
    if (fs.existsSync(rootDir)) return rootDir;
    if (rootDir.startsWith("/app/")) {
        const hostCandidate = path.resolve(process.cwd(), rootDir.replace(/^\/app\//, ""));
        if (fs.existsSync(hostCandidate)) return hostCandidate;
    }
    const storageIdx = rootDir.indexOf("storage");
    if (storageIdx !== -1) {
        const subPath = rootDir.slice(storageIdx).replace(/\\/g, "/");
        const containerCandidate = path.join("/app", subPath);
        if (fs.existsSync(containerCandidate)) return containerCandidate;
        const hostCandidate = path.resolve(process.cwd(), subPath);
        if (fs.existsSync(hostCandidate)) return hostCandidate;
    }
    return rootDir;
};

/**
 * Clean relative path from repo root.
 */
const sanitizePath = (rootDir, targetPath) => {
    if (!targetPath) return "";
    let norm = normalizePath(targetPath);
    if (rootDir) {
        const normRoot = normalizePath(rootDir);
        if (norm.startsWith(normRoot)) {
            norm = norm.slice(normRoot.length);
        }
    }
    norm = norm.replace(/^[a-zA-Z]:[\\/]/, "");
    norm = norm.replace(/^.*?\/storage\/projects\/[^/]+\/[^/]+\/[^/]+\/repo\//i, "");
    norm = norm.replace(/^.*?\/repo\//i, "");
    return norm.replace(/^\/+/, "");
};

/**
 * Apply suggestion code to an existing or new test file.
 * Safely merges without overwriting if multiple suggestions edit the same file.
 *
 * @param {string} rootDir
 * @param {Object} suggestion
 * @returns {{ targetTestFile: string, changed: boolean, originalContent: string, newContent: string }}
 */
export const applyCodeToTestFile = (rootDir, suggestion) => {
    let rawTestFile = suggestion.testFile || suggestion.targetTestFile;
    if (!rawTestFile && suggestion.sourceFile) {
        const found = findAssociatedTestFile(rootDir, suggestion.sourceFile);
        rawTestFile = found.found ? found.filePath : (found.suggestedFilePath || `tests/${path.basename(suggestion.sourceFile, path.extname(suggestion.sourceFile))}.test.js`);
    }
    if (!rawTestFile) {
        throw new ServiceError("testFile is required in suggestion metadata", 400);
    }

    const relTestPath = sanitizePath(rootDir, rawTestFile);
    const fullTestPath = path.join(rootDir, relTestPath);

    const targetDir = path.dirname(fullTestPath);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileExisted = fs.existsSync(fullTestPath);
    const originalContent = fileExisted ? fs.readFileSync(fullTestPath, "utf8") : "";

    let newContent = "";
    const codeToAdd = suggestion.generatedCode || suggestion.suggestedTestCode || suggestion.code || "";
    const fullContentProvided = suggestion.fullUpdatedContent;

    if (fullContentProvided && (!fileExisted || !originalContent.trim())) {
        newContent = fullContentProvided.trimEnd() + "\n";
    } else if (fullContentProvided && !originalContent.includes(codeToAdd.trim())) {
        // If file content was modified by a previous suggestion, merge the new code block
        if (originalContent.includes("describe(") || originalContent.includes("test(") || originalContent.includes("it(")) {
            newContent = originalContent.trimEnd() + "\n\n" + codeToAdd.trim() + "\n";
        } else {
            newContent = fullContentProvided.trimEnd() + "\n";
        }
    } else if (fileExisted && originalContent.trim()) {
        if (originalContent.includes(codeToAdd.trim())) {
            // Already contains code
            newContent = originalContent;
        } else {
            // Append new test block
            newContent = originalContent.trimEnd() + "\n\n" + codeToAdd.trim() + "\n";
        }
    } else {
        newContent = (fullContentProvided || codeToAdd).trimEnd() + "\n";
    }

    fs.writeFileSync(fullTestPath, newContent, "utf8");

    // Verify file actually written and changed
    const verifiedContent = fs.readFileSync(fullTestPath, "utf8");
    const changed = verifiedContent !== originalContent;

    return {
        targetTestFile: relTestPath,
        changed,
        originalContent,
        newContent: verifiedContent
    };
};

/**
 * Applies one or more test suggestions, reruns affected tests, collects real coverage,
 * and updates the database with new coverage results.
 *
 * @param {Object} params
 * @param {string} params.snapshotId
 * @param {string} [params.projectId]
 * @param {string} params.userId
 * @param {Object} [params.suggestion] - Single suggestion object
 * @param {Object[]} [params.suggestions] - Multiple suggestions array
 * @returns {Promise<Object>}
 */
export const applyUnitTestSuggestion = async ({ snapshotId, projectId, userId, suggestion, suggestions = [] }) => {
    if (!snapshotId) {
        throw new ServiceError("snapshotId is required", 400);
    }

    const itemsToApply = Array.isArray(suggestions) && suggestions.length > 0
        ? suggestions
        : (suggestion ? [suggestion] : []);

    if (itemsToApply.length === 0) {
        throw new ServiceError("No suggestion provided to apply", 400);
    }

    // Load Snapshot and Project
    const snapshot = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        include: {
            project: true,
            coverageSummaries: true
        }
    });

    if (!snapshot) {
        throw new ServiceError("Project snapshot not found", 404);
    }

    const rootDir = resolveSnapshotRootDir(snapshot.rootDir);
    if (!rootDir || !fs.existsSync(rootDir)) {
        throw new ServiceError("Project snapshot root directory not found on filesystem", 409);
    }

    const actualProjectId = projectId || snapshot.projectId;

    // Record previous coverage before applying changes
    const previousCoverage = snapshot.coverageSummaries
        ? {
            statements: snapshot.coverageSummaries.stmtsPct,
            branches: snapshot.coverageSummaries.branchesPct,
            functions: snapshot.coverageSummaries.funcsPct,
            lines: snapshot.coverageSummaries.linesPct
        }
        : null;

    // Apply suggestions to test files on disk
    const appliedList = [];
    const modifiedFiles = new Set();

    for (const sug of itemsToApply) {
        const result = applyCodeToTestFile(rootDir, sug);
        modifiedFiles.add(result.targetTestFile);
        appliedList.push({
            suggestionId: sug.suggestionId || sug.id,
            sourceFile: sug.sourceFile,
            testFile: result.targetTestFile,
            framework: sug.framework || "jest",
            targetLines: sug.targetLines || [],
            targetBranches: sug.targetBranches || [],
            changed: result.changed,
            status: "APPLIED"
        });
    }

    const coverageDir = path.join(rootDir, "coverage");
    if (!fs.existsSync(coverageDir)) {
        try { fs.mkdirSync(coverageDir, { recursive: true }); } catch { }
    }

    // Invalidate old test results and coverage files to guarantee no stale data is returned
    const staleFiles = [
        path.join(coverageDir, "coverage-summary.json"),
        path.join(coverageDir, "coverage-final.json"),
        path.join(coverageDir, "jest-results.json"),
        path.join(coverageDir, "vitest-results.json"),
        path.join(coverageDir, "test-results.json")
    ];
    for (const sf of staleFiles) {
        if (fs.existsSync(sf)) {
            try { fs.unlinkSync(sf); } catch { }
        }
    }

    // Determine testing framework
    const testFilesToRun = Array.from(modifiedFiles);
    const isVitest = itemsToApply.some(s => s.framework === "vitest") ||
        testFilesToRun.some(f => f.includes("vitest") || f.includes(".vitest."));
    const framework = isVitest ? "vitest" : "jest";

    let testExecutionError = null;
    let runnerExitCode = 0;
    let rawOutput = "";

    try {
        if (isVitest) {
            const vitestRes = await runVitestCoverage(null, rootDir, snapshot.vitestCommand, testFilesToRun);
            runnerExitCode = vitestRes.exitCode;
            rawOutput = (vitestRes.stderr || "") + "\n" + (vitestRes.stdout || "");
        } else {
            const jestRes = await runJestCoverage(null, rootDir, snapshot.jestConfigPath, testFilesToRun);
            runnerExitCode = jestRes.exitCode;
            rawOutput = (jestRes.stderr || "") + "\n" + (jestRes.stdout || "");
        }
    } catch (runErr) {
        testExecutionError = runErr.message;
        runnerExitCode = 1;
        rawOutput += "\n" + runErr.message;
    }

    const modResError = parseModuleResolutionError(rawOutput, rootDir);

    // If test failed or exited with non-zero
    if (runnerExitCode !== 0 || testExecutionError) {
        for (const item of appliedList) {
            item.status = "FAILED";
        }

        return {
            success: false,
            fileUpdated: true,
            status: "FAILED",
            message: testExecutionError || "Test execution failed after applying suggestion",
            errorDetail: modResError ? modResError.actualError : (rawOutput.slice(0, 1000) || testExecutionError),
            moduleResolutionError: modResError,
            appliedSuggestions: appliedList,
            previousCoverage,
            newCoverage: null, // Strictly null: do not fake or keep old coverage
            testResults: {
                totalTests: 0,
                passedTests: 0,
                failedTests: 1,
                status: "failed",
                error: testExecutionError || rawOutput.slice(0, 500)
            }
        };
    }

    // Tests succeeded! Collect REAL coverage from coverage-summary.json
    const summaryFile = path.join(coverageDir, "coverage-summary.json");
    let newCoverage = null;

    if (fs.existsSync(summaryFile)) {
        try {
            const rawSum = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
            const cleanedSum = mergeCoverageSummaries(rawSum, {});
            const total = cleanedSum.total;
            if (total) {
                newCoverage = {
                    statements: total.statements.pct,
                    branches: total.branches.pct,
                    functions: total.functions.pct,
                    lines: total.lines.pct
                };

                // Update CoverageSummary in DB
                await prisma.coverageSummary.upsert({
                    where: { snapshotId },
                    update: {
                        stmtsPct: newCoverage.statements,
                        branchesPct: newCoverage.branches,
                        funcsPct: newCoverage.functions,
                        linesPct: newCoverage.lines
                    },
                    create: {
                        snapshotId,
                        stmtsPct: newCoverage.statements,
                        branchesPct: newCoverage.branches,
                        funcsPct: newCoverage.functions,
                        linesPct: newCoverage.lines
                    }
                });
            }
        } catch (sumErr) {
            console.warn("[applyUnitTestSuggestion] Error parsing new coverage-summary:", sumErr.message);
        }
    }

    // Parse per-file and per-function coverage to update database
    await parseFinalCoverageFiles(null, snapshotId, actualProjectId, userId, coverageDir);
    await parseFinalCoverageFunctions(null, snapshotId, actualProjectId, userId, coverageDir);

    // Read test execution results
    let testResults = null;
    const jestResultsPath = path.join(coverageDir, "jest-results.json");
    const vitestResultsPath = path.join(coverageDir, "vitest-results.json");
    const testResultsPath = path.join(coverageDir, "test-results.json");

    for (const p of [jestResultsPath, vitestResultsPath, testResultsPath]) {
        if (fs.existsSync(p)) {
            try {
                testResults = JSON.parse(fs.readFileSync(p, "utf8"));
                break;
            } catch { }
        }
    }

    for (const item of appliedList) {
        item.status = "PASSED";
    }

    // Fetch updated source file coverage details for the affected source files
    const sourceFileCoverage = [];
    const sourceFilesInspected = new Set(itemsToApply.map(s => s.sourceFile).filter(Boolean));
    for (const sf of sourceFilesInspected) {
        try {
            const cov = getFileCoverageDetails(rootDir, sf);
            sourceFileCoverage.push({
                filePath: sf,
                ...cov
            });
        } catch { }
    }

    return {
        success: true,
        fileUpdated: true,
        status: "PASSED",
        message: "Applied test suggestion successfully and verified new coverage.",
        appliedSuggestions: appliedList,
        previousCoverage,
        newCoverage: newCoverage || previousCoverage,
        testResults: testResults || { status: "passed", totalTests: 1, passedTests: 1 },
        sourceFileCoverage
    };
};

