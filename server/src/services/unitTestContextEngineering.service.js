import fs from "fs";
import path from "path";
import { parseJavaScriptCode } from "./babelParser.service.js";
import { extractEnvReferencesFromAst, inferMockValue } from "./environmentDetection.service.js";
import { analyzeSourceAst, mapCoverageGaps } from "./businessLogicAstAnalyzer.service.js";
import { isLocContained, isLocOverlapping } from "./unreachableCodeDetector.service.js";
import { NODE_BUILTINS, isValidNpmPackageName } from "./dependencyResolution.service.js";

/**
 * STAGE 2: CONTEXT ENGINEERING & DECISION TABLE TEST MATRIX
 *
 * Provides formal software engineering test methodology:
 * 2.0. AST Existing Test Inspector (extracts suites, titles, assertions, covered categories)
 * 2.1. Decision Table / Truth Table Engine - 4 Mandatory Categories & Delta Matrix
 * 2.2. Indirect Testing Strategy for Internal Helpers (AST Call Graph Backtracking)
 * 2.3. Isolation Mock Contracts: DB (Prisma, Mongoose, Sequelize), HTTP, Queue, Redis, Env, Express
 */

/**
 * 2.0 AST EXISTING TEST INSPECTION
 *
 * Parses existing test files on disk via Babel AST to extract:
 * - Test suites (`describe`), test cases (`it`, `test`, `xit`, `xtest`, etc.)
 * - Test titles and descriptions
 * - Assertion types (`expect(...).toBe`, `.toEqual`, `.toThrow`, `.rejects`, etc.)
 * - Tested functions called within each test
 * - Classification into Categories A, B, C, D
 *
 * @param {string} testCode - Existing test code string
 * @param {string} [filePath] - Optional test file path
 * @returns {object} { suites: string[], tests: Array, testedFunctions: string[], coveredCategories: object, totalTests: number, skippedTests: number }
 */
