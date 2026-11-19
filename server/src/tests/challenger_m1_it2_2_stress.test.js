/**
 * challenger_m1_it2_2_stress.test.js
 *
 * Empirical Adversarial Challenge Test Harness for unitTestSimulationEngine.service.js
 * Subagent: challenger_m1_it2_2 (Role: Simulation Remediation Challenger)
 *
 * Verification Scope:
 * 1. Array Callbacks: reduce, map, filter (concise vs block body, parameter destructuring)
 * 2. Short-Circuit Boolean Chains: &&, ||, ?? across truthy, falsy, nullish, and boundary values
 * 3. Optional Chaining: Deeply nested undefined objects vs optional call expressions
 * 4. Property Assertion Verification: expect(res.prop).toBe(...) vs root return value matching
 * 5. JSON Serialization Roundtrip & Sub-100ms Performance Benchmark
 */

import { describe, test, expect, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";

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

describe("CHALLENGER M1-IT2-2: Adversarial Stress Test Suite", () => {
    let tempDir;

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-sim-chal2-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    // =========================================================================
    // SECTION 1: Array Callback Stress Testing (reduce, map, filter)
    // =========================================================================
    describe("Section 1: Array Callbacks (reduce, map, filter)", () => {
        test("1.1: Concise arrow callbacks evaluate arithmetic and filtering correctly", () => {
            const scope = { items: [10, 20, 30] };

            // reduce
            const exprReduce = parseJavaScriptCode("items.reduce((acc, curr) => acc + curr, 0);").ast.program.body[0].expression;
            expect(evaluateAstExpression(exprReduce, scope)).toBe(60);

            // map
            const exprMap = parseJavaScriptCode("items.map(x => x * 3);").ast.program.body[0].expression;
            expect(evaluateAstExpression(exprMap, scope)).toEqual([30, 60, 90]);

            // filter
            const exprFilter = parseJavaScriptCode("items.filter(x => x > 15);").ast.program.body[0].expression;
            expect(evaluateAstExpression(exprFilter, scope)).toEqual([20, 30]);

            // Chained filter + map + reduce
            const exprChain = parseJavaScriptCode("items.filter(x => x >= 20).map(x => x * 2).reduce((a, b) => a + b, 0);").ast.program.body[0].expression;
            expect(evaluateAstExpression(exprChain, scope)).toBe(100);
        });

        test("1.2 [REMEDIATED]: BlockStatement callbacks execute prior variable declarations", () => {
            const scope = { items: [10, 20, 30] };
            const code = `
                items.reduce((acc, curr) => {
                    const next = acc + curr;
                    return next;
                }, 0);
            `;
            const expr = parseJavaScriptCode(code).ast.program.body[0].expression;
            const result = evaluateAstExpression(expr, scope);

            // In standard JS: 60. Remediated: correctly evaluates to 60.
            expect(result).toBe(60);
        });

        test("1.3 [REMEDIATED]: Parameter destructuring in callbacks handles ObjectPattern", () => {
            const scope = { items: [{ amount: 10 }, { amount: 20 }] };
            const code = `items.map(({ amount }) => amount * 2);`;
            const expr = parseJavaScriptCode(code).ast.program.body[0].expression;
            const result = evaluateAstExpression(expr, scope);

            // In standard JS: [20, 40]. Remediated: correctly unpacks ObjectPattern to [20, 40].
            expect(result).toEqual([20, 40]);
        });
    });

    // =========================================================================
    // SECTION 2: Short-Circuit Boolean Evaluation (&&, ||, ??)
    // =========================================================================
    describe("Section 2: Short-Circuit Boolean Evaluation", () => {
        test("2.1: Binary and logical short-circuiting preserves JS semantics", () => {
            const options = {};

            // Logical AND short-circuit
            const exprAnd = parseJavaScriptCode("false && riskyCall();").ast.program.body[0].expression;
            const resAnd = evaluateAstExpression(exprAnd, { riskyCall: () => { throw new Error("Should not be called"); } }, options);
            expect(resAnd).toBe(false);
            expect(options.shortCircuited).toBe(true);

            // Logical OR short-circuit
            const exprOr = parseJavaScriptCode("true || riskyCall();").ast.program.body[0].expression;
            const resOr = evaluateAstExpression(exprOr, { riskyCall: () => { throw new Error("Should not be called"); } }, options);
            expect(resOr).toBe(true);

            // Nullish Coalescing (??) preserves 0 and empty string
            const exprNullishZero = parseJavaScriptCode("val ?? 100;").ast.program.body[0].expression;
            expect(evaluateAstExpression(exprNullishZero, { val: 0 })).toBe(0);
            expect(evaluateAstExpression(exprNullishZero, { val: "" })).toBe("");
            expect(evaluateAstExpression(exprNullishZero, { val: false })).toBe(false);
            expect(evaluateAstExpression(exprNullishZero, { val: null })).toBe(100);
            expect(evaluateAstExpression(exprNullishZero, { val: undefined })).toBe(100);

            // Compound chain: (a && b) || (c ?? d)
            const exprCompound = parseJavaScriptCode("(a && b) || (c ?? d);").ast.program.body[0].expression;
            expect(evaluateAstExpression(exprCompound, { a: false, b: 10, c: null, d: 42 })).toBe(42);
            expect(evaluateAstExpression(exprCompound, { a: true, b: 99, c: null, d: 42 })).toBe(99);
        });
    });

    // =========================================================================
    // SECTION 3: Optional Chaining (?. and ?.[])
    // =========================================================================
    describe("Section 3: Optional Chaining", () => {
        test("3.1: OptionalMemberExpression survives deeply nested null and undefined", () => {
            const code = "user?.profile?.address?.zipCode;";
            const expr = parseJavaScriptCode(code).ast.program.body[0].expression;

            expect(evaluateAstExpression(expr, { user: undefined })).toBeUndefined();
            expect(evaluateAstExpression(expr, { user: null })).toBeUndefined();
            expect(evaluateAstExpression(expr, { user: {} })).toBeUndefined();
            expect(evaluateAstExpression(expr, { user: { profile: null } })).toBeUndefined();
            expect(evaluateAstExpression(expr, { user: { profile: { address: null } } })).toBeUndefined();
            expect(evaluateAstExpression(expr, {
                user: { profile: { address: { zipCode: "94105" } } }
            })).toBe("94105");
        });

        test("3.2 [REMEDIATED]: OptionalCallExpression (?.()) executes valid callable functions", () => {
            const code = "obj?.method('world');";
            const expr = parseJavaScriptCode(code).ast.program.body[0].expression;

            const scope = {
                obj: {
                    method: (name) => `hello ${name}`
                }
            };

            const result = evaluateAstExpression(expr, scope);

            // In standard JS: "hello world". Remediated: correctly returns "hello world".
            expect(result).toBe("hello world");
        });

        test("3.3 [REMEDIATED]: Trace simulation succeeds when function uses optional method call", async () => {
            const sourceCode = `
                export function formatGreeting(user) {
                    const trimmed = user?.name?.trim?.() ?? "Anonymous";
                    return "Hello, " + trimmed;
                }
            `;
            const testCode = `
                import { formatGreeting } from "./user.js";
                describe("formatGreeting", () => {
                    it("should trim name when provided", () => {
                        const res = formatGreeting({ name: "  Bob  " });
                        expect(res).toBe("Hello, Bob");
                    });
                });
            `;

            const trace = await generateSimulationTrace("snap_opt_call", {
                sourceFilePath: "src/user.js",
                sourceCode,
                testCode,
                testFilePath: "tests/user.test.js"
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            const assertionStep = trace.steps.find(s => s.phase === "ASSERTION");

            // Remediated: trim?.() properly executes and returns "Hello, Bob"
            expect(returnStep.variables.returnValue).toBe("Hello, Bob");
            expect(assertionStep.assertionResult.actual).toBe("Hello, Bob");
            expect(assertionStep.assertionResult.expected).toBe("Hello, Bob");
            expect(assertionStep.assertionResult.passed).toBe(true);
            expect(trace.summary.allAssertionsPassed).toBe(true);
        });
    });

    // =========================================================================
    // SECTION 4: Property Assertion Verification
    // =========================================================================
    describe("Section 4: Property Assertion Verification", () => {
        test("4.1 [REMEDIATED]: Assertion on return value property (expect(res.prop).toBe(...)) passes", async () => {
            const sourceCode = `
                export function generateInvoice(amount, taxRate = 0.1) {
                    const tax = amount * taxRate;
                    const total = amount + tax;
                    return { amount, tax, total, status: "CALCULATED" };
                }
            `;
            const testCode = `
                import { generateInvoice } from "./invoice.js";
                describe("generateInvoice", () => {
                    it("should calculate total correctly", () => {
                        const res = generateInvoice(100, 0.15);
                        expect(res.total).toBe(115);
                    });
                });
            `;

            const trace = await generateSimulationTrace("snap_prop_assert", {
                sourceFilePath: "src/invoice.js",
                sourceCode,
                testCode,
                testFilePath: "tests/invoice.test.js"
            });

            const assertionStep = trace.steps.find(s => s.phase === "ASSERTION");

            // Remediated: The test asserts on res.total (115), and actual is resolved to 115!
            expect(assertionStep.assertionResult.expected).toBe(115);
            expect(assertionStep.assertionResult.actual).toBe(115);
            expect(assertionStep.assertionResult.passed).toBe(true);
            expect(trace.summary.allAssertionsPassed).toBe(true);
        });
    });

    // =========================================================================
    // SECTION 5: JSON Serialization Roundtrip & Performance Benchmark
    // =========================================================================
    describe("Section 5: JSON Serialization & Performance Benchmark", () => {
        test("5.1: Simulation trace serializes and deserializes cleanly without circular structures", async () => {
            const sourceCode = `
                export function calculateDiscount(order) {
                    if (!order || order.total <= 0) return 0;
                    if (order.isVip) return order.total * 0.2;
                    return order.total * 0.05;
                }
            `;
            const testCode = `
                import { calculateDiscount } from "./order.js";
                describe("calculateDiscount", () => {
                    it("should calculate standard discount", () => {
                        const discount = calculateDiscount({ total: 200, isVip: false });
                        expect(discount).toBe(10);
                    });
                });
            `;

            const trace = await generateSimulationTrace("snap_json_test", {
                sourceFilePath: "src/order.js",
                sourceCode,
                testCode,
                testFilePath: "tests/order.test.js"
            });

            // 1. Serialization
            let serialized;
            expect(() => {
                serialized = JSON.stringify(trace);
            }).not.toThrow();

            // 2. Deserialization
            let deserialized;
            expect(() => {
                deserialized = JSON.parse(serialized);
            }).not.toThrow();

            // 3. Roundtrip identity
            expect(deserialized.id).toBe(trace.id);
            expect(deserialized.steps.length).toBe(trace.steps.length);
            expect(deserialized.summary.allAssertionsPassed).toBe(true);
            expect(deserialized.summary.totalSteps).toBe(trace.steps.length);
            expect(deserialized.initialMocks).toEqual(trace.initialMocks);
        });

        test("5.2: Performance satisfies sub-100ms budget for interactive playback", async () => {
            const sourceCode = `
                export function evaluateRisk(score, history = []) {
                    if (score < 50) return "HIGH_RISK";
                    const cleanCount = history.filter(h => h.status === "CLEAN").length;
                    if (cleanCount > 5) return "LOW_RISK";
                    return "MODERATE_RISK";
                }
            `;
            const testCode = `
                import { evaluateRisk } from "./risk.js";
                describe("evaluateRisk", () => {
                    it("should evaluate risk for clean history", () => {
                        const res = evaluateRisk(75, [{ status: "CLEAN" }, { status: "CLEAN" }, { status: "CLEAN" }, { status: "CLEAN" }, { status: "CLEAN" }, { status: "CLEAN" }]);
                        expect(res).toBe("LOW_RISK");
                    });
                });
            `;

            // Warmup
            await generateSimulationTrace("snap_bench", {
                sourceFilePath: "src/risk.js",
                sourceCode,
                testCode,
                testFilePath: "tests/risk.test.js"
            });

            // Benchmark 50 consecutive runs
            const iterations = 50;
            const durations = [];
            for (let i = 0; i < iterations; i++) {
                const t0 = performance.now();
                await generateSimulationTrace("snap_bench", {
                    sourceFilePath: "src/risk.js",
                    sourceCode,
                    testCode,
                    testFilePath: "tests/risk.test.js"
                });
                durations.push(performance.now() - t0);
            }

            const avgMs = durations.reduce((a, b) => a + b, 0) / iterations;
            const maxMs = Math.max(...durations);

            console.log(`Playback Latency (50 runs): Avg=${avgMs.toFixed(2)}ms, Max=${maxMs.toFixed(2)}ms (Budget: <100ms)`);

            expect(avgMs).toBeLessThan(100);
            expect(maxMs).toBeLessThan(100);
        });
    });
});
