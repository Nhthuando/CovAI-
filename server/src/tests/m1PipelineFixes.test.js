import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { jest } from "@jest/globals";
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";

import { analyzeSourceAst } from "../services/businessLogicAstAnalyzer.service.js";
import {
  sourceInputContracts,
  inputContractViolations,
} from "../services/unitTestInputContracts.service.js";
import { testBlocks } from "../services/generatedTestInputRepair.service.js";
import {
  buildDecisionTableMatrix,
  buildIsolationMockContracts,
  assembleUnitTestContext,
} from "../services/unitTestContextEngineering.service.js";
import {
  buildStandardUnitTestPrompt,
  parseAndSanitizeAiTestResponse,
  generateAiUnitTestSuite,
} from "../services/unitTestGenerator.service.js";
import { generateFallbackUnitTests } from "../services/unitTestSuggestion.service.js";
import { cleanAndDeduplicateTestContent } from "../services/testSanitizer.service.js";
import { mongooseAdapter } from "../services/mockAdapters/mongoose.adapter.js";
import { genericRepositoryAdapter } from "../services/mockAdapters/genericRepository.adapter.js";
import { validateAndNormalizeMocks } from "../services/mockValidation.service.js";
import {
  proposeCommonJsTestDraft,
  isImportTimeProcessExitScript,
} from "../services/commonJsTestDraft.service.js";
import { analyzeMongooseSchemas } from "../services/mongooseSchemaAnalyzer.service.js";
import {
  definesMongooseModel,
  mongooseDocumentFixtureViolations,
  preserveMongooseSchemaInDraft,
} from "../services/mongooseModelDraft.service.js";
import { jestMongooseMockCode } from "../services/jestMongooseMock.js";

const require = createRequire(import.meta.url);

function createMockFnFactory(implDefault) {
  const createFn = (impl = implDefault) => {
    let returnThis = false;
    let resolvedOnceQueue = [];
    let resolvedVal;
    let hasResolvedVal = false;
    let returnVal;
    let hasReturnVal = false;
    let currentImpl = impl;

    const fn = function (...args) {
      fn.mock.calls.push(args);
      if (returnThis) return this;
      if (resolvedOnceQueue.length > 0) {
        return Promise.resolve(resolvedOnceQueue.shift());
      }
      if (hasResolvedVal) return Promise.resolve(resolvedVal);
      if (hasReturnVal) return returnVal;
      return currentImpl ? currentImpl.apply(this, args) : undefined;
    };
    fn.mock = { calls: [] };
    fn.mockReturnThis = () => {
      returnThis = true;
      return fn;
    };
    fn.mockReturnValue = (v) => {
      hasReturnVal = true;
      returnVal = v;
      return fn;
    };
    fn.mockResolvedValue = (v) => {
      hasResolvedVal = true;
      resolvedVal = v;
      return fn;
    };
    fn.mockResolvedValueOnce = (v) => {
      resolvedOnceQueue.push(v);
      return fn;
    };
    fn.mockImplementation = (nextImpl) => {
      currentImpl = nextImpl;
      return fn;
    };
    fn.mockClear = () => {
      fn.mock.calls = [];
      return fn;
    };
    return fn;
  };
  return createFn;
}