export const parseExistingTestAst = (testCode = "", filePath = "") => {
    const suites = [];
    const tests = [];
    const testedFunctions = new Set();
    const coveredCategories = {
        HAPPY_PATH: 0,
        BOUNDARY_VALUES: 0,
        BRANCH_TOGGLING: 0,
        ERROR_HANDLING: 0
    };

    if (!testCode || typeof testCode !== "string" || !testCode.trim()) {
        return {
            suites,
            tests,
            testedFunctions: [],
            coveredCategories,
            totalTests: 0,
            skippedTests: 0
        };
    }

    const classifyTitleCategory = (title, assertionTypes = [], callArgs = []) => {
        const lower = (title || "").toLowerCase();
        // 1. Explicit tags take highest precedence
        if (lower.includes("[category d") || lower.includes("tc-err")) return "ERROR_HANDLING";
        if (lower.includes("[category c") || lower.includes("tc-branch")) return "BRANCH_TOGGLING";
        if (lower.includes("[category b") || lower.includes("tc-bound")) return "BOUNDARY_VALUES";
        if (lower.includes("[category a") || lower.includes("tc-happy")) return "HAPPY_PATH";

        // 2. Assertions
        if (assertionTypes.some(a => ["toThrow", "toThrowError", "rejects"].includes(a))) return "ERROR_HANDLING";

        // 3. Keywords in title
        if (/error|throw|throws|exception|reject|rejects|catch|fail|invalid|400|500/i.test(lower)) return "ERROR_HANDLING";
        if (/branch|toggle|condition|if|else|switch|case|fallback|default|optional|ternary|\?\?|\|\||\?\.|\btrue\b|\bfalse\b/i.test(lower) || lower.includes("[true]") || lower.includes("[false]")) return "BRANCH_TOGGLING";
        if (/bound|boundary|extreme|limits|empty|zero|\b0\b|-1|negative|\[\]|\{\}/i.test(lower)) return "BOUNDARY_VALUES";

        // 4. Call args (boundary inputs)
        if (callArgs.some(arg => ["0", "-1", "null", "undefined", "[]", "{}"].includes(arg))) return "BOUNDARY_VALUES";

        return "HAPPY_PATH";
    };

    const parseRes = parseJavaScriptCode(testCode);

    if (parseRes.success && parseRes.ast) {
        const suiteStack = [];
        const skippedSuiteStack = [];

        const extractStringVal = (node) => {
            if (!node) return "";
            if (node.type === "StringLiteral") return node.value;
            if (node.type === "TemplateLiteral") {
                return (node.quasis || []).map(q => q.value?.raw || "").join("${...}");
            }
            return "";
        };

        const walk = (node) => {
            if (!node || typeof node !== "object") return;

            if (node.type === "CallExpression") {
                let calleeName = "";
                let isDescribe = false;
                let isTest = false;
                let isSkipped = false;

                if (node.callee?.type === "Identifier") {
                    calleeName = node.callee.name;
                    if (["describe","xdescribe"].includes(calleeName)) isDescribe = true;
                    if (calleeName === 'xdescribe') isSkipped = true;
                    if (["it", "test"].includes(calleeName)) isTest = true;
                    if (["xit", "xtest"].includes(calleeName)) {
                        isTest = true;
                        isSkipped = true;
                    }
                } else if (node.callee?.type === "MemberExpression") {
                    const objName = node.callee.object?.name;
                    const propName = node.callee.property?.name;
                    if (objName === "describe") {
                        isDescribe = true;
                        if (['skip','todo'].includes(propName)) isSkipped = true;
                    }
                    if (["it", "test"].includes(objName)) {
                        isTest = true;
                        if (['skip','todo'].includes(propName)) isSkipped = true;
                    }
                }

                if (isDescribe) {
                    const title = extractStringVal(node.arguments?.[0]) || "describe";
                    suiteStack.push(title);
                    skippedSuiteStack.push(isSkipped);
                    if (!suites.includes(title)) suites.push(title);

                    const callback = node.arguments?.[1];
                    if (callback) {
                        walk(callback);
                    }
                    suiteStack.pop();
                    skippedSuiteStack.pop();
                    return;
                }

                if (isTest) {
                    isSkipped = isSkipped || skippedSuiteStack.some(Boolean);
                    const title = extractStringVal(node.arguments?.[0]) || "test";
                    const fullTitle = [...suiteStack, title].join(" > ");
                    const assertionTypes = [];
                    const calledFns = new Set();
                    const callArgs = [];

                    const testCallback = node.arguments?.[1];
                    if (testCallback) {
                        const walkBody = (child) => {
                            if (!child || typeof child !== "object") return;

                            if (child.type === "CallExpression") {
                                if (child.callee?.type === "MemberExpression") {
                                    const prop = child.callee.property?.name;
                                    if (prop) assertionTypes.push(prop);

                                    const innerObj = child.callee.object;
                                    if (innerObj?.type === "MemberExpression" && ["rejects", "resolves"].includes(innerObj.property?.name)) {
                                        assertionTypes.push(innerObj.property.name);
                                    }
                                }

                                if (child.callee?.type === "Identifier" && !["expect", "beforeEach", "afterEach", "beforeAll", "afterAll", "it", "test", "describe"].includes(child.callee.name)) {
                                    calledFns.add(child.callee.name);
                                } else if (child.callee?.type === "MemberExpression" && child.callee.property?.name && !["fn", "spyOn", "mock", "expect"].includes(child.callee.property.name)) {
                                    calledFns.add(child.callee.property.name);
                                }

                                for (const arg of child.arguments || []) {
                                    if (arg.type === "NumericLiteral") callArgs.push(String(arg.value));
                                    if (arg.type === "NullLiteral") callArgs.push("null");
                                    if (arg.type === "Identifier" && arg.name === "undefined") callArgs.push("undefined");
                                    if (arg.type === "ArrayExpression" && arg.elements.length === 0) callArgs.push("[]");
                                    if (arg.type === "ObjectExpression" && arg.properties.length === 0) callArgs.push("{}");
                                }
                            }

                            for (const key of Object.keys(child)) {
                                if (["loc", "comments", "leadingComments", "trailingComments"].includes(key)) continue;
                                const val = child[key];
                                if (Array.isArray(val)) {
                                    for (const c of val) walkBody(c);
                                } else if (val && typeof val === "object") {
                                    walkBody(val);
                                }
                            }
                        };
                        walkBody(testCallback);
                    }

                    for (const fn of calledFns) testedFunctions.add(fn);

                    let targetFunction = Array.from(calledFns)[0] || "";
                    if (!targetFunction) {
                        for (const s of suiteStack) {
                            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s)) {
                                targetFunction = s;
                                break;
                            }
                        }
                    }

                    const category = classifyTitleCategory(title, assertionTypes, callArgs);
                    if (!isSkipped) {
                        coveredCategories[category] = (coveredCategories[category] || 0) + 1;
                    }

                    tests.push({
                        title,
                        fullTitle,
                        runnerTitle: [...suiteStack,title].join(' '),
                        suite: suiteStack.join(" > "),
                        category,
                        assertionTypes: Array.from(new Set(assertionTypes)),
                        calledFunctions: Array.from(calledFns),
                        targetFunction,
                        isSkipped,
                        line: node.loc?.start?.line || 1
                    });
                    return;
                }
            }

            for (const key of Object.keys(node)) {
                if (["loc", "comments", "leadingComments", "trailingComments"].includes(key)) continue;
                const child = node[key];
                if (Array.isArray(child)) {
                    for (const c of child) walk(c);
                } else if (child && typeof child === "object") {
                    walk(child);
                }
            }
        };

        walk(parseRes.ast);
    } else {
        // Resilient regex fallback if AST parsing fails
        const testMatches = [...testCode.matchAll(/(?:test|it|xit|xtest)(?:\.only|\.skip)?\s*\(\s*(['"`])([^'"`]+)\1/g)];
        for (const m of testMatches) {
            const isSkipped = m[0].includes(".skip") || m[0].startsWith("xit") || m[0].startsWith("xtest");
            const title = m[2];
            const category = classifyTitleCategory(title);
            if (!isSkipped) {
                coveredCategories[category] = (coveredCategories[category] || 0) + 1;
            }
            tests.push({
                title,
                fullTitle: title,
                suite: "",
                category,
                assertionTypes: [],
                calledFunctions: [],
                targetFunction: "",
                isSkipped,
                line: 1
            });
        }
    }

    return {
        suites,
        tests,
        testedFunctions: Array.from(testedFunctions),
        coveredCategories,
        totalTests: tests.length,
        skippedTests: tests.filter(t => t.isSkipped).length
    };
};

/**
 * Normalizes string values for markdown table cells by replacing newlines with spaces and escaping pipe characters.
 * @param {*} val
 * @returns {string}
 */
export const sanitizeTableCell = (val) => {
    if (val == null) return "";
    return String(val)
        .replace(/\r?\n+/g, " ")
        .replace(/\|/g, "\\|")
        .trim();
};

/**
 * 2.1 DECISION TABLE / TRUTH TABLE ENGINE
 *
 * Generates an exhaustive 4-category test matrix targeting >=90% to 100% coverage:
 * - Category A: Happy Path (Standard valid input, expected output)
 * - Category B: Boundary Value Analysis (0, negative, MAX_SAFE_INTEGER, [], "", {}, length extremes)
 * - Category C: Equivalence Partitioning & Branch Toggling (True vs False, null, undefined, ??, ||, ?.)
 * - Category D: Error & Exception Handling (throw, catch, rejected promise, invalid schema)
 *
 * Compares against existing test code to output a prioritized Delta Decision Table
 * excluding already-tested scenarios and verified infeasible branches.
 *
 * @param {object} params
 * @param {object} params.astMetadata - Metadata from analyzeSourceAst
 * @param {object} params.coverageGaps - Gap report from mapCoverageGaps
 * @param {string} params.sourceCode - Raw source code string
 * @param {string} [params.existingTestCode] - Existing test file content on disk
 * @param {string} [params.filePath] - Target file path
 * @returns {object} { matrixEntries, decisionTable, deltaDecisionTable, infeasibleSummaries, decisionTableMarkdown, deltaDecisionTableMarkdown, summary }
 */
/**
 * Synthesizes a valid multi-element collection fixture (>= 2 items)
 * for functions accepting arrays or collections.
 */
export const synthesizeCollectionFixture = (paramName = "", paramContract = null, sourceCode = "") => {
    const safeParam = String(paramName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isCollection = Boolean(
        paramContract?.kind === "array" ||
        paramContract?.element ||
        /history|items|list|rows|records|turns|messages|data|collection|entries|elements|tokens/i.test(paramName) ||
        (sourceCode && new RegExp(`Array\\.isArray\\(\\s*${safeParam}\\s*\\)|for\\s*\\(\\s*(?:const|let|var)\\s+\\w+\\s+of\\s+${safeParam}\\s*\\)|${safeParam}\\.map\\(|${safeParam}\\.filter\\(|${safeParam}\\.length`, "i").test(sourceCode))
    );

    if (!isCollection) return null;

    // Chat history / turn sequence specialization
    if (/history|turn|message|dialogue/i.test(paramName) || /role|assistant|user|model/i.test(sourceCode)) {
        return [
            { role: "user", content: "Hello assistant", text: "Hello assistant" },
            { role: "model", content: "Hello! How can I help you today?", text: "Hello! How can I help you today?" }
        ];
    }

    // Generic collection with inferred element fields or standard properties
    if (paramContract?.element?.fields) {
        const fields = paramContract.element.fields;
        const item1 = {};
        const item2 = {};
        for (const [key, prop] of Object.entries(fields)) {
            item1[key] = prop.kind === "number" ? 100 : (prop.kind === "boolean" ? true : `sample_${key}_1`);
            item2[key] = prop.kind === "number" ? 200 : (prop.kind === "boolean" ? false : `sample_${key}_2`);
        }
        return [item1, item2];
    }

    // Default 2-item valid collection
    return [
        { id: 1, name: "Item Alpha", status: "active", value: 100 },
        { id: 2, name: "Item Beta", status: "pending", value: 200 }
    ];
};

export const buildDecisionTableMatrix = ({
    astMetadata = null,
    coverageGaps = null,
    sourceCode = "",
    existingTestCode = "",
    filePath = ""
}) => {
    const matrixEntries = [];
    const exportedSymbols = astMetadata?.exportedSymbols || [];
    const internalFunctions = astMetadata?.internalFunctions || [];
    const decisionPoints = astMetadata?.decisionPoints || [];
    const exceptionPoints = astMetadata?.exceptionPoints || [];

    const uncoveredLinesSet = new Set((coverageGaps?.uncoveredLines || []).map(Number));
    const uncoveredBranches = coverageGaps?.uncoveredBranches || [];
    const uncoveredFunctions = coverageGaps?.uncoveredFunctions || [];
    const infeasibleCodeBlocks = coverageGaps?.infeasibleCodeBlocks || astMetadata?.infeasibleNodes || [];
    const infeasibleSummaries = [];

    // Parse existing test file on disk
    const existingTestAnalysis = parseExistingTestAst(existingTestCode, filePath);
    const existingTests = existingTestAnalysis.tests || [];

    // Helper to identify function containing a specific line number
    const findEnclosingFunction = (targetLine) => {
        if (!targetLine || typeof targetLine !== "number") {
            return exportedSymbols[0]?.name || "mainFunction";
        }

        const allCandidates = [];

        for (const s of exportedSymbols) {
            if (s.type === "constant") continue;
            const start = s.startLine || s.loc?.start?.line || s.line;
            const end = s.endLine || s.loc?.end?.line;
            if (start) {
                allCandidates.push({ name: s.name, start, end, isExport: true });
            }
            if (Array.isArray(s.methods)) {
                for (const m of s.methods) {
                    const mStart = m.startLine || m.loc?.start?.line || m.line;
                    const mEnd = m.endLine || m.loc?.end?.line;
                    if (mStart) {
                        allCandidates.push({ name: m.name, start: mStart, end: mEnd, isExport: true });
                    }
                }
            }
        }

        for (const f of internalFunctions) {
            const start = f.startLine || f.loc?.start?.line || f.line;
            const end = f.endLine || f.loc?.end?.line;
            if (start) {
                allCandidates.push({ name: f.name, start, end, isExport: false });
            }
        }

        // 1. Look for innermost enclosing symbol where start <= targetLine <= end
        const enclosing = allCandidates.filter(c => c.start <= targetLine && (c.end ? targetLine <= c.end : true));
        if (enclosing.length > 0) {
            enclosing.sort((a, b) => {
                const spanA = a.end ? (a.end - a.start) : Infinity;
                const spanB = b.end ? (b.end - b.start) : Infinity;
                if (spanA !== spanB) return spanA - spanB;
                return b.start - a.start;
            });
            return enclosing[0].name;
        }

        // 2. Fallback: closest preceding candidate by startLine
        const preceding = allCandidates
            .filter(c => c.start <= targetLine)
            .sort((a, b) => b.start - a.start);

        if (preceding.length > 0) {
            return preceding[0].name;
        }

        return exportedSymbols[0]?.name || "mainFunction";
    };

    let counter = 1;

    // --- CATEGORY A: HAPPY PATH (Standard Valid Flow & Core Logic Path Traversal) ---
    for (const exp of exportedSymbols) {
        if (exp.type === "constant") continue;
        const isFnUncovered = uncoveredFunctions.some(uf => uf.name === exp.name);

        // Check if function parameter expects a collection
        const firstParam = (exp.params && exp.params[0]) || "input";
        const collectionFixture = synthesizeCollectionFixture(firstParam, null, sourceCode);
        const fixtureStr = collectionFixture ? JSON.stringify(collectionFixture) : null;

        // Check if core lines (beyond initial guards) are uncovered
        const fnStart = exp.startLine || exp.line || 1;
        const fnEnd = exp.endLine || (fnStart + 30);
        const fnTotalLines = Math.max(1, fnEnd - fnStart + 1);
        const fnUncoveredLines = (coverageGaps?.uncoveredLines || []).filter(line => line >= fnStart && line <= fnEnd);
        const hasUncoveredCoreLogic = Boolean(collectionFixture && fnUncoveredLines.length >= 6 && (fnUncoveredLines.length / fnTotalLines) > 0.4);

        const hasExistingHappyTest = existingTests.some(t =>
            !t.isSkipped &&
            t.category === "HAPPY_PATH" &&
            (t.targetFunction === exp.name || (t.calledFunctions && t.calledFunctions.includes(exp.name)) || t.fullTitle.toLowerCase().includes(exp.name.toLowerCase()))
        );
        // If collection function core logic lines are overwhelmingly uncovered, existing test only hit guard clause!
        const isAlreadyTested = Boolean(hasExistingHappyTest && !hasUncoveredCoreLogic);

        const happyCondition = collectionFixture
            ? `Valid multi-element collection with complete item schema traversing past early-return guards`
            : `Standard valid arguments & expected state`;

        const happyInputScenario = collectionFixture
            ? `MANDATORY: Pass a non-empty, fully populated array with >= 2 items: ${fixtureStr}. NEVER pass [] or {}.`
            : `Provide valid payload with all standard required and optional fields`;

        const happyExpected = collectionFixture
            ? `Bypasses early-return guards and executes complete core business logic loops/transformations, returning populated result`
            : `Executes cleanly, returns expected result or resolves successful promise`;

        matrixEntries.push({
            id: `TC-HAPPY-${String(counter++).padStart(2, "0")}`,
            category: "HAPPY_PATH",
            categoryName: "A. Happy Path",
            targetFunction: exp.name,
            functionName: exp.name,
            targetLine: exp.line || 1,
            condition: happyCondition,
            scenario: happyCondition,
            inputScenario: happyInputScenario,
            expectedBehavior: happyExpected,
            isCovered: !isFnUncovered && !hasUncoveredCoreLogic,
            isAlreadyTested,
            isInfeasible: false,
            priority: isAlreadyTested ? "LOW" : ((isFnUncovered || hasUncoveredCoreLogic) ? "HIGH" : "NORMAL")
        });

        // If collection processes multi-turn/merging/filtering, add sequential Happy Path scenario
        if (collectionFixture && /merge|shift|pop|assistant|consecutive/i.test(sourceCode)) {
            const sequentialFixture = [
                { role: "model", content: "Greeting" },
                { role: "user", content: "First query" },
                { role: "assistant", content: "First answer" },
                { role: "model", content: "Continued answer" },
                { role: "user", content: "Trailing prompt" }
            ];
            matrixEntries.push({
                id: `TC-HAPPY-${String(counter++).padStart(2, "0")}`,
                category: "HAPPY_PATH",
                categoryName: "A. Happy Path",
                targetFunction: exp.name,
                functionName: exp.name,
                targetLine: exp.line || 1,
                condition: "Multi-item sequence: role conversion, consecutive turn merging, and boundary trimming",
                scenario: "Pass multi-item sequence with consecutive roles and transformable items",
                inputScenario: `Pass multi-item array: ${JSON.stringify(sequentialFixture)} to execute role conversion, merging, and trimming loops`,
                expectedBehavior: "Converts assistant to model, merges consecutive same-role turns, ensures start with user and end with model",
                isCovered: false,
                isAlreadyTested: false,
                isInfeasible: false,
                priority: "HIGH"
            });
        }

        // Deep member method iteration for classes, class-instances, and object dictionaries (Rule 8)
        const memberMethods = Array.isArray(exp.methods) && exp.methods.length > 0
            ? exp.methods
            : (Array.isArray(exp.classMembers) && exp.classMembers.length > 0 ? exp.classMembers : []);

        for (const m of memberMethods) {
            if (!m || !m.name || m.kind === "constructor" || m.name === "constructor") continue;
            const methodTarget = `${exp.name}.${m.name}`;
            const isMethodUncovered = uncoveredFunctions.some(uf => uf.name === m.name || uf.name === methodTarget);
            const hasExistingMethodHappy = existingTests.some(t =>
                !t.isSkipped &&
                t.category === "HAPPY_PATH" &&
                (t.targetFunction === methodTarget || t.targetFunction === m.name || (t.calledFunctions && (t.calledFunctions.includes(m.name) || t.calledFunctions.includes(methodTarget))) || t.fullTitle.toLowerCase().includes(m.name.toLowerCase()))
            );
            const isMethodAlreadyTested = Boolean(hasExistingMethodHappy);

            matrixEntries.push({
                id: `TC-HAPPY-${String(counter++).padStart(2, "0")}`,
                category: "HAPPY_PATH",
                categoryName: "A. Happy Path",
                targetFunction: methodTarget,
                functionName: m.name,
                targetLine: m.line || exp.line || 1,
                condition: `Standard valid execution for method ${m.name}`,
                scenario: `Standard valid execution for method ${m.name}`,
                inputScenario: `Invoke ${methodTarget} with valid arguments and expected state`,
                expectedBehavior: "Executes cleanly, returns expected result or resolves successful promise",
                isCovered: !isMethodUncovered,
                isAlreadyTested: isMethodAlreadyTested,
                isInfeasible: false,
                priority: isMethodAlreadyTested ? "LOW" : (isMethodUncovered ? "HIGH" : "NORMAL")
            });
        }
    }

    if (matrixEntries.length === 0) {
        const defaultFn = exportedSymbols[0]?.name || "defaultExport";
        const hasExistingHappyTest = existingTests.some(t => !t.isSkipped && t.category === "HAPPY_PATH");
        matrixEntries.push({
            id: `TC-HAPPY-${String(counter++).padStart(2, "0")}`,
            category: "HAPPY_PATH",
            categoryName: "A. Happy Path",
            targetFunction: defaultFn,
            functionName: defaultFn,
            targetLine: 1,
            condition: "Valid execution flow",
            scenario: "Valid execution flow",
            inputScenario: "Standard valid inputs",
            expectedBehavior: "Expected successful return or side effect",
            isCovered: false,
            isAlreadyTested: Boolean(hasExistingHappyTest),
            isInfeasible: false,
            priority: hasExistingHappyTest ? "LOW" : "HIGH"
        });
    }

    // --- CATEGORY B: BOUNDARY VALUE ANALYSIS ---
    for (const exp of exportedSymbols) {
        if (exp.type === "constant") continue;

        // Boundary B1: Zero, negative number, max safe integer
        const hasExistingB1 = existingTests.some(t =>
            !t.isSkipped &&
            t.category === "BOUNDARY_VALUES" &&
            (t.targetFunction === exp.name || (t.calledFunctions && t.calledFunctions.includes(exp.name)) || t.fullTitle.toLowerCase().includes(exp.name.toLowerCase())) &&
            (/0|-1|negative|max|limit|numeric/i.test(t.title) || !/empty|\[\]|\{\}|string/i.test(t.title))
        );
        matrixEntries.push({
            id: `TC-BOUND-${String(counter++).padStart(2, "0")}`,
            category: "BOUNDARY_VALUES",
            categoryName: "B. Boundary Values",
            targetFunction: exp.name,
            functionName: exp.name,
            targetLine: exp.line || 1,
            condition: "Numerical limits: 0, negative (-1), and max limits",
            scenario: "Numerical limits: 0, negative (-1), and max limits",
            inputScenario: "Pass numeric fields with 0, -1, or Number.MAX_SAFE_INTEGER",
            expectedBehavior: "Validates bounds or triggers boundary fallback gracefully",
            isCovered: false,
            isAlreadyTested: Boolean(hasExistingB1),
            isInfeasible: false,
            priority: hasExistingB1 ? "LOW" : "HIGH"
        });

        // Boundary B2: Empty collections and strings
        const hasExistingB2 = existingTests.some(t =>
            !t.isSkipped &&
            t.category === "BOUNDARY_VALUES" &&
            (t.targetFunction === exp.name || (t.calledFunctions && t.calledFunctions.includes(exp.name)) || t.fullTitle.toLowerCase().includes(exp.name.toLowerCase())) &&
            /empty|\[\]|\{\}|string/i.test(t.title)
        );
        matrixEntries.push({
            id: `TC-BOUND-${String(counter++).padStart(2, "0")}`,
            category: "BOUNDARY_VALUES",
            categoryName: "B. Boundary Values",
            targetFunction: exp.name,
            functionName: exp.name,
            targetLine: exp.line || 1,
            condition: "Empty collections & empty string: [], \"\", {}",
            scenario: "Empty collections & empty string: [], \"\", {}",
            inputScenario: "Pass empty array [], empty string \"\", or empty object {} to verify early-return boundary guard handles empty state without throw. (DO NOT use empty collection for Category A or for testing downstream branches!)",
            expectedBehavior: "Handles empty inputs without throwing unhandled TypeError/crash",
            isCovered: false,
            isAlreadyTested: Boolean(hasExistingB2),
            isInfeasible: false,
            priority: hasExistingB2 ? "LOW" : "HIGH"
        });

        // Deep member method iteration for classes, class-instances, and object dictionaries (Rule 8)
        const memberMethods = Array.isArray(exp.methods) && exp.methods.length > 0
            ? exp.methods
            : (Array.isArray(exp.classMembers) && exp.classMembers.length > 0 ? exp.classMembers : []);

        for (const m of memberMethods) {
            if (!m || !m.name || m.kind === "constructor" || m.name === "constructor") continue;
            const methodTarget = `${exp.name}.${m.name}`;

            const hasExistingMB1 = existingTests.some(t =>
                !t.isSkipped &&
                t.category === "BOUNDARY_VALUES" &&
                (t.targetFunction === methodTarget || t.targetFunction === m.name || (t.calledFunctions && (t.calledFunctions.includes(m.name) || t.calledFunctions.includes(methodTarget))) || t.fullTitle.toLowerCase().includes(m.name.toLowerCase())) &&
                (/0|-1|negative|max|limit|numeric/i.test(t.title) || !/empty|\[\]|\{\}|string/i.test(t.title))
            );
            matrixEntries.push({
                id: `TC-BOUND-${String(counter++).padStart(2, "0")}`,
                category: "BOUNDARY_VALUES",
                categoryName: "B. Boundary Values",
                targetFunction: methodTarget,
                functionName: m.name,
                targetLine: m.line || exp.line || 1,
                condition: `Numerical limits for ${m.name}: 0, negative (-1), and max limits`,
                scenario: `Numerical limits for ${m.name}: 0, negative (-1), and max limits`,
                inputScenario: `Pass numeric fields with 0, -1, or Number.MAX_SAFE_INTEGER to ${methodTarget}`,
                expectedBehavior: "Validates bounds or triggers boundary fallback gracefully",
                isCovered: false,
                isAlreadyTested: Boolean(hasExistingMB1),
                isInfeasible: false,
                priority: hasExistingMB1 ? "LOW" : "HIGH"
            });

            const hasExistingMB2 = existingTests.some(t =>
                !t.isSkipped &&
                t.category === "BOUNDARY_VALUES" &&
                (t.targetFunction === methodTarget || t.targetFunction === m.name || (t.calledFunctions && (t.calledFunctions.includes(m.name) || t.calledFunctions.includes(methodTarget))) || t.fullTitle.toLowerCase().includes(m.name.toLowerCase())) &&
                /empty|\[\]|\{\}|string/i.test(t.title)
            );
            matrixEntries.push({
                id: `TC-BOUND-${String(counter++).padStart(2, "0")}`,
                category: "BOUNDARY_VALUES",
                categoryName: "B. Boundary Values",
                targetFunction: methodTarget,
                functionName: m.name,
                targetLine: m.line || exp.line || 1,
                condition: `Empty collections & empty string for ${m.name}: [], "", {}`,
                scenario: `Empty collections & empty string for ${m.name}: [], "", {}`,
                inputScenario: `Pass empty array [], empty string "", or empty object {} to ${methodTarget}`,
                expectedBehavior: "Handles empty inputs without throwing unhandled TypeError/crash",
                isCovered: false,
                isAlreadyTested: Boolean(hasExistingMB2),
                isInfeasible: false,
                priority: hasExistingMB2 ? "LOW" : "HIGH"
            });
        }
    }

    // --- CATEGORY C: EQUIVALENCE PARTITIONING & BRANCH TOGGLING (True/False, ??, ||, ?.) ---
    for (const dp of decisionPoints) {
        const isUncovered = uncoveredLinesSet.has(dp.line);
        const matchedBranch = uncoveredBranches.find(ub => {
            if (dp.loc && ub.loc) {
                return isLocOverlapping(dp.loc, ub.loc) || isLocContained(dp.loc, ub.loc) || isLocContained(ub.loc, dp.loc);
            }
            return Math.abs(ub.line - dp.line) <= 1;
        });
        const matchedInfeasible = infeasibleCodeBlocks.find(inf => {
            if (dp.loc && inf.loc) {
                return isLocOverlapping(dp.loc, inf.loc) || isLocContained(dp.loc, inf.loc) || isLocContained(inf.loc, dp.loc);
            }
            return inf.line === dp.line;
        });
        const targetFn = findEnclosingFunction(dp.line);

        if (dp.type === "if" || dp.type === "ternary") {
            // Branch True
            const missedTrue = matchedBranch?.missedTrue ?? isUncovered;
            const isTrueInfeasible = Boolean(
                (matchedBranch?.isInfeasible && (matchedBranch.infeasibleMeta?.affectsBranch === "TRUE_BRANCH" || matchedBranch.infeasibleMeta?.affectsBranch === "BOTH")) ||
                (matchedInfeasible && (matchedInfeasible.affectsBranch === "TRUE_BRANCH" || matchedInfeasible.affectsBranch === "BOTH" || !matchedInfeasible.affectsBranch))
            );
            const trueJustification = isTrueInfeasible ? (matchedBranch?.infeasibleMeta?.justification || matchedInfeasible?.justification || "Unreachable environment guard or dead branch") : undefined;
            if (isTrueInfeasible && trueJustification) {
                infeasibleSummaries.push({
                    line: dp.line,
                    functionName: targetFn,
                    condition: `[TRUE] ${dp.text}`,
                    justification: trueJustification,
                    category: "BRANCH_TOGGLING"
                });
            }

            const hasExistingBranchTrue = existingTests.some(t =>
                !t.isSkipped &&
                (t.targetFunction === targetFn || (t.calledFunctions && t.calledFunctions.includes(targetFn)) || t.fullTitle.toLowerCase().includes(targetFn.toLowerCase())) &&
                (t.category === "BRANCH_TOGGLING" || t.category === "HAPPY_PATH") &&
                (t.title.includes("[TRUE]") || /true|consequent|handles|valid/i.test(t.title))
            );
            const isTrueAlreadyTested = hasExistingBranchTrue && !missedTrue;

            const matchedExp = exportedSymbols.find(e => e.name === targetFn);
            const isInternalBranch = dp.line > ((matchedExp?.startLine || matchedExp?.line || 1) + 4);
            const trueInputScenario = isInternalBranch
                ? "Provide valid outer collection/payload satisfying all preceding guards, with target item property configured so condition is truthy"
                : "Inputs satisfying condition as truthy";
            const falseInputScenario = isInternalBranch
                ? "Provide valid outer collection/payload satisfying all preceding guards, with target item property configured so condition is falsy"
                : "Inputs evaluating condition to falsy / null / undefined";

            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                functionName: targetFn,
                targetLine: dp.line,
                condition: `[TRUE] ${dp.text}`,
                scenario: `[TRUE] ${dp.text}`,
                inputScenario: trueInputScenario,
                expectedBehavior: "Executes consequent branch block",
                isCovered: !missedTrue,
                isAlreadyTested: isTrueAlreadyTested,
                isInfeasible: isTrueInfeasible,
                justification: trueJustification,
                priority: isTrueInfeasible || isTrueAlreadyTested ? "LOW" : (missedTrue ? "HIGH" : "NORMAL")
            });

            // Branch False
            const missedFalse = matchedBranch?.missedFalse ?? isUncovered;
            const isFalseInfeasible = Boolean(
                (matchedBranch?.isInfeasible && (matchedBranch.infeasibleMeta?.affectsBranch === "FALSE_BRANCH" || matchedBranch.infeasibleMeta?.affectsBranch === "BOTH")) ||
                (matchedInfeasible && (matchedInfeasible.affectsBranch === "FALSE_BRANCH" || matchedInfeasible.affectsBranch === "BOTH"))
            );
            const falseJustification = isFalseInfeasible ? (matchedBranch?.infeasibleMeta?.justification || matchedInfeasible?.justification || "Unreachable branch") : undefined;
            if (isFalseInfeasible && falseJustification) {
                infeasibleSummaries.push({
                    line: dp.line,
                    functionName: targetFn,
                    condition: `[FALSE] ${dp.text}`,
                    justification: falseJustification,
                    category: "BRANCH_TOGGLING"
                });
            }

            const hasExistingBranchFalse = existingTests.some(t =>
                !t.isSkipped &&
                (t.targetFunction === targetFn || (t.calledFunctions && t.calledFunctions.includes(targetFn)) || t.fullTitle.toLowerCase().includes(targetFn.toLowerCase())) &&
                (t.category === "BRANCH_TOGGLING") &&
                (t.title.includes("[FALSE]") || /false|alternate|fallback|else/i.test(t.title))
            );
            const isFalseAlreadyTested = hasExistingBranchFalse && !missedFalse;

            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                functionName: targetFn,
                targetLine: dp.line,
                condition: `[FALSE] ${dp.text}`,
                scenario: `[FALSE] ${dp.text}`,
                inputScenario: falseInputScenario,
                expectedBehavior: "Executes alternate branch or falls through",
                isCovered: !missedFalse,
                isAlreadyTested: isFalseAlreadyTested,
                isInfeasible: isFalseInfeasible,
                justification: falseJustification,
                priority: isFalseInfeasible || isFalseAlreadyTested ? "LOW" : (missedFalse ? "HIGH" : "NORMAL")
            });
        } else if (dp.type.startsWith("logical") || dp.type.startsWith("optional-chaining")) {
            const matchedExp = exportedSymbols.find(e => e.name === targetFn);
            const isInternalFallback = dp.line > ((matchedExp?.startLine || matchedExp?.line || 1) + 4);
            const fallbackInputScenario = isInternalFallback
                ? "Provide valid outer collection/payload satisfying preceding guards, configuring target property as null / undefined to trigger fallback"
                : "Pass null / undefined / false to trigger fallback expression";
            const hasExistingFallback = existingTests.some(t =>
                !t.isSkipped &&
                (t.targetFunction === targetFn || (t.calledFunctions && t.calledFunctions.includes(targetFn)) || t.fullTitle.toLowerCase().includes(targetFn.toLowerCase())) &&
                /fallback|nullish|falsy|optional/i.test(t.title)
            );
            const isAlreadyTested = hasExistingFallback && !isUncovered;
            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                functionName: targetFn,
                targetLine: dp.line,
                condition: `Nullish / Falsy fallback: ${dp.text}`,
                scenario: `Nullish / Falsy fallback: ${dp.text}`,
                inputScenario: fallbackInputScenario,
                expectedBehavior: "Default fallback value is returned or executed",
                isCovered: !isUncovered,
                isAlreadyTested,
                isInfeasible: false,
                priority: isAlreadyTested ? "LOW" : (isUncovered ? "HIGH" : "NORMAL")
            });
        } else if (dp.type === "switch-case") {
            const isAlreadyTested = !isUncovered;
            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                functionName: targetFn,
                targetLine: dp.line,
                condition: `Switch branch: ${dp.text}`,
                scenario: `Switch branch: ${dp.text}`,
                inputScenario: dp.isDefault ? "Pass unmatched case value to hit default" : "Pass specific case value",
                expectedBehavior: "Executes specific case body",
                isCovered: !isUncovered,
                isAlreadyTested,
                isInfeasible: false,
                priority: isAlreadyTested ? "LOW" : (isUncovered ? "HIGH" : "NORMAL")
            });
        } else if (dp.type === "default-arg") {
            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                functionName: targetFn,
                targetLine: dp.line,
                condition: `Default argument supplied: ${dp.param}`,
                scenario: `Default argument supplied: ${dp.param}`,
                inputScenario: `Pass explicit value for parameter "${dp.param}"`,
                expectedBehavior: "Overrides default parameter value with supplied input",
                isCovered: false,
                isAlreadyTested: false,
                isInfeasible: false,
                priority: "NORMAL"
            });
            matrixEntries.push({
                id: `TC-BRANCH-${String(counter++).padStart(2, "0")}`,
                category: "BRANCH_TOGGLING",
                categoryName: "C. Branch Toggling",
                targetFunction: targetFn,
                functionName: targetFn,
                targetLine: dp.line,
                condition: `Default argument fallback: ${dp.param}`,
                scenario: `Default argument fallback: ${dp.param}`,
                inputScenario: `Omit parameter "${dp.param}" or pass undefined`,
                expectedBehavior: "Uses default fallback value for parameter",
                isCovered: false,
                isAlreadyTested: false,
                isInfeasible: false,
                priority: "HIGH"
            });
        }
    }

    // --- CATEGORY D: ERROR & EXCEPTION HANDLING (throw, catch, reject) ---
    for (const ep of exceptionPoints) {
        const isUncovered = uncoveredLinesSet.has(ep.line);
        const targetFn = findEnclosingFunction(ep.line);

        const matchedInfeasible = infeasibleCodeBlocks.find(inf => {
            if (ep.loc && inf.loc) {
                return isLocOverlapping(ep.loc, inf.loc) || isLocContained(inf.loc, ep.loc) || isLocContained(ep.loc, inf.loc);
            }
            return inf.line === ep.line;
        });
        const isEpInfeasible = Boolean(matchedInfeasible);
        const epJustification = isEpInfeasible ? (matchedInfeasible.justification || "Unreachable exception point") : undefined;
        if (isEpInfeasible && epJustification) {
            infeasibleSummaries.push({
                line: ep.line,
                functionName: targetFn,
                condition: `Exception ${ep.type}: ${ep.text}`,
                justification: epJustification,
                category: "ERROR_HANDLING"
            });
        }

        const hasExistingErrorTest = existingTests.some(t =>
            !t.isSkipped &&
            t.category === "ERROR_HANDLING" &&
            (t.targetFunction === targetFn || (t.calledFunctions && t.calledFunctions.includes(targetFn)) || t.fullTitle.toLowerCase().includes(targetFn.toLowerCase()))
        );
        const isAlreadyTested = Boolean(hasExistingErrorTest && !isUncovered);

        if (ep.type === "throw") {
            matrixEntries.push({
                id: `TC-ERR-${String(counter++).padStart(2, "0")}`,
                category: "ERROR_HANDLING",
                categoryName: "D. Error & Exception",
                targetFunction: targetFn,
                functionName: targetFn,
                targetLine: ep.line,
                condition: `Trigger throw statement: ${ep.text}`,
                scenario: `Trigger throw statement: ${ep.text}`,
                inputScenario: "Pass missing/invalid parameter or schema violation",
                expectedBehavior: "Function throws expected error (test asserts with expect().rejects or toThrow())",
                isCovered: !isUncovered,
                isAlreadyTested,
                isInfeasible: isEpInfeasible,
                justification: epJustification,
                priority: isEpInfeasible || isAlreadyTested ? "LOW" : (isUncovered ? "HIGH" : "NORMAL")
            });
        } else if (ep.type === "catch") {
            matrixEntries.push({
                id: `TC-ERR-${String(counter++).padStart(2, "0")}`,
                category: "ERROR_HANDLING",
                categoryName: "D. Error & Exception",
                targetFunction: targetFn,
                functionName: targetFn,
                targetLine: ep.line,
                condition: `Trigger catch block: ${ep.text}`,
                scenario: `Trigger catch block: ${ep.text}`,
                inputScenario: "Mock downstream dependency (DB/HTTP/fs) to throw or reject",
                expectedBehavior: "Catches error and executes recovery or wraps into service error",
                isCovered: !isUncovered,
                isAlreadyTested,
                isInfeasible: isEpInfeasible,
                justification: epJustification,
                priority: isEpInfeasible || isAlreadyTested ? "LOW" : (isUncovered ? "HIGH" : "NORMAL")
            });
        } else if (ep.type === "promise-reject") {
            matrixEntries.push({
                id: `TC-ERR-${String(counter++).padStart(2, "0")}`,
                category: "ERROR_HANDLING",
                categoryName: "D. Error & Exception",
                targetFunction: targetFn,
                functionName: targetFn,
                targetLine: ep.line,
                condition: `Trigger Promise.reject: ${ep.text}`,
                scenario: `Trigger Promise.reject: ${ep.text}`,
                inputScenario: "Pass inputs causing asynchronous failure",
                expectedBehavior: "Promise rejects with expected error",
                isCovered: !isUncovered,
                isAlreadyTested,
                isInfeasible: isEpInfeasible,
                justification: epJustification,
                priority: isEpInfeasible || isAlreadyTested ? "LOW" : (isUncovered ? "HIGH" : "NORMAL")
            });
        }
    }

    // If no explicit exception points found, add general error handling test
    if (exceptionPoints.length === 0 && exportedSymbols.length > 0) {
        const defaultFn = exportedSymbols[0]?.name || "mainFunction";
        const hasExistingErrorTest = existingTests.some(t => !t.isSkipped && t.category === "ERROR_HANDLING");
        matrixEntries.push({
            id: `TC-ERR-${String(counter++).padStart(2, "0")}`,
            category: "ERROR_HANDLING",
            categoryName: "D. Error & Exception",
            targetFunction: defaultFn,
            functionName: defaultFn,
            targetLine: 1,
            condition: "Invalid argument validation / Null pointer safety",
            scenario: "Invalid argument validation / Null pointer safety",
            inputScenario: "Pass null, undefined, or malformed arguments",
            expectedBehavior: "Fails gracefully or throws informative validation error",
            isCovered: false,
            isAlreadyTested: Boolean(hasExistingErrorTest),
            isInfeasible: false,
            priority: hasExistingErrorTest ? "LOW" : "HIGH"
        });
    }

    // Delta Decision Table: Feasible, uncovered, not-yet-tested scenarios
    const deltaDecisionTable = matrixEntries.filter(e =>
        !e.isInfeasible &&
        !e.isAlreadyTested &&
        (!e.isCovered || e.priority === "HIGH" || (existingTests.length === 0 && e.category === "HAPPY_PATH"))
    );

    // Generate Markdown representation of Decision Table
    const tableHeader = "| ID | Target Function | Category | Test Condition / Input Scenario | Expected Behavior | Priority | Coverage Status |\n" +
        "| :--- | :--- | :--- | :--- | :--- | :---: | :---: |\n";
    const tableRows = matrixEntries.map(e =>
        `| **${e.id}** | \`${sanitizeTableCell(e.targetFunction)}\` | ${sanitizeTableCell(e.categoryName)} | ${sanitizeTableCell(e.condition)} (${sanitizeTableCell(e.inputScenario)}) | ${sanitizeTableCell(e.expectedBehavior)} | **${e.priority}** | ${e.isInfeasible ? "🛡️ Infeasible" : (e.isCovered ? "✅ Covered" : "❌ Missed")} |`
    ).join("\n");

    const decisionTableMarkdown = tableHeader + tableRows;

    // Generate Markdown representation of Delta Decision Table
    const deltaTableHeader = "| ID | Target Function | Category | Test Condition / Input Scenario | Expected Behavior | Priority |\n" +
        "| :--- | :--- | :--- | :--- | :--- | :---: |\n";
    const deltaTableRows = deltaDecisionTable.map(e =>
        `| **${e.id}** | \`${sanitizeTableCell(e.targetFunction)}\` | ${sanitizeTableCell(e.categoryName)} | ${sanitizeTableCell(e.condition)} (${sanitizeTableCell(e.inputScenario)}) | ${sanitizeTableCell(e.expectedBehavior)} | **${e.priority}** |`
    ).join("\n");
    const deltaDecisionTableMarkdown = deltaDecisionTable.length > 0
        ? (deltaTableHeader + deltaTableRows)
        : "All feasible test scenarios are covered or already tested.";

    const cc = astMetadata?.cyclomaticComplexity || (1 + (decisionPoints || []).length);
    const summary = {
        totalTestCases: matrixEntries.length,
        cyclomaticComplexity: cc,
        minimumBasisPaths: cc,
        happyPathCount: matrixEntries.filter(e => e.category === "HAPPY_PATH").length,
        boundaryCount: matrixEntries.filter(e => e.category === "BOUNDARY_VALUES").length,
        branchTogglingCount: matrixEntries.filter(e => e.category === "BRANCH_TOGGLING").length,
        errorHandlingCount: matrixEntries.filter(e => e.category === "ERROR_HANDLING").length,
        highPriorityMissed: matrixEntries.filter(e => e.priority === "HIGH").length,
        deltaCount: deltaDecisionTable.length,
        alreadyTestedCount: matrixEntries.filter(e => e.isAlreadyTested).length,
        infeasibleCount: matrixEntries.filter(e => e.isInfeasible).length
    };

    return {
        matrixEntries,
        decisionTable: matrixEntries,
        deltaDecisionTable,
        infeasibleSummaries,
        decisionTableMarkdown,
        deltaDecisionTableMarkdown,
        existingTestAnalysis,
        summary
    };
};

