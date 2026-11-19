import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";
import traversePkg from "@babel/traverse";
import generatePkg from "@babel/generator";
import * as t from "@babel/types";
import { isVitestTestCode } from "./testFrameworkNormalization.service.js";

const traverse = traversePkg?.default || traversePkg;
const generate = generatePkg?.default || generatePkg;

const MODULE_EXTENSIONS = [
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
    "/index.js",
    "/index.jsx",
    "/index.mjs",
    "/index.cjs"
];

const MOCK_HOIST_METHODS = new Set(["mock", "unmock", "deepUnmock", "enableAutomock", "disableAutomock"]);

function normalizeCanonicalPath(p) {
    if (!p || typeof p !== "string") return "";
    const normalized = path.normalize(p).replace(/\\/g, "/");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function stripModuleExtension(p) {
    return p.replace(/(?:\/index)?\.[cm]?[jt]sx?$/i, "");
}

/**
 * Resolves a relative module specifier from a file on disk if it actually exists.
 * Handles TypeScript ESM-style imports (e.g. `./foo.js` -> `./foo.ts`).
 */
export function resolveRelativeModuleOnDisk(specifier, fromFile, rootDir) {
    if (!specifier || !specifier.startsWith(".") || !fromFile || !rootDir) {
        return null;
    }
    const absFrom = path.isAbsolute(fromFile) ? fromFile : path.join(rootDir, fromFile);
    const fromDir = path.dirname(absFrom);
    const rawTarget = path.resolve(fromDir, specifier);
    const candidates = [rawTarget];

    if (/\.[cm]?jsx?$/i.test(rawTarget)) {
        candidates.push(rawTarget.replace(/\.[cm]?jsx?$/i, ""));
    }

    for (const base of candidates) {
        for (const ext of MODULE_EXTENSIONS) {
            const candidate = base + ext;
            try {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                    return candidate;
                }
            } catch (_) {
                // ignore fs permission/stat errors
            }
        }
    }
    return null;
}

/**
 * Computes a canonical extension-less key for comparing module specifiers across files.
 */
function canonicalModuleKey(specifier, fromFile, rootDir) {
    if (!specifier || !specifier.startsWith(".") || !fromFile || !rootDir) {
        return specifier || "";
    }
    const onDisk = resolveRelativeModuleOnDisk(specifier, fromFile, rootDir);
    if (onDisk) {
        return stripModuleExtension(normalizeCanonicalPath(onDisk));
    }
    const absFrom = path.isAbsolute(fromFile) ? fromFile : path.join(rootDir, fromFile);
    const resolved = path.resolve(path.dirname(absFrom), specifier);
    return stripModuleExtension(normalizeCanonicalPath(resolved));
}

function nativeModuleKey(specifier, fromFile, rootDir) {
    const resolved = specifier.startsWith(".") && fromFile && rootDir && resolveRelativeModuleOnDisk(specifier, fromFile, rootDir);
    return resolved ? normalizeCanonicalPath(resolved) : canonicalModuleKey(specifier, fromFile, rootDir);
}

function parseCodeToAst(code) {
    return parse(code, {
        sourceType: "unambiguous",
        errorRecovery: false,
        plugins: [
            "typescript",
            "jsx",
            "decorators-legacy",
            "classProperties",
            "dynamicImport",
            "topLevelAwait"
        ]
    });
}

function collectModuleImportsFromAst(ast, fromFile, rootDir) {
    const importsByModule = new Map();
    const importedBindings = new Map();
    const nativeRequires = new Map();

    const addImport = (specifier, importedName, localName) => {
        if (!specifier || typeof specifier !== "string") return;
        const key = canonicalModuleKey(specifier, fromFile, rootDir);
        if (!importsByModule.has(key)) {
            importsByModule.set(key, new Set());
        }
        if (importedName && importedName !== "*") {
            importsByModule.get(key).add(importedName);
        }
        if (localName) {
            importedBindings.set(localName, { specifier, canonicalKey: key, importedName });
        }
    };

    traverse(ast, {
        ImportDeclaration(nodePath) {
            if (nodePath.node.importKind === "type") return;
            const specifier = nodePath.node.source?.value;
            if (!specifier) return;
            for (const spec of nodePath.node.specifiers || []) {
                if (spec.importKind === "type") continue;
                if (t.isImportSpecifier(spec)) {
                    const importedName = t.isIdentifier(spec.imported)
                        ? spec.imported.name
                        : spec.imported?.value;
                    addImport(specifier, importedName, spec.local?.name);
                } else if (t.isImportDefaultSpecifier(spec)) {
                    addImport(specifier, "default", spec.local?.name);
                } else if (t.isImportNamespaceSpecifier(spec)) {
                    addImport(specifier, "*", spec.local?.name);
                }
            }
        },
        CallExpression(nodePath) {
            const { callee, arguments: args, loc } = nodePath.node;
            const [target] = args;
            if (!t.isIdentifier(callee, { name: "require" }) || !t.isStringLiteral(target) ||
                nodePath.scope.getBinding("require")) return;
            const specifier = target.value;
            const key = nativeModuleKey(specifier, fromFile, rootDir);
            const parent = nodePath.parentPath.node;
            const id = t.isVariableDeclarator(parent) && parent.init === nodePath.node ? parent.id : null;
            const named = t.isObjectPattern(id)
                ? id.properties.filter(prop => t.isObjectProperty(prop) && !prop.computed)
                    .map(prop => prop.key.name ?? prop.key.value).filter(Boolean) : [];
            if (t.isMemberExpression(parent) && parent.object === nodePath.node && !parent.computed) named.push(parent.property.name);
            const previous = nativeRequires.get(key);
            nativeRequires.set(key, { specifier, line: previous?.line ?? loc?.start.line,
                named: [...new Set([...(previous?.named || []), ...named])],
                wholeModule: Boolean(previous?.wholeModule || t.isIdentifier(id)) });
        },
        VariableDeclarator(nodePath) {
            const init = nodePath.node.init;
            if (
                t.isCallExpression(init) &&
                t.isIdentifier(init.callee, { name: "require" }) &&
                init.arguments.length === 1 &&
                t.isStringLiteral(init.arguments[0])
            ) {
                const specifier = init.arguments[0].value;
                const id = nodePath.node.id;
                if (t.isObjectPattern(id)) {
                    for (const prop of id.properties) {
                        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                            const localName = t.isIdentifier(prop.value) ? prop.value.name : prop.key.name;
                            addImport(specifier, prop.key.name, localName);
                        }
                    }
                } else if (t.isIdentifier(id)) {
                    addImport(specifier, "*", id.name);
                }
            }
        }
    });

    return { importsByModule, importedBindings, nativeRequires };
}

