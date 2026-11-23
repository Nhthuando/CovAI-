import fs from 'node:fs';
import path from 'node:path';
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    createPrismaDouble,
    createCjsExpressMongooseFixture,
    createVitestTsFixture,
    cleanupFixtureDir,
    sha256File,
    verifySourceHashesMatch,
    runDirectJest,
    runDirectVitest,
    CJS_FIXTURE_SOURCES,
    VITEST_TS_FIXTURE_SOURCES,
} from './helpers/e2eReproductionFixtures.js';

jest.setTimeout(120000);

const prisma = createPrismaDouble();
const mockGenerateText = jest.fn();

await jest.unstable_mockModule('../config/prisma.js', () => ({ default: prisma, prisma }));
await jest.unstable_mockModule('../controllers/coverage.controller.js', () => ({
    invalidateCoverageCache: jest.fn(),
}));
await jest.unstable_mockModule('../services/gemini.service.js', () => ({
    generateText: mockGenerateText,
}));
await jest.unstable_mockModule('../services/virtualDatabase.service.js', () => ({
    isDockerAvailable: () => false,
    isInsideDocker: () => false,
    getVirtualDatabaseHostConfig: () => ({ host: '127.0.0.1', port: 5433, user: 'postgres', password: '', adminDb: 'postgres' }),
    testDatabaseConnection: async () => false,
    ensureVirtualDatabaseServer: async () => false,
    sanitizeDatabaseCatalogName: (jobId) => String(jobId || 'covai_unit'),
    provisionIsolatedDatabase: async () => null,
    getVirtualDatabaseEnv: () => ({}),
    syncDatabaseSchema: async () => ({ success: true }),
    destroyIsolatedDatabase: async () => {},
    isDatabaseRequiredForProject: () => false,
    scavengeStaleDatabases: async () => {},
}));

const { suggestUnitTestcases } = await import('../services/unitTestSuggestion.service.js');
const { generateAiUnitTestSuite } = await import('../services/unitTestGenerator.service.js');
const {
    inspectUnitTestQuality,
    analyzeUnitTestFailures,
    proposeVerifiedFrameworkRepair,
    verifyQualityCoverage,
} = await import('../services/unitTestQualityGate.service.js');
const {
    applyUnitTestSuggestion,
    applyCodeToTestFile,
    activeApplyLocks,
} = await import('../services/applyTestSuggestion.service.js');
const { runUnitTestBatch } = await import('../services/unitTestBatchRunner.service.js');
const { analyzeSourceAst, classifyBusinessLogicFiles } = await import('../services/businessLogicAstAnalyzer.service.js');
const { analyzeMongooseSchemas } = await import('../services/mongooseSchemaAnalyzer.service.js');
const { preserveMongooseSchemaInDraft } = await import('../services/mongooseModelDraft.service.js');
const { classifyTestFailure, FAILURE_CLASSIFICATIONS } = await import('../services/testFailureClassifier.service.js');
const { attemptControlledMockRepair } = await import('../services/controlledMockRepair.service.js');
const { testContentHash } = await import('../services/unitTestChangeSet.service.js');

const activeFixtureDirs = [];

function trackCjsFixture(options) {
    const fixture = createCjsExpressMongooseFixture(options);
    activeFixtureDirs.push(fixture.rootDir);
    prisma.setFixture({
        projectId: 'proj-cjs-e2e',
        snapshotId: 'snap-cjs-e2e',
        userId: 'user-e2e-1',
        rootDir: fixture.rootDir,
        coverageFiles: [],
    });
    return fixture;
}

function trackVitestFixture(options) {
    const fixture = createVitestTsFixture(options);
    activeFixtureDirs.push(fixture.rootDir);
    prisma.setFixture({
        projectId: 'proj-vitest-e2e',
        snapshotId: 'snap-vitest-e2e',
        userId: 'user-e2e-1',
        rootDir: fixture.rootDir,
        coverageFiles: [],
    });
    return fixture;
}

function aiJsonDraft(testCode, explanation = 'Mocked AI unit test suite') {
    return JSON.stringify({
        explanation,
        suggestedTestCode: testCode,
        fullUpdatedContent: testCode,
    });
}

function makeBatchCoverageDir(rootDir, label = 'batch-cov') {
    const dir = path.join(rootDir, '.covai-test-runs', label);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateText.mockReset();
    mockGenerateText.mockRejectedValue(Object.assign(new Error('Offline test mode'), { code: 'AI_KEY_NOT_CONFIGURED' }));
    prisma.resetFixtures();
});

afterEach(() => {
    while (activeFixtureDirs.length > 0) {
        const dir = activeFixtureDirs.pop();
        cleanupFixtureDir(dir, activeApplyLocks);
    }
    activeApplyLocks.clear();
});

// ============================================================================
// TIER 1: Isolated Requirement Happy-Path & Reproduction Tests (Areas A–F)
// ============================================================================

