import { buildJwtMockCode } from "./authDependencyMockCode.js";
import { jestMongooseMockCode } from "./jestMongooseMock.js";
import { proposeEmptyArrayFallbackTest } from "./logicalFallbackTest.service.js";
import { proposeCommonJsTestDraft } from "./commonJsTestDraft.service.js";
import { proposeShopprControllerDraft } from "./shopprControllerDraft.service.js";
import {
  definesMongooseModel,
  preserveMongooseSchemaInDraft,
} from "./mongooseModelDraft.service.js";
import { analyzeMongooseSchemas } from "./mongooseSchemaAnalyzer.service.js";
import { hoistGeneratedVitestMocks } from "./vitestMockHoisting.service.js";
import fs from "fs";
import { createHash } from "node:crypto";
import { withAgentContext } from "../agents/registry.js";
import path from "path";
import { generateText as generateFeatureText } from "./gemini.service.js";
import { withGeminiFeature } from "./geminiRouting.service.js";
const generateText = (...args) =>
  measureUnitTestPhase("ai", () =>
    withGeminiFeature("unit-test", () => generateFeatureText(...args)),
  );
import { parseJavaScriptCode } from "./babelParser.service.js";
import { extractUnitTestBlocks } from "../utils/testBlockExtractor.js";
import {
  classifyUnitTestCase,
  getRequiredUnitCasesForFile,
  isTrivialCallbackFunctionName,
} from "../../../shared/unitTestCaseCoverage.js";
import {
  assembleUnitTestContext,
  buildIsolationMockContracts,
} from "./unitTestContextEngineering.service.js";
import {
  assembleUnitTestCandidate,
  removeGeneratedNoCheckDirective,
  testContentHash,
} from "./unitTestChangeSet.service.js";
import { sourceInputContracts } from "./unitTestInputContracts.service.js";
import { assertUnitTestTarget } from "./unitTestFilePolicy.service.js";
import { measureUnitTestPhase } from "./unitTestWork.service.js";
import { normalizeTestFrameworkCode } from "./testFrameworkNormalization.service.js";
import {
  describeNativeCommonJsDependencies,
  validateAndNormalizeMocks,
  validateMockContracts,
} from "./mockValidation.service.js";
import { renderNativeCommonJsMockHarness } from "./nativeCommonJsMockHarness.service.js";
import { analyzeDataAccessContracts } from "./dataAccessContractAnalyzer.service.js";
import {
  inspectUnitTestQuality,
  proposeVerifiedFrameworkRepair,
} from "./unitTestQualityGate.service.js";
import { existingTestContractsPreserved } from "./unitTestVerification.service.js";
import {
  computeRelativeImportPath,
  formatLineRanges,
  generateFallbackUnitTests,
  findExistingTestFile,
  findSourceOnDisk,
  sanitizeSourceFilePath,
} from "./unitTestSuggestion.service.js";
import {
  cleanAndDeduplicateTestContent,
  STATEMENT_SEPARATION_EXCLUSIONS,
  safeDecoupleInlineStatements,
  healBrokenCommentSplits,
  balanceTestFileBracesAndParens,
  healObjectIdAssertions,
  rebaseGeneratedTestModulePaths,
  getGeneratedJestMockError,
  isProjectEsm,
} from "./testSanitizer.service.js";
import { convertJestMocksAndStaticImportsToEsm } from "./esmTestRepair.service.js";
import { deduplicateAstDeclarations } from "./testHelperRegistry.service.js";
import {
  validateAndHealVitestTestCollection,
  healVitestCode,
  validateVitestAstStructure,
} from "./vitestCollectionValidator.service.js";

/**
 * STAGE 3: AI TEST GENERATION VIA LLM
 *
 * Implements:
 * 3.1. Standard Prompt Structure for LLM (6 Rigid Sections)
 * 3.2. Response Parsing & Sanity Check (AST Syntax Validation, Anti-skip, Placeholder filtering)
 * 3.3. Resilient Generation Orchestration (Gemini LLM with Isolation Fallback)
 */

export const countSafeDelimiters = (code) => {
  let openBraces = 0,
    closeBraces = 0;
  let openParens = 0,
    closeParens = 0;
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const prev = i > 0 ? code[i - 1] : "";

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "/" && prev === "*") inBlockComment = false;
      continue;
    }
    if (inStr) {
      if (char === inStr && prev !== "\\") inStr = null;
      continue;
    }
    if (char === "/" && code[i + 1] === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === "/" && code[i + 1] === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      inStr = char;
      continue;
    }

    if (char === "{") openBraces++;
    else if (char === "}") closeBraces++;
    else if (char === "(") openParens++;
    else if (char === ")") closeParens++;
  }

  return { openBraces, closeBraces, openParens, closeParens };
};

