import fs from "fs";
import { createHash } from 'node:crypto';
import { withAgentContext } from '../agents/registry.js';
import path from "path";
import { generateText as generateFeatureText } from './gemini.service.js';
import { withGeminiFeature } from './geminiRouting.service.js';
const generateText = (...args) => measureUnitTestPhase('ai', () => withGeminiFeature('unit-test', () => generateFeatureText(...args)));
import { parseJavaScriptCode } from "./babelParser.service.js";
import { assembleUnitTestCandidate, removeGeneratedNoCheckDirective } from './unitTestChangeSet.service.js';
import { sourceInputContracts } from './unitTestInputContracts.service.js';
import { assertUnitTestTarget } from './unitTestFilePolicy.service.js';
import { measureUnitTestPhase } from './unitTestWork.service.js';
import { normalizeTestFrameworkCode } from "./testFrameworkNormalization.service.js";
import { assembleUnitTestContext, buildIsolationMockContracts } from "./unitTestContextEngineering.service.js";
import {
    computeRelativeImportPath,
    formatLineRanges,
    generateFallbackUnitTests,
    findExistingTestFile,
    findSourceOnDisk,
    sanitizeSourceFilePath
} from "./unitTestSuggestion.service.js";
import { cleanAndDeduplicateTestContent, STATEMENT_SEPARATION_EXCLUSIONS, safeDecoupleInlineStatements, healBrokenCommentSplits, balanceTestFileBracesAndParens } from "./testSanitizer.service.js";
import { deduplicateAstDeclarations } from "./testHelperRegistry.service.js";
import {
    validateAndHealVitestTestCollection,
    healVitestCode,
    validateVitestAstStructure
} from "./vitestCollectionValidator.service.js";

/**
 * STAGE 3: AI TEST GENERATION VIA LLM
 *
 * Implements:
 * 3.1. Standard Prompt Structure for LLM (6 Rigid Sections)
 * 3.2. Response Parsing & Sanity Check (AST Syntax Validation, Anti-skip, Placeholder filtering)
 * 3.3. Resilient Generation Orchestration (Gemini LLM with Isolation Fallback)
 */

