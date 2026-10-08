import fs from "fs";
import path from "path";
import { parseJavaScriptCode } from "./babelParser.service.js";

/**
 * Normalizes file path to forward slashes without leading slashes or dots.
 */
export const normalizeRelativePath = (p = "") => {
    return p.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
};

/**
 * 1.1 PHÂN LOẠI VÀ NHẬN DIỆN FILE NGHIỆP VỤ MỤC TIÊU
 *
 * Checks if a relative or absolute file path corresponds to genuine Business Logic:
 * - Services: src/services/**
 * - Handlers: src/handlers/**
 * - Controllers: src/controllers/**
 * - Utils & Helpers: src/utils/**, src/helpers/**, src/lib/**
 * - Models & Middlewares: src/models/**, src/middlewares/**
 *
 * Strictly excludes:
 * - Test files (*.test.*, *.spec.*, *.testcase.*, *.steps.*, tests/**, __tests__/**)
 * - Mocks & fixtures (__mocks__/**, mocks/**, fixtures/**, stubs/**)
 * - Configs (jest.config.*, vite.config.*, tsconfig*.json, package.json)
 * - Dependencies & builds (node_modules/**, coverage/**, dist/**, build/**, .git/**)
 * - Frontend UI (client/**, frontend/**, components/**, *.jsx, *.tsx, *.vue, *.svelte)
 * - Routes and server entry points (routes/**, endpoints/**, app.js, server.js, index.js, main.js)
 */
