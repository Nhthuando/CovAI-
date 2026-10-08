import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import { findAssociatedTestFile, findAllAssociatedTestFiles } from "../services/fileCoverage.service.js";

describe("FileCoverage Associated Test File Traceability", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-cov-assoc-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    it("should find and link test file with DIFFERENT name that imports the business logic handler", () => {
        // Real-world scenario from user:
        // Source: src/handlers/create-quickbooks-account.handler.ts
        // Test: tests/unit/handlers/create-account.handlers.test.ts
        const srcDir = path.join(tempDir, "src", "handlers");
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(
            path.join(srcDir, "create-quickbooks-account.handler.ts"),
            "export const createQuickbooksAccount = () => {};",
            "utf8"
        );

        const testDir = path.join(tempDir, "tests", "unit", "handlers");
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(
            path.join(testDir, "create-account.handlers.test.ts"),
            `
            import { describe, it, expect } from '@jest/globals';
            const { createQuickbooksAccount } = await import('../../../src/handlers/create-quickbooks-account.handler');

            describe('createQuickbooksAccount', () => {
                it('handles creation', () => {
                    expect(createQuickbooksAccount).toBeDefined();
                });
            });
            `,
            "utf8"
        );

        const result = findAllAssociatedTestFiles(tempDir, "src/handlers/create-quickbooks-account.handler.ts");

        expect(result.hasExecutingTests).toBe(true);
        expect(result.linkedTestFiles.length).toBeGreaterThanOrEqual(1);

        const primary = result.primaryTestFile;
        expect(primary.found).toBe(true);
        expect(primary.filePath).toBe("tests/unit/handlers/create-account.handlers.test.ts");
        expect(primary.fileName).toBe("create-account.handlers.test.ts");
        expect(primary.relationType).toBe("DIRECT_IMPORT");
        expect(primary.testCode).toContain("createQuickbooksAccount");

        // Backward compatibility
        const compat = findAssociatedTestFile(tempDir, "src/handlers/create-quickbooks-account.handler.ts");
        expect(compat.found).toBe(true);
        expect(compat.filePath).toBe("tests/unit/handlers/create-account.handlers.test.ts");
    });

    it("should return multiple linked test files if multiple test suites touch the source file", () => {
        const srcDir = path.join(tempDir, "src", "services");
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, "billing.service.ts"), "export const charge = () => {};", "utf8");

        const testDir = path.join(tempDir, "tests");
        fs.mkdirSync(testDir, { recursive: true });

        // Test 1: Unit
        fs.writeFileSync(
            path.join(testDir, "billing-unit.test.ts"),
            "import { charge } from '../src/services/billing.service';",
            "utf8"
        );
        // Test 2: Integration
        fs.writeFileSync(
            path.join(testDir, "checkout-integration.test.ts"),
            "const { charge } = require('../src/services/billing.service');",
            "utf8"
        );

        const result = findAllAssociatedTestFiles(tempDir, "src/services/billing.service.ts");
        expect(result.linkedTestFiles.length).toBe(2);
        const paths = result.linkedTestFiles.map(f => f.filePath);
        expect(paths).toContain("tests/billing-unit.test.ts");
        expect(paths).toContain("tests/checkout-integration.test.ts");
    });
});
