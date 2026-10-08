import { describe, test, expect } from "@jest/globals";
import {
    buildDecisionTableMatrix,
    buildIndirectTestingStrategy,
    buildIsolationMockContracts,
    assembleUnitTestContext
} from "../services/unitTestContextEngineering.service.js";
import { analyzeSourceAst, mapCoverageGaps } from "../services/businessLogicAstAnalyzer.service.js";

describe("Unit Test Context Engineering Service - Phase 2 Verification", () => {
    describe("2.1 Ma Trận Kiểm Thử (Decision Table / Truth Table Engine)", () => {
        test("constructs an exhaustive 4-category test matrix for a business module", () => {
            const sourceCode = `
export function calculateOrderDiscount(order, options = {}) {
    if (!order || typeof order !== "object") {
        throw new Error("Invalid order payload");
    }

    const baseAmount = order.amount ?? 0;
    if (baseAmount <= 0) {
        return 0;
    }

    const isVip = order.isVip ? true : false;
    const rate = options.rate || 0.05;

    if (isVip && baseAmount > 1000) {
        return baseAmount * (rate + 0.1);
    }

    return baseAmount * rate;
}
`;
            const astMeta = analyzeSourceAst(sourceCode);
            const coverageGaps = mapCoverageGaps({
                astMetadata: astMeta,
                sourceCode,
                uncoveredLinesList: [14, 15] // Vip branch uncovered
            });

            const result = buildDecisionTableMatrix({
                astMetadata: astMeta,
                coverageGaps,
                sourceCode
            });

            expect(result.matrixEntries.length).toBeGreaterThanOrEqual(4);
            expect(result.summary.totalTestCases).toBeGreaterThanOrEqual(4);

            // 1. Happy Path
            const happyPath = result.matrixEntries.filter(e => e.category === "HAPPY_PATH");
            expect(happyPath.length).toBeGreaterThanOrEqual(1);
            expect(happyPath[0].targetFunction).toBe("calculateOrderDiscount");

            // 2. Boundary Values (0, negative, empty)
            const boundaries = result.matrixEntries.filter(e => e.category === "BOUNDARY_VALUES");
            expect(boundaries.length).toBeGreaterThanOrEqual(2);
            expect(boundaries.some(b => b.condition.includes("Numerical limits"))).toBe(true);
            expect(boundaries.some(b => b.condition.includes("Empty collections"))).toBe(true);

            // 3. Branch Toggling (True vs False, ??, ||, ?.)
            const branches = result.matrixEntries.filter(e => e.category === "BRANCH_TOGGLING");
            expect(branches.length).toBeGreaterThanOrEqual(2);
            expect(branches.some(b => b.condition.includes("[TRUE]"))).toBe(true);
            expect(branches.some(b => b.condition.includes("[FALSE]"))).toBe(true);

            // 4. Error & Exception Handling (throw, catch, reject)
            const errors = result.matrixEntries.filter(e => e.category === "ERROR_HANDLING");
            expect(errors.length).toBeGreaterThanOrEqual(1);
            expect(errors[0].condition).toContain("throw");

            // Verify Markdown generation
            expect(result.decisionTableMarkdown).toContain("| ID | Target Function | Category |");
            expect(result.decisionTableMarkdown).toContain("calculateOrderDiscount");
            expect(result.decisionTableMarkdown).toContain("Happy Path");
        });
    });

    describe("2.2 Chiến Lược Kiểm Thử Gián Tiếp (Indirect Testing Strategy)", () => {
        test("maps internal unexported helpers to their exported callers with strict testing directive", () => {
            const sourceCode = `
// Internal helper function
function applyVipDiscount(amount) {
    if (amount > 500) {
        return amount * 0.2;
    }
    return amount * 0.1;
}

// Exported public API
export function processOrder(order) {
    if (!order) return null;
    if (order.type === 'VIP') {
        return applyVipDiscount(order.amount);
    }
    return order.amount;
}
`;
            const astMeta = analyzeSourceAst(sourceCode);
            const result = buildIndirectTestingStrategy({
                astMetadata: astMeta,
                sourceCode
            });

            expect(result.indirectStrategies).toHaveLength(1);
            const strategy = result.indirectStrategies[0];
            expect(strategy.helperName).toBe("applyVipDiscount");
            expect(strategy.exportedCallers).toContain("processOrder");
            expect(strategy.warning).toContain("DO NOT IMPORT DIRECTLY - TEST INDIRECTLY VIA EXPORTED CALLER");
            expect(strategy.guidance).toContain('Helper function "applyVipDiscount"');
            expect(strategy.guidance).toContain('processOrder');

            expect(result.indirectGuidancePrompt).toContain("STRICT INDIRECT TESTING MANDATE FOR INTERNAL HELPER \"applyVipDiscount\"");
            expect(result.indirectGuidancePrompt).toContain("NEVER write `import { applyVipDiscount }`");
        });

        test("handles modules with all public exports cleanly", () => {
            const sourceCode = `
export function add(a, b) { return a + b; }
export function sub(a, b) { return a - b; }
`;
            const astMeta = analyzeSourceAst(sourceCode);
            const result = buildIndirectTestingStrategy({
                astMetadata: astMeta,
                sourceCode
            });

            expect(result.indirectStrategies).toHaveLength(0);
            expect(result.indirectGuidancePrompt).toContain("All business functions are publicly exported");
        });
    });

    describe("2.3 Hợp Đồng Mocking Độc Lập (Isolation Mock Contracts)", () => {
        test("detects Prisma, Axios, Bull, Env vars, and Express controller usage for Jest", () => {
            const sourceCode = `
import { prisma } from '../lib/prisma.js';
import axios from 'axios';
const Queue = require('bull');

export async function handlePaymentController(req, res, next) {
    const secret = process.env.PAYMENT_SECRET_KEY;
    const { userId, amount } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const response = await axios.post('https://api.gateway.com/pay', { amount, secret });

    const queue = new Queue('receipts');
    await queue.add({ userId, amount });

    return res.status(200).json({ success: true, txId: response.data.id });
}
`;
            const result = buildIsolationMockContracts({
                sourceCode,
                existingTestCode: "",
                framework: "jest"
            });

            expect(result.detectedDependencies).toContain("environment-variables");
            expect(result.detectedDependencies).toContain("prisma-db");
            expect(result.detectedDependencies).toContain("axios-http");
            expect(result.detectedDependencies).toContain("bull-queue");
            expect(result.detectedDependencies).toContain("express-controller");

            // Mock preamble checks
            expect(result.mockPreambleCode).toContain("process.env.PAYMENT_SECRET_KEY");
            expect(result.mockPreambleCode).toContain("jest.mock('@prisma/client'");
            expect(result.mockPreambleCode).toContain("jest.mock('axios'");
            expect(result.mockPreambleCode).toContain("jest.mock('bull'");
            expect(result.mockPreambleCode).toContain("createMockReqResNext");

            // Instructions
            expect(result.mockInstructions).toContain("MANDATORY ISOLATION MOCK CONTRACTS");
            expect(result.mockInstructions).toContain("Prisma DB");
            expect(result.mockInstructions).toContain("Axios HTTP");
            expect(result.mockInstructions).toContain("Bull Queue");
            expect(result.mockInstructions).toContain("Express Controllers");
        });

        test("generates Vitest-compatible mock preambles when framework is vitest", () => {
            const sourceCode = `
import axios from 'axios';
import { prisma } from '../lib/prisma.js';

export async function fetchProfile(userId) {
    return prisma.user.findFirst({ where: { id: userId } });
}
`;
            const result = buildIsolationMockContracts({
                sourceCode,
                existingTestCode: "",
                framework: "vitest"
            });

            expect(result.mockPreambleCode).toContain("vi.mock('axios'");
            expect(result.mockPreambleCode).toContain("vi.mock('@prisma/client'");
            expect(result.mockPreambleCode).not.toContain("jest.mock");
        });
    });

    describe("2.4 Context Assembler Orchestration (assembleUnitTestContext)", () => {
        test("integrates Phase 1 AST Analysis and Phase 2 Context Engineering into unified prompt context", () => {
            const sourceCode = `
function sanitizeEmail(email) {
    return email ? email.trim().toLowerCase() : "";
}

export function registerUser(email, password) {
    if (!email) {
        throw new Error("Email required");
    }
    const clean = sanitizeEmail(email);
    return { email: clean, active: true };
}
`;
            const coverageDetails = {
                lines: {},
                uncoveredLines: [3, 4], // sanitizeEmail lines uncovered
                summary: { linesPct: 50, branchesPct: 50, funcsPct: 50, stmtsPct: 50 }
            };

            const result = assembleUnitTestContext({
                sourceCode,
                coverageDetails,
                framework: "jest"
            });

            expect(result.astMetadata).toBeDefined();
            expect(result.coverageGaps).toBeDefined();
            expect(result.decisionTable).toBeDefined();
            expect(result.indirectTesting).toBeDefined();
            expect(result.mockContracts).toBeDefined();

            // Prompt content checks
            expect(result.engineeredPromptContext).toContain("SECTION 1: PUBLIC APIS & INDIRECT TESTING DIRECTIVE");
            expect(result.engineeredPromptContext).toContain("SECTION 2: ISOLATION MOCK CONTRACTS");
            expect(result.engineeredPromptContext).toContain("SECTION 3: MANDATORY DECISION TABLE TEST MATRIX");
            expect(result.engineeredPromptContext).toContain("SECTION 4: COVERAGE GAPS & TARGETED DECISION GUIDANCE");
            expect(result.engineeredPromptContext).toContain("registerUser");
            expect(result.engineeredPromptContext).toContain("sanitizeEmail");
        });
    });
});