export const escapePromptCode = (code, maxLen = 15000) => {
  if (!code) return "";
  const sliced =
    typeof code === "string" ? code.slice(0, maxLen) : String(code);
  return sliced.replace(/```/g, "\\`\\`\\`");
};

/**
 * 3.1 STANDARD PROMPT STRUCTURE FOR LLM (6 RIGID SECTIONS)
 *
 * @param {object} params
 * @param {string} params.framework - "jest" or "vitest"
 * @param {string} params.cleanSource - Normalized source file path
 * @param {object} params.testFileInfo - Info on target test file
 * @param {string} params.cleanImportPath - Relative module import path
 * @param {object} params.coverageDetails - Line and branch diagnostics
 * @param {string} params.sourceCode - Raw source code
 * @param {object} params.unitTestContext - Output from assembleUnitTestContext
 * @returns {string} Fully engineered 6-part prompt
 */
export const buildStandardUnitTestPrompt = ({
  framework = "jest",
  cleanSource,
  testFileInfo,
  cleanImportPath,
  coverageDetails,
  sourceCode,
  unitTestContext,
  inputContractSummary = null,
  isEsm = false,
}) => {
  const isVitest = framework === "vitest";
  const isTest = Boolean(testFileInfo.found);
  const nativeDependencies = isVitest
    ? describeNativeCommonJsDependencies(sourceCode, cleanSource)
    : [];
  const exampleDependency = nativeDependencies[0]?.specifier;
  const draftPath = testFileInfo.relativePath || testFileInfo.suggestedFilePath;
  const examplePath =
    exampleDependency?.startsWith(".") && draftPath
      ? path.posix.relative(
          path.posix.dirname(draftPath),
          path.posix.join(path.posix.dirname(cleanSource), exampleDependency),
        )
      : exampleDependency;
  const nativeHarnessExample =
    examplePath &&
    cleanImportPath &&
    draftPath &&
    (/\.cjs$/.test(cleanSource) ||
      /\bmodule\.exports\b|\bexports\./.test(sourceCode))
      ? renderNativeCommonJsMockHarness(JSON.stringify(cleanImportPath), [
          {
            module: JSON.stringify(
              exampleDependency.startsWith(".") && !examplePath.startsWith(".")
                ? "./" + examplePath
                : examplePath,
            ),
            binding: "dependencyDouble",
          },
        ])
      : "";
  const sourceLoaderContract = nativeDependencies.length
    ? `
SOURCE LOADER EVIDENCE (native CommonJS require): ${JSON.stringify(nativeDependencies)}
For dependencies in this list, vi.mock and vi.doMock cannot replace what the source reads. Follow this rule even when a database or SDK example below demonstrates vi.mock for an ESM dependency. Resolve relative dependency paths from the source file and rebase them to the test file. For a destructured require, provide exactly the named properties it reads. For a whole-module require, use the native module.exports shape (object or callable as the source uses it), without inventing a default wrapper. Create test-owned doubles, install a scoped CommonJS require.cache replacement before loading the subject with createRequire(import.meta.url), and restore the previous cache entries in finally. Assertions must reference the same mock functions supplied to the source.
${
  nativeHarnessExample
    ? `Use this loading scaffold for the dependencies the scenario needs. Define each mock binding before installing it and retain its exact references in assertions:
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
${nativeHarnessExample}
`
    : ""
}
`
    : "";
  const runnerContract = isVitest
    ? "Use ESM imports from 'vitest' and vi.fn/vi.spyOn/vi.mock. Never require('vitest') or use jest.*. Keep runner imports as ESM even when the source module uses CommonJS."
    : "For ESM tests import { jest } from '@jest/globals' before using jest.*. For CommonJS tests use the injected jest global without redeclaring it.";
  const pathContract =
    "Trace each input through normalization, validation/regex guards and early returns BEFORE choosing a later branch's expected result. An input rejected by an earlier guard cannot test a downstream result-type/error branch. Use an input accepted by all preceding guards, or isolate the real dependency with a supported mock. Never mock the function under test. Derive exact error messages from the reached return statement, not from the test title. Do not invent a passing test or weaken an assertion just to claim coverage of an unreachable branch.";

  const runtimeSymbols = (
    unitTestContext?.astMetadata?.exportedSymbols || []
  ).filter((s) => s && s.exportKind !== "type" && s.name !== "default");
  const rawNames = (
    unitTestContext?.astMetadata?.exportedSymbolNames || []
  ).filter((n) => n && n !== "default");
  const exportedSymbols =
    runtimeSymbols.length > 0
      ? Array.from(
          new Set(
            runtimeSymbols
              .map((s) =>
                s.name === "default" ? s.localName || "defaultExport" : s.name,
              )
              .filter(Boolean),
          ),
        )
      : rawNames;
  const exportedSymbolsStr =
    exportedSymbols.length > 0
      ? exportedSymbols.join(", ")
      : "All exported module members";
  const defaultRuntimeSym = runtimeSymbols.find((s) => s.isDefault);
  const namedRuntimeSyms = runtimeSymbols.filter((s) => !s.isDefault);
  const isCjsSource =
    !/^\s*(?:import|export)\s+/m.test(sourceCode || "") &&
    /(?:module\.exports|exports\.)/.test(sourceCode || "");
  const isEsmJest = Boolean(!isVitest && !isCjsSource && (isEsm || /^\s*(?:import|export)\s+/m.test(sourceCode || "")));
  let importExample = `import { ... } from '${cleanImportPath}';`;
  if (isCjsSource && !isVitest) {
    if (defaultRuntimeSym && namedRuntimeSyms.length === 0) {
      importExample = `const ${defaultRuntimeSym.name || "targetModule"} = require('${cleanImportPath}');`;
    } else if (namedRuntimeSyms.length > 0) {
      importExample = `const { ${namedRuntimeSyms
        .slice(0, 4)
        .map((s) => s.name)
        .join(", ")} } = require('${cleanImportPath}');`;
    } else {
      importExample = `const targetModule = require('${cleanImportPath}');`;
    }
  } else if (isEsmJest) {
    if (defaultRuntimeSym && namedRuntimeSyms.length > 0) {
      const defAlias = defaultRuntimeSym.name || "defaultExport";
      importExample = `const { default: ${defAlias}, ${namedRuntimeSyms
        .slice(0, 4)
        .map((s) => s.name)
        .join(", ")} } = await import('${cleanImportPath}');`;
    } else if (defaultRuntimeSym) {
      const defAlias = defaultRuntimeSym.name || "defaultExport";
      importExample = `const { default: ${defAlias} } = await import('${cleanImportPath}');`;
    } else if (namedRuntimeSyms.length > 0) {
      importExample = `const { ${namedRuntimeSyms
        .slice(0, 4)
        .map((s) => s.name)
        .join(", ")} } = await import('${cleanImportPath}');`;
    } else {
      importExample = `const { default: targetModule } = await import('${cleanImportPath}');`;
    }
  } else {
    if (defaultRuntimeSym && namedRuntimeSyms.length > 0) {
      const defAlias = defaultRuntimeSym.name || "defaultExport";
      importExample = `import ${defAlias}, { ${namedRuntimeSyms
        .slice(0, 4)
        .map((s) => s.name)
        .join(", ")} } from '${cleanImportPath}';`;
    } else if (defaultRuntimeSym) {
      const defAlias = defaultRuntimeSym.name || "defaultExport";
      importExample = `import ${defAlias} from '${cleanImportPath}';`;
    } else if (namedRuntimeSyms.length > 0) {
      importExample = `import { ${namedRuntimeSyms
        .slice(0, 4)
        .map((s) => s.name)
        .join(", ")} } from '${cleanImportPath}';`;
    }
  }
  const unexportedWarning =
    unitTestContext?.indirectTesting?.indirectGuidancePrompt || "";
  const mockInstructionsStr =
    unitTestContext?.mockContracts?.mockInstructions || "";
  const hasPrisma = Boolean(
    unitTestContext?.mockContracts?.detectedDependencies?.includes(
      "prisma-db",
    ) ||
    /prisma|@prisma\/client/i.test(sourceCode || "") ||
    /prisma|@prisma\/client/i.test(testFileInfo?.content || ""),
  );

  let prismaMockDirective = "";
  if (hasPrisma) {
    const preambleCode = unitTestContext?.mockContracts?.mockPreambleCode || "";
    const fallbackMock = isVitest
      ? `// 2. Universal Prisma Proxy Mock (Universal In-Memory Prisma Client Mock for Vitest, Prisma v7 Compatible)\nconst { mockPrismaClientInstance } = vi.hoisted(() => {\n  const defaultData = { id: 1, name: 'Sample', status: 'ACTIVE', email: 'sample@example.com', createdAt: new Date(), updatedAt: new Date() };\n  const _createModelMock = () => {\n    const baseModel = {\n      findUnique: vi.fn().mockResolvedValue(defaultData),\n      findFirst: vi.fn().mockResolvedValue(defaultData),\n      findMany: vi.fn().mockResolvedValue([defaultData]),\n      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n      createMany: vi.fn().mockResolvedValue({ count: 1 }),\n      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n      updateMany: vi.fn().mockResolvedValue({ count: 1 }),\n      upsert: vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.create || args?.update || {}) })),\n      delete: vi.fn().mockResolvedValue({ id: 1 }),\n      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),\n      count: vi.fn().mockResolvedValue(1),\n      aggregate: vi.fn().mockResolvedValue({ _count: 1, _sum: {}, _avg: {}, _min: {}, _max: {} }),\n      groupBy: vi.fn().mockResolvedValue([])\n    };\n    return new Proxy(baseModel, {\n      get(target, prop) {\n        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n        if (prop in target) return target[prop];\n        if (typeof prop === 'string') {\n          if (prop.includes('OrThrow') || prop.startsWith('findUnique') || prop.startsWith('findFirst')) target[prop] = vi.fn().mockResolvedValue(defaultData);\n          else if (prop.startsWith('find') || prop.includes('Many') || prop.includes('Return')) target[prop] = vi.fn().mockResolvedValue([defaultData]);\n          else if (prop.startsWith('count')) target[prop] = vi.fn().mockResolvedValue(1);\n          else if (prop.startsWith('create') || prop.startsWith('update') || prop.startsWith('upsert') || prop.startsWith('delete')) target[prop] = vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || args?.create || args?.update || {}) }));\n          else target[prop] = vi.fn().mockResolvedValue(defaultData);\n          return target[prop];\n        }\n        return undefined;\n      }\n    });\n  };\n  const _createPrismaProxyMock = () => {\n    const models = new Map();\n    let clientProxy;\n    clientProxy = new Proxy({\n      $connect: vi.fn().mockResolvedValue(undefined),\n      $disconnect: vi.fn().mockResolvedValue(undefined),\n      $transaction: vi.fn(async (args) => Array.isArray(args) ? Promise.all(args) : (typeof args === 'function' ? args(clientProxy) : Promise.resolve())),\n      $queryRaw: vi.fn().mockResolvedValue([]),\n      $queryRawUnsafe: vi.fn().mockResolvedValue([]),\n      $executeRaw: vi.fn().mockResolvedValue(1),\n      $executeRawUnsafe: vi.fn().mockResolvedValue(1),\n      $extends: vi.fn().mockReturnThis()\n    }, {\n      get(target, prop) {\n        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n        if (prop in target) return target[prop];\n        if (!models.has(prop)) models.set(prop, _createModelMock());\n        return models.get(prop);\n      }\n    });\n    return clientProxy;\n  };\n  const _createClientMock = _createPrismaProxyMock;\n  const clientProxy = _createPrismaProxyMock();\n  if (typeof globalThis !== 'undefined') {\n    globalThis.__mockPrisma = clientProxy;\n  }\n  return { mockPrismaClientInstance: clientProxy };\n});\nvi.mock('@prisma/client', () => ({\n  PrismaClient: vi.fn(() => mockPrismaClientInstance),\n  default: { PrismaClient: vi.fn(() => mockPrismaClientInstance) }\n}));`
      : `// 2. Universal Prisma Proxy Mock (Universal In-Memory Prisma Client Mock for Jest, Prisma v7 Compatible)\njest.mock('@prisma/client', () => {\n  const defaultData = { id: 1, name: 'Sample', status: 'ACTIVE', email: 'sample@example.com', createdAt: new Date(), updatedAt: new Date() };\n  const _createModelMock = () => {\n    const baseModel = {\n      findUnique: jest.fn().mockResolvedValue(defaultData),\n      findFirst: jest.fn().mockResolvedValue(defaultData),\n      findMany: jest.fn().mockResolvedValue([defaultData]),\n      create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n      createMany: jest.fn().mockResolvedValue({ count: 1 }),\n      update: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n      updateMany: jest.fn().mockResolvedValue({ count: 1 }),\n      upsert: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.create || args?.update || {}) })),\n      delete: jest.fn().mockResolvedValue({ id: 1 }),\n      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),\n      count: jest.fn().mockResolvedValue(1),\n      aggregate: jest.fn().mockResolvedValue({ _count: 1, _sum: {}, _avg: {}, _min: {}, _max: {} }),\n      groupBy: jest.fn().mockResolvedValue([])\n    };\n    return new Proxy(baseModel, {\n      get(target, prop) {\n        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n        if (prop in target) return target[prop];\n        if (typeof prop === 'string') {\n          if (prop.includes('OrThrow') || prop.startsWith('findUnique') || prop.startsWith('findFirst')) target[prop] = jest.fn().mockResolvedValue(defaultData);\n          else if (prop.startsWith('find') || prop.includes('Many') || prop.includes('Return')) target[prop] = jest.fn().mockResolvedValue([defaultData]);\n          else if (prop.startsWith('count')) target[prop] = jest.fn().mockResolvedValue(1);\n          else if (prop.startsWith('create') || prop.startsWith('update') || prop.startsWith('upsert') || prop.startsWith('delete')) target[prop] = jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || args?.create || args?.update || {}) }));\n          else target[prop] = jest.fn().mockResolvedValue(defaultData);\n          return target[prop];\n        }\n        return undefined;\n      }\n    });\n  };\n  const _createPrismaProxyMock = () => {\n    const models = new Map();\n    let clientProxy;\n    clientProxy = new Proxy({\n      $connect: jest.fn().mockResolvedValue(undefined),\n      $disconnect: jest.fn().mockResolvedValue(undefined),\n      $transaction: jest.fn(async (args) => Array.isArray(args) ? Promise.all(args) : (typeof args === 'function' ? args(clientProxy) : Promise.resolve())),\n      $queryRaw: jest.fn().mockResolvedValue([]),\n      $queryRawUnsafe: jest.fn().mockResolvedValue([]),\n      $executeRaw: jest.fn().mockResolvedValue(1),\n      $executeRawUnsafe: jest.fn().mockResolvedValue(1),\n      $extends: jest.fn().mockReturnThis()\n    }, {\n      get(target, prop) {\n        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n        if (prop in target) return target[prop];\n        if (!models.has(prop)) models.set(prop, _createModelMock());\n        return models.get(prop);\n      }\n    });\n    return clientProxy;\n  };\n  const _createClientMock = _createPrismaProxyMock;\n  const sharedMock = (typeof globalThis !== 'undefined' && globalThis.__mockPrisma) || _createPrismaProxyMock();\n  if (typeof globalThis !== 'undefined') globalThis.__mockPrisma = sharedMock;\n  return { __esModule: true, PrismaClient: jest.fn(() => sharedMock), default: { PrismaClient: jest.fn(() => sharedMock) } };\n}, { virtual: true });\njest.mock('../config/prisma', () => {\n  const p = (typeof globalThis !== 'undefined' && globalThis.__mockPrisma) || new Proxy({}, { get: (t, prop) => (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') ? undefined : (t[prop] || (t[prop] = jest.fn().mockResolvedValue({ id: 1, name: 'Sample' }))) });\n  return { __esModule: true, prisma: p, default: p };\n}, { virtual: true });`;

    const codeToEmbed = isEsmJest
      ? `// [CovAI Native ESM Prisma Mock] Register BEFORE dynamically importing SUT:\nconst mockSharedPrisma = { $connect: jest.fn(), $disconnect: jest.fn(), $transaction: jest.fn(async (arg) => typeof arg === 'function' ? arg(mockSharedPrisma) : Promise.all(arg || [])) };\nawait jest.unstable_mockModule('@prisma/client', () => ({ __esModule: true, PrismaClient: jest.fn(() => mockSharedPrisma), default: { PrismaClient: jest.fn(() => mockSharedPrisma) } }));`
      : preambleCode && preambleCode.includes("PrismaClient")
        ? preambleCode.trim()
        : fallbackMock;

    prismaMockDirective =
      `\n   - CRITICAL DATABASE ISOLATION CONTRACT (PRISMA v7):\n` +
      `     * NEVER connect to a real database or allow unmocked 'new PrismaClient()' instantiation.\n` +
      `     * In Prisma v7 environments, unconfigured 'new PrismaClient()' will immediately throw PrismaClientInitializationError during module evaluation.\n` +
      `     * Top-level mock mandate: You MUST mock '@prisma/client' and local DB singletons (e.g. '../config/prisma', '../lib/prisma') at top-level before controller/service imports.\n` +
      `     * Use this self-contained in-memory proxy mock template at the very top of your test file:\n\`\`\`javascript\n${codeToEmbed}\n\`\`\``;
  }

  const hasMongoose = Boolean(
    unitTestContext?.mockContracts?.detectedDependencies?.includes(
      "mongoose-db",
    ) ||
    /mongoose/i.test(sourceCode || "") ||
    /mongoose/i.test(testFileInfo?.content || ""),
  );
  let mongooseMockDirective = "";
  if (definesMongooseModel(sourceCode)) {
    mongooseMockDirective = `For schema tests, use real Mongoose Schema and model behavior in memory. Mock only connection and persistence. Construct the document and check validateSync before assertions. A valid document has no validation error (validateSync() returns undefined in Mongoose 7/8). Use 24-character hex strings (e.g. '507f1f77bcf86cd799439011') or new mongoose.Types.ObjectId() for ObjectId fields. Test declared default values by omitting defaulted fields and asserting their resolved defaults. Check error.errors[field] when required or enum constraints are violated. Use the installed version's return contract. Check metadata with Model.schema.path, Model.modelName and Model.collection.name. Do not infer an undeclared default or collection name.
Schema evidence: ${JSON.stringify(analyzeMongooseSchemas(sourceCode))}`;
  } else if (hasMongoose) {
    const preambleCode = unitTestContext?.mockContracts?.mockPreambleCode || "";
    const fallbackMongooseMock = isVitest
      ? `// Universal Mongoose In-Memory Proxy Mock for Vitest\nconst { _createMongooseModelProxy } = vi.hoisted(() => {\n  const _sampleItem = { _id: '507f1f77bcf86cd799439011', id: '1', userId: '507f1f77bcf86cd799439011', name: 'Sample Item', category: { _id: '1', name: 'General' }, status: 'ACTIVE', email: 'sample@example.com' };\n  const _createQueryMock = (result = [_sampleItem]) => ({\n    exec: vi.fn(() => Promise.resolve(result)),\n    populate: vi.fn().mockReturnThis(),\n    sort: vi.fn().mockReturnThis(),\n    limit: vi.fn().mockReturnThis(),\n    skip: vi.fn().mockReturnThis(),\n    lean: vi.fn(() => Promise.resolve(result)),\n    select: vi.fn().mockReturnThis(),\n    where: vi.fn().mockReturnThis(),\n    distinct: vi.fn().mockReturnThis(),\n    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),\n    catch: (reject) => Promise.resolve(result).catch(reject),\n    finally: (cb) => Promise.resolve(result).finally(cb)\n  });\n  const _proxyMaker = () => {\n    const fn = vi.fn((doc = {}) => ({\n      _id: doc._id || '507f1f77bcf86cd799439011',\n      id: doc.id || '1',\n      userId: doc.userId || '507f1f77bcf86cd799439011',\n      ...doc,\n      save: vi.fn((cb) => { const saved = { _id: '507f1f77bcf86cd799439011', id: '1', ...doc }; if (typeof cb === 'function') cb(null, saved); return Promise.resolve(saved); }),\n      validate: vi.fn((cb) => { if (typeof cb === 'function') cb(null); return Promise.resolve(); }),\n      validateSync: vi.fn(() => null),\n      toObject: vi.fn(() => ({ _id: '507f1f77bcf86cd799439011', id: '1', ...doc })),\n      toJSON: vi.fn(() => ({ _id: '507f1f77bcf86cd799439011', id: '1', ...doc })),\n      isModified: vi.fn(() => false),\n      set: vi.fn().mockReturnThis(),\n      get: vi.fn((k) => doc[k]),\n      populate: vi.fn().mockReturnThis()\n    }));\n    Object.assign(fn, {\n      find: vi.fn(() => _createQueryMock([_sampleItem])),\n      findOne: vi.fn(() => _createQueryMock(_sampleItem)),\n      findById: vi.fn(() => _createQueryMock(_sampleItem)),\n      findOneAndUpdate: vi.fn(() => _createQueryMock(_sampleItem)),\n      findByIdAndUpdate: vi.fn(() => _createQueryMock(_sampleItem)),\n      findByIdAndDelete: vi.fn(() => _createQueryMock(_sampleItem)),\n      deleteOne: vi.fn(() => Promise.resolve({ deletedCount: 1 })),\n      deleteMany: vi.fn(() => Promise.resolve({ deletedCount: 1 })),\n      create: vi.fn((doc) => Promise.resolve({ _id: '507f1f77bcf86cd799439011', id: '1', ...(Array.isArray(doc) ? doc[0] : doc) })),\n      countDocuments: vi.fn(() => Promise.resolve(1)),\n      distinct: vi.fn(() => Promise.resolve(['sample'])),\n      aggregate: vi.fn(() => Promise.resolve([_sampleItem])),\n      insertMany: vi.fn((docs) => Promise.resolve(Array.isArray(docs) ? docs : [docs])),\n      bulkWrite: vi.fn(() => Promise.resolve({ ok: 1, insertedCount: 1, modifiedCount: 0 })),\n      watch: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),\n      validate: vi.fn(() => Promise.resolve()),\n      validateSync: vi.fn(() => null),\n      schema: { path: vi.fn(() => ({ validate: vi.fn(), required: vi.fn() })), paths: {}, obj: {}, methods: {}, statics: {} }\n    });\n    return fn;\n  };\n  return { _createMongooseModelProxy: _proxyMaker };\n});\nvi.mock('mongoose', () => {\n  class _MockObjectId {\n    constructor(id) { this.id = id || '507f1f77bcf86cd799439011'; this._bsontype = 'ObjectID'; }\n    toString() { return String(this.id); }\n    toHexString() { return String(this.id); }\n    valueOf() { return String(this.id); }\n    equals(other) { return String(this) === String(other); }\n    static isValid(id) { return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id); }\n  }\n  class _MockSchema {\n    constructor(obj = {}) { this.obj = obj; this.methods = {}; this.statics = {}; this.paths = {}; }\n    static Types = { ObjectId: _MockObjectId };\n    index() { return this; }\n    pre() { return this; }\n    post() { return this; }\n    plugin() { return this; }\n    set() { return this; }\n    path() { return { validate: vi.fn(), required: vi.fn() }; }\n  }\n  const m = {\n    model: vi.fn(() => _createMongooseModelProxy()),\n    models: new Proxy({}, { get: () => _createMongooseModelProxy() }),\n    Schema: _MockSchema,\n    Types: { ObjectId: _MockObjectId },\n    connect: vi.fn(() => Promise.resolve()),\n    disconnect: vi.fn(() => Promise.resolve()),\n    set: vi.fn(),\n    connection: { on: vi.fn(), once: vi.fn(), readyState: 1, db: { admin: () => ({ ping: vi.fn(() => Promise.resolve()) }) } }\n  };\n  return { default: m, ...m };\n});`
      : jestMongooseMockCode;

    const codeToEmbed =
      preambleCode && preambleCode.includes("mongoose")
        ? preambleCode.trim()
        : fallbackMongooseMock;
    mongooseMockDirective =
      `\n   - CRITICAL DATABASE ISOLATION CONTRACT (MONGOOSE):\n` +
      `     * NEVER connect to real MongoDB ('mongoose.connect'). All Mongoose models MUST be mocked with thenable in-memory proxies.\n` +
      `     * Queries (find, findOne, findById, populate) MUST be thenable and resolve realistic entity mock objects without hanging.\n` +
      `     * OBJECTID ASSERTION CONTRACT: In Mongoose, ObjectId fields (e.g. 'userId', '_id') are ObjectId objects containing an internal Buffer. NEVER assert strict equality directly against a string literal (e.g. 'expect(doc.userId).toBe("<hex>")'), which produces 'AssertionError: expected { Object (buffer) } to be "<hex>"'. ALWAYS convert ObjectId fields to strings before assertion: 'expect(doc.userId?.toString()).toBe("<hex>")' or 'expect(String(doc.userId)).toBe("<hex>")'.\n` +
      `     * NO CALLBACK (DONE) EXECUTION TIMEOUTS: Mongoose v7/v8 removed callback parameters from validate() and save(). NEVER write '(done)' callback signatures or call 'doc.validate(done)' / 'doc.save(done)', which will hang indefinitely and exceed the 10000ms Vitest timeout. Always write 'async () => { ... }' with await. Ensure mocked model validate() and save() methods resolve synchronously or within <100ms in RAM.\n` +
      `     * Mock 'mongoose' at the very top of your test file:\n\`\`\`javascript\n${codeToEmbed}\n\`\`\``;
  }

  const hasJwt = Boolean(
    unitTestContext?.mockContracts?.detectedDependencies?.includes(
      "jwt-auth",
    ) ||
    /jwt|jsonwebtoken/i.test(sourceCode || "") ||
    /verifyToken/i.test(sourceCode || "") ||
    /jwt|jsonwebtoken/i.test(testFileInfo?.content || ""),
  );
  let jwtMockDirective = "";
  if (hasJwt) {
    const fallbackJwtMock = buildJwtMockCode(framework, "mock_token_xyz");

    jwtMockDirective =
      `\n   - CRITICAL AUTH ISOLATION CONTRACT (JSONWEBTOKEN):\n` +
      `     * NEVER call real jsonwebtoken signing or verification without mock. Mock 'jsonwebtoken' at the top level.\n` +
      `     * For middleware like 'verifyToken', always supply 'req.cookies = { jwt: "mock_token" }' for authorized cases, and delete/omit cookies.jwt for missing token (401) branches.\n` +
      `     * Use this mock at the top of your test file:\n\`\`\`javascript\n${fallbackJwtMock}\n\`\`\``;
  }
  const hasBrowserOrExtensionGlobals = Boolean(
    /\b(?:chrome\s*\.\s*(?:runtime|tabs|storage|action|alarms|scripting|windows)|document\s*\.\s*(?:addEventListener|getElementById|querySelector|querySelectorAll|createElement|body)|window\s*\.\s*(?:addEventListener|location|scrollY)|MutationObserver)\b/.test(
      sourceCode || "",
    ),
  );
  const browserExtensionMockDirective = hasBrowserOrExtensionGlobals
    ? `\n   - CRITICAL BROWSER & CHROME EXTENSION ENVIRONMENT CONTRACT:\n` +
      `     * This source file executes in a browser / Chrome Extension environment and accesses globals such as 'chrome', 'document', 'window', 'navigator', 'localStorage', 'history', 'MutationObserver', or 'fetch'.\n` +
      `     * Before importing or requiring the source module, stub 'globalThis.chrome', 'globalThis.window', 'globalThis.document', 'globalThis.navigator', 'globalThis.localStorage', 'globalThis.history', 'globalThis.MutationObserver', and 'globalThis.fetch' in memory with jest.fn()/vi.fn() spies.\n` +
      `     * Capture callbacks passed to 'chrome.runtime.onMessage.addListener', 'chrome.tabs.onUpdated.addListener', 'chrome.tabs.onActivated.addListener', 'chrome.alarms.onAlarm.addListener', 'document.addEventListener', and 'window.addEventListener', and invoke those captured listener callbacks directly in your tests with realistic event/message payloads so every internal handler function is executed.\n` +
      `     * If the file has top-level DOM initialization (e.g. checking document.readyState === 'loading' vs 'complete', wrapping history.pushState/replaceState, or scheduling setTimeout/setInterval timers), use '${isVitest ? "vi.resetModules()" : "jest.resetModules()"}' across tests to test BOTH readyState branches, invoke patched history.pushState/replaceState, dispatch 'popstate'/'visibilitychange'/'beforeunload'/'pagehide' listeners, and advance timers with '${isVitest ? "vi.useFakeTimers()/vi.advanceTimersByTime()" : "jest.useFakeTimers()/jest.advanceTimersByTime()"}' so 100% of internal script functions are executed.`
    : "";

  const decisionTableMarkdown =
    unitTestContext?.decisionTable?.decisionTableMarkdown || "";
  const deltaDecisionTableMarkdown =
    unitTestContext?.decisionTable?.deltaDecisionTableMarkdown ||
    decisionTableMarkdown;
  const fullCasePlanMarkdown =
    decisionTableMarkdown || deltaDecisionTableMarkdown || "";
  const astFunctions =
    unitTestContext?.astMetadata?.exportedSymbols ||
    coverageDetails?.functionFlow ||
    [];
  const internalAstFunctions =
    unitTestContext?.astMetadata?.internalFunctions ||
    unitTestContext?.astMetadata?.details?.internalFunctions ||
    [];
  const coverageFunctions =
    coverageDetails?.functions || coverageDetails?.functionFlow || [];

  const businessFunctionTargets = [];
  const seenBusinessFnNames = new Set();
  const addBusinessFnTarget = (name, line = 1, kind = "exported", callers = []) => {
    const cleanName = String(name || "")
      .trim()
      .replace(/\(\)$/, "")
      .trim();
    if (
      !cleanName ||
      cleanName === "default" ||
      isTrivialCallbackFunctionName(cleanName) ||
      seenBusinessFnNames.has(cleanName.toLowerCase())
    ) {
      return;
    }
    seenBusinessFnNames.add(cleanName.toLowerCase());
    businessFunctionTargets.push({
      name: cleanName,
      line: Number(line) || 1,
      kind,
      callers: Array.isArray(callers) ? callers.filter(Boolean) : [],
    });
  };

  for (const sym of runtimeSymbols) {
    const resolvedName =
      sym.name === "default" ? sym.localName || "defaultExport" : sym.name;
    addBusinessFnTarget(resolvedName, sym.line || sym.startLine || 1, "exported");
  }
  for (const fn of coverageFunctions) {
    const fnName = fn?.realName || fn?.functionName || fn?.name;
    const isExp = exportedSymbols.some(
      (s) => String(s).toLowerCase() === String(fnName || "").toLowerCase(),
    );
    addBusinessFnTarget(
      fnName,
      fn?.line || fn?.startLine || 1,
      isExp ? "exported" : "internal",
    );
  }
  for (const intFn of internalAstFunctions) {
    const fnName = typeof intFn === "string" ? intFn : intFn?.name;
    addBusinessFnTarget(
      fnName,
      intFn?.line || intFn?.startLine || 1,
      "internal",
      intFn?.callers || intFn?.exportedCallers || [],
    );
  }
  if (sourceCode) {
    const declMatches = [
      ...sourceCode.matchAll(
        /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
      ),
      ...sourceCode.matchAll(
        /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g,
      ),
    ];
    for (const m of declMatches) {
      if (m[1]) {
        const isExp = exportedSymbols.some(
          (s) => String(s).toLowerCase() === m[1].toLowerCase(),
        );
        addBusinessFnTarget(m[1], 1, isExp ? "exported" : "internal");
      }
    }
  }

  const requiredUnitCases = getRequiredUnitCasesForFile(
    {
      funcsTotal:
        coverageDetails?.summary?.funcsTotal ??
        Math.max(1, businessFunctionTargets.length || astFunctions.length),
      branchesTotal:
        coverageDetails?.summary?.branchesTotal ??
        (unitTestContext?.astMetadata?.decisionPoints || []).length,
      linesTotal:
        coverageDetails?.summary?.linesTotal ??
        String(sourceCode || "").split("\n").length,
    },
    astFunctions,
  );
  const requiredCaseSummary =
    businessFunctionTargets.length > 0
      ? businessFunctionTargets
          .map((fn, idx) =>
            fn.kind === "exported"
              ? `   ${idx + 1}. Function \`${fn.name}\` (line ${fn.line}, exported) -> Write dedicated \`it("[${fn.name}] should ...", ...)\` test(s) covering its normal execution, branch conditions, and edge/error guards.`
              : `   ${idx + 1}. Function \`${fn.name}\` (line ${fn.line}, internal/script function${fn.callers.length ? `, called by ${fn.callers.join(", ")}` : ""}) -> Exercise via its exported caller(s) or registered event/message listener callbacks and prefix test title with \`"[${fn.name}] ..."\`.`,
          )
          .join("\n")
      : requiredUnitCases
          .map(
            (c, idx) =>
              `   ${idx + 1}. "[${c.label}] <concise scenario title>" (caseKey: ${c.key}) — ${c.description}`,
          )
          .join("\n");
  const decisionGuidanceStr =
    unitTestContext?.coverageGaps?.guidanceSummary ||
    "No complex branching detected";
  const cyclomaticComplexity =
    unitTestContext?.decisionTable?.summary?.cyclomaticComplexity ||
    unitTestContext?.astMetadata?.cyclomaticComplexity ||
    1 + (unitTestContext?.astMetadata?.decisionPoints || []).length;

  const uncoveredLinesStr = formatLineRanges(
    coverageDetails?.uncoveredLines || [],
  );
  const failedLinesStr =
    (coverageDetails?.failedLines || [])
      .map(
        (l) =>
          `Line ${l}: ${coverageDetails?.lines?.[l]?.error || "failed assertion"}`,
      )
      .join("\n") || "None";

  const branches =
    coverageDetails?.branches || coverageDetails?.branchFlow || [];
  const uncoveredBranches = branches.filter(
    (b) => b.status !== "fully_covered" || b.totalHits === 0,
  );
  const branchDetailsStr =
    uncoveredBranches.length > 0
      ? uncoveredBranches
          .slice(0, 35)
          .map((b) => {
            const missingPaths = (b.paths || [])
              .filter((p) => !p.covered)
              .map((p) => `${p.type} branch`)
              .join(" & ");
            return `- Line ${b.line} (${b.type}): condition "${b.condition || "branch"}" -> MISSING: ${missingPaths || b.status}`;
          })
          .join("\n")
      : "All branches currently covered";

  const functions =
    coverageDetails?.functions || coverageDetails?.functionFlow || [];
  const uncoveredFunctions = functions.filter(
    (f) => !f.covered || f.hits === 0,
  );
  const functionDetailsStr =
    uncoveredFunctions.length > 0
      ? uncoveredFunctions
          .slice(0, 30)
          .map(
            (f) =>
              `- Function "${f.realName || f.name}" (line ${f.line}) - 0 test invocations`,
          )
          .join("\n")
      : "All functions currently invoked";

  const prompt = isTest
    ? `You are an expert ${framework.toUpperCase()} unit testing engineer.
We need to improve and add new unit test cases to the EXISTING test file: ${testFileInfo.relativePath}
which tests the source file: ${cleanSource}

### 1. ROLE DEFINITION & PROJECT CONTEXT
- Testing Framework: ${framework.toUpperCase()} (${isVitest ? "Vitest ESM syntax: import { describe, test, it, expect, vi } from 'vitest';" : "Jest syntax: globals describe, test, it, expect, jest are available globally. In CommonJS NEVER import or declare 'jest' (e.g. NEVER write const { jest } = require('@jest/globals') or const jest = ...), as 'jest' is already a global parameter."})
- Target Test File: ${testFileInfo.relativePath} (Status: EXISTING FILE - MUST PRESERVE AND AUGMENT)
- Runner API contract: ${runnerContract}
- Branch reachability contract: ${pathContract}
- Target Source File: ${cleanSource}

### 2. TARGET FILE & IMPORT CONTRACT
- Source Module Import Path: "${cleanImportPath}" (e.g. ${importExample})
- EXPORTED PUBLIC SYMBOLS (ONLY import and call these directly): ${exportedSymbolsStr}
${unexportedWarning}
- MODEL SCHEMA INVARIANT: When testing Sequelize/Mongoose model definitions (e.g. defineVersionModel(sequelize)), ALWAYS import the exported function from "${cleanImportPath}". In expect(mockSequelize.define).toHaveBeenCalledWith(...) assertions, guarantee that every property object is properly closed with braces and comma (e.g. id: { type: ..., primaryKey: true },) before the next property or before the options object ({ tableName: ... }).
- CUCUMBER / GHERKIN AST FIXTURE INVARIANT: When testing Cucumber/Gherkin functions or AST code-generation (e.g. ParsedFeature, ParsedScenario, ParsedStep), NEVER pass incomplete mock step or scenario objects. Every step object MUST contain { lineNumber, stepText: string, keyword: 'Given'|'When'|'Then' }. Every scenario object MUST contain { lineNumber, title: string, steps: ParsedStep[] }.

### 3. CURRENT COVERAGE DIAGNOSTICS & GAPS
- Target: 100% Statements, Branches, Functions and Lines where reachable. Prioritize uncovered branch outcomes and meaningful behavior assertions. Static expectations are estimates until a real runner verifies them. Never change existing skips, source code, expected behavior or coverage exclusions to reach the target. ZERO .ENV DEPENDENCY: Never assume, expect, or read from real .env files or external configuration. All required environment variables and secrets MUST be fully mocked in RAM using runner-native stubs (${isVitest ? "vi.stubEnv for Vitest" : "process.env overrides in beforeEach/afterEach for Jest"}) with realistic mock values.
- Current Coverage: Lines ${coverageDetails?.summary?.linesPct ?? 0}%, Branches ${coverageDetails?.summary?.branchesPct ?? 0}%, Functions ${coverageDetails?.summary?.funcsPct ?? 0}%, Statements ${coverageDetails?.summary?.stmtsPct ?? 0}%
- Control Flow Graph Complexity: Cyclomatic Complexity (CC) = ${cyclomaticComplexity} (Basis Paths = ${cyclomaticComplexity})
- Uncovered Lines in Source: ${uncoveredLinesStr}
- Uncovered Functions (0 invocations):
${functionDetailsStr}
- Uncovered Branches & Conditions:
${branchDetailsStr}
- CRITICAL DECISION POINTS & BRANCH TARGETS TO EXERCISE:
${decisionGuidanceStr}
- Failed Assertions in Previous Test Run:
${failedLinesStr}

### 4. SOURCE CODE & EXISTING TESTS
${
  sourceCode
    ? `SOURCE CODE UNDER TEST:
\`\`\`javascript
${escapePromptCode(sourceCode, 15000)}
\`\`\`
`
    : ""
}

EXISTING TEST CODE IN ${testFileInfo.relativePath}:
\`\`\`javascript
${escapePromptCode(testFileInfo.content || "", 15000)}
\`\`\`

### 5. STRICT GENERATION RULES & METHODOLOGY (TARGETING >=90% TO 100% COVERAGE)
1. NEVER USE test.skip / it.skip / describe.skip / xit / xtest:
   - Every single test MUST be active and runnable using \`test(...)\` or \`it(...)\`.
   - Tests marked with \`.skip\` produce 0% coverage increase and are strictly forbidden.
2. ONLY IMPORT EXPORTED SYMBOLS & TEST INTERNAL LOGIC INDIRECTLY:
${unexportedWarning}
3. REUSE EXISTING TEST MOCKS AND CONVENTIONS:
   - Carefully inspect the EXISTING TEST CODE in ${testFileInfo.relativePath}.
   - Re-use the exact same mocks, fixtures, and beforeEach configurations already established.
4. MANDATORY COMPLETE BUSINESS FUNCTION & BRANCH COVERAGE SUITE (${businessFunctionTargets.length || requiredUnitCases.length} TARGET FUNCTION(S) | CC = ${cyclomaticComplexity}):
   - Always preserve existing user tests without deleting or modifying them; generated tests will be merged cleanly alongside any existing test blocks.
   - Unit testing verifies business logic functions and their internal branches (NOT just 4 generic HTTP/integration cases!). You MUST generate dedicated \`it(...)\` / \`test(...)\` block(s) covering EVERY business logic function listed below, plus all conditional branches (\`if/else\`, \`switch\`, ternary, logical \`||\`/\`&&\`/\`??\`, \`try/catch\`) so the file reaches 100% Statements, Branches, Functions, and Lines coverage:
${requiredCaseSummary}
${businessFunctionTargets.length > 1 ? `   - MINIMUM TEST BLOCK COUNT & FUNCTION COVERAGE MANDATE: There are ${businessFunctionTargets.length} distinct business logic functions above. Write dedicated test(...)/it(...) block(s) covering EVERY business logic function listed above (and all its conditional branches/error paths) rather than collapsing unrelated functions into 4 generic Category A/B/C/D tests. If 1 scenario exercises an exported function that delegates to internal helper(s), keep the primary bracket tag in the title and list ALL covered functions via \`// @covers fn1, fn2\` inside or immediately above that test block.` : ""}
   - MANDATORY FUNCTION TAG & @covers CONTRACT: Start each generated \`it(...)\` / \`test(...)\` title with the primary target function in brackets (e.g. \`"[functionName] should ..."\`) AND add a \`// @covers fn1, fn2\` comment listing every unit function covered by that scenario.
   - 100% PASSING ASSERTION GUARANTEE (ZERO FAILING AI TESTS):
     * NEVER write speculative \`expect(() => fn(...)).toThrow()\` or \`expect(fn(...)).rejects.toThrow()\` unless the function body literally contains an unguarded \`throw\` statement reachable in that exact test state! If a function catches errors internally (e.g. \`try/catch\` logging or returning \`null\`/\`undefined\`/\`false\` or \`res.status(500)\`), assert the returned fallback or \`res.status\` instead of \`.toThrow()\`!
     * MODULE SINGLETON STATE AWARENESS: If a module caches singleton state (such as \`let io = null\` in \`socket.js\` set by \`initSocket()\`), calling \`getSocketInstance()\` AFTER \`initSocket()\` has already run in an earlier test will return the initialized instance and WILL NOT throw! Test uninitialized state before initializing singletons, or reset modules, or assert the actual returned value.
     * DETERMINISTIC ASSERTIONS: Trace exact return expressions and mock return values from the source code before writing \`.toBe(...)\` or \`.toEqual(...)\`. When code uses dynamic timestamps (\`Date.now()\`, \`new Date()\`), assert deterministic fields or use \`expect.any(Number)\` / \`.toMatchObject(...)\` so tests never fail on runtime drift.
   - Branch/Logic Reference Matrix:
${fullCasePlanMarkdown}
   - You MUST include test cases addressing all applicable testing categories:
   - Category A (Happy Path - CORE LOGIC PATH TRAVERSAL):
     * MANDATORY POPULATED MULTI-ELEMENT FIXTURES: If a function accepts an array, collection, or list parameter (e.g. 'history', 'items', 'messages', 'data', 'turns'), you MUST pass a fully populated, valid multi-element fixture (minimum 2 to 3 distinct items) with all required fields populated.
     * NEVER pass empty arrays '[]' or empty objects '{}' in Category A! Empty collections trip early-return guards and fail to execute core business logic.
     * MULTI-ITEM TRANSFORMATIONS: To test loops, transformations, filtering, sorting, or merging, pass diverse collections (e.g. multiple items with different roles/types/statuses, consecutive matching items, and leading/trailing items) so all core logic loops and branches (e.g., L14-L55) are completely traversed and executed.
   - Category B (Boundary Values - GUARD VERIFICATION):
     * Test genuine boundary limits (0, -1, empty array '[]', empty string '""', empty object '{}', max bounds).
     * Recognize that empty collections '[]' test guard clauses only; verify that the function handles them gracefully (e.g. returns empty array without throwing).
     * DO NOT use empty collections for Category A or for testing downstream branches.
   - Category C (Branch Toggling - GUARD CLAUSE PRECEDENCE INVARIANT):
     * For internal conditional branches located AFTER early-return guards, you MUST provide valid outer inputs (e.g. populated multi-element collections) that satisfy all preceding guards, and ONLY vary the specific target property or element field to exercise the True and False paths.
     * NEVER pass top-level null, undefined, or empty arrays to test downstream internal branches, because doing so immediately trips early return guards and leaves internal branches unreached.
   - Category D (Error & Exception Handling):
     * Test error handling and schema violations while respecting the non-null body guarantee.
     * For pure collection normalizers without throw statements, test tolerance for malformed elements within a populated collection.
   - REQUIRED CATEGORY COVERAGE MANDATE:
     * Generate at least ONE dedicated, standalone \`it(...)\` or \`test(...)\` block for EVERY applicable category above (A. Happy Path, B. Boundary Values, C. Branch Toggling when branches exist, D. Error Handling when guards/throws/async calls exist). Do NOT skip required categories or generate only 1 smoke test!
   - STRUCTURED COEXISTENCE WITH EXISTING TESTS:
     * Carefully inspect EXISTING TEST CODE in ${testFileInfo.relativePath} so your generated tests reuse working mocks/imports cleanly and use distinct, descriptive scenario titles (never clobbering existing test names).
     * Wrap your generated test blocks cleanly (e.g. in \`describe('AI Suggested Unit Tests', () => { ... })\`) when adding to an existing file so existing user test blocks remain 100% intact. Do not generate fake or placeholder assertions like expect(true).toBe(true).
5. REAL ASSERTIONS, NO TRIVIAL PLACEHOLDERS:
   - DO NOT write placeholder assertions like expect(true).toBe(true) or expect(1).toBe(1).
   - Never generate fake or tautological assertions for unreachable or environment-dependent code.
   - Every assertion must verify real outputs, state changes, or mock call arguments.
6. CRITICAL: NEVER RETURN PLACEHOLDER COMMENTS LIKE '// No additional snippets needed' OR 'N/A':
   - "suggestedTestCode" MUST contain executable test(...) or it(...) blocks importing and testing ${cleanSource}.
   - If no existing test file exists, "suggestedTestCode" MUST contain the complete test file code.
7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):
   - ${isEsmJest ? "In Native ESM Jest (`--experimental-vm-modules`), mock application/external dependencies ONLY with `await jest.unstable_mockModule('module', () => ({ ... }))` BEFORE dynamically loading the target with `const { ... } = await import('${cleanImportPath}')`. NEVER use `jest.mock(...)` or `{ virtual: true }`." : "Mock application dependencies only. For Jest auto-mocks use jest.mock('module'); virtual mocks require jest.mock('module', () => ({ /* exports */ }), { virtual: true })."}
   - ZERO EXTERNAL .ENV REQUIREMENT: Every unit test must be 100% self-contained and run in memory without requiring real .env files on disk. If the tested module references process.env, stub the variables directly in test setup (${isVitest ? "vi.stubEnv('VAR', 'mock_value')" : "process.env.VAR = 'mock_value'"}) with safe, valid mock fixtures.
${mockInstructionsStr}${prismaMockDirective}${mongooseMockDirective}${jwtMockDirective}${browserExtensionMockDirective}
   - ONLY call functions listed under EXPORTED PUBLIC SYMBOLS (${exportedSymbolsStr}).
8. STRICT BRACKET BALANCE & SYNTACTIC INTEGRITY:
   - Every describe(...), test(...), it(...), and object literal MUST have fully-closed, matching parentheses ')' and braces '}'.
   - When declaring mock data objects, use standard 'const mockItem = { ... };' or 'var mockItem = globalThis["mockItem"] = globalThis["mockItem"] || { ... };'.
   - NEVER leave open parentheses or unclosed string literals at statement boundaries.
9. EXPRESS CONTROLLER & MIDDLEWARE FIXTURES CONTRACT:
   - When generating tests for Express controllers or route handlers (or mutating req.body, req.file, req.params, req.query, req.headers):
   - ALWAYS declare 'let req, res, next;' in the enclosing 'describe(...)' block AND initialize them inside 'beforeEach'!
   - Example:
     let req, res, next;
     beforeEach(() => {
       req = { body: {}, params: {}, query: {}, headers: {}, file: null, files: [], user: { id: 1, role: 'admin' } };
       res = { status: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, json: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, send: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, sendStatus: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, cookie: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, clearCookie: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, redirect: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, setHeader: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, write: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, end: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"} };
       next = ${isVitest ? "vi.fn()" : "jest.fn()"};
     });
   - NEVER access properties like 'req.file = ...' or 'req.body = ...' without ensuring 'req' is an object.
   - NON-NULL BODY GUARANTEE: In Express controller tests, 'req.body' MUST NEVER BE NULL OR UNDEFINED, even in Category D (Error Handling) test cases!
     Controllers routinely destructure 'const { a, b, items } = req.body;'. Passing 'req.body = null' causes fatal 'TypeError: Cannot destructure property ... of req.body as it is null'.
     To test missing/invalid input in Category D, pass an empty object 'req.body = {}' or empty fields, NEVER null.
   - STRUCTURED PAYLOADS: If the controller accesses or destructures 'req.body.items', 'req.body.data', etc., initialize them with valid collection types (e.g. 'items: []' or 'items: [{ id: 1, name: "Sample" }]') rather than primitive strings or missing keys.
10. RUNNER COMPATIBILITY (JEST & VITEST):
   - ${isEsmJest ? "In Native ESM Jest (`--experimental-vm-modules`), use `jest.fn()`, `await jest.unstable_mockModule(...)`, `const { ... } = await import(...)`." : "In Jest environments, use 'jest.fn()', 'jest.mock()', 'jest.spyOn()'."}
   - NEVER access 'vi.fn()' in Jest suites unless 'vi' is explicitly imported or aliased to 'jest'.
11. HERMETIC TEST TEARDOWN:
   - You MUST include afterEach(() => { vi.restoreAllMocks(); }); (Vitest) or afterEach(() => { jest.restoreAllMocks(); }); (Jest) in every test suite to prevent mock/spy leakage. NEVER use vi.mock() or jest.mock() on local constant files, schemas, or data fixtures.
12. MONGOOSE OBJECTID & ASYNC TIMEOUT PREVENTION CONTRACT:
   - When asserting on MongoDB/Mongoose ObjectId properties (e.g. 'userId', '_id', 'ownerId'): NEVER use direct strict equality against a string literal (e.g. expect(item.userId).toBe('507f1f77bcf86cd799439011') or expect(result.userId).toEqual('507f1f77bcf86cd799439011')). ObjectId instances contain Buffer internals, causing 'AssertionError: expected { Object (buffer) } to be "<hex>"'. ALWAYS call .toString(), e.g. expect(item.userId?.toString()).toBe('507f1f77bcf86cd799439011') or expect(String(item.userId)).toBe('507f1f77bcf86cd799439011').
   - NEVER use '(done)' callback parameters in test functions. Mongoose v7+ removed callbacks from validate() and save(); passing callbacks will cause tests to hang until the runner aborts with a 10000ms timeout. Always write async test functions (async () => { ... }) and ensure model validations, mocks, and error handlers resolve or reject promptly without hanging.

### 6. OUTPUT FORMAT
Format your output strictly in JSON (ensure valid JSON syntax: values MUST be strings enclosed in double quotes "...", never backtick characters):
{
  "explanation": "Summary of the added test cases and which branches are covered",
  "suggestedTestCode": "// only executable test code blocks with real assertions",
  "fullUpdatedContent": "// complete test file content to be written"
}
`
    : `You are an expert ${framework.toUpperCase()} unit testing engineer.
We need to generate a comprehensive unit test suite to achieve >=90% to 100% coverage across all 4 metrics (Statements, Branches, Functions, Lines) and fix failed assertions for this source file.

### 1. ROLE DEFINITION & PROJECT CONTEXT
- Testing Framework: ${framework.toUpperCase()} (${isVitest ? "Vitest ESM syntax: import { describe, test, it, expect, vi } from 'vitest';" : isEsmJest ? "Native Jest ESM (`--experimental-vm-modules`): ALWAYS import `{ jest, describe, it, test, expect, beforeEach, afterEach } from '@jest/globals'`. NEVER use `jest.mock(...)` or `require(...)`; ALWAYS use `await jest.unstable_mockModule(...)` BEFORE `const { ... } = await import(...)`, and include explicit `.js` extensions on all relative module paths." : "Jest CommonJS syntax: describe, test, it, expect, jest are globally available. In CommonJS NEVER import or declare 'jest' (e.g. NEVER write const { jest } = require('@jest/globals') or const jest = ...), as 'jest' is already a global parameter."})
- Target Source File: ${cleanSource}
- Target Test File: ${testFileInfo.relativePath} (Status: NEW TEST FILE TO CREATE)
- Runner API contract: ${runnerContract}
- Branch reachability contract: ${pathContract}

### 2. TARGET FILE & IMPORT CONTRACT
- Source Module Import Path: "${cleanImportPath}" (MUST import using: ${importExample}; DO NOT guess other folders or use reserved keyword \`default\` as a named import!)
- EXPORTED PUBLIC SYMBOLS (ONLY import and call these directly): ${exportedSymbolsStr}
${unexportedWarning}

### 3. CURRENT COVERAGE DIAGNOSTICS & GAPS
- Current Coverage: Lines ${coverageDetails?.summary?.linesPct ?? 0}%, Branches ${coverageDetails?.summary?.branchesPct ?? 0}%, Functions ${coverageDetails?.summary?.funcsPct ?? 0}%, Statements ${coverageDetails?.summary?.stmtsPct ?? 0}%
- Control Flow Graph Complexity: Cyclomatic Complexity (CC) = ${cyclomaticComplexity} (Basis Paths = ${cyclomaticComplexity})
- Uncovered Lines in Source: ${uncoveredLinesStr}
- Uncovered Functions (0 invocations):
${functionDetailsStr}
- Uncovered Branches & Conditions:
${branchDetailsStr}
- CRITICAL DECISION POINTS & BRANCH TARGETS TO EXERCISE:
${decisionGuidanceStr}
- Failed Assertions in Previous Test Run:
${failedLinesStr}

### 4. SOURCE CODE
\`\`\`javascript
${escapePromptCode(sourceCode, 15000)}
\`\`\`

### 5. STRICT GENERATION RULES & METHODOLOGY (TARGETING >=90% TO 100% COVERAGE)
1. NEVER USE test.skip / it.skip / describe.skip / xit / xtest:
   - Every single test MUST be active and runnable using \`test(...)\` or \`it(...)\`.
   - Tests marked with \`.skip\` produce 0% coverage increase and are strictly forbidden.
2. ONLY IMPORT EXPORTED SYMBOLS & TEST INTERNAL LOGIC INDIRECTLY:
${unexportedWarning}
3. REUSE EXISTING TEST MOCKS AND CONVENTIONS:
   - If test code exists, re-use existing mock patterns and assertions.
4. MANDATORY COMPLETE BUSINESS FUNCTION & BRANCH COVERAGE SUITE (${businessFunctionTargets.length || requiredUnitCases.length} TARGET FUNCTION(S) | CC = ${cyclomaticComplexity}):
   - Unit testing verifies business logic functions and their internal branches (NOT just 4 generic HTTP/integration cases!). Generate dedicated \`it(...)\` / \`test(...)\` block(s) covering EVERY business logic function listed below, plus all conditional branches (\`if/else\`, \`switch\`, ternary, logical \`||\`/\`&&\`/\`??\`, \`try/catch\`) so the file achieves 100% Statements, Branches, Functions, and Lines coverage:
${requiredCaseSummary}
${businessFunctionTargets.length > 1 ? `   - MINIMUM TEST BLOCK COUNT & FUNCTION COVERAGE MANDATE: There are ${businessFunctionTargets.length} distinct business logic functions above. Write dedicated test(...)/it(...) block(s) covering EVERY business logic function listed above (and all its conditional branches/error paths) rather than collapsing unrelated functions into 4 generic Category A/B/C/D tests. If 1 scenario exercises an exported function that delegates to internal helper(s), keep the primary bracket tag in the title and list ALL covered functions via \`// @covers fn1, fn2\` inside or immediately above that test block.` : ""}
   - MANDATORY FUNCTION TAG & @covers CONTRACT: Start each generated \`it(...)\` / \`test(...)\` title with the primary target function in brackets (e.g. \`"[functionName] should ..."\`) AND add a \`// @covers fn1, fn2\` comment listing every unit function covered by that scenario.
   - 100% PASSING ASSERTION GUARANTEE (ZERO FAILING AI TESTS):
     * NEVER write speculative \`expect(() => fn(...)).toThrow()\` or \`expect(fn(...)).rejects.toThrow()\` unless the function body literally contains an unguarded \`throw\` statement reachable in that exact test state! If a function catches errors internally (e.g. \`try/catch\` logging or returning \`null\`/\`undefined\`/\`false\` or \`res.status(500)\`), assert the returned fallback or \`res.status\` instead of \`.toThrow()\`!
     * MODULE SINGLETON STATE AWARENESS: If a module caches singleton state (such as \`let io = null\` in \`socket.js\` set by \`initSocket()\`), calling \`getSocketInstance()\` AFTER \`initSocket()\` has already run in an earlier test will return the initialized instance and WILL NOT throw! Test uninitialized state before initializing singletons, or reset modules, or assert the actual returned value.
     * DETERMINISTIC ASSERTIONS: Trace exact return expressions and mock return values from the source code before writing \`.toBe(...)\` or \`.toEqual(...)\`. When code uses dynamic timestamps (\`Date.now()\`, \`new Date()\`), assert deterministic fields or use \`expect.any(Number)\` / \`.toMatchObject(...)\` so tests never fail on runtime drift.
   - Branch/Logic Reference Decision Table:
${fullCasePlanMarkdown || deltaDecisionTableMarkdown || decisionTableMarkdown}
   - You MUST include test cases addressing all 4 essential business logic testing categories:
   - Category A (Happy Path - CORE LOGIC PATH TRAVERSAL):
     * MANDATORY POPULATED MULTI-ELEMENT FIXTURES: If a function accepts an array, collection, or list parameter (e.g. 'history', 'items', 'messages', 'data', 'turns'), you MUST pass a fully populated, valid multi-element fixture (minimum 2 to 3 distinct items) with all required fields populated.
     * NEVER pass empty arrays '[]' or empty objects '{}' in Category A! Empty collections trip early-return guards and fail to execute core business logic.
     * MULTI-ITEM TRANSFORMATIONS: To test loops, transformations, filtering, sorting, or merging, pass diverse collections (e.g. multiple items with different roles/types/statuses, consecutive matching items, and leading/trailing items) so all core logic loops and branches (e.g., L14-L55) are completely traversed and executed.
   - Category B (Boundary Values - GUARD VERIFICATION):
     * Test genuine boundary limits (0, -1, empty array '[]', empty string '""', empty object '{}', max bounds).
     * Recognize that empty collections '[]' test guard clauses only; verify that the function handles them gracefully (e.g. returns empty array without throwing).
     * DO NOT use empty collections for Category A or for testing downstream branches.
   - Category C (Branch Toggling - GUARD CLAUSE PRECEDENCE INVARIANT):
     * For internal conditional branches located AFTER early-return guards, you MUST provide valid outer inputs (e.g. populated multi-element collections) that satisfy all preceding guards, and ONLY vary the specific target property or element field to exercise the True and False paths.
     * NEVER pass top-level null, undefined, or empty arrays to test downstream internal branches, because doing so immediately trips early return guards and leaves internal branches unreached.
   - Category D (Error & Exception Handling):
     * Test error handling and schema violations while respecting the non-null body guarantee.
     * For pure collection normalizers without throw statements, test tolerance for malformed elements within a populated collection.
   - REQUIRED FUNCTION & BRANCH COVERAGE MANDATE:
     * Generate dedicated \`it(...)\` / \`test(...)\` blocks covering every business logic function in the file (${businessFunctionTargets.length || 1} function(s)) and all its branches so 100% of Functions, Statements, Branches, and Lines are covered and 100% of generated tests pass.
   - Never generate fake or placeholder assertions like expect(true).toBe(true) for unreachable or environment-dependent code.
5. REAL ASSERTIONS, NO TRIVIAL PLACEHOLDERS:
   - DO NOT write placeholder assertions like expect(true).toBe(true) or expect(1).toBe(1).
   - Never generate fake or tautological assertions for unreachable or environment-dependent code.
   - Assert exact return values, transformed objects, or mock invocations.
6. CRITICAL: NEVER RETURN PLACEHOLDER COMMENTS LIKE '// No additional snippets needed' OR 'N/A':
   - "suggestedTestCode" MUST contain executable test(...) or it(...) blocks importing and testing ${cleanSource}.
   - "fullUpdatedContent" MUST contain the complete, standalone test file ready to execute.
7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):
   - ${isEsmJest ? "In Native ESM Jest (`--experimental-vm-modules`), mock application/external dependencies ONLY with `await jest.unstable_mockModule('module', () => ({ ... }))` BEFORE dynamically loading the target with `const { ... } = await import('${cleanImportPath}')`. NEVER use `jest.mock(...)` or `{ virtual: true }`." : "Mock application dependencies only. For Jest auto-mocks use jest.mock('module'); virtual mocks require jest.mock('module', () => ({ /* exports */ }), { virtual: true })."}
${mockInstructionsStr}${prismaMockDirective}${mongooseMockDirective}${jwtMockDirective}${browserExtensionMockDirective}
   - ONLY call functions listed under EXPORTED PUBLIC SYMBOLS (${exportedSymbolsStr}).
8. STRICT BRACKET BALANCE & SYNTACTIC INTEGRITY:
   - Every describe(...), test(...), it(...), and object literal MUST have fully-closed, matching parentheses ')' and braces '}'.
   - When declaring mock data objects, use standard 'const mockItem = { ... };' or 'var mockItem = globalThis["mockItem"] = globalThis["mockItem"] || { ... };'.
   - NEVER leave open parentheses or unclosed string literals at statement boundaries.
9. EXPRESS CONTROLLER & MIDDLEWARE FIXTURES CONTRACT:
   - When generating tests for Express controllers or route handlers (or mutating req.body, req.file, req.params, req.query, req.headers):
   - ALWAYS declare 'let req, res, next;' in the enclosing 'describe(...)' block AND initialize them inside 'beforeEach'!
   - Example:
     let req, res, next;
     beforeEach(() => {
       req = { body: {}, params: {}, query: {}, headers: {}, file: null, files: [], user: { id: 1, role: 'admin' } };
       res = { status: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, json: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, send: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, sendStatus: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, cookie: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, clearCookie: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, redirect: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, setHeader: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, write: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, end: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"} };
       next = ${isVitest ? "vi.fn()" : "jest.fn()"};
     });
   - NEVER access properties like 'req.file = ...' or 'req.body = ...' without ensuring 'req' is an object.
   - NON-NULL BODY GUARANTEE: In Express controller tests, 'req.body' MUST NEVER BE NULL OR UNDEFINED, even in Category D (Error Handling) test cases!
     Controllers routinely destructure 'const { a, b, items } = req.body;'. Passing 'req.body = null' causes fatal 'TypeError: Cannot destructure property ... of req.body as it is null'.
     To test missing/invalid input in Category D, pass an empty object 'req.body = {}' or empty fields, NEVER null.
   - STRUCTURED PAYLOADS: If the controller accesses or destructures 'req.body.items', 'req.body.data', etc., initialize them with valid collection types (e.g. 'items: []' or 'items: [{ id: 1, name: "Sample" }]') rather than primitive strings or missing keys.
10. RUNNER COMPATIBILITY (JEST & VITEST):
   - ${isEsmJest ? "In Native ESM Jest (`--experimental-vm-modules`), use `jest.fn()`, `await jest.unstable_mockModule(...)`, `const { ... } = await import(...)`." : "In Jest environments, use 'jest.fn()', 'jest.mock()', 'jest.spyOn()'."}
   - NEVER access 'vi.fn()' in Jest suites unless 'vi' is explicitly imported or aliased to 'jest'.
11. HERMETIC TEST TEARDOWN:
   - You MUST include afterEach(() => { vi.restoreAllMocks(); }); (Vitest) or afterEach(() => { jest.restoreAllMocks(); }); (Jest) in every test suite to prevent mock/spy leakage. NEVER use vi.mock() or jest.mock() on local constant files, schemas, or data fixtures.
12. MONGOOSE OBJECTID & ASYNC TIMEOUT PREVENTION CONTRACT:
   - When asserting on MongoDB/Mongoose ObjectId properties (e.g. 'userId', '_id', 'ownerId'): NEVER use direct strict equality against a string literal (e.g. expect(item.userId).toBe('507f1f77bcf86cd799439011') or expect(result.userId).toEqual('507f1f77bcf86cd799439011')). ObjectId instances contain Buffer internals, causing 'AssertionError: expected { Object (buffer) } to be "<hex>"'. ALWAYS call .toString(), e.g. expect(item.userId?.toString()).toBe('507f1f77bcf86cd799439011') or expect(String(item.userId)).toBe('507f1f77bcf86cd799439011').
   - NEVER use '(done)' callback parameters in test functions. Mongoose v7+ removed callbacks from validate() and save(); passing callbacks will cause tests to hang until the runner aborts with a 10000ms timeout. Always write async test functions (async () => { ... }) and ensure model validations, mocks, and error handlers resolve or reject promptly without hanging.

### 6. OUTPUT FORMAT
Format your output strictly in JSON:
{
  "explanation": "Summary of the added test cases and which branches are covered",
  "suggestedTestCode": "// only executable test code blocks with real assertions",
"fullUpdatedContent": "// complete test file content to be written"
}
`;
  return withAgentContext(
    `${prompt}
${sourceLoaderContract}
EXPECTED-VALUE REVIEW: Trace each concrete input through the COMPLETE function before writing an assertion, including cleanup loops after the behavior named by the test. Derive the final returned value, not an intermediate state. For sequences, check filtering, role conversion, merging, leading/trailing pruning and appending in their actual execution order. Keep the current message's caller role; never invent a model response. Compare all generated cases with one another and with existing tests; identical inputs must not have contradictory expected outputs. Preserve existing test contracts. If source behavior conflicts with a documented requirement, report the conflict instead of silently changing that requirement.
INPUT CONTRACTS: ${JSON.stringify(inputContractSummary || [...sourceInputContracts(sourceCode || "").functions.values()])}
Use function-specific boundary fixtures. A string parameter still requires strings for unknown-key or boundary scenarios; do not pass objects, arrays or numbers and assume a graceful default. Respect nested interface field types and optional/nullable unions. Type assertions such as "as any" do not convert runtime values. Never sweep the same list of invalid inputs across unrelated exports. Test out-of-contract input only when the rejection behavior is established, with an explicit error assertion; do not invent validation or catch errors to claim coverage.
Resolve the exact target path before designing a fixture. For Express middleware, model request properties read by the actual handler, provide a chainable response and a next callback, and assert the handler's observable effects. Treat same-named functions in socket and HTTP modules as separate contracts.
For CommonJS scripts that execute at import time, install dependency doubles and intercept process.exit before loading the script. In Vitest, vi.mock does not intercept CommonJS require calls. Use createRequire and scoped require.cache replacements for those dependencies, and restore the previous cache entries and spies in finally. Assert calls against the same mock functions that the script receives.
PRESERVATION: Keep correct existing tests, license headers, comments, type imports, helpers, hooks and deliberate skip states. Return additions rather than replacing the suite. Existing test defects require a baseline failure and a documented contract before a scoped repair; never weaken an assertion to match faulty source behavior. Do not introduce @ts-nocheck, @ts-ignore or blanket type-checking suppressions.
Write new test descriptions, comments, and explanations in English. Preserve existing identifiers and expected application strings exactly.`,
    "unit-test",
  );
};

