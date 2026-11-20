/**
 * challenger_m1_simulation_stress.test.js
 *
 * Empirical Adversarial Challenge Test Harness for unitTestSimulationEngine.service.js
 *
 * Objectives:
 * 1. Rule 2: 4 Categories (Happy Path, Boundary Values, Branch Toggling, Error Handling)
 * 2. Rule 3: Call Graph Backtracking (Multi-level internal helper call graphs)
 * 3. Rule 4: RAM Mocks (Isolation, no network sockets)
 * 4. Rule 8: Storage Immutability Guard (Zero writes to storage/ or uploads/)
 * 5. Circular Reference & Trace Serialization
 * 6. API Contract Compliance (PROJECT.md M1 ↔ M2 contract)
 * 7. Edge Cases: TypeScript, object dictionaries, switch-case, nested ternaries
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

describe("CHALLENGER: Adversarial Stress Testing of unitTestSimulationEngine.service.js", () => {
    let tempDir;

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-sim-challenger-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    // =========================================================================
    // 1. RULE 3: MULTI-LEVEL HELPER CALL GRAPH BACKTRACKING STRESS
    // =========================================================================
    describe("Rule 3: Multi-Level Helper Call Graph Backtracking", () => {
        test("CHALLENGE-R3-01: 3-Level Call Chain (public -> intermediate helper -> private leaf)", async () => {
            const sourceCode = `
function deepLeafHelper(val) {
    if (val < 0) return 0;
    return val * 2;
}

function intermediateHelper(data) {
    if (!data) return 0;
    return deepLeafHelper(data.amount);
}

export function publicApiEndpoint(req) {
    if (!req || !req.body) throw new Error("Invalid request");
    return intermediateHelper(req.body);
}
`;
            const trace = await generateSimulationTrace("snap_r3_01", {
                sourceFilePath: "src/services/multiLevel.service.js",
                sourceCode,
                functionName: "deepLeafHelper"
            });

            expect(trace).toBeDefined();

            // The entry step must be the public caller, NOT the unexported intermediate helper
            const entryStep = trace.steps.find(s => s.phase === "CALL_ENTRY");
            expect(entryStep).toBeDefined();

            // The callPath MUST resolve back to the public exported entry point 'publicApiEndpoint'
            expect(trace.scenarioMeta.callPath[0]).toBe("publicApiEndpoint");
            expect(trace.scenarioMeta.callPath).toEqual(["publicApiEndpoint", "intermediateHelper", "deepLeafHelper"]);
        });

        test("CHALLENGE-R3-02: Unreachable internal helper with NO exported callers", async () => {
            const sourceCode = `
function deadHelper(x) {
    return x * 100;
}

export function alivePublic(y) {
    return y + 1;
}
`;
            const trace = await generateSimulationTrace("snap_r3_02", {
                sourceFilePath: "src/services/orphan.js",
                sourceCode,
                functionName: "deadHelper"
            });

            expect(trace).toBeDefined();
            expect(trace.scenarioMeta.callPath).toBeDefined();
        });

        test("CHALLENGE-R3-03: Mutually recursive internal helpers", async () => {
            const sourceCode = `
function helperA(n) {
    if (n <= 0) return 0;
    return helperB(n - 1);
}

function helperB(n) {
    if (n <= 0) return 0;
    return helperA(n - 1);
}

export function runRecursion(n) {
    return helperA(n);
}
`;
            const trace = await generateSimulationTrace("snap_r3_03", {
                sourceFilePath: "src/services/recursion.js",
                sourceCode,
                functionName: "helperB"
            });

            expect(trace).toBeDefined();
            expect(trace.scenarioMeta.callPath).toBeDefined();
        });
    });

    // =========================================================================
    // 2. RULE 2: 4-CATEGORY DECISION TABLE STRESS & BRANCH OUTCOMES
    // =========================================================================
    describe("Rule 2: 4-Category Parameter Values & Branch Evaluation", () => {
        test("CHALLENGE-R2-01: Category B Boundary Values on empty collections and zeroes triggers True branch", async () => {
            const sourceCode = `
export function processBatch(items = [], threshold = 0) {
    if (items.length === 0) return { count: 0, status: "EMPTY" };
    if (threshold <= 0) return { count: items.length, status: "UNFILTERED" };
    const filtered = items.filter(x => x > threshold);
    return { count: filtered.length, status: "FILTERED" };
}
`;
            const trace = await generateSimulationTrace("snap_r2_01", {
                sourceFilePath: "src/services/batch.js",
                sourceCode,
                category: "BOUNDARY_VALUES"
            });

            expect(trace.testCase.category).toBe("BOUNDARY_VALUES");

            // Check branch decision step
            const branchStep = trace.steps.find(s => s.phase === "BRANCH_DECISION");
            expect(branchStep).toBeDefined();

            // In boundary values with empty collection items=[], the branch items.length === 0 must evaluate to TRUE
            const emptyBranch = trace.summary.branchesToggled.find(b => b.condition?.includes("items.length === 0"));
            expect(emptyBranch).toBeDefined();
            expect(emptyBranch.outcome).toBe(true);
        });

        test("CHALLENGE-R2-02: Category A Happy Path guard clause evaluates to False (bypassed)", async () => {
            const sourceCode = `
export function calculateTotal(order) {
    if (!order || typeof order !== "object") {
        throw new Error("Invalid order");
    }
    return order.amount * 1.1;
}
`;
            const trace = await generateSimulationTrace("snap_r2_happy", {
                sourceFilePath: "src/services/order.js",
                sourceCode,
                category: "HAPPY_PATH"
            });

            expect(trace.testCase.category).toBe("HAPPY_PATH");
            const guardBranch = trace.summary.branchesToggled.find(b => b.condition?.includes("!order"));
            expect(guardBranch).toBeDefined();
            // In Happy Path, the error guard clause must be bypassed (evaluated to FALSE)
            expect(guardBranch.outcome).toBe(false);
        });

        test("CHALLENGE-R2-03: Category C Branch Toggling on compound conditional expressions", async () => {
            const sourceCode = `
export function computeAccessTier(user, plan) {
    if (user?.role === "ADMIN" || (plan?.type === "ENTERPRISE" && plan?.active)) {
        return "TIER_1";
    }
    if (user?.age >= 65 || user?.isStudent) {
        return "CONCESSION";
    }
    return "STANDARD";
}
`;
            const trace = await generateSimulationTrace("snap_r2_02", {
                sourceFilePath: "src/services/tier.js",
                sourceCode,
                category: "BRANCH_TOGGLING"
            });

            expect(trace.testCase.category).toBe("BRANCH_TOGGLING");
            const branchStep = trace.steps.find(s => s.phase === "BRANCH_DECISION");
            expect(branchStep).toBeDefined();
            expect(branchStep.branchEvaluation.branchTaken).toBe("TRUE");
        });

        test("CHALLENGE-R2-04: Category D Error Handling throw verification and matcher", async () => {
            const sourceCode = `
export function parseToken(token) {
    if (!token) {
        throw new Error("Token missing");
    }
    if (typeof token !== "string") {
        throw new TypeError("Token must be a string");
    }
    return { valid: true };
}
`;
            const trace = await generateSimulationTrace("snap_r2_03", {
                sourceFilePath: "src/services/auth.js",
                sourceCode,
                category: "ERROR_HANDLING"
            });

            expect(trace.testCase.category).toBe("ERROR_HANDLING");
            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep).toBeDefined();
            expect(returnStep.title).toContain("Exception Thrown");

            const assertionStep = trace.steps.find(s => s.phase === "ASSERTION");
            expect(assertionStep).toBeDefined();
            expect(assertionStep.assertionResult.matcher).toBe("toThrow");
        });
    });

    // =========================================================================
    // 3. RULE 4: UNIVERSAL RAM MOCKS & NETWORK HERMETICITY
    // =========================================================================
    describe("Rule 4: Universal RAM Mocks & Hermetic Execution", () => {
        test("CHALLENGE-R4-01: Discovers all universal mocks without triggering socket/db connections", async () => {
            const sourceCode = `
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import Redis from "ioredis";
import Queue from "bullmq";
import mongoose from "mongoose";

const prisma = new PrismaClient();
const redis = new Redis();

export async function syncCustomer(customerId) {
    const cached = await redis.get(customerId);
    if (cached) return JSON.parse(cached);
    const user = await prisma.user.findUnique({ where: { id: customerId } });
    const remote = await axios.get("https://api.crm.com/user/" + customerId);
    await redis.set(customerId, JSON.stringify(remote.data));
    return remote.data;
}
`;
            const trace = await generateSimulationTrace("snap_r4_01", {
                sourceFilePath: "src/services/sync.js",
                sourceCode
            });

            expect(trace.initialMocks.length).toBeGreaterThanOrEqual(4);
            const mockModules = trace.initialMocks.map(m => m.module);
            expect(mockModules).toContain("prisma");
            expect(mockModules).toContain("axios");
            expect(mockModules).toContain("redis");
            expect(mockModules).toContain("bullmq");
            expect(mockModules).toContain("mongoose");
            expect(mockModules).toContain("process.env");

            const setupStep = trace.steps.find(s => s.phase === "SETUP_MOCKS");
            expect(setupStep).toBeDefined();
            expect(setupStep.activeMocks.length).toBe(trace.initialMocks.length);
        });
    });

    // =========================================================================
    // 4. RULE 8: STORAGE IMMUTABILITY AUDIT
    // =========================================================================
    describe("Rule 8: Storage Immutability Guard", () => {
        test("CHALLENGE-R8-01: Strictly zero writes to storage/ and uploads/ across 50 simulation cycles", async () => {
            const storageDir = path.join(tempDir, "storage", "projects", "audit_project", "snap_audit", "repo");
            const uploadsDir = path.join(tempDir, "uploads", "audit_project");
            fs.mkdirSync(storageDir, { recursive: true });
            fs.mkdirSync(uploadsDir, { recursive: true });

            const dummyFile = path.join(storageDir, "importantService.js");
            const originalCode = `export function calc(x) { return x * 42; }`;
            fs.writeFileSync(dummyFile, originalCode);

            const beforeStorageTree = fs.readdirSync(storageDir);
            const beforeUploadsTree = fs.readdirSync(uploadsDir);
            const beforeMtime = fs.statSync(dummyFile).mtimeMs;

            for (let i = 0; i < 50; i++) {
                await generateSimulationTrace("snap_audit", {
                    rootDir: tempDir,
                    sourceFilePath: "storage/projects/audit_project/snap_audit/repo/importantService.js"
                });
            }

            const afterStorageTree = fs.readdirSync(storageDir);
            const afterUploadsTree = fs.readdirSync(uploadsDir);
            const afterMtime = fs.statSync(dummyFile).mtimeMs;
            const afterCode = fs.readFileSync(dummyFile, "utf8");

            expect(afterMtime).toBe(beforeMtime);
            expect(afterStorageTree).toEqual(beforeStorageTree);
            expect(afterUploadsTree).toEqual(beforeUploadsTree);
            expect(afterCode).toBe(originalCode);
        });
    });

    // =========================================================================
    // 5. CIRCULAR REFERENCE & TRACE JSON SERIALIZATION
    // =========================================================================
    describe("Circular Reference & Trace Serialization", () => {
        test("CHALLENGE-SER-01: Serializes trace with complex deeply nested structures without crashing", async () => {
            const sourceCode = `
export function complexTransform(data) {
    if (!data) return null;
    return {
        meta: { id: data.id, tags: ["a", "b", "c"] },
        nested: { inner: { value: 123 } }
    };
}
`;
            const trace = await generateSimulationTrace("snap_ser_01", {
                sourceFilePath: "src/services/complex.js",
                sourceCode
            });

            const jsonStr = JSON.stringify(trace);
            expect(typeof jsonStr).toBe("string");

            const restored = JSON.parse(jsonStr);
            expect(restored.id).toBe(trace.id);
            expect(restored.steps.length).toBe(trace.steps.length);
            expect(restored.summary.totalSteps).toBe(trace.summary.totalSteps);
        });
    });

    // =========================================================================
    // 6. PROJECT.MD M1 ↔ M2 INTERFACE CONTRACT COMPLIANCE
    // =========================================================================
    describe("PROJECT.md M1 ↔ M2 Contract Compliance", () => {
        test("CHALLENGE-CONTRACT-01: getAvailableSimulationSources adheres to exact contract schema", async () => {
            const srcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "auth.service.js"), `export function login(u, p) { return true; }`);

            const sourcesResult = await getAvailableSimulationSources("snap_contract_01", { rootDir: tempDir });

            expect(sourcesResult).toBeDefined();
            expect(Array.isArray(sourcesResult.sourceFiles)).toBe(true);

            const fileItem = sourcesResult.sourceFiles[0];
            expect(fileItem).toHaveProperty("filePath");
            expect(fileItem).toHaveProperty("fileName");
            expect(fileItem).toHaveProperty("testFiles");
            expect(Array.isArray(fileItem.testFiles)).toBe(true);
            expect(fileItem).toHaveProperty("functions");
            expect(Array.isArray(fileItem.functions)).toBe(true);
            expect(fileItem).toHaveProperty("testCount");
            expect(typeof fileItem.testCount).toBe("number");
            expect(fileItem).toHaveProperty("virtualScenariosCount");
            expect(typeof fileItem.virtualScenariosCount).toBe("number");

            const fnItem = fileItem.functions[0];
            expect(fnItem).toHaveProperty("name");
            expect(fnItem).toHaveProperty("startLine");
            expect(fnItem).toHaveProperty("endLine");
            expect(fnItem).toHaveProperty("complexity");
        });

        test("CHALLENGE-CONTRACT-02: generateSimulationTrace adheres to exact contract schema", async () => {
            const sourceCode = `export function getStatus(code) { return code === 200 ? "OK" : "ERROR"; }`;
            const trace = await generateSimulationTrace("snap_contract_02", {
                sourceFilePath: "src/utils/status.js",
                sourceCode
            });

            expect(trace).toHaveProperty("sourceFilePath");
            expect(trace).toHaveProperty("sourceCode");
            expect(trace).toHaveProperty("testCase");
            expect(trace.testCase).toHaveProperty("id");
            expect(trace.testCase).toHaveProperty("title");
            expect(trace.testCase).toHaveProperty("category");
            expect(["HAPPY_PATH", "BOUNDARY_VALUES", "BRANCH_TOGGLING", "ERROR_HANDLING"]).toContain(trace.testCase.category);

            expect(trace).toHaveProperty("summary");
            expect(trace.summary).toHaveProperty("totalSteps");
            expect(trace.summary).toHaveProperty("branchesToggled");
            expect(trace.summary).toHaveProperty("assertionsCount");
            expect(trace.summary).toHaveProperty("allAssertionsPassed");

            expect(trace).toHaveProperty("initialMocks");
            expect(Array.isArray(trace.initialMocks)).toBe(true);
            for (const mock of trace.initialMocks) {
                expect(mock).toHaveProperty("module");
                expect(mock).toHaveProperty("mockType");
                expect(mock).toHaveProperty("simulatedMethods");
            }

            expect(trace).toHaveProperty("steps");
            expect(Array.isArray(trace.steps)).toBe(true);
            for (const step of trace.steps) {
                expect(step).toHaveProperty("stepIndex");
                expect(step).toHaveProperty("phase");
                expect([
                    "SETUP_MOCKS",
                    "CALL_ENTRY",
                    "EVAL_PARAMS",
                    "BRANCH_DECISION",
                    "MOCK_INTERACTION",
                    "STATE_TRANSITION",
                    "RETURN_VALUE",
                    "ASSERTION"
                ]).toContain(step.phase);
                expect(step).toHaveProperty("line");
                expect(step).toHaveProperty("codeSnippet");
                expect(step).toHaveProperty("callStack");
                expect(Array.isArray(step.callStack)).toBe(true);
                expect(step).toHaveProperty("variables");
                expect(step).toHaveProperty("activeMocks");
                expect(Array.isArray(step.activeMocks)).toBe(true);
                expect(step).toHaveProperty("educationalGuidance");
                expect(step.educationalGuidance).toHaveProperty("stepTitle");
                expect(step.educationalGuidance).toHaveProperty("category");
                expect(step.educationalGuidance).toHaveProperty("stepNarrative");
                expect(step.educationalGuidance).toHaveProperty("logicRationale");
                expect(step.educationalGuidance).toHaveProperty("developerTakeaway");
            }
        });
    });

    // =========================================================================
    // 7. EDGE CASES: TYPESCRIPT, OBJECT DICTIONARIES & CORNER CASES
    // =========================================================================
    describe("Edge Cases: TypeScript & Object Dictionaries", () => {
        test("CHALLENGE-EDGE-01: TypeScript syntax with interface, type annotations, and generics", async () => {
            const sourceCode = `
export interface UserPayload {
    id: string;
    score: number;
}

export function evaluateScore<T extends UserPayload>(user: T): boolean {
    if (user.score >= 100) {
        return true;
    }
    return false;
}
`;
            const trace = await generateSimulationTrace("snap_edge_ts", {
                sourceFilePath: "src/services/score.ts",
                sourceCode
            });

            expect(trace).toBeDefined();
            // Must target the executable function evaluateScore, NOT the compile-time type UserPayload
            expect(trace.testCase.targetFunction).toBe("evaluateScore");
            expect(trace.steps.length).toBeGreaterThanOrEqual(4);
        });

        test("CHALLENGE-EDGE-02: Exported object dictionaries (Rule 8 member methods discovery)", async () => {
            const sourceCode = `
export const cartService = {
    addItem(item) {
        if (!item) throw new Error("Missing item");
        return { success: true };
    },
    clearCart() {
        return { cleared: true };
    }
};
`;
            const sourcesResult = await getAvailableSimulationSources("snap_dict", {
                rootDir: tempDir,
                filePath: "src/services/cart.js"
            });

            // Even if written directly or through options
            const trace = await generateSimulationTrace("snap_dict_trace", {
                sourceFilePath: "src/services/cart.js",
                sourceCode,
                functionName: "cartService.addItem"
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.targetFunction).toContain("addItem");
        });

        test("CHALLENGE-EDGE-03: Exported class methods simulation", async () => {
            const sourceCode = `
export class OrderService {
    calculateTotal(items) {
        if (!items || items.length === 0) return 0;
        return items.reduce((sum, item) => sum + item.price, 0);
    }
}
`;
            const trace = await generateSimulationTrace("snap_edge_class", {
                sourceFilePath: "src/services/OrderService.js",
                sourceCode,
                functionName: "OrderService.calculateTotal"
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.targetFunction).toContain("calculateTotal");
        });

        test("CHALLENGE-EDGE-04: Empty file and comment-only file handling", async () => {
            const emptySource = `// Just a comment\n/* Multi line\ncomment */\n`;
            const trace = await generateSimulationTrace("snap_edge_empty", {
                sourceFilePath: "src/utils/empty.js",
                sourceCode: emptySource
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(3);
        });
    });

    // =========================================================================
    // 8. FEATURE F4: DEFENSIVE PATH SANITIZATION & STRESS
    // =========================================================================
    describe("Feature F4: Defensive Path Sanitization Stress & Edge Cases", () => {
        test("CHALLENGE-F4-01: Deep nested relative paths resolved from disk", async () => {
            const deepDir = path.join(tempDir, "src", "modules", "billing", "domain", "services");
            fs.mkdirSync(deepDir, { recursive: true });
            const deepFile = path.join(deepDir, "invoice.service.js");
            fs.writeFileSync(deepFile, "export function createInvoice(amount) { return { amount, status: 'DRAFT' }; }");

            const trace = await generateSimulationTrace("snap_f4_deep", {
                rootDir: tempDir,
                sourceFilePath: "src/modules/billing/domain/services/invoice.service.js",
                functionName: "createInvoice"
            });

            expect(trace).toBeDefined();
            expect(trace.sourceCode).toContain("createInvoice");
            expect(trace.sourceFilePath).toBe("src/modules/billing/domain/services/invoice.service.js");
        });

        test("CHALLENGE-F4-02: Leading slashes (single and multiple) sanitized", async () => {
            const svcDir = path.join(tempDir, "src", "services");
            fs.mkdirSync(svcDir, { recursive: true });
            fs.writeFileSync(path.join(svcDir, "calc.js"), "export function add(a, b) { return a + b; }");

            // Single leading slash
            const traceSingle = await generateSimulationTrace("snap_f4_slash1", {
                rootDir: tempDir,
                sourceFilePath: "/src/services/calc.js",
                functionName: "add"
            });
            expect(traceSingle).toBeDefined();
            expect(traceSingle.sourceFilePath).toBe("src/services/calc.js");

            // Multiple leading slashes
            const traceMulti = await generateSimulationTrace("snap_f4_slash2", {
                rootDir: tempDir,
                sourceFilePath: "///src/services/calc.js",
                functionName: "add"
            });
            expect(traceMulti).toBeDefined();
            expect(traceMulti.sourceFilePath).toBe("src/services/calc.js");
        });

        test("CHALLENGE-F4-03: Container storage paths (/app/storage/projects/...) stripped against repo root", async () => {
            const repoDir = path.join(tempDir, "storage", "projects", "proj123", "github", "179000", "repo");
            const srcDir = path.join(repoDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, "token.js"), "export function genToken() { return 'secret'; }");

            const trace = await generateSimulationTrace("snap_f4_container", {
                rootDir: repoDir,
                sourceFilePath: "/app/storage/projects/proj123/github/179000/repo/src/token.js",
                functionName: "genToken"
            });

            expect(trace).toBeDefined();
            expect(trace.sourceFilePath).toBe("src/token.js");
            expect(trace.sourceCode).toContain("genToken");
        });

        test("CHALLENGE-F4-04: Non-existent source file rejects with ServiceError 404", async () => {
            await expect(
                generateSimulationTrace("snap_f4_missing", {
                    rootDir: tempDir,
                    sourceFilePath: "src/services/does_not_exist.js"
                })
            ).rejects.toThrow(ServiceError);

            await expect(
                generateSimulationTrace("snap_f4_missing", {
                    rootDir: tempDir,
                    sourceFilePath: "src/services/does_not_exist.js"
                })
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        test("CHALLENGE-F4-05: Non-existent testFilePath falls back safely to virtual scenario without crashing", async () => {
            const svcDir = path.join(tempDir, "src");
            fs.mkdirSync(svcDir, { recursive: true });
            fs.writeFileSync(path.join(svcDir, "user.js"), "export function getUser(id) { return { id }; }");

            const trace = await generateSimulationTrace("snap_f4_missing_test", {
                rootDir: tempDir,
                sourceFilePath: "src/user.js",
                testFilePath: "tests/ghost.test.js",
                functionName: "getUser"
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.isVirtual).toBe(true);
            expect(trace.steps.length).toBeGreaterThanOrEqual(3);
        });

        test("CHALLENGE-F4-06: Empty string or whitespace-only sourceFilePath rejects with 404", async () => {
            await expect(
                generateSimulationTrace("snap_f4_empty", {
                    rootDir: tempDir,
                    sourceFilePath: "   "
                })
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        test("CHALLENGE-F4-07: Directory path as sourceFilePath rejects with 404 (does NOT crash with EISDIR)", async () => {
            const dirOnly = path.join(tempDir, "src", "helpers");
            fs.mkdirSync(dirOnly, { recursive: true });

            await expect(
                generateSimulationTrace("snap_f4_dir", {
                    rootDir: tempDir,
                    sourceFilePath: "src/helpers"
                })
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        test("CHALLENGE-F4-08: Path traversal attempts reject with 404", async () => {
            await expect(
                generateSimulationTrace("snap_f4_traversal", {
                    rootDir: tempDir,
                    sourceFilePath: "../../../../etc/passwd"
                })
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        test("CHALLENGE-F4-09: Test file with leading slash or backslashes is sanitized and parsed", async () => {
            const srcDir = path.join(tempDir, "src");
            const testDir = path.join(tempDir, "tests");
            fs.mkdirSync(srcDir, { recursive: true });
            fs.mkdirSync(testDir, { recursive: true });

            fs.writeFileSync(path.join(srcDir, "math.js"), "export function square(n) { return n * n; }");
            fs.writeFileSync(path.join(testDir, "math.test.js"), `
                import { square } from "../src/math.js";
                describe("square", () => {
                    it("squares a number (Happy Path)", () => {
                        expect(square(4)).toBe(16);
                    });
                });
            `);

            const trace = await generateSimulationTrace("snap_f4_testpath", {
                rootDir: tempDir,
                sourceFilePath: "/src/math.js",
                testFilePath: "/tests/math.test.js",
                functionName: "square"
            });

            expect(trace).toBeDefined();
            expect(trace.testCase.isVirtual).toBe(false);
            expect(trace.testCase.title).toContain("squares a number");
        });
    });

    // =========================================================================
    // 9. FEATURE F5: CATEGORY-AWARE TEST MATCHING & VIRTUAL SCENARIOS
    // =========================================================================
    describe("Feature F5: Category-Aware Test Matching Across 4 Categories", () => {
        const fullSuiteSource = `
