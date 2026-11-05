/**
 * unitTestSimulationEngine.service.js
 *
 * Core Backend Simulation Engine & AST Analysis for CovAI-
 *
 * Features:
 * 1. Hybrid Simulation Engine Core: Static AST parsing, symbolic RAM execution,
 *    and branch decision toggling aligned with Istanbul coverage data.
 * 2. 7-Step Educational Taxonomy Engine: Enriches simulation steps with pedagogical
 *    guidance across Setup Mocks, Call Entry, Parameters, Branch Decisions,
 *    Mock Interactions, Return/State Transitions, and Assertion Checks.
 * 3. Virtual Scenario Synthesis: Synthesizes virtual test cases from the 4-Category
 *    Decision Table Matrix for untested source files (0% coverage, 0 test files on disk).
 * 4. Universal RAM Mock State Tracking: Simulates Prisma ORM, Axios, Redis, Bull Queue,
 *    and environment variables hermetically in memory without network/DB I/O.
 * 5. Storage Immutability Guard: Strictly zero disk writes to storage/ or uploads/.
 * 6. Indirect Testing for Internal Helpers (Rule 3): Uses Call Graph Backtracking
 *    to trigger unexported helper logic via public caller entry points.
 */

import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { parseJavaScriptCode } from "./babelParser.service.js";
import {
    analyzeSourceAst,
    classifyBusinessLogicFiles
} from "./businessLogicAstAnalyzer.service.js";
import {
    parseExistingTestAst,
    buildDecisionTableMatrix,
    buildIndirectTestingStrategy
} from "./unitTestContextEngineering.service.js";
import {
    findTestsImportingSource,
    discoverAllTestFiles
} from "./testDependencyResolver.service.js";
import {
    cleanRelativePath,
    normalizePath,
    findAllAssociatedTestFiles
} from "./fileCoverage.service.js";

/**
 * Normalizes root directory paths for host vs. Docker container environments.
 */
export const resolveRootDir = (r) => {
    if (!r) return null;
    if (fs.existsSync(r)) return r;
    if (r.startsWith("/app/")) {
        const hostCandidate = path.resolve(process.cwd(), r.replace(/^\/app\//, ""));
        if (fs.existsSync(hostCandidate)) return hostCandidate;
    }
    return r;
};

/**
 * Categorizes a file path into business logic archetypes.
 */
export const categorizeFilePath = (filePath = "") => {
    const lower = filePath.toLowerCase();
    if (/(^|\/)services?(\/|\.)/i.test(lower)) return "services";
    if (/(^|\/)handlers?(\/|\.)/i.test(lower)) return "handlers";
    if (/(^|\/)controllers?(\/|\.)/i.test(lower)) return "controllers";
    if (/(^|\/)(utils?|helpers?|lib)(\/|\.)/i.test(lower)) return "utils";
    if (/(^|\/)models?(\/|\.)/i.test(lower)) return "models";
    if (/(^|\/)middlewares?(\/|\.)/i.test(lower)) return "middlewares";
    return "core";
};

/**
 * 4-Category Display Name Mapping
 */
export const CATEGORY_NAMES = {
    HAPPY_PATH: "A. Happy Path",
    BOUNDARY_VALUES: "B. Boundary Values",
    BRANCH_TOGGLING: "C. Branch Toggling",
    ERROR_HANDLING: "D. Error & Exception Handling"
};

/**
 * Resolves root directory and snapshot metadata hermetically.
 */
export const resolveSnapshotRoot = async (snapshotId, options = {}) => {
    if (options.rootDir && fs.existsSync(options.rootDir)) {
        return { rootDir: options.rootDir, snapshot: options.snapshot || null };
    }

    if (!snapshotId) {
        throw new ServiceError("snapshotId or rootDir is required", 400);
    }

    let snapshot = null;
    try {
        snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            include: { project: true }
        });
    } catch (_) {
        // Fallback for mock snapshot testing
    }

    if (!snapshot && !options.rootDir) {
        throw new ServiceError("Snapshot not found", 404);
    }

    const rawRoot = options.rootDir || snapshot?.rootDir;
    const resolved = resolveRootDir(rawRoot);
    return { rootDir: resolved || rawRoot, snapshot };
};

/**
 * 1. DISCOVERY LAYER
 *
 * Scans a project repository for all business logic files, associated tests,
 * exported and internal functions, and synthesized virtual decision table scenarios.
 *
 * @param {string} snapshotId
 * @param {object} options
 * @returns {Promise<{ snapshotId: string, totalFiles: number, sourceFiles: Array, files: Array }>}
 */
export const getAvailableSimulationSources = async (snapshotId, options = {}) => {
    const { rootDir } = await resolveSnapshotRoot(snapshotId, options);

    if (!rootDir || !fs.existsSync(rootDir)) {
        return {
            snapshotId: snapshotId || "unknown",
            totalFiles: 0,
            sourceFiles: [],
            files: []
        };
    }

    let targetFilePaths = [];
    if (options.filePath) {
        const cleaned = cleanRelativePath(rootDir, options.filePath);
        targetFilePaths = [cleaned];
    } else {
        const classified = classifyBusinessLogicFiles(rootDir);
        targetFilePaths = classified.all || [];
    }

    const sourceFiles = [];

    for (const relPath of targetFilePaths) {
        const fullSourcePath = path.join(rootDir, relPath);
        if (!fs.existsSync(fullSourcePath)) continue;

        let sourceCode = "";
        try {
            sourceCode = fs.readFileSync(fullSourcePath, "utf8");
        } catch {
            continue;
        }

        const astMetadata = analyzeSourceAst(sourceCode);
        const fileName = path.basename(relPath);

        // 1. Extract callable functions (exported, class methods, internal helpers)
        const functions = [];
        for (const exp of astMetadata.exportedSymbols || []) {
            if (exp.type === "constant" || exp.type === "interface" || exp.type === "type") continue;
            if (sourceCode && new RegExp(`export\\s+(?:interface|type)\\s+${exp.name}\\b`).test(sourceCode)) continue;
            functions.push({
                name: exp.name,
                type: exp.type || "function",
                startLine: exp.startLine || exp.loc?.start?.line || 1,
                endLine: exp.endLine || exp.loc?.end?.line || 1,
                params: exp.params || [],
                complexity: exp.complexity || 1,
                isInternal: false
            });
        }

        for (const cls of astMetadata.classes || []) {
            for (const method of cls.methods || []) {
                functions.push({
                    name: `${cls.name}.${method.name}`,
                    className: cls.name,
                    methodName: method.name,
                    type: "method",
                    startLine: method.startLine || method.loc?.start?.line || 1,
                    endLine: method.endLine || method.loc?.end?.line || 1,
                    params: method.params || [],
                    complexity: 1,
                    isInternal: false
                });
            }
        }

        for (const internal of astMetadata.internalFunctions || []) {
            functions.push({
                name: internal.name,
                type: "internal_function",
                startLine: internal.startLine || internal.loc?.start?.line || 1,
                endLine: internal.endLine || internal.loc?.end?.line || 1,
                params: internal.params || [],
                complexity: 1,
                isInternal: true,
                callers: internal.callers || []
            });
        }

        // 2. Discover associated test files
        const linkedTestMap = new Map();
        try {
            const importedMatches = findTestsImportingSource(rootDir, relPath) || [];
            for (const match of importedMatches) {
                linkedTestMap.set(match.filePath, match);
            }
        } catch {}

        try {
            const assoc = findAllAssociatedTestFiles(rootDir, relPath);
            for (const testItem of assoc.linkedTestFiles || []) {
                if (!linkedTestMap.has(testItem.filePath)) {
                    linkedTestMap.set(testItem.filePath, testItem);
                }
            }
        } catch {}

        const availableTests = [];
        let totalTestCount = 0;

        for (const [testRelPath, testMeta] of linkedTestMap.entries()) {
            let testContent = testMeta.testCode || "";
            if (!testContent) {
                const fullTestPath = path.join(rootDir, testRelPath);
                if (fs.existsSync(fullTestPath)) {
                    try {
                        testContent = fs.readFileSync(fullTestPath, "utf8");
                    } catch {}
                }
            }

            const parsedTest = parseExistingTestAst(testContent, testRelPath);
            totalTestCount += (parsedTest.tests || []).filter(t => !t.isSkipped).length;

            availableTests.push({
                testFilePath: testRelPath,
                fileName: path.basename(testRelPath),
                framework: testMeta.framework || "jest",
                relationType: testMeta.relationType || "DIRECT_IMPORT",
                suites: parsedTest.suites || [],
                testCases: (parsedTest.tests || []).map((t, idx) => ({
                    id: `tc_${idx + 1}`,
                    title: t.title,
                    fullTitle: t.fullTitle,
                    category: t.category,
                    categoryName: CATEGORY_NAMES[t.category] || t.category,
                    targetFunction: t.targetFunction || functions[0]?.name || "main",
                    line: t.line,
                    isSkipped: Boolean(t.isSkipped)
                }))
            });
        }

        // 3. Synthesize Virtual Decision Table Scenarios
        let virtualScenarios = [];
        try {
            const dtResult = buildDecisionTableMatrix({
                astMetadata,
                sourceCode,
                filePath: relPath
            });

            virtualScenarios = (dtResult.matrixEntries || []).map(entry => ({
                id: entry.id,
                title: `${entry.targetFunction} - ${entry.categoryName}: ${entry.condition}`,
                category: entry.category,
                categoryName: entry.categoryName,
                targetFunction: entry.targetFunction,
                condition: entry.condition,
                inputScenario: entry.inputScenario,
                expectedBehavior: entry.expectedBehavior,
                priority: entry.priority,
                isVirtual: true
            }));
        } catch {}

        const fileRecord = {
            filePath: relPath,
            fileName,
            isBusinessLogic: true,
            category: categorizeFilePath(relPath),
            testFiles: Array.from(linkedTestMap.keys()),
            functions,
            testCount: totalTestCount,
            virtualScenariosCount: virtualScenarios.length,
            availableTests,
            virtualScenarios
        };

        sourceFiles.push(fileRecord);
    }

    return {
        snapshotId: snapshotId || "unknown",
        totalFiles: sourceFiles.length,
        sourceFiles,
        files: sourceFiles
    };
};

/**
 * 2. SYMBOLIC RAM EXECUTION ENGINE
 *
 * Safe in-memory expression evaluator for AST nodes.
 */
