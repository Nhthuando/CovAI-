import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { autoHealTestFailures } from "../services/applyTestSuggestion.service.js";
import { isCollectionFailureOutput } from "../services/runTestsJob.service.js";

const traverse = traverseModule.default || traverseModule;
const allowedGlobals = new Set([
    ...Object.getOwnPropertyNames(globalThis),
    // runTestsJob only reads require behind a typeof guard.
    "require",
    "process", "Buffer", "URL", "console", "setTimeout", "clearTimeout",
    "setInterval", "clearInterval", "setImmediate", "AbortController", "AbortSignal",
    "fetch", "TextDecoder", "TextEncoder", "URLSearchParams", "structuredClone",
    "undefined", "global", "performance",
]);

// Load a fresh runner with mocks after the other services have linked their real dependencies.
jest.resetModules();
const run = jest.fn();
await jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({ dockerRunner: { run } }));
await jest.unstable_mockModule("../services/job.service.js", () => ({ addJobLog: jest.fn().mockResolvedValue() }));
const { runVitestTests } = await import("../services/vitestRunner.service.js");

test.each([
    "applyTestSuggestion.service.js",
    "runTestsJob.service.js",
    "vitestRunner.service.js",
])("%s has no undeclared identifiers", (file) => {
    const source = fs.readFileSync(new URL(`../services/${file}`, import.meta.url), "utf8");
    const ast = parse(source, { sourceType: "module" });

    traverse(ast, {
        Program(programPath) {
            const undeclared = Object.keys(programPath.scope.globals)
                .filter((name) => !allowedGlobals.has(name))
                .sort();
            expect(undeclared).toEqual([]);
        },
    });
});

describe("healing relative missing modules", () => {
    const testFile = "tests/worker.test.js";
    const rawOutput = "Cannot find module '../src/worker' from 'tests/worker.test.js'";
    let rootDir;

    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-auto-heal-"));
        fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "test-pkg" }));
        fs.mkdirSync(path.join(rootDir, "tests"));
    });

    afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

    test("adds a virtual option to a Jest mock", () => {
        const file = path.join(rootDir, testFile);
        fs.writeFileSync(file, "jest.mock('../src/worker', () => ({ port: 1 }));\ntest('a', () => { expect(1).toBe(1); });\n");

        expect(() => autoHealTestFailures(rootDir, [testFile], null, rawOutput, {})).not.toThrow();
        expect(fs.readFileSync(file, "utf8")).toContain("virtual: true");
    });

    test("preserves a Vitest mock without a Jest virtual option", () => {
        const file = path.join(rootDir, testFile);
        fs.writeFileSync(
            file,
            "import { vi, test, expect } from 'vitest';\nvi.mock('../src/worker', () => ({ port: 1 }));\ntest('a', () => { expect(1).toBe(1); });\n",
        );

        expect(() => autoHealTestFailures(rootDir, [testFile], null, rawOutput, { framework: "vitest" })).not.toThrow();
        const content = fs.readFileSync(file, "utf8");
        expect(content).toContain("vi.mock(");
        expect(content).not.toContain("jest.mock(");
        expect(content).not.toContain("virtual: true");
    });
});

describe("collection failure output", () => {
    test.each([
        [" FAIL  a.test.js\nFailed Suites 1\n Test Files  1 failed (1)\n      Tests  no tests", true],
        ["\u001b[31mFailed Suites 1\u001b[39m\n\u001b[2m      Tests \u001b[22m no tests", true],
        ["Test suite failed to run\nSyntaxError: x\nTests:       0 total", true],
        ["", false],
        [undefined, false],
        ["AssertionError: expected 1 to be 2\n Tests  1 failed | 2 passed (3)", false],
        ["Test suite failed to run\nTests:       3 passed, 3 total", false],
        ["Tests  no tests", false],
        ["Test suite failed to run\nTests:       10 total", false],
    ])("classifies %p as %p", (output, expected) => {
        expect(isCollectionFailureOutput(output)).toBe(expected);
    });
});

describe("Vitest executable resolution", () => {
    const runnerResult = { success: true, exitCode: 0, stdout: "", stderr: "" };
    let tempDir;

    const writeVitestBin = (dir) => {
        const binDir = path.join(dir, "node_modules", "vitest");
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, "vitest.mjs"), "");
    };

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-vitest-resolver-"));
        run.mockReset().mockResolvedValue(runnerResult);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("runs the local executable and returns the runner result", async () => {
        writeVitestBin(tempDir);

        await expect(runVitestTests("job", tempDir)).resolves.toBe(runnerResult);
        expect(run).toHaveBeenCalledWith(expect.objectContaining({
            snapshotPath: tempDir,
            command: 'node "node_modules/vitest/vitest.mjs" run --passWithNoTests',
        }));
    });

    test("uses the parent executable for a nested package", async () => {
        writeVitestBin(tempDir);
        const rootDir = path.join(tempDir, "pkg");
        fs.mkdirSync(rootDir);

        await runVitestTests("job", rootDir);
        expect(run).toHaveBeenCalledWith(expect.objectContaining({
            snapshotPath: rootDir,
            command: 'node "../node_modules/vitest/vitest.mjs" run --passWithNoTests',
        }));
    });

    test("falls back to npx when no Vitest executable exists", async () => {
        const rootDir = path.join(tempDir, "pkg");
        fs.mkdirSync(rootDir);
        const existsSync = fs.existsSync;
        jest.spyOn(fs, "existsSync").mockImplementation((file) =>
            file === "/app/node_modules/vitest/vitest.mjs" ? false : existsSync(file),
        );

        await runVitestTests("job", rootDir);
        expect(run).toHaveBeenCalledWith(expect.objectContaining({
            snapshotPath: rootDir,
            command: "npx --no-install vitest run --passWithNoTests",
        }));
    });

    test("preserves the custom command arguments", async () => {
        writeVitestBin(tempDir);

        await runVitestTests("job", tempDir, "vitest run --reporter=dot");
        expect(run).toHaveBeenCalledWith(expect.objectContaining({
            snapshotPath: tempDir,
            command: expect.stringMatching(/run --reporter=dot --passWithNoTests$/),
        }));
    });
});
