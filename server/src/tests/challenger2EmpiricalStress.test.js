import { describe, it, expect } from "@jest/globals";
import vm from "node:vm";
import { execSync } from "node:child_process";
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
import { buildStandardUnitTestPrompt } from "../services/unitTestGenerator.service.js";

describe("Milestone 4 Empirical Challenge Suite: Adaptive Generation, BFS Call Graph Backtracking, RAM Mock Hermeticity", () => {

    // =========================================================================
    // SECTION 1: ADAPTIVE NON-REPEATING GENERATION CYCLES & DELTA TABLE SHRINKAGE
    // =========================================================================
    describe("1. Adaptive Non-Repeating Generation Cycles & Delta Table Progressive Shrinkage", () => {
        const sampleEsmBusinessSource = `
function sanitizeInput(data) {
    if (!data) {
        throw new Error('Missing data');
    }
    return String(data).trim();
}

export function computeOrderTotal(order) {
    if (!order || typeof order !== 'object') {
        throw new Error('Order must be an object');
    }
    const items = order.items || [];
    if (items.length === 0) {
        return 0;
    }
    let total = 0;
    for (const item of items) {
        const price = item.price ?? 0;
        const qty = item.quantity || 1;
        if (price < 0 || qty < 0) {
            throw new Error('Negative values not allowed');
        }
        total += price * qty;
    }
    const isVip = order.user?.isVip ? true : false;
    const discount = isVip ? 0.2 : 0.05;
    const sanitizedNote = sanitizeInput(order.note || 'None');
    
    // Infeasible environment guard
    if (process.env.NODE_ENV === 'production') {
        total = total * 1.1; // Tax calculation in production only
    }
    
    return total * (1 - discount);
}
`;

        const sampleCjsBusinessSource = `
function sanitizeInput(data) {
    if (!data) {
        throw new Error('Missing data');
    }
    return String(data).trim();
}

function computeOrderTotal(order) {
    if (!order || typeof order !== 'object') {
        throw new Error('Order must be an object');
    }
    return order.amount || 0;
}

module.exports = {
    computeOrderTotal
};
`;

        const astMetadata = analyzeSourceAst(sampleEsmBusinessSource);
        const initialCoverageGaps = mapCoverageGaps({
            astMetadata,
            fileCoverageData: null,
            sourceCode: sampleEsmBusinessSource,
            uncoveredLinesList: [12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 29, 32]
        });

        it("Cycle 0: generates exhaustive Decision Table and unpruned Delta when no tests exist on disk", () => {
            const result = buildDecisionTableMatrix({
                astMetadata,
                coverageGaps: initialCoverageGaps,
                sourceCode: sampleEsmBusinessSource,
                existingTestCode: ""
            });

            expect(result.summary.totalTestCases).toBeGreaterThan(0);
            expect(result.summary.alreadyTestedCount).toBe(0);
            expect(result.summary.deltaCount).toBeGreaterThan(0);

            // Infeasible environment guard at line 28 must be excluded from delta
            expect(result.summary.infeasibleCount).toBeGreaterThan(0);
            expect(result.infeasibleSummaries.length).toBeGreaterThan(0);
            expect(result.infeasibleSummaries.some(s => s.condition.includes("process.env.NODE_ENV"))).toBe(true);

            // Verify all 4 categories are represented in the Delta Decision Table
            const deltaCategories = result.deltaDecisionTable.map(d => d.category);
            expect(deltaCategories).toContain("HAPPY_PATH");
            expect(deltaCategories).toContain("BOUNDARY_VALUES");
            expect(deltaCategories).toContain("BRANCH_TOGGLING");
            expect(deltaCategories).toContain("ERROR_HANDLING");
        });

        it("Cycle 1: subtracting Category A (Happy Path) tests shrinks the Delta Table", () => {
            const existingHappyTest = `
import { computeOrderTotal } from './orderService';

describe('Order Service', () => {
    it('should compute valid order total [Category A: Happy Path]', () => {
        const order = { items: [{ price: 100, quantity: 2 }], user: { isVip: true } };
        const total = computeOrderTotal(order);
        expect(total).toBe(160);
    });
});
`;
            const cycle1 = buildDecisionTableMatrix({
                astMetadata,
                coverageGaps: initialCoverageGaps,
                sourceCode: sampleEsmBusinessSource,
                existingTestCode: existingHappyTest
            });

            const happyEntry = cycle1.decisionTable.find(e => e.category === "HAPPY_PATH");
            expect(happyEntry.isAlreadyTested).toBe(true);
            expect(happyEntry.priority).toBe("LOW");

            // Happy path must NOT be in deltaDecisionTable
            expect(cycle1.deltaDecisionTable.some(d => d.id === happyEntry.id)).toBe(false);
            expect(cycle1.summary.alreadyTestedCount).toBeGreaterThanOrEqual(1);
        });

        it("Cycle 2: subtracting Boundary Values (Category B) and Error Handling (Category D) tests shrinks delta further", () => {
            const existingHappyAndBoundaryAndError = `
import { computeOrderTotal } from './orderService';

describe('Order Service', () => {
    it('should compute valid order total [Category A]', () => {
        const order = { items: [{ price: 100, quantity: 2 }] };
        expect(computeOrderTotal(order)).toBeGreaterThan(0);
    });

    it('handles numeric 0 and negative values [Category B]', () => {
        expect(() => computeOrderTotal({ items: [{ price: -1, quantity: 0 }] })).toThrow();
    });

    it('handles empty collection [] and empty string [Category B]', () => {
        expect(computeOrderTotal({ items: [] })).toBe(0);
    });

    it('throws error on missing order [Category D]', () => {
        expect(() => computeOrderTotal(null)).toThrow('Order must be an object');
    });

    it('throws error on negative values [Category D]', () => {
        expect(() => computeOrderTotal({ items: [{ price: -5, quantity: 1 }] })).toThrow();
    });
});
`;
            const cycle2 = buildDecisionTableMatrix({
                astMetadata,
                coverageGaps: initialCoverageGaps,
                sourceCode: sampleEsmBusinessSource,
                existingTestCode: existingHappyAndBoundaryAndError
            });

            expect(cycle2.summary.alreadyTestedCount).toBeGreaterThanOrEqual(3);
            // Boundary values and happy path are tested and filtered out of delta
            expect(cycle2.deltaDecisionTable.filter(d => d.category === "BOUNDARY_VALUES").length).toBe(0);
            expect(cycle2.deltaDecisionTable.filter(d => d.category === "HAPPY_PATH").length).toBe(0);
        });

        it("Cycle 3: full coverage achieved — delta table empties and outputs completion message", () => {
            const fullyCoveredTestSuite = `
import { computeOrderTotal } from './orderService';

describe('Order Service Exhaustive Suite', () => {
    it('valid order total [Category A] [tc-happy]', () => {
        expect(computeOrderTotal({ items: [{ price: 50, quantity: 2 }] })).toBeDefined();
    });

    it('handles 0, -1 boundary numbers [Category B] [tc-bound]', () => {
        expect(() => computeOrderTotal({ items: [{ price: 0, quantity: -1 }] })).toThrow();
    });

    it('handles empty [] collection [Category B] [tc-bound]', () => {
        expect(computeOrderTotal({ items: [] })).toBe(0);
    });

    it('[TRUE] condition isVip true branch [Category C] [tc-branch]', () => {
        expect(computeOrderTotal({ items: [{ price: 10, quantity: 1 }], user: { isVip: true } })).toBeDefined();
    });

    it('[FALSE] condition isVip false branch [Category C] [tc-branch]', () => {
        expect(computeOrderTotal({ items: [{ price: 10, quantity: 1 }], user: { isVip: false } })).toBeDefined();
    });

    it('fallback condition handles nullish optional [Category C] [tc-branch]', () => {
        expect(computeOrderTotal({ items: [{ price: null }] })).toBeDefined();
    });

    it('throws error when order is null [Category D] [tc-err]', () => {
        expect(() => computeOrderTotal(null)).toThrow();
    });

    it('throws error when items has negative value [Category D] [tc-err]', () => {
        expect(() => computeOrderTotal({ items: [{ price: -1 }] })).toThrow();
    });
});
`;
            const simulatedCoveredGaps = {
                ...initialCoverageGaps,
                uncoveredLines: [29, 30], // Only production environment guard is uncovered
                uncoveredBranches: initialCoverageGaps.uncoveredBranches.map(b => ({
                    ...b,
                    missedTrue: false,
                    missedFalse: false
                }))
            };

            const cycle3 = buildDecisionTableMatrix({
                astMetadata,
                coverageGaps: simulatedCoveredGaps,
                sourceCode: sampleEsmBusinessSource,
                existingTestCode: fullyCoveredTestSuite
            });

            expect(cycle3.deltaDecisionTable.length).toBe(0);
            expect(cycle3.deltaDecisionTableMarkdown).toBe("All feasible test scenarios are covered or already tested.");
            // Infeasible production check remains documented
            expect(cycle3.infeasibleSummaries.length).toBeGreaterThan(0);
        });

        it("Empirical Challenge: CommonJS module.exports object shorthand classification analysis", () => {
            const cjsAst = analyzeSourceAst(sampleCjsBusinessSource);
            const exportedSymbols = cjsAst.exportedSymbols;
            expect(exportedSymbols.length).toBe(1);
            expect(exportedSymbols[0].name).toBe("computeOrderTotal");

            // Document empirical behavior: CommonJS object shorthand exports are tagged with their AST property type
            const exportedType = exportedSymbols[0].type;
            // Record whether it was classified as 'constant' or 'function'
            expect(["constant", "function"]).toContain(exportedType);
        });

        it("Edge case: skipped tests (it.skip, test.skip, xit) are NOT counted as active/already tested", () => {
            const skippedTestSuite = `
describe('Skipped Tests', () => {
    it.skip('should compute valid order [Category A]', () => {
        expect(computeOrderTotal({ items: [{ price: 100 }] })).toBe(95);
    });
    xit('should handle boundary 0 [Category B]', () => {
        expect(computeOrderTotal({ items: [] })).toBe(0);
    });
    test.skip('should handle errors [Category D]', () => {
        expect(() => computeOrderTotal(null)).toThrow();
    });
});
`;
            const parsed = parseExistingTestAst(skippedTestSuite);
            expect(parsed.totalTests).toBe(3);
            expect(parsed.skippedTests).toBe(3);
            // Covered categories must remain 0 for skipped tests
            expect(parsed.coveredCategories.HAPPY_PATH).toBe(0);
            expect(parsed.coveredCategories.BOUNDARY_VALUES).toBe(0);
            expect(parsed.coveredCategories.ERROR_HANDLING).toBe(0);

            // Decision table must NOT mark them as already tested
            const res = buildDecisionTableMatrix({
                astMetadata,
                coverageGaps: initialCoverageGaps,
                sourceCode: sampleEsmBusinessSource,
                existingTestCode: skippedTestSuite
            });
            expect(res.decisionTable.find(e => e.category === "HAPPY_PATH").isAlreadyTested).toBe(false);
        });

        it("Edge case: malformed or corrupted test code falls back safely without throwing", () => {
            const corruptedCode = "describe('Corrupted', () => { it('broken test' unclosed quotes &&& syntax error %%%";
            expect(() => {
                const parsed = parseExistingTestAst(corruptedCode);
                expect(parsed.tests).toBeDefined();
            }).not.toThrow();

            expect(() => {
                const matrix = buildDecisionTableMatrix({
                    astMetadata,
                    coverageGaps: initialCoverageGaps,
                    sourceCode: sampleEsmBusinessSource,
                    existingTestCode: corruptedCode
                });
                expect(matrix.deltaDecisionTable).toBeDefined();
            }).not.toThrow();
        });
    });

    // =========================================================================
    // SECTION 2: AST CALL GRAPH BFS BACKTRACKING (MUTUAL RECURSION, DIAMONDS)
    // =========================================================================
    describe("2. AST Call Graph BFS Backtracking Under Hostile Topologies", () => {

        it("Resolves multi-level deep linear call chain (5 levels deep)", () => {
            const multiLevelSource = `
function leafHelper(v) { return v * 2; }
function level4(v) { return leafHelper(v); }
function level3(v) { return level4(v); }
function level2(v) { return level3(v); }
function level1(v) { return level2(v); }
export function publicApiEndpoint(v) {
    return level1(v);
}
`;
            const ast = analyzeSourceAst(multiLevelSource);
            const strategy = buildIndirectTestingStrategy({
                astMetadata: ast,
                sourceCode: multiLevelSource
            });

            const leafStrategy = strategy.indirectStrategies.find(s => s.helperName === "leafHelper");
            expect(leafStrategy).toBeDefined();
            expect(leafStrategy.exportedCallers).toContain("publicApiEndpoint");
            expect(leafStrategy.callChains).toBeDefined();
            expect(leafStrategy.callChains.some(c => c.includes("publicApiEndpoint") && c.includes("leafHelper"))).toBe(true);
            expect(leafStrategy.guidance).toContain('Helper function "leafHelper"');
            expect(strategy.indirectGuidancePrompt).toContain('NEVER write `import { leafHelper }`');
        });

        it("Terminates without infinite loop on mutual recursion: helperA <-> helperB", () => {
            const mutualRecursionSource = `
function helperA(n) {
    if (n <= 0) return 0;
    return helperB(n - 1);
}
function helperB(n) {
    if (n <= 0) return 0;
    return helperA(n - 1);
}
export function startMutual(n) {
    return helperA(n);
}
`;
            const ast = analyzeSourceAst(mutualRecursionSource);

            // Execute under time constraint to guarantee no infinite loop
            const startTime = Date.now();
            const strategy = buildIndirectTestingStrategy({
                astMetadata: ast,
                sourceCode: mutualRecursionSource
            });
            const elapsed = Date.now() - startTime;
            expect(elapsed).toBeLessThan(1000); // Must resolve in milliseconds

            const aStrategy = strategy.indirectStrategies.find(s => s.helperName === "helperA");
            const bStrategy = strategy.indirectStrategies.find(s => s.helperName === "helperB");

            expect(aStrategy.exportedCallers).toContain("startMutual");
            expect(bStrategy.exportedCallers).toContain("startMutual");
            expect(strategy.indirectGuidancePrompt).toContain('NEVER write `import { helperA }`');
            expect(strategy.indirectGuidancePrompt).toContain('NEVER write `import { helperB }`');
        });

        it("Terminates cleanly on 3-way cyclic recursion: helperA -> helperB -> helperC -> helperA", () => {
            const threeWayCycleSource = `
function helperC(x) { return helperA(x - 1); }
function helperB(x) { return helperC(x); }
function helperA(x) {
    if (x <= 0) return 1;
    return helperB(x);
}
export function runCycle(x) {
    return helperA(x);
}
`;
            const ast = analyzeSourceAst(threeWayCycleSource);
            const strategy = buildIndirectTestingStrategy({
                astMetadata: ast,
                sourceCode: threeWayCycleSource
            });

            expect(strategy.indirectStrategies.length).toBe(3);
            for (const s of strategy.indirectStrategies) {
                expect(s.exportedCallers).toContain("runCycle");
            }
        });

        it("Handles direct self-recursion: helperRecursive -> helperRecursive", () => {
            const selfRecursionSource = `
function computeFactorial(n) {
    if (n <= 1) return 1;
    return n * computeFactorial(n - 1);
}
export function calculate(n) {
    return computeFactorial(n);
}
`;
            const ast = analyzeSourceAst(selfRecursionSource);
            const strategy = buildIndirectTestingStrategy({
                astMetadata: ast,
                sourceCode: selfRecursionSource
            });

            const factStrategy = strategy.indirectStrategies.find(s => s.helperName === "computeFactorial");
            expect(factStrategy.exportedCallers).toContain("calculate");
            expect(factStrategy.callChains[0]).toBe("calculate -> computeFactorial");
        });

        it("Handles diamond graph convergence: exported -> (left, right) -> sinkHelper", () => {
            const diamondSource = `
function sinkHelper(data) {
    return data.trim();
}
function workerLeft(data) {
    return sinkHelper(data);
}
function workerRight(data) {
    return sinkHelper(data);
}
export function executeDiamondWorkflow(data, flag) {
    if (flag) {
        return workerLeft(data);
    } else {
        return workerRight(data);
    }
}
`;
            const ast = analyzeSourceAst(diamondSource);
            const strategy = buildIndirectTestingStrategy({
                astMetadata: ast,
                sourceCode: diamondSource
            });

            const sinkStrategy = strategy.indirectStrategies.find(s => s.helperName === "sinkHelper");
            expect(sinkStrategy).toBeDefined();
            expect(sinkStrategy.exportedCallers).toContain("executeDiamondWorkflow");
            expect(sinkStrategy.callChains.length).toBeGreaterThanOrEqual(1);
        });

        it("Handles multi-parent diamond graph: two distinct exports calling deep helper", () => {
            const multiParentSource = `
function deepSink(x) {
    return x * 10;
}
function branchA(x) { return deepSink(x); }
function branchB(x) { return deepSink(x); }
export function exportOne(x) { return branchA(x); }
export function exportTwo(x) { return branchB(x); }
`;
            const ast = analyzeSourceAst(multiParentSource);
            const strategy = buildIndirectTestingStrategy({
                astMetadata: ast,
                sourceCode: multiParentSource
            });

            const sinkStrategy = strategy.indirectStrategies.find(s => s.helperName === "deepSink");
            expect(sinkStrategy).toBeDefined();
            expect(sinkStrategy.exportedCallers).toContain("exportOne");
            expect(sinkStrategy.exportedCallers).toContain("exportTwo");
        });

        it("Handles disconnected / orphan internal helpers gracefully without crashing", () => {
            const orphanSource = `
function orphanFunction(x) {
    return x + 1; // Never called by any exported symbol
}
export function standaloneExport(x) {
    return x * 2;
}
`;
            const ast = analyzeSourceAst(orphanSource);
            const strategy = buildIndirectTestingStrategy({
                astMetadata: ast,
                sourceCode: orphanSource
            });

            const orphanStrategy = strategy.indirectStrategies.find(s => s.helperName === "orphanFunction");
            expect(orphanStrategy).toBeDefined();
            // Falls back to available exported symbols
            expect(orphanStrategy.exportedCallers).toContain("standaloneExport");
            expect(orphanStrategy.guidance).toContain('Helper function "orphanFunction"');
        });

        it("Supports both parameter calling styles: object signature vs positional arguments", () => {
            const testSource = `
function privateWorker() { return 42; }
export function publicCaller() { return privateWorker(); }
`;
            const ast = analyzeSourceAst(testSource);

            // Object signature
            const res1 = buildIndirectTestingStrategy({
                astMetadata: ast,
                sourceCode: testSource
            });
            expect(res1.indirectStrategies[0].exportedCallers).toContain("publicCaller");

            // Positional signature: (unexportedHelpers, astMetadata, sourceCode)
            const res2 = buildIndirectTestingStrategy(
                [{ name: "privateWorker", line: 2 }],
                ast,
                testSource
            );
            expect(res2.indirectStrategies[0].exportedCallers).toContain("publicCaller");
        });
    });

    // =========================================================================
    // SECTION 3: UNIVERSAL HERMETIC RAM MOCKS (PURE IN-MEMORY EXECUTION)
    // =========================================================================
    describe("3. Universal Hermetic RAM Mock Contracts Real-Time Execution", () => {

        it("Redis / ioredis Mock: executes get, set, del, keys, flushall, quit purely in RAM", async () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "const redis = require('redis'); const Redis = require('ioredis');",
                framework: "jest"
            });

            expect(contracts.detectedDependencies).toContain("redis-cache");
            expect(contracts.mockPreambleCode).toContain("Universal In-Memory Redis / ioredis Mock Client");

            // Execute the generated mock code in an isolated Node VM context
            const vmContext = {
                jest: {
                    fn: (impl) => {
                        const fn = (...args) => (impl ? impl(...args) : undefined);
                        return fn;
                    },
                    mock: () => {}
                },
                globalThis: {}
            };
            vm.createContext(vmContext);

            // Run mock code in VM
            vm.runInContext(contracts.mockPreambleCode, vmContext);

            const client = vmContext.mockRedisClient;
            expect(client).toBeDefined();
            expect(typeof client.get).toBe("function");

            // Test RAM operations
            expect(await client.set("token:123", "abc")).toBe("OK");
            expect(await client.get("token:123")).toBe("abc");
            expect(await client.exists("token:123")).toBe(1);
            expect(await client.keys()).toContain("token:123");

            // Delete
            expect(await client.del("token:123")).toBe(1);
            expect(await client.get("token:123")).toBeNull();
            expect(await client.exists("token:123")).toBe(0);

            // Flushall & Quit
            await client.set("k1", "v1");
            expect(await client.flushall()).toBe("OK");
            expect((await client.keys()).length).toBe(0);
            expect(await client.quit()).toBe("OK");
        });

        it("Mongoose Mock: chains query methods (find, where, sort, lean, exec) purely in RAM", async () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "const mongoose = require('mongoose'); const User = mongoose.model('User', schema);",
                framework: "jest"
            });

            expect(contracts.detectedDependencies).toContain("mongoose-db");

            let registeredFactory = null;
            const vmContext = {
                jest: {
                    fn: (impl) => {
                        let returnThis = false;
                        const f = function(...args) {
                            if (returnThis) return this;
                            return impl ? impl.apply(this, args) : undefined;
                        };
                        f.mockReturnThis = () => { returnThis = true; return f; };
                        return f;
                    },
                    mock: (modName, factory) => {
                        if (modName === "mongoose") registeredFactory = factory;
                    }
                },
                globalThis: {}
            };
            vm.createContext(vmContext);
            vm.runInContext(contracts.mockPreambleCode, vmContext);

            expect(registeredFactory).toBeDefined();
            const mockMongoose = registeredFactory();
            expect(mockMongoose.model).toBeDefined();

            const modelProxy = mockMongoose.model("User");
            expect(modelProxy).toBeDefined();

            // Test chainability with lean(): find().where().sort().limit().skip().lean()
            const leanResult = await modelProxy.find({ status: "ACTIVE" })
                .where("role")
                .sort({ createdAt: -1 })
                .limit(10)
                .skip(0)
                .lean();
            expect(Array.isArray(leanResult)).toBe(true);
            expect(leanResult[0]._id).toBe("1");

            // Test chainability with exec(): find().where().sort().exec()
            const execDoc = await modelProxy.find({ status: "ACTIVE" })
                .where("role")
                .sort({ createdAt: -1 })
                .exec();
            expect(execDoc).toBeDefined();
            expect(execDoc._id).toBeDefined();

            // Test findById and doc.save()
            const doc = await modelProxy.findById("507f1f77bcf86cd799439011").exec();
            expect(doc).toBeDefined();
            expect(doc._id).toBeDefined();
            expect(await doc.save()).toBeDefined();

            // Test mutations
            const created = await modelProxy.create({ name: "Alice", email: "alice@test.com" });
            expect(created._id).toBe("1");
            expect(created.name).toBe("Alice");

            const deleted = await modelProxy.deleteOne({ _id: "1" });
            expect(deleted.deletedCount).toBe(1);
        });

        it("Sequelize Mock: resolves model queries (findAll, findByPk, create, update, destroy) in RAM", async () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "const { Sequelize } = require('sequelize'); sequelize.define('User', {});",
                framework: "jest"
            });

            expect(contracts.detectedDependencies).toContain("sequelize-db");

            let registeredFactory = null;
            const vmContext = {
                jest: {
                    fn: (impl) => {
                        const f = (...args) => (impl ? impl(...args) : undefined);
                        return f;
                    },
                    mock: (modName, factory) => {
                        if (modName === "sequelize") registeredFactory = factory;
                    }
                },
                globalThis: {}
            };
            vm.createContext(vmContext);
            vm.runInContext(contracts.mockPreambleCode, vmContext);

            expect(registeredFactory).toBeDefined();
            const mockSequelizeModule = registeredFactory();
            const seqInstance = mockSequelizeModule.Sequelize();
            const modelProxy = seqInstance.define("User");
            expect(modelProxy).toBeDefined();

            const all = await modelProxy.findAll();
            expect(Array.isArray(all)).toBe(true);
            expect(all[0].id).toBe(1);

            const single = await modelProxy.findByPk(42);
            expect(single.id).toBe(1);

            const created = await modelProxy.create({ title: "Task" });
            expect(created.id).toBe(1);
            expect(created.title).toBe("Task");

            const updated = await modelProxy.update({ title: "Updated" });
            expect(updated).toEqual([1]);

            const destroyed = await modelProxy.destroy();
            expect(destroyed).toBe(1);
        });

        it("Prisma Mock: resolves arbitrary model accesses and transactions hermetically in RAM", async () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();",
                framework: "jest"
            });

            expect(contracts.detectedDependencies).toContain("prisma-db");

            const vmContext = {
                jest: {
                    fn: (impl) => {
                        const f = (...args) => (impl ? impl(...args) : undefined);
                        return f;
                    },
                    mock: () => {}
                },
                globalThis: {}
            };
            vm.createContext(vmContext);
            vm.runInContext(contracts.mockPreambleCode, vmContext);

            const prisma = vmContext.mockPrisma;
            expect(prisma).toBeDefined();

            // Test arbitrary model property access (Proxy behavior)
            const item = await prisma.unknownModelXYZ.findUnique({ where: { id: 1 } });
            expect(item).toBeDefined();
            expect(item.id).toBe(1);

            const list = await prisma.arbitraryCollection.findMany();
            expect(Array.isArray(list)).toBe(true);

            // Test $transaction with array of promises
            const txArrayResult = await prisma.$transaction([
                prisma.user.findMany(),
                prisma.order.count()
            ]);
            expect(Array.isArray(txArrayResult)).toBe(true);
            expect(txArrayResult[0]).toBeDefined();
            expect(txArrayResult[1]).toBe(1);

            // Test $transaction with interactive callback
            const txCallbackResult = await prisma.$transaction(async (tx) => {
                const count = await tx.item.count();
                return { count };
            });
            expect(txCallbackResult).toEqual({ count: 1 });
        });

        it("Axios Mock: responds to create, get, post, put, delete without outbound HTTP connections", async () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "const axios = require('axios'); async function fetchData() { return axios.get('/api'); }",
                framework: "jest"
            });

            expect(contracts.detectedDependencies).toContain("axios-http");

            let registeredFactory = null;
            const vmContext = {
                jest: {
                    fn: (impl) => {
                        const f = (...args) => (impl ? impl(...args) : undefined);
                        return f;
                    },
                    mock: (modName, factory) => {
                        if (modName === "axios") registeredFactory = factory;
                    }
                },
                globalThis: {}
            };
            vm.createContext(vmContext);
            vm.runInContext(contracts.mockPreambleCode, vmContext);

            expect(registeredFactory).toBeDefined();
            const mockAxios = registeredFactory();
            expect(mockAxios).toBeDefined();

            const postRes = await mockAxios.post("http://any-external-endpoint.com", { a: 1 });
            expect(postRes.status).toBe(200);
            expect(postRes.data.success).toBe(true);

            const getRes = await mockAxios.get("http://any-external-endpoint.com");
            expect(getRes.status).toBe(200);

            const customClient = mockAxios.create();
            const clientPostRes = await customClient.post("http://any-external-endpoint.com");
            expect(clientPostRes.status).toBe(200);
        });

        it("Downstream Local Services Mock: handles property access and reject mode toggle", async () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "const userService = require('../services/userService'); const orderModel = require('./models/order');",
                framework: "jest"
            });

            expect(contracts.detectedDependencies).toContain("downstream-local-services");

            const vmContext = {
                jest: {
                    fn: (impl) => {
                        const f = (...args) => (impl ? impl(...args) : undefined);
                        return f;
                    },
                    mock: () => {}
                },
                globalThis: {}
            };
            vm.createContext(vmContext);
            vm.runInContext(contracts.mockPreambleCode, vmContext);

            const stub = vmContext._createStubMaker();
            // Normal mode
            const res = await stub.anyDirectMethod();
            expect(res.id).toBe(1);
            expect(res.status).toBe("ACTIVE");

            // Reject mode toggle
            vmContext.setStubRejectMode(true);
            await expect(stub.anyDirectMethod()).rejects.toThrow("Mocked downstream failure");

            // Reset back
            vmContext.setStubRejectMode(false);
            const res2 = await stub.anotherMethod();
            expect(res2.id).toBe(1);
        });

        it("Vitest vs Jest Framework Flag generates appropriate syntax", () => {
            const jestContracts = buildIsolationMockContracts({
                sourceCode: "const redis = require('redis'); const axios = require('axios');",
                framework: "jest"
            });
            expect(jestContracts.mockPreambleCode).toContain("jest.mock('redis'");
            expect(jestContracts.mockPreambleCode).toContain("jest.fn");
            expect(jestContracts.mockPreambleCode).not.toContain("vi.mock('redis'");

            const vitestContracts = buildIsolationMockContracts({
                sourceCode: "const redis = require('redis'); const axios = require('axios');",
                framework: "vitest"
            });
            expect(vitestContracts.mockPreambleCode).toContain("vi.mock('redis'");
            expect(vitestContracts.mockPreambleCode).toContain("vi.fn");
            expect(vitestContracts.mockPreambleCode).not.toContain("jest.mock('redis'");
        });
    });

    // =========================================================================
    // SECTION 4: PROMPT TEMPLATE PURITY & ANTI-FAKE INVARIANT
    // =========================================================================
    describe("4. Prompt Template Purity & Anti-Fake Invariant", () => {
        it("Guarantees accidental JavaScript snippets are completely absent from prompt", () => {
            const prompt = buildStandardUnitTestPrompt({
                framework: "jest",
                cleanSource: "src/sample.js",
                testFileInfo: { found: true, relativePath: "src/sample.test.js", content: "" },
                cleanImportPath: "./sample.js",
                coverageDetails: { summary: { linesPct: 80, branchesPct: 70, funcsPct: 100, stmtsPct: 80 } },
                sourceCode: "function foo() {}",
                unitTestContext: {
                    astMetadata: { exportedSymbolNames: ["foo"], decisionPoints: [] },
                    decisionTable: { summary: { cyclomaticComplexity: 1 }, deltaDecisionTableMarkdown: "delta" }
                }
            });

            // The corrupted snippet previously present in prompt templates:
            expect(prompt).not.toContain("if (typeof deduplicateAstDeclarations === 'function')");
            expect(prompt).not.toContain("function deduplicateAstDeclarations");

            // Must enforce strict anti-fake invariant:
            expect(prompt).toContain("expect(true).toBe(true)");
            expect(prompt).toContain("Every single test MUST be active and runnable");
            expect(prompt).toContain("MANDATORY DELTA DECISION TABLE");
        });
    });

    // =========================================================================
    // SECTION 5: STORAGE IMMUTABILITY INVARIANT
    // =========================================================================
    describe("5. Storage Immutability Invariant Verification", () => {
        it("Verifies storage/ directory remains completely pristine and unmodified", () => {
            const gitStatus = execSync("git status --porcelain storage/", { encoding: "utf8" });
            expect(gitStatus.trim()).toBe("");
        });
    });
});