export const evaluateAstExpression = (node, scope = {}, options = {}) => {
    if (!node) return undefined;

    switch (node.type) {
        case "NumericLiteral":
        case "StringLiteral":
        case "BooleanLiteral":
            return node.value;

        case "NullLiteral":
            return null;

        case "Identifier":
            if (node.name === "undefined") return undefined;
            if (node.name === "NaN") return NaN;
            if (node.name === "Infinity") return Infinity;
            if (Object.prototype.hasOwnProperty.call(scope, node.name)) {
                return scope[node.name];
            }
            if (node.name === "Array") return Array;
            if (node.name === "Object") return Object;
            if (node.name === "String") return String;
            if (node.name === "Number") return Number;
            if (node.name === "Boolean") return Boolean;
            if (node.name === "Math") return Math;
            if (node.name === "JSON") return JSON;
            if (node.name === "Date") return Date;
            if (node.name === "RegExp") return RegExp;
            if (node.name === "Error") return Error;
            if (node.name === "TypeError") return TypeError;
            if (node.name === "RangeError") return RangeError;
            if (node.name === "Promise") return Promise;
            if (node.name === "parseInt") return parseInt;
            if (node.name === "parseFloat") return parseFloat;
            if (node.name === "isNaN") return isNaN;
            if (node.name === "isFinite") return isFinite;
            if (node.name === "console") return console;
            return undefined;

        case "ParenthesizedExpression":
            return evaluateAstExpression(node.expression, scope, options);

        case "UnaryExpression": {
            const argVal = evaluateAstExpression(node.argument, scope, options);
            if (node.operator === "!") return !argVal;
            if (node.operator === "-") return -argVal;
            if (node.operator === "+") return +argVal;
            if (node.operator === "typeof") return typeof argVal;
            return undefined;
        }

        case "BinaryExpression": {
            const left = evaluateAstExpression(node.left, scope, options);
            const right = evaluateAstExpression(node.right, scope, options);
            let res;
            switch (node.operator) {
                case "===": return left === right;
                case "!==": return left !== right;
                case "==": return left == right;
                case "!=": return left != right;
                case "<": return left < right;
                case "<=": return left <= right;
                case ">": return left > right;
                case ">=": return left >= right;
                case "+": res = left + right; break;
                case "-": res = left - right; break;
                case "*": res = left * right; break;
                case "/": res = right !== 0 ? left / right : (left > 0 ? Infinity : (left < 0 ? -Infinity : NaN)); break;
                case "%": res = left % right; break;
                default: return undefined;
            }
            if (typeof res === "number" && Number.isFinite(res)) {
                if (Math.abs(res - Math.round(res)) < 1e-10) {
                    return Math.round(res);
                }
                return Math.round(res * 1e12) / 1e12;
            }
            return res;
        }

        case "LogicalExpression": {
            const leftVal = evaluateAstExpression(node.left, scope, options);

            if (node.operator === "&&") {
                if (!leftVal) {
                    options.shortCircuited = true;
                    options.shortCircuitOperand = "right";
                    return leftVal;
                }
                return evaluateAstExpression(node.right, scope, options);
            }

            if (node.operator === "||") {
                if (leftVal) {
                    options.shortCircuited = true;
                    options.shortCircuitOperand = "right";
                    return leftVal;
                }
                return evaluateAstExpression(node.right, scope, options);
            }

            if (node.operator === "??") {
                if (leftVal !== null && leftVal !== undefined) {
                    options.shortCircuited = true;
                    options.shortCircuitOperand = "right";
                    return leftVal;
                }
                return evaluateAstExpression(node.right, scope, options);
            }
            return undefined;
        }

        case "ConditionalExpression": {
            const testVal = evaluateAstExpression(node.test, scope, options);
            return testVal
                ? evaluateAstExpression(node.consequent, scope, options)
                : evaluateAstExpression(node.alternate, scope, options);
        }

        case "MemberExpression":
        case "OptionalMemberExpression": {
            const objVal = evaluateAstExpression(node.object, scope, options);
            if (node.optional && (objVal === null || objVal === undefined)) {
                return undefined;
            }
            if (objVal === null || objVal === undefined) {
                return undefined;
            }
            const propName = node.computed
                ? evaluateAstExpression(node.property, scope, options)
                : node.property?.name;
            return objVal[propName];
        }

        case "ArrayExpression":
            return (node.elements || []).map(el => evaluateAstExpression(el, scope, options));

        case "ObjectExpression": {
            const result = {};
            for (const prop of node.properties || []) {
                if (prop.type === "ObjectProperty" || prop.type === "Property") {
                    const key = prop.key?.name || prop.key?.value || "prop";
                    result[key] = evaluateAstExpression(prop.value, scope, options);
                }
            }
            return result;
        }

        case "TemplateLiteral": {
            let res = "";
            const quasis = node.quasis || [];
            const exprs = node.expressions || [];
            for (let i = 0; i < quasis.length; i++) {
                res += quasis[i].value?.raw || "";
                if (i < exprs.length) {
                    res += String(evaluateAstExpression(exprs[i], scope, options));
                }
            }
            return res;
        }

        case "NewExpression": {
            const calleeName = node.callee?.name;
            const args = (node.arguments || []).map(a => evaluateAstExpression(a, scope, options));
            if (calleeName === "Error" || calleeName === "TypeError" || calleeName === "RangeError" || calleeName === "ServiceError") {
                return new Error(args[0] || "Error");
            }
            return { name: calleeName, args };
        }

        case "OptionalCallExpression":
        case "CallExpression": {
            if (node.callee?.type === "MemberExpression" || node.callee?.type === "OptionalMemberExpression") {
                const obj = evaluateAstExpression(node.callee.object, scope, options);
                if (obj === null || obj === undefined) {
                    return undefined;
                }
                const propName = node.callee.computed
                    ? evaluateAstExpression(node.callee.property, scope, options)
                    : (node.callee.property?.name || node.callee.property?.value);
                const method = obj[propName];
                if (typeof method === "function") {
                    try {
                        const args = (node.arguments || []).map(a => {
                            if (a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression") {
                                return (...callArgs) => {
                                    const innerScope = { ...scope };
                                    (a.params || []).forEach((p, idx) => {
                                        if (p.type === "Identifier") {
                                            innerScope[p.name] = callArgs[idx];
                                        } else if (p.type === "ObjectPattern") {
                                            const argVal = callArgs[idx] || {};
                                            for (const prop of p.properties || []) {
                                                if (prop.type === "ObjectProperty" || prop.type === "Property") {
                                                    const keyName = prop.key?.name || prop.key?.value;
                                                    const varName = prop.value?.type === "Identifier" ? prop.value.name : keyName;
                                                    if (varName) {
                                                        innerScope[varName] = argVal[keyName];
                                                    }
                                                }
                                            }
                                        } else if (p.type === "AssignmentPattern" && p.left?.type === "Identifier") {
                                            innerScope[p.left.name] = callArgs[idx] !== undefined ? callArgs[idx] : evaluateAstExpression(p.right, innerScope, options);
                                        }
                                    });
                                    if (a.body?.type === "BlockStatement") {
                                        for (const s of a.body.body || []) {
                                            if (s.type === "VariableDeclaration") {
                                                for (const decl of s.declarations || []) {
                                                    if (decl.id?.type === "Identifier") {
                                                        innerScope[decl.id.name] = evaluateAstExpression(decl.init, innerScope, options);
                                                    } else if (decl.id?.type === "ObjectPattern") {
                                                        const rVal = evaluateAstExpression(decl.init, innerScope, options) || {};
                                                        for (const prop of decl.id.properties || []) {
                                                            if (prop.type === "ObjectProperty" || prop.type === "Property") {
                                                                const kName = prop.key?.name || prop.key?.value;
                                                                const vName = prop.value?.type === "Identifier" ? prop.value.name : kName;
                                                                if (vName) innerScope[vName] = rVal[kName];
                                                            }
                                                        }
                                                    }
                                                }
                                            } else if (s.type === "ExpressionStatement") {
                                                evaluateAstExpression(s.expression, innerScope, options);
                                            } else if (s.type === "ReturnStatement") {
                                                return evaluateAstExpression(s.argument, innerScope, options);
                                            }
                                        }
                                        return undefined;
                                    }
                                    return evaluateAstExpression(a.body, innerScope, options);
                                };
                            }
                            return evaluateAstExpression(a, scope, options);
                        });
                        const res = method.apply(obj, args);
                        if (res && typeof res.catch === "function") {
                            res.catch(() => {});
                            if (propName === "reject" || obj === Promise) {
                                try {
                                    res._rejectionReason = args[0] || new Error("Rejected");
                                } catch (_) {}
                            }
                        }
                        return res;
                    } catch (_) {}
                }
                return undefined;
            }
            if (node.callee?.type === "Identifier" && typeof scope[node.callee.name] === "function") {
                try {
                    const args = (node.arguments || []).map(a => evaluateAstExpression(a, scope, options));
                    const res = scope[node.callee.name](...args);
                    if (res && typeof res.catch === "function") {
                        res.catch(() => {});
                    }
                    return res;
                } catch (_) {}
                return undefined;
            }
            try {
                const fn = evaluateAstExpression(node.callee, scope, options);
                if (typeof fn === "function") {
                    const args = (node.arguments || []).map(a => evaluateAstExpression(a, scope, options));
                    const res = fn(...args);
                    if (res && typeof res.catch === "function") {
                        res.catch(() => {});
                    }
                    return res;
                }
            } catch (_) {}
            return undefined;
        }

        case "UpdateExpression": {
            if (node.argument?.type === "Identifier") {
                const varName = node.argument.name;
                const oldVal = Number(scope[varName]) || 0;
                const newVal = node.operator === "++" ? oldVal + 1 : oldVal - 1;
                scope[varName] = newVal;
                return node.prefix ? newVal : oldVal;
            }
            return undefined;
        }

        case "AssignmentExpression": {
            const rightVal = evaluateAstExpression(node.right, scope, options);
            if (node.left?.type === "Identifier") {
                const varName = node.left.name;
                switch (node.operator) {
                    case "=": scope[varName] = rightVal; break;
                    case "+=": scope[varName] = (scope[varName] ?? 0) + rightVal; break;
                    case "-=": scope[varName] = (scope[varName] ?? 0) - rightVal; break;
                    case "*=": scope[varName] = (scope[varName] ?? 0) * rightVal; break;
                    case "/=": scope[varName] = (scope[varName] ?? 0) / rightVal; break;
                    case "%=": scope[varName] = (scope[varName] ?? 0) % rightVal; break;
                    case "??=": if (scope[varName] === null || scope[varName] === undefined) scope[varName] = rightVal; break;
                    case "||=": if (!scope[varName]) scope[varName] = rightVal; break;
                    case "&&=": if (scope[varName]) scope[varName] = rightVal; break;
                    default: scope[varName] = rightVal; break;
                }
                return scope[varName];
            } else if (node.left?.type === "MemberExpression" || node.left?.type === "OptionalMemberExpression") {
                const objVal = evaluateAstExpression(node.left.object, scope, options);
                if (objVal && typeof objVal === "object") {
                    const prop = node.left.computed
                        ? evaluateAstExpression(node.left.property, scope, options)
                        : (node.left.property?.name || node.left.property?.value);
                    switch (node.operator) {
                        case "=": objVal[prop] = rightVal; break;
                        case "+=": objVal[prop] = (objVal[prop] ?? 0) + rightVal; break;
                        case "-=": objVal[prop] = (objVal[prop] ?? 0) - rightVal; break;
                        case "*=": objVal[prop] = (objVal[prop] ?? 0) * rightVal; break;
                        case "/=": objVal[prop] = (objVal[prop] ?? 0) / rightVal; break;
                        case "%=": objVal[prop] = (objVal[prop] ?? 0) % rightVal; break;
                        case "??=": if (objVal[prop] === null || objVal[prop] === undefined) objVal[prop] = rightVal; break;
                        case "||=": if (!objVal[prop]) objVal[prop] = rightVal; break;
                        case "&&=": if (objVal[prop]) objVal[prop] = rightVal; break;
                        default: objVal[prop] = rightVal; break;
                    }
                    return objVal[prop];
                }
            }
            return rightVal;
        }

        default:
            return undefined;
    }
};

/**
 * Locates the target function AST node inside a parsed AST.
 */
export const findFunctionAstNode = (ast, fnName) => {
    if (!ast) return null;
    let result = null;

    const walk = (node) => {
        if (!node || typeof node !== "object" || result) return;

        if (node.type === "FunctionDeclaration") {
            if (!fnName || fnName === "default" || fnName === "main" || node.id?.name === fnName) {
                result = node;
                return;
            }
        }
        if (node.type === "VariableDeclarator" && (node.init?.type === "FunctionExpression" || node.init?.type === "ArrowFunctionExpression")) {
            if (!fnName || fnName === "default" || fnName === "main" || node.id?.name === fnName) {
                result = node.init;
                return;
            }
        }
        if (node.type === "ExportDefaultDeclaration") {
            if (node.declaration?.type === "FunctionDeclaration" || node.declaration?.type === "ArrowFunctionExpression" || node.declaration?.type === "FunctionExpression") {
                if (!fnName || fnName === "default" || fnName === "main" || !node.declaration.id || node.declaration.id?.name === fnName) {
                    result = node.declaration;
                    return;
                }
            }
        }
        if (node.type === "ExportNamedDeclaration" && node.declaration) {
            walk(node.declaration);
            if (result) return;
        }
        if (node.type === "ClassMethod" && node.key?.name === fnName) {
            result = node;
            return;
        }

        for (const k of Object.keys(node)) {
            if (k === "loc" || k === "comments") continue;
            const child = node[k];
            if (Array.isArray(child)) {
                for (const c of child) {
                    walk(c);
                    if (result) return;
                }
            } else if (child && typeof child === "object") {
                walk(child);
                if (result) return;
            }
        }
    };
    walk(ast);

    if (!result) {
        const fallbackWalk = (node) => {
            if (!node || typeof node !== "object" || result) return;
            if (node.type === "FunctionDeclaration" || node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
                result = node;
                return;
            }
            for (const k of Object.keys(node)) {
                if (k === "loc" || k === "comments") continue;
                const child = node[k];
                if (Array.isArray(child)) {
                    for (const c of child) {
                        fallbackWalk(c);
                        if (result) return;
                    }
                } else if (child && typeof child === "object") {
                    fallbackWalk(child);
                    if (result) return;
                }
            }
        };
        fallbackWalk(ast);
    }

    return result;
};

