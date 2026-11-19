import fs from "fs";
import path from "path";
import os from "os";
import { describe, test, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mock Prisma
const mockPrisma = {
    $transaction: jest.fn(async (cb) => (typeof cb === "function" ? cb(mockPrisma) : Promise.all(cb))),
    project: { findFirst: jest.fn(), findUnique: jest.fn() },
    projectSnapshot: { findUnique: jest.fn(), findFirst: jest.fn() },
    coverageSummary: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({}) },
    coverageFile: { findMany: jest.fn(), findFirst: jest.fn(), upsert: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    coverageFunction: { findMany: jest.fn().mockResolvedValue([]) },
    testRun: { findFirst: jest.fn().mockResolvedValue(null) },
    job: { findFirst: jest.fn().mockResolvedValue(null) },
    aiTest: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: "ai-1" }) }
};

await jest.unstable_mockModule("../config/prisma.js", () => ({ default: mockPrisma }));

// Pure coverage-outcome checks use a deterministic preparation seam; real DB
// publication/rollback tests live in projectWorkspacePublish.integration.test.js.
await jest.unstable_mockModule('../services/projectWorkspacePreparation.service.js',()=>({
    withPreparedProjectWorkspace:jest.fn(async(options,run)=>{
        expect(options.expectedWorkspaceRevision).toBe(0);
        expect(options.snapshotId).toBe('snap-dod');
        return run({});
    }),
}));

await jest.unstable_mockModule("../controllers/coverage.controller.js", () => ({
    invalidateCoverageCache: jest.fn()
}));

const {
    verifyQuantitativeDoD,
    applyUnitTestSuggestion,
    applyCodeToTestFile
} = await import("../services/applyTestSuggestion.service.js");

const { parseJavaScriptCode } = await import("../services/babelParser.service.js");