export function validateAge(age) {
    if (age === null || age === undefined || age < 0) {
        throw new Error("Invalid age");
    }
    if (age === 0) {
        return "NEWBORN";
    }
    if (age >= 18) {
        return "ADULT";
    }
    return "MINOR";
}
`;

        const fullSuiteTests = `
import { validateAge } from "./age.service.js";

describe("validateAge", () => {
    it("returns ADULT for age 25 (Happy Path)", () => {
        expect(validateAge(25)).toBe("ADULT");
    });

    it("returns NEWBORN for boundary age 0 (Boundary Values)", () => {
        expect(validateAge(0)).toBe("NEWBORN");
    });

    it("returns MINOR for age 10 (Branch Toggling)", () => {
        expect(validateAge(10)).toBe("MINOR");
    });

    it("throws error for negative age (Error Handling)", () => {
        expect(() => validateAge(-5)).toThrow("Invalid age");
    });
});
`;

        test("CHALLENGE-F5-01: Selects exact test matching requestedCategory for all 4 categories", async () => {
            const categories = [
                { cat: "HAPPY_PATH", expectedKeyword: "Happy Path" },
                { cat: "BOUNDARY_VALUES", expectedKeyword: "Boundary Values" },
                { cat: "BRANCH_TOGGLING", expectedKeyword: "Branch Toggling" },
                { cat: "ERROR_HANDLING", expectedKeyword: "Error Handling" }
            ];

            for (const { cat, expectedKeyword } of categories) {
                const trace = await generateSimulationTrace(`snap_f5_${cat}`, {
                    sourceCode: fullSuiteSource,
                    sourceFilePath: "src/services/age.service.js",
                    testCode: fullSuiteTests,
                    functionName: "validateAge",
                    category: cat
                });

                expect(trace.testCase.category).toBe(cat);
                expect(trace.testCase.title).toContain(expectedKeyword);
                expect(trace.testCase.isVirtual).toBe(false);
            }
        });

        test("CHALLENGE-F5-02: Falls back to synthesized virtual scenario when requested category is missing from test file", async () => {
            // Test file only has HAPPY_PATH
            const happyOnlyTests = `