/**
 * Iterative AST Syntax Self-Healing Engine (Rule 5 & Rule 9)
 * Repairs missing semicolons at line:col, missing commas in objects/arrays,
 * unclosed blocks/braces, unseparated statements, and runs deep sanitization.
 */
export const autoHealAstSyntax = (
  codeString,
  {
    framework = "jest",
    filePath = "",
    maxRetries = 6,
    sourceCode = "",
    isMongooseModel = false,
  } = {},
) => {
  if (!codeString || typeof codeString !== "string") {
    return { success: false, code: codeString, error: "Empty code" };
  }
  let currentCode = codeString;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (typeof balanceTestFileBracesAndParens === "function") {
      try {
        currentCode = balanceTestFileBracesAndParens(currentCode);
      } catch (_) {}
    }
    if (typeof cleanAndDeduplicateTestContent === "function") {
      try {
        currentCode = cleanAndDeduplicateTestContent(
          currentCode,
          "",
          filePath,
          { framework, sourceCode, isMongooseModel },
        );
      } catch (_) {}
      if (typeof deduplicateAstDeclarations === "function") {
        try {
          const dedupRes = deduplicateAstDeclarations(currentCode, {
            filePath,
          });
          if (dedupRes.changed && dedupRes.code) currentCode = dedupRes.code;
        } catch (_) {}
      }
    }

    const parsed = parseJavaScriptCode(currentCode);
    if (parsed.success) {
      if (framework === "jest") {
        const mockError = getGeneratedJestMockError(parsed.ast);
        if (mockError)
          return { success: false, code: currentCode, error: mockError };
      }
      return { success: true, code: currentCode, ast: parsed.ast };
    }

    const msg = parsed.error || "";

    // 1. Missing semicolon at line:col (e.g. Missing semicolon. (2:15))
    const semiMatch = msg.match(/Missing semicolon\. \((\d+):(\d+)\)/);
    if (semiMatch) {
      const lineNum = parseInt(semiMatch[1], 10);
      const colNum = parseInt(semiMatch[2], 10);
      const lines = currentCode.split("\n");
      if (lineNum <= lines.length) {
        const line = lines[lineNum - 1];
        const before = line.slice(0, colNum);
        const after = line.slice(colNum);
        lines[lineNum - 1] = `${before};\n${after.trimStart()}`;
        currentCode = lines.join("\n");
        continue;
      }
    }

    // 2. Unexpected token (e.g. Unexpected token, expected "," (76:154) or Unexpected token ';')
    const unexpectedMatch = msg.match(
      /Unexpected token(?:, expected [",']?(.*?)[",']?)? \((\d+):(\d+)\)/,
    );
    if (unexpectedMatch) {
      const expectedToken = unexpectedMatch[1] || "";
      const lineNum = parseInt(unexpectedMatch[2], 10);
      const colNum = parseInt(unexpectedMatch[3], 10);
      const lines = currentCode.split("\n");
      if (lineNum > 0 && lineNum <= lines.length) {
        const targetLine = lines[lineNum - 1];
        const stripped = targetLine
          .replace(/\/\/.*$/, "")
          .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "");

        let pOpen = 0,
          pClose = 0;
        for (const ch of stripped) {
          if (ch === "(") pOpen++;
          else if (ch === ")") pClose++;
        }

        // If line has unclosed parentheses before semicolon, heal parentheses first!
        if (pOpen > pClose) {
          const semiIdx = targetLine.lastIndexOf(";");
          if (semiIdx !== -1) {
            lines[lineNum - 1] =
              targetLine.slice(0, semiIdx) +
              ")".repeat(pOpen - pClose) +
              targetLine.slice(semiIdx);
            currentCode = lines.join("\n");
            continue;
          }
        }

        if (expectedToken === ",") {
          const before = targetLine.slice(0, colNum);
          const after = targetLine.slice(colNum);
          lines[lineNum - 1] = `${before}, ${after.trimStart()}`;
          currentCode = lines.join("\n");
          continue;
        }
      }
    }

    // 3. Balance unclosed braces & parens at EOF
    const { openBraces, closeBraces, openParens, closeParens } =
      countSafeDelimiters(currentCode);
    if (openBraces > closeBraces) {
      let braceDiff = openBraces - closeBraces;
      let parenDiff = Math.max(0, openParens - closeParens);
      let suffix = "";
      while (braceDiff > 0 && parenDiff > 0) {
        suffix += "\n});";
        braceDiff--;
        parenDiff--;
      }
      while (braceDiff > 0) {
        suffix += "\n}";
        braceDiff--;
      }
      currentCode = currentCode.trim() + suffix;
      continue;
    }

    // 4. Decouple glued inline statements safely
    const decoupled = safeDecoupleInlineStatements(currentCode);
    if (decoupled !== currentCode) {
      currentCode = decoupled;
      continue;
    }

    // 5. Check if trailing closing delimiter is needed at EOF
    const trimmed = currentCode.trim();
    if (
      !trimmed.endsWith("}") &&
      !trimmed.endsWith(");") &&
      !trimmed.endsWith(";")
    ) {
      const safeDelims = countSafeDelimiters(currentCode);
      const needsParen = safeDelims.openParens > safeDelims.closeParens;
      const needsBrace = safeDelims.openBraces > safeDelims.closeBraces;
      if (needsParen && needsBrace) {
        currentCode = trimmed + "\n});";
        continue;
      } else if (needsBrace) {
        currentCode = trimmed + "\n}";
        continue;
      } else if (needsParen) {
        currentCode = trimmed + ");";
        continue;
      }
    }

    return { success: false, code: currentCode, error: msg };
  }

  return {
    success: false,
    code: currentCode,
    error: "Exceeded AST self-healing retries",
  };
};

