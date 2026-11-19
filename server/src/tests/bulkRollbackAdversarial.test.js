import fs from "fs";
import path from "path";
import os from "os";
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

let currentTempDir = null;

let storedCoverageSummary = null;

const mockPrisma = {
    project: {
        findFirst: jest.fn(),
        findUnique: jest.fn()
    },
    projectMember: {
        findUnique: jest.fn()
    },
    projectSnapshot: {
        findUnique: jest.fn(),
        findFirst: jest.fn()
    },
    coverageSummary: {
        findUnique: jest.fn(async () => storedCoverageSummary),
        upsert: jest.fn(async ({ update, create }) => {
            storedCoverageSummary = { ...(create || {}), ...(update || {}) };
            return storedCoverageSummary;
        })
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
        create: jest.fn().mockResolvedValue({ id: "ai-adv-1" })
    },
    $transaction: jest.fn(async (cb) => (typeof cb === "function" ? cb(mockPrisma) : cb))
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma
}));

const mockCreateRunTestsJob = jest.fn().mockResolvedValue({ id: "job_adv_test" });
const mockAddJobToQueue = jest.fn().mockResolvedValue(true);

await jest.unstable_mockModule("../services/job.service.js", () => ({
    createInstallDepsJob: jest.fn().mockResolvedValue({ id: "install-1" }),
    createRunTestsJob: mockCreateRunTestsJob,
    createSupertestCoverageJob: jest.fn().mockResolvedValue({ id: "super-1" }),
    createVitestCoverageJob: jest.fn().mockResolvedValue({ id: "vitest-1" }),
    createCypressSystemCoverageJob: jest.fn().mockResolvedValue({ id: "cypress-1" }),
    createPlaywrightSystemCoverageJob: jest.fn().mockResolvedValue({ id: "playwright-1" }),
    createSystemTestAnalysisJob: jest.fn().mockResolvedValue({ id: "system-1" }),
    createAnalysisJob: jest.fn().mockResolvedValue({ id: "job_analysis" }),
    createSnapshotIngestJob: jest.fn().mockResolvedValue({ id: "job_ingest" }),
    markJobRunning: jest.fn().mockResolvedValue({}),
    markJobSuccess: jest.fn().mockResolvedValue({}),
    markJobFailed: jest.fn().mockResolvedValue({}),
    updateJobProgress: jest.fn().mockResolvedValue({}),
    cancelJob: jest.fn().mockResolvedValue({}),
    getJobById: jest.fn().mockResolvedValue({ id: "job-1", status: "SUCCESS" }),
    addJobLog: jest.fn().mockResolvedValue({}),
    STALE_JOB_TIMEOUT_MS: 15 * 60 * 1000
}));

await jest.unstable_mockModule("../services/queue.service.js", () => ({
    addJobToQueue: mockAddJobToQueue,
    addSupertestCoveragePipeline: jest.fn().mockResolvedValue(true),
    jobQueue: {}
}));

await jest.unstable_mockModule("../services/projectWorkspacePreparation.service.js", () => ({
    withPreparedProjectWorkspace: jest.fn(async (options, run) => run({
        rootDir: currentTempDir || os.tmpdir(),
        analysisRelative: "",
        originalRootDir: currentTempDir || os.tmpdir()
    }))
}));

let runnerCoverageOverride = null;
let runnerTestResultsOverride = null;
let runnerBehaviorHook = null;

await jest.unstable_mockModule("../services/unitTestBatchRunner.service.js", () => ({
    runUnitTestBatch: jest.fn(async ({ coverageDir, testFiles = [] }) => {
        if (typeof runnerBehaviorHook === "function") {
            runnerBehaviorHook();
        }
        fs.mkdirSync(coverageDir, { recursive: true });
        const testResults = runnerTestResultsOverride || testFiles.map(tf => ({
            name: path.resolve(currentTempDir || os.tmpdir(), tf),
            status: "passed",
            assertionResults: [{ status: "passed", title: "test pass" }]
        }));
        fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
            success: true,
            numFailedTestSuites: 0,
            testResults
        }), "utf8");

        const covSummary = runnerCoverageOverride || {
            total: {
                statements: { total: 20, covered: 16, pct: 80.0 },
                branches: { total: 10, covered: 8, pct: 80.0 },
                functions: { total: 8, covered: 6, pct: 75.0 },
                lines: { total: 20, covered: 16, pct: 80.0 }
            },
            "src/service.js": {
                statements: { total: 20, covered: 16, pct: 80.0 },
                branches: { total: 10, covered: 8, pct: 80.0 },
                functions: { total: 8, covered: 6, pct: 75.0 },
                lines: { total: 20, covered: 16, pct: 80.0 }
            }
        };
        fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify(covSummary), "utf8");
        return { exitCode: 0, stdout: "PASS", stderr: "" };
    })
}));