/**
 * Extracts all functions declared in the AST into a Map of name -> AST node.
 */
export const extractAllFunctionsFromAst = (ast) => {
    const fnMap = new Map();
    if (!ast) return fnMap;

    const walk = (node) => {
        if (!node || typeof node !== "object") return;

        if (node.type === "FunctionDeclaration" && node.id?.name) {
            fnMap.set(node.id.name, node);
        } else if (node.type === "VariableDeclarator" && (node.init?.type === "FunctionExpression" || node.init?.type === "ArrowFunctionExpression") && node.id?.name) {
            fnMap.set(node.id.name, node.init);
        } else if (node.type === "ExportDefaultDeclaration") {
            if (node.declaration?.id?.name) {
                fnMap.set(node.declaration.id.name, node.declaration);
            }
            if (node.declaration?.type === "FunctionDeclaration" || node.declaration?.type === "ArrowFunctionExpression" || node.declaration?.type === "FunctionExpression") {
                fnMap.set("default", node.declaration);
            }
        } else if (node.type === "ExportNamedDeclaration" && node.declaration) {
            walk(node.declaration);
        } else if (node.type === "ClassMethod" && node.key?.name) {
            fnMap.set(node.key.name, node);
        }

        for (const k of Object.keys(node)) {
            if (k === "loc" || k === "comments") continue;
            const child = node[k];
            if (Array.isArray(child)) {
                for (const c of child) walk(c);
            } else if (child && typeof child === "object") {
                walk(child);
            }
        }
    };

    walk(ast);
    return fnMap;
};

/**
 * Extracts formal parameter names from a function AST node.
 */
export const extractFunctionParamNames = (fnNode) => {
    if (!fnNode || !Array.isArray(fnNode.params)) return [];
    return fnNode.params.map(p => {
        if (!p) return "";
        if (p.type === "Identifier") return p.name;
        if (p.type === "AssignmentPattern") {
            return p.left?.name || (p.left?.type === "Identifier" ? p.left.name : "param");
        }
        if (p.type === "RestElement") return p.argument?.name || "rest";
        if (p.type === "ObjectPattern") return "options";
        return "";
    }).filter(Boolean);
};

/**
 * Extracts test call arguments and expect assertion details from test code AST.
 */
export const extractTestExecutionData = (testCode, targetFnName, selectedTestCase = null) => {
    if (!testCode || !testCode.trim()) return { callArgs: null, assertion: null, testScope: {} };
    const parseRes = parseJavaScriptCode(testCode);
    if (!parseRes.success || !parseRes.ast) return { callArgs: null, assertion: null, testScope: {} };

    const testLines = testCode.split(/\r?\n/);
    let callArgs = null;
    let assertion = null;
    const testScope = {};
    let targetResultVarName = null;

    const isTestCall = (node) => {
        if (!node || node.type !== "CallExpression") return false;
        if (node.callee?.type === "Identifier" && ["it", "test", "xit", "xtest"].includes(node.callee.name)) return true;
        if (node.callee?.type === "MemberExpression") {
            const obj = node.callee.object?.name;
            const prop = node.callee.property?.name;
            if (["it", "test"].includes(obj) && ["only", "skip", "concurrent"].includes(prop)) return true;
        }
        return false;
    };

    const getTestTitle = (node) => {
        const arg = node.arguments?.[0];
        if (arg?.type === "StringLiteral") return arg.value;
        if (arg?.type === "TemplateLiteral") return (arg.quasis || []).map(q => q.value?.raw || "").join("");
        return "";
    };

    const testNodes = [];
    const collectTestNodes = (node) => {
        if (!node || typeof node !== "object") return;
        if (isTestCall(node)) {
            testNodes.push(node);
            return;
        }
        for (const k of Object.keys(node)) {
            if (k === "loc" || k === "comments") continue;
            const child = node[k];
            if (Array.isArray(child)) child.forEach(collectTestNodes);
            else if (child && typeof child === "object") collectTestNodes(child);
        }
    };
    collectTestNodes(parseRes.ast);

    let targetTestNode = null;
    if (selectedTestCase && testNodes.length > 0) {
        targetTestNode = testNodes.find(node => {
            const line = node.loc?.start?.line;
            if (selectedTestCase.line && line === selectedTestCase.line) return true;
            const nodeTitle = getTestTitle(node);
            if (!nodeTitle) return false;
            const normNode = nodeTitle.trim().toLowerCase();

            if (selectedTestCase.title) {
                const normSel = selectedTestCase.title.trim().toLowerCase();
                if (normNode === normSel || normNode.includes(normSel) || normSel.includes(normNode)) return true;
            }
            if (selectedTestCase.fullTitle) {
                const normFull = selectedTestCase.fullTitle.trim().toLowerCase();
                if (normFull.includes(normNode)) return true;
            }
            if (selectedTestCase.id && (selectedTestCase.id === nodeTitle || selectedTestCase.id === normNode)) return true;
            return false;
        });
    }

    // Collect top-level declarations into testScope
    const collectTopLevelScope = (node) => {
        if (!node || typeof node !== "object") return;
        if (isTestCall(node)) return; // skip test blocks

        if (node.type === "VariableDeclaration") {
            for (const decl of node.declarations || []) {
                if (decl.id?.type === "Identifier" && decl.init) {
                    testScope[decl.id.name] = evaluateAstExpression(decl.init, testScope);
                }
            }
        }
        for (const k of Object.keys(node)) {
            if (k === "loc" || k === "comments") continue;
            const child = node[k];
            if (Array.isArray(child)) child.forEach(collectTopLevelScope);
            else if (child && typeof child === "object") collectTopLevelScope(child);
        }
    };
    collectTopLevelScope(parseRes.ast);

    const findCallsAndAssertions = (node) => {
        if (!node || typeof node !== "object") return;

        // 1. VariableDeclaration: const res = fn(...args) or const expected = 25
        if (node.type === "VariableDeclaration") {
            for (const decl of node.declarations) {
                if (decl.init) {
                    const isTargetCall = decl.init.type === "CallExpression" &&
                        (decl.init.callee?.name === targetFnName ||
                         decl.init.callee?.property?.name === targetFnName);

                    if (isTargetCall) {
                        callArgs = (decl.init.arguments || []).map(a => evaluateAstExpression(a, testScope));
                        if (decl.id?.type === "Identifier") {
                            targetResultVarName = decl.id.name;
                        }
                    } else {
                        if (decl.id?.type === "Identifier") {
                            testScope[decl.id.name] = evaluateAstExpression(decl.init, testScope);
                        }
                    }
                }
            }
        }

        // 2. CallExpression:
        if (node.type === "CallExpression") {
            const calleeName = node.callee?.name || node.callee?.property?.name;

            if (calleeName === targetFnName && !callArgs) {
                callArgs = (node.arguments || []).map(a => evaluateAstExpression(a, testScope));
            }

            if (node.callee?.type === "MemberExpression") {
                const matcher = node.callee.property?.name;
                const inner = node.callee.object;
                let expectCall = null;
                let isRejects = false;
                if (inner?.type === "CallExpression" && inner.callee?.name === "expect") {
                    expectCall = inner;
                } else if (inner?.type === "MemberExpression" && inner.object?.type === "CallExpression" && inner.object.callee?.name === "expect") {
                    expectCall = inner.object;
                    if (inner.property?.name === "rejects") {
                        isRejects = true;
                    }
                }
                if (expectCall) {
                    const actualArg = expectCall.arguments?.[0];

                    if (actualArg?.type === "CallExpression" &&
                        (actualArg.callee?.name === targetFnName || actualArg.callee?.property?.name === targetFnName)) {
                        callArgs = (actualArg.arguments || []).map(a => evaluateAstExpression(a, testScope));
                    }

                    if (actualArg?.type === "ArrowFunctionExpression" || actualArg?.type === "FunctionExpression") {
                        const body = actualArg.body;
                        let fnCall = null;
                        if (body?.type === "CallExpression") {
                            fnCall = body;
                        } else if (body?.type === "BlockStatement") {
                            for (const s of body.body) {
                                if (s.type === "ExpressionStatement" && s.expression?.type === "CallExpression") {
                                    fnCall = s.expression;
                                    break;
                                }
                                if (s.type === "ReturnStatement" && s.argument?.type === "CallExpression") {
                                    fnCall = s.argument;
                                    break;
                                }
                            }
                        }
                        if (fnCall && (fnCall.callee?.name === targetFnName || fnCall.callee?.property?.name === targetFnName)) {
                            callArgs = (fnCall.arguments || []).map(a => evaluateAstExpression(a, testScope));
                        }
                    }

                    // Extract property path if actualArg is a MemberExpression (e.g. res.total or res.status)
                    let propertyPath = null;
                    let targetVar = null;
                    if (actualArg?.type === "MemberExpression" || actualArg?.type === "OptionalMemberExpression") {
                        const parts = [];
                        let curr = actualArg;
                        while (curr && (curr.type === "MemberExpression" || curr.type === "OptionalMemberExpression")) {
                            if (curr.property?.name) {
                                parts.unshift(curr.property.name);
                            } else if (curr.property?.value) {
                                parts.unshift(curr.property.value);
                            }
                            curr = curr.object;
                        }
                        if (curr?.type === "Identifier") {
                            targetVar = curr.name;
                        }
                        propertyPath = parts.join(".");
                    }

                    const expectedArg = node.arguments?.[0];
                    const expectedVal = expectedArg ? evaluateAstExpression(expectedArg, testScope) : undefined;
                    const line = node.loc?.start?.line || 1;
                    let snippet = "";
                    if (node.start !== undefined && node.end !== undefined) {
                        snippet = testCode.slice(node.start, node.end);
                        if (!snippet.endsWith(";")) snippet += ";";
                    } else {
                        snippet = (testLines[line - 1] || "").trim();
                    }

                    const isRelevantActual = !assertion ||
                        actualArg?.name === targetResultVarName ||
                        targetVar === targetResultVarName ||
                        actualArg?.type === "CallExpression" ||
                        actualArg?.type === "ArrowFunctionExpression" ||
                        actualArg?.type === "MemberExpression" ||
                        actualArg?.type === "OptionalMemberExpression";

                    if (isRelevantActual) {
                        assertion = {
                            matcher: isRejects ? (matcher === "toThrow" ? "toThrow" : `rejects.${matcher}`) : matcher,
                            isRejects,
                            expected: expectedVal,
                            line,
                            propertyPath,
                            targetVar,
                            actualNode: actualArg,
                            snippet: snippet || (isRejects
                                ? `expect(${targetFnName}(...)).rejects.${matcher}(${JSON.stringify(expectedVal)});`
                                : `expect(result).${matcher}(${JSON.stringify(expectedVal)});`)
                        };
                    }
                }
            }
        }

        for (const k of Object.keys(node)) {
            if (k === "loc" || k === "comments") continue;
            const child = node[k];
            if (Array.isArray(child)) {
                for (const c of child) findCallsAndAssertions(c);
            } else if (child && typeof child === "object") {
                findCallsAndAssertions(child);
            }
        }
    };

    if (targetTestNode) {
        findCallsAndAssertions(targetTestNode);
    } else {
        findCallsAndAssertions(parseRes.ast);
    }

    return { callArgs, assertion, testScope, targetResultVarName };
};

/**
 * Synthesizes dynamic, parameter-tailored scopes for virtual test scenarios
 * across the 4-Category Decision Table Matrix.
 */
