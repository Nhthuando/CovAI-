import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import {
    findAllAssociatedTestFiles,
    findAssociatedTestFile,
    calculateTraceabilityScore
} from "../services/fileCoverage.service.js";
import {
    extractModuleSpecifiers,
    resolveSpecifierToRelativePath,
    findTestsImportingSource
} from "../services/testDependencyResolver.service.js";

describe("Section 2: Nature of Business Logic and Test Files Relationship (N-to-N Traceability)", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-nton-nature-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    // =========================================================================
    // 2.1. Mathematical Model of Code-Test Traceability (Directed Bipartite Graph)
    // =========================================================================
    describe("2.1 Mathematical Model of Code-Test Traceability G = (B ∪ T, E)", () => {
        it("Fan-In Duality: In-Degree(b_i) >= 2 - Single business logic handler is tested by multiple distinct test suites (Unit + Integration + E2E)", () => {
            // Setup Business file b1
            const srcDir = path.join(tempDir, "src", "handlers");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(
                path.join(srcDir, "create-quickbooks-account.handler.ts"),
                "export const createQuickbooksAccount = (req) => { return { status: 'created' }; };",
                "utf8"
            );

            // Setup 3 Test Files (T):
            // t1: Unit Test (direct import, unit mock, 3 test cases)
            const unitDir = path.join(tempDir, "tests", "unit", "handlers");
            fs.mkdirSync(unitDir, { recursive: true });
            fs.writeFileSync(
                path.join(unitDir, "create-account.handlers.test.ts"),
                `
                import { describe, it, expect } from '@jest/globals';
                const { createQuickbooksAccount } = await import('../../../src/handlers/create-quickbooks-account.handler');
                it('validates account payload', () => { expect(createQuickbooksAccount).toBeDefined(); });
                it('handles mock quickbooks client response', () => { expect(true).toBe(true); });
                it('returns 201 on success', () => { expect(true).toBe(true); });
                `,
                "utf8"
            );

            // t2: Integration Test (direct require, 2 test cases)
            const integDir = path.join(tempDir, "tests", "integration");
            fs.mkdirSync(integDir, { recursive: true });
            fs.writeFileSync(
                path.join(integDir, "quickbooks-api.integration.test.ts"),
                `
                const { createQuickbooksAccount } = require('../../src/handlers/create-quickbooks-account.handler');
                it('executes HTTP POST /api/accounts', () => {});
                it('handles HTTP 500 downstream error', () => {});
                `,
                "utf8"
            );

            // t3: E2E Spec (ES6 static import, 1 test case)
            const e2eDir = path.join(tempDir, "tests", "e2e");
            fs.mkdirSync(e2eDir, { recursive: true });
            fs.writeFileSync(
                path.join(e2eDir, "accounts-workflow.e2e.spec.ts"),
                `
                import { createQuickbooksAccount } from '../../src/handlers/create-quickbooks-account.handler';
                it('runs full signup to account provision workflow', () => {});
                `,
                "utf8"
            );

            const result = findAllAssociatedTestFiles(tempDir, "src/handlers/create-quickbooks-account.handler.ts");

            // Verify Fan-In characteristics
            expect(result.hasExecutingTests).toBe(true);
            expect(result.linkedTestFiles.length).toBe(3);

            const linkedPaths = result.linkedTestFiles.map(t => t.filePath);
            expect(linkedPaths).toContain("tests/unit/handlers/create-account.handlers.test.ts");
            expect(linkedPaths).toContain("tests/integration/quickbooks-api.integration.test.ts");
            expect(linkedPaths).toContain("tests/e2e/accounts-workflow.e2e.spec.ts");

            // Verify Primary Test Selection by Quantitative Score
            // t1 has DIRECT_IMPORT (+1000) + 3 tests (+30) + location (+200) = 1230
            // t2 has DIRECT_IMPORT (+1000) + 2 tests (+20) = 1020
            // t3 has DIRECT_IMPORT (+1000) + 1 test (+10) = 1010
            expect(result.primaryTestFile.filePath).toBe("tests/unit/handlers/create-account.handlers.test.ts");
            expect(result.primaryTestFile.isPrimary).toBe(true);
            expect(result.primaryTestFile.score).toBeGreaterThan(result.linkedTestFiles[1].score);
        });

        it("Fan-Out Duality: Out-Degree(t_j) >= 3 - Single aggregated test suite verifies multiple distinct business logic files", () => {
            // Setup 3 distinct business files (B)
            const srcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "order.service.ts"), "export const createOrder = () => {};", "utf8");
            fs.writeFileSync(path.join(srcDir, "payment.service.ts"), "export const processPayment = () => {};", "utf8");
            fs.writeFileSync(path.join(srcDir, "inventory.service.ts"), "export const checkStock = () => {};", "utf8");

            // Setup 1 Aggregated Test Suite (t1) covering all 3 business files
            const testDir = path.join(tempDir, "tests", "unit");
            fs.mkdirSync(testDir, { recursive: true });
            fs.writeFileSync(
                path.join(testDir, "checkout-pipeline.test.ts"),
                `
                import { createOrder } from '../../src/services/order.service';
                import { processPayment } from '../../src/services/payment.service';
                import { checkStock } from '../../src/services/inventory.service';

                it('completes order flow', () => {
                    checkStock();
                    createOrder();
                    processPayment();
                });
                `,
                "utf8"
            );

            // Querying each of the 3 business logic files individually must all resolve checkout-pipeline.test.ts!
            const resOrder = findAllAssociatedTestFiles(tempDir, "src/services/order.service.ts");
            const resPayment = findAllAssociatedTestFiles(tempDir, "src/services/payment.service.ts");
            const resInventory = findAllAssociatedTestFiles(tempDir, "src/services/inventory.service.ts");

            expect(resOrder.primaryTestFile.filePath).toBe("tests/unit/checkout-pipeline.test.ts");
            expect(resOrder.primaryTestFile.relationType).toBe("DIRECT_IMPORT");

            expect(resPayment.primaryTestFile.filePath).toBe("tests/unit/checkout-pipeline.test.ts");
            expect(resPayment.primaryTestFile.relationType).toBe("DIRECT_IMPORT");

            expect(resInventory.primaryTestFile.filePath).toBe("tests/unit/checkout-pipeline.test.ts");
            expect(resInventory.primaryTestFile.relationType).toBe("DIRECT_IMPORT");
        });
    });

    // =========================================================================
    // 2.2. The 4 Traceability Levels & Syntax Patterns
    // =========================================================================
    describe("2.2 The 4 Traceability Levels & Syntax Detection Support", () => {
        it("Level 1 (DIRECT_IMPORT): Recognizes all 5 syntax patterns (Static, Dynamic, CJS, Jest mock, Path alias)", () => {
            const testCode = `
                import { foo } from "../src/services/billing";
                const { bar } = await import("../src/services/auth");
                const baz = require("../src/services/logger");
                jest.mock("../src/clients/stripe-client", () => ({}));
                jest.unstable_mockModule("@/handlers/invoice.handler", () => ({}));
            `;
            const specifiers = extractModuleSpecifiers(testCode);

            expect(specifiers).toContain("../src/services/billing");
            expect(specifiers).toContain("../src/services/auth");
            expect(specifiers).toContain("../src/services/logger");
            expect(specifiers).toContain("../src/clients/stripe-client");
            expect(specifiers).toContain("@/handlers/invoice.handler");

            // Verify Path Aliases resolution
            const resolvedAlias = resolveSpecifierToRelativePath(
                tempDir,
                "tests/unit/invoice.test.ts",
                "@/handlers/invoice.handler"
            );
            expect(resolvedAlias).toBe("src/handlers/invoice.handler");
        });

        it("Level 4 (NAME_CONVENTION): Fallback when target source file has no direct imports (brand new file)", () => {
            const srcDir = path.join(tempDir, "src", "controllers");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(
                path.join(srcDir, "untested-export.controller.js"),
                "export const untestedAction = () => {};",
                "utf8"
            );

            // No test file exists yet
            const result = findAllAssociatedTestFiles(tempDir, "src/controllers/untested-export.controller.js");

            expect(result.hasExecutingTests).toBe(false);
            expect(result.primaryTestFile.found).toBe(false);
            expect(result.primaryTestFile.relationType).toBe("NONE");
            // Standardized suggested path for AI test generation (mapping src/ -> tests/)
            expect(result.suggestedNewTestPath).toBe("tests/controllers/untested-export.controller.test.js");
        });
    });

    // =========================================================================
    // 2.3 & 2.4 Traceability Decision Matrix & Primary Test Scoring Formula
    // =========================================================================
    describe("2.3 & 2.4 Primary Test Scoring Algorithm: Score(tj, bi) = S_relation + S_name + S_count + S_location", () => {
        it("Calculates exact quantitative score according to mathematical definition", () => {
            // Case A: DIRECT_IMPORT (+1000), Name match (+500), 5 test cases (+50), Location match (+200)
            const itemA = {
                relationType: "DIRECT_IMPORT",
                fileName: "create-quickbooks-account.handler.test.ts",
                filePath: "tests/unit/handlers/create-quickbooks-account.handler.test.ts",
                testCount: 5
            };
            const scoreA = calculateTraceabilityScore(
                itemA,
                "create-quickbooks-account.handler",
                "src/handlers"
            );
            expect(scoreA).toBe(1000 + 500 + 50 + 200); // 1750

            // Case B: DIRECT_IMPORT (+1000), Different name (+0), 2 test cases (+20), Location match (+200)
            const itemB = {
                relationType: "DIRECT_IMPORT",
                fileName: "create-account.handlers.test.ts",
                filePath: "tests/unit/handlers/create-account.handlers.test.ts",
                testCount: 2
            };
            const scoreB = calculateTraceabilityScore(
                itemB,
                "create-quickbooks-account.handler",
                "src/handlers"
            );
            expect(scoreB).toBe(1000 + 0 + 20 + 200); // 1220

            // Case C: EXECUTION_TRACE (+800), Different name (+0), 1 test case (+10), No location match (+0)
            const itemC = {
                relationType: "EXECUTION_TRACE",
                fileName: "integration.test.ts",
                filePath: "tests/e2e/integration.test.ts",
                testCount: 1
            };
            const scoreC = calculateTraceabilityScore(
                itemC,
                "create-quickbooks-account.handler",
                "src/handlers"
            );
            expect(scoreC).toBe(800 + 0 + 10 + 0); // 810

            // Case D: NAME_CONVENTION (+100), Name match (+500), 0 test cases (+0), Location match (+200)
            const itemD = {
                relationType: "NAME_CONVENTION",
                fileName: "create-quickbooks-account.handler.spec.ts",
                filePath: "tests/unit/handlers/create-quickbooks-account.handler.spec.ts",
                testCount: 0
            };
            const scoreD = calculateTraceabilityScore(
                itemD,
                "create-quickbooks-account.handler",
                "src/handlers"
            );
            expect(scoreD).toBe(100 + 500 + 0 + 200); // 800

            expect(scoreA).toBeGreaterThan(scoreB);
            expect(scoreB).toBeGreaterThan(scoreC);
            expect(scoreC).toBeGreaterThan(scoreD);
        });

        it("Guarantees DIRECT_IMPORT always trumps NAME_CONVENTION even if naming is identical", () => {
            // Source: src/services/auth.service.js
            // Test 1: tests/services/auth.service.test.js (NAME_CONVENTION stub with 0 direct imports)
            // Test 2: tests/legacy/login-checker.test.js (DIRECT_IMPORT actually importing auth.service.js)
            const srcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "auth.service.js"), "export const verifyToken = () => {};", "utf8");

            const stubDir = path.join(tempDir, "tests", "services");
            fs.mkdirSync(stubDir, { recursive: true });
            fs.writeFileSync(
                path.join(stubDir, "auth.service.test.js"),
                "// Empty placeholder or unrelated test\nit('placeholder', () => {});",
                "utf8"
            );

            const activeDir = path.join(tempDir, "tests", "legacy");
            fs.mkdirSync(activeDir, { recursive: true });
            fs.writeFileSync(
                path.join(activeDir, "login-checker.test.js"),
                `
                import { verifyToken } from '../../src/services/auth.service.js';
                it('verifies token successfully', () => { verifyToken(); });
                it('rejects invalid token', () => { verifyToken(); });
                `,
                "utf8"
            );

            const res = findAllAssociatedTestFiles(tempDir, "src/services/auth.service.js");

            // The test that actually imports the code MUST be selected as Primary!
            expect(res.primaryTestFile.filePath).toBe("tests/legacy/login-checker.test.js");
            expect(res.primaryTestFile.relationType).toBe("DIRECT_IMPORT");
            expect(res.primaryTestFile.isPrimary).toBe(true);
        });
    });

    // =========================================================================
    // 2.5. Real-World Project Verification (QuickBooks Handler & Client Ecosystem)
    // =========================================================================
    describe("2.5 Real-World Project Verification (Repository cmuxfsnh300012hob32cjq63v)", () => {
        const realUserRepo = path.resolve(
            process.cwd(),
            "storage/projects/cmuxfsnh300012hob32cjq63v/github/1791336995812/repo"
        );

        it("Verifies complete ecosystem around create-quickbooks-account.handler.ts", () => {
            if (!fs.existsSync(realUserRepo)) {
                console.warn("[SKIP] Real user project not present on disk:", realUserRepo);
                return;
            }

            const targetSource = "src/handlers/create-quickbooks-account.handler.ts";
            const result = findAllAssociatedTestFiles(realUserRepo, targetSource);

            expect(result.hasExecutingTests).toBe(true);
            expect(result.primaryTestFile.found).toBe(true);
            expect(result.primaryTestFile.filePath).toBe("tests/unit/handlers/create-account.handlers.test.ts");
            expect(result.primaryTestFile.relationType).toBe("DIRECT_IMPORT");
            expect(result.primaryTestFile.score).toBeGreaterThan(1000);
            expect(result.primaryTestFile.testCode).toContain("createQuickbooksAccount");
        });
    });
});
