import { describe, test, expect } from "@jest/globals";
import {
    parseExistingTestAst,
    buildDecisionTableMatrix,
    buildIndirectTestingStrategy,
    buildIsolationMockContracts,
    assembleUnitTestContext
} from "../services/unitTestContextEngineering.service.js";
import {
    analyzeSourceAst,
    mapCoverageGaps
} from "../services/businessLogicAstAnalyzer.service.js";
import {
    buildStandardUnitTestPrompt
} from "../services/unitTestGenerator.service.js";
import { isLocContained } from "../services/unreachableCodeDetector.service.js";

describe("Adaptive Unit Test Generator Engine - Milestone 2 Verification", () => {
    // ------------------------------------------------------------------------
    // 1. AST Existing Test Inspection (parseExistingTestAst)
    // ------------------------------------------------------------------------
    describe("1. AST Existing Test Inspector (parseExistingTestAst)", () => {
        test("extracts suites, test cases, assertions, and classifies into 4 categories", () => {
            const testCode = `
import { describe, it, test, expect } from 'vitest';
import { calculateDiscount } from '../services/discount.service.js';

describe('DiscountService', () => {
    it('[Category A: Happy Path] calculates nominal discount for valid order', () => {
        const order = { id: 1, amount: 100 };
        const result = calculateDiscount(order);
        expect(result).toBe(10);
    });

    it('[Category B: Boundary] handles 0 amount gracefully', () => {
        const result = calculateDiscount({ amount: 0 });
        expect(result).toBe(0);
    });

    test('[Category C: Branch Toggling] applies fallback rate when options are omitted', () => {
        const result = calculateDiscount({ amount: 50 }, undefined);
        expect(result).toBe(5);
    });

    it('[Category D: Error Handling] throws error when order is null', () => {
        expect(() => calculateDiscount(null)).toThrow('Invalid order');
    });

    it.skip('skipped test scenario', () => {
        expect(true).toBe(true);
    });
});
`;
            const analysis = parseExistingTestAst(testCode, "tests/discount.service.test.js");

            expect(analysis.suites).toContain("DiscountService");
            expect(analysis.totalTests).toBe(5);
            expect(analysis.skippedTests).toBe(1);

            // Tested functions
            expect(analysis.testedFunctions).toContain("calculateDiscount");

            // Categories
            expect(analysis.coveredCategories.HAPPY_PATH).toBe(1);
            expect(analysis.coveredCategories.BOUNDARY_VALUES).toBe(1);
            expect(analysis.coveredCategories.BRANCH_TOGGLING).toBe(1);
            expect(analysis.coveredCategories.ERROR_HANDLING).toBe(1);

            // Detailed test properties
            const happyTest = analysis.tests.find(t => t.category === "HAPPY_PATH");
            expect(happyTest).toBeDefined();
            expect(happyTest.assertionTypes).toContain("toBe");
            expect(happyTest.isSkipped).toBe(false);

            const errTest = analysis.tests.find(t => t.category === "ERROR_HANDLING");
            expect(errTest).toBeDefined();
            expect(errTest.assertionTypes).toContain("toThrow");

            const skippedTest = analysis.tests.find(t => t.title === "skipped test scenario");
            expect(skippedTest.isSkipped).toBe(true);
        });

        test("classifies tests based on title heuristics, call arguments, and assertions when tags are absent", () => {
            const testCode = `
describe('Payment Gateway', () => {
    it('returns receipt on successful payment', () => {
        expect(pay({ amount: 100 })).toEqual({ status: 'PAID' });
    });

    it('handles negative or zero balance limit', () => {
        expect(pay({ amount: -1 })).toBe(0);
    });

    it('toggles conditional discount when coupon is expired', () => {
        expect(pay({ amount: 100, coupon: 'EXPIRED' })).toBe(100);
    });

    it('rejects transaction when gateway network fails', async () => {
        await expect(pay({ fail: true })).rejects.toThrow();
    });
});
`;
            const analysis = parseExistingTestAst(testCode);
            expect(analysis.coveredCategories.HAPPY_PATH).toBe(1);
            expect(analysis.coveredCategories.BOUNDARY_VALUES).toBe(1);
            expect(analysis.coveredCategories.BRANCH_TOGGLING).toBe(1);
            expect(analysis.coveredCategories.ERROR_HANDLING).toBe(1);
        });

        test("handles empty or malformed test code safely without throwing", () => {
            const emptyRes = parseExistingTestAst("");
            expect(emptyRes.totalTests).toBe(0);
            expect(emptyRes.tests).toEqual([]);

            const nullRes = parseExistingTestAst(null);
            expect(nullRes.totalTests).toBe(0);

            // Malformed code should fall back to regex without crashing
            const malformedCode = `it('handles edge case', () => {`;
            const malformedRes = parseExistingTestAst(malformedCode);
            expect(malformedRes.totalTests).toBe(1);
            expect(malformedRes.tests[0].title).toBe("handles edge case");
        });
    });

    // ------------------------------------------------------------------------
    // 2. Delta Decision Table Matrix (buildDecisionTableMatrix)
    // ------------------------------------------------------------------------
    describe("2. Delta Decision Table Matrix & Anti-Duplication", () => {
        const sourceCode = `
export function processTransaction(tx, options = {}) {
    if (!tx || typeof tx !== 'object') {
        throw new Error('Transaction object required');
    }

    const amount = tx.amount ?? 0;
    if (amount <= 0) {
        return { success: false, reason: 'INVALID_AMOUNT' };
    }

    const feeRate = options.feeRate || 0.02;
    const isVip = tx.isVip ? true : false;

    if (isVip) {
        return { success: true, netAmount: amount };
    }

    const fee = amount * feeRate;
    return { success: true, netAmount: amount - fee };
}
`;

        test("computes full Decision Table when no existing test file is provided", () => {
            const astMeta = analyzeSourceAst(sourceCode);
            const coverageGaps = mapCoverageGaps({
                astMetadata: astMeta,
                sourceCode,
                uncoveredLinesList: [3, 4, 7, 8, 12, 13, 15, 16]
            });

            const result = buildDecisionTableMatrix({
                astMetadata: astMeta,
                coverageGaps,
                sourceCode,
                existingTestCode: ""
            });

            expect(result.matrixEntries.length).toBeGreaterThanOrEqual(4);
            expect(result.deltaDecisionTable.length).toBeGreaterThanOrEqual(4);
            expect(result.summary.deltaCount).toBe(result.deltaDecisionTable.length);
            expect(result.summary.alreadyTestedCount).toBe(0);

            // All items satisfy the interface contract
            for (const item of result.deltaDecisionTable) {
                expect(item).toHaveProperty("id");
                expect(item).toHaveProperty("category");
                expect(item).toHaveProperty("targetFunction");
                expect(item).toHaveProperty("functionName");
                expect(item).toHaveProperty("scenario");
                expect(item).toHaveProperty("expectedBehavior");
                expect(item).toHaveProperty("priority");
                expect(item.isAlreadyTested).toBe(false);
                expect(item.isInfeasible).toBe(false);
            }
        });

        test("subtracts already-tested scenarios from existingTestCode and generates targeted delta", () => {
            const astMeta = analyzeSourceAst(sourceCode);
            const coverageGaps = mapCoverageGaps({
                astMetadata: astMeta,
                sourceCode,
                uncoveredLinesList: [3, 4, 12, 13, 15, 16] // Line 3 (throw Error) and VIP/fee lines uncovered
            });

            // Existing test covers Happy Path and Boundary B1
            const existingTestCode = `
describe('processTransaction', () => {
    it('[Category A: Happy Path] processes transaction with valid amount', () => {
        const res = processTransaction({ amount: 100 });
        expect(res.success).toBe(true);
    });

    it('[Category B: Boundary] handles 0 or negative amount gracefully', () => {
        const res = processTransaction({ amount: 0 });
        expect(res.success).toBe(false);
    });
});
`;
            const result = buildDecisionTableMatrix({
                astMetadata: astMeta,
                coverageGaps,
                sourceCode,
                existingTestCode
            });

            expect(result.summary.alreadyTestedCount).toBeGreaterThanOrEqual(2);

            // Category A and B items are marked already tested with LOW priority
            const happyItem = result.matrixEntries.find(e => e.category === "HAPPY_PATH");
            expect(happyItem.isAlreadyTested).toBe(true);
            expect(happyItem.priority).toBe("LOW");

            // Delta table only contains unexercised scenarios
            expect(result.deltaDecisionTable.some(e => e.category === "HAPPY_PATH")).toBe(false);
            expect(result.deltaDecisionTable.some(e => e.category === "BRANCH_TOGGLING")).toBe(true);
            expect(result.deltaDecisionTable.some(e => e.category === "ERROR_HANDLING")).toBe(true);
        });

        test("excludes verified infeasible/unreachable branches from deltaDecisionTable", () => {
            const codeWithInfeasible = `
export function checkConfig() {
    if (process.env.NODE_ENV === 'production') {
        return 'PROD';
    }
    return 'TEST';
}
`;
            const astMeta = analyzeSourceAst(codeWithInfeasible);
            // Branch at line 3 is an environment guard (infeasible in NODE_ENV='test')
            const coverageGaps = mapCoverageGaps({
                astMetadata: astMeta,
                sourceCode: codeWithInfeasible,
                uncoveredLinesList: [4] // Line 4 is the return 'PROD' statement
            });

            const result = buildDecisionTableMatrix({
                astMetadata: astMeta,
                coverageGaps,
                sourceCode: codeWithInfeasible,
                existingTestCode: ""
            });

            // Infeasible branch must be tagged
            const infeasibleEntry = result.matrixEntries.find(e => e.condition.includes("[TRUE]") && e.isInfeasible);
            expect(infeasibleEntry).toBeDefined();
            expect(infeasibleEntry.priority).toBe("LOW");
            expect(infeasibleEntry.justification).toContain("process.env.NODE_ENV");

            // Infeasible item must NOT appear in deltaDecisionTable
            expect(result.deltaDecisionTable.some(e => e.id === infeasibleEntry.id)).toBe(false);

            // Infeasible summary should record justification
            expect(result.infeasibleSummaries.length).toBeGreaterThanOrEqual(1);
            expect(result.infeasibleSummaries[0].justification).toContain("process.env.NODE_ENV");
        });
    });

    // ------------------------------------------------------------------------
    // 3. Successive Suggestion Cycles / Non-Repeating Generation
    // ------------------------------------------------------------------------
    describe("3. Successive Suggestion Cycles (Non-Repeating Generation)", () => {
        const sourceCode = `
export function calculateShipping(order) {
    if (!order) throw new Error('Order missing');
    if (order.total <= 0) return 0;
    if (order.isFreeShipping) return 0;
    return 15;
}
`;

        test("successive cycles progressively shrink the delta table until all feasible logic is tested", () => {
            const astMeta = analyzeSourceAst(sourceCode);

            // Cycle 1: Baseline (0 tests on disk)
            const gapsCycle1 = mapCoverageGaps({
                astMetadata: astMeta,
                sourceCode,
                uncoveredLinesList: [3, 4, 5, 6]
            });
            const cycle1 = buildDecisionTableMatrix({
                astMetadata: astMeta,
                coverageGaps: gapsCycle1,
                sourceCode,
                existingTestCode: ""
            });
            expect(cycle1.deltaDecisionTable.length).toBeGreaterThan(0);
            const cycle1DeltaCount = cycle1.deltaDecisionTable.length;

            // Cycle 2: User applied tests covering Happy Path + Error Handling
            const testCodeCycle2 = `
describe('calculateShipping', () => {
    it('[Category A: Happy Path] calculates standard shipping rate', () => {
        expect(calculateShipping({ total: 100 })).toBe(15);
    });
    it('[Category D: Error Handling] throws error when order is missing', () => {
        expect(() => calculateShipping(null)).toThrow('Order missing');
    });
});
`;
            const gapsCycle2 = mapCoverageGaps({
                astMetadata: astMeta,
                sourceCode,
                uncoveredLinesList: [4, 5] // Only total <= 0 and free shipping branches remain
            });
            const cycle2 = buildDecisionTableMatrix({
                astMetadata: astMeta,
                coverageGaps: gapsCycle2,
                sourceCode,
                existingTestCode: testCodeCycle2
            });

            // Cycle 2 delta must be strictly smaller than Cycle 1
            expect(cycle2.deltaDecisionTable.length).toBeLessThan(cycle1DeltaCount);
            // Happy path and Error handling are excluded
            expect(cycle2.deltaDecisionTable.some(e => e.category === "HAPPY_PATH")).toBe(false);
            expect(cycle2.deltaDecisionTable.some(e => e.category === "ERROR_HANDLING")).toBe(false);

            // Cycle 3: User applied tests covering Boundary and remaining branches
            const testCodeCycle3 = `
${testCodeCycle2}
describe('calculateShipping - Additional Branches', () => {
    it('[Category B: Boundary] returns 0 when total is 0 or negative', () => {
        expect(calculateShipping({ total: 0 })).toBe(0);
        expect(calculateShipping({ total: -5 })).toBe(0);
    });
    it('[Category B: Boundary] handles empty order object {}', () => {
        expect(calculateShipping({})).toBe(15);
    });
    it('[Category C: Branch Toggling] returns 0 when free shipping is true', () => {
        expect(calculateShipping({ total: 50, isFreeShipping: true })).toBe(0);
    });
});
`;
            const gapsCycle3 = mapCoverageGaps({
                astMetadata: astMeta,
                sourceCode,
                uncoveredLinesList: [] // 100% coverage reached
            });
            const cycle3 = buildDecisionTableMatrix({
                astMetadata: astMeta,
                coverageGaps: gapsCycle3,
                sourceCode,
                existingTestCode: testCodeCycle3
            });

            // All feasible scenarios tested -> delta is 0
            expect(cycle3.deltaDecisionTable.length).toBe(0);
            expect(cycle3.summary.deltaCount).toBe(0);
            expect(cycle3.deltaDecisionTableMarkdown).toContain("All feasible test scenarios are covered or already tested");
        });
    });

    // ------------------------------------------------------------------------
    // 4. Same-Line Coordinate Containment Refinement
    // ------------------------------------------------------------------------
    describe("4. Same-Line Coordinate Containment Refinement", () => {
        test("prevents same-line environment guard from falsely marking adjacent feasible branch as infeasible", () => {
            // Both conditionals reside on the exact same line 2
            const code = `
const isProd = (process.env.NODE_ENV === 'production') ? true : false; const isAdmin = (role === 'admin') ? 1 : 2;
`;
            const astMeta = analyzeSourceAst(code);

            // Verify AST extraction identified both decision points
            expect(astMeta.decisionPoints.length).toBe(2);

            // Suppose both branches are uncovered
            const fileCoverage = {
                b: {
                    0: [0, 1], // Branch 0 (environment guard): missedTrue
                    1: [0, 1]  // Branch 1 (role === 'admin'): missedTrue
                },
                branchMap: {
                    0: {
                        line: 2,
                        loc: astMeta.decisionPoints[0].loc,
                        locations: [
                            astMeta.decisionPoints[0].loc,
                            astMeta.decisionPoints[0].loc
                        ]
                    },
                    1: {
                        line: 2,
                        loc: astMeta.decisionPoints[1].loc,
                        locations: [
                            astMeta.decisionPoints[1].loc,
                            astMeta.decisionPoints[1].loc
                        ]
                    }
                },
                s: { 0: 1 },
                statementMap: { 0: { start: { line: 2, column: 0 }, end: { line: 2, column: 110 } } },
                f: {},
                fnMap: {}
            };

            const gaps = mapCoverageGaps({
                astMetadata: astMeta,
                fileCoverageData: fileCoverage,
                sourceCode: code,
                uncoveredLinesList: []
            });

            expect(gaps.uncoveredBranches.length).toBe(2);

            // Branch 0 (process.env.NODE_ENV === 'production') MUST be tagged infeasible
            const envBranch = gaps.uncoveredBranches.find(b => isLocContained(b.loc, astMeta.decisionPoints[0].loc) || b.loc.start.column === astMeta.decisionPoints[0].loc.start.column);
            expect(envBranch.isInfeasible).toBe(true);
            expect(envBranch.infeasibleMeta?.type).toBe("ENVIRONMENT_GUARD");

            // Branch 1 (role === 'admin') MUST remain FEASIBLE (no false positive from same-line sharing!)
            const roleBranch = gaps.uncoveredBranches.find(b => b.loc.start.column === astMeta.decisionPoints[1].loc.start.column);
            expect(roleBranch.isInfeasible).toBeFalsy();
        });
    });

    // ------------------------------------------------------------------------
    // 5. AST Call Graph Backtracking for Private Helpers
    // ------------------------------------------------------------------------
    describe("5. AST Call Graph Backtracking for Private Helpers", () => {
        test("resolves single-level call path from exported caller to internal helper", () => {
            const sourceCode = `
function formatCurrency(val) {
    return '$' + Number(val).toFixed(2);
}

export function displayInvoice(amount) {
    return formatCurrency(amount);
}
`;
            const astMeta = analyzeSourceAst(sourceCode);
            expect(astMeta.callEdges.length).toBeGreaterThanOrEqual(1);

            const result = buildIndirectTestingStrategy({
                astMetadata: astMeta,
                sourceCode
            });

            expect(result.indirectStrategies.length).toBe(1);
            const strat = result.indirectStrategies[0];
            expect(strat.helperName).toBe("formatCurrency");
            expect(strat.exportedCallers).toContain("displayInvoice");
            expect(strat.callChains).toContain("displayInvoice -> formatCurrency");
            expect(strat.guidance).toContain('displayInvoice -> formatCurrency');
            expect(result.indirectGuidancePrompt).toContain("NEVER write `import { formatCurrency }`");
        });

        test("resolves multi-level deep call chain: ExportedA -> HelperB -> DeepHelperC", () => {
            const sourceCode = `
function deepSanitizer(text) {
    return text.trim().toLowerCase();
}

function midHelper(input) {
    return deepSanitizer(input) + '!';
}

export function publicApiEndpoint(payload) {
    return midHelper(payload.data);
}
`;
            const astMeta = analyzeSourceAst(sourceCode);
            const result = buildIndirectTestingStrategy({
                astMetadata: astMeta,
                sourceCode
            });

            expect(result.indirectStrategies.length).toBe(2);

            // Deep helper should trace back to publicApiEndpoint through midHelper
            const deepStrat = result.indirectStrategies.find(s => s.helperName === "deepSanitizer");
            expect(deepStrat).toBeDefined();
            expect(deepStrat.exportedCallers).toContain("publicApiEndpoint");
            expect(deepStrat.callChains.some(c => c.includes("publicApiEndpoint") && c.includes("deepSanitizer"))).toBe(true);
        });

        test("supports calling convention buildIndirectTestingStrategy(unexportedHelpers, astMetadata, sourceCode)", () => {
            const sourceCode = `
function helper(x) { return x * 2; }
export function main(y) { return helper(y); }
`;
            const astMeta = analyzeSourceAst(sourceCode);
            const result = buildIndirectTestingStrategy(["helper"], astMeta, sourceCode);
            expect(result.indirectStrategies.length).toBe(1);
            expect(result.indirectStrategies[0].exportedCallers).toContain("main");
        });
    });

    // ------------------------------------------------------------------------
    // 6. Universal Hermetic RAM Mock Contracts
    // ------------------------------------------------------------------------
    describe("6. Universal Hermetic RAM Mock Contracts", () => {
        test("detects Redis/ioredis and generates in-memory Map mock client", () => {
            const sourceCode = `
import Redis from 'ioredis';
const redis = new Redis();

export async function getCachedUser(id) {
    const raw = await redis.get('user:' + id);
    if (!raw) {
        await redis.set('user:' + id, JSON.stringify({ id }), 'EX', 3600);
        return { id };
    }
    return JSON.parse(raw);
}
`;
            const result = buildIsolationMockContracts({
                sourceCode,
                existingTestCode: "",
                framework: "jest"
            });

            expect(result.detectedDependencies).toContain("redis-cache");
            expect(result.mockPreambleCode).toContain("_createRedisMockClient");
            expect(result.mockPreambleCode).toContain("mockRedisClient");
            expect(result.mockPreambleCode).toContain("jest.mock('ioredis'");
            expect(result.mockPreambleCode).toContain("jest.mock('redis'");
            expect(result.mockInstructions).toContain("Redis Cache");
        });

        test("detects Mongoose and generates in-memory proxy query mock", () => {
            const sourceCode = `
const mongoose = require('mongoose');
const User = mongoose.model('User');

export async function findUser(id) {
    return User.findById(id).lean();
}
`;
            const result = buildIsolationMockContracts({
                sourceCode,
                existingTestCode: "",
                framework: "jest"
            });

            expect(result.detectedDependencies).toContain("mongoose-db");
            expect(result.mockPreambleCode).toContain("_createMongooseModelProxy");
            expect(result.mockPreambleCode).toContain("jest.mock('mongoose'");
            expect(result.mockInstructions).toContain("Mongoose DB");
        });

        test("detects Sequelize and generates in-memory define and query mock", () => {
            const sourceCode = `
import { Sequelize, DataTypes } from 'sequelize';

export function defineUserModel(sequelize) {
    return sequelize.define('User', {
        name: DataTypes.STRING
    });
}
`;
            const result = buildIsolationMockContracts({
                sourceCode,
                existingTestCode: "",
                framework: "jest"
            });

            expect(result.detectedDependencies).toContain("sequelize-db");
            expect(result.mockPreambleCode).toContain("_createSequelizeModelProxy");
            expect(result.mockPreambleCode).toContain("jest.mock('sequelize'");
            expect(result.mockInstructions).toContain("Sequelize DB");
        });

        test("generates Vitest-compatible Redis and Mongoose mocks when framework is vitest", () => {
            const sourceCode = `
import Redis from 'ioredis';
import mongoose from 'mongoose';
`;
            const result = buildIsolationMockContracts({
                sourceCode,
                existingTestCode: "",
                framework: "vitest"
            });

            expect(result.mockPreambleCode).toContain("vi.mock('ioredis'");
            expect(result.mockPreambleCode).toContain("vi.mock('mongoose'");
            expect(result.mockPreambleCode).not.toContain("jest.mock");
        });
    });

    // ------------------------------------------------------------------------
    // 7. Prompt Template Cleanup & Delta Decision Table Injection
    // ------------------------------------------------------------------------
    describe("7. Standard Prompt Template Cleanup & Delta Table Injection", () => {
        test("ensures accidental JS code snippet is completely removed from prompt template", () => {
            const unitTestContext = assembleUnitTestContext({
                sourceCode: "export function run() { return true; }",
                framework: "jest"
            });

            const prompt = buildStandardUnitTestPrompt({
                framework: "jest",
                cleanSource: "src/services/demo.js",
                testFileInfo: { relativePath: "src/tests/demo.test.js", found: true, content: "// existing test" },
                cleanImportPath: "../services/demo.js",
                coverageDetails: { uncoveredLines: [1] },
                sourceCode: "export function run() { return true; }",
                unitTestContext
            });

            // The accidental pasted code MUST NOT exist anywhere in the prompt
            expect(prompt).not.toContain("if (typeof deduplicateAstDeclarations === 'function')");
            expect(prompt).not.toContain("deduplicateAstDeclarations(currentCode");
        });

        test("injects Delta Decision Table, non-repetition rules, and bans fake assertions in prompt", () => {
            const sourceCode = `
export function compute(x) {
    if (x > 10) return 'HIGH';
    return 'LOW';
}
`;
            const unitTestContext = assembleUnitTestContext({
                sourceCode,
                framework: "jest",
                existingTestCode: "it('handles nominal', () => expect(compute(15)).toBe('HIGH'));"
            });

            const prompt = buildStandardUnitTestPrompt({
                framework: "jest",
                cleanSource: "src/services/compute.js",
                testFileInfo: { relativePath: "src/tests/compute.test.js", found: true, content: "// existing" },
                cleanImportPath: "../services/compute.js",
                coverageDetails: { uncoveredLines: [3] },
                sourceCode,
                unitTestContext
            });

            expect(prompt).toContain("MANDATORY DELTA DECISION TABLE");
            expect(prompt).toContain("CRITICAL NON-DUPLICATION INVARIANT");
            expect(prompt).toContain("Never re-test already covered scenarios");
            expect(prompt).toContain("Never generate fake or tautological assertions");
            expect(prompt).toContain("expect(true).toBe(true)");
        });
    });
});
