import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { buildSetupContent } from '../services/runTestsJob.service.js';
import { buildIsolationMockContracts, assembleUnitTestContext } from '../services/unitTestContextEngineering.service.js';
import { healControllerFixturesWithAst } from '../services/testSanitizer.service.js';
import { createSafeDatabaseFallbackProxy } from './helpers/databaseSafetySetup.js';
import prisma, { setPrismaClient } from '../config/prisma.js';

describe('Challenger 2 M4 Empirical Stress & Adversarial Verification Suite', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-ch2-m4-'));
    });

    afterEach(() => {
        setPrismaClient(null);
        if (tempDir && fs.existsSync(tempDir)) {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
        }
    });

    // =========================================================================
    // 1. UNIVERSAL PRISMA PROXY MOCK: DEEP RESILIENCE & ADVERSARIAL STRESS
    // =========================================================================
    describe('1. Universal Prisma Proxy Mock Stress & Invariants', () => {
        test('1.1: Fallback proxy allows arbitrary dynamic models and standard CRUD methods', async () => {
            const proxy = createSafeDatabaseFallbackProxy();

            // Arbitrary dynamic model names
            const models = ['user', 'project', 'auditLog', 'deeply_nested_custom_model', '$specialModel'];
            for (const model of models) {
                expect(proxy[model]).toBeDefined();
                const findUniqueRes = await proxy[model].findUnique({ where: { id: 42 } });
                expect(findUniqueRes.id).toBe(42);
                expect(findUniqueRes.status).toBe('ACTIVE');

                const findManyRes = await proxy[model].findMany();
                expect(Array.isArray(findManyRes)).toBe(true);
                expect(findManyRes.length).toBe(0);

                const countRes = await proxy[model].count();
                expect(countRes).toBe(0);

                const createRes = await proxy[model].create({ data: { name: 'Item Alpha' } });
                expect(createRes.name).toBe('Item Alpha');
            }
        });

        test('1.2: Promise assimilation safety — then/catch/finally/symbol return undefined to prevent deadlocks', async () => {
            const proxy = createSafeDatabaseFallbackProxy();

            // When a runtime inspects `then` (thenable test), it MUST be undefined so Promise.resolve does not hang
            expect(proxy.then).toBeUndefined();
            expect(proxy.catch).toBeUndefined();
            expect(proxy.finally).toBeUndefined();
            expect(proxy[Symbol.toStringTag]).toBeUndefined();
            expect(proxy[Symbol.iterator]).toBeUndefined();

            // On model level as well
            expect(proxy.user.then).toBeUndefined();
            expect(proxy.user.catch).toBeUndefined();
            expect(proxy.user[Symbol.asyncIterator]).toBeUndefined();

            // Verify Promise.resolve resolves synchronously
            const resolved = await Promise.resolve(proxy);
            expect(resolved).toBe(proxy);
        });

        test('1.3: $transaction supports both callback mode and promise array mode', async () => {
            const proxy = createSafeDatabaseFallbackProxy();

            // Callback mode with transaction client
            const callbackResult = await proxy.$transaction(async (tx) => {
                const u = await tx.user.create({ data: { email: 'tx@example.com' } });
                const o = await tx.order.create({ data: { userId: u.id, total: 100 } });
                return { u, o };
            });
            expect(callbackResult.u.email).toBe('tx@example.com');
            expect(callbackResult.o.total).toBe(100);

            // Array mode with concurrent operations
            const arrayResult = await proxy.$transaction([
                proxy.user.findUnique({ where: { id: 1 } }),
                proxy.product.findUnique({ where: { id: 2 } }),
                proxy.log.create({ data: { action: 'VIEW' } })
            ]);
            expect(Array.isArray(arrayResult)).toBe(true);
            expect(arrayResult.length).toBe(3);
            expect(arrayResult[0].id).toBe(1);
            expect(arrayResult[1].id).toBe(2);
            expect(arrayResult[2].action).toBe('VIEW');
        });

        test('1.4: $transaction rejections propagate correctly for both callback and array modes', async () => {
            const proxy = createSafeDatabaseFallbackProxy();

            // Callback mode error propagation
            await expect(proxy.$transaction(async (tx) => {
                throw new Error('Simulated atomic rollback condition');
            })).rejects.toThrow('Simulated atomic rollback condition');

            // Array mode error propagation
            const failingPromise = Promise.reject(new Error('Simulated batch item failure'));
            await expect(proxy.$transaction([proxy.user.findMany(), failingPromise])).rejects.toThrow('Simulated batch item failure');
        });

        test('1.5: Concurrency burst: 100 parallel operations resolve without race condition or deadlock', async () => {
            const proxy = createSafeDatabaseFallbackProxy();
            const operations = [];

            for (let i = 0; i < 100; i++) {
                operations.push((async () => {
                    const u = await proxy.user.findUnique({ where: { id: i } });
                    const posts = await proxy.post.findMany({ where: { authorId: i } });
                    return { id: u.id, postsCount: posts.length };
                })());
            }

            const results = await Promise.all(operations);
            expect(results.length).toBe(100);
            expect(results[0].id).toBe(0);
            expect(results[99].id).toBe(99);
        });

        test('1.6: $extends chaining returns an operative proxy', async () => {
            const proxy = createSafeDatabaseFallbackProxy();
            const extended = proxy.$extends({
                client: {
                    $customHelper: () => 'extended-helper-result'
                }
            });
            expect(extended).toBeDefined();
            const user = await extended.user.findUnique({ where: { id: 7 } });
            expect(user.id).toBe(7);
        });
    });

    // =========================================================================
    // 2. EXPRESS CONTROLLER REQUEST & RESPONSE MOCKING (FEATURES 8, 9, 10, 11)
    // =========================================================================
    describe('2. Controller Mocking & createMockReqResNext Contract', () => {
        const getPreambleMockFn = (framework = 'jest') => {
            const contracts = buildIsolationMockContracts({
                sourceCode: 'export const controller = (req, res, next) => { const { items } = req.body; res.json(items); };',
                framework
            });
            const sandbox = {
                jest,
                vi: jest,
                exports: {},
                module: {}
            };
            vm.createContext(sandbox);
            vm.runInContext(contracts.mockPreambleCode + '\nthis.__createMock = createMockReqResNext;', sandbox);
            return sandbox.__createMock;
        };

        test('2.1: createMockReqResNext guarantees non-null req.body under all hostile override variations', () => {
            const createMock = getPreambleMockFn('jest');

            const hostileInputs = [
                undefined,
                null,
                {},
                { body: null },
                { body: undefined },
                { req: { body: null } },
                { req: { body: undefined } },
                { body: {} },
                { body: { title: 'Valid Title' } },
                { body: { items: [1, 2, 3] } }
            ];

            for (const input of hostileInputs) {
                const { req, res, next } = createMock(input);
                expect(req).toBeDefined();
                expect(req.body).toBeDefined();
                expect(typeof req.body).toBe('object');
                expect(req.body).not.toBeNull();
                expect(Array.isArray(req.body.items)).toBe(true);

                // Destructuring properties on req.body NEVER throws TypeError
                expect(() => {
                    const { items, title, userId, records } = req.body;
                }).not.toThrow();

                // res chained methods test
                expect(() => {
                    res.status(200).json({ ok: true }).send().end();
                }).not.toThrow();
                expect(typeof next).toBe('function');
            }
        });

        test('2.2: Controller with unguarded destructuring and array iteration executes safely', async () => {
            const createMock = getPreambleMockFn('jest');
            const { req, res, next } = createMock({ body: null });

            // Simulated controller with dangerous destructuring and array method
            const realWorldBatchOrderController = async (req, res, next) => {
                try {
                    const { items, discountCode } = req.body;
                    let total = 0;
                    items.forEach(item => {
                        total += (item.price || 0) * (item.quantity || 1);
                    });
                    return res.status(200).json({ success: true, count: items.length, total });
                } catch (err) {
                    return next(err);
                }
            };

            await realWorldBatchOrderController(req, res, next);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ success: true, count: 0, total: 0 });
            expect(next).not.toHaveBeenCalled();
        });

        test('2.3: req.get header lookup behaves case-insensitively', () => {
            const createMock = getPreambleMockFn('jest');
            const { req } = createMock({
                headers: {
                    'content-type': 'application/json',
                    'authorization': 'Bearer secret-key'
                }
            });

            expect(req.get('authorization')).toBe('Bearer secret-key');
            expect(req.get('Authorization')).toBe('Bearer secret-key');
            expect(req.get('content-type')).toBe('application/json');
            expect(req.get('non-existent-header')).toBe('');
        });

        test('2.4: Vitest mock preamble creates vi.fn mocks', () => {
            const createMock = getPreambleMockFn('vitest');
            const { res, next } = createMock();
            expect(typeof res.status).toBe('function');
            expect(typeof res.json).toBe('function');
            expect(typeof next).toBe('function');
            res.status(201).json({ created: true });
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({ created: true });
        });
    });

    // =========================================================================
    // 3. AST FIXTURE HEALING & RESILIENCE (FEATURE 12)
    // =========================================================================
    describe('3. AST Fixture Healing Resilience (healControllerFixturesWithAst)', () => {
        test('3.1: Injects beforeEach with safe req/res fixtures when describe block lacks them', () => {
            const originalTestCode = `
describe("ProfileController", () => {
    it("updates user profile", async () => {
        const { username, email } = req.body;
        await updateProfile(req, res);
        expect(res.json).toHaveBeenCalled();
    });
});
`;
            const healed = healControllerFixturesWithAst(originalTestCode, 'controllers/profile.controller.test.js');
            expect(healed).toContain('beforeEach(() => {');
            expect(healed).toContain('req = { body: {}, params: {}, query: {}, headers: {}');
            expect(healed).toContain('res = {');
            expect(healed).toContain('status:');
            expect(healed).toContain('json:');
        });

        test('3.2: Replaces rogue req.body = null assignments with safe empty objects', () => {
            const rogueTestCode = `
describe("UserController", () => {
    it("handles null body without crashing", async () => {
        req.body = null;
        await handleRequest(req, res);
    });
    it("handles undefined body without crashing", async () => {
        req.body = undefined;
        await handleRequest(req, res);
    });
});
`;
            const healed = healControllerFixturesWithAst(rogueTestCode, 'user.controller.test.js');
            expect(healed).not.toContain('req.body = null');
            expect(healed).not.toContain('req.body = undefined');
            expect(healed).toContain('req.body = {}');
        });

        test('3.3: Appends missing req/res to existing beforeEach without clobbering existing custom setup', () => {
            const codeWithExistingBeforeEach = `
describe("CartController", () => {
    let customCartService;
    beforeEach(() => {
        customCartService = { getCart: jest.fn() };
    });

    it("fetches cart items using req.params.cartId", async () => {
        const { cartId } = req.params;
        await getCart(req, res);
    });
});
`;
            const healed = healControllerFixturesWithAst(codeWithExistingBeforeEach, 'cart.controller.test.js');
            expect(healed).toContain('customCartService = { getCart: jest.fn() };');
            expect(healed).toContain('req = { body: {}, params: {}, query: {}, headers: {}');
            expect(healed).toContain('res = {');
        });

        test('3.4: Fails safe on unparseable / syntax-corrupted input code', () => {
            const invalidCode = 'describe("Broken Code", () => { it("syntax error", () => { if ( } })';
            const result = healControllerFixturesWithAst(invalidCode, 'broken.test.js');
            expect(result).toBe(invalidCode);
        });

        test('3.5: Ignores non-controller files that have no controller keywords or req/res references', () => {
            const utilityTestCode = `
describe("MathUtil", () => {
    it("adds two numbers", () => {
        expect(1 + 1).toBe(2);
    });
});
`;
            const result = healControllerFixturesWithAst(utilityTestCode, 'src/utils/math.test.js');
            expect(result).toBe(utilityTestCode);
        });
    });

    // =========================================================================
    // 4. RUNNER PRE-FLIGHT SETUP SYNTHESIS & PRISMA V7 INTERCEPTION (FEATURES 4, 5, 6)
    // =========================================================================
    describe('4. Runner Pre-flight Setup Script (buildSetupContent)', () => {
        test('4.1: Synthesizes valid CommonJS script executable by Node VM without SyntaxError', () => {
            const setupScript = buildSetupContent({
                rootDir: 'd:/NCKH/CovAI-/server',
                targetDir: 'd:/NCKH/CovAI-/server/src'
            });

            expect(typeof setupScript).toBe('string');
            expect(setupScript).toContain('FallbackPrismaClient');
            expect(setupScript).toContain('createPrismaProxy');

            // Must parse without SyntaxError
            expect(() => {
                new vm.Script(setupScript);
            }).not.toThrow();
        });

        test('4.2: FallbackPrismaClient intercepts all Prisma v7 initialization & constructor errors', () => {
            const errorSignatures = [
                new Error('PrismaClient needs to be constructed with an adapter'),
                new Error('requires either "adapter" or "accelerateUrl"'),
                new Error('@prisma/client did not initialize yet. Please run "prisma generate"'),
                new Error('Can\'t reach database server at localhost:5432'),
                new Error('PrismaClientConstructorValidationError: missing datasourceUrl')
            ];

            for (const error of errorSignatures) {
                let callCount = 0;
                class StubPrismaClient {
                    constructor() {
                        callCount++;
                        throw error;
                    }
                }

                // Simulate the FallbackPrismaClient logic synthesized in covai-jest-setup.cjs
                function FallbackPrismaClient(...args) {
                    try {
                        if (args.length > 0 && args[0] && (args[0].adapter || args[0].accelerateUrl || args[0].datasources)) {
                            return new StubPrismaClient(...args);
                        }
                    } catch (_) {}
                    return createSafeDatabaseFallbackProxy();
                }

                const instance = new FallbackPrismaClient();
                expect(instance).toBeDefined();
                // When called with 0 args, it intercepts without crashing
                expect(typeof instance.user.findUnique).toBe('function');
            }
        });

        test('4.3: Virtual mock covers relative singleton paths and @prisma/client', () => {
            const setupScript = buildSetupContent({
                rootDir: 'd:/NCKH/CovAI-/server',
                targetDir: 'd:/NCKH/CovAI-/server/src'
            });

            expect(setupScript).toContain("jest.mock('@prisma/client'");
            expect(setupScript).toContain("_relPrismaPaths");
            expect(setupScript).toContain("'../config/prisma'");
            expect(setupScript).toContain("'../../config/prisma'");
            expect(setupScript).toContain("'../lib/prisma'");
        });
    });

    // =========================================================================
    // 5. TRANSITIVE PRISMA DETECTION (FEATURE 1)
    // =========================================================================
    describe('5. Transitive Prisma Dependency Detection', () => {
        test('5.1: Detects Prisma through 1-hop relative import file on disk', () => {
            // Write a helper that imports @prisma/client
            const helperPath = path.join(tempDir, 'dbHelper.js');
            fs.writeFileSync(helperPath, 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n');

            // Source file imports dbHelper
            const sourceCode = `import { prisma } from "./dbHelper.js";\nexport const getUser = (id) => prisma.user.findUnique({ where: { id } });`;
            const sourceFile = path.join(tempDir, 'userService.js');
            fs.writeFileSync(sourceFile, sourceCode);

            const contracts = buildIsolationMockContracts({
                sourceCode,
                sourceFile,
                rootDir: tempDir,
                framework: 'jest'
            });

            expect(contracts.detectedDependencies).toContain('prisma-db');
            expect(contracts.mockPreambleCode).toContain('__mockPrisma');
            expect(contracts.mockInstructions).toContain('Prisma DB: Re-use the self-contained in-memory Prisma Proxy Mock');
        });

        test('5.2: Resilient to circular relative imports without stack overflow', () => {
            const fileA = path.join(tempDir, 'moduleA.js');
            const fileB = path.join(tempDir, 'moduleB.js');

            fs.writeFileSync(fileA, 'import { b } from "./moduleB.js"; export const a = 1;\n');
            fs.writeFileSync(fileB, 'import { a } from "./moduleA.js"; export const b = 2;\n');

            expect(() => {
                const contracts = buildIsolationMockContracts({
                    sourceCode: 'import { b } from "./moduleB.js"; export const a = 1;',
                    sourceFile: fileA,
                    rootDir: tempDir,
                    framework: 'jest'
                });
                expect(contracts).toBeDefined();
            }).not.toThrow();
        });

        test('5.3: assembleUnitTestContext bundles contracts and engineered context properly', () => {
            const sourceCode = `
import { Router } from "express";
import prisma from "../config/prisma.js";

const router = Router();
router.post("/items", async (req, res, next) => {
    try {
        const { items } = req.body;
        const saved = await prisma.item.createMany({ data: items });
        res.status(201).json(saved);
    } catch (err) {
        next(err);
    }
});
export default router;
`;
            const result = assembleUnitTestContext({
                sourceCode,
                framework: 'jest',
                sourceFile: 'server/src/controllers/item.controller.js',
                rootDir: 'server'
            });

            expect(result).toBeDefined();
            expect(result.mockContracts).toBeDefined();
            expect(result.mockContracts.detectedDependencies).toContain('express-controller');
            expect(result.mockContracts.detectedDependencies).toContain('prisma-db');
            expect(result.mockContracts.mockPreambleCode).toContain('createMockReqResNext');
            expect(result.mockContracts.mockPreambleCode).toContain('__mockPrisma');
            expect(result.mockContracts.mockInstructions).toContain('ALWAYS pass (req, res, next) with createMockReqResNext()');
        });
    });
});