describe("validateAge", () => {
    it("returns ADULT for normal adult (Happy Path)", () => {
        expect(validateAge(30)).toBe("ADULT");
    });
});
`;

            // Request BOUNDARY_VALUES: must NOT return Happy Path test, must synthesize virtual BOUNDARY_VALUES scenario
            const traceBoundary = await generateSimulationTrace("snap_f5_virt_bv", {
                sourceCode: fullSuiteSource,
                sourceFilePath: "src/services/age.service.js",
                testCode: happyOnlyTests,
                functionName: "validateAge",
                category: "BOUNDARY_VALUES"
            });

            expect(traceBoundary.testCase.category).toBe("BOUNDARY_VALUES");
            expect(traceBoundary.testCase.isVirtual).toBe(true);

            // Request ERROR_HANDLING: must NOT return Happy Path test, must synthesize virtual ERROR_HANDLING scenario
            const traceError = await generateSimulationTrace("snap_f5_virt_eh", {
                sourceCode: fullSuiteSource,
                sourceFilePath: "src/services/age.service.js",
                testCode: happyOnlyTests,
                functionName: "validateAge",
                category: "ERROR_HANDLING"
            });

            expect(traceError.testCase.category).toBe("ERROR_HANDLING");
            expect(traceError.testCase.isVirtual).toBe(true);
        });

        test("CHALLENGE-F5-03: Virtual scenario synthesis across all 4 categories without any test file", async () => {
            const allCats = ["HAPPY_PATH", "BOUNDARY_VALUES", "BRANCH_TOGGLING", "ERROR_HANDLING"];

            for (const cat of allCats) {
                const trace = await generateSimulationTrace(`snap_f5_notest_${cat}`, {
                    sourceCode: fullSuiteSource,
                    sourceFilePath: "src/services/age.service.js",
                    functionName: "validateAge",
                    category: cat
                });

                expect(trace.testCase.category).toBe(cat);
                expect(trace.testCase.isVirtual).toBe(true);
                expect(trace.testCase.targetFunction).toBe("validateAge");
            }
        });

        test("CHALLENGE-F5-04: Unspecified requestedCategory preserves backward-compatible default selection", async () => {
            const trace = await generateSimulationTrace("snap_f5_default", {
                sourceCode: fullSuiteSource,
                sourceFilePath: "src/services/age.service.js",
                testCode: fullSuiteTests,
                functionName: "validateAge"
            });

            expect(trace.testCase).toBeDefined();
            expect(trace.testCase.targetFunction).toBe("validateAge");
            expect(trace.testCase.isVirtual).toBe(false);
        });
    });

    // =========================================================================
    // 10. FEATURE F6: PEDAGOGICAL ERROR_THROW PHASE ALIGNMENT
    // =========================================================================
    describe("Feature F6: Pedagogical Phase Alignment (ERROR_THROW)", () => {
        const errorSource = `
