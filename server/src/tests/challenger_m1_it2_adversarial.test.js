/**
 * challenger_m1_it2_adversarial.test.js
 *
 * Empirical Adversarial Challenge Suite for remediated unitTestSimulationEngine.service.js
 *
 * Tests:
 * 1. Dynamic Parameter Binding & Multi-Test-Case Scoping
 * 2. Mathematical Return Values & Expression Fidelity
 * 3. Branch Condition Evaluation & Short-Circuiting
 * 4. Rule 3 Multi-hop Call Graph Backtracking
 * 5. Storage Immutability & Disk Guard (SHA-256 audit)
 * 6. Edge Cases & Boundary Conditions (Empty strings, TS interfaces, Divide by zero)
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { describe, test, expect, beforeEach, afterEach, beforeAll, jest } from "@jest/globals";

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

const computeDirectoryHashMap = (dirPath) => {
    const hashMap = new Map();
    if (!dirPath || !fs.existsSync(dirPath)) return hashMap;
    const walk = (current) => {
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (_) { return; }
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

describe("CHALLENGER IT2: Adversarial Simulation Engine Verification", () => {
    let tempDir;
    const storagePath = path.resolve(process.cwd(), "storage");
    const uploadsPath = path.resolve(process.cwd(), "uploads");

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-chal-it2-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    // =========================================================================
    // 1. DYNAMIC PARAMETER BINDING & TEST CASE SCOPING
    // =========================================================================
    describe("1. Dynamic Parameter Binding & Multi-Test-Case Scoping", () => {
        test("CHAL-PARAM-01: Multi-argument binding with distinct primitive types", async () => {
            const sourceCode = `
export function formatUserProfile(name, age, isActive, score) {
    if (!name) return "Anonymous";
    return name + " (" + age + ") - " + (isActive ? "Active" : "Inactive") + " [" + score + "]";
}
`;
            const testCode = `
describe("formatUserProfile", () => {
    it("formats user properly", () => {
        const res = formatUserProfile("Bob", 30, true, 95.5);
        expect(res).toBe("Bob (30) - Active [95.5]");
    });
});
`;
            const trace = await generateSimulationTrace("snap_param_01", {
                sourceFilePath: "src/services/userFormat.js",
                sourceCode,
                testCode
            });

            expect(trace).toBeDefined();
            const callEntry = trace.steps.find(s => s.phase === "CALL_ENTRY");
            expect(callEntry.variables.name).toBe("Bob");
            expect(callEntry.variables.age).toBe(30);
            expect(callEntry.variables.isActive).toBe(true);
            expect(callEntry.variables.score).toBe(95.5);

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe("Bob (30) - Active [95.5]");
        });

        test("CHAL-PARAM-02: Multi-test file scoping: must bind parameters of SELECTED test case, not the last one", async () => {
            const sourceCode = `
export function calculate(val) {
    if (val > 100) return val * 2;
    return val + 10;
}
`;
            const testCode = `
describe("calculate", () => {
    it("case_small: handles small number", () => {
        expect(calculate(5)).toBe(15);
    });
    it("case_large: handles large number", () => {
        expect(calculate(200)).toBe(400);
    });
});
`;
            // Request specifically the first test case
            const traceSmall = await generateSimulationTrace("snap_param_02", {
                sourceFilePath: "src/services/calc.js",
                sourceCode,
                testCode,
                testCaseTitle: "case_small"
            });

            const callEntrySmall = traceSmall.steps.find(s => s.phase === "CALL_ENTRY");
            const returnStepSmall = traceSmall.steps.find(s => s.phase === "RETURN_VALUE");
            const assertStepSmall = traceSmall.steps.find(s => s.phase === "ASSERTION");

            // Empirical check: was val bound to 5 or was it overwritten by 200?
            expect(callEntrySmall.variables.val).toBe(5);
            expect(returnStepSmall.variables.returnValue).toBe(15);
            expect(assertStepSmall.assertionResult.expected).toBe(15);
        });

        test("CHAL-PARAM-03: Default parameters are respected when fewer arguments are passed", async () => {
            const sourceCode = `
export function computeTotal(subtotal, taxRate = 0.1, discount = 5) {
    return (subtotal * (1 + taxRate)) - discount;
}
`;
            const testCode = `
describe("computeTotal", () => {
    it("uses default tax and discount", () => {
        expect(computeTotal(100)).toBe(105);
    });
});
`;
            const trace = await generateSimulationTrace("snap_param_03", {
                sourceFilePath: "src/services/billing.js",
                sourceCode,
                testCode
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe(105);
        });
    });

    // =========================================================================
    // 2. REAL MATHEMATICAL RETURN VALUES & EXPRESSION FIDELITY
    // =========================================================================
    describe("2. Real Mathematical Return Values & Expression Fidelity", () => {
        test("CHAL-MATH-01: Complex arithmetic formula with precedence", async () => {
            const sourceCode = `
export function evaluateFormula(a, b, c, d) {
    return (a + b) * c - (d / 2);
}
`;
            const testCode = `
describe("evaluateFormula", () => {
    it("computes correctly", () => {
        expect(evaluateFormula(3, 7, 4, 10)).toBe(35);
    });
});
`;
            const trace = await generateSimulationTrace("snap_math_01", {
                sourceFilePath: "src/utils/math.js",
                sourceCode,
                testCode
            });

            // (3 + 7) * 4 - (10 / 2) = 10 * 4 - 5 = 35
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe(35);
            const assertStep = trace.steps.find(s => s.phase === "ASSERTION");
            expect(assertStep.assertionResult.expected).toBe(35);
            expect(assertStep.assertionResult.actual).toBe(35);
            expect(assertStep.assertionResult.passed).toBe(true);
        });

        test("CHAL-MATH-02: Array method chains (.filter, .map, .reduce) in business logic", async () => {
            const sourceCode = `
export function sumPositiveDoubles(numbers) {
    const positives = numbers.filter(n => n > 0);
    const doubled = positives.map(n => n * 2);
    return doubled.reduce((sum, n) => sum + n, 0);
}
`;
            const testCode = `
describe("sumPositiveDoubles", () => {
    it("filters, doubles, and sums", () => {
        expect(sumPositiveDoubles([-5, 2, -1, 4])).toBe(12);
    });
});
`;
            const trace = await generateSimulationTrace("snap_math_02", {
                sourceFilePath: "src/utils/arrayMath.js",
                sourceCode,
                testCode
            });

            // [-5, 2, -1, 4] -> [2, 4] -> [4, 8] -> 12
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe(12);
        });

        test("CHAL-MATH-03: String template literal and property interpolation", async () => {
            const sourceCode = `
export function buildGreeting(user) {
    return \`Hello, \${user.firstName} \${user.lastName}! Welcome to \${user.role}.\`;
}
`;
            const testCode = `
describe("buildGreeting", () => {
    it("interpolates properties into template string", () => {
        const u = { firstName: "John", lastName: "Doe", role: "Engineering" };
        expect(buildGreeting(u)).toBe("Hello, John Doe! Welcome to Engineering.");
    });
});
`;
            const trace = await generateSimulationTrace("snap_math_03", {
                sourceFilePath: "src/utils/greeting.js",
                sourceCode,
                testCode
            });

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe("Hello, John Doe! Welcome to Engineering.");
        });
    });

    // =========================================================================
    // 3. BRANCH CONDITION EVALUATION
    // =========================================================================
    describe("3. Branch Condition Evaluation", () => {
        test("CHAL-BRANCH-01: Sequential if-else ladder evaluation with exact path taken", async () => {
            const sourceCode = `
export function assignGrade(score) {
    if (score >= 90) {
        return "A";
    } else if (score >= 80) {
        return "B";
    } else if (score >= 70) {
        return "C";
    } else {
        return "F";
    }
}
`;
            const testCode = `
describe("assignGrade", () => {
    it("assigns B for score of 85", () => {
        expect(assignGrade(85)).toBe("B");
    });
});
`;
            const trace = await generateSimulationTrace("snap_branch_01", {
                sourceFilePath: "src/services/grades.js",
                sourceCode,
                testCode
            });

            // Branches:
            // 1. score >= 90: false
            // 2. score >= 80: true -> return "B"
            const branchSteps = trace.steps.filter(s => s.phase === "BRANCH_DECISION");
            expect(branchSteps.length).toBe(2);
            expect(branchSteps[0].branchEvaluation.branchTaken).toBe("FALSE");
            expect(branchSteps[1].branchEvaluation.branchTaken).toBe("TRUE");

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toBe("B");
        });

        test("CHAL-BRANCH-02: Nullish coalescing ?? vs logical OR || falsy differentiation", async () => {
            const sourceCode = `
export function resolveConfig(options) {
    const timeout = options.timeout ?? 5000;
    const retry = options.retry || 3;
    return { timeout, retry };
}
`;
            const testCode = `
describe("resolveConfig", () => {
    it("distinguishes 0 timeout from missing timeout", () => {
        expect(resolveConfig({ timeout: 0, retry: 0 })).toEqual({ timeout: 0, retry: 3 });
    });
});
`;
            const trace = await generateSimulationTrace("snap_branch_02", {
                sourceFilePath: "src/utils/config.js",
                sourceCode,
                testCode
            });

            // timeout: 0 is not nullish -> timeout = 0
            // retry: 0 is falsy -> retry = 3
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep.variables.returnValue).toEqual({ timeout: 0, retry: 3 });
        });
    });

    // =========================================================================
    // 4. RULE 3: CALL GRAPH BACKTRACKING FOR INTERNAL HELPERS
    // =========================================================================
    describe("4. Rule 3: Call Graph Backtracking for Internal Helpers", () => {
        test("CHAL-R3-01: Single-hop unexported helper is backtracked to exported caller", async () => {
            const sourceCode = `
function sanitizeInput(str) {
    if (!str) return "";
    return str.trim();
}

export function processInput(raw) {
    const clean = sanitizeInput(raw);
    return clean.toUpperCase();
}
`;
            const trace = await generateSimulationTrace("snap_r3_01", {
                sourceFilePath: "src/services/input.js",
                sourceCode,
                functionName: "sanitizeInput"
            });

            expect(trace.scenarioMeta.callPath[0]).toBe("processInput");
            expect(trace.scenarioMeta.callPath).toContain("sanitizeInput");
        });

        test("CHAL-R3-02: Multi-hop helper (3 levels: public -> helperA -> helperB)", async () => {
            const sourceCode = `
function leafHelper(v) {
    return v * 10;
}

function midHelper(x) {
    return leafHelper(x + 1);
}

export function mainApi(n) {
    return midHelper(n);
}
`;
            const trace = await generateSimulationTrace("snap_r3_02", {
                sourceFilePath: "src/services/chain.js",
                sourceCode,
                functionName: "leafHelper"
            });

            // Must resolve back to the public exported root 'mainApi'
            expect(trace.scenarioMeta.callPath[0]).toBe("mainApi");
        });
    });

    // =========================================================================
    // 5. STORAGE IMMUTABILITY GUARD (RULE 8)
    // =========================================================================
    describe("5. Storage Immutability Guard (Rule 8)", () => {
        test("CHAL-IMMUT-01: Zero bytes, zero timestamp mutations, zero file changes in storage/ and uploads/", async () => {
            const preStorageHashes = computeDirectoryHashMap(storagePath);
            const preUploadsHashes = computeDirectoryHashMap(uploadsPath);

            const sourceCode = `
export function computeMetrics(data) {
    if (!data) return { count: 0 };
    return { count: data.length };
}
`;
            // Execute 10 rapid simulation cycles
            for (let i = 0; i < 10; i++) {
                await generateSimulationTrace(`snap_immut_${i}`, {
                    sourceFilePath: "src/services/metrics.js",
                    sourceCode,
                    category: "HAPPY_PATH"
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
    });

    // =========================================================================
    // 6. EDGE CASES & PATHOLOGICAL INPUTS
    // =========================================================================
    describe("6. Edge Cases & Pathological Inputs", () => {
        test("CHAL-EDGE-01: Empty source code ('') handling without unhandled 404 crash", async () => {
            const trace = await generateSimulationTrace("snap_empty_it2", {
                sourceFilePath: "src/services/empty.js",
                sourceCode: ""
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(1);
        });

        test("CHAL-EDGE-02: TypeScript interface declaration preceding exported function", async () => {
            const sourceCode = `
export interface OrderPayload {
    id: string;
    amount: number;
}

export function processOrder(order: OrderPayload): number {
    return order.amount * 1.1;
}
`;
            const trace = await generateSimulationTrace("snap_ts_iface", {
                sourceFilePath: "src/services/order.ts",
                sourceCode
            });

            // Target function must be processOrder, not OrderPayload!
            expect(trace.testCase.targetFunction).toBe("processOrder");
        });

        test("CHAL-EDGE-03: Division by zero returns Infinity without throwing unhandled error", () => {
            const node = {
                type: "BinaryExpression",
                operator: "/",
                left: { type: "NumericLiteral", value: 100 },
                right: { type: "NumericLiteral", value: 0 }
            };
            const result = evaluateAstExpression(node);
            expect(result).toBe(Infinity);
        });
    });
});
