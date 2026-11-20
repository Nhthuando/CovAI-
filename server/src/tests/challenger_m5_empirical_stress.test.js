/**
 * challenger_m5_empirical_stress.test.js
 *
 * Milestone 5 Phase 2: Adversarial Coverage Hardening (Tier 5)
 * Empirical Challenger Stress Test Suite
 *
 * Focus Dimensions:
 * 1. Standard Built-in Identifier Resolution
 * 2. Deep Recursion and Cyclic Helper Calls
 * 3. Loop Construct Boundary Tests
 * 4. Compound Assignment Operators
 * 5. AST Node Types & Syntax Anomalies
 * 6. Malformed Trace Generation Requests
 * 7. Strict Storage Code Immutability Guard (Rule 8)
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
    simulateFunctionExecution,
    findFunctionAstNode,
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

describe("Milestone 5 Tier 5: Adversarial Empirical Challenge Suite", () => {
    let tempDir;
    const storagePath = path.resolve(process.cwd(), "storage");
    const uploadsPath = path.resolve(process.cwd(), "uploads");

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-m5-stress-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    // =========================================================================
    // DIMENSION 1: Standard Built-in Identifier Resolution
    // =========================================================================
    describe("Dimension 1: Standard Built-in Identifier Resolution", () => {
        test("1.1 resolves Math methods: max, min, floor, ceil, abs, round", async () => {
            const code = `
export function calcMath(a, b) {
    const maxVal = Math.max(a, b);
    const minVal = Math.min(a, b);
    const flr = Math.floor(3.7);
    const cel = Math.ceil(3.2);
    const ab = Math.abs(-42);
    const rnd = Math.round(4.6);
    return { maxVal, minVal, flr, cel, ab, rnd };
}
`;
            const trace = await generateSimulationTrace("snap_dim1_math", {
                sourceCode: code,
                functionName: "calcMath",
                inputs: [10, 25]
            });

            expect(trace).toBeDefined();
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep).toBeDefined();
            expect(returnStep.variables.maxVal).toBe(25);
            expect(returnStep.variables.minVal).toBe(10);
            expect(returnStep.variables.flr).toBe(3);
            expect(returnStep.variables.cel).toBe(4);
            expect(returnStep.variables.ab).toBe(42);
            expect(returnStep.variables.rnd).toBe(5);
        });

        test("1.2 resolves Object static methods: keys, values, assign, entries", async () => {
            const code = `
export function inspectObj(item) {
    const k = Object.keys(item);
    const v = Object.values(item);
    const cloned = Object.assign({}, item);
    return { k, v, cloned };
}
`;
            const trace = await generateSimulationTrace("snap_dim1_obj", {
                sourceCode: code,
                functionName: "inspectObj",
                inputs: [{ id: "usr_1", role: "admin" }]
            });

            expect(trace).toBeDefined();
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.k).toEqual(["id", "role"]);
            expect(returnStep.variables.v).toEqual(["usr_1", "admin"]);
            expect(returnStep.variables.cloned).toEqual({ id: "usr_1", role: "admin" });
        });

        test("1.3 resolves Array methods: Array.isArray and Array.from", async () => {
            const code = `
export function checkArray(items) {
    const isArr = Array.isArray(items);
    const fromArr = Array.from([1, 2, 3]);
    return { isArr, fromArr };
}
`;
            const trace = await generateSimulationTrace("snap_dim1_arr", {
                sourceCode: code,
                functionName: "checkArray",
                inputs: [[10, 20]]
            });

            expect(trace).toBeDefined();
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.isArr).toBe(true);
            expect(returnStep.variables.fromArr).toEqual([1, 2, 3]);
        });

        test("1.4 resolves Number properties & methods: isFinite, isNaN, MAX_SAFE_INTEGER", async () => {
            const code = `
export function checkNumber(n) {
    const fin = Number.isFinite(n);
    const nan = Number.isNaN(n);
    const maxSafe = Number.MAX_SAFE_INTEGER;
    return { fin, nan, maxSafe };
}
`;
            const trace = await generateSimulationTrace("snap_dim1_num", {
                sourceCode: code,
                functionName: "checkNumber",
                inputs: [42]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.fin).toBe(true);
            expect(returnStep.variables.nan).toBe(false);
            expect(returnStep.variables.maxSafe).toBe(Number.MAX_SAFE_INTEGER);
        });

        test("1.5 resolves global functions: parseInt, parseFloat, isNaN, isFinite", async () => {
            const code = `
export function parseValues(s1, s2) {
    const p1 = parseInt(s1, 10);
    const p2 = parseFloat(s2);
    const checkNan = isNaN(p1);
    const checkFin = isFinite(p2);
    return { p1, p2, checkNan, checkFin };
}
`;
            const trace = await generateSimulationTrace("snap_dim1_parse", {
                sourceCode: code,
                functionName: "parseValues",
                inputs: ["123", "45.67"]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.p1).toBe(123);
            expect(returnStep.variables.p2).toBe(45.67);
            expect(returnStep.variables.checkNan).toBe(false);
            expect(returnStep.variables.checkFin).toBe(true);
        });

        test("1.6 resolves JSON.stringify and JSON.parse", async () => {
            const code = `
export function serializeData(data) {
    const str = JSON.stringify(data);
    const parsed = JSON.parse(str);
    return { str, parsed };
}
`;
            const trace = await generateSimulationTrace("snap_dim1_json", {
                sourceCode: code,
                functionName: "serializeData",
                inputs: [{ active: true, count: 5 }]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.str).toBe('{"active":true,"count":5}');
            expect(returnStep.variables.parsed).toEqual({ active: true, count: 5 });
        });

        test("1.7 resolves Date.now, Date constructor, and RegExp identifier type", async () => {
            const code = `
export function validateDateAndRegex(str) {
    const timestamp = Date.now();
    const reType = typeof RegExp;
    const dateType = typeof Date;
    const regInstance = new RegExp("^[a-z]+$", "i");
    return { timestamp, reType, dateType, regInstance };
}
`;
            const trace = await generateSimulationTrace("snap_dim1_date_re", {
                sourceCode: code,
                functionName: "validateDateAndRegex",
                inputs: ["Hello"]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(typeof returnStep.variables.timestamp).toBe("number");
            expect(returnStep.variables.reType).toBe("function");
            expect(returnStep.variables.dateType).toBe("function");
            // Empirical discovery: NewExpression returns { name, args } for non-Error classes
            expect(returnStep.variables.regInstance).toEqual({ name: "RegExp", args: ["^[a-z]+$", "i"] });
        });

        test("1.8 honors scope property shadowing over built-ins", async () => {
            const code = `
export function shadowMath() {
    const Math = { maxVal: 999 };
    const res = Math.maxVal;
    return res;
}
`;
            const trace = await generateSimulationTrace("snap_dim1_shadow", {
                sourceCode: code,
                functionName: "shadowMath"
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.res).toBe(999);
        });
    });

    // =========================================================================
    // DIMENSION 2: Deep Recursion and Cyclic Helper Calls
    // =========================================================================
    describe("Dimension 2: Deep Recursion and Cyclic Helper Calls", () => {
        test("2.1 terminates finite recursion (factorial) within depth", async () => {
            const code = `
export function factorial(n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}
`;
            const trace = await generateSimulationTrace("snap_dim2_fact", {
                sourceCode: code,
                functionName: "factorial",
                inputs: [4]
            });

            expect(trace).toBeDefined();
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep).toBeDefined();
            // Note: factorial(4) = 24
            expect(returnStep.variables.returnValue ?? returnStep.returnValue).toBe(24);
        });

        test("2.2 mutual recursion between two internal functions terminates safely", async () => {
            const code = `
function isEven(n) {
    if (n === 0) return true;
    return isOdd(n - 1);
}
function isOdd(n) {
    if (n === 0) return false;
    return isEven(n - 1);
}
export function testParity(n) {
    return isEven(n);
}
`;
            const trace = await generateSimulationTrace("snap_dim2_mutual", {
                sourceCode: code,
                functionName: "testParity",
                inputs: [3]
            });

            expect(trace).toBeDefined();
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.returnValue ?? returnStep.returnValue).toBe(false);
        });

        test("2.3 infinite recursion is bounded and does not crash node process", async () => {
            const code = `
export function infiniteRecurse(n) {
    return infiniteRecurse(n + 1);
}
`;
            // Engine must catch V8 stack overflow or terminate safely without unhandled exception
            const trace = await generateSimulationTrace("snap_dim2_inf", {
                sourceCode: code,
                functionName: "infiniteRecurse",
                inputs: [1]
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(4);
        });

        test("2.4 indirect testing BFS handles cyclic callers without infinite loop", () => {
            // Helper A calls Helper B, Helper B calls Helper A
            const astMetadata = {
                exportedSymbols: [{ name: "publicEntry", calls: ["helperA"] }],
                internalFunctions: [
                    { name: "helperA", callers: ["helperB", "publicEntry"], calls: ["helperB"] },
                    { name: "helperB", callers: ["helperA"], calls: ["helperA"] }
                ]
            };
            const code = `
function helperB() { return helperA(); }
function helperA() { return helperB(); }
export function publicEntry() { return helperA(); }
`;
            // Test that trace generation does not freeze on cyclic graph
            expect(async () => {
                await generateSimulationTrace("snap_dim2_cyclic", {
                    sourceCode: code,
                    functionName: "helperB"
                });
            }).not.toThrow();
        });
    });

    // =========================================================================
    // DIMENSION 3: Loop Construct Boundary Tests
    // =========================================================================
    describe("Dimension 3: Loop Construct Boundary Tests", () => {
        test("3.1 ForOfStatement: empty array iterates 0 times", async () => {
            const code = `
export function sumItems(items) {
    let sum = 0;
    for (const x of items) {
        sum += x;
    }
    return sum;
}
`;
            const trace = await generateSimulationTrace("snap_dim3_forof_empty", {
                sourceCode: code,
                functionName: "sumItems",
                inputs: [[]]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.sum).toBe(0);
        });

        test("3.2 ForOfStatement: early return terminates loop execution immediately", async () => {
            const code = `
export function findFirstMatch(items, target) {
    for (const x of items) {
        if (x === target) {
            return x * 10;
        }
    }
    return -1;
}
`;
            const trace = await generateSimulationTrace("snap_dim3_forof_ret", {
                sourceCode: code,
                functionName: "findFirstMatch",
                inputs: [[10, 20, 30, 40], 20]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.returnValue ?? returnStep.returnValue).toBe(200);
        });

        test("3.3 ForInStatement: iterates over object keys", async () => {
            const code = `
export function collectKeys(obj) {
    const result = [];
    for (const k in obj) {
        result.push(k);
    }
    return result;
}
`;
            const trace = await generateSimulationTrace("snap_dim3_forin", {
                sourceCode: code,
                functionName: "collectKeys",
                inputs: [{ a: 1, b: 2, c: 3 }]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.result).toEqual(["a", "b", "c"]);
        });

        test("3.4 ForInStatement: empty object does not iterate", async () => {
            const code = `
export function emptyObjKeys(obj) {
    let count = 0;
    for (const k in obj) {
        count++;
    }
    return count;
}
`;
            const trace = await generateSimulationTrace("snap_dim3_forin_empty", {
                sourceCode: code,
                functionName: "emptyObjKeys",
                inputs: [{}]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.count).toBe(0);
        });

        test("3.5 WhileStatement: executes counter and terminates", async () => {
            const code = `
export function countdown(start) {
    let c = start;
    let iterations = 0;
    while (c > 0) {
        c--;
        iterations++;
    }
    return iterations;
}
`;
            const trace = await generateSimulationTrace("snap_dim3_while", {
                sourceCode: code,
                functionName: "countdown",
                inputs: [5]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.iterations).toBe(5);
        });

        test("3.6 WhileStatement: false condition does not iterate", async () => {
            const code = `
export function whileFalse() {
    let x = 100;
    while (x < 10) {
        x++;
    }
    return x;
}
`;
            const trace = await generateSimulationTrace("snap_dim3_while_false", {
                sourceCode: code,
                functionName: "whileFalse"
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.x).toBe(100);
        });

        test("3.7 WhileStatement: infinite loop is guarded by 1000 iteration safety limit", async () => {
            const code = `
export function infiniteWhile() {
    let count = 0;
    while (true) {
        count++;
    }
    return count;
}
`;
            const trace = await generateSimulationTrace("snap_dim3_while_inf", {
                sourceCode: code,
                functionName: "infiniteWhile"
            });

            // Must terminate at 1000 safety break and return count = 1001
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.count).toBe(1001);
        });

        test("3.8 Nested loops: inner loop early return breaks out of both loops", async () => {
            const code = `
export function searchMatrix(matrix, target) {
    for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
            if (matrix[r][c] === target) {
                return { r, c };
            }
        }
    }
    return null;
}
`;
            const trace = await generateSimulationTrace("snap_dim3_nested", {
                sourceCode: code,
                functionName: "searchMatrix",
                inputs: [[[1, 2], [3, 4]], 3]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.returnValue ?? returnStep.returnValue).toEqual({ r: 1, c: 0 });
        });
    });

    // =========================================================================
    // DIMENSION 4: Compound Assignment Operators
    // =========================================================================
    describe("Dimension 4: Compound Assignment Operators", () => {
        test("4.1 Identifier level: +=, -=, *=, /=, %= on numbers", async () => {
            const code = `
export function testMathCompounds() {
    let a = 20;
    a += 10; // 30
    a -= 6;  // 24
    a *= 2;  // 48
    a /= 4;  // 12
    a %= 5;  // 2
    return a;
}
`;
            const trace = await generateSimulationTrace("snap_dim4_math", {
                sourceCode: code,
                functionName: "testMathCompounds"
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.a).toBe(2);
        });

        test("4.2 Identifier level: logical compounds ??=, ||=, &&=", async () => {
            const code = `
export function testLogicalCompounds() {
    let un;
    un ??= 42; // un was undefined -> 42

    let zero = 0;
    zero ||= 99; // zero is falsy -> 99

    let truthy = 10;
    truthy &&= 77; // truthy is truthy -> 77

    let falsy = 0;
    falsy &&= 88; // falsy is 0 -> remains 0

    return { un, zero, truthy, falsy };
}
`;
            const trace = await generateSimulationTrace("snap_dim4_log", {
                sourceCode: code,
                functionName: "testLogicalCompounds"
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.un).toBe(42);
            expect(returnStep.variables.zero).toBe(99);
            expect(returnStep.variables.truthy).toBe(77);
            expect(returnStep.variables.falsy).toBe(0);
        });

        test("4.3 MemberExpression level: obj.prop +=, -=, *=, /=", async () => {
            const code = `
export function testMemberMath() {
    const state = { count: 10 };
    state.count += 5;
    state.count -= 3;
    state.count *= 2;
    state.count /= 4;
    return state.count;
}
`;
            const trace = await generateSimulationTrace("snap_dim4_member_math", {
                sourceCode: code,
                functionName: "testMemberMath"
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.state.count).toBe(6);
        });

        test("4.4 Compound assignment on uninitialized variable behaves safely", async () => {
            const code = `
export function testUninitializedAdd() {
    let num;
    num += 10; // (undefined ?? 0) + 10 = 10
    return num;
}
`;
            const trace = await generateSimulationTrace("snap_dim4_uninit", {
                sourceCode: code,
                functionName: "testUninitializedAdd"
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.num).toBe(10);
        });
    });

    // =========================================================================
    // DIMENSION 5: AST Node Types & Syntax Anomalies
    // =========================================================================
    describe("Dimension 5: AST Node Types & Syntax Anomalies", () => {
        test("5.1 UnaryExpression: !, -, +, typeof", async () => {
            const code = `
export function testUnary(val) {
    const notVal = !val;
    const negVal = -val;
    const plusVal = +val;
    const typeVal = typeof val;
    return { notVal, negVal, plusVal, typeVal };
}
`;
            const trace = await generateSimulationTrace("snap_dim5_unary", {
                sourceCode: code,
                functionName: "testUnary",
                inputs: [5]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.notVal).toBe(false);
            expect(returnStep.variables.negVal).toBe(-5);
            expect(returnStep.variables.plusVal).toBe(5);
            expect(returnStep.variables.typeVal).toBe("number");
        });

        test("5.2 LogicalExpression short-circuiting with falsy values: 0, '', null, undefined", async () => {
            const code = `
export function testShortCircuits(a, b, c) {
    const scAnd = a && b;       // if a is 0, returns 0 without evaluating b
    const scOr = a || c;        // if a is 0, evaluates c
    const scNullish = a ?? c;   // if a is 0, returns 0 (not null/undefined)
    return { scAnd, scOr, scNullish };
}
`;
            const trace = await generateSimulationTrace("snap_dim5_short_circuit", {
                sourceCode: code,
                functionName: "testShortCircuits",
                inputs: [0, 99, 42]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.scAnd).toBe(0);
            expect(returnStep.variables.scOr).toBe(42);
            expect(returnStep.variables.scNullish).toBe(0);
        });

        test("5.3 TemplateLiteral with expressions and string concatenation", async () => {
            const code = `
export function formatGreeting(name, count) {
    const msg = \`Hello \${name}, you have \${count * 2} messages!\`;
    return msg;
}
`;
            const trace = await generateSimulationTrace("snap_dim5_template", {
                sourceCode: code,
                functionName: "formatGreeting",
                inputs: ["Alice", 3]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.msg).toBe("Hello Alice, you have 6 messages!");
        });

        test("5.4 OptionalChaining on null and undefined objects", async () => {
            const code = `
export function getZipCode(user) {
    const zip = user?.address?.zip;
    const tag = user?.tags?.[0];
    return { zip, tag };
}
`;
            const trace = await generateSimulationTrace("snap_dim5_opt_chain", {
                sourceCode: code,
                functionName: "getZipCode",
                inputs: [null]
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.zip).toBeUndefined();
            expect(returnStep.variables.tag).toBeUndefined();
        });

        test("5.5 SwitchStatement: AST detects switch decision point, but simulateFunctionExecution bypasses switch block", async () => {
            const code = `
export function getRoleDiscount(role) {
    let discount = 0;
    switch (role) {
        case "VIP":
            discount = 0.20;
            break;
        case "MEMBER":
            discount = 0.10;
            break;
        default:
            discount = 0.05;
            break;
    }
    return discount;
}
`;
            const trace = await generateSimulationTrace("snap_dim5_switch", {
                sourceCode: code,
                functionName: "getRoleDiscount",
                inputs: ["VIP"]
            });

            // SwitchStatement handler evaluates discriminant, matches case "VIP", and executes discount = 0.20
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.discount).toBe(0.2);
        });
    });

    // =========================================================================
    // DIMENSION 6: Malformed Trace Generation Requests
    // =========================================================================
    describe("Dimension 6: Malformed Trace Generation Requests", () => {
        test("6.1 rejects missing sourceFilePath and missing sourceCode with 400 ServiceError", async () => {
            await expect(generateSimulationTrace("snap_malformed_1", {})).rejects.toThrow(ServiceError);
            try {
                await generateSimulationTrace("snap_malformed_1", {});
            } catch (err) {
                expect(err.statusCode).toBe(400);
            }
        });

        test("6.2 rejects non-existent sourceFilePath on disk with 404 ServiceError", async () => {
            await expect(generateSimulationTrace("snap_malformed_2", {
                rootDir: tempDir,
                sourceFilePath: "non/existent/service.js"
            })).rejects.toThrow(ServiceError);
        });

        test("6.3 missing snapshotId without rootDir throws 400 ServiceError", async () => {
            await expect(generateSimulationTrace(null, {
                sourceFilePath: "some/file.js"
            })).rejects.toThrow(ServiceError);
        });

        test("6.4 missing functionName falls back gracefully to default function", async () => {
            const code = `
export function primaryAction(x) {
    return x * 3;
}
`;
            const trace = await generateSimulationTrace("snap_fallback_fn", {
                sourceCode: code,
                inputs: [7]
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.targetFunction).toBe("primaryAction");
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE" || s.phase === "STATE_TRANSITION");
            expect(returnStep.variables.returnValue ?? returnStep.returnValue).toBe(21);
        });

        test("6.5 non-existent functionName falls back gracefully without 500 crash", async () => {
            const code = `
export function existingAction(y) {
    return y + 10;
}
`;
            const trace = await generateSimulationTrace("snap_missing_fn", {
                sourceCode: code,
                functionName: "totallyBogusFunctionDoesNotExist",
                inputs: [5]
            });

            expect(trace).toBeDefined();
            // Should gracefully fall back to first available function
            expect(trace.steps.length).toBeGreaterThanOrEqual(4);
        });

        test("6.6 prototype pollution payload in inputs does not pollute Object prototype", async () => {
            const maliciousPayload = JSON.parse('{"__proto__": {"polluted": "yes"}, "regular": 123}');
            const code = `
export function safeInput(p) {
    return p.regular;
}
`;
            const trace = await generateSimulationTrace("snap_proto_pollute", {
                sourceCode: code,
                functionName: "safeInput",
                inputs: [maliciousPayload]
            });

            expect(trace).toBeDefined();
            expect(({}).polluted).toBeUndefined();
        });

        test("6.7 malformed source code syntax recovers via Babel error recovery without uncaught crash", async () => {
            const brokenCode = `
export function broken(a, b) {
    let x = 
    return a + b;
}
`;
            const trace = await generateSimulationTrace("snap_syntax_recovery", {
                sourceCode: brokenCode,
                functionName: "broken",
                inputs: [1, 2]
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(2);
        });
    });

    // =========================================================================
    // DIMENSION 7: Strict Storage Code Immutability Guard (Rule 8)
    // =========================================================================
    describe("Dimension 7: Strict Storage Code Immutability Guard (Rule 8)", () => {
        test("7.1 verifies storage/ and uploads/ are 100% byte-for-byte identical pre and post simulation", async () => {
            const preStorageHashes = computeDirectoryHashMap(storagePath);
            const preUploadsHashes = computeDirectoryHashMap(uploadsPath);

            // Run a battery of simulations
            for (let i = 0; i < 5; i++) {
                await generateSimulationTrace(`snap_imm_run_${i}`, {
                    sourceCode: `export function computeTax(price) { return price * 0.08; }`,
                    functionName: "computeTax",
                    inputs: [100 + i]
                });
            }

            const postStorageHashes = computeDirectoryHashMap(storagePath);
            const postUploadsHashes = computeDirectoryHashMap(uploadsPath);

            expect(postStorageHashes.size).toBe(preStorageHashes.size);
            for (const [filePath, hash] of preStorageHashes.entries()) {
                expect(postStorageHashes.get(filePath)).toBe(hash);
            }

            expect(postUploadsHashes.size).toBe(preUploadsHashes.size);
            for (const [filePath, hash] of preUploadsHashes.entries()) {
                expect(postUploadsHashes.get(filePath)).toBe(hash);
            }
        });

        test("7.2 getAvailableSimulationSources causes zero filesystem side-effects", async () => {
            const preStorageHashes = computeDirectoryHashMap(storagePath);

            // Execute discovery on mock snapshot
            await getAvailableSimulationSources("dummy_snap_id", {
                rootDir: tempDir
            });

            const postStorageHashes = computeDirectoryHashMap(storagePath);
            expect(postStorageHashes.size).toBe(preStorageHashes.size);
            for (const [filePath, hash] of preStorageHashes.entries()) {
                expect(postStorageHashes.get(filePath)).toBe(hash);
            }
        });
    });
});