describe("M1 Pipeline Fixes (F1, F2, F3 + String Prototype Input Contracts)", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-m1-fixes-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("F1: AST Export & Symbol Analysis", () => {
    test("resolves CommonJS identifier/alias/property/default exports to functions with params & line ranges and excludes localName from internalFunctions", () => {
      const cjsCode = `
function helperCheck(x) {
    return x > 0;
}

async function verifyPayment(req, res) {
    if (!helperCheck(req.body.amount)) {
        return res.status(400).json({ ok: false });
    }
    return res.status(200).json({ ok: true });
}

const refundPayment = async (orderId, reason = 'requested') => {
    return { orderId, reason };
};

module.exports = {
    verifyPayment,
    processRefund: refundPayment
};
exports.ping = () => 'pong';
`;
      const ast = analyzeSourceAst(cjsCode);
      const verifySym = ast.exportedSymbols.find(
        (s) => s.name === "verifyPayment",
      );
      const refundSym = ast.exportedSymbols.find(
        (s) => s.name === "processRefund",
      );
      const pingSym = ast.exportedSymbols.find((s) => s.name === "ping");

      expect(verifySym).toMatchObject({
        name: "verifyPayment",
        localName: "verifyPayment",
        type: "function",
        isAsync: true,
        isDefault: false,
        isReExport: false,
        exportKind: "value",
        params: ["req", "res"],
      });
      expect(verifySym.startLine).toBeGreaterThan(1);
      expect(verifySym.endLine).toBeGreaterThan(verifySym.startLine);

      expect(refundSym).toMatchObject({
        name: "processRefund",
        localName: "refundPayment",
        type: "function",
        isAsync: true,
        isDefault: false,
        exportKind: "value",
        params: ["orderId", "reason"],
      });

      expect(pingSym).toMatchObject({
        name: "ping",
        type: "function",
        isDefault: false,
        exportKind: "value",
      });

      expect(ast.unexportedFunctions).toContain("helperCheck");
      expect(ast.unexportedFunctions).not.toContain("refundPayment");
      expect(ast.unexportedFunctions).not.toContain("verifyPayment");

      const matrix = buildDecisionTableMatrix({
        astMetadata: ast,
        sourceCode: cjsCode,
      });
      const targetNames = matrix.matrixEntries.map((e) => e.targetFunction);
      expect(targetNames).toContain("verifyPayment");
      expect(targetNames).toContain("processRefund");
    });

    test("detects unboundCommonJsExports while ignoring hoisted declarations and imports", () => {
      const code = `
const { verifySignature } = require('./sig');

module.exports = {
    placeOrder,
    verifyPayment,
    verifySignature,
    hoistedHelper
};

function verifyPayment(req, res) {
    return res.json({ ok: true });
}

function hoistedHelper() {
    return true;
}
`;
      const ast = analyzeSourceAst(code);
      expect(ast.unboundCommonJsExports).toHaveLength(1);
      expect(ast.unboundCommonJsExports[0]).toMatchObject({
        name: "placeOrder",
        line: 5,
      });
      expect(ast.unboundCommonJsExports[0].reason).toContain("placeOrder");
    });

    test("handles ESM export type exclusions, ExportAllDeclaration 1-hop re-exports, src/presets/index.ts default+named pattern, and never emits literal 'default'", () => {
      fs.mkdirSync(path.join(tmpDir, "src", "presets"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });

      fs.writeFileSync(
        path.join(tmpDir, "src", "presets", "tier2-ads.ts"),
        `
export interface AdPreset {
    id: string;
    label: string;
}
export const tier2AdsPresets: AdPreset[] = [{ id: 'ad-1', label: 'Banner' }];
export function resolveTier2Ad(id: string) {
    return tier2AdsPresets.find(p => p.id === id) || null;
}
`,
      );
      const indexTs = `
import { tier2AdsPresets } from './tier2-ads';
export type PresetKind = 'ads' | 'core';
export interface PresetMapEntry { id: string; }
export * from './tier2-ads';
export { type PresetKind as PublicPresetKind };

const allPresetsMap = new Map<string, PresetMapEntry>();
for (const p of tier2AdsPresets) {
    allPresetsMap.set(p.id, { id: p.id });
}

export function getPresetById(id: string) {
    return allPresetsMap.get(id) || null;
}

export default allPresetsMap;
`;
      fs.writeFileSync(
        path.join(tmpDir, "src", "presets", "index.ts"),
        indexTs,
      );

      const ast = analyzeSourceAst(indexTs, {
        rootDir: tmpDir,
        sourceFile: "src/presets/index.ts",
      });
      expect(ast.exportedSymbolNames).not.toContain("default");
      expect(ast.exportedSymbolNames).not.toContain("PresetKind");
      expect(ast.exportedSymbolNames).not.toContain("PresetMapEntry");
      expect(ast.exportedSymbolNames).not.toContain("PublicPresetKind");
      expect(ast.exportedSymbolNames).toContain("getPresetById");
      expect(ast.exportedSymbolNames).toContain("allPresetsMap");
      expect(ast.exportedSymbolNames).toContain("resolveTier2Ad");

      const defaultSym = ast.exportedSymbols.find((s) => s.isDefault);
      expect(defaultSym).toMatchObject({
        name: "allPresetsMap",
        localName: "allPresetsMap",
        isDefault: true,
        exportKind: "value",
      });

      const reExportSym = ast.exportedSymbols.find(
        (s) => s.name === "resolveTier2Ad",
      );
      expect(reExportSym).toMatchObject({
        name: "resolveTier2Ad",
        isReExport: true,
        source: "./tier2-ads",
        isDefault: false,
        exportKind: "value",
      });

      const inputContracts = sourceInputContracts(indexTs, {
        rootDir: tmpDir,
        sourceFile: path.join(tmpDir, "src", "presets", "index.ts"),
      });
      expect(inputContracts.functions.has("getPresetById")).toBe(true);
      expect(inputContracts.functions.has("resolveTier2Ad")).toBe(true);

      // ./tier2-ads must NOT be mocked as a service in isolation contracts
      const isolation = buildIsolationMockContracts({
        sourceCode: indexTs,
        framework: "vitest",
        sourceFile: "src/presets/index.ts",
        targetTestFile: "tests/presets.test.ts",
        rootDir: tmpDir,
      });
      expect(isolation.mockPreambleCode).not.toContain("tier2-ads");

      // Prompt & fallback must never emit literal `import { default }`
      const ctx = assembleUnitTestContext({
        sourceCode: indexTs,
        framework: "vitest",
        sourceFile: "src/presets/index.ts",
        targetTestFile: "tests/presets.test.ts",
        rootDir: tmpDir,
      });
      const prompt = buildStandardUnitTestPrompt({
        framework: "vitest",
        cleanSource: "src/presets/index.ts",
        testFileInfo: { found: false, relativePath: "tests/presets.test.ts" },
        cleanImportPath: "../src/presets/index",
        sourceCode: indexTs,
        unitTestContext: ctx,
      });
      expect(prompt).toContain("import allPresetsMap, {");
      expect(prompt).not.toMatch(/import\s*\{[^}]*\bdefault\b[^}]*\}/);

      const fallback = generateFallbackUnitTests({
        framework: "vitest",
        sourceFile: "src/presets/index.ts",
        targetTestFile: "tests/presets.test.ts",
        rootDir: tmpDir,
        baseName: "index",
        sourceCode: indexTs,
      });
      expect(fallback.fullUpdatedContent).toContain("import allPresetsMap, {");
      expect(fallback.fullUpdatedContent).not.toMatch(
        /import\s*\{[^}]*\bdefault\b[^}]*\}/,
      );
      expect(fallback.fullUpdatedContent).toContain("'Map'");

      // Sanitizer heals residual `import { default }` and `import { default, foo }`
      const healed1 = cleanAndDeduplicateTestContent(
        "import { default } from '../src/presets/index';\ntest('ok', () => { expect(defaultExport).toBeDefined(); });",
        "",
        "tests/presets.test.ts",
        { framework: "vitest" },
      );
      expect(healed1).toContain(
        "import defaultExport from '../src/presets/index';",
      );

      const healed2 = cleanAndDeduplicateTestContent(
        "import { default, getPresetById } from '../src/presets/index';\ntest('ok', () => { expect(getPresetById('x')).toBeNull(); });",
        "",
        "tests/presets.test.ts",
        { framework: "vitest" },
      );
      expect(healed2).toContain(
        "import defaultExport, { getPresetById } from '../src/presets/index';",
      );
    });
  });

  describe("F2: Mock Binding, Query Chains, spyOn & Nested SDKs", () => {
    test("generated Jest localServicesMockCode supports Mongoose query chains, spyOn, chatbot fields, and Razorpay SDK chains in VM", async () => {
      const controllerSource = `
const Order = require('../models/Order');
const razorpayInstance = require('../config/razorpay');
const chatbotHelper = require('../services/chatbotHelper');

exports.createOrder = async (req, res) => {
    const orders = await Order.find({ userId: req.user.id }).populate('items').select('total').sort({ createdAt: -1 }).limit(5).skip(0).lean().exec();
    const rzp = await razorpayInstance.orders.create({ amount: 500, currency: 'INR' });
    const bot = await chatbotHelper.ask('hello');
    return res.status(200).json({ orders, rzp, reply: bot.reply, text: bot.text, choices: bot.choices });
};
`;
      const contracts = buildIsolationMockContracts({
        sourceCode: controllerSource,
        framework: "jest",
        sourceFile: "controllers/orderController.js",
        targetTestFile: "tests/orderController.test.js",
        rootDir: tmpDir,
      });

      expect(contracts.detectedDependencies).toContain("razorpay-payments");
      expect(contracts.mockPreambleCode).toContain("getOwnPropertyDescriptor");

      const mockedFactories = new Map();
      const fnFactory = createMockFnFactory();
      const vmContext = {
        jest: {
          fn: fnFactory,
          mock: (modName, factory) => {
            mockedFactories.set(modName, factory);
          },
        },
        globalThis: {},
        Promise,
        Proxy,
        Object,
        Array,
        Error,
        Symbol,
        Reflect,
      };
      vm.createContext(vmContext);
      vm.runInContext(contracts.mockPreambleCode, vmContext);

      const Order = mockedFactories.get("../models/Order")();
      const razorpay = mockedFactories.get("../config/razorpay")();
      const chatbotHelper = mockedFactories.get("../services/chatbotHelper")();
      const rzpPkg = mockedFactories.get("razorpay")();

      // 1. Direct await & chained Mongoose queries resolve arrays
      const directRows = await Order.find({ userId: "u1" });
      expect(Array.isArray(directRows)).toBe(true);
      expect(directRows.length).toBeGreaterThan(0);

      const chainedRows = await Order.find({ userId: "u1" })
        .populate("items")
        .select("total")
        .sort({ createdAt: -1 })
        .limit(5)
        .skip(0)
        .lean()
        .exec();
      expect(Array.isArray(chainedRows)).toBe(true);

      Order.find.mockResolvedValueOnce([{ id: "custom-1" }]);
      const overridden = await Order.find();
      expect(overridden).toEqual([{ id: "custom-1" }]);

      // 2. spyOn-compatible PropertyDescriptors on Model, custom methods, and 3-level SDKs
      const findDesc = Object.getOwnPropertyDescriptor(Order, "find");
      expect(findDesc).toBeDefined();
      expect(typeof findDesc.value).toBe("function");

      const customDesc = Object.getOwnPropertyDescriptor(
        Order,
        "customStaticFinder",
      );
      expect(customDesc).toBeDefined();
      expect(typeof customDesc.value).toBe("function");

      const rzpCreateDesc = Object.getOwnPropertyDescriptor(
        razorpay.orders,
        "create",
      );
      expect(rzpCreateDesc).toBeDefined();
      expect(typeof rzpCreateDesc.value).toBe("function");

      // Real jest.spyOn compatibility check against proxy
      const spyFind = jest.spyOn(Order, "find");
      await Order.find({ status: "paid" });
      expect(spyFind).toHaveBeenCalledTimes(1);
      spyFind.mockRestore();

      const spyCustom = jest.spyOn(Order, "dynamicMethod");
      Order.dynamicMethod();
      expect(spyCustom).toHaveBeenCalledTimes(1);
      spyCustom.mockRestore();

      const spyOrdersCreate = jest.spyOn(razorpay.orders, "create");
      await razorpay.orders.create({ amount: 100 });
      expect(spyOrdersCreate).toHaveBeenCalledTimes(1);
      spyOrdersCreate.mockRestore();

      // 3. Chatbot helper fields
      const botRes = await chatbotHelper.ask("hi");
      expect(botRes.reply).toBeTruthy();
      expect(botRes.response).toBeTruthy();
      expect(botRes.text).toBeTruthy();
      expect(botRes.message).toBeTruthy();
      expect(botRes.content).toBeTruthy();
      expect(botRes.data).toBeDefined();
      expect(Array.isArray(botRes.choices)).toBe(true);

      // 4. Razorpay package constructor & utils
      const rzpInst = new rzpPkg({ key_id: "k", key_secret: "s" });
      const rzpOrder = await rzpInst.orders.create({ amount: 500 });
      expect(rzpOrder.id).toBe("order_mock_123");
    });

    test("generated Vitest localServicesMockCode returns fresh object-namespace proxy with callable default and query chains", async () => {
      const sourceCode = `
import Order from '../models/Order';
export async function listOrders() {
    return await Order.find().populate('user').lean().exec();
}
`;
      const contracts = buildIsolationMockContracts({
        sourceCode,
        framework: "vitest",
        sourceFile: "src/services/order.js",
        targetTestFile: "tests/order.test.js",
        rootDir: tmpDir,
      });
      const fnFactory = createMockFnFactory();
      const mockedFactories = new Map();
      const vmContext = {
        vi: {
          fn: fnFactory,
          hoisted: (cb) => cb(),
          mock: (modName, factory) => mockedFactories.set(modName, factory),
        },
        Promise,
        Proxy,
        Object,
        Array,
        Error,
        Symbol,
        Reflect,
      };
      vm.createContext(vmContext);
      vm.runInContext(contracts.mockPreambleCode, vmContext);

      const mod = mockedFactories.get("../models/Order")();
      expect(typeof mod).toBe("object");
      expect(typeof mod.default).toBe("function");
      const rows = await mod.default.find().populate("user").lean().exec();
      expect(Array.isArray(rows)).toBe(true);
      const desc = Object.getOwnPropertyDescriptor(mod.default, "find");
      expect(desc).toBeDefined();
      expect(typeof desc.value).toBe("function");
    });

    test("mongooseAdapter returns modelMock directly for Jest CJS relative models and genericRepositoryAdapter preserves 3-level nested SDK chains", () => {
      const mRes = mongooseAdapter.generateMock({
        dependency: {
          source: "../models/Order",
          bindings: [{ importedName: "default", localName: "Order" }],
        },
        contracts: [
          {
            method: "find",
            isAsync: true,
            expectedReturnType: "array",
            chainedMethods: ["populate", "lean", "exec"],
          },
        ],
        framework: "jest",
      });
      expect(mRes.mockCode).toContain("return modelMock;");
      expect(mRes.mockCode).toContain(
        "inst.validateSync = jest.fn(() => undefined)",
      );
      expect(mRes.mockCode).not.toContain("return { default: modelMock };");

      const gRes = genericRepositoryAdapter.generateMock({
        dependency: {
          source: "../config/razorpay",
          bindings: [
            { importedName: "default", localName: "razorpayInstance" },
          ],
        },
        contracts: [
          {
            dependencyRoot: "razorpayInstance",
            clientOrModel: "razorpayInstance.orders",
            method: "create",
            isAsync: true,
            expectedReturnType: "object",
            propertyAccesses: ["id"],
          },
          {
            dependencyRoot: "razorpayInstance",
            clientOrModel: "razorpayInstance.payments",
            method: "fetch",
            isAsync: true,
            expectedReturnType: "object",
            propertyAccesses: ["status"],
          },
        ],
        framework: "jest",
      });
      expect(gRes.mockCode).toContain("orders: {");
      expect(gRes.mockCode).toContain("create:");
      expect(gRes.mockCode).toContain("payments: {");
      expect(gRes.mockCode).toContain('orders: defaultObj["orders"]');
    });

    test("mockValidation validates 3-level MemberExpression spies and flags unspied 3-level assertions", () => {
      fs.mkdirSync(path.join(tmpDir, "config"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "config", "razorpay.js"),
        "module.exports = { orders: { create: async () => ({}) } };",
      );

      const validSpyTest = `
const razorpayInstance = require('../config/razorpay');
test('spies on 3-level member', async () => {
    const spy = jest.spyOn(razorpayInstance.orders, 'create').mockResolvedValue({ id: 'ord_1' });
    await razorpayInstance.orders.create({ amount: 100 });
    expect(razorpayInstance.orders.create).toHaveBeenCalled();
    spy.mockRestore();
});
`;
      const validCheck = validateAndNormalizeMocks({
        code: validSpyTest,
        filePath: "tests/order.test.js",
        sourceFile: "controllers/orderController.js",
        rootDir: tmpDir,
        framework: "jest",
      });
      expect(
        validCheck.diagnostics.filter(
          (d) => d.rule === "UNMOCKED_SPY_ASSERTION",
        ),
      ).toHaveLength(0);

      const unspiedTest = `
const razorpayInstance = require('../config/razorpay');
test('unspied 3-level member', async () => {
    expect(razorpayInstance.orders.create).toHaveBeenCalled();
});
`;
      const invalidCheck = validateAndNormalizeMocks({
        code: unspiedTest,
        filePath: "tests/order.test.js",
        sourceFile: "controllers/orderController.js",
        rootDir: tmpDir,
        framework: "jest",
      });
      expect(
        invalidCheck.diagnostics.some(
          (d) => d.rule === "UNMOCKED_SPY_ASSERTION",
        ),
      ).toBe(true);
    });

    test("parseAndSanitizeAiTestResponse forwards sourceCode & rootDir without silent ReferenceError and generateAiUnitTestSuite runs proposeVerifiedFrameworkRepair", async () => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
      const srcCode = `
import { loadItems } from './repo';
export async function run() {
    const rows = await loadItems();
    return rows.map(r => r.title);
}
`;
      fs.writeFileSync(
        path.join(tmpDir, "src", "repo.js"),
        "export async function loadItems() { return []; }\n",
      );
      fs.writeFileSync(path.join(tmpDir, "src", "runner.js"), srcCode);

      const badMockAiPayload = JSON.stringify({
        explanation: "test",
        suggestedTestCode: `
import { run } from '../src/runner';
jest.mock('../src/repo', () => ({ loadItems: jest.fn().mockReturnValue({ wrong: true }) }));
test('runs', async () => { expect(await run()).toBeDefined(); });
`,
        fullUpdatedContent: `
import { run } from '../src/runner';
jest.mock('../src/repo', () => ({ loadItems: jest.fn().mockReturnValue({ wrong: true }) }));
test('runs', async () => { expect(await run()).toBeDefined(); });
`,
      });
      const parseRes = parseAndSanitizeAiTestResponse({
        rawResponse: badMockAiPayload,
        framework: "jest",
        cleanSource: "src/runner.js",
        sourceCode: srcCode,
        rootDir: tmpDir,
      });
      expect(parseRes.success).toBe(false);
      expect(parseRes.errors.some((e) => e.includes("array"))).toBe(true);

      // Verify proposeVerifiedFrameworkRepair runs when existing suite has toBeTypeOf in Jest
      const simpleSrc = `export function double(n) { return n * 2; }\n`;
      fs.writeFileSync(path.join(tmpDir, "src", "double.js"), simpleSrc);
      fs.writeFileSync(
        path.join(tmpDir, "tests", "double.test.js"),
        `
import { double } from '../src/double';
test('doubles', () => {
    expect(double(2)).toBeTypeOf('number');
});
`,
      );
      const genRes = await generateAiUnitTestSuite({
        framework: "jest",
        snapshot: { rootDir: tmpDir },
        sourceFileToInspect: "src/double.js",
        sourceCode: simpleSrc,
        coverageDetails: { uncoveredLines: [1], summary: { linesPct: 100 } },
        isTest: false,
      });
      expect(genRes.suggestedTestCode).toBeDefined();
    });
  });

  describe("F3: process.exit Isolation & Mongoose Schema Preservation", () => {
    test("detects and isolates arbitrary import-time process.exit scripts (e.g. scripts/userSeeding.js) in Jest & Vitest without aborting worker", async () => {
      const seedingSource = `
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const dbConfiguration = require('../config/db');
const User = require('../models/User');

dotenv.config();

async function seedUsers() {
    try {
        await dbConfiguration.connectDB();
        const existing = await User.findOne({ email: 'seed@example.com' });
        if (!existing) {
            const password = await bcrypt.hash('Secret123!', 10);
            await User.create({ email: 'seed@example.com', password });
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

void seedUsers();
`;
      expect(isImportTimeProcessExitScript(seedingSource)).toBe(true);

      const contracts = sourceInputContracts(seedingSource);
      expect(contracts.entryPoints).toHaveLength(1);
      expect(contracts.entryPoints[0]).toMatchObject({
        name: "seedUsers",
        importTime: true,
        callsProcessExit: true,
      });
      expect(contracts.entryPoints[0].exitCodes).toEqual(
        expect.arrayContaining([0, 1]),
      );

      const jestDraft = proposeCommonJsTestDraft({
        sourceCode: seedingSource,
        sourceFile: "scripts/userSeeding.js",
        testFile: "tests/userSeeding.test.js",
        framework: "jest",
      });
      expect(jestDraft).not.toBeNull();
      expect(jestDraft.fullUpdatedContent).toContain("jest.resetModules()");
      expect(jestDraft.fullUpdatedContent).toContain("jest.doMock(");
      expect(jestDraft.fullUpdatedContent).toContain(
        "jest.spyOn(process, 'exit')",
      );

      const vitestDraft = proposeCommonJsTestDraft({
        sourceCode: seedingSource,
        sourceFile: "scripts/userSeeding.js",
        testFile: "tests/userSeeding.vitest.test.js",
        framework: "vitest",
      });
      expect(vitestDraft).not.toBeNull();
      expect(vitestDraft.fullUpdatedContent).toContain(
        "createRequire(import.meta.url)",
      );
      expect(vitestDraft.fullUpdatedContent).toContain("require.cache");
      expect(vitestDraft.fullUpdatedContent).toContain(
        "vi.spyOn(process, 'exit')",
      );
      expect(vitestDraft.fullUpdatedContent).not.toContain("vi.mock(");

      // Real sandbox execution of the seeding script under require.cache + process.exit spy in .covai-temp
      const covaiTempBase = fileURLToPath(
        new URL("../../.covai-temp/", import.meta.url),
      );
      fs.mkdirSync(covaiTempBase, { recursive: true });
      const workDir = fs.mkdtempSync(path.join(covaiTempBase, "m1-seeding-"));
      try {
        fs.mkdirSync(path.join(workDir, "scripts"), { recursive: true });
        fs.mkdirSync(path.join(workDir, "config"), { recursive: true });
        fs.mkdirSync(path.join(workDir, "models"), { recursive: true });
        fs.writeFileSync(
          path.join(workDir, "package.json"),
          JSON.stringify({ type: "commonjs" }),
          "utf8",
        );
        fs.writeFileSync(
          path.join(workDir, "config", "db.js"),
          "module.exports = { connectDB: async () => { throw new Error('real db forbidden'); } };",
        );
        fs.writeFileSync(
          path.join(workDir, "models", "User.js"),
          "module.exports = { findOne: async () => null, create: async () => ({}) };",
        );
        fs.writeFileSync(
          path.join(workDir, "scripts", "userSeeding.js"),
          seedingSource,
        );

        const scriptPath = require.resolve(
          path.join(workDir, "scripts", "userSeeding.js"),
        );
        const dbPath = require.resolve(path.join(workDir, "config", "db.js"));
        const userPath = require.resolve(
          path.join(workDir, "models", "User.js"),
        );

        const connectDB = jest.fn().mockResolvedValue(undefined);
        const findOne = jest.fn().mockResolvedValue(null);
        const create = jest.fn().mockResolvedValue({ id: "u1" });
        const prev = [scriptPath, dbPath, userPath].map((id) => [
          id,
          require.cache[id],
        ]);
        let bcryptId = null;
        try {
          bcryptId = require.resolve("bcrypt");
        } catch {}
        if (bcryptId) prev.push([bcryptId, require.cache[bcryptId]]);

        // Populate both Node require.cache and Jest's runtime module registry
        require.cache[dbPath] = {
          id: dbPath,
          filename: dbPath,
          loaded: true,
          exports: { connectDB },
        };
        require.cache[userPath] = {
          id: userPath,
          filename: userPath,
          loaded: true,
          exports: { findOne, create },
        };
        jest.doMock(dbPath, () => ({ connectDB }));
        jest.doMock(userPath, () => ({ findOne, create }));
        delete require.cache[scriptPath];

        let finish;
        const completed = new Promise((resolve) => {
          finish = resolve;
        });
        const exitSpy = jest
          .spyOn(process, "exit")
          .mockImplementation((code) => {
            finish(code);
          });
        const timer = setTimeout(() => finish("timeout"), 500);
        try {
          // Replace bcrypt/mongoose/dotenv inside script if uninstalled by checking
          fs.writeFileSync(
            path.join(workDir, "scripts", "userSeeding.js"),
            `
const dbConfiguration = require('../config/db');
const User = require('../models/User');
async function seedUsers() {
    try {
        await dbConfiguration.connectDB();
        const existing = await User.findOne({ email: 'seed@example.com' });
        if (!existing) await User.create({ email: 'seed@example.com' });
        process.exit(0);
    } catch (err) {
        process.exit(1);
    }
}
void seedUsers();
`,
          );
          require(scriptPath);
          const code = await completed;
          expect(code).toBe(0);
          expect(connectDB).toHaveBeenCalledTimes(1);
          expect(create).toHaveBeenCalledTimes(1);
        } finally {
          clearTimeout(timer);
          exitSpy.mockRestore();
          jest.dontMock(dbPath);
          jest.dontMock(userPath);
          for (const [id, entry] of prev) {
            if (entry) require.cache[id] = entry;
            else delete require.cache[id];
          }
        }
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }

      // Sanitizer must not leak worker mocks into normal tests, and must protect process.exit tests
      const normalSanitized = cleanAndDeduplicateTestContent(
        "const { processWorkerTask } = require('../src/workerHelper');\ntest('runs', () => { expect(processWorkerTask).toBeDefined(); });",
        "",
        "tests/workerHelper.test.js",
      );
      expect(normalSanitized).not.toContain("../src/jobs/analysis.job");

      const exitSanitized = cleanAndDeduplicateTestContent(
        "describe('seeding', () => { it('runs', () => { expect(true).toBe(true); }); });",
        "",
        "tests/userSeeding.vitest.test.js",
        { framework: "vitest", sourceCode: seedingSource },
      );
      expect(exitSanitized).toContain("vi.spyOn(process, 'exit')");
      expect(exitSanitized).not.toContain("jest.spyOn(process, 'exit')");
    });

    test("recognizes Mongoose Schema aliases, prevents jestMongooseMockCode injection on model tests, and validates real Mongoose validateSync() & defaults", () => {
      const orderSource = `
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const orderSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['Pending', 'Paid', 'Shipped'], default: 'Pending' },
    totalAmount: { type: Number, required: true, min: 0 }
});

module.exports = mongoose.model('Order', orderSchema);
`;
      const cartSource = `
const { Schema: S, model } = require('mongoose');
const cartSchema = new S({
    ownerId: { type: S.Types.ObjectId, required: true },
    currency: { type: String, default: 'USD' }
});
module.exports = { Cart: model('Cart', cartSchema) };
`;
      expect(definesMongooseModel(orderSource)).toBe(true);
      expect(definesMongooseModel(cartSource)).toBe(true);

      const orderSchemas = analyzeMongooseSchemas(orderSource);
      expect(orderSchemas).toHaveLength(1);
      expect(orderSchemas[0]).toMatchObject({
        modelName: "Order",
        complete: true,
      });
      expect(orderSchemas[0].fields.map((f) => f.path)).toEqual([
        "userId",
        "status",
        "totalAmount",
      ]);

      const cartSchemas = analyzeMongooseSchemas(cartSource);
      expect(cartSchemas).toHaveLength(1);
      expect(cartSchemas[0].modelName).toBe("Cart");

      // Unresolved identifier schema must still return false for definesMongooseModel
      expect(
        definesMongooseModel(
          "const mongoose = require('mongoose'); const User = mongoose.model('User', schema);",
        ),
      ).toBe(false);

      // jestMongooseMockCode validateSync returns undefined on valid documents (Contract 1)
      expect(jestMongooseMockCode).toContain(
        "validateSync: jest.fn(() => undefined)",
      );

      // Sanitizer & parseAndSanitizeAiTestResponse must NOT inject jestMongooseMockCode on model tests
      const aiModelResponse = JSON.stringify({
        explanation: "Real schema test",
        suggestedTestCode: `
const mongoose = require('mongoose');
const Order = require('../models/Order');
test('validates order', () => {
    const doc = new Order({ userId: '507f1f77bcf86cd799439011', totalAmount: 100 });
    expect(doc.validateSync()).toBeUndefined();
});
`,
        fullUpdatedContent: `
const mongoose = require('mongoose');
const Order = require('../models/Order');
test('validates order', () => {
    const doc = new Order({ userId: '507f1f77bcf86cd799439011', totalAmount: 100 });
    expect(doc.validateSync()).toBeUndefined();
});
`,
      });
      const sanitizedModel = parseAndSanitizeAiTestResponse({
        rawResponse: aiModelResponse,
        framework: "jest",
        cleanSource: "models/Order.js",
        sourceCode: orderSource,
        rootDir: tmpDir,
      });
      expect(sanitizedModel.success).toBe(true);
      expect(sanitizedModel.parsed.fullUpdatedContent).not.toContain(
        "Universal Mongoose In-Memory Proxy Mock",
      );

      // preserveMongooseSchemaInDraft also handles unstable_mockModule and disconnect
      const preserved = preserveMongooseSchemaInDraft({
        code: "jest.unstable_mockModule('mongoose', () => ({ model: jest.fn() }));",
        sourceCode: orderSource,
        framework: "jest",
      });
      expect(preserved).toContain("jest.requireActual('mongoose')");
      expect(preserved).toContain("disconnect:");

      // mongooseDocumentFixtureViolations catches invalid ObjectId string and destructured missing required
      const testAstCode = `
const { Cart } = require('../models/Cart');
test('validates cart', () => {
    const c = new Cart({ ownerId: 'not-a-hex-id' });
    expect(c.validateSync()).toBeUndefined();
});
`;
      const blocks = testBlocks(testAstCode);
      const violations = mongooseDocumentFixtureViolations(
        blocks[0].callback,
        cartSchemas[0],
        path.join(tmpDir, "tests", "Cart.test.js"),
        path.join(tmpDir, "models", "Cart.js"),
      );
      expect(violations.some((v) => v.reason.includes("ObjectId"))).toBe(true);

      // Real fallback draft + real mongoose runtime validation & defaults check
      const fallbackOrderDraft = generateFallbackUnitTests({
        framework: "jest",
        sourceFile: "models/Order.js",
        targetTestFile: "tests/Order.test.js",
        rootDir: tmpDir,
        baseName: "Order",
        sourceCode: orderSource,
      });
      expect(fallbackOrderDraft.fullUpdatedContent).toContain(
        "507f1f77bcf86cd799439011",
      );
      expect(fallbackOrderDraft.fullUpdatedContent).toContain(
        "expect(err).toBeUndefined()",
      );
      expect(fallbackOrderDraft.fullUpdatedContent).toContain(
        'expect(doc.status).toBe("Pending")',
      );
      expect(fallbackOrderDraft.fullUpdatedContent).toContain(
        "jest.requireActual('mongoose')",
      );

      // Optional check against mongoose if installed; otherwise verify AST-extracted schema contract directly
      let realMongoose = null;
      try {
        realMongoose = require("mongoose");
      } catch (_) {
        realMongoose = null;
      }
      if (realMongoose?.Schema && realMongoose?.model) {
        const realModelName = "M1OrderValidation_" + Date.now();
        const realSchema = new realMongoose.Schema({
          userId: {
            type: realMongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
          },
          status: {
            type: String,
            enum: ["Pending", "Paid", "Shipped"],
            default: "Pending",
          },
          totalAmount: { type: Number, required: true, min: 0 },
        });
        const RealOrder = realMongoose.model(realModelName, realSchema);
        const validDoc = new RealOrder({
          userId: "507f1f77bcf86cd799439011",
          totalAmount: 150,
        });
        expect(validDoc.validateSync()).toBeUndefined();
        expect(validDoc.status).toBe("Pending");

        const invalidDoc = new RealOrder({
          userId: "507f1f77bcf86cd799439011",
          status: "BadStatus",
        });
        const validationErr = invalidDoc.validateSync();
        expect(validationErr).toBeDefined();
        expect(validationErr.errors.totalAmount).toBeDefined();
        expect(validationErr.errors.status).toBeDefined();
      } else {
        const schemas = analyzeMongooseSchemas(orderSource);
        expect(schemas.length).toBeGreaterThan(0);
      }
    });
  });

  describe("String Prototype Input-Contract Fix (unitTestInputContracts.service.js)", () => {
    test("does NOT mark string parameters calling String.prototype methods/properties as kind:'object' and prevents false violations", () => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });
      const srcFile = path.join(tmpDir, "src", "textFormatter.js");
      const testFile = path.join(tmpDir, "tests", "textFormatter.test.js");

      const srcCode = `
export function formatMessage(message) {
    if (!message || typeof message !== 'string') return '';
    const trimmed = message.trim().trimStart().trimEnd();
    const lowered = trimmed.toLowerCase();
    const upper = lowered.toUpperCase();
    const parts = upper.split(',');
    const sliced = parts[0].slice(0, 10);
    if (sliced.includes('HELLO') || sliced.startsWith('HI') || sliced.endsWith('!')) {
        return sliced.replace('HI', 'HEY').replaceAll('!', '.');
    }
    const matched = sliced.match(/[A-Z]+/);
    return matched ? sliced.substring(0, 4).padStart(5, '0') + String(message.length) : sliced.at(0) || '';
}

export function checkAllStringMethods(s1, s2, s3) {
    const a = s1.substr(0, 2).charAt(0) + s1.charCodeAt(0) + s1.indexOf('a') + s1.lastIndexOf('b');
    const b = s2.concat('x').repeat(2).padEnd(5, '_').normalize().localeCompare('z');
    const c = s3.search(/a/) + [...s3.matchAll(/a/g)].length;
    return a + b + c;
}

export function inspectArrayWithIncludesAndSlice(items) {
    if (!Array.isArray(items)) return [];
    const sub = items.slice(0, 2);
    if (sub.includes('stop')) return [];
    return items.concat(['tail']).slice(0, items.length);
}

export function inspectOptionsObject(options) {
    return (options.prefix || '') + (options.maxTurns || 10);
}
`;
      fs.writeFileSync(srcFile, srcCode);
      const contracts = sourceInputContracts(srcCode, {
        rootDir: tmpDir,
        sourceFile: srcFile,
      });

      const fmtFn = contracts.functions.get("formatMessage");
      expect(fmtFn.parameters[0].kind).toBe("string");

      const allMethodsFn = contracts.functions.get("checkAllStringMethods");
      expect(allMethodsFn.parameters[0].kind).toBe("string");
      expect(allMethodsFn.parameters[1].kind).toBe("string");
      expect(allMethodsFn.parameters[2].kind).toBe("string");

      const arrFn = contracts.functions.get("inspectArrayWithIncludesAndSlice");
      expect(arrFn.parameters[0].kind).toBe("array");

      const optsFn = contracts.functions.get("inspectOptionsObject");
      expect(optsFn.parameters[0].kind).toBe("object");
      expect(optsFn.parameters[0].fields).toHaveProperty("prefix");

      const validTestCode = `
import { formatMessage, checkAllStringMethods, inspectArrayWithIncludesAndSlice } from '../src/textFormatter';
test('accepts strings and arrays without false object violations', () => {
    expect(formatMessage('  hello,world!  ')).toBeDefined();
    expect(checkAllStringMethods('abc', 'def', 'aaa')).toBeDefined();
    expect(inspectArrayWithIncludesAndSlice(['a', 'b'])).toBeDefined();
});
`;
      fs.writeFileSync(testFile, validTestCode);
      const blocks = testBlocks(validTestCode);
      const violations = inputContractViolations(
        blocks[0],
        testFile,
        tmpDir,
        srcFile,
        contracts.functions,
      );
      expect(violations).toEqual([]);
    });
  });
});
