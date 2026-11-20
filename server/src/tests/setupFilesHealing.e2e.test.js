import fs from "fs";
import path from "path";
import os from "os";
import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mock Prisma
const mockPrisma = {
    $transaction: jest.fn(async (cb) => {
        if (typeof cb === "function") return await cb(mockPrisma);
        return Promise.all(cb);
    }),
    job: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
    },
    jobLog: {
        create: jest.fn().mockResolvedValue({}),
    },
    projectSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({})
    },
    coverageSummary: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({})
    },
    coverageFile: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({})
    }
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma,
    prisma: mockPrisma
}));

// Mock dockerRunner
const run = jest.fn();
await jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({ dockerRunner: { run } }));

const {
    computeSourceFilesHash,
    verifySourceFilesUnchanged,
    purgeCovaiHarnessFiles,
    sourceIntegrityError
} = await import("../services/applyTestSuggestion.service.js");

const {
    validateVitestSetupFiles
} = await import("../services/vitestProjectGroups.service.js");

const {
    runVitestCoverage
} = await import("../services/vitestRunner.service.js");

const {
    captureWorkspaceFiles
} = await import("../services/projectWorkspacePublish.service.js");

const {
    runUnitTestBatch
} = await import("../services/unitTestBatchRunner.service.js");

describe("Milestone 1: Setup Files Auto-Healing and Source Integrity Protection (Requirement R1)", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-setup-healing-"));
        // Create standard source tree
        fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
        fs.writeFileSync(path.join(tempDir, "src", "math.js"), "export function add(a, b) { return a + b; }", "utf8");
        fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test-pkg", version: "1.0.0" }, null, 2), "utf8");
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch { }
        }
    });

    test("1. validateVitestSetupFiles creates auto-healed setup stub with watermark and tracks it in createdHarnessFiles", () => {
        // Setup a vitest.config.js referencing a missing ./tests/setup.js
        fs.writeFileSync(path.join(tempDir, "vitest.config.js"), `
            export default {
                test: {
                    setupFiles: ['./tests/setup.js']
                }
            };
        `, "utf8");

        const createdHarnessFiles = new Set();
        const result = validateVitestSetupFiles({
            rootDir: tempDir,
            directory: tempDir,
            autoHeal: true,
            createdHarnessFiles
        });

        expect(result.valid).toBe(true);
        expect(result.healed).toBe(true);
        expect(result.createdStubs.length).toBe(1);

        const setupPath = path.join(tempDir, "tests", "setup.js");
        expect(fs.existsSync(setupPath)).toBe(true);
        expect(createdHarnessFiles.has(setupPath)).toBe(true);

        const content = fs.readFileSync(setupPath, "utf8");
        expect(content).toContain("// [covai] auto-healed");
    });

    test("2. verifySourceFilesUnchanged does NOT fail when auto-healed setup stub is present on disk", () => {
        // Baseline before test execution
        const beforeHashes = computeSourceFilesHash(tempDir);
        expect(beforeHashes._compositeHash).toBeTruthy();

        // Simulate test runner auto-healing a setup file stub in server/tests/setup.js
        const stubPath = path.join(tempDir, "server", "tests", "setup.js");
        fs.mkdirSync(path.dirname(stubPath), { recursive: true });
        fs.writeFileSync(stubPath, "// [covai] auto-healed missing test setup file\nexport default {};\nexport {};\n", "utf8");
        expect(fs.existsSync(stubPath)).toBe(true);

        // verifySourceFilesUnchanged should recognize it as transient, unlink it, and report intact: true
        const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
        expect(check.intact).toBe(true);
        expect(check.changedFiles).toHaveLength(0);
        // The transient stub must be removed from disk
        expect(fs.existsSync(stubPath)).toBe(false);
    });

    test("3. purgeCovaiHarnessFiles sweeps both top-level covai-* files and nested auto-healed setup stubs", () => {
        const topHarness = path.join(tempDir, "covai-jest-setup.cjs");
        fs.writeFileSync(topHarness, "module.exports = {};", "utf8");

        const nestedStub1 = path.join(tempDir, "tests", "setup.js");
        fs.mkdirSync(path.dirname(nestedStub1), { recursive: true });
        fs.writeFileSync(nestedStub1, "// [covai] auto-healed missing test setup file\nexport default {};\n", "utf8");

        const nestedStub2 = path.join(tempDir, "server", "tests", "setup.ts");
        fs.mkdirSync(path.dirname(nestedStub2), { recursive: true });
        fs.writeFileSync(nestedStub2, "// [covai] auto-healed Jest setup stub\nexport {};\n", "utf8");

        expect(fs.existsSync(topHarness)).toBe(true);
        expect(fs.existsSync(nestedStub1)).toBe(true);
        expect(fs.existsSync(nestedStub2)).toBe(true);

        purgeCovaiHarnessFiles(tempDir);

        expect(fs.existsSync(topHarness)).toBe(false);
        expect(fs.existsSync(nestedStub1)).toBe(false);
        expect(fs.existsSync(nestedStub2)).toBe(false);
    });

    test("4. captureWorkspaceFiles ignores auto-healed setup stubs so they are never published to project snapshot", async () => {
        const genuineFile = path.join(tempDir, "src", "index.js");
        fs.writeFileSync(genuineFile, "console.log('genuine');", "utf8");

        const stubFile = path.join(tempDir, "server", "tests", "setup.js");
        fs.mkdirSync(path.dirname(stubFile), { recursive: true });
        fs.writeFileSync(stubFile, "// [covai] auto-healed missing test setup file\nexport default {};\n", "utf8");

        const captured = await captureWorkspaceFiles(tempDir);

        expect(captured.has("src/index.js")).toBe(true);
        expect(captured.has("server/tests/setup.js")).toBe(false);
    });

    test("5. Genuine unauthorized modifications to protected source files are strictly detected and blocked", () => {
        const beforeHashes = computeSourceFilesHash(tempDir);

        // 1. Genuine new source file
        const unauthorizedFile = path.join(tempDir, "src", "malicious.js");
        fs.writeFileSync(unauthorizedFile, "console.log('malicious');", "utf8");

        let check = verifySourceFilesUnchanged(tempDir, beforeHashes);
        expect(check.intact).toBe(false);
        expect(check.changedFiles.some(f => f.file === "src/malicious.js" && f.reason === "new file in source directory")).toBe(true);

        const error = sourceIntegrityError(check);
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe("SOURCE_INTEGRITY_FAILED");

        // Clean up unauthorized file
        fs.unlinkSync(unauthorizedFile);

        // 2. Modifying an existing protected source file
        fs.writeFileSync(path.join(tempDir, "src", "math.js"), "export function add() { return 999; }", "utf8");
        check = verifySourceFilesUnchanged(tempDir, beforeHashes);
        expect(check.intact).toBe(false);
        expect(check.changedFiles.some(f => f.file === "src/math.js" && f.reason === "file modified or altered")).toBe(true);

        // 3. Modifying a genuine user-authored setup file (without covai auto-healed watermark)
        fs.writeFileSync(path.join(tempDir, "src", "math.js"), "export function add(a, b) { return a + b; }", "utf8"); // restore
        const userSetup = path.join(tempDir, "tests", "setup.js");
        fs.mkdirSync(path.dirname(userSetup), { recursive: true });
        fs.writeFileSync(userSetup, "// Genuine user setup file\nimport '@testing-library/jest-dom';\n", "utf8");
        check = verifySourceFilesUnchanged(tempDir, beforeHashes);
        expect(check.intact).toBe(false);
        expect(check.changedFiles.some(f => f.file === "tests/setup.js")).toBe(true);
    });

    test("6. runVitestCoverage cleans up createdHarnessFiles in finally block even if execution fails", async () => {
        // Setup vitest.config.js referencing missing setup file
        fs.writeFileSync(path.join(tempDir, "vitest.config.js"), `
            export default {
                test: {
                    setupFiles: ['./tests/setup.js']
                }
            };
        `, "utf8");

        // Mock vitest runner failure
        run.mockRejectedValueOnce(new Error("Simulated runner crash"));

        const createdHarnessFiles = new Set();
        const options = {
            createdHarnessFiles,
            cleanupStubs: true,
            executionDir: tempDir
        };

        const setupPath = path.join(tempDir, "tests", "setup.js");

        await expect(
            runVitestCoverage("job-fail", tempDir, "npx vitest run", [], options)
        ).rejects.toThrow("Simulated runner crash");

        // Despite error, the stub must be unlinked by the finally block
        expect(fs.existsSync(setupPath)).toBe(false);
    });

    test("7. Mixed scenario: Auto-healed stub is unlinked while genuine tampering is still blocked", () => {
        const beforeHashes = computeSourceFilesHash(tempDir);

        // 1. Transient auto-healed stub
        const stubPath = path.join(tempDir, "tests", "setup.js");
        fs.mkdirSync(path.dirname(stubPath), { recursive: true });
        fs.writeFileSync(stubPath, "// [covai] auto-healed missing test setup file\nexport default {};\n", "utf8");

        // 2. Malicious modification to source
        fs.writeFileSync(path.join(tempDir, "src", "math.js"), "export function add() { return 'hacked'; }", "utf8");

        const check = verifySourceFilesUnchanged(tempDir, beforeHashes);

        // Integrity check MUST fail because src/math.js was modified
        expect(check.intact).toBe(false);
        expect(check.changedFiles.some(f => f.file === "src/math.js")).toBe(true);

        // But tests/setup.js must NOT be reported as changed because it was a transient stub
        expect(check.changedFiles.some(f => f.file === "tests/setup.js")).toBe(false);

        // And the stub must have been unlinked
        expect(fs.existsSync(stubPath)).toBe(false);
    });

    test("8. Jest setup stubbing filterExistingSetupFiles creates auto-healed stub and verifySourceFilesUnchanged accepts it", async () => {
        const { filterExistingSetupFiles } = await import("../services/runTestsJob.service.js");

        // Baseline before stub creation
        const beforeHashes = computeSourceFilesHash(tempDir);

        const createdHarnessFiles = new Set();
        const setupList = ["<rootDir>/server/tests/setup.js"];
        const filtered = filterExistingSetupFiles(setupList, tempDir, {
            rootDir: tempDir,
            autoStub: true,
            createdHarnessFiles
        });

        const stubPath = path.join(tempDir, "server", "tests", "setup.js");
        expect(fs.existsSync(stubPath)).toBe(true);
        expect(createdHarnessFiles.has(stubPath)).toBe(true);

        const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
        expect(check.intact).toBe(true);
        expect(fs.existsSync(stubPath)).toBe(false);
    });

    test("9. runUnitTestBatch cleans up lingering harness files in finally block", async () => {
        const testFile = path.join(tempDir, "tests", "math.test.js");
        fs.mkdirSync(path.dirname(testFile), { recursive: true });
        fs.writeFileSync(testFile, "test('dummy', () => {});", "utf8");

        const coverageDir = path.join(tempDir, "coverage");

        // Execute batch with empty testFiles list so it exits early after group setup
        const result = await runUnitTestBatch({
            rootDir: tempDir,
            snapshot: {},
            testFiles: ["tests/math.test.js"],
            targetSourceFiles: ["src/math.js"],
            coverageDir,
            frameworkByFile: { "tests/math.test.js": "vitest" }
        });

        expect(result).toBeDefined();
        // Check that any harness files created during execution were unlinked
        const lingering = fs.readdirSync(tempDir).filter(f => f.startsWith("covai-"));
        expect(lingering).toHaveLength(0);
    });
});
