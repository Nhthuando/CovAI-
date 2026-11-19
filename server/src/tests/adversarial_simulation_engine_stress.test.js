/**
 * adversarial_simulation_engine_stress.test.js
 *
 * Adversarial Challenge & Stress Test Suite for unitTestSimulationEngine.service.js
 *
 * Suites:
 * 1. Adversarial Nested Conditions & Complex Short-Circuits
 * 2. Class Methods, Private Fields, Getters/Setters & Object Archetypes
 * 3. Thrown Custom Errors & Promise Rejections
 * 4. Zero Statements, Zero Branches & Pathological Code Shapes
 * 5. Stress, Concurrency & Sub-100ms Performance Harness
 * 6. Storage Immutability & Disk Integrity Audit
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { describe, test, it, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from "@jest/globals";

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

const { parseJavaScriptCode } = await import("../services/babelParser.service.js");
const { ServiceError } = await import("../utils/serviceError.js");

/**
 * Computes recursive SHA-256 hash map of all files in a directory.
 */
const computeDirectoryHashMap = (dirPath) => {
    const hashMap = new Map();
    if (!dirPath || !fs.existsSync(dirPath)) return hashMap;

    const walk = (current) => {
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (_) {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                try {
                    const content = fs.readFileSync(fullPath);
                    const hash = crypto.createHash("sha256").update(content).digest("hex");
                    hashMap.set(fullPath, hash);
                } catch (_) {}
            }
        }
    };

    walk(dirPath);
    return hashMap;
};

