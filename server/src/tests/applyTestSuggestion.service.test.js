import fs from "fs";
import path from "path";
import os from "os";
import { jest } from "@jest/globals";
import {
    resolveSnapshotRootDir,
    applyCodeToTestFile,
    cleanAndDeduplicateTestContent,
    sanitizeAllProjectTestFiles,
    generateDeltaTestCode,
    autoHealTestFailures,
    autoRefineCoverageGaps,
    computeSourceFilesHash,
    verifySourceFilesUnchanged,
    cleanTestRunnerError,
    getTestRunnerFailure,
    resolveContainerOrHostTestPath
} from "../services/applyTestSuggestion.service.js";
import { runJestCoverage } from "../services/runTestsJob.service.js";
import { dockerRunner } from "../services/dockerRunner.service.js";

describe("applyTestSuggestion.service", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-apply-test-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { }
    });

    describe("resolveSnapshotRootDir", () => {
        test("returns existing filesystem path", () => {
            expect(resolveSnapshotRootDir(tempDir)).toBe(tempDir);
        });

        test("returns null for null/empty rootDir", () => {
            expect(resolveSnapshotRootDir(null)).toBeNull();
            expect(resolveSnapshotRootDir("")).toBeNull();
        });
    });

    describe("applyCodeToTestFile", () => {
        test("creates new test file if target does not exist", () => {
            const suggestion = {
                sourceFile: "src/utils/math.js",
                testFile: "tests/math.test.js",
                framework: "jest",
                generatedCode: "describe('math', () => { test('adds', () => { expect(1+1).toBe(2); }); });",
                fullUpdatedContent: "import { describe, test, expect } from '@jest/globals';\ndescribe('math', () => { test('adds', () => { expect(1+1).toBe(2); }); });\n"
            };

            const result = applyCodeToTestFile(tempDir, suggestion);
            expect(result.changed).toBe(true);
            expect(result.targetTestFile).toBe("tests/math.test.js");

            const writtenPath = path.join(tempDir, "tests", "math.test.js");
            expect(fs.existsSync(writtenPath)).toBe(true);
            const content = fs.readFileSync(writtenPath, "utf8");
            expect(content).toContain("describe('math'");
        });

        test("appends suggestion to existing test file without overwriting existing tests", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const existingFile = path.join(testDir, "calculator.test.js");
            fs.writeFileSync(existingFile, "describe('calculator', () => {\n  test('existing', () => expect(true).toBe(true));\n});\n", "utf8");

            const suggestion = {
                sourceFile: "src/calculator.js",
                testFile: "tests/calculator.test.js",
                framework: "jest",
                generatedCode: "describe('calculator branch tests', () => {\n  test('handles zero', () => expect(0).toBe(0));\n});"
            };

            const result = applyCodeToTestFile(tempDir, suggestion);
            expect(result.changed).toBe(true);

            const content = fs.readFileSync(existingFile, "utf8");
            expect(content).toContain("test('existing'");
            expect(content).toContain("test('handles zero'");
        });

        test("avoids duplicate code if identical suggestion is applied again", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const existingFile = path.join(testDir, "repeat.test.js");
            const code = "describe('repeat', () => {\n  test('once', () => expect(1).toBe(1));\n});";
            fs.writeFileSync(existingFile, code + "\n", "utf8");

            const suggestion = {
                sourceFile: "src/repeat.js",
                testFile: "tests/repeat.test.js",
                framework: "jest",
                generatedCode: code
            };

            const result = applyCodeToTestFile(tempDir, suggestion);
            expect(result.changed).toBe(false);
        });

        test("preserves existing describe blocks with identical title without deleting user tests", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const existingFile = path.join(testDir, "bill.test.js");
            const existingCode = `
import { createQuickbooksBill } from '../src/handlers/bill.handler';

describe('createQuickbooksBill', () => {
  it('user test 1', () => expect(1).toBe(1));
  it('user test 2', () => expect(2).toBe(2));
});
`;
            fs.writeFileSync(existingFile, existingCode.trim() + "\n", "utf8");

            const suggestion = {
                sourceFile: "src/handlers/bill.handler.js",
                testFile: "tests/bill.test.js",
                framework: "jest",
                generatedCode: `
import { createQuickbooksBill, getQuickbooksBill } from '../src/handlers/bill.handler';

describe('createQuickbooksBill', () => {
  it('new test case 3', () => expect(3).toBe(3));
});
`
            };

            const result = applyCodeToTestFile(tempDir, suggestion);
            expect(result.changed).toBe(true);

            const content = fs.readFileSync(existingFile, "utf8");
            // Original user tests MUST still be there!
            expect(content).toContain("it('user test 1'");
            expect(content).toContain("it('user test 2'");
            // New test must be added safely under Additional Coverage
            expect(content).toContain("describe('createQuickbooksBill - Additional Coverage'");
            expect(content).toContain("it('new test case 3'");
            // ESM import must NOT have duplicate createQuickbooksBill declarations
            expect(content).not.toMatch(/import\s*\{[^}]*createQuickbooksBill[^}]*\}\s*from[^\n]+\n[^\n]*import\s*\{[^}]*createQuickbooksBill/);
        });

        test("throws ServiceError when testFile is missing from suggestion metadata", () => {
            const suggestion = {
                sourceFile: "src/missing.js",
                generatedCode: "test('nothing', () => {});"
            };

            expect(() => applyCodeToTestFile(tempDir, suggestion)).toThrow("testFile is required");
        });
    });

    describe("cleanAndDeduplicateTestContent", () => {
        test("removes AI placeholder blocks with N/A non-code text", () => {
            const code = `
describe('Existing Suite', () => {
    test('existing', () => expect(1).toBe(1));
});

describe('AI Suggested Unit Tests', () => {
    N/A - This is a new test file.
});
`;
            const cleaned = cleanAndDeduplicateTestContent(code);
            expect(cleaned).not.toContain("N/A - This is a new test file.");
            expect(cleaned).toContain("Existing Suite");
        });

        test("deduplicates identical require statements and duplicate identifier declarations", () => {
            const code = `
const { sequelize, initDatabase, models } = require('../../src/models/index');
describe('test', () => {
    const { sequelize, initDatabase, models } = require('../../src/models/index');
    test('run', () => expect(true).toBe(true));
});
`;
            const cleaned = cleanAndDeduplicateTestContent(code, "Identifier 'sequelize' has already been declared");
            expect(cleaned).toContain("const { sequelize, initDatabase, models } = require('../../src/models/index');");
            // The second occurrence must be deduplicated
            const matches = cleaned.match(/const\s+\{\s*sequelize/g);
            expect(matches ? matches.length : 0).toBe(1);
        });

        test("deduplicates multiline jest.mock calls with identical target", () => {
            const code = `
jest.mock('sequelize', () => {
    return { Sequelize: jest.fn() };
});
jest.mock('sequelize', () => {
    const m = { auth: jest.fn() };
    return { Sequelize: jest.fn(() => m) };
});
describe('db', () => { test('ok', () => {}); });
`;
            const cleaned = cleanAndDeduplicateTestContent(code);
            const mockMatches = [...cleaned.matchAll(/jest\.mock\s*\(\s*['"]sequelize['"]/g)];
            expect(mockMatches.length).toBe(1);
        });

        test("strips ((data: any)) and TypeScript type annotations in JavaScript test files", () => {
            const code = `
jest.mock('json2csv', () => ({
    Parser: jest.fn().mockImplementation(() => ({
        parse: jest.fn(((data: any)) => {
            return data.join(',');
        }),
    })),
}));
describe('svc', () => {
    test('handles params', (req: any, res: any) => {
        try {
            expect(true).toBe(true);
        } catch (e: any) {
            console.error(e);
        }
    });
});
`;
            const cleaned = cleanAndDeduplicateTestContent(code);
            expect(cleaned).toContain("parse: jest.fn((data) =>");
            expect(cleaned).not.toContain("((data: any))");
            expect(cleaned).not.toContain(": any");
            expect(cleaned).toContain("catch (e)");
        });

        test("purges placeholder describe blocks with N/A - Providing full file content below", () => {
            const code = `
describe('Existing Suite', () => {
    test('existing', () => expect(1).toBe(1));
});

describe('AI Suggested Unit Tests', () => {
    N/A - Providing full file content below.
});

describe('AI Suggested Unit Tests', () => {
    // Test cases are fully integrated into the fullUpdatedContent below.
});

describe('AI Suggested Unit Tests', () => {
    // The full content is provided in the next block.
});
`;
            const cleaned = cleanAndDeduplicateTestContent(code);
            expect(cleaned).not.toContain("N/A - Providing full file content below");
            expect(cleaned).not.toContain("Test cases are fully integrated");
            expect(cleaned).not.toContain("The full content is provided");
            expect(cleaned).not.toContain("AI Suggested Unit Tests");
            expect(cleaned).toContain("describe('Existing Suite'");
        });
    });

    describe("sanitizeAllProjectTestFiles", () => {
        test("scans project test directory and fixes syntax errors and depth imports", () => {
            const testsDir = path.join(tempDir, "tests", "models");
            fs.mkdirSync(testsDir, { recursive: true });
            const testFile = path.join(testsDir, "doc.test.js");
            const invalidContent = `
const { doc } = require('../src/models/doc');
describe('AI Suggested Unit Tests', () => {
    N/A - This is a new test file.
});
describe('Doc', () => { test('works', () => expect(true).toBe(true)); });
`;
            fs.writeFileSync(testFile, invalidContent, "utf8");

            sanitizeAllProjectTestFiles(tempDir);

            const updated = fs.readFileSync(testFile, "utf8");
            expect(updated).not.toContain("N/A - This is a new test file.");
            expect(updated).toContain("../../src/models/doc");
            expect(updated).toContain("describe('Doc'");
        });

        test("recursively discovers and heals test files in monorepo subpackages (e.g. backend/tests/services)", () => {
            const backendServicesDir = path.join(tempDir, "backend", "tests", "services");
            fs.mkdirSync(backendServicesDir, { recursive: true });
            const analysisTestFile = path.join(backendServicesDir, "analysis.service.test.js");
            const corruptedContent = `
jest.mock('json2csv', () => ({
    Parser: jest.fn().mockImplementation(() => ({
        parse: jest.fn(((data: any)) => {
            return '';
        }),
    })),
}));
describe('analysis', () => {
    test('parses', () => expect(true).toBe(true));
});
`;
            fs.writeFileSync(analysisTestFile, corruptedContent, "utf8");

            sanitizeAllProjectTestFiles(tempDir);

            const updated = fs.readFileSync(analysisTestFile, "utf8");
            expect(updated).not.toContain("((data: any))");
            expect(updated).toContain("parse: jest.fn((data) =>");
        });
    });

    describe("generateDeltaTestCode", () => {
        test("generates targeted delta branch tests for CommonJS controllers", () => {
            const sourceCode = `
const adminService = require('../services/admin.service');
const getUsers = async (req, res, next) => { res.json([]); };
const deleteUser = async (req, res, next) => { res.send('ok'); };
module.exports = { getUsers, deleteUser };
`;
            const delta = generateDeltaTestCode({
                sourceFile: "controllers/admin.controller.js",
                targetTestFile: "tests/controllers/admin.controller.test.js",
                sourceCode,
                rootDir: tempDir
            });

            expect(delta).toContain("require(");
            expect(delta).toContain("getUsers delta branch test: covers alternate query and parameters");
            expect(delta).toContain("deleteUser delta branch test: covers null entity and missing field error paths");
            expect(delta).toContain("expect(res.status || res.json || next).toBeDefined()");
        });

        test("generates targeted delta branch tests for ESM services", () => {
            const sourceCode = `
export const calculateTax = (amount, rate) => amount * (rate || 0.1);
export const formatReceipt = (data) => data ? 'RECEIPT' : null;
`;
            const delta = generateDeltaTestCode({
                sourceFile: "src/services/tax.service.js",
                targetTestFile: "tests/tax.service.test.js",
                sourceCode,
                rootDir: tempDir
            });

            expect(delta).toContain("import { calculateTax, formatReceipt }");
            expect(delta).toContain("calculateTax delta branch test: covers boundary options and boolean toggles");
            expect(delta).toContain("formatReceipt delta branch test: covers empty inputs and default values");
        });

        test("returns empty string when no exports are discovered", () => {
            const sourceCode = `// Empty helper file with no exports\nconst secret = 42;\n`;
            const delta = generateDeltaTestCode({
                sourceFile: "src/utils/secret.js",
                targetTestFile: "tests/secret.test.js",
                sourceCode,
                rootDir: tempDir
            });

            expect(delta).toBe("");
        });
    });

    describe("autoHealTestFailures", () => {
        test("does not rewrite failing mock assertions or existing skips from observed output", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "user.test.js");
            const testContent = `
describe('user tests', () => {
    test.skip('skipped test 1', () => {
        expect(1).toBe(1);
    });
    xit('skipped test 2', () => {
        expect(2).toBe(2);
    });
    test('mock call assertion', () => {
        expect(myMock).toHaveBeenCalledWith('invalid');
    });
});
`;
            fs.writeFileSync(testFile, testContent, "utf8");

            const fakeTestResults = {
                testResults: [
                    {
                        name: testFile,
                        status: "failed",
                        assertionResults: [
                            {
                                title: "mock call assertion",
                                status: "failed",
                                failureMessages: ["Expected number of calls: 1\nReceived: 0\nNumber of calls: 0"]
                            }
                        ]
                    }
                ]
            };

            const healed = autoHealTestFailures(tempDir, ["tests/user.test.js"], fakeTestResults, "");
            expect(healed).toBe(false);

            const contentAfter = fs.readFileSync(testFile, "utf8");
            expect(contentAfter).toBe(testContent);
        });

        test("heals TDZ ReferenceError Cannot access path before initialization", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "worker.test.js");
            fs.writeFileSync(testFile, "const path = path;\ndescribe('worker', () => { test('ok', () => { expect(1).toBe(1); }); });");

            const rawOutput = "ReferenceError: Cannot access 'path' before initialization\n    at Object.path (tests/worker.test.js:1:14)";
            const healed = autoHealTestFailures(tempDir, ["tests/worker.test.js"], null, rawOutput);
            expect(healed).toBe(true);

            const contentAfter = fs.readFileSync(testFile, "utf8");
            expect(contentAfter).not.toContain("const path = path;");
            expect(contentAfter).toContain("const path = require('path');");
        });
    });

    describe("autoRefineCoverageGaps", () => {
        test("early exits if all files already meet >=90% on Statements, Branches, Functions, Lines", async () => {
            const fakeSum = {
                "src/service.js": {
                    statements: { pct: 95 },
                    branches: { pct: 92 },
                    functions: { pct: 100 },
                    lines: { pct: 94 }
                }
            };
            const result = await autoRefineCoverageGaps({
                rootDir: tempDir,
                sourceFilesInspected: ["src/service.js"],
                modifiedFiles: new Set(),
                snapshot: { id: "snap-1" },
                isVitest: false,
                coverageDir: tempDir,
                rawSum: fakeSum,
                rawFinal: {}
            });

            expect(result.currentSum).toEqual(fakeSum);
        });
    });

    describe("P0 Safety & Immutability Invariants", () => {
        test("source file hashes remain 100% unchanged before and after applying test suggestions", () => {
            const srcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            const sourceFile = path.join(srcDir, "billing.service.js");
            const sourceCode = "export function calculateTotal(qty, price) { return qty * price; }";
            fs.writeFileSync(sourceFile, sourceCode, "utf8");

            const hashesBefore = computeSourceFilesHash(tempDir);
            expect(Object.keys(hashesBefore).length).toBeGreaterThan(0);

            const suggestion = {
                sourceFile: "src/services/billing.service.js",
                testFile: "tests/billing.test.js",
                framework: "jest",
                generatedCode: "describe('billing', () => { test('calc', () => { expect(calculateTotal(2, 5)).toBe(10); }); });"
            };

            const result = applyCodeToTestFile(tempDir, suggestion);
            expect(result.changed).toBe(true);

            const immutabilityCheck = verifySourceFilesUnchanged(tempDir, hashesBefore);
            expect(immutabilityCheck.intact).toBe(true);
            expect(immutabilityCheck.changedFiles).toHaveLength(0);

            // Double-check source content
            const contentAfter = fs.readFileSync(sourceFile, "utf8");
            expect(contentAfter).toBe(sourceCode);
        });

        test("path traversal attempts with '..' segments are strictly rejected", () => {
            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "../outside.test.js",
                generatedCode: "describe('outside', () => { test('fail', () => {}); });"
            };

            expect(() => {
                applyCodeToTestFile(tempDir, suggestion);
            }).toThrow(/Path traversal forbidden/);
        });

        test("writing directly into source files (src/) is strictly rejected with 403", () => {
            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "src/calc.js",
                generatedCode: "describe('calc', () => { test('fail', () => {}); });"
            };

            expect(() => {
                applyCodeToTestFile(tempDir, suggestion);
            }).toThrow(/Strict Storage Guard/);
        });

        test("writing into configuration or environment files is strictly rejected", () => {
            for (const badFile of ["package.json", ".env", ".env.local", "tsconfig.json"]) {
                expect(() => {
                    applyCodeToTestFile(tempDir, {
                        testFile: badFile,
                        generatedCode: "describe('bad', () => {});"
                    });
                }).toThrow(/Strict Storage Guard/);
            }
        });

        test("stale diff detection throws 409 Conflict when baseContent mismatches on-disk content", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "auth.test.js");
            fs.writeFileSync(testFile, "// Original version 1 on disk", "utf8");

            const suggestion = {
                testFile: "tests/auth.test.js",
                baseContent: "// Outdated version 0 in memory",
                generatedCode: "describe('auth', () => { test('ok', () => {}); });"
            };

            expect(() => {
                applyCodeToTestFile(tempDir, suggestion);
            }).toThrow(/Stale diff detected/);
        });

        test("preserves existing skipped tests (.skip / xit) without unskipping them", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, "legacy.test.js");
            const legacyContent = `describe('legacy suite', () => {
  test.skip('skipped legacy test 1', () => { expect(1).toBe(1); });
  xit('skipped legacy test 2', () => { expect(2).toBe(2); });
});\n`;
            fs.writeFileSync(testFile, legacyContent, "utf8");

            const suggestion = {
                testFile: "tests/legacy.test.js",
                generatedCode: "describe('new coverage', () => { test('active test', () => { expect(3).toBe(3); }); });"
            };

            const result = applyCodeToTestFile(tempDir, suggestion);
            expect(result.changed).toBe(true);

            const contentAfter = fs.readFileSync(testFile, "utf8");
            expect(contentAfter).toContain("test.skip('skipped legacy test 1'");
            expect(contentAfter).toContain("xit('skipped legacy test 2'");
            expect(contentAfter).toContain("test('active test'");
        });
    });

    describe("cleanTestRunnerError", () => {
        test.each([
            "/app/uploads/snapshots/cmvqxxx1v0002s1lbnazxkujj/caculator/coverage/vitest-results.json",
            "/app/storage/projects/cmvr09nzq00006hlbmtt2std6/github/1793124901204/repo/backend/coverage/runs/run-id/vitest-results.json"
        ])("does not restore an informational report location as an error: %s", reportPath => {
            const output = `  \u001b[32mJSON report written to ${reportPath}\u001b[39m\r\n`;
            expect(cleanTestRunnerError(output)).toBe("");
            expect(getTestRunnerFailure(null, output, 1)).toContain("exit code 1");
            expect(getTestRunnerFailure(null, output, 1)).not.toContain("JSON report written");
        });

        test("extracts assertion failures from JSON reporter output", () => {
            const results = { testResults: [{ assertionResults: [{
                status: "failed", failureMessages: ["AssertionError: expected 2 to be 3"]
            }] }] };
            expect(getTestRunnerFailure(results, "JSON report written to /app/coverage/vitest-results.json", 1))
                .toBe("AssertionError: expected 2 to be 3");
        });

        test("preserves the detailed object diff instead of the abbreviated JSON message", () => {
            const results = { testResults: [{ assertionResults: [{ status: "failed",
                failureMessages: ["AssertionError: expected { result: '', …(1) } to deeply equal { result: '', …(1) }"]
            }] }] };
            const output = `FAIL tests/evaluator.test.ts > rejects non-numbers
AssertionError: expected { result: '', …(1) } to deeply equal { result: '', …(1) }
- Expected
+ Received
  {
-   "error": "non-number result",
+   "error": "invalid characters",
    "result": "",
  }
JSON report written to /app/coverage/results.json`;
            const error = getTestRunnerFailure(results, output, 1);
            expect(error).toContain('"error": "non-number result"');
            expect(error).toContain('"error": "invalid characters"');
            expect(error).not.toContain("JSON report written");
        });

        test("extracts collection errors and unhandled errors without assertions", () => {
            expect(getTestRunnerFailure({ testResults: [{ message: "SyntaxError: Unexpected token" }] }, "", 1))
                .toBe("SyntaxError: Unexpected token");
            expect(getTestRunnerFailure({ errors: [{ message: "Error: Worker exited" }] }, "", 1))
                .toBe("Error: Worker exited");
        });

        test("strips ANSI color escapes and Vite CJS deprecation warning to uncover real transform error", () => {
            const raw = `\u001b[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.\u001b[39m\nJSON report written to /app/storage/projects/xyz/coverage/vitest-results.json\nTransform failed with 1 error:\n/app/storage/projects/xyz/tests/presets/index.vitest.test.ts:5296:31: ERROR: Unexpected "default"`;
            const cleaned = cleanTestRunnerError(raw);
            expect(cleaned).not.toContain("The CJS build of Vite");
            expect(cleaned).not.toContain("\u001b[33m");
            expect(cleaned).not.toContain("JSON report written to");
            expect(cleaned).toContain("Transform failed with 1 error:");
            expect(cleaned).toContain('ERROR: Unexpected "default"');
        });

        test("handles empty or non-string inputs safely", () => {
            expect(cleanTestRunnerError(null)).toBe("");
            expect(cleanTestRunnerError("")).toBe("");
        });
    });

    describe("runJestCoverage covDir resolution", () => {
        test("resolves covDir without ReferenceError and returns coverageDir", async () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "dummy-pkg" }), "utf8");
            
            const spy = jest.spyOn(dockerRunner, "run").mockImplementation(async () => {
                const cov = path.join(tempDir, "coverage");
                fs.mkdirSync(cov, { recursive: true });
                fs.writeFileSync(path.join(cov, "coverage-summary.json"), JSON.stringify({ total: {} }));
                fs.writeFileSync(path.join(cov, "coverage-final.json"), JSON.stringify({}));
                fs.writeFileSync(path.join(cov, "jest-results.json"), JSON.stringify({ success: true, numTotalTests: 1, numPassedTests: 1 }));
                return { success: true, exitCode: 0, stdout: "", stderr: "" };
            });

            try {
                const res = await runJestCoverage("job-covdir-test", tempDir, null, ["tests/a.test.js"], null);
                expect(res).toBeDefined();
                expect(res.exitCode).toBe(0);
                expect(res.coverageDir).toBeDefined();
                expect(res.coverageDir).toContain("coverage");
            } finally {
                spy.mockRestore();
            }
        }, 15000);
    });

    describe("resolveContainerOrHostTestPath & toHaveLength auto-healing", () => {
        test("resolveContainerOrHostTestPath resolves snapshot container paths without duplicate nested segments", () => {
            const rootDir = "d:/NCKH/CovAI-/server/uploads/snapshots/snap123/calc/backend";
            const containerPath = "/app/uploads/snapshots/snap123/calc/backend/tests/utils/evaluator.test.ts";
            const resolved = resolveContainerOrHostTestPath(containerPath, rootDir);
            expect(resolved).toBeDefined();
            expect(resolved.replace(/\\/g, "/")).not.toContain("backend/backend");
        });

        test("autoHealTestFailures preserves a failing length expectation", () => {
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            const testPath = path.join(testDir, "calc.test.js");
            const testContent = `
describe('calc', () => {
    test('history custom limit', async () => {
        const history = [1, 2];
        expect(history).toHaveLength(10);
    });
});
`;
            fs.writeFileSync(testPath, testContent, "utf8");

            const rawOutput = `
FAIL tests/calc.test.js
  ● calc › history custom limit

    expect(received).toHaveLength(expected)

    Expected length: 10
    Received length: 2

      at Object.toHaveLength (tests/calc.test.js:5:25)
`;
            const modified = autoHealTestFailures(tempDir, ["tests/calc.test.js"], null, rawOutput);
            expect(modified).toBe(false);

            const healed = fs.readFileSync(testPath, "utf8");
            expect(healed).toBe(testContent);
        });
    });
});


