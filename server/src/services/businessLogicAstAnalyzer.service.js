import fs from "fs";
import path from "path";
import { parseJavaScriptCode } from "./babelParser.service.js";
import { detectInfeasibleAstNodes, isLocContained, isLocOverlapping } from "./unreachableCodeDetector.service.js";

/**
 * Normalizes file path to forward slashes without leading slashes or dots.
 */
export const normalizeRelativePath = (p = "") => {
    return p.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
};

import { isBusinessLogicSourceFile } from "../utils/businessLogicFileDetector.js";

/**
 * 1.1 CLASSIFY & IDENTIFY TARGET BUSINESS LOGIC FILES
 *
 * Checks if a relative or absolute file path corresponds to genuine Business Logic:
 * - Services: src/services/**
 * - Handlers: src/handlers/**
 * - Controllers: src/controllers/**
 * - Utils & Helpers: src/utils/**, src/helpers/**, src/lib/**
 * - Models & Middlewares: src/models/**, src/middlewares/**
 * - Core logic & Preset Services: src/core/**, src/presets/index.ts (modules with business functions)
 *
 * Strictly excludes:
 * - Test files (*.test.*, *.spec.*, *.testcase.*, *.steps.*, tests/**, __tests__/**)
 * - Mocks & fixtures (__mocks__/**, mocks/**, fixtures/**, stubs/**)
 * - Examples & Demos (examples/**, demo/**, samples/**)
 * - Configs (jest.config.*, vite.config.*, tsup.config.*, tsconfig*.json, package.json)
 * - TypeScript type definitions (*.d.ts, types.ts, *.types.ts, types/**)
 * - Static preset data catalogs & dictionaries (presets/tier*.ts, presets/data/**)
 * - Dependencies & builds (node_modules/**, coverage/**, dist/**, build/**, .git/**)
 * - Frontend UI & hooks & i18n (client/**, frontend/**, components/**, hooks/**, i18n/**, *.jsx, *.tsx)
 * - Routes and server entry points (routes/**, endpoints/**, app.js, server.js, index.js, main.js)
 */