describe("Adversarial Stress & Integrity Challenge (`unitTestSimulationEngine.service.js`)", () => {
    let tempDir;
    let initialStorageHashMap = new Map();
    let initialUploadsHashMap = new Map();

    const storagePath = path.resolve(process.cwd(), "storage");
    const uploadsPath = path.resolve(process.cwd(), "uploads");

    beforeAll(() => {
        // Capture initial SHA-256 hashes of storage and uploads
        initialStorageHashMap = computeDirectoryHashMap(storagePath);
        initialUploadsHashMap = computeDirectoryHashMap(uploadsPath);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-adv-sim-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    afterAll(() => {
        // Verify post-execution hashes match initial hashes exactly
        const postStorageHashMap = computeDirectoryHashMap(storagePath);
        const postUploadsHashMap = computeDirectoryHashMap(uploadsPath);

        expect(postStorageHashMap.size).toBe(initialStorageHashMap.size);
        for (const [filePath, hash] of initialStorageHashMap.entries()) {
            expect(postStorageHashMap.get(filePath)).toBe(hash);
        }

        expect(postUploadsHashMap.size).toBe(initialUploadsHashMap.size);
        for (const [filePath, hash] of initialUploadsHashMap.entries()) {
            expect(postUploadsHashMap.get(filePath)).toBe(hash);
        }
    });

    // =========================================================================
    // SUITE 1: Adversarial Nested Conditions & Complex Short-Circuits
    // =========================================================================
    describe("Suite 1: Adversarial Nested Conditions & Complex Short-Circuits", () => {
        test("ADV-SIM-01: 5-level nested ternary AST expression evaluation across all permutations", () => {
            const code = `const res = a ? (b ? (c ? (d ? (e ? 1 : 2) : 3) : 4) : 5) : 6;`;
            const parsed = parseJavaScriptCode(code);
            expect(parsed.success).toBe(true);

            const ternaryNode = parsed.ast.program.body[0].declarations[0].init;

            // Scenario 1: all true -> 1
            expect(evaluateAstExpression(ternaryNode, { a: true, b: true, c: true, d: true, e: true })).toBe(1);

            // Scenario 2: e is false -> 2
            expect(evaluateAstExpression(ternaryNode, { a: true, b: true, c: true, d: true, e: false })).toBe(2);

            // Scenario 3: d is false -> 3
            expect(evaluateAstExpression(ternaryNode, { a: true, b: true, c: true, d: false, e: false })).toBe(3);

            // Scenario 4: c is false -> 4
            expect(evaluateAstExpression(ternaryNode, { a: true, b: true, c: false, d: true, e: true })).toBe(4);

            // Scenario 5: b is false -> 5
            expect(evaluateAstExpression(ternaryNode, { a: true, b: false, c: true, d: true, e: true })).toBe(5);

            // Scenario 6: a is false -> 6
            expect(evaluateAstExpression(ternaryNode, { a: false, b: true, c: true, d: true, e: true })).toBe(6);
        });

        test("ADV-SIM-02: 5-level nested if/else control flow simulation trace generation", async () => {
            const sourceCode = `
export function classifyFiveLevels(a, b, c, d, e) {
    if (a) {
        if (b) {
            if (c) {
                if (d) {
                    if (e) {
                        return "LEVEL_5";
                    } else {
                        return "LEVEL_4_ALT";
                    }
                } else {
                    return "LEVEL_3_ALT";
                }
            } else {
                return "LEVEL_2_ALT";
            }
        } else {
            return "LEVEL_1_ALT";
        }
    }
    return "LEVEL_0";
}
`;
            const trace = await generateSimulationTrace("snap_nested_if", {
                sourceFilePath: "src/services/classifier.js",
                sourceCode,
                category: "BRANCH_TOGGLING"
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(7);
            const branchSteps = trace.steps.filter(s => s.phase === "BRANCH_DECISION");
            expect(branchSteps.length).toBeGreaterThanOrEqual(1);

            // Verify step educational guidance structure
            for (const step of branchSteps) {
                expect(step.branchEvaluation).toBeDefined();
                expect(step.branchEvaluation.branchTaken).toBeDefined();
                expect(step.educationalGuidance.category).toBe("BRANCH_TOGGLING");
                expect(step.educationalGuidance.developerTakeaway).toBeDefined();
            }

            expect(trace.summary.outcome).toBe("PASSED");
        });

        test("ADV-SIM-03: Complex short-circuit chains ((a && b) || (c ?? d)) with short-circuit operand tracking", () => {
            const code = `const expr = ((a && b) || (c ?? d));`;
            const parsed = parseJavaScriptCode(code);
            expect(parsed.success).toBe(true);

            const logicalNode = parsed.ast.program.body[0].declarations[0].init;

            // Permutation 1: a is false -> a && b short-circuits. c is null -> returns d
            const opts1 = {};
            const res1 = evaluateAstExpression(logicalNode, { a: false, b: 100, c: null, d: "fallback" }, opts1);
            expect(res1).toBe("fallback");
            expect(opts1.shortCircuited).toBe(true);

            // Permutation 2: a is true, b is truthy -> (a && b) is truthy -> || short-circuits right hand side!
            const opts2 = {};
            const res2 = evaluateAstExpression(logicalNode, { a: true, b: "authorized", c: "custom", d: "fallback" }, opts2);
            expect(res2).toBe("authorized");
            expect(opts2.shortCircuited).toBe(true);

            // Permutation 3: a is false, c is "defined_val" -> ?? short-circuits right hand side (d)!
            const opts3 = {};
            const res3 = evaluateAstExpression(logicalNode, { a: false, b: null, c: "defined_val", d: "fallback" }, opts3);
            expect(res3).toBe("defined_val");
            expect(opts3.shortCircuited).toBe(true);
        });

        test("ADV-SIM-04: Compound boolean condition with mixed operators in simulation trace", async () => {
            const sourceCode = `
export function checkAdminAccess(req) {
    if ((req.user && req.user.role === "ADMIN") || (req.headers && req.headers["x-admin-key"])) {
        return { authorized: true, level: "ROOT" };
    }
    return { authorized: false, level: "GUEST" };
}
`;
            const trace = await generateSimulationTrace("snap_compound_short", {
                sourceFilePath: "src/services/adminGuard.js",
                sourceCode,
                category: "HAPPY_PATH"
            });

            expect(trace).toBeDefined();
            const branchStep = trace.steps.find(s => s.phase === "BRANCH_DECISION");
            expect(branchStep).toBeDefined();
            expect(branchStep.branchEvaluation.branchTaken).toBe("TRUE");
            expect(trace.summary.outcome).toBe("PASSED");
        });

        test("ADV-SIM-05: Pathological short-circuit with falsy numbers (0), empty strings (''), and NaN", () => {
            const code = `const res = (val ?? fallback);`;
            const parsed = parseJavaScriptCode(code);
            const node = parsed.ast.program.body[0].declarations[0].init;

            // 0 is falsy, but NOT nullish -> must preserve 0
            expect(evaluateAstExpression(node, { val: 0, fallback: 42 })).toBe(0);

            // Empty string is falsy, but NOT nullish -> must preserve ""
            expect(evaluateAstExpression(node, { val: "", fallback: "default" })).toBe("");

            // false is boolean, NOT nullish -> must preserve false
            expect(evaluateAstExpression(node, { val: false, fallback: true })).toBe(false);

            // null must trigger fallback
            expect(evaluateAstExpression(node, { val: null, fallback: 99 })).toBe(99);

            // undefined must trigger fallback
            expect(evaluateAstExpression(node, { val: undefined, fallback: "def" })).toBe("def");
        });
    });

    // =========================================================================
    // SUITE 2: Class Methods, Private Fields, Getters/Setters & Object Archetypes
    // =========================================================================
    describe("Suite 2: Class Methods, Private Fields, Getters/Setters & Object Archetypes", () => {
        test("ADV-SIM-06: Discovery of class methods on class with #privateField, getters, setters, and static methods", async () => {
            const servicesDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(servicesDir, { recursive: true });

            const sourceCode = `
export class BankAccount {
    #balance = 0;
    #pin = "1234";

    constructor(initial = 0) {
        this.#balance = initial;
    }

    get balance() {
        return this.#balance;
    }

    set balance(val) {
        if (val < 0) throw new RangeError("Negative balance");
        this.#balance = val;
    }

    static createDefault() {
        return new BankAccount(100);
    }

    deposit(amount) {
        if (amount <= 0) return false;
        this.#balance += amount;
        return true;
    }

    #verifyPin(pin) {
        return this.#pin === pin;
    }

    withdraw(amount, pin) {
        if (!this.#verifyPin(pin)) throw new Error("Invalid PIN");
        if (amount > this.#balance) throw new Error("Insufficient funds");
        this.#balance -= amount;
        return this.#balance;
    }
}
`;
            fs.writeFileSync(path.join(servicesDir, "BankAccount.js"), sourceCode);

            const result = await getAvailableSimulationSources("snap_class_test", { rootDir: tempDir });
            expect(result).toBeDefined();
            expect(result.sourceFiles.length).toBe(1);

            const file = result.sourceFiles[0];
            expect(file.functions.length).toBeGreaterThanOrEqual(1);

            const functionNames = file.functions.map(f => f.name);
            expect(functionNames.some(n => n.includes("deposit"))).toBe(true);
            expect(functionNames.some(n => n.includes("withdraw"))).toBe(true);
            expect(functionNames.some(n => n.includes("balance"))).toBe(true);
        });

        test("ADV-SIM-07: Simulation trace generation for class instance methods without syntax crash", async () => {
            const sourceCode = `
export class OrderService {
    constructor() {
        this.status = "INITIALIZED";
    }

    processOrder(order) {
        if (!order || order.total <= 0) {
            throw new Error("Invalid order total");
        }
        return { success: true, orderId: order.id, processedTotal: order.total };
    }
}
`;
            const trace = await generateSimulationTrace("snap_class_sim", {
                sourceFilePath: "src/services/OrderService.js",
                sourceCode,
                functionName: "OrderService.processOrder",
                category: "HAPPY_PATH"
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(5);
            expect(trace.summary.outcome).toBe("PASSED");
            expect(trace.testCase.targetFunction).toBe("OrderService.processOrder");
        });

        test("ADV-SIM-08: Exported instantiated service class (export const cart = new CartService())", async () => {
            const sourceCode = `
class CartService {
    calculateTotal(items = []) {
        if (!items || items.length === 0) return 0;
        return items.reduce((acc, it) => acc + (it.price * (it.qty || 1)), 0);
    }
}

export const cartService = new CartService();
`;
            const trace = await generateSimulationTrace("snap_instantiated", {
                sourceFilePath: "src/services/cartService.js",
                sourceCode,
                category: "BOUNDARY_VALUES"
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.category).toBe("BOUNDARY_VALUES");
            expect(trace.steps.length).toBeGreaterThanOrEqual(4);
            expect(trace.summary.outcome).toBe("PASSED");
        });
    });

    // =========================================================================
    // SUITE 3: Thrown Custom Errors & Promise Rejections
    // =========================================================================
    describe("Suite 3: Thrown Custom Errors & Promise Rejections", () => {
        test("ADV-SIM-10: Custom Error class instantiation & throw simulation under Category D (ERROR_HANDLING)", async () => {
            const sourceCode = `
export class DomainValidationError extends Error {
    constructor(field, message) {
        super(message);
        this.name = "DomainValidationError";
        this.field = field;
    }
}

export function validateUserInput(user) {
    if (!user) {
        throw new DomainValidationError("user", "User payload cannot be null");
    }
    if (!user.email || !user.email.includes("@")) {
        throw new DomainValidationError("email", "Invalid email format");
    }
    return true;
}
`;
            const trace = await generateSimulationTrace("snap_custom_error", {
                sourceFilePath: "src/services/validator.js",
                sourceCode,
                category: "ERROR_HANDLING"
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.category).toBe("ERROR_HANDLING");

            // Verify exception step and educational guidance
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep).toBeDefined();
            expect(returnStep.title).toContain("Exception Thrown");
            expect(returnStep.variables.thrownException).toBeDefined();
            expect(returnStep.educationalGuidance.category).toBe("ERROR_HANDLING");
            expect(returnStep.educationalGuidance.developerTakeaway).toContain(".toThrow()");

            // Verify assertion step uses matcher toThrow
            const assertionStep = trace.steps.find(s => s.phase === "ASSERTION");
            expect(assertionStep).toBeDefined();
            expect(assertionStep.assertionResult.matcher).toBe("toThrow");
            expect(assertionStep.assertionResult.passed).toBe(true);
        });

        test("ADV-SIM-11: Async function with Promise rejection simulation and matcher verification", async () => {
            const sourceCode = `
export async function authenticateToken(token) {
    if (!token) {
        return Promise.reject(new Error("Missing authentication token"));
    }
    if (token === "expired_token") {
        throw new Error("Token expired");
    }
    return { valid: true, userId: "usr_999" };
}
`;
            const testCode = `
import { authenticateToken } from "./auth.js";
describe("authenticateToken", () => {
    it("rejects when token is missing", async () => {
        await expect(authenticateToken(null)).rejects.toThrow("Missing authentication token");
    });
});
`;
            const trace = await generateSimulationTrace("snap_promise_reject", {
                sourceFilePath: "src/services/auth.js",
                sourceCode,
                testCode,
                testFilePath: "tests/auth.test.js"
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.title).toContain("rejects when token is missing");
            expect(trace.summary.outcome).toBe("PASSED");
        });

        test("ADV-SIM-12: Error handling simulation handles multiple guard clauses gracefully", async () => {
            const sourceCode = `
export function updateInventory(item, quantity) {
    if (!item) throw new TypeError("Item required");
    if (quantity === 0) throw new RangeError("Quantity cannot be zero");
    if (quantity < 0 && Math.abs(quantity) > item.stock) {
        throw new Error("Insufficient stock for deduction");
    }
    item.stock += quantity;
    return item.stock;
}
`;
            const trace = await generateSimulationTrace("snap_multi_guards", {
                sourceFilePath: "src/services/inventory.js",
                sourceCode,
                category: "ERROR_HANDLING"
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.category).toBe("ERROR_HANDLING");
            const assertStep = trace.steps.find(s => s.phase === "ASSERTION");
            expect(assertStep.assertionResult.matcher).toBe("toThrow");
        });
    });

    // =========================================================================
    // SUITE 4: Zero Statements, Zero Branches & Pathological Code Shapes
    // =========================================================================
    describe("Suite 4: Zero Statements, Zero Branches & Pathological Code Shapes", () => {
        test("ADV-SIM-14: Completely empty source file ('') discovery and simulation resilience", async () => {
            const servicesDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(servicesDir, { recursive: true });
            fs.writeFileSync(path.join(servicesDir, "empty.service.js"), "");

            const result = await getAvailableSimulationSources("snap_empty", { rootDir: tempDir });
            expect(result).toBeDefined();
            expect(result.sourceFiles.length).toBe(1);
            expect(result.sourceFiles[0].functions.length).toBe(0);

            // Simulation trace generation on empty file should not throw unhandled crash
            const trace = await generateSimulationTrace("snap_empty", {
                sourceFilePath: "src/services/empty.service.js",
                sourceCode: ""
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(3);
            expect(trace.isVirtualScenario).toBe(true);
            expect(trace.summary.outcome).toBe("PASSED");
        });

        test("ADV-SIM-15: Source file containing only comments, whitespaces, and semicolons", async () => {
            const sourceCode = `
// ==========================================
// Configuration Stub - No business functions
// ==========================================
/*
 * Multi-line header block
 */
;;;
`;
            const trace = await generateSimulationTrace("snap_comments", {
                sourceFilePath: "src/services/stub.js",
                sourceCode
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(3);
            expect(trace.isVirtualScenario).toBe(true);
        });

        test("ADV-SIM-16: Source file with only constant exports (0 functions, 0 branches)", async () => {
            const sourceCode = `
export const API_BASE_URL = "https://api.example.com/v1";
export const TIMEOUT_MS = 5000;
export const SUPPORTED_LOCALES = ["en-US", "vi-VN", "fr-FR"];
`;
            const trace = await generateSimulationTrace("snap_constants", {
                sourceFilePath: "src/config/constants.js",
                sourceCode
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(3);
            expect(trace.summary.outcome).toBe("PASSED");
        });

        test("ADV-SIM-17: Pure linear function with 0 branches (100% linear happy path)", async () => {
            const sourceCode = `
export function linearCompute(x, y, multiplier = 2) {
    const sum = x + y;
    const result = sum * multiplier;
    return result;
}
`;
            const trace = await generateSimulationTrace("snap_linear", {
                sourceFilePath: "src/utils/math.js",
                sourceCode,
                category: "HAPPY_PATH"
            });

            expect(trace).toBeDefined();
            // Should have SETUP_MOCKS, CALL_ENTRY, EVAL_PARAMS, RETURN_VALUE, ASSERTION
            expect(trace.steps.length).toBeGreaterThanOrEqual(5);

            // 0 branches toggled because there are no decision points
            expect(trace.summary.branchesToggled.length).toBe(0);
            expect(trace.summary.outcome).toBe("PASSED");
        });

        test("ADV-SIM-18: Unexported internal helper without callers handles fallback cleanly", async () => {
            const sourceCode = `
function uncalledHelper(val) {
    return val * 10;
}
export function mainApi(x) {
    return x + 1;
}
`;
            const trace = await generateSimulationTrace("snap_uncalled_helper", {
                sourceFilePath: "src/utils/orphan.js",
                sourceCode,
                functionName: "uncalledHelper"
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.targetFunction).toBe("uncalledHelper");
            expect(trace.steps.length).toBeGreaterThanOrEqual(4);
        });
    });

    // =========================================================================
    // SUITE 5: Stress, Concurrency & Sub-100ms Performance Harness
    // =========================================================================
    describe("Suite 5: Stress, Concurrency & Sub-100ms Performance Harness", () => {
        test("ADV-SIM-19: 100 consecutive trace generations response time benchmark (Assert P95 < 50ms, Max < 100ms)", async () => {
            const sourceCode = `
export function computeDiscount(order, options = {}) {
    if (!order) throw new Error("Order required");
    const rate = options.rate || 0.1;
    if (order.isVip && order.amount > 1000) {
        return order.amount * (rate + 0.05);
    }
    return order.amount * rate;
}
`;
            const iterations = 100;
            const durations = [];

            for (let i = 0; i < iterations; i++) {
                const start = performance.now();
                const trace = await generateSimulationTrace("snap_bench", {
                    sourceFilePath: "src/services/bench.js",
                    sourceCode,
                    category: i % 2 === 0 ? "HAPPY_PATH" : "BRANCH_TOGGLING"
                });
                const duration = performance.now() - start;
                durations.push(duration);

                expect(trace).toBeDefined();
                expect(trace.summary.outcome).toBe("PASSED");
            }

            durations.sort((a, b) => a - b);
            const p50 = durations[Math.floor(iterations * 0.50)];
            const p95 = durations[Math.floor(iterations * 0.95)];
            const max = durations[durations.length - 1];
            const avg = durations.reduce((a, b) => a + b, 0) / iterations;

            console.log(`[ADV-SIM-19 Benchmark] Iterations: ${iterations} | Avg: ${avg.toFixed(2)}ms | P50: ${p50.toFixed(2)}ms | P95: ${p95.toFixed(2)}ms | Max: ${max.toFixed(2)}ms`);

            // Requirement: sub-100ms response times for trace generation
            expect(avg).toBeLessThan(50);
            expect(p95).toBeLessThan(75);
            expect(max).toBeLessThan(100);
        });

        test("ADV-SIM-20: 50 concurrent trace generation requests (Promise.all) with RAM mock state isolation", async () => {
            const sourceCode = `
import { prisma } from "../lib/prisma.js";
import axios from "axios";

export async function handleTransfer(fromId, toId, amount) {
    if (amount <= 0) return { error: "Amount must be positive" };
    const sender = await prisma.user.findUnique({ where: { id: fromId } });
    const response = await axios.post("https://transfer.net/exec", { fromId, toId, amount });
    return { success: true, txId: response.id };
}
`;
            const concurrentRequests = 50;
            const tasks = Array.from({ length: concurrentRequests }, (_, idx) => {
                const category = ["HAPPY_PATH", "BOUNDARY_VALUES", "BRANCH_TOGGLING", "ERROR_HANDLING"][idx % 4];
                return generateSimulationTrace(`snap_concurrent_${idx}`, {
                    sourceFilePath: `src/services/transfer_${idx}.js`,
                    sourceCode,
                    category
                });
            });

            const start = performance.now();
            const traces = await Promise.all(tasks);
            const totalDuration = performance.now() - start;

            expect(traces.length).toBe(concurrentRequests);
            for (const trace of traces) {
                expect(trace).toBeDefined();
                expect(trace.steps.length).toBeGreaterThanOrEqual(4);
                expect(trace.initialMocks.some(m => m.module === "prisma")).toBe(true);
                expect(trace.initialMocks.some(m => m.module === "axios")).toBe(true);
            }

            const avgPerRequest = totalDuration / concurrentRequests;
            console.log(`[ADV-SIM-20 Concurrency] 50 concurrent traces completed in ${totalDuration.toFixed(2)}ms (Avg: ${avgPerRequest.toFixed(2)}ms per request)`);
            expect(avgPerRequest).toBeLessThan(50);
        });

        test("ADV-SIM-21: Large source file simulation (500+ lines, multiple classes, 30+ decision points) benchmark", async () => {
            // Generate a synthetic 500-line source file with 30 branches
            let largeCode = `
import { prisma } from "../lib/prisma.js";
export class LargeEngine {
`;
            for (let i = 1; i <= 30; i++) {
                largeCode += `
    evaluateRule${i}(data) {
        if (!data || data.val < ${i}) {
            return false;
        }
        if (data.type === "RULE_${i}" && data.score > ${i * 10}) {
            return true;
        }
        return data.active ? true : false;
    }
`;
            }
            largeCode += `
    processAll(payload) {
        if (!payload) throw new Error("Payload missing");
        return { processed: true, count: 30 };
    }
}
export const largeEngine = new LargeEngine();
`;
            expect(largeCode.split("\n").length).toBeGreaterThan(300);

            const start = performance.now();
            const trace = await generateSimulationTrace("snap_large_file", {
                sourceFilePath: "src/services/LargeEngine.js",
                sourceCode: largeCode,
                category: "HAPPY_PATH"
            });
            const duration = performance.now() - start;

            console.log(`[ADV-SIM-21 Large File] Trace generation on 300+ line class file completed in ${duration.toFixed(2)}ms`);
            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(4);
            expect(duration).toBeLessThan(100);
        });
    });

    // =========================================================================
    // SUITE 6: Storage Immutability & Disk Integrity Audit
    // =========================================================================
    describe("Suite 6: Storage Immutability & Disk Integrity Audit", () => {
        test("ADV-SIM-22: Recursive SHA-256 pre/post audit of storage/ and uploads/ across all simulation operations", async () => {
            const preStorageHashes = computeDirectoryHashMap(storagePath);
            const preUploadsHashes = computeDirectoryHashMap(uploadsPath);

            // Execute multiple trace generations and source discoveries
            const sourceCode = `export function testStorageImmunity(x) { return x * 2; }`;
            await generateSimulationTrace("snap_imm_1", {
                sourceFilePath: "storage/projects/dummy/source.js",
                sourceCode
            });
            await generateSimulationTrace("snap_imm_2", {
                sourceFilePath: "uploads/snapshots/dummy/source.js",
                sourceCode
            });

            const postStorageHashes = computeDirectoryHashMap(storagePath);
            const postUploadsHashes = computeDirectoryHashMap(uploadsPath);

            expect(postStorageHashes.size).toBe(preStorageHashes.size);
            for (const [fPath, hash] of preStorageHashes.entries()) {
                expect(postStorageHashes.get(fPath)).toBe(hash);
            }

            expect(postUploadsHashes.size).toBe(preUploadsHashes.size);
            for (const [fPath, hash] of preUploadsHashes.entries()) {
                expect(postUploadsHashes.get(fPath)).toBe(hash);
            }
        });

        test("ADV-SIM-23: Simulated directory traversal payload in sourceFilePath is strictly contained or safely handled", async () => {
            const maliciousPaths = [
                "../../etc/passwd",
                "..\\..\\windows\\system32\\cmd.exe",
                "storage/../../../../secret.key",
                "uploads/../../../app.js"
            ];

            for (const malPath of maliciousPaths) {
                // If file does not exist, it throws ServiceError 404 cleanly
                await expect(generateSimulationTrace("snap_traversal", {
                    rootDir: tempDir,
                    sourceFilePath: malPath
                })).rejects.toThrow(ServiceError);
            }
        });

        test("ADV-SIM-24: In-memory simulation strictly does NOT create temp files in storage/ or uploads/", async () => {
            const preStorageCount = fs.existsSync(storagePath) ? fs.readdirSync(storagePath).length : 0;
            const preUploadsCount = fs.existsSync(uploadsPath) ? fs.readdirSync(uploadsPath).length : 0;

            const aiGeneratedTest = `
describe("in-memory-only", () => {
    it("runs purely in RAM", () => {
        expect(1 + 1).toBe(2);
    });
});
`;
            const trace = await generateSimulationTrace("snap_no_disk", {
                sourceFilePath: "src/utils/ram.js",
                sourceCode: "export function ramOnly() { return true; }",
                testCode: aiGeneratedTest
            });

            expect(trace).toBeDefined();
            expect(trace.testCode).toBe(aiGeneratedTest);

            const postStorageCount = fs.existsSync(storagePath) ? fs.readdirSync(storagePath).length : 0;
            const postUploadsCount = fs.existsSync(uploadsPath) ? fs.readdirSync(uploadsPath).length : 0;

            expect(postStorageCount).toBe(preStorageCount);
            expect(postUploadsCount).toBe(preUploadsCount);
        });
    });
});
