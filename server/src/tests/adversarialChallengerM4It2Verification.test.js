import { describe, test, expect, jest } from "@jest/globals";
import vm from "vm";
import path from "path";
import fs from "fs";
import { buildSetupContent } from "../services/runTestsJob.service.js";
import { buildIsolationMockContracts, assembleUnitTestContext } from "../services/unitTestContextEngineering.service.js";
import { healControllerFixturesWithAst } from "../services/testSanitizer.service.js";
import { generateFallbackUnitTests } from "../services/unitTestSuggestion.service.js";

describe("Milestone M4 Iteration 2: Empirical Stress & Hostile Boundary Suite", () => {

    describe("Dimension 1: Instruction Substring Reconciliation & Multi-Suite Contract", () => {
        test("1.1: buildIsolationMockContracts output satisfies all 4 existing suite substrings simultaneously", () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: `import prisma from "../config/prisma.js";\nexport async function getUser(id) { return prisma.user.findUnique({ where: { id } }); }`,
                framework: "jest"
            });

            expect(contracts.detectedDependencies).toContain("prisma-db");

            // Substring 1: businessLogicEdgeCasesMatrix.test.js:137
            expect(contracts.mockInstructions).toContain("Prisma DB: Re-use the Prisma Proxy Mock");

            // Substring 2: verificationTestCases62.test.js:269
            expect(contracts.mockInstructions).toContain("Re-use the Prisma Proxy Mock. Never connect to a real database.");

            // Substring 3: e2e_resilience_prisma_and_controllers.test.js:245
            expect(contracts.mockInstructions).toContain("Prisma DB: Re-use the self-contained in-memory Prisma Proxy Mock");

            // Substring 4: e2e_resilience_prisma_and_controllers.test.js:246
            expect(contracts.mockInstructions).toContain("PrismaClientInitializationError in Prisma v7");
        });

        test("1.2: assembleUnitTestContext injects section 2 isolation contracts with complete instructions", () => {
            const context = assembleUnitTestContext({
                sourceCode: `const prisma = require('./prisma');\nmodule.exports = { getUser: (id) => prisma.user.findUnique({ where: { id } }) };`,
                framework: "jest"
            });

            expect(context.engineeredPromptContext).toContain("SECTION 2: ISOLATION MOCK CONTRACTS");
            expect(context.engineeredPromptContext).toContain("Prisma DB: Re-use the Prisma Proxy Mock. Never connect to a real database.");
            expect(context.engineeredPromptContext).toContain("PrismaClientInitializationError in Prisma v7");
        });
    });

    describe("Dimension 2: Universal Prisma Proxy Surface Area & Unsafe Queries", () => {
        test("2.1: Jest mock template includes $queryRawUnsafe and $executeRawUnsafe", () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: `import prisma from "../config/prisma.js";`,
                framework: "jest"
            });

            expect(contracts.mockPreambleCode).toContain("$queryRawUnsafe: jest.fn().mockResolvedValue([])");
            expect(contracts.mockPreambleCode).toContain("$executeRawUnsafe: jest.fn().mockResolvedValue(1)");
        });

        test("2.2: Vitest mock template includes $queryRawUnsafe and $executeRawUnsafe", () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: `import prisma from "../config/prisma.js";`,
                framework: "vitest"
            });

            expect(contracts.mockPreambleCode).toContain("$queryRawUnsafe: vi.fn().mockResolvedValue([])");
            expect(contracts.mockPreambleCode).toContain("$executeRawUnsafe: vi.fn().mockResolvedValue(1)");
        });

        test("2.3: Fallback unit test generator mock templates include $queryRawUnsafe and $executeRawUnsafe", () => {
            const fallback = generateFallbackUnitTests({
                sourceCode: `import prisma from "../config/prisma.js";\nexport const doRaw = (sql) => prisma.$queryRawUnsafe(sql);`,
                sourceFile: "src/services/rawDb.service.js",
                framework: "jest"
            });

            const code = fallback.fullUpdatedContent || fallback.suggestedTestCode;
            expect(code).toContain("$queryRawUnsafe");
            expect(code).toContain("$executeRawUnsafe");
        });

        test("2.4: Execution of $queryRawUnsafe and $executeRawUnsafe in sandboxed proxy client", async () => {
            // Reconstruct the universal proxy handler as generated
            const _createModelMock = () => new Proxy({}, {
                get: (target, prop) => {
                    if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;
                    return () => Promise.resolve({ id: 1, name: "Sample" });
                }
            });

            const models = new Map();
            let clientProxy;
            clientProxy = new Proxy({
                $connect: () => Promise.resolve(),
                $disconnect: () => Promise.resolve(),
                $transaction: async (args) => Array.isArray(args) ? Promise.all(args) : (typeof args === 'function' ? args(clientProxy) : Promise.resolve()),
                $queryRaw: () => Promise.resolve([]),
                $queryRawUnsafe: () => Promise.resolve([]),
                $executeRaw: () => Promise.resolve(1),
                $executeRawUnsafe: () => Promise.resolve(1),
                $extends: () => clientProxy
            }, {
                get(target, prop) {
                    if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;
                    if (prop in target) return target[prop];
                    if (!models.has(prop)) models.set(prop, _createModelMock());
                    return models.get(prop);
                }
            });

            // Empirically test raw queries
            const queryRes = await clientProxy.$queryRawUnsafe("SELECT * FROM users WHERE active = $1", true);
            expect(queryRes).toEqual([]);

            const execRes = await clientProxy.$executeRawUnsafe("DELETE FROM sessions WHERE expired = true");
            expect(execRes).toBe(1);

            // Empirically test interactive transactions
            const txRes = await clientProxy.$transaction(async (tx) => {
                const u = await tx.user.findFirst();
                return u;
            });
            expect(txRes).toEqual({ id: 1, name: "Sample" });

            // Empirically test array transactions
            const batchRes = await clientProxy.$transaction([
                clientProxy.$queryRawUnsafe("SELECT 1"),
                clientProxy.$executeRawUnsafe("UPDATE t SET a = 1")
            ]);
            expect(batchRes).toEqual([[], 1]);
        });
    });

    describe("Dimension 3: Test Runner Pre-Flight Harness VM Execution & Resilience", () => {
        test("3.1: buildSetupContent intercepts Prisma v7 constructor error and substitutes FallbackPrismaClient", () => {
            const setupContent = buildSetupContent({ rootDir: process.cwd() });

            const fakePrismaPkg = {
                PrismaClient: function() {
                    const err = new Error("PrismaClient needs to be constructed with an adapter in Prisma v7");
                    err.name = "PrismaClientConstructorValidationError";
                    throw err;
                }
            };

            const sandbox = {
                require: (mod) => {
                    if (mod === "@prisma/client") return fakePrismaPkg;
                    if (mod === "fs" || mod === "path" || mod === "module") return require(mod);
                    return {};
                },
                process: { ...process, env: { ...process.env, NODE_ENV: "test" } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            const vmContext = vm.createContext(sandbox);
            vm.runInContext(setupContent, vmContext);

            expect(fakePrismaPkg.PrismaClient.name).toBe("FallbackPrismaClient");
            const instance = new fakePrismaPkg.PrismaClient();
            expect(instance).toBeDefined();
            expect(typeof instance.order.findUnique).toBe("function");
        });

        test("3.2: buildSetupContent gracefully ignores missing @prisma/client without throwing", () => {
            const setupContent = buildSetupContent({ rootDir: process.cwd() });

            const sandbox = {
                require: (mod) => {
                    if (mod === "@prisma/client") {
                        const err = new Error("Cannot find module '@prisma/client'");
                        err.code = "MODULE_NOT_FOUND";
                        throw err;
                    }
                    if (mod === "fs" || mod === "path" || mod === "module") return require(mod);
                    return {};
                },
                process: { ...process, env: { ...process.env, NODE_ENV: "test" } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            const vmContext = vm.createContext(sandbox);
            expect(() => {
                vm.runInContext(setupContent, vmContext);
            }).not.toThrow();
        });

        test("3.3: buildSetupContent FallbackPrismaClient preserves original constructor when adapter provided", () => {
            const setupContent = buildSetupContent({ rootDir: process.cwd() });

            let originalCalled = false;
            function OriginalPrismaClient(opts) {
                if (!opts || !opts.adapter) {
                    const err = new Error("@prisma/client did not initialize yet. Please run 'prisma generate'");
                    err.name = "PrismaClientInitializationError";
                    throw err;
                }
                originalCalled = true;
                this.isReal = true;
                this.adapter = opts.adapter;
            }

            const fakePrismaPkg = {
                PrismaClient: OriginalPrismaClient
            };

            const sandbox = {
                require: (mod) => {
                    if (mod === "@prisma/client") return fakePrismaPkg;
                    if (mod === "fs" || mod === "path" || mod === "module") return require(mod);
                    return {};
                },
                process: { ...process, env: { ...process.env, NODE_ENV: "test" } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            const vmContext = vm.createContext(sandbox);
            vm.runInContext(setupContent, vmContext);

            // Zero arg constructor falls back to proxy
            const fallbackInstance = new fakePrismaPkg.PrismaClient();
            expect(typeof fallbackInstance.user.findFirst).toBe("function");

            // Args with adapter calls through to OriginalPrismaClient
            const realInstance = new fakePrismaPkg.PrismaClient({ adapter: { name: "custom-adapter" } });
            expect(originalCalled).toBe(true);
            expect(realInstance.isReal).toBe(true);
            expect(realInstance.adapter.name).toBe("custom-adapter");
        });
    });

    describe("Dimension 4: Structured Controller Request/Response Mocking & AST Repair", () => {
        // Evaluate the generated createMockReqResNext code directly from buildIsolationMockContracts
        const getGeneratedCreateMockReqResNext = () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: `export const handler = (req, res, next) => res.json(req.body);`,
                framework: "jest"
            });
            const preamble = contracts.mockPreambleCode;
            const sandbox = {
                jest,
                createMockReqResNext: null
            };
            vm.runInNewContext(preamble + "\nthis.createMockReqResNext = createMockReqResNext;", sandbox);
            return sandbox.createMockReqResNext;
        };

        test("4.1: Generated createMockReqResNext prevents null/undefined body destructuring", () => {
            const createMock = getGeneratedCreateMockReqResNext();
            expect(typeof createMock).toBe("function");

            // Hostile falsy overrides
            const m1 = createMock({ body: null });
            expect(m1.req.body).not.toBeNull();
            expect(typeof m1.req.body).toBe("object");

            const m2 = createMock({ body: undefined });
            expect(m2.req.body).not.toBeUndefined();
            expect(typeof m2.req.body).toBe("object");

            const m3 = createMock({ query: null, params: null });
            expect(m3.req.query).not.toBeNull();
            expect(m3.req.params).not.toBeNull();
        });

        test("4.2: Controller destructuring items.map and total executes safely with generated createMockReqResNext", async () => {
            const createMock = getGeneratedCreateMockReqResNext();

            const hostileController = async (req, res, next) => {
                try {
                    const { items } = req.body;
                    const count = (items || []).length;
                    return res.status(200).json({ success: true, count });
                } catch (err) {
                    next(err);
                }
            };

            const { req, res, next } = createMock();
            await hostileController(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, count: 0 }));
            expect(next).not.toHaveBeenCalled();
        });

        test("4.3: healControllerFixturesWithAst removes rogue req.body = null in test AST", () => {
            const rogueTestCode = `
describe("Payment Controller", () => {
    it("should handle error when body is empty", async () => {
        const req = { body: null };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await paymentController(req, res);
    });
});
            `;

            const healed = healControllerFixturesWithAst(rogueTestCode, "paymentController.test.js");
            expect(healed).not.toContain("body: null");
            expect(healed).toContain("body: {}");
        });

        test("4.4: healControllerFixturesWithAst injects safe controller fixtures into describe blocks missing fixtures", () => {
            const missingFixturesCode = `
describe("Cart Controller", () => {
    it("adds item to cart", async () => {
        req.body = { itemId: "item-1" };
        await cartController(req, res, next);
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
            `;

            const healed = healControllerFixturesWithAst(missingFixturesCode, "cartController.test.js");
            expect(healed).toContain("beforeEach");
            expect(healed).toContain("req = { body: {}");
        });
    });

    describe("Dimension 5: applyTestSuggestion Auto-Refinement Convergence Guard", () => {
        test("5.1: autoRefineCoverageGaps terminates gracefully when rootDir is in storage", async () => {
            const { autoRefineCoverageGaps } = await import("../services/applyTestSuggestion.service.js");

            const tempDir = path.join(process.cwd(), "storage", "test_convergence_" + Date.now());
            const res = await autoRefineCoverageGaps({
                rootDir: tempDir,
                sourceFilesInspected: new Set(["src/calc.js"]),
                modifiedFiles: new Set()
            });

            expect(res).toBeDefined();
            expect(res.passesRun).toBe(0);
            expect(res.refined).toBe(false);
        });
    });
});
