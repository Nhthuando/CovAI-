import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execSync } from 'node:child_process';
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { buildSetupContent } from '../services/runTestsJob.service.js';
import { createSafeDatabaseFallbackProxy } from './helpers/databaseSafetySetup.js';
import prisma, { setPrismaClient } from '../config/prisma.js';

describe('Challenger M2: Empirical Runner Pre-flight Setup & Prisma Fallback Mocking', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-m2-challenger-'));
    });

    afterEach(() => {
        setPrismaClient(null);
        if (tempDir && fs.existsSync(tempDir)) {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
        }
    });

    // =========================================================================
    // 1. CommonJS Syntax & AST Validation of buildSetupContent
    // =========================================================================
    describe('1. Syntax & Structural Content Validation of buildSetupContent()', () => {
        test('generates valid CommonJS script syntax executable by Node VM without SyntaxError', () => {
            const setupScript = buildSetupContent({
                rootDir: tempDir,
                targetDir: tempDir,
                hermeticMocks: {
                    PORT: '8080',
                    MOCK_DB_URL: 'postgresql://user:pass@localhost:5432/test?schema=public',
                    NESTED_QUOTES: '"quoted" and \'single\''
                }
            });

            expect(typeof setupScript).toBe('string');
            expect(setupScript.length).toBeGreaterThan(1000);

            // Verify syntax compilation in Node VM Script
            expect(() => {
                new vm.Script(setupScript, { filename: 'covai-jest-setup.cjs' });
            }).not.toThrow();
        });

        test('contains FallbackPrismaClient wrapper and createPrismaProxy definitions', () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            expect(setupScript).toContain('FallbackPrismaClient');
            expect(setupScript).toContain('createPrismaProxy');
            expect(setupScript).toContain('OriginalPrismaClient');
            expect(setupScript).toContain('prismaPkg = require(\'@prisma/client\');');
            expect(setupScript).toContain('prismaPkg.PrismaClient = FallbackPrismaClient;');
        });

        test('contains Prisma v7 initialization and constructor error pattern detectors', () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            expect(setupScript).toContain('PrismaClientInitializationError');
            expect(setupScript).toContain('PrismaClientConstructorValidationError');
            expect(setupScript).toContain('needs to be constructed with');
            expect(setupScript).toContain('requires either "adapter"');
        });

        test('contains Jest virtual mock registrations for @prisma/client and relative singletons', () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            expect(setupScript).toContain('jest.mock(\'@prisma/client\'');
            expect(setupScript).toContain('\'../lib/prisma\'');
            expect(setupScript).toContain('\'../../lib/prisma\'');
            expect(setupScript).toContain('\'../config/prisma\'');
            expect(setupScript).toContain('\'../../config/prisma\'');
            expect(setupScript).toContain('\'../src/config/prisma\'');
            expect(setupScript).toContain('setPrismaClient: () => {}');
        });
    });

    // =========================================================================
    // 2. VM Context Evaluation (Simulated Environment)
    // =========================================================================
    describe('2. VM Context Evaluation with Simulated Prisma v7', () => {
        test('new PrismaClient() without arguments does NOT throw and returns proxy client with working methods', async () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            let originalCalls = 0;
            const fakeOriginalPrisma = function(...args) {
                originalCalls++;
                const err = new Error('`PrismaClient` needs to be constructed with a non-empty, valid `PrismaClientOptions`');
                err.name = 'PrismaClientInitializationError';
                throw err;
            };

            const fakePrismaPkg = { PrismaClient: fakeOriginalPrisma };

            const sandbox = {
                require: (id) => {
                    if (id === '@prisma/client') return fakePrismaPkg;
                    return require(id);
                },
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            const context = vm.createContext(sandbox);
            vm.runInContext(setupScript, context);

            // After setup execution, PrismaClient is wrapped
            expect(fakePrismaPkg.PrismaClient).not.toBe(fakeOriginalPrisma);

            // Instantiating with NO arguments must NOT throw
            let client;
            expect(() => {
                client = new fakePrismaPkg.PrismaClient();
            }).not.toThrow();

            expect(client).toBeDefined();

            // Check $connect & $disconnect
            await expect(client.$connect()).resolves.toBeUndefined();
            await expect(client.$disconnect()).resolves.toBeUndefined();

            // Check model queries
            const userResult = await client.user.findUnique({ where: { id: 123 } });
            expect(userResult).toBeDefined();

            const postList = await client.post.findMany({ where: { published: true } });
            expect(postList).toBeDefined();

            const newOrder = await client.order.create({ data: { amount: 99.5 } });
            expect(newOrder).toBeDefined();

            // Check $transaction callback
            const txCallbackResult = await client.$transaction(async (tx) => {
                const u = await tx.user.findFirst();
                return { u, txActive: true };
            });
            expect(txCallbackResult).toEqual(expect.objectContaining({ txActive: true }));

            // Check $transaction array
            const txArrayResult = await client.$transaction([
                Promise.resolve({ step: 1 }),
                Promise.resolve({ step: 2 })
            ]);
            expect(txArrayResult).toEqual([{ step: 1 }, { step: 2 }]);

            // Check $queryRaw
            const rawResult = await client.$queryRaw`SELECT 1 as val`;
            expect(rawResult).toBeDefined();

            // Check $extends
            const extendedClient = client.$extends({});
            expect(extendedClient).toBeDefined();
            expect(typeof extendedClient.user.findMany).toBe('function');

            // Check safe promise handling (then/catch must be undefined)
            expect(client.then).toBeUndefined();
            expect(client.catch).toBeUndefined();
            expect(client.finally).toBeUndefined();
        });

        test('new PrismaClient({ adapter: mockAdapter }) correctly delegates to original constructor', () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            const receivedArgs = [];
            const fakeOriginalPrisma = function(...args) {
                if (args.length === 0) {
                    const err = new Error('Needs non-empty valid PrismaClientOptions');
                    err.name = 'PrismaClientInitializationError';
                    throw err;
                }
                receivedArgs.push(args);
                this.isOriginalInstance = true;
                this.passedAdapter = args[0]?.adapter;
            };

            const fakePrismaPkg = { PrismaClient: fakeOriginalPrisma };

            const sandbox = {
                require: (id) => {
                    if (id === '@prisma/client') return fakePrismaPkg;
                    return require(id);
                },
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            const context = vm.createContext(sandbox);
            vm.runInContext(setupScript, context);

            const mockAdapter = { name: 'mock-pg-adapter', provider: 'postgres' };
            const client = new fakePrismaPkg.PrismaClient({ adapter: mockAdapter });

            expect(client).toBeInstanceOf(fakeOriginalPrisma);
            expect(client.isOriginalInstance).toBe(true);
            expect(client.passedAdapter).toBe(mockAdapter);
            expect(receivedArgs.length).toBe(1);
            expect(receivedArgs[0][0]).toEqual({ adapter: mockAdapter });
        });

        test('new PrismaClient({ accelerateUrl: ... }) and ({ datasources: ... }) delegate to original constructor', () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            const capturedCalls = [];
            const fakeOriginalPrisma = function(...args) {
                if (args.length === 0) {
                    const err = new Error('Needs non-empty valid PrismaClientOptions');
                    err.name = 'PrismaClientInitializationError';
                    throw err;
                }
                capturedCalls.push(args[0]);
                this.config = args[0];
            };

            const fakePrismaPkg = { PrismaClient: fakeOriginalPrisma };

            const sandbox = {
                require: (id) => {
                    if (id === '@prisma/client') return fakePrismaPkg;
                    return require(id);
                },
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            const context = vm.createContext(sandbox);
            vm.runInContext(setupScript, context);

            const clientAccelerate = new fakePrismaPkg.PrismaClient({ accelerateUrl: 'prisma://accelerate.net' });
            expect(clientAccelerate).toBeInstanceOf(fakeOriginalPrisma);
            expect(clientAccelerate.config.accelerateUrl).toBe('prisma://accelerate.net');

            const clientDatasources = new fakePrismaPkg.PrismaClient({ datasources: { db: { url: 'file:./dev.db' } } });
            expect(clientDatasources).toBeInstanceOf(fakeOriginalPrisma);
            expect(clientDatasources.config.datasources.db.url).toBe('file:./dev.db');

            expect(capturedCalls.length).toBe(2);
        });

        test('new PrismaClient({}) with empty object catches constructor error and safely falls back to proxy', () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            const fakeOriginalPrisma = function(...args) {
                if (args.length === 0) {
                    const err = new Error('needs to be constructed with non-empty');
                    err.name = 'PrismaClientInitializationError';
                    throw err;
                }
                // When empty object is passed, Prisma v7 throws ConstructorValidationError
                if (!args[0].adapter && !args[0].accelerateUrl && !args[0].datasources) {
                    const err = new Error('Using engine type "client" requires either "adapter" or "accelerateUrl"');
                    err.name = 'PrismaClientConstructorValidationError';
                    throw err;
                }
                this.valid = true;
            };

            const fakePrismaPkg = { PrismaClient: fakeOriginalPrisma };

            const sandbox = {
                require: (id) => {
                    if (id === '@prisma/client') return fakePrismaPkg;
                    return require(id);
                },
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            const context = vm.createContext(sandbox);
            vm.runInContext(setupScript, context);

            // Empty options: must NOT throw, must return proxy
            let clientEmpty;
            expect(() => {
                clientEmpty = new fakePrismaPkg.PrismaClient({});
            }).not.toThrow();

            expect(clientEmpty).toBeDefined();
            expect(typeof clientEmpty.account.findFirst).toBe('function');
        });
    });

    // =========================================================================
    // 3. Evaluation in Separate Node Child Process (Real @prisma/client v7)
    // =========================================================================
    describe('3. Isolated Child Process Evaluation with Real @prisma/client v7', () => {
        test('evaluates covai-jest-setup.cjs against real installed @prisma/client v7 package', () => {
            const serverPath = process.cwd().endsWith('server') ? process.cwd() : path.resolve(process.cwd(), 'server');
            const setupScript = buildSetupContent({ rootDir: serverPath });

            // Child process script that requires setup script, then exercises PrismaClient
            const childScript = `
const fs = require('fs');
${setupScript}

const prismaPkg = require('@prisma/client');

async function runChildVerification() {
    const report = {
        constructorWrapped: prismaPkg.PrismaClient.name === 'FallbackPrismaClient',
        noArgsSuccess: false,
        txCallbackSuccess: false,
        txArraySuccess: false,
        connectSuccess: false,
        queryRawSuccess: false,
        modelCallSuccess: false,
        adapterDelegated: false
    };

    console.log('BEGIN_CHILD_SCRIPT');
    // 1. Call new PrismaClient() without args
    let clientNoArgs;
    try {
        clientNoArgs = new prismaPkg.PrismaClient();
        report.noArgsSuccess = true;
    } catch (err) {
        report.noArgsError = { name: err.name, message: err.message };
    }

    if (clientNoArgs) {
        try {
            await clientNoArgs.$connect();
            report.connectSuccess = true;
        } catch (_) {}

        try {
            const txRes = await clientNoArgs.$transaction(async (tx) => {
                return await tx.user.findFirst();
            });
            if (txRes !== undefined) report.txCallbackSuccess = true;
        } catch (_) {}

        try {
            const arrRes = await clientNoArgs.$transaction([Promise.resolve(42)]);
            if (Array.isArray(arrRes) && arrRes[0] === 42) report.txArraySuccess = true;
        } catch (_) {}

        try {
            const rawRes = await clientNoArgs.$queryRaw(['SELECT 1']);
            if (rawRes !== undefined) report.queryRawSuccess = true;
        } catch (_) {}

        try {
            const modelRes = await clientNoArgs.project.findUnique({ where: { id: 'p1' } });
            if (modelRes !== undefined) report.modelCallSuccess = true;
        } catch (_) {}
    }

    // 2. Call new PrismaClient({ adapter: mockAdapter })
    try {
        const mockAdapter = { name: 'mock-pg', provider: 'postgres', adapterName: '@prisma/adapter-pg' };
        const clientWithAdapter = new prismaPkg.PrismaClient({ adapter: mockAdapter });
        // Real Prisma constructor was invoked if clientWithAdapter is created or throws Prisma's internal validation
        report.adapterDelegated = clientWithAdapter !== undefined;
    } catch (adapterErr) {
        // If real constructor threw provider validation, it confirms delegation to OriginalPrismaClient!
        if (adapterErr && adapterErr.message && adapterErr.message.includes('Driver Adapter')) {
            report.adapterDelegated = true;
        }
    }

    console.log('__CHALLENGER_REPORT__' + JSON.stringify(report));
}

runChildVerification().catch(err => {
    console.error('Fatal child script error:', err);
});
`;

            const runnerFilePath = path.join(tempDir, 'temp_challenger_runner.cjs');
            fs.writeFileSync(runnerFilePath, childScript, 'utf8');

            let output = '';
            try {
                output = execSync(`node "${runnerFilePath}"`, {
                    cwd: serverPath,
                    encoding: 'utf8',
                    timeout: 10000,
                    env: {
                        ...process.env,
                        NODE_PATH: path.join(serverPath, 'node_modules'),
                        NODE_ENV: 'test'
                    }
                });
            } catch (err) {
                console.error('Child exec error stdout:', err.stdout);
                console.error('Child exec error stderr:', err.stderr);
                throw err;
            }

            const reportMatch = output.match(/__CHALLENGER_REPORT__(.*)/);
            expect(reportMatch).not.toBeNull();
            const report = JSON.parse(reportMatch[1].trim());
            expect(report.constructorWrapped).toBe(true);
            expect(report.noArgsSuccess).toBe(true);
            expect(report.connectSuccess).toBe(true);
            expect(report.txCallbackSuccess).toBe(true);
            expect(report.txArraySuccess).toBe(true);
            expect(report.queryRawSuccess).toBe(true);
            expect(report.modelCallSuccess).toBe(true);
            expect(report.adapterDelegated).toBe(true);
        });
    });

    // =========================================================================
    // 4. Jest Virtual Mock Registration & Singleton Paths
    // =========================================================================
    describe('4. Jest Virtual Mocks & Singleton Proxy Resolution', () => {
        test('virtual mocks are registered for relative singleton paths in Jest mock registry', () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            const registeredMockPaths = [];
            const fakeJest = {
                mock: jest.fn((modulePath, factory, options) => {
                    registeredMockPaths.push({ modulePath, options });
                }),
                fn: jest.fn((impl) => {
                    const f = (...args) => (impl ? impl(...args) : undefined);
                    f.mockImplementation = () => f;
                    return f;
                })
            };

            const sandbox = {
                jest: fakeJest,
                global: {},
                globalThis: {},
                process: { ...process, env: { ...process.env } },
                require: () => { throw new Error('Not found'); }
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            const context = vm.createContext(sandbox);
            vm.runInContext(setupScript, context);

            expect(fakeJest.mock).toHaveBeenCalled();
            const modulePaths = registeredMockPaths.map(m => m.modulePath);

            expect(modulePaths).toContain('@prisma/client');
            expect(modulePaths).toContain('../lib/prisma');
            expect(modulePaths).toContain('../config/prisma');
            expect(modulePaths).toContain('../../config/prisma');
            expect(modulePaths).toContain('../src/config/prisma');
            expect(modulePaths).toContain('../../src/config/prisma');

            // All registered relative mocks should have virtual: true
            for (const item of registeredMockPaths) {
                expect(item.options).toEqual({ virtual: true });
            }
        });
    });

    // =========================================================================
    // 5. Backend Safety Setup (databaseSafetySetup.js)
    // =========================================================================
    describe('5. Backend Safety Setup & In-Memory Fallback Proxy', () => {
        test('createSafeDatabaseFallbackProxy provides full CRUD, raw query, and transaction support', async () => {
            const fallbackProxy = createSafeDatabaseFallbackProxy();
            setPrismaClient(fallbackProxy);

            // Test model operations
            const user = await prisma.user.findUnique({ where: { id: 42 } });
            expect(user.id).toBe(42);
            expect(user.status).toBe('ACTIVE');

            const users = await prisma.user.findMany();
            expect(Array.isArray(users)).toBe(true);

            const count = await prisma.user.count();
            expect(count).toBe(0);

            const created = await prisma.item.create({ data: { title: 'Empirical Test Item' } });
            expect(created.title).toBe('Empirical Test Item');

            // Test raw queries
            const raw = await prisma.$queryRaw`SELECT 1`;
            expect(Array.isArray(raw)).toBe(true);

            // Test transaction callback
            const txResult = await prisma.$transaction(async (tx) => {
                const item = await tx.item.findUnique({ where: { id: 99 } });
                return item;
            });
            expect(txResult.id).toBe(99);

            // Test transaction array
            const txArrResult = await prisma.$transaction([
                Promise.resolve('a'),
                Promise.resolve('b')
            ]);
            expect(txArrResult).toEqual(['a', 'b']);

            // Test $connect and $disconnect
            await expect(prisma.$connect()).resolves.toBeUndefined();
            await expect(prisma.$disconnect()).resolves.toBeUndefined();
        });
    });

    // =========================================================================
    // 6. Adversarial Stress & Edge Case Resilience Matrix
    // =========================================================================
    describe('6. Adversarial Stress & Edge Case Resilience', () => {
        test('Edge 1: Multiple successive calls to new PrismaClient() are isolated and functional', () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            const fakeOriginalPrisma = function() {
                const err = new Error('needs to be constructed with non-empty');
                err.name = 'PrismaClientInitializationError';
                throw err;
            };
            const fakePrismaPkg = { PrismaClient: fakeOriginalPrisma };

            const sandbox = {
                require: (id) => (id === '@prisma/client' ? fakePrismaPkg : require(id)),
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            vm.createContext(sandbox);
            vm.runInContext(setupScript, sandbox);

            const c1 = new fakePrismaPkg.PrismaClient();
            const c2 = new fakePrismaPkg.PrismaClient();
            const c3 = new fakePrismaPkg.PrismaClient();

            expect(c1).not.toBe(c2);
            expect(c2).not.toBe(c3);

            expect(typeof c1.user.findFirst).toBe('function');
            expect(typeof c2.order.findMany).toBe('function');
            expect(typeof c3.setting.count).toBe('function');
        });

        test('Edge 2: Chaining & Promise assimilation - Promise.resolve(client) resolves immediately without hanging', async () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            const fakePrismaPkg = {
                PrismaClient: function() {
                    const err = new Error('Constructor initialization error');
                    err.name = 'PrismaClientInitializationError';
                    throw err;
                }
            };

            const sandbox = {
                require: (id) => (id === '@prisma/client' ? fakePrismaPkg : require(id)),
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            vm.createContext(sandbox);
            vm.runInContext(setupScript, sandbox);

            const client = new fakePrismaPkg.PrismaClient();

            // Thenable check: if proxy returned a function for .then, Promise.resolve would loop infinitely
            expect(client.then).toBeUndefined();
            expect(client.catch).toBeUndefined();
            expect(client.finally).toBeUndefined();

            const resolved = await Promise.resolve(client);
            expect(resolved).toBe(client);
        });

        test('Edge 3: Deeply nested properties and method chaining resolve smoothly', async () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            const fakePrismaPkg = {
                PrismaClient: function() {
                    const err = new Error('needs to be constructed with non-empty');
                    err.name = 'PrismaClientInitializationError';
                    throw err;
                }
            };

            const sandbox = {
                require: (id) => (id === '@prisma/client' ? fakePrismaPkg : require(id)),
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            vm.createContext(sandbox);
            vm.runInContext(setupScript, sandbox);

            const client = new fakePrismaPkg.PrismaClient();

            // Chained extensions
            const ext1 = client.$extends({});
            const ext2 = ext1.$extends({});
            const ext3 = ext2.$extends({});

            await expect(ext3.deeply.nested.action()).resolves.toBeDefined();
        });

        test('Edge 4: Static properties and prototype on OriginalPrismaClient are preserved', () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            const fakeOriginalPrisma = function() {
                const err = new Error('needs to be constructed with non-empty');
                err.name = 'PrismaClientInitializationError';
                throw err;
            };
            fakeOriginalPrisma.dmmf = { datamodel: { models: [] } };
            fakeOriginalPrisma.rawSymbol = Symbol('prisma.raw');
            fakeOriginalPrisma.prototype.customHelper = () => 'custom';

            const fakePrismaPkg = { PrismaClient: fakeOriginalPrisma };

            const sandbox = {
                require: (id) => (id === '@prisma/client' ? fakePrismaPkg : require(id)),
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            vm.createContext(sandbox);
            vm.runInContext(setupScript, sandbox);

            // FallbackPrismaClient preserved static properties
            expect(fakePrismaPkg.PrismaClient.dmmf).toEqual({ datamodel: { models: [] } });
            expect(fakePrismaPkg.PrismaClient.rawSymbol).toBe(fakeOriginalPrisma.rawSymbol);
            expect(typeof fakePrismaPkg.PrismaClient.prototype.customHelper).toBe('function');
        });

        test('Edge 5: Uninstalled @prisma/client does not crash the setup script', () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            const sandbox = {
                require: (id) => {
                    const err = new Error(`Cannot find module '${id}'`);
                    err.code = 'MODULE_NOT_FOUND';
                    throw err;
                },
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            // Script must run cleanly without throwing
            expect(() => {
                const context = vm.createContext(sandbox);
                vm.runInContext(setupScript, context);
            }).not.toThrow();
        });

        test('Edge 6: Windows backslash paths in rootDir and targetDir are properly sanitized', () => {
            const windowsPath = 'C:\\Projects\\CovAI\\subdir\\target';
            const setupScript = buildSetupContent({
                rootDir: windowsPath,
                targetDir: windowsPath,
                hermeticMocks: {
                    BACKSLASH_VAR: 'C:\\test\\dir'
                }
            });

            // The generated script must not contain unescaped raw backslashes that cause invalid JS syntax
            expect(() => {
                new vm.Script(setupScript);
            }).not.toThrow();

            // Should have normalized rootDirCandidate
            expect(setupScript).toContain('C:/Projects/CovAI/subdir/target');
        });

        test('Edge 7: $transaction callback error rejection is propagated to caller', async () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            const fakePrismaPkg = {
                PrismaClient: function() {
                    const err = new Error('needs to be constructed with non-empty');
                    err.name = 'PrismaClientInitializationError';
                    throw err;
                }
            };

            const sandbox = {
                require: (id) => (id === '@prisma/client' ? fakePrismaPkg : require(id)),
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            vm.createContext(sandbox);
            vm.runInContext(setupScript, sandbox);

            const client = new fakePrismaPkg.PrismaClient();

            // Transaction callback throwing an error must reject
            await expect(client.$transaction(async (tx) => {
                throw new Error('Transaction simulated failure');
            })).rejects.toThrow('Transaction simulated failure');
        });

        test('Edge 8: $transaction promise array rejection is propagated to caller', async () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            const fakePrismaPkg = {
                PrismaClient: function() {
                    const err = new Error('needs to be constructed with non-empty');
                    err.name = 'PrismaClientInitializationError';
                    throw err;
                }
            };

            const sandbox = {
                require: (id) => (id === '@prisma/client' ? fakePrismaPkg : require(id)),
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            vm.createContext(sandbox);
            vm.runInContext(setupScript, sandbox);

            const client = new fakePrismaPkg.PrismaClient();

            // Array with rejected promise must reject
            await expect(client.$transaction([
                Promise.resolve(1),
                Promise.reject(new Error('Array operation failed'))
            ])).rejects.toThrow('Array operation failed');
        });

        test('Edge 9: Double setup execution is idempotent and does not nest FallbackPrismaClient', () => {
            const setupScript = buildSetupContent({ rootDir: tempDir });

            let originalInstantiations = 0;
            const fakeOriginalPrisma = function() {
                originalInstantiations++;
                const err = new Error('needs to be constructed with non-empty');
                err.name = 'PrismaClientInitializationError';
                throw err;
            };

            const fakePrismaPkg = { PrismaClient: fakeOriginalPrisma };

            const sandbox = {
                require: (id) => (id === '@prisma/client' ? fakePrismaPkg : require(id)),
                process: { ...process, env: { ...process.env } },
                console,
                global: {},
                globalThis: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;

            const context = vm.createContext(sandbox);

            // Execute once
            vm.runInContext(setupScript, context);
            const firstWrappedConstructor = fakePrismaPkg.PrismaClient;

            // Execute second time (simulating setupFiles + setupFilesAfterEnv)
            vm.runInContext(setupScript, context);

            // Must still produce working client without errors
            const client = new fakePrismaPkg.PrismaClient();
            expect(client).toBeDefined();
            expect(typeof client.user.findFirst).toBe('function');
        });
    });
});