export const isBusinessLogicFile = (filePath = "") => {
    if (!filePath || typeof filePath !== "string") return false;
    const norm = normalizeRelativePath(filePath).toLowerCase();

    // 1. Must be JavaScript or TypeScript
    if (!/\.[cm]?[jt]s$/i.test(norm)) return false;

    // 2. Reject TypeScript declaration files
    if (/\.d\.ts$/i.test(norm)) return false;

    // 3. Reject tests
    if (
        /\.(test|spec|testcase|steps)\.[cm]?[jt]s$/i.test(norm) ||
        /(^|\/)(tests?|__tests__|specs?|unit|step_definitions)\//i.test(norm)
    ) {
        return false;
    }

    // 4. Reject mocks and fixtures
    if (
        /(^|\/)(mocks?|__mocks__|fixtures?|stubs?)\//i.test(norm) ||
        /\.(mock|fixture|stub)\.[cm]?[jt]s$/i.test(norm)
    ) {
        return false;
    }

    // 5. Reject setup / teardown / helper files for test runners
    const baseName = path.basename(norm);
    if (/^(setup|global-?setup|setup-?tests|teardown|fixtures?)\.[a-z0-9]+$/i.test(baseName)) {
        return false;
    }

    // 6. Reject configs
    if (/^(jest|vitest|babel|webpack|vite|rollup|eslint|prettier|tailwind|postcss)\.config\.[a-z0-9]+$/i.test(baseName)) {
        return false;
    }

    // 7. Reject dependencies and build outputs
    if (/(^|\/)(node_modules|coverage|dist|build|\.git|\.next|\.turbo|out)\//i.test(norm)) {
        return false;
    }

    // 8. Reject frontend UI code
    if (/(^|\/)(client|frontend|components|views|pages)\//i.test(norm)) {
        return false;
    }

    // 9. Reject route and server entry files (reserved for integration/system testing)
    const isTopLevelEntry = /^(src\/|app\/|server\/|backend\/)?(index|main)\.[cm]?[jt]sx?$/i.test(norm.replace(/^\.?\//, ""));
    const isRouteOrEntry = /(^|\/)(routes?|endpoints?)(\/|\.|$)/i.test(norm) ||
        /\.(route|routes)\.[cm]?[jt]sx?$/i.test(norm) ||
        /(^|\/)(app|server)\.[cm]?[jt]sx?$/i.test(norm) ||
        isTopLevelEntry;
    if (isRouteOrEntry) {
        return false;
    }

    // 10. Check if it matches genuine business logic patterns
    const isBusinessLayer =
        /(^|\/)(services?|handlers?|controllers?|utils?|helpers?|models?|middlewares?|lib|domain|core|use-?cases?)(\/|\.|$)/i.test(norm) ||
        /\.(service|handler|controller|util|helper|model|middleware)\.[cm]?[jt]s$/i.test(norm);

    // If within src/, app/, or backend/, treat non-route JS/TS files as logic
    const isInSrcOrApp = /^(src|app|backend|server)\//i.test(norm);

    return isBusinessLayer || isInSrcOrApp;
};

/**
 * Scans a project root directory and categorizes all business logic files.
 * @param {string} rootDir
 * @returns {{ services: string[], handlers: string[], controllers: string[], utils: string[], models: string[], middlewares: string[], all: string[] }}
 */
export const classifyBusinessLogicFiles = (rootDir) => {
    if (!rootDir || !fs.existsSync(rootDir)) {
        return { services: [], handlers: [], controllers: [], utils: [], models: [], middlewares: [], all: [] };
    }

    const categories = {
        services: [],
        handlers: [],
        controllers: [],
        utils: [],
        models: [],
        middlewares: [],
        all: []
    };

    const walk = (currentDir) => {
        let entries = [];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = normalizeRelativePath(path.relative(rootDir, fullPath));
            const lowerRel = relPath.toLowerCase();

            if (entry.isDirectory()) {
                if (!/^(node_modules|coverage|dist|build|\.git|client|frontend)$/i.test(entry.name)) {
                    walk(fullPath);
                }
            } else if (entry.isFile()) {
                if (isBusinessLogicFile(relPath)) {
                    categories.all.push(relPath);
                    if (/(^|\/)services?(\/|\.)/i.test(lowerRel)) categories.services.push(relPath);
                    else if (/(^|\/)handlers?(\/|\.)/i.test(lowerRel)) categories.handlers.push(relPath);
                    else if (/(^|\/)controllers?(\/|\.)/i.test(lowerRel)) categories.controllers.push(relPath);
                    else if (/(^|\/)(utils?|helpers?|lib)(\/|\.)/i.test(lowerRel)) categories.utils.push(relPath);
                    else if (/(^|\/)models?(\/|\.)/i.test(lowerRel)) categories.models.push(relPath);
                    else if (/(^|\/)middlewares?(\/|\.)/i.test(lowerRel)) categories.middlewares.push(relPath);
                }
            }
        }
    };

    walk(rootDir);
    categories.all.sort();
    return categories;
};

/**
 * 1.2 PHÂN TÍCH AST (ABSTRACT SYNTAX TREE) BẰNG BABEL PARSER
 *
 * Extracts deep architectural metadata from source code:
 * 1. Public Exported Symbols: APIs that tests are permitted to invoke.
 * 2. Private / Internal Functions: Helpers that must be tested INDIRECTLY.
 * 3. Decision Points & Exception Points: Branching conditionals and throw/catch statements.
 */
export const analyzeSourceAst = (sourceCode = "") => {
    const exportedSymbols = [];
    const internalFunctions = [];
    const decisionPoints = [];
    const exceptionPoints = [];

    if (!sourceCode || typeof sourceCode !== "string") {
        return { exportedSymbols, internalFunctions, decisionPoints, exceptionPoints };
    }

    const lines = sourceCode.split(/\r?\n/);
    const getLineText = (lineNum) => {
        if (!lineNum || lineNum < 1 || lineNum > lines.length) return "";
        return lines[lineNum - 1].trim();
    };

    const parseRes = parseJavaScriptCode(sourceCode);
    if (parseRes.success && parseRes.ast) {
        const exportedMap = new Map();
        const internalMap = new Map();
        const scopeStack = [];
        const callEdges = [];

        const extractParamNames = (params) => {
            if (!Array.isArray(params)) return [];
            return params.map(p => {
                if (!p) return "";
                if (p.type === "Identifier") return p.name;
                if (p.type === "AssignmentPattern" && p.left?.name) return p.left.name;
                if (p.type === "RestElement" && p.argument?.name) return `...${p.argument.name}`;
                if (p.type === "ObjectPattern") return "{...}";
                if (p.type === "ArrayPattern") return "[...]";
                return "";
            }).filter(Boolean);
        };

        const walk = (node, parent) => {
            if (!node || typeof node !== "object") return;

            let pushedScope = null;
            if (node.type === "FunctionDeclaration" && node.id?.name) {
                pushedScope = node.id.name;
            } else if (node.type === "VariableDeclarator" && node.id?.name && (node.init?.type === "ArrowFunctionExpression" || node.init?.type === "FunctionExpression")) {
                pushedScope = node.id.name;
            } else if (node.type === "ClassMethod" && node.key?.name) {
                pushedScope = node.key.name;
            }
            if (pushedScope) {
                scopeStack.push(pushedScope);
            }

            // --- 1. ESM EXPORTS ---
            if (node.type === "ExportNamedDeclaration") {
                if (node.declaration) {
                    if (node.declaration.id?.name) {
                        exportedMap.set(node.declaration.id.name, {
                            name: node.declaration.id.name,
                            type: node.declaration.type === "ClassDeclaration" ? "class" : "function",
                            line: node.loc?.start?.line || 1,
                            isDefault: false,
                            params: extractParamNames(node.declaration.params),
                            calls: []
                        });
                    }
                    if (Array.isArray(node.declaration.declarations)) {
                        for (const d of node.declaration.declarations) {
                            if (d.id?.name) {
                                const isFn = d.init?.type === "ArrowFunctionExpression" || d.init?.type === "FunctionExpression";
                                exportedMap.set(d.id.name, {
                                    name: d.id.name,
                                    type: isFn ? "function" : "constant",
                                    line: d.loc?.start?.line || node.loc?.start?.line || 1,
                                    isDefault: false,
                                    params: isFn ? extractParamNames(d.init?.params) : [],
                                    calls: []
                                });
                            }
                        }
                    }
                }
                if (Array.isArray(node.specifiers)) {
                    for (const s of node.specifiers) {
                        const name = s.exported?.name || s.local?.name;
                        if (name) {
                            exportedMap.set(name, {
                                name,
                                type: "named-export",
                                line: node.loc?.start?.line || 1,
                                isDefault: false,
                                params: [],
                                calls: []
                            });
                        }
                    }
                }
            } else if (node.type === "ExportDefaultDeclaration") {
                const name = node.declaration?.id?.name || "default";
                const isFn = node.declaration?.type === "FunctionDeclaration" || node.declaration?.type === "ArrowFunctionExpression";
                exportedMap.set(name, {
                    name,
                    type: node.declaration?.type === "ClassDeclaration" ? "class" : (isFn ? "function" : "default-export"),
                    line: node.loc?.start?.line || 1,
                    isDefault: true,
                    params: isFn ? extractParamNames(node.declaration.params) : [],
                    calls: []
                });
            }

            // --- 2. COMMONJS EXPORTS ---
            if (node.type === "AssignmentExpression" && node.left) {
                const leftStart = node.left.start;
                const leftEnd = node.left.end;
                const leftCode = typeof leftStart === "number" && typeof leftEnd === "number" ? sourceCode.slice(leftStart, leftEnd) : "";

                if (leftCode.startsWith("module.exports")) {
                    if (node.right?.type === "ObjectExpression") {
                        for (const prop of node.right.properties || []) {
                            const pName = prop.key?.name || prop.key?.value;
                            if (pName) {
                                exportedMap.set(pName, {
                                    name: pName,
                                    type: "function",
                                    line: prop.loc?.start?.line || node.loc?.start?.line || 1,
                                    isDefault: false,
                                    params: [],
                                    calls: []
                                });
                            }
                        }
                    } else if (node.right?.id?.name || node.right?.name) {
                        const idName = node.right.id?.name || node.right.name;
                        exportedMap.set(idName, {
                            name: idName,
                            type: "function",
                            line: node.loc?.start?.line || 1,
                            isDefault: true,
                            params: [],
                            calls: []
                        });
                    }
                } else if (leftCode.startsWith("exports.")) {
                    const propName = leftCode.replace(/^exports\./, "").trim();
                    if (propName) {
                        exportedMap.set(propName, {
                            name: propName,
                            type: "function",
                            line: node.loc?.start?.line || 1,
                            isDefault: false,
                            params: [],
                            calls: []
                        });
                    }
                }
            }

            // --- 3. MODULE-SCOPED FUNCTIONS (INTERNAL / PRIVATE HELPERS) ---
            if (parent && (parent.type === "Program" || parent.type === "BlockStatement")) {
                if (node.type === "FunctionDeclaration" && node.id?.name) {
                    const fnName = node.id.name;
                    if (!exportedMap.has(fnName)) {
                        internalMap.set(fnName, {
                            name: fnName,
                            line: node.loc?.start?.line || 1,
                            isAsync: node.async === true,
                            paramCount: Array.isArray(node.params) ? node.params.length : 0,
                            params: extractParamNames(node.params),
                            callers: [],
                            warning: "DO NOT IMPORT DIRECTLY - TEST INDIRECTLY VIA EXPORTED CALLER"
                        });
                    }
                } else if (node.type === "VariableDeclaration") {
                    for (const d of node.declarations || []) {
                        if (d.id?.name && (d.init?.type === "ArrowFunctionExpression" || d.init?.type === "FunctionExpression")) {
                            const fnName = d.id.name;
                            if (!exportedMap.has(fnName)) {
                                internalMap.set(fnName, {
                                    name: fnName,
                                    line: d.loc?.start?.line || node.loc?.start?.line || 1,
                                    isAsync: d.init?.async === true,
                                    paramCount: Array.isArray(d.init?.params) ? d.init.params.length : 0,
                                    params: extractParamNames(d.init?.params),
                                    callers: [],
                                    warning: "DO NOT IMPORT DIRECTLY - TEST INDIRECTLY VIA EXPORTED CALLER"
                                });
                            }
                        }
                    }
                }
            }

            // Track function call invocations for caller linkage
            if (node.type === "CallExpression") {
                const calleeName = node.callee?.name;
                if (calleeName && scopeStack.length > 0) {
                    const currentCaller = scopeStack[scopeStack.length - 1];
                    callEdges.push({ caller: currentCaller, callee: calleeName });
                }
            }

            // --- 4. DECISION POINTS (BRANCHING STRUCTURES) ---
            if (node.type === "IfStatement") {
                const line = node.loc?.start?.line;
                decisionPoints.push({
                    line,
                    type: "if",
                    text: getLineText(line),
                    consequentLine: node.consequent?.loc?.start?.line,
                    alternateLine: node.alternate?.loc?.start?.line || null,
                    hasElse: Boolean(node.alternate)
                });
            } else if (node.type === "ConditionalExpression") {
                const line = node.loc?.start?.line;
                decisionPoints.push({
                    line,
                    type: "ternary",
                    text: getLineText(line),
                    consequentLine: node.consequent?.loc?.start?.line,
                    alternateLine: node.alternate?.loc?.start?.line || null
                });
            } else if (node.type === "SwitchCase") {
                const line = node.loc?.start?.line;
                decisionPoints.push({
                    line,
                    type: "switch-case",
                    text: getLineText(line),
                    isDefault: node.test === null
                });
            } else if (node.type === "LogicalExpression" && (node.operator === "??" || node.operator === "||" || node.operator === "&&")) {
                const line = node.loc?.start?.line;
                decisionPoints.push({
                    line,
                    type: `logical(${node.operator})`,
                    operator: node.operator,
                    text: getLineText(line)
                });
            } else if (node.type === "OptionalMemberExpression" || node.type === "OptionalCallExpression") {
                const line = node.loc?.start?.line;
                decisionPoints.push({
                    line,
                    type: "optional-chaining(?.)",
                    text: getLineText(line)
                });
            } else if (node.type === "AssignmentPattern") {
                const paramName = node.left?.name;
                const line = node.loc?.start?.line;
                if (paramName && line) {
                    decisionPoints.push({
                        line,
                        type: "default-arg",
                        param: paramName,
                        text: getLineText(line)
                    });
                }
            }

            // --- 5. EXCEPTION POINTS (THROW, CATCH, REJECT) ---
            if (node.type === "ThrowStatement") {
                const line = node.loc?.start?.line;
                const pt = {
                    line,
                    type: "throw",
                    text: getLineText(line)
                };
                exceptionPoints.push(pt);
                decisionPoints.push(pt);
            } else if (node.type === "CatchClause") {
                const line = node.loc?.start?.line;
                const pt = {
                    line,
                    type: "catch",
                    text: getLineText(line),
                    param: node.param?.name || "err"
                };
                exceptionPoints.push(pt);
                decisionPoints.push(pt);
            } else if (node.type === "CallExpression") {
                if (node.callee?.property?.name === "reject" && node.callee?.object?.name === "Promise") {
                    const line = node.loc?.start?.line;
                    const pt = {
                        line,
                        type: "promise-reject",
                        text: getLineText(line)
                    };
                    exceptionPoints.push(pt);
                    decisionPoints.push(pt);
                }
            }

            for (const key of Object.keys(node)) {
                if (key === "loc" || key === "comments" || key === "leadingComments" || key === "trailingComments") continue;
                const child = node[key];
                if (Array.isArray(child)) {
                    for (const c of child) walk(c, node);
                } else if (child && typeof child === "object") {
                    walk(child, node);
                }
            }

            if (pushedScope) {
                scopeStack.pop();
            }
        };

        walk(parseRes.ast, null);

        // Resolve callers for internal functions and callee calls for exports
        for (const [name, meta] of exportedMap.entries()) {
            internalMap.delete(name);
            meta.calls = Array.from(new Set(callEdges.filter(c => c.caller === name).map(c => c.callee)));
            exportedSymbols.push(meta);
        }
        for (const [fnName, meta] of internalMap.entries()) {
            const callers = callEdges
                .filter(c => c.callee === fnName && c.caller !== fnName)
                .map(c => c.caller);
            meta.callers = Array.from(new Set(callers));
            internalFunctions.push(meta);
        }
    }

    // Resilient fallback if AST parsing could not discover exports
    if (exportedSymbols.length === 0) {
        const expMatches = [...sourceCode.matchAll(/export\s+(?:async\s+)?(?:default\s+)?(?:function|const|let|var|class)\s+([a-zA-Z0-9_$]+)/g)];
        for (const m of expMatches) {
            if (m[1] && !exportedSymbols.some(s => s.name === m[1])) {
                exportedSymbols.push({ name: m[1], type: "function", isDefault: false, line: 1, params: [], calls: [] });
            }
        }
        const namedExpMatches = [...sourceCode.matchAll(/export\s+\{([^}]+)\}/g)];
        for (const m of namedExpMatches) {
            for (const s of m[1].split(",")) {
                const clean = s.trim().split(/\s+as\s+/)[0].trim();
                if (clean && !exportedSymbols.some(item => item.name === clean)) {
                    exportedSymbols.push({ name: clean, type: "named-export", isDefault: false, line: 1, params: [], calls: [] });
                }
            }
        }
        const cjsObjMatch = sourceCode.match(/module\.exports\s*=\s*\{([^}]+)\}/s);
        if (cjsObjMatch) {
            for (const s of cjsObjMatch[1].split(",")) {
                const clean = s.trim().split(":")[0].trim();
                if (clean && /^[a-zA-Z0-9_$]+$/.test(clean) && !exportedSymbols.some(item => item.name === clean)) {
                    exportedSymbols.push({ name: clean, type: "function", isDefault: false, line: 1, params: [], calls: [] });
                }
            }
        }
    }

    if (internalFunctions.length === 0) {
        const fnMatches = [...sourceCode.matchAll(/(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g)];
        for (const m of fnMatches) {
            if (m[1] && !exportedSymbols.some(s => s.name === m[1]) && !internalFunctions.some(item => item.name === m[1])) {
                const callers = exportedSymbols
                    .filter(exp => new RegExp(`\\b${m[1]}\\s*\\(`).test(sourceCode))
                    .map(exp => exp.name);
                internalFunctions.push({
                    name: m[1],
                    line: 1,
                    callers: Array.from(new Set(callers)),
                    params: [],
                    warning: "DO NOT IMPORT DIRECTLY - TEST INDIRECTLY VIA EXPORTED CALLER"
                });
            }
        }
    }

    return {
        exportedSymbols,
        internalFunctions,
        decisionPoints,
        exceptionPoints,
        unexportedFunctions: internalFunctions.map(f => f.name),
        exportedSymbolNames: exportedSymbols.map(s => s.name)
    };
};

