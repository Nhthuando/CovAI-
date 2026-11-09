import { describe, test, expect, jest } from "@jest/globals";
import vm from "vm";
import { createRequire } from "module";
import * as babel from "@babel/core";
import { buildIsolationMockContracts, assembleUnitTestContext } from "../services/unitTestContextEngineering.service.js";

const require = createRequire(import.meta.url);

describe("Milestone M1 Challenger: Empirical Hoisting and Prisma Mock Harness", () => {
    // -------------------------------------------------------------------------
    // 1. Generation & Ast / Babel Hoisting Verification
    // -------------------------------------------------------------------------
    describe("1. Hoisting Safety & ReferenceError Isolation in Jest", () => {
        test("buildIsolationMockContracts generates mock code without unhoisted outer variables", () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "import { PrismaClient } from '@prisma/client';\nconst prisma = new PrismaClient();",
                framework: "jest"
            });

            expect(contracts.detectedDependencies).toContain("prisma-db");
            expect(contracts.mockPreambleCode).toBeTruthy();

            // Transform code containing preamble with babel-plugin-jest-hoist
            const fullFileCode = `
                const myUnhoistedServiceConfig = { dbTimeout: 5000 };
                ${contracts.mockPreambleCode}
                const { PrismaClient } = require('@prisma/client');
                const client = new PrismaClient();
            `;

            let transformed;
            expect(() => {
                transformed = babel.transformSync(fullFileCode, {
                    plugins: [
                        require.resolve("babel-plugin-jest-hoist")
                    ],
                    configFile: false,
                    babelrc: false
                });
            }).not.toThrow();

            expect(transformed && transformed.code).toBeTruthy();
            
            // Hoisted code should place jest.mock calls before myUnhoistedServiceConfig
            const hoistedCode = transformed.code;
            console.log("HOISTED CODE PREVIEW:\n", hoistedCode.slice(0, 400));
            const mockIndex = hoistedCode.indexOf(".mock('@prisma/client'");
            const unhoistedVarIndex = hoistedCode.indexOf("myUnhoistedServiceConfig");
            expect(mockIndex).toBeGreaterThan(-1);
            expect(unhoistedVarIndex).toBeGreaterThan(-1);
            expect(mockIndex).toBeLessThan(unhoistedVarIndex);
        });

        test("Jest mock factory executes inside isolated Node VM without ReferenceErrors", () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "import { PrismaClient } from '@prisma/client';",
                framework: "jest"
            });

            const jestMockRegistry = new Map();
            const mockJest = {
                fn: (impl) => {
                    const fn = function (...args) {
                        fn.mock.calls.push(args);
                        return impl ? impl.apply(this, args) : undefined;
                    };
                    fn.mock = { calls: [] };
                    fn.mockImplementation = (newImpl) => mockJest.fn(newImpl);
                    fn.mockResolvedValue = (val) => mockJest.fn(() => Promise.resolve(val));
                    fn.mockReturnValue = (val) => mockJest.fn(() => val);
                    fn.mockReturnThis = () => mockJest.fn(function () { return this; });
                    return fn;
                },
                mock: (modulePath, factory, options) => {
                    jestMockRegistry.set(modulePath, factory);
                }
            };

            const sandbox = {
                jest: mockJest,
                globalThis: {},
                console,
                Promise,
                Map,
                Proxy,
                Date,
                Array
            };
            sandbox.globalThis = sandbox;

            const vmContext = vm.createContext(sandbox);

            // Execute the mock preamble in isolated VM
            expect(() => {
                vm.runInContext(contracts.mockPreambleCode, vmContext);
            }).not.toThrow();

            // Check that @prisma/client is registered
            expect(jestMockRegistry.has("@prisma/client")).toBe(true);

            // Trigger mock factory execution (as Jest would do on require('@prisma/client'))
            const factory = jestMockRegistry.get("@prisma/client");
            let exportsResult;
            expect(() => {
                exportsResult = factory();
            }).not.toThrow();

            expect(exportsResult).toBeDefined();
            expect(typeof exportsResult.PrismaClient).toBe("function");

            const instance = exportsResult.PrismaClient();
            expect(instance).toBeDefined();
        });
    });

    // -------------------------------------------------------------------------
    // 2. Chainability and Awaitability of Prisma Proxy Mock Methods
    // -------------------------------------------------------------------------
    describe("2. Prisma Proxy Mock Chainability & Awaitability", () => {
        const createJestMockEnvironment = () => {
            const registry = new Map();
            const mockJest = {
                fn: (impl) => {
                    const fn = function (...args) {
                        fn.mock.calls.push(args);
                        return impl ? impl.apply(this, args) : undefined;
                    };
                    fn.mock = { calls: [] };
                    fn.mockImplementation = (newImpl) => mockJest.fn(newImpl);
                    fn.mockResolvedValue = (val) => mockJest.fn(() => Promise.resolve(val));
                    fn.mockReturnValue = (val) => mockJest.fn(() => val);
                    fn.mockReturnThis = () => mockJest.fn(function () { return this; });
                    return fn;
                },
                mock: (modulePath, factory, options) => {
                    registry.set(modulePath, factory);
                }
            };
            const sandbox = {
                jest: mockJest,
                console,
                Promise,
                Map,
                Proxy,
                Date,
                Array
            };
            sandbox.globalThis = sandbox;
            return { registry, sandbox };
        };

        test("PrismaClient instance has awaitable and chainable $transaction, $connect, $disconnect, $queryRaw, $extends", async () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "import prisma from '../config/prisma.js';",
                framework: "jest"
            });

            const { registry, sandbox } = createJestMockEnvironment();
            vm.runInNewContext(contracts.mockPreambleCode, sandbox);

            const prismaClientFactory = registry.get("@prisma/client");
            const prismaMod = prismaClientFactory();
            const client = prismaMod.PrismaClient();

            // 1. $connect & $disconnect
            await expect(client.$connect()).resolves.toBeUndefined();
            await expect(client.$disconnect()).resolves.toBeUndefined();

            // 2. $queryRaw & $executeRaw
            const rawResult = await client.$queryRaw`SELECT * FROM users`;
            expect(Array.isArray(rawResult)).toBe(true);

            const execResult = await client.$executeRaw`UPDATE users SET active = 1`;
            expect(typeof execResult).toBe("number");

            // 3. $extends
            const extended = client.$extends({});
            expect(extended).toBeDefined();

            // 4. $transaction with array of promises
            const txArrayResult = await client.$transaction([
                client.user.findUnique({ where: { id: 1 } }),
                client.order.findMany()
            ]);
            expect(Array.isArray(txArrayResult)).toBe(true);
            expect(txArrayResult.length).toBe(2);

            // 5. $transaction with async callback function
            const txCallbackResult = await client.$transaction(async (tx) => {
                const u = await tx.user.findUnique({ where: { id: 1 } });
                const o = await tx.order.create({ data: { userId: u.id, total: 100 } });
                return { user: u, order: o };
            });
            expect(txCallbackResult).toBeDefined();
            expect(txCallbackResult.user).toBeDefined();
            expect(txCallbackResult.order).toBeDefined();

            // 6. Arbitrary model queries
            const userUnique = await client.user.findUnique({ where: { id: 123 } });
            expect(userUnique).toBeDefined();
            expect(userUnique.id).toBe(1);

            const orders = await client.order.findMany({ where: { userId: 123 } });
            expect(Array.isArray(orders)).toBe(true);

            const createdOrder = await client.order.create({ data: { name: "New Order" } });
            expect(createdOrder.name).toBe("New Order");

            const count = await client.user.count();
            expect(count).toBe(1);
        });

        test("STRESS TEST: Fallback proxy in Section 2 relative mocks lacks deep model proxies and $transaction execution when __mockPrisma is uninitialized", async () => {
            // Test the exact fallback proxy structure generated in Section 2 lines 1302-1304:
            // const p = (typeof globalThis !== 'undefined' && globalThis.__mockPrisma) || new Proxy({}, {
            //   get: (target, prop) => (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') ? undefined : (target[prop] || (target[prop] = jest.fn().mockResolvedValue({ id: 1, name: 'Sample' })))
            // });
            const uninitializedFallbackProxy = new Proxy({}, {
                get: (target, prop) => (prop === 'then' || prop === 'catch' || typeof prop === 'symbol')
                    ? undefined
                    : (target[prop] || (target[prop] = jest.fn().mockResolvedValue({ id: 1, name: 'Sample' })))
            });

            // 1. Model query method failure: prisma.user.findUnique(...)
            let findUniqueError = null;
            try {
                uninitializedFallbackProxy.user.findUnique({ where: { id: 1 } });
            } catch (err) {
                findUniqueError = err;
            }
            expect(findUniqueError).not.toBeNull();
            expect(findUniqueError.message).toContain("is not a function");

            // 2. $transaction callback is ignored and never executed:
            let callbackInvoked = false;
            await uninitializedFallbackProxy.$transaction(async (tx) => {
                callbackInvoked = true;
            });
            expect(callbackInvoked).toBe(false);
        });

        test("STRESS TEST: Relative path mock when imported BEFORE @prisma/client", async () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "import prisma from '../lib/prisma.js';",
                framework: "jest"
            });

            const { registry, sandbox } = createJestMockEnvironment();
            vm.runInNewContext(contracts.mockPreambleCode, sandbox);

            // Simulate importing '../lib/prisma.js' WITHOUT requiring '@prisma/client' first
            const relativeFactory = registry.get("../lib/prisma.js");
            expect(relativeFactory).toBeDefined();

            const importedMod = relativeFactory();
            const prisma = importedMod.prisma || importedMod.default;
            expect(prisma).toBeDefined();

            // Test if arbitrary model queries work on this imported prisma instance
            let queryResult;
            let error = null;
            try {
                queryResult = await prisma.user.findUnique({ where: { id: 10 } });
            } catch (err) {
                error = err;
            }

            console.log("Relative mock before @prisma/client result:", { queryResult, error: error?.message });
            expect(error).toBeNull();
            expect(queryResult).toBeDefined();
        });

        test("STRESS TEST: Arbitrary model and unlisted methods (findUniqueOrThrow, findFirstOrThrow)", async () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "import { PrismaClient } from '@prisma/client';",
                framework: "jest"
            });

            const { registry, sandbox } = createJestMockEnvironment();
            vm.runInNewContext(contracts.mockPreambleCode, sandbox);

            const client = registry.get("@prisma/client")().PrismaClient();

            // Check methods that Prisma v5/v6/v7 has, but might not be in a static mock
            let orThrowError = null;
            try {
                await client.user.findUniqueOrThrow({ where: { id: 1 } });
            } catch (err) {
                orThrowError = err;
            }
            console.log("findUniqueOrThrow test error:", orThrowError?.message);

            // Check arbitrary dynamic model
            let customModelResult;
            let customModelError = null;
            try {
                customModelResult = await client.arbitraryCustomAuditLogModel.findMany();
            } catch (err) {
                customModelError = err;
            }
            console.log("customModelResult:", customModelResult, "error:", customModelError?.message);
            expect(customModelError).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // 3. Regression Checks on Existing Backend Test Suites
    // -------------------------------------------------------------------------
    describe("3. Regression Checks on Existing Tests", () => {
        test("contracts.mockPreambleCode satisfies businessLogicEdgeCasesMatrix assertions", () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "import prisma from '../config/prisma.js'; export async function testOrder() { return await prisma.$transaction(async (tx) => tx.user.findUnique({ where: { id: 1 } })); }",
                framework: "jest"
            });

            // Check the exact assertions from businessLogicEdgeCasesMatrix.test.js:
            // expect(contracts.mockPreambleCode).toContain("_createPrismaProxyMock");
            // expect(contracts.mockPreambleCode).toContain("$transaction");
            // expect(contracts.mockPreambleCode).toContain("findMany");
            // expect(contracts.mockPreambleCode).toContain("jest.mock('../config/prisma.js'");
            const containsPrismaProxyMock = contracts.mockPreambleCode.includes("_createPrismaProxyMock");
            console.log("contracts.mockPreambleCode contains _createPrismaProxyMock:", containsPrismaProxyMock);
            expect(containsPrismaProxyMock).toBe(true);
        });

        test("contracts.mockPreambleCode satisfies verificationTestCases62 assertions", () => {
            const contracts = buildIsolationMockContracts({
                sourceCode: "import prisma from '../config/prisma.js'; export async function testOrder() { return await prisma.$transaction(async (tx) => tx.user.findUnique({ where: { id: 1 } })); }",
                framework: "jest"
            });

            // Check the exact assertions from verificationTestCases62.test.js:
            // expect(mockContracts.mockPreambleCode).toContain("Universal Prisma Proxy Mock");
            const containsUniversalHeader = contracts.mockPreambleCode.includes("Universal Prisma Proxy Mock");
            console.log("contracts.mockPreambleCode contains Universal Prisma Proxy Mock:", containsUniversalHeader);
            expect(containsUniversalHeader).toBe(true);
        });
    });
});
