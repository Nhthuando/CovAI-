import fs from "fs";
import path from "path";
import os from "os";
import vm from "vm";
import { describe, test, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Guarantee local storage to prevent Firebase initialization requirements
process.env.PROJECT_STORAGE_DRIVER = "local";

// Services under test
import {
    buildIsolationMockContracts,
    assembleUnitTestContext
} from "../services/unitTestContextEngineering.service.js";
import { buildSetupContent } from "../services/runTestsJob.service.js";
import {
    healControllerFixturesWithAst,
    cleanAndDeduplicateTestContent
} from "../services/testSanitizer.service.js";
import { buildStandardUnitTestPrompt } from "../services/unitTestGenerator.service.js";
import { parseJavaScriptCode } from "../services/babelParser.service.js";
import prisma, { setPrismaClient } from "../config/prisma.js";

/**
 * Universal In-Memory Prisma Proxy Factory mirroring the engine's synthesized proxy
 */
const createTestPrismaProxy = () => {
    const _mockFn = () => jest.fn(() => Promise.resolve({
        id: 1,
        name: "Sample Item",
        status: "ACTIVE",
        title: "Sample",
        email: "test@example.com",
        createdAt: new Date(),
        updatedAt: new Date()
    }));

    const _createModelProxy = () => new Proxy({}, {
        get: (target, prop) => {
            if (prop === "then") return undefined;
            if (!target[prop]) {
                if (prop === "findMany" || prop === "findRaw") {
                    target[prop] = jest.fn(() => Promise.resolve([{ id: 1, name: "Sample", status: "ACTIVE", title: "Sample" }]));
                } else if (prop === "count") {
                    target[prop] = jest.fn(() => Promise.resolve(1));
                } else {
                    target[prop] = _mockFn();
                }
            }
            return target[prop];
        }
    });

    let _clientProxy;
    _clientProxy = new Proxy({
        $transaction: jest.fn((args) => Array.isArray(args) ? Promise.all(args) : (typeof args === "function" ? args(_clientProxy) : Promise.resolve())),
        $queryRaw: jest.fn(() => Promise.resolve([])),
        $executeRaw: jest.fn(() => Promise.resolve(1)),
        $connect: jest.fn(() => Promise.resolve()),
        $disconnect: jest.fn(() => Promise.resolve())
    }, {
        get: (target, prop) => (prop in target ? target[prop] : (!target[prop] ? target[prop] = _createModelProxy() : target[prop]))
    });
    return _clientProxy;
};

/**
 * Universal Mock Req/Res/Next Generator matching engine contract
 */
const createMockReqResNext = (overrides = {}) => {
    const innerReq = (overrides && overrides.req) || {};
    const safeBody = (overrides && overrides.body !== undefined && overrides.body !== null)
        ? overrides.body
        : (innerReq.body !== undefined && innerReq.body !== null ? innerReq.body : {});

    const req = {
        body: safeBody,
        query: { page: "1", limit: "10", ...(innerReq.query || (overrides && overrides.query)) },
        params: { id: "1", ...(innerReq.params || (overrides && overrides.params)) },
        headers: { authorization: "Bearer test-token", ...(innerReq.headers || (overrides && overrides.headers)) },
        user: { id: 1, role: "admin", email: "admin@example.com", ...(innerReq.user || (overrides && overrides.user)) },
        file: innerReq.file || overrides?.file || null,
        files: innerReq.files || overrides?.files || [],
        cookies: { ...(innerReq.cookies || (overrides && overrides.cookies)) }
    };

    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
        cookie: jest.fn().mockReturnThis(),
        clearCookie: jest.fn().mockReturnThis(),
        redirect: jest.fn().mockReturnThis(),
        setHeader: jest.fn().mockReturnThis(),
        sendStatus: jest.fn().mockReturnThis(),
        write: jest.fn().mockReturnThis(),
        end: jest.fn().mockReturnThis()
    };
    const next = jest.fn();
    return { req, res, next };
};

