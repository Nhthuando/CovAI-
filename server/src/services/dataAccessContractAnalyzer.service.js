import fs from "node:fs";
import traverseModule from "@babel/traverse";
import { parseJavaScriptCode } from "./babelParser.service.js";
import { parsePrismaSchemaModels } from "./databaseMockTemplate.service.js";

const traverse = traverseModule.default || traverseModule;

const ARRAY_METHODS = new Set([
    "map", "filter", "reduce", "forEach", "find", "findIndex", "some", "every", "flatMap", "slice", "sort",
]);

const DEFAULT_RETURN_HINTS = {
    // Prisma / general
    findMany: { expectedReturnType: "array", nullable: false },
    findAll: { expectedReturnType: "array", nullable: false },
    getMany: { expectedReturnType: "array", nullable: false },
    getManyAndCount: { expectedReturnType: "array", nullable: false },
    findUnique: { expectedReturnType: "object|null", nullable: true },
    findFirst: { expectedReturnType: "object|null", nullable: true },
    findOne: { expectedReturnType: "object|null", nullable: true },
    findById: { expectedReturnType: "object|null", nullable: true },
    findByPk: { expectedReturnType: "object|null", nullable: true },
    getOne: { expectedReturnType: "object|null", nullable: true },
    find: { expectedReturnType: "array", nullable: false },
    create: { expectedReturnType: "object", nullable: false },
    save: { expectedReturnType: "object", nullable: false },
    update: { expectedReturnType: "object", nullable: false },
    upsert: { expectedReturnType: "object", nullable: false },
    delete: { expectedReturnType: "object", nullable: false },
    remove: { expectedReturnType: "object", nullable: false },
    destroy: { expectedReturnType: "number", nullable: false },
    count: { expectedReturnType: "number", nullable: false },
    countDocuments: { expectedReturnType: "number", nullable: false },
    createMany: { expectedReturnType: "object", nullable: false },
    updateMany: { expectedReturnType: "object", nullable: false },
    deleteMany: { expectedReturnType: "object", nullable: false },
    bulkCreate: { expectedReturnType: "array", nullable: false },
    aggregate: { expectedReturnType: "object", nullable: false },
    groupBy: { expectedReturnType: "array", nullable: false },
};

function unwrapAwait(node) {
    let cur = node;
    while (cur && cur.type === "AwaitExpression") cur = cur.argument;
    return cur;
}

function getMemberChain(node) {
    const parts = [];
    let cur = node;
    while (cur) {
        if (cur.type === "MemberExpression" || cur.type === "OptionalMemberExpression") {
            const prop = cur.property?.name || cur.property?.value;
            if (prop) parts.unshift(prop);
            cur = cur.object;
        } else if (cur.type === "CallExpression" || cur.type === "OptionalCallExpression") {
            // Chained method call: obj.a().b()
            const inner = getMemberChain(cur.callee);
            return [...inner, ...parts];
        } else if (cur.type === "Identifier") {
            parts.unshift(cur.name);
            break;
        } else {
            break;
        }
    }
    return parts;
}

function extractChainedCallSequence(callPath) {
    // Walk up from inner call (e.g. Model.find().populate('x').lean().exec())
    const methods = [];
    let topPath = callPath;
    while (
        topPath.parentPath?.isMemberExpression() &&
        topPath.parentPath.parentPath?.isCallExpression() &&
        topPath.parentPath.parentPath.get("callee") === topPath.parentPath
    ) {
        const prop = topPath.parentPath.node.property?.name || topPath.parentPath.node.property?.value;
        if (prop) methods.push(prop);
        topPath = topPath.parentPath.parentPath;
    }
    return { chainedMethods: methods, outerCallPath: topPath };
}

function summarizeArgs(args = []) {
    return args.map((arg) => {
        if (!arg) return "unknown";
        if (arg.type === "ObjectExpression") {
            const keys = (arg.properties || [])
                .map((p) => p.key?.name || p.key?.value)
                .filter(Boolean);
            return `{${keys.join(",")}}`;
        }
        if (arg.type === "Identifier") return arg.name;
        if (arg.type === "StringLiteral") return `'${arg.value}'`;
        if (arg.type === "NumericLiteral") return String(arg.value);
        return arg.type;
    });
}

