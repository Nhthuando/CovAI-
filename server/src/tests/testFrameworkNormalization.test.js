import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, test, expect, afterEach } from "@jest/globals";
import { normalizeTestFrameworkCode } from "../services/testFrameworkNormalization.service.js";
import { cleanAndDeduplicateTestContent, convertEsmToCommonJs } from "../services/testSanitizer.service.js";
import { applyCodeToTestFile } from "../services/applyTestSuggestion.service.js";
import { parseAndSanitizeAiTestResponse } from "../services/unitTestGenerator.service.js";

const serverDir = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = [];
const fixture = () => {
    const dir = fs.mkdtempSync(path.join(serverDir, ".framework-runtime-"));
    fixtures.push(dir);
    return dir;
};
afterEach(() => { for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("runner API normalization", () => {
    test("keeps Vitest ESM imports alongside CommonJS source imports", () => {
        const code = "import { test, expect } from 'vitest';\nconst mod = require('./math.cjs');\ntest('adds', () => { expect(mod.add(1, 2)).toBe(3); });";
        expect(convertEsmToCommonJs(code)).toBe(code);
        const cleaned = cleanAndDeduplicateTestContent(code, "", "math.test.js");
        expect(cleaned).toContain("from 'vitest'");
        expect(cleaned).not.toMatch(/require\(['"]vitest/);
    });

    test("normalizes require bindings and real Jest mocks for Vitest without changing local identifiers or strings", () => {
        const code = `const { test, expect, vi: mockApi } = require('vitest');
const label = 'jest.fn() and require("vitest")';
function local(jest) { return jest.fn(); }
test('mock', () => { const mock = jest.fn(); mock(); expect(mock).toHaveBeenCalledTimes(1); });`;
        const result = normalizeTestFrameworkCode(code, { framework: "vitest" });
        expect(result).toContain("vi as mockApi");
        expect(result).toContain("const mock = vi.fn()");
        expect(result).toContain("function local(jest) { return jest.fn(); }");
        expect(result).toContain(`'jest.fn() and require("vitest")'`);
        expect(normalizeTestFrameworkCode(result, { framework: "vitest" })).toBe(result);
    });

    test("preserves Jest ESM imports and supplies a missing jest import", () => {
        const code = "import { jest, test, expect } from '@jest/globals';\ntest('mock', () => { expect(jest.fn()()).toBeUndefined(); });";
        expect(cleanAndDeduplicateTestContent(code, "", "mock.test.mjs")).toContain("jest, test, expect");
        expect(normalizeTestFrameworkCode("test('mock', () => { jest.fn(); });", { filePath: "mock.test.mjs" }))
            .toContain("import { jest } from '@jest/globals'");
        expect(normalizeTestFrameworkCode("jest.fn();", { framework: "jest", filePath: "mock.test.cjs" })).toBe("jest.fn();");
        const diagnostic = "const message = \"require('vitest') failed\"; jest.fn();";
        expect(normalizeTestFrameworkCode(diagnostic, { filePath: "mock.test.cjs" })).toBe(diagnostic);
    });

    test("normalizes the AI suggestion and full preview before apply", () => {
        const code = "const { test, expect } = require('vitest');\ntest('mock', () => { const mock = jest.fn(() => 7); expect(mock()).toBe(7); });";
        const result = parseAndSanitizeAiTestResponse({ framework: "vitest", rawResponse: JSON.stringify({ suggestedTestCode: code, fullUpdatedContent: code }) });
        expect(result.success).toBe(true);
        for (const key of ["suggestedTestCode", "fullUpdatedContent"]) {
            expect(result.parsed[key]).not.toContain("require('vitest')");
            expect(result.parsed[key]).toContain("vi.fn(");
        }
    });
});

describe("applied tests execute in the actual runner", () => {
    test("Vitest executes CommonJS source, mocks and spies after repeated sanitization; genuine failures remain failures", () => {
        const root = fixture();
        fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "commonjs" }));
        fs.writeFileSync(path.join(root, "math.cjs"), "exports.add = (a, b) => a + b;\n");
        fs.writeFileSync(path.join(root, "dep.mjs"), "export const value = 0;\n");
        fs.writeFileSync(path.join(root, "vitest.config.mjs"), "export default { test: { globals: false, include: ['*.test.js'], pool: 'forks', maxWorkers: 1, minWorkers: 1 } };\n");
        const code = `const { test, expect, vi } = require('vitest');
const { add } = require('./math.cjs');
import { value } from './dep.mjs';
jest.mock('./dep.mjs', () => ({ value: 41 }));
test('real mock tracking', () => {
  const mock = jest.fn(add);
  expect(mock(2, 3)).toBe(5);
  expect(mock).toHaveBeenCalledWith(2, 3);
  expect(value).toBe(41);
});
test('real spy', () => {
  const object = { add };
  const spy = jest.spyOn(object, 'add');
  expect(object.add(3, 4)).toBe(7);
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});`;
        applyCodeToTestFile(root, { framework: "vitest", testFile: "math.test.js", sourceFile: "math.cjs", generatedCode: code });
        const applied = applyCodeToTestFile(root, { framework: "vitest", testFile: "math.test.js", sourceFile: "math.cjs", generatedCode: `const { test, expect } = require('vitest');
test('additional suggestion', () => {
  const nextMock = jest.fn(() => 9);
  expect(nextMock()).toBe(9);
  expect(nextMock).toHaveBeenCalledTimes(1);
});` });
        const cleaned = cleanAndDeduplicateTestContent(applied.newContent, "", "math.test.js");
        fs.writeFileSync(path.join(root, "math.test.js"), cleaned);
        const report = path.join(root, "results.json");
        const run = () => spawnSync(process.execPath, [path.join(serverDir, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.config.mjs", "--reporter=json", `--outputFile=${report}`], { cwd: root, encoding: "utf8", timeout: 30000 });
        const passed = run();
        if (passed.status !== 0) throw new Error(`${passed.error?.message || ""}\n${passed.stderr}\n${passed.stdout}\n${fs.existsSync(report) ? fs.readFileSync(report, "utf8") : "No JSON report"}\nApplied code:\n${cleaned}`);
        expect({ status: passed.status, error: passed.error?.message, output: passed.stderr + passed.stdout }).toEqual({ status: 0, error: undefined, output: expect.any(String) });
        expect(JSON.parse(fs.readFileSync(report, "utf8")).numPassedTests).toBe(3);
        fs.writeFileSync(path.join(root, "math.test.js"), cleaned.replace("toBe(5)", "toBe(999)"));
        const failed = run();
        expect(failed.status).toBe(1);
        expect(JSON.parse(fs.readFileSync(report, "utf8")).numFailedTests).toBe(1);
    }, 90000);

    test("native Jest ESM retains the real jest API after apply", () => {
        const root = fixture();
        fs.writeFileSync(path.join(root, "jest.config.mjs"), "export default { transform: {}, testMatch: ['**/*.test.mjs'], testEnvironment: 'node' };\n");
        applyCodeToTestFile(root, { framework: "jest", testFile: "mock.test.mjs", generatedCode: `import { jest, test, expect } from '@jest/globals';
test('tracks calls with the real jest mock', () => {
  const mock = jest.fn(n => n * 2);
  expect(mock(4)).toBe(8);
  expect(mock).toHaveBeenCalledWith(4);
});` });
        const report = path.join(root, "results.json");
        const result = spawnSync(process.execPath, ["--experimental-vm-modules", path.join(serverDir, "node_modules/jest/bin/jest.js"), "--config", "jest.config.mjs", "--runInBand", "--json", `--outputFile=${report}`], { cwd: root, encoding: "utf8", timeout: 30000 });
        expect({ status: result.status, error: result.error?.message, output: result.stderr + result.stdout }).toEqual({ status: 0, error: undefined, output: expect.any(String) });
        expect(JSON.parse(fs.readFileSync(report, "utf8")).numPassedTests).toBe(1);
    }, 40000);
});