export const isBusinessLogicFile = (filePath = "", configExclusions = []) => {
    if (typeof filePath === "string" && /(?:^|\/)(?:handlers|services|controllers|utils)\/[^/]+\.step\.[cm]?[jt]sx?$/i.test(filePath) && !/(?:tests?|__tests__|specs?|e2e)/i.test(filePath)) {
        return true;
    }
    return isBusinessLogicSourceFile(filePath, configExclusions);
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
                if (!/^(node_modules|coverage|dist|build|\.git|client|frontend|tests?|__tests__|specs?|e2e|cypress|playwright|fixtures|mocks|test[-_]data|test[-_]utils)$/i.test(entry.name)) {
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
 * 1.2 ABSTRACT SYNTAX TREE (AST) ANALYSIS VIA BABEL PARSER
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
    const declaredClasses = new Map();
    const declaredObjects = new Map();
    const declaredInstances = new Map();
    const mongooseModels = [];
    const callEdges = [];
    const sourceImports = new Map();

    if (!sourceCode || typeof sourceCode !== "string") {
        return {
            exportedSymbols,
            internalFunctions,
            decisionPoints,
            exceptionPoints,
            cyclomaticComplexity: 1,
            basisPathsCount: 1,
            classes: [],
            classMethods: [],
            declaredObjects: [],
            mongooseModels: [],
            unexportedFunctions: [],
            exportedSymbolNames: [],
            infeasibleNodes: [],
            ast: null,
            callEdges: [],
            imports: {},
            sourceImports: {},
            formattedImports: {}
        };
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

        const extractClassMethods = (classNode) => {
            const methods = [];
            let constructorParams = [];
            if (classNode?.body?.body) {
                for (const m of classNode.body.body) {
                    if (m.type === "ClassMethod") {
                        const mName = m.key?.name;
                        if (mName) {
                            if (m.kind === "constructor") {
                                constructorParams = extractParamNames(m.params);
                            } else {
                                methods.push({
                                    name: mName,
                                    isStatic: Boolean(m.static),
                                    isAsync: Boolean(m.async),
                                    kind: m.kind,
                                    params: extractParamNames(m.params),
                                    line: m.loc?.start?.line || 1
                                });
                            }
                        }
                    }
                }
            }
            return { methods, constructorParams };
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

            // --- 0. IMPORT DECLARATIONS (ESM & CJS) ---
            if (node.type === "ImportDeclaration") {
                const sourcePkg = node.source?.value;
                if (sourcePkg) {
                    if (!sourceImports.has(sourcePkg)) sourceImports.set(sourcePkg, { default: false, names: new Set(), namespace: false });
                    const entry = sourceImports.get(sourcePkg);
                    for (const spec of node.specifiers || []) {
                        if (spec.type === "ImportDefaultSpecifier") {
                            entry.default = true;
                        } else if (spec.type === "ImportNamespaceSpecifier") {
                            entry.namespace = true;
                        } else if (spec.type === "ImportSpecifier") {
                            const importedName = spec.imported?.name || spec.imported?.value;
                            if (importedName) entry.names.add(importedName);
                        }
                    }
                }
            } else if (node.type === "VariableDeclarator" && node.init?.type === "CallExpression") {
                const callee = node.init.callee;
                if (callee?.name === "require" && node.init.arguments?.[0]?.value) {
                    const sourcePkg = node.init.arguments[0].value;
                    if (!sourceImports.has(sourcePkg)) sourceImports.set(sourcePkg, { default: false, names: new Set(), namespace: false });
                    const entry = sourceImports.get(sourcePkg);
                    if (node.id?.type === "ObjectPattern") {
                        for (const prop of node.id.properties || []) {
                            const pName = prop.key?.name || prop.key?.value;
                            if (pName) entry.names.add(pName);
                        }
                    } else if (node.id?.type === "Identifier") {
                        entry.default = true;
                    }
                }
            }

            // --- Track Class Declarations & Expressions ---
            if (node.type === "ClassDeclaration" && node.id?.name) {
                const { methods, constructorParams } = extractClassMethods(node);
                declaredClasses.set(node.id.name, {
                    name: node.id.name,
                    methods,
                    constructorParams,
                    line: node.loc?.start?.line || 1
                });
            } else if (node.type === "VariableDeclarator" && node.id?.name && node.init?.type === "ClassExpression") {
                const { methods, constructorParams } = extractClassMethods(node.init);
                declaredClasses.set(node.id.name, {
                    name: node.id.name,
                    methods,
                    constructorParams,
                    line: node.loc?.start?.line || 1
                });
            }

            // --- Track Instantiations: const x = new ClassName() ---
            if (node.type === "VariableDeclarator" && node.id?.name && node.init?.type === "NewExpression") {
                const className = node.init.callee?.name;
                if (className) {
                    declaredInstances.set(node.id.name, { className, varName: node.id.name });
                }
            }

            // --- Track Object Literals with functions: const x = { async foo() {} } ---
            if (node.type === "VariableDeclarator" && node.id?.name && node.init?.type === "ObjectExpression") {
                const objName = node.id.name;
                const objMethods = [];
                for (const prop of node.init.properties || []) {
                    const pName = prop.key?.name || prop.key?.value;
                    if (pName) {
                        if (prop.type === "ObjectMethod") {
                            objMethods.push({
                                name: pName,
                                isAsync: Boolean(prop.async),
                                params: extractParamNames(prop.params),
                                line: prop.loc?.start?.line || 1
                            });
                        } else if (prop.value?.type === "ArrowFunctionExpression" || prop.value?.type === "FunctionExpression") {
                            objMethods.push({
                                name: pName,
                                isAsync: Boolean(prop.value.async),
                                params: extractParamNames(prop.value.params),
                                line: prop.loc?.start?.line || 1
                            });
                        }
                    }
                }
                if (objMethods.length > 0) {
                    declaredObjects.set(objName, { name: objName, methods: objMethods, line: node.loc?.start?.line || 1 });
                }
            }

            // --- 1. ESM EXPORTS ---
            if (node.type === "ExportNamedDeclaration") {
                if (node.declaration) {
                    if (node.declaration.id?.name) {
                        const isClass = node.declaration.type === "ClassDeclaration";
                        const classInfo = isClass ? extractClassMethods(node.declaration) : null;
                        if (isClass) {
                            declaredClasses.set(node.declaration.id.name, {
                                name: node.declaration.id.name,
                                methods: classInfo.methods,
                                constructorParams: classInfo.constructorParams,
                                line: node.loc?.start?.line || 1
                            });
                        }
                        exportedMap.set(node.declaration.id.name, {
                            name: node.declaration.id.name,
                            type: isClass ? "class" : "function",
                            line: node.loc?.start?.line || 1,
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc,
                            isDefault: false,
                            params: isClass ? classInfo.constructorParams : extractParamNames(node.declaration.params),
                            methods: isClass ? classInfo.methods : [],
                            calls: []
                        });
                    }
                    if (Array.isArray(node.declaration.declarations)) {
                        for (const d of node.declaration.declarations) {
                            if (d.id?.name) {
                                const isFn = d.init?.type === "ArrowFunctionExpression" || d.init?.type === "FunctionExpression";
                                const isNew = d.init?.type === "NewExpression";
                                const className = isNew ? d.init.callee?.name : null;
                                const isObj = d.init?.type === "ObjectExpression";
                                
                                let objMethods = [];
                                if (isObj) {
                                    for (const p of d.init.properties || []) {
                                        const pName = p.key?.name || p.key?.value;
                                        if (pName && (p.type === "ObjectMethod" || p.value?.type === "ArrowFunctionExpression" || p.value?.type === "FunctionExpression")) {
                                            objMethods.push({
                                                name: pName,
                                                isAsync: Boolean(p.async || p.value?.async),
                                                params: extractParamNames(p.params || p.value?.params),
                                                line: p.loc?.start?.line || 1,
                                                startLine: p.loc?.start?.line || 1,
                                                endLine: p.loc?.end?.line || 1,
                                                loc: p.loc
                                            });
                                        }
                                    }
                                }

                                exportedMap.set(d.id.name, {
                                    name: d.id.name,
                                    type: isFn ? "function" : (isNew ? "class-instance" : (isObj ? "object" : "constant")),
                                    className,
                                    methods: objMethods,
                                    line: d.loc?.start?.line || node.loc?.start?.line || 1,
                                    startLine: d.loc?.start?.line || node.loc?.start?.line || 1,
                                    endLine: d.loc?.end?.line || node.loc?.end?.line || 1,
                                    loc: d.loc || node.loc,
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
                const isClass = node.declaration?.type === "ClassDeclaration";
                const isFn = node.declaration?.type === "FunctionDeclaration" || node.declaration?.type === "ArrowFunctionExpression";
                const isNew = node.declaration?.type === "NewExpression";
                const className = isNew ? node.declaration.callee?.name : (node.declaration?.name || null);
                
                let defaultMethods = [];
                if (isClass) {
                    const classInfo = extractClassMethods(node.declaration);
                    defaultMethods = classInfo.methods;
                    if (node.declaration.id?.name) {
                        declaredClasses.set(node.declaration.id.name, {
                            name: node.declaration.id.name,
                            methods: defaultMethods,
                            constructorParams: classInfo.constructorParams,
                            line: node.loc?.start?.line || 1
                        });
                    }
                }

                exportedMap.set(name, {
                    name,
                    type: isClass ? "class" : (isFn ? "function" : (isNew ? "class-instance" : "default-export")),
                    className,
                    methods: defaultMethods,
                    line: node.loc?.start?.line || 1,
                    startLine: node.loc?.start?.line || 1,
                    endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                    loc: node.loc,
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
                                const isMethod = prop.type === "ObjectMethod" || prop.value?.type === "ArrowFunctionExpression" || prop.value?.type === "FunctionExpression";
                                exportedMap.set(pName, {
                                    name: pName,
                                    type: isMethod ? "function" : "constant",
                                    line: prop.loc?.start?.line || node.loc?.start?.line || 1,
                                    startLine: prop.loc?.start?.line || node.loc?.start?.line || 1,
                                    endLine: prop.loc?.end?.line || node.loc?.end?.line || 1,
                                    loc: prop.loc || node.loc,
                                    isDefault: false,
                                    params: isMethod ? extractParamNames(prop.params || prop.value?.params) : [],
                                    calls: []
                                });
                            }
                        }
                    } else if (node.right?.type === "NewExpression") {
                        const className = node.right.callee?.name;
                        exportedMap.set("default", {
                            name: "default",
                            type: "class-instance",
                            className,
                            line: node.loc?.start?.line || 1,
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc,
                            isDefault: true,
                            params: [],
                            methods: [],
                            calls: []
                        });
                    } else if (node.right?.id?.name || node.right?.name) {
                        const idName = node.right.id?.name || node.right.name;
                        const isClass = declaredClasses.has(idName);
                        exportedMap.set(idName, {
                            name: idName,
                            type: isClass ? "class" : "function",
                            className: isClass ? idName : null,
                            line: node.loc?.start?.line || 1,
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc,
                            isDefault: true,
                            params: [],
                            methods: isClass ? declaredClasses.get(idName).methods : [],
                            calls: []
                        });
                    }
                } else if (leftCode.startsWith("exports.")) {
                    const propName = leftCode.replace(/^exports\./, "").trim();
                    if (propName) {
                        const isMethod = node.right?.type === "ArrowFunctionExpression" || node.right?.type === "FunctionExpression";
                        exportedMap.set(propName, {
                            name: propName,
                            type: isMethod ? "function" : "constant",
                            line: node.loc?.start?.line || 1,
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc,
                            isDefault: false,
                            params: isMethod ? extractParamNames(node.right.params) : [],
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
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc,
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
                                    startLine: d.init?.loc?.start?.line || d.loc?.start?.line || node.loc?.start?.line || 1,
                                    endLine: d.init?.loc?.end?.line || d.loc?.end?.line || node.loc?.end?.line || 1,
                                    loc: d.init?.loc || d.loc || node.loc,
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
                    loc: node.loc,
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
                    loc: node.loc,
                    type: "ternary",
                    text: getLineText(line),
                    consequentLine: node.consequent?.loc?.start?.line,
                    alternateLine: node.alternate?.loc?.start?.line || null
                });
            } else if (node.type === "SwitchCase") {
                const line = node.loc?.start?.line;
                decisionPoints.push({
                    line,
                    loc: node.loc,
                    type: "switch-case",
                    text: getLineText(line),
                    isDefault: node.test === null
                });
            } else if (node.type === "LogicalExpression" && (node.operator === "??" || node.operator === "||" || node.operator === "&&")) {
                const line = node.loc?.start?.line;
                decisionPoints.push({
                    line,
                    loc: node.loc,
                    type: `logical(${node.operator})`,
                    operator: node.operator,
                    text: getLineText(line)
                });
            } else if (node.type === "OptionalMemberExpression" || node.type === "OptionalCallExpression") {
                const line = node.loc?.start?.line;
                decisionPoints.push({
                    line,
                    loc: node.loc,
                    type: "optional-chaining(?.)",
                    text: getLineText(line)
                });
            } else if (node.type === "AssignmentPattern") {
                const paramName = node.left?.name;
                const line = node.loc?.start?.line;
                if (paramName && line) {
                    decisionPoints.push({
                        line,
                        loc: node.loc,
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
                    loc: node.loc,
                    type: "throw",
                    text: getLineText(line)
                };
                exceptionPoints.push(pt);
                decisionPoints.push(pt);
            } else if (node.type === "CatchClause") {
                const line = node.loc?.start?.line;
                const pt = {
                    line,
                    loc: node.loc,
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
                        loc: node.loc,
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

            // Connect methods from declaredClasses or declaredObjects if not already attached
            if (!meta.methods || meta.methods.length === 0) {
                if (meta.className && declaredClasses.has(meta.className)) {
                    meta.methods = declaredClasses.get(meta.className).methods;
                } else if (declaredClasses.has(name)) {
                    meta.methods = declaredClasses.get(name).methods;
                } else if (declaredObjects.has(name)) {
                    meta.methods = declaredObjects.get(name).methods;
                } else if (declaredInstances.has(name)) {
                    const inst = declaredInstances.get(name);
                    if (inst?.className && declaredClasses.has(inst.className)) {
                        meta.methods = declaredClasses.get(inst.className).methods;
                        meta.className = inst.className;
                    }
                } else if ((name === "default" || meta.isDefault) && declaredClasses.size === 1) {
                    const singleClass = Array.from(declaredClasses.values())[0];
                    meta.methods = singleClass.methods;
                    meta.className = singleClass.name;
                } else if ((name === "default" || meta.isDefault) && declaredObjects.size === 1) {
                    const singleObj = Array.from(declaredObjects.values())[0];
                    meta.methods = singleObj.methods;
                }
            }

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
                exportedSymbols.push({ name: m[1], type: "function", isDefault: false, line: 1, params: [], calls: [], methods: [] });
            }
        }
        const namedExpMatches = [...sourceCode.matchAll(/export\s+\{([^}]+)\}/g)];
        for (const m of namedExpMatches) {
            for (const s of m[1].split(",")) {
                const clean = s.trim().split(/\s+as\s+/)[0].trim();
                if (clean && !exportedSymbols.some(item => item.name === clean)) {
                    exportedSymbols.push({ name: clean, type: "named-export", isDefault: false, line: 1, params: [], calls: [], methods: [] });
                }
            }
        }
        const cjsObjMatch = sourceCode.match(/module\.exports\s*=\s*\{([^}]+)\}/s);
        if (cjsObjMatch) {
            for (const s of cjsObjMatch[1].split(",")) {
                const clean = s.trim().split(":")[0].trim();
                if (clean && /^[a-zA-Z0-9_$]+$/.test(clean) && !exportedSymbols.some(item => item.name === clean)) {
                    exportedSymbols.push({ name: clean, type: "function", isDefault: false, line: 1, params: [], calls: [], methods: [] });
                }
            }
        }
    }

    const getSymbolBody = (exp, code) => {
        if (!exp || !code) return "";
        if (typeof exp.start === "number" && typeof exp.end === "number") {
            return code.slice(exp.start, exp.end);
        }
        if (exp.loc?.start?.line && exp.loc?.end?.line) {
            const lines = code.split(/\r?\n/);
            return lines.slice(exp.loc.start.line - 1, exp.loc.end.line).join("\n");
        }
        if (exp.startLine && exp.endLine) {
            const lines = code.split(/\r?\n/);
            return lines.slice(exp.startLine - 1, exp.endLine).join("\n");
        }
        const expName = exp.name?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!expName) return "";
        const fnPattern = new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function\\s+${expName}|(?:const|let|var)\\s+${expName}\\s*=\\s*(?:async\\s*)?(?:function|\\([^)]*\\)\\s*=>|[a-zA-Z0-9_$]+\\s*=>))[\\s\\S]*?(?=(?:export\\s+|(?:const|let|var)\\s+[a-zA-Z0-9_$]+\\s*=|$))`);
        const match = code.match(fnPattern);
        return match ? match[0] : "";
    };

    if (internalFunctions.length === 0) {
        const fnMatches = [...sourceCode.matchAll(/(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g)];
        for (const m of fnMatches) {
            if (m[1] && !exportedSymbols.some(s => s.name === m[1]) && !internalFunctions.some(item => item.name === m[1])) {
                const helperCallRegex = new RegExp(`\\b${m[1]}\\s*\\(`);
                const callers = exportedSymbols
                    .filter(exp => {
                        const body = getSymbolBody(exp, sourceCode);
                        return helperCallRegex.test(body);
                    })
                    .map(exp => exp.name);
                internalFunctions.push({
                    name: m[1],
                    line: 1,
                    startLine: 1,
                    endLine: 1,
                    callers: Array.from(new Set(callers)),
                    params: [],
                    warning: "DO NOT IMPORT DIRECTLY - TEST INDIRECTLY VIA EXPORTED CALLER"
                });
            }
        }
    }

    // Detect Mongoose/Sequelize models
    const modelMatches = [...sourceCode.matchAll(/mongoose\.model\s*\(\s*['"]([a-zA-Z0-9_$]+)['"]/g)];
    const detectedModels = modelMatches.map(m => ({ name: m[1] }));

    const classMethods = Array.from(declaredClasses.values()).flatMap(c =>
        (c.methods || []).map(m => ({ ...m, className: c.name }))
    );

    const infeasibleNodes = parseRes.success && parseRes.ast ? detectInfeasibleAstNodes(parseRes.ast, sourceCode) : [];

    const formattedImports = Object.fromEntries(
        Array.from(sourceImports.entries()).map(([k, v]) => [
            k,
            { default: Boolean(v?.default), namespace: Boolean(v?.namespace), names: Array.from(v?.names || []) }
        ])
    );

    return {
        exportedSymbols,
        internalFunctions,
        decisionPoints,
        exceptionPoints,
        cyclomaticComplexity: 1 + (decisionPoints || []).length,
        basisPathsCount: 1 + (decisionPoints || []).length,
        classes: Array.from(declaredClasses.values()),
        classMethods,
        declaredObjects: Array.from(declaredObjects.values()),
        mongooseModels: detectedModels,
        unexportedFunctions: internalFunctions.map(f => f.name),
        exportedSymbolNames: exportedSymbols.map(s => s.name),
        infeasibleNodes,
        ast: parseRes.success ? parseRes.ast : null,
        callEdges,
        imports: formattedImports,
        sourceImports: formattedImports,
        formattedImports: formattedImports
    };
};

/**
 * Backwards-compatible alias for analyzeSourceAst
 */
export const analyzeBusinessLogicFile = analyzeSourceAst;

/**
 * Extracts all imported packages and named specifiers from source code using AST.
 * @param {string} sourceCode
 * @returns {Record<string, { default: boolean, namespace: boolean, names: string[] }>}
 */
export const extractSourceImportsAst = (sourceCode = "") => {
    if (!sourceCode || typeof sourceCode !== "string") return {};
    const parseRes = parseJavaScriptCode(sourceCode);
    const importsMap = new Map();

    const walk = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.type === "ImportDeclaration") {
            const sourcePkg = node.source?.value;
            if (sourcePkg) {
                if (!importsMap.has(sourcePkg)) importsMap.set(sourcePkg, { default: false, names: new Set(), namespace: false });
                const entry = importsMap.get(sourcePkg);
                for (const spec of node.specifiers || []) {
                    if (spec.type === "ImportDefaultSpecifier") {
                        entry.default = true;
                    } else if (spec.type === "ImportNamespaceSpecifier") {
                        entry.namespace = true;
                    } else if (spec.type === "ImportSpecifier") {
                        const importedName = spec.imported?.name || spec.imported?.value;
                        if (importedName) entry.names.add(importedName);
                    }
                }
            }
        } else if (node.type === "VariableDeclarator" && node.init?.type === "CallExpression") {
            const callee = node.init.callee;
            if (callee?.name === "require" && node.init.arguments?.[0]?.value) {
                const sourcePkg = node.init.arguments[0].value;
                if (!importsMap.has(sourcePkg)) importsMap.set(sourcePkg, { default: false, names: new Set(), namespace: false });
                const entry = importsMap.get(sourcePkg);
                if (node.id?.type === "ObjectPattern") {
                    for (const prop of node.id.properties || []) {
                        const pName = prop.key?.name || prop.key?.value;
                        if (pName) entry.names.add(pName);
                    }
                } else if (node.id?.type === "Identifier") {
                    entry.default = true;
                }
            }
        }
        for (const key of Object.keys(node)) {
            if (key === "loc" || key === "comments" || key === "tokens") continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) walk(item);
            } else if (child && typeof child === "object" && child.type) {
                walk(child);
            }
        }
    };

    if (parseRes.success && parseRes.ast) {
        walk(parseRes.ast);
    }
    return Object.fromEntries(
        Array.from(importsMap.entries()).map(([k, v]) => [
            k,
            { default: v.default, namespace: v.namespace, names: Array.from(v.names) }
        ])
    );
};

/**
 * 1.3 MAPPING WITH coverage-final.json (ISTANBUL / V8)
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
    uncoveredLinesList = [],
    ast = null
}) => {
    const codeLines = sourceCode ? sourceCode.split(/\r?\n/) : [];
    const getSnippet = (lineNum) => (codeLines[lineNum - 1] || "").trim();

    const uncoveredLines = new Set((uncoveredLinesList || []).map(Number));
    const uncoveredStatements = [];
    const uncoveredBranches = [];
    const uncoveredFunctions = [];

    // 1. Process statementMap & s for uncovered lines and statements if fileCoverageData is provided
    if (fileCoverageData?.statementMap && fileCoverageData?.s) {
        for (const [id, range] of Object.entries(fileCoverageData.statementMap)) {
            const hits = fileCoverageData.s[id] ?? 0;
            if (hits === 0) {
                const startLine = range.start?.line || 1;
                const endLine = range.end?.line || startLine;
                for (let l = startLine; l <= endLine; l++) {
                    uncoveredLines.add(l);
                }
                uncoveredStatements.push({
                    stmtId: id,
                    line: startLine,
                    loc: range,
                    isInfeasible: false,
                    infeasibleMeta: null
                });
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
                    loc: branch.loc || { start: { line, column: 0 }, end: { line, column: 99999 } },
                    locations: branch.locations || [],
                    type,
                    condition: getSnippet(line),
                    missedTrue: isTrueUncovered,
                    missedFalse: isFalseUncovered,
                    status: (hitTrue === 0 && hitFalse === 0) ? "entirely_uncovered" : "partially_uncovered",
                    isInfeasible: false,
                    infeasibleMeta: null
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
                    loc: b.loc || { start: { line: b.line, column: 0 }, end: { line: b.line, column: 99999 } },
                    locations: b.locations || [],
                    type: b.type || "branch",
                    condition: b.condition || getSnippet(b.line),
                    missedTrue: missedTrue || b.status === "uncovered",
                    missedFalse: missedFalse || b.status === "uncovered",
                    status: b.status || "uncovered",
                    isInfeasible: Boolean(b.isInfeasible),
                    infeasibleMeta: b.infeasibleMeta || null
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
                    loc: fn.loc || fn.decl || { start: { line: fn.line || 1, column: 0 }, end: { line: fn.line || 1, column: 99999 } },
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
                    loc: f.loc || { start: { line: f.line || 1, column: 0 }, end: { line: f.line || 1, column: 99999 } },
                    hits: f.hits || 0
                });
            }
        }
    }

    // 4. Infeasible node reconciliation
    let infeasibleCodeBlocks = astMetadata?.infeasibleNodes || [];
    if ((!infeasibleCodeBlocks || infeasibleCodeBlocks.length === 0) && (ast || astMetadata?.ast || sourceCode)) {
        infeasibleCodeBlocks = detectInfeasibleAstNodes(ast || astMetadata?.ast, sourceCode);
    }

    // Tag uncovered branches with infeasible metadata
    for (const ub of uncoveredBranches) {
        for (const inf of infeasibleCodeBlocks) {
            let matched = false;

            if (inf.affectsBranch === "TRUE_BRANCH") {
                const trueLoc = ub.locations?.[0] || ub.loc;
                const hasPreciseCoords = Boolean(inf.loc?.start?.column !== undefined && trueLoc?.start?.column !== undefined);
                const isContained = isLocOverlapping(inf.loc, trueLoc) || isLocContained(inf.loc, trueLoc) || isLocContained(trueLoc, inf.loc);
                if (isContained || (!hasPreciseCoords && inf.line === ub.line)) {
                    if (ub.missedTrue) matched = true;
                }
            } else if (inf.affectsBranch === "FALSE_BRANCH") {
                const falseLoc = ub.locations?.[1] || ub.loc;
                const hasPreciseCoords = Boolean(inf.loc?.start?.column !== undefined && falseLoc?.start?.column !== undefined);
                const isContained = isLocOverlapping(inf.loc, falseLoc) || isLocContained(inf.loc, falseLoc) || isLocContained(falseLoc, inf.loc);
                if (isContained || (!hasPreciseCoords && inf.line === ub.line)) {
                    if (ub.missedFalse) matched = true;
                }
            } else if (inf.affectsBranch === "BOTH") {
                const targetLoc = ub.loc;
                const hasPreciseCoords = Boolean(inf.loc?.start?.column !== undefined && targetLoc?.start?.column !== undefined);
                const isContained = isLocOverlapping(inf.loc, targetLoc) || isLocContained(inf.loc, targetLoc) || isLocContained(targetLoc, inf.loc);
                if (isContained || (!hasPreciseCoords && inf.line === ub.line)) {
                    matched = true;
                }
            }

            if (matched) {
                ub.isInfeasible = true;
                ub.infeasibleMeta = {
                    type: inf.type,
                    justification: inf.justification,
                    category: inf.category,
                    affectsBranch: inf.affectsBranch,
                    reason: inf.reason
                };
                break;
            }
        }
    }

    // Tag uncovered statements with infeasible metadata
    for (const us of uncoveredStatements) {
        for (const inf of infeasibleCodeBlocks) {
            const hasPreciseCoords = Boolean(inf.loc?.start?.column !== undefined && us.loc?.start?.column !== undefined);
            const isContained = isLocContained(inf.loc, us.loc) || isLocOverlapping(inf.loc, us.loc) || isLocContained(us.loc, inf.loc);
            if (isContained || (!hasPreciseCoords && inf.line === us.line)) {
                us.isInfeasible = true;
                us.infeasibleMeta = {
                    type: inf.type,
                    justification: inf.justification,
                    category: inf.category,
                    reason: inf.reason
                };
                break;
            }
        }
    }

    const sortedUncoveredLines = Array.from(uncoveredLines).filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);

    // 5. Generate Targeted Decision Guidance connecting AST decisionPoints to coverage gaps via exact coordinates
    const targetedGuidance = [];
    const allDecisions = astMetadata?.decisionPoints || [];
    const allExceptions = astMetadata?.exceptionPoints || [];

    for (const dp of allDecisions) {
        const isLineUncovered = uncoveredLines.has(dp.line);
        const matchedBranch = uncoveredBranches.find(ub => {
            if (dp.loc && ub.loc) {
                return isLocOverlapping(dp.loc, ub.loc) || isLocContained(dp.loc, ub.loc) || isLocContained(ub.loc, dp.loc);
            }
            return Math.abs(ub.line - dp.line) <= 1;
        });

        if (isLineUncovered || matchedBranch) {
            if (matchedBranch?.isInfeasible) {
                targetedGuidance.push({
                    line: dp.line,
                    loc: dp.loc,
                    type: dp.type.toUpperCase(),
                    text: dp.text,
                    status: "INFEASIBLE_GUARD",
                    isInfeasible: true,
                    infeasibleMeta: matchedBranch.infeasibleMeta,
                    guidance: `Line ${dp.line} [${dp.type.toUpperCase()}]: "${dp.text}" -> Infeasible/unreachable (${matchedBranch.infeasibleMeta?.justification}). Suppressed from unit test generation.`
                });
            } else {
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
                    loc: dp.loc,
                    type: dp.type.toUpperCase(),
                    text: dp.text,
                    status: "UNCOVERED",
                    guidance: `Line ${dp.line} [${dp.type.toUpperCase()}]: "${dp.text}" -> ${detail}. (Craft test inputs to toggle this branch!)`
                });
            }
        }
    }

    for (const ep of allExceptions) {
        if (uncoveredLines.has(ep.line)) {
            const matchedInf = infeasibleCodeBlocks.find(inf => {
                if (ep.loc && inf.loc) {
                    return isLocOverlapping(ep.loc, inf.loc) || isLocContained(inf.loc, ep.loc);
                }
                return inf.line === ep.line;
            });

            if (matchedInf) {
                targetedGuidance.push({
                    line: ep.line,
                    loc: ep.loc,
                    type: ep.type.toUpperCase(),
                    text: ep.text,
                    status: "INFEASIBLE_EXCEPTION_PATH",
                    isInfeasible: true,
                    infeasibleMeta: {
                        type: matchedInf.type,
                        justification: matchedInf.justification,
                        category: matchedInf.category
                    },
                    guidance: `Line ${ep.line} [${ep.type.toUpperCase()}]: "${ep.text}" -> Infeasible exception block (${matchedInf.justification}). Suppressed from unit test generation.`
                });
            } else {
                targetedGuidance.push({
                    line: ep.line,
                    loc: ep.loc,
                    type: ep.type.toUpperCase(),
                    text: ep.text,
                    status: "UNCOVERED_ERROR_PATH",
                    guidance: `Line ${ep.line} [${ep.type.toUpperCase()}]: "${ep.text}" -> Exception path not triggered. (Pass invalid arguments or mock rejected promise to exercise this catch/throw statement!)`
                });
            }
        }
    }

    return {
        uncoveredLines: sortedUncoveredLines,
        uncoveredStatements,
        uncoveredBranches,
        uncoveredFunctions,
        infeasibleCodeBlocks,
        targetedGuidance,
        guidanceSummary: targetedGuidance.map(g => `- ${g.guidance}`).join("\n") || "All identified decision points executed in current suite."
    };
};
