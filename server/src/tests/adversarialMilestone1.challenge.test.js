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
    captureWorkspaceFiles,
    publishPreparedWorkspace
} = await import("../services/projectWorkspacePublish.service.js");

const {
    filterExistingSetupFiles
} = await import("../services/runTestsJob.service.js");

describe("Adversarial Challenge: Milestone 1 Source Integrity & Setup Healing", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-adv-challenge-"));
        fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
        fs.mkdirSync(path.join(tempDir, "tests"), { recursive: true });
        fs.writeFileSync(path.join(tempDir, "src", "index.js"), "export const value = 42;", "utf8");
        fs.writeFileSync(path.join(tempDir, "src", "util.js"), "export const util = () => true;", "utf8");
        fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "challenge-pkg", version: "1.0.0" }, null, 2), "utf8");
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch { }
        }
    });

    describe("Edge Case 1: Deeply Nested Setup Files", () => {
        test("1.1 Deeply nested setup file at level 5 (server/tests/sub1/sub2/sub3/setup.js)", () => {
            const relSetupPath = "server/tests/sub1/sub2/sub3/setup.js";
            fs.writeFileSync(path.join(tempDir, "vitest.config.js"), `
                export default {
                    test: {
                        setupFiles: ['./${relSetupPath}']
                    }
                };
            `, "utf8");

            // Baseline hash computed before stub was present (missing setup file)
            const beforeHashes = computeSourceFilesHash(tempDir);
            expect(beforeHashes[relSetupPath]).toBeUndefined();

            // Simulate runner execution auto-healing the missing setup file
            const createdHarnessFiles = new Set();
            const result = validateVitestSetupFiles({
                rootDir: tempDir,
                directory: tempDir,
                autoHeal: true,
                createdHarnessFiles
            });

            expect(result.valid).toBe(true);
            expect(result.healed).toBe(true);

            const absSetup = path.join(tempDir, relSetupPath);
            expect(fs.existsSync(absSetup)).toBe(true);
            expect(createdHarnessFiles.has(absSetup)).toBe(true);

            // Verify that verifySourceFilesUnchanged purges deeply nested stub and reports intact
            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(true);
            expect(fs.existsSync(absSetup)).toBe(false);
        });

        test("1.2 Deeply nested TypeScript setup files (.ts, .tsx, .mts, .cts, .cjs, .mjs)", () => {
            const extensions = [".ts", ".tsx", ".mts", ".cts", ".cjs", ".mjs"];
            const beforeHashes = computeSourceFilesHash(tempDir);

            for (const ext of extensions) {
                const subPath = path.join(tempDir, "custom", "deep", "dir", `setup${ext}`);
                fs.mkdirSync(path.dirname(subPath), { recursive: true });
                fs.writeFileSync(subPath, `// [covai] auto-healed missing test setup file\nexport const dummy = 1;\n`, "utf8");
                expect(fs.existsSync(subPath)).toBe(true);
            }

            // Purge should remove ALL of them regardless of JS/TS extension
            purgeCovaiHarnessFiles(tempDir);

            for (const ext of extensions) {
                const subPath = path.join(tempDir, "custom", "deep", "dir", `setup${ext}`);
                expect(fs.existsSync(subPath)).toBe(false);
            }

            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(true);
        });

        test("1.3 Nested setup files with special characters and spaces in folder name", () => {
            const beforeHashes = computeSourceFilesHash(tempDir);

            const specialDir = path.join(tempDir, "server", "tests", "sub folder (special @v1)");
            fs.mkdirSync(specialDir, { recursive: true });
            const stubPath = path.join(specialDir, "setup.special.js");
            fs.writeFileSync(stubPath, "// [covai] auto-healed missing test setup file\n", "utf8");

            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(true);
            expect(fs.existsSync(stubPath)).toBe(false);
        });

        test("1.4 Multiple setup files in single vitest config at mixed depths", () => {
            const rel1 = "tests/setup-root.js";
            const rel2 = "server/tests/deep/setup-deep.ts";
            const rel3 = "client/tests/ui/setup-ui.js";

            fs.writeFileSync(path.join(tempDir, "vitest.config.js"), `
                export default {
                    test: {
                        setupFiles: ['./${rel1}', './${rel2}', './${rel3}']
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
            expect(result.createdStubs).toHaveLength(3);

            for (const rel of [rel1, rel2, rel3]) {
                const abs = path.join(tempDir, rel);
                expect(fs.existsSync(abs)).toBe(true);
                expect(createdHarnessFiles.has(abs)).toBe(true);
            }

            // Cleanup via purgeCovaiHarnessFiles
            purgeCovaiHarnessFiles(tempDir);

            for (const rel of [rel1, rel2, rel3]) {
                const abs = path.join(tempDir, rel);
                expect(fs.existsSync(abs)).toBe(false);
            }
        });

        test("1.5 Pre-existing lingering auto-healed stub: purge before computeSourceFilesHash preserves integrity", () => {
            const stubPath = path.join(tempDir, "server", "tests", "setup.js");
            fs.mkdirSync(path.dirname(stubPath), { recursive: true });
            fs.writeFileSync(stubPath, "// [covai] auto-healed missing test setup file\nexport default {};\n", "utf8");

            // As executed in applyUnitTestSuggestion line 3481, purging before baseline hash guarantees clean baseline:
            purgeCovaiHarnessFiles(tempDir);
            const beforeHashes = computeSourceFilesHash(tempDir);
            expect(beforeHashes["server/tests/setup.js"]).toBeUndefined();

            // Simulate test execution auto-healing the stub again
            fs.writeFileSync(stubPath, "// [covai] auto-healed missing test setup file\nexport default {};\n", "utf8");

            // Post-execution verification purges the stub and confirms integrity intact
            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(true);
            expect(fs.existsSync(stubPath)).toBe(false);
        });

        test("1.6 Pre-existing auto-healed stub when computeSourceFilesHash runs without prior manual purge preserves integrity", () => {
            const stubPath = path.join(tempDir, "server", "tests", "setup.js");
            fs.mkdirSync(path.dirname(stubPath), { recursive: true });
            fs.writeFileSync(stubPath, "// [covai] auto-healed missing test setup file\nexport default {};\n", "utf8");

            // Even without manual purge beforehand, computeSourceFilesHash purges or skips the auto-healed stub
            const beforeHashes = computeSourceFilesHash(tempDir);
            expect(beforeHashes["server/tests/setup.js"]).toBeUndefined();

            // Simulate test execution auto-healing the stub again
            fs.writeFileSync(stubPath, "// [covai] auto-healed missing test setup file\nexport default {};\n", "utf8");

            // Post-execution verification purges the stub and confirms integrity intact
            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(true);
            expect(fs.existsSync(stubPath)).toBe(false);
        });
    });

    describe("Edge Case 2: Modifications to Existing User-Authored Setup Files", () => {
        test("2.1 Modifying existing user-authored server/tests/setup.js is strictly DETECTED and BLOCKED", () => {
            // User authored setup file with genuine testing code
            const userSetup = path.join(tempDir, "server", "tests", "setup.js");
            fs.mkdirSync(path.dirname(userSetup), { recursive: true });
            fs.writeFileSync(userSetup, "// Genuine user setup file\nglobal.fetch = jest.fn();\n", "utf8");

            // Baseline captured before test run
            const beforeHashes = computeSourceFilesHash(tempDir);
            expect(beforeHashes["server/tests/setup.js"]).toBeDefined();

            // Simulate test modifying the setup file
            fs.appendFileSync(userSetup, "\nglobal.__tampered = true;\n");

            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file === "server/tests/setup.js" && f.reason === "file modified or altered")).toBe(true);

            const err = sourceIntegrityError(check);
            expect(err.statusCode).toBe(403);
            expect(err.code).toBe("SOURCE_INTEGRITY_FAILED");
        });

        test("2.2 Deleting existing user-authored setup file is strictly DETECTED and BLOCKED", () => {
            const userSetup = path.join(tempDir, "server", "tests", "setup.js");
            fs.mkdirSync(path.dirname(userSetup), { recursive: true });
            fs.writeFileSync(userSetup, "// Genuine user setup file\nconsole.log('init');\n", "utf8");

            const beforeHashes = computeSourceFilesHash(tempDir);
            expect(beforeHashes["server/tests/setup.js"]).toBeDefined();

            // Simulate test or adversary deleting the setup file
            fs.unlinkSync(userSetup);

            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file === "server/tests/setup.js" && f.reason === "file deleted from source directory")).toBe(true);
        });

        test("2.3 Adversarial attempt: Altering user setup file AND prepending // [covai] auto-healed watermark is BLOCKED", () => {
            // An adversary tries to bypass integrity by adding the covai watermark to a modified user setup file
            const userSetup = path.join(tempDir, "server", "tests", "setup.js");
            fs.mkdirSync(path.dirname(userSetup), { recursive: true });
            fs.writeFileSync(userSetup, "// Genuine user setup file\nglobal.original = true;\n", "utf8");

            const beforeHashes = computeSourceFilesHash(tempDir);
            expect(beforeHashes["server/tests/setup.js"]).toBeDefined();

            // Adversary overwrites user setup file with tampered code PLUS covai watermark
            fs.writeFileSync(userSetup, "// [covai] auto-healed\nglobal.__injected = true;\n", "utf8");

            // Even if purge unlinks it, beforeHashes had it, so it will be flagged as deleted!
            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file === "server/tests/setup.js")).toBe(true);
        });

        test("2.4 Existing user setup file is NOT overwritten by validateVitestSetupFiles", () => {
            const userSetup = path.join(tempDir, "tests", "setup.js");
            fs.mkdirSync(path.dirname(userSetup), { recursive: true });
            const originalContent = "// Genuine user setup\nexport const userConfigured = true;\n";
            fs.writeFileSync(userSetup, originalContent, "utf8");

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
            expect(result.healed).toBe(false); // Should NOT heal because file already exists!
            expect(createdHarnessFiles.size).toBe(0);

            // Content must remain untouched
            const contentAfter = fs.readFileSync(userSetup, "utf8");
            expect(contentAfter).toBe(originalContent);
        });

        test("2.5 Existing user setup file is NOT overwritten by Jest filterExistingSetupFiles", () => {
            const userSetup = path.join(tempDir, "server", "tests", "setup.js");
            fs.mkdirSync(path.dirname(userSetup), { recursive: true });
            const originalContent = "// User Jest setup\nmodule.exports = { setup: true };\n";
            fs.writeFileSync(userSetup, originalContent, "utf8");

            const createdHarnessFiles = new Set();
            const setupList = ["<rootDir>/server/tests/setup.js"];
            const filtered = filterExistingSetupFiles(setupList, tempDir, {
                rootDir: tempDir,
                autoStub: true,
                createdHarnessFiles
            });

            expect(filtered).toHaveLength(1);
            expect(createdHarnessFiles.size).toBe(0); // Not created as stub

            const contentAfter = fs.readFileSync(userSetup, "utf8");
            expect(contentAfter).toBe(originalContent);
        });
    });

    describe("Edge Case 3: Workspace Snapshot Publication Isolation", () => {
        test("3.1 captureWorkspaceFiles completely excludes lingering stubs at various depths and extensions", async () => {
            // Write legitimate files
            fs.writeFileSync(path.join(tempDir, "src", "legit.js"), "export const legit = true;", "utf8");
            fs.writeFileSync(path.join(tempDir, "tests", "legit.test.js"), "test('ok', () => {});", "utf8");

            // Write various lingering stubs
            const stub1 = path.join(tempDir, "server", "tests", "setup.js");
            const stub2 = path.join(tempDir, "tests", "sub", "setup.ts");
            const stub3 = path.join(tempDir, "covai-jest-setup.cjs");

            fs.mkdirSync(path.dirname(stub1), { recursive: true });
            fs.mkdirSync(path.dirname(stub2), { recursive: true });

            fs.writeFileSync(stub1, "// [covai] auto-healed missing test setup file\nexport default {};\n", "utf8");
            fs.writeFileSync(stub2, "// [covai] auto-healed\nexport default {};\n", "utf8");
            fs.writeFileSync(stub3, "module.exports = {};", "utf8");

            const captured = await captureWorkspaceFiles(tempDir);

            // Genuine files must be captured
            expect(captured.has("src/legit.js")).toBe(true);
            expect(captured.has("tests/legit.test.js")).toBe(true);

            // Auto-healed and covai runner files must NEVER be captured
            expect(captured.has("server/tests/setup.js")).toBe(false);
            expect(captured.has("tests/sub/setup.ts")).toBe(false);
            expect(captured.has("covai-jest-setup.cjs")).toBe(false);
        });

        test("3.2 publishPreparedWorkspace does NOT stage or publish auto-healed setup files into changes", async () => {
            // Capture before snapshot with clean workspace
            const beforeFiles = await captureWorkspaceFiles(tempDir);

            // Now simulate test run that left an auto-healed stub behind AND created a genuine test file
            fs.writeFileSync(path.join(tempDir, "tests", "new.test.js"), "test('new', () => {});", "utf8");

            const stub = path.join(tempDir, "server", "tests", "setup.js");
            fs.mkdirSync(path.dirname(stub), { recursive: true });
            fs.writeFileSync(stub, "// [covai] auto-healed missing test setup file\nexport default {};\n", "utf8");

            // Check captured afterFiles
            const afterFiles = await captureWorkspaceFiles(tempDir);
            expect(afterFiles.has("tests/new.test.js")).toBe(true);
            expect(afterFiles.has("server/tests/setup.js")).toBe(false);

            // Compute paths changed
            const paths = [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].filter(
                name => beforeFiles.get(name)?.sha256 !== afterFiles.get(name)?.sha256
            );

            expect(paths).toContain("tests/new.test.js");
            expect(paths).not.toContain("server/tests/setup.js");
        });
    });

    describe("Edge Case 4: Adversarial Injection, Tampering & Bypass Defenses", () => {
        test("4.1 Malicious new source file in src/ disguised with watermark is BLOCKED and NOT PUBLISHED", async () => {
            const beforeHashes = computeSourceFilesHash(tempDir);

            // Attacker drops a malicious file into src/ pretending to be auto-healed
            const evilFile = path.join(tempDir, "src", "backdoor.js");
            fs.writeFileSync(evilFile, "// [covai] auto-healed\nprocess.exit(1);\n", "utf8");

            // Source integrity check strictly blocks unauthorized file in src/!
            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file === "src/backdoor.js" && f.reason === "new file in source directory")).toBe(true);

            // And it cannot be captured in workspace publication
            const captured = await captureWorkspaceFiles(tempDir);
            expect(captured.has("src/backdoor.js")).toBe(false);
        });

        test("4.2 Modifying protected non-setup source file and adding watermark is STILL BLOCKED", () => {
            // An attacker modifies an existing critical source file (src/index.js) and adds the watermark
            const beforeHashes = computeSourceFilesHash(tempDir);
            expect(beforeHashes["src/index.js"]).toBeDefined();

            fs.writeFileSync(path.join(tempDir, "src", "index.js"), "// [covai] auto-healed\nexport const value = 'hacked';", "utf8");

            // Purge will delete src/index.js, or if hash changes, beforeHashes had it!
            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file === "src/index.js")).toBe(true);
        });

        test("4.3 Fake watermark (typo or mimicry) is NOT treated as stub and is BLOCKED as unauthorized new file", () => {
            const beforeHashes = computeSourceFilesHash(tempDir);

            // Dropping a file with a mimic watermark
            const fakeStub = path.join(tempDir, "tests", "fake-stub.js");
            fs.writeFileSync(fakeStub, "// [covai-fake] auto-healed missing setup\n", "utf8");

            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file === "tests/fake-stub.js" && f.reason === "new file in source directory")).toBe(true);
        });

        test("4.4 Watermark placed outside first 256 bytes is NOT treated as stub and is BLOCKED", () => {
            const beforeHashes = computeSourceFilesHash(tempDir);

            const lateWatermarkFile = path.join(tempDir, "tests", "late-watermark.js");
            // Fill 300 bytes of comments before the watermark
            const padding = "// " + "A".repeat(300) + "\n";
            fs.writeFileSync(lateWatermarkFile, padding + "// [covai] auto-healed\n", "utf8");

            const check = verifySourceFilesUnchanged(tempDir, beforeHashes);
            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file === "tests/late-watermark.js" && f.reason === "new file in source directory")).toBe(true);
        });
    });

    describe("Edge Case 5: Workspace Boundary Containment", () => {
        test("5.1 Vitest setupFiles with path traversal outside root is rejected", () => {
            fs.writeFileSync(path.join(tempDir, "vitest.config.js"), `
                export default {
                    test: {
                        setupFiles: ['../../outside.js']
                    }
                };
            `, "utf8");

            const createdHarnessFiles = new Set();
            expect(() => {
                validateVitestSetupFiles({
                    rootDir: tempDir,
                    directory: tempDir,
                    autoHeal: true,
                    createdHarnessFiles
                });
            }).toThrow(/escapes workspace root/i);
        });

        test("5.2 Jest filterExistingSetupFiles ignores path traversal outside root", () => {
            const createdHarnessFiles = new Set();
            const setupList = ["<rootDir>/../../outside.js", "../../outside2.js"];
            const filtered = filterExistingSetupFiles(setupList, tempDir, {
                rootDir: tempDir,
                autoStub: true,
                createdHarnessFiles
            });

            expect(filtered).toHaveLength(0);
            expect(createdHarnessFiles.size).toBe(0);
            expect(fs.existsSync(path.resolve(tempDir, "../../outside.js"))).toBe(false);
        });
    });
});
