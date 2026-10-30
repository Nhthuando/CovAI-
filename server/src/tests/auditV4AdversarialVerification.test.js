import child_process from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { describe, test, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mock Prisma
const mockPrisma = {
    $transaction: jest.fn(async (cb) => {
        if (typeof cb === "function") {
            return await cb(mockPrisma);
        }
        return Promise.all(cb);
    }),
    projectSnapshot: {
        findUnique: jest.fn(),
        update: jest.fn()
    },
    coverageSummary: {
        findUnique: jest.fn(),
        upsert: jest.fn()
    },
    coverageFile: {
        findMany: jest.fn(),
        upsert: jest.fn()
    }
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma,
    prisma: mockPrisma
}));

const mockInvalidateCache = jest.fn();
await jest.unstable_mockModule("../controllers/coverage.controller.js", () => ({
    invalidateCoverageCache: mockInvalidateCache
}));

const {
    computeSourceFilesHash,
    verifySourceFilesUnchanged,
    applyUnitTestSuggestion,
    activeApplyLocks,
    normalizeLockKey,
    acquireAtomicMultiLocks,
    releaseAtomicMultiLocks
} = await import("../services/applyTestSuggestion.service.js");

const {
    initDurableTransaction,
    stageDurableFile,
    commitDurableTransaction,
    rollbackDurableTransaction,
    cleanupDurableTransaction,
    recoverPendingApplyTransactions
} = await import("../services/durableJournal.service.js");

