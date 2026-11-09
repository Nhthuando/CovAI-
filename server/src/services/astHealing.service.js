/**
 * server/src/services/astHealing.service.js
 *
 * Canonical Unified AST Healing Facade for CovAI-
 * Consolidates syntax self-healing, import normalization, and Vitest compatibility
 * without duplicate or conflicting AST passes.
 */

import fs from "fs";
import path from "path";
import traverseModule from "@babel/traverse";
import { parseJavaScriptCode } from "./babelParser.service.js";
import {
    cleanAndDeduplicateTestContent,
    safeDecoupleInlineStatements,
    healBrokenCommentSplits,
    balanceTestFileBracesAndParens,
    healImportPathsInTestCode,
    convertEsmToCommonJs,
    healVitestHoistedMocks
} from "./testSanitizer.service.js";
import {
    deduplicateAstDeclarations,
    inspectAstScopeDuplicates
} from "./testHelperRegistry.service.js";
import {
    normalizeTestFrameworkCode,
    isVitestTestCode,
    findHeaderInsertionIndex
} from "./testFrameworkNormalization.service.js";
import {
    validateVitestAstStructure,
    healVitestCode
} from "./vitestCollectionValidator.service.js";
import {
    validateTestCodeAst,
    healInvalidDynamicGetters
} from "../validators/aiTestCode.validator.js";

const traverse = traverseModule.default || traverseModule;

/**
 * Inserts code text immediately after leading directives or comments
 * (e.g. // @ts-nocheck, /* eslint-disable * /, 'use strict') so directives stay at line 1.
 */
export function insertAfterDirectives(code, insertion) {
    if (!code || !insertion) return code || "";
    const insertIdx = findHeaderInsertionIndex(code);
    if (insertIdx === 0) {
        return `${insertion}\n${code}`;
    }
    const header = code.slice(0, insertIdx);
    const body = code.slice(insertIdx);
    const separator = header.endsWith("\n") ? "" : "\n";
    return `${header}${separator}${insertion}\n${body}`;
}

/**
 * Enhanced multiline ESM to CommonJS converter supporting multiline import specifiers.
 */
export function convertMultilineEsmToCommonJs(code) {
    if (!code || typeof code !== "string" || !/\bimport\b/.test(code)) return code;
    return convertEsmToCommonJs(code);
}

/**
 * Universal AST Syntax Self-Healing Facade
 * Converges syntax errors, missing delimiters, duplicate helpers, dynamic getters,
 * and top-level returns into a clean AST.
 */