export function authenticateUser(token) {
    if (!token) {
        throw new Error("Missing authentication token");
    }
    return { authenticated: true, user: "admin" };
}
`;

        const errorTests = `
describe("authenticateUser", () => {
    it("throws error when token is omitted (Error Handling)", () => {
        expect(() => authenticateUser(null)).toThrow("Missing authentication token");
    });
});
`;

        test("CHALLENGE-F6-01: Guard clause throw produces dedicated ERROR_THROW phase step with pedagogical guidance", async () => {
            const trace = await generateSimulationTrace("snap_f6_01", {
                sourceCode: errorSource,
                sourceFilePath: "src/services/auth.service.js",
                testCode: errorTests,
                functionName: "authenticateUser",
                category: "ERROR_HANDLING"
            });

            const errorStep = trace.steps.find(s => s.phase === "ERROR_THROW");
            expect(errorStep).toBeDefined();
            expect(errorStep.stepType).toBe("ERROR_THROW");
            expect(errorStep.title).toBe("Exception Thrown (Guard Clause)");
            expect(errorStep.description).toContain("Execution halted early");
            expect(errorStep.variables).toHaveProperty("thrownException");
            expect(errorStep.variables.thrownException).toContain("Missing authentication token");
            expect(errorStep.educationalGuidance).toBeDefined();
            expect(errorStep.educationalGuidance.category).toBe("ERROR_HANDLING");
            expect(errorStep.educationalGuidance.stepTitle).toBe("Exception Thrown (Fail-Fast Guard)");
        });

        test("CHALLENGE-F6-02: Preserves backward-compatible RETURN_VALUE step alongside ERROR_THROW", async () => {
            const trace = await generateSimulationTrace("snap_f6_02", {
                sourceCode: errorSource,
                sourceFilePath: "src/services/auth.service.js",
                testCode: errorTests,
                functionName: "authenticateUser",
                category: "ERROR_HANDLING"
            });

            const errorStepIndex = trace.steps.findIndex(s => s.phase === "ERROR_THROW");
            const returnStepIndex = trace.steps.findIndex(s => s.phase === "RETURN_VALUE");

            expect(errorStepIndex).toBeGreaterThan(-1);
            expect(returnStepIndex).toBeGreaterThan(-1);
            expect(returnStepIndex).toBe(errorStepIndex + 1);
        });

        test("CHALLENGE-F6-03: Normal successful execution NEVER emits ERROR_THROW phase", async () => {
            const normalSource = `
