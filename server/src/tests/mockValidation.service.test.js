import fs from "fs";
import os from "os";
import path from "path";
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { validateAndNormalizeMocks, resolveRelativeModuleOnDisk } from "../services/mockValidation.service.js";

describe("Pre-Execution Mock Validation & Normalization Layer", () => {
    let tmpRoot;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "covai-mock-val-"));
        fs.mkdirSync(path.join(tmpRoot, "src", "code-generation"), { recursive: true });
        fs.mkdirSync(path.join(tmpRoot, "tests", "code-generation"), { recursive: true });

        fs.writeFileSync(
            path.join(tmpRoot, "src", "code-generation", "scenario-generation.ts"),
            "export const generateScenarioCode = () => 'real';\nexport const generateScenarioCodeWithSeparateStepFunctions = () => 'real-sep';\n",
            "utf8"
        );
        fs.writeFileSync(
            path.join(tmpRoot, "src", "code-generation", "generate-code-by-line-number.ts"),
            [
                "import { generateScenarioCode, generateScenarioCodeWithSeparateStepFunctions } from './scenario-generation';",
                "export const generateCodeFromFeature = () => generateScenarioCode();",
                "export const generateCodeWithSeparateFunctionsFromFeature = () => generateScenarioCodeWithSeparateStepFunctions();"
            ].join("\n"),
            "utf8"
        );
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    test("resolveRelativeModuleOnDisk resolves TS and JS ESM-style imports", () => {
        const testFile = "tests/code-generation/generate-code-by-line-number.test.ts";
        expect(resolveRelativeModuleOnDisk("../../src/code-generation/scenario-generation", testFile, tmpRoot))
            .toBe(path.join(tmpRoot, "src", "code-generation", "scenario-generation.ts"));
        expect(resolveRelativeModuleOnDisk("../../src/code-generation/scenario-generation.js", testFile, tmpRoot))
            .toBe(path.join(tmpRoot, "src", "code-generation", "scenario-generation.ts"));
        expect(resolveRelativeModuleOnDisk("../../src/code-generation/does-not-exist", testFile, tmpRoot))
            .toBeNull();
    });

    test("strips { virtual: true } for existing modules and adds { virtual: true } for missing modules", () => {
        const code = [
            "import { generateCodeFromFeature } from '../../src/code-generation/generate-code-by-line-number';",
            "jest.mock('../../src/code-generation/scenario-generation', () => ({",
            "  generateScenarioCode: jest.fn().mockReturnValue('mocked'),",
            "  generateScenarioCodeWithSeparateStepFunctions: jest.fn()",
            "}), { virtual: true });",
            "jest.mock('../../src/code-generation/missing-virtual-mod', () => ({ helper: jest.fn() }));",
            "test('works', () => { expect(generateCodeFromFeature()).toBe('mocked'); });"
        ].join("\n");

        const result = validateAndNormalizeMocks({
            code,
            filePath: "tests/code-generation/generate-code-by-line-number.test.ts",
            sourceFile: "src/code-generation/generate-code-by-line-number.ts",
            rootDir: tmpRoot,
            framework: "jest"
        });

        expect(result.valid).toBe(true);
        expect(result.modified).toBe(true);
        expect(result.repairs.map(r => r.rule)).toEqual(
            expect.arrayContaining(["VIRTUAL_FLAG_STRIPPED", "VIRTUAL_FLAG_ADDED", "MOCK_HOIST_ORDER"])
        );
        expect(result.code).toMatch(/jest\.mock\(['"]\.\.\/\.\.\/src\/code-generation\/scenario-generation['"],\s*\(\)\s*=>/);
        expect(result.code).not.toMatch(/scenario-generation['"][^;]*virtual:\s*true/);
        expect(result.code).toMatch(/missing-virtual-mod['"][^;]*virtual:\s*true/);
    });

    test("removes self-mock of the target source file under test", () => {
        const code = [
            "jest.mock('../../src/code-generation/generate-code-by-line-number', () => ({ generateCodeFromFeature: jest.fn() }));",
            "import { generateCodeFromFeature } from '../../src/code-generation/generate-code-by-line-number';",
            "test('t', () => { expect(generateCodeFromFeature).toBeDefined(); });"
        ].join("\n");

        const result = validateAndNormalizeMocks({
            code,
            filePath: "tests/code-generation/generate-code-by-line-number.test.ts",
            sourceFile: "src/code-generation/generate-code-by-line-number.ts",
            rootDir: tmpRoot,
            framework: "jest"
        });

        expect(result.valid).toBe(true);
        expect(result.modified).toBe(true);
        expect(result.repairs.some(r => r.rule === "SELF_MOCK_REMOVED")).toBe(true);
        expect(result.code).not.toContain("jest.mock");
    });

    test("injects missing named exports imported by SUT or test into mock factory", () => {
        const code = [
            "import { generateCodeFromFeature } from '../../src/code-generation/generate-code-by-line-number';",
            "jest.mock('../../src/code-generation/scenario-generation', () => ({",
            "  generateScenarioCode: jest.fn().mockReturnValue('mocked')",
            "}));",
            "test('t', () => { expect(generateCodeFromFeature()).toBe('mocked'); });"
        ].join("\n");

        const result = validateAndNormalizeMocks({
            code,
            filePath: "tests/code-generation/generate-code-by-line-number.test.ts",
            sourceFile: "src/code-generation/generate-code-by-line-number.ts",
            rootDir: tmpRoot,
            framework: "jest"
        });

        expect(result.valid).toBe(true);
        expect(result.modified).toBe(true);
        expect(result.repairs.some(r => r.rule === "MOCK_MISSING_EXPORT" && r.detail.includes("generateScenarioCodeWithSeparateStepFunctions"))).toBe(true);
        expect(result.code).toContain("generateScenarioCodeWithSeparateStepFunctions: jest.fn()");
    });

    test("hoists top-level jest.mock/vi.mock above SUT imports while keeping runner import and vi.hoisted first", () => {
        const code = [
            "import { describe, test, expect, vi } from 'vitest';",
            "const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }));",
            "import { generateCodeFromFeature } from '../../src/code-generation/generate-code-by-line-number';",
            "vi.mock('../../src/code-generation/scenario-generation', () => ({ generateScenarioCode: mockFn, generateScenarioCodeWithSeparateStepFunctions: vi.fn() }));",
            "test('t', () => { expect(generateCodeFromFeature).toBeDefined(); });"
        ].join("\n");

        const result = validateAndNormalizeMocks({
            code,
            filePath: "tests/code-generation/generate-code-by-line-number.test.ts",
            sourceFile: "src/code-generation/generate-code-by-line-number.ts",
            rootDir: tmpRoot,
            framework: "vitest"
        });

        expect(result.valid).toBe(true);
        expect(result.modified).toBe(true);
        const viHoistedIdx = result.code.indexOf("vi.hoisted");
        const viMockIdx = result.code.indexOf("vi.mock(");
        const sutImportIdx = result.code.indexOf("generate-code-by-line-number");
        expect(viHoistedIdx).toBeGreaterThan(-1);
        expect(viMockIdx).toBeGreaterThan(viHoistedIdx);
        expect(sutImportIdx).toBeGreaterThan(viMockIdx);
    });

    test("converts resetAllMocks to clearAllMocks when factory defines mockReturnValue without beforeEach reconfig", () => {
        const code = [
            "jest.mock('../../src/code-generation/scenario-generation', () => ({",
            "  generateScenarioCode: jest.fn().mockReturnValue('mocked'),",
            "  generateScenarioCodeWithSeparateStepFunctions: jest.fn()",
            "}));",
            "import { generateCodeFromFeature } from '../../src/code-generation/generate-code-by-line-number';",
            "describe('suite', () => {",
            "  afterEach(() => { jest.resetAllMocks(); });",
            "  test('t', () => { expect(generateCodeFromFeature()).toBe('mocked'); });",
            "});"
        ].join("\n");

        const result = validateAndNormalizeMocks({
            code,
            filePath: "tests/code-generation/generate-code-by-line-number.test.ts",
            sourceFile: "src/code-generation/generate-code-by-line-number.ts",
            rootDir: tmpRoot,
            framework: "jest"
        });

        expect(result.valid).toBe(true);
        expect(result.modified).toBe(true);
        expect(result.repairs.some(r => r.rule === "MOCK_RESET_PRESERVED")).toBe(true);
        expect(result.code).toContain("jest.clearAllMocks()");
        expect(result.code).not.toContain("jest.resetAllMocks()");
    });

    test("flags non-function mock factories and unmocked spy assertions", () => {
        const code = [
            "import { generateScenarioCode } from '../../src/code-generation/scenario-generation';",
            "jest.mock('../../src/code-generation/missing-mod', invalidExternalObj);",
            "test('t', () => { expect(generateScenarioCode).toHaveBeenCalled(); });"
        ].join("\n");

        const result = validateAndNormalizeMocks({
            code,
            filePath: "tests/code-generation/generate-code-by-line-number.test.ts",
            sourceFile: "src/code-generation/generate-code-by-line-number.ts",
            rootDir: tmpRoot,
            framework: "jest"
        });

        expect(result.valid).toBe(false);
        expect(result.diagnostics.some(d => d.rule === "MOCK_FACTORY_INVALID" && d.severity === "error")).toBe(true);
        expect(result.diagnostics.some(d => d.rule === "UNMOCKED_SPY_ASSERTION" && d.severity === "warning")).toBe(true);
    });
});