/**
 * 2.2 INDIRECT TESTING STRATEGY
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
export const buildIndirectTestingStrategy = (paramsOrHelpers, maybeAstMetadata, maybeSourceCode) => {
    let unexportedHelpersParam = null;
    let astMetadata = null;
    let sourceCode = "";

    if (paramsOrHelpers && typeof paramsOrHelpers === "object" && !Array.isArray(paramsOrHelpers) && ("astMetadata" in paramsOrHelpers || "sourceCode" in paramsOrHelpers)) {
        astMetadata = paramsOrHelpers.astMetadata;
        sourceCode = paramsOrHelpers.sourceCode || "";
        unexportedHelpersParam = paramsOrHelpers.unexportedHelpers;
    } else {
        unexportedHelpersParam = paramsOrHelpers;
        astMetadata = maybeAstMetadata;
        sourceCode = maybeSourceCode || "";
    }

    const internalFunctions = astMetadata?.internalFunctions || (Array.isArray(unexportedHelpersParam) ? unexportedHelpersParam.map(h => typeof h === "string" ? { name: h, line: 1 } : h) : []);
    const exportedSymbols = astMetadata?.exportedSymbols || [];
    const callEdges = astMetadata?.callEdges || [];
    const indirectStrategies = [];

    if (!internalFunctions.length) {
        return {
            indirectStrategies: [],
            indirectGuidancePrompt: "All business functions are publicly exported. Direct invocation in test cases is permitted."
        };
    }

    // Build call graph from AST callEdges, exported symbols' calls, and internal functions' callers
    // Map: callee -> Set of callers
    const calleeToCallersMap = new Map();
    const addEdge = (caller, callee) => {
        if (!caller || !callee || caller === callee) return;
        if (!calleeToCallersMap.has(callee)) calleeToCallersMap.set(callee, new Set());
        calleeToCallersMap.get(callee).add(caller);
    };

    for (const edge of callEdges) {
        addEdge(edge.caller, edge.callee);
    }
    for (const exp of exportedSymbols) {
        for (const callee of (exp.calls || [])) {
            addEdge(exp.name, callee);
        }
    }
    for (const intFn of internalFunctions) {
        for (const caller of (intFn.callers || [])) {
            addEdge(caller, intFn.name);
        }
    }

    // Resilient fallback: body regex matching if no edges found
    if (calleeToCallersMap.size === 0 && sourceCode) {
        const allFuncs = [...internalFunctions, ...exportedSymbols.filter(s => s.type !== "constant")];
        for (const f of allFuncs) {
            const name = f.name;
            const declPattern = new RegExp(`(?:function\\s+${name}|const\\s+${name}\\s*=|let\\s+${name}\\s*=|var\\s+${name}\\s*=)([\\s\\S]*?)(?=(?:function\\s+[a-zA-Z0-9_$]+|const\\s+[a-zA-Z0-9_$]+\\s*=|let\\s+[a-zA-Z0-9_$]+\\s*=|var\\s+[a-zA-Z0-9_$]+\\s*=|module\\.exports|export\\s+default|export\\s+\\{|$))`);
            const match = sourceCode.match(declPattern);
            const body = match ? match[1] : "";
            for (const helper of internalFunctions) {
                if (helper.name === name) continue;
                const callRegex = new RegExp(`\\b${helper.name}\\s*\\(`, "m");
                if (callRegex.test(body)) {
                    addEdge(name, helper.name);
                }
            }
        }
    }

    const exportedNamesSet = new Set(exportedSymbols.filter(s => s.type !== "constant").map(s => s.name));

    // For each internal helper, backtrack callers using BFS to find public exported callers and call chains
    for (const helper of internalFunctions) {
        const helperName = helper.name;
        const exportedCallerNames = new Set();
        const callChains = [];

        // BFS path queue: each item is path array ending at helperName: [node, ..., helperName]
        const queue = [[helperName]];
        const visitedNodes = new Set();

        while (queue.length > 0) {
            const currentPath = queue.shift();
            const currentHead = currentPath[0];

            const directCallers = calleeToCallersMap.get(currentHead) || new Set();

            for (const caller of directCallers) {
                if (exportedNamesSet.has(caller)) {
                    exportedCallerNames.add(caller);
                    callChains.push([caller, ...currentPath].join(" -> "));
                } else if (!currentPath.includes(caller) && !visitedNodes.has(caller)) {
                    visitedNodes.add(caller);
                    queue.push([caller, ...currentPath]);
                }
            }
        }

        const callerNames = Array.from(exportedCallerNames);
        const hasCallers = callerNames.length > 0;
        const callersStr = hasCallers ? callerNames.map(c => `\`${c}\``).join(", ") : "None detected";
        const primaryChain = callChains.length > 0 ? callChains[0] : null;

        indirectStrategies.push({
            helperName,
            helperLine: helper.line || 1,
            exportedCallers: callerNames,
            callChains: callChains,
            warning: "DO NOT IMPORT DIRECTLY - TEST INDIRECTLY VIA EXPORTED CALLER",
            guidance: hasCallers
                ? `Helper function "${helperName}" (line ${helper.line || 1}) is internal/unexported. Attempting to \`import { ${helperName} }\` will cause fatal TypeError. To cover lines and branches within "${helperName}", invoke ${callersStr} (Call chain: ${primaryChain}) with input variations (e.g. valid payload, null/undefined optional flags, edge numbers) that cause ${callersStr} to call "${helperName}".`
                : `Helper function "${helperName}" (line ${helper.line || 1}) is internal/unexported and has no discovered exported callers. Do not attempt to import it directly. If unreachable from public exports, do not synthesize calls to unrelated exports.`
        });
    }

    const indirectGuidancePrompt = indirectStrategies.map(s => {
        if (s.exportedCallers.length > 0) {
            return `⚠️ STRICT INDIRECT TESTING MANDATE FOR INTERNAL HELPER "${s.helperName}":\n` +
                `  - "${s.helperName}" is NOT exported! NEVER write \`import { ${s.helperName} }\` or \`const { ${s.helperName} } = require(...)\`.\n` +
                `  - Call path: ${(s.callChains || []).join(" | ") || s.helperName}\n` +
                `  - Call exported function(s): ${s.exportedCallers.map(c => `\`${c}\``).join(", ")}.\n` +
                `  - ${s.guidance}`;
        }
        return `⚠️ UNEXPORTED INTERNAL HELPER "${s.helperName}":\n` +
            `  - "${s.helperName}" is internal and has NO discovered exported caller.\n` +
            `  - NEVER import "${s.helperName}" directly. Do NOT attempt to test it via unrelated exports.`;
    }).join("\n\n");

    return {
        indirectStrategies,
        indirectGuidancePrompt
    };
};

/**
 * 2.3 ISOLATION MOCK CONTRACTS
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
    framework = "jest",
    sourceFile = null,
    targetTestFile = null,
    rootDir = null
}) => {
    const isVitest = framework === "vitest";
    const detectedDependencies = [];

    // 1-hop transitive import traversal on imported local source files to detect uninstalled external dependencies (e.g. mathjs in evaluator.ts)
    const transitiveSourceCodes = [];
    const transitiveMissingExternalPackages = new Set();
    const localImportMatches = [...sourceCode.matchAll(/(?:import\s+(?:[\w*\s{},]+from\s+)?['"](\.[^'"]+)['"]|require\s*\(\s*['"](\.[^'"]+)['"]\s*\))/g)];
    const relativeImportPaths = [...new Set(localImportMatches.map(m => m[1] || m[2]).filter(Boolean))];

    if (relativeImportPaths.length > 0) {
        let baseDir = null;
        if (sourceFile) {
            const rawSource = path.isAbsolute(sourceFile) ? sourceFile : (rootDir ? path.join(rootDir, sourceFile) : path.resolve(sourceFile));
            baseDir = fs.existsSync(rawSource) ? path.dirname(rawSource) : (rootDir ? path.join(rootDir, path.dirname(sourceFile)) : path.dirname(sourceFile));
        } else if (rootDir) {
            baseDir = rootDir;
        }

        const candidateExtensions = [".ts", ".js", ".tsx", ".jsx", "/index.ts", "/index.js", "/index.tsx", "/index.jsx", ""];

        for (const relPath of relativeImportPaths) {
            let resolvedTargetFile = null;
            if (baseDir) {
                const directPath = path.resolve(baseDir, relPath);
                for (const ext of candidateExtensions) {
                    const testFile = directPath + ext;
                    if (fs.existsSync(testFile) && fs.statSync(testFile).isFile()) {
                        resolvedTargetFile = testFile;
                        break;
                    }
                }
            }
            if (!resolvedTargetFile && rootDir) {
                for (const candDir of ["", "src", "backend/src", "server/src", "app/src", "backend", "server"]) {
                    const candidateBase = path.join(rootDir, candDir, path.basename(relPath));
                    for (const ext of candidateExtensions) {
                        const testFile = candidateBase + ext;
                        if (fs.existsSync(testFile) && fs.statSync(testFile).isFile()) {
                            resolvedTargetFile = testFile;
                            break;
                        }
                    }
                    if (resolvedTargetFile) break;
                }
            }

            if (resolvedTargetFile) {
                try {
                    const fileContent = fs.readFileSync(resolvedTargetFile, "utf8");
                    transitiveSourceCodes.push(fileContent);

                    // Inspect external dependencies in this transitive file
                    const extMatches = [...fileContent.matchAll(/(?:import\s+(?:[\w*\s{},]+from\s+)?['"]([^.][^'"]*)['"]|require\s*\(\s*['"]([^.][^'"]*)['"]\s*\))/g)];
                    for (const em of extMatches) {
                        const rawSpec = em[1] || em[2];
                        if (!rawSpec || rawSpec.startsWith(".") || rawSpec.startsWith("/") || rawSpec.startsWith("\\")) continue;
                        let pkg = rawSpec.startsWith("@") ? rawSpec.split("/").slice(0, 2).join("/") : rawSpec.split("/")[0];
                        pkg = pkg.replace(/@[\^~]?[0-9].*$/, "").trim();
                        if (pkg && !NODE_BUILTINS.has(pkg.toLowerCase()) && isValidNpmPackageName(pkg)) {
                            let isInstalled = false;
                            const searchDirs = [baseDir, rootDir, path.join(rootDir || "", "backend"), path.join(rootDir || "", "server")].filter(Boolean);
                            for (const sDir of searchDirs) {
                                if (fs.existsSync(path.join(sDir, "node_modules", pkg))) {
                                    isInstalled = true;
                                    break;
                                }
                            }
                            if (!isInstalled) {
                                transitiveMissingExternalPackages.add(pkg);
                            }
                        }
                    }
                } catch (_) {}
            }
        }
    }

    const codeToInspect = `${sourceCode}\n${existingTestCode}\n${transitiveSourceCodes.join("\n")}`;

    // 1. Detect Environment Variables using AST Extraction and Typed Mock Inference
    const detectedEnvNames = new Set();
    try {
        const parsedAst = parseJavaScriptCode(codeToInspect, {
            filePath: sourceFile || "",
            allowRecoveredAst: true
        });
        const astNode = parsedAst?.ast?.type ? parsedAst.ast : (parsedAst?.type ? parsedAst : null);
        if (astNode) {
            const astRefs = extractEnvReferencesFromAst(astNode, sourceFile || "");
            for (const ref of astRefs) {
                if (ref?.name) detectedEnvNames.add(ref.name);
            }
        }
    } catch (_) {}
    for (const m of codeToInspect.matchAll(/process\.env(?:\.([A-Za-z0-9_]+)|\[['"]([A-Za-z0-9_]+)['"]\])/g)) {
        const name = m[1] || m[2];
        if (name) detectedEnvNames.add(name);
    }
    if (/quickbooks/i.test(codeToInspect)) {
        for (const qbKey of ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REDIRECT_URI", "QUICKBOOKS_ENVIRONMENT"]) {
            detectedEnvNames.add(qbKey);
        }
    }
    const uniqueEnvs = Array.from(detectedEnvNames).filter(v => !["NODE_ENV", "PATH", "HOME", "USER"].includes(v));
    let envMockCode = "";
    if (uniqueEnvs.length > 0) {
        detectedDependencies.push("environment-variables");
        if (isVitest) {
            envMockCode = "// 1. Mock Environment Variables (Hermetic In-Memory RAM Stubs for Vitest)\n" +
                "beforeEach(() => {\n" +
                "  vi.stubEnv('NODE_ENV', 'test');\n" +
                uniqueEnvs.map(v => "  vi.stubEnv('" + v + "', process.env." + v + " || '" + inferMockValue(v) + "');").join("\n") +
                "\n});\n" +
                "afterEach(() => {\n" +
                "  vi.unstubAllEnvs();\n" +
                "  vi.restoreAllMocks();\n" +
                "});\n\n";
        } else {
            envMockCode = "// 1. Mock Environment Variables (Hermetic In-Memory RAM Stubs for Jest)\n" +
                "const originalEnv = process.env;\n" +
                "beforeEach(() => {\n" +
                "  process.env = {\n" +
                "    ...originalEnv,\n" +
                "    NODE_ENV: 'test',\n" +
                uniqueEnvs.map(v => "    " + v + ": process.env." + v + " || '" + inferMockValue(v) + "',").join("\n") +
                "\n  };\n" +
                "});\n" +
                "afterEach(() => {\n" +
                "  process.env = originalEnv;\n" +
                "  jest.restoreAllMocks();\n" +
                "});\n\n";
        }
    }

    // 2. Detect Prisma / Database
    const usesPrisma = /prisma|@prisma\/client/i.test(codeToInspect);
    let prismaMockCode = "";
    if (usesPrisma) {
        detectedDependencies.push("prisma-db");
        if (isVitest) {
            prismaMockCode = `// 2. Universal Prisma Proxy Mock (Universal In-Memory Prisma Client Mock for Vitest, Prisma v7 Compatible)\n` +
                `const { mockPrismaClientInstance } = vi.hoisted(() => {\n` +
                `  const defaultData = { id: 1, name: 'Sample', status: 'ACTIVE', email: 'sample@example.com', createdAt: new Date(), updatedAt: new Date() };\n` +
                `  const _createModelMock = () => {\n` +
                `    const baseModel = {\n` +
                `      findUnique: vi.fn().mockResolvedValue(defaultData),\n` +
                `      findFirst: vi.fn().mockResolvedValue(defaultData),\n` +
                `      findMany: vi.fn().mockResolvedValue([defaultData]),\n` +
                `      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n` +
                `      createMany: vi.fn().mockResolvedValue({ count: 1 }),\n` +
                `      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n` +
                `      updateMany: vi.fn().mockResolvedValue({ count: 1 }),\n` +
                `      upsert: vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.create || args?.update || {}) })),\n` +
                `      delete: vi.fn().mockResolvedValue({ id: 1 }),\n` +
                `      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),\n` +
                `      count: vi.fn().mockResolvedValue(1),\n` +
                `      aggregate: vi.fn().mockResolvedValue({ _count: 1, _sum: {}, _avg: {}, _min: {}, _max: {} }),\n` +
                `      groupBy: vi.fn().mockResolvedValue([])\n` +
                `    };\n` +
                `    return new Proxy(baseModel, {\n` +
                `      get(target, prop) {\n` +
                `        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n` +
                `        if (prop in target) return target[prop];\n` +
                `        if (typeof prop === 'string') {\n` +
                `          if (prop.includes('OrThrow') || prop.startsWith('findUnique') || prop.startsWith('findFirst')) {\n` +
                `            target[prop] = vi.fn().mockResolvedValue(defaultData);\n` +
                `          } else if (prop.startsWith('find') || prop.includes('Many') || prop.includes('Return')) {\n` +
                `            target[prop] = vi.fn().mockResolvedValue([defaultData]);\n` +
                `          } else if (prop.startsWith('count')) {\n` +
                `            target[prop] = vi.fn().mockResolvedValue(1);\n` +
                `          } else if (prop.startsWith('create') || prop.startsWith('update') || prop.startsWith('upsert') || prop.startsWith('delete')) {\n` +
                `            target[prop] = vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || args?.create || args?.update || {}) }));\n` +
                `          } else {\n` +
                `            target[prop] = vi.fn().mockResolvedValue(defaultData);\n` +
                `          }\n` +
                `          return target[prop];\n` +
                `        }\n` +
                `        return undefined;\n` +
                `      }\n` +
                `    });\n` +
                `  };\n` +
                `  const _createPrismaProxyMock = () => {\n` +
                `    const models = new Map();\n` +
                `    let clientProxy;\n` +
                `    clientProxy = new Proxy({\n` +
                `      $connect: vi.fn().mockResolvedValue(undefined),\n` +
                `      $disconnect: vi.fn().mockResolvedValue(undefined),\n` +
                `      $transaction: vi.fn(async (args) => Array.isArray(args) ? Promise.all(args) : (typeof args === 'function' ? args(clientProxy) : Promise.resolve())),\n` +
                `      $queryRaw: vi.fn().mockResolvedValue([]),\n` +
                `      $queryRawUnsafe: vi.fn().mockResolvedValue([]),\n` +
                `      $executeRaw: vi.fn().mockResolvedValue(1),\n` +
                `      $executeRawUnsafe: vi.fn().mockResolvedValue(1),\n` +
                `      $extends: vi.fn().mockReturnThis()\n` +
                `    }, {\n` +
                `      get(target, prop) {\n` +
                `        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n` +
                `        if (prop in target) return target[prop];\n` +
                `        if (!models.has(prop)) models.set(prop, _createModelMock());\n` +
                `        return models.get(prop);\n` +
                `      }\n` +
                `    });\n` +
                `    return clientProxy;\n` +
                `  };\n` +
                `  const _createClientMock = _createPrismaProxyMock;\n` +
                `  const clientProxy = _createPrismaProxyMock();\n` +
                `  if (typeof globalThis !== 'undefined') {\n` +
                `    globalThis.__mockPrisma = clientProxy;\n` +
                `  }\n` +
                `  return { mockPrismaClientInstance: clientProxy };\n` +
                `});\n\n` +
                `vi.mock('@prisma/client', () => ({\n` +
                `  PrismaClient: vi.fn(() => mockPrismaClientInstance),\n` +
                `  default: { PrismaClient: vi.fn(() => mockPrismaClientInstance) }\n` +
                `}));\n` +
                [
                    "../lib/prisma", "../lib/prisma.js",
                    "../../lib/prisma", "../../lib/prisma.js",
                    "../src/lib/prisma", "../src/lib/prisma.js",
                    "../../src/lib/prisma", "../../src/lib/prisma.js",
                    "../config/prisma", "../config/prisma.js",
                    "../../config/prisma", "../../config/prisma.js",
                    "../src/config/prisma", "../src/config/prisma.js",
                    "../../src/config/prisma", "../../src/config/prisma.js",
                    "@/lib/prisma", "@/lib/prisma.js",
                    "@/config/prisma", "@/config/prisma.js"
                ].map(p => `vi.mock('${p}', () => ({ __esModule: true, prisma: mockPrismaClientInstance, default: mockPrismaClientInstance }));`).join("\n") + "\n\n";
        } else {
            prismaMockCode = `// 2. Universal Prisma Proxy Mock (Universal In-Memory Prisma Client Mock for Jest, Prisma v7 Compatible)\n` +
                `jest.mock('@prisma/client', () => {\n` +
                `  const defaultData = { id: 1, name: 'Sample', status: 'ACTIVE', email: 'sample@example.com', createdAt: new Date(), updatedAt: new Date() };\n` +
                `  const _createModelMock = () => {\n` +
                `    const baseModel = {\n` +
                `      findUnique: jest.fn().mockResolvedValue(defaultData),\n` +
                `      findFirst: jest.fn().mockResolvedValue(defaultData),\n` +
                `      findMany: jest.fn().mockResolvedValue([defaultData]),\n` +
                `      create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n` +
                `      createMany: jest.fn().mockResolvedValue({ count: 1 }),\n` +
                `      update: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n` +
                `      updateMany: jest.fn().mockResolvedValue({ count: 1 }),\n` +
                `      upsert: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.create || args?.update || {}) })),\n` +
                `      delete: jest.fn().mockResolvedValue({ id: 1 }),\n` +
                `      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),\n` +
                `      count: jest.fn().mockResolvedValue(1),\n` +
                `      aggregate: jest.fn().mockResolvedValue({ _count: 1, _sum: {}, _avg: {}, _min: {}, _max: {} }),\n` +
                `      groupBy: jest.fn().mockResolvedValue([])\n` +
                `    };\n` +
                `    return new Proxy(baseModel, {\n` +
                `      get(target, prop) {\n` +
                `        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n` +
                `        if (prop in target) return target[prop];\n` +
                `        if (typeof prop === 'string') {\n` +
                `          if (prop.includes('OrThrow') || prop.startsWith('findUnique') || prop.startsWith('findFirst')) {\n` +
                `            target[prop] = jest.fn().mockResolvedValue(defaultData);\n` +
                `          } else if (prop.startsWith('find') || prop.includes('Many') || prop.includes('Return')) {\n` +
                `            target[prop] = jest.fn().mockResolvedValue([defaultData]);\n` +
                `          } else if (prop.startsWith('count')) {\n` +
                `            target[prop] = jest.fn().mockResolvedValue(1);\n` +
                `          } else if (prop.startsWith('create') || prop.startsWith('update') || prop.startsWith('upsert') || prop.startsWith('delete')) {\n` +
                `            target[prop] = jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || args?.create || args?.update || {}) }));\n` +
                `          } else {\n` +
                `            target[prop] = jest.fn().mockResolvedValue(defaultData);\n` +
                `          }\n` +
                `          return target[prop];\n` +
                `        }\n` +
                `        return undefined;\n` +
                `      }\n` +
                `    });\n` +
                `  };\n\n` +
                `  const _createPrismaProxyMock = () => {\n` +
                `    const models = new Map();\n` +
                `    let clientProxy;\n` +
                `    clientProxy = new Proxy({\n` +
                `      $connect: jest.fn().mockResolvedValue(undefined),\n` +
                `      $disconnect: jest.fn().mockResolvedValue(undefined),\n` +
                `      $transaction: jest.fn(async (args) => Array.isArray(args) ? Promise.all(args) : (typeof args === 'function' ? args(clientProxy) : Promise.resolve())),\n` +
                `      $queryRaw: jest.fn().mockResolvedValue([]),\n` +
                `      $queryRawUnsafe: jest.fn().mockResolvedValue([]),\n` +
                `      $executeRaw: jest.fn().mockResolvedValue(1),\n` +
                `      $executeRawUnsafe: jest.fn().mockResolvedValue(1),\n` +
                `      $extends: jest.fn().mockReturnThis()\n` +
                `    }, {\n` +
                `      get(target, prop) {\n` +
                `        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n` +
                `        if (prop in target) return target[prop];\n` +
                `        if (!models.has(prop)) models.set(prop, _createModelMock());\n` +
                `        return models.get(prop);\n` +
                `      }\n` +
                `    });\n` +
                `    return clientProxy;\n` +
                `  };\n` +
                `  const _createClientMock = _createPrismaProxyMock;\n\n` +
                `  const sharedMock = (typeof globalThis !== 'undefined' && globalThis.__mockPrisma) || _createPrismaProxyMock();\n` +
                `  if (typeof globalThis !== 'undefined') {\n` +
                `    globalThis.__mockPrisma = sharedMock;\n` +
                `  }\n` +
                `  return {\n` +
                `    __esModule: true,\n` +
                `    PrismaClient: jest.fn().mockImplementation(() => sharedMock),\n` +
                `    default: { PrismaClient: jest.fn().mockImplementation(() => sharedMock) }\n` +
                `  };\n` +
                `}, { virtual: true });\n` +
                [
                    "../lib/prisma", "../lib/prisma.js",
                    "../../lib/prisma", "../../lib/prisma.js",
                    "../src/lib/prisma", "../src/lib/prisma.js",
                    "../../src/lib/prisma", "../../src/lib/prisma.js",
                    "../config/prisma", "../config/prisma.js",
                    "../../config/prisma", "../../config/prisma.js",
                    "../src/config/prisma", "../src/config/prisma.js",
                    "../../src/config/prisma", "../../src/config/prisma.js",
                    "@/lib/prisma", "@/lib/prisma.js",
                    "@/config/prisma", "@/config/prisma.js"
                ].map(p =>
                    `jest.mock('${p}', () => {\n` +
                    `  const getPrisma = () => {\n` +
                    `    if (typeof globalThis !== 'undefined' && globalThis.__mockPrisma) return globalThis.__mockPrisma;\n` +
                    `    const defaultData = { id: 1, name: 'Sample', status: 'ACTIVE', email: 'sample@example.com', createdAt: new Date(), updatedAt: new Date() };\n` +
                    `    const _createModel = () => {\n` +
                    `      const base = {\n` +
                    `        findUnique: jest.fn().mockResolvedValue(defaultData),\n` +
                    `        findFirst: jest.fn().mockResolvedValue(defaultData),\n` +
                    `        findMany: jest.fn().mockResolvedValue([defaultData]),\n` +
                    `        create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n` +
                    `        createMany: jest.fn().mockResolvedValue({ count: 1 }),\n` +
                    `        update: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || {}) })),\n` +
                    `        updateMany: jest.fn().mockResolvedValue({ count: 1 }),\n` +
                    `        upsert: jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.create || args?.update || {}) })),\n` +
                    `        delete: jest.fn().mockResolvedValue({ id: 1 }),\n` +
                    `        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),\n` +
                    `        count: jest.fn().mockResolvedValue(1),\n` +
                    `        aggregate: jest.fn().mockResolvedValue({ _count: 1, _sum: {}, _avg: {}, _min: {}, _max: {} }),\n` +
                    `        groupBy: jest.fn().mockResolvedValue([])\n` +
                    `      };\n` +
                    `      return new Proxy(base, {\n` +
                    `        get(t, prop) {\n` +
                    `          if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n` +
                    `          if (prop in t) return t[prop];\n` +
                    `          if (typeof prop === 'string') {\n` +
                    `            if (prop.includes('OrThrow') || prop.startsWith('findUnique') || prop.startsWith('findFirst')) t[prop] = jest.fn().mockResolvedValue(defaultData);\n` +
                    `            else if (prop.startsWith('find') || prop.includes('Many') || prop.includes('Return')) t[prop] = jest.fn().mockResolvedValue([defaultData]);\n` +
                    `            else if (prop.startsWith('count')) t[prop] = jest.fn().mockResolvedValue(1);\n` +
                    `            else if (prop.startsWith('create') || prop.startsWith('update') || prop.startsWith('upsert') || prop.startsWith('delete')) t[prop] = jest.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...(args?.data || args?.create || args?.update || {}) }));\n` +
                    `            else t[prop] = jest.fn().mockResolvedValue(defaultData);\n` +
                    `            return t[prop];\n` +
                    `          }\n` +
                    `          return undefined;\n` +
                    `        }\n` +
                    `      });\n` +
                    `    };\n` +
                    `    const models = new Map();\n` +
                    `    let clientProxy;\n` +
                    `    clientProxy = new Proxy({\n` +
                    `      $connect: jest.fn().mockResolvedValue(undefined),\n` +
                    `      $disconnect: jest.fn().mockResolvedValue(undefined),\n` +
                    `      $transaction: jest.fn(async (args) => Array.isArray(args) ? Promise.all(args) : (typeof args === 'function' ? args(clientProxy) : Promise.resolve())),\n` +
                    `      $queryRaw: jest.fn().mockResolvedValue([]),\n` +
                    `      $queryRawUnsafe: jest.fn().mockResolvedValue([]),\n` +
                    `      $executeRaw: jest.fn().mockResolvedValue(1),\n` +
                    `      $executeRawUnsafe: jest.fn().mockResolvedValue(1),\n` +
                    `      $extends: jest.fn().mockReturnThis()\n` +
                    `    }, {\n` +
                    `      get(target, prop) {\n` +
                    `        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n` +
                    `        if (prop in target) return target[prop];\n` +
                    `        if (!models.has(prop)) models.set(prop, _createModel());\n` +
                    `        return models.get(prop);\n` +
                    `      }\n` +
                    `    });\n` +
                    `    if (typeof globalThis !== 'undefined') globalThis.__mockPrisma = clientProxy;\n` +
                    `    return clientProxy;\n` +
                    `  };\n` +
                    `  const p = new Proxy({}, {\n` +
                    `    get: (target, prop) => {\n` +
                    `      if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n` +
                    `      const client = getPrisma();\n` +
                    `      return client[prop];\n` +
                    `    }\n` +
                    `  });\n` +
                    `  return { __esModule: true, prisma: p, default: p };\n` +
                    `}, { virtual: true });`
                ).join("\n") + "\n\n";
        }
    }

    // 2.1. Detect Mongoose / Mongo
    const usesMongoose = /(?:require\(['"]mongoose['"]\)|from\s+['"]mongoose['"]|\bmongoose\.model\b|\bnew\s+mongoose\.Schema\b)/i.test(codeToInspect);
    let mongooseMockCode = "";
    if (usesMongoose) {
        detectedDependencies.push("mongoose-db");
        mongooseMockCode = `// 2.1 Universal Mongoose In-Memory Proxy Mock\n` +
            (isVitest
                ? `const { _createMongooseModelProxy } = vi.hoisted(() => {\n` +
                  `  const _queryMock = {\n` +
                  `    exec: vi.fn(() => Promise.resolve({ _id: '507f1f77bcf86cd799439011', id: '1', save: vi.fn(() => Promise.resolve({ id: '1' })) })),\n` +
                  `    populate: vi.fn().mockReturnThis(),\n` +
                  `    sort: vi.fn().mockReturnThis(),\n` +
                  `    limit: vi.fn().mockReturnThis(),\n` +
                  `    skip: vi.fn().mockReturnThis(),\n` +
                  `    lean: vi.fn(() => Promise.resolve([{ _id: '1', name: 'Sample' }])),\n` +
                  `    select: vi.fn().mockReturnThis(),\n` +
                  `    where: vi.fn().mockReturnThis()\n` +
                  `  };\n` +
                  `  const _proxyMaker = () => ({\n` +
                  `    find: vi.fn(() => _queryMock),\n` +
                  `    findOne: vi.fn(() => _queryMock),\n` +
                  `    findById: vi.fn(() => _queryMock),\n` +
                  `    findOneAndUpdate: vi.fn(() => _queryMock),\n` +
                  `    findByIdAndUpdate: vi.fn(() => _queryMock),\n` +
                  `    deleteOne: vi.fn(() => Promise.resolve({ deletedCount: 1 })),\n` +
                  `    deleteMany: vi.fn(() => Promise.resolve({ deletedCount: 1 })),\n` +
                  `    create: vi.fn((doc) => Promise.resolve({ _id: '1', ...doc })),\n` +
                  `    countDocuments: vi.fn(() => Promise.resolve(1))\n` +
                  `  });\n` +
                  `  return { _createMongooseModelProxy: _proxyMaker };\n` +
                  `});\n` +
                  `vi.mock('mongoose', () => {\n  const m = { model: vi.fn(() => _createMongooseModelProxy()), Schema: class { static Types = { ObjectId: String }; index() {} pre() {} post() {} }, connect: vi.fn(() => Promise.resolve()), connection: { on: vi.fn(), once: vi.fn() } };\n  return { default: m, ...m };\n});\n\n`
                : `const _createMongooseModelProxy = () => {\n` +
                  `  const _queryMock = {\n` +
                  `    exec: jest.fn(() => Promise.resolve({ _id: '507f1f77bcf86cd799439011', id: '1', save: jest.fn(() => Promise.resolve({ id: '1' })) })),\n` +
                  `    populate: jest.fn().mockReturnThis(),\n` +
                  `    sort: jest.fn().mockReturnThis(),\n` +
                  `    limit: jest.fn().mockReturnThis(),\n` +
                  `    skip: jest.fn().mockReturnThis(),\n` +
                  `    lean: jest.fn(() => Promise.resolve([{ _id: '1', name: 'Sample' }])),\n` +
                  `    select: jest.fn().mockReturnThis(),\n` +
                  `    where: jest.fn().mockReturnThis()\n` +
                  `  };\n` +
                  `  return {\n` +
                  `    find: jest.fn(() => _queryMock),\n` +
                  `    findOne: jest.fn(() => _queryMock),\n` +
                  `    findById: jest.fn(() => _queryMock),\n` +
                  `    findOneAndUpdate: jest.fn(() => _queryMock),\n` +
                  `    findByIdAndUpdate: jest.fn(() => _queryMock),\n` +
                  `    deleteOne: jest.fn(() => Promise.resolve({ deletedCount: 1 })),\n` +
                  `    deleteMany: jest.fn(() => Promise.resolve({ deletedCount: 1 })),\n` +
                  `    create: jest.fn((doc) => Promise.resolve({ _id: '1', ...doc })),\n` +
                  `    countDocuments: jest.fn(() => Promise.resolve(1))\n` +
                  `  };\n` +
                  `};\n` +
                  `jest.mock('mongoose', () => ({\n  model: jest.fn(() => _createMongooseModelProxy()),\n  Schema: class { static Types = { ObjectId: String }; index() {} pre() {} post() {} },\n  connect: jest.fn(() => Promise.resolve()),\n  connection: { on: jest.fn(), once: jest.fn() }\n}), { virtual: true });\n\n`);
    }

    // 2.1.1 Detect bcrypt / bcryptjs / argon2
    const usesBcrypt = /(?:require\(['"](?:bcrypt|bcryptjs|argon2)['"]\)|from\s+['"](?:bcrypt|bcryptjs|argon2)['"])/i.test(codeToInspect);
    let bcryptMockCode = "";
    if (usesBcrypt) {
        detectedDependencies.push("bcrypt-crypto");
        bcryptMockCode = `// 2.1.1 Universal Password Hashing Mock\n` +
            (isVitest
                ? `const _mockBcrypt = { hash: vi.fn(() => Promise.resolve('$2b$10$mockHashedPassword1234567890')), compare: vi.fn(() => Promise.resolve(true)), genSalt: vi.fn(() => Promise.resolve('$2b$10$salt')), hashSync: vi.fn(() => '$2b$10$mockHashedPassword1234567890'), compareSync: vi.fn(() => true) };\n` +
                  `vi.mock('bcrypt', () => ({ default: _mockBcrypt, ..._mockBcrypt }));\n` +
                  `vi.mock('bcryptjs', () => ({ default: _mockBcrypt, ..._mockBcrypt }));\n\n`
                : `const _mockBcrypt = { hash: jest.fn(() => Promise.resolve('$2b$10$mockHashedPassword1234567890')), compare: jest.fn(() => Promise.resolve(true)), genSalt: jest.fn(() => Promise.resolve('$2b$10$salt')), hashSync: jest.fn(() => '$2b$10$mockHashedPassword1234567890'), compareSync: jest.fn(() => true) };\n` +
                  `jest.mock('bcrypt', () => ({ default: _mockBcrypt, ..._mockBcrypt }), { virtual: true });\n` +
                  `jest.mock('bcryptjs', () => ({ default: _mockBcrypt, ..._mockBcrypt }), { virtual: true });\n\n`);
    }

    // 2.2. Detect Sequelize
    const usesSequelize = /(?:require\(['"]sequelize['"]\)|from\s+['"]sequelize['"]|\bnew\s+Sequelize\b|\bsequelize\.define\b)/i.test(codeToInspect);
    let sequelizeMockCode = "";
    if (usesSequelize) {
        detectedDependencies.push("sequelize-db");
        sequelizeMockCode = `// 2.2 Universal Sequelize In-Memory Proxy Mock\n` +
            `const _createSequelizeModelProxy = () => ({\n` +
            `  findAll: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve([{ id: 1 }])),\n` +
            `  findOne: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve({ id: 1 })),\n` +
            `  findByPk: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve({ id: 1 })),\n` +
            `  create: ${isVitest ? "vi.fn" : "jest.fn"}((d) => Promise.resolve({ id: 1, ...d })),\n` +
            `  update: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve([1])),\n` +
            `  destroy: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve(1)),\n` +
            `  count: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve(1))\n` +
            `});\n` +
            (isVitest
                ? `vi.mock('sequelize', () => ({\n  Sequelize: vi.fn(() => ({ define: vi.fn(() => _createSequelizeModelProxy()), authenticate: vi.fn(() => Promise.resolve()) })),\n  DataTypes: new Proxy({}, { get: () => 'STRING' }),\n  default: { Sequelize: vi.fn(() => ({ define: vi.fn(() => _createSequelizeModelProxy()) })), DataTypes: new Proxy({}, { get: () => 'STRING' }) }\n}));\n\n`
                : `jest.mock('sequelize', () => ({\n  Sequelize: jest.fn(() => ({ define: jest.fn(() => _createSequelizeModelProxy()), authenticate: jest.fn(() => Promise.resolve()) })),\n  DataTypes: new Proxy({}, { get: () => 'STRING' }),\n  default: { Sequelize: jest.fn(() => ({ define: jest.fn(() => _createSequelizeModelProxy()) })), DataTypes: new Proxy({}, { get: () => 'STRING' }) }\n}), { virtual: true });\n\n`);
    }

    // 2.3. Detect Redis / ioredis
    const usesRedis = /(?:require\(['"](?:io)?redis['"]\)|from\s+['"](?:io)?redis['"]|\bcreateClient\s*\(|\bnew\s+Redis\b)/i.test(codeToInspect);
    let redisMockCode = "";
    if (usesRedis) {
        detectedDependencies.push("redis-cache");
        redisMockCode = `// 2.3 Universal In-Memory Redis / ioredis Mock Client\n` +
            `const _createRedisMockClient = () => {\n` +
            `  const _store = new Map();\n` +
            `  const _client = {\n` +
            `    get: ${isVitest ? "vi.fn" : "jest.fn"}((key) => Promise.resolve(_store.get(String(key)) ?? null)),\n` +
            `    set: ${isVitest ? "vi.fn" : "jest.fn"}((key, val) => { _store.set(String(key), String(val)); return Promise.resolve('OK'); }),\n` +
            `    del: ${isVitest ? "vi.fn" : "jest.fn"}((key) => { const existed = _store.delete(String(key)); return Promise.resolve(existed ? 1 : 0); }),\n` +
            `    hget: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve(null)),\n` +
            `    hset: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve(1)),\n` +
            `    hgetall: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve({})),\n` +
            `    keys: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve(Array.from(_store.keys()))),\n` +
            `    flushall: ${isVitest ? "vi.fn" : "jest.fn"}(() => { _store.clear(); return Promise.resolve('OK'); }),\n` +
            `    exists: ${isVitest ? "vi.fn" : "jest.fn"}((key) => Promise.resolve(_store.has(String(key)) ? 1 : 0)),\n` +
            `    expire: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve(1)),\n` +
            `    ttl: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve(3600)),\n` +
            `    ping: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve('PONG')),\n` +
            `    connect: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve()),\n` +
            `    disconnect: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve()),\n` +
            `    quit: ${isVitest ? "vi.fn" : "jest.fn"}(() => Promise.resolve('OK')),\n` +
            `    on: ${isVitest ? "vi.fn" : "jest.fn"}(),\n` +
            `    status: 'ready'\n` +
            `  };\n` +
            `  return _client;\n` +
            `};\n` +
            `var mockRedisClient = globalThis.__mockRedisClient = _createRedisMockClient();\n` +
            (isVitest
                ? `vi.mock('ioredis', () => ({ default: vi.fn(() => globalThis.__mockRedisClient || mockRedisClient), Redis: vi.fn(() => globalThis.__mockRedisClient || mockRedisClient) }));\n` +
                  `vi.mock('redis', () => ({ createClient: vi.fn(() => globalThis.__mockRedisClient || mockRedisClient), default: { createClient: vi.fn(() => globalThis.__mockRedisClient || mockRedisClient) } }));\n\n`
                : `jest.mock('ioredis', () => {\n` +
                  `  const c = globalThis.__mockRedisClient || (typeof mockRedisClient !== 'undefined' ? mockRedisClient : {});\n` +
                  `  const Cls = jest.fn(() => c);\n` +
                  `  Cls.default = Cls;\n` +
                  `  Cls.Redis = Cls;\n` +
                  `  return Cls;\n` +
                  `}, { virtual: true });\n` +
                  `jest.mock('redis', () => {\n` +
                  `  const c = globalThis.__mockRedisClient || (typeof mockRedisClient !== 'undefined' ? mockRedisClient : {});\n` +
                  `  return { createClient: jest.fn(() => c), default: { createClient: jest.fn(() => c) } };\n` +
                  `}, { virtual: true });\n\n`);
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
jest.mock('axios', () => ({ create: jest.fn(() => _mockAxios), ..._mockAxios, default: { create: jest.fn(() => _mockAxios), ..._mockAxios } }), { virtual: true });\n\n`);
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
            `  const safeBody = (overrides && overrides.body !== undefined && overrides.body !== null)\n` +
            `    ? overrides.body\n` +
            `    : ((overrides && overrides.req && overrides.req.body !== undefined && overrides.req.body !== null) ? overrides.req.body : {});\n` +
            `  const req = {\n` +
            `    body: { items: [], ...safeBody }, // body: { ...overrides.body }\n` +
            `    query: { page: '1', limit: '10', ...(overrides?.query || overrides?.req?.query || {}) },\n` +
            `    params: { id: '1', ...(overrides?.params || overrides?.req?.params || {}) },\n` +
            `    headers: { authorization: 'Bearer test-token', ...(overrides?.headers || overrides?.req?.headers || {}) },\n` +
            `    cookies: { ...(overrides?.cookies || overrides?.req?.cookies || {}) },\n` +
            `    user: { id: 1, role: 'admin', email: 'admin@example.com', ...(overrides?.user || overrides?.req?.user || {}) },\n` +
            `    file: overrides?.file || overrides?.req?.file || null,\n` +
            `    files: overrides?.files || overrides?.req?.files || [],\n` +
            `    get: (header) => (overrides?.headers?.[header.toLowerCase()] || overrides?.req?.headers?.[header.toLowerCase()] || '')\n` +
            `  };\n` +
            `  const res = {\n` +
            `    status: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    json: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    send: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    sendStatus: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    cookie: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    clearCookie: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    redirect: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    setHeader: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    write: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"},\n` +
            `    end: ${isVitest ? "vi.fn().mockReturnThis()" : "jest.fn().mockReturnThis()"}\n` +
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

    // 7.1 Detect UI & Client-side Libraries (sonner, react-toastify, lucide-react, framer-motion, @radix-ui, next-themes)
    if (/sonner/i.test(codeToInspect)) {
        detectedDependencies.push("sonner");
        thirdPartyMockCode += `// 7.1 Mock Sonner Toast\n` +
            (isVitest
                ? `vi.mock('sonner', () => {\n  const _mockSonnerToast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), promise: vi.fn(), custom: vi.fn() });\n  return { toast: _mockSonnerToast, Toaster: vi.fn(() => null), default: { toast: _mockSonnerToast, Toaster: vi.fn(() => null) } };\n});\n\n`
                : `const _mockSonnerToast = Object.assign(jest.fn(), { error: jest.fn(), success: jest.fn(), info: jest.fn(), warning: jest.fn(), message: jest.fn(), loading: jest.fn(), dismiss: jest.fn(), promise: jest.fn(), custom: jest.fn() });\n` +
                  `jest.mock('sonner', () => ({ toast: _mockSonnerToast, Toaster: jest.fn(() => null), default: { toast: _mockSonnerToast, Toaster: jest.fn(() => null) } }), { virtual: true });\n\n`);
    }
    if (/react-toastify/i.test(codeToInspect)) {
        detectedDependencies.push("react-toastify");
        thirdPartyMockCode += `// 7.2 Mock React-Toastify\n` +
            (isVitest
                ? `vi.mock('react-toastify', () => {\n  const _mockToastify = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() });\n  return { toast: _mockToastify, ToastContainer: vi.fn(() => null), default: { toast: _mockToastify } };\n});\n\n`
                : `const _mockToastify = Object.assign(jest.fn(), { error: jest.fn(), success: jest.fn(), info: jest.fn(), warning: jest.fn(), dismiss: jest.fn() });\n` +
                  `jest.mock('react-toastify', () => ({ toast: _mockToastify, ToastContainer: jest.fn(() => null), default: { toast: _mockToastify } }), { virtual: true });\n\n`);
    }
    if (/lucide-react/i.test(codeToInspect)) {
        detectedDependencies.push("lucide-react");
        thirdPartyMockCode += `// 7.3 Mock Lucide Icons\n` +
            (isVitest
                ? `vi.mock('lucide-react', () => new Proxy({}, { get: (_, prop) => prop === '__esModule' ? true : vi.fn(() => null) }));\n\n`
                : `jest.mock('lucide-react', () => new Proxy({}, { get: (_, prop) => prop === '__esModule' ? true : jest.fn(() => null) }), { virtual: true });\n\n`);
    }
    if (/framer-motion/i.test(codeToInspect)) {
        detectedDependencies.push("framer-motion");
        thirdPartyMockCode += `// 7.4 Mock Framer Motion\n` +
            (isVitest
                ? `vi.mock('framer-motion', () => ({ motion: new Proxy({}, { get: () => 'div' }), AnimatePresence: ({ children }) => children }));\n\n`
                : `jest.mock('framer-motion', () => ({ motion: new Proxy({}, { get: () => 'div' }), AnimatePresence: ({ children }) => children }), { virtual: true });\n\n`);
    }
    if (/@radix-ui/i.test(codeToInspect)) {
        detectedDependencies.push("radix-ui");
        const radixMatches = [...new Set([...codeToInspect.matchAll(/['"](@radix-ui\/[^'"]+)['"]/g)].map(m => m[1]))];
        for (const rPkg of radixMatches) {
            thirdPartyMockCode += isVitest
                ? `vi.mock('${rPkg}', () => new Proxy({}, { get: (_, prop) => prop === '__esModule' ? true : (({ children, ...props }) => children || null) }));\n`
                : `jest.mock('${rPkg}', () => new Proxy({}, { get: (_, prop) => prop === '__esModule' ? true : (({ children, ...props }) => children || null) }), { virtual: true });\n`;
        }
        if (radixMatches.length > 0) thirdPartyMockCode += "\n";
    }
    if (/next-themes/i.test(codeToInspect)) {
        detectedDependencies.push("next-themes");
        thirdPartyMockCode += `// 7.5 Mock Next Themes\n` +
            (isVitest
                ? `vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn(), systemTheme: 'light' }), ThemeProvider: ({ children }) => children }));\n\n`
                : `jest.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: jest.fn(), systemTheme: 'light' }), ThemeProvider: ({ children }) => children }), { virtual: true });\n\n`);
    }
    if (/@langchain|langsmith/i.test(codeToInspect)) {
        detectedDependencies.push("langchain-sdk");
        thirdPartyMockCode += `// 7.6 Mock LangChain & LangGraph SDK\n` +
            (isVitest
                ? `vi.mock('@langchain/langgraph-sdk', () => {\n  const Client = vi.fn().mockImplementation(function (opts) { this.apiKey = opts?.apiKey; this.apiUrl = opts?.apiUrl; this.defaultHeaders = opts?.defaultHeaders; });\n  return { Client, default: { Client } };\n});\n` +
                  `vi.mock('langsmith', () => new Proxy({}, { get: (_, prop) => prop === '__esModule' ? true : vi.fn() }));\n\n`
                : `jest.mock('@langchain/langgraph-sdk', () => {\n  const Client = jest.fn().mockImplementation(function (opts) { this.apiKey = opts?.apiKey; this.apiUrl = opts?.apiUrl; this.defaultHeaders = opts?.defaultHeaders; });\n  return { Client, default: { Client } };\n}, { virtual: true });\n` +
                  `jest.mock('langsmith', () => new Proxy({}, { get: (_, prop) => prop === '__esModule' ? true : jest.fn() }), { virtual: true });\n\n`);
    }
    if (/mathjs/i.test(codeToInspect)) {
        detectedDependencies.push("mathjs");
        thirdPartyMockCode += `// 7.7 Mock mathjs (Arithmetic Evaluator & Compilers)\n` +
            (isVitest
                ? `vi.mock('mathjs', () => {\n` +
                  `  const __mockMathEvaluator = {\n` +
                  `    evaluate: vi.fn((expr, scope) => {\n` +
                  `      if (typeof expr === 'number') return expr;\n` +
                  `      if (typeof expr === 'string') {\n` +
                  `        try {\n` +
                  `          const sanitized = expr.replace(/[^0-9+\\-*\\/().\\s]/g, '');\n` +
                  `          return sanitized ? Function('"use strict"; return (' + sanitized + ')')() : 0;\n` +
                  `        } catch (_) { return 0; }\n` +
                  `      }\n` +
                  `      return 0;\n` +
                  `    }),\n` +
                  `    compile: vi.fn((expr) => ({\n` +
                  `      evaluate: vi.fn((scope) => typeof expr === 'number' ? expr : 0)\n` +
                  `    })),\n` +
                  `    parse: vi.fn((expr) => ({\n` +
                  `      compile: vi.fn(() => ({ evaluate: vi.fn(() => 0) })),\n` +
                  `      evaluate: vi.fn(() => 0)\n` +
                  `    })),\n` +
                  `    simplify: vi.fn((expr) => expr),\n` +
                  `    derivative: vi.fn(() => ({ evaluate: vi.fn(() => 0) })),\n` +
                  `    add: vi.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a + b : 0)),\n` +
                  `    subtract: vi.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : 0)),\n` +
                  `    multiply: vi.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a * b : 0)),\n` +
                  `    divide: vi.fn((a, b) => (typeof a === 'number' && typeof b === 'number' && b !== 0 ? a / b : 0))\n` +
                  `  };\n` +
                  `  const create = vi.fn(() => __mockMathEvaluator);\n` +
                  `  const all = {};\n` +
                  `  return {\n` +
                  `    create,\n` +
                  `    all,\n` +
                  `    ...__mockMathEvaluator,\n` +
                  `    default: {\n` +
                  `      create,\n` +
                  `      all,\n` +
                  `      ...__mockMathEvaluator\n` +
                  `    }\n` +
                  `  };\n` +
                  `});\n\n`
                : `jest.mock('mathjs', () => {\n` +
                  `  const __mockMathEvaluator = {\n` +
                  `    evaluate: jest.fn((expr, scope) => {\n` +
                  `      if (typeof expr === 'number') return expr;\n` +
                  `      if (typeof expr === 'string') {\n` +
                  `        try {\n` +
                  `          const sanitized = expr.replace(/[^0-9+\\-*\\/().\\s]/g, '');\n` +
                  `          return sanitized ? Function('"use strict"; return (' + sanitized + ')')() : 0;\n` +
                  `        } catch (_) { return 0; }\n` +
                  `      }\n` +
                  `      return 0;\n` +
                  `    }),\n` +
                  `    compile: jest.fn((expr) => ({\n` +
                  `      evaluate: jest.fn((scope) => typeof expr === 'number' ? expr : 0)\n` +
                  `    })),\n` +
                  `    parse: jest.fn((expr) => ({\n` +
                  `      compile: jest.fn(() => ({ evaluate: jest.fn(() => 0) })),\n` +
                  `      evaluate: jest.fn(() => 0)\n` +
                  `    })),\n` +
                  `    simplify: jest.fn((expr) => expr),\n` +
                  `    derivative: jest.fn(() => ({ evaluate: jest.fn(() => 0) })),\n` +
                  `    add: jest.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a + b : 0)),\n` +
                  `    subtract: jest.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : 0)),\n` +
                  `    multiply: jest.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a * b : 0)),\n` +
                  `    divide: jest.fn((a, b) => (typeof a === 'number' && typeof b === 'number' && b !== 0 ? a / b : 0))\n` +
                  `  };\n` +
                  `  const create = jest.fn(() => __mockMathEvaluator);\n` +
                  `  const all = {};\n` +
                  `  return {\n` +
                  `    create,\n` +
                  `    all,\n` +
                  `    ...__mockMathEvaluator,\n` +
                  `    default: {\n` +
                  `      create,\n` +
                  `      all,\n` +
                  `      ...__mockMathEvaluator\n` +
                  `    }\n` +
                  `  };\n` +
                  `}, { virtual: true });\n\n`);
    }

    // Inject virtual isolation mocks for uninstalled transitive external dependencies
    for (const tPkg of transitiveMissingExternalPackages) {
        if (!detectedDependencies.includes(tPkg) && !["mathjs", "sonner", "react-toastify", "lucide-react", "framer-motion", "next-themes", "radix-ui", "langchain-sdk"].includes(tPkg)) {
            detectedDependencies.push(tPkg);
            thirdPartyMockCode += isVitest
                ? `vi.mock('${tPkg}', () => {\n  const handler = { get: (_, p) => p === '__esModule' ? true : (p === 'then' || p === 'catch' || typeof p === 'symbol') ? undefined : new Proxy(vi.fn(), handler) };\n  const mockObj = new Proxy(vi.fn(), handler);\n  return Object.assign(new Proxy({}, handler), { default: mockObj });\n});\n\n`
                : `jest.mock('${tPkg}', () => {\n  const handler = { get: (_, p) => p === '__esModule' ? true : (p === 'then' || p === 'catch' || typeof p === 'symbol') ? undefined : new Proxy(jest.fn(), handler) };\n  const mockObj = new Proxy(jest.fn(), handler);\n  return Object.assign(new Proxy({}, handler), { default: mockObj });\n}, { virtual: true });\n\n`;
        }
    }

    // 8. Detect Downstream Local Services & Models (Pure RAM Isolation)
    const localRequires = [...new Set([...sourceCode.matchAll(/(?:require\s*\(\s*['"](\.[^'"]+)['"]\s*\)|from\s+['"](\.[^'"]+)['"])/g)].map(m => m[1] || m[2]))]
        .filter(reqPath => !/(?:\/types\/|\.d\.ts$|definition)/i.test(reqPath))
        .filter(reqPath => !/(?:^|[\\/])(?:utils?|helpers?|validators?|formatters?|math|evaluator|presets?|constants?|locales?|fixtures?|types?|schemas?|data|tier\d+)(?:[\\/]|$|\.|$)/i.test(reqPath))
        .filter(reqPath => !usesPrisma || !/prisma/i.test(reqPath));
    let localServicesMockCode = "";
    if (localRequires.length > 0) {
        detectedDependencies.push("downstream-local-services");
        if (isVitest) {
            localServicesMockCode = `// 8. Universal RAM Mocks for Downstream Local Dependencies\n` +
                `const { mockCreateUniversalStub, setStubRejectMode } = vi.hoisted(() => {\n` +
                `  let shouldReject = false;\n` +
                `  const fnMaker = typeof vi !== 'undefined' ? vi.fn : (() => ({}));\n` +
                `  const stubFn = () => fnMaker(() => {\n` +
                `    if (shouldReject) return Promise.reject(new Error('Mocked downstream failure'));\n` +
                `    return Promise.resolve({ id: 1, name: 'Sample Item', title: 'Sample Title', status: 'ACTIVE', score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90, filename: 'sample.pdf', analysis: { score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90 }, toJSON() { return { id: 1, score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90 }; } });\n` +
                `  });\n` +
                `  const handler = {\n` +
                `    get: (target, prop) => {\n` +
                `      if (prop === Symbol.iterator) return function* () { yield* []; };\n` +
                `      if (prop === Symbol.asyncIterator) return async function* () { yield* []; };\n` +
                `      if (prop === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');\n` +
                `      if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n` +
                `      if (prop === '__esModule') return true;\n` +
                `      if (prop === 'populate' || prop === 'sort' || prop === 'limit' || prop === 'skip' || prop === 'select' || prop === 'where') return () => new Proxy(stubFn(), handler);\n` +
                `      if (prop === 'exec' || prop === 'lean') return () => Promise.resolve([{ id: 1, name: 'Sample Item' }]);\n` +
                `      if (prop === 'countDocuments') return () => Promise.resolve(5);\n` +
                `      if (prop === 'create') return (doc) => Promise.resolve({ id: 1, ...doc });\n` +
                `      if (prop === 'deleteOne' || prop === 'deleteMany') return () => Promise.resolve({ deletedCount: 1 });\n` +
                `      if (!(prop in target)) {\n` +
                `        if (prop === 'default') target[prop] = new Proxy(stubFn(), handler);\n` +
                `        else target[prop] = new Proxy(stubFn(), handler);\n` +
                `      }\n` +
                `      return target[prop];\n` +
                `    },\n` +
                `    has: (target, prop) => {\n` +
                `      if (prop === 'then' || prop === 'catch') return false;\n` +
                `      return true;\n` +
                `    },\n` +
                `    apply: () => Promise.resolve({ id: 1, name: 'Sample Item' })\n` +
                `  };\n` +
                `  const universalStub = new Proxy({}, handler);\n` +
                `  return {\n` +
                `    mockCreateUniversalStub: () => universalStub,\n` +
                `    setStubRejectMode: (mode) => { shouldReject = Boolean(mode); }\n` +
                `  };\n` +
                `});\n`;
            for (const reqPath of localRequires) {
                const mockPaths = [reqPath];
                if (sourceFile && targetTestFile) {
                    try {
                        const srcDir = path.dirname(sourceFile.replace(/\\/g, "/"));
                        const testDir = path.dirname(targetTestFile.replace(/\\/g, "/"));
                        const resolvedTarget = path.normalize(path.join(srcDir, reqPath)).replace(/\\/g, "/");
                        let testRelPath = path.relative(testDir, resolvedTarget).replace(/\\/g, "/");
                        if (!testRelPath.startsWith(".")) testRelPath = "./" + testRelPath;
                        if (!mockPaths.includes(testRelPath)) mockPaths.push(testRelPath);
                    } catch (_) {}
                }
                for (const p of mockPaths) {
                    localServicesMockCode += `vi.mock('${p}', () => mockCreateUniversalStub());\n`;
                }
            }
            localServicesMockCode += "\n";
        } else {
            localServicesMockCode = `// 8. Universal RAM Mocks for Downstream Local Dependencies\n` +
                `var _mockShouldReject = false;\n` +
                `var setStubRejectMode = globalThis.__setStubRejectMode = (mode) => { _mockShouldReject = Boolean(mode); };\n` +
                `var _createStubMaker = () => {\n` +
                `  const fnMaker = typeof jest !== 'undefined' ? jest.fn : (() => ({}));\n` +
                `  const stubFn = () => fnMaker(() => {\n` +
                `    if (_mockShouldReject) return Promise.reject(new Error('Mocked downstream failure'));\n` +
                `    return Promise.resolve({ id: 1, name: 'Sample Item', title: 'Sample Title', status: 'ACTIVE', score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90, filename: 'sample.pdf', analysis: { score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90 }, toJSON() { return { id: 1, score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90 }; } });\n` +
                `  });\n` +
                `  const baseTarget = {\n` +
                `    models: new Proxy({}, { get: (t, p) => (p === 'then' ? undefined : (t[p] || (t[p] = stubFn()))) }),\n` +
                `    AppError: class extends Error { statusCode; details; constructor(sc, m, d) { super(m); this.statusCode = sc; this.details = d; } },\n` +
                `    asyncHandler: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),\n` +
                `    errorMiddleware: fnMaker((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }))\n` +
                `  };\n` +
                `  const handler = {\n` +
                `    get: (target, prop) => {\n` +
                `      if (prop === Symbol.iterator) return function* () { yield* []; };\n` +
                `      if (prop === Symbol.asyncIterator) return async function* () { yield* []; };\n` +
                `      if (prop === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');\n` +
                `      if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;\n` +
                `      if (prop === '__esModule') return true;\n` +
                `      if (!(prop in target)) {\n` +
                `        if (prop === 'default') target[prop] = target;\n` +
                `        else {\n` +
                `          const fn = stubFn();\n` +
                `          target[prop] = new Proxy(fn, handler);\n` +
                `        }\n` +
                `      }\n` +
                `      return target[prop];\n` +
                `    },\n` +
                `    has: (target, prop) => (prop !== 'then' && prop !== 'catch')\n` +
                `  };\n` +
                `  return new Proxy(baseTarget, handler);\n` +
                `};\n` +
                `var mockCreateUniversalStub = globalThis.__mockCreateUniversalStub = globalThis.__mockCreateUniversalStub || (() => _createStubMaker());\n`;
            for (const reqPath of localRequires) {
                const mockPaths = [reqPath];
                if (sourceFile && targetTestFile) {
                    try {
                        const srcDir = path.dirname(sourceFile.replace(/\\/g, "/"));
                        const testDir = path.dirname(targetTestFile.replace(/\\/g, "/"));
                        const resolvedTarget = path.normalize(path.join(srcDir, reqPath)).replace(/\\/g, "/");
                        let testRelPath = path.relative(testDir, resolvedTarget).replace(/\\/g, "/");
                        if (!testRelPath.startsWith(".")) testRelPath = "./" + testRelPath;
                        if (!mockPaths.includes(testRelPath)) mockPaths.push(testRelPath);
                    } catch (_) {}
                }
                for (const p of mockPaths) {
                    localServicesMockCode += `jest.mock('${p}', () => {\n` +
                        `  const maker = (typeof mockCreateUniversalStub === 'function' ? mockCreateUniversalStub : globalThis.__mockCreateUniversalStub);\n` +
                        `  if (typeof maker === 'function') return maker();\n` +
                        `  const fnM = typeof jest !== 'undefined' ? jest.fn : (() => ({}));\n` +
                        `  const stubFn = () => fnM(() => Promise.resolve({ id: 1, name: 'Sample Item', status: 'ACTIVE', score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90, filename: 'sample.pdf', analysis: { score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90 }, toJSON() { return { id: 1, score: 85, ambiguity: 15, clarity: 85, completeness: 90, consistency: 90 }; } }));\n` +
                        `  const handler = {\n` +
                        `    get: (t, p) => {\n` +
                        `      if (p === Symbol.iterator) return function* () { yield* []; };\n` +
                        `      if (p === Symbol.asyncIterator) return async function* () { yield* []; };\n` +
                        `      if (p === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');\n` +
                        `      if (p === '__esModule') return true;\n` +
                        `      if (p === 'then' || p === 'catch' || typeof p === 'symbol') return undefined;\n` +
                        `      if (!(p in t)) {\n` +
                        `        if (p === 'default') t[p] = t;\n` +
                        `        else {\n` +
                        `          const fn = stubFn();\n` +
                        `          t[p] = new Proxy(fn, handler);\n` +
                        `        }\n` +
                        `      }\n` +
                        `      return t[p];\n` +
                        `    }\n` +
                        `  };\n` +
                        `  return new Proxy({}, handler);\n` +
                        `}, { virtual: true });\n`;
                }
            }
            localServicesMockCode += "\n";
        }
    }

    const trimmedPreamble = `${envMockCode}${prismaMockCode}${mongooseMockCode}${bcryptMockCode}${sequelizeMockCode}${redisMockCode}${axiosMockCode}${bullMockCode}${configMockCode}${thirdPartyMockCode}${localServicesMockCode}${controllerMockCode}${timersMockCode}`.trim();
    const mockPreambleCode = trimmedPreamble ? trimmedPreamble + "\n\n" : "";

    const mockInstructions = [
        "MANDATORY ISOLATION MOCK CONTRACTS:",
        "- All unit tests MUST execute purely in RAM without network, real database, or external processes.",
        detectedDependencies.includes("prisma-db") ? "- Prisma DB: Re-use the Prisma Proxy Mock. Never connect to a real database. (Prisma DB: Re-use the self-contained in-memory Prisma Proxy Mock). Both '@prisma/client' and local database singletons ('../config/prisma', '../lib/prisma', etc.) MUST be mocked before any controller or service imports to prevent top-level 'new PrismaClient()' execution and PrismaClientInitializationError in Prisma v7 environments." : null,
        detectedDependencies.includes("mongoose-db") ? "- Mongoose DB: Mongoose models are mocked with in-memory proxy. Queries resolve mock documents without connecting to MongoDB." : null,
        detectedDependencies.includes("bcrypt-crypto") ? "- Password Hashing (Bcrypt): Bcrypt functions (hash, compare) are stubbed in RAM. Never run expensive native hashing in tests." : null,
        detectedDependencies.includes("sequelize-db") ? "- Sequelize DB: Sequelize models and queries are mocked in RAM. Queries resolve mock instances without DB connections." : null,
        detectedDependencies.includes("redis-cache") ? "- Redis Cache: Redis/ioredis operations are routed to in-memory mock client (get, set, del, keys, flushall). Never connect to a real Redis server." : null,
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
 * CONTEXT ASSEMBLER (STAGE 2 ORCHESTRATION)
 *
 * Integrates AST Analysis (Phase 1) and Context Engineering (Phase 2)
 * into a single unified context payload for LLM Prompt Builder or Test Generator.
 */
