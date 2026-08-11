import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { detectTestingFrameworks } from "../utils/testingFrameworkDetector.js";
import { detectJest } from "../utils/jestDetector.js";

const roots = [];
const fixture = (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "covai-framework-"));
    roots.push(root);
    for (const [relativePath, content] of Object.entries(files)) {
        const target = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    return root;
};

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("testing framework detector", () => {
    it("detects Jest from dependency, script, config, and inline configuration", () => {
        const root = fixture({ "package.json": JSON.stringify({ scripts: { test: "jest --runInBand" }, devDependencies: { jest: "^29.7.0" }, jest: { testEnvironment: "node" } }), "jest.config.js": "export default {};" });
        expect(detectTestingFrameworks(root)).toMatchObject({ detectedFrameworks: ["jest"], primaryFramework: "jest", frameworkType: "single" });
    });

    it("detects Vitest configuration", () => {
        const root = fixture({ "package.json": JSON.stringify({ devDependencies: { vitest: "^2.1.0" } }), "vitest.config.ts": "export default {};" });
        expect(detectTestingFrameworks(root)).toMatchObject({ detectedFrameworks: ["vitest"], primaryFramework: "vitest", frameworkType: "single" });
    });

    it("returns both frameworks and multiple type", () => {
        const root = fixture({ "package.json": JSON.stringify({ scripts: { test: "jest", unit: "vitest run" }, devDependencies: { jest: "^29", vitest: "^2" } }) });
        expect(detectTestingFrameworks(root)).toMatchObject({ detectedFrameworks: ["jest", "vitest"], primaryFramework: "jest", frameworkType: "multiple", hasMultipleFrameworks: true });
    });

    it("discovers classified tests and ignores generated directories", () => {
        const root = fixture({ "src/a.test.js": "import { jest } from '@jest/globals';", "__tests__/b.spec.ts": "import { vi } from 'vitest';", "test/helpers.ts": "export const x = 1;", "node_modules/pkg/ignored.test.js": "jest.fn();" });
        expect(detectTestingFrameworks(root).testFiles).toEqual([{ path: "__tests__/b.spec.ts", framework: "vitest" }, { path: "src/a.test.js", framework: "jest" }]);
    });

    it("returns a safe empty result for missing roots and malformed packages", () => {
        expect(detectTestingFrameworks(path.join(os.tmpdir(), "missing-covai-framework"))).toMatchObject({ frameworkType: "none", errors: [expect.any(String)] });
        const root = fixture({ "package.json": "not json" });
        expect(detectTestingFrameworks(root)).toMatchObject({ frameworkType: "none", errors: ["Unable to parse package.json"] });
    });

    it("keeps the legacy Jest result and exposes normalized detection", () => {
        const root = fixture({ "package.json": JSON.stringify({ scripts: { test: "jest" }, devDependencies: { jest: "^29" } }) });
        expect(detectJest(root)).toMatchObject({ hasJest: true, jestCommand: "jest", testingFrameworks: { frameworkType: "single", detectedFrameworks: ["jest"] } });
    });
});
