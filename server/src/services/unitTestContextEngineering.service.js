import path from "path";
import { parseJavaScriptCode } from "./babelParser.service.js";
import { analyzeSourceAst, mapCoverageGaps } from "./businessLogicAstAnalyzer.service.js";

/**
 * GIAI ĐOẠN 2: CONTEXT ENGINEERING & MA TRẬN KIỂM THỬ (DECISION TABLE)
 *
 * Provides formal software engineering test methodology:
 * 2.1. Ma trận kiểm thử (Decision Table / Truth Table Engine - 4 Mandatory Categories)
 * 2.2. Chiến lược Kiểm thử Gián tiếp (Indirect Testing Strategy for Internal Helpers)
 * 2.3. Hợp đồng Mocking Độc lập (Isolation Mock Contracts: DB, HTTP, Queue, Env, Express)
 */

/**
 * 2.1 MA TRẬN KIỂM THỬ (DECISION TABLE / TRUTH TABLE ENGINE)
 *
 * Generates an exhaustive 4-category test matrix targeting >=90% to 100% coverage:
 * - Category A: Happy Path (Standard valid input, expected output)
 * - Category B: Boundary Value Analysis (0, negative, MAX_SAFE_INTEGER, [], "", {}, length extremes)
 * - Category C: Equivalence Partitioning & Branch Toggling (True vs False, null, undefined, ??, ||, ?.)
 * - Category D: Error & Exception Handling (throw, catch, rejected promise, invalid schema)
 *
 * @param {object} params
 * @param {object} params.astMetadata - Metadata from analyzeSourceAst
 * @param {object} params.coverageGaps - Gap report from mapCoverageGaps
 * @param {string} params.sourceCode - Raw source code string
 * @returns {object} { matrixEntries: Array, decisionTableMarkdown: string, summary: object }
 */
