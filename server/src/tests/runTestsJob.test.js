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
    mergeCoverageFinal,
    isSyntheticCoverageEntry,
    computeSummaryFromFileCoverage,
    syncCoverageArtifactsToOrigin,
    buildJestModuleNameMapper,
    readProjectJestConfig,
    isEsmProjectForRepo,
    resolveTestEnvironment,
    resolveJestBin,
    jestParallelFlags,
    getOptimalWorkerFlags,
    syncCoverageDirectories,
    clearLogicFilesCache
} from "../services/runTestsJob.service.js";
import { isApiFilePath } from "../utils/apiFileDetector.js";

describe('Jest script commands in isolated host workspaces', () => {
    it('uses the installed JS executable for a bare Jest script while preserving runInBand', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(),'covai-jest-command-'));
        try {
            fs.mkdirSync(path.join(root,'node_modules/jest/bin'),{recursive:true});
            fs.writeFileSync(path.join(root,'node_modules/jest/bin/jest.js'),'');
            const command = resolveJestBin(root,false,'jest --runInBand --coverage');
            expect(command).toBe('node node_modules/jest/bin/jest.js --runInBand');
            expect(jestParallelFlags(command)).toBe('');
            expect(resolveJestBin(root,true,'npx jest --watch --runInBand')).toBe('node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand');
            expect(jestParallelFlags('node jest.js --maxWorkers=2')).toBe('');
            expect(jestParallelFlags('node jest.js')).toBe(' --maxWorkers=50%');
        } finally { fs.rmSync(root,{recursive:true,force:true}); }
    });
});

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
            fs.writeFileSync(path.join(testsDir, "unit.test.js"), "test('unit', () => {})");

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