function extractQuerySelectedFields(args = []) {
    const selected = new Set();
    for (const arg of args) {
        if (arg?.type !== "ObjectExpression") continue;
        for (const prop of arg.properties || []) {
            const key = prop.key?.name || prop.key?.value;
            if (!key) continue;
            if (["select", "include", "data"].includes(key) && prop.value?.type === "ObjectExpression") {
                for (const sub of prop.value.properties || []) {
                    const subKey = sub.key?.name || sub.key?.value;
                    if (subKey) selected.add(subKey);
                }
            } else if (key === "attributes" && prop.value?.type === "ArrayExpression") {
                for (const el of prop.value.elements || []) {
                    if (el?.type === "StringLiteral" && el.value) selected.add(el.value);
                }
            }
        }
    }
    return [...selected];
}

function classifyOperationKind(method = "") {
    const m = String(method).toLowerCase();
    if (m.startsWith("count")) return "count";
    if (m.startsWith("create") || m === "save" || m === "insertmany") return "create";
    if (m.startsWith("update") || m === "upsert" || m.includes("update")) return "update";
    if (m.startsWith("delete") || m === "remove" || m === "destroy" || m.includes("delete")) return "delete";
    if (m.startsWith("find") || m.startsWith("get")) return "find";
    return "other";
}

function inferUsageForIdentifier(scope, varName) {
    const arrayOps = new Set();
    const propertyAccesses = new Set();
    let nullable = false;

    const binding = scope?.getBinding(varName);
    if (!binding) return { arrayOps: [], propertyAccesses: [], nullable: false };

    for (const refPath of binding.referencePaths || []) {
        const parent = refPath.parentPath;
        if (!parent) continue;

        if (parent.isOptionalMemberExpression()) {
            nullable = true;
            const prop = parent.node.property?.name;
            if (prop) {
                if (ARRAY_METHODS.has(prop)) arrayOps.add(prop);
                else if (prop !== "length") propertyAccesses.add(prop);
                else arrayOps.add("length");
            }
        } else if (parent.isMemberExpression() && parent.get("object") === refPath) {
                const prop = parent.node.property?.name || parent.node.property?.value;
                if (prop) {
                    if (ARRAY_METHODS.has(prop)) {
                        arrayOps.add(prop);
                        // Also inspect callback parameter property accesses: arr.map((x) => x.email)
                        const callParent = parent.parentPath;
                        if (callParent?.isCallExpression()) {
                            const cb = callParent.get("arguments.0");
                            if (cb && (cb.isArrowFunctionExpression() || cb.isFunctionExpression())) {
                                const firstParam = cb.node.params?.[0];
                                if (firstParam?.type === "Identifier") {
                                    const paramBinding = cb.scope?.getBinding(firstParam.name);
                                    for (const pRef of paramBinding?.referencePaths || []) {
                                        const pParent = pRef.parentPath;
                                        if (pParent?.isMemberExpression() && pParent.get("object") === pRef) {
                                            const itemProp = pParent.node.property?.name || pParent.node.property?.value;
                                            if (itemProp && itemProp !== "length") propertyAccesses.add(itemProp);
                                        }
                                    }
                                }
                            }
                        }
                    } else if (prop === "length") arrayOps.add("length");
                    else propertyAccesses.add(prop);
                } else if (parent.node.computed && parent.node.property?.type === "NumericLiteral") {
                    arrayOps.add("indexAccess");
                }
        } else if (parent.isUnaryExpression({ operator: "!" })) {
            nullable = true;
        } else if (parent.isIfStatement() && parent.get("test") === refPath) {
            nullable = true;
        } else if (parent.isBinaryExpression() && ["==", "===", "!=", "!=="].includes(parent.node.operator)) {
            const other = parent.get("left") === refPath ? parent.node.right : parent.node.left;
            if (other?.type === "NullLiteral" || (other?.type === "Identifier" && other.name === "undefined")) {
                nullable = true;
            }
        } else if (parent.isLogicalExpression() && ["??", "||"].includes(parent.node.operator) && parent.get("left") === refPath) {
            nullable = true;
        } else if (parent.isForOfStatement() && parent.get("right") === refPath) {
            arrayOps.add("forOf");
        } else if (parent.isSpreadElement() && parent.parentPath?.isArrayExpression()) {
            arrayOps.add("spread");
        }
    }

    return {
        arrayOps: [...arrayOps],
        propertyAccesses: [...propertyAccesses],
        nullable,
    };
}