export const buildDecisionTableMatrix = ({
    astMetadata = null,
    coverageGaps = null,
    sourceCode = ""
}) => {
    const matrixEntries = [];
    const exportedSymbols = astMetadata?.exportedSymbols || [];
    const internalFunctions = astMetadata?.internalFunctions || [];
    const decisionPoints = astMetadata?.decisionPoints || [];
    const exceptionPoints = astMetadata?.exceptionPoints || [];

    const uncoveredLinesSet = new Set((coverageGaps?.uncoveredLines || []).map(Number));
    const uncoveredBranches = coverageGaps?.uncoveredBranches || [];
    const uncoveredFunctions = coverageGaps?.uncoveredFunctions || [];

    // Helper to identify function containing a specific line number
    const findEnclosingFunction = (line) => {
        // Look in exported symbols first
        const exp = exportedSymbols.find(s => s.line && s.line <= line);
        if (exp) return exp.name;
        const intFn = internalFunctions.find(f => f.line && f.line <= line);
        if (intFn) return intFn.name;
        return exportedSymbols[0]?.name || "mainFunction";
    };

    let counter = 1;

    // --- CATEGORY A: HAPPY PATH (Luồng thành công chuẩn) ---
    for (const exp of exportedSymbols) {
        if (exp.type === "constant") continue;
        const isFnUncovered = uncoveredFunctions.some(uf => uf.name === exp.name);
        matrixEntries.push({
            id: `TC-HAPPY-${String(counter++).padStart(2, "0")}`,
            category: "HAPPY_PATH",
            categoryName: "A. Happy Path",
            targetFunction: exp.name,
            targetLine: exp.line || 1,
            condition: "Standard valid arguments & expected state",
            inputScenario: "Provide valid payload with all standard required and optional fields",
            expectedBehavior: "Executes cleanly, returns expected result or resolves successful promise",
            isCovered: !isFnUncovered,
            priority: isFnUncovered ? "HIGH" : "NORMAL"
        });
    }

    if (matrixEntries.length === 0) {
        matrixEntries.push({
            id: `TC-HAPPY-${String(counter++).padStart(2, "0")}`,
            category: "HAPPY_PATH",
            categoryName: "A. Happy Path",
            targetFunction: exportedSymbols[0]?.name || "defaultExport",
            targetLine: 1,
            condition: "Valid execution flow",
            inputScenario: "Standard valid inputs",
            expectedBehavior: "Expected successful return or side effect",
            isCovered: false,
            priority: "HIGH"
        });
    }

    // --- CATEGORY B: BOUNDARY VALUE ANALYSIS (Phân tích giá trị biên) ---
    for (const exp of exportedSymbols) {
        if (exp.type === "constant") continue;

        // Boundary B1: Zero, negative number, max safe integer
        matrixEntries.push({
            id: `TC-BOUND-${String(counter++).padStart(2, "0")}`,
            category: "BOUNDARY_VALUES",
            categoryName: "B. Boundary Values",
            targetFunction: exp.name,
            targetLine: exp.line || 1,
            condition: "Numerical limits: 0, negative (-1), and max limits",
            inputScenario: "Pass numeric fields with 0, -1, or Number.MAX_SAFE_INTEGER",
            expectedBehavior: "Validates bounds or triggers boundary fallback gracefully",
            isCovered: false,
            priority: "HIGH"
        });

        // Boundary B2: Empty collections and strings
        matrixEntries.push({
            id: `TC-BOUND-${String(counter++).padStart(2, "0")}`,
            category: "BOUNDARY_VALUES",
            categoryName: "B. Boundary Values",
            targetFunction: exp.name,
            targetLine: exp.line || 1,
            condition: "Empty collections & empty string: [], \"\", {}",
            inputScenario: "Pass empty array [], empty string \"\", or empty object {}",
            expectedBehavior: "Handles empty inputs without throwing unhandled TypeError/crash",
            isCovered: false,
            priority: "HIGH"
        });
    }

    // --- CATEGORY C: EQUIVALENCE PARTITIONING & BRANCH TOGGLING (True/False, ??, ||, ?.) ---
    for (const dp of decisionPoints) {
        const isUncovered = uncoveredLinesSet.has(dp.line);
        const matchedBranch = uncoveredBranches.find(ub => Math.abs(ub.line - dp.line) <= 1);
        const targetFn = findEnclosingFunction(dp.line);

        if (dp.type === "if" || dp.type === "ternary") {
            // Branch True
            const missedTrue = matchedBranch?.missedTrue ?? isUncovered;
            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                targetLine: dp.line,
                condition: `[TRUE] ${dp.text}`,
                inputScenario: "Inputs satisfying condition as truthy",
                expectedBehavior: "Executes consequent branch block",
                isCovered: !missedTrue,
                priority: missedTrue ? "HIGH" : "NORMAL"
            });

            // Branch False
            const missedFalse = matchedBranch?.missedFalse ?? isUncovered;
            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                targetLine: dp.line,
                condition: `[FALSE] ${dp.text}`,
                inputScenario: "Inputs evaluating condition to falsy / null / undefined",
                expectedBehavior: "Executes alternate branch or falls through",
                isCovered: !missedFalse,
                priority: missedFalse ? "HIGH" : "NORMAL"
            });
        } else if (dp.type.startsWith("logical") || dp.type.startsWith("optional-chaining")) {
            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                targetLine: dp.line,
                condition: `Nullish / Falsy fallback: ${dp.text}`,
                inputScenario: "Pass null / undefined / false to trigger fallback expression",
                expectedBehavior: "Default fallback value is returned or executed",
                isCovered: !isUncovered,
                priority: isUncovered ? "HIGH" : "NORMAL"
            });
        } else if (dp.type === "switch-case") {
            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                targetLine: dp.line,
                condition: `Switch branch: ${dp.text}`,
                inputScenario: dp.isDefault ? "Pass unmatched case value to hit default" : "Pass specific case value",
                expectedBehavior: "Executes specific case body",
                isCovered: !isUncovered,
                priority: isUncovered ? "HIGH" : "NORMAL"
            });
        } else if (dp.type === "default-arg") {
            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                targetLine: dp.line,
                condition: `Default argument supplied: ${dp.param}`,
                inputScenario: `Pass explicit value for parameter "${dp.param}"`,
                expectedBehavior: "Overrides default parameter value with supplied input",
                isCovered: false,
                priority: "NORMAL"
            });
            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                targetLine: dp.line,
                condition: `Default argument fallback: ${dp.param}`,
                inputScenario: `Omit parameter "${dp.param}" or pass undefined`,
                expectedBehavior: "Uses default fallback value for parameter",
                isCovered: false,
                priority: "HIGH"
            });
        }
    }

    // --- CATEGORY D: ERROR & EXCEPTION HANDLING (throw, catch, reject) ---
    for (const ep of exceptionPoints) {
        const isUncovered = uncoveredLinesSet.has(ep.line);
        const targetFn = findEnclosingFunction(ep.line);

        if (ep.type === "throw") {
            matrixEntries.push({
                id: `TC-ERR-${String(counter++).padStart(2, "0")}`,
                category: "ERROR_HANDLING",
                categoryName: "D. Error & Exception",
                targetFunction: targetFn,
                targetLine: ep.line,
                condition: `Trigger throw statement: ${ep.text}`,
                inputScenario: "Pass missing/invalid parameter or schema violation",
                expectedBehavior: "Function throws expected error (test asserts with expect().rejects or toThrow())",
                isCovered: !isUncovered,
                priority: isUncovered ? "HIGH" : "NORMAL"
            });
        } else if (ep.type === "catch") {
            matrixEntries.push({
                id: `TC-ERR-${String(counter++).padStart(2, "0")}`,
                category: "ERROR_HANDLING",
                categoryName: "D. Error & Exception",
                targetFunction: targetFn,
                targetLine: ep.line,
                condition: `Trigger catch block: ${ep.text}`,
                inputScenario: "Mock downstream dependency (DB/HTTP/fs) to throw or reject",
                expectedBehavior: "Catches error and executes recovery or wraps into service error",
                isCovered: !isUncovered,
                priority: isUncovered ? "HIGH" : "NORMAL"
            });
        } else if (ep.type === "promise-reject") {
            matrixEntries.push({
                id: `TC-ERR-${String(counter++).padStart(2, "0")}`,
                category: "ERROR_HANDLING",
                categoryName: "D. Error & Exception",
                targetFunction: targetFn,
                targetLine: ep.line,
                condition: `Trigger Promise.reject: ${ep.text}`,
                inputScenario: "Pass inputs causing asynchronous failure",
                expectedBehavior: "Promise rejects with expected error",
                isCovered: !isUncovered,
                priority: isUncovered ? "HIGH" : "NORMAL"
            });
        }
    }

    // If no explicit exception points found, add general error handling test
    if (exceptionPoints.length === 0 && exportedSymbols.length > 0) {
        matrixEntries.push({
            id: `TC-ERR-${String(counter++).padStart(2, "0")}`,
            category: "ERROR_HANDLING",
            categoryName: "D. Error & Exception",
            targetFunction: exportedSymbols[0]?.name || "mainFunction",
            targetLine: 1,
            condition: "Invalid argument validation / Null pointer safety",
            inputScenario: "Pass null, undefined, or malformed arguments",
            expectedBehavior: "Fails gracefully or throws informative validation error",
            isCovered: false,
            priority: "HIGH"
        });
    }

    // Generate Markdown representation of Decision Table
    const tableHeader = "| ID | Target Function | Category | Test Condition / Input Scenario | Expected Behavior | Priority | Coverage Status |\n" +
        "| :--- | :--- | :--- | :--- | :--- | :---: | :---: |\n";
    const tableRows = matrixEntries.map(e =>
        `| **${e.id}** | \`${e.targetFunction}\` | ${e.categoryName} | ${e.condition.replace(/\|/g, "\\|")} (${e.inputScenario.replace(/\|/g, "\\|")}) | ${e.expectedBehavior.replace(/\|/g, "\\|")} | **${e.priority}** | ${e.isCovered ? "✅ Covered" : "❌ Missed"} |`
    ).join("\n");

    const decisionTableMarkdown = tableHeader + tableRows;

    const cc = astMetadata?.cyclomaticComplexity || (1 + (decisionPoints || []).length);
    const summary = {
        totalTestCases: matrixEntries.length,
        cyclomaticComplexity: cc,
        minimumBasisPaths: cc,
        happyPathCount: matrixEntries.filter(e => e.category === "HAPPY_PATH").length,
        boundaryCount: matrixEntries.filter(e => e.category === "BOUNDARY_VALUES").length,
        branchTogglingCount: matrixEntries.filter(e => e.category === "BRANCH_TOGGLING").length,
        errorHandlingCount: matrixEntries.filter(e => e.category === "ERROR_HANDLING").length,
        highPriorityMissed: matrixEntries.filter(e => e.priority === "HIGH").length
    };

    return {
        matrixEntries,
        decisionTableMarkdown,
        summary
    };
};

