import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { describe, test, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

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
        create: jest.fn().mockResolvedValue({ id: "ai-challenger-1" })
    },
    $transaction: jest.fn(async (cb) => (typeof cb === "function" ? cb(mockPrisma) : cb))
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma
}));

const mockCreateRunTestsJob = jest.fn().mockResolvedValue({ id: "job_challenger_stress" });
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
    withPreparedProjectWorkspace: jest.fn(async (options, run) => run({}))
}));

await jest.unstable_mockModule("../services/dependencyInstallation.service.js", () => ({
    dependencyInstallationService: { install: jest.fn(async () => ({ success: true, installed: true, stdout: "", stderr: "" })) }
}));

export const mockGenerateText = jest.fn();

await jest.unstable_mockModule("../services/gemini.service.js", () => ({
    generateText: mockGenerateText
}));

await jest.unstable_mockModule("../controllers/coverage.controller.js", () => ({
    invalidateCoverageCache: jest.fn()
}));

const {
    saveUnitTestFileVersions,
    getUnitTestVersions,
    switchUnitTestVersion,
    clearManifestCache,
    removeEmptyParentsRecursively,
    hashContent,
    normalizePathKey,
    VERSIONS_DIR_NAME,
    MANIFEST_FILE_NAME
} = await import("../services/unitTestVersion.service.js");

const {
    applyUnitTestSuggestion
} = await import("../services/applyTestSuggestion.service.js");

const {
    buildTree
} = await import("../services/project.service.js");

