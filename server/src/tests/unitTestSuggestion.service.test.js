import fs from "fs";
import os from "os";
import path from "path";
import {
    findAssociatedSourceFile,
    findExistingTestFile,
    generateFallbackUnitTests,
    suggestUnitTestcases
} from "../services/unitTestSuggestion.service.js";

describe("unitTestSuggestion.service unit tests", () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-test-sugg-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe("findExistingTestFile", () => {
        test("finds existing test file in tests/<source>.test.js", () => {
            fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, "tests", "calc.test.js"), "// existing calc test");

            const result = findExistingTestFile(tmpDir, "src/calc.js");
            expect(result.found).toBe(true);
            expect(result.relativePath).toBe("tests/calc.test.js");
            expect(result.content).toBe("// existing calc test");
        });

        test("defaults to tests/<source>.test.<ext> when no existing test file is found", () => {
            const result = findExistingTestFile(tmpDir, "src/controllers/auth.controller.js");
            expect(result.found).toBe(false);
            expect(result.relativePath).toBe("tests/auth.controller.test.js");
        });

        test("returns test file itself without nested .test.test.js extensions", () => {
            fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, "tests", "api.supertest.test.js"), "// test content");

            const result = findExistingTestFile(tmpDir, "tests/api.supertest.test.js");
            expect(result.found).toBe(true);
            expect(result.relativePath).toBe("tests/api.supertest.test.js");
            expect(result.relativePath).not.toContain(".test.test.js");
        });
    });

    describe("generateFallbackUnitTests", () => {
        test("generates Jest test structure when framework is jest", () => {
            const result = generateFallbackUnitTests({
                framework: "jest",
                sourceFile: "src/calculator.js",
                baseName: "calculator",
                uncoveredLines: [15, 20],
                existingContent: ""
            });

            expect(result.explanation).toContain("JEST");
            expect(result.fullUpdatedContent).toContain("describe('calculator unit tests");
            expect(result.fullUpdatedContent).toContain("15, 20");
        });

        test("appends to existing test content without modifying source", () => {
            const existing = "// Header\ndescribe('base', () => {});";
            const result = generateFallbackUnitTests({
                framework: "vitest",
                sourceFile: "src/calc.js",
                baseName: "calc",
                uncoveredLines: [5],
                existingContent: existing
            });

            expect(result.fullUpdatedContent.startsWith(existing)).toBe(true);
            expect(result.fullUpdatedContent).toContain("describe('calc unit tests");
        });
    });

    describe("findAssociatedSourceFile", () => {
        test("finds source file from relative import in test file", () => {
            fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
            fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, "src", "calculator.js"), "export const add = (a, b) => a + b;");
            fs.writeFileSync(path.join(tmpDir, "tests", "calc.test.js"), "import { add } from '../src/calculator.js';");

            const found = findAssociatedSourceFile(tmpDir, "tests/calc.test.js");
            expect(found).toBe("src/calculator.js");
        });

        test("finds source file by base name convention when in src/", () => {
            fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
            fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, "src", "math.js"), "export const square = (x) => x * x;");
            fs.writeFileSync(path.join(tmpDir, "tests", "math.test.js"), "// test content");

            const found = findAssociatedSourceFile(tmpDir, "tests/math.test.js");
            expect(found).toBe("src/math.js");
        });

        test("returns null when no matching source file exists", () => {
            fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, "tests", "unknown.test.js"), "// no import");

            const found = findAssociatedSourceFile(tmpDir, "tests/unknown.test.js");
            expect(found).toBeNull();
        });
    });

    describe("suggestUnitTestcases test file support", () => {
        test("does not reject test files with 400 error, proceeds to project lookup", async () => {
            // When projectId does not exist, it throws 404 Project not found, proving it did not reject with 400
            await expect(suggestUnitTestcases({
                projectId: "proj-nonexistent",
                snapshotId: "snap-123",
                filePath: "tests/calculator.test.js",
                userId: "user-123"
            })).rejects.toThrow("Project not found or unauthorized");
        });
    });

    describe("Vitest support in findExistingTestFile & fallback", () => {
        test("finds tests/vitest.test.js when framework is vitest", () => {
            fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, "tests", "vitest.test.js"), "import { test } from 'vitest';");

            const result = findExistingTestFile(tmpDir, "src/calculator.js", "vitest");
            expect(result.found).toBe(true);
            expect(result.relativePath).toBe("tests/vitest.test.js");
        });

        test("defaults to tests/<base>.vitest.test.js when tests/<base>.test.js is used by jest", () => {
            fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, "tests", "calc.test.js"), "// jest test");

            const result = findExistingTestFile(tmpDir, "src/calc.js", "vitest");
            expect(result.found).toBe(false);
            expect(result.relativePath).toBe("tests/calc.vitest.test.js");
        });

        test("generates Vitest ESM syntax with imports in fallback", () => {
            const result = generateFallbackUnitTests({
                framework: "vitest",
                sourceFile: "src/calculator.js",
                baseName: "calculator",
                uncoveredLines: [10],
                existingContent: "",
                sourceCode: "export function add(a, b) { return a + b; }"
            });

            expect(result.explanation).toContain("VITEST");
            expect(result.fullUpdatedContent).toContain("import { describe, test, expect } from 'vitest';");
            expect(result.fullUpdatedContent).toContain("import { add } from '../src/calculator.js';");
            expect(result.fullUpdatedContent).toContain("add should execute without error");
        });
    });
});