describe("6. Verification Plan & Acceptance Criteria (Quantitative DoD)", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-dod-verification-"));
        jest.clearAllMocks();
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { }
    });

    describe("6.1.1 Minimum Target Coverage Threshold (>= 90%)", () => {
        test("accepts DoD when all 4 metrics (Statements, Branches, Functions, Lines) reach >= 90%", () => {
            const coverage = {
                statements: 95.5,
                branches: 91.2,
                functions: 100.0,
                lines: 94.8
            };
            const testResults = { totalTests: 12, passedTests: 12, failedTests: 0, status: "passed" };
            const testCode = "describe('OrderService', () => { test('works', () => expect(1).toBe(1)); });";

            const result = verifyQuantitativeDoD({
                coverage,
                testResults,
                testCode,
                rootDir: tempDir
            });

            expect(result.passed).toBe(true);
            expect(result.criteria.coverageThreshold.passed).toBe(true);
            expect(result.criteria.coverageThreshold.statements.passed).toBe(true);
            expect(result.criteria.coverageThreshold.branches.passed).toBe(true);
            expect(result.criteria.coverageThreshold.functions.passed).toBe(true);
            expect(result.criteria.coverageThreshold.lines.passed).toBe(true);
        });

        test("marks optimal: true when all 4 metrics reach 100%", () => {
            const coverage = {
                statements: 100,
                branches: 100,
                functions: 100,
                lines: 100
            };
            const testResults = { totalTests: 8, passedTests: 8, failedTests: 0, status: "passed" };
            const testCode = "describe('TaxService', () => { test('optimal', () => expect(true).toBe(true)); });";

            const result = verifyQuantitativeDoD({
                coverage,
                testResults,
                testCode,
                rootDir: tempDir
            });

            expect(result.passed).toBe(true);
            expect(result.criteria.coverageThreshold.statements.optimal).toBe(true);
            expect(result.criteria.coverageThreshold.branches.optimal).toBe(true);
            expect(result.criteria.coverageThreshold.functions.optimal).toBe(true);
            expect(result.criteria.coverageThreshold.lines.optimal).toBe(true);
        });

        test("rejects DoD if Branch Coverage is below 90% despite other 3 metrics reaching 100%", () => {
            const coverage = {
                statements: 100,
                branches: 87.5, // Below 90% threshold
                functions: 100,
                lines: 100
            };
            const testResults = { totalTests: 10, passedTests: 10, failedTests: 0, status: "passed" };
            const testCode = "describe('Pricing', () => { test('test', () => expect(1).toBe(1)); });";

            const result = verifyQuantitativeDoD({
                coverage,
                testResults,
                testCode,
                rootDir: tempDir
            });

            expect(result.passed).toBe(false);
            expect(result.criteria.coverageThreshold.passed).toBe(false);
            expect(result.criteria.coverageThreshold.branches.passed).toBe(false);
            expect(result.criteria.coverageThreshold.statements.passed).toBe(true);
        });

        test("rejects DoD if Statements, Functions, or Lines fall below 90%", () => {
            const lowStatements = { statements: 88, branches: 92, functions: 100, lines: 91 };
            const lowFunctions = { statements: 95, branches: 92, functions: 85, lines: 95 };
            const lowLines = { statements: 92, branches: 91, functions: 100, lines: 89 };

            const testResults = { totalTests: 5, passedTests: 5, failedTests: 0, status: "passed" };

            expect(verifyQuantitativeDoD({ coverage: lowStatements, testResults, rootDir: tempDir }).passed).toBe(false);
            expect(verifyQuantitativeDoD({ coverage: lowFunctions, testResults, rootDir: tempDir }).passed).toBe(false);
            expect(verifyQuantitativeDoD({ coverage: lowLines, testResults, rootDir: tempDir }).passed).toBe(false);
        });
    });

    describe("6.1.2 Test Suite Validity (100% Green, 0 Skips, 0 Fatal Errors)", () => {
        test("accepts when 100% test cases pass, 0 failing, 0 skips, and 0 fatal errors", () => {
            const testResults = {
                totalTests: 15,
                passedTests: 15,
                failedTests: 0,
                status: "passed",
                error: null
            };
            const testCode = `
describe('AuthService', () => {
    test('login with valid credentials', async () => {
        expect(1).toBe(1);
    });
    test('rejects empty password', async () => {
        expect(true).toBe(true);
    });
});
`;
            const result = verifyQuantitativeDoD({
                coverage: { statements: 95, branches: 95, functions: 100, lines: 95 },
                testResults,
                testCode,
                rootDir: tempDir
            });

            expect(result.criteria.testValidity.passed).toBe(true);
            expect(result.criteria.testValidity.allGreen.passed).toBe(true);
            expect(result.criteria.testValidity.zeroSkipped.passed).toBe(true);
            expect(result.criteria.testValidity.zeroFatalErrors.passed).toBe(true);
        });

        test("rejects if test case fails (failedTests > 0 or status !== passed)", () => {
            const testResults = {
                totalTests: 10,
                passedTests: 8,
                failedTests: 2,
                status: "failed"
            };

            const result = verifyQuantitativeDoD({
                coverage: { statements: 95, branches: 95, functions: 100, lines: 95 },
                testResults,
                testCode: "describe('Suite', () => { test('fail', () => expect(1).toBe(2)); });",
                rootDir: tempDir
            });

            expect(result.passed).toBe(false);
            expect(result.criteria.testValidity.passed).toBe(false);
            expect(result.criteria.testValidity.allGreen.passed).toBe(false);
        });

        test("rejects if test code contains skip keywords (.skip, xit, xtest, xdescribe)", () => {
            const skippedCodes = [
                "describe('Suite', () => { test.skip('skipped test', () => {}); });",
                "describe('Suite', () => { it.skip('skipped it', () => {}); });",
                "describe.skip('Skipped Suite', () => { test('test', () => {}); });",
                "describe('Suite', () => { xit('skipped xit', () => {}); });",
                "describe('Suite', () => { xtest('skipped xtest', () => {}); });",
                "xdescribe('Skipped Group', () => { test('test', () => {}); });"
            ];

            const goodTestResults = { totalTests: 5, passedTests: 5, failedTests: 0, status: "passed" };
            const goodCoverage = { statements: 95, branches: 95, functions: 100, lines: 95 };

            for (const code of skippedCodes) {
                const res = verifyQuantitativeDoD({
                    coverage: goodCoverage,
                    testResults: goodTestResults,
                    testCode: code,
                    rootDir: tempDir
                });
                expect(res.passed).toBe(false);
                expect(res.criteria.testValidity.zeroSkipped.passed).toBe(false);
            }
        });

        test("rejects if runner encounters fatal error: SyntaxError, ReferenceError, or TypeError", () => {
            const goodCoverage = { statements: 95, branches: 95, functions: 100, lines: 95 };
            const fatalErrorOutputs = [
                { totalTests: 0, passedTests: 0, failedTests: 1, status: "failed", error: "SyntaxError: Unexpected token '{'" },
                { totalTests: 1, passedTests: 0, failedTests: 1, status: "failed", error: "ReferenceError: helper is not defined" },
                { totalTests: 1, passedTests: 0, failedTests: 1, status: "failed", error: "TypeError: next is not a function" }
            ];

            for (const res of fatalErrorOutputs) {
                const evalResult = verifyQuantitativeDoD({
                    coverage: goodCoverage,
                    testResults: res,
                    testCode: "test('test', () => {});",
                    rootDir: tempDir
                });
                expect(evalResult.passed).toBe(false);
                expect(evalResult.criteria.testValidity.zeroFatalErrors.passed).toBe(false);
            }
        });
    });

    describe("6.1.3 System Safety (Storage Guard & Test Preservation)", () => {
        test("Strict Storage Guard: rejects DoD if rootDir resides in storage/", () => {
            const storageRoots = [
                "d:/NCKH/CovAI-/server/storage/projects/p1",
                "C:\\server\\storage\\test",
                "/app/storage/repos/repo-1",
                "storage/project"
            ];

            const goodCoverage = { statements: 95, branches: 95, functions: 100, lines: 95 };
            const goodTestResults = { totalTests: 5, passedTests: 5, failedTests: 0, status: "passed" };

            for (const r of storageRoots) {
                const res = verifyQuantitativeDoD({
                    coverage: goodCoverage,
                    testResults: goodTestResults,
                    testCode: "describe('test', () => {});",
                    rootDir: r
                });
                expect(res.passed).toBe(false);
                expect(res.criteria.systemSafety.storageGuard.passed).toBe(false);
            }
        });

        test("Preserves 100% of user existing tests: rejects DoD if existing tests are deleted or overwritten", () => {
            const originalUserTests = [
                "test('original user test 1: verifies invoice creation'",
                "test('original user test 2: handles customer discount'"
            ];

            // Case 1: Existing tests fully preserved
            const preservedCode = `
// Original Tests
describe('Invoice', () => {
    test('original user test 1: verifies invoice creation', () => expect(1).toBe(1));
    test('original user test 2: handles customer discount', () => expect(2).toBe(2));
});
// Additional AI Tests
describe('Invoice - Additional Coverage', () => {
    test('handles negative quantity', () => expect(true).toBe(true));
});
`;
            const passRes = verifyQuantitativeDoD({
                coverage: { statements: 95, branches: 95, functions: 100, lines: 95 },
                testResults: { totalTests: 3, passedTests: 3, failedTests: 0, status: "passed" },
                testCode: preservedCode,
                rootDir: tempDir,
                originalUserTests
            });
            expect(passRes.passed).toBe(true);
            expect(passRes.criteria.systemSafety.userTestsPreserved.passed).toBe(true);

            // Case 2: Existing tests overwritten with missing test 2
            const truncatedCode = `
describe('Invoice - AI Generated Only', () => {
    test('original user test 1: verifies invoice creation', () => expect(1).toBe(1));
    test('new ai test only', () => expect(true).toBe(true));
});
`;
            const failRes = verifyQuantitativeDoD({
                coverage: { statements: 95, branches: 95, functions: 100, lines: 95 },
                testResults: { totalTests: 2, passedTests: 2, failedTests: 0, status: "passed" },
                testCode: truncatedCode,
                rootDir: tempDir,
                originalUserTests
            });
            expect(failRes.passed).toBe(false);
            expect(failRes.criteria.systemSafety.userTestsPreserved.passed).toBe(false);
        });

        test("disk verification: applyCodeToTestFile preserves 100% of user original test code", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });

            const originalCode = `// User original test file
const { calculate } = require('../src/calc');
describe('Calculator User Tests', () => {
    test('user test: basic sum', () => {
        expect(calculate(2, 3)).toBe(5);
    });
});
`;
            const testPath = path.join(testsDir, "calc.test.js");
            fs.writeFileSync(testPath, originalCode, "utf8");

            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                framework: "jest",
                generatedCode: `describe('Calculator Additional Edge Cases', () => {
    test('ai test: divide by zero', () => {
        expect(() => calculate(1, 0)).toThrow();
    });
});`
            };

            applyCodeToTestFile(tempDir, suggestion);

            const updatedContent = fs.readFileSync(testPath, "utf8");

            // Verify existing content intact
            expect(updatedContent).toContain("// User original test file");
            expect(updatedContent).toContain("describe('Calculator User Tests'");
            expect(updatedContent).toContain("test('user test: basic sum'");
            expect(updatedContent).toContain("expect(calculate(2, 3)).toBe(5)");

            // Verify new code appended validly
            expect(updatedContent).toContain("Calculator Additional Edge Cases");
            expect(updatedContent).toContain("ai test: divide by zero");

            const ast = parseJavaScriptCode(updatedContent);
            expect(ast.success).toBe(true);
        });
    });

    describe("6.1.4 Automated Quantitative DoD Integration into applyUnitTestSuggestion", () => {
        test("applyUnitTestSuggestion returns dodEvaluation satisfying 100% criteria when tests pass and reach >= 90%", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(covDir, { recursive: true });

            const srcFile = path.join(srcDir, "metric.js");
            fs.writeFileSync(srcFile, "export const getGrade = (s) => s >= 90 ? 'A' : 'B';", "utf8");

            const suggestion = {
                sourceFile: "src/metric.js",
                proposalBase:{snapshotId:'snap-dod',workspaceRevision:0},
                testFile: "tests/metric.test.js",
                framework: "jest",
                generatedCode: `describe('MetricService', () => {
    test('handles grade A', () => expect(getGrade(95)).toBe('A'));
    test('handles grade B', () => expect(getGrade(80)).toBe('B'));
});`
            };

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-dod",
                projectId: "proj-dod",
                rootDir: tempDir,
                project: { id: "proj-dod", ownerId: "user-dod" },
                coverageSummaries: { stmtsPct: 0, branchesPct: 0, funcsPct: 0, linesPct: 0 }
            });

            mockPrisma.coverageFile.findMany.mockResolvedValue([]);

            const applyRes = await applyUnitTestSuggestion({
                snapshotId: "snap-dod",
                projectId: "proj-dod",
                userId: "user-dod",
                suggestion,
                runCoverageFn: async ({ coverageDir }) => {
                    const sumData = {
                        "src/metric.js": {
                            statements: { total: 100, covered: 96, skipped: 0, pct: 96 },
                            branches: { total: 100, covered: 92, skipped: 0, pct: 92 },
                            functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            lines: { total: 100, covered: 95, skipped: 0, pct: 95 }
                        },
                        total: {
                            statements: { total: 100, covered: 96, skipped: 0, pct: 96 },
                            branches: { total: 100, covered: 92, skipped: 0, pct: 92 },
                            functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            lines: { total: 100, covered: 95, skipped: 0, pct: 95 }
                        }
                    };
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify(sumData), "utf8");
                    const testResultsData = {
                        numTotalTests: 2,
                        numPassedTests: 2,
                        numFailedTests: 0,
                        status: "passed",
                        testResults: [{
                            name: "tests/metric.test.js",
                            status: "passed",
                            numFailingTests: 0,
                            assertionResults: [{ title: "handles grade A", status: "passed" }]
                        }]
                    };
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify(testResultsData), "utf8");
                }
            });

            expect(applyRes.success).toBe(true);
            expect(applyRes.status).toBe("PASSED");
            expect(applyRes.dodEvaluation).toBeDefined();
            expect(applyRes.dodEvaluation.passed).toBe(true);
            expect(applyRes.dodEvaluation.criteria.coverageThreshold.passed).toBe(true);
            expect(applyRes.dodEvaluation.criteria.testValidity.passed).toBe(true);
            expect(applyRes.dodEvaluation.criteria.systemSafety.passed).toBe(true);
        });
    });
});