export const assembleUnitTestContext = ({
    sourceCode = "",
    coverageDetails = null,
    framework = "jest",
    existingTestCode = "",
    sourceFile = null,
    targetTestFile = null,
    rootDir = null
}) => {
    // 1. Phase 1: AST Analysis & Coverage Gap Mapping
    const astMetadata = analyzeSourceAst(sourceCode);
    const coverageGaps = mapCoverageGaps({
        astMetadata,
        fileCoverageData: coverageDetails?.rawCoverageData || coverageDetails,
        sourceCode,
        uncoveredLinesList: coverageDetails?.uncoveredLines || []
    });

    // 2. Phase 2: Decision Table Matrix (with existing test code inspection & delta matrix)
    const decisionTable = buildDecisionTableMatrix({
        astMetadata,
        coverageGaps,
        sourceCode,
        existingTestCode
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
        framework,
        sourceFile,
        targetTestFile,
        rootDir
    });

    // 5. Build Engineered Context Prompt Block
    const engineeredPromptContext = [
        `### SECTION 1: PUBLIC APIS & INDIRECT TESTING DIRECTIVE`,
        `Exported Public Symbols: ${(astMetadata?.exportedSymbolNames || []).filter(Boolean).join(", ") || "All exported members"}`,
        indirectTesting.indirectGuidancePrompt,
        "",
        `### SECTION 2: ISOLATION MOCK CONTRACTS`,
        mockContracts.mockInstructions,
        mockContracts.mockPreambleCode ? `\n#### MANDATORY ISOLATION MOCK PREAMBLE (MUST BE PLACED AT VERY TOP OF FILE BEFORE IMPORTS):\n\`\`\`javascript\n${mockContracts.mockPreambleCode.trim()}\n\`\`\`` : "",
        "",
        `### SECTION 3: MANDATORY DECISION TABLE TEST MATRIX & TARGETED DELTA (TARGETING >=90% TO 100% COVERAGE)`,
        `Total Test Scenarios Required: ${decisionTable.summary.totalTestCases} (Happy Path: ${decisionTable.summary.happyPathCount}, Boundary: ${decisionTable.summary.boundaryCount}, Branch: ${decisionTable.summary.branchTogglingCount}, Error: ${decisionTable.summary.errorHandlingCount})`,
        `Already Tested Scenarios (DO NOT REPEAT): ${decisionTable.summary.alreadyTestedCount || 0}`,
        `Feasible Scenarios Remaining: ${decisionTable.summary.deltaCount || 0}`,
        `Unreachable / Infeasible Branches Excluded: ${decisionTable.summary.infeasibleCount || 0}`,
        "",
        `#### COMPLEMENTARY DELTA SCENARIOS TO GENERATE:`,
        decisionTable.deltaDecisionTableMarkdown,
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

/**
 * Generates an isolated, universal in-memory mock for mathjs with arithmetic and evaluator capabilities.
 */
export const generateMathjsMockCode = (framework = "vitest") => {
    const isVitest = framework === "vitest";
    return isVitest
        ? `vi.mock('mathjs', () => {\n` +
          `  const __mockMathEvaluator = {\n` +
          `    evaluate: vi.fn((expr, scope) => {\n` +
          `      if (typeof expr === 'number') return expr;\n` +
          `      if (typeof expr === 'string') {\n` +
          `        try {\n` +
          `          const sanitized = expr.replace(/[^0-9+\\-*\\/().\\s]/g, '');\n` +
          `          return sanitized ? Function('"use strict"; return (' + sanitized + ')')() : 0;\n` +
          `        } catch (_) { return 0; }\n` +
          `      }\n` +
          `      return 0;\n` +
          `    }),\n` +
          `    compile: vi.fn((expr) => ({\n` +
          `      evaluate: vi.fn((scope) => typeof expr === 'number' ? expr : 0)\n` +
          `    })),\n` +
          `    parse: vi.fn((expr) => ({\n` +
          `      compile: vi.fn(() => ({ evaluate: vi.fn(() => 0) })),\n` +
          `      evaluate: vi.fn(() => 0)\n` +
          `    })),\n` +
          `    simplify: vi.fn((expr) => expr),\n` +
          `    derivative: vi.fn(() => ({ evaluate: vi.fn(() => 0) })),\n` +
          `    add: vi.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a + b : 0)),\n` +
          `    subtract: vi.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : 0)),\n` +
          `    multiply: vi.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a * b : 0)),\n` +
          `    divide: vi.fn((a, b) => (typeof a === 'number' && typeof b === 'number' && b !== 0 ? a / b : 0))\n` +
          `  };\n` +
          `  const create = vi.fn(() => __mockMathEvaluator);\n` +
          `  const all = {};\n` +
          `  return {\n` +
          `    create,\n` +
          `    all,\n` +
          `    ...__mockMathEvaluator,\n` +
          `    default: {\n` +
          `      create,\n` +
          `      all,\n` +
          `      ...__mockMathEvaluator\n` +
          `    }\n` +
          `  };\n` +
          `});`
        : `jest.mock('mathjs', () => {\n` +
          `  const __mockMathEvaluator = {\n` +
          `    evaluate: jest.fn((expr, scope) => {\n` +
          `      if (typeof expr === 'number') return expr;\n` +
          `      if (typeof expr === 'string') {\n` +
          `        try {\n` +
          `          const sanitized = expr.replace(/[^0-9+\\-*\\/().\\s]/g, '');\n` +
          `          return sanitized ? Function('"use strict"; return (' + sanitized + ')')() : 0;\n` +
          `        } catch (_) { return 0; }\n` +
          `      }\n` +
          `      return 0;\n` +
          `    }),\n` +
          `    compile: jest.fn((expr) => ({\n` +
          `      evaluate: jest.fn((scope) => typeof expr === 'number' ? expr : 0)\n` +
          `    })),\n` +
          `    parse: jest.fn((expr) => ({\n` +
          `      compile: jest.fn(() => ({ evaluate: jest.fn(() => 0) })),\n` +
          `      evaluate: jest.fn(() => 0)\n` +
          `    })),\n` +
          `    simplify: jest.fn((expr) => expr),\n` +
          `    derivative: jest.fn(() => ({ evaluate: jest.fn(() => 0) })),\n` +
          `    add: jest.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a + b : 0)),\n` +
          `    subtract: jest.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : 0)),\n` +
          `    multiply: jest.fn((a, b) => (typeof a === 'number' && typeof b === 'number' ? a * b : 0)),\n` +
          `    divide: jest.fn((a, b) => (typeof a === 'number' && typeof b === 'number' && b !== 0 ? a / b : 0))\n` +
          `  };\n` +
          `  const create = jest.fn(() => __mockMathEvaluator);\n` +
          `  const all = {};\n` +
          `  return {\n` +
          `    create,\n` +
          `    all,\n` +
          `    ...__mockMathEvaluator,\n` +
          `    default: {\n` +
          `      create,\n` +
          `      all,\n` +
          `      ...__mockMathEvaluator\n` +
          `    }\n` +
          `  };\n` +
          `}, { virtual: true });`;
};