export const synthesizeVirtualScope = (fnNode, testCategory) => {
    const scope = { NODE_ENV: "test" };
    if (!fnNode) return scope;

    const paramNames = extractFunctionParamNames(fnNode);
    if (paramNames.length === 0) return scope;

    const paramProps = {};
    const paramNestedValues = {};
    for (const p of paramNames) {
        paramProps[p] = new Set();
        paramNestedValues[p] = {};
    }

    const setDeepProp = (obj, pathArray, value) => {
        let curr = obj;
        for (let i = 0; i < pathArray.length - 1; i++) {
            const key = pathArray[i];
            if (!curr[key] || typeof curr[key] !== "object") {
                curr[key] = {};
            }
            curr = curr[key];
        }
        const lastKey = pathArray[pathArray.length - 1];
        curr[lastKey] = value;
    };

    const extractMemberPath = (node) => {
        const parts = [];
        let curr = node;
        while (curr && (curr.type === "MemberExpression" || curr.type === "OptionalMemberExpression")) {
            const prop = curr.computed
                ? (curr.property?.value || curr.property?.name)
                : curr.property?.name;
            if (prop) parts.unshift(prop);
            curr = curr.object;
        }
        if (curr?.type === "Identifier") {
            return { root: curr.name, path: parts };
        }
        return null;
    };

    const scanProps = (node) => {
        if (!node || typeof node !== "object") return;

        // 1. Member access
        if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
            const memberInfo = extractMemberPath(node);
            if (memberInfo && paramProps[memberInfo.root]) {
                if (memberInfo.path.length > 0) {
                    paramProps[memberInfo.root].add(memberInfo.path[0]);
                }
            }
        }

        // 2. Binary comparison (e.g. user?.role === "ADMIN", plan?.type === "ENTERPRISE", user?.age >= 65, req.user.role === "ADMIN")
        if (node.type === "BinaryExpression") {
            let member = null;
            let literal = null;
            let isMemberLeft = true;

            if ((node.left.type === "MemberExpression" || node.left.type === "OptionalMemberExpression") &&
                (node.right.type === "StringLiteral" || node.right.type === "NumericLiteral" || node.right.type === "BooleanLiteral")) {
                member = node.left;
                literal = node.right;
                isMemberLeft = true;
            } else if ((node.right.type === "MemberExpression" || node.right.type === "OptionalMemberExpression") &&
                       (node.left.type === "StringLiteral" || node.left.type === "NumericLiteral" || node.left.type === "BooleanLiteral")) {
                member = node.right;
                literal = node.left;
                isMemberLeft = false;
            }

            if (member && literal) {
                const memberInfo = extractMemberPath(member);
                if (memberInfo && paramProps[memberInfo.root] && memberInfo.path.length > 0) {
                    paramProps[memberInfo.root].add(memberInfo.path[0]);
                    let targetVal = literal.value;
                    if (isMemberLeft) {
                        if (node.operator === ">" && typeof targetVal === "number") targetVal += 1;
                        if (node.operator === "<" && typeof targetVal === "number") targetVal -= 1;
                    } else {
                        if (node.operator === ">" && typeof targetVal === "number") targetVal -= 1;
                        if (node.operator === "<" && typeof targetVal === "number") targetVal += 1;
                    }
                    setDeepProp(paramNestedValues[memberInfo.root], memberInfo.path, targetVal);
                }
            }
        }

        for (const k of Object.keys(node)) {
            if (k === "loc" || k === "comments") continue;
            const child = node[k];
            if (Array.isArray(child)) for (const c of child) scanProps(c);
            else if (child && typeof child === "object") scanProps(child);
        }
    };
    scanProps(fnNode.body);

    for (let i = 0; i < paramNames.length; i++) {
        const p = paramNames[i];
        const props = Array.from(paramProps[p] || []);
        const nested = paramNestedValues[p] || {};
        const isFirst = i === 0;
        const lowerP = p.toLowerCase();
        const isArrayParam = ["items", "list", "array", "arr", "elements", "rows", "records"].includes(lowerP) ||
            props.some(pr => ["map", "reduce", "filter", "forEach", "slice", "push", "pop"].includes(pr));

        if (isArrayParam) {
            if (testCategory === "BOUNDARY_VALUES") scope[p] = [];
            else if (testCategory === "ERROR_HANDLING" && isFirst) scope[p] = null;
            else scope[p] = [10, 20, 30];
        } else if (props.length > 0 || Object.keys(nested).length > 0) {
            if (testCategory === "ERROR_HANDLING" && isFirst) {
                scope[p] = null;
            } else if (testCategory === "BOUNDARY_VALUES") {
                const obj = {};
                for (const prop of props) {
                    if (["amount", "total", "balance", "price", "count", "rate"].includes(prop)) obj[prop] = 0;
                    else if (["items", "list"].includes(prop)) obj[prop] = [];
                    else if (["isVip", "isAdmin", "active"].includes(prop)) obj[prop] = false;
                    else obj[prop] = "";
                }
                scope[p] = obj;
            } else if (testCategory === "BRANCH_TOGGLING") {
                const obj = { ...nested };
                for (const prop of props) {
                    if (obj[prop] === undefined) {
                        if (["amount", "total", "balance"].includes(prop)) obj[prop] = 1500;
                        else if (["isVip", "isAdmin", "active", "isStudent"].includes(prop)) obj[prop] = true;
                        else if (["rate"].includes(prop)) obj[prop] = 0.1;
                        else obj[prop] = "SPECIAL";
                    }
                }
                scope[p] = obj;
            } else {
                const obj = { ...nested };
                for (const prop of props) {
                    if (obj[prop] === undefined) {
                        if (["amount", "total", "balance"].includes(prop)) obj[prop] = 500;
                        else if (["isVip", "isAdmin"].includes(prop)) obj[prop] = false;
                        else if (["rate"].includes(prop)) obj[prop] = 0.05;
                        else if (["id"].includes(prop)) obj[prop] = "id_101";
                        else if (["age"].includes(prop)) obj[prop] = 25;
                        else if (["user", "headers", "meta", "data", "options", "config"].includes(prop)) {
                            obj[prop] = prop === "headers" ? { "x-admin-key": "admin_key" } : { role: "ADMIN", name: "Alice" };
                        } else obj[prop] = "val";
                    }
                }
                scope[p] = obj;
            }
        } else {
            if (["items", "list", "array"].includes(lowerP)) {
                if (testCategory === "BOUNDARY_VALUES") scope[p] = [];
                else if (testCategory === "ERROR_HANDLING" && isFirst) scope[p] = null;
                else scope[p] = [10, 20, 30];
            } else if (["name", "str", "text", "payload"].includes(lowerP)) {
                if (testCategory === "BOUNDARY_VALUES") scope[p] = "";
                else if (testCategory === "ERROR_HANDLING" && isFirst) scope[p] = null;
                else scope[p] = "Alice";
            } else if (["isvip", "isexempt", "isadmin", "active"].includes(lowerP)) {
                if (testCategory === "BRANCH_TOGGLING") scope[p] = true;
                else scope[p] = false;
            } else if (["role", "type", "status"].includes(lowerP)) {
                if (testCategory === "BRANCH_TOGGLING") scope[p] = "ADMIN";
                else if (testCategory === "ERROR_HANDLING" && isFirst) scope[p] = null;
                else scope[p] = "STANDARD";
            } else if (["a", "b", "x", "y"].includes(lowerP)) {
                if (testCategory === "BOUNDARY_VALUES") scope[p] = 0;
                else if (testCategory === "ERROR_HANDLING" && isFirst) scope[p] = null;
                else if (testCategory === "BRANCH_TOGGLING") scope[p] = lowerP === "a" || lowerP === "x" ? 15 : 20;
                else scope[p] = lowerP === "a" || lowerP === "x" ? 2 : 3;
            } else if (["hours", "amount", "rate", "count", "balance"].includes(lowerP)) {
                if (testCategory === "ERROR_HANDLING" && isFirst) scope[p] = -1;
                else if (testCategory === "BOUNDARY_VALUES") scope[p] = 0;
                else if (testCategory === "BRANCH_TOGGLING") scope[p] = lowerP === "rate" ? 0.2 : 1500;
                else scope[p] = lowerP === "hours" ? 40 : (lowerP === "rate" ? 0.05 : 100);
            } else {
                if (testCategory === "ERROR_HANDLING" && isFirst) scope[p] = null;
                else if (testCategory === "BOUNDARY_VALUES") scope[p] = 0;
                else scope[p] = 100;
            }
        }
    }

    if (fnNode.params && Array.isArray(fnNode.params)) {
        for (const p of fnNode.params) {
            if (p.type === "AssignmentPattern" && p.left?.type === "Identifier") {
                if (scope[p.left.name] === undefined) {
                    scope[p.left.name] = evaluateAstExpression(p.right, scope);
                }
            }
        }
    }

    return scope;
};

/**
 * Symbolic statement-by-statement executor that traverses the AST body of the target function,
 * executing variable declarations, evaluating if conditions, recording branch outcomes,
 * intercepting universal RAM mocks, and returning genuine computed values and thrown exceptions.
 */
