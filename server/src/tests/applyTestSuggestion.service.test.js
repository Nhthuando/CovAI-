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
    autoRefineCoverageGaps
} from "../services/applyTestSuggestion.service.js";

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
        test("unskips skipped tests to restore coverage and relaxes assertions", () => {
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
            expect(healed).toBe(true);

            const contentAfter = fs.readFileSync(testFile, "utf8");
            expect(contentAfter).not.toContain("test.skip(");
            expect(contentAfter).not.toContain("xit(");
            expect(contentAfter).toContain("test('skipped test 1'");
            expect(contentAfter).toContain("it('skipped test 2'");
            expect(contentAfter).toContain("expect(myMock).toBeDefined()");
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
});


