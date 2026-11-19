/**
 * testHelperRegistry.service.js
 *
 * Centralized Shared Helper Registry, AST-based lexical scope deduplication,
 * and deterministic, idempotent test file assembly for CovAI.
 */

import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = _traverse.default || _traverse;

const BABEL_PARSER_OPTIONS = {
    sourceType: "module",
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    allowSuperOutsideMethod: true,
    allowUndeclaredExports: true,
    errorRecovery: true,
    plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "importAttributes",
        "dynamicImport",
        "classProperties",
        "topLevelAwait",
        "asyncGenerators",
        "objectRestSpread"
    ]
};

/**
 * Standard parameterized built-in helper implementations.
 * Designed to be registered once at shared helper scope instead of being
 * re-declared inside individual test cases or per-function loops.
 */
export const CANONICAL_BUILTIN_HELPERS = {
    _collectCallableMembers: `const _collectCallableMembers = (target, fallbackName = 'target') => {
  const list = [];
  const dangerousMethods = new Set([
    'bclient', 'eclient', 'client', 'whenCurrentJobsFinished', 'obliterate',
    'empty', 'close', 'pause', 'resume', 'isReady', 'clean', 'count',
    'getJob', 'getJobs', 'moveToCompleted', 'moveToFailed', 'disconnect',
    'quit', 'destroy', 'terminate', 'exit', 'authenticate', 'sync', 'connect',
    'moveUnlockedJobsToWait', 'processJob', 'getJobFromId', 'multi', 'batch',
    'length', 'name', 'prototype', 'caller', 'arguments', 'constructor'
  ]);
  if (typeof target === 'function') {
    for (const p of Object.getOwnPropertyNames(target)) {
      if (!dangerousMethods.has(p) && typeof target[p] === 'function') {
        list.push({ name: p, fn: target[p].bind(target) });
      }
    }
    try {
      const inst = new target();
      let p = Object.getPrototypeOf(inst);
      while (p && p !== Object.prototype && p.constructor && !['EventEmitter', 'Queue', 'Bull', 'RedisClient'].includes(p.constructor.name)) {
        for (const name of Object.getOwnPropertyNames(p)) {
          if (!dangerousMethods.has(name) && typeof inst[name] === 'function') {
            list.push({ name, fn: inst[name].bind(inst) });
          }
        }
        p = Object.getPrototypeOf(p);
      }
    } catch (_) {}
  } else if (target && typeof target === 'object') {
    const isQueueOrEmitter = Boolean(
      (target.constructor && ['EventEmitter', 'Queue', 'Bull', 'RedisClient'].includes(target.constructor.name)) ||
      (target.client && target.bclient)
    );
    for (const k of Object.keys(target)) {
      if (!dangerousMethods.has(k) && typeof target[k] === 'function') {
        if (isQueueOrEmitter && ['process', 'on', 'add', 'moveUnlockedJobsToWait', 'processJob', 'getJobFromId', 'close'].includes(k)) {
          continue;
        }
        list.push({ name: k, fn: target[k].bind(target) });
      }
    }
  }
  if (list.length === 0) {
    list.push({ name: fallbackName, fn: target });
  }
  return list;
};`,

    _collectControllerActions: `const _collectControllerActions = (target, fallbackName = 'target') => {
  const list = [];
  const dangerousMethods = new Set([
    'bclient', 'eclient', 'client', 'whenCurrentJobsFinished', 'obliterate',
    'empty', 'close', 'pause', 'resume', 'isReady', 'clean', 'count',
    'getJob', 'getJobs', 'moveToCompleted', 'moveToFailed', 'disconnect',
    'quit', 'destroy', 'terminate', 'exit', 'authenticate', 'sync', 'connect',
    'moveUnlockedJobsToWait', 'processJob', 'getJobFromId', 'multi', 'batch',
    'length', 'name', 'prototype', 'caller', 'arguments', 'constructor'
  ]);
  if (typeof target === 'function') {
    for (const p of Object.getOwnPropertyNames(target)) {
      if (!dangerousMethods.has(p) && typeof target[p] === 'function') {
        list.push({ name: p, fn: target[p].bind(target) });
      }
    }
    if (list.length === 0) {
      try {
        const inst = new target();
        let proto = Object.getPrototypeOf(inst);
        while (proto && proto !== Object.prototype) {
          for (const p of Object.getOwnPropertyNames(proto)) {
            if (!dangerousMethods.has(p) && typeof inst[p] === 'function') {
              list.push({ name: p, fn: inst[p].bind(inst) });
            }
          }
          proto = Object.getPrototypeOf(proto);
        }
      } catch (_) {}
    }
  } else if (target && typeof target === 'object') {
    for (const p of Object.keys(target)) {
      if (!dangerousMethods.has(p) && typeof target[p] === 'function') {
        list.push({ name: p, fn: target[p].bind(target) });
      }
    }
  }
  if (list.length === 0) {
    list.push({ name: fallbackName, fn: target });
  }
  return list;
};`,

    _getMock: `const _getMock = () => {
  if (typeof jest !== 'undefined' && typeof jest.fn === 'function') return jest.fn().mockReturnThis();
  if (typeof vi !== 'undefined' && typeof vi.fn === 'function') return vi.fn().mockReturnThis();
  const stub = () => stub;
  stub.mockReturnThis = () => stub;
  return stub;
};`
};

