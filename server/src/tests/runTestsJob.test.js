import fs from "fs";
import path from "path";
import os from "os";
import { describe, expect, it } from "@jest/globals";
import {
    coverageResultFromSummary,
    findUnitFiles,
    findLogicSourceFiles,
    generateBaselineCoverage,
    mergeCoverageSummaries,
    buildJestModuleNameMapper,
    readProjectJestConfig,
    isEsmProjectForRepo
} from "../services/runTestsJob.service.js";
import { isApiFilePath } from "../utils/apiFileDetector.js";

describe("isApiFilePath", () => {
    it("identifies API routes, controllers, endpoints, and server entry files", () => {
        expect(isApiFilePath("src/routes/auth.routes.js")).toBe(true);
        expect(isApiFilePath("src/controllers/user.controller.js")).toBe(true);
        expect(isApiFilePath("src/endpoints/payment.js")).toBe(true);
        expect(isApiFilePath("src/app.js")).toBe(true);
        expect(isApiFilePath("server.js")).toBe(true);
        expect(isApiFilePath("src/server.ts")).toBe(true);
    });

    it("does not treat business logic services, models, utils, or internal barrel files as API files", () => {
        expect(isApiFilePath("src/services/auth.service.js")).toBe(false);
        expect(isApiFilePath("src/models/user.model.js")).toBe(false);
        expect(isApiFilePath("src/utils/calculator.js")).toBe(false);
        expect(isApiFilePath("src/utils/index.js")).toBe(false);
        expect(isApiFilePath("src/services/index.js")).toBe(false);
    });
});

describe("mergeCoverageSummaries", () => {
    it("recalculates unit coverage totals strictly on unit files, excluding API routes and controllers", () => {
        const inputSummary = {
            "total": {
                lines: { total: 447, covered: 383, pct: 85.7 },
                statements: { total: 447, covered: 383, pct: 85.7 },
                functions: { total: 70, covered: 68, pct: 97.1 },
                branches: { total: 119, covered: 100, pct: 84.0 },
            },
            "src/services/auth.service.js": {
                lines: { total: 383, covered: 383, skipped: 0, pct: 100 },
                statements: { total: 383, covered: 383, skipped: 0, pct: 100 },
                functions: { total: 68, covered: 68, skipped: 0, pct: 100 },
                branches: { total: 100, covered: 100, skipped: 0, pct: 100 },
            },
            "src/routes/auth.routes.js": {
                lines: { total: 64, covered: 0, skipped: 0, pct: 0 },
                statements: { total: 64, covered: 0, skipped: 0, pct: 0 },
                functions: { total: 2, covered: 0, skipped: 0, pct: 0 },
                branches: { total: 19, covered: 0, skipped: 0, pct: 0 },
            },
        };

        const merged = mergeCoverageSummaries(inputSummary, {});

        // Totals must exclude src/routes/auth.routes.js
        expect(merged.total.statements.total).toBe(383);
        expect(merged.total.statements.covered).toBe(383);
        expect(merged.total.statements.pct).toBe(100);

        expect(merged.total.branches.total).toBe(100);
        expect(merged.total.branches.covered).toBe(100);
        expect(merged.total.branches.pct).toBe(100);

        expect(merged.total.functions.total).toBe(68);
        expect(merged.total.functions.covered).toBe(68);
        expect(merged.total.functions.pct).toBe(100);
    });

    it("respects projectJestConfig.coverageThreshold by subtracting path-matched files from global total", () => {
        const inputSummary = {
            "total": {
                lines: { total: 100, covered: 90, pct: 90 },
                statements: { total: 100, covered: 90, pct: 90 },
                functions: { total: 20, covered: 18, pct: 90 },
                branches: { total: 20, covered: 18, pct: 90 },
            },
            "src/services/normal.service.js": {
                lines: { total: 80, covered: 80, skipped: 0, pct: 100 },
                statements: { total: 80, covered: 80, skipped: 0, pct: 100 },
                functions: { total: 16, covered: 16, skipped: 0, pct: 100 },
                branches: { total: 16, covered: 16, skipped: 0, pct: 100 },
            },
            "src/clients/oauth-client.js": {
                lines: { total: 20, covered: 10, skipped: 0, pct: 50 },
                statements: { total: 20, covered: 10, skipped: 0, pct: 50 },
                functions: { total: 4, covered: 2, skipped: 0, pct: 50 },
                branches: { total: 4, covered: 2, skipped: 0, pct: 50 },
            }
        };

        const projectJestConfig = {
            coverageThreshold: {
                global: { statements: 100, branches: 100, functions: 100, lines: 100 },
                "./src/clients/oauth-client.js": { statements: 50, branches: 50, functions: 50, lines: 50 }
            }
        };

        const merged = mergeCoverageSummaries(inputSummary, {}, { projectJestConfig });

        // Global total must exclude src/clients/oauth-client.js
        expect(merged.total.statements.total).toBe(80);
        expect(merged.total.statements.covered).toBe(80);
        expect(merged.total.statements.pct).toBe(100);
        expect(merged.total.lines.pct).toBe(100);
        expect(merged.total.functions.pct).toBe(100);
        expect(merged.total.branches.pct).toBe(100);
    });
});

describe("coverageResultFromSummary", () => {
    it("maps the multi-framework aggregator result into the job result contract", () => {
        expect(coverageResultFromSummary({
            summary: { linesPct: 80, branchesPct: 70, funcsPct: 60, stmtsPct: 90 },
            fileCount: 3,
        })).toEqual({ lines: 80, branches: 70, functions: 60, statements: 90 });
    });

    it("returns null when aggregation did not produce a summary", () => {
        expect(coverageResultFromSummary(null)).toBeNull();
    });
});

