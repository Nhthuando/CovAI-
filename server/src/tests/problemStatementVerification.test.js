import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import { findAllAssociatedTestFiles, findAssociatedTestFile } from "../services/fileCoverage.service.js";
import { findExistingTestFile } from "../services/unitTestSuggestion.service.js";

describe("Problem Statement 1.0 Empirical & Objective Verification", () => {
    const realUserRepo = path.resolve(
        process.cwd(),
        "storage/projects/cmuxfsnh300012hob32cjq63v/github/1791336995812/repo"
    );

    describe("1.2 Real User Project Empirical Case (QuickBooks Handler)", () => {
        it("Mục tiêu 1 & 2: Resolves create-account.handlers.test.ts for create-quickbooks-account.handler.ts with zero false negatives", () => {
            if (!fs.existsSync(realUserRepo)) {
                console.warn("[SKIP] Real user project not present on disk:", realUserRepo);
                return;
            }

            const targetSource = "src/handlers/create-quickbooks-account.handler.ts";
            const result = findAllAssociatedTestFiles(realUserRepo, targetSource);

            // Objective 1: Zero false negatives
            expect(result.hasExecutingTests).toBe(true);
            expect(result.primaryTestFile.found).toBe(true);

            // Objective 2: Arbitrary naming tolerance
            expect(result.primaryTestFile.filePath).toBe("tests/unit/handlers/create-account.handlers.test.ts");
            expect(result.primaryTestFile.relationType).toBe("DIRECT_IMPORT");
            expect(result.primaryTestFile.testCount).toBeGreaterThanOrEqual(1);

            // Backward-compatible API
            const compat = findAssociatedTestFile(realUserRepo, targetSource);
            expect(compat.found).toBe(true);
            expect(compat.filePath).toBe("tests/unit/handlers/create-account.handlers.test.ts");
        });

        it("Mục tiêu 4: Preserves existing test mocks and context for AI Test Generation", () => {
            if (!fs.existsSync(realUserRepo)) return;

            const targetSource = "src/handlers/create-quickbooks-account.handler.ts";
            const existing = findExistingTestFile(realUserRepo, targetSource);

            expect(existing.found).toBe(true);
            expect(existing.relativePath).toBe("tests/unit/handlers/create-account.handlers.test.ts");
            // Must contain existing mock declarations so AI does not generate conflicting mocks
            expect(existing.content).toContain("mockQuickbooksClient");
            expect(existing.content).toContain("createQuickbooksAccount");
        });
    });

    describe("1.4 Real-World Testing Design Patterns Synthetic Verification", () => {
        let tempDir;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-patterns-"));
        });

        afterEach(() => {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        });

        it("Pattern 1: Aggregated Layer Tests - 1 test file covers multiple different handlers", () => {
            const srcDir = path.join(tempDir, "src", "handlers");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "create-account.handler.ts"), "export const createAccount = () => {};", "utf8");
            fs.writeFileSync(path.join(srcDir, "update-account.handler.ts"), "export const updateAccount = () => {};", "utf8");

            const testDir = path.join(tempDir, "tests", "unit");
            fs.mkdirSync(testDir, { recursive: true });
            fs.writeFileSync(
                path.join(testDir, "account.handlers.test.ts"),
                `
                import { createAccount } from '../../src/handlers/create-account.handler';
                import { updateAccount } from '../../src/handlers/update-account.handler';
                it('creates', () => {});
                it('updates', () => {});
                `,
                "utf8"
            );

            // Both distinct handlers should link to the same aggregated test file!
            const res1 = findAllAssociatedTestFiles(tempDir, "src/handlers/create-account.handler.ts");
            const res2 = findAllAssociatedTestFiles(tempDir, "src/handlers/update-account.handler.ts");

            expect(res1.primaryTestFile.found).toBe(true);
            expect(res1.primaryTestFile.filePath).toBe("tests/unit/account.handlers.test.ts");

            expect(res2.primaryTestFile.found).toBe(true);
            expect(res2.primaryTestFile.filePath).toBe("tests/unit/account.handlers.test.ts");
        });

        it("Pattern 2: Feature / Domain-Centric Tests - Feature spec covers domain services", () => {
            const srcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "billing-calculator.ts"), "export const calc = () => {};", "utf8");

            const testDir = path.join(tempDir, "tests", "features");
            fs.mkdirSync(testDir, { recursive: true });
            fs.writeFileSync(
                path.join(testDir, "quickbooks-billing.spec.ts"),
                `
                const { calc } = require('../../src/services/billing-calculator');
                it('calculates billing', () => {});
                `,
                "utf8"
            );

            const res = findAllAssociatedTestFiles(tempDir, "src/services/billing-calculator.ts");
            expect(res.primaryTestFile.found).toBe(true);
            expect(res.primaryTestFile.filePath).toBe("tests/features/quickbooks-billing.spec.ts");
            expect(res.primaryTestFile.relationType).toBe("DIRECT_IMPORT");
        });

        it("Pattern 3: Multi-Test Cardinality (1-to-N) - Handler tested by both unit and integration tests", () => {
            const srcDir = path.join(tempDir, "src", "handlers");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "invoice.handler.ts"), "export const invoice = () => {};", "utf8");

            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });

            fs.writeFileSync(
                path.join(testDir, "invoice.unit.test.ts"),
                "import { invoice } from '../src/handlers/invoice.handler'; it('u', () => {});",
                "utf8"
            );
            fs.writeFileSync(
                path.join(testDir, "invoice-api.integration.test.ts"),
                "import { invoice } from '../src/handlers/invoice.handler'; it('i1', () => {}); it('i2', () => {});",
                "utf8"
            );

            const res = findAllAssociatedTestFiles(tempDir, "src/handlers/invoice.handler.ts");
            expect(res.linkedTestFiles.length).toBe(2);
            expect(res.hasExecutingTests).toBe(true);
            const paths = res.linkedTestFiles.map(t => t.filePath);
            expect(paths).toContain("tests/invoice.unit.test.ts");
            expect(paths).toContain("tests/invoice-api.integration.test.ts");
        });
    });
});