export const simulateFunctionExecution = ({
    fnNode,
    initialScope,
    sourceCodeLines,
    activeMocks = [],
    sourceAst = null,
    callDepth = 0
}) => {
    const scope = { ...initialScope };
    let returnValue = undefined;
    let thrownError = undefined;
    let terminated = false;
    let returnLine = fnNode?.loc?.end?.line || 1;
    let returnSnippet = "";
    const branchesToggled = [];
    const executionEvents = [];
    const executedLines = new Set();

    if (fnNode?.loc?.start?.line) {
        executedLines.add(fnNode.loc.start.line);
    }

    // Register all functions defined in sourceAst so internal helpers and mutual calls can be evaluated
    if (sourceAst && callDepth < 10) {
        const allFns = extractAllFunctionsFromAst(sourceAst);
        for (const [fnName, helperNode] of allFns.entries()) {
            if (fnName) {
                scope[fnName] = (...callArgs) => {
                    if (callDepth >= 9) {
                        return undefined;
                    }
                    const helperScope = { ...scope };
                    const paramNames = extractFunctionParamNames(helperNode);
                    paramNames.forEach((pName, pIdx) => {
                        if (pName) {
                            helperScope[pName] = callArgs[pIdx];
                        }
                    });
                    if (helperNode.params && Array.isArray(helperNode.params)) {
                        for (const p of helperNode.params) {
                            if (p.type === "AssignmentPattern" && p.left?.type === "Identifier") {
                                if (helperScope[p.left.name] === undefined) {
                                    helperScope[p.left.name] = evaluateAstExpression(p.right, helperScope);
                                }
                            }
                        }
                    }
                    const helperRes = simulateFunctionExecution({
                        fnNode: helperNode,
                        initialScope: helperScope,
                        sourceCodeLines,
                        activeMocks,
                        sourceAst,
                        callDepth: callDepth + 1
                    });
                    helperRes.executedLines.forEach(l => executedLines.add(l));
                    helperRes.branchesToggled.forEach(b => branchesToggled.push(b));
                    helperRes.executionEvents.forEach(e => executionEvents.push(e));
                    return helperRes.returnValue;
                };
            }
        }
    }

    const statements = fnNode?.body?.type === "BlockStatement"
        ? fnNode.body.body
        : (fnNode?.body ? [{ type: "ReturnStatement", argument: fnNode.body, loc: fnNode.body?.loc }] : []);

    const execStmtList = (stmtList) => {
        for (const stmt of stmtList) {
            if (terminated) break;
            const line = stmt.loc?.start?.line || 1;
            executedLines.add(line);
            const snippet = (sourceCodeLines[line - 1] || "").trim();

            if (stmt.type === "VariableDeclaration") {
                for (const decl of stmt.declarations) {
                    if (!decl.id || decl.id.type !== "Identifier") continue;
                    const varName = decl.id.name;

                    const isMockCall = (decl.init?.type === "AwaitExpression" || decl.init?.type === "CallExpression") &&
                        (snippet.includes("prisma.") || snippet.includes("axios.") || snippet.includes("Queue"));

                    if (isMockCall) {
                        let mockReturn = { id: "mock_res_1", status: "RESOLVED" };
                        if (snippet.includes("prisma.")) {
                            mockReturn = { id: scope.userId || "usr_1", name: "Mock User", balance: 1000 };
                            if (activeMocks[0]) {
                                activeMocks[0].method = "findUnique";
                                activeMocks[0].returned = mockReturn;
                                activeMocks[0].status = "RESOLVED";
                            }
                        } else if (snippet.includes("axios.")) {
                            mockReturn = { id: "tx_mock_1", status: "SUCCESS", data: { verified: true } };
                            const axiosMock = activeMocks.find(m => m.module === "axios") || activeMocks[1];
                            if (axiosMock) {
                                axiosMock.method = "post";
                                axiosMock.returned = mockReturn;
                                axiosMock.status = "RESOLVED";
                            }
                        }

                        scope[varName] = mockReturn;
                        executionEvents.push({
                            type: "MOCK_INTERACTION",
                            line,
                            snippet,
                            mockReturn
                        });
                    } else {
                        const val = evaluateAstExpression(decl.init, scope);
                        scope[varName] = val;
                        executionEvents.push({
                            type: "VARIABLE_DECLARATION",
                            line,
                            name: varName,
                            value: val,
                            snippet
                        });
                    }
                }
            } else if (stmt.type === "ExpressionStatement") {
                if (snippet.includes("prisma.") || snippet.includes("axios.") || snippet.includes("Queue")) {
                    const axiosMock = activeMocks.find(m => m.module === "axios") || activeMocks[0];
                    if (axiosMock) {
                        axiosMock.status = "RESOLVED";
                    }
                    executionEvents.push({
                        type: "MOCK_INTERACTION",
                        line,
                        snippet
                    });
                } else {
                    evaluateAstExpression(stmt.expression, scope);
                }
            } else if (stmt.type === "IfStatement") {
                const condVal = Boolean(evaluateAstExpression(stmt.test, scope));
                const condSnippet = sourceCodeLines[line - 1]
                    ? sourceCodeLines[line - 1].trim()
                    : "if (condition)";

                branchesToggled.push({
                    line,
                    condition: condSnippet,
                    outcome: condVal
                });

                const branchTaken = condVal ? "TRUE" : "FALSE";
                const explanation = condVal
                    ? `Condition '${condSnippet}' evaluated to TRUE in current scope. Entering consequent branch.`
                    : `Condition '${condSnippet}' evaluated to FALSE in current scope. Continuing to alternate or nominal flow.`;

                executionEvents.push({
                    type: "BRANCH_DECISION",
                    line,
                    condition: condSnippet,
                    evaluatedTo: condVal,
                    branchTaken,
                    explanation,
                    snippet,
                    consequentLine: stmt.consequent?.loc?.start?.line || line + 1,
                    alternateLine: stmt.alternate?.loc?.start?.line || null
                });

                if (condVal) {
                    if (stmt.consequent?.type === "BlockStatement") {
                        const sig = execStmtList(stmt.consequent.body);
                        if (sig) return sig;
                    } else if (stmt.consequent) {
                        const sig = execStmtList([stmt.consequent]);
                        if (sig) return sig;
                    }
                } else if (stmt.alternate) {
                    if (stmt.alternate.type === "BlockStatement") {
                        const sig = execStmtList(stmt.alternate.body);
                        if (sig) return sig;
                    } else {
                        const sig = execStmtList([stmt.alternate]);
                        if (sig) return sig;
                    }
                }
            } else if (stmt.type === "SwitchStatement") {
                const discVal = evaluateAstExpression(stmt.discriminant, scope);
                const switchSnippet = sourceCodeLines[line - 1]
                    ? sourceCodeLines[line - 1].trim()
                    : `switch (${stmt.discriminant?.name || "value"})`;

                let matchedIndex = -1;
                let defaultIndex = -1;
                const cases = stmt.cases || [];

                for (let ci = 0; ci < cases.length; ci++) {
                    const c = cases[ci];
                    if (c.test) {
                        const testVal = evaluateAstExpression(c.test, scope);
                        if (matchedIndex === -1 && testVal === discVal) {
                            matchedIndex = ci;
                        }
                    } else {
                        defaultIndex = ci;
                    }
                }

                const startIndex = matchedIndex !== -1 ? matchedIndex : defaultIndex;
                const matchedCase = startIndex !== -1 ? cases[startIndex] : null;
                const caseLabel = matchedCase?.test
                    ? `case ${JSON.stringify(evaluateAstExpression(matchedCase.test, scope))}`
                    : (startIndex !== -1 ? "default" : "no match");

                branchesToggled.push({
                    line,
                    condition: switchSnippet,
                    outcome: startIndex !== -1
                });

                executionEvents.push({
                    type: "BRANCH_DECISION",
                    line,
                    condition: switchSnippet,
                    evaluatedTo: startIndex !== -1,
                    branchTaken: caseLabel,
                    explanation: `Switch discriminant evaluated to '${caseLabel}'.`,
                    snippet: switchSnippet,
                    consequentLine: matchedCase?.loc?.start?.line || line + 1,
                    alternateLine: null
                });

                if (startIndex !== -1) {
                    for (let ci = startIndex; ci < cases.length; ci++) {
                        if (terminated) break;
                        const c = cases[ci];
                        if (c.consequent && c.consequent.length > 0) {
                            const sig = execStmtList(c.consequent);
                            if (sig === "break") {
                                break;
                            }
                            if (sig === "continue") {
                                return "continue";
                            }
                        }
                    }
                }
            } else if (stmt.type === "ForOfStatement") {
                const iterable = evaluateAstExpression(stmt.right, scope);
                const loopItems = Array.isArray(iterable) ? iterable : (iterable && typeof iterable === "object" ? Object.values(iterable) : []);
                for (const item of loopItems) {
                    if (terminated) break;
                    let varName = null;
                    if (stmt.left.type === "VariableDeclaration") {
                        const decl = stmt.left.declarations?.[0];
                        if (decl?.id?.type === "Identifier") {
                            varName = decl.id.name;
                        }
                    } else if (stmt.left.type === "Identifier") {
                        varName = stmt.left.name;
                    }
                    if (varName) {
                        scope[varName] = item;
                    }
                    let sig;
                    if (stmt.body?.type === "BlockStatement") {
                        sig = execStmtList(stmt.body.body);
                    } else if (stmt.body) {
                        sig = execStmtList([stmt.body]);
                    }
                    if (sig === "break") break;
                    if (sig === "continue") continue;
                }
            } else if (stmt.type === "ForInStatement") {
                const obj = evaluateAstExpression(stmt.right, scope);
                const keys = obj && typeof obj === "object" ? Object.keys(obj) : [];
                for (const key of keys) {
                    if (terminated) break;
                    let varName = null;
                    if (stmt.left.type === "VariableDeclaration") {
                        const decl = stmt.left.declarations?.[0];
                        if (decl?.id?.type === "Identifier") {
                            varName = decl.id.name;
                        }
                    } else if (stmt.left.type === "Identifier") {
                        varName = stmt.left.name;
                    }
                    if (varName) {
                        scope[varName] = key;
                    }
                    let sig;
                    if (stmt.body?.type === "BlockStatement") {
                        sig = execStmtList(stmt.body.body);
                    } else if (stmt.body) {
                        sig = execStmtList([stmt.body]);
                    }
                    if (sig === "break") break;
                    if (sig === "continue") continue;
                }
            } else if (stmt.type === "ForStatement") {
                if (stmt.init) {
                    if (stmt.init.type === "VariableDeclaration") {
                        execStmtList([stmt.init]);
                    } else {
                        evaluateAstExpression(stmt.init, scope);
                    }
                }
                let iterations = 0;
                while (!terminated && (stmt.test ? Boolean(evaluateAstExpression(stmt.test, scope)) : true)) {
                    if (iterations++ > 1000) break;
                    let sig;
                    if (stmt.body?.type === "BlockStatement") {
                        sig = execStmtList(stmt.body.body);
                    } else if (stmt.body) {
                        sig = execStmtList([stmt.body]);
                    }
                    if (sig === "break") break;
                    if (stmt.update) {
                        evaluateAstExpression(stmt.update, scope);
                    }
                }
            } else if (stmt.type === "WhileStatement") {
                let iterations = 0;
                while (!terminated && Boolean(evaluateAstExpression(stmt.test, scope))) {
                    if (iterations++ > 1000) break;
                    let sig;
                    if (stmt.body?.type === "BlockStatement") {
                        sig = execStmtList(stmt.body.body);
                    } else if (stmt.body) {
                        sig = execStmtList([stmt.body]);
                    }
                    if (sig === "break") break;
                    if (sig === "continue") continue;
                }
            } else if (stmt.type === "BreakStatement") {
                return "break";
            } else if (stmt.type === "ContinueStatement") {
                return "continue";
            } else if (stmt.type === "TryStatement") {
                let sig;
                try {
                    if (stmt.block) {
                        sig = execStmtList(stmt.block.body);
                    }
                } catch (e) {
                    if (stmt.handler) {
                        const catchParam = stmt.handler.param?.name;
                        if (catchParam) {
                            scope[catchParam] = e;
                        }
                        if (stmt.handler.body) {
                            sig = execStmtList(stmt.handler.body.body);
                        }
                    }
                } finally {
                    if (stmt.finalizer) {
                        const finSig = execStmtList(stmt.finalizer.body);
                        if (finSig) sig = finSig;
                    }
                }
                if (sig) return sig;
            } else if (stmt.type === "BlockStatement") {
                const sig = execStmtList(stmt.body);
                if (sig) return sig;
            } else if (stmt.type === "ReturnStatement") {
                returnValue = stmt.argument ? evaluateAstExpression(stmt.argument, scope) : undefined;
                if (returnValue && (typeof returnValue.then === "function" || typeof returnValue.catch === "function")) {
                    if (typeof returnValue.catch === "function") {
                        returnValue.catch(() => {});
                    }
                    if (returnValue._rejectionReason !== undefined) {
                        const rejErr = returnValue._rejectionReason;
                        thrownError = rejErr instanceof Error ? rejErr.message : String(rejErr || "Promise rejected");
                        scope.thrownException = "Error: " + thrownError;
                    }
                }
                scope.returnValue = returnValue;
                terminated = true;
                returnLine = line;
                returnSnippet = snippet || (returnValue !== undefined ? `return ${JSON.stringify(returnValue)};` : "return;");
                if (thrownError) {
                    executionEvents.push({
                        type: "THROW_EXCEPTION",
                        line,
                        error: thrownError,
                        snippet: returnSnippet
                    });
                } else {
                    executionEvents.push({
                        type: "RETURN_VALUE",
                        line,
                        value: returnValue,
                        snippet: returnSnippet
                    });
                }
                break;
            } else if (stmt.type === "ThrowStatement") {
                const errObj = evaluateAstExpression(stmt.argument, scope);
                if (errObj && typeof errObj.catch === "function") {
                    errObj.catch(() => {});
                }
                const rawErr = errObj?._rejectionReason || errObj;
                thrownError = rawErr instanceof Error ? rawErr.message : String(rawErr || "Error");
                scope.thrownException = "Error: " + thrownError;
                terminated = true;
                returnLine = line;
                returnSnippet = snippet || `throw new Error("${thrownError}");`;
                executionEvents.push({
                    type: "THROW_EXCEPTION",
                    line,
                    error: thrownError,
                    snippet: returnSnippet
                });
                break;
            }
        }
    };

    execStmtList(statements);

    if (!terminated) {
        returnLine = fnNode?.loc?.end?.line || returnLine;
        returnSnippet = (sourceCodeLines[returnLine - 1] || "return undefined;").trim();
        scope.returnValue = returnValue;
    }

    return {
        scope,
        returnValue,
        thrownError,
        returnLine,
        returnSnippet,
        terminated,
        branchesToggled,
        executionEvents,
        executedLines
    };
};

/**
 * Universal RAM Mock Configuration Discoverer
 */