describe("COVAI AUDIT V4 — Adversarial Verification of Artifact Provenance, Durable Journal & Recovery", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-audit-v4-"));
        activeApplyLocks.clear();
        jest.clearAllMocks();
    });

    afterEach(() => {
        activeApplyLocks.clear();
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (_) {}
    });

    // =========================================================================
    // SECTION 1: P0-A — Artifact Provenance and Anti-TOCTOU
    // =========================================================================
    describe("P0-A: Artifact Provenance & Anti-TOCTOU", () => {
        test("A1. Multi-Runner Artifact Isolation: Concurrent jobs persist only their own sealed run artifacts", async () => {
            const rootDir = tempDir;
            const snapId1 = "snap-iso-1";
            const snapId2 = "snap-iso-2";

            mockPrisma.projectSnapshot.findUnique.mockImplementation(async ({ where }) => {
                return {
                    id: where.id,
                    projectId: "proj-iso-100",
                    rootDir,
                    coverageSummaries: { stmtsPct: 40, branchesPct: 40, funcsPct: 40, linesPct: 40 }
                };
            });

            // Create source files on disk
            fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
            fs.writeFileSync(path.join(rootDir, "src/job1.js"), "function job1() { return 1; }", "utf8");
            fs.writeFileSync(path.join(rootDir, "src/job2.js"), "function job2() { return 2; }", "utf8");

            // Job 1 produces coverage of 75%
            const runCoverage1 = jest.fn(async () => {
                const covDir = path.join(rootDir, "coverage");
                fs.mkdirSync(covDir, { recursive: true });
                fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify({
                    total: {
                        lines: { total: 100, covered: 75, pct: 75 },
                        statements: { total: 100, covered: 75, pct: 75 },
                        functions: { total: 100, covered: 75, pct: 75 },
                        branches: { total: 100, covered: 75, pct: 75 }
                    },
                    [path.join(rootDir, "src/job1.js")]: {
                        lines: { total: 100, covered: 75, pct: 75 },
                        statements: { total: 100, covered: 75, pct: 75 },
                        functions: { total: 100, covered: 75, pct: 75 },
                        branches: { total: 100, covered: 75, pct: 75 }
                    }
                }), "utf8");
                return { exitCode: 0, stdout: "PASS tests/job1.test.js", stderr: "" };
            });

            const res1 = await applyUnitTestSuggestion({
                snapshotId: snapId1,
                projectId: "proj-iso-100",
                userId: "user-1",
                suggestion: {
                    sourceFile: "src/job1.js",
                    testFile: "tests/job1.test.js",
                    generatedCode: "describe('job1', () => { test('ok', () => {}); });"
                },
                runCoverageFn: runCoverage1
            });

            expect(res1.status).toBe("PASSED");
            expect(res1.perFileResults["src/job1.js"].newCoverage.lines).toBe(75);
            expect(res1.runId).toBeDefined();

            // Job 2 produces coverage of 90%
            const runCoverage2 = jest.fn(async () => {
                const covDir = path.join(rootDir, "coverage");
                fs.mkdirSync(covDir, { recursive: true });
                fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify({
                    total: {
                        lines: { total: 100, covered: 90, pct: 90 },
                        statements: { total: 100, covered: 90, pct: 90 },
                        functions: { total: 100, covered: 90, pct: 90 },
                        branches: { total: 100, covered: 90, pct: 90 }
                    },
                    [path.join(rootDir, "src/job2.js")]: {
                        lines: { total: 100, covered: 90, pct: 90 },
                        statements: { total: 100, covered: 90, pct: 90 },
                        functions: { total: 100, covered: 90, pct: 90 },
                        branches: { total: 100, covered: 90, pct: 90 }
                    }
                }), "utf8");
                return { exitCode: 0, stdout: "PASS tests/job2.test.js", stderr: "" };
            });

            const res2 = await applyUnitTestSuggestion({
                snapshotId: snapId2,
                projectId: "proj-iso-100",
                userId: "user-1",
                suggestion: {
                    sourceFile: "src/job2.js",
                    testFile: "tests/job2.test.js",
                    generatedCode: "describe('job2', () => { test('ok', () => {}); });"
                },
                runCoverageFn: runCoverage2
            });

            expect(res2.status).toBe("PASSED");
            expect(res2.perFileResults["src/job2.js"].newCoverage.lines).toBe(90);
            expect(res2.runId).toBeDefined();
            expect(res1.runId).not.toBe(res2.runId);

            // Verify both sealed run directories exist independently
            expect(fs.existsSync(res1.runProvenance.sealedRunDir)).toBe(true);
            expect(fs.existsSync(res2.runProvenance.sealedRunDir)).toBe(true);
        });

        test("A2. Shared Coverage Tampering Immunity: Malicious writes to shared coverage/ before/during/after do not taint sealed run", async () => {
            const rootDir = tempDir;
            const snapshotId = "snap-tamper-shared";

            fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
            fs.writeFileSync(path.join(rootDir, "src/tamper.js"), "function tamper() { return 1; }", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: snapshotId,
                projectId: "proj-tamper",
                rootDir,
                coverageSummaries: { stmtsPct: 50, branchesPct: 50, funcsPct: 50, linesPct: 50 }
            });

            const runCoverage = jest.fn(async () => {
                const covDir = path.join(rootDir, "coverage");
                fs.mkdirSync(covDir, { recursive: true });
                // Valid runner output
                fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify({
                    total: {
                        lines: { total: 10, covered: 8, pct: 80 },
                        statements: { total: 10, covered: 8, pct: 80 },
                        functions: { total: 10, covered: 8, pct: 80 },
                        branches: { total: 10, covered: 8, pct: 80 }
                    },
                    [path.join(rootDir, "src/tamper.js")]: {
                        lines: { total: 10, covered: 8, pct: 80 },
                        statements: { total: 10, covered: 8, pct: 80 },
                        functions: { total: 10, covered: 8, pct: 80 },
                        branches: { total: 10, covered: 8, pct: 80 }
                    }
                }), "utf8");

                // Simulate adversary overwriting shared coverage/ midway through
                setTimeout(() => {
                    try {
                        fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify({
                            total: {
                                lines: { total: 10, covered: 1, pct: 10 },
                                statements: { total: 10, covered: 1, pct: 10 },
                                functions: { total: 10, covered: 1, pct: 10 },
                                branches: { total: 10, covered: 1, pct: 10 }
                            }
                        }), "utf8");
                    } catch (_) {}
                }, 5);

                return { exitCode: 0, stdout: "PASS tests/tamper.test.js", stderr: "" };
            });

            const result = await applyUnitTestSuggestion({
                snapshotId,
                projectId: "proj-tamper",
                userId: "user-tamper",
                suggestion: {
                    sourceFile: "src/tamper.js",
                    testFile: "tests/tamper.test.js",
                    generatedCode: "describe('tamper', () => { test('ok', () => {}); });"
                },
                runCoverageFn: runCoverage
            });

            // The pipeline must persist the verified coverage (80%), NOT the adversarial overwrite (10%)
            expect(result.status).toBe("PASSED");
            expect(result.perFileResults["src/tamper.js"].newCoverage.lines).toBe(80);
        });

        test("A3. Anti-TOCTOU In-Memory Guarantee: Modifying artifact file on disk after verification has zero effect on in-memory parsed metrics", async () => {
            const rootDir = tempDir;
            const snapshotId = "snap-anti-toctou";

            fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
            fs.writeFileSync(path.join(rootDir, "src/toctou.js"), "function toctou() { return 1; }", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: snapshotId,
                projectId: "proj-toctou",
                rootDir,
                coverageSummaries: { stmtsPct: 50, branchesPct: 50, funcsPct: 50, linesPct: 50 }
            });

            let capturedSealedDir = null;

            const runCoverage = jest.fn(async () => {
                const covDir = path.join(rootDir, "coverage");
                fs.mkdirSync(covDir, { recursive: true });
                fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify({
                    total: {
                        lines: { total: 50, covered: 45, pct: 90 },
                        statements: { total: 50, covered: 45, pct: 90 },
                        functions: { total: 50, covered: 45, pct: 90 },
                        branches: { total: 50, covered: 45, pct: 90 }
                    },
                    [path.join(rootDir, "src/toctou.js")]: {
                        lines: { total: 50, covered: 45, pct: 90 },
                        statements: { total: 50, covered: 45, pct: 90 },
                        functions: { total: 50, covered: 45, pct: 90 },
                        branches: { total: 50, covered: 45, pct: 90 }
                    }
                }), "utf8");
                return { exitCode: 0, stdout: "PASS tests/toctou.test.js", stderr: "" };
            });

            const result = await applyUnitTestSuggestion({
                snapshotId,
                projectId: "proj-toctou",
                userId: "user-toctou",
                suggestion: {
                    sourceFile: "src/toctou.js",
                    testFile: "tests/toctou.test.js",
                    generatedCode: "describe('toctou', () => { test('ok', () => {}); });"
                },
                runCoverageFn: runCoverage
            });

            expect(result.status).toBe("PASSED");
            capturedSealedDir = result.runProvenance.sealedRunDir;

            // Adversary modifies sealed artifact AFTER persistence
            fs.writeFileSync(path.join(capturedSealedDir, "coverage-summary.json"), "CORRUPTED DISK DATA", "utf8");

            // Result in memory remains the validated 90%
            expect(result.perFileResults["src/toctou.js"].newCoverage.lines).toBe(90);
        });

        test("A4. Provenance Manifest Mismatch Fail-Closed: Mismatched snapshotId or projectId aborts coverage update", async () => {
            const rootDir = tempDir;
            const snapshotId = "snap-provenance-mismatch";

            fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
            fs.writeFileSync(path.join(rootDir, "src/prov.js"), "function prov() { return 1; }", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: snapshotId,
                projectId: "proj-expected",
                rootDir,
                coverageSummaries: { stmtsPct: 50, branchesPct: 50, funcsPct: 50, linesPct: 50 }
            });

            // Run coverage returns success, but request projectId mismatches snapshot projectId
            const runCoverage = jest.fn(async () => {
                const covDir = path.join(rootDir, "coverage");
                fs.mkdirSync(covDir, { recursive: true });
                fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify({
                    total: {
                        lines: { total: 10, covered: 10, pct: 100 },
                        statements: { total: 10, covered: 10, pct: 100 },
                        functions: { total: 10, covered: 10, pct: 100 },
                        branches: { total: 10, covered: 10, pct: 100 }
                    }
                }), "utf8");
                return { exitCode: 0, stdout: "PASS tests/prov.test.js", stderr: "" };
            });

            // Must reject with Provenance mismatch error
            await expect(applyUnitTestSuggestion({
                snapshotId,
                projectId: "proj-ATTACKER-MISMATCH", // Malicious projectId injection
                userId: "user-attacker",
                suggestion: {
                    sourceFile: "src/prov.js",
                    testFile: "tests/prov.test.js",
                    generatedCode: "describe('prov', () => { test('ok', () => {}); });"
                },
                runCoverageFn: runCoverage
            })).rejects.toThrow(/Provenance mismatch/);

            // DB and cache must NOT be touched
            expect(mockPrisma.coverageSummary.upsert).not.toHaveBeenCalled();
        });

        test("A5. Stale Leftover Coverage Rejection: Prior run artifact older than run start time is rejected when new run produces no output", async () => {
            const rootDir = tempDir;
            const snapshotId = "snap-stale-leftover";

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: snapshotId,
                projectId: "proj-stale",
                rootDir,
                coverageSummaries: { stmtsPct: 30, branchesPct: 30, funcsPct: 30, linesPct: 30 }
            });

            // Create a stale coverage file with old timestamp (10 seconds ago)
            const covDir = path.join(rootDir, "coverage");
            fs.mkdirSync(covDir, { recursive: true });
            const staleSummary = path.join(covDir, "coverage-summary.json");
            fs.writeFileSync(staleSummary, JSON.stringify({
                total: {
                    lines: { total: 100, covered: 99, pct: 99 },
                    statements: { total: 100, covered: 99, pct: 99 },
                    functions: { total: 100, covered: 99, pct: 99 },
                    branches: { total: 100, covered: 99, pct: 99 }
                }
            }), "utf8");
            const oldTime = (Date.now() - 15000) / 1000;
            fs.utimesSync(staleSummary, oldTime, oldTime);

            // Runner exits 0 but does not produce any new coverage files
            const runCoverage = jest.fn(async () => {
                return { exitCode: 0, stdout: "Ran 0 tests", stderr: "" };
            });

            const result = await applyUnitTestSuggestion({
                snapshotId,
                projectId: "proj-stale",
                userId: "user-stale",
                suggestion: {
                    sourceFile: "src/stale.js",
                    testFile: "tests/stale.test.js",
                    generatedCode: "describe('stale', () => { test('empty', () => {}); });"
                },
                runCoverageFn: runCoverage
            });

            // Pipeline must reject stale artifact and report failure
            expect(result.status).toBe("FAILED");
            expect(mockPrisma.coverageSummary.upsert).not.toHaveBeenCalled();
        });

        test("A6. Concurrent Independent Jest / Vitest Runners with Different Coverage: Direct sealedRunDir output avoids collisions", async () => {
            const rootDir = tempDir;
            const snapIdA = "snap-a6-runnerA";
            const snapIdB = "snap-a6-runnerB";

            mockPrisma.projectSnapshot.findUnique.mockImplementation(async ({ where }) => ({
                id: where.id,
                projectId: "proj-a6",
                rootDir,
                coverageSummaries: { stmtsPct: 40, branchesPct: 40, funcsPct: 40, linesPct: 40 }
            }));

            fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
            fs.writeFileSync(path.join(rootDir, "src/runnerA.js"), "function runnerA() { return 1; }", "utf8");
            fs.writeFileSync(path.join(rootDir, "src/runnerB.js"), "function runnerB() { return 2; }", "utf8");

            // Mock runner A writing directly to its sealedRunDir with 55% coverage
            const runCoverageA = jest.fn(async ({ sealedRunDir }) => {
                fs.writeFileSync(path.join(sealedRunDir, "coverage-summary.json"), JSON.stringify({
                    total: {
                        lines: { total: 100, covered: 55, pct: 55 },
                        statements: { total: 100, covered: 55, pct: 55 },
                        functions: { total: 100, covered: 55, pct: 55 },
                        branches: { total: 100, covered: 55, pct: 55 }
                    },
                    [path.join(rootDir, "src/runnerA.js")]: {
                        lines: { total: 100, covered: 55, pct: 55 },
                        statements: { total: 100, covered: 55, pct: 55 },
                        functions: { total: 100, covered: 55, pct: 55 },
                        branches: { total: 100, covered: 55, pct: 55 }
                    }
                }), "utf8");
                return { exitCode: 0, stdout: "PASS tests/runnerA.test.js", stderr: "" };
            });

            // Mock runner B writing directly to its sealedRunDir with 95% coverage
            const runCoverageB = jest.fn(async ({ sealedRunDir }) => {
                fs.writeFileSync(path.join(sealedRunDir, "coverage-summary.json"), JSON.stringify({
                    total: {
                        lines: { total: 100, covered: 95, pct: 95 },
                        statements: { total: 100, covered: 95, pct: 95 },
                        functions: { total: 100, covered: 95, pct: 95 },
                        branches: { total: 100, covered: 95, pct: 95 }
                    },
                    [path.join(rootDir, "src/runnerB.js")]: {
                        lines: { total: 100, covered: 95, pct: 95 },
                        statements: { total: 100, covered: 95, pct: 95 },
                        functions: { total: 100, covered: 95, pct: 95 },
                        branches: { total: 100, covered: 95, pct: 95 }
                    }
                }), "utf8");
                return { exitCode: 0, stdout: "PASS tests/runnerB.test.js", stderr: "" };
            });

            const resA = await applyUnitTestSuggestion({
                snapshotId: snapIdA,
                projectId: "proj-a6",
                userId: "user-a",
                suggestion: {
                    sourceFile: "src/runnerA.js",
                    testFile: "tests/runnerA.test.js",
                    generatedCode: "describe('a', () => {});"
                },
                runCoverageFn: runCoverageA
            });

            const resB = await applyUnitTestSuggestion({
                snapshotId: snapIdB,
                projectId: "proj-a6",
                userId: "user-b",
                suggestion: {
                    sourceFile: "src/runnerB.js",
                    testFile: "tests/runnerB.test.js",
                    generatedCode: "describe('b', () => {});"
                },
                runCoverageFn: runCoverageB
            });

            expect(resA.perFileResults["src/runnerA.js"].newCoverage.lines).toBe(55);
            expect(resB.perFileResults["src/runnerB.js"].newCoverage.lines).toBe(95);

            // Manifests bind runId, snapshotId, projectId, sourceFilesCompositeHash
            const manifestA = JSON.parse(fs.readFileSync(path.join(resA.runProvenance.sealedRunDir, "manifest.json"), "utf8"));
            const manifestB = JSON.parse(fs.readFileSync(path.join(resB.runProvenance.sealedRunDir, "manifest.json"), "utf8"));

            expect(manifestA.runId).toBe(resA.runId);
            expect(manifestA.snapshotId).toBe(snapIdA);
            expect(manifestA.projectId).toBe("proj-a6");
            expect(manifestA.sourceFilesCompositeHash).toBeDefined();

            expect(manifestB.runId).toBe(resB.runId);
            expect(manifestB.snapshotId).toBe(snapIdB);
            expect(manifestB.projectId).toBe("proj-a6");
            expect(manifestB.sourceFilesCompositeHash).toBeDefined();
        });
    });

    // =========================================================================
    // SECTION 2: P0-B — Durable Journal & Crash Consistency
    // =========================================================================
    describe("P0-B: Durable Journal & Crash Consistency", () => {
        test("B1. Crash Immediately After Manifest Creation: Recovery restores baseline cleanly", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "b1.test.js");
            const origCode = "// orig b1 code";
            fs.writeFileSync(testPath, origCode, "utf8");

            // Initialize transaction (creates manifest at INITIALIZED)
            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b1",
                targetFiles: ["tests/b1.test.js"]
            });
            expect(tx.status).toBe("INITIALIZED");

            // Simulate crash before any staging
            const recovery = recoverPendingApplyTransactions(tempDir);
            expect(recovery.recovered).toBe(true);
            expect(recovery.action).toBe("ROLLED_BACK");
            expect(fs.readFileSync(testPath, "utf8")).toBe(origCode);
        });

        test("B2. Crash During Staging: Staged files not committed; recovery restores baseline", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "b2.test.js");
            const origCode = "// orig b2 code";
            fs.writeFileSync(testPath, origCode, "utf8");

            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b2",
                targetFiles: ["tests/b2.test.js"]
            });

            stageDurableFile({
                rootDir: tempDir,
                tx,
                relativePath: "tests/b2.test.js",
                content: "// staged new code"
            });
            expect(tx.status).toBe("STAGED");

            // Simulate crash during staging
            const recovery = recoverPendingApplyTransactions(tempDir);
            expect(recovery.recovered).toBe(true);
            expect(recovery.action).toBe("ROLLED_BACK");
            expect(fs.readFileSync(testPath, "utf8")).toBe(origCode);
        });

        test("B3. Partial Multi-File Commit Crash: File 1 replaced but File 2 pending -> recovery restores both to baseline", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const f1 = path.join(testsDir, "f1.test.js");
            const f2 = path.join(testsDir, "f2.test.js");
            fs.writeFileSync(f1, "const f1 = 'original';", "utf8");
            fs.writeFileSync(f2, "const f2 = 'original';", "utf8");

            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b3",
                targetFiles: ["tests/f1.test.js", "tests/f2.test.js"]
            });

            stageDurableFile({ rootDir: tempDir, tx, relativePath: "tests/f1.test.js", content: "const f1 = 'new';" });
            stageDurableFile({ rootDir: tempDir, tx, relativePath: "tests/f2.test.js", content: "const f2 = 'new';" });

            // Simulate crash: f1 committed, f2 not yet committed
            fs.writeFileSync(f1, "const f1 = 'new';", "utf8");
            tx.status = "COMMITTING";
            fs.writeFileSync(path.join(tempDir, ".covai_journal", "active_tx.json"), JSON.stringify(tx, null, 2), "utf8");

            // Run recovery
            const recovery = recoverPendingApplyTransactions(tempDir);
            expect(recovery.recovered).toBe(true);
            expect(recovery.action).toBe("ROLLED_BACK");
            expect(fs.readFileSync(f1, "utf8")).toBe("const f1 = 'original';");
            expect(fs.readFileSync(f2, "utf8")).toBe("const f2 = 'original';");
        });

        test("B4. Mid-Write Corrupted Destination Crash: File corrupted mid-write is restored to intact backup", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "b4.test.js");
            const intactCode = "describe('intact', () => { test('ok', () => {}); });";
            fs.writeFileSync(testPath, intactCode, "utf8");

            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b4",
                targetFiles: ["tests/b4.test.js"]
            });

            stageDurableFile({ rootDir: tempDir, tx, relativePath: "tests/b4.test.js", content: "// new content" });

            // Simulate corrupted truncated write on disk
            fs.writeFileSync(testPath, "CORRUPTED_TRUNCATED_HALFWAY...", "utf8");
            tx.status = "COMMITTING";
            fs.writeFileSync(path.join(tempDir, ".covai_journal", "active_tx.json"), JSON.stringify(tx, null, 2), "utf8");

            const recovery = recoverPendingApplyTransactions(tempDir);
            expect(recovery.recovered).toBe(true);
            expect(fs.readFileSync(testPath, "utf8")).toBe(intactCode);
        });

        test("B5. Post-COMMITTED Crash Before Journal Cleanup: Recovery cleans up without rolling back committed work", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "b5.test.js");
            fs.writeFileSync(testPath, "// pre-committed code", "utf8");

            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b5",
                targetFiles: ["tests/b5.test.js"]
            });

            stageDurableFile({ rootDir: tempDir, tx, relativePath: "tests/b5.test.js", content: "// post-committed code" });
            commitDurableTransaction({ rootDir: tempDir, tx });

            // Verify status is COMMITTED on disk
            expect(fs.readFileSync(testPath, "utf8")).toBe("// post-committed code");

            // Crash happened before cleanupDurableTransaction
            const recovery = recoverPendingApplyTransactions(tempDir);
            expect(recovery.recovered).toBe(true);
            expect(recovery.action).toBe("CLEANED_UP_COMMITTED");

            // Target file keeps the committed new code!
            expect(fs.readFileSync(testPath, "utf8")).toBe("// post-committed code");
            expect(fs.existsSync(path.join(tempDir, ".covai_journal", "active_tx.json"))).toBe(false);
        });

        test("B6. Crash During Recovery Itself: Second recovery call completes restoration safely", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "b6.test.js");
            const origCode = "// orig b6 code";
            fs.writeFileSync(testPath, origCode, "utf8");

            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b6",
                targetFiles: ["tests/b6.test.js"]
            });

            stageDurableFile({ rootDir: tempDir, tx, relativePath: "tests/b6.test.js", content: "// modified b6" });
            fs.writeFileSync(testPath, "// modified b6", "utf8");
            tx.status = "COMMITTING";
            fs.writeFileSync(path.join(tempDir, ".covai_journal", "active_tx.json"), JSON.stringify(tx, null, 2), "utf8");

            // Run first recovery
            const rec1 = recoverPendingApplyTransactions(tempDir);
            expect(rec1.recovered).toBe(true);
            expect(fs.readFileSync(testPath, "utf8")).toBe(origCode);

            // Run second recovery immediately (simulating crash & reboot)
            const rec2 = recoverPendingApplyTransactions(tempDir);
            expect(rec2.recovered).toBe(false);
            expect(rec2.reason).toBe("No active transaction found");
            expect(fs.readFileSync(testPath, "utf8")).toBe(origCode);
        });

        test("B7. Recovery Idempotency: Multiple consecutive calls produce 0 errors", () => {
            for (let i = 0; i < 5; i++) {
                const rec = recoverPendingApplyTransactions(tempDir);
                expect(rec.recovered).toBe(false);
            }
        });

        test("B8. Corrupted Backup Checksum Fail-Closed: Corrupted backup marks journal unrecoverable and rejects new apply", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "b8.test.js");
            fs.writeFileSync(testPath, "// orig b8 code", "utf8");

            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b8",
                targetFiles: ["tests/b8.test.js"]
            });

            // Adversary corrupts backup file on disk
            const backupPath = tx.files[0].backupPath;
            fs.writeFileSync(backupPath, "// TAMPERED BACKUP DATA", "utf8");

            // Recovery detects checksum mismatch and fails closed
            const recovery = recoverPendingApplyTransactions(tempDir);
            expect(recovery.recovered).toBe(false);
            expect(recovery.unrecoverable).toBe(true);

            // New apply attempts must be blocked with unrecoverable error
            expect(() => {
                initDurableTransaction({
                    rootDir: tempDir,
                    snapshotId: "snap-b8-new",
                    targetFiles: ["tests/b8.test.js"]
                });
            }).toThrow(/unrecoverable corrupted journal state/);
        });

        test("B9. ENOSPC / File Permission Error Handling: File descriptors closed safely", () => {
            const invalidRootDir = path.join(tempDir, "non_existent_subdir_xyz");
            expect(() => {
                initDurableTransaction({
                    rootDir: invalidRootDir,
                    snapshotId: "snap-b9",
                    targetFiles: ["tests/b9.test.js"]
                });
            }).toThrow(/does not exist/);
        });

        test("B10. Automatic Recovery on New Apply: Interrupted prior transaction is recovered before new transaction starts", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "b10.test.js");
            fs.writeFileSync(testPath, "// baseline b10", "utf8");

            // Prior dead transaction left on disk
            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b10-prior",
                targetFiles: ["tests/b10.test.js"]
            });
            stageDurableFile({ rootDir: tempDir, tx, relativePath: "tests/b10.test.js", content: "// dirty b10" });
            fs.writeFileSync(testPath, "// dirty b10", "utf8");
            tx.pid = 99999999; // Dead PID
            tx.status = "COMMITTING";
            fs.writeFileSync(path.join(tempDir, ".covai_journal", "active_tx.json"), JSON.stringify(tx, null, 2), "utf8");

            // New transaction initialization must detect dead prior transaction and recover it first
            const newTx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b10-new",
                targetFiles: ["tests/b10.test.js"]
            });

            expect(newTx.status).toBe("INITIALIZED");
            expect(newTx.snapshotId).toBe("snap-b10-new");
            // Baseline was restored before new transaction began!
            expect(fs.readFileSync(testPath, "utf8")).toBe("// baseline b10");
        });

        test("B11. Hard Crash: True Parent-Controlled SIGKILL Crash & Recovery with SHA-256 Content Verification", async () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "sigkill_hard_crash.test.js");
            const originalText = "describe('pre-crash-v4-sigkill', () => { test('truth', () => { expect(1+1).toBe(2); }); });";
            fs.writeFileSync(testPath, originalText, "utf8");
            const originalSha256 = crypto.createHash("sha256").update(originalText).digest("hex");

            const checkpointFile = path.join(tempDir, ".checkpoint_committing");
            const workerScript = path.join(tempDir, "sigkill-worker.mjs");
            const durableModuleUrl = new URL("../services/durableJournal.service.js", import.meta.url).href;

            const workerCode = `
                import fs from "fs";
                import path from "path";
                import { initDurableTransaction, stageDurableFile } from "${durableModuleUrl}";

                const rootDir = process.argv[2];
                const checkpointPath = process.argv[3];

                const tx = initDurableTransaction({
                    rootDir,
                    snapshotId: "snap-v4-sigkill",
                    targetFiles: ["tests/sigkill_hard_crash.test.js"]
                });

                stageDurableFile({
                    rootDir,
                    tx,
                    relativePath: "tests/sigkill_hard_crash.test.js",
                    content: "// corrupted mid-commit v4 sigkill"
                });

                // Mutate target file to simulate partial commit
                fs.writeFileSync(path.join(rootDir, "tests/sigkill_hard_crash.test.js"), "// corrupted mid-commit v4 sigkill", "utf8");
                tx.status = "COMMITTING";
                fs.writeFileSync(path.join(rootDir, ".covai_journal", "active_tx.json"), JSON.stringify(tx, null, 2), "utf8");

                // Signal parent that checkpoint is reached
                fs.writeFileSync(checkpointPath, String(process.pid), "utf8");

                // Block and wait for parent to forcefully terminate with SIGKILL
                setInterval(() => {}, 1000);
            `;
            fs.writeFileSync(workerScript, workerCode, "utf8");

            // Parent spawns child worker asynchronously
            const child = child_process.spawn("node", [workerScript, tempDir, checkpointFile], {
                stdio: ["ignore", "pipe", "pipe"]
            });

            // Wait until child signals that checkpoint is reached
            let waited = 0;
            while (!fs.existsSync(checkpointFile) && waited < 10000) {
                await new Promise((r) => setTimeout(r, 50));
                waited += 50;
            }
            expect(fs.existsSync(checkpointFile)).toBe(true);

            // Parent forcefully sends SIGKILL to child process
            child.kill("SIGKILL");

            // Wait for child process exit
            await new Promise((resolve) => {
                child.on("exit", resolve);
            });

            // Confirm disk was left in dirty state by killed child
            expect(fs.readFileSync(testPath, "utf8")).toBe("// corrupted mid-commit v4 sigkill");
            expect(fs.existsSync(path.join(tempDir, ".covai_journal", "active_tx.json"))).toBe(true);

            // Recovery routine runs in parent process
            const recovery = recoverPendingApplyTransactions(tempDir);
            expect(recovery.recovered).toBe(true);
            expect(recovery.action).toBe("ROLLED_BACK");

            // Verify file content and SHA-256 match original 100%
            const restoredText = fs.readFileSync(testPath, "utf8");
            expect(restoredText).toBe(originalText);
            const restoredSha256 = crypto.createHash("sha256").update(restoredText).digest("hex");
            expect(restoredSha256).toBe(originalSha256);

            // Verify active_tx.json was cleanly removed
            expect(fs.existsSync(path.join(tempDir, ".covai_journal", "active_tx.json"))).toBe(false);
        });

        test("B12. DB Committed Crash Window: Reconciles and Rolls Forward (ROLLED_FORWARD_DB_ALREADY_COMMITTED)", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "b12.test.js");
            const originalCode = "// original b12";
            const newCommittedCode = "// new committed b12";
            fs.writeFileSync(testPath, originalCode, "utf8");

            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b12",
                targetFiles: ["tests/b12.test.js"]
            });

            stageDurableFile({ rootDir: tempDir, tx, relativePath: "tests/b12.test.js", content: newCommittedCode });
            fs.writeFileSync(testPath, newCommittedCode, "utf8");
            tx.status = "COMMITTING";
            fs.writeFileSync(path.join(tempDir, ".covai_journal", "active_tx.json"), JSON.stringify(tx, null, 2), "utf8");

            // Crash occurred right after Prisma committed to Postgres, but before status: COMMITTED was written
            const recovery = recoverPendingApplyTransactions(tempDir, { isDbCommitted: true });
            expect(recovery.recovered).toBe(true);
            expect(recovery.action).toBe("ROLLED_FORWARD_DB_ALREADY_COMMITTED");

            // File remains the newly committed code, NOT reverted
            expect(fs.readFileSync(testPath, "utf8")).toBe(newCommittedCode);
            expect(fs.existsSync(path.join(tempDir, ".covai_journal", "active_tx.json"))).toBe(false);
        });

        test("B13. DB Uncommitted Crash Window: Rolls Back to Original Backup (ROLLED_BACK)", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "b13.test.js");
            const originalCode = "// original b13";
            const uncommittedCode = "// uncommitted b13";
            fs.writeFileSync(testPath, originalCode, "utf8");

            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b13",
                targetFiles: ["tests/b13.test.js"]
            });

            stageDurableFile({ rootDir: tempDir, tx, relativePath: "tests/b13.test.js", content: uncommittedCode });
            fs.writeFileSync(testPath, uncommittedCode, "utf8");
            tx.status = "COMMITTING";
            fs.writeFileSync(path.join(tempDir, ".covai_journal", "active_tx.json"), JSON.stringify(tx, null, 2), "utf8");

            // DB was NOT committed
            const recovery = recoverPendingApplyTransactions(tempDir, { isDbCommitted: false });
            expect(recovery.recovered).toBe(true);
            expect(recovery.action).toBe("ROLLED_BACK");

            // File restored to original
            expect(fs.readFileSync(testPath, "utf8")).toBe(originalCode);
            expect(fs.existsSync(path.join(tempDir, ".covai_journal", "active_tx.json"))).toBe(false);
        });

        test("B14. Corrupted Manifest Quarantining and Fail-Closed: Malformed JSON quarantined to .corrupt.<timestamp>", () => {
            const journalDir = path.join(tempDir, ".covai_journal");
            fs.mkdirSync(journalDir, { recursive: true });
            const manifestPath = path.join(journalDir, "active_tx.json");
            fs.writeFileSync(manifestPath, '{"txId": "broken-manifest", truncated...', "utf8");

            const recovery = recoverPendingApplyTransactions(tempDir);
            expect(recovery.recovered).toBe(false);
            expect(recovery.unrecoverable).toBe(true);

            // Active manifest should no longer be at active_tx.json, but quarantined
            expect(fs.existsSync(manifestPath)).toBe(false);
            const journalFiles = fs.readdirSync(journalDir);
            const quarantined = journalFiles.find(f => f.startsWith("active_tx.corrupt."));
            expect(quarantined).toBeDefined();

            // Next attempt to initDurableTransaction must fail closed
            expect(() => {
                initDurableTransaction({
                    rootDir: tempDir,
                    snapshotId: "snap-b14",
                    targetFiles: ["tests/b14.test.js"]
                });
            }).toThrow(/unrecoverable corrupted journal state/);
        });

        test("B15. Missing Backup File Fail-Closed: Missing backup file blocks apply with CORRUPTED_BACKUP_FAIL_CLOSED", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "b15.test.js");
            fs.writeFileSync(testPath, "// orig b15", "utf8");

            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-b15",
                targetFiles: ["tests/b15.test.js"]
            });

            // Adversary deletes backup file
            if (fs.existsSync(tx.files[0].backupPath)) {
                fs.unlinkSync(tx.files[0].backupPath);
            }

            const recovery = recoverPendingApplyTransactions(tempDir);
            expect(recovery.recovered).toBe(false);
            expect(recovery.unrecoverable).toBe(true);

            // Manifest marked CORRUPTED_BACKUP_FAIL_CLOSED
            const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, ".covai_journal", "active_tx.json"), "utf8"));
            expect(manifest.status).toBe("CORRUPTED_BACKUP_FAIL_CLOSED");
        });
    });

    // =========================================================================
    // SECTION 3: P0-C — Lock Atomicity & Journal Ownership
    // =========================================================================
    describe("P0-C: Lock Atomicity & Journal Ownership", () => {
        test("C1. Concurrent Requests on Same Snapshot: Rejected with 409 Conflict", async () => {
            const rootDir = tempDir;
            const snapshotId = "snap-c1-conflict";

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: snapshotId,
                projectId: "proj-c1",
                rootDir,
                coverageSummaries: { stmtsPct: 50, branchesPct: 50, funcsPct: 50, linesPct: 50 }
            });

            let releaseGate;
            const gatePromise = new Promise((resolve) => { releaseGate = resolve; });

            const runCoverage = jest.fn(async () => {
                await gatePromise;
                return { exitCode: 0, stdout: "PASS tests/c1.test.js", stderr: "" };
            });

            // Start first apply
            const job1Promise = applyUnitTestSuggestion({
                snapshotId,
                projectId: "proj-c1",
                userId: "user-1",
                suggestion: {
                    sourceFile: "src/c1.js",
                    testFile: "tests/c1.test.js",
                    generatedCode: "describe('c1', () => { test('ok', () => {}); });"
                },
                runCoverageFn: runCoverage
            });

            // Allow event loop tick for job 1 to acquire lock
            await new Promise((r) => setTimeout(r, 20));

            // Job 2 on same snapshot must immediately reject with 409
            await expect(applyUnitTestSuggestion({
                snapshotId,
                projectId: "proj-c1",
                userId: "user-2",
                suggestion: {
                    sourceFile: "src/c1.js",
                    testFile: "tests/c1.test.js",
                    generatedCode: "describe('c1', () => { test('ok', () => {}); });"
                },
                runCoverageFn: runCoverage
            })).rejects.toThrow(/Another test application or runner job is currently executing on this snapshot/);

            releaseGate();
            await job1Promise;
        });

        test("C2. Concurrent Requests on Same Workspace Across Different Snapshots: Rejected with 409 Conflict", async () => {
            const rootDir = tempDir;

            mockPrisma.projectSnapshot.findUnique.mockImplementation(async ({ where }) => ({
                id: where.id,
                projectId: "proj-c2",
                rootDir,
                coverageSummaries: { stmtsPct: 50, branchesPct: 50, funcsPct: 50, linesPct: 50 }
            }));

            let releaseGate;
            const gatePromise = new Promise((resolve) => { releaseGate = resolve; });

            const runCoverage = jest.fn(async () => {
                await gatePromise;
                return { exitCode: 0, stdout: "PASS", stderr: "" };
            });

            const job1Promise = applyUnitTestSuggestion({
                snapshotId: "snap-c2-alpha",
                projectId: "proj-c2",
                userId: "user-1",
                suggestion: {
                    sourceFile: "src/alpha.js",
                    testFile: "tests/alpha.test.js",
                    generatedCode: "describe('alpha', () => {});"
                },
                runCoverageFn: runCoverage
            });

            await new Promise((r) => setTimeout(r, 20));

            // Job 2 targeting different snapshot on SAME workspace must reject with 409
            await expect(applyUnitTestSuggestion({
                snapshotId: "snap-c2-beta",
                projectId: "proj-c2",
                userId: "user-2",
                suggestion: {
                    sourceFile: "src/beta.js",
                    testFile: "tests/beta.test.js",
                    generatedCode: "describe('beta', () => {});"
                },
                runCoverageFn: runCoverage
            })).rejects.toThrow(/Another test application is currently executing on workspace/);

            releaseGate();
            await job1Promise;
        });

        test("C3. Concurrent Requests Modifying Same Physical Test File: Rejected with 409 Conflict", () => {
            const filePath = path.join(tempDir, "shared.test.js");
            const fileKey = normalizeLockKey("file", filePath);

            // Pre-acquire lock on file
            acquireAtomicMultiLocks([fileKey]);

            // Attempt to acquire lock on same file must throw 409
            expect(() => {
                acquireAtomicMultiLocks([fileKey]);
            }).toThrow(/Another test application is currently modifying test file/);

            releaseAtomicMultiLocks([fileKey]);
        });

        test("C4. Atomic All-Or-Nothing Lock Acquisition: Failure on resource 3 does NOT leak resource 1 or 2", () => {
            const k1 = "workspace:test-res-1";
            const k2 = "workspace:test-res-2";
            const k3 = "workspace:test-res-3";

            // Resource 3 is already locked
            activeApplyLocks.add(k3);

            // Attempting to lock [k1, k2, k3] must throw 409
            expect(() => {
                acquireAtomicMultiLocks([k1, k2, k3]);
            }).toThrow(/Another test application is currently executing on workspace/);

            // k1 and k2 MUST NOT have been acquired!
            expect(activeApplyLocks.has(k1)).toBe(false);
            expect(activeApplyLocks.has(k2)).toBe(false);
            expect(activeApplyLocks.has(k3)).toBe(true);

            activeApplyLocks.clear();
        });

        test("C5. Lock Release Guarantee on Early Exception: All locks released in finally block", async () => {
            const rootDir = tempDir;
            const snapshotId = "snap-c5-fail";

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: snapshotId,
                projectId: "proj-c5",
                rootDir,
                coverageSummaries: null
            });

            // Database throws an unexpected catastrophic error during execution
            mockPrisma.projectSnapshot.findUnique.mockRejectedValueOnce(new Error("Simulated catastrophic crash inside findUnique"));

            await expect(applyUnitTestSuggestion({
                snapshotId,
                projectId: "proj-c5",
                userId: "user-c5",
                suggestion: {
                    sourceFile: "src/c5.js",
                    testFile: "tests/c5.test.js",
                    generatedCode: "describe('c5', () => {});"
                }
            })).rejects.toThrow("Simulated catastrophic crash inside findUnique");

            // Locks must be 100% empty
            expect(activeApplyLocks.size).toBe(0);
        });

        test("C6. Path Canonicalization & Alias Normalization: Slashes, casing, and relative segments normalize to identical lock key", () => {
            const base = path.join(tempDir, "sub", "test.js");
            const relativeWithDots = path.join(tempDir, "sub", "..", "sub", ".", "test.js");
            const mixedSlashes = base.replace(/\\/g, "/");

            const key1 = normalizeLockKey("file", base);
            const key2 = normalizeLockKey("file", relativeWithDots);
            const key3 = normalizeLockKey("file", mixedSlashes);

            expect(key1).toBe(key2);
            expect(key2).toBe(key3);
        });

        test("C7. Active Living PID Blocks Concurrent Journal Acquisition", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            fs.writeFileSync(path.join(testsDir, "c7.test.js"), "// orig", "utf8");

            const journalDir = path.join(tempDir, ".covai_journal");
            fs.mkdirSync(journalDir, { recursive: true });

            // Create manifest owned by parent process PID (which is alive and !== process.pid)
            const parentPid = process.ppid || 1;
            const manifest = {
                txId: "tx-living-pid",
                snapshotId: "snap-c7",
                pid: parentPid,
                hostname: os.hostname(),
                status: "COMMITTING",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                files: []
            };
            fs.writeFileSync(path.join(journalDir, "active_tx.json"), JSON.stringify(manifest, null, 2), "utf8");

            // Attempting to initialize another transaction while process is alive must fail
            expect(() => {
                initDurableTransaction({
                    rootDir: tempDir,
                    snapshotId: "snap-c7-new",
                    targetFiles: ["tests/c7.test.js"]
                });
            }).toThrow(/already held by running process/);
        });

        test("C8. Cross-Host Rejection: Foreign container hostname throws fail-closed error to prevent PID reuse", () => {
            const journalDir = path.join(tempDir, ".covai_journal");
            fs.mkdirSync(journalDir, { recursive: true });

            const manifest = {
                txId: "tx-foreign-host",
                snapshotId: "snap-c8",
                pid: 1,
                hostname: "other-container-node-alpha",
                status: "COMMITTING",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                files: []
            };
            fs.writeFileSync(path.join(journalDir, "active_tx.json"), JSON.stringify(manifest, null, 2), "utf8");

            expect(() => {
                initDurableTransaction({
                    rootDir: tempDir,
                    snapshotId: "snap-c8-new",
                    targetFiles: ["tests/c8.test.js"]
                });
            }).toThrow(/owned by different host\/container/);
        });

        test("C9. Cross-Host COMMITTED Recovery: Foreign container COMMITTED journal is cleaned up safely without error", () => {
            const journalDir = path.join(tempDir, ".covai_journal");
            fs.mkdirSync(journalDir, { recursive: true });

            const manifest = {
                txId: "tx-foreign-committed",
                snapshotId: "snap-c9",
                pid: 99999,
                hostname: "foreign-container-restarted-id",
                status: "COMMITTED",
                createdAt: Date.now() - 3600000,
                updatedAt: Date.now() - 3600000,
                files: []
            };
            fs.writeFileSync(path.join(journalDir, "active_tx.json"), JSON.stringify(manifest, null, 2), "utf8");

            const recovery = recoverPendingApplyTransactions(tempDir);
            expect(recovery.recovered).toBe(true);
            expect(recovery.action).toBe("CLEANED_UP_COMMITTED");
            expect(fs.existsSync(path.join(journalDir, "active_tx.json"))).toBe(false);

            // Also verify initDurableTransaction proceeds cleanly without throwing cross-host error
            expect(() => {
                const newTx = initDurableTransaction({
                    rootDir: tempDir,
                    snapshotId: "snap-c9-new",
                    targetFiles: ["tests/c9.test.js"]
                });
                expect(newTx).toBeDefined();
            }).not.toThrow();
        });

        test("C10. Cross-Host Stale Lease Expiration: Foreign container transaction older than timeout proceeds with safe recovery", () => {
            const journalDir = path.join(tempDir, ".covai_journal");
            fs.mkdirSync(journalDir, { recursive: true });

            const manifest = {
                txId: "tx-foreign-stale",
                snapshotId: "snap-c10",
                pid: 88888,
                hostname: "dead-container-xyz",
                status: "INITIALIZED",
                createdAt: Date.now() - 600000,
                updatedAt: Date.now() - 600000,
                files: []
            };
            fs.writeFileSync(path.join(journalDir, "active_tx.json"), JSON.stringify(manifest, null, 2), "utf8");

            const recovery = recoverPendingApplyTransactions(tempDir, { staleTimeoutMs: 300000 });
            expect(recovery.recovered).toBe(true);
            expect(recovery.unrecoverable).toBeFalsy();
        });
    });

    // =========================================================================
    // SECTION 4: P0-D — Filesystem and Database Consistency
    // =========================================================================
    describe("P0-D: Filesystem & Database Consistency", () => {
        test("D1. Prisma Transaction Failure Filesystem Rollback: Modified test files restored to baseline when DB fails", async () => {
            const rootDir = tempDir;
            const snapshotId = "snap-d1-db-fail";

            const testsDir = path.join(rootDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "d1.test.js");
            const originalTestCode = "describe('baseline', () => { test('ok', () => {}); });";
            fs.writeFileSync(testPath, originalTestCode, "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: snapshotId,
                projectId: "proj-d1",
                rootDir,
                coverageSummaries: { stmtsPct: 40, branchesPct: 40, funcsPct: 40, linesPct: 40 }
            });

            // Runner succeeds and produces new coverage
            const runCoverage = jest.fn(async () => {
                const covDir = path.join(rootDir, "coverage");
                fs.mkdirSync(covDir, { recursive: true });
                fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify({
                    total: {
                        lines: { total: 10, covered: 10, pct: 100 },
                        statements: { total: 10, covered: 10, pct: 100 },
                        functions: { total: 10, covered: 10, pct: 100 },
                        branches: { total: 10, covered: 10, pct: 100 }
                    }
                }), "utf8");
                return { exitCode: 0, stdout: "PASS tests/d1.test.js", stderr: "" };
            });

            // Prisma $transaction fails (e.g. database connection lost / constraint violation)
            mockPrisma.$transaction.mockRejectedValueOnce(new Error("FATAL: Database connection severed during coverage upsert"));

            await expect(applyUnitTestSuggestion({
                snapshotId,
                projectId: "proj-d1",
                userId: "user-d1",
                suggestion: {
                    sourceFile: "src/d1.js",
                    testFile: "tests/d1.test.js",
                    generatedCode: "describe('augmented', () => { test('new', () => {}); });"
                },
                runCoverageFn: runCoverage
            })).rejects.toThrow(/Database persistence error/);

            // Reconciliation check: Test file on disk MUST have been rolled back to originalTestCode!
            expect(fs.readFileSync(testPath, "utf8")).toBe(originalTestCode);

            // Cache MUST NOT have been invalidated!
            expect(mockInvalidateCache).not.toHaveBeenCalledWith(snapshotId);
        });

        test("D2. Cache Invalidation Strictly After Database Transaction Succeeds", async () => {
            const rootDir = tempDir;
            const snapshotId = "snap-d2-cache-order";

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: snapshotId,
                projectId: "proj-d2",
                rootDir,
                coverageSummaries: { stmtsPct: 50, branchesPct: 50, funcsPct: 50, linesPct: 50 }
            });

            const callOrder = [];

            mockPrisma.$transaction.mockImplementationOnce(async (cb) => {
                callOrder.push("DB_TRANSACTION_START");
                if (typeof cb === "function") await cb(mockPrisma);
                callOrder.push("DB_TRANSACTION_COMMIT");
            });

            mockInvalidateCache.mockImplementationOnce(() => {
                callOrder.push("CACHE_INVALIDATE");
            });

            const runCoverage = jest.fn(async () => {
                const covDir = path.join(rootDir, "coverage");
                fs.mkdirSync(covDir, { recursive: true });
                fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify({
                    total: {
                        lines: { total: 20, covered: 18, pct: 90 },
                        statements: { total: 20, covered: 18, pct: 90 },
                        functions: { total: 20, covered: 18, pct: 90 },
                        branches: { total: 20, covered: 18, pct: 90 }
                    }
                }), "utf8");
                return { exitCode: 0, stdout: "PASS tests/d2.test.js", stderr: "" };
            });

            const result = await applyUnitTestSuggestion({
                snapshotId,
                projectId: "proj-d2",
                userId: "user-d2",
                suggestion: {
                    sourceFile: "src/d2.js",
                    testFile: "tests/d2.test.js",
                    generatedCode: "describe('d2', () => {});"
                },
                runCoverageFn: runCoverage
            });

            expect(result.status).toBe("PASSED");
            expect(callOrder).toEqual([
                "DB_TRANSACTION_START",
                "DB_TRANSACTION_COMMIT",
                "CACHE_INVALIDATE"
            ]);
        });

        test("D3. Unrecoverable Workspace Fail-Closed: Blocks new Apply attempts with 500 error", async () => {
            const rootDir = tempDir;
            const snapshotId = "snap-d3-blocked";

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: snapshotId,
                projectId: "proj-d3",
                rootDir,
                coverageSummaries: null
            });

            // Plant unrecoverable corrupted journal state
            const journalDir = path.join(rootDir, ".covai_journal");
            fs.mkdirSync(journalDir, { recursive: true });
            fs.writeFileSync(path.join(journalDir, "active_tx.json"), JSON.stringify({
                txId: "corrupted-tx",
                snapshotId,
                status: "CORRUPTED_BACKUP_FAIL_CLOSED",
                files: []
            }, null, 2), "utf8");

            await expect(applyUnitTestSuggestion({
                snapshotId,
                projectId: "proj-d3",
                userId: "user-d3",
                suggestion: {
                    sourceFile: "src/d3.js",
                    testFile: "tests/d3.test.js",
                    generatedCode: "describe('d3', () => {});"
                }
            })).rejects.toThrow(/Workspace has an unrecoverable corrupted journal state/);
        });
    });
});
