import fs from "fs";
import path from "path";
import os from "os";
import { describe, test, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mock Prisma for database queries and updates
const mockPrisma = {
    project: {
        findFirst: jest.fn(),
        findUnique: jest.fn()
    },
    projectSnapshot: {
        findUnique: jest.fn(),
        findFirst: jest.fn()
    },
    coverageSummary: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({})
    },
    coverageFile: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({})
    },
    coverageFunction: {
        findMany: jest.fn().mockResolvedValue([])
    },
    testRun: {
        findFirst: jest.fn().mockResolvedValue(null)
    },
    job: {
        findFirst: jest.fn().mockResolvedValue(null)
    },
    aiTest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "ai-1" })
    }
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma
}));

const mockAiResponse = JSON.stringify({
    explanation: "Comprehensive unit tests for processOrder covering all branches and edge cases",
    suggestedTestCode: `describe('processOrder', () => {
    test('processOrder happy path', () => {
        expect(processOrder({ id: 1, total: 200 })).toBeDefined();
    });
    test('processOrder handles invalid order', () => {
        expect(() => processOrder(null)).toThrow();
    });
});`
});

export const mockGenerateText = jest.fn().mockResolvedValue(mockAiResponse);

await jest.unstable_mockModule("../services/gemini.service.js", () => ({
    generateText: mockGenerateText
}));

await jest.unstable_mockModule("../controllers/coverage.controller.js", () => ({
    invalidateCoverageCache: jest.fn()
}));

// Dynamic imports after registering unstable_mockModule
const {
    suggestUnitTestcases,
    findExistingTestFile,
    extractAstMetadata
} = await import("../services/unitTestSuggestion.service.js");

const {
    applyUnitTestSuggestion,
    autoRefineCoverageGaps,
    generateDeltaTestCode,
    autoHealTestFailures,
    applyCodeToTestFile
} = await import("../services/applyTestSuggestion.service.js");

const { parseJavaScriptCode } = await import("../services/babelParser.service.js");