export function describeNativeCommonJsDependencies(code, filePath, rootDir) {
    try {
        return [...collectModuleImportsFromAst(parseCodeToAst(code), filePath, rootDir).nativeRequires.values()];
    } catch {
        return [];
    }
}

function collectSourceFileImports(sourceFile, rootDir) {
    const empty = { importsByModule: new Map(), nativeRequires: new Map() };
    if (!sourceFile || !rootDir) return empty;
    const absSource = path.isAbsolute(sourceFile) ? sourceFile : path.join(rootDir, sourceFile);
    if (!fs.existsSync(absSource)) return empty;
    try {
        const srcCode = fs.readFileSync(absSource, "utf8");
        const ast = parseCodeToAst(srcCode);
        return collectModuleImportsFromAst(ast, absSource, rootDir);
    } catch (_) {
        return empty;
    }
}

function isMockCallExpression(expr, runnerObjName, scope) {
    if (!t.isCallExpression(expr)) return null;
    if (!t.isMemberExpression(expr.callee)) return null;
    const obj = expr.callee.object;
    const prop = expr.callee.property;
    if (!t.isIdentifier(obj) || !t.isIdentifier(prop)) return null;
    const binding = scope?.getBinding(obj.name);
    const imported = binding?.path.isImportSpecifier() &&
        ["vitest", "@jest/globals"].includes(binding.path.parent.source.value);
    const objName = imported ? binding.path.node.imported.name : obj.name;
    if (binding && !imported && binding.path.parentPath?.isImportDeclaration()) return null;
    const propName = prop.name;
    if (objName !== runnerObjName && objName !== "jest" && objName !== "vi") return null;
    if (!MOCK_HOIST_METHODS.has(propName) && propName !== "doMock") return null;
    return { objName, propName, isHoistedMethod: MOCK_HOIST_METHODS.has(propName) };
}

function findFactoryReturnedObject(factoryNode) {
    if (!t.isArrowFunctionExpression(factoryNode) && !t.isFunctionExpression(factoryNode)) {
        return null;
    }
    if (t.isObjectExpression(factoryNode.body)) {
        return factoryNode.body;
    }
    if (t.isBlockStatement(factoryNode.body)) {
        for (const stmt of factoryNode.body.body) {
            if (t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)) {
                return stmt.argument;
            }
        }
    }
    return null;
}

function factoryUsesActualOrSpread(factoryNode, returnedObj, code) {
    if (returnedObj && returnedObj.properties.some(p => t.isSpreadElement(p))) {
        return true;
    }
    const slice = (factoryNode.start != null && factoryNode.end != null)
        ? code.slice(factoryNode.start, factoryNode.end)
        : generate(factoryNode).code;
    return /\b(?:requireActual|importActual)\b/.test(slice);
}