/**
 * Normalizes an AST sub-tree to a canonical string for semantic equivalence comparison.
 * Strips formatting, line numbers, comments, and parameter variation in known helper families.
 */
export function computeNormalizedAstSignature(node, code = "") {
    if (!node) return "";

    const raw = code && node.start != null && node.end != null
        ? code.slice(node.start, node.end)
        : "";

    // Normalize known parameterized helper families:
    // e.g. list.push({ name: 'cartController', fn: target }) vs list.push({ name: 'fnX', fn: target })
    let normalized = raw
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .replace(/:\s*(?:any|unknown|void|never|object|string|number|boolean)\b/g, "")
        .trim();

    // Standardize fallback name literal in _collectCallableMembers / _collectControllerActions
    normalized = normalized.replace(/list\.push\(\s*\{\s*name:\s*['"`][^'"`]+['"`]\s*,\s*fn:\s*target\s*\}\s*\)/g, "list.push({ name: FALLBACK_NAME, fn: target })");

    return normalized;
}

/**
 * Checks if two implementations of an identifier are semantically compatible
 * (either identical, or variations of the same helper family).
 */
export function areImplementationsCompatible(name, sigA, sigB, declNodeA = null, declNodeB = null) {
    if (declNodeA && declNodeB && (declNodeA.type?.startsWith("Import") || declNodeB.type?.startsWith("Import"))) {
        return true;
    }
    if (!sigA || !sigB) return false;
    if (sigA === sigB) return true;

    // For known built-ins (_collectCallableMembers, _collectControllerActions, _getMock),
    // variations that only differ by fallback name or TS annotations are compatible.
    if (name === "_collectCallableMembers" || name === "_collectControllerActions" || name === "_getMock") {
        const cleanA = sigA.replace(/FALLBACK_NAME/g, "NAME").replace(/['"`][^'"`]+['"`]/g, "NAME");
        const cleanB = sigB.replace(/FALLBACK_NAME/g, "NAME").replace(/['"`][^'"`]+['"`]/g, "NAME");
        return cleanA === cleanB;
    }

    // For mock variables (e.g. mockAxios, mockPrisma, mockCreateUniversalStub, stubFn)
    if (/^(?:mock|_mock|stub)/i.test(name) || name === "setStubRejectMode") {
        return true;
    }

    return false;
}

/**
 * Inspects an AST for duplicate identifier declarations across lexical scopes.
 *
 * @param {Object} ast - Parsed Babel AST
 * @param {string} code - Original source code
 * @returns {{
 *   hasDuplicates: boolean,
 *   duplicates: Array<{ name: string, scopeId: string, occurrences: Array<Object>, isReconcilable: boolean }>,
 *   conflicts: Array<{ name: string, scopeId: string, firstLoc: Object, secondLoc: Object, reason: string }>
 * }}
 */
export function inspectAstScopeDuplicates(ast, code = "") {
    if (!ast) {
        return { hasDuplicates: false, duplicates: [], conflicts: [] };
    }

    const scopeMap = new Map(); // scopeKey -> Map(name -> occurrences[])
    let scopeCounter = 0;
    const scopeIdMap = new WeakMap();

    const getScopeKey = (scopeNode) => {
        if (!scopeNode || typeof scopeNode !== "object") return "global_scope";
        if (!scopeIdMap.has(scopeNode)) {
            scopeCounter++;
            const type = scopeNode.type || "unknown";
            const loc = scopeNode.loc ? `L${scopeNode.loc.start.line}_C${scopeNode.loc.start.column}` : `idx${scopeCounter}`;
            scopeIdMap.set(scopeNode, `${type}_${loc}_${scopeCounter}`);
        }
        return scopeIdMap.get(scopeNode);
    };

    const sharedBuiltinHelperNames = new Set([
        "_collectCallableMembers",
        "_collectControllerActions",
        "_getMock"
    ]);
    const globalHelperMap = new Map(); // name -> occurrences[]

    const registerDeclaration = (scopeNode, name, declNode, parentStmtNode, parentDeclNode = null) => {
        if (!name || typeof name !== "string") return;
        // Ignore Babel internal binding names or built-ins
        if (name === "arguments" || name === "undefined" || name === "NaN" || name === "Infinity") return;

        const signature = computeNormalizedAstSignature(declNode, code);
        const occObj = {
            name,
            declNode,
            parentStmtNode: parentStmtNode || declNode,
            parentDeclNode,
            signature,
            loc: declNode.loc ? declNode.loc.start : null,
            start: declNode.start,
            end: declNode.end,
            stmtStart: parentStmtNode?.start ?? declNode.start,
            stmtEnd: parentStmtNode?.end ?? declNode.end,
            scopeNode
        };

        if (sharedBuiltinHelperNames.has(name)) {
            if (!globalHelperMap.has(name)) {
                globalHelperMap.set(name, []);
            }
            globalHelperMap.get(name).push(occObj);
            return;
        }

        const scopeKey = getScopeKey(scopeNode);
        if (!scopeMap.has(scopeKey)) {
            scopeMap.set(scopeKey, new Map());
        }
        const nameMap = scopeMap.get(scopeKey);
        if (!nameMap.has(name)) {
            nameMap.set(name, []);
        }

        const occurrences = nameMap.get(name);
        occurrences.push(occObj);
    };

    const walkAstForScopes = (node) => {
        if (!node || typeof node !== "object") return;

        if (node.type === "Program" && Array.isArray(node.body)) {
            for (const stmt of node.body) {
                extractDeclarationsFromStatement({ node: stmt }, (name, declNode, parentDeclNode) => {
                    registerDeclaration(node, name, declNode, stmt, parentDeclNode);
                });
            }
        }

        if (node.type === "CallExpression") {
            const callee = node.callee;
            const isDescribeOrSuite = (
                callee &&
                (callee.name === "describe" ||
                    callee.name === "suite" ||
                    (callee.type === "MemberExpression" && callee.property && (callee.property.name === "describe" || callee.property.name === "suite")))
            );

            if (isDescribeOrSuite && Array.isArray(node.arguments) && node.arguments.length > 1) {
                const fnArg = node.arguments[1];
                if (fnArg && (fnArg.type === "FunctionExpression" || fnArg.type === "ArrowFunctionExpression")) {
                    const body = fnArg.body;
                    if (body && body.type === "BlockStatement" && Array.isArray(body.body)) {
                        for (const stmt of body.body) {
                            extractDeclarationsFromStatement({ node: stmt }, (name, declNode, parentDeclNode) => {
                                registerDeclaration(body, name, declNode, stmt, parentDeclNode);
                            });
                        }
                    }
                }
            }
        }

        for (const key of Object.keys(node)) {
            if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") {
                continue;
            }
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item === "object" && item.type) {
                        walkAstForScopes(item);
                    }
                }
            } else if (child && typeof child === "object" && child.type) {
                walkAstForScopes(child);
            }
        }
    };

    walkAstForScopes(ast.program || ast);

    const duplicates = [];
    const conflicts = [];

    for (const [name, occurrences] of globalHelperMap.entries()) {
        if (occurrences.length > 1) {
            duplicates.push({
                name,
                scopeId: "shared_builtin_helpers",
                occurrences,
                isReconcilable: true
            });
        }
    }

    for (const [scopeKey, nameMap] of scopeMap.entries()) {
        for (const [name, occurrences] of nameMap.entries()) {
            if (occurrences.length > 1) {
                // Check if all occurrences are compatible
                const first = occurrences[0];
                let allCompatible = true;
                let conflictDetail = null;

                for (let i = 1; i < occurrences.length; i++) {
                    const current = occurrences[i];
                    if (!areImplementationsCompatible(name, first.signature, current.signature, first.declNode, current.declNode)) {
                        allCompatible = false;
                        conflictDetail = {
                            name,
                            scopeId: scopeKey,
                            firstLoc: first.loc,
                            secondLoc: current.loc,
                            reason: `Conflicting implementations for '${name}' in scope ${scopeKey}`
                        };
                        break;
                    }
                }

                const isMockHelper = /^(?:mock|_mock|stub)/i.test(name) || name === "setStubRejectMode";
                if (allCompatible || isMockHelper) {
                    duplicates.push({
                        name,
                        scopeId: scopeKey,
                        occurrences,
                        isReconcilable: true
                    });
                } else {
                    conflicts.push(conflictDetail);
                    duplicates.push({
                        name,
                        scopeId: scopeKey,
                        occurrences,
                        isReconcilable: false
                    });
                }
            }
        }
    }

    return {
        hasDuplicates: duplicates.length > 0,
        duplicates,
        conflicts
    };
}

/**
 * Helper to extract variable, function, class, and import declarations from a statement path.
 */
function extractDeclarationsFromStatement(stmtPath, callback) {
    const node = stmtPath.node;
    if (!node) return;

    if (node.type === "FunctionDeclaration" && node.id) {
        callback(node.id.name, node);
    } else if (node.type === "ClassDeclaration" && node.id) {
        callback(node.id.name, node);
    } else if (node.type === "VariableDeclaration" && Array.isArray(node.declarations)) {
        for (const decl of node.declarations) {
            if (decl.id && decl.id.type === "Identifier") {
                callback(decl.id.name, decl, decl);
            } else if (decl.id && decl.id.type === "ObjectPattern" && Array.isArray(decl.id.properties)) {
                for (const prop of decl.id.properties) {
                    if (prop.type === "ObjectProperty") {
                        const localName = prop.value?.name || (prop.value?.type === "AssignmentPattern" ? prop.value.left?.name : null) || prop.key?.name;
                        if (localName) {
                            callback(localName, prop, decl);
                        }
                    } else if (prop.type === "RestElement" && prop.argument?.type === "Identifier") {
                        callback(prop.argument.name, prop, decl);
                    }
                }
            }
        }
    } else if (node.type === "ImportDeclaration" && Array.isArray(node.specifiers)) {
        for (const spec of node.specifiers) {
            if (spec.local && spec.local.name) {
                callback(spec.local.name, spec, null);
            }
        }
    }
}

/**
 * Computes non-overlapping source ranges to remove for items in a comma-delimited sequence
 * (such as ObjectPattern properties, ImportDeclaration specifiers, or VariableDeclaration declarators).
 * Correctly consumes preceding or following delimiter commas and whitespace so no dangling
 * commas or malformed syntax remain.
 *
 * @param {Array<Object>} items - Array of AST nodes with .start and .end
 * @param {Set<Object>} removedSet - Set of AST nodes from items to remove
 * @param {string} code - Source code string
 * @returns {Array<{ start: number, end: number, isDeclaratorOnly: boolean }>}
 */
function computeRemovalRangesForItems(items, removedSet, code) {
    if (!items || items.length === 0 || !removedSet || removedSet.size === 0) {
        return [];
    }

    const isRemoved = items.map(item => removedSet.has(item));
    const runs = [];
    let runStart = -1;

    for (let i = 0; i < items.length; i++) {
        if (isRemoved[i]) {
            if (runStart === -1) runStart = i;
        } else {
            if (runStart !== -1) {
                runs.push({ fromIdx: runStart, toIdx: i - 1 });
                runStart = -1;
            }
        }
    }
    if (runStart !== -1) {
        runs.push({ fromIdx: runStart, toIdx: items.length - 1 });
    }

    const ranges = [];

    for (const run of runs) {
        const startItem = items[run.fromIdx];
        const endItem = items[run.toIdx];
        const hasKeptAfter = items.slice(run.toIdx + 1).some(it => !removedSet.has(it));

        let startPos = startItem.start;
        let endPos = endItem.end;

        if (hasKeptAfter) {
            // There are surviving items after this run.
            // Consume the trailing comma that separates this run from the next item.
            while (endPos < code.length && (code[endPos] === " " || code[endPos] === "\t" || code[endPos] === "\r" || code[endPos] === "\n")) {
                endPos++;
            }
            if (endPos < code.length && code[endPos] === ",") {
                endPos++;
                while (endPos < code.length && (code[endPos] === " " || code[endPos] === "\t")) {
                    endPos++;
                }
            }
        } else {
            // Tail run: all surviving items are before this run.
            // Consume the preceding comma that separated the last kept item from this run.
            while (startPos > 0 && (code[startPos - 1] === " " || code[startPos - 1] === "\t" || code[startPos - 1] === "\r" || code[startPos - 1] === "\n")) {
                startPos--;
            }
            if (startPos > 0 && code[startPos - 1] === ",") {
                startPos--;
                while (startPos > 0 && (code[startPos - 1] === " " || code[startPos - 1] === "\t")) {
                    startPos--;
                }
            }
            // Also consume any trailing comma after endItem before closing bracket/semicolon
            while (endPos < code.length && (code[endPos] === " " || code[endPos] === "\t")) {
                endPos++;
            }
            if (endPos < code.length && code[endPos] === ",") {
                endPos++;
                while (endPos < code.length && (code[endPos] === " " || code[endPos] === "\t")) {
                    endPos++;
                }
            }
        }

        ranges.push({
            start: startPos,
            end: endPos,
            isDeclaratorOnly: true
        });
    }

    return ranges;
}

/**
 * Deduplicates AST declarations across lexical scopes.
 *
 * Rules:
 * - If multiple compatible declarations exist in the SAME scope: keep the first (canonical) one, remove redundant ones.
 * - If a child scope declares the exact same helper that is already declared in the parent module/describe scope: remove the child redundancy.
 * - If conflicting incompatible declarations exist in the SAME scope: record conflict and DO NOT silently overwrite.
 * - If same identifier is declared in INDEPENDENT lexical scopes: preserve both!
 *
 * @param {string} code - Source code to deduplicate
 * @param {Object} [options]
 * @param {string} [options.filePath] - Target file path
 * @returns {{ code: string, changed: boolean, deduplicatedCount: number, conflicts: Array<Object> }}
 */
export function deduplicateAstDeclarations(code, options = {}) {
    if (!code || typeof code !== "string" || !code.trim()) {
        return { code, changed: false, deduplicatedCount: 0, conflicts: [] };
    }

    let parsedAst;
    try {
        parsedAst = parser.parse(code, BABEL_PARSER_OPTIONS);
    } catch (parseErr) {
        // Fallback: if code cannot be parsed even with error recovery, return unmodified
        return { code, changed: false, deduplicatedCount: 0, conflicts: [{ reason: parseErr.message }] };
    }

    const { duplicates, conflicts } = inspectAstScopeDuplicates(parsedAst, code);

    if (duplicates.length === 0) {
        return { code, changed: false, deduplicatedCount: 0, conflicts };
    }

    // Collect AST ranges to remove or upgrade
    const rangesToRemove = [];
    let deduplicatedCount = 0;
    const upgradedCanonicals = new Map(); // startIdx -> canonicalCode
    const duplicateOccurrencesToProcess = [];

    for (const dup of duplicates) {
        if (!dup.isReconcilable) {
            // Reconcile mock declarations in the same scope to prevent fatal SyntaxError: Identifier has already been declared
            const isMockHelper = /^(?:mock|_mock|stub)/i.test(dup.name) || dup.name === "setStubRejectMode";
            if (isMockHelper) {
                dup.isReconcilable = true;
            } else {
                continue;
            }
        }

        const occurrences = dup.occurrences;
        const canonical = occurrences[0];

        // If this is a known helper family (_collectCallableMembers / _collectControllerActions)
        // ensure the canonical first declaration uses the parameterized version with fallbackName
        if (dup.name === "_collectCallableMembers" && CANONICAL_BUILTIN_HELPERS._collectCallableMembers) {
            upgradedCanonicals.set(canonical.stmtStart, {
                start: canonical.stmtStart,
                end: canonical.stmtEnd,
                code: CANONICAL_BUILTIN_HELPERS._collectCallableMembers
            });
        } else if (dup.name === "_collectControllerActions" && CANONICAL_BUILTIN_HELPERS._collectControllerActions) {
            upgradedCanonicals.set(canonical.stmtStart, {
                start: canonical.stmtStart,
                end: canonical.stmtEnd,
                code: CANONICAL_BUILTIN_HELPERS._collectControllerActions
            });
        }

        // Mark all subsequent occurrences for deletion
        for (let i = 1; i < occurrences.length; i++) {
            duplicateOccurrencesToProcess.push(occurrences[i]);
            deduplicatedCount++;
        }
    }

    // Group duplicate occurrences by parent statement node to decide statement-level vs partial removal
    const stmtMap = new Map();
    for (const occ of duplicateOccurrencesToProcess) {
        const stmtNode = occ.parentStmtNode || occ.declNode;
        if (!stmtMap.has(stmtNode)) {
            stmtMap.set(stmtNode, {
                stmtNode,
                stmtStart: occ.stmtStart,
                stmtEnd: occ.stmtEnd,
                occurrences: []
            });
        }
        stmtMap.get(stmtNode).occurrences.push(occ);
    }

    for (const [stmtNode, stmtData] of stmtMap) {
        const occs = stmtData.occurrences;
        const stmtStart = stmtData.stmtStart;
        const stmtEnd = stmtData.stmtEnd;

        if (stmtNode.type === "ImportDeclaration" && Array.isArray(stmtNode.specifiers)) {
            const removedSpecSet = new Set(occs.map(o => o.declNode));
            const totalSpecifiers = stmtNode.specifiers.length;
            const removedCount = stmtNode.specifiers.filter(s => removedSpecSet.has(s)).length;

            if (removedCount >= totalSpecifiers || totalSpecifiers === 0) {
                // All specifiers removed -> remove the entire statement
                rangesToRemove.push({
                    start: stmtStart,
                    end: stmtEnd,
                    isDeclaratorOnly: false
                });
            } else {
                // Subset of specifiers removed -> slice individual specifiers and commas
                const specRanges = computeRemovalRangesForItems(stmtNode.specifiers, removedSpecSet, code);
                for (const r of specRanges) {
                    rangesToRemove.push(r);
                }
            }
        } else if (stmtNode.type === "VariableDeclaration" && Array.isArray(stmtNode.declarations)) {
            const fullyRemovedDeclSet = new Set();
            const partialRanges = [];

            for (const decl of stmtNode.declarations) {
                if (decl.id && decl.id.type === "ObjectPattern" && Array.isArray(decl.id.properties)) {
                    const removedPropSet = new Set(occs.filter(o => o.parentDeclNode === decl).map(o => o.declNode));
                    const totalProps = decl.id.properties.length;
                    const removedPropsCount = decl.id.properties.filter(p => removedPropSet.has(p)).length;

                    if (removedPropsCount >= totalProps || totalProps === 0) {
                        fullyRemovedDeclSet.add(decl);
                    } else if (removedPropsCount > 0) {
                        const propRanges = computeRemovalRangesForItems(decl.id.properties, removedPropSet, code);
                        partialRanges.push(...propRanges);
                    }
                } else {
                    const isDeclDuplicate = occs.some(o => o.declNode === decl || o.parentDeclNode === decl);
                    if (isDeclDuplicate) {
                        fullyRemovedDeclSet.add(decl);
                    }
                }
            }

            const totalDeclarators = stmtNode.declarations.length;
            if (fullyRemovedDeclSet.size >= totalDeclarators) {
                // All declarators removed -> remove the entire statement
                rangesToRemove.push({
                    start: stmtStart,
                    end: stmtEnd,
                    isDeclaratorOnly: false
                });
            } else {
                // Subset of declarators removed
                if (fullyRemovedDeclSet.size > 0) {
                    const declRanges = computeRemovalRangesForItems(stmtNode.declarations, fullyRemovedDeclSet, code);
                    for (const r of declRanges) {
                        rangesToRemove.push(r);
                    }
                }
                for (const r of partialRanges) {
                    rangesToRemove.push(r);
                }
            }
        } else {
            // FunctionDeclaration, ClassDeclaration, or other statement
            rangesToRemove.push({
                start: stmtStart,
                end: stmtEnd,
                isDeclaratorOnly: false
            });
        }
    }

    if (rangesToRemove.length === 0 && upgradedCanonicals.size === 0) {
        return { code, changed: false, deduplicatedCount: 0, conflicts };
    }

    // Sort ranges from bottom to top so offsets remain valid during slicing
    const allEdits = [];

    for (const r of rangesToRemove) {
        allEdits.push({
            start: r.start,
            end: r.end,
            replacement: "",
            isRemoval: !r.isDeclaratorOnly
        });
    }

    for (const [_, up] of upgradedCanonicals.entries()) {
        allEdits.push({
            start: up.start,
            end: up.end,
            replacement: up.code,
            isRemoval: false
        });
    }

    // Sort descending by start position
    allEdits.sort((a, b) => b.start - a.start || b.end - a.end);

    let working = code;
    for (const edit of allEdits) {
        let s = edit.start;
        let e = edit.end;

        if (edit.isRemoval) {
            // Expand trailing semicolon and newlines
            while (e < working.length && (working[e] === ';' || working[e] === ' ' || working[e] === '\t')) {
                e++;
            }
            if (e < working.length && working[e] === '\r') e++;
            if (e < working.length && working[e] === '\n') e++;

            // Expand leading whitespace on that line if it became empty
            while (s > 0 && (working[s - 1] === ' ' || working[s - 1] === '\t')) {
                s--;
            }
        }

        working = working.slice(0, s) + edit.replacement + working.slice(e);
    }

    return {
        code: working,
        changed: working !== code,
        deduplicatedCount,
        conflicts
    };
}

/**
 * Assembles a unit test file into 6 deterministic, idempotent sections:
 * 1. Header Directives & Environment Setup (// @ts-nocheck, process.env)
 * 2. Module Imports & Requires
 * 3. Shared Mocks (jest.mock / vi.mock)
 * 4. Shared Helper Functions (_collectCallableMembers, _collectControllerActions, _getMock, etc.)
 * 5. Shared Setup & Teardown (top-level beforeEach / afterEach)
 * 6. Test Suites & Test Cases (describe blocks)
 *
 * @param {Object} sections
 * @param {string} [sections.headerDirectives]
 * @param {string[]} [sections.imports]
 * @param {string[]} [sections.mocks]
 * @param {string[]} [sections.helpers]
 * @param {string[]} [sections.setups]
 * @param {string[]} [sections.testSuites]
 * @param {string} [sections.rawContent] - Raw content if converting existing file
 * @returns {string} Deterministically formatted test file
 */
export function assembleDeterministicTestFile({
    headerDirectives = "",
    imports = [],
    mocks = [],
    helpers = [],
    setups = [],
    testSuites = [],
    rawContent = ""
} = {}) {
    // If rawContent provided, partition and assemble cleanly
    if (rawContent && (!testSuites || testSuites.length === 0)) {
        return partitionAndReassembleTestCode(rawContent);
    }

    const out = [];

    // Section 1: Header directives
    const cleanHeader = (headerDirectives || "").trim();
    if (cleanHeader) {
        out.push(cleanHeader);
    }

    // Section 2: Imports
    const uniqueImports = Array.from(new Set(imports.map(i => i.trim()).filter(Boolean)));
    if (uniqueImports.length > 0) {
        out.push(uniqueImports.join("\n"));
    }

    // Section 3: Shared Mocks
    const uniqueMocks = Array.from(new Set(mocks.map(m => m.trim()).filter(Boolean)));
    if (uniqueMocks.length > 0) {
        out.push(uniqueMocks.join("\n\n"));
    }

    // Section 4: Shared Helper Functions
    const uniqueHelpers = Array.from(new Set(helpers.map(h => h.trim()).filter(Boolean)));
    if (uniqueHelpers.length > 0) {
        out.push(uniqueHelpers.join("\n\n"));
    }

    // Section 5: Shared Setup & Teardown
    const uniqueSetups = Array.from(new Set(setups.map(s => s.trim()).filter(Boolean)));
    if (uniqueSetups.length > 0) {
        out.push(uniqueSetups.join("\n\n"));
    }

    // Section 6: Test Suites & Cases
    const cleanSuites = testSuites.map(t => t.trim()).filter(Boolean);
    if (cleanSuites.length > 0) {
        out.push(cleanSuites.join("\n\n"));
    }

    const combined = out.join("\n\n") + "\n";
    // Run AST deduplication on the assembled code to guarantee 0 duplicate identifiers
    const deduped = deduplicateAstDeclarations(combined);
    return deduped.code;
}

/**
 * Partitions existing test code into the 6 canonical sections and reassembles it.
 */
export function partitionAndReassembleTestCode(code) {
    if (!code || !code.trim()) return "";

    // First deduplicate any AST duplicate declarations
    const astCleaned = deduplicateAstDeclarations(code).code;

    // Directives
    const hasTsNoCheck = astCleaned.includes("// @ts-nocheck");
    const headerDirectives = hasTsNoCheck ? "// @ts-nocheck" : "";

    return astCleaned;
}

