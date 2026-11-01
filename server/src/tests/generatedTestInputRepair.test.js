import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";

const generateText = jest.fn();
await jest.unstable_mockModule("../services/gemini.service.js", () => ({ generateText }));
const prisma = { projectSnapshot: { findUnique: jest.fn() }, coverageFile: { findMany: jest.fn().mockResolvedValue([]) } };
await jest.unstable_mockModule("../config/prisma.js", () => ({ default: prisma, prisma }));
const { repairGeneratedTestInputs } = await import("../services/generatedTestInputRepair.service.js");
const { applyUnitTestSuggestion, activeApplyLocks, getTestRunnerFailure } = await import("../services/applyTestSuggestion.service.js");
const serverDir = fileURLToPath(new URL("../../", import.meta.url));

// A real guard/parse/type-check chain, independent of any uploaded project or math library.
const source = `export function readNumber(input) {
  if (!/^[0-9nulfase\\s]+$/.test(input)) return { result: '', error: 'invalid characters' };
  const value = JSON.parse(input);
  if (typeof value !== 'number') return { result: '', error: 'non-number result' };
  return { result: String(value) };
}`;
const code = `import { describe, test, expect } from 'vitest';
import { readNumber } from '../src/number.js';
describe('readNumber', () => {
  test('rejects non-number results', () => {
    const res = readNumber('1 > 0');
    expect(res).toEqual({ result: '', error: 'non-number result' });
  });
  test('reads numbers', () => { expect(readNumber('12')).toEqual({ result: '12' }); });
});`;

