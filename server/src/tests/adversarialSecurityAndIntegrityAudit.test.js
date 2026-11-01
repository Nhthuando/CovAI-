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
    applyCodeToTestFile,
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
    recoverPendingApplyTransactions
} = await import("../services/durableJournal.service.js");

describe("Adversarial Security & Integrity Audit (P0.1, P0.4, P0.5)", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-adversarial-audit-"));
        jest.clearAllMocks();
        mockPrisma.$transaction.mockImplementation(async (cb) => {
            if (typeof cb === "function") {
                return await cb(mockPrisma);
            }
            return Promise.all(cb);
        });
        activeApplyLocks.clear();
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    // =========================================================================
    // PHẦN A — P0.1: SOURCE CODE INTEGRITY & FILESYSTEM SECURITY
    // =========================================================================
    describe("P0.1 Source Code Integrity & Filesystem Security", () => {
        test("A1. Path traversal attempts with sibling directories are strictly rejected with 400", () => {
            const evilDir = tempDir + "-evil";
            fs.mkdirSync(evilDir, { recursive: true });
            try {
                const suggestion = {
                    testFile: `../${path.basename(evilDir)}/escape.test.js`,
                    generatedCode: "describe('escape', () => {});"
                };

                expect(() => {
                    applyCodeToTestFile(tempDir, suggestion);
                }).toThrow(/Path traversal forbidden/);
            } finally {
                try { fs.rmSync(evilDir, { recursive: true, force: true }); } catch (_) {}
            }
        });

        test("A2. URL-encoded traversal (%2e%2e) is strictly rejected with 400", () => {
            const suggestion = {
                testFile: "tests/%2e%2e/outside.test.js",
                generatedCode: "describe('encoded', () => {});"
            };

            expect(() => {
                applyCodeToTestFile(tempDir, suggestion);
            }).toThrow(/Path traversal forbidden/);
        });

        test("A3. Writing non-test or configuration files inside tests/ directory is strictly rejected with 403", () => {
            const forbiddenFiles = [
                "tests/package.json",
                "tests/.env",
                "tests/.env.production",
                "tests/tsconfig.json",
                "tests/schema.prisma",
                "tests/vite.config.js",
                "tests/docker-compose.yml"
            ];

            for (const badFile of forbiddenFiles) {
                expect(() => {
                    applyCodeToTestFile(tempDir, {
                        testFile: badFile,
                        generatedCode: "describe('evil', () => {});"
                    });
                }).toThrow(/Strict Storage Guard/);
            }
        });

        test("A4. computeSourceFilesHash detects modification of non-JS configuration/source files (.env, .prisma, .py)", () => {
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            const envFile = path.join(tempDir, ".env");
            const prismaFile = path.join(tempDir, "schema.prisma");
            const pythonFile = path.join(srcDir, "worker.py");

            fs.writeFileSync(envFile, "PORT=5000", "utf8");
            fs.writeFileSync(prismaFile, "model User { id Int @id }", "utf8");
            fs.writeFileSync(pythonFile, "print('hello')", "utf8");

            const beforeHashes = computeSourceFilesHash(tempDir);
            expect(beforeHashes[".env"]).toBeDefined();
            expect(beforeHashes["schema.prisma"]).toBeDefined();
            expect(beforeHashes["src/worker.py"]).toBeDefined();
            expect(beforeHashes._compositeHash).toBeDefined();

            // Modify .env
            fs.writeFileSync(envFile, "PORT=9999", "utf8");
            const verify1 = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(verify1.intact).toBe(false);
            expect(verify1.changedFiles.some(f => f.file === ".env" && f.reason.includes("modified"))).toBe(true);

            // Revert .env, modify schema.prisma
            fs.writeFileSync(envFile, "PORT=5000", "utf8");
            fs.writeFileSync(prismaFile, "model Admin { id Int @id }", "utf8");
            const verify2 = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(verify2.intact).toBe(false);
            expect(verify2.changedFiles.some(f => f.file === "schema.prisma")).toBe(true);
        });

        test("A5. computeSourceFilesHash detects deletion and creation of source files", () => {
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            const file1 = path.join(srcDir, "auth.js");
            fs.writeFileSync(file1, "export const auth = true;", "utf8");

            const before = computeSourceFilesHash(tempDir);

            // Delete file1
            fs.unlinkSync(file1);
            const verifyDel = verifySourceFilesUnchanged(tempDir, before);
            expect(verifyDel.intact).toBe(false);
            expect(verifyDel.changedFiles.some(f => f.file === "src/auth.js" && f.reason.includes("deleted"))).toBe(true);

            // Restore file1, create file2
            fs.writeFileSync(file1, "export const auth = true;", "utf8");
            const file2 = path.join(srcDir, "backdoor.js");
            fs.writeFileSync(file2, "export const backdoor = 1;", "utf8");

            const verifyCreate = verifySourceFilesUnchanged(tempDir, before);
            expect(verifyCreate.intact).toBe(false);
            expect(verifyCreate.changedFiles.some(f => f.file === "src/backdoor.js" && f.reason.includes("new file"))).toBe(true);
        });

        test("A6. computeSourceFilesHash detects symlink escape created inside source directory", () => {
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });

            const before = computeSourceFilesHash(tempDir);

            // Create a symlink inside src pointing outside tempDir
            const outsideTarget = os.tmpdir();
            const linkPath = path.join(srcDir, "evil_link");
            try {
                fs.symlinkSync(outsideTarget, linkPath, "dir");
                const after = computeSourceFilesHash(tempDir);
                const verify = verifySourceFilesUnchanged(tempDir, before);
                expect(verify.intact).toBe(false);
                expect(verify.changedFiles.some(f => f.file === "src/evil_link" || f.hashAfter?.startsWith("ESCAPE:"))).toBe(true);
            } catch (symErr) {
                // In environments where symlink creation requires elevated privileges on Windows, skip symlink creation
                if (symErr.code === "EPERM") {
                    console.warn("Skipping symlink creation test due to Windows EPERM");
                } else {
                    throw symErr;
                }
            }
        });

        test("A7. Deterministic composite hash changes if any file is touched", () => {
            const file = path.join(tempDir, "calc.js");
            fs.writeFileSync(file, "const a = 1;", "utf8");

            const h1 = computeSourceFilesHash(tempDir);
            const h2 = computeSourceFilesHash(tempDir);
            expect(h1._compositeHash).toBe(h2._compositeHash);

            fs.writeFileSync(file, "const a = 2;", "utf8");
            const h3 = computeSourceFilesHash(tempDir);
            expect(h3._compositeHash).not.toBe(h1._compositeHash);
        });

        test("A8. Fail-closed: Source integrity check fails when a file is unreadable (EACCES/EIO), and two error-tainted runs do NOT match as valid", () => {
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "service.js"), "export const s = 1;", "utf8");

            const originalRead = fs.readFileSync;
            const readSpy = jest.spyOn(fs, "readFileSync").mockImplementation((filePath, ...args) => {
                if (typeof filePath === "string" && filePath.includes("service.js")) {
                    const err = new Error("Permission denied (EACCES)");
                    err.code = "EACCES";
                    throw err;
                }
                return originalRead(filePath, ...args);
            });

            try {
                const errorHash1 = computeSourceFilesHash(tempDir);
                expect(errorHash1._compositeHash).toBeNull();
                expect(errorHash1._hasIntegrityError).toBe(true);
                expect(errorHash1._integrityStatus).toBe("FAILED");
                expect(errorHash1._readErrors.length).toBeGreaterThan(0);

                const errorHash2 = computeSourceFilesHash(tempDir);
                expect(errorHash2._compositeHash).toBeNull();

                // Two consecutive error-tainted runs must NEVER be evaluated as intact/valid!
                const verifyResult = verifySourceFilesUnchanged(tempDir, errorHash1);
                expect(verifyResult.intact).toBe(false);
                expect(verifyResult.error).toContain("fail-closed");
            } finally {
                readSpy.mockRestore();
            }
        });

        test("A9. Provenance & Sealing: Each test run generates unique runId, seals artifacts into coverage/runs/<runId>/, and writes manifest with SHA-256 hashes", async () => {
            const testsDir = path.join(tempDir, "tests");
            const srcDir = path.join(tempDir, "src");
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(covDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "calc.js"), "export const add = (a, b) => a + b;", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-provenance-test",
                projectId: "proj-prov",
                rootDir: tempDir,
                project: { id: "proj-prov", ownerId: "user-prov" },
                coverageSummaries: null
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);
            mockPrisma.coverageFile.upsert.mockResolvedValue({});
            mockPrisma.coverageSummary.upsert.mockResolvedValue({});

            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                generatedCode: "describe('calc', () => { test('adds numbers', () => { expect(1+1).toBe(2); }); });"
            };

            const result = await applyUnitTestSuggestion({
                snapshotId: "snap-provenance-test",
                projectId: "proj-prov",
                userId: "user-prov",
                suggestion,
                runCoverageFn: async ({ coverageDir }) => {
                    fs.writeFileSync(path.join(coverageDir, "coverage-final.json"), JSON.stringify({
                        "src/calc.js": { path: "src/calc.js", s: { 0: 1 }, b: {}, f: { 0: 1 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify({
                        "src/calc.js": {
                            statements: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            branches: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            lines: { total: 10, covered: 10, skipped: 0, pct: 100 }
                        },
                        total: { statements: { total: 10, covered: 10, pct: 100 }, branches: { pct: 100 }, functions: { pct: 100 }, lines: { pct: 100 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
                        status: "passed",
                        numFailedTests: 0,
                        testResults: [{ name: "tests/calc.test.js", status: "passed", numFailingTests: 0 }]
                    }), "utf8");
                }
            });

            expect(result.status).toBe("PASSED");
            expect(result.runId).toBeDefined();
            expect(result.runProvenance).toBeDefined();
            expect(result.runProvenance.runId).toBe(result.runId);

            // Verify physical directory exists with sealed artifacts and manifest
            const sealedDir = result.runProvenance.sealedRunDir;
            expect(fs.existsSync(sealedDir)).toBe(true);
            expect(fs.existsSync(path.join(sealedDir, "coverage-summary.json"))).toBe(true);
            expect(fs.existsSync(path.join(sealedDir, "coverage-final.json"))).toBe(true);
            expect(fs.existsSync(path.join(sealedDir, "manifest.json"))).toBe(true);

            const manifest = JSON.parse(fs.readFileSync(path.join(sealedDir, "manifest.json"), "utf8"));
            expect(manifest.runId).toBe(result.runId);
            expect(manifest.snapshotId).toBe("snap-provenance-test");
            expect(manifest.summarySha256).toBeDefined();
            expect(manifest.finalSha256).toBeDefined();
        });

        test("A10. Post-validation artifact tampering immunity: Altering shared coverage-summary.json does not affect persistence from sealed run directory", async () => {
            const testsDir = path.join(tempDir, "tests");
            const srcDir = path.join(tempDir, "src");
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(covDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "calc.js"), "export const add = (a, b) => a + b;", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-tamper-test",
                projectId: "proj-tamper",
                rootDir: tempDir,
                project: { id: "proj-tamper", ownerId: "user-tamper" },
                coverageSummaries: null
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);
            let capturedPersistedSummary = null;
            mockPrisma.coverageSummary.upsert.mockImplementation(async ({ create, update }) => {
                capturedPersistedSummary = update || create;
                return capturedPersistedSummary;
            });
            mockPrisma.coverageFile.upsert.mockResolvedValue({});

            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                generatedCode: "describe('calc', () => { test('ok', () => {}); });"
            };

            const result = await applyUnitTestSuggestion({
                snapshotId: "snap-tamper-test",
                projectId: "proj-tamper",
                userId: "user-tamper",
                suggestion,
                runCoverageFn: async ({ coverageDir }) => {
                    // Legitimate runner writes 100% coverage
                    fs.writeFileSync(path.join(coverageDir, "coverage-final.json"), JSON.stringify({
                        "src/calc.js": { path: "src/calc.js", s: { 0: 1 }, b: {}, f: { 0: 1 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify({
                        "src/calc.js": {
                            statements: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            branches: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            lines: { total: 10, covered: 10, skipped: 0, pct: 100 }
                        },
                        total: { statements: { total: 10, covered: 10, pct: 100 }, branches: { pct: 100 }, functions: { pct: 100 }, lines: { pct: 100 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
                        status: "passed",
                        numFailedTests: 0,
                        testResults: [{ name: "tests/calc.test.js", status: "passed", numFailingTests: 0 }]
                    }), "utf8");
                }
            });

            expect(result.status).toBe("PASSED");
            expect(result.newCoverage.statements).toBe(100);
            expect(result.runProvenance.manifest.summarySha256).toBeDefined();

            // Tamper test: mutate shared coverage-summary.json AFTER run
            fs.writeFileSync(path.join(covDir, "coverage-summary.json"), JSON.stringify({
                total: { statements: { pct: 0 }, branches: { pct: 0 }, functions: { pct: 0 }, lines: { pct: 0 } }
            }), "utf8");

            // The sealed directory still retains authentic hash and contents
            const sealedSummary = JSON.parse(fs.readFileSync(path.join(result.runProvenance.sealedRunDir, "coverage-summary.json"), "utf8"));
            expect(sealedSummary.total.statements.pct).toBe(100);
        });

        test("A11. Cross-Job Isolation: Concurrent/consecutive runs use independent sealed run directories without artifact pollution", async () => {
            const testsDir = path.join(tempDir, "tests");
            const srcDir = path.join(tempDir, "src");
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(covDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "math.js"), "export const mul = (a, b) => a * b;", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-multi-run",
                projectId: "proj-multi",
                rootDir: tempDir,
                project: { id: "proj-multi", ownerId: "user-multi" },
                coverageSummaries: null
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);
            mockPrisma.coverageFile.upsert.mockResolvedValue({});
            mockPrisma.coverageSummary.upsert.mockResolvedValue({});

            const suggestion1 = {
                sourceFile: "src/math.js",
                testFile: "tests/math1.test.js",
                generatedCode: "describe('math1', () => { test('ok', () => {}); });"
            };

            const res1 = await applyUnitTestSuggestion({
                snapshotId: "snap-multi-run",
                projectId: "proj-multi",
                userId: "user-multi",
                suggestion: suggestion1,
                runCoverageFn: async ({ coverageDir }) => {
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify({
                        total: { statements: { total: 10, covered: 8, pct: 80 }, branches: { pct: 80 }, functions: { pct: 80 }, lines: { pct: 80 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "coverage-final.json"), JSON.stringify({
                        "src/math.js": { path: "src/math.js", s: { 0: 1 }, b: {}, f: { 0: 1 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
                        status: "passed",
                        numFailedTests: 0,
                        testResults: [{ name: "tests/math1.test.js", status: "passed", numFailingTests: 0 }]
                    }), "utf8");
                }
            });

            const suggestion2 = {
                sourceFile: "src/math.js",
                testFile: "tests/math2.test.js",
                generatedCode: "describe('math2', () => { test('ok', () => {}); });"
            };

            const res2 = await applyUnitTestSuggestion({
                snapshotId: "snap-multi-run",
                projectId: "proj-multi",
                userId: "user-multi",
                suggestion: suggestion2,
                runCoverageFn: async ({ coverageDir }) => {
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify({
                        total: { statements: { total: 10, covered: 10, pct: 100 }, branches: { pct: 100 }, functions: { pct: 100 }, lines: { pct: 100 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "coverage-final.json"), JSON.stringify({
                        "src/math.js": { path: "src/math.js", s: { 0: 1 }, b: {}, f: { 0: 1 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
                        status: "passed",
                        numFailedTests: 0,
                        testResults: [{ name: "tests/math2.test.js", status: "passed", numFailingTests: 0 }]
                    }), "utf8");
                }
            });

            expect(res1.runId).not.toBe(res2.runId);
            expect(res1.runProvenance.sealedRunDir).not.toBe(res2.runProvenance.sealedRunDir);
            expect(fs.existsSync(res1.runProvenance.sealedRunDir)).toBe(true);
            expect(fs.existsSync(res2.runProvenance.sealedRunDir)).toBe(true);

            const m1 = JSON.parse(fs.readFileSync(path.join(res1.runProvenance.sealedRunDir, "manifest.json"), "utf8"));
            const m2 = JSON.parse(fs.readFileSync(path.join(res2.runProvenance.sealedRunDir, "manifest.json"), "utf8"));
            expect(m1.runId).toBe(res1.runId);
            expect(m2.runId).toBe(res2.runId);
        });
    });

    // =========================================================================
    // PHẦN B — P0.4: ATOMIC APPLY, ROLLBACK & STALE DIFF
    // =========================================================================
    describe("P0.4 Atomic Apply, Rollback & Stale Diff", () => {
        test("B1. Stale diff detection throws 409 Conflict when baseContent mismatches on-disk file", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testFile = path.join(testsDir, "user.test.js");
            fs.writeFileSync(testFile, "// version 2 on disk", "utf8");

            const suggestion = {
                testFile: "tests/user.test.js",
                baseContent: "// version 1 in suggestion",
                generatedCode: "describe('user', () => {});"
            };

            expect(() => {
                applyCodeToTestFile(tempDir, suggestion);
            }).toThrow(/Stale diff detected/);
        });

        test("B2. Stale diff detection throws 409 Conflict when file on disk was deleted since suggestions were generated", () => {
            const suggestion = {
                testFile: "tests/deleted.test.js",
                baseContent: "// existed when suggested",
                generatedCode: "describe('deleted', () => {});"
            };

            expect(() => {
                applyCodeToTestFile(tempDir, suggestion);
            }).toThrow(/Stale diff detected.*deleted from disk/);
        });

        test("B3. Stale diff detection throws 409 Conflict when baseSha256 mismatches", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testFile = path.join(testsDir, "hash.test.js");
            fs.writeFileSync(testFile, "// actual content", "utf8");

            const suggestion = {
                testFile: "tests/hash.test.js",
                baseSha256: "0000000000000000000000000000000000000000000000000000000000000000",
                generatedCode: "describe('hash', () => {});"
            };

            expect(() => {
                applyCodeToTestFile(tempDir, suggestion);
            }).toThrow(/Stale diff detected.*SHA-256 hash has changed/);
        });

        test("B4. Transactional rollback restores test files when a subsequent file in bulk apply fails", async () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const file1 = path.join(testsDir, "first.test.js");
            const originalFile1Content = "// original content 1";
            fs.writeFileSync(file1, originalFile1Content, "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-atomic",
                projectId: "proj-1",
                rootDir: tempDir,
                project: { id: "proj-1", ownerId: "user-1" },
                coverageSummaries: null
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);

            const suggestions = [
                {
                    sourceFile: "src/first.js",
                    testFile: "tests/first.test.js",
                    generatedCode: "describe('first', () => { test('ok', () => {}); });"
                },
                {
                    sourceFile: "src/second.js",
                    testFile: "../evil.test.js", // Will throw 400 Path traversal
                    generatedCode: "describe('second', () => {});"
                }
            ];

            await expect(applyUnitTestSuggestion({
                snapshotId: "snap-atomic",
                projectId: "proj-1",
                userId: "user-1",
                suggestions
            })).rejects.toThrow(/Path traversal forbidden/);

            // Verify file1 was rolled back completely to originalContent
            const currentFile1 = fs.readFileSync(file1, "utf8");
            expect(currentFile1).toBe(originalFile1Content);
        });

        test("B5. Concurrent applyUnitTestSuggestion on the same snapshot is rejected with 409 Conflict", async () => {
            mockPrisma.projectSnapshot.findUnique.mockImplementation(() => {
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve({
                            id: "snap-concurrent",
                            projectId: "proj-1",
                            rootDir: tempDir,
                            project: { id: "proj-1", ownerId: "user-1" },
                            coverageSummaries: null
                        });
                    }, 50);
                });
            });

            const suggestion = {
                sourceFile: "src/sample.js",
                testFile: "tests/sample.test.js",
                generatedCode: "describe('sample', () => {});"
            };

            const p1 = applyUnitTestSuggestion({
                snapshotId: "snap-concurrent",
                projectId: "proj-1",
                userId: "user-1",
                suggestion,
                runCoverageFn: async () => {}
            });

            // Second concurrent call immediately
            const p2 = applyUnitTestSuggestion({
                snapshotId: "snap-concurrent",
                projectId: "proj-1",
                userId: "user-1",
                suggestion,
                runCoverageFn: async () => {}
            });

            // One should succeed or reject with concurrency 409
            const results = await Promise.allSettled([p1, p2]);
            const hasConflict = results.some(r => r.status === "rejected" && r.reason?.message?.includes("Another test application"));
            expect(hasConflict).toBe(true);
        });

        test("B6. Multi-resource locking: Prevents concurrent apply jobs across different snapshots targeting same workspace or test file, and guarantees lock release on failure", async () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "calc.test.js");
            fs.writeFileSync(testPath, "// initial", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockImplementation(async ({ where }) => {
                return {
                    id: where.id,
                    projectId: "proj-shared",
                    rootDir: tempDir,
                    project: { id: "proj-shared", ownerId: "user-1" },
                    coverageSummaries: null
                };
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);

            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                generatedCode: "describe('calc', () => { test('ok', () => {}); });"
            };

            // Acquire physical workspace lock directly to simulate concurrent job running on same workspace
            const canonicalRoot = path.resolve(tempDir);
            activeApplyLocks.add(`workspace:${canonicalRoot}`);

            // Different snapshotId trying to apply on same physical workspace
            await expect(applyUnitTestSuggestion({
                snapshotId: "different-snapshot-id",
                projectId: "proj-shared",
                userId: "user-1",
                suggestion,
                runCoverageFn: async () => {}
            })).rejects.toThrow(/Another test application is currently executing on workspace/);

            // Release manual lock
            activeApplyLocks.delete(`workspace:${canonicalRoot}`);

            // Verify exception during execution releases all acquired locks cleanly in finally
            try {
                await applyUnitTestSuggestion({
                    snapshotId: "snap-fail-locks",
                    projectId: "proj-shared",
                    userId: "user-1",
                    suggestion,
                    runCoverageFn: async () => {
                        throw new Error("Runner fatal explosion");
                    }
                });
            } catch (_) {}

            // Invariant: activeApplyLocks must be completely empty after execution
            expect(activeApplyLocks.size).toBe(0);
        });

        test("B7. Atomic multi-resource locking all-or-nothing: If resource 2 is locked, resource 1 is never retained", () => {
            activeApplyLocks.clear();
            const lock1 = "workspace:/app/storage/project-alpha";
            const lock2 = "file:/app/storage/project-alpha/tests/auth.test.js";

            // Pre-lock resource 2
            activeApplyLocks.add(lock2);

            // Attempting to acquire [lock1, lock2] must fail atomically
            expect(() => {
                acquireAtomicMultiLocks([lock1, lock2]);
            }).toThrow(/Another test application is currently modifying test file/);

            // INVARIANT: lock1 was NEVER acquired or retained
            expect(activeApplyLocks.has(lock1)).toBe(false);
            expect(activeApplyLocks.has(lock2)).toBe(true);

            // Cleanup
            activeApplyLocks.delete(lock2);
            expect(activeApplyLocks.size).toBe(0);
        });

        test("B8. Path equivalence & canonicalization: Slashes, casing, and relative segments normalize to identical lock key", () => {
            activeApplyLocks.clear();
            const raw1 = path.join(tempDir, "tests", "sub", "..", "calc.test.js");
            const raw2 = tempDir.replace(/\\/g, "/") + "/tests/calc.test.js";

            const key1 = normalizeLockKey("file", raw1);
            const key2 = normalizeLockKey("file", raw2);

            expect(key1).toBe(key2);

            // Locking with key1 blocks key2
            acquireAtomicMultiLocks([key1]);
            expect(() => {
                acquireAtomicMultiLocks([key2]);
            }).toThrow(/Another test application/);

            releaseAtomicMultiLocks([key1]);
            expect(activeApplyLocks.size).toBe(0);
        });

        test("B9. Lock cleanup invariant: Locks are 100% released on any early error or exception", async () => {
            activeApplyLocks.clear();
            mockPrisma.projectSnapshot.findUnique.mockRejectedValueOnce(new Error("Prisma network timeout"));

            await expect(applyUnitTestSuggestion({
                snapshotId: "snap-lock-fail",
                projectId: "proj-1",
                userId: "user-1",
                suggestion: { sourceFile: "src/calc.js", testFile: "tests/calc.test.js" }
            })).rejects.toThrow("Prisma network timeout");

            // Even though findUnique threw, locks must be 100% released
            expect(activeApplyLocks.size).toBe(0);
        });
    });

    // =========================================================================
    // PHẦN C — P0.5: COVERAGE ARTIFACT, DATABASE & CACHE INTEGRITY
    // =========================================================================
    describe("P0.5 Coverage Artifact, Database & Cache Integrity", () => {
        test("C1. Runner failure (exitCode !== 0) strictly prevents updating CoverageSummary in database", async () => {
            const testsDir = path.join(tempDir, "tests");
            const srcDir = path.join(tempDir, "src");
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(covDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "calc.js"), "export const add = (a, b) => a + b;", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-fail",
                projectId: "proj-fail",
                rootDir: tempDir,
                project: { id: "proj-fail", ownerId: "user-fail" },
                coverageSummaries: { stmtsPct: 20, branchesPct: 20, funcsPct: 20, linesPct: 20 }
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);

            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                generatedCode: "describe('calc', () => { test('failing', () => { expect(1).toBe(2); }); });"
            };

            const result = await applyUnitTestSuggestion({
                snapshotId: "snap-fail",
                projectId: "proj-fail",
                userId: "user-fail",
                suggestion,
                runCoverageFn: async ({ coverageDir }) => {
                    // Runner failed: creates test-results with failure, exit code 1
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
                        status: "failed",
                        numFailedTests: 1,
                        testResults: [{ name: "tests/calc.test.js", status: "failed", numFailingTests: 1 }]
                    }), "utf8");
                    const err = new Error("Jest test suite failed with exit code 1");
                    throw err;
                }
            });

            // Must report failure
            expect(result.success).toBe(false);
            expect(result.status).toBe("FAILED");
            // Must NOT have upserted CoverageSummary in Prisma
            expect(mockPrisma.coverageSummary.upsert).not.toHaveBeenCalled();
            // Must NOT have upserted CoverageFile in Prisma
            expect(mockPrisma.coverageFile.upsert).not.toHaveBeenCalled();
            // Must NOT report new coverage on failure
            expect(result.newCoverage).toBeNull();
        });

        test("C2. Missing coverage-final.json strictly prevents updating CoverageSummary even if runner exits 0", async () => {
            const testsDir = path.join(tempDir, "tests");
            const srcDir = path.join(tempDir, "src");
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(covDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "calc.js"), "export const add = (a, b) => a + b;", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-nofinal",
                projectId: "proj-nofinal",
                rootDir: tempDir,
                project: { id: "proj-nofinal", ownerId: "user-nofinal" },
                coverageSummaries: { stmtsPct: 40, branchesPct: 40, funcsPct: 40, linesPct: 40 }
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);

            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                generatedCode: "describe('calc', () => { test('ok', () => { expect(1).toBe(1); }); });"
            };

            const result = await applyUnitTestSuggestion({
                snapshotId: "snap-nofinal",
                projectId: "proj-nofinal",
                userId: "user-nofinal",
                suggestion,
                runCoverageFn: async ({ coverageDir }) => {
                    // Test results say passed, but coverage-final.json is NOT generated!
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
                        status: "passed",
                        numFailedTests: 0,
                        testResults: [{ name: "tests/calc.test.js", status: "passed", numFailingTests: 0 }]
                    }), "utf8");
                }
            });

            expect(result.success).toBe(false);
            expect(mockPrisma.coverageSummary.upsert).not.toHaveBeenCalled();
            expect(result.newCoverage.statements).toBe(40);
        });

        test("C3. Stale coverage artifacts from prior runs are wiped before new runner execution", async () => {
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(covDir, { recursive: true });

            const oldFinalFile = path.join(covDir, "coverage-final.json");
            const oldSumFile = path.join(covDir, "coverage-summary.json");
            fs.writeFileSync(oldFinalFile, JSON.stringify({ stale: true }), "utf8");
            fs.writeFileSync(oldSumFile, JSON.stringify({ stale: true }), "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-wipe",
                projectId: "proj-wipe",
                rootDir: tempDir,
                project: { id: "proj-wipe", ownerId: "user-wipe" },
                coverageSummaries: null
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);

            let inspectedWipeInsideRunner = false;

            await applyUnitTestSuggestion({
                snapshotId: "snap-wipe",
                projectId: "proj-wipe",
                userId: "user-wipe",
                suggestion: {
                    sourceFile: "src/a.js",
                    testFile: "tests/a.test.js",
                    generatedCode: "describe('a', () => {});"
                },
                runCoverageFn: async ({ coverageDir }) => {
                    // Inside runner before generating new files, old files must NOT exist
                    const finalExists = fs.existsSync(path.join(coverageDir, "coverage-final.json"));
                    const sumExists = fs.existsSync(path.join(coverageDir, "coverage-summary.json"));
                    inspectedWipeInsideRunner = (!finalExists && !sumExists);
                }
            });

            expect(inspectedWipeInsideRunner).toBe(true);
        });

        test("C4. Verified coverage persistence throws 500 ServiceError if database write fails", async () => {
            const testsDir = path.join(tempDir, "tests");
            const srcDir = path.join(tempDir, "src");
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(covDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "calc.js"), "export const add = (a, b) => a + b;", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-dberr",
                projectId: "proj-dberr",
                rootDir: tempDir,
                project: { id: "proj-dberr", ownerId: "user-dberr" },
                coverageSummaries: null
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);

            // Simulate database error during upsert
            mockPrisma.coverageFile.upsert.mockRejectedValue(new Error("Prisma connection failure"));

            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                generatedCode: "describe('calc', () => { test('ok', () => {}); });"
            };

            await expect(applyUnitTestSuggestion({
                snapshotId: "snap-dberr",
                projectId: "proj-dberr",
                userId: "user-dberr",
                suggestion,
                runCoverageFn: async ({ coverageDir }) => {
                    fs.writeFileSync(path.join(coverageDir, "coverage-final.json"), JSON.stringify({
                        "src/calc.js": { path: "src/calc.js", s: { 0: 1 }, b: {}, f: { 0: 1 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify({
                        "src/calc.js": {
                            statements: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            branches: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            lines: { total: 10, covered: 10, skipped: 0, pct: 100 }
                        },
                        total: { statements: { pct: 100 }, branches: { pct: 100 }, functions: { pct: 100 }, lines: { pct: 100 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
                        status: "passed",
                        numFailedTests: 0,
                        testResults: [{ name: "tests/calc.test.js", status: "passed", numFailingTests: 0 }]
                    }), "utf8");
                }
            })).rejects.toThrow(/Database persistence error/);
        });

        test("C5. Verified coverage persistence updates CoverageSummary and returns verified status", async () => {
            const testsDir = path.join(tempDir, "tests");
            const srcDir = path.join(tempDir, "src");
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(covDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "calc.js"), "export const add = (a, b) => a + b;", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-pass",
                projectId: "proj-pass",
                rootDir: tempDir,
                project: { id: "proj-pass", ownerId: "user-pass" },
                coverageSummaries: { stmtsPct: 50, branchesPct: 50, funcsPct: 50, linesPct: 50 }
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);
            mockPrisma.coverageFile.upsert.mockResolvedValue({});
            mockPrisma.coverageSummary.upsert.mockResolvedValue({});

            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                generatedCode: "describe('calc', () => { test('ok', () => {}); });"
            };

            const result = await applyUnitTestSuggestion({
                snapshotId: "snap-pass",
                projectId: "proj-pass",
                userId: "user-pass",
                suggestion,
                runCoverageFn: async ({ coverageDir }) => {
                    fs.writeFileSync(path.join(coverageDir, "coverage-final.json"), JSON.stringify({
                        "src/calc.js": { path: "src/calc.js", s: { 0: 1 }, b: {}, f: { 0: 1 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify({
                        "src/calc.js": {
                            statements: { total: 20, covered: 19, skipped: 0, pct: 95 },
                            branches: { total: 10, covered: 9, skipped: 0, pct: 90 },
                            functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
                            lines: { total: 20, covered: 19, skipped: 0, pct: 95 }
                        },
                        total: { statements: { total: 20, covered: 19, pct: 95 }, branches: { total: 10, covered: 9, pct: 90 }, functions: { total: 2, covered: 2, pct: 100 }, lines: { total: 20, covered: 19, pct: 95 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
                        status: "passed",
                        numFailedTests: 0,
                        testResults: [{ name: "tests/calc.test.js", status: "passed", numFailingTests: 0 }]
                    }), "utf8");
                }
            });

            expect(result.success).toBe(true);
            expect(result.status).toBe("PASSED");
            expect(mockPrisma.coverageSummary.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { snapshotId: "snap-pass" },
                update: expect.objectContaining({ stmtsPct: 95, branchesPct: 90, funcsPct: 100, linesPct: 95 })
            }));
            expect(result.newCoverage.statements).toBe(95);
            expect(mockInvalidateCache).toHaveBeenCalledWith("snap-pass");
        });

        test("C6. Transactional persistence: Failure in CoverageSummary upsert aborts transaction and does NOT invalidate cache", async () => {
            const testsDir = path.join(tempDir, "tests");
            const srcDir = path.join(tempDir, "src");
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(covDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "calc.js"), "export const add = (a, b) => a + b;", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-tx-fail",
                projectId: "proj-tx",
                rootDir: tempDir,
                project: { id: "proj-tx", ownerId: "user-tx" },
                coverageSummaries: null
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);
            mockPrisma.coverageFile.upsert.mockResolvedValue({});
            // Simulate CoverageSummary failing inside transaction
            mockPrisma.coverageSummary.upsert.mockRejectedValue(new Error("Prisma constraint violation on CoverageSummary"));

            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                generatedCode: "describe('calc', () => { test('ok', () => {}); });"
            };

            await expect(applyUnitTestSuggestion({
                snapshotId: "snap-tx-fail",
                projectId: "proj-tx",
                userId: "user-tx",
                suggestion,
                runCoverageFn: async ({ coverageDir }) => {
                    fs.writeFileSync(path.join(coverageDir, "coverage-final.json"), JSON.stringify({
                        "src/calc.js": { path: "src/calc.js", s: { 0: 1 }, b: {}, f: { 0: 1 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "coverage-summary.json"), JSON.stringify({
                        "src/calc.js": {
                            statements: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            branches: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            functions: { total: 10, covered: 10, skipped: 0, pct: 100 },
                            lines: { total: 10, covered: 10, skipped: 0, pct: 100 }
                        },
                        total: { statements: { total: 10, covered: 10, pct: 100 }, branches: { total: 10, covered: 10, pct: 100 }, functions: { total: 10, covered: 10, pct: 100 }, lines: { total: 10, covered: 10, pct: 100 } }
                    }), "utf8");
                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
                        status: "passed",
                        numFailedTests: 0,
                        testResults: [{ name: "tests/calc.test.js", status: "passed", numFailingTests: 0 }]
                    }), "utf8");
                }
            })).rejects.toThrow(/Database persistence error for coverage transaction/);

            // Invariant: Cache must NEVER be invalidated when persistence transaction fails
            expect(mockInvalidateCache).not.toHaveBeenCalledWith("snap-tx-fail");
        });

        test("C7. Provenance & Freshness: Stale coverage artifact from prior run (older than run start time) is rejected and does not update DB", async () => {
            const testsDir = path.join(tempDir, "tests");
            const srcDir = path.join(tempDir, "src");
            const covDir = path.join(tempDir, "coverage");
            fs.mkdirSync(testsDir, { recursive: true });
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(covDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "calc.js"), "export const add = (a, b) => a + b;", "utf8");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-stale-art",
                projectId: "proj-stale",
                rootDir: tempDir,
                project: { id: "proj-stale", ownerId: "user-stale" },
                coverageSummaries: null
            });
            mockPrisma.coverageFile.findMany.mockResolvedValue([]);

            const suggestion = {
                sourceFile: "src/calc.js",
                testFile: "tests/calc.test.js",
                generatedCode: "describe('calc', () => { test('ok', () => {}); });"
            };

            const result = await applyUnitTestSuggestion({
                snapshotId: "snap-stale-art",
                projectId: "proj-stale",
                userId: "user-stale",
                suggestion,
                runCoverageFn: async ({ coverageDir }) => {
                    // Runner creates file with an artificially stale mtime (10 seconds in the past)
                    const staleFile = path.join(coverageDir, "coverage-summary.json");
                    fs.writeFileSync(staleFile, JSON.stringify({
                        "src/calc.js": { statements: { total: 10, covered: 10, pct: 100 } },
                        total: { statements: { total: 10, covered: 10, pct: 100 }, branches: { pct: 100 }, functions: { pct: 100 }, lines: { pct: 100 } }
                    }), "utf8");
                    const pastTime = (Date.now() - 10000) / 1000;
                    fs.utimesSync(staleFile, pastTime, pastTime);

                    fs.writeFileSync(path.join(coverageDir, "test-results.json"), JSON.stringify({
                        status: "passed",
                        numFailedTests: 0,
                        testResults: [{ name: "tests/calc.test.js", status: "passed", numFailingTests: 0 }]
                    }), "utf8");
                }
            });

            // Stale artifact must NOT be accepted as authoritative
            expect(result.status).toBe("FAILED");
            expect(mockPrisma.coverageSummary.upsert).not.toHaveBeenCalled();
            expect(mockInvalidateCache).not.toHaveBeenCalledWith("snap-stale-art");
        });

        test("C8. Durable Journal: Creates durable backup files with fsync before mutating test files on disk", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "auth.test.js");
            const origContent = "// original durable content";
            fs.writeFileSync(testPath, origContent, "utf8");

            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-journal-test",
                targetFiles: ["tests/auth.test.js"]
            });

            expect(tx.status).toBe("INITIALIZED");
            expect(tx.files.length).toBe(1);

            const fileEntry = tx.files[0];
            expect(fileEntry.originalExists).toBe(true);
            expect(fs.existsSync(fileEntry.backupPath)).toBe(true);
            expect(fs.readFileSync(fileEntry.backupPath, "utf8")).toBe(origContent);

            // Rollback cleans up and restores
            rollbackDurableTransaction({ rootDir: tempDir, tx });
            expect(fs.readFileSync(testPath, "utf8")).toBe(origContent);
        });

        test("C9. Crash Recovery: recoverPendingApplyTransactions restores corrupted partial apply without data loss (Idempotent)", () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });

            const file1 = path.join(testsDir, "unit1.test.js");
            const file2 = path.join(testsDir, "unit2.test.js");
            fs.writeFileSync(file1, "const a = 1;", "utf8");
            fs.writeFileSync(file2, "const b = 2;", "utf8");

            // Initialize transaction
            const tx = initDurableTransaction({
                rootDir: tempDir,
                snapshotId: "snap-crash-recovery",
                targetFiles: ["tests/unit1.test.js", "tests/unit2.test.js"]
            });

            // Stage new content
            stageDurableFile({ rootDir: tempDir, tx, relativePath: "tests/unit1.test.js", content: "const a = 999;" });
            stageDurableFile({ rootDir: tempDir, tx, relativePath: "tests/unit2.test.js", content: "const b = 888;" });

            // Simulate partial commit / crash: file1 was overwritten, but file2 was not committed before crash
            fs.writeFileSync(file1, "const a = 999;", "utf8");
            tx.status = "COMMITTING";
            fs.writeFileSync(path.join(tempDir, ".covai_journal", "active_tx.json"), JSON.stringify(tx, null, 2), "utf8");

            // Verify file1 is currently modified (dirty state)
            expect(fs.readFileSync(file1, "utf8")).toBe("const a = 999;");

            // Execute Crash Recovery
            const recoveryResult = recoverPendingApplyTransactions(tempDir);
            expect(recoveryResult.recovered).toBe(true);
            expect(recoveryResult.action).toBe("ROLLED_BACK");

            // Verify original contents 100% restored
            expect(fs.readFileSync(file1, "utf8")).toBe("const a = 1;");
            expect(fs.readFileSync(file2, "utf8")).toBe("const b = 2;");

            // Idempotent check: Running recovery a second time safely reports nothing pending
            const secondRecovery = recoverPendingApplyTransactions(tempDir);
            expect(secondRecovery.recovered).toBe(false);
            expect(secondRecovery.reason).toBe("No active transaction found");
        });

        test("C10. Real Child-Process Hard Crash (SIGKILL / exit 137) Simulation & Recovery", async () => {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testPath = path.join(testsDir, "crash.test.js");
            const originalText = "describe('pre-crash', () => { test('ok', () => {}); });";
            fs.writeFileSync(testPath, originalText, "utf8");

            // Create a standalone child worker script that initializes durable journal, mutates file, and terminates abruptly with exit 137 (SIGKILL equivalent)
            const workerScript = path.join(tempDir, "crash-worker.mjs");
            const durableModuleUrl = new URL("../services/durableJournal.service.js", import.meta.url).href;
            const workerCode = `
                import fs from "fs";
                import path from "path";
                import { initDurableTransaction, stageDurableFile } from "${durableModuleUrl}";

                const rootDir = process.argv[2];
                const tx = initDurableTransaction({
                    rootDir,
                    snapshotId: "snap-sigkill",
                    targetFiles: ["tests/crash.test.js"]
                });

                stageDurableFile({
                    rootDir,
                    tx,
                    relativePath: "tests/crash.test.js",
                    content: "// corrupted mid-commit text"
                });

                // Mutate file directly to simulate crash during commit
                fs.writeFileSync(path.join(rootDir, "tests/crash.test.js"), "// corrupted mid-commit text", "utf8");
                tx.status = "COMMITTING";
                fs.writeFileSync(path.join(rootDir, ".covai_journal/active_tx.json"), JSON.stringify(tx, null, 2), "utf8");

                // Abrupt hard crash: terminate immediately without catch/finally
                process.exit(137);
            `;
            fs.writeFileSync(workerScript, workerCode, "utf8");

            // Spawn the child process
            const childResult = child_process.spawnSync("node", [workerScript, tempDir], { encoding: "utf8" });
            if (childResult.status !== 137 && childResult.stderr) {
                console.error("[C10 Child Worker Error]", childResult.stderr);
            }
            expect(childResult.status).toBe(137);

            // Confirm disk was left in dirty corrupted state by crashed worker
            expect(fs.readFileSync(testPath, "utf8")).toBe("// corrupted mid-commit text");
            expect(fs.existsSync(path.join(tempDir, ".covai_journal", "active_tx.json"))).toBe(true);

            // Parent recovery routine runs
            const recovery = recoverPendingApplyTransactions(tempDir);
            expect(recovery.recovered).toBe(true);
            expect(recovery.action).toBe("ROLLED_BACK");

            // Verify file is 100% restored to originalText
            expect(fs.readFileSync(testPath, "utf8")).toBe(originalText);
            expect(fs.existsSync(path.join(tempDir, ".covai_journal", "active_tx.json"))).toBe(false);
        });
    });
});
