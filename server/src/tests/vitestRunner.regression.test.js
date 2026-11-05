import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";

const run = jest.fn();
await jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({ dockerRunner: { run } }));
await jest.unstable_mockModule("../services/job.service.js", () => ({ addJobLog: jest.fn().mockResolvedValue() }));
const { runVitestCoverage } = await import("../services/vitestRunner.service.js");

describe("Vitest coverage fallback", () => {
    let rootDir;
    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-vitest-runner-"));
        fs.mkdirSync(path.join(rootDir, "node_modules/vitest"), { recursive: true });
        fs.mkdirSync(path.join(rootDir, "node_modules/@vitest/coverage-v8"), { recursive: true });
        run.mockReset();
    });
    afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

    test.each([false, true])("preserves isolated output and globals in fallback (backend: %s)", async backend => {
        if (backend) {
            fs.mkdirSync(path.join(rootDir, "backend"));
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
