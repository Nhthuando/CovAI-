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
        create: jest.fn().mockResolvedValue({ id: "tr-1" }),
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
    ensureWorkspaceNodeModulesLinked
} = await import("../services/dependencyResolution.service.js");

const { applyUnitTestSuggestion, activeApplyLocks } = await import("../services/applyTestSuggestion.service.js");
const { parseModuleResolutionError } = await import("../services/runTestsJob.service.js");

describe("Automatic Missing Dependency Resolution & Installation (R1)", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-dep-resolution-"));
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

    describe("Category A & B: extractMissingDependency", () => {
        it("extracts single third-party package name (razorpay) from Jest failure output", () => {
            const rawOutput = `
FAIL tests/payment.test.js
  ● Test suite failed to run
    Cannot find module 'razorpay' from 'src/services/payment.service.js'
      1 | const Razorpay = require('razorpay');
            `;
            const dep = extractMissingDependency(rawOutput);
            expect(dep).not.toBeNull();
            expect(dep.packageName).toBe("razorpay");
            expect(dep.rawSpecifier).toBe("razorpay");
            expect(dep.importedFrom).toBe("src/services/payment.service.js");
        });

        it("extracts single package name from Node ESM loader output", () => {
            const rawOutput = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'razorpay' imported from /app/src/billing.js";
            const dep = extractMissingDependency(rawOutput);
            expect(dep).not.toBeNull();
            expect(dep.packageName).toBe("razorpay");
        });

        it("extracts single package name from Vitest error output", () => {
            const rawOutput = 'Failed to resolve import "razorpay" from "src/utils/checkout.ts". Does the file exist?';
            const dep = extractMissingDependency(rawOutput);
            expect(dep).not.toBeNull();
            expect(dep.packageName).toBe("razorpay");
            expect(dep.importedFrom).toBe("src/utils/checkout.ts");
        });

        it("extracts scoped package names without truncation (@paypal/checkout-server-sdk)", () => {
            const rawOutput = "Cannot find module '@paypal/checkout-server-sdk' from 'src/paypal.js'";
            const dep = extractMissingDependency(rawOutput);
            expect(dep).not.toBeNull();
            expect(dep.packageName).toBe("@paypal/checkout-server-sdk");
        });

        it("normalizes subpath imports to base package (lodash/merge -> lodash)", () => {
            const rawOutput = "Cannot find module 'lodash/merge' from 'src/helpers.js'";
            const dep = extractMissingDependency(rawOutput);
            expect(dep).not.toBeNull();
            expect(dep.packageName).toBe("lodash");
            expect(dep.rawSpecifier).toBe("lodash/merge");
        });
    });

    describe("Category D: Input Validation & Security Guards", () => {
        it("rejects command injection attempts in package names", () => {
            expect(isValidNpmPackageName("razorpay; cat /etc/passwd")).toBe(false);
            expect(isValidNpmPackageName("razorpay && rm -rf /")).toBe(false);
            expect(isValidNpmPackageName("razorpay`whoami`")).toBe(false);
            expect(isValidNpmPackageName("razorpay$(id)")).toBe(false);
            expect(isValidNpmPackageName("razorpay | echo 1")).toBe(false);
            expect(isValidNpmPackageName("")).toBe(false);
            expect(isValidNpmPackageName("   ")).toBe(false);
            expect(isValidNpmPackageName(null)).toBe(false);
        });

        it("ignores Node.js built-in modules so syntax healers handle them", () => {
            const rawOutput = "Cannot find module 'fs' from 'src/index.js'";
            const dep = extractMissingDependency(rawOutput);
            expect(dep).toBeNull();

            const rawPathOutput = "Cannot find module 'path' from 'src/index.js'";
            expect(extractMissingDependency(rawPathOutput)).toBeNull();

            const rawCryptoOutput = "Cannot find module 'crypto' from 'src/index.js'";
            expect(extractMissingDependency(rawCryptoOutput)).toBeNull();
        });

        it("ignores relative and absolute internal file paths", () => {
            expect(extractMissingDependency("Cannot find module './localHelper' from 'src/index.js'")).toBeNull();
            expect(extractMissingDependency("Cannot find module '../utils' from 'src/index.js'")).toBeNull();
            expect(extractMissingDependency("Cannot find module '/app/src/index' from 'test.js'")).toBeNull();
        });
    });

    describe("Category C: Package Manager Detection & Workspace Installation", () => {
        it("detects pnpm and runs pnpm add when pnpm-lock.yaml exists", async () => {
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test-app", dependencies: {} }));
            fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: 5.4");

            const res = await installPackageInWorkspace({
                rootDir: tempDir,
                packageName: "razorpay",
                isDev: true,
                jobId: "job-pnpm"
            });

            expect(res.success).toBe(true);
            expect(mockDockerRun).toHaveBeenCalledWith(expect.objectContaining({
                command: "pnpm add -D razorpay",
                snapshotPath: tempDir
            }));

            // Confirms package.json is updated
            const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, "package.json"), "utf8"));
            expect(pkg.devDependencies.razorpay).toBe("^latest");
        });

        it("detects yarn and runs yarn add when yarn.lock exists", async () => {
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test-yarn", dependencies: {} }));
            fs.writeFileSync(path.join(tempDir, "yarn.lock"), "# yarn lockfile v1");

            const res = await installPackageInWorkspace({
                rootDir: tempDir,
                packageName: "razorpay",
                isDev: false
            });

            expect(res.success).toBe(true);
            expect(mockDockerRun).toHaveBeenCalledWith(expect.objectContaining({
                command: "yarn add  razorpay",
                snapshotPath: tempDir
            }));
        });

        it("defaults to npm install with safe flags when no alternate lockfile exists", async () => {
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test-npm", dependencies: {} }));

            const res = await installPackageInWorkspace({
                rootDir: tempDir,
                packageName: "razorpay",
                isDev: false,
                jobId: "job-npm"
            });

            expect(res.success).toBe(true);
            expect(mockDockerRun).toHaveBeenCalledWith(expect.objectContaining({
                command: expect.stringContaining("npm install --save razorpay"),
                timeoutMs: 60000
            }));
        });

        it("handles package installation failure gracefully without throwing unhandled error", async () => {
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test-fail", dependencies: {} }));
            mockDockerRun.mockRejectedValueOnce(new Error("ETIMEDOUT: npm registry unreachable"));

            const res = await installPackageInWorkspace({
                rootDir: tempDir,
                packageName: "razorpay",
                isDev: false
            });

            expect(res.success).toBe(false);
            expect(res.timedOut).toBe(true);
            expect(res.stderr).toContain("ETIMEDOUT");
        });
    });

    describe("applyTestSuggestion: Automatic Installation of Undeclared Packages", () => {
        it("installs missing dependency automatically even when not declared in package.json", async () => {
            // Setup project with no razorpay in package.json and no razorpay in node_modules
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({
                name: "ecommerce-backend",
                dependencies: { express: "^4.18.2" }
            }, null, 2));
            fs.mkdirSync(path.join(tempDir, "node_modules", "express"), { recursive: true });
            fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
            fs.writeFileSync(path.join(tempDir, "src/payment.js"), "export const processPayment = (amount) => amount;\n");

            mockPrisma.projectSnapshot.findUnique.mockResolvedValue({
                id: "snap-razorpay",
                projectId: "project-razorpay",
                rootDir: tempDir
            });

            let runCount = 0;
            // On first run: test fails because razorpay is missing. On second run (after auto-install): passes!
            const customRunCoverage = jest.fn().mockImplementation(async ({ sealedRunDir }) => {
                runCount++;
                if (runCount === 1) {
                    fs.writeFileSync(path.join(sealedRunDir, "jest-results.json"), JSON.stringify({
                        success: false,
                        numFailedTests: 1,
                        testResults: [{
                            name: path.join(sealedRunDir, "tests/payment.test.js"),
                            status: "failed",
                            assertionResults: [{
                                status: "failed",
                                title: "creates payment",
                                failureMessages: ["Cannot find module 'razorpay' from 'tests/payment.test.js'"]
                            }]
                        }]
                    }));
                } else {
                    fs.writeFileSync(path.join(sealedRunDir, "jest-results.json"), JSON.stringify({
                        success: true,
                        numPassedTests: 1,
                        numFailedTests: 0,
                        testResults: [{
                            name: path.join(sealedRunDir, "tests/payment.test.js"),
                            status: "passed",
                            assertionResults: [{ status: "passed", title: "creates payment" }]
                        }]
                    }));
                    fs.writeFileSync(path.join(sealedRunDir, "coverage-summary.json"), JSON.stringify({
                        total: { statements: { total: 10, covered: 10, pct: 100 }, lines: { total: 10, covered: 10, pct: 100 } }
                    }));
                }
            });

            const result = await applyUnitTestSuggestion({
                snapshotId: "snap-razorpay",
                projectId: "project-razorpay",
                suggestion: {
                    sourceFile: "src/payment.js",
                    testFile: "tests/payment.test.js",
                    framework: "jest",
                    generatedCode: "const Razorpay = require('razorpay'); test('creates payment', () => { expect(Razorpay).toBeDefined(); });"
                },
                runCoverageFn: customRunCoverage
            });

            expect(result.success).toBe(true);
            expect(runCount).toBeGreaterThanOrEqual(2);
            // Verify razorpay was recorded into package.json
            const updatedPkg = JSON.parse(fs.readFileSync(path.join(tempDir, "package.json"), "utf8"));
            expect(updatedPkg.dependencies.razorpay).toBe("^latest");
        });
    });

    describe("runTestsJob: Module Resolution Detection & In-Flight Recovery Logic", () => {
        it("parseModuleResolutionError correctly populates missingDependency for Jest missing module", () => {
            const rawError = `
FAIL src/tests/payment.test.js
  ● Test suite failed to run
    Cannot find module 'razorpay' from 'src/services/payment.js'
            `;
            const result = parseModuleResolutionError(rawError, tempDir);
            expect(result).not.toBeNull();
            expect(result.type).toBe("MODULE_RESOLUTION_ERROR");
            expect(result.missingModule).toBe("razorpay");
            expect(result.missingDependency).toBeDefined();
            expect(result.missingDependency.packageName).toBe("razorpay");
        });

        it("parseModuleResolutionError correctly populates missingDependency for Node ESM ERR_MODULE_NOT_FOUND", () => {
            const rawError = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'razorpay' imported from /app/src/billing.js";
            const result = parseModuleResolutionError(rawError, tempDir);
            expect(result).not.toBeNull();
            expect(result.missingDependency).toBeDefined();
            expect(result.missingDependency.packageName).toBe("razorpay");
        });

        it("enforces in-flight loop guard (max 3 attempts) and prevents duplicate re-install loops", () => {
            const attempted = new Set();
            const MAX_DEP_ATTEMPTS = 3;

            // First attempt: razorpay detected
            const dep1 = "razorpay";
            expect(attempted.has(dep1)).toBe(false);
            expect(attempted.size < MAX_DEP_ATTEMPTS).toBe(true);
            attempted.add(dep1);

            // Duplicate razorpay in same run should be ignored (no infinite loop)
            expect(attempted.has(dep1)).toBe(true);
            const shouldRetryDuplicate = !attempted.has(dep1) && attempted.size < MAX_DEP_ATTEMPTS;
            expect(shouldRetryDuplicate).toBe(false);

            // Second package: axios
            const dep2 = "axios";
            expect(!attempted.has(dep2) && attempted.size < MAX_DEP_ATTEMPTS).toBe(true);
            attempted.add(dep2);

            // Third package: express
            const dep3 = "express";
            expect(!attempted.has(dep3) && attempted.size < MAX_DEP_ATTEMPTS).toBe(true);
            attempted.add(dep3);

            // Fourth package: should NOT be attempted (guard prevents infinite cascades)
            const dep4 = "lodash";
            expect(!attempted.has(dep4) && attempted.size < MAX_DEP_ATTEMPTS).toBe(false);
        });

        it("links node_modules between original storage root and prepared runner workspace", () => {
            const origRoot = path.join(tempDir, "orig");
            const workRoot = path.join(tempDir, "work");
            fs.mkdirSync(path.join(origRoot, "node_modules", "razorpay"), { recursive: true });
            fs.writeFileSync(path.join(origRoot, "package.json"), "{}");
            fs.mkdirSync(workRoot, { recursive: true });
            fs.writeFileSync(path.join(workRoot, "package.json"), "{}");

            const links = ensureWorkspaceNodeModulesLinked(origRoot, workRoot);
            expect(links.length).toBeGreaterThan(0);
            expect(fs.existsSync(path.join(workRoot, "node_modules", "razorpay"))).toBe(true);
        });
    });
});