/**
 * 3.2 RESPONSE PARSING & SANITY CHECK (AST SYNTAX VALIDATION & ANTI-SKIP)
 *
 * Validates, cleans, and verifies the AI generated code:
 * - Strips markdown wrapping (```json, ```javascript, ```).
 * - Extracts JSON safely.
 * - Removes .skip from test.skip / it.skip / describe.skip / xit / xtest.
 * - Filters out placeholder text ("N/A", "// No additional snippets needed").
 * - Validates AST syntax using Babel Parser (flags/repairs syntax errors).
 * - Ensures presence of test blocks and expect assertions.
 *
 * @param {object} params
 * @param {string} params.rawResponse - Raw string response from Gemini
 * @param {string} params.framework - "jest" or "vitest"
 * @param {string} params.cleanSource - Target source file
 * @returns {object} { success: boolean, parsed: object, syntaxValid: boolean, errors: string[] }
 */
export const parseAndSanitizeAiTestResponse = ({
  rawResponse = "",
  framework = "jest",
  cleanSource = "",
  sourceCode = "",
  rootDir = "",
  targetTestFile = "",
  isEsm = null,
}) => {
  const errors = [];
  if (!rawResponse || typeof rawResponse !== "string") {
    return {
      success: false,
      parsed: null,
      syntaxValid: false,
      errors: ["Empty AI response received"],
    };
  }

  let cleanText = rawResponse.trim();

  // 1. Strip markdown code fence blocks
  if (cleanText.includes("```json")) {
    cleanText = cleanText
      .replace(/^[\s\S]*?```json\s*/i, "")
      .replace(/```[\s\S]*$/, "")
      .trim();
  } else if (
    cleanText.includes("```javascript") ||
    cleanText.includes("```js")
  ) {
    cleanText = cleanText
      .replace(/^[\s\S]*?```(?:javascript|js)\s*/i, "")
      .replace(/```[\s\S]*$/, "")
      .trim();
  } else if (cleanText.includes("```")) {
    cleanText = cleanText
      .replace(/^[\s\S]*?```\s*/, "")
      .replace(/```[\s\S]*$/, "")
      .trim();
  }

  // 2. Extract JSON payload
  let parsedJson = null;

  // 2.1 Direct regex extraction for LLM outputs that wrap code in backticks (`...`) instead of JSON string quotes
  const extractBacktickField = (fieldName, text) => {
    const match = text.match(
      new RegExp(
        `["']${fieldName}["']\\s*:\\s*\`([\\s\\S]*?)\`\\s*(?:,|\\n|\\r|\\})`,
        "m",
      ),
    );
    return match ? match[1] : null;
  };

  const btTestCode = extractBacktickField("suggestedTestCode", cleanText);
  const btFullContent = extractBacktickField("fullUpdatedContent", cleanText);
  const btExplanation = extractBacktickField("explanation", cleanText);

  if (btTestCode || btFullContent) {
    parsedJson = {
      explanation:
        btExplanation || "Targeted unit test cases for uncovered branches",
      suggestedTestCode: btTestCode || btFullContent || "",
      fullUpdatedContent: btFullContent || btTestCode || "",
    };
  }

  if (!parsedJson) {
    try {
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedJson = JSON.parse(jsonMatch[0]);
      } else {
        parsedJson = JSON.parse(cleanText);
      }
    } catch (parseErr) {
      // Attempt mild JSON repair (e.g. unescaped newlines, backticks, or trailing commas)
      try {
        let repaired = cleanText
          .replace(
            /:\s*`([\s\S]*?)`\s*([,}])/g,
            (m, val, post) => `: ${JSON.stringify(val)}${post}`,
          )
          .replace(/,\s*([}\]])/g, "$1") // trailing commas
          .replace(/\r?\n/g, "\\n");
        const match = repaired.match(/\{[\s\S]*\}/);
        if (match) parsedJson = JSON.parse(match[0]);
      } catch (_) {
        // 2.2 Direct code extraction fallback from markdown code blocks or cleanText
        const codeBlockMatch = rawResponse.match(
          /```(?:javascript|js|typescript|ts)?\r?\n([\s\S]*?)```/,
        );
        const candidateCode = codeBlockMatch ? codeBlockMatch[1] : cleanText;
        if (
          candidateCode &&
          (candidateCode.includes("test(") ||
            candidateCode.includes("it(") ||
            candidateCode.includes("describe("))
        ) {
          parsedJson = {
            explanation: "Extracted test suite from code block response",
            suggestedTestCode: candidateCode.trim(),
            fullUpdatedContent: candidateCode.trim(),
          };
        } else {
          errors.push(`JSON parsing error: ${parseErr.message}`);
        }
      }
    }
  }

  if (!parsedJson) {
    return { success: false, parsed: null, syntaxValid: false, errors };
  }

  // 3. Anti-skip sanitization
  const unskipCode = (code) => {
    if (!code || typeof code !== "string") return code;
    return code
      .replace(/\b(test|it)\.skip\s*\(/g, "$1(")
      .replace(/\bdescribe\.skip\s*\(/g, "describe(")
      .replace(/\bxit\s*\(/g, "it(")
      .replace(/\bxtest\s*\(/g, "test(")
      .replace(/\bxdescribe\s*\(/g, "describe(");
  };

  if (parsedJson.suggestedTestCode) {
    parsedJson.suggestedTestCode = unskipCode(parsedJson.suggestedTestCode);
  }
  if (parsedJson.fullUpdatedContent) {
    parsedJson.fullUpdatedContent = unskipCode(parsedJson.fullUpdatedContent);
  }

  // 3.4. Decouple glued inline statements safely
  if (parsedJson.suggestedTestCode) {
    parsedJson.suggestedTestCode = safeDecoupleInlineStatements(
      parsedJson.suggestedTestCode,
    );
  }
  if (parsedJson.fullUpdatedContent) {
    parsedJson.fullUpdatedContent = safeDecoupleInlineStatements(
      parsedJson.fullUpdatedContent,
    );
  }

  // 3.5. Self-assignment sanitization (e.g. const path = path; -> const path = require('path'); or removal)
  const sanitizeSelfAssignments = (code) => {
    if (!code || typeof code !== "string") return code;
    const NODE_BUILTIN_MODULES = new Set([
      "path",
      "fs",
      "crypto",
      "http",
      "https",
      "os",
      "url",
      "util",
      "events",
      "stream",
      "child_process",
      "buffer",
      "zlib",
      "net",
      "tls",
      "cluster",
      "readline",
      "vm",
      "worker_threads",
    ]);
    const isTs = framework === "vitest" || /\bimport\s+/.test(code);
    return code.replace(
      /(?:^[ \t]*|\n[ \t]*)(const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*\2\s*;?[ \t]*(?:\r?\n|$)/gm,
      (match, kind, varName) => {
        if (NODE_BUILTIN_MODULES.has(varName)) {
          return isTs
            ? `\nimport ${varName} from '${varName}';\n`
            : `\nconst ${varName} = require('${varName}');\n`;
        }
        return "\n";
      },
    );
  };

  if (parsedJson.suggestedTestCode) {
    parsedJson.suggestedTestCode = sanitizeSelfAssignments(
      parsedJson.suggestedTestCode,
    );
    parsedJson.suggestedTestCode = healObjectIdAssertions(
      parsedJson.suggestedTestCode,
    );
  }
  if (parsedJson.fullUpdatedContent) {
    parsedJson.fullUpdatedContent = sanitizeSelfAssignments(
      parsedJson.fullUpdatedContent,
    );
    parsedJson.fullUpdatedContent = healObjectIdAssertions(
      parsedJson.fullUpdatedContent,
    );
  }

  // 4. Placeholder detection & reconciliation
  const isPlaceholderCode = (str) => {
    if (!str || typeof str !== "string") return true;
    const t = str.trim();
    if (t.length < 30) return true;
    if (
      t.includes("N/A") ||
      t.includes("Providing full file content below") ||
      t.includes("No additional snippets needed") ||
      t.includes("fullUpdatedContent below") ||
      t.includes("next block")
    )
      return true;
    if (t.startsWith("//") && !t.includes("test(") && !t.includes("it("))
      return true;
    if (t.startsWith("N/A") || t.startsWith("None") || t.startsWith("No "))
      return true;
    if (!t.includes("test(") && !t.includes("it(")) return true;
    return false;
  };

  if (
    isPlaceholderCode(parsedJson.suggestedTestCode) &&
    !isPlaceholderCode(parsedJson.fullUpdatedContent)
  ) {
    parsedJson.suggestedTestCode = parsedJson.fullUpdatedContent;
  } else if (
    isPlaceholderCode(parsedJson.fullUpdatedContent) &&
    !isPlaceholderCode(parsedJson.suggestedTestCode)
  ) {
    parsedJson.fullUpdatedContent = parsedJson.suggestedTestCode;
  }

  if (
    isPlaceholderCode(parsedJson.suggestedTestCode) &&
    isPlaceholderCode(parsedJson.fullUpdatedContent)
  ) {
    errors.push(
      "Both suggestedTestCode and fullUpdatedContent contain placeholder comments or lack executable test blocks",
    );
    return { success: false, parsed: parsedJson, syntaxValid: false, errors };
  }

  // Enforce runner imports before previewing or applying AI-generated code.
  const shouldUseEsmJest = Boolean(
    framework === "jest" &&
    (isEsm === true || (isEsm == null && rootDir && cleanSource && isProjectEsm(rootDir, cleanSource)))
  );
  for (const field of ["suggestedTestCode", "fullUpdatedContent"]) {
    if (parsedJson[field]) {
      parsedJson[field] = normalizeTestFrameworkCode(parsedJson[field], {
        framework,
      });
      if (framework === "vitest") {
        parsedJson[field] = healVitestCode(parsedJson[field], {
          filePath: cleanSource,
        });
      } else if (shouldUseEsmJest) {
        parsedJson[field] = convertJestMocksAndStaticImportsToEsm(parsedJson[field], {
          testFilePath: targetTestFile || cleanSource || "tests/unit.test.js",
          sourceCode: sourceCode ? [{ path: cleanSource || "src/target.js", content: sourceCode }] : [],
          rootDir: rootDir || null,
          targetSourceFile: cleanSource || null,
        });
      }
    }
  }

  // 5. AST Syntax Validation & Universal Self-Healing via Babel Parser (Rule 5 & Rule 9)
  const isMongooseModel = definesMongooseModel(sourceCode);
  let codeToValidate =
    parsedJson.fullUpdatedContent || parsedJson.suggestedTestCode;
  const healResult = autoHealAstSyntax(codeToValidate, {
    framework,
    filePath: cleanSource,
    sourceCode,
    isMongooseModel,
  });
  let syntaxValid = healResult.success;

  if (syntaxValid) {
    if (parsedJson.fullUpdatedContent) {
      const healedFull = autoHealAstSyntax(parsedJson.fullUpdatedContent, {
        framework,
        filePath: cleanSource,
        sourceCode,
        isMongooseModel,
      });
      if (healedFull.success) parsedJson.fullUpdatedContent = healedFull.code;
    }
    if (parsedJson.suggestedTestCode) {
      const healedSuggested = autoHealAstSyntax(parsedJson.suggestedTestCode, {
        framework,
        filePath: cleanSource,
        sourceCode,
        isMongooseModel,
      });
      if (healedSuggested.success)
        parsedJson.suggestedTestCode = healedSuggested.code;
    }
  } else {
    errors.push(
      `AST syntax validation failed: ${healResult.error || "Syntax error in generated test code"}`,
    );
  }

  // 5.1 Dedicated Vitest AST Structure & API Validation (Requirement R3)
  if (framework === "vitest") {
    const vitestCheck = validateVitestAstStructure(
      parsedJson.fullUpdatedContent || parsedJson.suggestedTestCode,
    );
    if (!vitestCheck.valid) {
      // Apply healing pass for any remaining issues
      for (const field of ["suggestedTestCode", "fullUpdatedContent"]) {
        if (parsedJson[field]) {
          parsedJson[field] = healVitestCode(parsedJson[field], {
            filePath: cleanSource,
            collectionError: vitestCheck.errors.join("; "),
          });
        }
      }
      const recheck = validateVitestAstStructure(
        parsedJson.fullUpdatedContent || parsedJson.suggestedTestCode,
      );
      if (!recheck.valid) {
        errors.push(...recheck.errors);
      }
    }
  }

  // 5.2 Pre-Execution Mock Validation & Normalization Layer
  let sourceContracts = [];
  try {
    if (sourceCode) {
      sourceContracts =
        analyzeDataAccessContracts({
          sourceCode,
          sourceFile: cleanSource,
        }).contracts || [];
    }
  } catch (_) {
    sourceContracts = [];
  }

  for (const field of ["suggestedTestCode", "fullUpdatedContent"]) {
    if (parsedJson[field]) {
      const mockCheck = validateAndNormalizeMocks({
        code: parsedJson[field],
        sourceFile: cleanSource,
        rootDir,
        framework,
      });
      if (mockCheck.modified && mockCheck.code) {
        parsedJson[field] = mockCheck.code;
      }
      for (const diag of mockCheck.diagnostics || []) {
        if (diag.severity === "error" && !errors.includes(diag.message)) {
          errors.push(diag.message);
        }
      }
      if (sourceContracts.length > 0) {
        const contractCheck = validateMockContracts({
          code: parsedJson[field],
          contracts: sourceContracts,
          framework,
          sourceFile: cleanSource,
        });
        for (const v of contractCheck.violations || []) {
          if (v.severity === "error" && !errors.includes(v.message)) {
            errors.push(v.message);
          }
        }
      }
    }
  }

  // 6. Ensure real assertions exist
  const hasAssertions = /expect\s*\(/.test(
    parsedJson.suggestedTestCode || parsedJson.fullUpdatedContent,
  );
  if (!hasAssertions) {
    errors.push("Generated test code lacks expect(...) assertions");
  }

  const success = syntaxValid && errors.length === 0;

  return {
    success,
    parsed: parsedJson,
    syntaxValid,
    hasAssertions,
    errors,
  };
};

/**
 * 3.3 RESILIENT GENERATION ORCHESTRATION (GEMINI LLM WITH ISOLATION FALLBACK)
 *
 * Runs the end-to-end Phase 3 generation process:
 * 1. Assembles complete Phase 1 AST & Phase 2 Context via assembleUnitTestContext.
 * 2. Builds 6-part standardized prompt via buildStandardUnitTestPrompt.
 * 3. Calls Gemini API with 45s race timeout.
 * 4. Parses and validates response via parseAndSanitizeAiTestResponse.
 * 5. Falls back seamlessly to generateFallbackUnitTests if AI service is offline or invalid.
 *
 * @param {object} params
 * @param {string} params.framework - "jest" or "vitest"
 * @param {object} params.snapshot - Project snapshot
 * @param {string} params.sourceFileToInspect - Relative source file under test
 * @param {string} params.sourceCode - Raw source code
 * @param {object} params.coverageDetails - Istanbul / v8 line/branch coverage data
 * @param {boolean} params.isTest - Whether target is existing test file
 * @param {string} params.filePath - Input target file path
 * @returns {Promise<object>} Suggestion result object
 */
export const generateAiUnitTestSuite = async ({
  userId,
  framework = "jest",
  snapshot,
  sourceFileToInspect,
  sourceCode,
  coverageDetails,
  isTest,
  filePath,
  targetTestFile,
  selectedAiModel = null,
  validateCollection = false,
}) => {
  const cleanSource = sanitizeSourceFilePath(
    snapshot?.rootDir,
    sourceFileToInspect,
  );
  const ext = path.extname(cleanSource) || ".js";
  const baseName = path
    .basename(cleanSource, ext)
    .replace(/\.(test|spec)$/i, "");

  const testFileInfo = targetTestFile
    ? {
        found: fs.existsSync(path.join(snapshot.rootDir, targetTestFile)),
        relativePath: targetTestFile,
        suggestedFilePath: targetTestFile,
        absolutePath: path.join(snapshot.rootDir, targetTestFile),
        fileName: path.basename(targetTestFile),
        content: fs.existsSync(path.join(snapshot.rootDir, targetTestFile))
          ? fs.readFileSync(path.join(snapshot.rootDir, targetTestFile), "utf8")
          : "",
        framework,
      }
    : isTest
      ? {
          found: true,
          relativePath: filePath,
          suggestedFilePath: filePath,
          absolutePath: path.join(snapshot.rootDir, filePath),
          fileName: path.basename(filePath),
          content: fs.existsSync(path.join(snapshot.rootDir, filePath))
            ? fs.readFileSync(path.join(snapshot.rootDir, filePath), "utf8")
            : "",
          framework,
        }
      : findExistingTestFile(snapshot.rootDir, cleanSource, framework);

  const targetPolicy = assertUnitTestTarget(
    snapshot.rootDir,
    testFileInfo.relativePath,
    framework,
  );
  let proposalBase = {};
  if (userId && snapshot?.projectId && snapshot?.id) {
    const { captureProjectProposalBase } =
      await import("./projectProposalBase.service.js");
    proposalBase = await captureProjectProposalBase({
      projectId: snapshot.projectId,
      snapshotId: snapshot.id,
      userId,
      path: testFileInfo.relativePath,
    });
    testFileInfo.content = proposalBase.existingContent;
    testFileInfo.found = proposalBase.isExisting;
  }
  const cleanImportPath = computeRelativeImportPath(
    testFileInfo.relativePath,
    cleanSource,
    snapshot?.rootDir,
  );

  // 1. Assemble Phase 1 AST & Phase 2 Context Engineering
  const unitTestContext = assembleUnitTestContext({
    sourceCode,
    coverageDetails,
    framework,
    existingTestCode: testFileInfo.content || "",
    sourceFile: cleanSource,
    targetTestFile: testFileInfo.relativePath,
    rootDir: snapshot?.rootDir,
  });

  // 2. Build Standard 6-Part Prompt (Section 3.1)
  const sourceContracts = sourceInputContracts(sourceCode || "", {
    rootDir: snapshot.rootDir,
    sourceFile: path.join(snapshot.rootDir, cleanSource),
  });
  const projectUsesEsm = Boolean(
    (snapshot?.rootDir && isProjectEsm(snapshot.rootDir, cleanSource)) ||
    /^\s*(?:import|export)\s+/m.test(sourceCode || ""),
  );
  const prompt = buildStandardUnitTestPrompt({
    framework,
    cleanSource,
    testFileInfo,
    cleanImportPath,
    coverageDetails,
    sourceCode,
    unitTestContext,
    isEsm: projectUsesEsm,
    inputContractSummary: {
      exports: [...sourceContracts.functions.values()],
      entryPoints: sourceContracts.entryPoints || [],
      requestRoutes: sourceContracts.requestRoutes || [],
    },
  });

  // 3. Invoke LLM with 90s Timeout
  const draftContext = {
    sourceCode,
    sourceFile: cleanSource,
    testFile: testFileInfo.relativePath,
    original: testFileInfo.content,
  };
  let aiParsedResult =
    proposeEmptyArrayFallbackTest({ ...draftContext, coverageDetails }) ||
    proposeCommonJsTestDraft({ ...draftContext, framework }) ||
    proposeShopprControllerDraft({ ...draftContext, framework });
  let aiGenerationError = null;
  let generationTimer = null;
  let telemetry = null;

  if (!aiParsedResult)
    try {
      const callStart = Date.now();
      const needsExtendedTokens =
        (sourceContracts?.functions?.size || 0) >= 6 ||
        (coverageDetails?.functions?.length || 0) >= 6 ||
        (sourceCode || "").length > 6000;
      const aiResponse = await Promise.race([
        generateText(prompt, selectedAiModel, {
          requestTimeoutMs: 45000,
          totalTimeoutMs: 90000,
          maxAttempts: 2,
          maxOutputTokens: needsExtendedTokens ? 8192 : 4096,
        }),
        new Promise((_, reject) => {
          generationTimer = setTimeout(
            () =>
              reject(new Error("AI generation timed out (90s limit reached)")),
            90000,
          );
        }),
      ]).finally(() => {
        if (generationTimer) {
          clearTimeout(generationTimer);
          generationTimer = null;
        }
      });

      const responseText =
        typeof aiResponse === "object" && aiResponse?.text !== undefined
          ? aiResponse.text
          : aiResponse;
      telemetry = aiResponse?.telemetry || {
        durationMs: Date.now() - callStart,
        durationSeconds: Number(((Date.now() - callStart) / 1000).toFixed(2)),
        tokens: {
          prompt: Math.max(1, Math.round(prompt.length / 4)),
          completion: Math.max(1, Math.round((responseText || "").length / 4)),
          total: Math.max(
            2,
            Math.round((prompt.length + (responseText || "").length) / 4),
          ),
        },
        model: "gemini",
      };

      // 4. Parse & Sanitize Response (Section 3.2)
      const parseCheck = parseAndSanitizeAiTestResponse({
        rawResponse: responseText,
        framework,
        cleanSource,
        sourceCode,
        rootDir: snapshot?.rootDir || "",
        targetTestFile: testFileInfo.relativePath,
        isEsm: projectUsesEsm,
      });

      if (parseCheck.success && parseCheck.parsed) {
        aiParsedResult = parseCheck.parsed;
      } else {
        aiGenerationError = (parseCheck.errors || []).join("; ");
        console.warn(
          `[unitTestGenerator] AI sanity check warning (${framework}): ${aiGenerationError}`,
        );
      }
    } catch (aiErr) {
      aiGenerationError = aiErr.message;
      console.warn(
        `[unitTestGenerator] AI Generation fallback triggered (${framework}): ${aiErr.message}`,
      );
    } finally {
      if (generationTimer) {
        clearTimeout(generationTimer);
        generationTimer = null;
      }
    }

  // 5. Resilient Isolation Mock Fallback if AI output failed validation
  if (!aiParsedResult) {
    aiParsedResult = generateFallbackUnitTests({
      framework,
      sourceFile: cleanSource,
      targetTestFile: testFileInfo.relativePath,
      rootDir: snapshot?.rootDir,
      baseName,
      uncoveredLines: coverageDetails?.uncoveredLines || [],
      existingContent: testFileInfo.content,
      sourceCode,
    });
  }

  const stripLeadingCaseNoise = (rawTitle = "") =>
    String(rawTitle || "")
      .trim()
      .replace(/^\[[^\]]+\]\s*[:\-]?\s*/i, "")
      .replace(/^TC-[A-Z0-9_/&\-\s]+:\s*/i, "")
      .replace(
        /^(?:Category\s+[A-D]\s*[:\-]?\s*)?(?:Happy\s+Path|Boundary(?:\s*\/\s*Edge|\s+Values?)?|Branch(?:\s+Paths?|\s+Toggling|\s+Coverage)?|Error(?:\s+Handling|\s*&\s*Exception)?)\s*[:\-]\s*/i,
        "",
      )
      .trim();

  const capGeneratedUnitTestsToRequiredCases = (
    code,
    _reqCases = [],
    originalCode = "",
    filePath = "unit.test.js",
  ) => {
    if (!code) return code;
    try {
      const blocks = extractUnitTestBlocks(code);
      if (!blocks || blocks.length === 0) return code;

      const existingTitles = new Set(
        extractUnitTestBlocks(originalCode || "").map((b) =>
          String(b.title || "")
            .trim()
            .toLowerCase(),
        ),
      );
      const rawNewBlocks = blocks.filter(
        (b) =>
          !existingTitles.has(
            String(b.title || "")
              .trim()
              .toLowerCase(),
          ),
      );
      if (rawNewBlocks.length === 0) return code;

      // Deduplicate identical new AI test blocks by normalized full title while preserving all distinct function test blocks
      const seenNewTitles = new Set();
      const duplicateBlocks = [];
      for (const b of rawNewBlocks) {
        const normT = String(b.title || "").trim().toLowerCase();
        if (seenNewTitles.has(normT)) {
          duplicateBlocks.push(b);
        } else {
          seenNewTitles.add(normT);
        }
      }

      if (duplicateBlocks.length === 0) return code;

      const edits = [];
      for (const rem of duplicateBlocks) {
        let start = rem.start;
        let end = rem.end;
        while (
          start > 0 &&
          (code[start - 1] === " " || code[start - 1] === "\t")
        ) {
          start--;
        }
        while (
          end < code.length &&
          (code[end] === "\r" || code[end] === "\n")
        ) {
          end++;
          if (code[end - 1] === "\n") break;
        }
        edits.push({ start, end, replacement: "" });
      }

      edits.sort((a, b) => b.start - a.start);
      let updated = code;
      for (const edit of edits) {
        updated =
          updated.slice(0, edit.start) +
          edit.replacement +
          updated.slice(edit.end);
      }
      return parseJavaScriptCode(updated, { filePath }).success
        ? updated
        : code;
    } catch {
      return code;
    }
  };

  const assembleCandidate = () => {
    const testFile = testFileInfo.relativePath;
    const astFunctions =
      unitTestContext?.astMetadata?.exportedSymbols ||
      coverageDetails?.functionFlow ||
      [];
    const requiredCases = getRequiredUnitCasesForFile(
      {
        funcsTotal:
          coverageDetails?.summary?.funcsTotal ??
          Math.max(1, astFunctions.length),
        branchesTotal:
          coverageDetails?.summary?.branchesTotal ??
          (unitTestContext?.astMetadata?.decisionPoints || []).length,
        linesTotal:
          coverageDetails?.summary?.linesTotal ??
          String(sourceCode || "").split("\n").length,
      },
      astFunctions,
    );
    let proposed = removeGeneratedNoCheckDirective(
      aiParsedResult.fullUpdatedContent ||
        aiParsedResult.suggestedTestCode ||
        "",
      testFile,
    );
    proposed = normalizeTestFrameworkCode(proposed, {
      framework,
      filePath: testFile,
    });
    proposed = hoistGeneratedVitestMocks(proposed, {
      framework,
      original: testFileInfo.content,
    });
    proposed = preserveMongooseSchemaInDraft({
      code: proposed,
      sourceCode,
      original: testFileInfo.content,
      framework,
    });
    proposed = capGeneratedUnitTestsToRequiredCases(
      proposed,
      requiredCases,
      testFileInfo.content || "",
      testFile,
    );
    let rebasedProposed = rebaseGeneratedTestModulePaths(proposed, {
      rootDir: snapshot.rootDir,
      testFile,
      sourceFile: cleanSource,
    });
    if (projectUsesEsm && framework === "jest") {
      rebasedProposed = convertJestMocksAndStaticImportsToEsm(rebasedProposed, {
        testFilePath: testFile,
        sourceCode: sourceCode ? [{ path: cleanSource, content: sourceCode }] : [],
        rootDir: snapshot.rootDir,
        targetSourceFile: cleanSource,
      });
    }
    if (!parseJavaScriptCode(rebasedProposed, { filePath: testFile }).success) {
      rebasedProposed = autoHealAstSyntax(rebasedProposed, {
        framework,
        filePath: testFile,
        sourceCode,
      });
    }
    const changeSet = assembleUnitTestCandidate({
      original: testFileInfo.content || "",
      proposed: rebasedProposed,
      testFile,
    });
    const cappedFinalContent = capGeneratedUnitTestsToRequiredCases(
      changeSet.content,
      requiredCases,
      testFileInfo.content || "",
      testFile,
    );
    changeSet.content = cappedFinalContent;
    aiParsedResult.fullUpdatedContent = cappedFinalContent;
    aiParsedResult.suggestedTestCode = cappedFinalContent;
    aiParsedResult.changeSet = changeSet;
    if (changeSet.content === testFileInfo.content)
      aiParsedResult.explanation =
        "The original suite is preserved. No executable additions were assembled; review the remaining coverage gaps or test diagnostics.";
  };
  try {
    assembleCandidate();
  } catch (error) {
    try {
      aiParsedResult = generateFallbackUnitTests({
        framework,
        sourceFile: cleanSource,
        targetTestFile: testFileInfo.relativePath,
        rootDir: snapshot?.rootDir,
        baseName,
        uncoveredLines: coverageDetails?.uncoveredLines || [],
        existingContent: testFileInfo.content,
        sourceCode,
      });
      assembleCandidate();
    } catch (fallbackError) {
      if (!testFileInfo.content) throw fallbackError;
      aiParsedResult = {
        explanation: fallbackError.message,
        suggestedTestCode: testFileInfo.content,
        fullUpdatedContent: testFileInfo.content,
        changeSet: {
          needsReview: [{ reason: fallbackError.message }],
          additions: [],
          repairs: [],
        },
      };
    }
  }

  const inspectCandidate = () =>
    inspectUnitTestQuality({
      rootDir: snapshot.rootDir,
      testFile: testFileInfo.relativePath,
      sourceFile: cleanSource,
      framework,
      code: aiParsedResult.fullUpdatedContent || "",
      original: testFileInfo.content || "",
    });
  const applyVerifiedFrameworkRepair = (gate) => {
    if (!gate?.findings?.length) return gate;
    const currentCode = aiParsedResult.fullUpdatedContent || "";
    const originalCode = testFileInfo.content || "";
    const repair = proposeVerifiedFrameworkRepair(
      currentCode,
      originalCode,
      gate.findings,
      { framework },
    );
    if (!repair?.content || repair.content === currentCode) return gate;
    try {
      if (!existingTestContractsPreserved(originalCode, repair.content))
        return gate;
    } catch {
      return gate;
    }
    const rechecked = inspectUnitTestQuality({
      rootDir: snapshot.rootDir,
      testFile: testFileInfo.relativePath,
      sourceFile: cleanSource,
      framework,
      code: repair.content,
      original: originalCode,
    });
    if (rechecked.findings.length <= gate.findings.length) {
      aiParsedResult.fullUpdatedContent = repair.content;
      aiParsedResult.suggestedTestCode = repair.content;
      if (aiParsedResult.changeSet) {
        aiParsedResult.changeSet = {
          ...aiParsedResult.changeSet,
          content: repair.content,
          candidateHash: testContentHash(repair.content),
          afterHash: testContentHash(repair.content),
          repairs: [
            ...(aiParsedResult.changeSet.repairs || []),
            { action: repair.action },
          ],
        };
      }
      return rechecked;
    }
    return gate;
  };
  let qualityGate = applyVerifiedFrameworkRepair(inspectCandidate());
  // Run collection only for candidates that passed static inspection.
  if (
    !qualityGate.findings.length &&
    validateCollection &&
    (framework === "vitest" || testFileInfo.relativePath?.includes("vitest"))
  ) {
    const candidateCode = aiParsedResult.fullUpdatedContent || "";
    if (candidateCode) {
      const vitestValidation = await validateAndHealVitestTestCollection({
        testCode: candidateCode,
        rootDir: snapshot?.rootDir,
        filePath: testFileInfo.relativePath,
        maxRetries: 3,
      });

      if (vitestValidation.success && vitestValidation.code) {
        aiParsedResult.fullUpdatedContent = vitestValidation.code;
        assembleCandidate();
      } else if (!vitestValidation.success) {
        console.warn(
          `[unitTestGenerator] Vitest collection validation failed after retries: ${vitestValidation.error}`,
        );
        aiParsedResult = generateFallbackUnitTests({
          framework,
          sourceFile: cleanSource,
          targetTestFile: testFileInfo.relativePath,
          rootDir: snapshot?.rootDir,
          baseName,
          uncoveredLines: coverageDetails?.uncoveredLines || [],
          existingContent: testFileInfo.content,
          sourceCode,
        });
        assembleCandidate();
        const fallbackCandidate = aiParsedResult.fullUpdatedContent || "";
        const fallbackValidation = await validateAndHealVitestTestCollection({
          testCode: fallbackCandidate,
          rootDir: snapshot?.rootDir,
          filePath: testFileInfo.relativePath,
          maxRetries: 2,
        });
        if (fallbackValidation.code) {
          aiParsedResult.fullUpdatedContent = fallbackValidation.code;
          assembleCandidate();
        }
      }
    }
  }
  qualityGate = applyVerifiedFrameworkRepair(inspectCandidate());

  // 6. Format Final Primary Suggestion
  const cleanRepoPath = (p) => {
    if (!p) return "";
    let norm = p
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .trim();
    if (snapshot?.rootDir) {
      const normRoot = snapshot.rootDir
        .replace(/\\/g, "/")
        .replace(/^\.?\//, "")
        .trim();
      if (norm.startsWith(normRoot)) norm = norm.slice(normRoot.length);
    }
    norm = norm.replace(/^.*\/repo\//, "");
    return norm.replace(/^\/+/, "");
  };

  const cleanSourceFile = cleanRepoPath(sourceFileToInspect);
  const cleanTargetTest = cleanRepoPath(
    testFileInfo.relativePath || testFileInfo.fullPath,
  );
  const effectiveSourceCode =
    sourceCode ||
    (snapshot?.rootDir && sourceFileToInspect
      ? findSourceOnDisk(snapshot.rootDir, sourceFileToInspect).content
      : "");
  const computedSourceSha256 = effectiveSourceCode
    ? createHash("sha256").update(effectiveSourceCode).digest("hex")
    : undefined;

  const branches =
    coverageDetails?.branches || coverageDetails?.branchFlow || [];
  const uncoveredBranches = branches.filter(
    (b) => b.status !== "fully_covered" || b.totalHits === 0,
  );
  const targetBranchesList = uncoveredBranches.map(
    (b) => `${b.type}:${b.line}`,
  );
  const primaryTargetLines = coverageDetails?.uncoveredLines?.slice(0, 5) || [];
  const primaryReason =
    uncoveredBranches.length > 0
      ? `Branch ${uncoveredBranches[0].type} at line ${uncoveredBranches[0].line} (${uncoveredBranches[0].condition || "branch condition"}) was not executed`
      : primaryTargetLines.length > 0
        ? `Lines ${primaryTargetLines.join(", ")} not tested in current suite`
        : "Add test cases covering edge cases and logical conditions";

  const resolvedTestCode =
    aiParsedResult.suggestedTestCode || aiParsedResult.fullUpdatedContent || "";
  const scenarioMatrix = unitTestContext?.decisionTable?.matrixEntries || [];

  // Extract ONLY the newly generated AI test cases (excluding pre-existing user tests in testFileInfo.content)
  const existingUserTitles = new Set(
    extractUnitTestBlocks(testFileInfo.content || "").map((b) =>
      String(b.title || "")
        .trim()
        .toLowerCase(),
    ),
  );
  const generatedTestCases = extractUnitTestBlocks(
    aiParsedResult.fullUpdatedContent || resolvedTestCode || "",
  )
    .filter(
      (b) =>
        !existingUserTitles.has(
          String(b.title || "")
            .trim()
            .toLowerCase(),
        ),
    )
    .map((b) => {
      const def = classifyUnitTestCase({ title: b.title });
      return {
        title: b.title,
        caseKey: def.key,
        caseLabel: def.label,
        category: def.category,
        code: b.code,
        startLine: b.startLine,
        endLine: b.endLine,
        origin: "AI_DRAFT",
      };
    });

  const primarySuggestion = {
    targetPolicy,
    targetCandidates: testFileInfo.targetCandidates,
    ...proposalBase,
    proposalBase: { ...proposalBase, existingContent: undefined },
    suggestionId: `sug-${Date.now()}-1`,
    sourceFile: cleanSourceFile,
    sourceSha256: computedSourceSha256,
    targetSourceFile: cleanSourceFile,
    testFile: cleanTargetTest,
    targetTestFile: cleanTargetTest,
    framework,
    testType: "unit",
    targetLines: primaryTargetLines,
    targetBranches: targetBranchesList,
    reason: primaryReason,
    explanation:
      aiParsedResult.explanation ||
      `Exhaustive ${framework.toUpperCase()} unit tests for ${cleanSourceFile}`,
    generatedCode: resolvedTestCode,
    suggestedTestCode: resolvedTestCode,
    testCode: resolvedTestCode,
    originalCode: testFileInfo.content || "",
    fullUpdatedContent: aiParsedResult.fullUpdatedContent,
    testCases: generatedTestCases,
    changeSet: aiParsedResult.changeSet,
    qualityGate: {
      ...qualityGate,
      status: qualityGate.findings.length ? "REVIEW_REQUIRED" : "READY",
    },
    status: "GENERATED",
    isExisting: testFileInfo.found,
    uncoveredLines: coverageDetails?.uncoveredLines || [],
    failedLines: coverageDetails?.failedLines || [],
    uncoverageDiagnostics: coverageDetails?.uncoverageDiagnostics || null,
    summary: coverageDetails?.summary
      ? {
          linesPct: coverageDetails.summary.linesPct ?? 0,
          branchesPct: coverageDetails.summary.branchesPct ?? 0,
          functionsPct:
            coverageDetails.summary.functionsPct ??
            coverageDetails.summary.funcsPct ??
            0,
          statementsPct:
            coverageDetails.summary.statementsPct ??
            coverageDetails.summary.stmtsPct ??
            0,
          funcsPct:
            coverageDetails.summary.functionsPct ??
            coverageDetails.summary.funcsPct ??
            0,
          stmtsPct:
            coverageDetails.summary.statementsPct ??
            coverageDetails.summary.stmtsPct ??
            0,
          ...coverageDetails.summary,
        }
      : {
          linesPct: 0,
          branchesPct: 0,
          functionsPct: 0,
          statementsPct: 0,
        },
    decisionTableSummary: unitTestContext?.decisionTable?.summary,
    scenarioMatrix,
    telemetry: telemetry || {
      durationMs: 0,
      durationSeconds: 0,
      tokens: { prompt: 0, completion: 0, total: 0 },
      model: "fallback",
    },
  };

  return {
    ...primarySuggestion,
    targetPolicy,
    testCode: resolvedTestCode,
    targetSourceFile: cleanSourceFile,
    targetTestFile: cleanTargetTest,
    scenarioMatrix,
    suggestions: [primarySuggestion],
    telemetry: primarySuggestion.telemetry,
  };
};

const rootRunnerLocks = new Map();
const withRootRunnerLock = async (rootDir, taskFn) => {
  const key = path.resolve(String(rootDir || "default")).toLowerCase();
  const prev = rootRunnerLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  rootRunnerLocks.set(key, prev.then(() => current, () => current));
  await prev;
  try {
    return await taskFn();
  } finally {
    release();
    if (rootRunnerLocks.get(key) === current) {
      rootRunnerLocks.delete(key);
    }
  }
};

/**
 * Executes a single generated unit test draft in isolation (`materializeDraftTestsForRun` ->
 * Jest/Vitest -> `restoreDraftTestsForRun`), measures real passing tests & business function
 * coverage, and performs up to 2 targeted AI repair/gap-fill passes toward 100% pass & coverage.
 */
export const verifyAndRefineUnitTestDraft = async ({
  rootDir,
  snapshot,
  suggestion,
  sourceCode = "",
  selectedAiModel = null,
  maxPasses = 2,
  forceVerifyInTests = false,
  runEvaluator = null,
  generateTextFn = null,
} = {}) => {
  if (!suggestion || suggestion.isFullyCovered) return suggestion;
  const cleanSource = String(suggestion.sourceFile || suggestion.targetSourceFile || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const cleanTestFile = String(suggestion.testFile || suggestion.targetTestFile || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const initialCode = String(
    suggestion.fullUpdatedContent ||
      suggestion.suggestedTestCode ||
      suggestion.generatedCode ||
      suggestion.testCode ||
      "",
  );
  if (!cleanSource || !cleanTestFile || !initialCode.trim()) return suggestion;

  if (!runEvaluator) {
    if (process.env.JEST_WORKER_ID && !forceVerifyInTests) return suggestion;
    if (!rootDir || !fs.existsSync(rootDir)) return suggestion;
    const hasManifestOrModules =
      fs.existsSync(path.join(rootDir, "package.json")) ||
      fs.existsSync(path.join(rootDir, "node_modules")) ||
      fs.existsSync(path.join(rootDir, "server", "node_modules"));
    if (!hasManifestOrModules) return suggestion;
  }

  const framework = suggestion.framework === "vitest" ? "vitest" : "jest";
  const effectiveSource =
    sourceCode ||
    (rootDir && fs.existsSync(path.join(rootDir, cleanSource))
      ? fs.readFileSync(path.join(rootDir, cleanSource), "utf8")
      : "");
  const projectUsesEsm = Boolean(
    (rootDir && isProjectEsm(rootDir, cleanSource)) ||
      /^\s*(?:import|export)\s+/m.test(effectiveSource),
  );
  const existingUserTitles = new Set(
    extractUnitTestBlocks(suggestion.originalCode || "").map((b) =>
      String(b.title || "").trim().toLowerCase(),
    ),
  );

  const defaultEvaluateCandidate = async (candidateCode) => {
    return withRootRunnerLock(rootDir, async () => {
      const verifyId = `draft-verify-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const relCovDir = `.covai-temp/${verifyId}`;
      const absCovDir = path.join(rootDir, ".covai-temp", verifyId);
      let draftState = null;
      try {
        const {
          runJestCoverage,
          materializeDraftTestsForRun,
        } = await import("./runTestsJob.service.js");
        const { parseJestResults, parseVitestResults } = await import("./testResultParser.service.js");

        draftState = materializeDraftTestsForRun(rootDir, [
          {
            sourceFile: cleanSource,
            testFile: cleanTestFile,
            framework,
            code: candidateCode,
          },
        ]);

        let parsedRun = null;
        if (framework === "vitest") {
          const { runVitestCoverage } = await import("./vitestRunner.service.js");
          await runVitestCoverage(`verify-${verifyId}`, rootDir, snapshot?.vitestCommand, [cleanTestFile], {
            coverageDir: relCovDir,
            targetSourceFiles: [cleanSource],
            useHermeticMock: true,
          });
          parsedRun = parseVitestResults(absCovDir, { rootDir });
        } else {
          await runJestCoverage(`verify-${verifyId}`, rootDir, null, [cleanTestFile], snapshot?.jestCommand, {
            coverageDir: relCovDir,
            targetSourceFiles: [cleanSource],
            useHermeticMock: true,
          });
          parsedRun = parseJestResults(absCovDir, { rootDir });
        }

        const sumPath = [
          path.join(absCovDir, "coverage-summary.json"),
          path.join(absCovDir, "jest-coverage-summary.json"),
          path.join(absCovDir, "vitest-coverage-summary.json"),
        ].find((p) => fs.existsSync(p));
        const finalPath = [
          path.join(absCovDir, "coverage-final.json"),
          path.join(absCovDir, "jest-coverage-final.json"),
          path.join(absCovDir, "vitest-coverage-final.json"),
        ].find((p) => fs.existsSync(p));

        const normTarget = cleanSource.toLowerCase();
        const matchEntry = (obj) => {
          if (!obj || typeof obj !== "object") return null;
          for (const [k, v] of Object.entries(obj)) {
            if (k === "total") continue;
            const normK = k.replace(/\\/g, "/").toLowerCase();
            if (normK === normTarget || normK.endsWith("/" + normTarget) || normTarget.endsWith("/" + normK)) {
              return v;
            }
          }
          return null;
        };

        const sumJson = sumPath ? JSON.parse(fs.readFileSync(sumPath, "utf8")) : null;
        const finalJson = finalPath ? JSON.parse(fs.readFileSync(finalPath, "utf8")) : null;
        const sumEntry = matchEntry(sumJson);
        const finalEntry = matchEntry(finalJson);

        const uncoveredFns = [];
        const uncoveredLinesSet = new Set();
        const uncoveredBranchLines = new Set();
        if (finalEntry) {
          for (const [fnId, fnMeta] of Object.entries(finalEntry.fnMap || {})) {
            const hits = Number(finalEntry.f?.[fnId] || 0);
            const fnName = String(fnMeta?.name || "").trim();
            if (hits === 0 && fnName && !isTrivialCallbackFunctionName(fnName)) {
              uncoveredFns.push({
                name: fnName,
                line: fnMeta?.decl?.start?.line || fnMeta?.loc?.start?.line || fnMeta?.line || 1,
              });
            }
          }
          for (const [sId, loc] of Object.entries(finalEntry.statementMap || {})) {
            if (Number(finalEntry.s?.[sId] || 0) === 0 && loc?.start?.line) {
              uncoveredLinesSet.add(loc.start.line);
            }
          }
          for (const [bId, bMeta] of Object.entries(finalEntry.branchMap || {})) {
            const arr = finalEntry.b?.[bId] || [];
            if (Array.isArray(arr) && arr.some((h) => Number(h || 0) === 0)) {
              const bLine = bMeta?.line || bMeta?.loc?.start?.line;
              if (bLine) uncoveredBranchLines.add(bLine);
            }
          }
        }

        const scenarios = Array.isArray(parsedRun?.scenarios) ? parsedRun.scenarios : [];
        const failedScenarios = scenarios
          .filter((s) => String(s?.status || "").toLowerCase() === "failed" || s?.isSuiteLevelFailure)
          .map((s) => ({
            title: s.title || s.suiteName || cleanTestFile,
            error: Array.isArray(s.failureMessages) ? s.failureMessages.join("\n").slice(0, 1200) : "",
          }));
        const passedTests = Number(parsedRun?.passedTests || 0);
        const failedTests = Number(parsedRun?.failedTests || failedScenarios.length || 0);
        const linesPct = Number(sumEntry?.lines?.pct ?? 0);
        const branchesPct = Number(sumEntry?.branches?.pct ?? 0);
        const funcsPct = Number(sumEntry?.functions?.pct ?? 0);
        const stmtsPct = Number(sumEntry?.statements?.pct ?? 0);

        return {
          passedTests,
          failedTests,
          failedScenarios,
          linesPct,
          branchesPct,
          funcsPct,
          stmtsPct,
          uncoveredFns,
          uncoveredLines: Array.from(uncoveredLinesSet).sort((a, b) => a - b),
          uncoveredBranchLines: Array.from(uncoveredBranchLines).sort((a, b) => a - b),
        };
      } finally {
        if (draftState) {
          try {
            const { restoreDraftTestsForRun } = await import("./runTestsJob.service.js");
            restoreDraftTestsForRun(draftState);
          } catch {}
        }
        try {
          if (fs.existsSync(absCovDir)) fs.rmSync(absCovDir, { recursive: true, force: true });
        } catch {}
      }
    });
  };

  const evaluateFn = runEvaluator || defaultEvaluateCandidate;
  const scoreEval = (ev) => {
    if (!ev) return -1;
    const passBonus = ev.failedTests === 0 && ev.passedTests > 0 ? 100000 : ev.passedTests * 25 - ev.failedTests * 200;
    return passBonus + ev.funcsPct * 3 + ev.linesPct * 2 + ev.branchesPct * 2 + ev.stmtsPct;
  };

  let bestCode = initialCode;
  let bestEval = null;
  try {
    bestEval = await evaluateFn(bestCode);
  } catch (evalErr) {
    console.warn(`[verifyAndRefineUnitTestDraft] Initial evaluation skipped for ${cleanSource}:`, evalErr.message);
    return suggestion;
  }

  const aiCall = generateTextFn || generateText;
  for (let pass = 1; pass <= maxPasses; pass++) {
    const needsPassFix = bestEval.failedTests > 0 || bestEval.passedTests === 0;
    const needsCovFill =
      bestEval.uncoveredFns.length > 0 ||
      bestEval.linesPct < 100 ||
      bestEval.branchesPct < 100 ||
      bestEval.funcsPct < 100;
    if (!needsPassFix && !needsCovFill) break;

    const refinePrompt = [
      `Refine the ${framework.toUpperCase()} unit test file "${cleanTestFile}" for "${cleanSource}" so 100% of tests PASS and coverage reaches 100% across Functions, Lines, Branches, and Statements.`,
      `CURRENT MEASURED RESULTS: Passed=${bestEval.passedTests}, Failed=${bestEval.failedTests}, Lines=${bestEval.linesPct}%, Functions=${bestEval.funcsPct}%, Branches=${bestEval.branchesPct}%, Statements=${bestEval.stmtsPct}%.`,
      bestEval.failedScenarios.length > 0
        ? `FAILING TESTS TO FIX (MUST ALL PASS):\n${bestEval.failedScenarios
            .slice(0, 10)
            .map((f, i) => `${i + 1}. "${f.title}"\nError: ${f.error}`)
            .join("\n")}`
        : "All existing tests currently pass — preserve every passing test intact.",
      bestEval.uncoveredFns.length > 0
        ? `STILL UNCOVERED BUSINESS FUNCTIONS (0 hits — MUST add/update dedicated "[fnName] ..." tests to invoke every one):\n${bestEval.uncoveredFns
            .slice(0, 25)
            .map((fn) => `- ${fn.name}() at line ${fn.line}`)
            .join("\n")}`
        : "",
      bestEval.uncoveredLines.length > 0
        ? `STILL UNCOVERED SOURCE LINES: ${bestEval.uncoveredLines.slice(0, 40).join(", ")}`
        : "",
      bestEval.uncoveredBranchLines.length > 0
        ? `STILL UNCOVERED BRANCH LINES: ${bestEval.uncoveredBranchLines.slice(0, 30).join(", ")}`
        : "",
      effectiveSource
        ? `SOURCE CODE (${cleanSource}):\n\`\`\`javascript\n${escapePromptCode(effectiveSource, 14000)}\n\`\`\``
        : "",
      `CURRENT TEST CODE (${cleanTestFile}):\n\`\`\`javascript\n${escapePromptCode(bestCode, 14000)}\n\`\`\``,
      `REQUIREMENTS:`,
      `- Preserve existing passing tests cleanly.`,
      `- Fix every failing assertion or mock mismatch by tracing actual source behavior (NEVER invent speculative .toThrow() where errors are caught).`,
      `- Cover EVERY remaining uncovered function and branch listed above.`,
      `- Return strictly valid JSON: { "explanation": "...", "suggestedTestCode": "...", "fullUpdatedContent": "..." }`,
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const rawResp = await aiCall(refinePrompt, selectedAiModel, {
        requestTimeoutMs: 45000,
        totalTimeoutMs: 60000,
        maxAttempts: 1,
        maxOutputTokens: 8192,
      });
      const respText = typeof rawResp === "object" && rawResp?.text !== undefined ? rawResp.text : rawResp;
      const parsed = parseAndSanitizeAiTestResponse({
        rawResponse: respText,
        framework,
        cleanSource,
        sourceCode: effectiveSource,
        rootDir: rootDir || "",
        targetTestFile: cleanTestFile,
        isEsm: projectUsesEsm,
      });
      if (!parsed.success || !parsed.parsed) continue;
      let candidate = normalizeTestFrameworkCode(
        parsed.parsed.fullUpdatedContent || parsed.parsed.suggestedTestCode || "",
        { framework, filePath: cleanTestFile },
      );
      candidate = rebaseGeneratedTestModulePaths(candidate, {
        rootDir: rootDir || "",
        testFile: cleanTestFile,
        sourceFile: cleanSource,
      });
      if (projectUsesEsm && framework === "jest") {
        candidate = convertJestMocksAndStaticImportsToEsm(candidate, {
          testFilePath: cleanTestFile,
          sourceCode: effectiveSource ? [{ path: cleanSource, content: effectiveSource }] : [],
          rootDir: rootDir || "",
          targetSourceFile: cleanSource,
        });
      }
      if (!candidate.trim() || !parseJavaScriptCode(candidate, { filePath: cleanTestFile }).success) {
        continue;
      }

      const nextEval = await evaluateFn(candidate);
      const isStrictImprovement =
        nextEval.failedTests < bestEval.failedTests ||
        (nextEval.failedTests === bestEval.failedTests && scoreEval(nextEval) > scoreEval(bestEval));
      if (isStrictImprovement) {
        bestCode = candidate;
        bestEval = nextEval;
      }
    } catch (refineErr) {
      console.warn(`[verifyAndRefineUnitTestDraft] Pass ${pass} warning for ${cleanSource}:`, refineErr.message);
      break;
    }
  }

  const nextTestCases = extractUnitTestBlocks(bestCode)
    .filter((b) => !existingUserTitles.has(String(b.title || "").trim().toLowerCase()))
    .map((b) => {
      const def = classifyUnitTestCase({ title: b.title });
      return {
        title: b.title,
        caseKey: def.key,
        caseLabel: def.label,
        category: def.category,
        code: b.code,
        startLine: b.startLine,
        endLine: b.endLine,
        origin: "AI_DRAFT",
      };
    });

  return {
    ...suggestion,
    generatedCode: bestCode,
    suggestedTestCode: bestCode,
    testCode: bestCode,
    fullUpdatedContent: bestCode,
    ...(nextTestCases.length > 0 ? { testCases: nextTestCases } : {}),
    validation: {
      ...(suggestion.validation || {}),
      status: bestEval.failedTests === 0 ? "VERIFIED_DRAFT" : "NEEDS_REVIEW",
      coverageGoalStatus:
        bestEval.failedTests === 0 && bestEval.linesPct >= 100 && bestEval.funcsPct >= 100
          ? "MET"
          : "PARTIAL",
      passedTests: bestEval.passedTests,
      failedTests: bestEval.failedTests,
      linesPct: bestEval.linesPct,
      branchesPct: bestEval.branchesPct,
      funcsPct: bestEval.funcsPct,
      stmtsPct: bestEval.stmtsPct,
      uncoveredFunctions: bestEval.uncoveredFns.map((f) => f.name),
    },
  };
};