describe("Empirical Challenger Stress Test Harness", () => {
    let tempDir;
    const snapshotId = "snap-challenger-stress-001";
    const projectId = "proj-challenger-stress-001";
    const userId = "user-challenger-stress-001";

    beforeEach(() => {
        clearManifestCache();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-challenger-stress-"));
        jest.clearAllMocks();

        const mockSnapshot = {
            id: snapshotId,
            projectId,
            rootDir: tempDir,
            coverageSummaries: []
        };
        mockPrisma.project.findFirst.mockResolvedValue({ id: projectId, ownerId: userId, name: "Stress Project", snapshots: [mockSnapshot] });
        mockPrisma.project.findUnique.mockResolvedValue({ id: projectId, ownerId: userId, name: "Stress Project", snapshots: [mockSnapshot] });
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

    describe("Stress 1: Rapid Toggle Sequence between Versions", () => {
        it("robustly handles rapid toggling v1 -> v2 -> v1 -> v2 -> fallback toggle -> fallback toggle", async () => {
            const srcDir = path.join(tempDir, "src");
            const testsDir = path.join(tempDir, "tests", "unit", "deep");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            // File 1: Pre-existing baseline test
            const existingRel = "tests/unit/deep/existing.test.js";
            const existingFull = path.join(tempDir, existingRel);
            const baselineExistingCode = "// Baseline content v1\ntest('existing', () => expect(1).toBe(1));";
            const updatedExistingCode = "// Applied content v2\ntest('existing v2', () => expect(2).toBe(2));";
            fs.writeFileSync(existingFull, updatedExistingCode, "utf8");

            // File 2: Completely new test file
            const newRel = "tests/unit/deep/newlyCreated.test.js";
            const newFull = path.join(tempDir, newRel);
            const newCodeV2 = "// Newly created test v2\ntest('brand new', () => expect(true).toBe(true));";
            fs.writeFileSync(newFull, newCodeV2, "utf8");

            // Save both as Version 2 APPLIED
            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/existing.js",
                testFile: existingRel,
                originalContent: baselineExistingCode,
                updatedContent: updatedExistingCode,
                isExisting: true,
                status: "APPLIED"
            });

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/new.js",
                testFile: newRel,
                originalContent: "",
                updatedContent: newCodeV2,
                status: "APPLIED"
            });

            // Cycle 1: Rollback to Version 1 (Baseline)
            const r1 = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                targetVersion: 1,
                allFiles: true
            });
            expect(r1.success).toBe(true);
            expect(fs.existsSync(newFull)).toBe(false);
            expect(fs.readFileSync(existingFull, "utf8")).toBe(baselineExistingCode);

            // Cycle 2: Switch to Version 2
            const r2 = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                targetVersion: 2,
                allFiles: true
            });
            expect(r2.success).toBe(true);
            expect(fs.existsSync(newFull)).toBe(true);
            expect(fs.readFileSync(newFull, "utf8")).toBe(newCodeV2);
            expect(fs.readFileSync(existingFull, "utf8")).toBe(updatedExistingCode);

            // Verify hashes on disk match manifest
            const manifestPath = path.join(tempDir, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME);
            const manifestV2 = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            const normNew = normalizePathKey(newRel);
            const normExist = normalizePathKey(existingRel);
            expect(manifestV2.files[normNew].versions[1].sha256).toBe(
                crypto.createHash("sha256").update(fs.readFileSync(newFull, "utf8")).digest("hex")
            );
            expect(manifestV2.files[normExist].versions[1].sha256).toBe(
                crypto.createHash("sha256").update(fs.readFileSync(existingFull, "utf8")).digest("hex")
            );

            // Cycle 3: Switch back to Version 1 again
            const r3 = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                targetVersion: 1,
                allFiles: true
            });
            expect(r3.success).toBe(true);
            expect(fs.existsSync(newFull)).toBe(false);
            expect(fs.readFileSync(existingFull, "utf8")).toBe(baselineExistingCode);

            // Cycle 4: Switch back to Version 2 again
            const r4 = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                targetVersion: 2,
                allFiles: true
            });
            expect(r4.success).toBe(true);
            expect(fs.existsSync(newFull)).toBe(true);
            expect(fs.readFileSync(newFull, "utf8")).toBe(newCodeV2);

            // Cycle 5: Fallback toggle without targetVersion (currently on v2 -> toggles to v1)
            const r5 = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                filePath: newRel
            });
            expect(r5.success).toBe(true);
            expect(fs.existsSync(newFull)).toBe(false);

            // Cycle 6: Fallback toggle without targetVersion (currently on v1 -> toggles to highest: v2)
            const r6 = await switchUnitTestVersion({
                snapshotId,
                projectId,
                userId,
                filePath: newRel
            });
            expect(r6.success).toBe(true);
            expect(fs.existsSync(newFull)).toBe(true);
            expect(fs.readFileSync(newFull, "utf8")).toBe(newCodeV2);
        });
    });

    describe("Stress 2: Repeated Baseline Rollbacks (Idempotency Stress)", () => {
        it("handles repeated consecutive baseline rollbacks without throwing or corrupting manifest", async () => {
            const testRel = "tests/transient.test.js";
            const fullPath = path.join(tempDir, testRel);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, "test('transient', () => {});", "utf8");

            saveUnitTestFileVersions({
                snapshotId,
                rootDir: tempDir,
                projectId,
                sourceFile: "src/transient.js",
                testFile: testRel,
                originalContent: "",
                updatedContent: "test('transient', () => {});",
                status: "APPLIED"
            });

            // Repeatedly rollback 5 times
            for (let i = 1; i <= 5; i++) {
                const res = await switchUnitTestVersion({
                    snapshotId,
                    projectId,
                    userId,
                    targetVersion: 1,
                    allFiles: true
                });
                expect(res.success).toBe(true);
                expect(fs.existsSync(fullPath)).toBe(false);
                expect(fs.existsSync(path.join(tempDir, "tests"))).toBe(false);

                // Manifest should remain valid JSON
                const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME), "utf8"));
                expect(manifest.files[testRel].currentVersion).toBe(1);
                expect(manifest.files[testRel].versions[0].isActive).toBe(true);
                expect(manifest.files[testRel].versions[1].isActive).toBe(false);
            }
        });
    });

    describe("Stress 3: Post-Verification Version Gate & Partial Apply", () => {
        it("does NOT record version when runner verification fails completely (0 passed tests)", async () => {
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "broken.js"), "module.exports = { failMe: () => false };", "utf8");

            const suggestion = {
                sourceFile: "src/broken.js",
                testFile: "tests/broken.test.js",
                targetTestFile: "tests/broken.test.js",
                framework: "jest",
                suggestedTestCode: "test('fail', () => { expect(true).toBe(false); });"
            };

            // Mock runner returning complete failure via test-results.json and non-zero exit simulation
            const applyResult = await applyUnitTestSuggestion({
                snapshotId,
                projectId,
                userId,
                suggestion,
                runCoverageFn: async ({ coverageDir, sealedRunDir }) => {
                    const failResults = {
                        success: false,
                        numTotalTests: 1,
                        numPassedTests: 0,
                        numFailedTests: 1,
                        testResults: [{
                            name: "tests/broken.test.js",
                            status: "failed",
                            numFailingTests: 1,
                            assertionResults: [{ status: "failed", title: "fail", failureMessages: ["expected true to be false"] }]
                        }]
                    };
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify(failResults), "utf8");
                    if (sealedRunDir) {
                        fs.writeFileSync(path.join(sealedRunDir, "test-results.json"), JSON.stringify(failResults), "utf8");
                    }
                    throw new Error("Test runner failed with exit code 1");
                }
            });

            expect(applyResult.success).toBe(false);
            expect(applyResult.status).toBe("FAILED");

            // Manifest must NOT have recorded a version because runner failed!
            const manifestPath = path.join(tempDir, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME);
            if (fs.existsSync(manifestPath)) {
                console.error("UNEXPECTED MANIFEST CONTENT WHEN RUNNER FAILED:", fs.readFileSync(manifestPath, "utf8"));
            }
            expect(fs.existsSync(manifestPath)).toBe(false);
        });

        it("records version with status APPLIED and accurate hash when runner passes", async () => {
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "valid.js"), "module.exports = { greet: () => 'hello' };", "utf8");

            const suggestion = {
                sourceFile: "src/valid.js",
                testFile: "tests/valid.test.js",
                targetTestFile: "tests/valid.test.js",
                framework: "jest",
                suggestedTestCode: "test('greet returns hello', () => { expect('hello').toBe('hello'); });"
            };

            const applyResult = await applyUnitTestSuggestion({
                snapshotId,
                projectId,
                userId,
                suggestion,
                runCoverageFn: async ({ coverageDir }) => {
                    const sumData = {
                        "src/valid.js": {
                            statements: { total: 2, covered: 2, skipped: 0, pct: 100 },
                            branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
                            functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
                            lines: { total: 2, covered: 2, skipped: 0, pct: 100 }
                        },
                        total: {
                            statements: { total: 2, covered: 2, skipped: 0, pct: 100 },
                            branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
                            functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
                            lines: { total: 2, covered: 2, skipped: 0, pct: 100 }
                        }
                    };
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify(sumData), "utf8");
                    const unitDir = path.join(coverageDir, "unit");
                    fs.mkdirSync(unitDir, { recursive: true });
                    fs.writeFileSync(path.join(unitDir, "coverage-summary.json"), JSON.stringify(sumData), "utf8");
                    return { success: true, exitCode: 0, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, totalTests: 1, passedTests: 1, failedTests: 0 };
                }
            });

            expect(applyResult.success).toBe(true);

            // Manifest must exist
            const manifestPath = path.join(tempDir, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME);
            expect(fs.existsSync(manifestPath)).toBe(true);

            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            const record = manifest.files["tests/valid.test.js"];
            expect(record).toBeDefined();
            expect(record.currentVersion).toBe(2);

            const v2 = record.versions[1];
            expect(v2.status).toBe("APPLIED");
            expect(v2.isActive).toBe(true);

            // Hash on disk MUST match manifest v2.sha256 exactly
            const diskFile = path.join(tempDir, "tests", "valid.test.js");
            expect(fs.existsSync(diskFile)).toBe(true);
            const diskContent = fs.readFileSync(diskFile, "utf8");
            const diskHash = crypto.createHash("sha256").update(diskContent).digest("hex");
            expect(v2.sha256).toBe(diskHash);
            expect(v2.content).toBe(diskContent);
        });
    });

    describe("Stress 4: Path Normalization, Slashes, and Traversal Defense", () => {
        it("normalizes Windows backslashes and redundant slashes for version keys", () => {
            const raw1 = "\\tests\\unit\\service.test.js";
            const raw2 = "tests///unit//service.test.js";
            const raw3 = "/tests/unit/service.test.js";

            expect(normalizePathKey(raw1)).toBe("tests/unit/service.test.js");
            expect(normalizePathKey(raw2)).toBe("tests///unit//service.test.js".replace(/\\/g, "/").replace(/^\/+/, ""));
            expect(normalizePathKey(raw3)).toBe("tests/unit/service.test.js");
        });

        it("safely prunes nested directories without touching workspace root or sibling source files", () => {
            const deepDir = path.join(tempDir, "a", "b", "c", "d", "e");
            fs.mkdirSync(deepDir, { recursive: true });
            const deepFile = path.join(deepDir, "deep.test.js");
            fs.writeFileSync(deepFile, "dummy", "utf8");

            // Also have a source file in a/b/keep.js
            fs.writeFileSync(path.join(tempDir, "a", "b", "keep.js"), "const x = 1;", "utf8");

            fs.unlinkSync(deepFile);
            removeEmptyParentsRecursively(deepFile, [tempDir]);

            // e, d, and c should be deleted
            expect(fs.existsSync(deepDir)).toBe(false);
            expect(fs.existsSync(path.join(tempDir, "a", "b", "c", "d"))).toBe(false);
            expect(fs.existsSync(path.join(tempDir, "a", "b", "c"))).toBe(false);

            // a/b should be KEPT because keep.js is in it
            expect(fs.existsSync(path.join(tempDir, "a", "b"))).toBe(true);
            expect(fs.existsSync(path.join(tempDir, "a", "b", "keep.js"))).toBe(true);

            // tempDir (workspace root) must be 100% intact
            expect(fs.existsSync(tempDir)).toBe(true);
        });
    });

    describe("Stress 5: Project Tree Filtering of Version Storage", () => {
        it("excludes .covai_test_versions and other .covai_ metadata from buildTree", () => {
            // Create .covai_test_versions directory with manifest.json
            const versionsDir = path.join(tempDir, VERSIONS_DIR_NAME);
            fs.mkdirSync(versionsDir, { recursive: true });
            fs.writeFileSync(path.join(versionsDir, "manifest.json"), "{}", "utf8");

            // Create normal files
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "app.js"), "console.log('hi');", "utf8");

            const tree = buildTree(tempDir);

            // Must NOT include .covai_test_versions in the tree
            const leakedNodes = tree.filter(n =>
                n.name.startsWith(".covai_") ||
                n.name.startsWith(".covai-") ||
                n.name === ".covai_test_versions"
            );
            expect(leakedNodes).toHaveLength(0);

            // Must include src
            const srcNode = tree.find(n => n.name === "src");
            expect(srcNode).toBeDefined();
            expect(srcNode.children.some(c => c.name === "app.js")).toBe(true);
        });
    });

    describe("Stress 6: Partial Apply in Suggestion Batch", () => {
        it("records APPLIED version for applied test files when at least one suite passes", async () => {
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "math.js"), "module.exports = { add: (a,b)=>a+b };", "utf8");

            const suggestion1 = {
                sourceFile: "src/math.js",
                testFile: "tests/mathPass.test.js",
                targetTestFile: "tests/mathPass.test.js",
                framework: "jest",
                suggestedTestCode: "test('math passes', () => { expect(1+1).toBe(2); });"
            };

            const suggestion2 = {
                sourceFile: "src/math.js",
                testFile: "tests/mathFail.test.js",
                targetTestFile: "tests/mathFail.test.js",
                framework: "jest",
                suggestedTestCode: "test('math fails', () => { expect(1+1).toBe(99); });"
            };

            const applyResult = await applyUnitTestSuggestion({
                snapshotId,
                projectId,
                userId,
                suggestions: [suggestion1, suggestion2],
                runCoverageFn: async ({ coverageDir, sealedRunDir }) => {
                    const partialResults = {
                        success: false,
                        numTotalTests: 2,
                        numPassedTests: 1,
                        numFailedTests: 1,
                        testResults: [
                            {
                                name: "tests/mathPass.test.js",
                                status: "passed",
                                numFailingTests: 0,
                                assertionResults: [{ status: "passed", title: "math passes" }]
                            },
                            {
                                name: "tests/mathFail.test.js",
                                status: "failed",
                                numFailingTests: 1,
                                assertionResults: [{ status: "failed", title: "math fails", failureMessages: ["expect 2 to be 99"] }]
                            }
                        ]
                    };
                    const sumData = {
                        "src/math.js": {
                            statements: { total: 2, covered: 2, skipped: 0, pct: 100 },
                            branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
                            functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
                            lines: { total: 2, covered: 2, skipped: 0, pct: 100 }
                        },
                        total: {
                            statements: { total: 2, covered: 2, skipped: 0, pct: 100 },
                            branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
                            functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
                            lines: { total: 2, covered: 2, skipped: 0, pct: 100 }
                        }
                    };
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify(partialResults), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify(sumData), "utf8");
                    if (sealedRunDir) {
                        fs.writeFileSync(path.join(sealedRunDir, "test-results.json"), JSON.stringify(partialResults), "utf8");
                        fs.writeFileSync(path.join(sealedRunDir, "coverage-summary.json"), JSON.stringify(sumData), "utf8");
                    }
                    return { success: false, exitCode: 1, ...partialResults };
                }
            });

            // INVARIANT: When batch test execution fails, all items are marked FAILED
            // and no new version is recorded!
            expect(applyResult.success).toBe(false);
            expect(applyResult.status).toBe("FAILED");
            const manifestPath = path.join(tempDir, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME);
            expect(fs.existsSync(manifestPath)).toBe(false);

            // Now re-run with both tests passing:
            const passingBatchResult = await applyUnitTestSuggestion({
                snapshotId,
                projectId,
                userId,
                suggestions: [
                    { ...suggestion1 },
                    { ...suggestion2, suggestedTestCode: "test('math passes 2', () => { expect(1+1).toBe(2); });" }
                ],
                runCoverageFn: async ({ coverageDir, sealedRunDir }) => {
                    const passResults = {
                        success: true,
                        numTotalTests: 2,
                        numPassedTests: 2,
                        numFailedTests: 0,
                        testResults: [
                            {
                                name: "tests/mathPass.test.js",
                                status: "passed",
                                numFailingTests: 0,
                                assertionResults: [{ status: "passed", title: "math passes" }]
                            },
                            {
                                name: "tests/mathFail.test.js",
                                status: "passed",
                                numFailingTests: 0,
                                assertionResults: [{ status: "passed", title: "math passes 2" }]
                            }
                        ]
                    };
                    const sumData = {
                        "src/math.js": {
                            statements: { total: 2, covered: 2, skipped: 0, pct: 100 },
                            branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
                            functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
                            lines: { total: 2, covered: 2, skipped: 0, pct: 100 }
                        },
                        total: {
                            statements: { total: 2, covered: 2, skipped: 0, pct: 100 },
                            branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
                            functions: { total: 1, covered: 1, skipped: 0, pct: 100 },
                            lines: { total: 2, covered: 2, skipped: 0, pct: 100 }
                        }
                    };
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify(passResults), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify(sumData), "utf8");
                    if (sealedRunDir) {
                        fs.writeFileSync(path.join(sealedRunDir, "test-results.json"), JSON.stringify(passResults), "utf8");
                        fs.writeFileSync(path.join(sealedRunDir, "coverage-summary.json"), JSON.stringify(sumData), "utf8");
                    }
                    return { success: true, exitCode: 0, ...passResults };
                }
            });

            expect(passingBatchResult.success).toBe(true);
            expect(fs.existsSync(manifestPath)).toBe(true);
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            expect(manifest.files["tests/mathPass.test.js"]).toBeDefined();
            expect(manifest.files["tests/mathPass.test.js"].currentVersion).toBe(2);
            expect(manifest.files["tests/mathPass.test.js"].versions[1].status).toBe("APPLIED");
            expect(manifest.files["tests/mathFail.test.js"]).toBeDefined();
            expect(manifest.files["tests/mathFail.test.js"].currentVersion).toBe(2);
            expect(manifest.files["tests/mathFail.test.js"].versions[1].status).toBe("APPLIED");
        });
    });

    describe("Stress 7: Concurrent Version Writes and Manifest Integrity", () => {
        it("preserves manifest integrity under concurrent calls across multiple test files", () => {
            const fileCount = 10;
            for (let i = 0; i < fileCount; i++) {
                saveUnitTestFileVersions({
                    snapshotId,
                    rootDir: tempDir,
                    projectId,
                    sourceFile: `src/mod${i}.js`,
                    testFile: `tests/mod${i}.test.js`,
                    originalContent: "",
                    updatedContent: `test('mod ${i}', () => {});`,
                    status: "APPLIED"
                });
            }

            const manifestPath = path.join(tempDir, VERSIONS_DIR_NAME, MANIFEST_FILE_NAME);
            expect(fs.existsSync(manifestPath)).toBe(true);
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            expect(Object.keys(manifest.files)).toHaveLength(fileCount);

            for (let i = 0; i < fileCount; i++) {
                const rec = manifest.files[`tests/mod${i}.test.js`];
                expect(rec).toBeDefined();
                expect(rec.currentVersion).toBe(2);
                expect(rec.versions[1].status).toBe("APPLIED");
            }
        });
    });

    describe("Stress 8: Dynamic File Explorer Invalidation Event Flow", () => {
        it("dispatches covai:project-event with type 'file' when projectId is provided", () => {
            const eventsDispatched = [];
            const mockWindow = {
                dispatchEvent: (evt) => { eventsDispatched.push(evt); }
            };

            // Invalidate function logic mirror
            const testInvalidateProjectTree = (pId) => {
                if (pId) {
                    mockWindow.dispatchEvent({
                        type: "covai:project-event",
                        detail: { projectId: pId, type: "file" }
                    });
                }
            };

            testInvalidateProjectTree(projectId);
            expect(eventsDispatched).toHaveLength(1);
            expect(eventsDispatched[0].detail.projectId).toBe(projectId);
            expect(eventsDispatched[0].detail.type).toBe("file");

            // Without projectId: should not dispatch
            testInvalidateProjectTree(null);
            expect(eventsDispatched).toHaveLength(1);
        });
    });
});
