import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { isBusinessLogicSourceFile } from "../utils/businessLogicFileDetector.js";
import { isBusinessLogicFile } from "../services/businessLogicAstAnalyzer.service.js";
import { classifyUnitTestPath, unitTestInventory } from "../services/unitTestFilePolicy.service.js";
import { testContentHash } from "../services/unitTestChangeSet.service.js";

const prisma = {
    projectSnapshot: { findUnique: jest.fn() },
    coverageFile: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
    coverageSummary: { upsert: jest.fn() }
};
await jest.unstable_mockModule("../config/prisma.js", () => ({ default: prisma, prisma }));
await jest.unstable_mockModule("../controllers/coverage.controller.js", () => ({ invalidateCoverageCache: jest.fn() }));
const { applyUnitTestSuggestion, activeApplyLocks, purgeCovaiHarnessFiles } = await import("../services/applyTestSuggestion.service.js");
const { findUnitFiles, findLogicSourceFiles } = await import("../services/runTestsJob.service.js");

describe("apply suggestion with JSON-only runner failures", () => {
    let rootDir;
    beforeEach(() => {
        jest.clearAllMocks();
        const tempParent = fileURLToPath(new URL("../../.covai-temp/", import.meta.url));
        fs.mkdirSync(tempParent, { recursive: true });
        rootDir = fs.mkdtempSync(path.join(tempParent, "covai-apply-json-error-"));
        fs.mkdirSync(path.join(rootDir, "src"));
        fs.writeFileSync(path.join(rootDir, "src/math.js"), "export const add = (a, b) => a + b;\n");
        prisma.projectSnapshot.findUnique.mockResolvedValue({ id: "snap-json", projectId: "project-json", rootDir });
    });
    afterEach(() => {
        activeApplyLocks.clear();
        fs.rmSync(rootDir, { recursive: true, force: true });
    });

    test.each([false, true])("returns the actual failure even when coverage exists (%s)", async withCoverage => {
        const result = await applyUnitTestSuggestion({
            snapshotId: "snap-json", projectId: "project-json",
            suggestion: {
                sourceFile: "src/math.js", testFile: "tests/math.test.js", framework: "vitest",
                generatedCode: "test('adds', () => { throw new Error('service unavailable'); });"
            },
            runCoverageFn: async ({ sealedRunDir }) => {
                fs.writeFileSync(path.join(sealedRunDir, "vitest-results.json"), JSON.stringify({
                    success: false, numFailedTests: 1,
                    testResults: [{ name: path.join(rootDir, "tests/math.test.js"), status: "failed",
                        assertionResults: [{ status: "failed", title: "adds", failureMessages: ["Error: service unavailable"] }]
                    }]
                }));
                if (withCoverage) fs.writeFileSync(path.join(sealedRunDir, "coverage-final.json"), JSON.stringify({ "src/math.js": {} }));
            }
        });
        expect(result.success).toBe(false);
        expect(result.status).toBe("FAILED");
        expect(result.errorDetail).toContain("Error: service unavailable");
        expect(result.appliedSuggestions[0].error).toContain("Error: service unavailable");
        expect(result.newCoverage).toBeNull();
    });

    const orphan = "tests/covai-jest-resolver-server.test.cjs";
    const existing = "tests/existing.test.js";
    const original = "test('baseline', () => { expect(1).toBe(1); });\n";
    const candidate = name => "test('" + name + "', () => { expect(2 + 2).toBe(4); });\n";
    const suggestions = ["first", "second", "existing"].map(name => ({
        sourceFile: "src/math.js",
        testFile: "tests/" + name + ".test.js",
        framework: "jest",
        generatedCode: candidate(name),
    }));
    function writeFixture(file, content) {
        const target = path.join(rootDir, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    const apply = (drafts, runCoverageFn) => applyUnitTestSuggestion({
        snapshotId: "snap-json", projectId: "project-json", suggestions: drafts, runCoverageFn,
    });

    test("records and executes the equivalent matcher repair for a reviewed Jest draft", async () => {
        const draft = suggestions[0];
        const code = "const { add } = require('../src/math.js');\ntest('checks result type', () => expect(add(2, 3)).toBeTypeOf('number'));";
        const run = jest.fn(async ({ sealedRunDir }) => {
            const content = fs.readFileSync(path.join(rootDir, draft.testFile), "utf8");
            expect(content).toContain("typeof (0, add(2, 3))");
            expect(content).not.toContain("toBeTypeOf");
            fs.writeFileSync(path.join(sealedRunDir, "jest-results.json"), JSON.stringify({
                success: true, testResults: [{ name: path.join(rootDir, draft.testFile), status: "passed",
                    assertionResults: [{ status: "passed", title: "checks result type" }] }],
            }));
            const covered = { total: 1, covered: 1, skipped: 0, pct: 100 };
            const metrics = { statements: covered, functions: covered, lines: covered, branches: covered };
            fs.writeFileSync(path.join(sealedRunDir, "coverage-summary.json"), JSON.stringify({ total: metrics, "src/math.js": metrics }));
            return { exitCode: 0 };
        });
        const result = await apply([{ ...draft, status: "GENERATED", generatedCode: code, fullUpdatedContent: code,
            changeSet: { candidateHash: testContentHash(code), baseHash: testContentHash("") } }], run);
        expect(run).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ success: true, qualityGate: {
            repairs: [expect.objectContaining({ action: "NORMALIZE_JEST_TYPEOF", testFile: draft.testFile })],
        } });
    });

    test("returns all external dependencies reported across failed suites", async () => {
        const drafts = suggestions.slice(0, 2).map(item => ({
            ...item, status: "GENERATED",
            generatedCode: "const { add } = require('../src/math.js');\ntest('adds', () => expect(add(1, 2)).toBe(3));",
        }));
        const errors = [
            ["Cannot find module '../src/local-helper' from 'tests/first.test.js'", "Cannot find module '@google/genai' from 'tests/first.test.js'"],
            ["Cannot find module 'bcrypt' from 'tests/second.test.js'", "Cannot find module 'mongoose' from 'tests/second.test.js'"],
        ];
        const result = await apply(drafts, async ({ sealedRunDir }) => {
            fs.writeFileSync(path.join(sealedRunDir, "jest-results.json"), JSON.stringify({
                success: false, numFailedTests: 2,
                testResults: drafts.map(({ testFile }, index) => ({
                    name: path.join(rootDir, testFile), status: "failed",
                    assertionResults: [{ title: "adds", status: "failed", failureMessages: errors[index] }],
                })),
            }));
            return { exitCode: 1 };
        });
        expect(result.missingDependencies.map(dependency => dependency.packageName)).toEqual(["@google/genai", "bcrypt", "mongoose"]);
        expect(result.missingDependency.packageName).toBe("@google/genai");
        expect(result.fileUpdated).toBe(false);
    });

    test.each([
        ["fully covered", "NO_CHANGES", null],
        ["partially covered", "FAILED", "TARGETED_LINES_OR_BRANCHES_NOT_GAINED"],
        ["missing", "FAILED", "fresh coverage-final.json"],
    ])("handles successful generated tests with a %s baseline", async (baseline, status, diagnostic) => {
        const testFile = "tests/math.test.js";
        const originalSuite = "import { add } from '../src/math.js';\ntest('base', () => expect(add(1, 2)).toBe(3));\n";
        writeFixture(testFile, originalSuite);
        const generatedCode = originalSuite + "test('adds other numbers', () => expect(add(2, 3)).toBe(5));\n";
        const location = { start: { line: 1, column: 0 }, end: { line: 1, column: 35 } };
        const run = jest.fn(async ({ sealedRunDir, phase }) => {
            const isBaseline = phase === "quality-baseline";
            expect(fs.readFileSync(path.join(rootDir, testFile), "utf8")).toContain(isBaseline ? "test('base'" : "adds other numbers");
            if (isBaseline) expect(fs.readFileSync(path.join(rootDir, testFile), "utf8")).toBe(originalSuite);
            const titles = isBaseline ? ["base"] : ["base", "adds other numbers"];
            fs.writeFileSync(path.join(sealedRunDir, "jest-results.json"), JSON.stringify({
                success: true, testResults: [{
                    name: path.join(rootDir, testFile), status: "passed",
                    assertionResults: titles.map(title => ({ title, status: "passed" })),
                }],
            }));
            if (!isBaseline || baseline !== "missing") {
                fs.writeFileSync(path.join(sealedRunDir, "coverage-final.json"), JSON.stringify({
                    "src/math.js": {
                        path: "src/math.js", statementMap: { 0: location }, s: { 0: 1 },
                        fnMap: { 0: { name: "add", decl: location, loc: location } }, f: { 0: 1 },
                        branchMap: { 0: { type: "branch", loc: location, locations: [location] } },
                        b: { 0: [baseline === "partially covered" ? 0 : 1] },
                    },
                }));
            }
            return { exitCode: 0 };
        });
        const result = await apply([{
            ...suggestions[0], testFile, generatedCode, status: "GENERATED", targetLines: [1],
        }], run);
        expect(run).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ status, fileUpdated: false, qualityGate: { accepted: 0 } });
        if (diagnostic) {
            expect(result.success).toBe(false);
            expect(result.coverageDiagnostics.failureReason).toContain(diagnostic);
        } else {
            expect(result).toMatchObject({
                success: true, workflowState: "BASELINE_ALREADY_FULLY_COVERED",
                qualityGate: { status: "NO_CHANGES", coverage: [] },
                coverageDiagnostics: { failureReason: null, targetSourceFiles: ["src/math.js"] },
            });
        }
        expect(result.versionBatch).toBeUndefined();
        expect(fs.readFileSync(path.join(rootDir, testFile), "utf8")).toBe(originalSuite);
        expect(prisma.coverageSummary.upsert).not.toHaveBeenCalled();
    });

    test("blocks a generated assertion unrelated to the source before the runner", async () => {
        const runner = jest.fn();
        const result = await apply([{
            ...suggestions[0], status: "GENERATED", generatedCode: "test('adds', () => expect(1).toBe(1));",
        }], runner);
        expect(result).toMatchObject({ success: false, fileUpdated: false, qualityGate: {
            status: "REVIEW_REQUIRED", attempts: [], findings: [expect.objectContaining({ code: "D" })],
        } });
        expect(runner).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(rootDir, suggestions[0].testFile))).toBe(false);
    });

    test("preserves an unverified expectation and performs no automatic retry", async () => {
        const draft = {
            ...suggestions[0], status: "GENERATED",
            generatedCode: "import { add } from '../src/math.js';\ntest('adds', () => expect(add(1, 1)).toBe(3));",
        };
        const runner = jest.fn(async ({ sealedRunDir }) => {
            expect(fs.readFileSync(path.join(rootDir, draft.testFile), "utf8")).toContain("toBe(3)");
            fs.writeFileSync(path.join(sealedRunDir, "jest-results.json"), JSON.stringify({
                success: false, numFailedTests: 1, testResults: [{
                    name: path.join(rootDir, draft.testFile), status: "failed",
                    assertionResults: [{ title: "adds", status: "failed", failureMessages: ["Expected: 3\nReceived: 2"] }],
                }],
            }));
            return { exitCode: 1 };
        });
        const result = await apply([draft], runner);
        expect(result).toMatchObject({ success: false, newCoverage: null, qualityGate: { accepted: 0, attempts: [
            expect.objectContaining({ failures: [expect.objectContaining({ classification: "REQUIREMENT_UNVERIFIED", expected: "3", actual: "2" })] }),
        ] } });
        expect(runner).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(path.join(rootDir, draft.testFile))).toBe(false);
    });

    test("excludes live and cached resolver paths from Suggest, regression and coverage", () => {
        const resolver = "src/covai-jest-resolver-server.cjs";
        const packageResolver = "server/covai-jest-resolver-server.cjs";
        writeFixture(resolver, "module.exports = () => 'resolver';");
        writeFixture(packageResolver, "module.exports = () => 'resolver';");
        writeFixture(orphan, "require('../src/covai-jest-resolver-server');\n" + original);
        writeFixture("server/" + orphan, original);
        writeFixture(existing, original);
        writeFixture("src/covai-custom.js", "exports.name = 'application code';");

        // The DB coverage list and the disk inventory use these source classifiers.
        for (const file of [resolver, packageResolver]) {
            expect(isBusinessLogicFile(file)).toBe(false);
            expect(isBusinessLogicSourceFile(file)).toBe(false);
            expect(classifyUnitTestPath(rootDir, file).role).toBe("RUNTIME");
        }
        expect(unitTestInventory(rootDir).sourcePaths).toEqual(expect.arrayContaining([existing, "src/math.js"]));
        expect(unitTestInventory(rootDir).sourcePaths).not.toEqual(expect.arrayContaining([resolver]));
        expect(findLogicSourceFiles(rootDir).map(file => file.relativePath)).toEqual(["src/covai-custom.js", "src/math.js"]);
        expect(findUnitFiles(rootDir).jestFiles).toEqual([existing]);

        purgeCovaiHarnessFiles(rootDir);
        expect(fs.existsSync(path.join(rootDir, resolver))).toBe(false);
        expect(fs.existsSync(path.join(rootDir, packageResolver))).toBe(false);
        expect(fs.existsSync(path.join(rootDir, orphan))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, "server", orphan))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, "src/covai-custom.js"))).toBe(true);
    });

    test.each([
        { sourceFile: "src/covai-jest-resolver-server.cjs", testFile: "tests/regular.test.js" },
        { sourceFile: "src/math.js", testFile: orphan },
    ])("rejects a stale mixed batch before preparing any candidate ($testFile)", async stale => {
        const run = jest.fn();
        await expect(apply([suggestions[0], { ...suggestions[1], ...stale }], run)).rejects.toMatchObject({
            statusCode: 422,
            message: expect.stringContaining("Regenerate the batch with Suggest"),
        });
        expect(run).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(rootDir, suggestions[0].testFile))).toBe(false);
        expect(prisma.coverageSummary.upsert).not.toHaveBeenCalled();
    });

    test.each([true, false])("runs only after all three candidates are written and verifies or rolls back (%s)", async pass => {
        writeFixture(existing, original);
        writeFixture(orphan, "require('../src/covai-jest-resolver-server');\n" + original);
        const run = jest.fn(async ({ sealedRunDir, testFilesToRun }) => {
            expect(new Set(testFilesToRun)).toEqual(new Set(suggestions.map(item => item.testFile)));
            for (const item of suggestions) {
                expect(fs.readFileSync(path.join(rootDir, item.testFile), "utf8")).toContain(item.generatedCode.trim());
            }
            expect(fs.readFileSync(path.join(rootDir, existing), "utf8")).toContain(original.trim());

            fs.writeFileSync(path.join(sealedRunDir, "jest-results.json"), JSON.stringify({
                success: pass,
                numFailedTests: pass ? 0 : 3,
                testResults: suggestions.map(item => ({
                    name: path.join(rootDir, item.testFile),
                    status: pass ? "passed" : "failed",
                    assertionResults: [{ status: pass ? "passed" : "failed", title: "candidate",
                        failureMessages: pass ? [] : ["Error: fixture failure"] }],
                })),
            }));
            if (pass) {
                const covered = { total: 1, covered: 1, skipped: 0, pct: 100 };
                const coverage = {
                    statements: covered, functions: covered, lines: covered,
                    branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
                };
                fs.writeFileSync(path.join(sealedRunDir, "coverage-summary.json"), JSON.stringify({
                    total: coverage, "src/math.js": coverage,
                }));
            }
            return { exitCode: pass ? 0 : 1 };
        });
        const result = await apply(suggestions, run);
        expect(run).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ success: pass, fileUpdated: pass, status: pass ? "PASSED" : "FAILED" });
        if (pass) {
            expect(result.versionBatch).toBeDefined();
            expect(prisma.coverageSummary.upsert).toHaveBeenCalledTimes(1);
        } else {
            expect(fs.readFileSync(path.join(rootDir, existing), "utf8")).toBe(original);
            expect(fs.existsSync(path.join(rootDir, suggestions[0].testFile))).toBe(false);
            expect(fs.existsSync(path.join(rootDir, suggestions[1].testFile))).toBe(false);
            expect(prisma.coverageSummary.upsert).not.toHaveBeenCalled();
        }
        expect(fs.existsSync(path.join(rootDir, orphan))).toBe(true);
    });

    test("rolls back a batch when the second candidate cannot be written", async () => {
        const run = jest.fn();
        const target = path.join(rootDir, suggestions[1].testFile);
        const open = fs.openSync;
        const spy = jest.spyOn(fs, "openSync").mockImplementation((file, flags, ...args) => {
            if (file === target && flags === "w") throw new Error("fixture write failed");
            return open(file, flags, ...args);
        });
        try {
            await expect(apply(suggestions.slice(0, 2), run)).rejects.toThrow("fixture write failed");
            expect(run).not.toHaveBeenCalled();
            expect(fs.existsSync(path.join(rootDir, suggestions[0].testFile))).toBe(false);
            expect(fs.existsSync(target)).toBe(false);
            expect(prisma.coverageSummary.upsert).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });
});
