import { describe, it, expect, jest } from "@jest/globals";
import path from "path";
import fs from "fs";
import os from "os";
import { classifyTestFile } from "../utils/testingFrameworkDetector.js";
import { findUnitFiles, generateBaselineCoverage } from "../services/runTestsJob.service.js";
import { parseCoverageSummary } from "../services/coverageSummaryParser.service.js";

describe("Decoupled Test Pillars: Unit, Integration, and System Tests", () => {
    describe("1. Strict Classification (classifyTestFile)", () => {
        it("classifies pure business logic unit tests as jest or vitest", () => {
            const jestContent = `
                describe('CartService', () => {
                    it('calculates total discount', () => {
                        expect(1 + 1).toBe(2);
                    });
                });
            `;
            expect(classifyTestFile(jestContent, "tests/services/cart.service.test.js")).toBe("jest");

            const vitestContent = `
                import { describe, it, expect, vi } from 'vitest';
                describe('AuthUtil', () => {
                    it('hashes password', () => {
                        expect(true).toBe(true);
                    });
                });
            `;
            expect(classifyTestFile(vitestContent, "tests/utils/auth.test.ts")).toBe("vitest");
        });

        it("classifies HTTP route contract tests as supertest (integration)", () => {
            const supertestImport = `
                import request from 'supertest';
                import app from '../app.js';
                describe('GET /api/v1/items', () => {
                    it('returns 200', async () => {
                        const res = await request(app).get('/api/v1/items');
                        expect(res.status).toBe(200);
                    });
                });
            `;
            expect(classifyTestFile(supertestImport, "tests/integration/items.test.js")).toBe("supertest");

            const apiPathFile = `
                describe('Orders API', () => {
                    it('creates order', () => {
                        const res = request(server).post('/api/orders');
                    });
                });
            `;
            expect(classifyTestFile(apiPathFile, "tests/api/orders.test.js")).toBe("supertest");
        });

        it("classifies browser end-to-end specs as playwright or cypress (system)", () => {
            const playwrightSpec = `
                import { test, expect } from '@playwright/test';
                test('user can log in and view dashboard', async ({ page }) => {
                    await page.goto('http://localhost:3000/login');
                    await page.fill('#username', 'admin');
                });
            `;
            expect(classifyTestFile(playwrightSpec, "tests/system/login.spec.ts")).toBe("playwright");

            const cypressSpec = `
                describe('Checkout Flow', () => {
                    it('completes order', () => {
                        cy.visit('/checkout');
                    });
                });
            `;
            expect(classifyTestFile(cypressSpec, "cypress/e2e/checkout.cy.js")).toBe("cypress");
        });
    });

    describe("2. Unit Test File Discovery Guard (findUnitFiles)", () => {
        let tempDir;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-pillar-test-"));
            fs.mkdirSync(path.join(tempDir, "tests", "unit"), { recursive: true });
            fs.mkdirSync(path.join(tempDir, "tests", "integration"), { recursive: true });
            fs.mkdirSync(path.join(tempDir, "tests", "system"), { recursive: true });
            fs.mkdirSync(path.join(tempDir, "cypress", "e2e"), { recursive: true });

            // Pure unit test
            fs.writeFileSync(
                path.join(tempDir, "tests", "unit", "calculator.test.js"),
                "describe('calc', () => { it('adds', () => expect(1+1).toBe(2)); });"
            );

            // Integration test (supertest)
            fs.writeFileSync(
                path.join(tempDir, "tests", "integration", "api.test.js"),
                "const request = require('supertest'); describe('api', () => { it('gets', () => {}); });"
            );

            // System test (playwright)
            fs.writeFileSync(
                path.join(tempDir, "tests", "system", "e2e.test.js"),
                "const { test } = require('@playwright/test'); test('nav', () => {});"
            );

            // Cypress test
            fs.writeFileSync(
                path.join(tempDir, "cypress", "e2e", "user.cy.js"),
                "describe('cy', () => { it('visits', () => cy.visit('/')); });"
            );
        });

        afterEach(() => {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) { }
        });

        it("discovers only pure unit tests and strictly skips integration/system test files", () => {
            const result = findUnitFiles(tempDir);
            const allFound = [...result.jestFiles, ...result.vitestFiles];

            // Unit file must be included
            expect(allFound.some(f => f.includes("calculator.test.js"))).toBe(true);

            // Integration and system tests MUST be skipped
            expect(allFound.some(f => f.includes("api.test.js"))).toBe(false);
            expect(allFound.some(f => f.includes("e2e.test.js"))).toBe(false);
            expect(allFound.some(f => f.includes("user.cy.js"))).toBe(false);

            // Check that they are listed in skippedFiles
            expect(result.skippedFiles.some(f => f.includes("api.test.js"))).toBe(true);
            expect(result.skippedFiles.some(f => f.includes("e2e.test.js"))).toBe(true);
        });
    });

    describe("3. Namespaced Coverage Artifacts (generateBaselineCoverage)", () => {
        let tempDir;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-baseline-test-"));
            fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
            fs.writeFileSync(
                path.join(tempDir, "src", "billing.js"),
                "export const calculateTax = (amount) => amount * 0.1;"
            );
        });

        afterEach(() => {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) { }
        });

        it("generates coverage artifacts into namespaced unit coverage directory", () => {
            const logicFiles = [{
                relativePath: "src/billing.js",
                absolutePath: path.join(tempDir, "src", "billing.js")
            }];

            const unitCoverageDir = path.join(tempDir, "coverage", "unit");
            generateBaselineCoverage(tempDir, logicFiles, unitCoverageDir);

            // Verify coverage/unit has coverage-summary.json and coverage-final.json
            expect(fs.existsSync(path.join(unitCoverageDir, "coverage-summary.json"))).toBe(true);
            expect(fs.existsSync(path.join(unitCoverageDir, "coverage-final.json"))).toBe(true);

            const summary = JSON.parse(fs.readFileSync(path.join(unitCoverageDir, "coverage-summary.json"), "utf8"));
            expect(summary.total).toBeDefined();
            expect(summary.total.lines.total).toBeGreaterThan(0);
            expect(summary.total.lines.covered).toBe(0);
            expect(summary.total.lines.pct).toBe(0);
        });
    });

    describe("4. Integration Test Isolation (parseCoverageSummary with skipSummaryUpsert)", () => {
        let tempDir;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-parse-cov-"));
            const covDir = path.join(tempDir, "coverage", "integration");
            fs.mkdirSync(covDir, { recursive: true });

            fs.writeFileSync(
                path.join(covDir, "coverage-summary.json"),
                JSON.stringify({
                    total: {
                        lines: { total: 50, covered: 45, pct: 90 },
                        statements: { total: 50, covered: 45, pct: 90 },
                        functions: { total: 5, covered: 5, pct: 100 },
                        branches: { total: 10, covered: 8, pct: 80 }
                    },
                    "routes/items.js": {
                        lines: { total: 50, covered: 45, pct: 90 },
                        statements: { total: 50, covered: 45, pct: 90 },
                        functions: { total: 5, covered: 5, pct: 100 },
                        branches: { total: 10, covered: 8, pct: 80 }
                    }
                })
            );
        });

        afterEach(() => {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) { }
        });

        it("parses integration coverage without overwriting primary CoverageSummary when skipSummaryUpsert is true", async () => {
            const covDir = path.join(tempDir, "coverage", "integration");
            const result = await parseCoverageSummary(covDir, "snap-integration", { skipSummaryUpsert: true });

            expect(result.summary).toBeNull();
            expect(result.total.lines.pct).toBe(90);
            expect(result.fileCount).toBe(1);
        });
    });
});

