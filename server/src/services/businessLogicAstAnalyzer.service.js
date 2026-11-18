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
import { isCovaiJestArtifact } from "../utils/covaiJestArtifact.js";

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
    if (isCovaiJestArtifact(filePath)) return false;
    if (!/(?:^|\/)(?:node_modules|dist|build|tests?|__tests__|__mocks__|fixtures)(?:\/|$)|\.(?:test|spec|testcase|d)\./i.test(filePath) &&
        /(?:^|\/)(?:hooks|utils|helpers|services)\/[^/]+\.[jt]sx?$/i.test(filePath) &&
        !configExclusions.some(exclusion => typeof exclusion === 'string' && filePath.includes(exclusion))) return true;
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

const REEXPORT_EXTENSIONS = [
    "",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    "/index.ts",
    "/index.tsx",
    "/index.mts",
    "/index.cts",
    "/index.js",
    "/index.jsx",
    "/index.mjs",
    "/index.cjs"
];

const resolveLocalModuleFile = (rootDir, fromFile, specifier) => {
    if (!rootDir || !fromFile || !specifier || typeof specifier !== "string" || !specifier.startsWith(".")) {
        return null;
    }
    try {
        const absFrom = path.isAbsolute(fromFile) ? fromFile : path.join(rootDir, fromFile);
        const rawTarget = path.resolve(path.dirname(absFrom), specifier);
        const bases = [rawTarget];
        if (/\.[cm]?jsx?$/i.test(rawTarget)) {
            bases.push(rawTarget.replace(/\.[cm]?jsx?$/i, ""));
        }
        for (const base of bases) {
            for (const ext of REEXPORT_EXTENSIONS) {
                const candidate = base + ext;
                try {
                    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                        return candidate;
                    }
                } catch {
                    // ignore stat errors
                }
            }
        }
    } catch {
        // ignore invalid path errors
    }
    return null;
};

const collectPatternIdentifiers = (pattern, targetSet) => {
    if (!pattern || !targetSet) return;
    if (pattern.type === "Identifier" && pattern.name) {
        targetSet.add(pattern.name);
    } else if (pattern.type === "AssignmentPattern") {
        collectPatternIdentifiers(pattern.left, targetSet);
    } else if (pattern.type === "RestElement") {
        collectPatternIdentifiers(pattern.argument, targetSet);
    } else if (pattern.type === "ObjectPattern") {
        for (const prop of pattern.properties || []) {
            if (prop.type === "RestElement") collectPatternIdentifiers(prop.argument, targetSet);
            else if (prop.value) collectPatternIdentifiers(prop.value, targetSet);
        }
    } else if (pattern.type === "ArrayPattern") {
        for (const el of pattern.elements || []) {
            if (el) collectPatternIdentifiers(el, targetSet);
        }
    }
};

/**
 * 1.2 ABSTRACT SYNTAX TREE (AST) ANALYSIS VIA BABEL PARSER
 *
 * Extracts deep architectural metadata from source code:
 * 1. Public Exported Symbols: APIs that tests are permitted to invoke.
 * 2. Private / Internal Functions: Helpers that must be tested INDIRECTLY.
 * 3. Decision Points & Exception Points: Branching conditionals and throw/catch statements.
 */
