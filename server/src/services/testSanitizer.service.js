import fs from "fs";
import path from "path";
import { normalizePath } from "./fileCoverage.service.js";

const RESERVED_KEYWORDS = new Set([
    "jest", "require", "describe", "test", "it", "expect", "beforeEach", "afterEach",
    "beforeAll", "afterAll", "global", "globalThis", "process", "module", "exports",
    "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Buffer",
    "window", "document", "undefined", "null", "NaN", "Infinity", "eval", "arguments"
]);

/**
 * Normalizes and heals any import specifiers in test files that inadvertently reference
 * temporary storage paths (e.g. '../storage/projects/.../repo/src/foo')
 * and converts them to valid relative paths from the test file directory.
 *
 * @param {string} code - The test file source code
 * @param {string} relTestPath - Relative path of the test file within rootDir (e.g. 'tests/configuration.test.ts')
 * @returns {string} Cleaned code with valid relative imports
 */
export const healImportPathsInTestCode = (code, relTestPath = "tests/sample.test.js", rootDir = "") => {
    if (!code) return "";
    const testDir = path.dirname(relTestPath.replace(/\\/g, "/"));

    return code.replace(
        /((?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*|jest\.(?:mock|requireActual|requireMock)\s*\(\s*)['"])([^'"]+)(['"]\s*\)?)/g,
        (match, prefix, importTarget, suffix) => {
            if (/storage\/projects\/[^/]+\/[^/]+\/[^/]+\/repo\//i.test(importTarget) || /(?:^|\/)\.\.\/.*repo\//i.test(importTarget)) {
                const cleanSubpath = importTarget
                    .replace(/^.*\/repo\//i, "")
                    .replace(/^\.?\//, "");

                let rel = path.relative(testDir, cleanSubpath).replace(/\\/g, "/");
                if (!rel.startsWith(".")) {
                    rel = "./" + rel;
                }
                const cleanImport = rel.replace(/\.[cm]?[jt]sx?$/, "");
                return `${prefix}${cleanImport}${suffix}`;
            }

            // If rootDir is provided and import starts with '.', check if target is valid or needs healing to src/
            if (rootDir && importTarget.startsWith(".")) {
                const testAbsDir = path.resolve(rootDir, testDir);
                const absTarget = path.resolve(testAbsDir, importTarget);
                const exts = ["", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"];
                let targetExists = false;
                for (const ext of exts) {
                    const candidate = absTarget + ext;
                    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                        targetExists = true;
                        break;
                    }
                }
                if (!targetExists) {
                    for (const ext of ["/index.js", "/index.ts", "/index.mjs", "/index.cjs"]) {
                        const candidate = absTarget + ext;
                        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                            targetExists = true;
                            break;
                        }
                    }
                }
                if (targetExists) {
                    return match;
                }

                // If not found in testDir, check if it points to a source file in src/ or repo root
                const srcSubDir = testDir.replace(/^tests?\/?/, "src/");
                const candAbsFromSrc = path.resolve(rootDir, srcSubDir, importTarget);
                const cleanTarget = importTarget.replace(/^(\.\.\/|\.\/)+/, "").replace(/^\.?\//, "");
                const cleanPkgTarget = cleanTarget.replace(/^(?:backend|frontend|server|client|api)\//, "");
                const candidateAbsList = [
                    candAbsFromSrc,
                    path.resolve(rootDir, "src", cleanTarget),
                    path.resolve(rootDir, cleanTarget),
                    path.resolve(rootDir, "src", cleanPkgTarget),
                    path.resolve(rootDir, cleanPkgTarget)
                ];

                for (const candAbs of candidateAbsList) {
                    let foundRel = null;
                    for (const ext of exts) {
                        const full = candAbs + ext;
                        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
                            foundRel = path.relative(testAbsDir, candAbs).replace(/\\/g, "/");
                            if (!foundRel.startsWith(".")) foundRel = "./" + foundRel;
                            break;
                        }
                    }
                    if (!foundRel) {
                        for (const ext of ["/index.js", "/index.ts", "/index.mjs", "/index.cjs"]) {
                            const full = candAbs + ext;
                            if (fs.existsSync(full) && fs.statSync(full).isFile()) {
                                foundRel = path.relative(testAbsDir, candAbs).replace(/\\/g, "/");
                                if (!foundRel.startsWith(".")) foundRel = "./" + foundRel;
                                break;
                            }
                        }
                    }
                    if (foundRel) {
                        const hasExt = /\.[cm]?[jt]sx?$/.test(importTarget);
                        const finalTarget = hasExt ? foundRel : foundRel.replace(/\.[cm]?[jt]sx?$/, "");
                        return `${prefix}${finalTarget}${suffix}`;
                    }
                }
            }

            // Case 2: relative path pointing to src/...
            // Recalculate relative path to ensure the exact correct number of '../' for testDir depth
            const srcMatch = importTarget.match(/^(?:\.\.\/|\.\/)*(?:(?:backend|frontend|server|client|api)\/)?(src\/.*)$/);
            if (srcMatch) {
                const cleanSrcPath = srcMatch[1];
                let packagePrefix = "";
                const parts = testDir.split("/");
                const testIdx = parts.findIndex(p => p === "tests" || p === "test" || p === "__tests__");
                if (testIdx > 0) {
                    packagePrefix = parts.slice(0, testIdx).join("/");
                }
                const targetPath = packagePrefix ? `${packagePrefix}/${cleanSrcPath}` : cleanSrcPath;

                let rel = path.relative(testDir, targetPath).replace(/\\/g, "/");
                if (!rel.startsWith(".")) {
                    rel = "./" + rel;
                }
                const hasExt = /\.[cm]?[jt]sx?$/.test(importTarget);
                const finalTarget = hasExt ? rel : rel.replace(/\.[cm]?[jt]sx?$/, "");
                return `${prefix}${finalTarget}${suffix}`;
            }

            return match;
        }
    );
};

/**
 * Converts unescaped multiline single- or double-quoted strings into template literals
 * to avoid Babel "SyntaxError: Unterminated string constant" when LLMs generate multiline strings.
 */
export const healMultilineStrings = (code) => {
    if (!code) return "";
    const lines = code.split("\n");
    const result = [];
    let inMultilineQuote = false;
    let quoteChar = null;
    let buffer = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (inMultilineQuote) {
            buffer.push(line);
            let closed = false;
            let escaped = false;
            for (let c = 0; c < line.length; c++) {
                const ch = line[c];
                if (ch === "\\") {
                    escaped = !escaped;
                } else {
                    if (ch === quoteChar && !escaped) {
                        closed = true;
                        break;
                    }
                    escaped = false;
                }
            }
            if (closed) {
                const joined = buffer.join("\n");
                const fixed = joined.replace(
                    new RegExp(`(${quoteChar === "'" ? "'" : '"'})([\\s\\S]*?)(${quoteChar === "'" ? "'" : '"'})`),
                    "`$2`"
                );
                result.push(fixed);
                inMultilineQuote = false;
                buffer = [];
            }
            continue;
        }

        let inStr = null;
        let escaped = false;
        for (let c = 0; c < line.length; c++) {
            const ch = line[c];
            if (ch === "\\") {
                escaped = !escaped;
                continue;
            }
            if (!inStr) {
                if (ch === "'" || ch === '"' || ch === "`") {
                    inStr = ch;
                }
            } else if (inStr === ch && !escaped) {
                inStr = null;
            }
            escaped = false;
        }

        if (inStr && (inStr === "'" || inStr === '"') && !line.endsWith("\\")) {
            inMultilineQuote = true;
            quoteChar = inStr;
            buffer = [line];
        } else {
            result.push(line);
        }
    }

    if (buffer.length > 0) {
        result.push(...buffer);
    }

    return result.join("\n");
};

/**
 * Sanitizes and cleans up test file content to eliminate syntax errors,
 * non-code text (e.g. "N/A - This is a new test file."), invalid TypeScript syntax in JS files,
 * duplicate identifier declarations, and duplicate identical describe blocks.
 */
export const cleanAndDeduplicateTestContent = (content, rawOutput = "", filePath = "") => {
    if (!content) return "";
    let cleaned = content;

    // Detect if this file is TypeScript
    const isExplicitTsFile = Boolean(filePath && /\.[cm]?tsx?$/i.test(filePath));
    const isExplicitJsFile = Boolean(filePath && /\.[cm]?jsx?$/i.test(filePath));
    const hasTsConstructs = /^\s*import\s+type\b/m.test(content) ||
        /\b(?:interface\s+[A-Z]|type\s+[A-Z][a-zA-Z0-9_$]*\s*=|enum\s+[A-Z])\b/.test(content);

    const isTsFile = isExplicitTsFile || (!isExplicitJsFile && hasTsConstructs);

    // 0. Heal multiline strings with unescaped literal newlines
    cleaned = healMultilineStrings(cleaned);

    // 1. Remove non-code placeholder AI blocks (e.g. describe('AI Suggested Unit Tests', () => { N/A - See fullUpdatedContent });)
    cleaned = cleaned.replace(/[ \t]*describe\s*\(\s*['"]AI Suggested Unit Tests['"][\s\S]*?\n[ \t]*\}\s*\);?/g, (match) => {
        if (!match.includes("test(") && !match.includes("it(")) {
            return "";
        }
        if (match.includes("N/A") || match.includes("Providing full file content below") || match.includes("fullUpdatedContent") || match.includes("next block")) {
            return "";
        }
        return match;
    });
    cleaned = cleaned.replace(/^[ \t]*N\/A(?:\s*-[^\n]*)?\r?\n?/gm, "");
    cleaned = cleaned.replace(/^[ \t]*\/\/\s*(?:No additional|See full|Test cases are fully integrated|The full content is provided|Handled via)[^\n]*\r?\n?/gm, "");
    cleaned = cleaned.replace(/[ \t]*describe\s*\(\s*['"]AI Suggested Unit Tests['"]\s*,\s*(?:\(\s*\)|function\s*\(\s*\))\s*=>\s*\{\s*(?:\/\/[^\n]*\r?\n\s*)*\}\s*\);?\r?\n?/g, "");
    cleaned = cleaned.replace(/[ \t]*describe\s*\(\s*['"]AI Suggested Unit Tests['"]\s*,\s*(?:\(\s*\)|function\s*\(\s*\))\s*=>\s*\{\s*\}\s*\);?\r?\n?/g, "");

    // Heal orphaned test blocks that start with title string without `test(` or `it(`
    cleaned = cleaned.replace(/^[ \t]*(['"][^'"]+['"]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{)/gm, "    test($1");

    // Heal unquoted test runner keyword comparisons (e.g. expect(...).toEqual(test) -> expect(...).toEqual("test"))
    cleaned = cleaned.replace(/\.(toEqual|toBe)\(\s*(test|it|describe)\s*\)/g, '.$1("$2")');

    // 1.2. Remove orphaned object mock property lines cut from broken multi-line mocks
    // e.g. "create: jest.fn(() => ({ post: jest.fn() })) \n }));"
    const orphanMockRegex = /^[ \t]*[a-zA-Z0-9_$]+\s*:\s*(?:jest|vi)\.fn\b[\s\S]*?\r?\n[ \t]*\}\s*\)\s*\);?[ \t]*\r?\n?/gm;
    cleaned = cleaned.replace(orphanMockRegex, (match, offset, str) => {
        const before = str.slice(0, offset).replace(/\/\/[^\n]*\n/g, '').trimEnd();
        if (/(?:jest|vi)\.mock\s*\([^;{]+=>\s*\(\s*\{$/.test(before) || /=>\s*\(\s*\{$/.test(before)) {
            return match;
        }
        return '';
    });

    // Remove orphan closing brackets like "}));" or "});" that have no matching open brackets
    cleaned = cleaned.replace(/^[ \t]*(?:\}\s*\)\s*\);|\)\s*\);)[ \t]*\r?\n?/gm, (match, offset, str) => {
        const before = str.slice(0, offset);
        let openP = 0;
        let openB = 0;
        let inS = null;
        for (let i = 0; i < before.length; i++) {
            const ch = before[i];
            if (ch === '"' || ch === "'" || ch === '`') {
                if (!inS) inS = ch;
                else if (inS === ch && before[i - 1] !== '\\') inS = null;
            } else if (!inS) {
                if (ch === '(') openP++;
                else if (ch === ')') openP = Math.max(0, openP - 1);
                else if (ch === '{') openB++;
                else if (ch === '}') openB = Math.max(0, openB - 1);
            }
        }
        if (openP === 0 && openB === 0) {
            return '';
        }
        return match;
    });

    // 2. Strip corrupted or invalid TypeScript annotations in JavaScript files ONLY that break Babel parser
    if (!isTsFile) {
        cleaned = cleaned.replace(/\(\(([a-zA-Z0-9_$,\s]+)(?:\s*:\s*[^)]+)?\)\)/g, "($1)");
        cleaned = cleaned.replace(/\(([a-zA-Z0-9_$]+)\s*:\s*(?:any|string|number|boolean|object|unknown|void|never)\s*(?:\[\s*\])*\)/g, "($1)");
        cleaned = cleaned.replace(/\(([a-zA-Z0-9_$]+)\s*:\s*(?:any|string|number|boolean|object|unknown|void|never)\s*(?:\[\s*\])*\s*,/g, "($1,");
        cleaned = cleaned.replace(/,\s*([a-zA-Z0-9_$]+)\s*:\s*(?:any|string|number|boolean|object|unknown|void|never)\s*(?:\[\s*\])*\s*\)/g, ", $1)");
        cleaned = cleaned.replace(/,\s*([a-zA-Z0-9_$]+)\s*:\s*(?:any|string|number|boolean|object|unknown|void|never)\s*(?:\[\s*\])*\s*,/g, ", $1,");
        cleaned = cleaned.replace(/catch\s*\(\s*([a-zA-Z0-9_$]+)\s*:\s*(?:any|Error|unknown)\s*\)/g, "catch ($1)");
        cleaned = cleaned.replace(/formatError\s*:\s*jest\.fn\s*\(\s*\(?\s*([a-zA-Z0-9_]+)\s*:\s*any\s*\)?\s*=>/g, "formatError: jest.fn(($1) =>");
        cleaned = cleaned.replace(/\b(const|let|var)\s+([a-zA-Z0-9_$]+)\s*:\s*(?:any|string|number|boolean|object|unknown)\s*(?:\[\s*\])*\s*=/g, "$1 $2 =");
        cleaned = cleaned.replace(/\(\s*globalThis\s+as\s+any\s*\)/g, "globalThis");
        cleaned = cleaned.replace(/\bas\s+(?:any|jest\.Mock|unknown)(?:\s*\[\s*\])*(?:\b|(?=[^a-zA-Z0-9_$]))/g, "");
    }

    // 2.5. Remove illegal redeclarations of `jest` in CommonJS / Jest test files
    // In Jest's CommonJS environment, `jest` is injected as a formal parameter:
    // (function (module, exports, require, __dirname, __filename, jest) { ... })
    // Declaring `const { jest } = require(...)` or `const jest = ...` at module scope causes:
    // "SyntaxError: Identifier 'jest' has already been declared".
    cleaned = cleaned.replace(
        /^[ \t]*(const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(([^)]+)\);?[ \t]*\r?$/gm,
        (match, kind, inner, mod) => {
            const tokens = inner.split(',').map(t => t.trim()).filter(Boolean);
            const hasJestToken = tokens.some(t => {
                const name = t.includes(':') ? t.split(':')[0].trim() : (t.includes(' as ') ? t.split(' as ')[0].trim() : t);
                return name === 'jest';
            });
            if (!hasJestToken) return match;

            const remainingTokens = tokens.filter(t => {
                const name = t.includes(':') ? t.split(':')[0].trim() : (t.includes(' as ') ? t.split(' as ')[0].trim() : t);
                return name !== 'jest';
            });

            if (remainingTokens.length === 0) {
                return "";
            }
            return `${kind} { ${remainingTokens.join(', ')} } = require(${mod});`;
        }
    );

    cleaned = cleaned.replace(
        /^[ \t]*(const|let)\s+jest\s*=\s*require\s*\(['"](?:@jest\/globals|jest)['"]\);?[ \t]*\r?\n?/gm,
        ""
    );

    // 3. Remove duplicate identical lines of const/let/var/require/import
    const lines = cleaned.split("\n");
    const seenTopLevelRequireOrImport = new Set();
    const finalLines = [];
    let importBraceDepth = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        const isRequireOrImport = (
            (trimmed.startsWith("const ") || trimmed.startsWith("let ") || trimmed.startsWith("var ") || trimmed.startsWith("import ")) &&
            (trimmed.includes("require(") || trimmed.includes("from '") || trimmed.includes('from "'))
        );

        if (isRequireOrImport) {
            if (importBraceDepth === 0) {
                if (seenTopLevelRequireOrImport.has(trimmed)) {
                    continue;
                }
                seenTopLevelRequireOrImport.add(trimmed);
            } else if (seenTopLevelRequireOrImport.has(trimmed)) {
                // If it was already declared at module scope (braceDepth === 0),
                // declaring it again inside a nested scope is redundant.
                continue;
            }
        }
        finalLines.push(line);

        const strippedForBraces = line.replace(/\/\/.*$/, "").replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, "");
        for (let c = 0; c < strippedForBraces.length; c++) {
            const ch = strippedForBraces[c];
            if (ch === '{') importBraceDepth++;
            else if (ch === '}') importBraceDepth = Math.max(0, importBraceDepth - 1);
        }
    }
    cleaned = finalLines.join("\n");

    // 4. Fix duplicate declarations of top-level identifiers (at module scope, braceDepth === 0)
    const linesAfterDedup = cleaned.split("\n");
    const topDeclared = new Map();
    let braceDepth = 0;

    for (let i = 0; i < linesAfterDedup.length; i++) {
        const line = linesAfterDedup[i];
        const trimmedLine = line.trim();

        // Only consider top-level declarations (braceDepth === 0)
        if (braceDepth === 0) {
            if (trimmedLine.startsWith("import ")) {
                // Named imports: import { a, b } from '...'
                const importNamedMatch = trimmedLine.match(/^import\s+\{([^}]+)\}\s+from\s+(.+)$/);
                if (importNamedMatch) {
                    const [, inner, rest] = importNamedMatch;
                    const rawTokens = inner.split(',').map(t => t.trim()).filter(Boolean);
                    const remainingTokens = [];
                    let anyDuplicate = false;

                    for (const tok of rawTokens) {
                        const localName = tok.includes(' as ') ? tok.split(' as ')[1].trim() : tok;
                        if (topDeclared.has(localName)) {
                            anyDuplicate = true;
                        } else {
                            topDeclared.set(localName, i);
                            remainingTokens.push(tok);
                        }
                    }

                    if (anyDuplicate) {
                        if (remainingTokens.length === 0) {
                            linesAfterDedup[i] = `// [deduped] ${line.trim()}`;
                        } else {
                            linesAfterDedup[i] = `import { ${remainingTokens.join(', ')} } from ${rest}`;
                        }
                    }
                } else {
                    // Default or namespace import: import foo from '...' or import * as foo from '...'
                    const defaultImportMatch = trimmedLine.match(/^import\s+(?:\*\s+as\s+)?([a-zA-Z0-9_$]+)\s+from\s+/);
                    if (defaultImportMatch) {
                        const varName = defaultImportMatch[1];
                        if (topDeclared.has(varName)) {
                            linesAfterDedup[i] = `// [deduped] ${line.trim()}`;
                        } else {
                            topDeclared.set(varName, i);
                        }
                    }
                }
            } else if (trimmedLine.startsWith("const ") || trimmedLine.startsWith("let ") || trimmedLine.startsWith("var ")) {
                // Destructuring: const { a, b } = require(...) or = ...
                const destructuringMatch = trimmedLine.match(/^(const|let|var)\s+\{([^}]+)\}\s*=\s*(.+)$/);
                if (destructuringMatch) {
                    const [, kind, inner, rest] = destructuringMatch;
                    const rawTokens = inner.split(',').map(t => t.trim()).filter(Boolean);
                    const remainingTokens = [];
                    let anyDuplicate = false;

                    for (const tok of rawTokens) {
                        const localName = tok.includes(':')
                            ? tok.split(':')[1].trim()
                            : (tok.includes(' as ') ? tok.split(' as ')[1].trim() : tok);
                        if (topDeclared.has(localName)) {
                            anyDuplicate = true;
                        } else {
                            topDeclared.set(localName, i);
                            remainingTokens.push(tok);
                        }
                    }

                    if (anyDuplicate) {
                        if (remainingTokens.length === 0) {
                            linesAfterDedup[i] = `// [deduped] ${line.trim()}`;
                        } else {
                            linesAfterDedup[i] = `${kind} { ${remainingTokens.join(', ')} } = ${rest}`;
                        }
                    }
                } else {
                    // Simple declaration: const foo = ... or let foo = ... or var foo = ...
                    const simpleMatch = trimmedLine.match(/^(const|let|var)\s+([a-zA-Z0-9_$]+)\s*(=|\()/);
                    if (simpleMatch) {
                        const [, , varName] = simpleMatch;
                        if (topDeclared.has(varName)) {
                            linesAfterDedup[i] = `// [deduped] ${line.trim()}`;
                        } else {
                            topDeclared.set(varName, i);
                        }
                    }
                }
            }
        }

        // Update braceDepth for tracking module scope, ignoring braces in comments or strings
        const strippedForBraces = line.replace(/\/\/.*$/, "").replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, "");
        for (let c = 0; c < strippedForBraces.length; c++) {
            const ch = strippedForBraces[c];
            if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
        }
    }
    cleaned = linesAfterDedup.join("\n");

    // 5. Remove duplicate identical describe blocks for AI Suggested Unit Tests
    const aiDescribeBlocks = [...cleaned.matchAll(/(?:describe\s*\(\s*['"]AI Suggested Unit Tests['"]\s*,\s*(?:\(\s*\)|function\s*\(\s*\))\s*=>\s*\{[\s\S]*?\n\}\s*\);?)/g)];
    if (aiDescribeBlocks.length > 1) {
        for (let i = 1; i < aiDescribeBlocks.length; i++) {
            cleaned = cleaned.replace(aiDescribeBlocks[i][0], "");
        }
    }

    // 6. Clean up duplicate jest.mock calls with identical target (supporting multiline factory functions)
    const seenMockModules = new Set();
    const mockRegex = /jest\.mock\s*\(\s*(['"][^'"]+['"])/g;
    let matchMock;
    const mockIntervalsToRemove = [];
    while ((matchMock = mockRegex.exec(cleaned)) !== null) {
        const modName = matchMock[1];
        const startIdx = matchMock.index;
        let openParens = 0;
        let endIdx = -1;
        for (let j = startIdx; j < cleaned.length; j++) {
            if (cleaned[j] === "(") openParens++;
            else if (cleaned[j] === ")") {
                openParens--;
                if (openParens === 0) {
                    endIdx = j + 1;
                    if (cleaned[endIdx] === ";") endIdx++;
                    if (cleaned[endIdx] === "\n") endIdx++;
                    break;
                }
            }
        }
        if (endIdx !== -1) {
            if (seenMockModules.has(modName)) {
                mockIntervalsToRemove.push([startIdx, endIdx]);
            } else {
                seenMockModules.add(modName);
            }
        }
    }
    for (let k = mockIntervalsToRemove.length - 1; k >= 0; k--) {
        const [s, e] = mockIntervalsToRemove[k];
        cleaned = cleaned.slice(0, s) + cleaned.slice(e);
    }

    // 7. Ensure safe global `jest` definition if rawOutput explicitly reports ReferenceError: jest is not defined
    if (rawOutput && rawOutput.includes("ReferenceError: jest is not defined")) {
        if (!cleaned.includes("var jest =") && !cleaned.includes("const jest =") && !cleaned.includes("let jest =") && !cleaned.includes("import { jest") && !cleaned.includes("import {jest")) {
            const jestPolyfill =
                "var jest = (typeof globalThis !== 'undefined' && globalThis.jest) ? globalThis.jest : (typeof global !== 'undefined' && global.jest ? global.jest : (typeof vi !== 'undefined' ? vi : undefined));\n" +
                "if (typeof jest === 'undefined' || !jest) {\n" +
                "  var _createMockFn = function(impl) { var f = typeof impl === 'function' ? function() { return impl.apply(this, arguments); } : function() {}; f.mock = { calls: [], instances: [], results: [] }; f.mockReturnValue = function(v) { return _createMockFn(function() { return v; }); }; f.mockResolvedValue = function(v) { return _createMockFn(function() { return Promise.resolve(v); }); }; f.mockRejectedValue = function(v) { return _createMockFn(function() { return Promise.reject(v); }); }; f.mockImplementation = function(fn) { return _createMockFn(fn); }; f.mockReturnThis = function() { return f; }; f.mockClear = function() { return f; }; f.mockReset = function() { return f; }; return f; };\n" +
                "  jest = { fn: _createMockFn, mock: function() {}, unmock: function() {}, spyOn: function(o, m) { return _createMockFn(o ? o[m] : null); }, clearAllMocks: function() {}, resetAllMocks: function() {}, resetModules: function() {}, restoreAllMocks: function() {}, isolateModules: function(fn) { if (typeof fn === 'function') fn(); } };\n" +
                "}\n";
            cleaned = jestPolyfill + cleaned;
        }
    }

    // 8. If rawOutput reports "Identifier 'jest' has already been declared", ensure all lexical jest bindings are replaced with var
    if (rawOutput && rawOutput.includes("Identifier 'jest' has already been declared")) {
        cleaned = cleaned.replace(/^[ \t]*(?:const|let)\s+jest\s*=/gm, "var jest =");
        cleaned = cleaned.replace(
            /^[ \t]*(?:const|let)\s+\{([^}]+)\}\s*=\s*(.+)$/gm,
            (match, inner, rest) => {
                const tokens = inner.split(',').map(t => t.trim()).filter(Boolean);
                const remaining = tokens.filter(t => {
                    const name = t.includes(':') ? t.split(':')[0].trim() : (t.includes(' as ') ? t.split(' as ')[0].trim() : t);
                    return name !== 'jest';
                });
                if (remaining.length === tokens.length) return match;
                if (remaining.length === 0) return `// [sanitized] ${match.trim()}`;
                return `const { ${remaining.join(', ')} } = ${rest}`;
            }
        );
    }

    // 9. If rawOutput reports ReferenceError: <varName> is not defined, check if <varName> is required in the file and provide it
    if (rawOutput && rawOutput.includes("ReferenceError:")) {
        const refMatches = [...rawOutput.matchAll(/ReferenceError:\s*(\w+)\s+is not defined/g)];
        for (const rm of refMatches) {
            const varName = rm[1];
            if (RESERVED_KEYWORDS.has(varName)) continue;

            const reqMatch = cleaned.match(new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*require\\s*\\(([^)]+)\\)`));
            if (reqMatch) {
                const modSpec = reqMatch[1];
                cleaned = cleaned.replace(
                    /(test|it)\s*\(\s*(['"`][^'"`]+['"`])\s*,\s*((?:async\s*)?\(\s*\)\s*=>\s*\{)([\s\S]*?)\n\s*\}\s*\);?/g,
                    (testBlock, testKeyword, testTitle, testHeader, testBody) => {
                        const usesVar = new RegExp(`\\b${varName}\\b`).test(testBody);
                        const definesVar = new RegExp(`(?:const|let|var)\\s+${varName}\\b`).test(testBody);
                        if (usesVar && !definesVar) {
                            const firstUseIdx = testBody.search(new RegExp(`\\b${varName}\\b`));
                            if (firstUseIdx !== -1) {
                                const lineStart = testBody.lastIndexOf('\n', firstUseIdx);
                                const insertPos = lineStart === -1 ? 0 : lineStart + 1;
                                const newBody = testBody.slice(0, insertPos) + `    const ${varName} = require(${modSpec});\n` + testBody.slice(insertPos);
                                return `${testKeyword}(${testTitle}, ${testHeader}${newBody}\n});`;
                            }
                            return `${testKeyword}(${testTitle}, ${testHeader}\n    const ${varName} = require(${modSpec});${testBody}\n});`;
                        }
                        return testBlock;
                    }
                );
            }
        }
    }

    // 10. Heal and standardize axios mock to provide a shared mock instance across all axios.create() calls
    if (cleaned.includes("axios") && cleaned.includes("create: jest.fn")) {
        cleaned = cleaned.replace(
            /jest\.mock\(['"]axios['"],\s*\(\)\s*=>\s*\(\{\s*create:\s*(?:jest|vi)\.fn\(\(\)\s*=>\s*\(\{\s*post:\s*(?:jest|vi)\.fn\(\)\s*\}\)\)\s*\}\)\);/g,
            `jest.mock('axios', () => {
  const instance = {
    post: jest.fn(() => Promise.resolve({ data: {} })),
    get: jest.fn(() => Promise.resolve({ data: {} }))
  };
  globalThis.__mockAxiosInstance = instance;
  return {
    create: jest.fn(() => instance),
    post: instance.post,
    get: instance.get
  };
});`
        );
    }

    if (cleaned.includes("mockAxiosInstance") && !/^(?:const|let|var)\s+mockAxiosInstance\b/m.test(cleaned)) {
        cleaned = cleaned.replace(
            /^[ \t]*\/\/\s*\[deduped\]\s*const\s+mockAxiosInstance\s*=\s*(.+)$/m,
            "const mockAxiosInstance = (typeof globalThis !== 'undefined' && globalThis.__mockAxiosInstance) ? globalThis.__mockAxiosInstance : $1;"
        );
        if (!/^(?:const|let|var)\s+mockAxiosInstance\b/m.test(cleaned)) {
            cleaned = "const mockAxiosInstance = (typeof globalThis !== 'undefined' && globalThis.__mockAxiosInstance) ? globalThis.__mockAxiosInstance : (typeof axios !== 'undefined' && axios.create ? axios.create() : { post: jest.fn(() => Promise.resolve({ data: {} })), get: jest.fn(() => Promise.resolve({ data: {} })) });\n" + cleaned;
        }
    }

    // 11. Normalize redundant monorepo prefixes (../../backend/src/... -> ../../src/...)
    cleaned = cleaned.replace(/require\(['"](?:\.\.\/)+(?:backend|frontend|server|client|api)\/src\/([^'"]+)['"]\)/g, "require('../../src/$1')");

    return cleaned;
};

/**
 * Scans all test files in project root (including monorepo packages like backend/, frontend/)
 * and applies syntax deduplication, import depth healing, and removes non-code placeholder comments
 * or invalid TypeScript syntax to prevent Babel parser aborts during runner discovery.
 */
export const sanitizeAllProjectTestFiles = (rootDir) => {
    if (!rootDir || !fs.existsSync(rootDir)) return;
    const testFiles = [];
    const scanDir = (dir, depth = 0) => {
        if (!fs.existsSync(dir) || depth > 10) return;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (
                    entry.name === "node_modules" ||
                    entry.name === ".git" ||
                    entry.name === "coverage" ||
                    entry.name === "dist" ||
                    entry.name === "build" ||
                    entry.name === ".next" ||
                    entry.name === ".cache" ||
                    entry.name === "storage" ||
                    entry.name === ".understand-anything"
                ) continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath, depth + 1);
                } else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) {
                    testFiles.push(fullPath);
                }
            }
        } catch { }
    };

    scanDir(rootDir, 0);

    for (const tf of testFiles) {
        try {
            const original = fs.readFileSync(tf, "utf8");
            const relFromRoot = normalizePath(path.relative(rootDir, tf));
            let cleaned = cleanAndDeduplicateTestContent(original, "", tf);
            cleaned = healImportPathsInTestCode(cleaned, relFromRoot, rootDir);
            if (cleaned !== original) {
                fs.writeFileSync(tf, cleaned, "utf8");
            }
        } catch { }
    }
};
