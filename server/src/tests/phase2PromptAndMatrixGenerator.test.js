import { describe, test, expect } from "@jest/globals";
import {
    buildDecisionTableMatrix,
    buildIndirectTestingStrategy,
    buildIsolationMockContracts,
    assembleUnitTestContext
} from "../services/unitTestContextEngineering.service.js";
import {
    buildUnitTestPrompt,
    buildStandardUnitTestPrompt,
    generateFallbackUnitTests,
    extractSourceGapsAndDecisions
} from "../services/unitTestSuggestion.service.js";
import { analyzeSourceAst, mapCoverageGaps } from "../services/businessLogicAstAnalyzer.service.js";

describe("Phase 2: Prompt Engineering & Test Matrix Generator Verification", () => {
    const complexBusinessSourceCode = `
import { Queue } from "bullmq";
import axios from "axios";
import { prisma } from "../lib/prisma.js";

const notificationQueue = new Queue("notifications");

// Internal helper function (unexported)
function calculateTierMultiplier(tier = "silver") {
    if (tier === "platinum") return 1.5;
    if (tier === "gold") return 1.2;
    return 1.0;
}

// Public API
export async function processCustomerInvoice(invoice, options = {}) {
    if (!invoice || typeof invoice !== "object") {
        throw new Error("Invalid invoice payload");
    }

    const baseAmount = invoice.amount ?? 0;
    if (baseAmount <= 0) {
        return { success: false, reason: "Zero or negative amount" };
    }

    const multiplier = calculateTierMultiplier(invoice.tier);
    const taxRate = options.taxRate || 0.1;
    const finalTotal = baseAmount * multiplier * (1 + taxRate);

    try {
        const savedRecord = await prisma.invoice.create({
            data: {
                customerId: invoice.customerId,
                amount: finalTotal,
                status: "PROCESSED"
            }
        });

        if (options.notifyCustomer) {
            await notificationQueue.add("send-receipt", {
                invoiceId: savedRecord.id,
                email: invoice.email
            });
        }

        return {
            success: true,
            invoiceId: savedRecord.id,
            total: finalTotal
        };
    } catch (dbErr) {
        throw new Error("Database transaction failure: " + dbErr.message);
    }
}
`;

    describe("2.1 Test Matrix Generator (4 Mandatory Categories)", () => {
        test("generates exhaustive 4-category test matrix containing Happy Path, Boundary Values, Branch Toggling, and Error Handling", () => {
            const astMeta = analyzeSourceAst(complexBusinessSourceCode);
            const coverageGaps = mapCoverageGaps({
                astMetadata: astMeta,
                sourceCode: complexBusinessSourceCode,
                uncoveredLinesList: [18, 19, 23, 37, 38]
            });

            const matrixResult = buildDecisionTableMatrix({
                astMetadata: astMeta,
                coverageGaps,
                sourceCode: complexBusinessSourceCode
            });

            expect(matrixResult).toBeDefined();
            expect(matrixResult.matrixEntries.length).toBeGreaterThanOrEqual(4);
            expect(matrixResult.summary.totalTestCases).toBeGreaterThanOrEqual(4);

            // Category A: Happy Path
            const happyEntries = matrixResult.matrixEntries.filter(e => e.category === "HAPPY_PATH");
            expect(happyEntries.length).toBeGreaterThanOrEqual(1);
            expect(happyEntries[0].categoryName).toContain("Happy Path");
            expect(happyEntries[0].targetFunction).toBe("processCustomerInvoice");

            // Category B: Boundary Values (0, negative, empty)
            const boundaryEntries = matrixResult.matrixEntries.filter(e => e.category === "BOUNDARY_VALUES");
            expect(boundaryEntries.length).toBeGreaterThanOrEqual(2);
            expect(boundaryEntries.some(b => b.condition.includes("Numerical limits"))).toBe(true);
            expect(boundaryEntries.some(b => b.condition.includes("Empty collections"))).toBe(true);

            // Category C: Branch Toggling (True/False, ??, ||, default-arg)
            const branchEntries = matrixResult.matrixEntries.filter(e => e.category === "BRANCH_TOGGLING");
            expect(branchEntries.length).toBeGreaterThanOrEqual(2);
            expect(branchEntries.some(b => b.condition.includes("[TRUE]") || b.condition.includes("Nullish") || b.condition.includes("Default argument"))).toBe(true);

            // Category D: Error & Exception Handling (throw, catch, reject)
            const errorEntries = matrixResult.matrixEntries.filter(e => e.category === "ERROR_HANDLING");
            expect(errorEntries.length).toBeGreaterThanOrEqual(1);
            expect(errorEntries.some(e => e.condition.includes("throw") || e.condition.includes("catch"))).toBe(true);

            // Decision Table Markdown representation
            expect(matrixResult.decisionTableMarkdown).toContain("| ID | Target Function | Category |");
            expect(matrixResult.decisionTableMarkdown).toContain("processCustomerInvoice");
        });

        test("extractSourceGapsAndDecisions combines AST metadata, coverage gaps, and 4-category decision table", () => {
            const fullAnalysis = extractSourceGapsAndDecisions({
                sourceCode: complexBusinessSourceCode,
                uncoveredLines: [18, 23]
            });

            expect(fullAnalysis.astMetadata.exportedSymbols).toContain("processCustomerInvoice");
            expect(fullAnalysis.astMetadata.unexportedFunctions).toContain("calculateTierMultiplier");
            expect(fullAnalysis.decisionTable.categories.happyPath).toBeGreaterThanOrEqual(1);
            expect(fullAnalysis.decisionTable.categories.boundary).toBeGreaterThanOrEqual(1);
            expect(fullAnalysis.decisionTable.categories.branchToggling).toBeGreaterThanOrEqual(1);
            expect(fullAnalysis.decisionTable.categories.exceptions).toBeGreaterThanOrEqual(1);
            expect(fullAnalysis.indirectStrategy.recommendations.length).toBeGreaterThanOrEqual(1);
            expect(fullAnalysis.indirectStrategy.recommendations[0].helper).toBe("calculateTierMultiplier");
        });
    });

    describe("2.2 Isolation Mock Contracts (Prisma, Axios, BullMQ, process.env, Fake Timers)", () => {
        test("generates Jest isolation mock contracts for Prisma proxy, BullMQ, Axios, and process.env", () => {
            const sourceWithDeps = `
                const queue = new Queue('orders');
                const client = new PrismaClient();
                const res = await axios.get('https://api.example.com');
                const timeout = setTimeout(() => {}, 1000);
                const secret = process.env.API_SECRET_KEY;
            `;

            const contracts = buildIsolationMockContracts({
                sourceCode: sourceWithDeps,
                framework: "jest"
            });

            expect(contracts.detectedDependencies).toContain("bull-queue");
            expect(contracts.detectedDependencies).toContain("prisma-db");
            expect(contracts.detectedDependencies).toContain("axios-http");
            expect(contracts.detectedDependencies).toContain("environment-variables");
            expect(contracts.detectedDependencies).toContain("timers-async");

            // Prisma Client Proxy with $transaction
            expect(contracts.mockPreambleCode).toContain("jest.mock('@prisma/client'");
            expect(contracts.mockPreambleCode).toContain("$transaction");
            expect(contracts.mockPreambleCode).toContain("mockPrisma");

            // Bull & BullMQ Queue
            expect(contracts.mockPreambleCode).toContain("jest.mock('bullmq'");
            expect(contracts.mockPreambleCode).toContain("Worker");
            expect(contracts.mockPreambleCode).toContain("Queue");

            // Axios
            expect(contracts.mockPreambleCode).toContain("jest.mock('axios'");
            expect(contracts.mockPreambleCode).toContain("_mockAxios");

            // Process.env
            expect(contracts.mockPreambleCode).toContain("process.env.API_SECRET_KEY");

            // Fake Timers
            expect(contracts.mockPreambleCode).toContain("jest.useFakeTimers()");

            // Instructions
            expect(contracts.mockInstructions).toContain("MANDATORY ISOLATION MOCK CONTRACTS");
            expect(contracts.mockInstructions).toContain("Prisma DB");
            expect(contracts.mockInstructions).toContain("Axios HTTP");
        });

        test("generates Vitest isolation mock contracts with vi.mock syntax", () => {
            const sourceWithDeps = `
                import { Queue } from 'bullmq';
                import axios from 'axios';
                import { prisma } from '../lib/prisma.js';
                const key = process.env.JWT_SECRET;
            `;

            const contracts = buildIsolationMockContracts({
                sourceCode: sourceWithDeps,
                framework: "vitest"
            });

            expect(contracts.mockPreambleCode).toContain("vi.mock('@prisma/client'");
            expect(contracts.mockPreambleCode).toContain("vi.mock('bullmq'");
            expect(contracts.mockPreambleCode).toContain("vi.mock('axios'");
            expect(contracts.mockPreambleCode).toContain("process.env.JWT_SECRET");
            expect(contracts.mockPreambleCode).not.toContain("jest.mock");
        });
    });

    describe("2.3 Standard Prompt Engineering (buildUnitTestPrompt)", () => {
        test("constructs 6-part standardized prompt for Jest with strict generation rules and anti-skip policy", () => {
            const prompt = buildUnitTestPrompt({
                framework: "jest",
                sourceCode: complexBusinessSourceCode,
                filePath: "src/services/invoice.service.js",
                targetTestFile: "tests/invoice.service.test.js",
                coverageDetails: {
                    uncoveredLines: [18, 19, 23],
                    summary: { linesPct: 75, branchesPct: 60, funcsPct: 100, stmtsPct: 75 }
                }
            });

            // 1. Role Definition & Project Context
            expect(prompt).toContain("### 1. ROLE DEFINITION & PROJECT CONTEXT");
            expect(prompt).toContain("JEST");
            expect(prompt).toContain("In CommonJS NEVER import or declare 'jest'");

            // 2. Target File & Import Contract
            expect(prompt).toContain("calculateTierMultiplier");
            expect(prompt).toContain("is NOT exported");

            // 3. Current Coverage Diagnostics & Gaps
            expect(prompt).toContain("### 3. CURRENT COVERAGE DIAGNOSTICS & GAPS");
            expect(prompt).toContain("Lines 18-19, 23");

            // 4. Source Code
            expect(prompt).toContain("### 4. SOURCE CODE");
            expect(prompt).toContain("processCustomerInvoice");

            // 5. Strict Generation Rules & Methodology
            expect(prompt).toContain("### 5. STRICT GENERATION RULES & METHODOLOGY");
            expect(prompt).toContain("NEVER USE test.skip / it.skip / describe.skip / xit / xtest");
            expect(prompt).toContain("MANDATORY TEST MATRIX (DECISION TABLE)");
            expect(prompt).toContain("Category A (Happy Path)");
            expect(prompt).toContain("Category B (Boundary Values)");
            expect(prompt).toContain("Category C (Branch Toggling)");
            expect(prompt).toContain("Category D (Error & Exception Handling)");
            expect(prompt).toContain("DO NOT write placeholder assertions like expect(true).toBe(true)");
            expect(prompt).toContain("ISOLATION MOCK CONTRACTS");

            // 6. Output Format
            expect(prompt).toContain("### 6. OUTPUT FORMAT");
            expect(prompt).toContain('"explanation"');
            expect(prompt).toContain('"suggestedTestCode"');
            expect(prompt).toContain('"fullUpdatedContent"');
        });

        test("constructs standardized prompt for Vitest with vi syntax and ESM import rules", () => {
            const prompt = buildUnitTestPrompt({
                framework: "vitest",
                sourceCode: complexBusinessSourceCode,
                filePath: "src/services/invoice.service.js",
                targetTestFile: "tests/invoice.service.vitest.test.js"
            });

            expect(prompt).toContain("VITEST");
            expect(prompt).toContain("import { describe, test, it, expect, vi } from 'vitest'");
            expect(prompt).toContain("MANDATORY TEST MATRIX (DECISION TABLE)");
            expect(prompt).toContain("ISOLATION MOCK CONTRACTS");
        });
    });

    describe("2.4 Fallback Unit Test Suite Generation (4-Category Structure)", () => {
        test("generates fallback test file organized across all 4 testing categories without .skip", () => {
            const fallbackResult = generateFallbackUnitTests({
                framework: "jest",
                sourceFile: "src/services/invoice.service.js",
                targetTestFile: "tests/invoice.service.test.js",
                baseName: "invoice.service",
                uncoveredLines: [18, 23],
                sourceCode: complexBusinessSourceCode
            });

            expect(fallbackResult).toBeDefined();
            expect(fallbackResult.fullUpdatedContent).toBeDefined();

            const content = fallbackResult.fullUpdatedContent;

            // Strict zero .skip rule
            expect(content).not.toMatch(/\b(test|it|describe)\.skip\b/);
            expect(content).not.toMatch(/\b(xit|xtest|xdescribe)\b/);

            // Zero placeholder assertions
            expect(content).not.toContain("expect(true).toBe(true)");
            expect(content).not.toContain("// TODO");
            expect(content).not.toContain("N/A");

            // All 4 testing categories present in generated tests
            expect(content).toContain("[Category A: Happy Path]");
            expect(content).toContain("[Category B: Boundary Values]");
            expect(content).toContain("[Category C: Branch Toggling]");
            expect(content).toContain("[Category D: Error Handling]");

            // Isolation Mock Preambles present
            expect(content).toContain("mockPrisma");
            expect(content).toContain("bullmq");
            expect(content).toContain("axios");

            // Correct relative import
            expect(content).toContain("processCustomerInvoice");
            expect(content).toContain("../src/services/invoice.service");
        });

        test("generates 4-category fallback tests for Express controllers with req, res, next mocks", () => {
            const controllerSource = `
                export async function createOrderController(req, res, next) {
                    if (!req.body.amount) return res.status(400).json({ error: "Missing amount" });
                    res.status(201).json({ success: true });
                }
            `;

            const fallbackResult = generateFallbackUnitTests({
                framework: "vitest",
                sourceFile: "src/controllers/order.controller.js",
                targetTestFile: "tests/order.controller.test.js",
                baseName: "order.controller",
                sourceCode: controllerSource
            });

            const content = fallbackResult.fullUpdatedContent;

            expect(content).toContain("import { describe, test, expect } from 'vitest'");
            expect(content).toContain("[Category A: Happy Path]");
            expect(content).toContain("[Category B: Boundary Values]");
            expect(content).toContain("[Category C: Branch Toggling]");
            expect(content).toContain("[Category D: Error Handling]");
            expect(content).toContain("res.json");
            expect(content).toContain("res.status");
        });
    });
});
