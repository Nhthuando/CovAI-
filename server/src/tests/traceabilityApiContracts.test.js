import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import {
    findAllAssociatedTestFiles,
    findAssociatedTestFile,
    calculateTraceabilityScore
} from "../services/fileCoverage.service.js";
import { findExistingTestFile } from "../services/unitTestSuggestion.service.js";

describe("Section 4: Data Model & API Contracts Specification Invariant Verification", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-contract-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_) {}
    });

    // =========================================================================
    // 4.2. LinkedTestFile & TestTraceabilityMetadata Contract Adherence
    // =========================================================================
    describe("4.2 LinkedTestFile & TestTraceability Schema Conformance", () => {
        it("Returns all required contract fields with expected types", () => {
            const srcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "email.service.ts"), "export const send = () => {};", "utf8");

            const testDir = path.join(tempDir, "tests", "unit");
            fs.mkdirSync(testDir, { recursive: true });
            fs.writeFileSync(
                path.join(testDir, "email-dispatch.test.ts"),
                `
                import { send } from '../../src/services/email.service';
                it('dispatches email', () => {});
                it('handles smtp error', () => {});
                `,
                "utf8"
            );

            const result = findAllAssociatedTestFiles(tempDir, "src/services/email.service.ts");

            // Top-level envelope
            expect(result).toHaveProperty("primaryTestFile");
            expect(result).toHaveProperty("linkedTestFiles");
            expect(result).toHaveProperty("suggestedNewTestPath");
            expect(result).toHaveProperty("hasExecutingTests");

            expect(typeof result.hasExecutingTests).toBe("boolean");
            expect(Array.isArray(result.linkedTestFiles)).toBe(true);

            // Item contract: LinkedTestFile
            const item = result.primaryTestFile;
            expect(item).toHaveProperty("found");
            expect(typeof item.found).toBe("boolean");
            expect(item).toHaveProperty("filePath");
            expect(typeof item.filePath).toBe("string");
            expect(item).toHaveProperty("fileName");
            expect(typeof item.fileName).toBe("string");
            expect(item).toHaveProperty("suggestedFilePath");
            expect(typeof item.suggestedFilePath).toBe("string");
            expect(item).toHaveProperty("relationType");
            expect(["DIRECT_IMPORT", "EXECUTION_TRACE", "TRANSITIVE", "NAME_CONVENTION", "SELF", "NONE"]).toContain(item.relationType);
            expect(item).toHaveProperty("confidence");
            expect(typeof item.confidence).toBe("number");
            expect(item).toHaveProperty("score");
            expect(typeof item.score).toBe("number");
            expect(item).toHaveProperty("testCount");
            expect(typeof item.testCount).toBe("number");
            expect(item).toHaveProperty("testCode");
            expect(typeof item.testCode).toBe("string");
            expect(item).toHaveProperty("framework");
            expect(["jest", "vitest"]).toContain(item.framework);
            expect(item).toHaveProperty("isPrimary");
            expect(typeof item.isPrimary).toBe("boolean");
        });
    });

    // =========================================================================
    // 4.6. Contract Invariants 1, 2, 3, 4
    // =========================================================================
    describe("4.6 Mathematical Data Invariants (Invariants 1 - 4)", () => {
        let multiTestResult;

        beforeEach(() => {
            const srcDir = path.join(tempDir, "src", "domain");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "invoice.entity.ts"), "export class Invoice {}", "utf8");

            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(path.join(testsDir, "unit"), { recursive: true });
            fs.mkdirSync(path.join(testsDir, "integration"), { recursive: true });
            fs.mkdirSync(path.join(testsDir, "e2e"), { recursive: true });

            // Test 1: Unit (Name match + 5 tests)
            fs.writeFileSync(
                path.join(testsDir, "unit", "invoice.entity.test.ts"),
                `
                import { Invoice } from '../../src/domain/invoice.entity';
                it('t1', () => {}); it('t2', () => {}); it('t3', () => {}); it('t4', () => {}); it('t5', () => {});
                `,
                "utf8"
            );

            // Test 2: Integration (3 tests)
            fs.writeFileSync(
                path.join(testsDir, "integration", "billing-cycle.test.ts"),
                `
                import { Invoice } from '../../src/domain/invoice.entity';
                it('i1', () => {}); it('i2', () => {}); it('i3', () => {});
                `,
                "utf8"
            );

            // Test 3: E2E (1 test)
            fs.writeFileSync(
                path.join(testsDir, "e2e", "workflow.spec.ts"),
                `
                const { Invoice } = require('../../src/domain/invoice.entity');
                it('e1', () => {});
                `,
                "utf8"
            );

            multiTestResult = findAllAssociatedTestFiles(tempDir, "src/domain/invoice.entity.ts");
        });

        it("Invariant 1 (Primary Uniqueness): Exactly ONE item has isPrimary === true", () => {
            expect(multiTestResult.linkedTestFiles.length).toBe(3);

            const primaryItems = multiTestResult.linkedTestFiles.filter(t => t.isPrimary === true);
            expect(primaryItems.length).toBe(1);
        });

        it("Invariant 2 (Primary Identity Equivalence): Response.primaryTestFile === argmax(score)", () => {
            const sortedByScore = [...multiTestResult.linkedTestFiles].sort((a, b) => b.score - a.score);
            const highestScoring = sortedByScore[0];

            expect(multiTestResult.primaryTestFile.filePath).toBe(highestScoring.filePath);
            expect(multiTestResult.primaryTestFile.score).toBe(highestScoring.score);
            expect(multiTestResult.primaryTestFile.isPrimary).toBe(true);
        });

        it("Invariant 3 (Deterministic Score Ordering): linkedTestFiles is strictly descending by score", () => {
            const list = multiTestResult.linkedTestFiles;
            for (let i = 0; i < list.length - 1; i++) {
                expect(list[i].score).toBeGreaterThanOrEqual(list[i + 1].score);
            }
        });

        it("Invariant 4 (Execution Trace Sanity): hasExecutingTests === true when tests exist", () => {
            expect(multiTestResult.hasExecutingTests).toBe(true);
        });
    });

    // =========================================================================
    // 4.4. Zero-Breaking Backward Compatibility
    // =========================================================================
    describe("4.4 Zero-Breaking Backward Compatibility Guarantees", () => {
        it("findAssociatedTestFile returns primary test file for legacy consumer compatibility", () => {
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "math.js"), "export const add = (a, b) => a + b;", "utf8");

            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(testDir, { recursive: true });
            fs.writeFileSync(
                path.join(testDir, "calculator.test.js"),
                "import { add } from '../src/math'; it('adds', () => {});",
                "utf8"
            );

            const legacy = findAssociatedTestFile(tempDir, "src/math.js");
            expect(legacy).toBeDefined();
            expect(legacy.found).toBe(true);
            expect(legacy.filePath).toBe("tests/calculator.test.js");
            expect(legacy.relationType).toBe("DIRECT_IMPORT");
        });

        it("Greenfield fallback: returns found=false, relationType=NONE without crashing", () => {
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "untested.js"), "export const u = 1;", "utf8");

            const legacy = findAssociatedTestFile(tempDir, "src/untested.js");
            expect(legacy).toBeDefined();
            expect(legacy.found).toBe(false);
            expect(legacy.relationType).toBe("NONE");
            expect(legacy.filePath).toBeNull();
            expect(legacy.suggestedFilePath).toBe("tests/untested.test.js");
        });
    });

    // =========================================================================
    // 4.5. AI Context Extraction Contract
    // =========================================================================
    describe("4.5 AI Context Extraction Contract for unitTestSuggestion.service", () => {
        it("Extracts existing mocks and suites to prevent LLM mock collisions", () => {
            const srcDir = path.join(tempDir, "src", "handlers");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "payment.handler.ts"), "export const pay = () => {};", "utf8");

            const testDir = path.join(tempDir, "tests", "unit", "handlers");
            fs.mkdirSync(testDir, { recursive: true });
            fs.writeFileSync(
                path.join(testDir, "pay-actions.test.ts"),
                `
                import { describe, it, expect, jest } from '@jest/globals';
                const mockStripeClient = { charge: jest.fn() };
                jest.mock('../../../src/clients/stripe-client', () => ({ stripeClient: mockStripeClient }));
                const { pay } = await import('../../../src/handlers/payment.handler');

                describe('payment processing', () => {
                    it('charges stripe', () => { pay(); });
                });
                `,
                "utf8"
            );

            const existingContext = findExistingTestFile(tempDir, "src/handlers/payment.handler.ts");

            expect(existingContext.found).toBe(true);
            expect(existingContext.relativePath).toBe("tests/unit/handlers/pay-actions.test.ts");
            expect(existingContext.content).toContain("mockStripeClient");
            expect(existingContext.content).toContain("stripeClient");
            expect(existingContext.content).toContain("describe('payment processing'");
        });
    });
});
