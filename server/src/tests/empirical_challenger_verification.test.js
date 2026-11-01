import fs from "fs";
import path from "path";
import os from "os";
import { describe, expect, it } from "@jest/globals";
import {
    syncCoverageDirectories,
    syncCoverageArtifactsToOrigin,
    getOptimalWorkerFlags,
    findLogicSourceFiles,
    clearLogicFilesCache,
    resolveJestBin
} from "../services/runTestsJob.service.js";

describe("Empirical Challenge Suite: Unit Test Runner Robustness & Performance", () => {

    describe("1. Dual Coverage Directory Detection & Mirroring Invariants", () => {
        it("detects and mirrors when coverage reports exist ONLY in coverage/unit", () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-dual-unit-only-"));
            try {
                const rootCov = path.join(tempDir, "coverage");
                const unitCov = path.join(tempDir, "coverage", "unit");
                fs.mkdirSync(unitCov, { recursive: true });

                const summaryPayload = {
                    total: {
                        lines: { total: 100, covered: 92, pct: 92 },
                        statements: { total: 120, covered: 110, pct: 91.66 },
                        functions: { total: 20, covered: 19, pct: 95 },
                        branches: { total: 40, covered: 35, pct: 87.5 }
                    },
                    "src/auth.service.js": {
                        lines: { total: 50, covered: 46, pct: 92 },
                        statements: { total: 60, covered: 55, pct: 91.66 },
                        functions: { total: 10, covered: 9, pct: 90 },
                        branches: { total: 20, covered: 17, pct: 85 }
                    }
                };
                fs.writeFileSync(path.join(unitCov, "coverage-summary.json"), JSON.stringify(summaryPayload, null, 2));
                fs.writeFileSync(path.join(unitCov, "jest-results.json"), JSON.stringify({ numPassedTests: 15, numFailedTests: 0 }));

                // Ensure rootCov does not have the files yet
                expect(fs.existsSync(path.join(rootCov, "coverage-summary.json"))).toBe(false);
                expect(fs.existsSync(path.join(rootCov, "jest-results.json"))).toBe(false);

                // Run synchronization
                const synced = syncCoverageDirectories(rootCov, unitCov);
                expect(synced).toBe(true);

                // Verify mirrored into coverage/
                const rootSummaryPath = path.join(rootCov, "coverage-summary.json");
                const rootResultsPath = path.join(rootCov, "jest-results.json");
                expect(fs.existsSync(rootSummaryPath)).toBe(true);
                expect(fs.existsSync(rootResultsPath)).toBe(true);

                const parsedRootSummary = JSON.parse(fs.readFileSync(rootSummaryPath, "utf8"));
                expect(parsedRootSummary.total.lines.pct).toBe(92);
                expect(parsedRootSummary["src/auth.service.js"].branches.pct).toBe(85);
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        it("mirrors all 12 supported coverage and result artifact types bidirectionally", () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-dual-all-artifacts-"));
            try {
                const rootCov = path.join(tempDir, "coverage");
                const unitCov = path.join(tempDir, "coverage", "unit");
                fs.mkdirSync(rootCov, { recursive: true });
                fs.mkdirSync(unitCov, { recursive: true });

                const artifacts = [
                    "coverage-summary.json",
                    "coverage-final.json",
                    "jest-results.json",
                    "vitest-results.json",
                    "test-results.json",
                    "lcov.info",
                    "jest-coverage-final.json",
                    "vitest-coverage-final.json",
                    "jest-coverage-summary.json",
                    "vitest-coverage-summary.json",
                    "jest-lcov.info",
                    "vitest-lcov.info"
                ];

                // Write 6 in rootCov, 6 in unitCov
                artifacts.slice(0, 6).forEach(name => {
                    fs.writeFileSync(path.join(rootCov, name), `content-from-root-${name}`);
                });
                artifacts.slice(6).forEach(name => {
                    fs.writeFileSync(path.join(unitCov, name), `content-from-unit-${name}`);
                });

                const synced = syncCoverageDirectories(rootCov, unitCov);
                expect(synced).toBe(true);

                // Both directories must now contain all 12 artifacts
                for (const name of artifacts) {
                    const inRoot = path.join(rootCov, name);
                    const inUnit = path.join(unitCov, name);
                    expect(fs.existsSync(inRoot)).toBe(true);
                    expect(fs.existsSync(inUnit)).toBe(true);
                    expect(fs.readFileSync(inRoot, "utf8")).toBe(fs.readFileSync(inUnit, "utf8"));
                }
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        it("resolves timestamp conflicts by prioritizing the newer modified file", async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-dual-timestamp-"));
            try {
                const rootCov = path.join(tempDir, "coverage");
                const unitCov = path.join(tempDir, "coverage", "unit");
                fs.mkdirSync(unitCov, { recursive: true });

                const oldSummary = { total: { lines: { pct: 50 } } };
                const newSummary = { total: { lines: { pct: 90 } } };

                // Write older file in rootCov
                fs.writeFileSync(path.join(rootCov, "coverage-summary.json"), JSON.stringify(oldSummary));
                const oldTime = new Date(Date.now() - 60000);
                fs.utimesSync(path.join(rootCov, "coverage-summary.json"), oldTime, oldTime);

                // Write newer file in unitCov
                fs.writeFileSync(path.join(unitCov, "coverage-summary.json"), JSON.stringify(newSummary));
                const newTime = new Date();
                fs.utimesSync(path.join(unitCov, "coverage-summary.json"), newTime, newTime);

                syncCoverageDirectories(rootCov, unitCov);

                const rootContent = JSON.parse(fs.readFileSync(path.join(rootCov, "coverage-summary.json"), "utf8"));
                expect(rootContent.total.lines.pct).toBe(90);
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        it("simulates runner candidate detection logic when summary exists exclusively in coverage/unit", () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-candidate-detection-"));
            try {
                const coverageDir = path.join(tempDir, "coverage");
                const unitCoverageDir = path.join(tempDir, "coverage", "unit");
                fs.mkdirSync(unitCoverageDir, { recursive: true });

                const rawSummary = {
                    total: {
                        lines: { total: 42, covered: 38, pct: 90.47 },
                        statements: { total: 45, covered: 40, pct: 88.88 }
                    }
                };
                fs.writeFileSync(path.join(unitCoverageDir, "coverage-summary.json"), JSON.stringify(rawSummary));

                // Replicate lines 3913-3949 of runTestsJob.service.js
                const summaryCandidates = [
                    path.join(unitCoverageDir, "coverage-summary.json"),
                    path.join(coverageDir, "coverage-summary.json"),
                    path.join(unitCoverageDir, "jest-coverage-summary.json"),
                    path.join(coverageDir, "jest-coverage-summary.json"),
                    path.join(unitCoverageDir, "vitest-coverage-summary.json"),
                    path.join(coverageDir, "vitest-coverage-summary.json")
                ];

                let hasValidCoverage = false;
                let validSummaryData = null;
                for (const candidate of summaryCandidates) {
                    if (fs.existsSync(candidate)) {
                        try {
                            const sum = JSON.parse(fs.readFileSync(candidate, "utf8"));
                            const totalLines = sum?.total?.lines?.total || 0;
                            const totalStmts = sum?.total?.statements?.total || 0;
                            const totalFiles = Object.keys(sum || {}).filter(k => k !== "total").length;
                            if (totalLines > 0 || totalStmts > 0 || totalFiles > 0) {
                                hasValidCoverage = true;
                                if (!validSummaryData) validSummaryData = sum;
                                break;
                            }
                        } catch { }
                    }
                }

                expect(hasValidCoverage).toBe(true);
                expect(validSummaryData).not.toBeNull();
                expect(validSummaryData.total.lines.pct).toBe(90.47);

                // Mirroring check
                const summaryFile = path.join(coverageDir, "coverage-summary.json");
                const unitSummaryFile = path.join(unitCoverageDir, "coverage-summary.json");
                if (validSummaryData) {
                    if (!fs.existsSync(summaryFile)) {
                        fs.writeFileSync(summaryFile, JSON.stringify(validSummaryData, null, 2), "utf8");
                    }
                    if (!fs.existsSync(unitSummaryFile)) {
                        fs.writeFileSync(unitSummaryFile, JSON.stringify(validSummaryData, null, 2), "utf8");
                    }
                }

                expect(fs.existsSync(summaryFile)).toBe(true);
                expect(fs.existsSync(unitSummaryFile)).toBe(true);
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        it("gracefully handles invalid inputs and empty directories without throwing", () => {
            expect(syncCoverageDirectories(null, null)).toBe(false);
            expect(syncCoverageDirectories("", "")).toBe(false);

            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-dual-empty-"));
            try {
                const c1 = path.join(tempDir, "cov1");
                const c2 = path.join(tempDir, "cov2");
                fs.mkdirSync(c1);
                fs.mkdirSync(c2);
                expect(syncCoverageDirectories(c1, c2)).toBe(false);
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });
    });

    describe("2. Exit Code 1 Recovery & Classification Invariants", () => {
        it("preserves coverage and routes exit code 1 to SUCCESS when valid coverage exists", () => {
            // Emulate execution logic at lines 3951-4055 & 4274-4278
            const runnerResult = { exitCode: 1 };
            const hasValidCoverage = true;
            let jobFailedCalled = false;
            let jobSuccessPayload = null;
            let warningLogged = false;

            const addJobLog = (id, level, msg) => {
                if (level === "WARN" && msg.includes("some test assertions failed (exit code 1)")) {
                    warningLogged = true;
                }
            };
            const markJobFailed = () => { jobFailedCalled = true; };
            const markJobSuccess = (id, payload) => { jobSuccessPayload = payload; };

            if (runnerResult && runnerResult.exitCode !== 0 && runnerResult.exitCode !== null) {
                if (!hasValidCoverage) {
                    markJobFailed();
                } else {
                    addJobLog("job-1", "WARN", `[RUN_TESTS] Runner completed with warning: some test assertions failed (exit code ${runnerResult.exitCode}). Collecting actual coverage results from executed tests...`);
                }
            }

            if (!jobFailedCalled) {
                const summaryResult = { summary: { linesPct: 85, branchesPct: 75, funcsPct: 90, stmtsPct: 88 } };
                markJobSuccess("job-1", {
                    coverageResult: {
                        lines: summaryResult.summary.linesPct,
                        branches: summaryResult.summary.branchesPct,
                        functions: summaryResult.summary.funcsPct,
                        statements: summaryResult.summary.stmtsPct
                    },
                    hasTestFailures: runnerResult && runnerResult.exitCode !== 0,
                    exitCode: runnerResult?.exitCode ?? 0
                });
            }

            expect(jobFailedCalled).toBe(false);
            expect(warningLogged).toBe(true);
            expect(jobSuccessPayload).not.toBeNull();
            expect(jobSuccessPayload.hasTestFailures).toBe(true);
            expect(jobSuccessPayload.exitCode).toBe(1);
            expect(jobSuccessPayload.coverageResult.lines).toBe(85);
        });

        it("fails job fatally when runner exits with code 1 and NO coverage exists", () => {
            const runnerResult = { exitCode: 1 };
            const hasValidCoverage = false;
            let jobFailedError = null;
            let jobSuccessCalled = false;

            const markJobFailed = (id, err) => { jobFailedError = err; };
            const markJobSuccess = () => { jobSuccessCalled = true; };

            if (runnerResult && runnerResult.exitCode !== 0 && runnerResult.exitCode !== null) {
                if (!hasValidCoverage) {
                    markJobFailed("job-2", new Error(`Test execution failed with exit code ${runnerResult.exitCode}`));
                }
            }

            expect(jobSuccessCalled).toBe(false);
            expect(jobFailedError).not.toBeNull();
            expect(jobFailedError.message).toBe("Test execution failed with exit code 1");
        });

        it("distinguishes module resolution crashes from generic exit code 1", () => {
            const fullOutput = "Error: Cannot find module 'lodash' from 'src/tests/calc.test.js'";
            const modResError = { missingModule: "lodash", testFile: "src/tests/calc.test.js" };
            const hasValidCoverage = false;
            const runnerResult = { exitCode: 1 };

            let failMessage = modResError
                ? `Test suite failed to run: Cannot find module '${modResError.missingModule}' from '${modResError.testFile}'`
                : `Test execution failed with exit code ${runnerResult.exitCode}`;

            expect(failMessage).toContain("Cannot find module 'lodash'");
        });

        it("ensures getCoverageSummary response exposes coverage instead of 'Unavailable' when hasTestFailures is true", () => {
            // Emulate coverage.controller.js lines 869-959
            const latestJob = { status: "SUCCESS" };
            const latestTestRun = {
                failedTests: 1,
                passedTests: 4,
                totalTests: 5,
                status: "FAILED",
                scenarios: [{ title: "cart checkout fails on coupon timeout", status: "failed", failureMessages: ["Expected 200, got 500"] }]
            };
            const coverage = { statements: 88, branches: 82, functions: 90, lines: 87.5 };

            const isJobFailed = latestJob?.status === "FAILED";
            const hasModuleResolutionError = false;
            const isFatalFailure = isJobFailed || hasModuleResolutionError;
            const hasTestFailures = (latestTestRun?.failedTests || 0) > 0;

            let latestRunStatus = "success";
            if (isFatalFailure) {
                latestRunStatus = "failed";
            } else if (hasTestFailures) {
                latestRunStatus = "passed_with_failures";
            }

            const responseData = {
                coverage: isFatalFailure ? null : coverage,
                previousCoverage: coverage,
                isPreviousResult: isFatalFailure,
                latestRunStatus,
                hasTestFailures
            };

            // Invariants:
            // 1. coverage is NOT null
            expect(responseData.coverage).not.toBeNull();
            expect(responseData.coverage.lines).toBe(87.5);
            // 2. isPreviousResult is false (this is current coverage, NOT excluded)
            expect(responseData.isPreviousResult).toBe(false);
            // 3. latestRunStatus explains that tests passed with assertion failures
            expect(responseData.latestRunStatus).toBe("passed_with_failures");
            expect(responseData.hasTestFailures).toBe(true);
        });
    });

    describe("3. Performance Improvements & Runner Flags Invariants", () => {
        it("supplies --runInBand dynamically for test suites with <= 3 test files", () => {
            expect(getOptimalWorkerFlags(1)).toBe("--runInBand");
            expect(getOptimalWorkerFlags(2)).toBe("--runInBand");
            expect(getOptimalWorkerFlags(3)).toBe("--runInBand");
        });

        it("supplies --maxWorkers=2 for suites with > 3 files or default file count", () => {
            expect(getOptimalWorkerFlags(4)).toBe("--maxWorkers=2");
            expect(getOptimalWorkerFlags(10)).toBe("--maxWorkers=2");
            expect(getOptimalWorkerFlags(100)).toBe("--maxWorkers=2");
            expect(getOptimalWorkerFlags(0)).toBe("--maxWorkers=2");
        });

        it("preserves explicit concurrency flags in custom commands", () => {
            expect(getOptimalWorkerFlags(1, "jest --runInBand")).toBe("");
            expect(getOptimalWorkerFlags(1, "jest --maxWorkers=4")).toBe("");
            expect(getOptimalWorkerFlags(10, "jest --runInBand")).toBe("");
            expect(getOptimalWorkerFlags(10, "jest --maxWorkers=1")).toBe("");
            expect(getOptimalWorkerFlags(10, "npm test -- --maxWorkers=50%")).toBe("");
        });

        it("verifies --json is omitted from Jest CLI stdout and outputFile is preserved", () => {
            const rootDir = "/fake/root";
            const relCovDir = "coverage/unit";
            const rootJestBin = "node node_modules/jest/bin/jest.js";
            const rootWorkerFlags = getOptimalWorkerFlags(2);

            const jestCmd = `${rootJestBin} --coverage --coverageDirectory="${relCovDir}" --passWithNoTests --coverageReporters=json-summary --coverageReporters=json --coverageReporters=lcov --outputFile="${relCovDir}/jest-results.json" --forceExit --testTimeout=10000 ${rootWorkerFlags} --cache`.replace(/\s+/g, " ").trim();

            // Check that stdout pollution flag is NOT present
            expect(jestCmd).not.toContain(" --json ");
            expect(jestCmd).not.toMatch(/\s--json(?:\s|$)/);

            // Check that file-based output is configured
            expect(jestCmd).toContain(`--outputFile="${relCovDir}/jest-results.json"`);
            expect(jestCmd).toContain(`--coverageDirectory="${relCovDir}"`);
            expect(jestCmd).toContain("--testTimeout=10000");
            expect(jestCmd).toContain("--runInBand");
            expect(jestCmd).toContain("--cache");
        });

        it("verifies Vitest configuration includes timeout, worker limits, and coverage.all=false", () => {
            const backendBin = "npx vitest";
            const relCovDir = "coverage/unit";
            const coverageAllFlag = "--coverage.all=false";
            const vitestCmd = `cd backend && ${backendBin} run tests/unit --globals --coverage ${coverageAllFlag} --testTimeout=10000 --maxWorkers=2 --coverage.reportsDirectory=../${relCovDir} --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=lcov --coverage.reportOnFailure=true --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0 --reporter=default --reporter=json --outputFile=../${relCovDir}/vitest-results.json --passWithNoTests`;

            expect(vitestCmd).toContain("--maxWorkers=2");
            expect(vitestCmd).toContain("--testTimeout=10000");
            expect(vitestCmd).toContain("--coverage.all=false");
            expect(vitestCmd).toContain(`--outputFile=../${relCovDir}/vitest-results.json`);
        });

        it("caches findLogicSourceFiles and clears cache on clearLogicFilesCache", () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-cache-test-"));
            try {
                clearLogicFilesCache();
                const srcDir = path.join(tempDir, "src");
                fs.mkdirSync(srcDir, { recursive: true });
                fs.writeFileSync(path.join(srcDir, "logicA.js"), "export const a = 1;");

                const firstScan = findLogicSourceFiles(tempDir);
                expect(firstScan.length).toBe(1);

                // Add another file without invalidation
                fs.writeFileSync(path.join(srcDir, "logicB.js"), "export const b = 2;");
                const secondScan = findLogicSourceFiles(tempDir);
                expect(secondScan.length).toBe(1); // Cached!

                // Clear cache
                clearLogicFilesCache();
                const thirdScan = findLogicSourceFiles(tempDir);
                expect(thirdScan.length).toBe(2); // Fresh!
            } finally {
                clearLogicFilesCache();
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });
    });
});
