import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";

const run = jest.fn();
await jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({ dockerRunner: { run } }));
await jest.unstable_mockModule("../services/job.service.js", () => ({ addJobLog: jest.fn().mockResolvedValue() }));
const { runVitestCoverage, resolveVitestMajorVersion, getVitestWorkerArgs, runVitestWithSelfHealing } = await import("../services/vitestRunner.service.js");

describe("Vitest multi-version compatibility and self-healing", () => {
    let rootDir;
    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-vitest-runner-"));
        fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "test-pkg" }));
        const vitestDir = path.join(rootDir, "node_modules/vitest");
        fs.mkdirSync(vitestDir, { recursive: true });
        fs.writeFileSync(path.join(vitestDir, "package.json"), JSON.stringify({ name: "vitest", version: "3.2.7" }));
        fs.writeFileSync(path.join(vitestDir, "vitest.mjs"), "export default {};");
        const v8Dir = path.join(rootDir, "node_modules/@vitest/coverage-v8");
        fs.mkdirSync(v8Dir, { recursive: true });
        fs.writeFileSync(path.join(v8Dir, "package.json"), JSON.stringify({ name: "@vitest/coverage-v8", version: "3.2.7" }));
        run.mockReset();
    });
    afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

    test("resolveVitestMajorVersion correctly detects versions from node_modules and package.json", () => {
        const testDir1 = fs.mkdtempSync(path.join(os.tmpdir(), "covai-v5-"));
        const vitestPkgDir1 = path.join(testDir1, "node_modules/vitest");
        fs.mkdirSync(vitestPkgDir1, { recursive: true });
        fs.writeFileSync(path.join(vitestPkgDir1, "package.json"), JSON.stringify({ version: "5.0.1" }));
        expect(resolveVitestMajorVersion(testDir1)).toBe(5);
        expect(getVitestWorkerArgs(testDir1)).toBe("--maxWorkers=2");

        const testDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "covai-v1-"));
        const vitestPkgDir2 = path.join(testDir2, "node_modules/vitest");
        fs.mkdirSync(vitestPkgDir2, { recursive: true });
        fs.writeFileSync(path.join(vitestPkgDir2, "package.json"), JSON.stringify({ version: "1.6.1" }));
        expect(resolveVitestMajorVersion(testDir2)).toBe(1);
        expect(getVitestWorkerArgs(testDir2)).toBe("--maxWorkers=2 --minWorkers=1");

        const testDir3 = fs.mkdtempSync(path.join(os.tmpdir(), "covai-v3-pkg-"));
        fs.writeFileSync(path.join(testDir3, "package.json"), JSON.stringify({ devDependencies: { vitest: "^3.2.0" } }));
        expect(resolveVitestMajorVersion(testDir3)).toBe(3);
        expect(getVitestWorkerArgs(testDir3)).toBe("--maxWorkers=2");

        fs.rmSync(testDir1, { recursive: true, force: true });
        fs.rmSync(testDir2, { recursive: true, force: true });
        fs.rmSync(testDir3, { recursive: true, force: true });
    });

    test("runVitestWithSelfHealing heals CACError: Unknown option '--minWorkers'", async () => {
        run.mockResolvedValueOnce({
            success: false,
            exitCode: 1,
            stderr: "CACError: Unknown option `--minWorkers`\n    at Command.checkUnknownOptions",
        });
        run.mockResolvedValueOnce({
            success: true,
            exitCode: 0,
            stdout: "Tests passed cleanly",
        });

        const initialCmd = "vitest run --globals --testTimeout=10000 --maxWorkers=2 --minWorkers=1 --passWithNoTests";
        const result = await runVitestWithSelfHealing({
            snapshotPath: rootDir,
            command: initialCmd,
            timeoutMs: 10000,
            jobId: "test-job",
        });

        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls[0][0].command).toContain("--minWorkers=1");
        expect(run.mock.calls[1][0].command).not.toContain("--minWorkers");
        expect(run.mock.calls[1][0].command).toContain("--maxWorkers=2");
        expect(result.exitCode).toBe(0);
    });

    test("runVitestWithSelfHealing heals Tinypool RangeError by adding --minWorkers=1", async () => {
        run.mockResolvedValueOnce({
            success: false,
            exitCode: 1,
            stderr: "RangeError: options.minThreads and options.maxThreads must not conflict\n    at new Tinypool",
        });
        run.mockResolvedValueOnce({
            success: true,
            exitCode: 0,
            stdout: "Tests passed cleanly",
        });

        const initialCmd = "vitest run --globals --testTimeout=10000 --maxWorkers=2 --passWithNoTests";
        const result = await runVitestWithSelfHealing({
            snapshotPath: rootDir,
            command: initialCmd,
            timeoutMs: 10000,
            jobId: "test-job",
        });

        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls[0][0].command).not.toContain("--minWorkers");
        expect(run.mock.calls[1][0].command).toContain("--minWorkers=1");
        expect(result.exitCode).toBe(0);
    });

    test.each([false, true])("preserves isolated output and globals in fallback (backend: %s)", async backend => {
        if (backend) {
            fs.mkdirSync(path.join(rootDir, "backend/node_modules/vitest"), { recursive: true });
            fs.mkdirSync(path.join(rootDir, "backend/node_modules/@vitest/coverage-v8"), { recursive: true });
            fs.writeFileSync(path.join(rootDir, "backend/node_modules/vitest/package.json"), JSON.stringify({ name: "vitest", version: "3.2.7" }));
            fs.writeFileSync(path.join(rootDir, "backend/node_modules/vitest/vitest.mjs"), "export default {};");
            fs.writeFileSync(path.join(rootDir, "backend/node_modules/@vitest/coverage-v8/package.json"), JSON.stringify({ name: "@vitest/coverage-v8", version: "3.2.7" }));
            fs.writeFileSync(path.join(rootDir, "backend/package.json"), "{}");
        }
        const coverageDir = path.join(rootDir, "coverage/runs/current-run");
        const resultsFile = path.join(coverageDir, "vitest-results.json");
        const writes = [];
        run.mockImplementation(async ({ command }) => {
            const relativeOutput = command.match(/--outputFile=([^\s]+)/)[1];
            const outputPath = path.resolve(backend ? path.join(rootDir, "backend") : rootDir, relativeOutput);
            writes.push(outputPath);
            if (writes.length === 1) {
                fs.writeFileSync(outputPath, JSON.stringify({ success: false, numFailedTests: 1 }));
                return { success: false, exitCode: 1, stderr: "Error: coverage provider failed" };
            }
            // An older report must not survive a retry.
            expect(fs.existsSync(resultsFile)).toBe(false);
            fs.writeFileSync(outputPath, JSON.stringify({ success: true, numPassedTests: 1 }));
            return { success: true, exitCode: 0, stderr: `JSON report written to ${outputPath}` };
        });
        const target = backend ? "backend/tests/math.test.js" : "tests/math.test.js";
        const result = await runVitestCoverage(null, rootDir, null, [target], { coverageDir });
        expect(writes).toEqual([resultsFile, resultsFile]);
        expect(run.mock.calls[0][0].command).toContain("--globals");
        expect(run.mock.calls[1][0].command).toContain("--globals --coverage.enabled=false");
        for (const [args] of run.mock.calls) expect(args.command).toContain("--reporter=default --reporter=json");
        expect(result.exitCode).toBe(0);
        expect(result.coverageDir).toBe(coverageDir);
        expect(JSON.parse(fs.readFileSync(resultsFile, "utf8")).success).toBe(true);
    });

    test("does not import stale backend results into an isolated failed run", async () => {
        const legacyDir = path.join(rootDir, "backend/coverage");
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.mkdirSync(path.join(rootDir, "backend/node_modules/vitest"), { recursive: true });
        fs.mkdirSync(path.join(rootDir, "backend/node_modules/@vitest/coverage-v8"), { recursive: true });
        fs.writeFileSync(path.join(rootDir, "backend/node_modules/vitest/package.json"), JSON.stringify({ name: "vitest", version: "3.2.7" }));
        fs.writeFileSync(path.join(rootDir, "backend/node_modules/vitest/vitest.mjs"), "export default {};");
        fs.writeFileSync(path.join(rootDir, "backend/node_modules/@vitest/coverage-v8/package.json"), JSON.stringify({ name: "@vitest/coverage-v8", version: "3.2.7" }));
        fs.writeFileSync(path.join(rootDir, "backend/package.json"), "{}");
        fs.writeFileSync(path.join(legacyDir, "vitest-results.json"), JSON.stringify({ success: true, numPassedTests: 10 }));
        run.mockResolvedValueOnce({ success: true, exitCode: 0, stdout: "No report generated" });
        run.mockResolvedValueOnce({ success: false, exitCode: 1, stderr: "Error: Worker crashed" });
        const coverageDir = path.join(rootDir, "coverage/runs/failed-run");
        const result = await runVitestCoverage(null, rootDir, null, ["backend/tests/math.test.js"], { coverageDir });
        expect(run).toHaveBeenCalledTimes(2);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toBe("Error: Worker crashed");
        expect(fs.existsSync(path.join(coverageDir, "vitest-results.json"))).toBe(false);
    });
});