function factoryConfiguresReturnValues(factoryNode, code) {
    if (!factoryNode) return false;
    const slice = (factoryNode.start != null && factoryNode.end != null)
        ? code.slice(factoryNode.start, factoryNode.end)
        : generate(factoryNode).code;
    return /\.(?:mockReturnValue|mockReturnValueOnce|mockResolvedValue|mockResolvedValueOnce|mockRejectedValue|mockImplementation|mockImplementationOnce)\s*\(|\b(?:jest|vi)\.fn\s*\(\s*(?:\(|function\b)/.test(slice);
}

function isRunnerImportStatement(stmt) {
    if (t.isImportDeclaration(stmt)) {
        const src = stmt.source?.value;
        return src === "@jest/globals" || src === "vitest";
    }
    if (t.isVariableDeclaration(stmt)) {
        return stmt.declarations.some(d =>
            t.isCallExpression(d.init) &&
            t.isIdentifier(d.init.callee, { name: "require" }) &&
            t.isStringLiteral(d.init.arguments[0]) &&
            (d.init.arguments[0].value === "@jest/globals" || d.init.arguments[0].value === "vitest")
        );
    }
    return false;
}

function isViHoistedStatement(stmt) {
    if (!t.isVariableDeclaration(stmt)) return false;
    return stmt.declarations.some(d =>
        t.isCallExpression(d.init) &&
        t.isMemberExpression(d.init.callee) &&
        t.isIdentifier(d.init.callee.object, { name: "vi" }) &&
        t.isIdentifier(d.init.callee.property, { name: "hoisted" })
    );
}

function isInlineMockFactory(node) {
    return t.isArrowFunctionExpression(node) || t.isFunctionExpression(node);
}

/**
 * Applies non-overlapping source range patches in reverse order to preserve formatting outside edited nodes.
 */
function applySourcePatches(source, patches) {
    if (!patches.length) return source;
    const sorted = [...patches].sort((a, b) => b.start - a.start);
    let out = source;
    let lastStart = Infinity;
    for (const p of sorted) {
        if (p.end > lastStart) continue;
        out = out.slice(0, p.start) + p.replacement + out.slice(p.end);
        lastStart = p.start;
    }
    return out;
}

/**
 * Pre-Execution Mock Validation & Normalization Layer.
 * Statically inspects and heals Jest/Vitest mock declarations before any test runner executes.
 */
export function validateAndNormalizeMocks({
    code = "",
    filePath = "",
    sourceFile = "",
    rootDir = "",
    framework = ""
} = {}) {
    if (!code || typeof code !== "string") {
        return { valid: true, code: code || "", modified: false, repairs: [], diagnostics: [] };
    }

    const isVitest = framework === "vitest" || (framework !== "jest" && isVitestTestCode(code));
    const runnerObjName = isVitest ? "vi" : "jest";
    const repairs = [];
    const diagnostics = [];

    let ast;
    try {
        ast = parseCodeToAst(code);
    } catch (err) {
        return {
            valid: false,
            code,
            modified: false,
            repairs,
            diagnostics: [{ severity: "error", rule: "MOCK_PARSE_ERROR", message: err.message }]
        };
    }

    const absSourceKey = (sourceFile && rootDir)
        ? stripModuleExtension(normalizeCanonicalPath(path.isAbsolute(sourceFile) ? sourceFile : path.join(rootDir, sourceFile)))
        : "";

    const { importsByModule: sourceImports, nativeRequires } = collectSourceFileImports(sourceFile, rootDir);
    const testImports = collectModuleImportsFromAst(ast, filePath || sourceFile, rootDir);

    const mockedModuleKeys = new Set();
    let hasConfiguredMockFactories = false;
    let hasBeforeEachReconfig = false;
    const patches = [];

    // 1. Inspect mock calls and collect targeted AST-range patches
    traverse(ast, {
        CallExpression(nodePath) {
            const callee = nodePath.node.callee;
            if (t.isIdentifier(callee, { name: "beforeEach" }) && nodePath.node.start != null && nodePath.node.end != null) {
                const bodySlice = code.slice(nodePath.node.start, nodePath.node.end);
                if (/\.(?:mockReturnValue|mockResolvedValue|mockImplementation)\s*\(/.test(bodySlice)) {
                    hasBeforeEachReconfig = true;
                }
            }

            const mockMeta = isMockCallExpression(nodePath.node, runnerObjName, nodePath.scope);
            if (!mockMeta) return;

            const args = nodePath.node.arguments;
            const firstArg = args[0];
            if (!t.isStringLiteral(firstArg)) return;
            const specifier = firstArg.value;
            const specKey = canonicalModuleKey(specifier, filePath || sourceFile, rootDir);

            // Rule 1: Self-mocking guard
            if (
                absSourceKey &&
                specKey &&
                specKey === absSourceKey &&
                t.isExpressionStatement(nodePath.parent) &&
                nodePath.parent.start != null &&
                nodePath.parent.end != null
            ) {
                let removeEnd = nodePath.parent.end;
                if (code[removeEnd] === "\r") removeEnd++;
                if (code[removeEnd] === "\n") removeEnd++;
                patches.push({ start: nodePath.parent.start, end: removeEnd, replacement: "" });
                repairs.push({
                    rule: "SELF_MOCK_REMOVED",
                    detail: `Removed self-mock of target source file '${specifier}'.`
                });
                return;
            }

            mockedModuleKeys.add(specKey);
            const native = isVitest && nativeRequires.get(nativeModuleKey(specifier, filePath || sourceFile, rootDir));
            if (native && mockMeta.objName === 'vi') {
                diagnostics.push({
                    severity: 'error', rule: 'VITEST_NATIVE_REQUIRE_MOCK',
                    line: nodePath.node.loc?.start.line, sourceLine: native.line,
                    message: `Vitest's ${mockMeta.propName}('${specifier}') does not replace the dependency loaded by the source's require('${native.specifier}'). Use a scoped CommonJS mock before loading the source.`,
                });
            }

            let callMutated = false;

            // Rule 2: Virtual flag normalization for Jest relative & uninstalled external mocks
            if (!isVitest && rootDir) {
                let existsOnDisk = true;
                if (specifier.startsWith(".") && (filePath || sourceFile)) {
                    existsOnDisk = Boolean(resolveRelativeModuleOnDisk(specifier, filePath || sourceFile, rootDir));
                } else if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:")) {
                    const pkgName = specifier.startsWith("@")
                        ? specifier.split("/").slice(0, 2).join("/")
                        : specifier.split("/")[0];
                    existsOnDisk = fs.existsSync(path.join(rootDir, "node_modules", pkgName));
                }
                const optsArg = args[2];

                if (existsOnDisk) {
                    if (t.isObjectExpression(optsArg)) {
                        const filteredProps = optsArg.properties.filter(p =>
                            !(t.isObjectProperty(p) && t.isIdentifier(p.key, { name: "virtual" }) && t.isBooleanLiteral(p.value, { value: true }))
                        );
                        if (filteredProps.length !== optsArg.properties.length) {
                            if (filteredProps.length === 0 && args.length === 3) {
                                args.pop();
                            } else {
                                optsArg.properties = filteredProps;
                            }
                            callMutated = true;
                            repairs.push({
                                rule: "VIRTUAL_FLAG_STRIPPED",
                                detail: `Removed { virtual: true } from existing module mock '${specifier}'.`
                            });
                        }
                    }
                } else {
                    if (args.length === 2 && isInlineMockFactory(args[1])) {
                        args.push(t.objectExpression([t.objectProperty(t.identifier("virtual"), t.booleanLiteral(true))]));
                        callMutated = true;
                        repairs.push({
                            rule: "VIRTUAL_FLAG_ADDED",
                            detail: `Added { virtual: true } for non-existent module mock '${specifier}'.`
                        });
                    } else if (t.isObjectExpression(optsArg)) {
                        const hasVirtual = optsArg.properties.some(p =>
                            t.isObjectProperty(p) && t.isIdentifier(p.key, { name: "virtual" })
                        );
                        if (!hasVirtual) {
                            optsArg.properties.push(t.objectProperty(t.identifier("virtual"), t.booleanLiteral(true)));
                            callMutated = true;
                            repairs.push({
                                rule: "VIRTUAL_FLAG_ADDED",
                                detail: `Added virtual: true option for non-existent module mock '${specifier}'.`
                            });
                        }
                    }
                }
            }

            // Rule 3: Validate inline factory & export contract
            if (args.length >= 2) {
                const factoryArg = args[1];
                const isFactoryFn = isInlineMockFactory(factoryArg);
                const isUndefinedOrNull = t.isIdentifier(factoryArg, { name: "undefined" }) || t.isNullLiteral(factoryArg);
                if (!isFactoryFn && !isUndefinedOrNull) {
                    diagnostics.push({
                        severity: "error",
                        rule: "MOCK_FACTORY_INVALID",
                        message: `${runnerObjName}.${mockMeta.propName}('${specifier}') factory must be an inline function.`,
                        line: nodePath.node.loc?.start?.line
                    });
                } else if (isFactoryFn) {
                    if (factoryConfiguresReturnValues(factoryArg, code)) {
                        hasConfiguredMockFactories = true;
                    }

                    // Rule 5: Export contract alignment
                    const returnedObj = findFactoryReturnedObject(factoryArg);
                    if (returnedObj && !factoryUsesActualOrSpread(factoryArg, returnedObj, code)) {
                        const existingKeys = new Set();
                        for (const prop of returnedObj.properties) {
                            if (t.isObjectProperty(prop) || t.isObjectMethod(prop)) {
                                if (t.isIdentifier(prop.key)) existingKeys.add(prop.key.name);
                                else if (t.isStringLiteral(prop.key)) existingKeys.add(prop.key.value);
                            }
                        }

                        const expectedNames = new Set([
                            ...(sourceImports.get(specKey) || []),
                            ...(testImports.importsByModule.get(specKey) || [])
                        ]);

                        for (const expectedName of expectedNames) {
                            if (!existingKeys.has(expectedName)) {
                                if (isVitest) {
                                    diagnostics.push({
                                        severity: "error",
                                        rule: "MOCK_MISSING_EXPORT",
                                        message: `Vitest mock for '${specifier}' does not provide the imported '${expectedName}' export.`,
                                        line: nodePath.node.loc?.start.line,
                                    });
                                    continue;
                                }
                                returnedObj.properties.push(
                                    t.objectProperty(
                                        t.identifier(expectedName),
                                        t.callExpression(
                                            t.memberExpression(t.identifier(runnerObjName), t.identifier("fn")),
                                            []
                                        )
                                    )
                                );
                                existingKeys.add(expectedName);
                                callMutated = true;
                                repairs.push({
                                    rule: "MOCK_MISSING_EXPORT",
                                    detail: `Added missing mock export '${expectedName}' to '${specifier}' factory.`
                                });
                            }
                        }
                    }
                }
            }

            if (callMutated && nodePath.node.start != null && nodePath.node.end != null) {
                patches.push({
                    start: nodePath.node.start,
                    end: nodePath.node.end,
                    replacement: generate(nodePath.node, { comments: true }).code
                });
            }

            // Rule 3b: Flag non-top-level jest.mock / vi.mock
            if (mockMeta.isHoistedMethod && nodePath.parentPath && !t.isProgram(nodePath.parentPath.parent)) {
                diagnostics.push({
                    severity: "warning",
                    rule: "MOCK_NOT_TOP_LEVEL",
                    message: `${runnerObjName}.${mockMeta.propName}('${specifier}') is nested inside a block; consider top-level placement or ${runnerObjName}.doMock.`,
                    line: nodePath.node.loc?.start?.line
                });
            }
        }
    });

    // 2. Rule 6: Lifecycle hook safety (resetAllMocks / restoreAllMocks wiping factory return values)
    const hasSpyOnForLifecycle = /\b(?:jest|vi)\.spyOn\s*\(/.test(code);
    if (hasConfiguredMockFactories && !hasBeforeEachReconfig) {
        traverse(ast, {
            CallExpression(nodePath) {
                const callee = nodePath.node.callee;
                if (
                    t.isMemberExpression(callee) &&
                    t.isIdentifier(callee.object) &&
                    (callee.object.name === "jest" || callee.object.name === "vi") &&
                    t.isIdentifier(callee.property) &&
                    (callee.property.name === "resetAllMocks" || (callee.property.name === "restoreAllMocks" && !hasSpyOnForLifecycle)) &&
                    callee.property.start != null &&
                    callee.property.end != null
                ) {
                    const prevName = callee.property.name;
                    patches.push({
                        start: callee.property.start,
                        end: callee.property.end,
                        replacement: "clearAllMocks"
                    });
                    repairs.push({
                        rule: "MOCK_RESET_PRESERVED",
                        detail: `Converted ${callee.object.name}.${prevName}() to clearAllMocks() to preserve factory mockReturnValue/mockImplementation.`
                    });
                }
            }
        });
    }

    // 3. Rule 7: Validate the specific function used as a spy assertion.
    const extractMemberChain = (node) => {
        if (!node) return null;
        if (t.isIdentifier(node)) return [node.name];
        if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
            const prefix = extractMemberChain(node.object);
            if (!prefix) return null;
            const propName = node.computed
                ? (t.isStringLiteral(node.property) ? node.property.value : null)
                : (t.isIdentifier(node.property) ? node.property.name : null);
            if (!propName) return null;
            return [...prefix, propName];
        }
        return null;
    };

    const spies = [];
    traverse(ast, {
        CallExpression(p) {
            const { callee, arguments: args } = p.node;
            if (t.isMemberExpression(callee) && t.isIdentifier(callee.object, { name: runnerObjName }) &&
                t.isIdentifier(callee.property, { name: "spyOn" }) && t.isStringLiteral(args[1])) {
                const targetChain = extractMemberChain(args[0]);
                if (!targetChain || targetChain.length === 0) return;
                const rootName = targetChain[0];
                const binding = p.scope.getBinding(rootName);
                const hook = p.getFunctionParent()?.parentPath;
                const hookScope = hook?.isCallExpression() && ["beforeEach", "beforeAll"].includes(hook.node.callee.name)
                    ? hook.scope : null;
                if (binding) {
                    const fullPath = [...targetChain, args[1].value].join(".");
                    spies.push({ binding, method: args[1].value, fullPath, scope: p.scope, hookScope });
                }
            }
        },
    });
    traverse(ast, {
        CallExpression(p) {
            const callee = p.node.callee;
            if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.property) ||
                !/^toHaveBeenCalled/.test(callee.property.name)) return;
            const expectation = t.isMemberExpression(callee.object) && t.isIdentifier(callee.object.property, { name: "not" })
                ? callee.object.object : callee.object;
            if (!t.isCallExpression(expectation) || !t.isIdentifier(expectation.callee, { name: "expect" })) return;
            const target = expectation.arguments[0];
            const chain = extractMemberChain(target);
            if (!chain || chain.length === 0) return;
            const rootName = chain[0];
            const info = testImports.importedBindings.get(rootName);
            const binding = p.scope.getBinding(rootName);
            if (!info?.specifier.startsWith(".") || !binding || mockedModuleKeys.has(info.canonicalKey)) return;
            const fullPath = chain.join(".");
            const member = chain.length > 1 ? chain.slice(1).join(".") : null;
            if (chain.length > 1 && spies.some(spy => {
                if (spy.binding !== binding || spy.fullPath !== fullPath) return false;
                for (let scope = p.scope; scope; scope = scope.parent) {
                    if (scope === spy.scope || scope === spy.hookScope) return true;
                }
                return false;
            })) return;
            // Local spies shadowing an imported name are not claims about the import.
            if (!binding.path.isImportSpecifier() && !binding.path.isImportDefaultSpecifier() &&
                !binding.path.isImportNamespaceSpecifier() &&
                !(binding.path.isVariableDeclarator() && binding.path.node.init?.callee?.name === "require")) return;
            diagnostics.push({
                severity: "warning",
                rule: "UNMOCKED_SPY_ASSERTION",
                message: `Assertion expects '${rootName}${member ? "." + member : ""}' to have been called, but '${info.specifier}' is not mocked.`,
                line: p.node.loc?.start?.line,
            });
        },
    });

    let currentCode = applySourcePatches(code, patches);

    // 4. Rule 4: Top-level mock hoisting order in Program.body (as a clean second pass preserving exact slices)
    try {
        const hoistAst = parseCodeToAst(currentCode);
        const body = hoistAst.program.body;
        const topLevelMocksToMove = [];
        let firstNonRunnerImportIdx = -1;
        let insertAfterStmt = null;

        body.forEach((stmt, idx) => {
            if (isRunnerImportStatement(stmt) || isViHoistedStatement(stmt)) {
                if (firstNonRunnerImportIdx === -1) {
                    insertAfterStmt = stmt;
                }
            } else if (
                t.isExpressionStatement(stmt) &&
                isMockCallExpression(stmt.expression, runnerObjName)?.isHoistedMethod
            ) {
                if (firstNonRunnerImportIdx !== -1) {
                    topLevelMocksToMove.push(stmt);
                }
            } else if (
                firstNonRunnerImportIdx === -1 &&
                (t.isImportDeclaration(stmt) ||
                    (t.isVariableDeclaration(stmt) && stmt.declarations.some(d =>
                        t.isCallExpression(d.init) && t.isIdentifier(d.init.callee, { name: "require" })
                    )))
            ) {
                firstNonRunnerImportIdx = idx;
            }
        });

        if (topLevelMocksToMove.length > 0 && firstNonRunnerImportIdx !== -1) {
            const movedSlices = [];
            const removeRanges = [];
            for (const stmt of topLevelMocksToMove) {
                if (stmt.start != null && stmt.end != null) {
                    movedSlices.push(currentCode.slice(stmt.start, stmt.end).trim());
                    let end = stmt.end;
                    if (currentCode[end] === "\r") end++;
                    if (currentCode[end] === "\n") end++;
                    removeRanges.push({ start: stmt.start, end, replacement: "" });
                }
            }
            if (movedSlices.length > 0) {
                const insertPos = insertAfterStmt && insertAfterStmt.end != null
                    ? (currentCode[insertAfterStmt.end] === "\r" && currentCode[insertAfterStmt.end + 1] === "\n"
                        ? insertAfterStmt.end + 2
                        : (currentCode[insertAfterStmt.end] === "\n" ? insertAfterStmt.end + 1 : insertAfterStmt.end))
                    : (body[firstNonRunnerImportIdx].start ?? 0);

                const hoistedBlock = movedSlices.join("\n") + "\n";
                const allHoistPatches = [
                    ...removeRanges,
                    { start: insertPos, end: insertPos, replacement: hoistedBlock }
                ];
                currentCode = applySourcePatches(currentCode, allHoistPatches);
                repairs.push({
                    rule: "MOCK_HOIST_ORDER",
                    detail: `Hoisted ${movedSlices.length} ${runnerObjName}.mock() declaration(s) above module imports.`
                });
            }
        }
    } catch (_) {
        // Keep currentCode if re-parse fails
    }

    const hasErrors = diagnostics.some(d => d.severity === "error");
    return {
        valid: !hasErrors,
        code: currentCode,
        modified: currentCode !== code,
        repairs,
        diagnostics
    };
}

function classifyLiteralReturnNode(node) {
    if (!node) return { kind: "unknown", props: new Set() };
    if (t.isArrayExpression(node)) {
        const props = new Set();
        const first = node.elements?.[0];
        if (t.isObjectExpression(first)) {
            for (const p of first.properties || []) {
                const key = p.key?.name || p.key?.value;
                if (key) props.add(key);
            }
        }
        return { kind: "array", props };
    }
    if (t.isObjectExpression(node)) {
        const props = new Set();
        for (const p of node.properties || []) {
            const key = p.key?.name || p.key?.value;
            if (key) props.add(key);
        }
        return { kind: "object", props };
    }
    if (t.isNumericLiteral(node)) return { kind: "number", props: new Set() };
    if (t.isBooleanLiteral(node)) return { kind: "boolean", props: new Set() };
    if (t.isStringLiteral(node)) return { kind: "string", props: new Set() };
    if (t.isNullLiteral(node)) return { kind: "null", props: new Set() };
    return { kind: "unknown", props: new Set() };
}

/**
 * Extracts property names explicitly required by test assertions
 * (e.g. expect(item).toHaveProperty('id'), expect(item.id).toBe(...)).
 *
 * @param {string} code
 * @returns {string[]}
 */
export function extractAssertionPropertyRequirements(code = "") {
    if (!code || typeof code !== "string") return [];
    let ast;
    try {
        ast = parse(code, {
            sourceType: "unambiguous",
            plugins: ["typescript", "jsx"],
            errorRecovery: true,
        });
    } catch {
        return [];
    }
    const props = new Set();
    traverse(ast, {
        CallExpression(p) {
            const { callee, arguments: args } = p.node;
            if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.property)) return;
            const matcher = callee.property.name;
            if (matcher === "toHaveProperty" && t.isStringLiteral(args[0])) {
                const topKey = args[0].value.split(".")[0];
                if (topKey) props.add(topKey);
            } else if ((matcher === "toMatchObject" || matcher === "toEqual" || matcher === "toStrictEqual") && t.isObjectExpression(args[0])) {
                for (const prop of args[0].properties || []) {
                    const key = prop.key?.name || prop.key?.value;
                    if (key) props.add(key);
                }
            }
            // Check expect(x.prop) — but not spy/mock call assertions such as expect(res.status).toHaveBeenCalledWith(...),
            // where `status` is a method on a response double rather than a data field the mock must return.
            if (t.isCallExpression(callee.object) && t.isIdentifier(callee.object.callee, { name: "expect" }) &&
                !/^(?:toHaveBeenCalled|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toHaveReturned|toHaveLastReturnedWith|toHaveNthReturnedWith|toBeCalled|lastCalledWith|nthCalledWith|toReturn)/.test(matcher)) {
                const expectArg = callee.object.arguments?.[0];
                if (t.isMemberExpression(expectArg) && t.isIdentifier(expectArg.property) && expectArg.property.name !== "length") {
                    props.add(expectArg.property.name);
                }
            }
        },
    });
    return [...props];
}