describe("resolveTestEnvironment", () => {
    it("defaults to node when configuredEnv is undefined or node", () => {
        expect(resolveTestEnvironment("/nonexistent", "/nonexistent", undefined)).toBe("node");
        expect(resolveTestEnvironment("/nonexistent", "/nonexistent", "node")).toBe("node");
    });

    it("returns jsdom if local project directory contains jest-environment-jsdom", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-local-jsdom-"));
        try {
            const fakeJsdomDir = path.join(tempDir, "node_modules", "jest-environment-jsdom");
            fs.mkdirSync(fakeJsdomDir, { recursive: true });
            expect(resolveTestEnvironment(tempDir, tempDir, "jsdom")).toBe("jsdom");
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("resolves to host/container absolute path or node when local project directory lacks jest-environment-jsdom", () => {
        const tempEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-empty-dir-"));
        try {
            const resolved = resolveTestEnvironment(tempEmptyDir, tempEmptyDir, "jsdom");
            expect(typeof resolved).toBe("string");
            // Either resolved to server's installed jest-environment-jsdom absolute path or safe fallback 'node'
            expect(resolved.includes("jest-environment-jsdom") || resolved === "node").toBe(true);
        } finally {
            fs.rmSync(tempEmptyDir, { recursive: true, force: true });
        }
    });

    it("preserves custom test environments", () => {
        expect(resolveTestEnvironment("/nonexistent", "/nonexistent", "custom-env")).toBe("custom-env");
    });
});

describe("Exact AST-Aware Coverage Merger & Artifact Synchronization", () => {
    it("replaces synthetic 0% line-count baseline (80 lines) with real Istanbul AST coverage (25/25 statements -> 100%)", () => {
        // Build an 80-line synthetic baseline entry (0% coverage)
        const syntheticStatementMap = {};
        const syntheticS = {};
        for (let i = 0; i < 80; i++) {
            syntheticStatementMap[String(i)] = {
                start: { line: i + 1, column: 0 },
                end: { line: i + 1, column: 20 }
            };
            syntheticS[String(i)] = 0;
        }
        const baselineFinal = {
            "src/services/order.service.js": {
                path: "src/services/order.service.js",
                _syntheticBaseline: true,
                statementMap: syntheticStatementMap,
                fnMap: {},
                branchMap: {},
                s: syntheticS,
                f: {},
                b: {}
            }
        };
        const baselineSummary = {
            "src/services/order.service.js": {
                _syntheticBaseline: true,
                lines: { total: 80, covered: 0, skipped: 0, pct: 0 },
                statements: { total: 80, covered: 0, skipped: 0, pct: 0 },
                functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
                branches: { total: 0, covered: 0, skipped: 0, pct: 0 }
            }
        };

        // Real Istanbul AST instrumentation has 25 executable statements, 4 functions, 2 branches (4 arms), all covered
        const realStatementMap = {};
        const realS = {};
        for (let i = 0; i < 25; i++) {
            realStatementMap[String(i)] = {
                start: { line: i * 2 + 1, column: 2 },
                end: { line: i * 2 + 1, column: 30 }
            };
            realS[String(i)] = 3;
        }
        const rawFinal = {
            "src/services/order.service.js": {
                path: "src/services/order.service.js",
                statementMap: realStatementMap,
                fnMap: {
                    "0": { name: "createOrder", decl: { start: { line: 1 } } },
                    "1": { name: "validateOrder", decl: { start: { line: 15 } } },
                    "2": { name: "calculateTotal", decl: { start: { line: 30 } } },
                    "3": { name: "cancelOrder", decl: { start: { line: 45 } } }
                },
                branchMap: {
                    "0": { type: "if", line: 10 },
                    "1": { type: "cond-expr", line: 22 }
                },
                s: realS,
                f: { "0": 2, "1": 2, "2": 1, "3": 1 },
                b: { "0": [1, 1], "1": [2, 1] }
            }
        };
        const rawSum = {
            "src/services/order.service.js": computeSummaryFromFileCoverage(rawFinal["src/services/order.service.js"])
        };

        expect(isSyntheticCoverageEntry(baselineFinal["src/services/order.service.js"])).toBe(true);
        expect(isSyntheticCoverageEntry(rawFinal["src/services/order.service.js"])).toBe(false);

        const mergedFinal = mergeCoverageFinal(baselineFinal, rawFinal);
        const mergedSum = mergeCoverageSummaries(baselineSummary, rawSum, { mergedFinal });

        // Synthetic 80-statement map must be completely replaced by real 25-statement AST map
        expect(Object.keys(mergedFinal["src/services/order.service.js"].s).length).toBe(25);
        expect(mergedSum["src/services/order.service.js"].statements).toEqual({
            total: 25,
            covered: 25,
            skipped: 0,
            pct: 100
        });
        expect(mergedSum["src/services/order.service.js"].lines).toEqual({
            total: 25,
            covered: 25,
            skipped: 0,
            pct: 100
        });
        expect(mergedSum["src/services/order.service.js"].functions).toEqual({
            total: 4,
            covered: 4,
            skipped: 0,
            pct: 100
        });
        expect(mergedSum["src/services/order.service.js"].branches).toEqual({
            total: 4,
            covered: 4,
            skipped: 0,
            pct: 100
        });
        expect(mergedSum.total.statements.pct).toBe(100);
        expect(mergedSum.total.lines.pct).toBe(100);
        expect(mergedSum.total.functions.pct).toBe(100);
        expect(mergedSum.total.branches.pct).toBe(100);
    });

    it("replaces DB percentage fallback (total: 100) with real Istanbul AST coverage without diluting percentage", () => {
        const dbFallbackSummary = {
            "src/utils/math.js": {
                _syntheticBaseline: true,
                lines: { total: 100, covered: 50, skipped: 0, pct: 50 },
                statements: { total: 100, covered: 50, skipped: 0, pct: 50 },
                functions: { total: 100, covered: 50, skipped: 0, pct: 50 },
                branches: { total: 100, covered: 50, skipped: 0, pct: 50 }
            }
        };
        const rawSum = {
            "src/utils/math.js": {
                lines: { total: 12, covered: 12, skipped: 0, pct: 100 },
                statements: { total: 12, covered: 12, skipped: 0, pct: 100 },
                functions: { total: 3, covered: 3, skipped: 0, pct: 100 },
                branches: { total: 4, covered: 4, skipped: 0, pct: 100 }
            }
        };

        const mergedSum = mergeCoverageSummaries(dbFallbackSummary, rawSum);
        expect(mergedSum["src/utils/math.js"].statements.total).toBe(12);
        expect(mergedSum["src/utils/math.js"].statements.covered).toBe(12);
        expect(mergedSum["src/utils/math.js"].statements.pct).toBe(100);
        expect(mergedSum.total.statements.pct).toBe(100);
    });

    it("computes exact union across two partial test runs covering complementary branches", () => {
        const statementMap = {
            "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
            "1": { start: { line: 2, column: 2 }, end: { line: 2, column: 15 } },
            "2": { start: { line: 4, column: 2 }, end: { line: 4, column: 15 } }
        };
        const fnMap = { "0": { name: "toggle", decl: { start: { line: 1 } } } };
        const branchMap = { "0": { type: "if", line: 1 } };

        const run1Final = {
            "src/utils/toggle.js": {
                path: "src/utils/toggle.js",
                statementMap,
                fnMap,
                branchMap,
                s: { "0": 1, "1": 1, "2": 0 },
                f: { "0": 1 },
                b: { "0": [1, 0] }
            }
        };
        const run2Final = {
            "src/utils/toggle.js": {
                path: "src/utils/toggle.js",
                statementMap,
                fnMap,
                branchMap,
                s: { "0": 1, "1": 0, "2": 1 },
                f: { "0": 1 },
                b: { "0": [0, 1] }
            }
        };

        const mergedFinal = mergeCoverageFinal(run1Final, run2Final);
        const mergedSum = mergeCoverageSummaries(
            { "src/utils/toggle.js": computeSummaryFromFileCoverage(run1Final["src/utils/toggle.js"]) },
            { "src/utils/toggle.js": computeSummaryFromFileCoverage(run2Final["src/utils/toggle.js"]) },
            { mergedFinal }
        );

        expect(mergedSum["src/utils/toggle.js"].statements.pct).toBe(100);
        expect(mergedSum["src/utils/toggle.js"].branches.pct).toBe(100);
        expect(mergedSum["src/utils/toggle.js"].functions.pct).toBe(100);
        expect(mergedSum["src/utils/toggle.js"].lines.pct).toBe(100);
    });

    it("syncs coverage artifacts from temporary operation workspace back to origin rootDir", () => {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-work-sync-"));
        const origDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-orig-sync-"));
        try {
            const workCov = path.join(workDir, "coverage");
            fs.mkdirSync(workCov, { recursive: true });
            fs.writeFileSync(path.join(workCov, "coverage-summary.json"), JSON.stringify({ total: { lines: { pct: 100 } } }));
            fs.writeFileSync(path.join(workCov, "coverage-final.json"), JSON.stringify({ "src/a.js": { s: { "0": 1 } } }));

            const synced = syncCoverageArtifactsToOrigin(workDir, origDir);
            expect(synced).toBe(true);
            expect(fs.existsSync(path.join(origDir, "coverage", "coverage-summary.json"))).toBe(true);
            expect(fs.existsSync(path.join(origDir, "coverage", "coverage-final.json"))).toBe(true);
            expect(fs.existsSync(path.join(origDir, "coverage", "unit", "coverage-summary.json"))).toBe(true);
            expect(fs.existsSync(path.join(origDir, "coverage", "unit", "coverage-final.json"))).toBe(true);
        } finally {
            fs.rmSync(workDir, { recursive: true, force: true });
            fs.rmSync(origDir, { recursive: true, force: true });
        }
    });

    it("syncs coverage artifacts bidirectionally between coverage and coverage/unit via syncCoverageDirectories", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-dual-sync-"));
        try {
            const rootCov = path.join(tempDir, "coverage");
            const unitCov = path.join(tempDir, "coverage", "unit");
            fs.mkdirSync(unitCov, { recursive: true });

            fs.writeFileSync(path.join(unitCov, "coverage-summary.json"), JSON.stringify({ total: { lines: { pct: 85 } } }));
            fs.writeFileSync(path.join(unitCov, "jest-results.json"), JSON.stringify({ numPassedTests: 5 }));

            const synced = syncCoverageDirectories(rootCov, unitCov);
            expect(synced).toBe(true);
            expect(fs.existsSync(path.join(rootCov, "coverage-summary.json"))).toBe(true);
            expect(fs.existsSync(path.join(rootCov, "jest-results.json"))).toBe(true);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe("getOptimalWorkerFlags", () => {
    it("returns --runInBand for suites with <= 3 test files", () => {
        expect(getOptimalWorkerFlags(1)).toBe("--runInBand");
        expect(getOptimalWorkerFlags(2)).toBe("--runInBand");
        expect(getOptimalWorkerFlags(3)).toBe("--runInBand");
    });

    it("returns --maxWorkers=2 for suites with > 3 test files to prevent container thrashing", () => {
        expect(getOptimalWorkerFlags(4)).toBe("--maxWorkers=2");
        expect(getOptimalWorkerFlags(25)).toBe("--maxWorkers=2");
    });

    it("respects existing runner concurrency flags in custom command", () => {
        expect(getOptimalWorkerFlags(10, "jest --runInBand")).toBe("");
        expect(getOptimalWorkerFlags(10, "jest --maxWorkers=4")).toBe("");
        expect(getOptimalWorkerFlags(1, "jest --maxWorkers=1")).toBe("");
    });
});

describe("findUnitFiles helper filtering & findLogicSourceFiles caching", () => {
    it("skips non-test helper scripts in tests/ lacking test block invocations", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-helper-filter-"));
        try {
            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });

            // Helper script inside tests/ with no describe/it/test invocation
            fs.writeFileSync(path.join(testsDir, "dbUtils.js"), "const connect = () => { if (process.env.DB) { return true; } }; module.exports = { connect };");
            // Genuine test file
            fs.writeFileSync(path.join(testsDir, "user.service.test.js"), "describe('userService', () => { it('works', () => {}); });");

            const { jestFiles, skippedFiles } = findUnitFiles(tempDir);
            expect(jestFiles.length).toBe(1);
            expect(jestFiles[0]).toContain("user.service.test.js");
            expect(skippedFiles).toContain("tests/dbUtils.js");
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it("caches findLogicSourceFiles results in memory to eliminate duplicate directory traversals", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-logic-cache-"));
        try {
            clearLogicFilesCache();
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "calculator.js"), "export const add = (a, b) => a + b;");

            const firstPass = findLogicSourceFiles(tempDir);
            expect(firstPass.length).toBe(1);

            // Add new file without bypassing cache -> cached result is returned
            fs.writeFileSync(path.join(srcDir, "multiplier.js"), "export const mul = (a, b) => a * b;");
            const secondPass = findLogicSourceFiles(tempDir);
            expect(secondPass.length).toBe(1);

            // With bypassCache -> detects new file
            const thirdPass = findLogicSourceFiles(tempDir, { bypassCache: true });
            expect(thirdPass.length).toBe(2);
        } finally {
            clearLogicFilesCache();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});