export const escapePromptCode = (code, maxLen = 25000) => {
    if (!code) return "";
    const sliced = typeof code === "string" ? code.slice(0, maxLen) : String(code);
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
    inputContractSummary = null
}) => {
    const isVitest = framework === "vitest";
    const isTest = Boolean(testFileInfo.found);
    const runnerContract = isVitest
        ? "Use ESM imports from 'vitest' and vi.fn/vi.spyOn/vi.mock. Never require('vitest') or use jest.*. Keep runner imports as ESM even when the source module uses CommonJS."
        : "For ESM tests import { jest } from '@jest/globals' before using jest.*. For CommonJS tests use the injected jest global without redeclaring it.";
    const pathContract = "Trace each input through normalization, validation/regex guards and early returns BEFORE choosing a later branch's expected result. An input rejected by an earlier guard cannot test a downstream result-type/error branch. Use an input accepted by all preceding guards, or isolate the real dependency with a supported mock. Never mock the function under test. Derive exact error messages from the reached return statement, not from the test title. Do not invent a passing test or weaken an assertion just to claim coverage of an unreachable branch.";

    const exportedSymbols = unitTestContext?.astMetadata?.exportedSymbolNames || [];
    const exportedSymbolsStr = exportedSymbols.length > 0 ? exportedSymbols.join(", ") : "All exported module members";
    const unexportedWarning = unitTestContext?.indirectTesting?.indirectGuidancePrompt || "";
    const mockInstructionsStr = unitTestContext?.mockContracts?.mockInstructions || "";
    const hasPrisma = Boolean(
        unitTestContext?.mockContracts?.detectedDependencies?.includes("prisma-db") ||
        /prisma|@prisma\/client/i.test(sourceCode || "") ||
        /prisma|@prisma\/client/i.test(testFileInfo?.content || "")
    );

    let prismaMockDirective = "";
    if (hasPrisma) {
        const preambleCode = unitTestContext?.mockContracts?.mockPreambleCode || "";
        const fallbackMock = isVitest
            ? `// 2. Universal Prisma Proxy Mock (Universal In-Memory Prisma Client Mock for Vitest, Prisma v7 Compatible)\nconst { mockPrismaClientInstance } = vi.hoisted(() => {\n  const defaultData = { id: 1, name: 'Sample', status: 'ACTIVE', email: 'sample@example.com', createdAt: new Date(), updatedAt: new Date() };\n  const _createModelMock = () => {\n    const baseModel = {\n      findUnique: vi.fn().mockResolvedValue(defaultData),\n      findFirst: vi.fn().mockResolvedValue(defaultData),\n      findMany: vi.fn().mockResolvedValue([defaultData]),\n      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n      createMany: vi.fn().mockResolvedValue({ count: 1 }),\n      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n      updateMany: vi.fn().mockResolvedValue({ count: 1 }),\n      upsert: vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.create || args?.update || {}) })),\n      delete: vi.fn().mockResolvedValue({ id: 1 }),\n      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),\n      count: vi.fn().mockResolvedValue(1),\n      aggregate: vi.fn().mockResolvedValue({ _count: 1, _sum: {}, _avg: {}, _min: {}, _max: {} }),\n      groupBy: vi.fn().mockResolvedValue([])\n    };\n    return new Proxy(baseModel, {\n      get(target, prop) {\n        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n        if (prop in target) return target[prop];\n        if (typeof prop === 'string') {\n          if (prop.includes('OrThrow') || prop.startsWith('findUnique') || prop.startsWith('findFirst')) target[prop] = vi.fn().mockResolvedValue(defaultData);\n          else if (prop.startsWith('find') || prop.includes('Many') || prop.includes('Return')) target[prop] = vi.fn().mockResolvedValue([defaultData]);\n          else if (prop.startsWith('count')) target[prop] = vi.fn().mockResolvedValue(1);\n          else if (prop.startsWith('create') || prop.startsWith('update') || prop.startsWith('upsert') || prop.startsWith('delete')) target[prop] = vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || args?.create || args?.update || {}) }));\n          else target[prop] = vi.fn().mockResolvedValue(defaultData);\n          return target[prop];\n        }\n        return undefined;\n      }\n    });\n  };\n  const _createPrismaProxyMock = () => {\n    const models = new Map();\n    let clientProxy;\n    clientProxy = new Proxy({\n      $connect: vi.fn().mockResolvedValue(undefined),\n      $disconnect: vi.fn().mockResolvedValue(undefined),\n      $transaction: vi.fn(async (args) => Array.isArray(args) ? Promise.all(args) : (typeof args === 'function' ? args(clientProxy) : Promise.resolve())),\n      $queryRaw: vi.fn().mockResolvedValue([]),\n      $queryRawUnsafe: vi.fn().mockResolvedValue([]),\n      $executeRaw: vi.fn().mockResolvedValue(1),\n      $executeRawUnsafe: vi.fn().mockResolvedValue(1),\n      $extends: vi.fn().mockReturnThis()\n    }, {\n      get(target, prop) {\n        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n        if (prop in target) return target[prop];\n        if (!models.has(prop)) models.set(prop, _createModelMock());\n        return models.get(prop);\n      }\n    });\n    return clientProxy;\n  };\n  const _createClientMock = _createPrismaProxyMock;\n  const clientProxy = _createPrismaProxyMock();\n  if (typeof globalThis !== 'undefined') {\n    globalThis.__mockPrisma = clientProxy;\n  }\n  return { mockPrismaClientInstance: clientProxy };\n});\nvi.mock('@prisma/client', () => ({\n  PrismaClient: vi.fn(() => mockPrismaClientInstance),\n  default: { PrismaClient: vi.fn(() => mockPrismaClientInstance) }\n}));`
            : `// 2. Universal Prisma Proxy Mock (Universal In-Memory Prisma Client Mock for Jest, Prisma v7 Compatible)\njest.mock('@prisma/client', () => {\n  const defaultData = { id: 1, name: 'Sample', status: 'ACTIVE', email: 'sample@example.com', createdAt: new Date(), updatedAt: new Date() };\n  const _createModelMock = () => {\n    const baseModel = {\n      findUnique: jest.fn().mockResolvedValue(defaultData),\n      findFirst: jest.fn().mockResolvedValue(defaultData),\n      findMany: jest.fn().mockResolvedValue([defaultData]),\n      create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n      createMany: jest.fn().mockResolvedValue({ count: 1 }),\n      update: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n      updateMany: jest.fn().mockResolvedValue({ count: 1 }),\n      upsert: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.create || args?.update || {}) })),\n      delete: jest.fn().mockResolvedValue({ id: 1 }),\n      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),\n      count: jest.fn().mockResolvedValue(1),\n      aggregate: jest.fn().mockResolvedValue({ _count: 1, _sum: {}, _avg: {}, _min: {}, _max: {} }),\n      groupBy: jest.fn().mockResolvedValue([])\n    };\n    return new Proxy(baseModel, {\n      get(target, prop) {\n        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n        if (prop in target) return target[prop];\n        if (typeof prop === 'string') {\n          if (prop.includes('OrThrow') || prop.startsWith('findUnique') || prop.startsWith('findFirst')) target[prop] = jest.fn().mockResolvedValue(defaultData);\n          else if (prop.startsWith('find') || prop.includes('Many') || prop.includes('Return')) target[prop] = jest.fn().mockResolvedValue([defaultData]);\n          else if (prop.startsWith('count')) target[prop] = jest.fn().mockResolvedValue(1);\n          else if (prop.startsWith('create') || prop.startsWith('update') || prop.startsWith('upsert') || prop.startsWith('delete')) target[prop] = jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || args?.create || args?.update || {}) }));\n          else target[prop] = jest.fn().mockResolvedValue(defaultData);\n          return target[prop];\n        }\n        return undefined;\n      }\n    });\n  };\n  const _createPrismaProxyMock = () => {\n    const models = new Map();\n    let clientProxy;\n    clientProxy = new Proxy({\n      $connect: jest.fn().mockResolvedValue(undefined),\n      $disconnect: jest.fn().mockResolvedValue(undefined),\n      $transaction: jest.fn(async (args) => Array.isArray(args) ? Promise.all(args) : (typeof args === 'function' ? args(clientProxy) : Promise.resolve())),\n      $queryRaw: jest.fn().mockResolvedValue([]),\n      $queryRawUnsafe: jest.fn().mockResolvedValue([]),\n      $executeRaw: jest.fn().mockResolvedValue(1),\n      $executeRawUnsafe: jest.fn().mockResolvedValue(1),\n      $extends: jest.fn().mockReturnThis()\n    }, {\n      get(target, prop) {\n        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n        if (prop in target) return target[prop];\n        if (!models.has(prop)) models.set(prop, _createModelMock());\n        return models.get(prop);\n      }\n    });\n    return clientProxy;\n  };\n  const _createClientMock = _createPrismaProxyMock;\n  const sharedMock = (typeof globalThis !== 'undefined' && globalThis.__mockPrisma) || _createPrismaProxyMock();\n  if (typeof globalThis !== 'undefined') globalThis.__mockPrisma = sharedMock;\n  return { __esModule: true, PrismaClient: jest.fn(() => sharedMock), default: { PrismaClient: jest.fn(() => sharedMock) } };\n}, { virtual: true });\njest.mock('../config/prisma', () => {\n  const p = (typeof globalThis !== 'undefined' && globalThis.__mockPrisma) || new Proxy({}, { get: (t, prop) => (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') ? undefined : (t[prop] || (t[prop] = jest.fn().mockResolvedValue({ id: 1, name: 'Sample' }))) });\n  return { __esModule: true, prisma: p, default: p };\n}, { virtual: true });`;

        const codeToEmbed = (preambleCode && preambleCode.includes("PrismaClient")) ? preambleCode.trim() : fallbackMock;

        prismaMockDirective = `\n   - CRITICAL DATABASE ISOLATION CONTRACT (PRISMA v7):\n` +
            `     * NEVER connect to a real database or allow unmocked 'new PrismaClient()' instantiation.\n` +
            `     * In Prisma v7 environments, unconfigured 'new PrismaClient()' will immediately throw PrismaClientInitializationError during module evaluation.\n` +
            `     * Top-level mock mandate: You MUST mock '@prisma/client' and local DB singletons (e.g. '../config/prisma', '../lib/prisma') at top-level before controller/service imports.\n` +
            `     * Use this self-contained in-memory proxy mock template at the very top of your test file:\n\`\`\`javascript\n${codeToEmbed}\n\`\`\``;
    }
    const decisionTableMarkdown = unitTestContext?.decisionTable?.decisionTableMarkdown || "";
    const deltaDecisionTableMarkdown = unitTestContext?.decisionTable?.deltaDecisionTableMarkdown || decisionTableMarkdown;
    const decisionGuidanceStr = unitTestContext?.coverageGaps?.guidanceSummary || "No complex branching detected";
    const cyclomaticComplexity = unitTestContext?.decisionTable?.summary?.cyclomaticComplexity ||
        unitTestContext?.astMetadata?.cyclomaticComplexity ||
        (1 + (unitTestContext?.astMetadata?.decisionPoints || []).length);

    const uncoveredLinesStr = formatLineRanges(coverageDetails?.uncoveredLines || []);
    const failedLinesStr = (coverageDetails?.failedLines || []).map(l => `Line ${l}: ${coverageDetails?.lines?.[l]?.error || "failed assertion"}`).join("\n") || "None";

    const branches = coverageDetails?.branches || coverageDetails?.branchFlow || [];
    const uncoveredBranches = branches.filter(b => b.status !== "fully_covered" || b.totalHits === 0);
    const branchDetailsStr = uncoveredBranches.length > 0
        ? uncoveredBranches.slice(0, 35).map(b => {
            const missingPaths = (b.paths || []).filter(p => !p.covered).map(p => `${p.type} branch`).join(" & ");
            return `- Line ${b.line} (${b.type}): condition "${b.condition || 'branch'}" -> MISSING: ${missingPaths || b.status}`;
        }).join("\n")
        : "All branches currently covered";

    const functions = coverageDetails?.functions || coverageDetails?.functionFlow || [];
    const uncoveredFunctions = functions.filter(f => !f.covered || f.hits === 0);
    const functionDetailsStr = uncoveredFunctions.length > 0
        ? uncoveredFunctions.slice(0, 30).map(f => `- Function "${f.realName || f.name}" (line ${f.line}) - 0 test invocations`).join("\n")
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
- Source Module Import Path: "${cleanImportPath}" (e.g. import { ... } from '${cleanImportPath}';)
- EXPORTED PUBLIC SYMBOLS (ONLY import and call these directly): ${exportedSymbolsStr}
${unexportedWarning}
- MODEL SCHEMA INVARIANT: When testing Sequelize/Mongoose model definitions (e.g. defineVersionModel(sequelize)), ALWAYS import the exported function from "${cleanImportPath}". In expect(mockSequelize.define).toHaveBeenCalledWith(...) assertions, guarantee that every property object is properly closed with braces and comma (e.g. id: { type: ..., primaryKey: true },) before the next property or before the options object ({ tableName: ... }).
- CUCUMBER / GHERKIN AST FIXTURE INVARIANT: When testing Cucumber/Gherkin functions or AST code-generation (e.g. ParsedFeature, ParsedScenario, ParsedStep), NEVER pass incomplete mock step or scenario objects. Every step object MUST contain { lineNumber, stepText: string, keyword: 'Given'|'When'|'Then' }. Every scenario object MUST contain { lineNumber, title: string, steps: ParsedStep[] }.

### 3. CURRENT COVERAGE DIAGNOSTICS & GAPS
- Target: 100% Statements, Branches, Functions and Lines where reachable. Prioritize uncovered branch outcomes and meaningful behavior assertions. Static expectations are estimates until a real runner verifies them. Never change existing skips, source code, expected behavior or coverage exclusions to reach the target. Required secrets must be reported, not invented.
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
${sourceCode ? `SOURCE CODE UNDER TEST:
\`\`\`javascript
${escapePromptCode(sourceCode, 25000)}
\`\`\`
` : ""}

EXISTING TEST CODE IN ${testFileInfo.relativePath}:
\`\`\`javascript
${escapePromptCode(testFileInfo.content || "", 25000)}
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
4. MANDATORY DELTA DECISION TABLE & CFG BASIS PATHS (CC = ${cyclomaticComplexity}, TARGET MINIMUM ${cyclomaticComplexity} BASIS PATHS):
   - To satisfy McCabe's Basis Path Testing invariant, generate complementary independent test scenarios covering missing execution paths in the Control Flow Graph.
   - Follow this targeted DELTA Decision Table (Scenarios remaining to cover, excluding already tested paths and infeasible code):
${deltaDecisionTableMarkdown}
   - You MUST include test cases addressing remaining unfulfilled business logic testing categories:
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
   - CRITICAL NON-DUPLICATION INVARIANT:
   - Carefully review the EXISTING TEST CODE in ${testFileInfo.relativePath}.
   - Do NOT regenerate or duplicate test cases that already exist in the test file!
   - Every generated test case must be novel and complementary, specifically fulfilling an unexercised scenario from the DELTA Decision Table above.
   - Never re-test already covered scenarios. Do not generate fake or placeholder assertions like expect(true).toBe(true) for unreachable code.
5. REAL ASSERTIONS, NO TRIVIAL PLACEHOLDERS:
   - DO NOT write placeholder assertions like expect(true).toBe(true) or expect(1).toBe(1).
   - Never generate fake or tautological assertions for unreachable or environment-dependent code.
   - Every assertion must verify real outputs, state changes, or mock call arguments.
6. CRITICAL: NEVER RETURN PLACEHOLDER COMMENTS LIKE '// No additional snippets needed' OR 'N/A':
   - "suggestedTestCode" MUST contain executable test(...) or it(...) blocks importing and testing ${cleanSource}.
   - If no existing test file exists, "suggestedTestCode" MUST contain the complete test file code.
7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):
${mockInstructionsStr}${prismaMockDirective}
   - ONLY call functions listed under EXPORTED PUBLIC SYMBOLS (${exportedSymbolsStr}).
8. STRICT BRACKET BALANCE & SYNTACTIC INTEGRITY:
   - Every describe(...), test(...), it(...), and object literal MUST have fully-closed, matching parentheses ')' and braces '}'.
   - When declaring mock data objects, use standard 'const mockItem = { ... };' or 'var mockItem = globalThis["mockItem"] = globalThis["mockItem"] || { ... };'.
   - NEVER leave open parentheses or unclosed string literals at statement boundaries.
9. EXPRESS CONTROLLER & MIDDLEWARE FIXTURES CONTRACT:
   - When generating tests for Express controllers or route handlers (or mutating req.body, req.file, req.params, req.query, req.headers):
   - ALWAYS ensure 'req', 'res', and 'next' are properly initialized as objects before tests execute!
   - In beforeEach or within the test block:
     req = { body: {}, params: {}, query: {}, headers: {}, file: null, files: [], user: { id: 1, role: 'admin' } };
     res = { status: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, json: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, send: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, sendStatus: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, cookie: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, clearCookie: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, redirect: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, setHeader: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, write: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, end: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"} };
     next = ${isVitest ? "vi.fn()" : "jest.fn()"};
   - NEVER access properties like 'req.file = ...' or 'req.body = ...' without ensuring 'req' is an object.
   - NON-NULL BODY GUARANTEE: In Express controller tests, 'req.body' MUST NEVER BE NULL OR UNDEFINED, even in Category D (Error Handling) test cases!
     Controllers routinely destructure 'const { a, b, items } = req.body;'. Passing 'req.body = null' causes fatal 'TypeError: Cannot destructure property ... of req.body as it is null'.
     To test missing/invalid input in Category D, pass an empty object 'req.body = {}' or empty fields, NEVER null.
   - STRUCTURED PAYLOADS: If the controller accesses or destructures 'req.body.items', 'req.body.data', etc., initialize them with valid collection types (e.g. 'items: []' or 'items: [{ id: 1, name: "Sample" }]') rather than primitive strings or missing keys.
10. RUNNER COMPATIBILITY (JEST & VITEST):
   - In Jest environments, use 'jest.fn()', 'jest.mock()', 'jest.spyOn()'.
   - NEVER access 'vi.fn()' in Jest suites unless 'vi' is explicitly imported or aliased to 'jest'.
11. HERMETIC TEST TEARDOWN:
   - You MUST include afterEach(() => { vi.restoreAllMocks(); }); (Vitest) or afterEach(() => { jest.restoreAllMocks(); }); (Jest) in every test suite to prevent mock/spy leakage. NEVER use vi.mock() or jest.mock() on local constant files, schemas, or data fixtures.

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
- Testing Framework: ${framework.toUpperCase()} (${isVitest ? "Vitest ESM syntax: import { describe, test, it, expect, vi } from 'vitest';" : "Jest syntax: describe, test, it, expect, jest are globally available. In CommonJS NEVER import or declare 'jest' (e.g. NEVER write const { jest } = require('@jest/globals') or const jest = ...), as 'jest' is already a global parameter."})
- Target Source File: ${cleanSource}
- Target Test File: ${testFileInfo.relativePath} (Status: NEW TEST FILE TO CREATE)
- Runner API contract: ${runnerContract}
- Branch reachability contract: ${pathContract}

### 2. TARGET FILE & IMPORT CONTRACT
- Source Module Import Path: "${cleanImportPath}" (MUST import from: '${cleanImportPath}'; DO NOT guess other folders!)
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
${escapePromptCode(sourceCode, 25000)}
\`\`\`

### 5. STRICT GENERATION RULES & METHODOLOGY (TARGETING >=90% TO 100% COVERAGE)
1. NEVER USE test.skip / it.skip / describe.skip / xit / xtest:
   - Every single test MUST be active and runnable using \`test(...)\` or \`it(...)\`.
   - Tests marked with \`.skip\` produce 0% coverage increase and are strictly forbidden.
2. ONLY IMPORT EXPORTED SYMBOLS & TEST INTERNAL LOGIC INDIRECTLY:
${unexportedWarning}
3. REUSE EXISTING TEST MOCKS AND CONVENTIONS:
   - If test code exists, re-use existing mock patterns and assertions.
4. MANDATORY TEST MATRIX (DECISION TABLE) & CFG BASIS PATHS (CC = ${cyclomaticComplexity}, MINIMUM ${cyclomaticComplexity} BASIS PATHS):
   - To satisfy McCabe's Basis Path Testing invariant, generate at least ${cyclomaticComplexity} independent test scenarios covering all execution paths in the Control Flow Graph.
   - Follow this structured 4-category Decision Table created from AST analysis and coverage gaps:
${deltaDecisionTableMarkdown || decisionTableMarkdown}
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
   - Never generate fake or placeholder assertions like expect(true).toBe(true) for unreachable or environment-dependent code.
5. REAL ASSERTIONS, NO TRIVIAL PLACEHOLDERS:
   - DO NOT write placeholder assertions like expect(true).toBe(true) or expect(1).toBe(1).
   - Never generate fake or tautological assertions for unreachable or environment-dependent code.
   - Assert exact return values, transformed objects, or mock invocations.
6. CRITICAL: NEVER RETURN PLACEHOLDER COMMENTS LIKE '// No additional snippets needed' OR 'N/A':
   - "suggestedTestCode" MUST contain executable test(...) or it(...) blocks importing and testing ${cleanSource}.
   - "fullUpdatedContent" MUST contain the complete, standalone test file ready to execute.
7. ISOLATION MOCK CONTRACTS (PURE RAM EXECUTION):
${mockInstructionsStr}${prismaMockDirective}
   - ONLY call functions listed under EXPORTED PUBLIC SYMBOLS (${exportedSymbolsStr}).
8. STRICT BRACKET BALANCE & SYNTACTIC INTEGRITY:
   - Every describe(...), test(...), it(...), and object literal MUST have fully-closed, matching parentheses ')' and braces '}'.
   - When declaring mock data objects, use standard 'const mockItem = { ... };' or 'var mockItem = globalThis["mockItem"] = globalThis["mockItem"] || { ... };'.
   - NEVER leave open parentheses or unclosed string literals at statement boundaries.
9. EXPRESS CONTROLLER & MIDDLEWARE FIXTURES CONTRACT:
   - When generating tests for Express controllers or route handlers (or mutating req.body, req.file, req.params, req.query, req.headers):
   - ALWAYS ensure 'req', 'res', and 'next' are properly initialized as objects before tests execute!
   - In beforeEach or within the test block:
     req = { body: {}, params: {}, query: {}, headers: {}, file: null, files: [], user: { id: 1, role: 'admin' } };
     res = { status: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, json: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, send: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, sendStatus: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, cookie: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, clearCookie: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, redirect: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, setHeader: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, write: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}, end: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"} };
     next = ${isVitest ? "vi.fn()" : "jest.fn()"};
   - NEVER access properties like 'req.file = ...' or 'req.body = ...' without ensuring 'req' is an object.
   - NON-NULL BODY GUARANTEE: In Express controller tests, 'req.body' MUST NEVER BE NULL OR UNDEFINED, even in Category D (Error Handling) test cases!
     Controllers routinely destructure 'const { a, b, items } = req.body;'. Passing 'req.body = null' causes fatal 'TypeError: Cannot destructure property ... of req.body as it is null'.
     To test missing/invalid input in Category D, pass an empty object 'req.body = {}' or empty fields, NEVER null.
   - STRUCTURED PAYLOADS: If the controller accesses or destructures 'req.body.items', 'req.body.data', etc., initialize them with valid collection types (e.g. 'items: []' or 'items: [{ id: 1, name: "Sample" }]') rather than primitive strings or missing keys.
10. RUNNER COMPATIBILITY (JEST & VITEST):
   - In Jest environments, use 'jest.fn()', 'jest.mock()', 'jest.spyOn()'.
   - NEVER access 'vi.fn()' in Jest suites unless 'vi' is explicitly imported or aliased to 'jest'.
11. HERMETIC TEST TEARDOWN:
   - You MUST include afterEach(() => { vi.restoreAllMocks(); }); (Vitest) or afterEach(() => { jest.restoreAllMocks(); }); (Jest) in every test suite to prevent mock/spy leakage. NEVER use vi.mock() or jest.mock() on local constant files, schemas, or data fixtures.

### 6. OUTPUT FORMAT
Format your output strictly in JSON:
{
  "explanation": "Summary of the added test cases and which branches are covered",
  "suggestedTestCode": "// only executable test code blocks with real assertions",
"fullUpdatedContent": "// complete test file content to be written"
}
`;
    return withAgentContext(`${prompt}
EXPECTED-VALUE REVIEW: Trace each concrete input through the COMPLETE function before writing an assertion, including cleanup loops after the behavior named by the test. Derive the final returned value, not an intermediate state. For sequences, check filtering, role conversion, merging, leading/trailing pruning and appending in their actual execution order. Keep the current message's caller role; never invent a model response. Compare all generated cases with one another and with existing tests; identical inputs must not have contradictory expected outputs. Preserve existing test contracts. If source behavior conflicts with a documented requirement, report the conflict instead of silently changing that requirement.
INPUT CONTRACTS: ${JSON.stringify(inputContractSummary || [...sourceInputContracts(sourceCode || '').functions.values()])}
Use function-specific boundary fixtures. A string parameter still requires strings for unknown-key or boundary scenarios; do not pass objects, arrays or numbers and assume a graceful default. Respect nested interface field types and optional/nullable unions. Type assertions such as "as any" do not convert runtime values. Never sweep the same list of invalid inputs across unrelated exports. Test out-of-contract input only when the rejection behavior is established, with an explicit error assertion; do not invent validation or catch errors to claim coverage.
PRESERVATION: Keep correct existing tests, license headers, comments, type imports, helpers, hooks and deliberate skip states. Return additions rather than replacing the suite. Existing test defects require a baseline failure and a documented contract before a scoped repair; never weaken an assertion to match faulty source behavior. Do not introduce @ts-nocheck, @ts-ignore or blanket type-checking suppressions.
Write new test descriptions, comments, and explanations in English. Preserve existing identifiers and expected application strings exactly.`, 'unit-test');
};