describe('Tier 1 — Area A: Mock Binding & Spy Compatibility (R1.1)', () => {
    test('T1-A1: Admin.find mockResolvedValue binds cleanly for adminController.js', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const Admin = require('../models/Admin');
const bcrypt = require('bcrypt');
jest.mock('../models/Admin', () => ({ find: jest.fn(), create: jest.fn() }));
jest.mock('bcrypt', () => ({ hash: jest.fn() }));
const { listAdmins } = require('../controllers/adminController');

test('listAdmins returns active admins', async () => {
    Admin.find.mockResolvedValueOnce([{ _id: 'adm-1', email: 'a@test.com' }]);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await listAdmins({}, res);
    expect(Admin.find).toHaveBeenCalledWith({ active: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, admins: [{ _id: 'adm-1', email: 'a@test.com' }] });
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/adminController.test.js',
            sourceFile: 'controllers/adminController.js',
            framework: 'jest',
            code,
        });
        expect(gate.findings).toEqual([]);
        fs.writeFileSync(path.join(rootDir, 'tests/adminController.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/adminController.test.js'],
            targetSourceFiles: ['controllers/adminController.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't1-a1'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T1-A2: bcrypt.hash spyOn works cleanly on CJS bcrypt module in adminController.js', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const bcrypt = require('bcrypt');
const Admin = require('../models/Admin');
const { createAdmin } = require('../controllers/adminController');

test('createAdmin hashes password with bcrypt.hash spy', async () => {
    const hashSpy = jest.spyOn(bcrypt, 'hash').mockResolvedValueOnce('hashed_pw_123');
    const createSpy = jest.spyOn(Admin, 'create').mockResolvedValueOnce({ _id: 'adm-2', email: 'new@test.com', password: 'hashed_pw_123' });
    const req = { body: { email: 'new@test.com', password: 'secret', name: 'New' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    try {
        await createAdmin(req, res);
        expect(hashSpy).toHaveBeenCalledWith('secret', 10);
        expect(createSpy).toHaveBeenCalledWith({ email: 'new@test.com', password: 'hashed_pw_123', name: 'New' });
        expect(res.status).toHaveBeenCalledWith(201);
    } finally {
        hashSpy.mockRestore();
        createSpy.mockRestore();
    }
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/adminController.spy.test.js',
            sourceFile: 'controllers/adminController.js',
            framework: 'jest',
            code,
        });
        expect(gate.findings).toEqual([]);
        fs.writeFileSync(path.join(rootDir, 'tests/adminController.spy.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/adminController.spy.test.js'],
            targetSourceFiles: ['controllers/adminController.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't1-a2'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T1-A3: Order.find().populate().sort().lean() 3-level chain mock executes cleanly for orderController.js', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const Order = require('../models/Order');
jest.mock('../models/Order', () => ({ find: jest.fn() }));
const { getUserOrders } = require('../controllers/orderController');

test('getUserOrders chains populate, sort, and lean', async () => {
    const expected = [{ _id: 'ord-1', totalAmount: 500 }];
    const lean = jest.fn().mockResolvedValueOnce(expected);
    const sort = jest.fn().mockReturnValueOnce({ lean });
    const populate = jest.fn().mockReturnValueOnce({ sort });
    Order.find.mockReturnValueOnce({ populate });

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await getUserOrders({ user: { id: 'u-1' } }, res);

    expect(Order.find).toHaveBeenCalledWith({ userId: 'u-1' });
    expect(populate).toHaveBeenCalledWith('items');
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(lean).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, orders: expected });
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/orderController.chain.test.js',
            sourceFile: 'controllers/orderController.js',
            framework: 'jest',
            code,
        });
        expect(gate.findings).toEqual([]);
        fs.writeFileSync(path.join(rootDir, 'tests/orderController.chain.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/orderController.chain.test.js'],
            targetSourceFiles: ['controllers/orderController.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't1-a3'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T1-A4: razorpayInstance.orders.create nested SDK mock works cleanly in orderController.js', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const mockOrdersCreate = jest.fn().mockResolvedValue({ id: 'rzp_ord_99', amount: 15000, currency: 'INR' });
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({
    orders: { create: mockOrdersCreate },
})));
const { createRazorpayOrder } = require('../controllers/orderController');

test('createRazorpayOrder invokes razorpayInstance.orders.create with paise amount', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createRazorpayOrder({ body: { amount: 150, currency: 'INR', receipt: 'rcpt-1' } }, res);
    expect(mockOrdersCreate).toHaveBeenCalledWith({ amount: 15000, currency: 'INR', receipt: 'rcpt-1' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
        success: true,
        order: { id: 'rzp_ord_99', amount: 15000, currency: 'INR' },
    });
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/orderController.razorpay.test.js',
            sourceFile: 'controllers/orderController.js',
            framework: 'jest',
            code,
        });
        expect(gate.findings).toEqual([]);
        fs.writeFileSync(path.join(rootDir, 'tests/orderController.razorpay.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/orderController.razorpay.test.js'],
            targetSourceFiles: ['controllers/orderController.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't1-a4'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T1-A5: offline fallback generation for orderController.js produces chain-compatible mocks with zero mock binding errors', async () => {
        const { rootDir } = trackCjsFixture();
        const result = await generateAiUnitTestSuite({
            framework: 'jest',
            snapshot: { rootDir },
            sourceFileToInspect: 'controllers/orderController.js',
            sourceCode: CJS_FIXTURE_SOURCES['controllers/orderController.js'],
            coverageDetails: { uncoveredLines: [11, 23] },
        });

        expect(result.testCode).toBeTruthy();
        expect(result.qualityGate.findings.filter(f =>
            ['MOCK_BINDING_ERROR', 'MOCK_HOISTING_ERROR', 'UNMOCKED_SPY_ASSERTION'].includes(f.classification)
        )).toEqual([]);

        const targetPath = path.join(rootDir, result.targetTestFile);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, result.fullUpdatedContent);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: [result.targetTestFile],
            targetSourceFiles: ['controllers/orderController.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't1-a5'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });
});

describe('Tier 1 — Area B: Export Shapes & Expectation Alignment (R1.2)', () => {
    test('T1-B1: analyzeSourceAst resolves CJS object literal exports on chatbotController.js to function metadata', () => {
        const ast = analyzeSourceAst(CJS_FIXTURE_SOURCES['controllers/chatbotController.js']);
        const byName = new Map(ast.exportedSymbols.map(s => [s.name, s]));

        expect(byName.get('classifyIntent')).toMatchObject({ type: 'function', params: ['message'] });
        expect(byName.get('buildQuickReplies')).toMatchObject({ type: 'function', params: ['intent'] });
        expect(byName.get('formatBotReply')).toMatchObject({ type: 'function', params: ['intent', 'userName'] });
        expect(byName.get('handleMessage')).toMatchObject({ type: 'function', isAsync: true, params: ['req', 'res'] });
    });

    test('T1-B2: chatbotController.js tests assert real helper return shapes (not undefined) and pass Jest', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const { classifyIntent, buildQuickReplies, formatBotReply, handleMessage } = require('../controllers/chatbotController');

test('formatBotReply returns structured intent, reply, and suggestions', () => {
    const out = formatBotReply(classifyIntent('track my order'), 'Alice');
    expect(out).toEqual({
        intent: 'order_status',
        reply: 'Hi Alice, let me check your order status.',
        suggestions: buildQuickReplies('order_status'),
    });
});

test('handleMessage responds with 200 and formatted bot payload', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handleMessage({ body: { message: 'Need a refund' }, user: { name: 'Bob' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
        success: true,
        intent: 'refund',
        reply: 'Hi Bob, here are our refund options.',
        suggestions: ['Start return', 'Refund policy'],
    });
});
`;
        mockGenerateText.mockResolvedValueOnce(aiJsonDraft(code));
        const suggested = await suggestUnitTestcases({
            projectId: 'proj-cjs-e2e',
            snapshotId: 'snap-cjs-e2e',
            userId: 'user-e2e-1',
            filePath: 'controllers/chatbotController.js',
            framework: 'jest',
            validationMode: 'fast',
        });

        expect(suggested.qualityGate.findings).toEqual([]);
        fs.writeFileSync(path.join(rootDir, suggested.targetTestFile), suggested.fullUpdatedContent);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: [suggested.targetTestFile],
            targetSourceFiles: ['controllers/chatbotController.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't1-b2'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T1-B3: analyzeSourceAst preserves isDefault, omits type-only exports, and resolves re-exports on src/presets/index.ts (Contract 1)', () => {
        const ast = analyzeSourceAst(VITEST_TS_FIXTURE_SOURCES['src/presets/index.ts']);
        const symbols = ast.exportedSymbols;

        const defaultExport = symbols.find(s => s.isDefault === true);
        expect(defaultExport).toBeDefined();
        expect(defaultExport.name).not.toBe('default');

        const symbolNames = symbols.map(s => s.name);
        expect(symbolNames).not.toContain('PresetItem');
        expect(symbolNames).not.toContain('PresetCategory');
        expect(ast.exportedSymbolNames || []).not.toContain('PresetItem');
        expect(ast.exportedSymbolNames || []).not.toContain('PresetCategory');

        const valueNames = symbols.filter(s => s.exportKind !== 'type').map(s => s.name);
        expect(valueNames).toEqual(expect.arrayContaining(['resolvePresetsByTier', 'tier2AdsPresets', 'filterEnabledAds']));
    });

    test('T1-B4: suggestUnitTestcases for src/presets/index.ts never emits `import { default }` or runtime tests for type-only exports', async () => {
        trackVitestFixture();
        const result = await suggestUnitTestcases({
            projectId: 'proj-vitest-e2e',
            snapshotId: 'snap-vitest-e2e',
            userId: 'user-e2e-1',
            filePath: 'src/presets/index.ts',
            framework: 'vitest',
            validationMode: 'fast',
        });

        expect(result.testCode).toBeTruthy();
        expect(result.testCode).not.toMatch(/\bimport\s*\{[^}]*\bdefault\b[^}]*\}\s*from/);
        expect(result.testCode).not.toMatch(/\bPresetItem\s*\(/);
        expect(result.testCode).not.toMatch(/\bPresetCategory\s*\(/);
    });

    test('T1-B5: Vitest execution on src/presets/index.ts passes cleanly without SyntaxError: Unexpected "default"', async () => {
        const { rootDir } = trackVitestFixture();
        const code = `import { describe, expect, test } from 'vitest';
import presetsDefault, { resolvePresetsByTier, tier2AdsPresets, getBasicPresetIds, filterEnabledAds } from '../src/presets/index';

describe('presets index exports', () => {
    test('resolves enabled tier 1 and tier 2 presets', () => {
        expect(resolvePresetsByTier(1).map(p => p.id)).toEqual(getBasicPresetIds());
        expect(resolvePresetsByTier(2)).toEqual(filterEnabledAds(tier2AdsPresets));
    });

    test('default export exposes resolvePresetsByTier and tier2AdsPresets', () => {
        expect(presetsDefault.tier2AdsPresets).toBe(tier2AdsPresets);
        expect(presetsDefault.resolvePresetsByTier(2)).toHaveLength(1);
    });
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/presets.vitest.test.ts',
            sourceFile: 'src/presets/index.ts',
            framework: 'vitest',
            code,
        });
        expect(gate.findings).toEqual([]);
        fs.writeFileSync(path.join(rootDir, 'tests/presets.vitest.test.ts'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/presets.vitest.test.ts'],
            targetSourceFiles: ['src/presets/index.ts'],
            coverageDir: makeBatchCoverageDir(rootDir, 't1-b5'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
        expect(batch.stdout + batch.stderr).not.toContain('Unexpected "default"');
    });
});

describe('Tier 1 — Area C: Runtime Side Effects & Mongoose Validation/Defaults (R1.3)', () => {
    test('T1-C1: offline suggestion for scripts/userSeeding.js generates per-test process.exit spy before require()', async () => {
        const { rootDir } = trackCjsFixture();
        const result = await generateAiUnitTestSuite({
            framework: 'jest',
            snapshot: { rootDir },
            sourceFileToInspect: 'scripts/userSeeding.js',
            sourceCode: CJS_FIXTURE_SOURCES['scripts/userSeeding.js'],
            coverageDetails: { uncoveredLines: [8, 17, 20] },
        });

        expect(result.testCode).toMatch(/spyOn\s*\(\s*process\s*,\s*['"]exit['"]\s*\)/);
        expect(result.qualityGate.findings).toEqual([]);
    });

    test('T1-C2: scripts/userSeeding.js passes both process.exit(0) and process.exit(1) paths in Jest without aborting worker', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const path = require('node:path');

function loadSeeding({ connectFail = false, createResult = { _id: 'u-1' } } = {}) {
    jest.resetModules();
    const connectMock = connectFail
        ? jest.fn().mockRejectedValueOnce(new Error('DB offline'))
        : jest.fn().mockResolvedValueOnce({});
    const hashMock = jest.fn().mockResolvedValueOnce('hashed_seed_pw');
    const createMock = jest.fn().mockResolvedValueOnce(createResult);
    jest.doMock('mongoose', () => ({ connect: connectMock, Schema: jest.fn(), model: jest.fn() }));
    jest.doMock('bcrypt', () => ({ hash: hashMock }));
    jest.doMock('../models/User', () => ({ create: createMock }));
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
    return { connectMock, hashMock, createMock };
}

test('userSeeding exits with code 0 when user is created', async () => {
    const { connectMock, createMock } = loadSeeding();
    let resolveExit;
    const exitPromise = new Promise(resolve => { resolveExit = resolve; });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(resolveExit);
    try {
        require('../scripts/userSeeding');
        expect(await exitPromise).toBe(0);
        expect(connectMock).toHaveBeenCalledTimes(1);
        expect(createMock).toHaveBeenCalledTimes(1);
    } finally {
        exitSpy.mockRestore();
        jest.resetModules();
    }
});

test('userSeeding exits with code 1 when connect rejects', async () => {
    const { createMock } = loadSeeding({ connectFail: true });
    let resolveExit;
    const exitPromise = new Promise(resolve => { resolveExit = resolve; });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(resolveExit);
    try {
        require('../scripts/userSeeding');
        expect(await exitPromise).toBe(1);
        expect(createMock).not.toHaveBeenCalled();
    } finally {
        exitSpy.mockRestore();
        jest.resetModules();
    }
});
`;
        fs.writeFileSync(path.join(rootDir, 'tests/userSeeding.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/userSeeding.test.js'],
            targetSourceFiles: ['scripts/userSeeding.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't1-c2'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
        expect(batch.stdout + batch.stderr).not.toContain('Process.exit called with code 1');
    });

    test('T1-C3: analyzeMongooseSchemas recognizes `const Schema = mongoose.Schema;` alias and extracts required/enum/default on Order.js', () => {
        const models = analyzeMongooseSchemas(CJS_FIXTURE_SOURCES['models/Order.js']);
        expect(models).toHaveLength(1);
        expect(models[0].modelName).toBe('Order');
        const fields = new Map(models[0].fields.map(f => [f.path, f]));
        expect(fields.get('userId')).toMatchObject({ required: true });
        expect(fields.get('orderId')).toMatchObject({ required: true });
        expect(fields.get('totalAmount')).toMatchObject({ required: true });
        expect(fields.get('status')).toMatchObject({
            enum: ['pending', 'paid', 'shipped', 'cancelled'],
            default: { kind: 'literal', value: 'pending' },
        });
        expect(fields.get('paymentMethod')).toMatchObject({
            enum: ['Razorpay', 'COD'],
            default: { kind: 'literal', value: 'Razorpay' },
        });
    });

    test('T1-C4: preserveMongooseSchemaInDraft preserves real Schema/Model for Order.js and Cart.js', () => {
        const naiveMock = `jest.mock('mongoose', () => ({ Schema: jest.fn(), model: jest.fn() }));
const Order = require('../models/Order');
test('valid order', () => { expect(new Order({ userId: '507f1f77bcf86cd799439011', orderId: 'o1', totalAmount: 100 }).validateSync()).toBeUndefined(); });`;

        const preserved = preserveMongooseSchemaInDraft({
            code: naiveMock,
            sourceCode: CJS_FIXTURE_SOURCES['models/Order.js'],
            framework: 'jest',
        });
        expect(preserved).toContain('jest.requireActual');
        expect(preserved).toContain('actual.model.bind(actual)');
    });

    test('T1-C5: Order.js and Cart.js validateSync() and schema defaults execute cleanly under Jest', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const mongoose = require('mongoose');
const Order = require('../models/Order');
const Cart = require('../models/Cart');

test('Order applies defaults and validates valid document via validateSync', () => {
    const valid = new Order({
        userId: new mongoose.Types.ObjectId(),
        orderId: 'ORD-1001',
        totalAmount: 299,
    });
    expect(valid.status).toBe('pending');
    expect(valid.paymentMethod).toBe('Razorpay');
    expect(valid.validateSync()).toBeUndefined();
});

test('Order reports ValidationError when required fields are missing', () => {
    const invalid = new Order({});
    const err = invalid.validateSync();
    expect(err).toBeTruthy();
    expect(err.errors.userId).toBeDefined();
    expect(err.errors.orderId).toBeDefined();
    expect(err.errors.totalAmount).toBeDefined();
});

test('Cart applies defaults and validates enum status', () => {
    const cart = new Cart({ userId: new mongoose.Types.ObjectId() });
    expect(cart.totalAmount).toBe(0);
    expect(cart.status).toBe('active');
    expect(cart.validateSync()).toBeUndefined();
});
`;
        fs.writeFileSync(path.join(rootDir, 'tests/models.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/models.test.js'],
            targetSourceFiles: ['models/Order.js', 'models/Cart.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't1-c5'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });
});

describe('Tier 1 — Area D: Automated Repair Loop & Bounded Convergence (R1.4)', () => {
    test('T1-D1: proposeVerifiedFrameworkRepair rewrites Vitest toBeTypeOf into Jest typeof check', () => {
        const { rootDir } = trackCjsFixture();
        const broken = `const { classifyIntent } = require('../controllers/chatbotController');
test('returns string intent', () => {
    expect(classifyIntent('track order')).toBeTypeOf('string');
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/chatbot.type.test.js',
            sourceFile: 'controllers/chatbotController.js',
            framework: 'jest',
            code: broken,
        });
        expect(gate.findings).toEqual([
            expect.objectContaining({ classification: 'FRAMEWORK_COMPATIBILITY_ERROR', api: 'toBeTypeOf' }),
        ]);
        const repair = proposeVerifiedFrameworkRepair(broken, '', gate.findings, { framework: 'jest' });
        expect(repair).toMatchObject({ action: 'NORMALIZE_JEST_TYPEOF' });
        expect(repair.content).not.toContain('toBeTypeOf');
        const recheck = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/chatbot.type.test.js',
            sourceFile: 'controllers/chatbotController.js',
            framework: 'jest',
            code: repair.content,
        });
        expect(recheck.findings).toEqual([]);
    });

    test('T1-D2: Vitest unhoisted vi.mock referencing local const is repaired via proposeVerifiedFrameworkRepair and runs cleanly', async () => {
        const { rootDir } = trackVitestFixture();
        const broken = `import { expect, test, vi } from 'vitest';
const mockResolve = vi.fn(() => ['basic-1']);
vi.mock('../src/presets/tier1-basic', () => ({
    tier1BasicPresets: [{ id: 'basic-1', label: 'Basic Feed', tier: 1, enabled: true }],
    getBasicPresetIds: mockResolve,
}));
import { resolvePresetsByTier, getBasicPresetIds } from '../src/presets/index';

test('returns mocked basic presets', () => {
    expect(resolvePresetsByTier(1)).toHaveLength(1);
    expect(getBasicPresetIds()).toEqual(['basic-1']);
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/presets.hoist.vitest.test.ts',
            sourceFile: 'src/presets/index.ts',
            framework: 'vitest',
            code: broken,
        });
        expect(gate.findings.some(f => f.classification === 'VITEST_MOCK_HOISTING_ERROR')).toBe(true);
        const repair = proposeVerifiedFrameworkRepair(broken, '', gate.findings, { framework: 'vitest' });
        expect(repair).not.toBeNull();
        expect(repair.action).toBe('HOIST_VITEST_MOCK_BINDINGS');
    });

    test('T1-D3: attemptControlledMockRepair repairs Order.find missing chainable query contract (INVALID_MOCK_CONTRACT)', () => {
        const { rootDir } = trackCjsFixture();
        const broken = `const Order = require('../models/Order');
jest.mock('../models/Order', () => ({ find: jest.fn().mockResolvedValue([]) }));
const { getUserOrders } = require('../controllers/orderController');

test('getUserOrders returns orders', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await getUserOrders({ user: { id: 'u-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
});
`;
        const repair = attemptControlledMockRepair({
            testCode: broken,
            sourceCode: CJS_FIXTURE_SOURCES['controllers/orderController.js'],
            sourceFile: 'controllers/orderController.js',
            testFile: 'tests/orderController.test.js',
            rootDir,
            framework: 'jest',
            errorMessage: 'TypeError: Order.find(...).populate is not a function',
            attempt: 1,
            maxAttempts: 2,
        });
        expect(repair.classification?.classification).toBe(FAILURE_CLASSIFICATIONS.INVALID_MOCK_CONTRACT);
        expect(repair.repaired).toBe(true);
        expect(repair.code).toContain('populate');
        expect(repair.code).toContain('sort');
        expect(repair.code).toContain('lean');
    });

    test('T1-D4: proposeVerifiedFrameworkRepair injects spyOn for UNMOCKED_SPY_ASSERTION on Admin.find', () => {
        const { rootDir } = trackCjsFixture();
        const broken = `const Admin = require('../models/Admin');
const { listAdmins } = require('../controllers/adminController');

test('calls Admin.find', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await listAdmins({}, res);
    expect(Admin.find).toHaveBeenCalledWith({ active: true });
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/admin.unspied.test.js',
            sourceFile: 'controllers/adminController.js',
            framework: 'jest',
            code: broken,
        });
        expect(gate.findings).toEqual([
            expect.objectContaining({ classification: 'UNMOCKED_SPY_ASSERTION' }),
        ]);
        const repair = proposeVerifiedFrameworkRepair(broken, '', gate.findings, { framework: 'jest' });
        expect(repair).toMatchObject({ action: 'INJECT_SPY_ON_BEFORE_EACH' });
        expect(repair.content).toContain("jest.spyOn(Admin, 'find')");
    });

    test('T1-D5: applyUnitTestSuggestion repairs framework/mock issues and converges in bounded attempts without infinite loop', async () => {
        const { rootDir } = trackCjsFixture();
        const draftWithFixableError = `const { classifyIntent } = require('../controllers/chatbotController');
test('classifies order intent as string', () => {
    expect(classifyIntent('track my order')).toBeTypeOf('string');
});
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestion: {
                suggestionId: 'sug-d5',
                status: 'GENERATED',
                sourceFile: 'controllers/chatbotController.js',
                testFile: 'tests/chatbotController.test.js',
                framework: 'jest',
                generatedCode: draftWithFixableError,
                fullUpdatedContent: draftWithFixableError,
                targetLines: [2, 5],
            },
        });

        expect(res.success).toBe(true);
        expect(['PASSED', 'APPLIED']).toContain(res.status);
        expect(res.qualityGate.attempts.length).toBeLessThanOrEqual(3);
        expect(res.qualityGate.repairs.length).toBeGreaterThanOrEqual(1);
    });
});

describe('Tier 1 — Area E: Genuine Target Source Defect Isolation (R2)', () => {
    test('T1-E1: analyzeSourceAst detects unbound `placeOrder` in controllers/paymentController.js while preserving `verifyPayment`', () => {
        const ast = analyzeSourceAst(CJS_FIXTURE_SOURCES['controllers/paymentController.js']);
        expect(ast.unboundCommonJsExports).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'placeOrder', line: expect.any(Number) }),
            ])
        );
        expect(ast.exportedSymbolNames).toContain('verifyPayment');
    });

    test('T1-E2: inspectUnitTestQuality isolates `placeOrder` test cases via defectScope/defectSymbol while keeping `verifyPayment` READY (Contract 2)', () => {
        const { rootDir } = trackCjsFixture();
        const code = `const paymentModel = require('../models/Payment');
const orderModel = require('../models/Order');
const productModel = require('../models/Product');
const razorpayUtils = require('razorpay/dist/utils/razorpay-utils');
jest.mock('../models/Payment', () => ({ create: jest.fn() }));
jest.mock('../models/Order', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../models/Product', () => ({ findByIdAndUpdate: jest.fn() }));
jest.mock('razorpay/dist/utils/razorpay-utils', () => ({ validateWebhookSignature: jest.fn() }));
const controller = require('../controllers/paymentController');

test('verifyPayment processes valid signature', async () => {
    razorpayUtils.validateWebhookSignature.mockReturnValueOnce(true);
    paymentModel.create.mockResolvedValueOnce({ _id: 'p1' });
    orderModel.findOneAndUpdate.mockResolvedValueOnce({ status: 'paid' });
    productModel.findByIdAndUpdate.mockResolvedValueOnce({ stock: 9 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.verifyPayment({ body: { razorpay_order_id: 'o1', razorpay_payment_id: 'pay1', razorpay_signature: 'sig', user_id: 'u1', method: 'Razorpay', product_id: 'prod1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
});

test('placeOrder creates an order', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.placeOrder({}, res);
    expect(res.status).toHaveBeenCalledWith(201);
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/paymentController.test.js',
            sourceFile: 'controllers/paymentController.js',
            framework: 'jest',
            code,
        });

        expect(gate.findings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'C',
                    classification: 'POTENTIAL_SOURCE_DEFECT',
                    defectSymbol: 'placeOrder',
                    defectScope: 'EXPORT_SYMBOL',
                }),
            ])
        );
        expect(gate.isolatedDefects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    symbol: 'placeOrder',
                    testCaseIds: expect.arrayContaining(['placeOrder creates an order']),
                }),
            ])
        );
        const isolatedIds = new Set((gate.isolatedDefects || []).flatMap(d => d.testCaseIds || []));
        expect(isolatedIds.has('verifyPayment processes valid signature')).toBe(false);
    });

    test('T1-E3: analyzeUnitTestFailures classifies ReferenceError: placeOrder is not defined as code C source defect', () => {
        const { rootDir } = trackCjsFixture();
        const failures = analyzeUnitTestFailures({
            rootDir,
            items: [{ testFile: 'tests/paymentController.test.js', sourceFile: 'controllers/paymentController.js', framework: 'jest' }],
            results: {
                testResults: [{
                    name: path.join(rootDir, 'tests/paymentController.test.js'),
                    status: 'failed',
                    assertionResults: [{
                        status: 'failed',
                        fullName: 'placeOrder creates an order',
                        failureMessages: [
                            `ReferenceError: placeOrder is not defined\n    at Object.<anonymous> (${path.join(rootDir, 'controllers/paymentController.js')}:22:20)`,
                        ],
                    }],
                }],
            },
        });

        expect(failures).toEqual([
            expect.objectContaining({
                code: 'C',
                classification: 'POTENTIAL_SOURCE_DEFECT',
                reason: expect.stringContaining('placeOrder'),
            }),
        ]);
    });

    test('T1-E4: applyUnitTestSuggestion isolates `placeOrder` defect and runs/passes valid `verifyPayment` tests via in-memory load shim', async () => {
        const { rootDir } = trackCjsFixture();
        const draft = await generateAiUnitTestSuite({
            framework: 'jest',
            snapshot: { rootDir },
            sourceFileToInspect: 'controllers/paymentController.js',
            sourceCode: CJS_FIXTURE_SOURCES['controllers/paymentController.js'],
            coverageDetails: { uncoveredLines: [8, 13, 14, 15] },
        });

        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestion: draft,
        });

        expect(res.success).toBe(true);
        expect(['PASSED', 'PARTIAL', 'APPLIED']).toContain(res.status);
        expect(res.qualityGate.isolatedDefects).toEqual(
            expect.arrayContaining([expect.objectContaining({ symbol: 'placeOrder' })])
        );
        expect(fs.existsSync(path.join(rootDir, draft.targetTestFile))).toBe(true);
    });

    test('T1-E5: paymentController.js SHA-256 on disk remains strictly unchanged across suggest, gate, and apply', async () => {
        const fixture = trackCjsFixture();
        const sourcePath = path.join(fixture.rootDir, 'controllers/paymentController.js');
        const beforeSha = sha256File(sourcePath);

        const suggested = await suggestUnitTestcases({
            projectId: 'proj-cjs-e2e',
            snapshotId: 'snap-cjs-e2e',
            userId: 'user-e2e-1',
            filePath: 'controllers/paymentController.js',
            framework: 'jest',
            validationMode: 'fast',
        });

        expect(sha256File(sourcePath)).toBe(beforeSha);

        await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestion: suggested,
        }).catch(() => {});

        expect(sha256File(sourcePath)).toBe(beforeSha);
        expect(verifySourceHashesMatch(fixture.rootDir, fixture.snapshotHashes()).intact).toBe(true);
    });
});

describe('Tier 1 — Area F: Batch Apply & Executable Output Verification (R3)', () => {
    test('T1-F1: applyUnitTestSuggestion writes and passes single Jest CJS suite for adminController.js', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const Admin = require('../models/Admin');
const bcrypt = require('bcrypt');
jest.mock('../models/Admin', () => ({ find: jest.fn(), create: jest.fn() }));
jest.mock('bcrypt', () => ({ hash: jest.fn() }));
const { listAdmins, createAdmin } = require('../controllers/adminController');

test('listAdmins returns 200 with admins', async () => {
    Admin.find.mockResolvedValueOnce([{ email: 'a@b.com' }]);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await listAdmins({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
});

test('createAdmin hashes password and returns 201', async () => {
    bcrypt.hash.mockResolvedValueOnce('h1');
    Admin.create.mockResolvedValueOnce({ email: 'a@b.com', password: 'h1' });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createAdmin({ body: { email: 'a@b.com', password: 'pw' } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
});
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestion: {
                suggestionId: 'sug-f1',
                status: 'GENERATED',
                sourceFile: 'controllers/adminController.js',
                testFile: 'tests/adminController.test.js',
                framework: 'jest',
                generatedCode: code,
                fullUpdatedContent: code,
                targetLines: [6, 17],
            },
        });
        expect(res.success).toBe(true);
        expect(res.status).toBe('PASSED');
        expect(res.appliedSuggestions[0].status).toBe('PASSED');
        expect(fs.existsSync(path.join(rootDir, 'tests/adminController.test.js'))).toBe(true);
    });

    test('T1-F2: applyUnitTestSuggestion writes and passes single Vitest TS suite for src/presets/index.ts', async () => {
        const { rootDir } = trackVitestFixture();
        const code = `import { expect, test } from 'vitest';
import presetsDefault, { resolvePresetsByTier, tier2AdsPresets } from '../src/presets/index';

test('resolvePresetsByTier filters enabled presets per tier', () => {
    expect(resolvePresetsByTier(1).map(i => i.id)).toEqual(['basic-1']);
    expect(resolvePresetsByTier(2)).toEqual([tier2AdsPresets[0]]);
    expect(presetsDefault.resolvePresetsByTier(2)).toHaveLength(1);
});
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-vitest-e2e',
            projectId: 'proj-vitest-e2e',
            suggestion: {
                suggestionId: 'sug-f2',
                status: 'GENERATED',
                sourceFile: 'src/presets/index.ts',
                testFile: 'tests/presets.vitest.test.ts',
                framework: 'vitest',
                generatedCode: code,
                fullUpdatedContent: code,
                targetLines: [9, 10],
            },
        });
        expect(res.success).toBe(true);
        expect(res.status).toBe('PASSED');
        expect(res.appliedSuggestions[0].status).toBe('PASSED');
        expect(() => runDirectVitest(rootDir, ['tests/presets.vitest.test.ts'])).not.toThrow();
    });

    test('T1-F3: batch apply across multiple valid CJS files publishes all test files with PASSED status', async () => {
        const { rootDir } = trackCjsFixture();
        const chatbotCode = `const { classifyIntent, formatBotReply } = require('../controllers/chatbotController');
test('classifies refund and formats reply', () => {
    const intent = classifyIntent('I want a refund');
    expect(formatBotReply(intent, 'Sam').intent).toBe('refund');
});
`;
        const orderModelCode = `const mongoose = require('mongoose');
const Order = require('../models/Order');
test('Order model defaults and validateSync work', () => {
    const doc = new Order({ userId: new mongoose.Types.ObjectId(), orderId: 'O-1', totalAmount: 99 });
    expect(doc.status).toBe('pending');
    expect(doc.validateSync()).toBeUndefined();
});
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestions: [
                {
                    suggestionId: 'sug-f3-a',
                    status: 'GENERATED',
                    sourceFile: 'controllers/chatbotController.js',
                    testFile: 'tests/chatbotController.test.js',
                    framework: 'jest',
                    generatedCode: chatbotCode,
                    fullUpdatedContent: chatbotCode,
                    targetLines: [6, 19],
                },
                {
                    suggestionId: 'sug-f3-b',
                    status: 'GENERATED',
                    sourceFile: 'models/Order.js',
                    testFile: 'tests/Order.test.js',
                    framework: 'jest',
                    generatedCode: orderModelCode,
                    fullUpdatedContent: orderModelCode,
                    targetLines: [4, 10],
                },
            ],
        });
        expect(res.success).toBe(true);
        expect(res.appliedSuggestions.map(s => s.status)).toEqual(['PASSED', 'PASSED']);
        expect(() => runDirectJest(rootDir, ['tests/chatbotController.test.js', 'tests/Order.test.js'])).not.toThrow();
    });

    test('T1-F4: partial batch isolation rolls back failed/blocked item and publishes valid item (Contract 2)', async () => {
        const { rootDir } = trackCjsFixture();
        const validCode = `const { classifyIntent } = require('../controllers/chatbotController');
test('detects general intent', () => {
    expect(classifyIntent('hello')).toBe('general');
});
`;
        const brokenSyntaxCode = `const Admin = require('../models/Admin');
test('syntax error', () => { expect(1).toBe( ; });
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestions: [
                {
                    suggestionId: 'sug-f4-ok',
                    status: 'GENERATED',
                    sourceFile: 'controllers/chatbotController.js',
                    testFile: 'tests/chatbotController.test.js',
                    framework: 'jest',
                    generatedCode: validCode,
                    fullUpdatedContent: validCode,
                    targetLines: [8],
                },
                {
                    suggestionId: 'sug-f4-bad',
                    status: 'GENERATED',
                    sourceFile: 'controllers/adminController.js',
                    testFile: 'tests/adminController.broken.test.js',
                    framework: 'jest',
                    generatedCode: brokenSyntaxCode,
                    fullUpdatedContent: brokenSyntaxCode,
                    targetLines: [6],
                },
            ],
        });

        expect(fs.existsSync(path.join(rootDir, 'tests/chatbotController.test.js'))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, 'tests/adminController.broken.test.js'))).toBe(false);
        const okItem = res.appliedSuggestions.find(s => s.suggestionId === 'sug-f4-ok');
        const badItem = res.appliedSuggestions.find(s => s.suggestionId === 'sug-f4-bad');
        expect(okItem?.status).toBe('PASSED');
        expect(badItem?.status).toBe('FAILED');
        expect(res.modifiedFiles || []).not.toContain('tests/adminController.broken.test.js');
    });

    test('T1-F5: applyCodeToTestFile writes valid CJS and TS files executable directly by Jest and Vitest', () => {
        const cjs = trackCjsFixture();
        const ts = trackVitestFixture();

        const cjsApply = applyCodeToTestFile(cjs.rootDir, {
            sourceFile: 'controllers/chatbotController.js',
            testFile: 'tests/chatbot.direct.test.js',
            framework: 'jest',
            generatedCode: `const { buildQuickReplies } = require('../controllers/chatbotController');
test('returns quick replies for unknown', () => {
    expect(buildQuickReplies('unknown')).toEqual(['Browse products', 'Contact support']);
});
`,
        });
        expect(cjsApply.changed).toBe(true);
        expect(() => runDirectJest(cjs.rootDir, ['tests/chatbot.direct.test.js'])).not.toThrow();

        const tsApply = applyCodeToTestFile(ts.rootDir, {
            sourceFile: 'src/presets/index.ts',
            testFile: 'tests/presets.direct.test.ts',
            framework: 'vitest',
            generatedCode: `import { expect, test } from 'vitest';
import { resolvePresetsByTier } from '../src/presets/index';
test('returns empty list for unsupported tier', () => {
    expect(resolvePresetsByTier(99 as any)).toEqual([]);
});
`,
        });
        expect(tsApply.changed).toBe(true);
        expect(() => runDirectVitest(ts.rootDir, ['tests/presets.direct.test.ts'])).not.toThrow();
    });
});

// ============================================================================
// TIER 2: Boundary, Corner & Adversarial Cases (Areas A–F)
// ============================================================================

describe('Tier 2 — Area A: Mock & Spy Boundary Cases', () => {
    test('T2-A1: unmocked Admin.find spy assertion is flagged by inspectUnitTestQuality without crashing', () => {
        const { rootDir } = trackCjsFixture();
        const code = `const Admin = require('../models/Admin');
const { listAdmins } = require('../controllers/adminController');
test('asserts without spy', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await listAdmins({}, res);
    expect(Admin.find).toHaveBeenCalled();
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/admin.nomock.test.js',
            sourceFile: 'controllers/adminController.js',
            framework: 'jest',
            code,
        });
        expect(gate.findings.some(f => f.classification === 'UNMOCKED_SPY_ASSERTION')).toBe(true);
    });

    test('T2-A2: Order.find query chain works for both direct await and explicit .exec() terminal call', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const Order = require('../models/Order');
const { getUserOrders } = require('../controllers/orderController');

test('Order.find stub query chain supports await and exec()', async () => {
    const direct = await Order.find({ userId: 'u1' }).populate('items').sort({ createdAt: -1 }).lean();
    const viaExec = await Order.find({ userId: 'u1' }).populate('items').sort({ createdAt: -1 }).lean().exec();
    expect(direct).toEqual([]);
    expect(viaExec).toEqual([]);

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await getUserOrders({ user: { id: 'u1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
});
`;
        fs.writeFileSync(path.join(rootDir, 'tests/order.thenable.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/order.thenable.test.js'],
            targetSourceFiles: ['controllers/orderController.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't2-a2'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T2-A3: bcrypt.hash rejection branch in createAdmin returns 500 cleanly', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const bcrypt = require('bcrypt');
const { createAdmin } = require('../controllers/adminController');

test('createAdmin returns 500 when bcrypt.hash rejects', async () => {
    const spy = jest.spyOn(bcrypt, 'hash').mockRejectedValueOnce(new Error('salt failure'));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    try {
        await createAdmin({ body: { email: 'e@test.com', password: 'pw' } }, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ success: false, message: 'salt failure' });
    } finally {
        spy.mockRestore();
    }
});
`;
        fs.writeFileSync(path.join(rootDir, 'tests/admin.hasherr.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/admin.hasherr.test.js'],
            targetSourceFiles: ['controllers/adminController.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't2-a3'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T2-A4: razorpayInstance.orders.create failure returns 500 without leaking unhandled promise', async () => {
        const { rootDir } = trackCjsFixture();
        const mockCode = `const mockCreate = jest.fn().mockRejectedValueOnce(new Error('Razorpay gateway timeout'));
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({ orders: { create: mockCreate } })));
const { createRazorpayOrder } = require('../controllers/orderController');

test('createRazorpayOrder handles SDK error and invalid amount boundary', async () => {
    const resBad = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createRazorpayOrder({ body: { amount: 0 } }, resBad);
    expect(resBad.status).toHaveBeenCalledWith(400);

    const resErr = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createRazorpayOrder({ body: { amount: 10 } }, resErr);
    expect(resErr.status).toHaveBeenCalledWith(500);
    expect(resErr.json).toHaveBeenCalledWith({ success: false, message: 'Razorpay gateway timeout' });
});
`;
        fs.writeFileSync(path.join(rootDir, 'tests/order.rzp-err.test.js'), mockCode);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/order.rzp-err.test.js'],
            targetSourceFiles: ['controllers/orderController.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't2-a4'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T2-A5: adversarial special characters ($regex, quotes, unicode, backslashes) in mocked payloads pass gate and Jest', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const Admin = require('../models/Admin');
jest.mock('../models/Admin', () => ({ find: jest.fn() }));
const { listAdmins } = require('../controllers/adminController');

test('handles special characters \\"quotes\\" $regex \\\\backslash and unicode Tiếng Việt', async () => {
    const tricky = [{ email: 'admin+1@test.com', name: 'O\\"Brien \\\\ $ne Tiếng Việt' }];
    Admin.find.mockResolvedValueOnce(tricky);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await listAdmins({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, admins: tricky });
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/admin.adversarial.test.js',
            sourceFile: 'controllers/adminController.js',
            framework: 'jest',
            code,
        });
        expect(gate.findings).toEqual([]);
        fs.writeFileSync(path.join(rootDir, 'tests/admin.adversarial.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/admin.adversarial.test.js'],
            targetSourceFiles: ['controllers/adminController.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't2-a5'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });
});

describe('Tier 2 — Area B: Export Shapes & AST Boundary Cases', () => {
    test('T2-B1: empty and syntactically malformed code returns deterministic findings without throwing', () => {
        const { rootDir } = trackCjsFixture();
        const emptyAst = analyzeSourceAst('');
        expect(emptyAst.exportedSymbols).toEqual([]);
        expect(emptyAst.unboundCommonJsExports || []).toEqual([]);

        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/broken.test.js',
            sourceFile: 'controllers/chatbotController.js',
            framework: 'jest',
            code: 'const x = {{{;',
        });
        expect(gate.findings).toEqual([
            expect.objectContaining({ code: 'E', reason: expect.stringContaining('cannot be parsed') }),
        ]);
    });

    test('T2-B2: type-only exports in src/presets/types.ts and src/presets/index.ts are excluded from runtime test targets', () => {
        const indexAst = analyzeSourceAst(VITEST_TS_FIXTURE_SOURCES['src/presets/index.ts']);
        const runtimeSymbols = indexAst.exportedSymbols.filter(s => s.exportKind !== 'type');
        expect(runtimeSymbols.map(s => s.name)).not.toContain('PresetItem');
        expect(runtimeSymbols.map(s => s.name)).not.toContain('PresetCategory');
    });

    test('T2-B3: classifyBusinessLogicFiles includes src/presets/index.ts and excludes static tier1-basic.ts / tier2-ads.ts / types.ts', () => {
        const { rootDir } = trackVitestFixture();
        const classified = classifyBusinessLogicFiles(rootDir);
        expect(classified.all).toContain('src/presets/index.ts');
        expect(classified.all).not.toContain('src/presets/tier1-basic.ts');
        expect(classified.all).not.toContain('src/presets/tier2-ads.ts');
        expect(classified.all).not.toContain('src/presets/types.ts');
    });

    test('T2-B4: chatbotController boundary inputs (null, whitespace, unknown intent) match actual return shapes', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const { classifyIntent, formatBotReply, handleMessage } = require('../controllers/chatbotController');

test('handles empty, null, and whitespace inputs deterministically', () => {
    expect(classifyIntent(null)).toBe('unknown');
    expect(classifyIntent('   ')).toBe('unknown');
    expect(formatBotReply('unknown')).toEqual({
        intent: 'unknown',
        reply: 'Hi Guest, could you please clarify your question?',
        suggestions: ['Browse products', 'Contact support'],
    });
});

test('handleMessage tolerates missing req.body and req.user', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handleMessage({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, intent: 'unknown' }));
});
`;
        fs.writeFileSync(path.join(rootDir, 'tests/chatbot.boundary.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/chatbot.boundary.test.js'],
            targetSourceFiles: ['controllers/chatbotController.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't2-b4'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T2-B5: Vitest test combining default + named + re-exported symbols with special-char test names passes cleanly', async () => {
        const { rootDir } = trackVitestFixture();
        const code = `import { expect, test } from 'vitest';
import defaultPresets, { resolvePresetsByTier, tier1BasicPresets, tier2AdsPresets, filterEnabledAds } from '../src/presets/index';

test('combines default, named, star-reexport & named-reexport with "quotes" & [brackets]', () => {
    expect(tier1BasicPresets).toHaveLength(2);
    expect(filterEnabledAds(tier2AdsPresets)).toHaveLength(1);
    expect(defaultPresets.resolvePresetsByTier(1)).toHaveLength(1);
    expect(resolvePresetsByTier(2)).toEqual(defaultPresets.resolvePresetsByTier(2));
});
`;
        fs.writeFileSync(path.join(rootDir, 'tests/presets.combined.test.ts'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/presets.combined.test.ts'],
            targetSourceFiles: ['src/presets/index.ts'],
            coverageDir: makeBatchCoverageDir(rootDir, 't2-b5'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });
});

describe('Tier 2 — Area C: process.exit & Mongoose Schema Boundary Cases', () => {
    test('T2-C1: userSeeding exits with code 1 when User.create returns null without aborting worker', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `test('userSeeding exits with 1 if User.create returns null', async () => {
    jest.resetModules();
    jest.doMock('mongoose', () => ({ connect: jest.fn().mockResolvedValue({}) }));
    jest.doMock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('pw') }));
    jest.doMock('../models/User', () => ({ create: jest.fn().mockResolvedValue(null) }));
    jest.doMock('dotenv', () => ({ config: jest.fn() }));
    let done;
    const exitCodePromise = new Promise(resolve => { done = resolve; });
    const spy = jest.spyOn(process, 'exit').mockImplementation(done);
    try {
        require('../scripts/userSeeding');
        expect(await exitCodePromise).toBe(1);
    } finally {
        spy.mockRestore();
        jest.resetModules();
    }
});
`;
        fs.writeFileSync(path.join(rootDir, 'tests/userSeeding.null.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/userSeeding.null.test.js'],
            targetSourceFiles: ['scripts/userSeeding.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't2-c1'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T2-C2: Vitest runner also intercepts process.exit in CJS seeding scripts without crashing worker', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `import { createRequire } from 'node:module';
import { expect, test, vi } from 'vitest';
const require = createRequire(import.meta.url);

test('Vitest intercepts process.exit(0) in userSeeding.js', async () => {
    const script = require.resolve('../scripts/userSeeding');
    const deps = [
        [require.resolve('mongoose'), { connect: vi.fn().mockResolvedValue({}) }],
        [require.resolve('bcrypt'), { hash: vi.fn().mockResolvedValue('hashed') }],
        [require.resolve('../models/User'), { create: vi.fn().mockResolvedValue({ _id: '1' }) }],
        [require.resolve('dotenv'), { config: vi.fn() }],
    ];
    const prev = [script, ...deps.map(([id]) => id)].map(id => [id, require.cache[id]]);
    for (const [id, exports] of deps) require.cache[id] = { id, filename: id, loaded: true, exports };
    delete require.cache[script];
    let done;
    const p = new Promise(r => { done = r; });
    const spy = vi.spyOn(process, 'exit').mockImplementation(done);
    try {
        require(script);
        expect(await p).toBe(0);
    } finally {
        spy.mockRestore();
        for (const [id, entry] of prev) {
            if (entry) require.cache[id] = entry;
            else delete require.cache[id];
        }
    }
});
`;
        fs.writeFileSync(path.join(rootDir, 'tests/userSeeding.vitest.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/userSeeding.vitest.test.js'],
            targetSourceFiles: ['scripts/userSeeding.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't2-c2'),
            frameworkByFile: { 'tests/userSeeding.vitest.test.js': 'vitest' },
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T2-C3: analyzeMongooseSchemas supports both `const Schema = mongoose.Schema` and `const { Schema } = mongoose`', () => {
        const orderModels = analyzeMongooseSchemas(CJS_FIXTURE_SOURCES['models/Order.js']);
        const cartModels = analyzeMongooseSchemas(CJS_FIXTURE_SOURCES['models/Cart.js']);
        expect(orderModels[0].fields.find(f => f.path === 'status')).toMatchObject({
            default: { kind: 'literal', value: 'pending' },
        });
        expect(cartModels[0].fields.find(f => f.path === 'status')).toMatchObject({
            enum: ['active', 'checked_out'],
            default: { kind: 'literal', value: 'active' },
        });
        expect(cartModels[0].fields.find(f => f.path === 'totalAmount')).toMatchObject({
            default: { kind: 'literal', value: 0 },
        });
    });

    test('T2-C4: Order.validateSync rejects invalid enum status and negative min totalAmount', async () => {
        const { rootDir } = trackCjsFixture();
        const code = `const mongoose = require('mongoose');
const Order = require('../models/Order');

test('validateSync detects invalid enum and negative totalAmount', () => {
    const bad = new Order({
        userId: new mongoose.Types.ObjectId(),
        orderId: 'ORD-BAD',
        totalAmount: -5,
        status: 'invalid_state',
    });
    const err = bad.validateSync();
    expect(err).toBeTruthy();
    expect(err.errors.status).toBeDefined();
    expect(err.errors.totalAmount).toBeDefined();
});
`;
        fs.writeFileSync(path.join(rootDir, 'tests/order.enum.test.js'), code);
        const batch = await runUnitTestBatch({
            rootDir,
            testFiles: ['tests/order.enum.test.js'],
            targetSourceFiles: ['models/Order.js'],
            coverageDir: makeBatchCoverageDir(rootDir, 't2-c4'),
            requireDocker: false,
        });
        expect(batch.exitCode).toBe(0);
    });

    test('T2-C5: inspectUnitTestQuality flags INVALID_FIXTURE (code B) when a valid Order test omits required path or uses bogus enum', () => {
        const { rootDir } = trackCjsFixture();
        const badFixtureTest = `const Order = require('../models/Order');
test('valid order succeeds', () => {
    const doc = new Order({ status: 'bogus_status' });
    expect(doc.validateSync()).toBeUndefined();
});
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/order.invalid-fixture.test.js',
            sourceFile: 'models/Order.js',
            framework: 'jest',
            code: badFixtureTest,
        });
        expect(gate.findings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: 'B', reason: expect.stringContaining('required schema path') }),
                expect.objectContaining({ code: 'B', reason: expect.stringContaining('undeclared enum value') }),
            ])
        );
    });
});

describe('Tier 2 — Area D: Automated Repair Loop Boundary Cases', () => {
    test('T2-D1: genuine requirement mismatch (code D/A) is NOT silently rewritten to pass', async () => {
        const { rootDir } = trackCjsFixture();
        const wrongRequirement = `const { classifyIntent } = require('../controllers/chatbotController');
test('requires refund keyword to return billing_dispute', () => {
    expect(classifyIntent('refund please')).toBe('billing_dispute');
});
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestion: {
                suggestionId: 'sug-d1-req',
                status: 'GENERATED',
                sourceFile: 'controllers/chatbotController.js',
                testFile: 'tests/chatbot.req.test.js',
                framework: 'jest',
                generatedCode: wrongRequirement,
                fullUpdatedContent: wrongRequirement,
                targetLines: [6],
            },
        });
        expect(res.success).toBe(false);
        expect(res.status).toBe('FAILED');
        expect(fs.existsSync(path.join(rootDir, 'tests/chatbot.req.test.js'))).toBe(false);
    });

    test('T2-D2: attemptControlledMockRepair stops cleanly when attempt exceeds maxAttempts', () => {
        const { rootDir } = trackCjsFixture();
        const outcome = attemptControlledMockRepair({
            testCode: "test('x', () => {});",
            sourceCode: CJS_FIXTURE_SOURCES['controllers/orderController.js'],
            sourceFile: 'controllers/orderController.js',
            testFile: 'tests/orderController.test.js',
            rootDir,
            framework: 'jest',
            errorMessage: 'TypeError: Order.find(...).populate is not a function',
            attempt: 3,
            maxAttempts: 2,
        });
        expect(outcome).toMatchObject({
            repaired: false,
            stoppedReason: 'MAX_REPAIR_ATTEMPTS_EXCEEDED',
        });
    });

    test('T2-D3: repair classifier marks missing undeclared package as ENVIRONMENT_ERROR and does not attempt mock rewrite', () => {
        const classified = classifyTestFailure({
            errorMessage: "Cannot find module 'non-existent-enterprise-sdk' from 'controllers/orderController.js'",
        });
        expect(classified.classification).toBe(FAILURE_CLASSIFICATIONS.ENVIRONMENT_ERROR);
        expect(classified.repairableMock).toBe(false);
    });

    test('T2-D4: applyUnitTestSuggestion preserves existing authored test cases when repairing newly added draft cases', async () => {
        const { rootDir } = trackCjsFixture();
        const existing = `const { classifyIntent } = require('../controllers/chatbotController');
test('existing authored test stays untouched', () => {
    expect(classifyIntent('track order')).toBe('order_status');
});
`;
        fs.writeFileSync(path.join(rootDir, 'tests/chatbot.preserve.test.js'), existing);
        const proposed = `${existing}
test('new case uses vitest matcher that gets repaired', () => {
    expect(classifyIntent('hello')).toBeTypeOf('string');
});
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestion: {
                suggestionId: 'sug-d4',
                status: 'GENERATED',
                sourceFile: 'controllers/chatbotController.js',
                testFile: 'tests/chatbot.preserve.test.js',
                framework: 'jest',
                originalCode: existing,
                generatedCode: proposed,
                fullUpdatedContent: proposed,
                targetLines: [7],
            },
        });
        expect(res.success).toBe(true);
        const disk = fs.readFileSync(path.join(rootDir, 'tests/chatbot.preserve.test.js'), 'utf8');
        expect(disk).toContain("test('existing authored test stays untouched'");
        expect(disk).not.toContain('toBeTypeOf');
    });

    test('T2-D5: duplicate test titles in a draft trigger code D finding and do not pass silently', () => {
        const { rootDir } = trackCjsFixture();
        const dup = `const { classifyIntent } = require('../controllers/chatbotController');
test('same name', () => { expect(classifyIntent('hello')).toBe('general'); });
test('same name', () => { expect(classifyIntent('refund')).toBe('refund'); });
`;
        const gate = inspectUnitTestQuality({
            rootDir,
            testFile: 'tests/chatbot.dup.test.js',
            sourceFile: 'controllers/chatbotController.js',
            framework: 'jest',
            code: dup,
        });
        expect(gate.findings).toEqual([
            expect.objectContaining({ code: 'D', reason: expect.stringContaining('same full test name') }),
        ]);
    });
});

describe('Tier 2 — Area E: Source Defect Isolation Boundary Cases', () => {
    test('T2-E1: multiple unbound CJS exports in one controller report every unbound symbol while keeping bound exports runnable', () => {
        const multiDefect = `function validHelper(x) { return x + 1; }
module.exports = { missingAlpha, missingBeta, validHelper };
`;
        const ast = analyzeSourceAst(multiDefect);
        const names = ast.unboundCommonJsExports.map(e => e.name);
        expect(names).toEqual(expect.arrayContaining(['missingAlpha', 'missingBeta']));
        expect(names).not.toContain('validHelper');
    });

    test('T2-E2: locally declared symbols and built-in globals are not falsely flagged as unboundCommonJsExports', () => {
        const cleanAst = analyzeSourceAst(CJS_FIXTURE_SOURCES['controllers/chatbotController.js']);
        expect(cleanAst.unboundCommonJsExports || []).toEqual([]);
    });

    test('T2-E3: aliased CJS export property (`module.exports = { handler: undeclaredFn, verifyPayment }`) detects undeclaredFn', () => {
        const aliased = `function verifyPayment() { return true; }
module.exports = { handler: undeclaredHandler, verifyPayment };
`;
        const ast = analyzeSourceAst(aliased);
        expect(ast.unboundCommonJsExports.map(e => e.name)).toContain('undeclaredHandler');
        expect(ast.unboundCommonJsExports.map(e => e.name)).not.toContain('verifyPayment');
    });

    test('T2-E4: sibling valid controller (adminController.js) in same batch is unblocked by paymentController placeOrder defect', async () => {
        const { rootDir } = trackCjsFixture();
        const paymentDraft = await generateAiUnitTestSuite({
            framework: 'jest',
            snapshot: { rootDir },
            sourceFileToInspect: 'controllers/paymentController.js',
            sourceCode: CJS_FIXTURE_SOURCES['controllers/paymentController.js'],
            coverageDetails: { uncoveredLines: [8, 13] },
        });
        const adminCode = `const Admin = require('../models/Admin');
jest.mock('../models/Admin', () => ({ find: jest.fn() }));
const { listAdmins } = require('../controllers/adminController');
test('listAdmins returns 200', async () => {
    Admin.find.mockResolvedValueOnce([]);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await listAdmins({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
});
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestions: [
                paymentDraft,
                {
                    suggestionId: 'sug-e4-admin',
                    status: 'GENERATED',
                    sourceFile: 'controllers/adminController.js',
                    testFile: 'tests/adminController.test.js',
                    framework: 'jest',
                    generatedCode: adminCode,
                    fullUpdatedContent: adminCode,
                    targetLines: [6],
                },
            ],
        });
        expect(res.success).toBe(true);
        const adminApplied = res.appliedSuggestions.find(s => s.testFile === 'tests/adminController.test.js');
        expect(adminApplied?.status).toBe('PASSED');
    });

    test('T2-E5: tampered paymentController.js during apply triggers SOURCE_INTEGRITY_FAILED without publishing test file', async () => {
        const { rootDir } = trackCjsFixture();
        const paymentPath = path.join(rootDir, 'controllers/paymentController.js');
        const originalPayment = fs.readFileSync(paymentPath, 'utf8');
        const validVerifyTest = `const razorpayUtils = require('razorpay/dist/utils/razorpay-utils');
jest.mock('../models/Payment', () => ({ create: jest.fn() }));
jest.mock('../models/Order', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../models/Product', () => ({ findByIdAndUpdate: jest.fn() }));
jest.mock('razorpay/dist/utils/razorpay-utils', () => ({ validateWebhookSignature: jest.fn() }));
const { verifyPayment } = require('../controllers/paymentController');
test('rejects bad signature', async () => {
    razorpayUtils.validateWebhookSignature.mockReturnValueOnce(false);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await verifyPayment({ body: { razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 's' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
});
`;
        await expect(
            applyUnitTestSuggestion({
                snapshotId: 'snap-cjs-e2e',
                projectId: 'proj-cjs-e2e',
                suggestion: {
                    suggestionId: 'sug-e5',
                    sourceFile: 'controllers/paymentController.js',
                    testFile: 'tests/payment.tamper.test.js',
                    framework: 'jest',
                    generatedCode: validVerifyTest,
                    fullUpdatedContent: validVerifyTest,
                },
                runCoverageFn: async ({ rootDir: runRoot, testFilesToRun = [], sealedRunDir }) => {
                    fs.appendFileSync(paymentPath, '\n// simulated unauthorized write\n');
                    fs.mkdirSync(sealedRunDir, { recursive: true });
                    fs.writeFileSync(
                        path.join(sealedRunDir, 'jest-results.json'),
                        JSON.stringify({
                            success: true,
                            numFailedTests: 0,
                            numFailedTestSuites: 0,
                            testResults: (testFilesToRun.length ? testFilesToRun : ['tests/payment.tamper.test.js']).map(tf => ({
                                name: path.join(runRoot, tf),
                                status: 'passed',
                                assertionResults: [
                                    { status: 'passed', title: 'rejects bad signature', fullName: 'rejects bad signature' },
                                ],
                            })),
                        })
                    );
                    const metric = {
                        lines: { total: 10, covered: 8, skipped: 0, pct: 80 },
                        statements: { total: 10, covered: 8, skipped: 0, pct: 80 },
                        functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
                        branches: { total: 2, covered: 1, skipped: 0, pct: 50 },
                    };
                    const summary = { total: metric };
                    const finalCov = {};
                    for (const rel of Object.keys(CJS_FIXTURE_SOURCES)) {
                        const abs = path.join(runRoot, rel);
                        summary[abs] = metric;
                        finalCov[abs] = {
                            path: abs,
                            statementMap: { '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } },
                            s: { '0': 1 },
                            fnMap: {},
                            f: {},
                            branchMap: {},
                            b: {},
                        };
                    }
                    fs.writeFileSync(path.join(sealedRunDir, 'coverage-summary.json'), JSON.stringify(summary));
                    fs.writeFileSync(path.join(sealedRunDir, 'coverage-final.json'), JSON.stringify(finalCov));
                    return { exitCode: 0 };
                },
            })
        ).rejects.toMatchObject({ code: 'SOURCE_INTEGRITY_FAILED' });

        fs.writeFileSync(paymentPath, originalPayment, 'utf8');
        expect(fs.existsSync(path.join(rootDir, 'tests/payment.tamper.test.js'))).toBe(false);
    });
});

describe('Tier 2 — Area F: Batch Apply & Error Boundary Cases', () => {
    test('T2-F1: conflicting proposals targeting the same testFile throw 409 before writing to disk', async () => {
        const { rootDir } = trackCjsFixture();
        await expect(
            applyUnitTestSuggestion({
                snapshotId: 'snap-cjs-e2e',
                projectId: 'proj-cjs-e2e',
                suggestions: [
                    {
                        suggestionId: 's1',
                        sourceFile: 'controllers/chatbotController.js',
                        testFile: 'tests/chatbotController.test.js',
                        framework: 'jest',
                        generatedCode: "test('a', () => expect(1).toBe(1));",
                        fullUpdatedContent: "test('a', () => expect(1).toBe(1));",
                    },
                    {
                        suggestionId: 's2',
                        sourceFile: 'controllers/chatbotController.js',
                        testFile: 'tests/chatbotController.test.js',
                        framework: 'jest',
                        generatedCode: "test('b', () => expect(2).toBe(2));",
                        fullUpdatedContent: "test('b', () => expect(2).toBe(2));",
                    },
                ],
            })
        ).rejects.toMatchObject({ statusCode: 409 });
        expect(fs.existsSync(path.join(rootDir, 'tests/chatbotController.test.js'))).toBe(false);
    });

    test('T2-F2: empty suggestions list or missing snapshotId throws deterministic 400 error', async () => {
        trackCjsFixture();
        await expect(
            applyUnitTestSuggestion({ snapshotId: 'snap-cjs-e2e', suggestions: [] })
        ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_SUGGESTION' });

        await expect(
            applyUnitTestSuggestion({
                snapshotId: '',
                suggestion: {
                    sourceFile: 'controllers/chatbotController.js',
                    testFile: 'tests/chatbotController.test.js',
                    generatedCode: "test('x', () => expect(1).toBe(1));",
                },
            })
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    test('T2-F3: path traversal in testFile is rejected before any file write', async () => {
        trackCjsFixture();
        await expect(
            applyUnitTestSuggestion({
                snapshotId: 'snap-cjs-e2e',
                projectId: 'proj-cjs-e2e',
                suggestion: {
                    sourceFile: 'controllers/chatbotController.js',
                    testFile: '../../escaped.test.js',
                    framework: 'jest',
                    generatedCode: "test('x', () => expect(1).toBe(1));",
                },
            })
        ).rejects.toThrow();
    });

    test('T2-F4: stale sourceSha256 after source modification throws 409 without mutating tests', async () => {
        const { rootDir } = trackCjsFixture();
        const srcPath = path.join(rootDir, 'controllers/chatbotController.js');
        fs.appendFileSync(srcPath, '\n// modified after suggestion\n');
        await expect(
            applyUnitTestSuggestion({
                snapshotId: 'snap-cjs-e2e',
                projectId: 'proj-cjs-e2e',
                suggestion: {
                    sourceFile: 'controllers/chatbotController.js',
                    testFile: 'tests/chatbot.stale.test.js',
                    sourceSha256: '0000000000000000000000000000000000000000000000000000000000000000',
                    framework: 'jest',
                    generatedCode: "test('x', () => expect(1).toBe(1));",
                },
            })
        ).rejects.toMatchObject({ statusCode: 409 });
        expect(fs.existsSync(path.join(rootDir, 'tests/chatbot.stale.test.js'))).toBe(false);
    });

    test('T2-F5: non-existent snapshotId throws 404 without leaving activeApplyLocks', async () => {
        trackCjsFixture();
        await expect(
            applyUnitTestSuggestion({
                snapshotId: 'non-existent-snap-999',
                projectId: 'proj-cjs-e2e',
                suggestion: {
                    sourceFile: 'controllers/chatbotController.js',
                    testFile: 'tests/chatbotController.test.js',
                    framework: 'jest',
                    generatedCode: "test('x', () => expect(1).toBe(1));",
                },
            })
        ).rejects.toMatchObject({ statusCode: 404 });
        expect(activeApplyLocks.size).toBe(0);
    });
});

// ============================================================================
// TIER 3: Pairwise Cross-Feature Combinatorial Tests (Areas A–F)
// ============================================================================

describe('Tier 3 — Pairwise Cross-Feature Combinations (Areas A–F)', () => {
    test('T3-1 (A + E): paymentController defect isolated while orderController 3-level chain + razorpay mock apply & pass', async () => {
        const { rootDir } = trackCjsFixture();
        const paymentDraft = await generateAiUnitTestSuite({
            framework: 'jest',
            snapshot: { rootDir },
            sourceFileToInspect: 'controllers/paymentController.js',
            sourceCode: CJS_FIXTURE_SOURCES['controllers/paymentController.js'],
            coverageDetails: { uncoveredLines: [8, 13, 14] },
        });
        const orderCode = `const Order = require('../models/Order');
const mockCreate = jest.fn().mockResolvedValue({ id: 'rzp_1', amount: 5000 });
jest.mock('../models/Order', () => ({ find: jest.fn() }));
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({ orders: { create: mockCreate } })));
const { getUserOrders, createRazorpayOrder } = require('../controllers/orderController');

test('orderController handles find chain and razorpay orders.create', async () => {
    const lean = jest.fn().mockResolvedValueOnce([{ _id: 'o1' }]);
    const sort = jest.fn().mockReturnValueOnce({ lean });
    const populate = jest.fn().mockReturnValueOnce({ sort });
    Order.find.mockReturnValueOnce({ populate });
    const r1 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await getUserOrders({ user: { id: 'u1' } }, r1);
    expect(r1.status).toHaveBeenCalledWith(200);

    const r2 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createRazorpayOrder({ body: { amount: 50 } }, r2);
    expect(r2.status).toHaveBeenCalledWith(201);
});
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestions: [
                paymentDraft,
                {
                    suggestionId: 'sug-t3-order',
                    status: 'GENERATED',
                    sourceFile: 'controllers/orderController.js',
                    testFile: 'tests/orderController.test.js',
                    framework: 'jest',
                    generatedCode: orderCode,
                    fullUpdatedContent: orderCode,
                    targetLines: [11, 27],
                },
            ],
        });
        expect(res.success).toBe(true);
        expect(res.qualityGate.isolatedDefects).toEqual(
            expect.arrayContaining([expect.objectContaining({ symbol: 'placeOrder' })])
        );
        expect(res.appliedSuggestions.find(s => s.testFile === 'tests/orderController.test.js')?.status).toBe('PASSED');
    });

    test('T3-2 (B + D): Vitest/TS src/presets/index.ts draft with hoisting defect is repaired and converges to Vitest pass', async () => {
        const { rootDir } = trackVitestFixture();
        const unhoisted = `import { expect, test, vi } from 'vitest';
const mockAds = [{ id: 'ads-x', label: 'X', tier: 2, enabled: true }];
vi.mock('../src/presets/tier2-ads', () => ({
    tier2AdsPresets: mockAds,
    filterEnabledAds: () => mockAds,
}));
import presetsDefault, { resolvePresetsByTier } from '../src/presets/index';

test('resolves mocked tier 2 presets cleanly after hoist repair', () => {
    expect(resolvePresetsByTier(2)).toEqual(mockAds);
    expect(presetsDefault.tier2AdsPresets).toEqual(mockAds);
});
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-vitest-e2e',
            projectId: 'proj-vitest-e2e',
            suggestion: {
                suggestionId: 'sug-t3-2',
                status: 'GENERATED',
                sourceFile: 'src/presets/index.ts',
                testFile: 'tests/presets.repair.vitest.test.ts',
                framework: 'vitest',
                generatedCode: unhoisted,
                fullUpdatedContent: unhoisted,
                targetLines: [9, 10],
            },
        });
        expect(res.success).toBe(true);
        expect(res.status).toBe('PASSED');
        expect(() => runDirectVitest(rootDir, ['tests/presets.repair.vitest.test.ts'])).not.toThrow();
    });

    test('T3-3 (C + E): userSeeding (process.exit) and paymentController (placeOrder defect) apply cleanly together', async () => {
        const { rootDir } = trackCjsFixture();
        const seedingDraft = await generateAiUnitTestSuite({
            framework: 'jest',
            snapshot: { rootDir },
            sourceFileToInspect: 'scripts/userSeeding.js',
            sourceCode: CJS_FIXTURE_SOURCES['scripts/userSeeding.js'],
            coverageDetails: { uncoveredLines: [8, 17] },
        });
        const paymentDraft = await generateAiUnitTestSuite({
            framework: 'jest',
            snapshot: { rootDir },
            sourceFileToInspect: 'controllers/paymentController.js',
            sourceCode: CJS_FIXTURE_SOURCES['controllers/paymentController.js'],
            coverageDetails: { uncoveredLines: [8, 13] },
        });

        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestions: [seedingDraft, paymentDraft],
        });
        expect(res.success).toBe(true);
        expect(res.qualityGate.isolatedDefects).toEqual(
            expect.arrayContaining([expect.objectContaining({ symbol: 'placeOrder' })])
        );
        expect(fs.existsSync(path.join(rootDir, seedingDraft.targetTestFile))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, paymentDraft.targetTestFile))).toBe(true);
    });

    test('T3-4 (A + C): adminController mocks/spies and Order/Cart schema validation & defaults coexist in one batch', async () => {
        const { rootDir } = trackCjsFixture();
        const adminCode = `const Admin = require('../models/Admin');
const bcrypt = require('bcrypt');
const { createAdmin } = require('../controllers/adminController');

test('createAdmin uses bcrypt.hash spy and Admin.create spy', async () => {
    const hashSpy = jest.spyOn(bcrypt, 'hash').mockResolvedValueOnce('h_pw');
    const createSpy = jest.spyOn(Admin, 'create').mockResolvedValueOnce({ email: 'a@b.com', password: 'h_pw' });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    try {
        await createAdmin({ body: { email: 'a@b.com', password: 'pw' } }, res);
        expect(res.status).toHaveBeenCalledWith(201);
    } finally {
        hashSpy.mockRestore();
        createSpy.mockRestore();
    }
});
`;
        const cartCode = `const mongoose = require('mongoose');
const Cart = require('../models/Cart');
test('Cart applies default totalAmount and status and validates required userId', () => {
    const bad = new Cart({});
    expect(bad.validateSync().errors.userId).toBeDefined();
    const ok = new Cart({ userId: new mongoose.Types.ObjectId() });
    expect(ok.totalAmount).toBe(0);
    expect(ok.status).toBe('active');
    expect(ok.validateSync()).toBeUndefined();
});
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestions: [
                {
                    suggestionId: 'sug-t3-admin',
                    status: 'GENERATED',
                    sourceFile: 'controllers/adminController.js',
                    testFile: 'tests/adminController.test.js',
                    framework: 'jest',
                    generatedCode: adminCode,
                    fullUpdatedContent: adminCode,
                    targetLines: [16, 19],
                },
                {
                    suggestionId: 'sug-t3-cart',
                    status: 'GENERATED',
                    sourceFile: 'models/Cart.js',
                    testFile: 'tests/Cart.test.js',
                    framework: 'jest',
                    generatedCode: cartCode,
                    fullUpdatedContent: cartCode,
                    targetLines: [4, 15],
                },
            ],
        });
        expect(res.success).toBe(true);
        expect(() => runDirectJest(rootDir, ['tests/adminController.test.js', 'tests/Cart.test.js'])).not.toThrow();
    });

    test('T3-5 (D + F): repairable draft + clean draft in batch repair, publish, and pass direct Jest execution', async () => {
        const { rootDir } = trackCjsFixture();
        const repairableAdmin = `const Admin = require('../models/Admin');
const { listAdmins } = require('../controllers/adminController');
test('listAdmins returns array', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await listAdmins({}, res);
    expect(Admin.find).toHaveBeenCalledWith({ active: true });
    expect(res.status).toHaveBeenCalledWith(200);
});
`;
        const cleanChatbot = `const { classifyIntent } = require('../controllers/chatbotController');
test('classifies order intent', () => {
    expect(classifyIntent('track package')).toBe('order_status');
});
`;
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestions: [
                {
                    suggestionId: 'sug-t3-5a',
                    status: 'GENERATED',
                    sourceFile: 'controllers/adminController.js',
                    testFile: 'tests/admin.repaired.test.js',
                    framework: 'jest',
                    generatedCode: repairableAdmin,
                    fullUpdatedContent: repairableAdmin,
                    targetLines: [6],
                },
                {
                    suggestionId: 'sug-t3-5b',
                    status: 'GENERATED',
                    sourceFile: 'controllers/chatbotController.js',
                    testFile: 'tests/chatbot.clean.test.js',
                    framework: 'jest',
                    generatedCode: cleanChatbot,
                    fullUpdatedContent: cleanChatbot,
                    targetLines: [5],
                },
            ],
        });
        expect(res.success).toBe(true);
        expect(() => runDirectJest(rootDir, ['tests/admin.repaired.test.js', 'tests/chatbot.clean.test.js'])).not.toThrow();
    });

    test('T3-6 (B + F): chatbotController (CJS) and src/presets/index.ts (Vitest/TS) each apply cleanly matching export shapes', async () => {
        trackCjsFixture();
        trackVitestFixture();

        const cjsSuggest = await suggestUnitTestcases({
            projectId: 'proj-cjs-e2e',
            snapshotId: 'snap-cjs-e2e',
            userId: 'user-e2e-1',
            filePath: 'controllers/chatbotController.js',
            framework: 'jest',
            validationMode: 'fast',
        });
        const tsSuggest = await suggestUnitTestcases({
            projectId: 'proj-vitest-e2e',
            snapshotId: 'snap-vitest-e2e',
            userId: 'user-e2e-1',
            filePath: 'src/presets/index.ts',
            framework: 'vitest',
            validationMode: 'fast',
        });

        const cjsApply = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestion: cjsSuggest,
        });
        expect(cjsApply.success).toBe(true);

        const tsApply = await applyUnitTestSuggestion({
            snapshotId: 'snap-vitest-e2e',
            projectId: 'proj-vitest-e2e',
            suggestion: tsSuggest,
        });
        expect(tsApply.success).toBe(true);
    });

    test('T3-7 (E + F): paymentController (isolated placeOrder + valid verifyPayment) + unparseable sibling file leaves valid suite applied & failed file rolled back', async () => {
        const { rootDir } = trackCjsFixture();
        const paymentDraft = await generateAiUnitTestSuite({
            framework: 'jest',
            snapshot: { rootDir },
            sourceFileToInspect: 'controllers/paymentController.js',
            sourceCode: CJS_FIXTURE_SOURCES['controllers/paymentController.js'],
            coverageDetails: { uncoveredLines: [8, 13] },
        });
        const res = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestions: [
                paymentDraft,
                {
                    suggestionId: 'sug-t3-7-bad',
                    status: 'GENERATED',
                    sourceFile: 'controllers/chatbotController.js',
                    testFile: 'tests/chatbot.unparseable.test.js',
                    framework: 'jest',
                    generatedCode: 'test("broken", () => { const x = ; });',
                    fullUpdatedContent: 'test("broken", () => { const x = ; });',
                    targetLines: [5],
                },
            ],
        });
        expect(fs.existsSync(path.join(rootDir, paymentDraft.targetTestFile))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, 'tests/chatbot.unparseable.test.js'))).toBe(false);
        expect(res.appliedSuggestions.find(s => s.suggestionId === 'sug-t3-7-bad')?.status).toBe('FAILED');
        expect(res.qualityGate.isolatedDefects).toEqual(
            expect.arrayContaining([expect.objectContaining({ symbol: 'placeOrder' })])
        );
    });
});

// ============================================================================
// TIER 4: Real-World Multi-File End-to-End Scenarios (NO runCoverageFn mock)
// ============================================================================

describe('Tier 4 — Real-World Multi-File E2E Scenarios (Real Suggest -> Gate -> Apply -> Direct Runner)', () => {
    test('T4-S1: Full Express+Mongoose CJS repo suggest -> gate -> batch apply -> direct Jest execution with placeOrder isolated', async () => {
        const fixture = trackCjsFixture();
        const { rootDir } = fixture;
        const initialHashes = fixture.snapshotHashes();

        mockGenerateText.mockImplementation(async (prompt) => {
            if (prompt.includes('controllers/adminController.js')) {
                return aiJsonDraft(`const Admin = require('../models/Admin');
const bcrypt = require('bcrypt');
jest.mock('../models/Admin', () => ({ find: jest.fn(), create: jest.fn() }));
jest.mock('bcrypt', () => ({ hash: jest.fn() }));
const { listAdmins, createAdmin } = require('../controllers/adminController');

test('listAdmins returns active admins', async () => {
    Admin.find.mockResolvedValueOnce([{ email: 'a@b.com' }]);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await listAdmins({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
});

test('createAdmin hashes password and returns 201', async () => {
    bcrypt.hash.mockResolvedValueOnce('hashed');
    Admin.create.mockResolvedValueOnce({ email: 'a@b.com', password: 'hashed' });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createAdmin({ body: { email: 'a@b.com', password: 'secret' } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
});
`);
            }
            if (prompt.includes('controllers/orderController.js')) {
                return aiJsonDraft(`const Order = require('../models/Order');
const mockCreate = jest.fn().mockResolvedValue({ id: 'rzp_ord_1', amount: 20000 });
jest.mock('../models/Order', () => ({ find: jest.fn() }));
jest.mock('razorpay', () => jest.fn().mockImplementation(() => ({ orders: { create: mockCreate } })));
const { getUserOrders, createRazorpayOrder } = require('../controllers/orderController');

test('getUserOrders chains populate, sort, lean', async () => {
    const lean = jest.fn().mockResolvedValueOnce([{ _id: 'o1' }]);
    const sort = jest.fn().mockReturnValueOnce({ lean });
    const populate = jest.fn().mockReturnValueOnce({ sort });
    Order.find.mockReturnValueOnce({ populate });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await getUserOrders({ user: { id: 'u1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
});

test('createRazorpayOrder creates razorpay order', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await createRazorpayOrder({ body: { amount: 200 } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
});
`);
            }
            if (prompt.includes('controllers/chatbotController.js')) {
                return aiJsonDraft(`const { classifyIntent, formatBotReply, handleMessage } = require('../controllers/chatbotController');
test('formatBotReply and handleMessage return expected shapes', async () => {
    expect(formatBotReply(classifyIntent('refund'), 'Mia').intent).toBe('refund');
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handleMessage({ body: { message: 'track order' }, user: { name: 'Mia' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
});
`);
            }
            throw Object.assign(new Error('Fallback to AST/recipe proposer'), { code: 'AI_KEY_NOT_CONFIGURED' });
        });

        const targets = [
            'controllers/paymentController.js',
            'controllers/adminController.js',
            'controllers/orderController.js',
            'controllers/chatbotController.js',
            'scripts/userSeeding.js',
            'models/Order.js',
            'models/Cart.js',
        ];
        const suggested = await suggestUnitTestcases({
            projectId: 'proj-cjs-e2e',
            snapshotId: 'snap-cjs-e2e',
            userId: 'user-e2e-1',
            filePath: 'all',
            filePaths: targets,
            framework: 'jest',
            validationMode: 'fast',
        });

        expect(suggested.suggestions.length).toBeGreaterThanOrEqual(7);
        const applyRes = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            userId: 'user-e2e-1',
            suggestions: suggested.suggestions,
        });

        expect(applyRes.success).toBe(true);
        expect(['PASSED', 'PARTIAL', 'APPLIED']).toContain(applyRes.status);
        expect(applyRes.qualityGate.isolatedDefects).toEqual(
            expect.arrayContaining([expect.objectContaining({ symbol: 'placeOrder' })])
        );
        expect(verifySourceHashesMatch(rootDir, initialHashes).intact).toBe(true);

        const appliedFiles = applyRes.appliedSuggestions
            .filter(s => s.status === 'PASSED')
            .map(s => s.testFile);
        expect(appliedFiles.length).toBeGreaterThanOrEqual(6);
        expect(() => runDirectJest(rootDir, appliedFiles)).not.toThrow();
    });

    test('T4-S2: Broken CJS drafts reproducing reported failures go through suggest -> repair loop -> apply & pass direct Jest', async () => {
        const fixture = trackCjsFixture();
        const { rootDir } = fixture;

        mockGenerateText.mockImplementation(async (prompt) => {
            if (prompt.includes('controllers/adminController.js')) {
                return aiJsonDraft(`const Admin = require('../models/Admin');
const { listAdmins } = require('../controllers/adminController');
test('listAdmins returns 200', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await listAdmins({}, res);
    expect(Admin.find).toHaveBeenCalledWith({ active: true });
    expect(res.status).toHaveBeenCalledWith(200);
});
`);
            }
            if (prompt.includes('controllers/orderController.js')) {
                return aiJsonDraft(`const Order = require('../models/Order');
jest.mock('../models/Order', () => ({ find: jest.fn().mockResolvedValue([]) }));
const { getUserOrders } = require('../controllers/orderController');
test('getUserOrders returns orders', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await getUserOrders({ user: { id: 'u1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
});
`);
            }
            return aiJsonDraft(`const { classifyIntent } = require('../controllers/chatbotController');
test('classifyIntent returns a string', () => {
    expect(classifyIntent('track')).toBeTypeOf('string');
});
`);
        });

        const adminSug = await suggestUnitTestcases({
            projectId: 'proj-cjs-e2e', snapshotId: 'snap-cjs-e2e', userId: 'user-e2e-1',
            filePath: 'controllers/adminController.js', framework: 'jest', validationMode: 'fast',
        });
        const orderSug = await suggestUnitTestcases({
            projectId: 'proj-cjs-e2e', snapshotId: 'snap-cjs-e2e', userId: 'user-e2e-1',
            filePath: 'controllers/orderController.js', framework: 'jest', validationMode: 'fast',
        });
        const botSug = await suggestUnitTestcases({
            projectId: 'proj-cjs-e2e', snapshotId: 'snap-cjs-e2e', userId: 'user-e2e-1',
            filePath: 'controllers/chatbotController.js', framework: 'jest', validationMode: 'fast',
        });

        const applyRes = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestions: [adminSug, orderSug, botSug],
        });

        expect(applyRes.success).toBe(true);
        expect(applyRes.status).toBe('PASSED');
        expect(applyRes.qualityGate.attempts.length).toBeLessThanOrEqual(4);
        expect(() => runDirectJest(rootDir, applyRes.appliedSuggestions.map(s => s.testFile))).not.toThrow();
    });

    test('T4-S3: Full Vitest+TypeScript src/presets/index.ts repo suggest -> gate -> apply -> direct vitest run', async () => {
        const fixture = trackVitestFixture();
        const { rootDir } = fixture;
        const initialHashes = fixture.snapshotHashes();

        const suggested = await suggestUnitTestcases({
            projectId: 'proj-vitest-e2e',
            snapshotId: 'snap-vitest-e2e',
            userId: 'user-e2e-1',
            filePath: 'all',
            framework: 'vitest',
            validationMode: 'fast',
        });

        expect(suggested.targetFiles).toContain('src/presets/index.ts');
        expect(suggested.targetFiles).not.toContain('src/presets/tier2-ads.ts');
        expect(suggested.testCode).not.toMatch(/\bimport\s*\{[^}]*\bdefault\b[^}]*\}\s*from/);

        const applyRes = await applyUnitTestSuggestion({
            snapshotId: 'snap-vitest-e2e',
            projectId: 'proj-vitest-e2e',
            userId: 'user-e2e-1',
            suggestions: suggested.suggestions,
        });

        expect(applyRes.success).toBe(true);
        expect(applyRes.status).toBe('PASSED');
        expect(verifySourceHashesMatch(rootDir, initialHashes).intact).toBe(true);

        const appliedTestFiles = applyRes.appliedSuggestions.map(s => s.testFile);
        const vitestOut = runDirectVitest(rootDir, appliedTestFiles);
        expect(vitestOut).not.toContain('Unexpected "default"');
    });

    test('T4-S4: Multi-file mixed batch apply preserves disk SHA-256 of paymentController & all sources while isolating placeOrder', async () => {
        const fixture = trackCjsFixture();
        const { rootDir } = fixture;
        const hashes = fixture.snapshotHashes();

        const paymentSug = await generateAiUnitTestSuite({
            framework: 'jest',
            snapshot: { rootDir },
            sourceFileToInspect: 'controllers/paymentController.js',
            sourceCode: CJS_FIXTURE_SOURCES['controllers/paymentController.js'],
            coverageDetails: { uncoveredLines: [8, 13, 14, 15] },
        });
        const orderModelSug = await generateAiUnitTestSuite({
            framework: 'jest',
            snapshot: { rootDir },
            sourceFileToInspect: 'models/Order.js',
            sourceCode: CJS_FIXTURE_SOURCES['models/Order.js'],
            coverageDetails: { uncoveredLines: [4, 10] },
        });
        const adminCode = `const Admin = require('../models/Admin');
jest.mock('../models/Admin', () => ({ find: jest.fn() }));
const { listAdmins } = require('../controllers/adminController');
test('listAdmins returns 200', async () => {
    Admin.find.mockResolvedValueOnce([]);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await listAdmins({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
});
`;

        const applyRes = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            suggestions: [
                paymentSug,
                orderModelSug,
                {
                    suggestionId: 'sug-t4-s4-admin',
                    status: 'GENERATED',
                    sourceFile: 'controllers/adminController.js',
                    testFile: 'tests/adminController.test.js',
                    framework: 'jest',
                    generatedCode: adminCode,
                    fullUpdatedContent: adminCode,
                    targetLines: [6],
                },
            ],
        });

        expect(applyRes.success).toBe(true);
        expect(verifySourceHashesMatch(rootDir, hashes).intact).toBe(true);
        expect(applyRes.qualityGate.isolatedDefects).toEqual(
            expect.arrayContaining([expect.objectContaining({ symbol: 'placeOrder' })])
        );
        const passedFiles = applyRes.appliedSuggestions.filter(s => s.status === 'PASSED').map(s => s.testFile);
        expect(() => runDirectJest(rootDir, passedFiles)).not.toThrow();
    });

    test('T4-S5: CLI/seeding userSeeding.js + chatbotController.js + Cart.js end-to-end suggest -> gate -> apply -> direct Jest', async () => {
        const fixture = trackCjsFixture();
        const { rootDir } = fixture;

        mockGenerateText.mockImplementation(async (prompt) => {
            if (prompt.includes('controllers/chatbotController.js')) {
                return aiJsonDraft(`const { classifyIntent, buildQuickReplies, formatBotReply, handleMessage } = require('../controllers/chatbotController');
test('chatbot helpers and controller return expected payload', async () => {
    expect(classifyIntent('track order')).toBe('order_status');
    expect(buildQuickReplies('general')).toEqual(['Browse products', 'Contact support']);
    expect(formatBotReply('general', 'Dev').reply).toContain('Dev');
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handleMessage({ body: { message: 'hello' }, user: { name: 'Dev' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
});
`);
            }
            throw Object.assign(new Error('Use AST/recipe fallback'), { code: 'AI_KEY_NOT_CONFIGURED' });
        });

        const suggested = await suggestUnitTestcases({
            projectId: 'proj-cjs-e2e',
            snapshotId: 'snap-cjs-e2e',
            userId: 'user-e2e-1',
            filePath: 'all',
            filePaths: ['scripts/userSeeding.js', 'controllers/chatbotController.js', 'models/Cart.js'],
            framework: 'jest',
            validationMode: 'fast',
        });

        const applyRes = await applyUnitTestSuggestion({
            snapshotId: 'snap-cjs-e2e',
            projectId: 'proj-cjs-e2e',
            userId: 'user-e2e-1',
            suggestions: suggested.suggestions,
        });

        expect(applyRes.success).toBe(true);
        expect(applyRes.status).toBe('PASSED');
        const appliedFiles = applyRes.appliedSuggestions.map(s => s.testFile);
        expect(appliedFiles).toHaveLength(3);
        expect(() => runDirectJest(rootDir, appliedFiles)).not.toThrow();
    });
});