/**
 * 1.3 ÁNH XẠ VỚI coverage-final.json (ISTANBUL / V8)
 *
 * Bridges the AST analysis with Istanbul / v8 execution data to isolate:
 * - Uncovered Lines: Statements with 0 hits.
 * - Uncovered Branches: Branch decision paths with 0 hits.
 * - Uncovered Functions: Functions with 0 hits.
 * - Targeted Decision Guidance: Human & LLM actionable instructions.
 */
export const mapCoverageGaps = ({
    astMetadata = null,
    fileCoverageData = null,
    sourceCode = "",
    uncoveredLinesList = []
}) => {
    const codeLines = sourceCode ? sourceCode.split(/\r?\n/) : [];
    const getSnippet = (lineNum) => (codeLines[lineNum - 1] || "").trim();

    const uncoveredLines = new Set((uncoveredLinesList || []).map(Number));
    const uncoveredBranches = [];
    const uncoveredFunctions = [];

    // 1. Process statementMap & s for uncovered lines if fileCoverageData is provided
    if (fileCoverageData?.statementMap && fileCoverageData?.s) {
        for (const [id, range] of Object.entries(fileCoverageData.statementMap)) {
            const hits = fileCoverageData.s[id] ?? 0;
            if (hits === 0) {
                const startLine = range.start?.line || 1;
                const endLine = range.end?.line || startLine;
                for (let l = startLine; l <= endLine; l++) {
                    uncoveredLines.add(l);
                }
            }
        }
    }

    // 2. Process branchMap & b for uncovered branches (Istanbul format)
    if (fileCoverageData?.branchMap && fileCoverageData?.b) {
        for (const [id, branch] of Object.entries(fileCoverageData.branchMap)) {
            const counts = fileCoverageData.b[id] || [];
            const line = branch.line || branch.loc?.start?.line || 1;
            const type = branch.type || "if";

            const hitTrue = counts[0] ?? 0;
            const hitFalse = counts[1] ?? 0;

            const isTrueUncovered = hitTrue === 0;
            const isFalseUncovered = counts.length > 1 && hitFalse === 0;

            if (isTrueUncovered || isFalseUncovered) {
                uncoveredBranches.push({
                    branchId: id,
                    line,
                    type,
                    condition: getSnippet(line),
                    missedTrue: isTrueUncovered,
                    missedFalse: isFalseUncovered,
                    status: (hitTrue === 0 && hitFalse === 0) ? "entirely_uncovered" : "partially_uncovered"
                });
            }
        }
    } else if (Array.isArray(fileCoverageData?.branches || fileCoverageData?.branchFlow)) {
        // Formatted coverage array support
        const branchArray = fileCoverageData.branches || fileCoverageData.branchFlow;
        for (const b of branchArray) {
            if (b.status !== "fully_covered" || b.totalHits === 0) {
                const missedTrue = Array.isArray(b.paths) && b.paths.some(p => p.type?.toLowerCase().includes("branch 1") && !p.covered);
                const missedFalse = Array.isArray(b.paths) && b.paths.some(p => p.type?.toLowerCase().includes("branch 2") && !p.covered);
                uncoveredBranches.push({
                    branchId: b.id || `b-${b.line}`,
                    line: b.line,
                    type: b.type || "branch",
                    condition: b.condition || getSnippet(b.line),
                    missedTrue: missedTrue || b.status === "uncovered",
                    missedFalse: missedFalse || b.status === "uncovered",
                    status: b.status || "uncovered"
                });
            }
        }
    }

    // 3. Process fnMap & f for uncovered functions (Istanbul format)
    if (fileCoverageData?.fnMap && fileCoverageData?.f) {
        for (const [id, fn] of Object.entries(fileCoverageData.fnMap)) {
            const hits = fileCoverageData.f[id] ?? 0;
            if (hits === 0) {
                uncoveredFunctions.push({
                    fnId: id,
                    name: fn.name || "(anonymous)",
                    line: fn.line || fn.loc?.start?.line || 1,
                    hits: 0
                });
            }
        }
    } else if (Array.isArray(fileCoverageData?.functions || fileCoverageData?.functionFlow)) {
        // Formatted coverage array support
        const fnArray = fileCoverageData.functions || fileCoverageData.functionFlow;
        for (const f of fnArray) {
            if (!f.covered || f.hits === 0) {
                uncoveredFunctions.push({
                    fnId: f.id || `f-${f.line}`,
                    name: f.realName || f.name || "(anonymous)",
                    line: f.line || 1,
                    hits: f.hits || 0
                });
            }
        }
    }

    const sortedUncoveredLines = Array.from(uncoveredLines).filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);

    // 4. Generate Targeted Decision Guidance connecting AST decisionPoints to coverage gaps
    const targetedGuidance = [];
    const allDecisions = astMetadata?.decisionPoints || [];
    const allExceptions = astMetadata?.exceptionPoints || [];

    for (const dp of allDecisions) {
        const isLineUncovered = uncoveredLines.has(dp.line);
        const matchedBranch = uncoveredBranches.find(ub => Math.abs(ub.line - dp.line) <= 1);

        if (isLineUncovered || matchedBranch) {
            let detail = "";
            if (matchedBranch) {
                if (matchedBranch.missedTrue && matchedBranch.missedFalse) {
                    detail = "NEITHER True nor False path executed";
                } else if (matchedBranch.missedTrue) {
                    detail = "Missing TRUE path";
                } else if (matchedBranch.missedFalse) {
                    detail = "Missing FALSE path";
                }
            } else {
                detail = "Unexecuted condition block";
            }

            targetedGuidance.push({
                line: dp.line,
                type: dp.type.toUpperCase(),
                text: dp.text,
                status: "UNCOVERED",
                guidance: `Line ${dp.line} [${dp.type.toUpperCase()}]: "${dp.text}" -> ${detail}. (Craft test inputs to toggle this branch!)`
            });
        }
    }

    for (const ep of allExceptions) {
        if (uncoveredLines.has(ep.line)) {
            targetedGuidance.push({
                line: ep.line,
                type: ep.type.toUpperCase(),
                text: ep.text,
                status: "UNCOVERED_ERROR_PATH",
                guidance: `Line ${ep.line} [${ep.type.toUpperCase()}]: "${ep.text}" -> Exception path not triggered. (Pass invalid arguments or mock rejected promise to exercise this catch/throw statement!)`
            });
        }
    }

    return {
        uncoveredLines: sortedUncoveredLines,
        uncoveredBranches,
        uncoveredFunctions,
        targetedGuidance,
        guidanceSummary: targetedGuidance.map(g => `- ${g.guidance}`).join("\n") || "All identified decision points executed in current suite."
    };
};