export function healTestSyntax(code, options = {}) {
    const {
        framework = "jest",
        filePath = "",
        maxAttempts = options.maxRetries || 6,
        strict = false,
        allowRecoveredAst = false
    } = options;

    if (!code || typeof code !== "string" || !code.trim()) {
        return {
            success: false,
            repaired: false,
            code: code ?? "",
            ast: null,
            error: "Empty code",
            errors: [{ line: 1, column: 0, message: "Empty code", construct: "EmptyContent", filePath }],
            attempts: 0,
            appliedHeals: []
        };
    }

    let currentCode = code;
    const appliedHeals = [];

    // Phase 1: Deterministic Lexical Pre-Cleaning (Run once)
    const decoupled = safeDecoupleInlineStatements(currentCode);
    if (decoupled !== currentCode) {
        currentCode = decoupled;
        appliedHeals.push("safeDecoupleInlineStatements");
    }

    const commentHealed = healBrokenCommentSplits(currentCode);
    if (commentHealed !== currentCode) {
        currentCode = commentHealed;
        appliedHeals.push("healBrokenCommentSplits");
    }

    const gettersHealed = healInvalidDynamicGetters(currentCode);
    if (gettersHealed !== currentCode) {
        currentCode = gettersHealed;
        appliedHeals.push("healInvalidDynamicGetters");
    }

    const orphanSemi = currentCode.replace(/;\s*\)+/g, ");");
    if (orphanSemi !== currentCode) {
        currentCode = orphanSemi;
        appliedHeals.push("cleanOrphanSemicolons");
    }

    const commasCleaned = currentCode.replace(/,\s*,/g, ", ");
    if (commasCleaned !== currentCode) {
        currentCode = commasCleaned;
        appliedHeals.push("cleanConsecutiveCommas");
    }

    const defaultFixed = currentCode.replace(/\bdefault\s*\(/g, "defaultFn(");
    if (defaultFixed !== currentCode) {
        currentCode = defaultFixed;
        appliedHeals.push("healStandaloneDefault");
    }

    // Phase 2: Iterative Diagnostic Convergence Loop
    let lastErrors = [];
    let attempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        attempts = attempt;
        let modifiedInPass = false;

        // 1. Balance braces/parens using comment/string-aware scanner
        if (typeof balanceTestFileBracesAndParens === "function") {
            try {
                const balanced = balanceTestFileBracesAndParens(currentCode);
                if (balanced !== currentCode) {
                    currentCode = balanced;
                    modifiedInPass = true;
                    appliedHeals.push("balanceTestFileBracesAndParens");
                }
            } catch (_) {}
        }

        // 2. Scope deduplication for duplicate helpers (e.g. _collectCallableMembers)
        if (typeof deduplicateAstDeclarations === "function") {
            try {
                const dedupRes = deduplicateAstDeclarations(currentCode, { filePath });
                if (dedupRes.changed && dedupRes.code) {
                    currentCode = dedupRes.code;
                    modifiedInPass = true;
                    appliedHeals.push("deduplicateAstDeclarations");
                }
            } catch (_) {}
        }

        // 3. Parse AST using Babel parser
        const parsed = parseJavaScriptCode(currentCode, { filePath, allowRecoveredAst });
        if (parsed.success) {
            // Semantic AST verification (mock factories, forbidden imports)
            const valResult = validateTestCodeAst(currentCode, { filePath });
            if (valResult.valid) {
                return {
                    success: true,
                    repaired: true,
                    code: currentCode,
                    ast: parsed.ast,
                    error: null,
                    errors: [],
                    attempts,
                    appliedHeals
                };
            }
            lastErrors = valResult.errors;
        } else {
            lastErrors = [{
                line: 1,
                column: 0,
                message: parsed.error || "Syntax error",
                construct: "SyntaxError",
                filePath
            }];
        }

        const msg = parsed.error || (lastErrors[0]?.message ?? "");

        // Targeted Repair A: Missing semicolon at line:col
        const semiMatch = msg.match(/Missing semicolon\. \((\d+):(\d+)\)/);
        if (semiMatch) {
            const lineNum = parseInt(semiMatch[1], 10);
            const colNum = parseInt(semiMatch[2], 10);
            const lines = currentCode.split("\n");
            if (lineNum <= lines.length) {
                const line = lines[lineNum - 1];
                lines[lineNum - 1] = `${line.slice(0, colNum)};\n${line.slice(colNum).trimStart()}`;
                currentCode = lines.join("\n");
                appliedHeals.push(`missingSemicolonAtLine${lineNum}`);
                continue;
            }
        }

        // Targeted Repair B: Unexpected token (missing comma or unclosed parenthesis)
        const unexpectedMatch = msg.match(/Unexpected token(?:, expected [",']?(.*?)[",']?)? \((\d+):(\d+)\)/);
        if (unexpectedMatch) {
            const expectedToken = unexpectedMatch[1] || "";
            const lineNum = parseInt(unexpectedMatch[2], 10);
            const colNum = parseInt(unexpectedMatch[3], 10);
            const lines = currentCode.split("\n");
            if (lineNum > 0 && lineNum <= lines.length) {
                const targetLine = lines[lineNum - 1];
                const stripped = targetLine.replace(/\/\/.*$/, "").replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "");
                let pOpen = 0, pClose = 0;
                for (const ch of stripped) {
                    if (ch === "(") pOpen++;
                    else if (ch === ")") pClose++;
                }
                if (pOpen > pClose) {
                    const semiIdx = targetLine.lastIndexOf(";");
                    if (semiIdx !== -1) {
                        lines[lineNum - 1] = targetLine.slice(0, semiIdx) + ")".repeat(pOpen - pClose) + targetLine.slice(semiIdx);
                        currentCode = lines.join("\n");
                        appliedHeals.push(`unclosedParenAtLine${lineNum}`);
                        continue;
                    }
                }
                if (expectedToken === ",") {
                    lines[lineNum - 1] = `${targetLine.slice(0, colNum)}, ${targetLine.slice(colNum).trimStart()}`;
                    currentCode = lines.join("\n");
                    appliedHeals.push(`missingCommaAtLine${lineNum}`);
                    continue;
                }
            }
        }

        // Targeted Repair C: Stray top-level return statement
        const hasTopLevelReturn = lastErrors.some(e => e.message?.includes("'return' outside of function"));
        if (hasTopLevelReturn || /^[ \t]*(?:if\s*\([^)]+\)\s*)?return\b/m.test(currentCode)) {
            const strippedGetterBranches = currentCode.replace(
                /^[ \t]*if\s*\(\s*(?:prop|p)\s*===\s*(?:Symbol\.[a-zA-Z0-9_$]+|['"][^'"]+['"]|typeof\s+(?:prop|p)\s*===\s*['"]symbol['"])[^)]*\)\s*return\b[^\n\r]*;?[ \t]*\r?\n?/gm,
                ""
            );
            if (strippedGetterBranches !== currentCode) {
                currentCode = strippedGetterBranches;
                appliedHeals.push("strippedOrphanedGetterBranches");
                continue;
            }
            const strippedReturns = currentCode.replace(/^[ \t]*return\s+([a-zA-Z0-9_$({[\'"`][^\n\r]*;?)/gm, (m, expr, offset) => {
                const prefix = currentCode.slice(0, offset);
                const oB = (prefix.match(/\{/g) || []).length;
                const cB = (prefix.match(/\}/g) || []).length;
                return oB <= cB ? `${expr}` : m;
            });
            if (strippedReturns !== currentCode) {
                currentCode = strippedReturns;
                appliedHeals.push("strippedTopLevelReturn");
                continue;
            }
        }

        // Targeted Repair D: Duplicate variable declaration (Identifier 'X' has already been declared)
        const duplicateDeclError = lastErrors.find(e => e.message?.includes("has already been declared"));
        if (duplicateDeclError) {
            const varMatch = duplicateDeclError.message.match(/Identifier '([^']+)' has already been declared/);
            if (varMatch && varMatch[1] && !["_collectCallableMembers", "_collectControllerActions", "_getMock"].includes(varMatch[1])) {
                const varName = varMatch[1];
                let count = 0;
                const redeclRegex = new RegExp(`(^[ \\t]*)(?:const|let|var)\\s+(${varName}\\b[ \\t]*=)`, "gm");
                const healedVar = currentCode.replace(redeclRegex, (m, indent, rest) => {
                    count++;
                    return count === 1 ? m : `${indent}${rest}`;
                });
                if (healedVar !== currentCode) {
                    currentCode = healedVar;
                    appliedHeals.push(`reassignedDuplicateVar_${varName}`);
                    continue;
                }
            }
        }

        // Targeted Repair E: Unclosed delimiters at EOF via string/comment-aware LIFO stack
        const stack = [];
        let inStr = null;
        let inLineC = false;
        let inBlockC = false;
        for (let i = 0; i < currentCode.length; i++) {
            const c = currentCode[i];
            const next = currentCode[i + 1];
            if (inLineC) { if (c === '\n') inLineC = false; continue; }
            if (inBlockC) { if (c === '*' && next === '/') { inBlockC = false; i++; } continue; }
            if (inStr) { if (c === inStr && currentCode[i - 1] !== '\\') inStr = null; continue; }
            if (c === '/' && next === '/') { inLineC = true; i++; continue; }
            if (c === '/' && next === '*') { inBlockC = true; i++; continue; }
            if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
            if (c === '(' || c === '{' || c === '[') stack.push(c);
            else if (c === ')' && stack[stack.length - 1] === '(') stack.pop();
            else if (c === '}' && stack[stack.length - 1] === '{') stack.pop();
            else if (c === ']' && stack[stack.length - 1] === '[') stack.pop();
        }
        if (stack.length > 0) {
            let suffix = "";
            while (stack.length > 0) {
                const delim = stack.pop();
                if (delim === '{') {
                    if (stack.length > 0 && stack[stack.length - 1] === '(') {
                        stack.pop();
                        suffix += "\n});";
                    } else {
                        suffix += "\n};";
                    }
                } else if (delim === '(') suffix += ");";
                else if (delim === '[') suffix += "];";
            }
            currentCode = currentCode.trimEnd() + suffix + "\n";
            appliedHeals.push("lifoDelimiterBalanceAtEof");
            continue;
        }

        // Targeted Repair F: Trailing closing delimiter at EOF
        const trimmed = currentCode.trim();
        if (!trimmed.endsWith("}") && !trimmed.endsWith(");") && !trimmed.endsWith(";")) {
            currentCode = trimmed + "\n});";
            appliedHeals.push("trailingClosingDelimiter");
            continue;
        }

        if (!modifiedInPass) {
            break;
        }
    }

    // Final validation check
    const finalParsed = parseJavaScriptCode(currentCode, { filePath, allowRecoveredAst });
    const finalVal = validateTestCodeAst(currentCode, { filePath });

    const isValid = finalParsed.success && (strict ? finalVal.valid : true);

    return {
        success: isValid,
        repaired: isValid,
        code: currentCode,
        ast: finalParsed.ast || finalVal.ast,
        error: isValid ? null : (finalParsed.error || finalVal.errors[0]?.message || "Syntax error"),
        errors: finalVal.errors || [],
        attempts,
        appliedHeals
    };
}

/**
 * Normalizes imports in test code: resolves relative paths against repo root,
 * converts multiline ESM to CommonJS require(), and ensures runner imports
 * are placed after comments/directives.
 */
export function healTestImports(code, options = {}) {
    const {
        framework = "jest",
        isCommonJs = false,
        filePath = "tests/sample.test.js",
        rootDir = ""
    } = options;

    if (!code || typeof code !== "string") {
        return { success: false, code: code || "", modified: false, isCommonJs: false, changes: [] };
    }

    let result = code;
    const initialCode = code;
    const changes = [];

    // 1. Resolve relative import paths and strip container paths
    if (typeof healImportPathsInTestCode === "function") {
        const resolvedPaths = healImportPathsInTestCode(result, filePath, rootDir);
        if (resolvedPaths !== result) {
            changes.push({ type: "IMPORT_PATH_RESOLUTION", from: "container-paths", to: "relative-paths" });
            result = resolvedPaths;
        }
    }

    // 2. Multiline ESM to CommonJS conversion for CJS test suites
    if (isCommonJs || (framework === "jest" && /(?:const|let|var)\s+.*=\s*require\(/.test(result))) {
        const cjsConverted = convertMultilineEsmToCommonJs(result);
        if (cjsConverted !== result) {
            changes.push({ type: "ESM_TO_CJS_CONVERSION", from: "import", to: "require" });
            result = cjsConverted;
        }
    }

    // 3. Vitest Runner Imports Normalization
    if (framework === "vitest" || isVitestTestCode(result, { filePath })) {
        const normalized = normalizeTestFrameworkCode(result, { framework: "vitest", filePath });
        if (normalized !== result) {
            changes.push({ type: "VITEST_IMPORT_NORMALIZATION", from: "unnormalized", to: "vitest" });
            result = normalized;
        }
    }

    return {
        success: true,
        code: result,
        modified: result !== initialCode,
        isCommonJs: Boolean(isCommonJs || /(?:const|let|var)\s+.*=\s*require\(/.test(result)),
        changes
    };
}

/**
 * Heals Vitest API compatibility, mock hoisting, un-raced controller invocations,
 * and virtual RAM mocks for missing dependencies.
 */
export function healVitestCompatibility(code, options = {}) {
    const {
        filePath = "",
        collectionError = "",
        autoHealSyntax = true
    } = options;

    if (!code || typeof code !== "string") {
        return { success: false, code: code || "", ast: null, nestedTestsFixed: 0, jestApisReplaced: 0, errors: ["Empty code"] };
    }

    let transformed = code;
    let jestApisReplaced = 0;

    // 1. Transform Jest APIs to Vitest APIs
    const jestPatterns = [
        [/\bjest\.fn\b/g, "vi.fn"],
        [/\bjest\.mock\b/g, "vi.mock"],
        [/\bjest\.spyOn\b/g, "vi.spyOn"],
        [/\bjest\.clearAllMocks\b/g, "vi.clearAllMocks"],
        [/\bjest\.resetAllMocks\b/g, "vi.resetAllMocks"],
        [/\bjest\.restoreAllMocks\b/g, "vi.restoreAllMocks"],
        [/\bjest\.useFakeTimers\b/g, "vi.useFakeTimers"],
        [/\bjest\.useRealTimers\b/g, "vi.useRealTimers"],
        [/\bjest\.runAllTimers\b/g, "vi.runAllTimers"],
        [/\bjest\.advanceTimersByTime\b/g, "vi.advanceTimersByTime"],
        [/\bjest\.setSystemTime\b/g, "vi.setSystemTime"],
        [/\bjest\.isolateModules\b/g, "vi.isolateModules"]
    ];

    for (const [regex, replacement] of jestPatterns) {
        if (regex.test(transformed)) {
            transformed = transformed.replace(regex, replacement);
            jestApisReplaced++;
        }
    }

    // 2. Ensure runner imports from 'vitest' placed after directives
    if (!/from\s+['"]vitest['"]/.test(transformed)) {
        const importStmt = `import { describe, test, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';`;
        transformed = insertAfterDirectives(transformed, importStmt);
    } else if (/\bvi\./.test(transformed) && !/import\s+[^;]*\bvi\b[^;]*from\s+['"]vitest['"]/.test(transformed)) {
        transformed = transformed.replace(/(import\s*\{)([^}]*?)(\}\s*from\s*['"]vitest['"])/, "$1 vi,$2$3");
    }

    // 3. Wrap un-raced controller/helper invocations with Promise.race
    transformed = transformed.replace(
        /await\s+Promise\.resolve\s*\((m\.fn\([^)]*\)|inst\[mName\]\([^)]*\)|target\[name\]\([^)]*\)|act\.fn\([^)]*\))\)\.catch\(\(\)\s*=>\s*\{\}\)/g,
        "await Promise.race([Promise.resolve($1).catch(() => {}), new Promise(r => setTimeout(r, 60))])"
    );

    // 4. Inject virtual RAM mock if collection error indicates missing module
    if (collectionError) {
        const missingModMatch = collectionError.match(/Cannot find module ['"]([^'"]+)['"]/);
        if (missingModMatch) {
            const missingMod = missingModMatch[1];
            if (!transformed.includes(`vi.mock('${missingMod}'`)) {
                const mockSnippet = `vi.mock('${missingMod}', () => { const m = typeof mockCreateUniversalStub === 'function' ? mockCreateUniversalStub() : new Proxy({}, { get: () => vi.fn(() => Promise.resolve({})) }); return { default: m, ...m }; });\n`;
                transformed = insertAfterDirectives(transformed, mockSnippet);
            }
        }
    }

    // 5. Hoist mocks if needed
    if (typeof healVitestHoistedMocks === "function") {
        transformed = healVitestHoistedMocks(transformed);
    }

    // 6. AST Syntax Self-Healing pass
    let astResult = null;
    if (autoHealSyntax) {
        astResult = healTestSyntax(transformed, { framework: "vitest", filePath });
        if (astResult.success && astResult.code) {
            transformed = astResult.code;
        }
    }

    const structureCheck = validateVitestAstStructure(transformed);

    return {
        success: structureCheck.valid,
        code: transformed,
        ast: astResult?.ast || null,
        nestedTestsFixed: structureCheck.nestedTestCount || 0,
        jestApisReplaced,
        errors: structureCheck.errors || []
    };
}

// =========================================================================
// Backwards Compatibility Exports
// =========================================================================

/**
 * Backwards-compatible adapter for unitTestGenerator.service.js callers.
 */
export const autoHealAstSyntax = (codeString, options = {}) => {
    const res = healTestSyntax(codeString, {
        framework: options.framework || "jest",
        filePath: options.filePath || "",
        maxAttempts: options.maxRetries || options.maxAttempts || 6,
        ...options
    });
    return {
        success: res.success,
        code: res.code,
        ast: res.ast,
        ...(res.error ? { error: res.error } : {})
    };
};

/**
 * Backwards-compatible adapter for aiTestCode.validator.js callers.
 */
export const autoRepairTestSyntaxWithAst = (code, options = {}) => {
    const res = healTestSyntax(code, {
        filePath: options.filePath || "",
        maxAttempts: options.maxAttempts || options.maxRetries || 3,
        ...options
    });
    return {
        repaired: res.repaired,
        code: res.code,
        ast: res.ast,
        errors: res.errors || [],
        attempts: res.attempts
    };
};

// Re-export core validators and helpers for external caller convenience
export {
    validateTestCodeAst,
    healInvalidDynamicGetters,
    deduplicateAstDeclarations
};
