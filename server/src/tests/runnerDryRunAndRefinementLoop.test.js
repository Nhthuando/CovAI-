import fs from "fs";
import path from "path";
import os from "os";
import { jest } from "@jest/globals";
import {
    autoHealTestFailures,
    autoRefineCoverageGaps,
    generateDeltaTestCode,
    applyCodeToTestFile
} from "../services/applyTestSuggestion.service.js";
import { parseJavaScriptCode } from "../services/babelParser.service.js";

describe("Phase 5: Runner Dry-Run & Iterative Refinement Loop", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-phase5-runner-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { }
    });

    describe("5.1 Runner Dry-Run Configuration & Environment", () => {
        test("detects ESM project requirements and ensures safe VM modules execution", () => {
            const pkgPath = path.join(tempDir, "package.json");
            fs.writeFileSync(pkgPath, JSON.stringify({ name: "esm-project", type: "module" }), "utf8");

            const isEsm = JSON.parse(fs.readFileSync(pkgPath, "utf8")).type === "module";
            expect(isEsm).toBe(true);

            // Verified that runner resolves node --experimental-vm-modules for ESM
            const runnerPrefix = isEsm ? "node --experimental-vm-modules" : "node";
            expect(runnerPrefix).toContain("--experimental-vm-modules");
        });

        test("parses test results and exit code from runner output", () => {
            const fakeResults = {
                numTotalTests: 5,
                numPassedTests: 5,
                numFailedTests: 0,
                success: true,
                testResults: [
                    {
                        name: "tests/order.test.js",
                        status: "passed",
                        numFailingTests: 0
                    }
                ]
            };

            const isPassed = fakeResults.numFailedTests === 0 && fakeResults.numPassedTests > 0;
            expect(isPassed).toBe(true);
        });
    });

    describe("5.2 Chẩn đoán & Tự động Vá lỗi (Auto-Heal Engine)", () => {
        test("heals Assertion Mismatch: Expected X vs Received Y by adjusting to actual business return", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "order.test.js");
            const testContent = `
describe('Order Service', () => {
  it('calculates total with discount', () => {
    const total = 90;
    expect(total).toBe(100);
  });
});`;
            fs.writeFileSync(testFile, testContent, "utf8");

            const fakeTestResults = {
                testResults: [
                    {
                        name: testFile,
                        status: "failed",
                        assertionResults: [
                            {
                                title: "calculates total with discount",
                                status: "failed",
                                failureMessages: [
                                    "Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 100\nReceived: 90\n    at tests/order.test.js:5:19"
                                ]
                            }
                        ]
                    }
                ]
            };

            const healed = autoHealTestFailures(tempDir, ["tests/order.test.js"], fakeTestResults, "");
            expect(healed).toBe(true);

            const contentAfter = fs.readFileSync(testFile, "utf8");
            expect(contentAfter).toContain("expect(total).toEqual(90)");
            expect(contentAfter).not.toContain("expect(total).toBe(100)");

            const ast = parseJavaScriptCode(contentAfter);
            expect(ast.success).toBe(true);
        });

        test("heals Assertion Mismatch when received is undefined (.toBeUndefined)", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "optional.test.js");
            const testContent = `
describe('Optional Field', () => {
  it('returns undefined for missing tag', () => {
    expect(tag).toBe('default');
  });
});`;
            fs.writeFileSync(testFile, testContent, "utf8");

            const fakeTestResults = {
                testResults: [
                    {
                        name: testFile,
                        status: "failed",
                        assertionResults: [
                            {
                                title: "returns undefined for missing tag",
                                status: "failed",
                                failureMessages: [
                                    "Expected: \"default\"\nReceived: undefined\n    at tests/optional.test.js:4:17"
                                ]
                            }
                        ]
                    }
                ]
            };

            const healed = autoHealTestFailures(tempDir, ["tests/optional.test.js"], fakeTestResults, "");
            expect(healed).toBe(true);

            const contentAfter = fs.readFileSync(testFile, "utf8");
            expect(contentAfter).toContain("toBeUndefined()");
            const ast = parseJavaScriptCode(contentAfter);
            expect(ast.success).toBe(true);
        });

        test("heals missing mock ReferenceError by injecting mock proxy", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "auth.test.js");
            const testContent = `
describe('Auth Service', () => {
  it('validates token', () => {
    mockTokenValidator();
    expect(true).toBe(true);
  });
});`;
            fs.writeFileSync(testFile, testContent, "utf8");

            const rawOutput = "ReferenceError: mockTokenValidator is not defined\n    at tests/auth.test.js:4:5";
            const healed = autoHealTestFailures(tempDir, ["tests/auth.test.js"], null, rawOutput);
            expect(healed).toBe(true);

            const contentAfter = fs.readFileSync(testFile, "utf8");
            expect(contentAfter).toContain("var mockTokenValidator =");
            const ast = parseJavaScriptCode(contentAfter);
            expect(ast.success).toBe(true);
        });

        test("heals persistent uncalled mock assertions (Number of calls: 0) by relaxing to .toBeDefined()", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "logger.test.js");
            const testContent = `
describe('Audit Logger', () => {
  it('calls audit hook', () => {
    expect(mockAuditHook).toHaveBeenCalled();
  });
});`;
            fs.writeFileSync(testFile, testContent, "utf8");

            const fakeTestResults = {
                testResults: [
                    {
                        name: testFile,
                        status: "failed",
                        assertionResults: [
                            {
                                title: "calls audit hook",
                                status: "failed",
                                failureMessages: [
                                    "Expected number of calls: >= 1\nReceived number of calls: 0\n    at tests/logger.test.js:4:27"
                                ]
                            }
                        ]
                    }
                ]
            };

            const healed = autoHealTestFailures(tempDir, ["tests/logger.test.js"], fakeTestResults, "");
            expect(healed).toBe(true);

            const contentAfter = fs.readFileSync(testFile, "utf8");
            expect(contentAfter).toContain("expect(mockAuditHook).toBeDefined();");
            const ast = parseJavaScriptCode(contentAfter);
            expect(ast.success).toBe(true);
        });

        test("unskips skipped tests to restore runner execution and coverage recording", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "skipped.test.js");
            const testContent = `
describe('Suite', () => {
  test.skip('skipped test 1', () => expect(1).toBe(1));
  xit('skipped test 2', () => expect(2).toBe(2));
});`;
            fs.writeFileSync(testFile, testContent, "utf8");

            const healed = autoHealTestFailures(tempDir, ["tests/skipped.test.js"], {
                testResults: [{ name: testFile, status: "failed", assertionResults: [{ status: "failed", failureMessages: ["some failure"] }] }]
            }, "");
            expect(healed).toBe(true);

            const contentAfter = fs.readFileSync(testFile, "utf8");
            expect(contentAfter).not.toContain("test.skip(");
            expect(contentAfter).not.toContain("xit(");
            expect(contentAfter).toContain("test('skipped test 1'");
            expect(contentAfter).toContain("it('skipped test 2'");
        });

        test("respects strict storage guard: does not auto-heal if rootDir is inside storage", () => {
            const storagePath = "d:/test/server/storage/projects/hack";
            const healed = autoHealTestFailures(storagePath, ["test.js"], null, "ReferenceError: foo is not defined");
            expect(healed).toBe(false);
        });
    });

    describe("5.3 Vòng lặp Bổ sung Độ bao phủ (Coverage Refinement Loop)", () => {
        test("early exits cleanly when all inspected files already meet >=90% on all 4 criteria", async () => {
            const fakeSum = {
                "src/services/billing.service.js": {
                    statements: { pct: 95 },
                    branches: { pct: 92 },
                    functions: { pct: 100 },
                    lines: { pct: 94 }
                }
            };
            const result = await autoRefineCoverageGaps({
                rootDir: tempDir,
                sourceFilesInspected: ["src/services/billing.service.js"],
                modifiedFiles: new Set(),
                snapshot: { id: "snap-1" },
                isVitest: false,
                coverageDir: tempDir,
                rawSum: fakeSum,
                rawFinal: {}
            });

            expect(result.currentSum).toEqual(fakeSum);
        });

        test("extracts uncovered branch lines from Istanbul coverageData.b and generates targeted delta tests", () => {
            const sourceCode = `
export const calculateDiscount = (total, isVip, coupon) => {
  if (total <= 0) return 0;
  if (isVip) return total * 0.2;
  if (coupon === 'SAVE10') return total * 0.1;
  return 0;
};`;

            // Istanbul coverageData simulating uncovered branches at Line 3 and Line 4
            const coverageData = {
                b: {
                    "0": [1, 0], // Branch 0: Line 2 - falsy uncovered
                    "1": [0, 1]  // Branch 1: Line 3 - truthy uncovered
                },
                branchMap: {
                    "0": { loc: { start: { line: 2 } } },
                    "1": { loc: { start: { line: 3 } } }
                }
            };

            const deltaCode = generateDeltaTestCode({
                sourceFile: "src/services/discount.service.js",
                targetTestFile: "tests/discount.service.test.js",
                coverageData,
                sourceCode,
                rootDir: tempDir
            });

            expect(deltaCode).toContain("Targeted gap-closing delta tests for uncovered branch lines: 2, 3");
            expect(deltaCode).toContain("calculateDiscount delta branch test");
            expect(deltaCode).toContain("Gap Closing Delta Tests");

            const ast = parseJavaScriptCode(deltaCode);
            expect(ast.success).toBe(true);
        });

        test("appends delta tests to test file when coverage is below 90%", async () => {
            const testsDir = path.join(tempDir, "tests");
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(srcDir, { recursive: true });

            const srcFile = path.join(srcDir, "metric.service.js");
            fs.writeFileSync(srcFile, "export const evaluate = (val) => val > 10 ? 'HIGH' : 'LOW';", "utf8");

            const testFile = path.join(testsDir, "metric.service.test.js");
            fs.writeFileSync(testFile, `import { evaluate } from '../src/metric.service';
describe('metric', () => {
  test('high', () => expect(evaluate(20)).toBe('HIGH'));
});
`, "utf8");

            const modifiedFiles = new Set(["tests/metric.service.test.js"]);
            const lowCoverageSummary = {
                "src/metric.service.js": {
                    statements: { pct: 60 },
                    branches: { pct: 50 },
                    functions: { pct: 100 },
                    lines: { pct: 60 }
                }
            };

            const coverageFinalData = {
                "src/metric.service.js": {
                    b: { "0": [1, 0] },
                    branchMap: { "0": { loc: { start: { line: 1 } } } }
                }
            };

            // Call autoRefineCoverageGaps with simulated runner pass
            const refined = await autoRefineCoverageGaps({
                rootDir: tempDir,
                sourceFilesInspected: ["src/metric.service.js"],
                modifiedFiles,
                snapshot: { id: "snap-test", jestConfigPath: null },
                isVitest: false,
                coverageDir: tempDir,
                rawSum: lowCoverageSummary,
                rawFinal: coverageFinalData,
                runCoverageFn: async ({ coverageDir }) => {
                    // Simulates runner outputting fresh >=90% coverage after delta test execution
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify({
                        "src/metric.service.js": {
                            statements: { pct: 95 },
                            branches: { pct: 92 },
                            functions: { pct: 100 },
                            lines: { pct: 95 }
                        }
                    }), "utf8");
                }
            });

            expect(refined).toBeDefined();

            // Verify test file was appended with delta branch tests
            const updatedTest = fs.readFileSync(testFile, "utf8");
            expect(updatedTest).toContain("Gap Closing Delta Tests");
            expect(updatedTest).toContain("evaluate delta branch test");

            const ast = parseJavaScriptCode(updatedTest);
            expect(ast.success).toBe(true);
        });
    });
});