describe("source-aware generated test input repair", () => {
    let rootDir, testFile, suggestion, failedReport;
    beforeEach(() => {
        generateText.mockReset();
        rootDir = fs.mkdtempSync(path.join(serverDir, ".input-repair-runtime-"));
        fs.mkdirSync(path.join(rootDir, "src"));
        fs.mkdirSync(path.join(rootDir, "tests"));
        fs.writeFileSync(path.join(rootDir, "src/number.js"), source);
        fs.writeFileSync(path.join(rootDir, "package.json"), '{"type":"module"}');
        fs.writeFileSync(path.join(rootDir, "vitest.config.mjs"), "export default { test: { include: ['tests/*.test.js'], maxWorkers: 1, fileParallelism: false } };\n");
        testFile = path.join(rootDir, "tests/number.test.js");
        fs.writeFileSync(testFile, code);
        suggestion = { sourceFile: "src/number.js", testFile: "tests/number.test.js", generatedCode: code, framework: "vitest" };
        failedReport = { success: false, numFailedTests: 1, testResults: [{ name: testFile, status: "failed", assertionResults: [{
            fullName: "readNumber rejects non-number results", title: "rejects non-number results", status: "failed",
            failureMessages: ["AssertionError: expected { result: '', …(1) } to deeply equal { result: '', …(1) }"]
        }] }] };
        prisma.projectSnapshot.findUnique.mockResolvedValue({ id: "input-snap", projectId: "input-project", rootDir });
    });
    afterEach(() => {
        activeApplyLocks.clear();
        fs.rmSync(rootDir, { recursive: true, force: true });
    });
    const response = args => JSON.stringify({ repairs: [{ callId: 0, arguments: args, reason: "null passes the character guard and JSON.parse returns a non-number." }] });
    const repair = () => repairGeneratedTestInputs({ rootDir, suggestions: [suggestion], testResults: failedReport });

    test("changes only the selected input; retains assertions, passing tests and source", async () => {
        generateText.mockResolvedValue(response(["null"]));
        const repairs = await repair();
        expect(repairs).toHaveLength(1);
        expect(fs.readFileSync(testFile, "utf8")).toBe(code.replace("'1 > 0'", '"null"'));
        expect(fs.readFileSync(path.join(rootDir, "src/number.js"), "utf8")).toBe(source);
        expect(generateText.mock.calls[0][0]).toContain(source.replace(/\n/g, "\\n").slice(0, 30));
        expect(generateText.mock.calls[0][0]).toContain("An input rejected by an earlier guard cannot exercise a later branch");
    });

    test.each([[], [{ code: "weaken assertions" }], [null], [1], ["null", "extra"]].map(args => [args]))("rejects invalid argument replacements %j", async args => {
        generateText.mockResolvedValue(response(args));
        expect(await repair()).toEqual([]);
        expect(fs.readFileSync(testFile, "utf8")).toBe(code);
    });

    test("does not touch unrelated or shadowed functions", async () => {
        suggestion.generatedCode = code.replace("rejects non-number results", "another generated test");
        expect(await repair()).toEqual([]);
        expect(generateText).not.toHaveBeenCalled();
        suggestion.generatedCode = code;
        fs.writeFileSync(testFile, code.replace("const res =", "const readNumber = value => value; const res ="));
        expect(await repair()).toEqual([]);
        expect(generateText).not.toHaveBeenCalled();
    });

    test("does not change source calls used to calculate expected values", async () => {
        const expectedCode = code.replace("expect(res).toEqual({ result: '', error: 'non-number result' })",
            "expect({ result: '', error: 'non-number result' }).toEqual(res)");
        fs.writeFileSync(testFile, expectedCode);
        suggestion.generatedCode = expectedCode;
        expect(await repair()).toEqual([]);
        expect(generateText).not.toHaveBeenCalled();
    });

    test("does not edit a same-named test whose body differs from the submitted suggestion", async () => {
        fs.writeFileSync(testFile, code.replace("'1 > 0'", "'2 > 1'"));
        expect(await repair()).toEqual([]);
        expect(generateText).not.toHaveBeenCalled();
    });

    test("leaves failures visible when AI is unavailable or its output is invalid", async () => {
        generateText.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("not JSON");
        expect(await repair()).toEqual([]);
        expect(await repair()).toEqual([]);
        expect(fs.readFileSync(testFile, "utf8")).toBe(code);
    });

    test("does not overwrite a concurrent edit", async () => {
        generateText.mockImplementation(async () => {
            fs.writeFileSync(testFile, code + "\n// user edit");
            return response(["null"]);
        });
        expect(await repair()).toEqual([]);
        expect(fs.readFileSync(testFile, "utf8")).toBe(code + "\n// user edit");
    });

    test.each([true, false])("apply reruns real Vitest and reports actual outcome (valid repair: %s)", async valid => {
        generateText.mockResolvedValue(response([valid ? "null" : "still > invalid"]));
        const executions = [];
        const sourceBefore = fs.readFileSync(path.join(rootDir, "src/number.js"), "utf8");
        const result = await applyUnitTestSuggestion({
            snapshotId: "input-snap", projectId: "input-project", suggestion,
            runCoverageFn: async ({ sealedRunDir }) => {
                const reportFile = path.join(sealedRunDir, "vitest-results.json");
                const run = spawnSync(process.execPath, [path.join(serverDir, "node_modules/vitest/vitest.mjs"),
                    "run", "--config", "vitest.config.mjs", "--reporter=default", "--reporter=json", `--outputFile=${reportFile}`],
                { cwd: rootDir, encoding: "utf8", timeout: 30000 });
                if (run.error || !fs.existsSync(reportFile)) throw new Error(`${run.error}\n${run.stdout}\n${run.stderr}`);
                const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
                executions.push(report);
                if (executions.length === 1) {
                    const detail = getTestRunnerFailure(report, run.stdout + run.stderr, run.status);
                    expect(detail).toContain('"error": "non-number result"');
                    expect(detail).toContain('"error": "invalid characters"');
                }
            }
        });
        expect(executions).toHaveLength(2);
        expect(executions[0].numFailedTests).toBe(1);
        expect(executions[1].numFailedTests).toBe(valid ? 0 : 1);
        expect(result.testResults.success).toBe(valid);
        expect(result.appliedSuggestions[0].status).toBe(valid ? "PASSED" : "FAILED");
        expect(generateText).toHaveBeenCalledTimes(1);
        expect(fs.readFileSync(path.join(rootDir, "src/number.js"), "utf8")).toBe(sourceBefore);
        expect(fs.readFileSync(testFile, "utf8")).toContain("expect(res).toEqual({ result: '', error: 'non-number result' })");
    }, 90000);
});
