import fs from "fs";
import path from "path";
import os from "os";
import { describe, expect, it } from "@jest/globals";
import { coverageResultFromSummary, findUnitFiles, mergeCoverageSummaries } from "../services/runTestsJob.service.js";
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