describe("buildJestModuleNameMapper", () => {
    it("does not hard-code dist/src when the project uses a real src root", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-jest-mapper-"));
        try {
            fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "demo-app" }, null, 2));

            const mapper = buildJestModuleNameMapper(tempDir, {}, "demo-app");
            const serialized = JSON.stringify(mapper);

            expect(serialized).toContain("<rootDir>/src");
            expect(serialized).not.toContain("dist/src");
            expect(mapper["^demo-app$"]).toBe("<rootDir>/src");
            expect(mapper["^demo-app/(.*)$"]).toBe("<rootDir>/src/$1");
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe("findUnitFiles", () => {
    it("discovers 50 test files including step-definitions and classifies them", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-unit-test-"));
        try {
            const stepsDir = path.join(tempDir, "tests", "step-definitions");
            fs.mkdirSync(stepsDir, { recursive: true });

            // Create 50 step definition / test files
            for (let i = 1; i <= 50; i++) {
                fs.writeFileSync(
                    path.join(stepsDir, `feature_${i}.steps.js`),
                    `describe("Feature ${i}", () => { it("works", () => { expect(true).toBe(true); }); });`
                );
            }

            const { jestFiles, vitestFiles, skippedFiles } = findUnitFiles(tempDir);
            expect(jestFiles.length + vitestFiles.length).toBe(50);
            expect(skippedFiles.length).toBe(0);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("skips frontend files and helper/setup files", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-unit-skip-"));
        try {
            const clientDir = path.join(tempDir, "client", "tests");
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(clientDir, { recursive: true });
            fs.mkdirSync(testsDir, { recursive: true });

            fs.writeFileSync(path.join(clientDir, "ui.test.js"), "test('ui', () => {})");
            fs.writeFileSync(path.join(testsDir, "setup.js"), "// setup");
            fs.writeFileSync(path.join(testsDir, "component.jsx"), "export default () => <div/>");
            fs.writeFileSync(path.join(testsDir, "api.test.js"), "test('api', () => {})");

            const { jestFiles, vitestFiles } = findUnitFiles(tempDir);
            expect(jestFiles.length + vitestFiles.length).toBe(1);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe("findLogicSourceFiles & generateBaselineCoverage (projects with 0 tests)", () => {
    it("discovers logic source files while ignoring tests, frontend, and config files", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-logic-files-"));
        try {
            fs.mkdirSync(path.join(tempDir, "src", "services"), { recursive: true });
            fs.mkdirSync(path.join(tempDir, "src", "utils"), { recursive: true });
            fs.mkdirSync(path.join(tempDir, "client", "src"), { recursive: true });
            fs.mkdirSync(path.join(tempDir, "tests"), { recursive: true });

            fs.writeFileSync(path.join(tempDir, "src", "services", "bankAccount.js"), "class BankAccount {}\nexport default BankAccount;\n");
            fs.writeFileSync(path.join(tempDir, "src", "utils", "calc.js"), "export function add(a, b) { return a + b; }\n");
            fs.writeFileSync(path.join(tempDir, "client", "src", "App.jsx"), "export default () => <div/>;\n");
            fs.writeFileSync(path.join(tempDir, "tests", "dummy.test.js"), "test('dummy', () => {});\n");
            fs.writeFileSync(path.join(tempDir, "jest.config.js"), "module.exports = {};\n");

            const files = findLogicSourceFiles(tempDir);
            expect(files.map(f => f.relativePath)).toEqual([
                "src/services/bankAccount.js",
                "src/utils/calc.js"
            ]);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("generates 0% baseline coverage-summary.json and coverage-final.json for logic files", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-baseline-cov-"));
        try {
            fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
            const filePath = path.join(tempDir, "src", "calculator.js");
            fs.writeFileSync(filePath, "function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n");

            const logicFiles = findLogicSourceFiles(tempDir);
            const coverageDir = path.join(tempDir, "coverage");
            const result = generateBaselineCoverage(tempDir, logicFiles, coverageDir);

            expect(result.summaryData.total.lines.pct).toBe(0);
            expect(result.summaryData.total.lines.covered).toBe(0);
            expect(result.summaryData.total.lines.total).toBeGreaterThan(0);
            expect(result.summaryData.total.functions.total).toBeGreaterThan(0);

            expect(fs.existsSync(path.join(coverageDir, "coverage-summary.json"))).toBe(true);
            expect(fs.existsSync(path.join(coverageDir, "coverage-final.json"))).toBe(true);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe("readProjectJestConfig & isEsmProjectForRepo", () => {
    it("loads config from jest.config.js and identifies ESM projects", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-jest-esm-"));
        try {
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "esm-project", type: "module" }));
            fs.writeFileSync(path.join(tempDir, "jest.config.js"), `
                export default {
                    preset: 'ts-jest/presets/default-esm',
                    extensionsToTreatAsEsm: ['.ts']
                };
            `);

            const config = await readProjectJestConfig(tempDir);
            expect(config.preset).toBe("ts-jest/presets/default-esm");
            expect(config.extensionsToTreatAsEsm).toEqual([".ts"]);

            const isEsm = isEsmProjectForRepo(tempDir, config);
            expect(isEsm).toBe(true);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("falls back to package.json jest field if no jest.config exists", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-pkg-jest-"));
        try {
            fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({
                name: "cjs-project",
                jest: { testEnvironment: "node" }
            }));

            const config = await readProjectJestConfig(tempDir);
            expect(config.testEnvironment).toBe("node");

            const isEsm = isEsmProjectForRepo(tempDir, config);
            expect(isEsm).toBe(false);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