/**
 * Validates mock implementations in a test file against analyzed data-access
 * contracts BEFORE Docker execution.
 *
 * @param {object} params
 * @returns {{ valid: boolean, violations: Array<object> }}
 */
export function validateMockContracts({
    code = "",
    contracts = [],
    framework = "",
} = {}) {
    if (!code || (!Array.isArray(contracts) || contracts.length === 0)) {
        // Still allow empty-mock-object check against assertion requirements if code has assertions
        if (!code) return { valid: true, violations: [] };
    }

    let ast;
    try {
        ast = parse(code, {
            sourceType: "unambiguous",
            plugins: ["typescript", "jsx"],
            errorRecovery: true,
        });
    } catch {
        return { valid: true, violations: [] };
    }

    const violations = [];
    const mockedModules = new Map();

    // Inspect vi.mock / jest.mock factories and per-method mockResolvedValue / mockReturnValue
    traverse(ast, {
        CallExpression(p) {
            const { callee, arguments: args } = p.node;
            if (
                t.isMemberExpression(callee) &&
                t.isIdentifier(callee.object) &&
                ["jest", "vi"].includes(callee.object.name) &&
                t.isIdentifier(callee.property, { name: "mock" }) &&
                t.isStringLiteral(args[0])
            ) {
                const modSpec = args[0].value;
                const factory = args[1];
                let hasProxy = false;
                const definedMethods = new Map();

                if (factory) {
                    p.get("arguments.1").traverse({
                        NewExpression(np) {
                            if (t.isIdentifier(np.node.callee, { name: "Proxy" })) hasProxy = true;
                        },
                        ObjectProperty(op) {
                            const key = op.node.key?.name || op.node.key?.value;
                            if (!key) return;
                            const valNode = op.node.value;
                            let returnInfo = { kind: "unknown", props: new Set(), isAsyncMock: null, isChainable: false };
                            if (t.isCallExpression(valNode)) {
                                // e.g., vi.fn().mockResolvedValue(...) or vi.fn(() => createChainableQuery(...))
                                const cal = valNode.callee;
                                if (t.isMemberExpression(cal) && t.isIdentifier(cal.property)) {
                                    const mName = cal.property.name;
                                    if (mName === "mockResolvedValue" || mName === "mockResolvedValueOnce") {
                                        returnInfo = { ...classifyLiteralReturnNode(valNode.arguments[0]), isAsyncMock: true, isChainable: false };
                                    } else if (mName === "mockReturnValue" || mName === "mockReturnValueOnce") {
                                        returnInfo = { ...classifyLiteralReturnNode(valNode.arguments[0]), isAsyncMock: false, isChainable: false };
                                    }
                                } else if (
                                    t.isMemberExpression(cal) &&
                                    t.isIdentifier(cal.property, { name: "fn" }) &&
                                    valNode.arguments?.[0] &&
                                    (t.isArrowFunctionExpression(valNode.arguments[0]) || t.isFunctionExpression(valNode.arguments[0]))
                                ) {
                                    const body = valNode.arguments[0].body;
                                    if (t.isCallExpression(body) && t.isIdentifier(body.callee) && /chain/i.test(body.callee.name)) {
                                        returnInfo = { ...classifyLiteralReturnNode(body.arguments[0]), isAsyncMock: true, isChainable: true };
                                    }
                                }
                            }
                            definedMethods.set(key, returnInfo);
                        },
                    });
                }

                mockedModules.set(modSpec, { hasProxy, definedMethods, line: p.node.loc?.start?.line });
            }
        },
    });

    for (const contract of contracts) {
        const modEntry = mockedModules.get(contract.importSource);
        if (!modEntry) continue; // Not mocked in this file (or mocked via relative path resolution)

        const methodInfo = modEntry.definedMethods.get(contract.method);
        if (!methodInfo && !modEntry.hasProxy) {
            violations.push({
                severity: "error",
                rule: "MOCK_METHOD_MISSING",
                dependency: contract.importSource,
                method: contract.method,
                message: `Mock for '${contract.importSource}' is missing method '${contract.method}' called by '${contract.functionName}'.`,
            });
            continue;
        }
        if (!methodInfo) continue;

        // 1. Expected return type check
        if (contract.expectedReturnType === "array" && methodInfo.kind !== "unknown" && methodInfo.kind !== "array") {
            violations.push({
                severity: "error",
                rule: "MOCK_RETURN_TYPE_MISMATCH",
                dependency: contract.importSource,
                method: contract.method,
                message: `Contract expects '${contract.method}' to return an array (${contract.arrayOperations?.join(", ") || "collection"}), but mock returns ${methodInfo.kind}.`,
            });
        } else if (
            contract.expectedReturnType === "object" &&
            methodInfo.kind !== "unknown" &&
            methodInfo.kind !== "object"
        ) {
            violations.push({
                severity: "error",
                rule: "MOCK_RETURN_TYPE_MISMATCH",
                dependency: contract.importSource,
                method: contract.method,
                message: `Contract expects '${contract.method}' to return an object, but mock returns ${methodInfo.kind}.`,
            });
        } else if (
            contract.expectedReturnType === "number" &&
            methodInfo.kind !== "unknown" &&
            methodInfo.kind !== "number"
        ) {
            violations.push({
                severity: "error",
                rule: "MOCK_RETURN_TYPE_MISMATCH",
                dependency: contract.importSource,
                method: contract.method,
                message: `Contract expects '${contract.method}' to return a number, but mock returns ${methodInfo.kind}.`,
            });
        }

        // 2. Async behavior check
        if (contract.isAsync && methodInfo.isAsyncMock === false && !methodInfo.isChainable) {
            violations.push({
                severity: "warning",
                rule: "MOCK_ASYNC_MISMATCH",
                dependency: contract.importSource,
                method: contract.method,
                message: `'${contract.method}' is awaited/chained as async in source, but mock uses synchronous mockReturnValue.`,
            });
        }

        // 3. Chained method check
        if (contract.chainedMethods?.length > 0 && !methodInfo.isChainable && ["array", "object", "number", "string"].includes(methodInfo.kind)) {
            violations.push({
                severity: "error",
                rule: "MOCK_CHAIN_MISMATCH",
                dependency: contract.importSource,
                method: contract.method,
                message: `'${contract.method}' chains (${contract.chainedMethods.join(".")}) in source, but mock resolves directly to a plain ${methodInfo.kind}.`,
            });
        }

        // 4. Required property access check (when mock returns explicit object/array-of-object)
        if (
            (methodInfo.kind === "object" || methodInfo.kind === "array") &&
            methodInfo.props.size > 0 &&
            Array.isArray(contract.propertyAccesses)
        ) {
            const missingProps = contract.propertyAccesses.filter((prop) => !methodInfo.props.has(prop));
            if (missingProps.length > 0) {
                violations.push({
                    severity: "warning",
                    rule: "MOCK_MISSING_REQUIRED_PROPERTIES",
                    dependency: contract.importSource,
                    method: contract.method,
                    message: `Mock return value for '${contract.method}' is missing accessed properties: ${missingProps.join(", ")}.`,
                });
            }
        }
    }

    // 5. Empty mock object detection (mockResolvedValue({}) / mockReturnValue({}))
    // Only reject `{}` when source contracts or test assertions require grounded fields.
    const assertionFields = extractAssertionPropertyRequirements(code);
    const contractRequiredFields = new Set(assertionFields);
    for (const c of contracts || []) {
        for (const p of c.propertyAccesses || []) contractRequiredFields.add(p);
        for (const p of c.querySelectedFields || []) contractRequiredFields.add(p);
        if (c.schemaHint?.required) {
            for (const p of c.schemaHint.required) contractRequiredFields.add(p);
        }
        if (c.schemaHint?.idField) contractRequiredFields.add(c.schemaHint.idField);
    }

    if (contractRequiredFields.size > 0) {
        traverse(ast, {
            CallExpression(p) {
                const { callee, arguments: args } = p.node;
                if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.property)) return;
                const mName = callee.property.name;
                if (!["mockResolvedValue", "mockResolvedValueOnce", "mockReturnValue", "mockReturnValueOnce"].includes(mName)) {
                    return;
                }
                const arg0 = args[0];
                if (t.isObjectExpression(arg0) && (arg0.properties || []).length === 0) {
                    const requiredList = [...contractRequiredFields];
                    violations.push({
                        severity: "error",
                        rule: "EMPTY_MOCK_OBJECT_FOR_CONTRACT",
                        dependency: "mock",
                        method: mName,
                        requiredFields: requiredList,
                        line: p.node.loc?.start?.line,
                        message: `Suspicious empty mock object '${mName}({})' conflicts with required contract/assertion fields: ${requiredList.join(", ")}.`,
                    });
                }
            },
        });
    }

    return {
        valid: !violations.some((v) => v.severity === "error"),
        violations,
    };
}
