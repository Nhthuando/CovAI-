import fs from "fs";
import path from "path";
import os from "os";
import { jest } from "@jest/globals";
import {
    resolveSnapshotRootDir,
    applyCodeToTestFile,
    cleanAndDeduplicateTestContent,
    sanitizeAllProjectTestFiles
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
});

