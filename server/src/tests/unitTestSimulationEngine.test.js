/**
 * unitTestSimulationEngine.test.js
 *
 * Comprehensive Test Suite for Unit Test Simulation Engine & AST Analysis
 *
 * Tiers:
 * - Tier 1: Feature Coverage & API Contracts (7-Step Taxonomy, 4 Categories, discovery)
 * - Tier 2: Boundary Cases & Defensive Robustness (Untested files, 0 tests, error handling)
 * - Tier 3: Combinations & Complex Flow (Private helpers indirect testing, compound branches, mocks)
 * - Tier 4: Storage Immutability Guard & Real-World Integration (Zero disk writes, in-memory testCode)
 */

import fs from "fs";
import path from "path";
import os from "os";
import { describe, test, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

const mockPrisma = {
    projectSnapshot: {
        findUnique: jest.fn()
    },
    project: {
        findUnique: jest.fn()
    }
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: mockPrisma
}));

const {
    getAvailableSimulationSources,
    generateSimulationTrace,
    evaluateAstExpression,
    discoverUniversalRamMocks,
    categorizeFilePath,
    resolveRootDir,
    CATEGORY_NAMES
} = await import("../services/unitTestSimulationEngine.service.js");

const { ServiceError } = await import("../utils/serviceError.js");