/**
 * 2.2 CHIẾN LƯỢC KIỂM THỬ GIÁN TIẾP (INDIRECT TESTING STRATEGY)
 *
 * For internal, unexported helper functions, direct import triggers fatal TypeError.
 * This analyzer maps internal helpers to their exported callers and generates actionable
 * guidance on how to trigger every branch inside private functions via public calls.
 *
 * @param {object} params
 * @param {object} params.astMetadata - Metadata from analyzeSourceAst
 * @param {string} params.sourceCode - Raw source code string
 * @returns {object} { indirectStrategies: Array, indirectGuidancePrompt: string }
 */
export const buildIndirectTestingStrategy = ({
    astMetadata = null,
    sourceCode = ""
}) => {
    const internalFunctions = astMetadata?.internalFunctions || [];
    const exportedSymbols = astMetadata?.exportedSymbols || [];
    const indirectStrategies = [];

    if (!internalFunctions.length) {
        return {
            indirectStrategies: [],
            indirectGuidancePrompt: "All business functions are publicly exported. Direct invocation in test cases is permitted."
        };
    }

    // Map each function (internal or exported) to which internal helpers it directly calls
    const allFuncs = [...internalFunctions, ...exportedSymbols.filter(s => s.type !== "constant")];
    const funcDirectCallMap = new Map();

    for (const f of allFuncs) {
        const name = f.name;
        const declPattern = new RegExp(`(?:function\\s+${name}|const\\s+${name}\\s*=|let\\s+${name}\\s*=|var\\s+${name}\\s*=)([\\s\\S]*?)(?=(?:function\\s+[a-zA-Z0-9_$]+|const\\s+[a-zA-Z0-9_$]+\\s*=|let\\s+[a-zA-Z0-9_$]+\\s*=|var\\s+[a-zA-Z0-9_$]+\\s*=|module\\.exports|export\\s+default|export\\s+\\{|$))`);
        const match = sourceCode.match(declPattern);
        const body = match ? match[1] : "";
        const calledHelpers = new Set();
        for (const helper of internalFunctions) {
            if (helper.name === name) continue;
            const callRegex = new RegExp(`\\b${helper.name}\\s*\\(`, "m");
            if (callRegex.test(body)) {
                calledHelpers.add(helper.name);
            }
        }
        funcDirectCallMap.set(name, calledHelpers);
    }

    // For each internal helper, backtrack callers through the call graph to find public exported callers
    for (const helper of internalFunctions) {
        const helperName = helper.name;
        const exportedCallerNames = new Set();

        const findExportedCallers = (targetName, visited = new Set()) => {
            if (visited.has(targetName)) return;
            visited.add(targetName);

            for (const exp of exportedSymbols) {
                if (exp.type === "constant") continue;
                const calls = funcDirectCallMap.get(exp.name);
                if (calls && calls.has(targetName)) {
                    exportedCallerNames.add(exp.name);
                }
            }

            // Also check internal functions that call targetName, and recursively backtrack
            for (const inner of internalFunctions) {
                const calls = funcDirectCallMap.get(inner.name);
                if (calls && calls.has(targetName)) {
                    findExportedCallers(inner.name, visited);
                }
            }
        };

        findExportedCallers(helperName);

        const callerNames = exportedCallerNames.size > 0
            ? Array.from(exportedCallerNames)
            : exportedSymbols.filter(s => s.type !== "constant").map(s => s.name);
        const callersStr = callerNames.length > 0 ? callerNames.map(c => `\`${c}\``).join(", ") : "the exported module functions";

        indirectStrategies.push({
            helperName,
            helperLine: helper.line || 1,
            exportedCallers: callerNames,
            warning: "DO NOT IMPORT DIRECTLY - TEST INDIRECTLY VIA EXPORTED CALLER",
            guidance: `Helper function "${helperName}" (line ${helper.line || 1}) is internal/unexported. Attempting to \`import { ${helperName} }\` will cause fatal TypeError. To cover lines and branches within "${helperName}", invoke ${callersStr} with input variations (e.g. valid payload, null/undefined optional flags, edge numbers) that cause ${callersStr} to call "${helperName}".`
        });
    }

    const indirectGuidancePrompt = indirectStrategies.map(s =>
        `⚠️ STRICT INDIRECT TESTING MANDATE FOR INTERNAL HELPER "${s.helperName}":\n` +
        `  - "${s.helperName}" is NOT exported! NEVER write \`import { ${s.helperName} }\` or \`const { ${s.helperName} } = require(...)\`.\n` +
        `  - Call exported function(s): ${(s.exportedCallers || []).join(", ") || "the exported module functions"}.\n` +
        `  - ${s.guidance}`
    ).join("\n\n");

    return {
        indirectStrategies,
        indirectGuidancePrompt
    };
};