await jest.unstable_mockModule("../services/dependencyInstallation.service.js", () => ({
    dependencyInstallationService: { install: jest.fn(async () => ({ success: true, installed: true, stdout: "", stderr: "" })) }
}));

const {
    saveVerifiedUnitTestBatch,
    switchUnitTestVersion,
    clearManifestCache,
    removeEmptyParentsRecursively,
    loadManifest,
    VERSIONS_DIR_NAME,
    MANIFEST_FILE_NAME
} = await import("../services/unitTestVersion.service.js");

const {
    computeSourceFilesHash,
    verifySourceFilesUnchanged
} = await import("../services/applyTestSuggestion.service.js");

const {
    switchUnitTestVersionController
} = await import("../controllers/coverage.controller.js");

describe("Milestone 2 Bulk Rollback & Filesystem State Logic - Adversarial Stress Suite", () => {
    let tempDir;
    const snapshotId = "snap-adv-001";
    const projectId = "proj-adv-001";
    const userId = "user-adv-001";

    beforeEach(() => {
        clearManifestCache();
        storedCoverageSummary = null;
        runnerCoverageOverride = null;
        runnerTestResultsOverride = null;
        runnerBehaviorHook = null;
        jest.clearAllMocks();

        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-adv-test-"));
        currentTempDir = tempDir;

        // Default project snapshot lookup
        mockPrisma.project.findUnique.mockResolvedValue({
            id: projectId,
            workspaceRevision: 1
        });
        mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
            id: snapshotId,
            projectId,
            rootDir: tempDir,
            storagePath: tempDir,
            source: "LOCAL"
        });
        mockPrisma.projectSnapshot.findFirst.mockResolvedValue({
            id: snapshotId,
            projectId,
            rootDir: tempDir,
            storagePath: tempDir,
            source: "LOCAL",
            project: { id: projectId, members: [{ userId }] }
        });
        mockPrisma.coverageSummary.upsert.mockImplementation(async ({ update, create }) => {
            storedCoverageSummary = { ...(create || {}), ...(update || {}) };
            return storedCoverageSummary;
        });
        mockPrisma.coverageFile.upsert.mockResolvedValue({});
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    describe("1. Bulk Rollback to Version 1 (Baseline)", () => {
        it("1.1: Restores modified test files to exact baseline contents byte-for-byte", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "calculator.js"), "module.exports = { add: (a, b) => a + b };", "utf8");

            const baselineContent = "// Baseline Calculator Test\ndescribe('add', () => { it('works', () => {}); });";
            const testFilePath = path.join(testsDir, "calculator.test.js");
            fs.writeFileSync(testFilePath, baselineContent, "utf8");

            // Batch Version 2 modifies calculator.test.js
            const modifiedContent = `${baselineContent}\n// AI generated test for edge cases\ndescribe('add negative', () => {});`;
            fs.writeFileSync(testFilePath, modifiedContent, "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_v2_calc",
                files: [{
                    testFile: "tests/calculator.test.js",
                    sourceFile: "src/calculator.js",
                    originalContent: baselineContent,
                    updatedContent: modifiedContent,
                    framework: "jest"
                }],
                verification: { valid: true },
                coverage: { total: { statements: { total: 10, covered: 9, pct: 90.0 }, branches: { total: 4, covered: 4, pct: 100.0 }, functions: { total: 2, covered: 2, pct: 100.0 }, lines: { total: 10, covered: 9, pct: 90.0 } } }
            });

            expect(fs.readFileSync(testFilePath, "utf8")).toBe(modifiedContent);

            // Rollback to Version 1 (Baseline)
            const result = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1
            });

            expect(result.success).toBe(true);
            expect(result.targetVersion).toBe(1);
            expect(fs.readFileSync(testFilePath, "utf8")).toBe(baselineContent);
            expect(fs.readFileSync(testFilePath, "utf8")).not.toContain("AI generated");
        });

        it("1.2: Completely unlinks newly created test files from disk", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "user.js"), "module.exports = { getUser: () => ({ id: 1 }) };", "utf8");

            const newTestFilePath = path.join(testsDir, "user.test.js");
            const newTestContent = "// AI generated user test\ndescribe('user', () => {});";
            fs.writeFileSync(newTestFilePath, newTestContent, "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_v2_user",
                files: [{
                    testFile: "tests/user.test.js",
                    sourceFile: "src/user.js",
                    originalContent: null, // Did not exist in baseline!
                    updatedContent: newTestContent,
                    framework: "jest"
                }],
                verification: { valid: true },
                coverage: { total: { statements: { total: 5, covered: 5, pct: 100.0 }, branches: { total: 0, covered: 0, pct: 100.0 }, functions: { total: 1, covered: 1, pct: 100.0 }, lines: { total: 5, covered: 5, pct: 100.0 } } }
            });

            expect(fs.existsSync(newTestFilePath)).toBe(true);

            // Revert all files to baseline
            const result = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1
            });

            expect(result.success).toBe(true);
            expect(fs.existsSync(newTestFilePath)).toBe(false);
        });

        it("1.3: Recursively cleans up empty parent directories created solely for new test files without deleting project root", async () => {
            const deepDir = path.join(tempDir, "tests", "unit", "nested", "level3");
            fs.mkdirSync(deepDir, { recursive: true });
            const deepTestFile = path.join(deepDir, "deep.test.js");
            fs.writeFileSync(deepTestFile, "// Deep test\ndescribe('deep', () => {});", "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_v2_deep",
                files: [{
                    testFile: "tests/unit/nested/level3/deep.test.js",
                    sourceFile: "src/deep.js",
                    originalContent: null,
                    updatedContent: "// Deep test\ndescribe('deep', () => {});",
                    framework: "jest"
                }],
                verification: { valid: true },
                coverage: { total: { statements: { total: 2, covered: 2, pct: 100 }, branches: { total: 0, covered: 0, pct: 100 }, functions: { total: 1, covered: 1, pct: 100 }, lines: { total: 2, covered: 2, pct: 100 } } }
            });

            const result = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1
            });

            expect(result.success).toBe(true);
            expect(fs.existsSync(deepTestFile)).toBe(false);
            expect(fs.existsSync(deepDir)).toBe(false);
            expect(fs.existsSync(path.join(tempDir, "tests", "unit", "nested"))).toBe(false);
            expect(fs.existsSync(path.join(tempDir, "tests", "unit"))).toBe(false);
            expect(fs.existsSync(path.join(tempDir, "tests"))).toBe(false);
            // Root project dir must be intact
            expect(fs.existsSync(tempDir)).toBe(true);
        });

        it("1.4: Gracefully rolls back zero-test baseline repositories without crashing on empty batches", async () => {
            // A repository with NO unit tests initially (only business source files)
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "core.js"), "module.exports = { core: () => 'ok' };", "utf8");

            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const generatedTest = path.join(testsDir, "core.test.js");
            const generatedContent = "// Generated unit test\ndescribe('core', () => {});";
            fs.writeFileSync(generatedTest, generatedContent, "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_v2_zero_baseline",
                files: [{
                    testFile: "tests/core.test.js",
                    sourceFile: "src/core.js",
                    originalContent: null,
                    updatedContent: generatedContent,
                    framework: "jest"
                }],
                verification: { valid: true },
                coverage: { total: { statements: { total: 10, covered: 10, pct: 100 }, branches: { total: 0, covered: 0, pct: 100 }, functions: { total: 1, covered: 1, pct: 100 }, lines: { total: 10, covered: 10, pct: 100 } } }
            });

            // Now, rollback to Version 1 (Baseline)
            // Since there were NO tests originally, deleting tests/core.test.js leaves 0 tests in the project.
            const result = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1
            });

            expect(result.success).toBe(true);
            expect(result.targetVersion).toBe(1);
            expect(fs.existsSync(generatedTest)).toBe(false);

            // Verify synthesis of 0% baseline coverage in manifest and database
            const manifest = loadManifest({ snapshotId, rootDir: tempDir });
            expect(manifest.activeBatchId).toBeNull();
            expect(manifest.lastVerification.coverage.statements.pct).toBe(0);
            expect(manifest.lastVerification.coverage.lines.pct).toBe(0);

            // Verify database coverage summary upsert with 0%
            expect(mockPrisma.coverageSummary.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { snapshotId },
                update: expect.objectContaining({ stmtsPct: 0, linesPct: 0, branchesPct: 0, funcsPct: 0 })
            }));
        });
    });

    describe("2. Historical Batch Rollbacks (Reverting to v2 when on v3)", () => {
        it("2.1: Correctly restores intermediate batch state: restores v2 file, keeps v2 file, unlinks v3-only file", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            const deepDir = path.join(testsDir, "nested");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(deepDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "a.js"), "module.exports = { a: 1 };", "utf8");
            fs.writeFileSync(path.join(srcDir, "b.js"), "module.exports = { b: 2 };", "utf8");
            fs.writeFileSync(path.join(srcDir, "c.js"), "module.exports = { c: 3 };", "utf8");

            const aBaseline = "// File A Baseline\ndescribe('a', () => {});";
            const aV2 = "// File A Version 2\ndescribe('a v2', () => {});";
            const aV3 = "// File A Version 3\ndescribe('a v3', () => {});";

            const bV2 = "// File B Version 2 (Created in v2)\ndescribe('b v2', () => {});";

            const cV3 = "// File C Version 3 (Created in v3)\ndescribe('c v3', () => {});";

            const fileAPath = path.join(testsDir, "a.test.js");
            const fileBPath = path.join(testsDir, "b.test.js");
            const fileCPath = path.join(deepDir, "c.test.js");

            // Baseline: only a.test.js exists
            fs.writeFileSync(fileAPath, aBaseline, "utf8");

            // Apply Batch Version 2: updates a.test.js and creates b.test.js
            fs.writeFileSync(fileAPath, aV2, "utf8");
            fs.writeFileSync(fileBPath, bV2, "utf8");

            const batch2 = saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_batch_2",
                files: [
                    { testFile: "tests/a.test.js", sourceFile: "src/a.js", originalContent: aBaseline, updatedContent: aV2, framework: "jest" },
                    { testFile: "tests/b.test.js", sourceFile: "src/b.js", originalContent: null, updatedContent: bV2, framework: "jest" }
                ],
                verification: { valid: true },
                coverage: { total: { statements: { total: 20, covered: 15, pct: 75.0 }, branches: { total: 10, covered: 7, pct: 70.0 }, functions: { total: 5, covered: 4, pct: 80.0 }, lines: { total: 20, covered: 15, pct: 75.0 } } }
            });
            expect(batch2.version).toBe(2);

            // Apply Batch Version 3: updates a.test.js again and creates c.test.js in nested dir
            fs.writeFileSync(fileAPath, aV3, "utf8");
            fs.writeFileSync(fileCPath, cV3, "utf8");

            const batch3 = saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_batch_3",
                files: [
                    { testFile: "tests/a.test.js", sourceFile: "src/a.js", originalContent: aBaseline, updatedContent: aV3, framework: "jest" },
                    { testFile: "tests/nested/c.test.js", sourceFile: "src/c.js", originalContent: null, updatedContent: cV3, framework: "jest" }
                ],
                verification: { valid: true },
                coverage: { total: { statements: { total: 30, covered: 27, pct: 90.0 }, branches: { total: 15, covered: 13, pct: 86.6 }, functions: { total: 8, covered: 7, pct: 87.5 }, lines: { total: 30, covered: 27, pct: 90.0 } } }
            });
            expect(batch3.version).toBe(3);

            // Verify current state is Version 3
            let currentManifest = loadManifest({ snapshotId, rootDir: tempDir });
            expect(currentManifest.activeBatchId).toBe("batch_run_batch_3");
            expect(fs.readFileSync(fileAPath, "utf8")).toBe(aV3);
            expect(fs.readFileSync(fileBPath, "utf8")).toBe(bV2);
            expect(fs.readFileSync(fileCPath, "utf8")).toBe(cV3);

            // Now: Bulk rollback to Version 2!
            runnerCoverageOverride = {
                total: {
                    statements: { total: 20, covered: 15, pct: 75.0 },
                    branches: { total: 10, covered: 7, pct: 70.0 },
                    functions: { total: 5, covered: 4, pct: 80.0 },
                    lines: { total: 20, covered: 15, pct: 75.0 }
                }
            };

            const revertResult = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 2
            });

            expect(revertResult.success).toBe(true);
            expect(revertResult.targetVersion).toBe(2);

            // Invariant 1: file a.test.js restored to v2 content (NOT baseline, NOT v3)
            expect(fs.readFileSync(fileAPath, "utf8")).toBe(aV2);

            // Invariant 2: file b.test.js maintained at v2 content
            expect(fs.readFileSync(fileBPath, "utf8")).toBe(bV2);

            // Invariant 3: file c.test.js (introduced only in v3) unlinked from disk
            expect(fs.existsSync(fileCPath)).toBe(false);

            // Invariant 4: empty parent directory tests/nested cleaned up
            expect(fs.existsSync(deepDir)).toBe(false);

            // Invariant 5: Manifest active batch updated to batch 2
            const manifestAfterRevert = loadManifest({ snapshotId, rootDir: tempDir });
            expect(manifestAfterRevert.activeBatchId).toBe("batch_run_batch_2");
            expect(manifestAfterRevert.files["tests/a.test.js"].currentVersion).toBe(2);
            expect(manifestAfterRevert.files["tests/b.test.js"].currentVersion).toBe(2);
            expect(manifestAfterRevert.files["tests/nested/c.test.js"].currentVersion).toBe(1);
        });
    });

    describe("3. Source Business Logic Files Immutability", () => {
        it("3.1: Proves source business logic files are strictly unchanged via computeSourceFilesHash", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            const srcFile1 = path.join(srcDir, "auth.js");
            const srcFile2 = path.join(srcDir, "order.js");
            fs.writeFileSync(srcFile1, "export const auth = () => true;", "utf8");
            fs.writeFileSync(srcFile2, "export const order = () => ({ total: 100 });", "utf8");

            const initialSourceHash = computeSourceFilesHash(tempDir);
            expect(initialSourceHash._hasIntegrityError).toBeFalsy();
            expect(initialSourceHash._compositeHash).toBeTruthy();

            const testFile = path.join(testsDir, "auth.test.js");
            fs.writeFileSync(testFile, "// Test v2\ndescribe('auth', () => {});", "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_source_immutability",
                files: [{
                    testFile: "tests/auth.test.js",
                    sourceFile: "src/auth.js",
                    originalContent: null,
                    updatedContent: "// Test v2\ndescribe('auth', () => {});",
                    framework: "jest"
                }],
                verification: { valid: true },
                coverage: { total: { statements: { total: 10, covered: 8, pct: 80 }, branches: { total: 2, covered: 2, pct: 100 }, functions: { total: 2, covered: 2, pct: 100 }, lines: { total: 10, covered: 8, pct: 80 } } }
            });

            // Bulk revert to baseline
            const rollbackResult = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1
            });

            expect(rollbackResult.success).toBe(true);

            // Recompute source file hash after rollback
            const postRollbackSourceHash = computeSourceFilesHash(tempDir);
            expect(postRollbackSourceHash._compositeHash).toBe(initialSourceHash._compositeHash);

            const verification = verifySourceFilesUnchanged(tempDir, initialSourceHash);
            expect(verification.intact).toBe(true);
        });

        it("3.2: Fails closed and blocks rollback if source files are modified during test verification", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            const srcFile = path.join(srcDir, "logic.js");
            fs.writeFileSync(srcFile, "module.exports = { original: true };", "utf8");

            const testFile = path.join(testsDir, "logic.test.js");
            fs.writeFileSync(testFile, "// Baseline\ndescribe('logic', () => {});", "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_tamper_test",
                files: [{
                    testFile: "tests/logic.test.js",
                    sourceFile: "src/logic.js",
                    originalContent: "// Baseline\ndescribe('logic', () => {});",
                    updatedContent: "// Modified\ndescribe('logic modified', () => {});",
                    framework: "jest"
                }],
                verification: { valid: true },
                coverage: { total: { statements: { total: 5, covered: 4, pct: 80 }, branches: { total: 0, covered: 0, pct: 100 }, functions: { total: 1, covered: 1, pct: 100 }, lines: { total: 5, covered: 4, pct: 80 } } }
            });

            // Simulate hostile test execution mutating a source file during the runUnitTestBatch step
            runnerBehaviorHook = () => {
                fs.writeFileSync(srcFile, "module.exports = { TAMPERED: true };", "utf8");
            };

            const result = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1
            });

            // Must reject the rollback and keep active version unchanged
            expect(result.success).toBe(false);
            expect(result.status).toBe("FAILED");
            expect(result.message).toContain("failed verification; the active version is unchanged");
        });
    });

    describe("4. Database Records Update with Recalculated Metrics", () => {
        it("4.1: Persists recalculated CoverageSummary and CoverageFile rows during bulk rollback", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "metric.js"), "module.exports = { m: 1 };", "utf8");
            const testFile = path.join(testsDir, "metric.test.js");
            fs.writeFileSync(testFile, "// Baseline\ndescribe('m', () => {});", "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_metric_v2",
                files: [{
                    testFile: "tests/metric.test.js",
                    sourceFile: "src/metric.js",
                    originalContent: "// Baseline\ndescribe('m', () => {});",
                    updatedContent: "// Updated\ndescribe('m v2', () => {});",
                    framework: "jest"
                }],
                verification: { valid: true },
                coverage: { total: { statements: { total: 10, covered: 9, pct: 90.0 }, branches: { total: 4, covered: 4, pct: 100.0 }, functions: { total: 2, covered: 2, pct: 100.0 }, lines: { total: 10, covered: 9, pct: 90.0 } } }
            });

            // Setup mock runner returning baseline coverage (e.g. 50%)
            runnerCoverageOverride = {
                total: {
                    statements: { total: 10, covered: 5, pct: 50.0 },
                    branches: { total: 4, covered: 2, pct: 50.0 },
                    functions: { total: 2, covered: 1, pct: 50.0 },
                    lines: { total: 10, covered: 5, pct: 50.0 }
                },
                "src/metric.js": {
                    statements: { total: 10, covered: 5, pct: 50.0 },
                    branches: { total: 4, covered: 2, pct: 50.0 },
                    functions: { total: 2, covered: 1, pct: 50.0 },
                    lines: { total: 10, covered: 5, pct: 50.0 }
                }
            };

            const result = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1
            });

            expect(result.success).toBe(true);

            // Invariant: prisma.coverageSummary.upsert called with recalculated metrics
            expect(mockPrisma.coverageSummary.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { snapshotId },
                update: {
                    stmtsPct: 50.0,
                    branchesPct: 50.0,
                    funcsPct: 50.0,
                    linesPct: 50.0
                }
            }));

            // Invariant: prisma.coverageFile.upsert called with canonical path and metrics
            expect(mockPrisma.coverageFile.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { snapshotId_filePath: { snapshotId, filePath: "src/metric.js" } },
                update: {
                    stmtsPct: 50.0,
                    branchesPct: 50.0,
                    funcsPct: 50.0,
                    linesPct: 50.0
                }
            }));
        });

        it("4.2: switchUnitTestVersionController returns HTTP 200 with refreshed coverage payload", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "service.js"), "module.exports = {};", "utf8");
            fs.writeFileSync(path.join(testsDir, "service.test.js"), "// Test\ndescribe('s', () => {});", "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_ctrl_test",
                files: [{
                    testFile: "tests/service.test.js",
                    sourceFile: "src/service.js",
                    originalContent: "// Baseline",
                    updatedContent: "// Test",
                    framework: "jest"
                }],
                verification: { valid: true },
                coverage: { total: { statements: { total: 10, covered: 10, pct: 100 }, branches: { total: 2, covered: 2, pct: 100 }, functions: { total: 1, covered: 1, pct: 100 }, lines: { total: 10, covered: 10, pct: 100 } } }
            });

            runnerCoverageOverride = {
                total: {
                    statements: { total: 10, covered: 6, pct: 60.0 },
                    branches: { total: 2, covered: 1, pct: 50.0 },
                    functions: { total: 1, covered: 1, pct: 100.0 },
                    lines: { total: 10, covered: 6, pct: 60.0 }
                }
            };

            const req = {
                user: { id: userId },
                params: { snapshotId },
                body: {
                    allFiles: true,
                    targetVersion: 1
                }
            };

            let responseStatus = null;
            let responseBody = null;
            const res = {
                status: (code) => {
                    responseStatus = code;
                    return {
                        json: (data) => {
                            responseBody = data;
                            return data;
                        }
                    };
                }
            };

            await switchUnitTestVersionController(req, res);

            expect(responseStatus).toBe(200);
            expect(responseBody.success).toBe(true);
            expect(responseBody.targetVersion).toBe(1);
            expect(responseBody.message).toContain("Successfully reverted all files to Version 1 (Baseline)");
            expect(responseBody.coverage).toBeDefined();
            expect(responseBody.coverage.statements.pct).toBe(60.0);
            expect(responseBody.coverage.lines.pct).toBe(60.0);
        });
    });

    describe("5. Adversarial Edge Cases & Boundary Conditions", () => {
        it("5.1: Non-existent version throws 409 conflict error", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "edge.js"), "module.exports = {};", "utf8");
            fs.writeFileSync(path.join(testsDir, "edge.test.js"), "// Edge test", "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_edge_nonexistent",
                files: [{
                    testFile: "tests/edge.test.js",
                    sourceFile: "src/edge.js",
                    originalContent: "// Baseline",
                    updatedContent: "// Edge test",
                    framework: "jest"
                }],
                verification: { valid: true },
                coverage: { total: { statements: { total: 10, covered: 10, pct: 100 }, branches: { total: 0, covered: 0, pct: 100 }, functions: { total: 1, covered: 1, pct: 100 }, lines: { total: 10, covered: 10, pct: 100 } } }
            });

            await expect(switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 999 // Does not exist
            })).rejects.toThrow(/The selected version has no verified batch manifest/);
        });

        it("5.2: String-typed version inputs (e.g. targetVersion: '1') parse and work correctly", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            const baseline = "// Baseline string test";
            const updated = "// Updated string test";
            const testPath = path.join(testsDir, "str.test.js");
            fs.writeFileSync(testPath, baseline, "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_str_ver",
                files: [{
                    testFile: "tests/str.test.js",
                    sourceFile: "src/str.js",
                    originalContent: baseline,
                    updatedContent: updated,
                    framework: "jest"
                }],
                verification: { valid: true },
                coverage: { total: { statements: { total: 5, covered: 5, pct: 100 }, branches: { total: 0, covered: 0, pct: 100 }, functions: { total: 1, covered: 1, pct: 100 }, lines: { total: 5, covered: 5, pct: 100 } } }
            });

            fs.writeFileSync(testPath, updated, "utf8");

            const result = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: "1" // String '1'
            });

            expect(result.success).toBe(true);
            expect(result.targetVersion).toBe(1);
            expect(fs.readFileSync(testPath, "utf8")).toBe(baseline);
        });

        it("5.3: Path traversal attempts in manifest testFile throw 400", async () => {
            const manifest = {
                snapshotId,
                projectId,
                schemaVersion: 2,
                activeBatchId: "batch_malicious",
                files: {
                    "../../outside.test.js": {
                        sourceFile: "src/outside.js",
                        testFile: "../../outside.test.js",
                        framework: "jest",
                        currentVersion: 2,
                        baseline: { exists: false, content: "" },
                        versions: [
                            { version: 1, type: "ORIGINAL", content: "", isActive: false },
                            { version: 2, type: "APPLIED", content: "// hacked", isActive: true }
                        ]
                    }
                },
                batches: [{
                    batchId: "batch_malicious",
                    version: 2,
                    fileVersions: { "../../outside.test.js": "v2_mal" }
                }]
            };

            const versionsDir = path.join(tempDir, VERSIONS_DIR_NAME);
            fs.mkdirSync(versionsDir, { recursive: true });
            fs.writeFileSync(path.join(versionsDir, MANIFEST_FILE_NAME), JSON.stringify(manifest), "utf8");

            await expect(switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1
            })).rejects.toThrow(/Invalid versioned test file/);
        });

        it("5.4: Missing both filePath and allFiles returns HTTP 400 from controller", async () => {
            const req = {
                user: { id: userId },
                params: { snapshotId },
                body: {
                    targetVersion: 1
                    // Neither filePath nor allFiles provided
                }
            };

            let responseStatus = null;
            let responseBody = null;
            const res = {
                status: (code) => {
                    responseStatus = code;
                    return {
                        json: (data) => {
                            responseBody = data;
                            return data;
                        }
                    };
                }
            };

            await switchUnitTestVersionController(req, res);

            expect(responseStatus).toBe(400);
            expect(responseBody.success).toBe(false);
            expect(responseBody.message).toContain("Either filePath or allFiles: true is required");
        });

        it("5.5: Expired test artifact in batch manifest throws 410 error", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "exp.js"), "module.exports = {};", "utf8");
            fs.writeFileSync(path.join(testsDir, "exp.test.js"), "// Exp test", "utf8");

            const manifest = {
                snapshotId,
                projectId,
                schemaVersion: 2,
                activeBatchId: "batch_exp",
                files: {
                    "tests/exp.test.js": {
                        sourceFile: "src/exp.js",
                        testFile: "tests/exp.test.js",
                        framework: "jest",
                        currentVersion: 2,
                        baseline: { exists: false, content: "" },
                        versions: [
                            { version: 1, versionId: "v1_exp", type: "ORIGINAL", content: "", isActive: false }
                            // Missing version record corresponding to batch's fileVersions!
                        ]
                    }
                },
                batches: [{
                    batchId: "batch_exp",
                    version: 2,
                    fileVersions: { "tests/exp.test.js": "v2_nonexistent_versionId" }
                }]
            };

            const versionsDir = path.join(tempDir, VERSIONS_DIR_NAME);
            fs.mkdirSync(versionsDir, { recursive: true });
            fs.writeFileSync(path.join(versionsDir, MANIFEST_FILE_NAME), JSON.stringify(manifest), "utf8");

            await expect(switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 2
            })).rejects.toThrow(/A test artifact in this version has expired/);
        });

        it("5.6: Idempotent bulk rollback: calling rollback to baseline consecutively succeeds without errors", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "idem.js"), "module.exports = { val: 1 };", "utf8");
            const baseline = "// Baseline idem";
            const updated = "// Updated idem";
            const testPath = path.join(testsDir, "idem.test.js");
            fs.writeFileSync(testPath, updated, "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_idem_1",
                files: [{
                    testFile: "tests/idem.test.js",
                    sourceFile: "src/idem.js",
                    originalContent: baseline,
                    updatedContent: updated,
                    framework: "jest"
                }],
                verification: { valid: true },
                coverage: { total: { statements: { total: 10, covered: 10, pct: 100 }, branches: { total: 2, covered: 2, pct: 100 }, functions: { total: 1, covered: 1, pct: 100 }, lines: { total: 10, covered: 10, pct: 100 } } }
            });

            // First rollback to baseline
            const res1 = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1
            });
            expect(res1.success).toBe(true);
            expect(fs.readFileSync(testPath, "utf8")).toBe(baseline);

            // Second rollback to baseline (already at baseline)
            const res2 = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1
            });
            expect(res2.success).toBe(true);
            expect(res2.targetVersion).toBe(1);
            expect(fs.readFileSync(testPath, "utf8")).toBe(baseline);
        });

        it("5.7: Sibling directory protection during nested directory cleanup", async () => {
            // tests/unit/dirA/testA.test.js (generated, to be unlinked)
            // tests/unit/dirB/testB.test.js (baseline, to be preserved)
            const dirA = path.join(tempDir, "tests", "unit", "dirA");
            const dirB = path.join(tempDir, "tests", "unit", "dirB");
            fs.mkdirSync(dirA, { recursive: true });
            fs.mkdirSync(dirB, { recursive: true });

            const testAPath = path.join(dirA, "testA.test.js");
            const testBPath = path.join(dirB, "testB.test.js");
            const testBContent = "// Preserved baseline test B";
            fs.writeFileSync(testAPath, "// Generated test A", "utf8");
            fs.writeFileSync(testBPath, testBContent, "utf8");

            saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "run_sibling_test",
                files: [
                    {
                        testFile: "tests/unit/dirA/testA.test.js",
                        sourceFile: "src/a.js",
                        originalContent: null, // New file
                        updatedContent: "// Generated test A",
                        framework: "jest"
                    },
                    {
                        testFile: "tests/unit/dirB/testB.test.js",
                        sourceFile: "src/b.js",
                        originalContent: testBContent, // Existing file
                        updatedContent: testBContent,
                        framework: "jest"
                    }
                ],
                verification: { valid: true },
                coverage: { total: { statements: { total: 10, covered: 10, pct: 100 }, branches: { total: 0, covered: 0, pct: 100 }, functions: { total: 2, covered: 2, pct: 100 }, lines: { total: 10, covered: 10, pct: 100 } } }
            });

            const result = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1
            });

            expect(result.success).toBe(true);
            // dirA and testA unlinked and pruned
            expect(fs.existsSync(testAPath)).toBe(false);
            expect(fs.existsSync(dirA)).toBe(false);
            // dirB and testB must remain intact!
            expect(fs.existsSync(dirB)).toBe(true);
            expect(fs.existsSync(testBPath)).toBe(true);
            expect(fs.readFileSync(testBPath, "utf8")).toBe(testBContent);
            // Parent tests/unit and tests must remain intact because dirB is still there!
            expect(fs.existsSync(path.join(tempDir, "tests", "unit"))).toBe(true);
            expect(fs.existsSync(path.join(tempDir, "tests"))).toBe(true);
        });
    });
});
