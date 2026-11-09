import fs from "fs";
import path from "path";
import os from "os";
import { describe, test, it, expect, beforeEach, afterEach } from "@jest/globals";
import { findUnitFiles } from "../services/runTestsJob.service.js";
import { classifyTestFile } from "../utils/testingFrameworkDetector.js";

// Helper replicating isE2EOrIntegrationSuite in applyTestSuggestion.service.js (lines 3719-3727)
// and isE2EOrIntegrationTest in unitTestBatchRunner.service.js (lines 64-72)
const isE2EOrIntegrationSuite = (filePath) => {
    if (!filePath || typeof filePath !== 'string') return false;
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    return (
        /(?:^|\/)(?:e2e|system|cypress|playwright|integration)(?:[-_a-z0-9]*)?(?:\/|$)/i.test(norm) ||
        /\b(?:e2e|system|cypress|playwright|supertest|integration)\.(?:test|spec)\.[cm]?[jt]s$/i.test(norm) ||
        /(?:^|[._-])(?:e2e|system|cypress|playwright|supertest|integration)(?:[._-]|$)/i.test(path.basename(norm)) ||
        /(?:^|\/)tier\d+[-_].*\.(?:test|spec)\.[cm]?[jt]s$/i.test(norm)
    );
};

describe("Adversarial Test Filtering & Discovery Suite", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-adversarial-test-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    describe("1. Root and Nested E2E Suite Exclusion", () => {
        it("strictly excludes root e2e/tests/tier4-workloads.test.js from findUnitFiles", () => {
            const e2eDir = path.join(tempDir, "e2e", "tests");
            fs.mkdirSync(e2eDir, { recursive: true });
            fs.writeFileSync(
                path.join(e2eDir, "tier4-workloads.test.js"),
                "describe('tier4', () => it('runs workloads', () => expect(1).toBe(1)));"
            );

            const result = findUnitFiles(tempDir);
            const allDiscovered = [...result.jestFiles, ...result.vitestFiles];
            expect(allDiscovered.some(f => f.includes("tier4-workloads.test.js"))).toBe(false);
        });

        it("strictly excludes nested e2e/sub/feature.test.js from findUnitFiles", () => {
            const nestedE2eDir = path.join(tempDir, "e2e", "sub");
            fs.mkdirSync(nestedE2eDir, { recursive: true });
            fs.writeFileSync(
                path.join(nestedE2eDir, "feature.test.js"),
                "describe('nested e2e', () => it('runs feature', () => expect(1).toBe(1)));"
            );

            const result = findUnitFiles(tempDir);
            const allDiscovered = [...result.jestFiles, ...result.vitestFiles];
            expect(allDiscovered.some(f => f.includes("feature.test.js"))).toBe(false);
        });

        it("recognizes root and nested e2e paths in isE2EOrIntegrationSuite across Unix and Windows slashes", () => {
            expect(isE2EOrIntegrationSuite("e2e/tests/tier4-workloads.test.js")).toBe(true);
            expect(isE2EOrIntegrationSuite("e2e\\tests\\tier4-workloads.test.js")).toBe(true);
            expect(isE2EOrIntegrationSuite("e2e/sub/feature.test.js")).toBe(true);
            expect(isE2EOrIntegrationSuite("e2e\\sub\\feature.test.js")).toBe(true);
            expect(isE2EOrIntegrationSuite("tests/e2e/sub/feature.test.js")).toBe(true);
            expect(isE2EOrIntegrationSuite("tests\\e2e\\sub\\feature.test.js")).toBe(true);
        });
    });

    describe("2. Test Framework and Library Imports", () => {
        it("identifies supertest imports and excludes them from findUnitFiles", () => {
            const unitDir = path.join(tempDir, "tests", "unit");
            fs.mkdirSync(unitDir, { recursive: true });
            fs.writeFileSync(
                path.join(unitDir, "api-contract.test.js"),
                "import request from 'supertest'; describe('api', () => it('calls', () => {}));"
            );

            const result = findUnitFiles(tempDir);
            const allDiscovered = [...result.jestFiles, ...result.vitestFiles];
            expect(allDiscovered.some(f => f.includes("api-contract.test.js"))).toBe(false);
            expect(result.skippedFiles.some(f => f.includes("api-contract.test.js"))).toBe(true);
        });

        it("identifies @playwright/test imports and excludes them from findUnitFiles", () => {
            const unitDir = path.join(tempDir, "tests", "unit");
            fs.mkdirSync(unitDir, { recursive: true });
            fs.writeFileSync(
                path.join(unitDir, "browser.test.js"),
                "import { test } from '@playwright/test'; test('browser navigation', () => {});"
            );

            const result = findUnitFiles(tempDir);
            const allDiscovered = [...result.jestFiles, ...result.vitestFiles];
            expect(allDiscovered.some(f => f.includes("browser.test.js"))).toBe(false);
            expect(result.skippedFiles.some(f => f.includes("browser.test.js"))).toBe(true);
        });

        it("preserves valid unit test files importing @jest/globals", () => {
            const unitDir = path.join(tempDir, "tests", "unit");
            fs.mkdirSync(unitDir, { recursive: true });
            fs.writeFileSync(
                path.join(unitDir, "math.test.js"),
                "import { describe, it, expect } from '@jest/globals'; describe('math', () => it('adds', () => expect(1+1).toBe(2)));"
            );

            const result = findUnitFiles(tempDir);
            expect(result.jestFiles.some(f => f.includes("math.test.js"))).toBe(true);
            expect(result.skippedFiles.some(f => f.includes("math.test.js"))).toBe(false);
        });
    });

    describe("3. Valid Unit Test File Retention", () => {
        it("retains server/tests/**/*.vitest.test.js without accidental filtering", () => {
            const vitestDir = path.join(tempDir, "server", "tests", "controllers");
            fs.mkdirSync(vitestDir, { recursive: true });
            fs.writeFileSync(
                path.join(vitestDir, "auth.vitest.test.js"),
                "import { describe, it, expect } from 'vitest'; describe('auth', () => it('authenticates', () => expect(1).toBe(1)));"
            );

            const result = findUnitFiles(tempDir);
            expect(result.vitestFiles.some(f => f.includes("auth.vitest.test.js"))).toBe(true);
            expect(isE2EOrIntegrationSuite("server/tests/controllers/auth.vitest.test.js")).toBe(false);
            expect(isE2EOrIntegrationSuite("server\\tests\\controllers\\auth.vitest.test.js")).toBe(false);
        });

        it("retains standard unit test files in tests/unit/", () => {
            const unitDir = path.join(tempDir, "tests", "unit");
            fs.mkdirSync(unitDir, { recursive: true });
            fs.writeFileSync(
                path.join(unitDir, "calculator.test.js"),
                "describe('calc', () => it('multiplies', () => expect(2 * 3).toBe(6)));"
            );

            const result = findUnitFiles(tempDir);
            expect(result.jestFiles.some(f => f.includes("calculator.test.js"))).toBe(true);
            expect(isE2EOrIntegrationSuite("tests/unit/calculator.test.js")).toBe(false);
            expect(isE2EOrIntegrationSuite("tests\\unit\\calculator.test.js")).toBe(false);
        });
    });

    describe("4. Named Non-Unit Test Files & Pipeline Escapes (Vulnerability Demonstrations)", () => {
        it("verifies tier1-*.test.js and system.spec.ts exclusion", () => {
            expect(isE2EOrIntegrationSuite("tier1-auth.test.js")).toBe(true);
            expect(isE2EOrIntegrationSuite("tests/tier1-auth.test.js")).toBe(true);
            expect(isE2EOrIntegrationSuite("tests\\tier1-auth.test.js")).toBe(true);
            expect(isE2EOrIntegrationSuite("system.spec.ts")).toBe(true);
            expect(isE2EOrIntegrationSuite("tests/system.spec.ts")).toBe(true);
            expect(isE2EOrIntegrationSuite("tests\\system.spec.ts")).toBe(true);
        });

        it("verifies isE2EOrIntegrationSuite strictly excludes integration.test.js and api.integration.test.js", () => {
            expect(isE2EOrIntegrationSuite("integration.test.js")).toBe(true);
            expect(isE2EOrIntegrationSuite("tests/integration.test.js")).toBe(true);
            expect(isE2EOrIntegrationSuite("tests/api.integration.test.js")).toBe(true);
        });

        it("verifies findUnitFiles excludes tests in e2e-tests/ and integration-tests/ directories", () => {
            const e2eTestsDir = path.join(tempDir, "tests", "e2e-tests");
            const integTestsDir = path.join(tempDir, "tests", "integration-tests");
            fs.mkdirSync(e2eTestsDir, { recursive: true });
            fs.mkdirSync(integTestsDir, { recursive: true });

            fs.writeFileSync(
                path.join(e2eTestsDir, "checkout.test.js"),
                "describe('e2e test', () => it('checks out', () => expect(1).toBe(1)));"
            );
            fs.writeFileSync(
                path.join(integTestsDir, "database.test.js"),
                "describe('integ test', () => it('queries db', () => expect(1).toBe(1)));"
            );

            const result = findUnitFiles(tempDir);
            expect(result.jestFiles.some(f => f.includes("checkout.test.js"))).toBe(false);
            expect(result.vitestFiles.some(f => f.includes("checkout.test.js"))).toBe(false);
            expect(result.jestFiles.some(f => f.includes("database.test.js"))).toBe(false);
            expect(result.vitestFiles.some(f => f.includes("database.test.js"))).toBe(false);
            expect(result.skippedFiles.some(f => f.includes("checkout.test.js"))).toBe(true);
            expect(result.skippedFiles.some(f => f.includes("database.test.js"))).toBe(true);
        });
    });
});
