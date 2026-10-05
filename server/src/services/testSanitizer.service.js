import fs from "fs";
import path from "path";
import { normalizePath } from "./fileCoverage.service.js";

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
        /((?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*)['"])([^'"]+)(['"]\s*\)?)/g,
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

            // If the import already exists on disk from testDir, leave it completely untouched
            if (rootDir) {
                const testAbsDir = path.resolve(rootDir, testDir);
                const absTarget = path.resolve(testAbsDir, importTarget);
                const exts = ["", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", "/index.js", "/index.ts"];
                if (exts.some(ext => fs.existsSync(absTarget + ext))) {
                    return match;
                }
            }

            // Case 2: relative path pointing to src/...
            // Recalculate relative path to ensure the exact correct number of '../' for testDir depth
            const srcMatch = importTarget.match(/^(?:\.\.\/|\.\/)*(src\/.*)$/);
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
 * Sanitizes and cleans up test file content to eliminate syntax errors,
 * non-code text (e.g. "N/A - This is a new test file."), invalid TypeScript syntax in JS files,
 * duplicate identifier declarations, and duplicate identical describe blocks.
 */
export const cleanAndDeduplicateTestContent = (content, rawOutput = "") => {
    if (!content) return "";
    let cleaned = content;

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
    cleaned = cleaned.replace(/[ \t]*describe\s*\(\s*['"][^'"]*['"]\s*,\s*(?:\(\s*\)|function\s*\(\s*\))\s*=>\s*\{\s*(?:\/\/[^\n]*\r?\n\s*)*\}\s*\);?\r?\n?/g, "");
    cleaned = cleaned.replace(/[ \t]*describe\s*\(\s*['"][^'"]*['"]\s*,\s*(?:\(\s*\)|function\s*\(\s*\))\s*=>\s*\{\s*\}\s*\);?\r?\n?/g, "");

    // 2. Strip corrupted or invalid TypeScript annotations in JavaScript files that break Babel parser
    // e.g. parse: jest.fn(((data: any)) => { ... }) -> parse: jest.fn((data) => { ... })
    cleaned = cleaned.replace(/\(\(([a-zA-Z0-9_$,\s]+)(?:\s*:\s*[^)]+)?\)\)/g, "($1)");
    cleaned = cleaned.replace(/\(([a-zA-Z0-9_$]+)\s*:\s*(?:any|string|number|boolean|object|unknown|void|never)\)/g, "($1)");
    cleaned = cleaned.replace(/\(([a-zA-Z0-9_$]+)\s*:\s*(?:any|string|number|boolean|object|unknown|void|never)\s*,/g, "($1,");
    cleaned = cleaned.replace(/,\s*([a-zA-Z0-9_$]+)\s*:\s*(?:any|string|number|boolean|object|unknown|void|never)\s*\)/g, ", $1)");
    cleaned = cleaned.replace(/,\s*([a-zA-Z0-9_$]+)\s*:\s*(?:any|string|number|boolean|object|unknown|void|never)\s*,/g, ", $1,");
    cleaned = cleaned.replace(/catch\s*\(\s*([a-zA-Z0-9_$]+)\s*:\s*(?:any|Error|unknown)\s*\)/g, "catch ($1)");
    cleaned = cleaned.replace(/formatError\s*:\s*jest\.fn\s*\(\s*\(?\s*([a-zA-Z0-9_]+)\s*:\s*any\s*\)?\s*=>/g, "formatError: jest.fn(($1) =>");
    cleaned = cleaned.replace(/\b(const|let|var)\s+([a-zA-Z0-9_$]+)\s*:\s*any\b/g, "$1 $2");
    cleaned = cleaned.replace(/\(\s*globalThis\s+as\s+any\s*\)/g, "globalThis");
    cleaned = cleaned.replace(/\bas\s+(?:any|jest\.Mock)\b/g, "");

    // 3. Remove duplicate identical lines of const/let/var/require
    const lines = cleaned.split("\n");
    const seenImportOrRequire = new Set();
    const finalLines = [];

    for (const line of lines) {
        const trimmed = line.trim();
        const isRequireOrImport = (
            (trimmed.startsWith("const ") || trimmed.startsWith("let ") || trimmed.startsWith("var ") || trimmed.startsWith("import ")) &&
            (trimmed.includes("require(") || trimmed.includes("from '") || trimmed.includes('from "'))
        );

        if (isRequireOrImport) {
            if (seenImportOrRequire.has(trimmed)) {
                continue;
            }
            seenImportOrRequire.add(trimmed);
        }
        finalLines.push(line);
    }
    cleaned = finalLines.join("\n");

    // 4. Fix duplicate declarations of identifiers reported by Jest or detected in content
    const linesAfterDedup = cleaned.split("\n");
    const topDeclared = new Map();

    for (let i = 0; i < linesAfterDedup.length; i++) {
        const line = linesAfterDedup[i];

        // Destructuring: const/let/var { a, b } = require(...) or = ...
        const destructuringMatch = line.match(/^(\s*)(const|let|var)\s+\{([^}]+)\}\s*=\s*(.+)$/);
        if (destructuringMatch) {
            const [, indent, kind, inner, rest] = destructuringMatch;
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
                    linesAfterDedup[i] = `${indent}// [deduped] ${line.trim()}`;
                } else {
                    linesAfterDedup[i] = `${indent}${kind} { ${remainingTokens.join(', ')} } = ${rest}`;
                }
            }
            continue;
        }

        // Simple declaration: const foo = ... or let foo = ...
        const simpleMatch = line.match(/^(\s*)(const|let)\s+([a-zA-Z0-9_$]+)\s*(=|\()/);
        if (simpleMatch) {
            const [, indent, kind, varName] = simpleMatch;
            if (topDeclared.has(varName)) {
                const newName = `${varName}_dedup`;
                linesAfterDedup[i] = line.replace(new RegExp(`\\b${varName}\\b`), newName);
                for (let j = i + 1; j < linesAfterDedup.length; j++) {
                    linesAfterDedup[j] = linesAfterDedup[j].replace(new RegExp(`\\b${varName}\\b`, 'g'), newName);
                }
            } else {
                topDeclared.set(varName, i);
            }
        }
    }
    cleaned = linesAfterDedup.join("\n");

    // 5. Remove duplicate identical describe blocks
    const describeBlocks = [...cleaned.matchAll(/(?:describe\s*\(\s*(['"][^'"]+['"])\s*,\s*(?:\(\s*\)|function\s*\(\s*\))\s*=>\s*\{[\s\S]*?\n\}\s*\);?)/g)];
    const seenDescribeTitles = new Set();
    for (const d of describeBlocks) {
        const title = d[1];
        if (seenDescribeTitles.has(title)) {
            cleaned = cleaned.replace(d[0], "");
        } else {
            seenDescribeTitles.add(title);
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
            let cleaned = cleanAndDeduplicateTestContent(original);
            cleaned = healImportPathsInTestCode(cleaned, relFromRoot, rootDir);
            if (cleaned !== original) {
                fs.writeFileSync(tf, cleaned, "utf8");
            }
        } catch { }
    }
};
