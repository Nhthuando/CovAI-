import fs from "fs";
import path from "path";
import os from "os";
import { describe, test, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

let currentTempDir = null;

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
    },
    $transaction: jest.fn(async (cb) => (typeof cb === "function" ? cb(mockPrisma) : cb))
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma
}));

const mockCreateRunTestsJob = jest.fn().mockResolvedValue({ id: "job_lifecycle_test" });
const mockAddJobToQueue = jest.fn().mockResolvedValue(true);

await jest.unstable_mockModule("../services/job.service.js", () => ({
    createRunTestsJob: mockCreateRunTestsJob,
    createAnalysisJob: jest.fn().mockResolvedValue({ id: "job_analysis" }),
    createSnapshotIngestJob: jest.fn().mockResolvedValue({ id: "job_ingest" }),
    markJobRunning: jest.fn().mockResolvedValue({}),
    markJobSuccess: jest.fn().mockResolvedValue({}),
    markJobFailed: jest.fn().mockResolvedValue({}),
    updateJobProgress: jest.fn().mockResolvedValue({}),
    getJobById: jest.fn().mockResolvedValue({ id: "job-1", status: "PENDING" }),
    addJobLog: jest.fn().mockResolvedValue({})
}));

await jest.unstable_mockModule("../services/queue.service.js", () => ({
    addJobToQueue: mockAddJobToQueue
}));

await jest.unstable_mockModule("../services/projectWorkspacePreparation.service.js", () => ({
    withPreparedProjectWorkspace: jest.fn(async (options, run) => run({
        rootDir: currentTempDir || os.tmpdir(),
        analysisRelative: ""
    }))
}));

await jest.unstable_mockModule("../services/unitTestBatchRunner.service.js", () => ({
    runUnitTestBatch: jest.fn(async ({ coverageDir, testFiles = [] }) => {
        fs.mkdirSync(coverageDir, { recursive: true });
        const testResults = testFiles.map(tf => ({
            name: path.resolve(currentTempDir || os.tmpdir(), tf),
            status: "passed",
            assertionResults: [{ status: "passed", title: "baseline" }]
        }));
        fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
            success: true,
            numFailedTestSuites: 0,
            testResults
        }), "utf8");
        fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify({
            total: {
                statements: { total: 10, covered: 5, pct: 50.0 },
                branches: { total: 10, covered: 5, pct: 50.0 },
                functions: { total: 10, covered: 5, pct: 50.0 },
                lines: { total: 10, covered: 5, pct: 50.0 }
            }
        }), "utf8");
        return { exitCode: 0, stdout: "PASS", stderr: "" };
    })
}));

await jest.unstable_mockModule("../services/dependencyInstallation.service.js", () => ({
    dependencyInstallationService: { install: jest.fn(async () => ({ success: true, installed: true, stdout: "", stderr: "" })) }
}));