export const discoverUniversalRamMocks = (astMetadata = {}, testCode = "") => {
    const mocks = [];
    const imports = astMetadata.imports || astMetadata.formattedImports || {};

    // Prisma ORM
    if (imports["@prisma/client"] || imports["../config/prisma.js"] || imports["../lib/prisma.js"] || imports["prismaClient"]) {
        mocks.push({
            module: "prisma",
            mockType: "DATABASE_MOCK",
            simulatedMethods: ["user.findUnique", "order.create", "order.findMany", "$transaction"],
            status: "READY"
        });
    }

    // Axios HTTP Client
    if (imports["axios"] || imports["node-fetch"] || imports["got"]) {
        mocks.push({
            module: "axios",
            mockType: "HTTP_CLIENT_MOCK",
            simulatedMethods: ["get", "post", "put", "delete"],
            status: "READY"
        });
    }

    // Redis Cache
    if (imports["ioredis"] || imports["redis"]) {
        mocks.push({
            module: "redis",
            mockType: "CACHE_MOCK",
            simulatedMethods: ["get", "set", "del"],
            status: "READY"
        });
    }

    // BullMQ Queue
    if (imports["bull"] || imports["bullmq"]) {
        mocks.push({
            module: "bullmq",
            mockType: "QUEUE_MOCK",
            simulatedMethods: ["add", "process"],
            status: "READY"
        });
    }

    // Mongoose Models
    if (imports["mongoose"] || (astMetadata.mongooseModels && astMetadata.mongooseModels.length > 0)) {
        mocks.push({
            module: "mongoose",
            mockType: "DATABASE_MOCK",
            simulatedMethods: ["find", "findOne", "create", "save"],
            status: "READY"
        });
    }

    // Process.env Sandbox
    mocks.push({
        module: "process.env",
        mockType: "ENVIRONMENT_MOCK",
        simulatedMethods: ["NODE_ENV"],
        status: "READY"
    });

    return mocks;
};

/**
 * 3. SIMULATION TRACE GENERATION
 *
 * Generates an end-to-end simulation trace structured across the 7-Step
 * Educational Taxonomy, complete with line numbers, code snippets, variables,
 * branch toggling explanations, universal RAM mocks, and assertion outcomes.
 *
 * @param {string} snapshotId
 * @param {object} payload
 * @returns {Promise<object>} SimulationTrace
 */