export const analyzeSourceAst = (sourceCode = "", optionsOrFilePath = {}) => {
    const options = typeof optionsOrFilePath === "string"
        ? { filePath: optionsOrFilePath }
        : (optionsOrFilePath || {});
    const reExportDepth = Number(options._reExportDepth || 0);
    const rootDir = options.rootDir || null;
    const sourceFile = options.sourceFile || options.filePath || null;
    const visitedFiles = options._visitedFiles instanceof Set ? options._visitedFiles : new Set();

    const exportedSymbols = [];
    const internalFunctions = [];
    const decisionPoints = [];
    const exceptionPoints = [];
    const declaredClasses = new Map();
    const declaredObjects = new Map();
    const declaredInstances = new Map();
    const declaredFunctions = new Map();
    const declaredConstants = new Map();
    const moduleBindings = new Set();
    const unboundCommonJsExports = [];
    const reExportSources = [];
    const cjsExportSites = [];
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
            unboundCommonJsExports: [],
            infeasibleNodes: [],
            ast: null,
            callEdges: [],
            imports: {},
            sourceImports: {},
            formattedImports: {}
        };
    }

    if (rootDir && sourceFile) {
        const absSelf = path.isAbsolute(sourceFile) ? sourceFile : path.join(rootDir, sourceFile);
        visitedFiles.add(path.normalize(absSelf).toLowerCase());
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

        const resolveDeclaredIdentifier = (idName) => {
            if (!idName) return null;
            if (declaredFunctions.has(idName)) {
                const fn = declaredFunctions.get(idName);
                return {
                    type: "function",
                    isAsync: Boolean(fn.isAsync),
                    params: fn.params || [],
                    methods: [],
                    className: null,
                    startLine: fn.startLine,
                    endLine: fn.endLine,
                    line: fn.line,
                    loc: fn.loc
                };
            }
            if (declaredClasses.has(idName)) {
                const cls = declaredClasses.get(idName);
                return {
                    type: "class",
                    isAsync: false,
                    params: cls.constructorParams || [],
                    methods: cls.methods || [],
                    className: cls.name,
                    startLine: cls.startLine || cls.line,
                    endLine: cls.endLine || cls.line,
                    line: cls.line,
                    loc: cls.loc
                };
            }
            if (declaredObjects.has(idName)) {
                const obj = declaredObjects.get(idName);
                return {
                    type: "object",
                    isAsync: false,
                    params: [],
                    methods: obj.methods || [],
                    className: null,
                    startLine: obj.startLine || obj.line,
                    endLine: obj.endLine || obj.line,
                    line: obj.line,
                    loc: obj.loc
                };
            }
            if (declaredInstances.has(idName)) {
                const inst = declaredInstances.get(idName);
                const cls = inst.className ? declaredClasses.get(inst.className) : null;
                return {
                    type: "class-instance",
                    isAsync: false,
                    params: [],
                    methods: cls?.methods || [],
                    className: inst.className || null,
                    startLine: inst.line,
                    endLine: inst.line,
                    line: inst.line
                };
            }
            if (declaredConstants.has(idName)) {
                const c = declaredConstants.get(idName);
                return {
                    type: c.type || "constant",
                    isAsync: false,
                    params: [],
                    methods: c.methods || [],
                    className: c.className || null,
                    startLine: c.startLine || c.line,
                    endLine: c.endLine || c.line,
                    line: c.line,
                    loc: c.loc
                };
            }
            return null;
        };

        const setExported = (meta) => {
            const key = (meta.isDefault ? "default:" : "named:") + meta.name;
            exportedMap.set(key, meta);
        };

        const extractObjectLiteralMethods = (objNode) => {
            const objMethods = [];
            for (const p of objNode?.properties || []) {
                if (p.type === "SpreadElement") continue;
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
            return objMethods;
        };

        const walk = (node, parent) => {
            if (!node || typeof node !== "object") return;

            const inTopLevelScope = scopeStack.length === 0;

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

            // --- Track Module-Level Bindings & Declarations ---
            if (inTopLevelScope) {
                if (node.type === "FunctionDeclaration" && node.id?.name) {
                    moduleBindings.add(node.id.name);
                    if (!declaredFunctions.has(node.id.name)) {
                        declaredFunctions.set(node.id.name, {
                            name: node.id.name,
                            isAsync: Boolean(node.async),
                            params: extractParamNames(node.params),
                            line: node.loc?.start?.line || 1,
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc
                        });
                    }
                } else if (node.type === "ClassDeclaration" && node.id?.name) {
                    moduleBindings.add(node.id.name);
                } else if (node.type === "TSEnumDeclaration" && node.id?.name) {
                    moduleBindings.add(node.id.name);
                } else if (node.type === "VariableDeclarator") {
                    collectPatternIdentifiers(node.id, moduleBindings);
                    if (node.id?.type === "Identifier" && node.id.name) {
                        const varName = node.id.name;
                        const init = node.init;
                        if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") {
                            declaredFunctions.set(varName, {
                                name: varName,
                                isAsync: Boolean(init.async),
                                params: extractParamNames(init.params),
                                line: node.loc?.start?.line || 1,
                                startLine: init.loc?.start?.line || node.loc?.start?.line || 1,
                                endLine: init.loc?.end?.line || node.loc?.end?.line || node.loc?.start?.line || 1,
                                loc: init.loc || node.loc
                            });
                        } else if (init?.type !== "ClassExpression" && init?.type !== "NewExpression" && init?.type !== "ObjectExpression") {
                            declaredConstants.set(varName, {
                                type: "constant",
                                className: null,
                                methods: [],
                                line: node.loc?.start?.line || 1,
                                startLine: node.loc?.start?.line || 1,
                                endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                                loc: node.loc
                            });
                        }
                    }
                } else if (node.type === "ImportDeclaration") {
                    for (const spec of node.specifiers || []) {
                        if (spec.local?.name) moduleBindings.add(spec.local.name);
                    }
                }
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
                    line: node.loc?.start?.line || 1,
                    startLine: node.loc?.start?.line || 1,
                    endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                    loc: node.loc
                });
            } else if (node.type === "VariableDeclarator" && node.id?.name && node.init?.type === "ClassExpression") {
                const { methods, constructorParams } = extractClassMethods(node.init);
                declaredClasses.set(node.id.name, {
                    name: node.id.name,
                    methods,
                    constructorParams,
                    line: node.loc?.start?.line || 1,
                    startLine: node.loc?.start?.line || 1,
                    endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                    loc: node.loc
                });
            }

            // --- Track Instantiations: const x = new ClassName() ---
            if (node.type === "VariableDeclarator" && node.id?.name && node.init?.type === "NewExpression") {
                const className = node.init.callee?.name;
                if (className) {
                    declaredInstances.set(node.id.name, { className, varName: node.id.name, line: node.loc?.start?.line || 1 });
                }
            }

            // --- Track Object Literals with functions: const x = { async foo() {} } ---
            if (node.type === "VariableDeclarator" && node.id?.name && node.init?.type === "ObjectExpression") {
                const objName = node.id.name;
                const objMethods = extractObjectLiteralMethods(node.init);
                if (objMethods.length > 0) {
                    declaredObjects.set(objName, {
                        name: objName,
                        methods: objMethods,
                        line: node.loc?.start?.line || 1,
                        startLine: node.loc?.start?.line || 1,
                        endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                        loc: node.loc
                    });
                } else if (inTopLevelScope) {
                    declaredConstants.set(objName, {
                        type: "object",
                        className: null,
                        methods: [],
                        line: node.loc?.start?.line || 1,
                        startLine: node.loc?.start?.line || 1,
                        endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                        loc: node.loc
                    });
                }
            }

            // --- 1. ESM EXPORTS ---
            if (node.type === "ExportNamedDeclaration") {
                if (node.exportKind === "type") {
                    // Skip TypeScript type-only exports
                } else {
                    if (node.declaration) {
                        const declType = node.declaration.type;
                        const isTypeOnlyDecl =
                            declType === "TSInterfaceDeclaration" ||
                            declType === "TSTypeAliasDeclaration" ||
                            declType === "TSDeclareFunction" ||
                            node.declaration.declare === true;

                        if (!isTypeOnlyDecl) {
                            if (node.declaration.id?.name) {
                                const isClass = declType === "ClassDeclaration";
                                const classInfo = isClass ? extractClassMethods(node.declaration) : null;
                                if (isClass) {
                                    declaredClasses.set(node.declaration.id.name, {
                                        name: node.declaration.id.name,
                                        methods: classInfo.methods,
                                        constructorParams: classInfo.constructorParams,
                                        line: node.loc?.start?.line || 1,
                                        startLine: node.loc?.start?.line || 1,
                                        endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                                        loc: node.loc
                                    });
                                }
                                setExported({
                                    name: node.declaration.id.name,
                                    localName: node.declaration.id.name,
                                    type: isClass ? "class" : "function",
                                    isAsync: Boolean(!isClass && node.declaration.async),
                                    line: node.loc?.start?.line || 1,
                                    startLine: node.loc?.start?.line || 1,
                                    endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                                    loc: node.loc,
                                    isDefault: false,
                                    isReExport: false,
                                    source: null,
                                    exportKind: "value",
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
                                        const isAlias = d.init?.type === "Identifier";
                                        const objMethods = isObj ? extractObjectLiteralMethods(d.init) : [];

                                        setExported({
                                            name: d.id.name,
                                            localName: isAlias ? d.init.name : d.id.name,
                                            type: isFn ? "function" : (isNew ? "class-instance" : (isObj ? "object" : "constant")),
                                            isAsync: Boolean(isFn && d.init?.async),
                                            className,
                                            methods: objMethods,
                                            line: d.loc?.start?.line || node.loc?.start?.line || 1,
                                            startLine: d.loc?.start?.line || node.loc?.start?.line || 1,
                                            endLine: d.loc?.end?.line || node.loc?.end?.line || 1,
                                            loc: d.loc || node.loc,
                                            isDefault: false,
                                            isReExport: false,
                                            source: null,
                                            exportKind: "value",
                                            params: isFn ? extractParamNames(d.init?.params) : [],
                                            calls: [],
                                            _resolveFromLocal: isAlias
                                        });
                                    }
                                }
                            }
                        }
                    }
                    if (Array.isArray(node.specifiers)) {
                        const reExportSrc = node.source?.value || null;
                        if (reExportSrc) {
                            reExportSources.push({
                                kind: "named",
                                source: reExportSrc,
                                line: node.loc?.start?.line || 1,
                                specifiers: node.specifiers
                                    .filter(s => s.exportKind !== "type")
                                    .map(s => ({
                                        type: s.type,
                                        local: s.local?.name || "*",
                                        exported: s.exported?.name || s.exported?.value || s.local?.name
                                    }))
                            });
                        }
                        for (const s of node.specifiers) {
                            if (s.exportKind === "type") continue;
                            if (s.type === "ExportNamespaceSpecifier") {
                                const nsName = s.exported?.name || s.exported?.value;
                                if (nsName) {
                                    setExported({
                                        name: nsName,
                                        localName: "*",
                                        type: "namespace-export",
                                        isAsync: false,
                                        line: s.loc?.start?.line || node.loc?.start?.line || 1,
                                        startLine: node.loc?.start?.line || 1,
                                        endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                                        loc: s.loc || node.loc,
                                        isDefault: false,
                                        isReExport: true,
                                        source: reExportSrc,
                                        exportKind: "value",
                                        params: [],
                                        methods: [],
                                        calls: []
                                    });
                                }
                                continue;
                            }
                            const exportedName = s.exported?.name || s.exported?.value || s.local?.name;
                            const localName = s.local?.name || exportedName;
                            if (exportedName) {
                                const isDefaultAlias = exportedName === "default";
                                const safeName = isDefaultAlias
                                    ? (localName && localName !== "default" ? localName : "defaultExport")
                                    : exportedName;
                                setExported({
                                    name: safeName,
                                    localName,
                                    type: "named-export",
                                    isAsync: false,
                                    line: s.loc?.start?.line || node.loc?.start?.line || 1,
                                    startLine: s.loc?.start?.line || node.loc?.start?.line || 1,
                                    endLine: s.loc?.end?.line || node.loc?.end?.line || node.loc?.start?.line || 1,
                                    loc: s.loc || node.loc,
                                    isDefault: isDefaultAlias,
                                    isReExport: Boolean(reExportSrc),
                                    source: reExportSrc,
                                    exportKind: "value",
                                    params: [],
                                    methods: [],
                                    calls: [],
                                    _resolveFromLocal: !reExportSrc
                                });
                            }
                        }
                    }
                }
            } else if (node.type === "ExportDefaultDeclaration") {
                const decl = node.declaration;
                const declType = decl?.type;
                const isClass = declType === "ClassDeclaration" || declType === "ClassExpression";
                const isFn = declType === "FunctionDeclaration" || declType === "FunctionExpression" || declType === "ArrowFunctionExpression";
                const isNew = declType === "NewExpression";
                const isObj = declType === "ObjectExpression";
                const isIdentifier = declType === "Identifier";
                const localName = isIdentifier ? decl.name : (decl?.id?.name || null);
                const name = localName || "defaultExport";
                const className = isNew ? decl.callee?.name : (isIdentifier ? decl.name : (decl?.id?.name || null));

                let defaultMethods = [];
                let constructorParams = [];
                if (isClass) {
                    const classInfo = extractClassMethods(decl);
                    defaultMethods = classInfo.methods;
                    constructorParams = classInfo.constructorParams;
                    if (decl.id?.name) {
                        declaredClasses.set(decl.id.name, {
                            name: decl.id.name,
                            methods: defaultMethods,
                            constructorParams,
                            line: node.loc?.start?.line || 1,
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc
                        });
                    }
                } else if (isObj) {
                    defaultMethods = extractObjectLiteralMethods(decl);
                }

                setExported({
                    name,
                    localName,
                    type: isClass ? "class" : (isFn ? "function" : (isNew ? "class-instance" : (isObj ? "object" : (isIdentifier ? "constant" : "default-export")))),
                    isAsync: Boolean(isFn && decl?.async),
                    className,
                    methods: defaultMethods,
                    line: node.loc?.start?.line || 1,
                    startLine: node.loc?.start?.line || 1,
                    endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                    loc: node.loc,
                    isDefault: true,
                    isReExport: false,
                    source: null,
                    exportKind: "value",
                    params: isClass ? constructorParams : (isFn ? extractParamNames(decl.params) : []),
                    calls: [],
                    _resolveFromLocal: isIdentifier
                });
            } else if (node.type === "ExportAllDeclaration") {
                if (node.exportKind !== "type" && node.source?.value) {
                    reExportSources.push({
                        kind: "all",
                        source: node.source.value,
                        line: node.loc?.start?.line || 1
                    });
                }
            }

            // --- 2. COMMONJS EXPORTS ---
            if (node.type === "AssignmentExpression" && node.left) {
                const left = node.left;
                const isModuleExportsRoot =
                    left.type === "MemberExpression" &&
                    !left.computed &&
                    left.object?.type === "Identifier" &&
                    left.object.name === "module" &&
                    left.property?.type === "Identifier" &&
                    left.property.name === "exports";

                const isCjsProp =
                    left.type === "MemberExpression" &&
                    !left.computed &&
                    left.property?.type === "Identifier" &&
                    (
                        (left.object?.type === "Identifier" && left.object.name === "exports") ||
                        (left.object?.type === "MemberExpression" &&
                            !left.object.computed &&
                            left.object.object?.type === "Identifier" &&
                            left.object.object.name === "module" &&
                            left.object.property?.type === "Identifier" &&
                            left.object.property.name === "exports")
                    );

                if (isModuleExportsRoot) {
                    if (node.right?.type === "ObjectExpression") {
                        for (const prop of node.right.properties || []) {
                            if (prop.type === "SpreadElement") continue;
                            const pName = prop.key?.name || prop.key?.value;
                            if (!pName) continue;
                            const isInlineFn = prop.type === "ObjectMethod" || prop.value?.type === "ArrowFunctionExpression" || prop.value?.type === "FunctionExpression";
                            const isId = prop.value?.type === "Identifier";
                            const localName = isId ? prop.value.name : pName;
                            if (isId && inTopLevelScope) {
                                cjsExportSites.push({
                                    name: prop.value.name,
                                    line: prop.loc?.start?.line || node.loc?.start?.line || 1,
                                    column: prop.value.loc?.start?.column ?? prop.loc?.start?.column ?? 0
                                });
                            }
                            setExported({
                                name: pName,
                                localName,
                                type: isInlineFn ? "function" : "constant",
                                isAsync: Boolean(isInlineFn && (prop.async || prop.value?.async)),
                                line: prop.loc?.start?.line || node.loc?.start?.line || 1,
                                startLine: prop.loc?.start?.line || node.loc?.start?.line || 1,
                                endLine: prop.loc?.end?.line || node.loc?.end?.line || 1,
                                loc: prop.loc || node.loc,
                                isDefault: false,
                                isReExport: false,
                                source: null,
                                exportKind: "value",
                                params: isInlineFn ? extractParamNames(prop.params || prop.value?.params) : [],
                                methods: [],
                                calls: [],
                                _resolveFromLocal: isId
                            });
                        }
                    } else if (node.right?.type === "NewExpression") {
                        const className = node.right.callee?.name || null;
                        setExported({
                            name: "defaultExport",
                            localName: null,
                            type: "class-instance",
                            isAsync: false,
                            className,
                            line: node.loc?.start?.line || 1,
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc,
                            isDefault: true,
                            isReExport: false,
                            source: null,
                            exportKind: "value",
                            params: [],
                            methods: [],
                            calls: []
                        });
                    } else if (node.right?.type === "ArrowFunctionExpression" || node.right?.type === "FunctionExpression") {
                        const fnName = node.right.id?.name || "defaultExport";
                        setExported({
                            name: fnName,
                            localName: node.right.id?.name || null,
                            type: "function",
                            isAsync: Boolean(node.right.async),
                            className: null,
                            line: node.loc?.start?.line || 1,
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc,
                            isDefault: true,
                            isReExport: false,
                            source: null,
                            exportKind: "value",
                            params: extractParamNames(node.right.params),
                            methods: [],
                            calls: []
                        });
                    } else if (node.right?.type === "ClassExpression") {
                        const clsName = node.right.id?.name || "defaultExport";
                        const classInfo = extractClassMethods(node.right);
                        setExported({
                            name: clsName,
                            localName: node.right.id?.name || null,
                            type: "class",
                            isAsync: false,
                            className: node.right.id?.name || null,
                            line: node.loc?.start?.line || 1,
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc,
                            isDefault: true,
                            isReExport: false,
                            source: null,
                            exportKind: "value",
                            params: classInfo.constructorParams,
                            methods: classInfo.methods,
                            calls: []
                        });
                    } else if (node.right?.type === "Identifier") {
                        const idName = node.right.name;
                        if (inTopLevelScope) {
                            cjsExportSites.push({
                                name: idName,
                                line: node.loc?.start?.line || 1,
                                column: node.right.loc?.start?.column ?? 0
                            });
                        }
                        const isClass = declaredClasses.has(idName);
                        setExported({
                            name: idName,
                            localName: idName,
                            type: isClass ? "class" : "function",
                            isAsync: false,
                            className: isClass ? idName : null,
                            line: node.loc?.start?.line || 1,
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc,
                            isDefault: true,
                            isReExport: false,
                            source: null,
                            exportKind: "value",
                            params: [],
                            methods: isClass ? declaredClasses.get(idName).methods : [],
                            calls: [],
                            _resolveFromLocal: true
                        });
                    }
                } else if (isCjsProp) {
                    const propName = left.property?.name;
                    if (propName) {
                        const isInlineFn = node.right?.type === "ArrowFunctionExpression" || node.right?.type === "FunctionExpression";
                        const isId = node.right?.type === "Identifier";
                        const localName = isId ? node.right.name : propName;
                        if (isId && inTopLevelScope) {
                            cjsExportSites.push({
                                name: node.right.name,
                                line: node.loc?.start?.line || 1,
                                column: node.right.loc?.start?.column ?? 0
                            });
                        }
                        setExported({
                            name: propName,
                            localName,
                            type: isInlineFn ? "function" : "constant",
                            isAsync: Boolean(isInlineFn && node.right?.async),
                            line: node.loc?.start?.line || 1,
                            startLine: node.loc?.start?.line || 1,
                            endLine: node.loc?.end?.line || node.loc?.start?.line || 1,
                            loc: node.loc,
                            isDefault: false,
                            isReExport: false,
                            source: null,
                            exportKind: "value",
                            params: isInlineFn ? extractParamNames(node.right.params) : [],
                            methods: [],
                            calls: [],
                            _resolveFromLocal: isId
                        });
                    }
                }
            }

            // --- 3. MODULE-SCOPED FUNCTIONS (INTERNAL / PRIVATE HELPERS) ---
            if (parent && (parent.type === "Program" || parent.type === "BlockStatement")) {
                if (node.type === "FunctionDeclaration" && node.id?.name) {
                    const fnName = node.id.name;
                    if (!exportedMap.has("named:" + fnName) && !exportedMap.has("default:" + fnName)) {
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
                            if (!exportedMap.has("named:" + fnName) && !exportedMap.has("default:" + fnName)) {
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

        // Compute unboundCommonJsExports after full AST walk (covers hoisted declarations)
        const CJS_WRAPPER_GLOBALS = new Set([
            "module", "exports", "require", "__filename", "__dirname",
            "undefined", "null", "true", "false"
        ]);
        const seenUnbound = new Set();
        for (const site of cjsExportSites) {
            if (
                !moduleBindings.has(site.name) &&
                !CJS_WRAPPER_GLOBALS.has(site.name) &&
                !Object.hasOwn(globalThis, site.name)
            ) {
                const sig = `${site.name}:${site.line}:${site.column}`;
                if (!seenUnbound.has(sig)) {
                    seenUnbound.add(sig);
                    unboundCommonJsExports.push({
                        name: site.name,
                        line: site.line,
                        column: site.column,
                        reason: `Identifier '${site.name}' is exported in CommonJS module.exports without being declared or imported.`
                    });
                }
            }
        }

        // Resolve 1-hop re-exports when rootDir & sourceFile are provided
        const resolvedTargetCache = new Map();
        const loadReExportTarget = (specifier) => {
            if (!rootDir || !sourceFile || reExportDepth >= 1 || !specifier?.startsWith(".")) return null;
            if (resolvedTargetCache.has(specifier)) return resolvedTargetCache.get(specifier);
            const resolvedPath = resolveLocalModuleFile(rootDir, sourceFile, specifier);
            if (!resolvedPath) {
                resolvedTargetCache.set(specifier, null);
                return null;
            }
            const normKey = path.normalize(resolvedPath).toLowerCase();
            if (visitedFiles.has(normKey)) {
                resolvedTargetCache.set(specifier, null);
                return null;
            }
            try {
                const stat = fs.statSync(resolvedPath);
                if (stat.size > 500000) {
                    resolvedTargetCache.set(specifier, null);
                    return null;
                }
                const targetCode = fs.readFileSync(resolvedPath, "utf8");
                const nextVisited = new Set(visitedFiles);
                nextVisited.add(normKey);
                const analysis = analyzeSourceAst(targetCode, {
                    rootDir,
                    sourceFile: resolvedPath,
                    _reExportDepth: reExportDepth + 1,
                    _visitedFiles: nextVisited
                });
                resolvedTargetCache.set(specifier, analysis);
                return analysis;
            } catch {
                resolvedTargetCache.set(specifier, null);
                return null;
            }
        };

        for (const reExp of reExportSources) {
            const targetAnalysis = loadReExportTarget(reExp.source);
            if (!targetAnalysis) continue;
            if (reExp.kind === "all") {
                for (const sym of targetAnalysis.exportedSymbols || []) {
                    if (sym.isDefault || sym.exportKind === "type") continue;
                    const mapKey = "named:" + sym.name;
                    if (!exportedMap.has(mapKey)) {
                        exportedMap.set(mapKey, {
                            ...sym,
                            isDefault: false,
                            isReExport: true,
                            source: reExp.source,
                            exportKind: "value",
                            calls: Array.isArray(sym.calls) ? [...sym.calls] : []
                        });
                    }
                }
            } else if (reExp.kind === "named") {
                for (const spec of reExp.specifiers || []) {
                    if (spec.type === "ExportNamespaceSpecifier") continue;
                    const exportedName = spec.exported;
                    const isDefaultAlias = exportedName === "default";
                    const safeName = isDefaultAlias
                        ? (spec.local && spec.local !== "default" ? spec.local : "defaultExport")
                        : exportedName;
                    const mapKey = (isDefaultAlias ? "default:" : "named:") + safeName;
                    const existing = exportedMap.get(mapKey);
                    const targetSym = (targetAnalysis.exportedSymbols || []).find(sym =>
                        spec.local === "default" ? sym.isDefault : sym.name === spec.local
                    );
                    if (existing && targetSym) {
                        existing.type = targetSym.type || existing.type;
                        existing.isAsync = Boolean(targetSym.isAsync);
                        existing.params = Array.isArray(targetSym.params) ? targetSym.params : [];
                        existing.methods = Array.isArray(targetSym.methods) ? targetSym.methods : [];
                        existing.className = targetSym.className || existing.className || null;
                        existing.startLine = targetSym.startLine || existing.startLine;
                        existing.endLine = targetSym.endLine || existing.endLine;
                    }
                }
            }
        }

        // Post-walk resolution for local identifier exports and caller/internal linkage
        const localNameToExportedNames = new Map();
        for (const meta of exportedMap.values()) {
            if (meta._resolveFromLocal && meta.localName) {
                const resolved = resolveDeclaredIdentifier(meta.localName);
                if (resolved) {
                    meta.type = resolved.type;
                    meta.isAsync = Boolean(resolved.isAsync);
                    if (Array.isArray(resolved.params) && resolved.params.length > 0) {
                        meta.params = resolved.params;
                    }
                    if ((!meta.methods || meta.methods.length === 0) && Array.isArray(resolved.methods) && resolved.methods.length > 0) {
                        meta.methods = resolved.methods;
                    }
                    if (!meta.className && resolved.className) {
                        meta.className = resolved.className;
                    }
                    if (resolved.startLine) meta.startLine = resolved.startLine;
                    if (resolved.endLine) meta.endLine = resolved.endLine;
                    if (resolved.line) meta.line = resolved.line;
                    if (resolved.loc) meta.loc = resolved.loc;
                }
            }
            delete meta._resolveFromLocal;

            internalMap.delete(meta.name);
            if (meta.localName) {
                internalMap.delete(meta.localName);
                if (!localNameToExportedNames.has(meta.localName)) {
                    localNameToExportedNames.set(meta.localName, new Set());
                }
                localNameToExportedNames.get(meta.localName).add(meta.name);
            }

            meta.calls = Array.from(new Set(
                callEdges
                    .filter(c => c.caller === meta.name || (meta.localName && c.caller === meta.localName))
                    .map(c => c.callee)
            ));

            // Connect methods from declaredClasses or declaredObjects if not already attached
            if (!meta.methods || meta.methods.length === 0) {
                if (meta.className && declaredClasses.has(meta.className)) {
                    meta.methods = declaredClasses.get(meta.className).methods;
                } else if (declaredClasses.has(meta.name)) {
                    meta.methods = declaredClasses.get(meta.name).methods;
                } else if (meta.localName && declaredClasses.has(meta.localName)) {
                    meta.methods = declaredClasses.get(meta.localName).methods;
                } else if (declaredObjects.has(meta.name)) {
                    meta.methods = declaredObjects.get(meta.name).methods;
                } else if (meta.localName && declaredObjects.has(meta.localName)) {
                    meta.methods = declaredObjects.get(meta.localName).methods;
                } else if (declaredInstances.has(meta.name)) {
                    const inst = declaredInstances.get(meta.name);
                    if (inst?.className && declaredClasses.has(inst.className)) {
                        meta.methods = declaredClasses.get(inst.className).methods;
                        meta.className = inst.className;
                    }
                } else if (meta.isDefault && declaredClasses.size === 1) {
                    const singleClass = Array.from(declaredClasses.values())[0];
                    meta.methods = singleClass.methods;
                    meta.className = singleClass.name;
                } else if (meta.isDefault && declaredObjects.size === 1) {
                    const singleObj = Array.from(declaredObjects.values())[0];
                    meta.methods = singleObj.methods;
                }
            }

            exportedSymbols.push(meta);
        }
        for (const [fnName, meta] of internalMap.entries()) {
            const callers = callEdges
                .filter(c => c.callee === fnName && c.caller !== fnName)
                .flatMap(c => {
                    const mapped = localNameToExportedNames.get(c.caller);
                    return mapped && mapped.size > 0 ? Array.from(mapped) : [c.caller];
                });
            meta.callers = Array.from(new Set(callers));
            internalFunctions.push(meta);
        }
    }

    // Resilient fallback if AST parsing could not discover exports
    if (exportedSymbols.length === 0) {
        const expMatches = [...sourceCode.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([a-zA-Z0-9_$]+)/g)];
        for (const m of expMatches) {
            if (m[1] && !exportedSymbols.some(s => s.name === m[1])) {
                const isDef = /\bexport\s+default\b/.test(m[0]);
                exportedSymbols.push({
                    name: m[1],
                    localName: m[1],
                    type: "function",
                    isAsync: /\basync\b/.test(m[0]),
                    isDefault: isDef,
                    isReExport: false,
                    source: null,
                    exportKind: "value",
                    line: 1,
                    startLine: 1,
                    endLine: 1,
                    params: [],
                    calls: [],
                    methods: []
                });
            }
        }
        const namedExpMatches = [...sourceCode.matchAll(/export\s+\{([^}]+)\}/g)];
        for (const m of namedExpMatches) {
            for (const s of m[1].split(",")) {
                const trimmedSpec = s.trim();
                if (!trimmedSpec || /^type\s+/.test(trimmedSpec)) continue;
                const parts = trimmedSpec.split(/\s+as\s+/);
                const local = parts[0].trim();
                const exported = (parts[1] || local).trim();
                const isDef = exported === "default";
                const name = isDef ? (local && local !== "default" ? local : "defaultExport") : exported;
                if (name && !exportedSymbols.some(item => item.name === name)) {
                    exportedSymbols.push({
                        name,
                        localName: local,
                        type: "named-export",
                        isAsync: false,
                        isDefault: isDef,
                        isReExport: false,
                        source: null,
                        exportKind: "value",
                        line: 1,
                        startLine: 1,
                        endLine: 1,
                        params: [],
                        calls: [],
                        methods: []
                    });
                }
            }
        }
        const cjsObjMatch = sourceCode.match(/module\.exports\s*=\s*\{([^}]+)\}/s);
        if (cjsObjMatch) {
            for (const s of cjsObjMatch[1].split(",")) {
                const clean = s.trim().split(":")[0].trim();
                if (clean && /^[a-zA-Z0-9_$]+$/.test(clean) && !exportedSymbols.some(item => item.name === clean)) {
                    exportedSymbols.push({
                        name: clean,
                        localName: clean,
                        type: "function",
                        isAsync: false,
                        isDefault: false,
                        isReExport: false,
                        source: null,
                        exportKind: "value",
                        line: 1,
                        startLine: 1,
                        endLine: 1,
                        params: [],
                        calls: [],
                        methods: []
                    });
                }
            }
        }
        const cjsSingleMatch = sourceCode.match(/module\.exports\s*=\s*([a-zA-Z0-9_$]+)\s*;?/);
        if (cjsSingleMatch && !["null", "undefined", "true", "false"].includes(cjsSingleMatch[1])) {
            const single = cjsSingleMatch[1];
            if (!exportedSymbols.some(item => item.name === single)) {
                exportedSymbols.push({
                    name: single,
                    localName: single,
                    type: "function",
                    isAsync: false,
                    isDefault: true,
                    isReExport: false,
                    source: null,
                    exportKind: "value",
                    line: 1,
                    startLine: 1,
                    endLine: 1,
                    params: [],
                    calls: [],
                    methods: []
                });
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
            if (m[1] && !exportedSymbols.some(s => s.name === m[1] || s.localName === m[1]) && !internalFunctions.some(item => item.name === m[1])) {
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

    const exportedSymbolNames = Array.from(new Set(
        exportedSymbols
            .filter(s => s.exportKind !== "type")
            .map(s => (s.name === "default" ? (s.localName || "defaultExport") : s.name))
            .filter(Boolean)
    ));

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
        exportedSymbolNames,
        unboundCommonJsExports,
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