describe("Phase 4: Vòng Lặp Tinh Chỉnh & Kiểm Chứng Độ Bao Phủ (Refinement Loop & Verification)", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-phase4-refine-"));
        jest.clearAllMocks();
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { }
    });

    describe("4.1 Toàn Bộ Luồng Tích Hợp: Từ suggestUnitTestcases Đến applyUnitTestSuggestion", () => {
        test("thực thi toàn bộ luồng: sinh test suggestion -> apply vào file -> kích hoạt runner -> cập nhật DB và đạt coverage >= 90%", async () => {
            const srcDir = path.join(tempDir, "src", "services");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            const sourceCode = `
export function processOrder(order) {
    if (!order || !order.id) {
        throw new Error("Invalid order");
    }
    const isVip = order.total > 1000;
    const discount = isVip ? 0.2 : 0.05;
    return {
        id: order.id,
        finalTotal: order.total * (1 - discount),
        isVip
    };
}
`;
            const srcPath = path.join(srcDir, "order.service.js");
            fs.writeFileSync(srcPath, sourceCode, "utf8");

            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(covDir, { recursive: true });
            fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify({
                "src/services/order.service.js": {
                    statements: { pct: 60 },
                    branches: { pct: 50 },
                    functions: { pct: 100 },
                    lines: { pct: 60 }
                }
            }), "utf8");
            fs.writeFileSync(path.join(covDir, "coverage-final.json"), JSON.stringify({
                "src/services/order.service.js": {
                    b: { "0": [1, 0] },
                    branchMap: { "0": { loc: { start: { line: 3 } } } }
                }
            }), "utf8");

            // Mock database project & snapshot
            mockPrisma.project.findFirst.mockResolvedValue({
                id: "proj-1",
                ownerId: "user-1",
                snapshots: [{
                    id: "snap-1",
                    rootDir: tempDir,
                    coverageSummaries: { stmtsPct: 60, branchesPct: 50, funcsPct: 100, linesPct: 60 }
                }]
            });

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-1",
                projectId: "proj-1",
                rootDir: tempDir,
                project: { id: "proj-1", ownerId: "user-1" },
                coverageSummaries: { stmtsPct: 60, branchesPct: 50, funcsPct: 100, linesPct: 60 },
                coverageFiles: [{
                    filePath: "src/services/order.service.js",
                    stmtsPct: 60,
                    branchesPct: 50,
                    funcsPct: 100,
                    linesPct: 60
                }]
            });

            mockPrisma.coverageFile.findMany.mockResolvedValue([
                {
                    filePath: "src/services/order.service.js",
                    stmtsPct: 60,
                    branchesPct: 50,
                    funcsPct: 100,
                    linesPct: 60
                }
            ]);

            // Bước 1: Gọi suggestUnitTestcases
            const suggestionResult = await suggestUnitTestcases({
                projectId: "proj-1",
                snapshotId: "snap-1",
                filePath: "src/services/order.service.js",
                userId: "user-1",
                framework: "jest"
            });

            expect(suggestionResult).toBeDefined();
            expect(suggestionResult.sourceFile).toContain("order.service.js");
            expect(suggestionResult.suggestedTestCode).toBeDefined();
            expect(suggestionResult.suggestedTestCode.length).toBeGreaterThan(0);
            expect(suggestionResult.framework).toBe("jest");

            // Kiểm tra AST Analysis và Decision Points được trích xuất
            expect(suggestionResult.decisionPoints).toBeDefined();

            // Bước 2: Gọi applyUnitTestSuggestion với mock runner cung cấp độ bao phủ tăng dần
            let runnerCalls = 0;
            const applyResult = await applyUnitTestSuggestion({
                snapshotId: "snap-1",
                projectId: "proj-1",
                userId: "user-1",
                suggestion: suggestionResult,
                runCoverageFn: async ({ coverageDir, pass }) => {
                    runnerCalls++;
                    // Giả lập runner ghi kết quả kiểm thử và độ bao phủ đạt >= 90%
                    const sumData = {
                        "src/services/order.service.js": {
                            statements: { total: 100, covered: 95, skipped: 0, pct: 95 },
                            branches: { total: 100, covered: 92, skipped: 0, pct: 92 },
                            functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            lines: { total: 100, covered: 94, skipped: 0, pct: 94 }
                        },
                        total: {
                            statements: { total: 100, covered: 95, skipped: 0, pct: 95 },
                            branches: { total: 100, covered: 92, skipped: 0, pct: 92 },
                            functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            lines: { total: 100, covered: 94, skipped: 0, pct: 94 }
                        }
                    };
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify(sumData), "utf8");

                    const testRes = {
                        numTotalTests: 4,
                        numPassedTests: 4,
                        numFailedTests: 0,
                        status: "passed",
                        testResults: [{
                            name: "tests/order.service.test.js",
                            status: "passed",
                            numFailingTests: 0,
                            assertionResults: [{ title: "processOrder happy path", status: "passed" }]
                        }]
                    };
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify(testRes), "utf8");
                }
            });

            // Bước 3: Kiểm chứng kết quả Apply thành công và đạt mục tiêu >= 90%
            expect(applyResult.success).toBe(true);
            expect(applyResult.status).toBe("PASSED");
            expect(applyResult.newCoverage.statements).toBeGreaterThanOrEqual(90);
            expect(applyResult.newCoverage.branches).toBeGreaterThanOrEqual(90);
            expect(applyResult.newCoverage.functions).toBeGreaterThanOrEqual(90);
            expect(applyResult.newCoverage.lines).toBeGreaterThanOrEqual(90);

            // Kiểm tra database được cập nhật
            expect(mockPrisma.coverageSummary.upsert).toHaveBeenCalled();
            expect(mockPrisma.coverageFile.upsert).toHaveBeenCalled();
        }, 30000);
    });

    describe("4.2 Vòng Lặp Tinh Chỉnh Thích Ứng (Adaptive Refinement Loop - 2-3 Passes)", () => {
        test("tự động lặp qua các vòng (pass 1 -> pass 2 -> pass 3) cho đến khi đạt >= 90% cả 4 tiêu chí", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(covDir, { recursive: true });

            const srcFile = path.join(srcDir, "pricing.js");
            fs.writeFileSync(srcFile, `
export function calcPrice(units, isMember, promoCode) {
    if (units <= 0) return 0;
    let rate = 10;
    if (isMember) rate = 8;
    if (promoCode === 'HALF') rate = rate / 2;
    return units * rate;
}
`, "utf8");

            const testFile = path.join(testsDir, "pricing.test.js");
            fs.writeFileSync(testFile, `
import { calcPrice } from '../src/pricing';
describe('Pricing Tests', () => {
    test('standard price', () => {
        expect(calcPrice(5, false, null)).toBe(50);
    });
});
`, "utf8");

            const modifiedFiles = new Set(["tests/pricing.test.js"]);

            // Bắt đầu với độ bao phủ thấp: 60% Statements, 33% Branches
            let currentCoverage = {
                "src/pricing.js": {
                    statements: { pct: 60 },
                    branches: { pct: 33 },
                    functions: { pct: 100 },
                    lines: { pct: 60 }
                }
            };

            let passCount = 0;

            const refinedResult = await autoRefineCoverageGaps({
                rootDir: tempDir,
                sourceFilesInspected: ["src/pricing.js"],
                modifiedFiles,
                snapshot: { id: "snap-refine" },
                isVitest: false,
                coverageDir: covDir,
                rawSum: currentCoverage,
                rawFinal: {
                    "src/pricing.js": {
                        b: { "0": [1, 0], "1": [0, 1] },
                        branchMap: {
                            "0": { loc: { start: { line: 3 } } },
                            "1": { loc: { start: { line: 5 } } }
                        }
                    }
                },
                runCoverageFn: async ({ pass }) => {
                    passCount++;
                    if (pass === 1) {
                        // Vòng 1: Đạt 78% branches (vẫn dưới 90%)
                        currentCoverage = {
                            "src/pricing.js": {
                                statements: { pct: 85 },
                                branches: { pct: 75 },
                                functions: { pct: 100 },
                                lines: { pct: 85 }
                            }
                        };
                    } else {
                        // Vòng 2: Bổ sung delta tests và vượt ngưỡng 90%
                        currentCoverage = {
                            "src/pricing.js": {
                                statements: { pct: 95 },
                                branches: { pct: 92 },
                                functions: { pct: 100 },
                                lines: { pct: 95 }
                            }
                        };
                    }
                    fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify(currentCoverage), "utf8");
                }
            });

            // Vòng lặp phải thực hiện ít nhất 2 pass và đánh dấu đã refined
            expect(passCount).toBeGreaterThanOrEqual(2);
            expect(refinedResult.passesRun).toBeGreaterThanOrEqual(2);
            expect(refinedResult.refined).toBe(true);

            // Kiểm tra nội dung file test đã được bổ sung thêm delta tests
            const updatedTestCode = fs.readFileSync(testFile, "utf8");
            expect(updatedTestCode).toContain("Gap Closing Delta Tests");
            expect(updatedTestCode).toContain("Targeted gap-closing delta tests for uncovered branch lines");

            // Đảm bảo cú pháp AST hoàn toàn sạch sau nhiều vòng bổ sung
            const parseAst = parseJavaScriptCode(updatedTestCode);
            expect(parseAst.success).toBe(true);
        });

        test("dừng ngay lập tức (early exit) khi tất cả các tiêu chí đã đạt >= 90% từ đầu", async () => {
            const highCoverage = {
                "src/service.js": {
                    statements: { pct: 96 },
                    branches: { pct: 94 },
                    functions: { pct: 100 },
                    lines: { pct: 96 }
                }
            };

            let runnerCalled = false;
            const result = await autoRefineCoverageGaps({
                rootDir: tempDir,
                sourceFilesInspected: ["src/service.js"],
                modifiedFiles: new Set(),
                snapshot: { id: "snap-high" },
                isVitest: false,
                coverageDir: tempDir,
                rawSum: highCoverage,
                rawFinal: {},
                runCoverageFn: async () => {
                    runnerCalled = true;
                }
            });

            expect(runnerCalled).toBe(false);
            expect(result.refined).toBe(false);
            expect(result.currentSum).toEqual(highCoverage);
        });
    });

    describe("4.3 Tự Động Chẩn Đoán & Khắc Phục Lỗi Assertion (Auto-Heal Engine)", () => {
        test("chẩn đoán lỗi lệch giá trị (Expected vs Received) và tự động sửa assertion về kết quả đúng", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });

            const testFile = path.join(testsDir, "status.test.js");
            fs.writeFileSync(testFile, `
describe('Status Service', () => {
    test('returns order status', () => {
        const status = 'COMPLETED';
        expect(status).toBe('DONE');
    });
});
`, "utf8");

            const fakeTestResults = {
                testResults: [{
                    name: "tests/status.test.js",
                    status: "failed",
                    assertionResults: [{
                        title: "returns order status",
                        status: "failed",
                        failureMessages: [
                            `Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: "DONE"\nReceived: "COMPLETED"\n\n  at Object.<anonymous> (${testFile}:5:24)`
                        ]
                    }]
                }]
            };

            const healed = autoHealTestFailures(tempDir, ["tests/status.test.js"], fakeTestResults, "");
            expect(healed).toBe(true);

            const healedContent = fs.readFileSync(testFile, "utf8");
            expect(healedContent).toContain(`.toEqual("COMPLETED")`);

            const ast = parseJavaScriptCode(healedContent);
            expect(ast.success).toBe(true);
        });

        test("tự động mở khóa (unskip) các bài test bị AI đánh dấu .skip, xit, xtest để khôi phục độ phủ", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });

            const testFile = path.join(testsDir, "skipped.test.js");
            fs.writeFileSync(testFile, `
describe.skip('Skipped Suite', () => {
    test.skip('skipped test 1', () => expect(true).toBe(true));
    xit('skipped it 2', () => expect(1).toBe(1));
    xtest('skipped xtest 3', () => expect(2).toBe(2));
});
`, "utf8");

            const fakeTestResults = {
                testResults: [{
                    name: "tests/skipped.test.js",
                    status: "failed",
                    assertionResults: [{ title: "test", status: "failed", failureMessages: ["skipped"] }]
                }]
            };

            const healed = autoHealTestFailures(tempDir, ["tests/skipped.test.js"], fakeTestResults, "");
            expect(healed).toBe(true);

            const content = fs.readFileSync(testFile, "utf8");
            expect(content).not.toContain("describe.skip");
            expect(content).not.toContain("test.skip");
            expect(content).not.toContain("xit(");
            expect(content).not.toContain("xtest(");
            expect(content).toContain("describe(");
            expect(content).toContain("test(");
            expect(content).toContain("it(");
        });
    });

    describe("4.4 Xử Lý Các Edge Cases Đặc Thù Trong Business Logic", () => {
        test("Test Case 1 (Helper Nội Bộ Unexported): sinh delta test gọi hàm export với các tổ hợp tham số kích hoạt nhánh nội bộ", () => {
            const sourceCode = `
export function handleCalculation(type, val) {
    if (type === 'cube') return _calcCube(val);
    if (type === 'square') return _calcSquare(val);
    return val;
}
function _calcCube(n) {
    return n * n * n;
}
function _calcSquare(n) {
    return n * n;
}
`;
            const meta = extractAstMetadata(sourceCode);
            expect(meta.exportedSymbols).toContain("handleCalculation");
            expect(meta.unexportedFunctions).toContain("_calcCube");
            expect(meta.unexportedFunctions).toContain("_calcSquare");

            const deltaCode = generateDeltaTestCode({
                sourceFile: "src/calc.js",
                targetTestFile: "tests/calc.test.js",
                coverageData: {
                    b: { "0": [1, 0], "1": [0, 1] },
                    branchMap: {
                        "0": { loc: { start: { line: 3 } } },
                        "1": { loc: { start: { line: 4 } } }
                    }
                },
                sourceCode,
                rootDir: tempDir
            });

            expect(deltaCode).toContain("handleCalculation delta branch test");
            const ast = parseJavaScriptCode(deltaCode);
            expect(ast.success).toBe(true);
        });

        test("Test Case 2 (Database & Prisma Transaction): sinh mock contract bảo vệ truy vấn DB và $transaction", () => {
            const sourceCode = `
import prisma from '../config/prisma.js';
export async function transferFunds(fromId, toId, amount) {
    return await prisma.$transaction(async (tx) => {
        const sender = await tx.account.findUnique({ where: { id: fromId } });
        if (!sender || sender.balance < amount) throw new Error("Insufficient funds");
        await tx.account.update({ where: { id: fromId }, data: { balance: sender.balance - amount } });
        await tx.account.update({ where: { id: toId }, data: { balance: { increment: amount } } });
        return { success: true };
    });
}
`;
            const deltaCode = generateDeltaTestCode({
                sourceFile: "src/services/transfer.service.js",
                targetTestFile: "tests/transfer.service.test.js",
                coverageData: null,
                sourceCode,
                rootDir: tempDir
            });

            expect(deltaCode).toContain("transferFunds delta branch test");
            const ast = parseJavaScriptCode(deltaCode);
            expect(ast.success).toBe(true);
        });

        test("Test Case 3 (Error Handling & try/catch): sinh test case giả lập lỗi bao phủ toàn bộ khối catch", () => {
            const sourceCode = `
export async function fetchData(client) {
    try {
        return await client.getData();
    } catch (err) {
        return { error: true, message: err.message };
    }
}
`;
            const deltaCode = generateDeltaTestCode({
                sourceFile: "src/services/fetch.service.js",
                targetTestFile: "tests/fetch.service.test.js",
                coverageData: null,
                sourceCode,
                rootDir: tempDir
            });

            expect(deltaCode).toContain("covers error and exception branches");
            const ast = parseJavaScriptCode(deltaCode);
            expect(ast.success).toBe(true);
        });
    });

    describe("4.5 An Toàn Hệ Thống & Kiểm Chứng Nghiêm Ngặt Thư Mục Storage", () => {
        test("Strict Storage Guard: từ chối chạy autoRefineCoverageGaps và không sửa đổi nếu rootDir ở storage/", async () => {
            const storagePath = path.join(tempDir, "storage", "projects", "p1");
            fs.mkdirSync(storagePath, { recursive: true });

            const fakeSummary = { "src/a.js": { statements: { pct: 50 }, branches: { pct: 40 }, functions: { pct: 50 }, lines: { pct: 50 } } };

            const result = await autoRefineCoverageGaps({
                rootDir: storagePath,
                sourceFilesInspected: ["src/a.js"],
                modifiedFiles: new Set(),
                snapshot: { id: "snap-storage" },
                isVitest: false,
                coverageDir: storagePath,
                rawSum: fakeSummary,
                rawFinal: {}
            });

            expect(result.refined).toBe(false);
            expect(result.passesRun).toBe(0);
        });

        test("Bảo tồn 100% test cũ của người dùng khi merge nhiều lần trong refinement loop", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });

            const initialUserTest = `// Original User Test Suite
describe('User Existing Suite', () => {
    test('user test 1', () => {
        expect(10).toBe(10);
    });
});
`;
            const testPath = path.join(testsDir, "calc.test.js");
            fs.writeFileSync(testPath, initialUserTest, "utf8");

            const suggestion1 = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                framework: "jest",
                generatedCode: `describe('Additional Pass 1', () => {
    test('pass 1 test', () => expect(1).toBe(1));
});`
            };

            const suggestion2 = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                framework: "jest",
                generatedCode: `describe('Additional Pass 2', () => {
    test('pass 2 test', () => expect(2).toBe(2));
});`
            };

            applyCodeToTestFile(tempDir, suggestion1);
            applyCodeToTestFile(tempDir, suggestion2);

            const finalContent = fs.readFileSync(testPath, "utf8");

            // Kiểm tra test cũ vẫn giữ nguyên 100%
            expect(finalContent).toContain("// Original User Test Suite");
            expect(finalContent).toContain("user test 1");

            // Kiểm tra cả 2 suggestion được gắn thêm hợp lệ
            expect(finalContent).toContain("Additional Pass 1");
            expect(finalContent).toContain("Additional Pass 2");

            const ast = parseJavaScriptCode(finalContent);
            expect(ast.success).toBe(true);
        });
    });
});