export function addPoints(current, points) {
    return current + points;
}
`;
            const trace = await generateSimulationTrace("snap_f6_03", {
                sourceCode: normalSource,
                sourceFilePath: "src/services/points.js",
                functionName: "addPoints",
                category: "HAPPY_PATH"
            });

            const errorStep = trace.steps.find(s => s.phase === "ERROR_THROW");
            expect(errorStep).toBeUndefined();

            const returnStep = trace.steps.find(s => s.phase === "RETURN_VALUE");
            expect(returnStep).toBeDefined();
            expect(returnStep.title).not.toContain("Exception Thrown");
        });

        test("CHALLENGE-F6-04: Virtual scenario with ERROR_HANDLING triggers ERROR_THROW node", async () => {
            const guardSource = `
export function withdrawFunds(amount) {
    if (amount <= 0) {
        throw new RangeError("Amount must be positive");
    }
    return { success: true };
}
`;
            const trace = await generateSimulationTrace("snap_f6_04", {
                sourceCode: guardSource,
                sourceFilePath: "src/services/bank.js",
                functionName: "withdrawFunds",
                category: "ERROR_HANDLING"
            });

            const errorStep = trace.steps.find(s => s.phase === "ERROR_THROW");
            expect(errorStep).toBeDefined();
            expect(errorStep.phase).toBe("ERROR_THROW");
            expect(errorStep.title).toBe("Exception Thrown (Guard Clause)");
        });
    });
});