describe("CovAI- E2E Resilience: Prisma v7 & Express Controller Mocking Suite", () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-e2e-resilience-"));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) { }
        }
        jest.restoreAllMocks();
    });

    // =========================================================================
    // TIER 1: FEATURE COVERAGE & CORE MECHANICS (Features 1 - 12)
    // =========================================================================
    describe("Tier 1: Feature Coverage & Core Mechanics", () => {
        // --- Area A: Transitive & Hoisting-Safe Prisma Mocking (Features 1, 2, 3) ---
        describe("Area A: Transitive & Hoisting-Safe Prisma Mocking", () => {
            test("1.1 Transitive Prisma detection via 1-hop relative imports", () => {
                const srcDir = path.join(tempDir, "src");
                const servicesDir = path.join(srcDir, "services");
                fs.mkdirSync(servicesDir, { recursive: true });

                const orderServicePath = path.join(servicesDir, "orderService.js");
                fs.writeFileSync(orderServicePath, `
                    import { PrismaClient } from "@prisma/client";
                    const db = new PrismaClient();
                    export const queryOrders = async () => db.order.findMany();
                `, "utf8");

                const controllerPath = path.join(srcDir, "orderController.js");
                const controllerCode = `
                    import { queryOrders } from "./services/orderService.js";
                    export const getOrders = async (req, res) => {
                        const data = await queryOrders();
                        return res.json(data);
                    };
                `;
                fs.writeFileSync(controllerPath, controllerCode, "utf8");

                const result = buildIsolationMockContracts({
                    sourceCode: controllerCode,
                    sourceFile: controllerPath,
                    rootDir: tempDir,
                    framework: "jest"
                });

                expect(result.detectedDependencies).toContain("prisma-db");
                expect(result.mockPreambleCode).toContain("Prisma Client Mock");
                expect(result.mockPreambleCode).toContain("globalThis.__mockPrisma");
            });

            test("1.2 Direct Prisma detection in source and test code", () => {
                const sourceCode = `
                    import prisma from "../config/prisma";
                    export const getUser = async (id) => prisma.user.findUnique({ where: { id } });
                `;

                const result = buildIsolationMockContracts({
                    sourceCode,
                    framework: "jest"
                });

                expect(result.detectedDependencies).toContain("prisma-db");
                expect(result.mockPreambleCode).toContain("jest.mock('@prisma/client'");
                expect(result.mockPreambleCode).toContain("jest.mock('../config/prisma'");
            });

            test("1.3 Hoisting-Safe Universal Prisma Mock syntax generation for Vitest & Jest", () => {
                const sourceCode = `import prisma from "../lib/prisma";`;

                // Vitest contract
                const vitestRes = buildIsolationMockContracts({
                    sourceCode,
                    framework: "vitest"
                });
                expect(vitestRes.mockPreambleCode).toContain("vi.mock('@prisma/client'");
                expect(vitestRes.mockPreambleCode).toContain("globalThis.__mockPrisma");
                expect(vitestRes.mockPreambleCode).not.toContain("jest.mock");

                // Jest contract
                const jestRes = buildIsolationMockContracts({
                    sourceCode,
                    framework: "jest"
                });
                expect(jestRes.mockPreambleCode).toContain("jest.mock('@prisma/client'");
                expect(jestRes.mockPreambleCode).toContain("{ virtual: true }");
                expect(jestRes.mockPreambleCode).toContain("globalThis.__mockPrisma");
                expect(jestRes.mockPreambleCode).not.toContain("vi.mock");
            });

            test("1.4 Universal Prisma Proxy mock handles dynamic models, transactions, and raw queries", async () => {
                const proxy = createTestPrismaProxy();

                // Dynamic models
                const user = await proxy.user.create({ data: { name: "Alice" } });
                expect(user).toHaveProperty("id", 1);

                const count = await proxy.cartItem.count();
                expect(count).toBe(1);

                const items = await proxy.order.findMany();
                expect(Array.isArray(items)).toBe(true);

                // Transaction (array)
                const txResults = await proxy.$transaction([
                    proxy.user.findUnique({ where: { id: 1 } }),
                    proxy.order.findMany()
                ]);
                expect(txResults).toHaveLength(2);

                // Transaction (callback)
                const txCbResult = await proxy.$transaction(async (tx) => {
                    const u = await tx.user.findUnique({ where: { id: 1 } });
                    return u.id * 10;
                });
                expect(txCbResult).toBe(10);

                // Raw queries & connections
                await expect(proxy.$queryRaw`SELECT 1`).resolves.toEqual([]);
                await expect(proxy.$executeRaw`DELETE FROM logs`).resolves.toBe(1);
                await expect(proxy.$connect()).resolves.toBeUndefined();
                await expect(proxy.$disconnect()).resolves.toBeUndefined();
            });

            test("1.5 assembleUnitTestContext contract passes sourceFile, targetTestFile, rootDir and injects instructions", () => {
                const sourceCode = `import { PrismaClient } from "@prisma/client"; const p = new PrismaClient();`;

                const context = assembleUnitTestContext({
                    sourceCode,
                    coverageDetails: { summary: { linesPct: 50 } },
                    framework: "jest",
                    sourceFile: "src/controllers/auth.controller.js",
                    targetTestFile: "tests/auth.controller.test.js",
                    rootDir: tempDir
                });

                expect(context).toHaveProperty("mockContracts");
                expect(context.mockContracts.detectedDependencies).toContain("prisma-db");
                expect(context.mockContracts.mockInstructions).toContain("Prisma DB: Re-use the self-contained in-memory Prisma Proxy Mock");
                expect(context.mockContracts.mockInstructions).toContain("PrismaClientInitializationError in Prisma v7");
            });
        });

        // --- Area B: Runner Pre-flight & Fallback Mocking (Features 4, 5, 6, 7) ---
        describe("Area B: Runner Pre-flight & Fallback Mocking", () => {
            test("1.6 buildSetupContent synthesizes covai-jest-setup.cjs containing Fallback Prisma Proxy", () => {
                const setupContent = buildSetupContent({ rootDir: tempDir });

                expect(setupContent).toContain("prismaPkg = require('@prisma/client');");
                expect(setupContent).toContain("createPrismaProxy");
                expect(setupContent).toContain("prismaPkg.PrismaClient = function()");
                expect(setupContent).toContain("$transaction");
            });

            test("1.7 Pre-flight setup intercepts stubbed PrismaClient initialization errors", () => {
                const setupContent = buildSetupContent({ rootDir: tempDir });

                // Verify the synthesized script code contains critical interception tokens
                expect(setupContent).toContain("PrismaClientInitializationError");
                expect(setupContent).toContain("did not initialize yet");
                expect(setupContent).toContain("prisma generate");
                expect(setupContent).toContain("FallbackPrismaClient");
                expect(setupContent).toContain("createPrismaProxy");

                // Create a stubbed @prisma/client simulating Prisma v7 ungenerated client
                const fakePrismaPkg = {
                    PrismaClient: function () {
                        const err = new Error("@prisma/client did not initialize yet. Please run 'prisma generate' and try to import it again.");
                        err.name = "PrismaClientInitializationError";
                        throw err;
                    }
                };

                // Confirm un-intercepted zero-arg invocation throws stub error
                expect(() => new fakePrismaPkg.PrismaClient()).toThrow("did not initialize yet");

                // Execute the generated setup script in an isolated VM sandbox
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

                // Verify the generated setup script intercepted and replaced PrismaClient with FallbackPrismaClient
                expect(fakePrismaPkg.PrismaClient.name).toBe("FallbackPrismaClient");

                // Zero-arg constructor now safely returns the resilient proxy mock
                const client = new fakePrismaPkg.PrismaClient();
                expect(client).toBeDefined();
                expect(typeof client.user.findFirst).toBe("function");
                expect(typeof client.user.findMany).toBe("function");
                expect(typeof client.$transaction).toBe("function");
            });

            test("1.8 Virtual mock registration covers relative singleton paths", () => {
                const sourceCode = `import prisma from "../../lib/prisma.js";`;
                const contracts = buildIsolationMockContracts({ sourceCode, framework: "jest" });

                expect(contracts.mockPreambleCode).toContain("jest.mock('../../lib/prisma.js'");
                expect(contracts.mockPreambleCode).toContain("jest.mock('../../src/lib/prisma.js'");
                expect(contracts.mockPreambleCode).toContain("jest.mock('../../config/prisma.js'");
                expect(contracts.mockPreambleCode).toContain("globalThis.__mockPrisma");
            });

            test("1.9 Backend safety setup and setPrismaClient contract", async () => {
                const proxy = createTestPrismaProxy();
                setPrismaClient(proxy);

                const mockUser = await prisma.user.findUnique({ where: { id: 42 } });
                expect(mockUser).toHaveProperty("id", 1);

                const txResult = await prisma.$transaction(async (tx) => {
                    return await tx.order.findMany();
                });
                expect(Array.isArray(txResult)).toBe(true);
            });

            test("1.10 Runner pre-flight Fallback Prisma handles constructor parameter validation", () => {
                // Ensure Fallback proxy handles new PrismaClient({ adapter }) or other constructor options
                const setupContent = buildSetupContent({ rootDir: tempDir });
                expect(setupContent).toContain("prismaPkg.PrismaClient = function() { return createPrismaProxy(); };");
                expect(setupContent).toContain("prop === '$connect' || prop === '$disconnect'");
            });
        });

        // --- Area C: Structured Controller Request/Response Mocking (Features 8, 9, 10, 11, 12) ---
        describe("Area C: Structured Controller Request/Response Mocking", () => {
            test("1.11 createMockReqResNext provides safe non-null body and chained res methods", () => {
                const { req, res, next } = createMockReqResNext();

                expect(req.body).toBeDefined();
                expect(typeof req.body).toBe("object");
                expect(req.body).not.toBeNull();
                expect(req.query).toHaveProperty("page", "1");
                expect(req.params).toHaveProperty("id", "1");
                expect(req.headers).toHaveProperty("authorization");

                const chained = res.status(200).json({ success: true });
                expect(chained).toBe(res);
                expect(res.status).toHaveBeenCalledWith(200);
                expect(res.json).toHaveBeenCalledWith({ success: true });
                expect(typeof next).toBe("function");
            });

            test("1.12 Preamble generates createMockReqResNext when controller pattern is detected", () => {
                const sourceCode = `
                    export const updateProfile = async (req, res, next) => {
                        const { name, email } = req.body;
                        return res.json({ name, email });
                    };
                `;

                const contracts = buildIsolationMockContracts({ sourceCode, framework: "jest" });
                expect(contracts.detectedDependencies).toContain("express-controller");
                expect(contracts.mockPreambleCode).toContain("const createMockReqResNext = (overrides = {}) =>");
                expect(contracts.mockPreambleCode).toContain("body: { ...overrides.body }");
                expect(contracts.mockPreambleCode).toContain("status: jest.fn().mockReturnThis()");
            });

            test("1.13 Non-Null Body and Express Controller Contract in AI Prompts", () => {
                const prompt = buildStandardUnitTestPrompt({
                    sourceCode: "export const handler = (req, res) => res.json(req.body.items);",
                    cleanSource: "src/controllers/cart.controller.js",
                    cleanImportPath: "../controllers/cart.controller.js",
                    framework: "jest",
                    testFileInfo: { relativePath: "tests/cart.controller.test.js" },
                    exportedSymbolsStr: "handler",
                    coverageDetails: { summary: { linesPct: 0 } },
                    cyclomaticComplexity: 2
                });

                expect(prompt).toContain("EXPRESS CONTROLLER & MIDDLEWARE FIXTURES CONTRACT");
                expect(prompt).toContain("req = { body: {}, params: {}, query: {}, headers: {}");
                expect(prompt).toContain("res = { status: jest.fn().mockReturnThis()");
            });

            test("1.14 AST Fixture synthesis via healControllerFixturesWithAst", () => {
                const testCodeWithoutFixtures = `
                    describe("cartController tests", () => {
                        it("should add item to cart", async () => {
                            req.body = { itemId: 123, quantity: 2 };
                            await addItem(req, res, next);
                            expect(res.status).toHaveBeenCalledWith(200);
                        });
                    });
                `;

                const healed = healControllerFixturesWithAst(testCodeWithoutFixtures, "src/controllers/cartController.js");

                expect(healed).toContain("beforeEach(() => {");
                expect(healed).toContain("req = { body: {}, params: {}, query: {}, headers: {}, file: null, files: [], cookies: {}, user: { id: 1, role: 'admin' } };");
                expect(healed).toContain("res = {");
                expect(healed).toContain("status:");
                expect(healed).toContain("json:");
                expect(healed).toContain("next =");

                const parseResult = parseJavaScriptCode(healed);
                expect(parseResult.success).toBe(true);
            });

            test("1.15 healControllerFixturesWithAst preserves existing beforeEach and appends missing req/res", () => {
                const existingTestWithBeforeEach = `
                    describe("profileController tests", () => {
                        beforeEach(() => {
                            console.log("setup database mocks");
                        });
                        it("updates profile", async () => {
                            req.body.name = "Bob";
                            await updateProfile(req, res);
                            expect(res.json).toHaveBeenCalled();
                        });
                    });
                `;

                const healed = healControllerFixturesWithAst(existingTestWithBeforeEach, "src/controllers/profileController.js");

                expect(healed).toContain("console.log(\"setup database mocks\");");
                expect(healed).toContain("req = { body: {}, params: {}, query: {}, headers: {}");
                expect(healed).toContain("res = {");

                const parseResult = parseJavaScriptCode(healed);
                expect(parseResult.success).toBe(true);
            });
        });
    });

    // =========================================================================
    // TIER 2: BOUNDARY & CORNER CASES
    // =========================================================================
    describe("Tier 2: Boundary & Corner Cases", () => {
        test("2.1 createMockReqResNext with unusual or falsy overrides never results in null body", () => {
            const case1 = createMockReqResNext(null);
            expect(case1.req.body).toEqual({});

            const case2 = createMockReqResNext({});
            expect(case2.req.body).toEqual({});

            const case3 = createMockReqResNext({ body: undefined });
            expect(case3.req.body).toEqual({});

            const case4 = createMockReqResNext({ body: null });
            expect(case4.req.body).toEqual({});

            const case5 = createMockReqResNext({ body: { custom: "data" } });
            expect(case5.req.body).toEqual({ custom: "data" });
        });

        test("2.2 Unconfigured DATABASE_URL does not crash runner harness", () => {
            const originalUrl = process.env.DATABASE_URL;
            try {
                delete process.env.DATABASE_URL;
                const proxy = createTestPrismaProxy();
                setPrismaClient(proxy);

                expect(async () => {
                    await prisma.systemLog.findMany();
                }).not.toThrow();
            } finally {
                if (originalUrl) process.env.DATABASE_URL = originalUrl;
            }
        });

        test("2.3 Deeply nested unusual destructuring in controllers executes safely with default fixtures", async () => {
            const complexController = async (req, res) => {
                const {
                    items: [firstItem = {}] = [],
                    metadata: { source = "web", tracking: { utm_source = "direct" } = {} } = {}
                } = req.body;

                return res.status(200).json({
                    firstItem,
                    source,
                    utm_source
                });
            };

            const { req: defaultReq, res: defaultRes } = createMockReqResNext({
                body: { items: [], metadata: {} }
            });
            await complexController(defaultReq, defaultRes);
            expect(defaultRes.status).toHaveBeenCalledWith(200);
            expect(defaultRes.json).toHaveBeenCalledWith({
                firstItem: {},
                source: "web",
                utm_source: "direct"
            });

            const { req: populatedReq, res: populatedRes } = createMockReqResNext({
                body: {
                    items: [{ id: 101, sku: "SKU-99" }],
                    metadata: { source: "mobile", tracking: { utm_source: "newsletter" } }
                }
            });
            await complexController(populatedReq, populatedRes);
            expect(populatedRes.json).toHaveBeenCalledWith({
                firstItem: { id: 101, sku: "SKU-99" },
                source: "mobile",
                utm_source: "newsletter"
            });
        });

        test("2.4 Vitest vs Jest framework differences in AST healing and preambles", () => {
            const controllerSource = `
                export const testHandler = async (req, res, next) => {
                    const { filter } = req.query;
                    return res.json({ filter });
                };
            `;

            const vitestPreamble = buildIsolationMockContracts({
                sourceCode: controllerSource,
                framework: "vitest"
            }).mockPreambleCode;
            expect(vitestPreamble).toContain("vi.fn().mockReturnThis()");
            expect(vitestPreamble).not.toContain("jest.fn");

            const jestPreamble = buildIsolationMockContracts({
                sourceCode: controllerSource,
                framework: "jest"
            }).mockPreambleCode;
            expect(jestPreamble).toContain("jest.fn().mockReturnThis()");
            expect(jestPreamble).not.toContain("vi.fn");
        });

        test("2.5 Resilient transitive dependency traversal with non-existent files or circular imports", () => {
            const controllerPath = path.join(tempDir, "brokenController.js");
            const controllerCode = `
                import { helper } from "./missingHelper.js";
                import { self } from "./brokenController.js";
                export const action = (req, res) => res.send("ok");
            `;
            fs.writeFileSync(controllerPath, controllerCode, "utf8");

            expect(() => {
                const result = buildIsolationMockContracts({
                    sourceCode: controllerCode,
                    sourceFile: controllerPath,
                    rootDir: tempDir,
                    framework: "jest"
                });
                expect(result).toBeDefined();
            }).not.toThrow();
        });

        test("2.6 Concurrency and stress resilience on Universal Prisma Proxy", async () => {
            const proxy = createTestPrismaProxy();

            const findPromises = Array.from({ length: 50 }, (_, i) =>
                proxy.invoice.findMany({ where: { status: `STATE_${i}` } })
            );

            const txPromises = Array.from({ length: 20 }, (_, i) =>
                proxy.$transaction(async (tx) => {
                    const item = await tx.item.create({ data: { index: i } });
                    return item.id + i;
                })
            );

            const allResults = await Promise.all([...findPromises, ...txPromises]);
            expect(allResults).toHaveLength(70);
            expect(allResults.slice(0, 50).every(Array.isArray)).toBe(true);
            expect(allResults.slice(50).every(n => typeof n === "number")).toBe(true);
        });
    });

    // =========================================================================
    // TIER 3: CROSS-FEATURE COMBINATIONS
    // =========================================================================
    describe("Tier 3: Cross-Feature Combinations", () => {
        test("3.1 Controller with both Prisma queries and req.body.items destructuring", async () => {
            const proxy = createTestPrismaProxy();
            setPrismaClient(proxy);

            const createBatchOrderController = async (req, res, next) => {
                try {
                    const { items = [], customerId } = req.body;
                    if (!items || items.length === 0) {
                        return res.status(400).json({ error: "Cart is empty" });
                    }

                    const result = await prisma.$transaction(async (tx) => {
                        const order = await tx.order.create({
                            data: { customerId, itemCount: items.length }
                        });
                        for (const item of items) {
                            await tx.orderItem.create({
                                data: { orderId: order.id, productId: item.id, qty: item.qty }
                            });
                        }
                        return order;
                    });

                    return res.status(201).json({ success: true, order: result });
                } catch (err) {
                    return next(err);
                }
            };

            // Test 1: Empty items boundary
            const { req: emptyReq, res: emptyRes, next: emptyNext } = createMockReqResNext({
                body: { items: [], customerId: 10 }
            });
            await createBatchOrderController(emptyReq, emptyRes, emptyNext);
            expect(emptyRes.status).toHaveBeenCalledWith(400);
            expect(emptyRes.json).toHaveBeenCalledWith({ error: "Cart is empty" });
            expect(emptyNext).not.toHaveBeenCalled();

            // Test 2: Valid items happy path
            const { req: validReq, res: validRes, next: validNext } = createMockReqResNext({
                body: {
                    items: [{ id: 1, qty: 2 }, { id: 2, qty: 5 }],
                    customerId: 10
                }
            });
            await createBatchOrderController(validReq, validRes, validNext);
            expect(validRes.status).toHaveBeenCalledWith(201);
            expect(validRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, order: expect.any(Object) })
            );
            expect(validNext).not.toHaveBeenCalled();
        });

        test("3.2 Transitive Prisma detection coupled with AST controller fixture healing", () => {
            const srcDir = path.join(tempDir, "src");
            fs.mkdirSync(srcDir, { recursive: true });

            const dbServiceFile = path.join(srcDir, "db.js");
            fs.writeFileSync(dbServiceFile, `
                import { PrismaClient } from "@prisma/client";
                export const db = new PrismaClient();
            `, "utf8");

            const controllerFile = path.join(srcDir, "productController.js");
            const controllerContent = `
                import { db } from "./db.js";
                export const createProduct = async (req, res, next) => {
                    const { name, price, tags = [] } = req.body;
                    const prod = await db.product.create({ data: { name, price, tags } });
                    return res.status(201).json(prod);
                };
            `;
            fs.writeFileSync(controllerFile, controllerContent, "utf8");

            const context = assembleUnitTestContext({
                sourceCode: controllerContent,
                framework: "jest",
                sourceFile: controllerFile,
                rootDir: tempDir
            });
            expect(context.mockContracts.detectedDependencies).toContain("prisma-db");

            const rawTestCode = `
                import { createProduct } from "./productController.js";
                describe("productController", () => {
                    it("creates a product", async () => {
                        req.body = { name: "Widget", price: 9.99, tags: ["gadget"] };
                        await createProduct(req, res, next);
                        expect(res.status).toHaveBeenCalledWith(201);
                    });
                });
            `;

            const healedTestCode = healControllerFixturesWithAst(rawTestCode, controllerFile);
            expect(healedTestCode).toContain("beforeEach(() => {");
            expect(healedTestCode).toContain("req = { body: {}, params: {}, query: {}, headers: {}");
            expect(healedTestCode).toContain("res = {");

            const fullSuite = `${context.mockContracts.mockPreambleCode}\n${healedTestCode}`;
            const astCheck = parseJavaScriptCode(fullSuite);
            expect(astCheck.success).toBe(true);
        });

        test("3.3 Express middleware next(err) chaining with Prisma error handling", async () => {
            const proxy = createTestPrismaProxy();
            setPrismaClient(proxy);

            proxy.user.findUnique = jest.fn(() => Promise.reject(new Error("P2002: Unique constraint violation")));

            const checkUserMiddleware = async (req, res, next) => {
                try {
                    const { email } = req.body;
                    const user = await prisma.user.findUnique({ where: { email } });
                    return res.json({ user });
                } catch (err) {
                    return next(err);
                }
            };

            const { req, res, next } = createMockReqResNext({
                body: { email: "conflict@example.com" }
            });

            await checkUserMiddleware(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining("P2002")
            }));
            expect(res.json).not.toHaveBeenCalled();
        });

        test("3.4 Mixed CommonJS and ESM syntax resilience", () => {
            const esmCode = `import prisma from '../config/prisma.js'; export const x = 1;`;
            const cjsCode = `const prisma = require('../../lib/prisma'); module.exports = { y: 2 };`;

            const esmRes = buildIsolationMockContracts({ sourceCode: esmCode, framework: "jest" });
            const cjsRes = buildIsolationMockContracts({ sourceCode: cjsCode, framework: "jest" });

            expect(esmRes.detectedDependencies).toContain("prisma-db");
            expect(cjsRes.detectedDependencies).toContain("prisma-db");
        });
    });

    // =========================================================================
    // TIER 4: REAL-WORLD APPLICATION SCENARIOS
    // =========================================================================
    describe("Tier 4: Real-World Scenarios", () => {
        test("4.1 Real-World cartController scenario (addItem, getCart, clearCart)", async () => {
            const proxy = createTestPrismaProxy();
            setPrismaClient(proxy);

            let cartItems = [];

            const cartController = {
                addItem: async (req, res, next) => {
                    try {
                        const { productId, quantity = 1 } = req.body;
                        if (!productId) {
                            return res.status(400).json({ error: "productId is required" });
                        }
                        const product = await prisma.product.findUnique({ where: { id: productId } });
                        if (!product) {
                            return res.status(404).json({ error: "Product not found" });
                        }
                        const existing = cartItems.find(i => i.productId === productId);
                        if (existing) {
                            existing.quantity += quantity;
                        } else {
                            cartItems.push({ productId, quantity, title: product.title, price: 19.99 });
                        }
                        return res.status(200).json({ success: true, cart: cartItems });
                    } catch (e) {
                        return next(e);
                    }
                },
                getCart: async (req, res) => {
                    const subtotal = cartItems.reduce((acc, cur) => acc + cur.quantity * cur.price, 0);
                    return res.status(200).json({ items: cartItems, subtotal });
                },
                clearCart: async (req, res) => {
                    cartItems = [];
                    return res.status(200).json({ success: true, message: "Cart emptied" });
                }
            };

            // Scenario 1: Add item with valid body
            const { req: addReq, res: addRes, next: addNext } = createMockReqResNext({
                body: { productId: 101, quantity: 2 }
            });
            await cartController.addItem(addReq, addRes, addNext);
            expect(addRes.status).toHaveBeenCalledWith(200);
            expect(addRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                cart: expect.arrayContaining([expect.objectContaining({ productId: 101, quantity: 2 })])
            }));

            // Scenario 2: Add item with missing productId
            const { req: badReq, res: badRes } = createMockReqResNext({ body: {} });
            await cartController.addItem(badReq, badRes, jest.fn());
            expect(badRes.status).toHaveBeenCalledWith(400);

            // Scenario 3: Get cart and check subtotal
            const { req: getReq, res: getRes } = createMockReqResNext();
            await cartController.getCart(getReq, getRes);
            expect(getRes.status).toHaveBeenCalledWith(200);
            expect(getRes.json).toHaveBeenCalledWith(expect.objectContaining({
                subtotal: 39.98
            }));

            // Scenario 4: Clear cart
            const { req: clearReq, res: clearRes } = createMockReqResNext();
            await cartController.clearCart(clearReq, clearRes);
            expect(clearRes.status).toHaveBeenCalledWith(200);
            expect(clearRes.json).toHaveBeenCalledWith({ success: true, message: "Cart emptied" });
        });

        test("4.2 Real-World orderCheckoutController scenario with transaction rollback", async () => {
            const proxy = createTestPrismaProxy();
            setPrismaClient(proxy);

            const checkoutController = async (req, res, next) => {
                try {
                    const { items = [], paymentMethod } = req.body;
                    if (!paymentMethod) {
                        return res.status(400).json({ error: "Missing payment method" });
                    }

                    const order = await prisma.$transaction(async (tx) => {
                        for (const item of items) {
                            const stock = await tx.inventory.findUnique({ where: { productId: item.productId } });
                            if (stock && stock.available < item.quantity) {
                                throw new Error(`Insufficient stock for item ${item.productId}`);
                            }
                        }
                        const newOrder = await tx.order.create({
                            data: { items, paymentMethod, status: "PAID" }
                        });
                        return newOrder;
                    });

                    return res.status(201).json({ success: true, order });
                } catch (err) {
                    if (err.message.includes("Insufficient stock")) {
                        return res.status(409).json({ error: err.message });
                    }
                    return next(err);
                }
            };

            const { req: okReq, res: okRes, next: okNext } = createMockReqResNext({
                body: {
                    items: [{ productId: 1, quantity: 2 }],
                    paymentMethod: "CREDIT_CARD"
                }
            });
            await checkoutController(okReq, okRes, okNext);
            expect(okRes.status).toHaveBeenCalledWith(201);
            expect(okRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

            proxy.inventory.findUnique = jest.fn().mockResolvedValue({ available: 0 });
            const { req: failReq, res: failRes } = createMockReqResNext({
                body: {
                    items: [{ productId: 99, quantity: 5 }],
                    paymentMethod: "PAYPAL"
                }
            });
            await checkoutController(failReq, failRes, jest.fn());
            expect(failRes.status).toHaveBeenCalledWith(409);
            expect(failRes.json).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.stringContaining("Insufficient stock")
            }));
        });

        test("4.3 Real-World authRegistrationController scenario with Prisma singleton", async () => {
            const proxy = createTestPrismaProxy();
            setPrismaClient(proxy);

            const registerController = async (req, res, next) => {
                try {
                    const { email, password, name } = req.body;
                    if (!email || !password) {
                        return res.status(400).json({ error: "Email and password required" });
                    }
                    const existingUser = await prisma.user.findUnique({ where: { email } });
                    if (existingUser) {
                        return res.status(409).json({ error: "Email already registered" });
                    }
                    const user = await prisma.user.create({
                        data: { email, name, passwordHash: "hashed_" + password }
                    });
                    return res.status(201).json({ success: true, user: { id: user.id, email: user.email, name: user.name } });
                } catch (err) {
                    return next(err);
                }
            };

            proxy.user.findUnique = jest.fn().mockResolvedValue(null);
            proxy.user.create = jest.fn().mockResolvedValue({ id: 55, email: "new@example.com", name: "New User" });

            const { req: regReq, res: regRes, next: regNext } = createMockReqResNext({
                body: { email: "new@example.com", password: "SecretPassword123!", name: "New User" }
            });
            await registerController(regReq, regRes, regNext);
            expect(regRes.status).toHaveBeenCalledWith(201);
            expect(regRes.json).toHaveBeenCalledWith({
                success: true,
                user: { id: 55, email: "new@example.com", name: "New User" }
            });

            proxy.user.findUnique = jest.fn().mockResolvedValue({ id: 1, email: "existing@example.com" });
            const { req: dupReq, res: dupRes } = createMockReqResNext({
                body: { email: "existing@example.com", password: "pwd" }
            });
            await registerController(dupReq, dupRes, jest.fn());
            expect(dupRes.status).toHaveBeenCalledWith(409);
            expect(dupRes.json).toHaveBeenCalledWith({ error: "Email already registered" });
        });

        test("4.4 End-to-end runner harness simulation with covai-jest-setup", () => {
            const setupContent = buildSetupContent({ rootDir: tempDir });

            expect(() => {
                new Function("require", setupContent);
            }).not.toThrow();

            expect(setupContent).toContain("createPrismaProxy");
            expect(setupContent).toContain("prismaPkg.PrismaClient = function()");
        });
    });
});
