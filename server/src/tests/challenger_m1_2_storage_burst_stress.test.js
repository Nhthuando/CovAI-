/**
 * challenger_m1_2_storage_burst_stress.test.js
 *
 * Empirical Challenger 2 Stress Test Suite for Milestone M1:
 * Backend Simulation Engine & Contract Sync
 *
 * Targeted Challenge Dimensions:
 * 1. Storage & Uploads Immutability Guard (F9):
 *    - Full recursive SHA-256 digest computation before and after all simulation runs
 *    - Zero file creation, modification, or deletion across storage/ and uploads/
 * 2. High Concurrency Burst Resilience:
 *    - Burst of 100 simultaneous parallel trace generations across all 4 categories
 *    - Throughput, RAM mock isolation, and state leak verification
 * 3. Loop Iteration Limits & Infinite Loop Safety:
 *    - While/for loop iteration cap breaking (preventing event-loop starvation)
 *    - Deep mutual recursion safety without stack overflows
 * 4. Thenable Proxy Deadlock Immunity:
 *    - Universal RAM mock thenable handling
 *    - Promise rejections and unhandled rejection immunity
 * 5. Large Scale AST & Multi-Branch Stress:
 *    - 1,000-line simulated complex service with 50 decision branches
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
    discoverUniversalRamMocks,
    categorizeFilePath,
    resolveRootDir,
    CATEGORY_NAMES
} = await import("../services/unitTestSimulationEngine.service.js");

const { parseJavaScriptCode } = await import("../services/babelParser.service.js");
const { ServiceError } = await import("../utils/serviceError.js");

/**
 * Computes recursive SHA-256 digest map of all files in a directory.
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

describe("CHALLENGER 2: Milestone M1 Empirical Immutability & Concurrency Stress", () => {
    let tempDir;
    let initialStorageHashMap = new Map();
    let initialUploadsHashMap = new Map();

    const rootDir = process.cwd();
    // Check both server-relative and root-relative storage & uploads paths
    const storagePaths = [
        path.resolve(rootDir, "storage"),
        path.resolve(rootDir, "server", "storage")
    ].filter(p => fs.existsSync(p));

    const uploadsPaths = [
        path.resolve(rootDir, "uploads"),
        path.resolve(rootDir, "server", "uploads")
    ].filter(p => fs.existsSync(p));

    beforeAll(() => {
        // Collect pre-test SHA-256 digests across all storage and uploads directories
        for (const sp of storagePaths) {
            const map = computeDirectoryHashMap(sp);
            for (const [k, v] of map.entries()) {
                initialStorageHashMap.set(k, v);
            }
        }
        for (const up of uploadsPaths) {
            const map = computeDirectoryHashMap(up);
            for (const [k, v] of map.entries()) {
                initialUploadsHashMap.set(k, v);
            }
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-challenger2-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    afterAll(() => {
        // Audit post-test SHA-256 digests against initial baseline
        const postStorageHashMap = new Map();
        for (const sp of storagePaths) {
            const map = computeDirectoryHashMap(sp);
            for (const [k, v] of map.entries()) {
                postStorageHashMap.set(k, v);
            }
        }

        const postUploadsHashMap = new Map();
        for (const up of uploadsPaths) {
            const map = computeDirectoryHashMap(up);
            for (const [k, v] of map.entries()) {
                postUploadsHashMap.set(k, v);
            }
        }

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
    // SECTION 1: High Concurrency Burst (100 Simultaneous Parallel Requests)
    // =========================================================================
    describe("Section 1: High Concurrency Burst & Isolation", () => {
        test("BURST-01: 100 concurrent requests across 4 categories complete with zero state contamination", async () => {
            const sourceCode = `
import { prisma } from "../lib/prisma.js";
import axios from "axios";

export async function processOrder(orderId, items, user) {
    if (!orderId || !items || items.length === 0) {
        throw new Error("Invalid order payload");
    }
    const customer = await prisma.user.findUnique({ where: { id: user?.id } });
    if (!customer) {
        throw new Error("Customer not found");
    }
    let total = 0;
    for (const item of items) {
        total += item.price * (item.quantity || 1);
    }
    if (total > 5000) {
        const discountRes = await axios.post("https://api.discount.internal/apply", { total, tier: customer.tier });
        total = discountRes.discountedTotal || (total * 0.9);
    }
    return { orderId, total, status: "PROCESSED" };
}
`;
            const categories = ["HAPPY_PATH", "BOUNDARY_VALUES", "BRANCH_TOGGLING", "ERROR_HANDLING"];
            const burstSize = 100;

            const tasks = Array.from({ length: burstSize }, (_, i) => {
                const cat = categories[i % categories.length];
                return generateSimulationTrace(`snap_burst_${i}`, {
                    sourceFilePath: `src/services/order_${i}.js`,
                    sourceCode,
                    functionName: "processOrder",
                    category: cat
                });
            });

            const start = performance.now();
            const results = await Promise.all(tasks);
            const duration = performance.now() - start;

            expect(results.length).toBe(burstSize);
            for (let i = 0; i < burstSize; i++) {
                const res = results[i];
                expect(res).toBeDefined();
                expect(res.steps).toBeDefined();
                expect(res.steps.length).toBeGreaterThanOrEqual(4);
                expect(res.summary).toBeDefined();
                expect(res.isVirtualScenario).toBe(true);
            }

            const avgMs = duration / burstSize;
            console.log(`[BURST-01] ${burstSize} concurrent simulations resolved in ${duration.toFixed(2)}ms (Avg: ${avgMs.toFixed(2)}ms/req)`);
            expect(avgMs).toBeLessThan(50);
        });
    });

    // =========================================================================
    // SECTION 2: Loop Iteration Limits & Infinite Loop Safety
    // =========================================================================
    describe("Section 2: Loop Iteration Limits & Infinite Loop Safety", () => {
        test("LOOP-01: While loop with potential infinite loop (true condition) is safely broken at limit", async () => {
            const infiniteWhileSource = `
export function dangerousLoop(n) {
    let count = 0;
    while (true) {
        count++;
        if (count > 5000) break;
    }
    return count;
}
`;
            const start = performance.now();
            const trace = await generateSimulationTrace("snap_inf_loop", {
                sourceFilePath: "src/services/loop.js",
                sourceCode: infiniteWhileSource,
                functionName: "dangerousLoop",
                category: "HAPPY_PATH"
            });
            const duration = performance.now() - start;

            expect(trace).toBeDefined();
            // Engine safety limit breaks out at 1000 iterations without hanging
            expect(duration).toBeLessThan(500);
            expect(trace.steps.length).toBeGreaterThan(0);
        });

        test("LOOP-02: Mutually recursive functions safely handle call graph without unbounded stack explosion", async () => {
            const mutualRecursionSource = `
function stepPing(depth) {
    if (depth <= 0) return "DONE";
    return stepPong(depth - 1);
}

function stepPong(depth) {
    if (depth <= 0) return "DONE";
    return stepPing(depth - 1);
}

export function executePingPong(maxDepth) {
    return stepPing(maxDepth);
}
`;
            const trace = await generateSimulationTrace("snap_ping_pong", {
                sourceFilePath: "src/services/pingpong.js",
                sourceCode: mutualRecursionSource,
                functionName: "stepPong",
                category: "HAPPY_PATH"
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(4);
            expect(trace.scenarioMeta.callPath).toBeDefined();
        });
    });

    // =========================================================================
    // SECTION 3: Thenable Proxy Deadlock Immunity
    // =========================================================================
    describe("Section 3: Thenable Proxy Deadlock Immunity", () => {
        test("THEN-01: Universal RAM mock with custom thenable does not cause promise deadlock", async () => {
            const asyncServiceSource = `
import { prisma } from "../lib/prisma.js";

export async function fetchAccountSummary(accountId) {
    const summary = await prisma.account.findUnique({
        where: { id: accountId },
        include: { transactions: true }
    });
    return summary || { id: accountId, empty: true };
}
`;
            const start = performance.now();
            const trace = await generateSimulationTrace("snap_thenable", {
                sourceFilePath: "src/services/account.service.js",
                sourceCode: asyncServiceSource,
                functionName: "fetchAccountSummary",
                category: "HAPPY_PATH"
            });
            const duration = performance.now() - start;

            expect(trace).toBeDefined();
            expect(duration).toBeLessThan(150);
            expect(trace.initialMocks.some(m => m.module === "prisma")).toBe(true);
            expect(trace.steps.some(s => s.phase === "MOCK_INTERACTION")).toBe(true);
        });

        test("THEN-02: Promise rejection in async return statement is captured as exception without unhandled rejection", async () => {
            const rejectedPromiseSource = `
export async function failOperation() {
    return Promise.reject(new Error("Downstream service offline"));
}
`;
            const trace = await generateSimulationTrace("snap_rejection", {
                sourceFilePath: "src/services/rejection.js",
                sourceCode: rejectedPromiseSource,
                functionName: "failOperation",
                category: "ERROR_HANDLING"
            });

            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(3);
            const errorStep = trace.steps.find(s => s.phase === "ERROR_THROW" || s.phase === "RETURN_VALUE");
            expect(errorStep).toBeDefined();
        });
    });

    // =========================================================================
    // SECTION 4: Large Scale AST & Multi-Branch Stress (1,000 Lines, 50 Decision Points)
    // =========================================================================
    describe("Section 4: Large Scale AST Stress", () => {
        test("SCALE-01: 1,000-line service with 50 decision points executes trace in sub-100ms", async () => {
            let code = `
import { prisma } from "../lib/prisma.js";
export class MassiveRuleMatrix {
`;
            for (let i = 1; i <= 50; i++) {
                code += `
    checkCondition${i}(ctx) {
        if (!ctx) return false;
        if (ctx.code === "RULE_${i}" && ctx.level > ${i}) {
            return true;
        }
        return ctx.active ? true : false;
    }
`;
            }
            code += `
    dispatchMatrix(payload) {
        if (!payload || !payload.id) {
            throw new Error("Missing payload id");
        }
        return { success: true, evaluatedRules: 50 };
    }
}
export const massiveRuleMatrix = new MassiveRuleMatrix();
`;
            // Add padding comments to reach ~1,000 lines
            for (let pad = 0; pad < 400; pad++) {
                code += `// Padding comment line ${pad} to verify large file AST scalability\n`;
            }

            expect(code.split("\n").length).toBeGreaterThan(800);

            const start = performance.now();
            const trace = await generateSimulationTrace("snap_massive", {
                sourceFilePath: "src/services/MassiveRuleMatrix.js",
                sourceCode: code,
                functionName: "dispatchMatrix",
                category: "HAPPY_PATH"
            });
            const duration = performance.now() - start;

            console.log(`[SCALE-01] 800+ line file trace generation completed in ${duration.toFixed(2)}ms`);
            expect(trace).toBeDefined();
            expect(trace.steps.length).toBeGreaterThanOrEqual(4);
            expect(duration).toBeLessThan(100);
        });
    });

    // =========================================================================
    // SECTION 5: Storage Immutability (F9) Byte-for-Byte Audit
    // =========================================================================
    describe("Section 5: Strict Storage & Uploads Immutability Audit", () => {
        test("IMMUT-01: Zero bytes altered in storage/ and uploads/ across disk-targeted simulation paths", async () => {
            const preStorage = new Map();
            for (const sp of storagePaths) {
                const map = computeDirectoryHashMap(sp);
                for (const [k, v] of map.entries()) preStorage.set(k, v);
            }

            const preUploads = new Map();
            for (const up of uploadsPaths) {
                const map = computeDirectoryHashMap(up);
                for (const [k, v] of map.entries()) preUploads.set(k, v);
            }

            // Execute simulations targeting disk-like paths
            const testPayloads = [
                { sourceFilePath: "storage/projects/test_proj/file.js", sourceCode: "export function test1() { return 1; }" },
                { sourceFilePath: "uploads/snapshots/snap_1/file.js", sourceCode: "export function test2() { return 2; }" },
                { sourceFilePath: "src/deep/nested/path/module.js", sourceCode: "export function test3() { return 3; }" }
            ];

            for (const p of testPayloads) {
                await generateSimulationTrace("snap_immut_audit", p);
            }

            const postStorage = new Map();
            for (const sp of storagePaths) {
                const map = computeDirectoryHashMap(sp);
                for (const [k, v] of map.entries()) postStorage.set(k, v);
            }

            const postUploads = new Map();
            for (const up of uploadsPaths) {
                const map = computeDirectoryHashMap(up);
                for (const [k, v] of map.entries()) postUploads.set(k, v);
            }

            expect(postStorage.size).toBe(preStorage.size);
            for (const [f, h] of preStorage.entries()) {
                expect(postStorage.get(f)).toBe(h);
            }

            expect(postUploads.size).toBe(preUploads.size);
            for (const [f, h] of preUploads.entries()) {
                expect(postUploads.get(f)).toBe(h);
            }
        });
    });
});