/**
 * 2.3 HỢP ĐỒNG MOCKING ĐỘC LẬP (ISOLATION MOCK CONTRACTS)
 *
 * Generates robust, executable mock preambles ensuring tests execute purely in RAM:
 * - Database (Prisma Client, Mongoose, SQL): Proxy mock resolving dummy entities.
 * - HTTP Clients (Axios, Fetch): Universal mock instance handling .create(), .post(), .get().
 * - Queues & Caches (Bull, BullMQ, Redis): Mocking process, add, close.
 * - Environment Variables (process.env): Auto-detecting env keys and initializing safe test defaults.
 * - Express Controllers: Standardized req, res, next mocks with chaining support (.status().json()).
 *
 * @param {object} params
 * @param {string} params.sourceCode - Raw source code
 * @param {string} params.existingTestCode - Existing test code if any
 * @param {string} params.framework - "jest" or "vitest"
 * @returns {object} { detectedDependencies: string[], mockPreambleCode: string, mockInstructions: string }
 */
export const buildIsolationMockContracts = ({
    sourceCode = "",
    existingTestCode = "",
    framework = "jest"
}) => {
    const isVitest = framework === "vitest";
    const detectedDependencies = [];
    const codeToInspect = `${sourceCode}\n${existingTestCode}`;

    // 1. Detect Environment Variables
    const envMatches = [...codeToInspect.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map(m => m[1]);
    const uniqueEnvs = Array.from(new Set(envMatches)).filter(v => !["NODE_ENV", "PATH", "HOME", "USER"].includes(v));
    let envMockCode = "";
    if (uniqueEnvs.length > 0) {
        detectedDependencies.push("environment-variables");
        envMockCode = `// 1. Mock Environment Variables\nprocess.env.NODE_ENV = 'test';\n` +
            uniqueEnvs.map(v => `process.env.${v} = process.env.${v} || 'test-${v.toLowerCase()}';`).join("\n") + "\n\n";
    }

    // 2. Detect Prisma / Database
    const usesPrisma = /prisma|@prisma\/client/i.test(codeToInspect);
    let prismaMockCode = "";
    if (usesPrisma) {
        detectedDependencies.push("prisma-db");
        prismaMockCode = `// 2. Universal Prisma Proxy Mock (Resolves all models, queries, and transactions)\n` +
            `const _createPrismaProxyMock = () => {\n` +
            `  const _mockFn = () => (${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve({ id: 1, name: 'Sample Item', status: 'ACTIVE', title: 'Sample', email: 'test@example.com', createdAt: new Date(), updatedAt: new Date() })));\n` +
            `  const _createModelProxy = () => new Proxy({}, {\n` +
            `    get: (target, prop) => {\n` +
            `      if (prop === 'then') return undefined;\n` +
            `      if (!target[prop]) {\n` +
            `        if (prop === 'findMany' || prop === 'findRaw') {\n` +
            `          target[prop] = ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve([{ id: 1, name: 'Sample', status: 'ACTIVE', title: 'Sample' }]));\n` +
            `        } else if (prop === 'count') {\n` +
            `          target[prop] = ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve(1));\n` +
            `        } else {\n` +
            `          target[prop] = _mockFn();\n` +
            `        }\n` +
            `      }\n` +
            `      return target[prop];\n` +
            `    }\n` +
            `  });\n` +
            `  let _clientProxy;\n` +
            `  _clientProxy = new Proxy({\n` +
            `    $transaction: ${isVitest ? "vi.fn" : "jest.fn"}((args) => Array.isArray(args) ? Promise.all(args) : (typeof args === 'function' ? args(_clientProxy) : Promise.resolve())),\n` +
            `    $queryRaw: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve([])),\n` +
            `    $executeRaw: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve(1)),\n` +
            `    $connect: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve()),\n` +
            `    $disconnect: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve())\n` +
            `  }, {\n` +
            `    get: (target, prop) => (prop in target ? target[prop] : (!target[prop] ? target[prop] = _createModelProxy() : target[prop]))\n` +
            `  });\n` +
            `  return _clientProxy;\n` +
            `};\n` +
            `const mockPrisma = _createPrismaProxyMock();\n` +
            (isVitest
                ? `vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(() => mockPrisma), default: { PrismaClient: vi.fn(() => mockPrisma) } }));\n\n`
                : `jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma), default: { PrismaClient: jest.fn(() => mockPrisma) } }));\n` +
                  `jest.mock('../lib/prisma.js', () => ({ prisma: mockPrisma, default: mockPrisma }), { virtual: true });\n` +
                  `jest.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma, default: mockPrisma }), { virtual: true });\n` +
                  `jest.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma, default: mockPrisma }), { virtual: true });\n` +
                  `jest.mock('../config/prisma.js', () => ({ prisma: mockPrisma, default: mockPrisma }), { virtual: true });\n` +
                  `jest.mock('../../config/prisma.js', () => ({ prisma: mockPrisma, default: mockPrisma }), { virtual: true });\n` +
                  `jest.mock('../src/config/prisma.js', () => ({ prisma: mockPrisma, default: mockPrisma }), { virtual: true });\n\n`);
    }

    // 3. Detect Axios / HTTP Client
    const usesAxios = /axios/i.test(codeToInspect);
    let axiosMockCode = "";
    if (usesAxios) {
        detectedDependencies.push("axios-http");
        axiosMockCode = `// 3. Shared Axios Mock Instance (Handles axios.create, get, post, put, delete)\n` +
            (isVitest
                ? `const _mockAxios = { post: vi.fn(() => Promise.resolve({ data: { success: true, message: 'ok' }, status: 200 })), get: vi.fn(() => Promise.resolve({ data: {}, status: 200 })), put: vi.fn(() => Promise.resolve({ data: {}, status: 200 })), delete: vi.fn(() => Promise.resolve({ data: {}, status: 200 })) };\n` +
                  `const mockAxios = _mockAxios;
vi.mock('axios', () => ({ default: { create: vi.fn(() => _mockAxios), ..._mockAxios } }));\n\n`
                : `const _mockAxios = { post: jest.fn(() => Promise.resolve({ data: { success: true, message: 'ok' }, status: 200 })), get: jest.fn(() => Promise.resolve({ data: {}, status: 200 })), put: jest.fn(() => Promise.resolve({ data: {}, status: 200 })), delete: jest.fn(() => Promise.resolve({ data: {}, status: 200 })) };\n` +
                  `const mockAxios = _mockAxios;
jest.mock('axios', () => ({ create: jest.fn(() => _mockAxios), ..._mockAxios, default: { create: jest.fn(() => _mockAxios), ..._mockAxios } }));\n\n`);
    }

    // 4. Detect Bull / BullMQ / Redis
    const usesBull = /(?:require\(['"]bull(?:mq)?['"]\)|from\s+['"]bull(?:mq)?['"]|\bnew\s+(?:Bull|Queue|Worker)\b)/i.test(codeToInspect);
    let bullMockCode = "";
    if (usesBull) {
        detectedDependencies.push("bull-queue");
        bullMockCode = `// 4. Bull / BullMQ / Redis Queue Mock (Prevents real Redis connections)\n` +
            (isVitest
                ? `const mockCreateBullInstance = () => ({ process: vi.fn(), on: vi.fn(), add: vi.fn(() => Promise.resolve({ id: '1' })), getWaitingCount: vi.fn(() => Promise.resolve(0)), getActiveCount: vi.fn(() => Promise.resolve(0)), getCompletedCount: vi.fn(() => Promise.resolve(0)), getFailedCount: vi.fn(() => Promise.resolve(0)), getDelayedCount: vi.fn(() => Promise.resolve(0)), close: vi.fn(() => Promise.resolve()) });\n` +
                  `vi.mock('bull', () => ({ default: vi.fn().mockImplementation(mockCreateBullInstance) }));\n` +
                  `vi.mock('bullmq', () => ({ Queue: vi.fn().mockImplementation(mockCreateBullInstance), Worker: vi.fn().mockImplementation(() => ({ on: vi.fn(), close: vi.fn(() => Promise.resolve()) })) }));\n\n`
                : `const mockCreateBullInstance = () => ({ process: jest.fn(), on: jest.fn(), add: jest.fn(() => Promise.resolve({ id: '1' })), getWaitingCount: jest.fn(() => Promise.resolve(0)), getActiveCount: jest.fn(() => Promise.resolve(0)), getCompletedCount: jest.fn(() => Promise.resolve(0)), getFailedCount: jest.fn(() => Promise.resolve(0)), getDelayedCount: jest.fn(() => Promise.resolve(0)), close: jest.fn(() => Promise.resolve()) });\n` +
                  `jest.mock('bull', () => Object.assign(jest.fn().mockImplementation(mockCreateBullInstance), { default: jest.fn().mockImplementation(mockCreateBullInstance) }), { virtual: true });\n` +
                  `jest.mock('bullmq', () => ({ Queue: jest.fn().mockImplementation(mockCreateBullInstance), Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn(() => Promise.resolve()) })) }), { virtual: true });\n\n`);
    }

    // 4.5. Detect App Config imports
    const usesConfig = /require\(['"][^'"]*config(?:\/index)?['"]\)|from\s+['"][^'"]*config(?:\/index)?['"]/i.test(codeToInspect);
    let configMockCode = "";
    if (usesConfig) {
        detectedDependencies.push("app-config");
        configMockCode = `// 4.5. App Config Universal Mock\n` +
            `const mockAppConfig = new Proxy({\n` +
            `  aiEngine: { baseUrl: 'http://localhost:5000' },\n` +
            `  ollama: { baseUrl: 'http://localhost:11434', timeoutMs: 10000, maxHistoryMessages: 2, model: 'llama3' },\n` +
            `  groq: { baseUrl: 'https://api.groq.com', timeoutMs: 10000, enabled: false },\n` +
            `  queue: { analysisQueueName: 'test-analysis-queue' },\n` +
            `  redis: { host: 'localhost', port: 6379 },\n` +
            `  upload: { maxFileSizeInBytes: 10485760 }\n` +
            `}, {\n` +
            `  get: (target, prop) => {\n` +
            `    if (prop === 'then' || typeof prop === 'symbol') return undefined;\n` +
            `    if (!(prop in target)) target[prop] = {};\n` +
            `    return target[prop];\n` +
            `  }\n` +
            `});\n` +
            (isVitest
                ? `vi.mock('../../src/config', () => ({ default: mockAppConfig, ...mockAppConfig }));\n` +
                  `vi.mock('../config', () => ({ default: mockAppConfig, ...mockAppConfig }));\n\n`
                : `jest.mock('../../src/config', () => mockAppConfig, { virtual: true });\n` +
                  `jest.mock('../config', () => mockAppConfig, { virtual: true });\n\n`);
    }

    // 5. Detect Express Controller Usage
    const isController = /controller/i.test(sourceCode) || /req\s*,\s*res\s*,\s*next/i.test(sourceCode);
    let controllerMockCode = "";
    if (isController) {
        detectedDependencies.push("express-controller");
        controllerMockCode = `// 5. Express Controller Mock Generator (Provides chained res methods & rich req fields)\n` +
            `const createMockReqResNext = (overrides = {}) => {\n` +
            `  const req = {\n` +
            `    body: { ...overrides.body },\n` +
            `    query: { page: '1', limit: '10', ...overrides.query },\n` +
            `    params: { id: '1', ...overrides.params },\n` +
            `    headers: { authorization: 'Bearer test-token', ...overrides.headers },\n` +
            `    user: { id: 1, role: 'admin', email: 'admin@example.com', ...overrides.user },\n` +
            `    file: overrides.file || null\n` +
            `  };\n` +
            `  const res = {\n` +
            `    json: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    status: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    send: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    setHeader: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}\n` +
            `  };\n` +
            `  const next = ${isVitest ? "vi.fn()" : "jest.fn()"};\n` +
            `  return { req, res, next };\n` +
            `};\n\n`;
    }

    // 6. Detect Timers / Asynchronous Delays
    const usesTimers = /setTimeout|setInterval|setImmediate|sleep\s*\(|delay\s*\(/i.test(codeToInspect);
    let timersMockCode = "";
    if (usesTimers) {
        detectedDependencies.push("timers-async");
        timersMockCode = `// 6. Fake Timers & Async Delay Control (Prevents test timeout & memory leaks)\n` +
            `// Before tests involving timers/delays, call ${isVitest ? "vi.useFakeTimers()" : "jest.useFakeTimers()"};\n` +
            `// And advance timers with ${isVitest ? "vi.runAllTimers()" : "jest.runAllTimers()"} or ${isVitest ? "vi.advanceTimersByTime(1000)" : "jest.advanceTimersByTime(1000)"};\n\n`;
    }

    // 7. Detect Third-Party Libraries (pdfkit, json2csv, multer)
    let thirdPartyMockCode = "";
    if (/pdfkit/i.test(codeToInspect)) {
        detectedDependencies.push("pdfkit");
        thirdPartyMockCode += `// 7. Mock PDFKit\n` +
            (isVitest
                ? `vi.mock('pdfkit', () => ({ default: vi.fn().mockImplementation(() => ({ fontSize: vi.fn().mockReturnThis(), text: vi.fn().mockReturnThis(), moveDown: vi.fn().mockReturnThis(), on: vi.fn().mockReturnThis(), pipe: vi.fn().mockReturnThis(), end: vi.fn().mockReturnThis() })) }));\n\n`
                : `jest.mock('pdfkit', () => jest.fn().mockImplementation(() => ({ fontSize: jest.fn().mockReturnThis(), text: jest.fn().mockReturnThis(), moveDown: jest.fn().mockReturnThis(), on: jest.fn().mockReturnThis(), pipe: jest.fn().mockReturnThis(), end: jest.fn().mockReturnThis() })), { virtual: true });\n\n`);
    }
    if (/json2csv/i.test(codeToInspect)) {
        detectedDependencies.push("json2csv");
        thirdPartyMockCode += `// 7. Mock json2csv\n` +
            (isVitest
                ? `vi.mock('json2csv', () => ({ Parser: vi.fn().mockImplementation(() => ({ parse: vi.fn(() => 'col1,col2\\nval1,val2') })) }));\n\n`
                : `jest.mock('json2csv', () => ({ Parser: jest.fn().mockImplementation(() => ({ parse: jest.fn(() => 'col1,col2\\nval1,val2') })) }), { virtual: true });\n\n`);
    }
    if (/multer/i.test(codeToInspect)) {
        detectedDependencies.push("multer");
        thirdPartyMockCode += `// 7. Mock multer\n` +
            (isVitest
                ? `const mockMulter = Object.assign(vi.fn(() => ({ single: vi.fn(() => (req, res, next) => next && next()), array: vi.fn(() => (req, res, next) => next && next()) })), { memoryStorage: vi.fn(), diskStorage: vi.fn() });\nvi.mock('multer', () => ({ default: mockMulter, ...mockMulter }));\n\n`
                : `const mockMulter = Object.assign(jest.fn(() => ({ single: jest.fn(() => (req, res, next) => next && next()), array: jest.fn(() => (req, res, next) => next && next()) })), { memoryStorage: jest.fn(), diskStorage: jest.fn() });\njest.mock('multer', () => mockMulter, { virtual: true });\n\n`);
    }

    // 8. Detect Downstream Local Services & Models (Pure RAM Isolation)
    const localRequires = [...new Set([...sourceCode.matchAll(/(?:require\s*\(\s*['"](\.[^'"]+)['"]\s*\)|from\s+['"](\.[^'"]+)['"])/g)].map(m => m[1] || m[2]))];
    let localServicesMockCode = "";
    if (localRequires.length > 0) {
        detectedDependencies.push("downstream-local-services");
        localServicesMockCode = `// 8. Universal RAM Mocks for Downstream Local Dependencies\n` +
            `const mockCreateUniversalStub = () => {\n` +
            `  const stubFn = () => (${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve({ id: 1, name: 'Sample Item', title: 'Sample Title', status: 'ACTIVE', score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90, filename: 'sample.pdf', analysis: { score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90 }, toJSON() { return { id: 1, score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90 }; } })));\n` +
            `  const baseTarget = {\n` +
            `    models: mockCreateModelRegistry(),\n` +
            `    AppError: class extends Error { constructor(sc, m, d) { super(m); this.statusCode = sc; this.details = d; } },\n` +
            `    asyncHandler: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),\n` +
            `    errorMiddleware: ${isVitest ? "vi.fn" : "jest.fn"}((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }))\n` +
            `  };\n` +
            `  return new Proxy(baseTarget, {\n` +
            `    get: (target, prop) => {\n` +
            `      if (prop === 'then' || typeof prop === 'symbol') return undefined;\n` +
            `      if (!(prop in target)) {\n` +
            `        if (prop === 'default') {\n` +
            `          target[prop] = target;\n` +
            `        } else if (prop === 'findAndCountAll') {\n` +
            `          target[prop] = ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve({ count: 1, rows: [{ id: 1, title: 'Sample', score: 50, ambiguity: 50, clarity: 50, completeness: 50, consistency: 50, toJSON() { return { id: 1, score: 50, ambiguity: 50, clarity: 50, completeness: 50, consistency: 50 }; } }] }));\n` +
            `        } else {\n` +
            `          target[prop] = stubFn();\n` +
            `        }\n` +
            `      }\n` +
            `      return target[prop];\n` +
            `    }\n` +
            `  });\n` +
            `};\n` +
            `const mockCreateModelRegistry = () => new Proxy({}, { get: (t, p) => (p === 'then' ? undefined : (t[p] || (t[p] = mockCreateUniversalStub()))) });\n`;
        
        for (const reqPath of localRequires) {
            if (isVitest) {
                localServicesMockCode += `vi.mock('${reqPath}', () => mockCreateUniversalStub());\n`;
            } else {
                localServicesMockCode += `jest.mock('${reqPath}', () => mockCreateUniversalStub(), { virtual: true });\n`;
            }
        }
        localServicesMockCode += "\n";
    }

    const mockPreambleCode = `${envMockCode}${prismaMockCode}${axiosMockCode}${bullMockCode}${configMockCode}${thirdPartyMockCode}${localServicesMockCode}${controllerMockCode}${timersMockCode}`.trim();

    const mockInstructions = [
        "MANDATORY ISOLATION MOCK CONTRACTS:",
        "- All unit tests MUST execute purely in RAM without network, real database, or external processes.",
        detectedDependencies.includes("prisma-db") ? "- Prisma DB: Re-use the Prisma Proxy Mock. Never connect to a real database." : null,
        detectedDependencies.includes("axios-http") ? "- Axios HTTP: Always mock network calls. To test error branches, use `_mockAxios.post.mockRejectedValueOnce(new Error('Network Error'))`." : null,
        detectedDependencies.includes("bull-queue") ? "- Bull Queue: Mock queue.add and queue.process to prevent Redis connection timeouts." : null,
        detectedDependencies.includes("environment-variables") ? "- Environment Variables: Required keys are pre-initialized in process.env." : null,
        detectedDependencies.includes("express-controller") ? "- Express Controllers: ALWAYS pass (req, res, next) with createMockReqResNext() and assert `res.status` / `res.json` / `next`." : null,
        detectedDependencies.includes("timers-async") ? `- Asynchronous & Timers: Wrap asynchronous logic in async/await. For timers/delays, use ${isVitest ? 'vi.useFakeTimers()' : 'jest.useFakeTimers()'} and advance timers immediately.` : null,
        detectedDependencies.includes("downstream-local-services") ? "- Downstream Services & Models: All local services and models are stubbed in RAM. Never import unmocked downstream files that connect to databases." : null
    ].filter(Boolean).join("\n");

    return {
        detectedDependencies,
        mockPreambleCode,
        mockInstructions
    };
};

/**
 * CONTEXT ASSEMBLER (GIAI ĐOẠN 2 ORCHESTRATION)
 *
 * Integrates AST Analysis (Phase 1) and Context Engineering (Phase 2)
 * into a single unified context payload for LLM Prompt Builder or Test Generator.
 */
export const assembleUnitTestContext = ({
    sourceCode = "",
    coverageDetails = null,
    framework = "jest",
    existingTestCode = ""
}) => {
    // 1. Phase 1: AST Analysis & Coverage Gap Mapping
    const astMetadata = analyzeSourceAst(sourceCode);
    const coverageGaps = mapCoverageGaps({
        astMetadata,
        fileCoverageData: coverageDetails?.rawCoverageData || coverageDetails,
        sourceCode,
        uncoveredLinesList: coverageDetails?.uncoveredLines || []
    });

    // 2. Phase 2: Decision Table Matrix
    const decisionTable = buildDecisionTableMatrix({
        astMetadata,
        coverageGaps,
        sourceCode
    });

    // 3. Phase 2: Indirect Testing Strategy
    const indirectTesting = buildIndirectTestingStrategy({
        astMetadata,
        sourceCode
    });

    // 4. Phase 2: Isolation Mock Contracts
    const mockContracts = buildIsolationMockContracts({
        sourceCode,
        existingTestCode,
        framework
    });

    // 5. Build Engineered Context Prompt Block
    const engineeredPromptContext = [
        `### SECTION 1: PUBLIC APIS & INDIRECT TESTING DIRECTIVE`,
        `Exported Public Symbols: ${(astMetadata?.exportedSymbolNames || []).filter(Boolean).join(", ") || "All exported members"}`,
        indirectTesting.indirectGuidancePrompt,
        "",
        `### SECTION 2: ISOLATION MOCK CONTRACTS`,
        mockContracts.mockInstructions,
        "",
        `### SECTION 3: MANDATORY DECISION TABLE TEST MATRIX (TARGETING >=90% TO 100% COVERAGE)`,
        `Total Test Scenarios Required: ${decisionTable.summary.totalTestCases} (Happy Path: ${decisionTable.summary.happyPathCount}, Boundary: ${decisionTable.summary.boundaryCount}, Branch: ${decisionTable.summary.branchTogglingCount}, Error: ${decisionTable.summary.errorHandlingCount})`,
        `High Priority Uncovered Scenarios: ${decisionTable.summary.highPriorityMissed}`,
        "",
        decisionTable.decisionTableMarkdown,
        "",
        `### SECTION 4: COVERAGE GAPS & TARGETED DECISION GUIDANCE`,
        coverageGaps.guidanceSummary
    ].join("\n");

    return {
        astMetadata,
        coverageGaps,
        decisionTable,
        indirectTesting,
        mockContracts,
        engineeredPromptContext
    };
};