/**
 * Iterative AST Syntax Self-Healing Engine (Rule 5 & Rule 9)
 * Repairs missing semicolons at line:col, missing commas in objects/arrays,
 * unclosed blocks/braces, unseparated statements, and runs deep sanitization.
 */
export const autoHealAstSyntax = (codeString, { framework = "jest", filePath = "", maxRetries = 6 } = {}) => {
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
                currentCode = cleanAndDeduplicateTestContent(currentCode, "", filePath, { framework });
            } catch (_) {}
        if (typeof deduplicateAstDeclarations === 'function') {
            try {
                const dedupRes = deduplicateAstDeclarations(currentCode, { filePath });
                if (dedupRes.changed && dedupRes.code) currentCode = dedupRes.code;
            } catch (_) {}
        }
        }

        const parsed = parseJavaScriptCode(currentCode);
        if (parsed.success) {
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
        const unexpectedMatch = msg.match(/Unexpected token(?:, expected [",']?(.*?)[",']?)? \((\d+):(\d+)\)/);
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

                let pOpen = 0, pClose = 0;
                for (const ch of stripped) {
                    if (ch === "(") pOpen++;
                    else if (ch === ")") pClose++;
                }

                // If line has unclosed parentheses before semicolon, heal parentheses first!
                if (pOpen > pClose) {
                    const semiIdx = targetLine.lastIndexOf(";");
                    if (semiIdx !== -1) {
                        lines[lineNum - 1] = targetLine.slice(0, semiIdx) + ")".repeat(pOpen - pClose) + targetLine.slice(semiIdx);
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
        const openBraces = (currentCode.match(/{/g) || []).length;
        const closeBraces = (currentCode.match(/}/g) || []).length;
        const openParens = (currentCode.match(/\(/g) || []).length;
        const closeParens = (currentCode.match(/\)/g) || []).length;
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
        if (!trimmed.endsWith("}") && !trimmed.endsWith(");") && !trimmed.endsWith(";")) {
            const needsParen = (currentCode.match(/\(/g) || []).length > (currentCode.match(/\)/g) || []).length;
            const needsBrace = (currentCode.match(/{/g) || []).length > (currentCode.match(/}/g) || []).length;
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

    return { success: false, code: currentCode, error: "Exceeded AST self-healing retries" };
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
    cleanSource = ""
}) => {
    const errors = [];
    if (!rawResponse || typeof rawResponse !== "string") {
        return { success: false, parsed: null, syntaxValid: false, errors: ["Empty AI response received"] };
    }

    let cleanText = rawResponse.trim();

    // 1. Strip markdown code fence blocks
    if (cleanText.includes("```json")) {
        cleanText = cleanText.replace(/^[\s\S]*?```json\s*/i, "").replace(/```[\s\S]*$/, "").trim();
    } else if (cleanText.includes("```javascript") || cleanText.includes("```js")) {
        cleanText = cleanText.replace(/^[\s\S]*?```(?:javascript|js)\s*/i, "").replace(/```[\s\S]*$/, "").trim();
    } else if (cleanText.includes("```")) {
        cleanText = cleanText.replace(/^[\s\S]*?```\s*/, "").replace(/```[\s\S]*$/, "").trim();
    }

    // 2. Extract JSON payload
    let parsedJson = null;

    // 2.1 Direct regex extraction for LLM outputs that wrap code in backticks (`...`) instead of JSON string quotes
    const extractBacktickField = (fieldName, text) => {
        const match = text.match(new RegExp(`["']${fieldName}["']\\s*:\\s*\`([\\s\\S]*?)\`\\s*(?:,|\\n|\\r|\\})`, "m"));
        return match ? match[1] : null;
    };

    const btTestCode = extractBacktickField("suggestedTestCode", cleanText);
    const btFullContent = extractBacktickField("fullUpdatedContent", cleanText);
    const btExplanation = extractBacktickField("explanation", cleanText);

    if (btTestCode || btFullContent) {
        parsedJson = {
            explanation: btExplanation || "Targeted unit test cases for uncovered branches",
            suggestedTestCode: btTestCode || btFullContent || "",
            fullUpdatedContent: btFullContent || btTestCode || ""
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
                    .replace(/:\s*`([\s\S]*?)`\s*([,}])/g, (m, val, post) => `: ${JSON.stringify(val)}${post}`)
                    .replace(/,\s*([}\]])/g, "$1") // trailing commas
                    .replace(/\r?\n/g, "\\n");
                const match = repaired.match(/\{[\s\S]*\}/);
                if (match) parsedJson = JSON.parse(match[0]);
            } catch (_) {
                // 2.2 Direct code extraction fallback from markdown code blocks or cleanText
                const codeBlockMatch = rawResponse.match(/```(?:javascript|js|typescript|ts)?\r?\n([\s\S]*?)```/);
                const candidateCode = codeBlockMatch ? codeBlockMatch[1] : cleanText;
                if (candidateCode && (candidateCode.includes("test(") || candidateCode.includes("it(") || candidateCode.includes("describe("))) {
                    parsedJson = {
                        explanation: "Extracted test suite from code block response",
                        suggestedTestCode: candidateCode.trim(),
                        fullUpdatedContent: candidateCode.trim()
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
        parsedJson.suggestedTestCode = safeDecoupleInlineStatements(parsedJson.suggestedTestCode);
    }
    if (parsedJson.fullUpdatedContent) {
        parsedJson.fullUpdatedContent = safeDecoupleInlineStatements(parsedJson.fullUpdatedContent);
    }

    // 3.5. Self-assignment sanitization (e.g. const path = path; -> const path = require('path'); or removal)
    const sanitizeSelfAssignments = (code) => {
        if (!code || typeof code !== "string") return code;
        const NODE_BUILTIN_MODULES = new Set([
            "path", "fs", "crypto", "http", "https", "os", "url", "util", "events", "stream",
            "child_process", "buffer", "zlib", "net", "tls", "cluster", "readline", "vm", "worker_threads"
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
            }
        );
    };

    if (parsedJson.suggestedTestCode) {
        parsedJson.suggestedTestCode = sanitizeSelfAssignments(parsedJson.suggestedTestCode);
    }
    if (parsedJson.fullUpdatedContent) {
        parsedJson.fullUpdatedContent = sanitizeSelfAssignments(parsedJson.fullUpdatedContent);
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
        ) return true;
        if (t.startsWith("//") && !t.includes("test(") && !t.includes("it(")) return true;
        if (t.startsWith("N/A") || t.startsWith("None") || t.startsWith("No ")) return true;
        if (!t.includes("test(") && !t.includes("it(")) return true;
        return false;
    };

    if (isPlaceholderCode(parsedJson.suggestedTestCode) && !isPlaceholderCode(parsedJson.fullUpdatedContent)) {
        parsedJson.suggestedTestCode = parsedJson.fullUpdatedContent;
    } else if (isPlaceholderCode(parsedJson.fullUpdatedContent) && !isPlaceholderCode(parsedJson.suggestedTestCode)) {
        parsedJson.fullUpdatedContent = parsedJson.suggestedTestCode;
    }

    if (isPlaceholderCode(parsedJson.suggestedTestCode) && isPlaceholderCode(parsedJson.fullUpdatedContent)) {
        errors.push("Both suggestedTestCode and fullUpdatedContent contain placeholder comments or lack executable test blocks");
        return { success: false, parsed: parsedJson, syntaxValid: false, errors };
    }

    // Enforce runner imports before previewing or applying AI-generated code.
    for (const field of ["suggestedTestCode", "fullUpdatedContent"]) {
        if (parsedJson[field]) {
            parsedJson[field] = normalizeTestFrameworkCode(parsedJson[field], { framework });
            if (framework === "vitest") {
                parsedJson[field] = healVitestCode(parsedJson[field], { filePath: cleanSource });
            }
        }
    }

    // 5. AST Syntax Validation & Universal Self-Healing via Babel Parser (Rule 5 & Rule 9)
    let codeToValidate = parsedJson.fullUpdatedContent || parsedJson.suggestedTestCode;
    const healResult = autoHealAstSyntax(codeToValidate, { framework, filePath: cleanSource });
    let syntaxValid = healResult.success;

    if (syntaxValid) {
        if (parsedJson.fullUpdatedContent) {
            const healedFull = autoHealAstSyntax(parsedJson.fullUpdatedContent, { framework, filePath: cleanSource });
            if (healedFull.success) parsedJson.fullUpdatedContent = healedFull.code;
        }
        if (parsedJson.suggestedTestCode) {
            const healedSuggested = autoHealAstSyntax(parsedJson.suggestedTestCode, { framework, filePath: cleanSource });
            if (healedSuggested.success) parsedJson.suggestedTestCode = healedSuggested.code;
        }
    } else {
        errors.push(`AST syntax validation failed: ${healResult.error || "Syntax error in generated test code"}`);
    }

    // 5.1 Dedicated Vitest AST Structure & API Validation (Requirement R3)
    if (framework === "vitest") {
        const vitestCheck = validateVitestAstStructure(parsedJson.fullUpdatedContent || parsedJson.suggestedTestCode);
        if (!vitestCheck.valid) {
            // Apply healing pass for any remaining issues
            for (const field of ["suggestedTestCode", "fullUpdatedContent"]) {
                if (parsedJson[field]) {
                    parsedJson[field] = healVitestCode(parsedJson[field], { filePath: cleanSource, collectionError: vitestCheck.errors.join("; ") });
                }
            }
            const recheck = validateVitestAstStructure(parsedJson.fullUpdatedContent || parsedJson.suggestedTestCode);
            if (!recheck.valid) {
                errors.push(...recheck.errors);
            }
        }
    }

    // 6. Ensure real assertions exist
    const hasAssertions = /expect\s*\(/.test(parsedJson.suggestedTestCode || parsedJson.fullUpdatedContent);
    if (!hasAssertions) {
        errors.push("Generated test code lacks expect(...) assertions");
    }

    const success = syntaxValid && errors.length === 0;

    return {
        success,
        parsed: parsedJson,
        syntaxValid,
        hasAssertions,
        errors
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
    selectedAiModel = null,
    validateCollection = true
}) => {
    const cleanSource = sanitizeSourceFilePath(snapshot?.rootDir, sourceFileToInspect);
    const ext = path.extname(cleanSource) || ".js";
    const baseName = path.basename(cleanSource, ext).replace(/\.(test|spec)$/i, "");

    const testFileInfo = isTest
        ? {
            found: true,
            relativePath: filePath,
            suggestedFilePath: filePath,
            absolutePath: path.join(snapshot.rootDir, filePath),
            fileName: path.basename(filePath),
            content: fs.existsSync(path.join(snapshot.rootDir, filePath)) ? fs.readFileSync(path.join(snapshot.rootDir, filePath), "utf8") : "",
            framework
        }
        : findExistingTestFile(snapshot.rootDir, cleanSource, framework);

    const targetPolicy = assertUnitTestTarget(snapshot.rootDir, testFileInfo.relativePath, framework);
    let proposalBase = {};
    if (userId && snapshot?.projectId && snapshot?.id) {
        const { captureProjectProposalBase } = await import("./projectProposalBase.service.js");
        proposalBase = await captureProjectProposalBase({ projectId: snapshot.projectId, snapshotId: snapshot.id, userId, path: testFileInfo.relativePath });
        testFileInfo.content = proposalBase.existingContent;
        testFileInfo.found = proposalBase.isExisting;
    }
    const cleanImportPath = computeRelativeImportPath(testFileInfo.relativePath, cleanSource, snapshot?.rootDir);

    // 1. Assemble Phase 1 AST & Phase 2 Context Engineering
    const unitTestContext = assembleUnitTestContext({
        sourceCode,
        coverageDetails,
        framework,
        existingTestCode: testFileInfo.content || "",
        sourceFile: cleanSource,
        targetTestFile: testFileInfo.relativePath,
        rootDir: snapshot?.rootDir
    });

    // 2. Build Standard 6-Part Prompt (Section 3.1)
    const prompt = buildStandardUnitTestPrompt({
        framework,
        cleanSource,
        testFileInfo,
        cleanImportPath,
        coverageDetails,
        sourceCode,
        unitTestContext,
        inputContractSummary:[...sourceInputContracts(sourceCode || '',{rootDir:snapshot.rootDir,sourceFile:path.join(snapshot.rootDir,cleanSource)}).functions.values()]
    });

    // 3. Invoke LLM with 90s Timeout
    let aiParsedResult = null;
    let aiGenerationError = null;
    let generationTimer = null;

    try {
        const responseText = await Promise.race([
            generateText(prompt, selectedAiModel),
            new Promise((_, reject) => {
                generationTimer = setTimeout(() => reject(new Error("AI generation timed out (90s limit reached)")), 90000);
            })
        ]).finally(() => {
            if (generationTimer) {
                clearTimeout(generationTimer);
                generationTimer = null;
            }
        });

        // 4. Parse & Sanitize Response (Section 3.2)
        const parseCheck = parseAndSanitizeAiTestResponse({
            rawResponse: responseText,
            framework,
            cleanSource
        });

        if (parseCheck.success && parseCheck.parsed) {
            aiParsedResult = parseCheck.parsed;
        } else {
            aiGenerationError = (parseCheck.errors || []).join("; ");
            console.warn(`[unitTestGenerator] AI sanity check warning (${framework}): ${aiGenerationError}`);
        }
    } catch (aiErr) {
        aiGenerationError = aiErr.message;
        console.warn(`[unitTestGenerator] AI Generation fallback triggered (${framework}): ${aiErr.message}`);
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
            sourceCode
        });
    }

    const assembleCandidate = () => {
        const changeSet = assembleUnitTestCandidate({ original: testFileInfo.content || '',
            proposed: removeGeneratedNoCheckDirective(aiParsedResult.fullUpdatedContent || aiParsedResult.suggestedTestCode || '',testFileInfo.relativePath), testFile: testFileInfo.relativePath });
        aiParsedResult.fullUpdatedContent = changeSet.content;
        aiParsedResult.suggestedTestCode = changeSet.content;
        aiParsedResult.changeSet = changeSet;
        if (changeSet.content === testFileInfo.content) aiParsedResult.explanation = 'The original suite is preserved. No executable additions were assembled; review the remaining coverage gaps or test diagnostics.';
    };
    try { assembleCandidate(); }
    catch (error) {
        if (!testFileInfo.content) throw error;
        aiParsedResult = { explanation: error.message, suggestedTestCode: testFileInfo.content, fullUpdatedContent: testFileInfo.content,
            changeSet: { needsReview: [{ reason: error.message }], additions: [], repairs: [] } };
    }

    // Collection validates the complete assembled suite, never a delta snippet.
    if (validateCollection && (framework === "vitest" || testFileInfo.relativePath?.includes("vitest"))) {
        const candidateCode = aiParsedResult.fullUpdatedContent || "";
        if (candidateCode) {
            const vitestValidation = await validateAndHealVitestTestCollection({
                testCode: candidateCode,
                rootDir: snapshot?.rootDir,
                filePath: testFileInfo.relativePath,
                maxRetries: 3
            });

            if (vitestValidation.success && vitestValidation.code) {
                aiParsedResult.fullUpdatedContent = vitestValidation.code;
                assembleCandidate();
            } else if (!vitestValidation.success) {
                console.warn(`[unitTestGenerator] Vitest collection validation failed after retries: ${vitestValidation.error}`);
                aiParsedResult = generateFallbackUnitTests({
                    framework,
                    sourceFile: cleanSource,
                    targetTestFile: testFileInfo.relativePath,
                    rootDir: snapshot?.rootDir,
                    baseName,
                    uncoveredLines: coverageDetails?.uncoveredLines || [],
                    existingContent: testFileInfo.content,
                    sourceCode
                });
                assembleCandidate();
                const fallbackCandidate = aiParsedResult.fullUpdatedContent || "";
                const fallbackValidation = await validateAndHealVitestTestCollection({
                    testCode: fallbackCandidate,
                    rootDir: snapshot?.rootDir,
                    filePath: testFileInfo.relativePath,
                    maxRetries: 2
                });
                if (fallbackValidation.code) {
                    aiParsedResult.fullUpdatedContent = fallbackValidation.code;
                    assembleCandidate();
                }
            }
        }
    }

    // 6. Format Final Primary Suggestion
    const cleanRepoPath = (p) => {
        if (!p) return "";
        let norm = p.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
        if (snapshot?.rootDir) {
            const normRoot = snapshot.rootDir.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
            if (norm.startsWith(normRoot)) norm = norm.slice(normRoot.length);
        }
        norm = norm.replace(/^.*\/repo\//, "");
        return norm.replace(/^\/+/, "");
    };

    const cleanSourceFile = cleanRepoPath(sourceFileToInspect);
    const cleanTargetTest = cleanRepoPath(testFileInfo.relativePath || testFileInfo.fullPath);
    const effectiveSourceCode = sourceCode || (snapshot?.rootDir && sourceFileToInspect ? findSourceOnDisk(snapshot.rootDir, sourceFileToInspect).content : "");
    const computedSourceSha256 = effectiveSourceCode ? createHash('sha256').update(effectiveSourceCode).digest('hex') : undefined;

    const branches = coverageDetails?.branches || coverageDetails?.branchFlow || [];
    const uncoveredBranches = branches.filter(b => b.status !== "fully_covered" || b.totalHits === 0);
    const targetBranchesList = uncoveredBranches.map(b => `${b.type}:${b.line}`);
    const primaryTargetLines = coverageDetails?.uncoveredLines?.slice(0, 5) || [];
    const primaryReason = uncoveredBranches.length > 0
        ? `Branch ${uncoveredBranches[0].type} at line ${uncoveredBranches[0].line} (${uncoveredBranches[0].condition || "branch condition"}) was not executed`
        : (primaryTargetLines.length > 0
            ? `Lines ${primaryTargetLines.join(", ")} not tested in current suite`
            : "Add test cases covering edge cases and logical conditions");

    const resolvedTestCode = aiParsedResult.suggestedTestCode || aiParsedResult.fullUpdatedContent || "";
    const scenarioMatrix = unitTestContext?.decisionTable?.matrixEntries || [];

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
        explanation: aiParsedResult.explanation || `Exhaustive ${framework.toUpperCase()} unit tests for ${cleanSourceFile}`,
        generatedCode: resolvedTestCode,
        suggestedTestCode: resolvedTestCode,
        testCode: resolvedTestCode,
        originalCode: testFileInfo.content || "",
        fullUpdatedContent: aiParsedResult.fullUpdatedContent,
        changeSet: aiParsedResult.changeSet,
        status: "GENERATED",
        isExisting: testFileInfo.found,
        uncoveredLines: coverageDetails?.uncoveredLines || [],
        failedLines: coverageDetails?.failedLines || [],
        uncoverageDiagnostics: coverageDetails?.uncoverageDiagnostics || null,
        summary: coverageDetails?.summary ? {
            linesPct: coverageDetails.summary.linesPct ?? 0,
            branchesPct: coverageDetails.summary.branchesPct ?? 0,
            functionsPct: coverageDetails.summary.functionsPct ?? coverageDetails.summary.funcsPct ?? 0,
            statementsPct: coverageDetails.summary.statementsPct ?? coverageDetails.summary.stmtsPct ?? 0,
            funcsPct: coverageDetails.summary.functionsPct ?? coverageDetails.summary.funcsPct ?? 0,
            stmtsPct: coverageDetails.summary.statementsPct ?? coverageDetails.summary.stmtsPct ?? 0,
            ...coverageDetails.summary
        } : {
            linesPct: 0,
            branchesPct: 0,
            functionsPct: 0,
            statementsPct: 0
        },
        decisionTableSummary: unitTestContext?.decisionTable?.summary,
        scenarioMatrix
    };

    return {
        ...primarySuggestion,
        targetPolicy,
        testCode: resolvedTestCode,
        targetSourceFile: cleanSourceFile,
        targetTestFile: cleanTargetTest,
        scenarioMatrix,
        suggestions: [primarySuggestion]
    };
};
