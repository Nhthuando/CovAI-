import fs from "fs";
import path from "path";
import os from "os";
import { jest } from "@jest/globals";
import {
    resolveSnapshotRootDir,
    applyCodeToTestFile
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
});

