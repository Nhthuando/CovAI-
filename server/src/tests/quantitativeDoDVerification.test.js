import fs from "fs";
import path from "path";
import os from "os";
import { describe, test, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mock Prisma
const mockPrisma = {
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

await jest.unstable_mockModule("../controllers/coverage.controller.js", () => ({
    invalidateCoverageCache: jest.fn()
}));

const {
    verifyQuantitativeDoD,
    applyUnitTestSuggestion,
    applyCodeToTestFile
} = await import("../services/applyTestSuggestion.service.js");

const { parseJavaScriptCode } = await import("../services/babelParser.service.js");

describe("6. Kế Hoạch Kiểm Định & Tiêu Chí Nghiệm Thu (Quantitative DoD)", () => {
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

    describe("6.1.1 Tiêu Chí Độ Bao Phủ Tối Thiểu (Target Coverage Threshold >= 90%)", () => {
        test("chấp thuận nghiệm thu DoD khi cả 4 tiêu chí (Statements, Branches, Functions, Lines) đạt >= 90%", () => {
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

        test("đánh dấu trạng thái tối ưu (optimal: true) khi cả 4 tiêu chí đạt tuyệt đối 100%", () => {
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

        test("từ chối nghiệm thu DoD nếu Branch Coverage dưới 90% mặc dù 3 tiêu chí khác đạt 100%", () => {
            const coverage = {
                statements: 100,
                branches: 87.5, // Dưới ngưỡng 90%
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

        test("từ chối nghiệm thu DoD nếu Statements, Functions hoặc Lines dưới 90%", () => {
            const lowStatements = { statements: 88, branches: 92, functions: 100, lines: 91 };
            const lowFunctions = { statements: 95, branches: 92, functions: 85, lines: 95 };
            const lowLines = { statements: 92, branches: 91, functions: 100, lines: 89 };

            const testResults = { totalTests: 5, passedTests: 5, failedTests: 0, status: "passed" };

            expect(verifyQuantitativeDoD({ coverage: lowStatements, testResults, rootDir: tempDir }).passed).toBe(false);
            expect(verifyQuantitativeDoD({ coverage: lowFunctions, testResults, rootDir: tempDir }).passed).toBe(false);
            expect(verifyQuantitativeDoD({ coverage: lowLines, testResults, rootDir: tempDir }).passed).toBe(false);
        });
    });

    describe("6.1.2 Tiêu Chí Tính Hợp Lệ Của Test Suite (100% Green, 0 Skips, 0 Fatal Errors)", () => {
        test("chấp thuận khi 100% test cases pass, 0 failing, 0 skips, và 0 fatal runtime/syntax errors", () => {
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

        test("từ chối nghiệm thu nếu có test case bị thất bại (failedTests > 0 hoặc status !== passed)", () => {
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

        test("từ chối nghiệm thu nếu mã test chứa các từ khóa skip (.skip, xit, xtest, xdescribe)", () => {
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

        test("từ chối nghiệm thu nếu runner gặp lỗi fatal: SyntaxError, ReferenceError hoặc TypeError", () => {
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

    describe("6.1.3 Tiêu Chí An Toàn Hệ Thống (Storage Guard & Bảo Tồn Test Cũ)", () => {
        test("Strict Storage Guard: từ chối nghiệm thu DoD nếu rootDir nằm trong storage/", () => {
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

        test("Bảo tồn 100% test cũ của người dùng: từ chối nghiệm thu DoD nếu bất kỳ test cũ nào bị mất hoặc bị ghi đè", () => {
            const originalUserTests = [
                "test('original user test 1: verifies invoice creation'",
                "test('original user test 2: handles customer discount'"
            ];

            // Trường hợp 1: Test cũ được bảo tồn đầy đủ
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

            // Trường hợp 2: Test cũ bị ghi đè mất test 2
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

        test("thực nghiệm trên đĩa: applyCodeToTestFile bảo toàn 100% mã kiểm thử ban đầu của người dùng", () => {
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

            // Kiểm tra bảo tồn nguyên vẹn nội dung cũ
            expect(updatedContent).toContain("// User original test file");
            expect(updatedContent).toContain("describe('Calculator User Tests'");
            expect(updatedContent).toContain("test('user test: basic sum'");
            expect(updatedContent).toContain("expect(calculate(2, 3)).toBe(5)");

            // Kiểm tra mã mới được gắn thêm hợp lệ
            expect(updatedContent).toContain("Calculator Additional Edge Cases");
            expect(updatedContent).toContain("ai test: divide by zero");

            const ast = parseJavaScriptCode(updatedContent);
            expect(ast.success).toBe(true);
        });
    });

    describe("6.1.4 Tích Hợp Tự Động Định Lượng Vào Kết Quả applyUnitTestSuggestion", () => {
        test("applyUnitTestSuggestion trả về dodEvaluation đáp ứng 100% tiêu chí khi test pass và đạt >=90%", async () => {
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