const mockAiResponse = JSON.stringify({
    explanation: "Generated unit tests covering uncovered branches and logic",
    suggestedTestCode: `describe('orderService', () => {
    test('calculateTotal with tax', () => {
        const { calculateTotal } = require('../src/services/order.service');
        expect(calculateTotal(100, 0.1)).toBe(110);
    });
    test('calculateTotal without tax', () => {
        const { calculateTotal } = require('../src/services/order.service');
        expect(calculateTotal(100, 0)).toBe(100);
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

const {
    suggestUnitTestcases
} = await import("../services/unitTestSuggestion.service.js");

const {
    applyUnitTestSuggestion
} = await import("../services/applyTestSuggestion.service.js");

const {
    saveUnitTestFileVersions,
    saveVerifiedUnitTestBatch,
    getUnitTestVersions,
    switchUnitTestVersion,
    clearManifestCache,
    removeEmptyParentsRecursively,
    VERSIONS_DIR_NAME,
    MANIFEST_FILE_NAME
} = await import("../services/unitTestVersion.service.js");

const {
    buildTree
} = await import("../services/project.service.js");

describe("Unit Test Version History Lifecycle, File Persistence, and Rollback", () => {
    let tempDir;
    const snapshotId = "snap-lifecycle-001";
    const projectId = "proj-lifecycle-001";
    const userId = "user-lifecycle-001";

    beforeEach(() => {
        clearManifestCache();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-lifecycle-test-"));
        currentTempDir = tempDir;
        jest.clearAllMocks();

        const mockSnapshot = {
            id: snapshotId,
            projectId,
            rootDir: tempDir,
            coverageSummaries: []
        };
        mockPrisma.project.findFirst.mockResolvedValue({ id: projectId, ownerId: userId, name: "Lifecycle Project", snapshots: [mockSnapshot] });
        mockPrisma.project.findUnique.mockResolvedValue({ id: projectId, ownerId: userId, name: "Lifecycle Project", snapshots: [mockSnapshot] });
        mockPrisma.projectMember.findUnique.mockResolvedValue({ role: "OWNER" });
        mockPrisma.projectSnapshot.findFirst.mockResolvedValue(mockSnapshot);
        mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
            ...mockSnapshot,
            project: { id: projectId, ownerId: userId }
        });
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    describe("R3: Version History Creation Timing Invariants", () => {
        it("does NOT create version records in manifest.json during suggestion generation (Stage 2)", async () => {
            // Setup source file
            const srcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            const sourceFilePath = path.join(srcDir, "order.service.js");
            fs.writeFileSync(
                sourceFilePath,
                `function calculateTotal(price, tax) {
                    if (tax > 0) return price + (price * tax);
                    return price;
                }
                module.exports = { calculateTotal };`,
                "utf8"
            );

            mockPrisma.coverageFile.findMany.mockResolvedValue([
                {
                    filePath: "src/services/order.service.js",
                    stmtsPct: 50,
                    branchesPct: 50,
                    funcsPct: 100,
                    linesPct: 50
                }
            ]);

            // Call suggestUnitTestcases
            const suggestion = await suggestUnitTestcases({
                projectId,
                snapshotId,
                filePath: "src/services/order.service.js",
                userId,
                framework: "jest"
            });

            expect(suggestion).toBeDefined();
            expect(suggestion.suggestedTestCode).toBeDefined();

            // INVARIANT: Suggestion generation is proposal-only.
            // No version record or manifest file should exist on disk!
            const manifestPath = path.join(tempDir, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME);
            expect(fs.existsSync(manifestPath)).toBe(false);

            const versions = getUnitTestVersions({ snapshotId, rootDir: tempDir });
            expect(Object.keys(versions)).toHaveLength(0);
        });

        it("creates version records ONLY after test suggestion apply and runner verification complete", async () => {
            const srcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            const sourceFilePath = path.join(srcDir, "order.service.js");
            fs.writeFileSync(
                sourceFilePath,
                `function calculateTotal(price, tax) {
                    if (tax > 0) return price + (price * tax);
                    return price;
                }
                module.exports = { calculateTotal };`,
                "utf8"
            );

            mockPrisma.coverageFile.findMany.mockResolvedValue([
                {
                    filePath: "src/services/order.service.js",
                    stmtsPct: 50,
                    branchesPct: 50,
                    funcsPct: 100,
                    linesPct: 50
                }
            ]);

            const suggestion = await suggestUnitTestcases({
                projectId,
                snapshotId,
                filePath: "src/services/order.service.js",
                userId,
                framework: "jest"
            });

            // Before apply: no version records
            expect(fs.existsSync(path.join(tempDir, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME))).toBe(false);

            // Apply suggestion with verified runner output
            const applyResult = await applyUnitTestSuggestion({
                snapshotId,
                projectId,
                userId,
                suggestion,
                runCoverageFn: async ({ coverageDir }) => {
                    const sumData = {
                        "src/services/order.service.js": {
                            statements: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            branches: { total: 2, covered: 2, skipped: 0, pct: 100 },
                            functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
                            lines: { total: 10, covered: 10, skipped: 0, pct: 100 }
                        },
                        total: {
                            statements: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            branches: { total: 2, covered: 2, skipped: 0, pct: 100 },
                            functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
                            lines: { total: 10, covered: 10, skipped: 0, pct: 100 }
                        }
                    };
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify(sumData), "utf8");
                    const unitDir = path.join(coverageDir, "unit");
                    fs.mkdirSync(unitDir, { recursive: true });
                    fs.writeFileSync(path.join(unitDir, "coverage-summary.json"), JSON.stringify(sumData), "utf8");
                    const testResultsData = {
                        success: true,
                        numFailedTestSuites: 0,
                        numPassedTestSuites: 1,
                        testResults: [
                            {
                                name: path.join(tempDir, "tests/services/order.service.test.js"),
                                status: "passed",
                                assertionResults: [
                                    { status: "passed", title: "calculateTotal with tax" },
                                    { status: "passed", title: "calculateTotal without tax" }
                                ]
                            }
                        ]
                    };
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify(testResultsData), "utf8");
                    fs.writeFileSync(path.join(unitDir, "test-results.json"), JSON.stringify(testResultsData), "utf8");
                    return {
                        success: true,
                        exitCode: 0,
                        numTotalTests: 2,
                        numPassedTests: 2,
                        numFailedTests: 0,
                        totalTests: 2,
                        passedTests: 2,
                        failedTests: 0,
                        ...testResultsData
                    };
                }
            });

            expect(applyResult.success).toBe(true);
            expect(applyResult.status).toBe("PASSED");

            // INVARIANT: Manifest is now written to disk after verification
            const manifestPath = path.join(tempDir, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME);
            expect(fs.existsSync(manifestPath)).toBe(true);

            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            expect(manifest.files).toBeDefined();

            const fileKeys = Object.keys(manifest.files);
            expect(fileKeys.length).toBeGreaterThanOrEqual(1);

            const fileRecord = manifest.files[fileKeys[0]];
            expect(fileRecord.currentVersion).toBe(2);
            expect(fileRecord.isNewFile).toBe(true);
            expect(fileRecord.versions).toHaveLength(2);

            const [v1, v2] = fileRecord.versions;
            expect(v1.version).toBe(1);
            expect(v1.status).toBe("BASELINE");
            expect(v1.content).toBe("");
            expect(v1.isActive).toBe(false);

            expect(v2.version).toBe(2);
            expect(v2.status).toBe("APPLIED");
            expect(v2.isActive).toBe(true);

            // Verify v2 content matches the actual disk content
            const testDiskPath = path.join(tempDir, fileRecord.testFile);
            expect(fs.existsSync(testDiskPath)).toBe(true);
            const actualDiskContent = fs.readFileSync(testDiskPath, "utf8");
            expect(v2.content).toBe(actualDiskContent);
        });
    });

    describe("R2: Baseline Version 1 Rollback Semantics", () => {
        it("unlinks generated test files and recursively prunes empty parent test directories on zero-test repos", async () => {
            // Setup empty repo with only source code (0 test files)
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "user.js"), "module.exports = {};", "utf8");

            // AI suggestion generates a nested test file: tests/unit/services/user.test.js
            const testRelPath = "tests/unit/services/user.test.js";
            const fullTestPath = path.join(tempDir, testRelPath);
            fs.mkdirSync(path.dirname(fullTestPath), { recursive: true });
            fs.writeFileSync(fullTestPath, "describe('user', () => { it('works', () => {}); });", "utf8");

            // Save version record as APPLIED
            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/user.js",
                testFile: testRelPath,
                originalContent: "",
                updatedContent: fs.readFileSync(fullTestPath, "utf8"),
                framework: "jest",
                summary: "Applied unit tests",
                isExisting: false,
                status: "APPLIED"
            });

            // Confirm test file and directory structure exists
            expect(fs.existsSync(fullTestPath)).toBe(true);
            expect(fs.existsSync(path.join(tempDir, "tests", "unit", "services"))).toBe(true);

            // Roll back to Version 1 (Baseline)
            const switchResult = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                targetVersion: 1,
                allFiles: true,
                runTests: true
            });

            expect(switchResult.success).toBe(true);
            expect(switchResult.switchedCount).toBe(1);

            // INVARIANT: Generated test file must be deleted from disk
            expect(fs.existsSync(fullTestPath)).toBe(false);

            // INVARIANT: Empty parent test directories must be pruned recursively up to tempDir
            expect(fs.existsSync(path.join(tempDir, "tests", "unit", "services"))).toBe(false);
            expect(fs.existsSync(path.join(tempDir, "tests", "unit"))).toBe(false);
            expect(fs.existsSync(path.join(tempDir, "tests"))).toBe(false);

            // Root directory and user source directory must remain intact
            expect(fs.existsSync(srcDir)).toBe(true);
            expect(fs.existsSync(path.join(srcDir, "user.js"))).toBe(true);

            // File Explorer tree inspection:
            // buildTree must return 0 test files and NO tests folder
            const tree = buildTree(tempDir);
            const testNodes = tree.filter(n => n.name === "tests" || n.name.includes("test"));
            expect(testNodes).toHaveLength(0);

            // .covai_test_versions must also be filtered from tree
            const covaiNodes = tree.filter(n => n.name.startsWith(".covai"));
            expect(covaiNodes).toHaveLength(0);
        });

        it("restores original baseline content and discards subsequent generated test files on pre-existing test repos", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "calc.js"), "module.exports = { add: (a,b) => a+b };", "utf8");

            // Pre-existing test file with baseline content
            const existingTestPath = path.join(testsDir, "calc.test.js");
            const baselineContent = "// Baseline Calc Tests\ndescribe('calc', () => { it('adds', () => expect(1+1).toBe(2)); });";
            fs.writeFileSync(existingTestPath, baselineContent, "utf8");

            // Simulate applying an update to calc.test.js
            const updatedCalcContent = `${baselineContent}\ndescribe('calc extended', () => { it('handles 0', () => {}); });`;
            fs.writeFileSync(existingTestPath, updatedCalcContent, "utf8");

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                originalContent: baselineContent,
                updatedContent: updatedCalcContent,
                framework: "jest",
                summary: "Extended existing calc test suite",
                isExisting: true,
                status: "APPLIED"
            });

            // Simulate applying an entirely new test file: tests/extra.test.js
            const extraTestPath = path.join(testsDir, "extra.test.js");
            const extraContent = "describe('extra', () => { it('runs', () => {}); });";
            fs.writeFileSync(extraTestPath, extraContent, "utf8");

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/extra.js",
                testFile: "tests/extra.test.js",
                originalContent: "",
                updatedContent: extraContent,
                framework: "jest",
                summary: "New extra test suite",
                isExisting: false,
                status: "APPLIED"
            });

            expect(fs.existsSync(existingTestPath)).toBe(true);
            expect(fs.existsSync(extraTestPath)).toBe(true);

            // Rollback all files to Version 1 (Baseline)
            const switchResult = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                targetVersion: 1,
                allFiles: true,
                runTests: true
            });

            expect(switchResult.success).toBe(true);
            expect(switchResult.switchedCount).toBe(2);

            // INVARIANT 1: Pre-existing test file restored to exact baseline content
            expect(fs.existsSync(existingTestPath)).toBe(true);
            const restoredContent = fs.readFileSync(existingTestPath, "utf8");
            expect(restoredContent).toBe(baselineContent);
            expect(restoredContent).not.toContain("calc extended");

            // INVARIANT 2: Subsequent generated test file unlinked and deleted from disk
            expect(fs.existsSync(extraTestPath)).toBe(false);

            // INVARIANT 3: tests directory preserved because calc.test.js is still there
            expect(fs.existsSync(testsDir)).toBe(true);

            // File Explorer tree reflection
            const tree = buildTree(tempDir);
            const testsFolder = tree.find(n => n.name === "tests");
            expect(testsFolder).toBeDefined();
            expect(testsFolder.children.some(c => c.name === "calc.test.js")).toBe(true);
            expect(testsFolder.children.some(c => c.name === "extra.test.js")).toBe(false);
        });

        it("handles monorepo subpackage paths when restoring pre-existing baseline test files", async () => {
            // Setup monorepo layout:
            // tempDir (workspaceRoot) -> backend/tests/db.test.js
            const backendDir = path.join(tempDir, "backend");
            const backendTestsDir = path.join(backendDir, "tests");
            fs.mkdirSync(backendTestsDir, { recursive: true });

            const baselineDbTestContent = "// Monorepo Baseline DB Test\ndescribe('db', () => {});";
            const dbTestPath = path.join(backendTestsDir, "db.test.js");
            fs.writeFileSync(dbTestPath, baselineDbTestContent, "utf8");

            // Analysis snapshot rootDir is backend/
            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: snapshotId,
                projectId,
                rootDir: backendDir,
                storagePath: tempDir
            });

            const modifiedContent = `${baselineDbTestContent}\n// AI additions`;
            fs.writeFileSync(dbTestPath, modifiedContent, "utf8");

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: backendDir,
                projectId,
                sourceFile: "backend/src/db.js",
                testFile: "backend/tests/db.test.js",
                originalContent: baselineDbTestContent,
                updatedContent: modifiedContent,
                framework: "jest",
                summary: "Updated monorepo test",
                isExisting: true,
                status: "APPLIED"
            });

            // Rollback to Version 1
            const switchResult = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                targetVersion: 1,
                allFiles: true,
                runTests: true
            });

            expect(switchResult.success).toBe(true);
            expect(fs.existsSync(dbTestPath)).toBe(true);
            expect(fs.readFileSync(dbTestPath, "utf8")).toBe(baselineDbTestContent);
        });
    });

    describe("removeEmptyParentsRecursively unit behavior", () => {
        it("stops removing directories when reaching stopDirs", () => {
            const nestedDir = path.join(tempDir, "a", "b", "c");
            fs.mkdirSync(nestedDir, { recursive: true });
            const dummyFile = path.join(nestedDir, "test.js");
            fs.writeFileSync(dummyFile, "dummy", "utf8");

            fs.unlinkSync(dummyFile);
            removeEmptyParentsRecursively(dummyFile, [tempDir]);

            expect(fs.existsSync(nestedDir)).toBe(false);
            expect(fs.existsSync(path.join(tempDir, "a", "b"))).toBe(false);
            expect(fs.existsSync(path.join(tempDir, "a"))).toBe(false);
            expect(fs.existsSync(tempDir)).toBe(true);
        });

        it("stops removing directories when a sibling file exists in a parent folder", () => {
            const parentDir = path.join(tempDir, "tests");
            const childDir = path.join(parentDir, "unit");
            fs.mkdirSync(childDir, { recursive: true });

            const targetFile = path.join(childDir, "deleted.test.js");
            const siblingFile = path.join(parentDir, "keepMe.test.js");
            fs.writeFileSync(targetFile, "deleted", "utf8");
            fs.writeFileSync(siblingFile, "keep", "utf8");

            fs.unlinkSync(targetFile);
            removeEmptyParentsRecursively(targetFile, [tempDir]);

            expect(fs.existsSync(childDir)).toBe(false);
            expect(fs.existsSync(parentDir)).toBe(true);
            expect(fs.existsSync(siblingFile)).toBe(true);
        });
    });

    describe("R2 & R3: Bulk Version Rollback to Baseline (Version 1) Full Lifecycle", () => {
        it("applies a verified batch (Version 2) and bulk reverts to Version 1 (Baseline) with test verification and metric recalculation", async () => {
            // 1. Setup repository layout: 2 source files, 1 pre-existing baseline test
            const srcDir = path.join(tempDir, "src", "services");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "auth.service.js"), "module.exports = { login: () => true };", "utf8");
            fs.writeFileSync(path.join(srcDir, "payment.service.js"), "module.exports = { charge: () => true };", "utf8");

            const existingTestPath = path.join(testsDir, "auth.test.js");
            const baselineTestContent = "// Baseline Auth Test v1\ndescribe('auth', () => { it('baseline', () => {}); });";
            fs.writeFileSync(existingTestPath, baselineTestContent, "utf8");

            // Initial baseline coverage in database
            mockPrisma.coverageSummary.findUnique.mockResolvedValue({
                snapshotId,
                stmtsPct: 50.0,
                branchesPct: 50.0,
                funcsPct: 50.0,
                linesPct: 50.0
            });

            // 2. Apply a batch of suggestions (moves project to Version 2)
            const updatedAuthContent = `${baselineTestContent}\n// v2 enhanced`;
            const newPaymentTestPath = path.join(testsDir, "payment.test.js");
            const newPaymentContent = "// Brand new payment test v2\ndescribe('payment', () => { it('charges', () => {}); });";

            fs.writeFileSync(existingTestPath, updatedAuthContent, "utf8");
            fs.writeFileSync(newPaymentTestPath, newPaymentContent, "utf8");

            const v2Batch = saveVerifiedUnitTestBatch({
                snapshotId,
                rootDir: tempDir,
                projectId,
                runId: "lifecycle_batch_run_001",
                files: [
                    {
                        testFile: "tests/auth.test.js",
                        sourceFile: "src/services/auth.service.js",
                        originalContent: baselineTestContent,
                        updatedContent: updatedAuthContent,
                        framework: "jest"
                    },
                    {
                        testFile: "tests/payment.test.js",
                        sourceFile: "src/services/payment.service.js",
                        originalContent: null, // newly created test file
                        updatedContent: newPaymentContent,
                        framework: "jest"
                    }
                ],
                verification: { valid: true },
                coverage: {
                    total: {
                        statements: { pct: 92.5, total: 20, covered: 18, skipped: 0 },
                        branches: { pct: 88.0, total: 10, covered: 9, skipped: 0 },
                        functions: { pct: 95.0, total: 6, covered: 6, skipped: 0 },
                        lines: { pct: 92.5, total: 20, covered: 18, skipped: 0 }
                    }
                }
            });

            expect(v2Batch.version).toBe(2);
            expect(fs.existsSync(newPaymentTestPath)).toBe(true);

            // Verify Version 2 active state in manifest
            const manifestAfterBatch = JSON.parse(fs.readFileSync(path.join(tempDir, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME), "utf8"));
            expect(manifestAfterBatch.schemaVersion).toBe(2);
            expect(manifestAfterBatch.activeBatchId).toBe("batch_lifecycle_batch_run_001");
            expect(manifestAfterBatch.files["tests/auth.test.js"].currentVersion).toBe(2);
            expect(manifestAfterBatch.files["tests/payment.test.js"].currentVersion).toBe(2);

            // 3. Trigger bulk revert to Version 1 (Baseline) with { allFiles: true, targetVersion: 1 }
            const rollbackResult = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                allFiles: true,
                targetVersion: 1,
                runTests: true
            });

            expect(rollbackResult.success).toBe(true);
            expect(rollbackResult.targetVersion).toBe(1);

            // 4. Invariant: All test files restored to baseline (or newly created unlinked)
            // Pre-existing auth.test.js restored to exact baseline content
            expect(fs.existsSync(existingTestPath)).toBe(true);
            expect(fs.readFileSync(existingTestPath, "utf8")).toBe(baselineTestContent);
            expect(fs.readFileSync(existingTestPath, "utf8")).not.toContain("v2 enhanced");

            // Newly created payment.test.js completely unlinked from disk
            expect(fs.existsSync(newPaymentTestPath)).toBe(false);

            // 5. Invariant: Test verification re-run and baseline coverage metrics recalculated & persisted
            // Check that manifest updated to baseline
            const manifestAfterRollback = JSON.parse(fs.readFileSync(path.join(tempDir, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME), "utf8"));
            expect(manifestAfterRollback.activeBatchId).toBeNull();
            expect(manifestAfterRollback.files["tests/auth.test.js"].currentVersion).toBe(1);
            expect(manifestAfterRollback.files["tests/payment.test.js"].currentVersion).toBe(1);

            // Invariant: Active version badge returns to Version 1
            const authV1 = manifestAfterRollback.files["tests/auth.test.js"].versions.find(v => v.version === 1);
            const authV2 = manifestAfterRollback.files["tests/auth.test.js"].versions.find(v => v.version === 2);
            expect(authV1.isActive).toBe(true);
            expect(authV2.isActive).toBe(false);

            const paymentV1 = manifestAfterRollback.files["tests/payment.test.js"].versions.find(v => v.version === 1);
            const paymentV2 = manifestAfterRollback.files["tests/payment.test.js"].versions.find(v => v.version === 2);
            expect(paymentV1.isActive).toBe(true);
            expect(paymentV2.isActive).toBe(false);
        });
    });
});