export const generateSimulationTrace = async (snapshotId, payload = {}) => {
    let {
        sourceFilePath,
        testFilePath,
        testCaseId,
        testCaseTitle,
        functionName,
        category: requestedCategory
    } = payload;

    if (!sourceFilePath && typeof payload.sourceCode !== "string") {
        throw new ServiceError("sourceFilePath or sourceCode is required", 400);
    }

    // 1. Resolve source code
    let sourceCode = typeof payload.sourceCode === "string" ? payload.sourceCode : "";
    let rootDir = payload.rootDir || null;

    if (typeof payload.sourceCode !== "string") {
        const rootRes = await resolveSnapshotRoot(snapshotId, payload.options || payload);
        rootDir = rootRes.rootDir;

        if (typeof sourceFilePath !== "string") {
            path.join(rootDir, sourceFilePath);
        }

        if (!sourceFilePath.trim()) {
            throw new ServiceError(`Source file not found: ${sourceFilePath}`, 404);
        }

        const cleanedSourcePath = cleanRelativePath(rootDir, sourceFilePath);
        const fullSourcePath = path.join(rootDir, cleanedSourcePath);
        if (!fs.existsSync(fullSourcePath) || fs.statSync(fullSourcePath).isDirectory()) {
            throw new ServiceError(`Source file not found: ${sourceFilePath}`, 404);
        }
        sourceCode = fs.readFileSync(fullSourcePath, "utf8");
        sourceFilePath = cleanedSourcePath;
    }

    const astMetadata = analyzeSourceAst(sourceCode);
    const sourceCodeLines = sourceCode.split(/\r?\n/);

    // Filter executable exported functions (exclude TypeScript interfaces, type aliases, and constants)
    const executableExportedSymbols = (astMetadata.exportedSymbols || []).filter(sym => {
        if (!sym || !sym.name) return false;
        if (sym.type === "constant" || sym.type === "interface" || sym.type === "type") return false;
        if (sourceCode && new RegExp(`export\\s+(?:interface|type)\\s+${sym.name}\\b`).test(sourceCode)) {
            return false;
        }
        return true;
    });

    // 2. Resolve test code & test case
    let testCode = payload.testCode || "";
    let actualTestFilePath = testFilePath || null;

    if (!testCode && actualTestFilePath && rootDir) {
        if (typeof actualTestFilePath === "string" && actualTestFilePath.trim()) {
            const cleanedActualTestPath = cleanRelativePath(rootDir, actualTestFilePath);
            const fullTestPath = path.join(rootDir, cleanedActualTestPath);
            if (fs.existsSync(fullTestPath) && !fs.statSync(fullTestPath).isDirectory()) {
                testCode = fs.readFileSync(fullTestPath, "utf8");
                actualTestFilePath = cleanedActualTestPath;
            }
        }
    }

    // If still no test code, check associated tests on disk
    if (!testCode && rootDir && sourceFilePath) {
        try {
            const assoc = findAllAssociatedTestFiles(rootDir, sourceFilePath);
            if (assoc.primaryTestFile?.found && assoc.primaryTestFile?.testCode) {
                testCode = assoc.primaryTestFile.testCode;
                actualTestFilePath = assoc.primaryTestFile.filePath;
            }
        } catch {}
    }

    let parsedTestAst = null;
    let selectedTestCase = null;
    let isVirtualScenario = false;

    if (testCode && testCode.trim()) {
        parsedTestAst = parseExistingTestAst(testCode, actualTestFilePath || "test.js");
        const tests = parsedTestAst.tests || [];

        if (testCaseId) {
            selectedTestCase = tests.find(t => t.id === testCaseId || t.title === testCaseId || t.fullTitle === testCaseId);
        }
        if (!selectedTestCase && testCaseTitle) {
            selectedTestCase = tests.find(t => t.title.toLowerCase().includes(testCaseTitle.toLowerCase()));
        }
        // Match both function AND requested category if category is specified
        if (!selectedTestCase && functionName && requestedCategory) {
            selectedTestCase = tests.find(t =>
                (t.targetFunction === functionName || t.calledFunctions?.includes(functionName)) &&
                t.category === requestedCategory
            );
        }
        // Match by requested category across suite if category is specified
        if (!selectedTestCase && requestedCategory) {
            selectedTestCase = tests.find(t => t.category === requestedCategory);
        }
        // Match by function name only if no specific category was requested
        if (!selectedTestCase && functionName && !requestedCategory) {
            selectedTestCase = tests.find(t => t.targetFunction === functionName || t.calledFunctions?.includes(functionName));
        }
        // Fall back to first test only if no specific category was requested
        if (!selectedTestCase && !requestedCategory && tests.length > 0) {
            selectedTestCase = tests[0];
        }
    }

    // 3. Virtual Scenario Synthesis if no test file or no match
    let virtualScenario = null;
    if (!selectedTestCase) {
        isVirtualScenario = true;
        const dtResult = buildDecisionTableMatrix({
            astMetadata,
            sourceCode,
            filePath: sourceFilePath || "source.js"
        });
        const entries = dtResult.matrixEntries || [];

        if (testCaseId) {
            virtualScenario = entries.find(e => e.id === testCaseId);
        }
        if (!virtualScenario && functionName && requestedCategory) {
            virtualScenario = entries.find(e => e.targetFunction === functionName && e.category === requestedCategory);
        }
        if (!virtualScenario && requestedCategory) {
            virtualScenario = entries.find(e => e.category === requestedCategory);
        }
        if (!virtualScenario && functionName) {
            virtualScenario = entries.find(e => e.targetFunction === functionName);
        }
        if (!virtualScenario && entries.length > 0) {
            virtualScenario = entries[0];
        }

        if (!virtualScenario) {
            // Default synthesized scenario customized to requestedCategory if decision table is empty
            const primaryFn = executableExportedSymbols[0]?.name || functionName || "main";
            virtualScenario = {
                id: requestedCategory ? `TC-${requestedCategory.replace(/_/g, "-")}-01` : "TC-HAPPY-01",
                category: requestedCategory || "HAPPY_PATH",
                categoryName: CATEGORY_NAMES[requestedCategory] || "A. Happy Path",
                targetFunction: functionName || primaryFn,
                condition: requestedCategory ? `Synthesized ${CATEGORY_NAMES[requestedCategory] || requestedCategory}` : "Nominal Execution",
                inputScenario: requestedCategory === "BOUNDARY_VALUES"
                    ? "Extreme boundary values (0, -1, empty collection)"
                    : (requestedCategory === "ERROR_HANDLING" ? "Invalid input triggering exception" : "Standard valid parameters"),
                expectedBehavior: requestedCategory === "ERROR_HANDLING" ? "Throws validation or domain exception" : "Expected return value",
                priority: "HIGH",
                isVirtual: true
            };
        }

        selectedTestCase = {
            id: virtualScenario.id,
            title: `Virtual Simulation: ${virtualScenario.condition} (${virtualScenario.inputScenario})`,
            category: virtualScenario.category,
            targetFunction: virtualScenario.targetFunction,
            line: 1,
            isVirtual: true
        };
    }

    const testCategory = selectedTestCase.category || requestedCategory || "HAPPY_PATH";

    const allSourceFnNames = [
        ...executableExportedSymbols.map(s => s.name),
        ...astMetadata.internalFunctions.map(s => s.name)
    ];

    let targetFnName = functionName;
    if (!targetFnName) {
        if (selectedTestCase?.targetFunction && allSourceFnNames.includes(selectedTestCase.targetFunction)) {
            targetFnName = selectedTestCase.targetFunction;
        } else {
            const matchedCalled = (selectedTestCase?.calledFunctions || []).find(fn => allSourceFnNames.includes(fn));
            if (matchedCalled) {
                targetFnName = matchedCalled;
            } else if (selectedTestCase?.suite && allSourceFnNames.includes(selectedTestCase.suite)) {
                targetFnName = selectedTestCase.suite;
            } else {
                targetFnName = executableExportedSymbols[0]?.name || allSourceFnNames[0] || "main";
            }
        }
    }

    // 4. Resolve Target Function AST & Call Graph Backtracking (Rule 3)
    const isInternalHelper = astMetadata.internalFunctions.some(f => f.name === targetFnName);
    let publicCallerName = null;
    let callPath = [targetFnName];

    if (isInternalHelper) {
        const exportedNames = new Set(executableExportedSymbols.map(s => s.name));
        const internalMap = new Map(astMetadata.internalFunctions.map(f => [f.name, f]));

        // BFS to find shortest caller chain from an exported function to targetFnName
        const queue = [ [targetFnName] ];
        const visited = new Set([targetFnName]);
        let resolvedPath = null;

        while (queue.length > 0) {
            const currentPath = queue.shift();
            const currentHead = currentPath[0];

            if (currentPath.length > 1 && exportedNames.has(currentHead)) {
                resolvedPath = currentPath;
                break;
            }

            let callers = [];
            const helperMeta = internalMap.get(currentHead);
            if (helperMeta?.callers && helperMeta.callers.length > 0) {
                callers = helperMeta.callers;
            } else {
                for (const exp of executableExportedSymbols) {
                    if (exp.calls && exp.calls.includes(currentHead)) {
                        callers.push(exp.name);
                    }
                }
            }

            for (const caller of callers) {
                if (exportedNames.has(caller)) {
                    resolvedPath = [caller, ...currentPath];
                    break;
                }
                if (!visited.has(caller)) {
                    visited.add(caller);
                    queue.push([caller, ...currentPath]);
                }
            }

            if (resolvedPath) break;
        }

        if (resolvedPath) {
            callPath = resolvedPath;
            publicCallerName = resolvedPath[0];
        } else {
            const helperMeta = internalMap.get(targetFnName);
            if (helperMeta?.callers && helperMeta.callers.length > 0) {
                publicCallerName = helperMeta.callers[0];
                callPath = [publicCallerName, targetFnName];
            } else if (executableExportedSymbols.length > 0) {
                publicCallerName = executableExportedSymbols[0].name;
                callPath = [publicCallerName, targetFnName];
            }
        }
    }

    // 5. Initialize Universal RAM Mocks (Rule 4)
    const initialMocks = discoverUniversalRamMocks(astMetadata, testCode);
    const activeMocks = initialMocks.map(m => ({ ...m, status: "READY" }));

    // 6. Trace Steps Generator
    const steps = [];
    const branchesToggled = [];
    const executedLines = new Set();
    let currentScope = { NODE_ENV: "test" };
    let stepIndexCounter = 1;

    // STEP 1: SETUP_MOCKS (Phase 1)
    const mockSnippet = testCode
        ? (testCode.match(/jest\.mock\([^;]+\);/)?.[0] || "process.env.NODE_ENV = 'test';")
        : `// Universal RAM Mock Isolation Contracts\nprocess.env.NODE_ENV = 'test';`;

    steps.push({
        stepIndex: stepIndexCounter++,
        stepNumber: 1,
        phase: "SETUP_MOCKS",
        stepType: "SETUP_MOCKS",
        title: "Universal RAM Mock Initialization",
        description: "Downstream I/O dependencies isolated hermetically in RAM with zero disk writes.",
        line: 1,
        column: 0,
        endLine: 1,
        codeSnippet: mockSnippet,
        callStack: ["<test_suite>"],
        variables: { ...currentScope },
        activeMocks: [...activeMocks],
        educationalGuidance: {
            stepTitle: "Universal RAM Mock Initialization",
            category: testCategory,
            categoryExplanation: "Category Setup: Unit tests must execute hermetically in memory. Isolate external dependencies before module execution to prevent network/DB latency and side-effects.",
            stepNarrative: `Configured ${initialMocks.length} Universal RAM Mock(s): ${initialMocks.map(m => m.module).join(", ")}.`,
            logicRationale: "Running tests hermetically in RAM ensures 100% deterministic assertions and guarantees the Storage Immutability Guard.",
            developerTakeaway: "Always mock external services (Prisma, Axios, Redis) before importing the target business logic module."
        }
    });

    // Parse source code with @babel/parser
    const sourceAstRes = parseJavaScriptCode(sourceCode);
    const sourceAst = sourceAstRes.ast;

    let fnNode = findFunctionAstNode(sourceAst, targetFnName);
    if (!fnNode && publicCallerName) {
        fnNode = findFunctionAstNode(sourceAst, publicCallerName);
    }
    if (!fnNode) {
        fnNode = findFunctionAstNode(sourceAst, null);
    }

    const fnStartLine = fnNode?.loc?.start?.line || 1;
    const fnEndLine = fnNode?.loc?.end?.line || fnStartLine;
    executedLines.add(fnStartLine);

    // Dynamic Parameter & Scope Resolution
    const paramNames = extractFunctionParamNames(fnNode);
    let testExecutionData = null;

    if (testCode && testCode.trim()) {
        testExecutionData = extractTestExecutionData(testCode, targetFnName, selectedTestCase);
    }

    if (testExecutionData?.callArgs && testExecutionData.callArgs.length > 0) {
        // Track A: Test code AST argument extraction
        currentScope = { NODE_ENV: "test" };
        paramNames.forEach((name, idx) => {
            if (idx < testExecutionData.callArgs.length && testExecutionData.callArgs[idx] !== undefined) {
                currentScope[name] = testExecutionData.callArgs[idx];
            }
        });
        if (fnNode?.params && Array.isArray(fnNode.params)) {
            for (const p of fnNode.params) {
                if (p.type === "AssignmentPattern" && p.left?.type === "Identifier") {
                    if (currentScope[p.left.name] === undefined) {
                        currentScope[p.left.name] = evaluateAstExpression(p.right, currentScope);
                    }
                }
            }
        }
    } else {
        // Track B: Virtual Scenario Scope Synthesizer
        currentScope = synthesizeVirtualScope(fnNode, testCategory);
    }

    // Apply explicit payload.inputs if provided
    if (payload.inputs && typeof payload.inputs === "object") {
        if (Array.isArray(payload.inputs)) {
            paramNames.forEach((name, idx) => {
                if (idx < payload.inputs.length && payload.inputs[idx] !== undefined) {
                    currentScope[name] = payload.inputs[idx];
                }
            });
        } else {
            Object.assign(currentScope, payload.inputs);
        }
    }

    if (fnNode?.params && Array.isArray(fnNode.params)) {
        for (const p of fnNode.params) {
            if (p.type === "AssignmentPattern" && p.left?.type === "Identifier") {
                if (currentScope[p.left.name] === undefined) {
                    currentScope[p.left.name] = evaluateAstExpression(p.right, currentScope);
                }
            }
        }
    }

    // STEP 2: CALL_ENTRY (Phase 2)
    if (isInternalHelper && publicCallerName) {
        // Step 2a: Indirect Call Graph Entry at Public Caller (Rule 3)
        const callerFnNode = findFunctionAstNode(sourceAst, publicCallerName);
        const callerLine = callerFnNode?.loc?.start?.line || fnStartLine;
        const callerSnippet = (sourceCodeLines[callerLine - 1] || `export function ${publicCallerName}() {`).trim();
        executedLines.add(callerLine);

        steps.push({
            stepIndex: stepIndexCounter++,
            stepNumber: steps.length + 1,
            phase: "CALL_ENTRY",
            stepType: "CALL_ENTRY",
            title: `Indirect Call Graph Entry: ${publicCallerName}`,
            description: `Invoking exported caller ${publicCallerName}() to indirectly trigger internal helper ${targetFnName}().`,
            line: callerLine,
            column: 0,
            endLine: callerLine,
            codeSnippet: callerSnippet,
            callStack: [publicCallerName],
            variables: { ...currentScope },
            activeMocks: [...activeMocks],
            educationalGuidance: {
                stepTitle: `Indirect Call Graph Entry: ${publicCallerName}`,
                category: testCategory,
                categoryExplanation: "Rule 3 Strict Indirect Testing: Internal/unexported helper functions must NEVER be imported directly (`import { helper }` causes fatal runtime TypeError).",
                stepNarrative: `Test enters via public caller ${publicCallerName}() and passes parameters to reach private helper ${targetFnName}().`,
                logicRationale: "Indirect testing tests private logic as an integrated part of the public API without leaking internal implementation details.",
                developerTakeaway: "Use Call Graph Backtracking to determine the minimum public input necessary to exercise private branches."
            }
        });

        // Step 2b: Entering Internal Helper
        const helperLine = fnNode?.loc?.start?.line || fnStartLine + 5;
        executedLines.add(helperLine);
        const helperSnippet = (sourceCodeLines[helperLine - 1] || `function ${targetFnName}() {`).trim();

        steps.push({
            stepIndex: stepIndexCounter++,
            stepNumber: steps.length + 1,
            phase: "CALL_ENTRY",
            stepType: "CALL_ENTRY",
            title: `Call Graph Step-In: ${targetFnName}`,
            description: `Execution control stepped from ${publicCallerName}() into private helper ${targetFnName}().`,
            line: helperLine,
            column: 0,
            endLine: helperLine,
            codeSnippet: helperSnippet,
            callStack: [publicCallerName, targetFnName],
            variables: { ...currentScope },
            activeMocks: [...activeMocks],
            educationalGuidance: {
                stepTitle: `Internal Helper Invocation: ${targetFnName}`,
                category: testCategory,
                categoryExplanation: "Exercising internal callee via public API parameters.",
                stepNarrative: `Parameters successfully forwarded to ${targetFnName}().`,
                logicRationale: "Testing internal functions via public callers ensures the integration interface remains intact.",
                developerTakeaway: "Do not export private functions merely to make them testable."
            }
        });
    } else {
        // Direct Call Entry
        const fnSnippet = (sourceCodeLines[fnStartLine - 1] || `export function ${targetFnName}() {`).trim();
        steps.push({
            stepIndex: stepIndexCounter++,
            stepNumber: steps.length + 1,
            phase: "CALL_ENTRY",
            stepType: "CALL_ENTRY",
            title: `Call Graph Entry: ${targetFnName}`,
            description: `Function invoked with bound parameters. Call stack initialized.`,
            line: fnStartLine,
            column: 0,
            endLine: fnStartLine,
            codeSnippet: fnSnippet,
            callStack: [targetFnName],
            variables: { ...currentScope },
            activeMocks: [...activeMocks],
            educationalGuidance: {
                stepTitle: `Call Graph Entry: ${targetFnName}`,
                category: testCategory,
                categoryExplanation: "Call Graph Entry represents the entry point of execution into the unit under test.",
                stepNarrative: `Entering ${targetFnName} with bound arguments: ${Object.keys(currentScope).filter(k => k !== "NODE_ENV").join(", ")}.`,
                logicRationale: "Public functions represent the contract boundary of the module.",
                developerTakeaway: "Validate parameter contracts at the boundary to fail fast on invalid arguments."
            }
        });
    }

    // STEP 3: EVAL_PARAMS (Phase 3)
    const paramEvalLine = Math.min(fnStartLine + 1, fnEndLine);
    executedLines.add(paramEvalLine);
    const paramSnippet = (sourceCodeLines[paramEvalLine - 1] || "").trim() || `${targetFnName} parameter bindings`;

    steps.push({
        stepIndex: stepIndexCounter++,
        stepNumber: steps.length + 1,
        phase: "EVAL_PARAMS",
        stepType: "EVAL_PARAMS",
        title: "Parameter & Scope Evaluation",
        description: `Bound function arguments evaluated against boundary conditions and default parameters.`,
        line: paramEvalLine,
        column: 0,
        endLine: paramEvalLine,
        codeSnippet: paramSnippet,
        callStack: callPath,
        variables: { ...currentScope },
        activeMocks: [...activeMocks],
        educationalGuidance: {
            stepTitle: "Parameter & Scope Evaluation",
            category: testCategory,
            categoryExplanation: "Evaluating arguments for default fallbacks and boundary limits.",
            stepNarrative: `In-scope parameters: ${JSON.stringify(currentScope)}.`,
            logicRationale: "Defensive functions validate parameters early to prevent unhandled runtime exceptions downstream.",
            developerTakeaway: "Author tests targeting boundary values (0, -1, empty collections) to verify fallback robustness."
        }
    });

    // Execute symbolic statement-by-statement executor
    const simResult = simulateFunctionExecution({
        fnNode,
        initialScope: currentScope,
        sourceCodeLines,
        activeMocks,
        sourceAst
    });

    currentScope = simResult.scope;
    simResult.executedLines.forEach(l => executedLines.add(l));
    simResult.branchesToggled.forEach(b => branchesToggled.push(b));

    // Emit steps for execution events (Branch Decisions and Mock Interactions)
    for (const ev of simResult.executionEvents) {
        if (ev.type === "BRANCH_DECISION") {
            steps.push({
                stepIndex: stepIndexCounter++,
                stepNumber: steps.length + 1,
                phase: "BRANCH_DECISION",
                stepType: "BRANCH_DECISION",
                title: `Branch Decision: [${ev.branchTaken}] ${ev.condition || "Conditional Evaluation"}`,
                description: `Evaluating conditional expression '${ev.condition}': evaluated to ${ev.evaluatedTo}.`,
                line: ev.line,
                column: 0,
                endLine: ev.line,
                codeSnippet: ev.snippet,
                callStack: callPath,
                variables: { ...currentScope },
                activeMocks: [...activeMocks],
                branchEvaluation: {
                    condition: ev.condition,
                    evaluatedTo: ev.evaluatedTo,
                    branchTaken: ev.branchTaken,
                    explanation: ev.explanation
                },
                branch: {
                    type: "if",
                    conditionText: ev.condition,
                    evaluatedTo: ev.evaluatedTo,
                    consequentLine: ev.consequentLine || ev.line,
                    alternateLine: ev.alternateLine || ev.line + 1,
                    reason: ev.explanation
                },
                educationalGuidance: {
                    stepTitle: `Branch Decision: [${ev.branchTaken}] Path Taken`,
                    category: "BRANCH_TOGGLING",
                    categoryExplanation: "Category C Branch Toggling: Verifying isolated execution of truthy vs falsy/nullish branches.",
                    stepNarrative: `Condition evaluated to ${ev.evaluatedTo}. Execution takes the ${ev.branchTaken} branch.`,
                    logicRationale: "Testing both sides of every decision point is required to achieve 100% branch coverage.",
                    developerTakeaway: "Write separate test cases for True and False outcomes of compound conditions."
                }
            });
        } else if (ev.type === "MOCK_INTERACTION") {
            steps.push({
                stepIndex: stepIndexCounter++,
                stepNumber: steps.length + 1,
                phase: "MOCK_INTERACTION",
                stepType: "MOCK_INTERACTION",
                title: "Universal RAM Mock Resolution",
                description: "Intercepted downstream I/O call. Mock response delivered hermetically in RAM.",
                line: ev.line,
                column: 0,
                endLine: ev.line,
                codeSnippet: ev.snippet,
                callStack: callPath,
                variables: { ...currentScope },
                activeMocks: [...activeMocks],
                educationalGuidance: {
                    stepTitle: "Universal RAM Mock Resolution",
                    category: testCategory,
                    categoryExplanation: "Downstream I/O isolation returns deterministic data in RAM.",
                    stepNarrative: "Mock returned simulated payload without database or network I/O.",
                    logicRationale: "Isolating downstream services hermetically in RAM ensures tests fail ONLY when the unit's own logic fails.",
                    developerTakeaway: "Configure mocks to return realistic schema structures matching downstream API contracts."
                }
            });
        }
    }

    // If source code had mock calls (Prisma/Axios) and none were emitted yet, check if we need to emit mock resolution
    const hasDbCall = sourceCode.includes("prisma.") || sourceCode.includes("axios.") || sourceCode.includes("Queue");
    const hasMockStep = steps.some(s => s.phase === "MOCK_INTERACTION");
    if (hasDbCall && !hasMockStep && !simResult.thrownError) {
        const mockLine = Math.min(fnStartLine + 3, fnEndLine);
        executedLines.add(mockLine);
        const mockCallSnippet = (sourceCodeLines[mockLine - 1] || "await prisma.user.findUnique({ where: { id } });").trim();
        const simulatedReturn = { id: "mock_res_1", status: "COMPLETED", data: { verified: true } };
        if (activeMocks[0]) {
            activeMocks[0].method = "findUnique";
            activeMocks[0].returned = simulatedReturn;
            activeMocks[0].status = "RESOLVED";
        }
        steps.push({
            stepIndex: stepIndexCounter++,
            stepNumber: steps.length + 1,
            phase: "MOCK_INTERACTION",
            stepType: "MOCK_INTERACTION",
            title: "Universal RAM Mock Resolution",
            description: "Intercepted downstream I/O call. Mock response delivered hermetically in RAM.",
            line: mockLine,
            column: 0,
            endLine: mockLine,
            codeSnippet: mockCallSnippet,
            callStack: callPath,
            variables: { ...currentScope },
            activeMocks: [...activeMocks],
            educationalGuidance: {
                stepTitle: "Universal RAM Mock Resolution",
                category: testCategory,
                categoryExplanation: "Downstream I/O isolation returns deterministic data in RAM.",
                stepNarrative: "Mock returned simulated payload without database or network I/O.",
                logicRationale: "Isolating downstream services hermetically in RAM ensures tests fail ONLY when the unit's own logic fails.",
                developerTakeaway: "Configure mocks to return realistic schema structures matching downstream API contracts."
            }
        });
    }

    // STEP 6: RETURN_VALUE / STATE_TRANSITION (Phase 6)
    const returnLine = simResult.returnLine;
    executedLines.add(returnLine);
    const returnSnippet = simResult.returnSnippet;

    if (simResult.thrownError) {
        // Feature F6: Pedagogical ERROR_THROW node
        steps.push({
            stepIndex: stepIndexCounter++,
            stepNumber: steps.length + 1,
            phase: "ERROR_THROW",
            stepType: "ERROR_THROW",
            title: "Exception Thrown (Guard Clause)",
            description: `Execution halted early: ${simResult.thrownError}.`,
            line: returnLine,
            column: 0,
            endLine: returnLine,
            codeSnippet: returnSnippet,
            callStack: callPath,
            variables: { ...currentScope, thrownException: simResult.thrownError },
            activeMocks: [...activeMocks],
            educationalGuidance: {
                stepTitle: "Exception Thrown (Fail-Fast Guard)",
                category: "ERROR_HANDLING",
                categoryExplanation: "Category D Error Handling: Guard clauses prevent corrupted state by throwing early.",
                stepNarrative: `Function threw '${simResult.thrownError}' as designed.`,
                logicRationale: "Early exception throws guard against null-pointer errors and invalid downstream mutations.",
                developerTakeaway: "Assert on the exact exception message using .toThrow() or .rejects."
            }
        });

        // Backward-compatible RETURN_VALUE / Exception State step
        steps.push({
            stepIndex: stepIndexCounter++,
            stepNumber: steps.length + 1,
            phase: "RETURN_VALUE",
            stepType: "RETURN_VALUE",
            title: "Exception Thrown (Guard Clause)",
            description: `Execution halted early: ${simResult.thrownError}.`,
            line: returnLine,
            column: 0,
            endLine: returnLine,
            codeSnippet: returnSnippet,
            callStack: callPath,
            variables: { ...currentScope, thrownException: simResult.thrownError },
            activeMocks: [...activeMocks],
            educationalGuidance: {
                stepTitle: "Exception Thrown (Fail-Fast Guard)",
                category: "ERROR_HANDLING",
                categoryExplanation: "Category D Error Handling: Guard clauses prevent corrupted state by throwing early.",
                stepNarrative: `Function threw '${simResult.thrownError}' as designed.`,
                logicRationale: "Early exception throws guard against null-pointer errors and invalid downstream mutations.",
                developerTakeaway: "Assert on the exact exception message using .toThrow() or .rejects."
            }
        });
    } else {
        steps.push({
            stepIndex: stepIndexCounter++,
            stepNumber: steps.length + 1,
            phase: "RETURN_VALUE",
            stepType: "RETURN_VALUE",
            title: "Deterministic Return Value",
            description: `Function successfully evaluated and returned: ${JSON.stringify(simResult.returnValue)}.`,
            line: returnLine,
            column: 0,
            endLine: returnLine,
            codeSnippet: returnSnippet,
            callStack: callPath,
            variables: { ...currentScope },
            activeMocks: [...activeMocks],
            educationalGuidance: {
                stepTitle: "Deterministic Return Value",
                category: testCategory,
                categoryExplanation: "Verifying output value against computed state.",
                stepNarrative: `Returned value ${JSON.stringify(simResult.returnValue)} reflects valid business calculations.`,
                logicRationale: "Functional purity dictates that given identical inputs, the function returns identical outputs.",
                developerTakeaway: "Calculate expected numeric outputs manually or via fixed constants in test assertions."
            }
        });
    }

    // STEP 7: ASSERTION (Phase 7)
    let matcher = "toBe";
    let expectedVal = simResult.returnValue;
    let actualVal = simResult.returnValue;

    if (simResult.thrownError) {
        matcher = "toThrow";
        expectedVal = simResult.thrownError;
        actualVal = simResult.thrownError;
    }

    if (testExecutionData?.assertion) {
        matcher = testExecutionData.assertion.matcher || matcher;
        if (testExecutionData.assertion.expected !== undefined) {
            expectedVal = testExecutionData.assertion.expected;
        }

        // Return object property assertion matching (e.g. expect(res.total).toBe(115))
        if (testExecutionData.assertion.propertyPath && simResult.returnValue && typeof simResult.returnValue === "object") {
            const parts = testExecutionData.assertion.propertyPath.split(".");
            let resolved = simResult.returnValue;
            for (const p of parts) {
                if (resolved !== null && resolved !== undefined && typeof resolved === "object" && p in resolved) {
                    resolved = resolved[p];
                } else {
                    resolved = undefined;
                    break;
                }
            }
            if (resolved !== undefined) {
                actualVal = resolved;
            }
        } else if (testExecutionData.assertion.actualNode) {
            const evalScope = {
                [testExecutionData.targetResultVarName || "res"]: simResult.returnValue,
                result: simResult.returnValue,
                res: simResult.returnValue,
                returnValue: simResult.returnValue,
                ...(testExecutionData.testScope || {})
            };
            const evaluatedActual = evaluateAstExpression(testExecutionData.assertion.actualNode, evalScope);
            if (evaluatedActual !== undefined) {
                actualVal = evaluatedActual;
            }
        }
    }

    let passed = false;
    if (matcher === "toThrow" || matcher === "rejects.toThrow") {
        passed = expectedVal ? String(actualVal).includes(String(expectedVal)) : Boolean(actualVal);
    } else {
        passed = (expectedVal === actualVal) || (JSON.stringify(expectedVal) === JSON.stringify(actualVal));
    }

    let assertionSnippet = testExecutionData?.assertion?.snippet;
    if (!assertionSnippet) {
        assertionSnippet = simResult.thrownError
            ? `expect(() => ${targetFnName}(...)).toThrow('${expectedVal}');`
            : `expect(result).${matcher}(${JSON.stringify(expectedVal)});`;
    }

    steps.push({
        stepIndex: stepIndexCounter++,
        stepNumber: steps.length + 1,
        phase: "ASSERTION",
        stepType: "ASSERTION",
        title: `Assertion Verification: .${matcher}()`,
        description: `Verified actual outcome against expected contract: ${passed ? "PASSED" : "FAILED"}.`,
        line: testExecutionData?.assertion?.line || selectedTestCase.line || 10,
        column: 0,
        endLine: testExecutionData?.assertion?.line || selectedTestCase.line || 10,
        codeSnippet: assertionSnippet,
        callStack: ["<test_runner>"],
        variables: { expected: expectedVal, actual: actualVal },
        activeMocks: [...activeMocks],
        assertionResult: {
            matcher,
            expected: expectedVal,
            actual: actualVal,
            passed
        },
        assertion: {
            matcher,
            expected: expectedVal,
            actual: actualVal,
            passed
        },
        educationalGuidance: {
            stepTitle: `Assertion Check: .${matcher}()`,
            category: testCategory,
            categoryExplanation: "Category Assertion: Validating received outcome against specified expected behavior.",
            stepNarrative: `Assertion verified: received ${JSON.stringify(actualVal)} satisfies expected ${JSON.stringify(expectedVal)}. Result: ${passed ? "PASSED" : "FAILED"}.`,
            logicRationale: "Assertions form the contract specification that prevents future regression bugs.",
            developerTakeaway: "Use strict equality .toBe() for primitives, and .toEqual() for deep object comparison."
        }
    });

    // 7. Assemble Summary & Response
    const summary = {
        totalSteps: steps.length,
        branchesToggled,
        toggledBranches: branchesToggled,
        assertionsCount: 1,
        allAssertionsPassed: passed,
        outcome: passed ? "PASSED" : "FAILED",
        executedLines: Array.from(executedLines).sort((a, b) => a - b),
        durationMs: Number((Math.max(0.8, steps.length * 0.3)).toFixed(1))
    };

    return {
        id: `sim_${targetFnName}_${testCategory.toLowerCase()}`,
        sourceFilePath: sourceFilePath || "source.js",
        sourceCode,
        testFilePath: actualTestFilePath,
        testCode,
        isVirtualScenario,
        testCase: {
            id: selectedTestCase.id || "TC-01",
            title: selectedTestCase.title,
            category: testCategory,
            categoryName: CATEGORY_NAMES[testCategory] || testCategory,
            targetFunction: targetFnName,
            isVirtual: isVirtualScenario
        },
        scenarioMeta: {
            id: selectedTestCase.id || "TC-01",
            title: selectedTestCase.title,
            category: testCategory,
            categoryName: CATEGORY_NAMES[testCategory] || testCategory,
            targetFunction: targetFnName,
            callPath
        },
        summary,
        initialMocks,
        steps
    };
};