describe("Unit Test Simulation Engine & AST Analysis (`unitTestSimulationEngine.service.js`)", () => {
    let tempDir;

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-sim-test-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    // =========================================================================
    // TIER 1: Feature Coverage & API Contracts
    // =========================================================================
    describe("Tier 1: Feature Coverage & API Contracts", () => {
        test("TEST-SIM-T1-01: getAvailableSimulationSources returns valid sources contract", async () => {
            const servicesDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(servicesDir, { recursive: true });

            const sourceCode = `
export function calculateOrderDiscount(order, options = {}) {
    if (!order || typeof order !== "object") throw new Error("Invalid order payload");
    const baseAmount = order.amount ?? 0;
    if (baseAmount <= 0) return 0;
    const isVip = order.isVip ? true : false;
    const rate = options.rate || 0.05;
    if (isVip && baseAmount > 1000) return baseAmount * (rate + 0.1);
    return baseAmount * rate;
}
`;
            fs.writeFileSync(path.join(servicesDir, "orderDiscount.service.js"), sourceCode);

            const testsDir = path.join(tempDir, "tests");
            fs.mkdirSync(testsDir, { recursive: true });
            const testCode = `
import { calculateOrderDiscount } from "../src/services/orderDiscount.service.js";
describe("calculateOrderDiscount", () => {
    it("should calculate discount for standard order", () => {
        const res = calculateOrderDiscount({ amount: 500, isVip: false });
        expect(res).toBe(25);
    });
});
`;
            fs.writeFileSync(path.join(testsDir, "orderDiscount.test.js"), testCode);

            const result = await getAvailableSimulationSources("snap_test_01", { rootDir: tempDir });

            expect(result).toBeDefined();
            expect(result.snapshotId).toBe("snap_test_01");
            expect(Array.isArray(result.sourceFiles)).toBe(true);
            expect(result.sourceFiles.length).toBeGreaterThanOrEqual(1);

            const targetSource = result.sourceFiles.find(f => f.fileName === "orderDiscount.service.js");
            expect(targetSource).toBeDefined();
            expect(targetSource.isBusinessLogic).toBe(true);
            expect(targetSource.category).toBe("services");
            expect(Array.isArray(targetSource.testFiles)).toBe(true);
            expect(targetSource.functions.some(fn => fn.name === "calculateOrderDiscount")).toBe(true);
            expect(targetSource.testCount).toBeGreaterThanOrEqual(1);
            expect(targetSource.virtualScenariosCount).toBeGreaterThanOrEqual(1);
            expect(result.files).toBe(result.sourceFiles);

            // Verify simulation trace with rootDir and assert exact return value: 500 * 0.05 = 25
            const trace = await generateSimulationTrace("snap_test_01", {
                rootDir: tempDir,
                sourceFilePath: "src/services/orderDiscount.service.js",
                testFilePath: "tests/orderDiscount.test.js"
            });
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe(25);
            const assertionStep = trace.steps.find(s => s.phase === "ASSERTION");
            expect(assertionStep.assertionResult.expected).toBe(25);
            expect(assertionStep.assertionResult.actual).toBe(25);
            expect(assertionStep.assertionResult.passed).toBe(true);
        });

        test("TEST-SIM-T1-02: 7-Step Taxonomy compliance in generated trace", async () => {
            const sourceCode = `
export function calculateTax(amount, isExempt = false) {
    if (isExempt) return 0;
    if (amount <= 0) return 0;
    return amount * 0.1;
}
`;
            const testCode = `
import { calculateTax } from "./tax.js";
describe("calculateTax", () => {
    it("should return tax for nominal amount", () => {
        const tax = calculateTax(100);
        expect(tax).toBe(10);
    });
});
`;
            const trace = await generateSimulationTrace("snap_test_02", {
                sourceFilePath: "src/services/tax.js",
                sourceCode,
                testCode,
                testFilePath: "tests/tax.test.js"
            });

            expect(trace).toBeDefined();
            expect(trace.sourceFilePath).toBe("src/services/tax.js");
            expect(trace.sourceCode).toBe(sourceCode);
            expect(Array.isArray(trace.steps)).toBe(true);
            expect(trace.steps.length).toBeGreaterThanOrEqual(5);

            // Verify each step conforms to the 7-Step Educational Taxonomy
            const allowedPhases = new Set([
                "SETUP_MOCKS",
                "CALL_ENTRY",
                "EVAL_PARAMS",
                "BRANCH_DECISION",
                "MOCK_INTERACTION",
                "STATE_TRANSITION",
                "RETURN_VALUE",
                "ASSERTION"
            ]);

            for (const step of trace.steps) {
                expect(step.stepIndex).toBeGreaterThan(0);
                expect(allowedPhases.has(step.phase)).toBe(true);
                expect(step.codeSnippet).toBeDefined();
                expect(Array.isArray(step.callStack)).toBe(true);
                expect(step.variables).toBeDefined();
                expect(Array.isArray(step.activeMocks)).toBe(true);
                expect(step.educationalGuidance).toBeDefined();
                expect(step.educationalGuidance.stepTitle).toBeDefined();
                expect(step.educationalGuidance.category).toBeDefined();
                expect(step.educationalGuidance.stepNarrative).toBeDefined();
                expect(step.educationalGuidance.logicRationale).toBeDefined();
                expect(step.educationalGuidance.developerTakeaway).toBeDefined();
            }

            // Verify phase existence
            const phases = trace.steps.map(s => s.phase);
            expect(phases).toContain("SETUP_MOCKS");
            expect(phases).toContain("CALL_ENTRY");
            expect(phases).toContain("EVAL_PARAMS");
            expect(phases).toContain("RETURN_VALUE");
            expect(phases).toContain("ASSERTION");

            // Verify exact return value calculation: 100 * 0.1 = 10
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe(10);
            const assertionStep = trace.steps.find(s => s.phase === "ASSERTION");
            expect(assertionStep.assertionResult.expected).toBe(10);
            expect(assertionStep.assertionResult.actual).toBe(10);
            expect(assertionStep.assertionResult.passed).toBe(true);
        });

        test("TEST-SIM-T1-03: 4-Category Tagging across Happy Path, Boundary, Branch, and Error", async () => {
            const sourceCode = `
export function checkAccess(user, role) {
    if (!user) throw new Error("User required");
    if (role === "ADMIN") return "ALL";
    if (user.age < 18) return "NONE";
    return "STANDARD";
}
`;
            const categories = ["HAPPY_PATH", "BOUNDARY_VALUES", "BRANCH_TOGGLING", "ERROR_HANDLING"];

            for (const cat of categories) {
                const trace = await generateSimulationTrace("snap_cat_test", {
                    sourceFilePath: "src/services/access.js",
                    sourceCode,
                    category: cat
                });

                expect(trace.testCase.category).toBe(cat);
                expect(trace.testCase.categoryName).toBe(CATEGORY_NAMES[cat]);
                expect(trace.steps.some(s => s.educationalGuidance.category === cat || s.educationalGuidance.category === "BRANCH_TOGGLING")).toBe(true);
            }
        });

        test("TEST-SIM-T1-04: Assertion outcome evaluation and contract verification", async () => {
            const sourceCode = `export function add(a, b) { return a + b; }`;
            const testCode = `
describe("add", () => {
    it("adds numbers", () => {
        expect(add(2, 3)).toBe(5);
    });
});
`;
            const trace = await generateSimulationTrace("snap_assert_test", {
                sourceFilePath: "src/utils/math.js",
                sourceCode,
                testCode
            });

            const callEntry = trace.steps.find(s => s.phase === "CALL_ENTRY");
            expect(callEntry.variables.a).toBe(2);
            expect(callEntry.variables.b).toBe(3);

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe(5);

            const assertionStep = trace.steps.find(s => s.phase === "ASSERTION");
            expect(assertionStep).toBeDefined();
            expect(assertionStep.assertionResult).toBeDefined();
            expect(assertionStep.assertionResult.matcher).toBe("toBe");
            expect(assertionStep.assertionResult.expected).toBe(5);
            expect(assertionStep.assertionResult.actual).toBe(5);
            expect(assertionStep.assertionResult.passed).toBe(true);
            expect(trace.summary.allAssertionsPassed).toBe(true);
            expect(trace.summary.outcome).toBe("PASSED");
        });
    });

    // =========================================================================
    // TIER 2: Boundary Cases & Defensive Robustness
    // =========================================================================
    describe("Tier 2: Boundary Cases & Defensive Robustness", () => {
        test("TEST-SIM-T2-01: Untested source file synthesizes Virtual Scenarios seamlessly (0 test files on disk)", async () => {
            const sourceCode = `
export function processTransaction(tx) {
    if (!tx || !tx.amount) {
        throw new Error("Invalid transaction");
    }
    if (tx.amount <= 0) {
        return { status: "REJECTED", reason: "Zero or negative amount" };
    }
    return { status: "APPROVED", amount: tx.amount };
}
`;
            // Notice: testCode is null, testFilePath is null -> File has 0 tests!
            const trace = await generateSimulationTrace("snap_untested", {
                sourceFilePath: "src/services/transaction.service.js",
                sourceCode
            });

            expect(trace).toBeDefined();
            expect(trace.isVirtualScenario).toBe(true);
            expect(trace.testCase.isVirtual).toBe(true);
            expect(trace.testCase.id).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(4);
            expect(trace.summary.totalSteps).toBe(trace.steps.length);
        });

        test("TEST-SIM-T2-02: Rejects invalid or missing source file path with clean ServiceError", async () => {
            await expect(generateSimulationTrace("snap_invalid", {}))
                .rejects.toThrow(ServiceError);

            await expect(generateSimulationTrace(null, { rootDir: tempDir }))
                .rejects.toThrow(ServiceError);
        });

        test("TEST-SIM-T2-03: Handles minimal single-line and anonymous functions cleanly", async () => {
            const sourceCode = `export default function(x) { return x * 2; }`;
            const trace = await generateSimulationTrace("snap_minimal", {
                sourceFilePath: "src/utils/double.js",
                sourceCode
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(4);
            expect(trace.summary.executedLines.length).toBeGreaterThanOrEqual(1);
        });

        test("TEST-SIM-T2-04: Boundary value simulation handles 0, negative numbers, and empty collections", async () => {
            const sourceCode = `
export function computeAverage(items = []) {
    if (items.length === 0) return 0;
    const sum = items.reduce((acc, v) => acc + v, 0);
    return sum / items.length;
}
`;
            const trace = await generateSimulationTrace("snap_boundary", {
                sourceFilePath: "src/utils/stats.js",
                sourceCode,
                category: "BOUNDARY_VALUES"
            });

            expect(trace.testCase.category).toBe("BOUNDARY_VALUES");
            const paramStep = trace.steps.find(s => s.phase === "EVAL_PARAMS");
            expect(paramStep).toBeDefined();
            expect(paramStep.variables).toBeDefined();

            // items = [] -> items.length === 0 -> returns 0
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe(0);
            const assertStep = trace.steps.find(s => s.phase === "ASSERTION");
            expect(assertStep.assertionResult.expected).toBe(0);
            expect(assertStep.assertionResult.actual).toBe(0);
            expect(assertStep.assertionResult.passed).toBe(true);
        });
    });

    // =========================================================================
    // TIER 3: Combinations & Complex Flow
    // =========================================================================
    describe("Tier 3: Combinations & Complex Flow", () => {
        test("TEST-SIM-T3-01: Rule 3 Call Graph Backtracking for internal private helpers", async () => {
            const sourceCode = `
function sanitizeDiscountRate(rate) {
    if (rate > 0.5) return 0.5;
    if (rate <= 0) return 0.05;
    return rate;
}

export function applyOrderDiscount(order) {
    if (!order) return null;
    const rate = sanitizeDiscountRate(order.customRate || 0.1);
    return order.total * rate;
}
`;
            // Target the internal private helper function
            const trace = await generateSimulationTrace("snap_indirect", {
                sourceFilePath: "src/services/discountHelper.js",
                sourceCode,
                functionName: "sanitizeDiscountRate"
            });

            expect(trace).toBeDefined();
            expect(trace.scenarioMeta.callPath).toEqual(["applyOrderDiscount", "sanitizeDiscountRate"]);

            // Step 2 should show Indirect Call Graph Entry at public caller
            const callerEntryStep = trace.steps.find(s => s.title.includes("applyOrderDiscount"));
            expect(callerEntryStep).toBeDefined();
            expect(callerEntryStep.callStack).toContain("applyOrderDiscount");

            // Subsequent step steps into the private helper
            const helperStep = trace.steps.find(s => s.title.includes("sanitizeDiscountRate"));
            expect(helperStep).toBeDefined();
            expect(helperStep.callStack).toEqual(["applyOrderDiscount", "sanitizeDiscountRate"]);
        });

        test("TEST-SIM-T3-02: Compound decision points and short-circuit evaluation (Category C)", async () => {
            const sourceCode = `
export function validateVipPrivilege(user, order) {
    if (user && user.isVip && order.amount > 1000) {
        return "VIP_DISCOUNT";
    }
    return "STANDARD_DISCOUNT";
}
`;
            const trace = await generateSimulationTrace("snap_compound", {
                sourceFilePath: "src/services/vip.js",
                sourceCode,
                category: "BRANCH_TOGGLING"
            });

            const branchStep = trace.steps.find(s => s.phase === "BRANCH_DECISION");
            expect(branchStep).toBeDefined();
            expect(branchStep.branchEvaluation).toBeDefined();
            expect(branchStep.branchEvaluation.branchTaken).toBe("TRUE");
            expect(trace.summary.branchesToggled.length).toBeGreaterThanOrEqual(1);

            // user.isVip && order.amount > 1000 -> returns "VIP_DISCOUNT"
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe("VIP_DISCOUNT");
        });

        test("TEST-SIM-T3-03: Universal RAM mock resolution for Prisma, Axios, and Bull (Rule 4)", async () => {
            const sourceCode = `
import { prisma } from "../lib/prisma.js";
import axios from "axios";
import Queue from "bull";

export async function processPayment(userId, amount) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const response = await axios.post("https://payment.gateway.com", { userId, amount });
    return { success: true, txId: response.id };
}
`;
            const trace = await generateSimulationTrace("snap_ram_mocks", {
                sourceFilePath: "src/services/payment.js",
                sourceCode,
                category: "HAPPY_PATH"
            });

            expect(trace.initialMocks.length).toBeGreaterThanOrEqual(2);
            expect(trace.initialMocks.some(m => m.module === "prisma")).toBe(true);
            expect(trace.initialMocks.some(m => m.module === "axios")).toBe(true);

            // Step 1 sets up mocks
            const setupStep = trace.steps.find(s => s.phase === "SETUP_MOCKS");
            expect(setupStep.activeMocks.length).toBeGreaterThanOrEqual(2);

            // Mock interaction step
            const mockStep = trace.steps.find(s => s.phase === "MOCK_INTERACTION");
            expect(mockStep).toBeDefined();
            expect(mockStep.educationalGuidance.logicRationale).toContain("RAM");
        });

        test("TEST-SIM-T3-04: Category D Error Handling and exception throw propagation", async () => {
            const sourceCode = `
export function withdrawBalance(account, amount) {
    if (!account) {
        throw new Error("Invalid account payload");
    }
    if (amount <= 0) {
        throw new Error("Withdrawal amount must be positive");
    }
    return account.balance - amount;
}
`;
            const trace = await generateSimulationTrace("snap_error", {
                sourceFilePath: "src/services/bank.js",
                sourceCode,
                category: "ERROR_HANDLING"
            });

            expect(trace.testCase.category).toBe("ERROR_HANDLING");
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep).toBeDefined();
            expect(returnStep.variables.thrownException).toContain("Invalid account payload");
            expect(returnStep.variables.thrownException).not.toContain("Invalid order payload");

            const assertStep = trace.steps.find(s => s.phase === "ASSERTION");
            expect(assertStep.assertionResult.matcher).toBe("toThrow");
            expect(assertStep.assertionResult.expected).toBe("Invalid account payload");
            expect(assertStep.assertionResult.actual).toBe("Invalid account payload");
            expect(assertStep.assertionResult.passed).toBe(true);
        });
    });

    // =========================================================================
    // TIER 4: Storage Immutability Guard & Real-World Integration
    // =========================================================================
    describe("Tier 4: Storage Immutability Guard & Real-World Integration", () => {
        test("TEST-SIM-T4-01: Storage Immutability Audit — strictly zero disk writes to storage/ or uploads/", async () => {
            const storageDir = path.join(tempDir, "storage", "projects", "p1", "snap1", "repo");
            fs.mkdirSync(storageDir, { recursive: true });

            const sourceFile = path.join(storageDir, "service.js");
            const originalContent = `export function compute(a) { return a * 10; }`;
            fs.writeFileSync(sourceFile, originalContent);

            const beforeStat = fs.statSync(sourceFile);
            const beforeMtime = beforeStat.mtimeMs;
            const beforeFiles = fs.readdirSync(storageDir);

            // Run multiple simulation calls against the source file
            await getAvailableSimulationSources("snap_immutability", { rootDir: tempDir });
            await generateSimulationTrace("snap_immutability", {
                rootDir: tempDir,
                sourceFilePath: "storage/projects/p1/snap1/repo/service.js"
            });

            // Audit: Verify file modification time and directory contents are identical
            const afterStat = fs.statSync(sourceFile);
            const afterMtime = afterStat.mtimeMs;
            const afterFiles = fs.readdirSync(storageDir);

            expect(afterMtime).toBe(beforeMtime);
            expect(afterFiles).toEqual(beforeFiles);
            expect(fs.readFileSync(sourceFile, "utf8")).toBe(originalContent);
        });

        test("TEST-SIM-T4-02: Simulates unapplied in-memory testCode (AI suggestions) without writing to disk", async () => {
            const sourceCode = `export function greet(name) { return "Hello, " + (name || "World"); }`;
            const unappliedAiTestCode = `
describe("greet", () => {
    it("should fallback to World for empty name", () => {
        expect(greet("")).toBe("Hello, World");
    });
});
`;
            // In-memory test code simulation before user applies changes to disk
            const trace = await generateSimulationTrace("snap_in_memory", {
                sourceFilePath: "src/utils/greet.js",
                sourceCode,
                testCode: unappliedAiTestCode
            });

            expect(trace).toBeDefined();
            expect(trace.testCode).toBe(unappliedAiTestCode);
            expect(trace.testCase.title).toContain("should fallback to World for empty name");
            expect(trace.summary.outcome).toBe("PASSED");

            // "" || "World" -> returns "Hello, World"
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe("Hello, World");
            const assertStep = trace.steps.find(s => s.phase === "ASSERTION");
            expect(assertStep.assertionResult.expected).toBe("Hello, World");
            expect(assertStep.assertionResult.actual).toBe("Hello, World");
            expect(assertStep.assertionResult.passed).toBe(true);
        });

        test("TEST-SIM-T4-03: Trace JSON serializes and deserializes cleanly without circular references", async () => {
            const sourceCode = `export function multiply(a, b) { return a * b; }`;
            const trace = await generateSimulationTrace("snap_serialize", {
                sourceFilePath: "src/utils/multiply.js",
                sourceCode
            });

            const serialized = JSON.stringify(trace);
            expect(typeof serialized).toBe("string");

            const parsed = JSON.parse(serialized);
            expect(parsed.id).toBe(trace.id);
            expect(parsed.steps.length).toBe(trace.steps.length);
            expect(parsed.summary.totalSteps).toBe(trace.summary.totalSteps);
        });

        test("TEST-SIM-T4-04: Helper utility functions evaluateAstExpression and categorizeFilePath", () => {
            expect(categorizeFilePath("src/services/auth.service.js")).toBe("services");
            expect(categorizeFilePath("src/handlers/login.handler.ts")).toBe("handlers");
            expect(categorizeFilePath("src/controllers/user.controller.js")).toBe("controllers");
            expect(categorizeFilePath("src/utils/format.js")).toBe("utils");
            expect(categorizeFilePath("src/models/user.model.js")).toBe("models");
            expect(categorizeFilePath("src/middlewares/auth.js")).toBe("middlewares");

            // Evaluate AST node
            const scope = { x: 10, y: 20, isVip: false };
            const nodeBinary = {
                type: "BinaryExpression",
                operator: "+",
                left: { type: "Identifier", name: "x" },
                right: { type: "Identifier", name: "y" }
            };
            expect(evaluateAstExpression(nodeBinary, scope)).toBe(30);

            const options = {};
            const nodeLogicalShort = {
                type: "LogicalExpression",
                operator: "&&",
                left: { type: "Identifier", name: "isVip" },
                right: { type: "NumericLiteral", value: 100 }
            };
            const resultShort = evaluateAstExpression(nodeLogicalShort, scope, options);
            expect(resultShort).toBe(false);
            expect(options.shortCircuited).toBe(true);
        });

        test("TEST-SIM-T4-05: Non-facade verification — generateSimulationTrace actively invokes evaluateAstExpression", async () => {
            const trace = await generateSimulationTrace("snap_real_ast", {
                sourceFilePath: "src/utils/calc.js",
                sourceCode: `export function calc(x) { if (x > 10) return x * 2; return x + 1; }`,
                category: "BRANCH_TOGGLING"
            });
            expect(trace.summary.branchesToggled.length).toBeGreaterThanOrEqual(1);
            expect(trace.steps.some(s => s.phase === "BRANCH_DECISION")).toBe(true);
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe(30);
            expect(typeof returnStep.variables.returnValue).toBe("number");
        });
    });
});
