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
    job: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    jobLog: { create: jest.fn().mockResolvedValue({}) },
    projectSnapshot: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    coverageSummary: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    coverageFile: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn().mockResolvedValue({}) }
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
    isLegitimateSetupFilePath,
    sourceIntegrityError
} = await import("../services/applyTestSuggestion.service.js");

const {
    runVitestCoverage
} = await import("../services/vitestRunner.service.js");

describe("Milestone 1 Adversarial Empirical Challenge Suite", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-adversarial-chal-"));
        fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
        fs.writeFileSync(path.join(tempDir, "src", "index.js"), "console.log('original');", "utf8");
        fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test-pkg", version: "1.0.0" }, null, 2), "utf8");
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch { }
        }
    });

    describe("Vulnerability Demonstrations (Remediated Protections)", () => {
        test("VULNERABILITY 1: Source file tampering bypass via watermark injection in src/malicious.js is BLOCKED", () => {
            const before = computeSourceFilesHash(tempDir);
            expect(before._compositeHash).toBeTruthy();

            // Attacker or rogue test creates an unauthorized source file in src/malicious.js
            // prepending '// [covai] auto-healed'
            const malPath = path.join(tempDir, "src", "malicious.js");
            fs.writeFileSync(
                malPath,
                "// [covai] auto-healed\nexport function backdoor() { return 'PWNED'; }\n",
                "utf8"
            );

            const check = verifySourceFilesUnchanged(tempDir, before);

            // REMEDIATED BEHAVIOR:
            // Arbitrary application code in src/ must NEVER be whitelisted even with watermark!
            // It must be strictly detected and blocked as an illegal new file!
            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file === "src/malicious.js" && f.reason === "new file in source directory")).toBe(true);
        });

        test("VULNERABILITY 2: Application source files in src/ containing watermark text are NOT purged", () => {
            // A developer writes legitimate source code or documentation mentioning the watermark
            const appDocPath = path.join(tempDir, "src", "autoHealDocs.js");
            fs.writeFileSync(
                appDocPath,
                "// [covai] auto-healed logic is documented in this module\nexport const doc = true;\n",
                "utf8"
            );

            expect(fs.existsSync(appDocPath)).toBe(true);

            // purgeCovaiHarnessFiles recursively sweeps the directory
            purgeCovaiHarnessFiles(tempDir);

            // REMEDIATED BEHAVIOR:
            // purgeCovaiHarnessFiles must NOT delete files in src/!
            expect(fs.existsSync(appDocPath)).toBe(true);
        });

        test("VULNERABILITY 3: Non-src application files (controllers/setupUser.js, app/setupRoutes.js) with watermark are strictly BLOCKED", () => {
            const before = computeSourceFilesHash(tempDir);

            // Attacker injects backdoors into non-src directories pretending to be setup stubs
            fs.mkdirSync(path.join(tempDir, "controllers"), { recursive: true });
            fs.mkdirSync(path.join(tempDir, "app"), { recursive: true });

            const ctlPath = path.join(tempDir, "controllers", "setupUser.js");
            fs.writeFileSync(ctlPath, "// [covai] auto-healed\nexport function setupUser() { return 'evil'; }\n", "utf8");

            const appPath = path.join(tempDir, "app", "setupRoutes.js");
            fs.writeFileSync(appPath, "// [covai] auto-healed\nexport function setupRoutes() { return 'evil'; }\n", "utf8");

            const check = verifySourceFilesUnchanged(tempDir, before);

            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file === "controllers/setupUser.js" && f.reason === "new file in source directory")).toBe(true);
            expect(check.changedFiles.some(f => f.file === "app/setupRoutes.js" && f.reason === "new file in source directory")).toBe(true);
        });

        test("VULNERABILITY 4: Non-src application files starting with setup containing watermark are NOT purged", () => {
            fs.mkdirSync(path.join(tempDir, "app"), { recursive: true });
            fs.mkdirSync(path.join(tempDir, "lib"), { recursive: true });

            const appFile = path.join(tempDir, "app", "setupRoutes.js");
            fs.writeFileSync(appFile, "// [covai] auto-healed documentation and configuration\nexport const routes = [];\n", "utf8");

            const libFile = path.join(tempDir, "lib", "setupDatabase.js");
            fs.writeFileSync(libFile, "// [covai] auto-healed db init helper\nexport const db = {};\n", "utf8");

            expect(fs.existsSync(appFile)).toBe(true);
            expect(fs.existsSync(libFile)).toBe(true);

            purgeCovaiHarnessFiles(tempDir);

            expect(fs.existsSync(appFile)).toBe(true);
            expect(fs.existsSync(libFile)).toBe(true);
        });
    });

    describe("Verified Robust Protections", () => {
        test("PROTECTION 1: Modifying an existing source file is strictly blocked even with watermark", () => {
            const before = computeSourceFilesHash(tempDir);

            // Modifying an existing file (src/index.js)
            fs.writeFileSync(
                path.join(tempDir, "src", "index.js"),
                "// [covai] auto-healed\nconsole.log('modified');",
                "utf8"
            );

            const check = verifySourceFilesUnchanged(tempDir, before);

            // Strictly blocked!
            expect(check.intact).toBe(false);
            expect(check.changedFiles.some(f => f.file === "src/index.js")).toBe(true);
        });

        test("PROTECTION 2: Legitimate setup file stub in tests/setup.js is cleaned and passes integrity", () => {
            const before = computeSourceFilesHash(tempDir);

            const setupPath = path.join(tempDir, "tests", "setup.js");
            fs.mkdirSync(path.dirname(setupPath), { recursive: true });
            fs.writeFileSync(
                setupPath,
                "// [covai] auto-healed missing test setup file\nexport default {};\n",
                "utf8"
            );

            const check = verifySourceFilesUnchanged(tempDir, before);

            expect(check.intact).toBe(true);
            expect(fs.existsSync(setupPath)).toBe(false);
        });

        test("PROTECTION 3: Runner teardown cleans up createdHarnessFiles in finally block even on fatal runner crash", async () => {
            fs.writeFileSync(path.join(tempDir, "vitest.config.js"), `
                export default {
                    test: { setupFiles: ['./tests/setup.js'] }
                };
            `, "utf8");

            // Simulate crash during execution
            run.mockRejectedValueOnce(new Error("FATAL ENGINE CRASH"));

            const createdHarnessFiles = new Set();
            const options = {
                createdHarnessFiles,
                cleanupStubs: true,
                executionDir: tempDir
            };

            const setupPath = path.join(tempDir, "tests", "setup.js");

            await expect(
                runVitestCoverage("job-crash", tempDir, "npx vitest run", [], options)
            ).rejects.toThrow("FATAL ENGINE CRASH");

            // The finally block must have unlinked the setup stub from disk
            expect(fs.existsSync(setupPath)).toBe(false);
        });

        test("PROTECTION 4: Legitimate setup file stubs in src/setupTests.js and src/setup.ts are cleaned and pass integrity", () => {
            const before = computeSourceFilesHash(tempDir);

            // Auto-heal Create React App / Vite setup files in src/
            const craSetup = path.join(tempDir, "src", "setupTests.js");
            const tsSetup = path.join(tempDir, "src", "setup.ts");

            fs.writeFileSync(craSetup, "// [covai] auto-healed missing test setup file\nexport default {};\n", "utf8");
            fs.writeFileSync(tsSetup, "// [covai] auto-healed missing test setup file\nexport default {};\n", "utf8");

            const check = verifySourceFilesUnchanged(tempDir, before);

            expect(check.intact).toBe(true);
            expect(fs.existsSync(craSetup)).toBe(false);
            expect(fs.existsSync(tsSetup)).toBe(false);
        });

        test("PROTECTION 5: isLegitimateSetupFilePath accurately discriminates legitimate setup stubs from application source files", () => {
            // Legitimate setups
            expect(isLegitimateSetupFilePath(tempDir, "src/setupTests.js")).toBe(true);
            expect(isLegitimateSetupFilePath(tempDir, "src/setup.ts")).toBe(true);
            expect(isLegitimateSetupFilePath(tempDir, "src/setup-tests.js")).toBe(true);
            expect(isLegitimateSetupFilePath(tempDir, "src/tests/setup.js")).toBe(true);
            expect(isLegitimateSetupFilePath(tempDir, "tests/setup.js")).toBe(true);
            expect(isLegitimateSetupFilePath(tempDir, "server/tests/deep/setup.js")).toBe(true);
            expect(isLegitimateSetupFilePath(tempDir, "setup.js")).toBe(true);
            expect(isLegitimateSetupFilePath(tempDir, "vitest.setup.js")).toBe(true);
            expect(isLegitimateSetupFilePath(tempDir, "jest.setup.ts")).toBe(true);

            // Application files that must NEVER be considered setup stubs
            expect(isLegitimateSetupFilePath(tempDir, "controllers/setupUser.js")).toBe(false);
            expect(isLegitimateSetupFilePath(tempDir, "controllers/setup.js")).toBe(false);
            expect(isLegitimateSetupFilePath(tempDir, "app/setupRoutes.js")).toBe(false);
            expect(isLegitimateSetupFilePath(tempDir, "app/setupBackdoor.js")).toBe(false);
            expect(isLegitimateSetupFilePath(tempDir, "lib/setupDatabase.js")).toBe(false);
            expect(isLegitimateSetupFilePath(tempDir, "scripts/setupDatabase.js")).toBe(false);
            expect(isLegitimateSetupFilePath(tempDir, "src/malicious.js")).toBe(false);
            expect(isLegitimateSetupFilePath(tempDir, "src/autoHealDocs.js")).toBe(false);
            expect(isLegitimateSetupFilePath(tempDir, "src/setupUser.js")).toBe(false);
            expect(isLegitimateSetupFilePath(tempDir, "src/auth/setup.js")).toBe(false);
        });
    });
});