function getEnclosingFunctionName(path) {
    let cur = path.parentPath;
    while (cur) {
        if (cur.isFunctionDeclaration() && cur.node.id?.name) return cur.node.id.name;
        if ((cur.isArrowFunctionExpression() || cur.isFunctionExpression()) && cur.parentPath?.isVariableDeclarator()) {
            return cur.parentPath.node.id?.name || "<anonymous>";
        }
        if ((cur.isClassMethod() || cur.isObjectMethod()) && cur.node.key?.name) {
            return cur.node.key.name;
        }
        cur = cur.parentPath;
    }
    return "<module>";
}

function isInsideTryCatch(path) {
    let cur = path.parentPath;
    while (cur) {
        if (cur.isTryStatement()) return true;
        if (cur.isFunction()) return false;
        cur = cur.parentPath;
    }
    return false;
}

/**
 * Analyzes a target source file AST to extract data access and dependency
 * contracts per function and per imported dependency.
 *
 * @param {object} params
 * @returns {object} Analyzed contracts and metadata
 */
export function analyzeDataAccessContracts({
    sourceCode = "",
    sourceFile = "",
    prismaSchemaPath = null,
    prismaSchemaContent = null,
} = {}) {
    if (!sourceCode || typeof sourceCode !== "string") {
        return { contracts: [], dependencies: [], schemaModels: {} };
    }

    let schemaModels = {};
    if (prismaSchemaContent) {
        schemaModels = parsePrismaSchemaModels(prismaSchemaContent);
    } else if (prismaSchemaPath && fs.existsSync(prismaSchemaPath)) {
        try {
            schemaModels = parsePrismaSchemaModels(fs.readFileSync(prismaSchemaPath, "utf8"));
        } catch {
            schemaModels = {};
        }
    }

    const parsed = parseJavaScriptCode(sourceCode, { filePath: sourceFile, allowRecoveredAst: true });
    const ast = parsed?.ast?.type ? parsed.ast : (parsed?.type ? parsed : null);
    if (!ast) {
        return { contracts: [], dependencies: [], schemaModels };
    }

    // 1. Collect all imported bindings -> module source
    const bindingToImport = new Map();
    const dependenciesMap = new Map();

    const recordImport = (source, localName, importedName) => {
        if (!source) return;
        if (!dependenciesMap.has(source)) {
            dependenciesMap.set(source, { source, bindings: [] });
        }
        if (localName) {
            bindingToImport.set(localName, { source, localName, importedName: importedName || localName });
            dependenciesMap.get(source).bindings.push({ localName, importedName: importedName || localName });
        }
    };

    traverse(ast, {
        ImportDeclaration(p) {
            const source = p.node.source?.value;
            if (!source) return;
            for (const spec of p.node.specifiers || []) {
                const imported = spec.type === "ImportDefaultSpecifier"
                    ? "default"
                    : spec.type === "ImportNamespaceSpecifier"
                        ? "*"
                        : (spec.imported?.name || spec.imported?.value);
                recordImport(source, spec.local?.name, imported);
            }
            if ((p.node.specifiers || []).length === 0) {
                recordImport(source, null, null);
            }
        },
        VariableDeclarator(p) {
            const init = p.node.init;
            if (init?.type === "CallExpression" && init.callee?.name === "require" && init.arguments?.[0]?.type === "StringLiteral") {
                const source = init.arguments[0].value;
                if (p.node.id?.type === "Identifier") {
                    recordImport(source, p.node.id.name, "default");
                } else if (p.node.id?.type === "ObjectPattern") {
                    for (const prop of p.node.id.properties || []) {
                        const local = prop.value?.name || prop.key?.name;
                        const imported = prop.key?.name;
                        recordImport(source, local, imported);
                    }
                }
            } else if (p.node.id?.type === "Identifier" && init) {
                // Track derived ORM/client instances: const prisma = new PrismaClient(), const Model = mongoose.model(...), const Inv = seq.define(...)
                let rootIdent = null;
                if (init.type === "NewExpression" && init.callee?.type === "Identifier") {
                    rootIdent = init.callee.name;
                } else if (init.type === "CallExpression") {
                    const chain = getMemberChain(init.callee);
                    if (chain.length > 0) rootIdent = chain[0];
                }
                if (rootIdent && bindingToImport.has(rootIdent)) {
                    const parentImp = bindingToImport.get(rootIdent);
                    bindingToImport.set(p.node.id.name, {
                        source: parentImp.source,
                        localName: p.node.id.name,
                        importedName: parentImp.importedName,
                        derivedFrom: rootIdent,
                    });
                }
            }
        },
    });

    // 2. Inspect all call expressions rooted at an imported binding or global fetch
    const contracts = [];
    const seenOuterCalls = new Set();

    traverse(ast, {
        CallExpression(p) {
            // Skip outer chained calls (e.g. .populate().lean().exec()); analyze from the root query call upward
            if (p.node.callee?.type === "MemberExpression" && p.node.callee.object?.type === "CallExpression") {
                return;
            }
            const chain = getMemberChain(p.node.callee);
            if (chain.length === 0) return;

            const rootName = chain[0];
            const importInfo = bindingToImport.get(rootName);
            const isGlobalFetch = rootName === "fetch" || (rootName === "globalThis" && chain[1] === "fetch");
            if (!importInfo && !isGlobalFetch) return;

            const { chainedMethods, outerCallPath } = extractChainedCallSequence(p);
            // Avoid double-recording chained outer calls when visiting inner call
            if (seenOuterCalls.has(outerCallPath.node)) return;
            seenOuterCalls.add(outerCallPath.node);

            const method = chain[chain.length - 1];
            // If this call is an intermediate link of an outer chain, only analyze the root call with its full chainedMethods
            const clientOrModel = chain.length >= 3
                ? `${chain[0]}.${chain[1]}`
                : (chain.length === 2 ? chain[0] : rootName);

            const isAsync =
                outerCallPath.parentPath?.isAwaitExpression() ||
                chainedMethods.includes("then") ||
                chainedMethods.includes("exec");

            const assignedParent = outerCallPath.parentPath?.isAwaitExpression()
                ? outerCallPath.parentPath.parentPath
                : outerCallPath.parentPath;

            let assignedVar = null;
            let usage = { arrayOps: [], propertyAccesses: [], nullable: false };
            if (assignedParent?.isVariableDeclarator() && assignedParent.node.id?.type === "Identifier") {
                assignedVar = assignedParent.node.id.name;
                usage = inferUsageForIdentifier(assignedParent.scope, assignedVar);
            } else if (
                outerCallPath.parentPath?.isMemberExpression() ||
                (outerCallPath.parentPath?.isAwaitExpression() && outerCallPath.parentPath.parentPath?.isMemberExpression())
            ) {
                const mem = outerCallPath.parentPath.isAwaitExpression()
                    ? outerCallPath.parentPath.parentPath
                    : outerCallPath.parentPath;
                const prop = mem.node.property?.name;
                if (prop && ARRAY_METHODS.has(prop)) usage.arrayOps.push(prop);
                else if (prop) usage.propertyAccesses.push(prop);
            }

            const hint = DEFAULT_RETURN_HINTS[method] || null;
            let expectedReturnType = hint?.expectedReturnType || "unknown";
            let nullable = hint?.nullable ?? usage.nullable;

            if (usage.arrayOps.length > 0) {
                expectedReturnType = "array";
                nullable = false;
            } else if (usage.propertyAccesses.length > 0 && expectedReturnType === "unknown") {
                expectedReturnType = usage.nullable ? "object|null" : "object";
            } else if (usage.nullable && expectedReturnType === "object") {
                expectedReturnType = "object|null";
            }

            // Look up schema hint if Prisma model name matches chain[1]
            let schemaHint = null;
            if (chain.length >= 2) {
                const modelLower = chain[1].toLowerCase();
                if (schemaModels[`__meta_${modelLower}`]) {
                    schemaHint = schemaModels[`__meta_${modelLower}`];
                }
            }

            contracts.push({
                functionName: getEnclosingFunctionName(outerCallPath),
                importSource: isGlobalFetch ? "global:fetch" : importInfo.source,
                dependencyRoot: rootName,
                clientOrModel,
                method,
                operationKind: classifyOperationKind(method),
                args: summarizeArgs(p.node.arguments),
                querySelectedFields: extractQuerySelectedFields(p.node.arguments),
                chainedMethods,
                expectedReturnType,
                nullable,
                arrayOperations: usage.arrayOps,
                propertyAccesses: usage.propertyAccesses,
                isAsync: Boolean(isAsync),
                inTryCatch: isInsideTryCatch(outerCallPath),
                assignedVar,
                schemaHint,
            });
        },
    });

    return {
        contracts,
        dependencies: Array.from(dependenciesMap.values()),
        schemaModels,
    };
}
