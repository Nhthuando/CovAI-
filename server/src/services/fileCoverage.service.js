import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { cleanStorageText, cleanStoragePath } from "../utils/pathSanitizer.js";

/**
 * Normalizes file paths across Windows/Linux, stripping leading slashes and dot-slashes.
 */
export const normalizePath = (p = "") => {
    return p.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
};

/**
 * Strips host or container repo root prefixes to get clean relative repo path.
 */
export const cleanRelativePath = (rootDir, targetPath) => {
    if (!targetPath) return "";
    let norm = normalizePath(targetPath);
    if (rootDir) {
        const normRoot = normalizePath(rootDir);
        if (norm.startsWith(normRoot)) norm = norm.slice(normRoot.length);
    }
    norm = norm.replace(/^[a-zA-Z]:[\\/]/, "");
    norm = norm.replace(/^.*?\/storage\/projects\/[^/]+\/[^/]+\/[^/]+\/repo\//i, "");
    norm = norm.replace(/^.*?\/repo\//i, "");
    return norm.replace(/^\/+/, "");
};

/**
 * Checks if a candidate path from Istanbul coverage or stack traces matches the target file.
 */
export const matchesFilePath = (candidatePath = "", targetPath = "") => {
    const normCandidate = cleanRelativePath(null, candidatePath);
    const normTarget = cleanRelativePath(null, targetPath);
    if (!normCandidate || !normTarget) return false;
    return normCandidate === normTarget ||
        normCandidate.endsWith("/" + normTarget) ||
        normTarget.endsWith("/" + normCandidate);
};

/**
 * Parses test failure messages to extract exact assertion failure line numbers matching target file.
 * Quality rule: Never mark a line as failed merely because test run failed. Only mark when result JSON has an exact match.
 */
export const parseAssertionFailuresForFile = (testResultsObj, targetFilePath) => {
    const failedLines = {};
    if (!testResultsObj || !Array.isArray(testResultsObj.testResults)) {
        return failedLines;
    }

    // Regex to match stack trace frames: e.g. at ... (/path/to/file.js:42:15) or at file.js:42:15 or ❯ file.js:42:15
    const stackLineRegex = /(?:at\s+(?:.*?\()?)?([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+):(\d+)(?::\d+)?\)?/g;

    for (const suite of testResultsObj.testResults) {
        const assertions = suite.assertionResults || [];
        for (const assertion of assertions) {
            if (assertion.status === "failed") {
                const messages = assertion.failureMessages || [];
                for (const msg of messages) {
                    if (typeof msg !== "string") continue;
                    let match;
                    stackLineRegex.lastIndex = 0;
                    while ((match = stackLineRegex.exec(msg)) !== null) {
                        const matchedFilePath = match[1];
                        const lineNumber = parseInt(match[2], 10);
                        if (lineNumber > 0 && matchesFilePath(matchedFilePath, targetFilePath)) {
                            // First clean error message line
                            const firstLine = cleanStorageText(msg.split("\n")[0].trim() || "Assertion failed");
                            if (!failedLines[lineNumber]) {
                                failedLines[lineNumber] = {
                                    line: lineNumber,
                                    message: firstLine,
                                    fullStack: cleanStorageText(msg.slice(0, 500))
                                };
                            }
                        }
                    }
                }
            }
        }
    }

    return failedLines;
};

/**
 * Parses Istanbul coverage data for a specific file and calculates per-line statuses.
 */
export const extractLineCoverage = (fileCoverageData, assertionFailures = {}) => {
    const lineStatements = {};
    const lineBranches = {};

    // 1. Map statements to lines
    if (fileCoverageData.statementMap && fileCoverageData.s) {
        for (const [id, range] of Object.entries(fileCoverageData.statementMap)) {
            const hits = fileCoverageData.s[id] ?? 0;
            const startLine = range.start?.line || 1;
            const endLine = range.end?.line || startLine;
            for (let l = startLine; l <= endLine; l++) {
                if (!lineStatements[l]) lineStatements[l] = [];
                lineStatements[l].push(hits);
            }
        }
    }

    // 2. Map branches to lines
    if (fileCoverageData.branchMap && fileCoverageData.b) {
        for (const [id, branch] of Object.entries(fileCoverageData.branchMap)) {
            const counts = fileCoverageData.b[id] || [];
            if (Array.isArray(branch.locations) && branch.locations.length > 0) {
                branch.locations.forEach((loc, idx) => {
                    const hits = counts[idx] ?? 0;
                    const startLine = loc.start?.line || branch.line;
                    const endLine = loc.end?.line || startLine;
                    if (startLine) {
                        for (let l = startLine; l <= endLine; l++) {
                            if (!lineBranches[l]) lineBranches[l] = [];
                            lineBranches[l].push(hits);
                        }
                    }
                });
            } else if (branch.line) {
                const hits = counts[0] ?? 0;
                if (!lineBranches[branch.line]) lineBranches[branch.line] = [];
                lineBranches[branch.line].push(hits);
            }
        }
    }

    // 3. Assemble all relevant lines
    const allLines = new Set([
        ...Object.keys(lineStatements).map(Number),
        ...Object.keys(lineBranches).map(Number),
        ...Object.keys(assertionFailures).map(Number)
    ]);

    const lines = {};
    const coveredLines = [];
    const uncoveredLines = [];
    const failedLines = [];

    for (const lineNum of Array.from(allLines).sort((a, b) => a - b)) {
        // Priority 1: Assertion failure stack trace pointed to this line
        if (assertionFailures[lineNum]) {
            lines[lineNum] = {
                status: "failed",
                icon: "×",
                error: assertionFailures[lineNum].message,
                details: assertionFailures[lineNum].fullStack
            };
            failedLines.push(lineNum);
            continue;
        }

        const stmtHits = lineStatements[lineNum] || [];
        const branchHits = lineBranches[lineNum] || [];

        const hasZeroStmt = stmtHits.some(h => h === 0);
        const hasZeroBranch = branchHits.some(h => h === 0);

        if (hasZeroStmt || hasZeroBranch) {
            lines[lineNum] = {
                status: "uncovered",
                icon: "⚑",
                reason: hasZeroBranch && !hasZeroStmt ? "Uncovered branch" : "Uncovered statement",
                hits: stmtHits.length ? Math.max(...stmtHits) : 0
            };
            uncoveredLines.push(lineNum);
        } else if (stmtHits.length > 0 && stmtHits.every(h => h > 0)) {
            const maxHits = Math.max(...stmtHits);
            lines[lineNum] = {
                status: "covered",
                icon: "✓",
                hits: maxHits,
                reason: `Covered by tests (${maxHits} hits)`
            };
            coveredLines.push(lineNum);
        }
    }

    return {
        lines,
        coveredLines,
        uncoveredLines,
        failedLines
    };
};

/**
 * Extracts ordered statement flow with hit counts, status, and code snippets.
 */
export const extractStatementFlow = (fileCoverageData, sourceCode = "") => {
    if (!fileCoverageData || !fileCoverageData.statementMap) return [];
    const codeLines = sourceCode ? sourceCode.split("\n") : [];

    const sortedEntries = Object.entries(fileCoverageData.statementMap).sort((a, b) => {
        const startA = a[1]?.start || {};
        const startB = b[1]?.start || {};
        if ((startA.line || 0) !== (startB.line || 0)) {
            return (startA.line || 0) - (startB.line || 0);
        }
        return (startA.column || 0) - (startB.column || 0);
    });

    return sortedEntries.map(([id, range], index) => {
        const startLine = range.start?.line || 1;
        const endLine = range.end?.line || startLine;
        const startCol = range.start?.column || 0;
        const endCol = range.end?.column;
        const hits = fileCoverageData.s?.[id] ?? 0;
        const covered = hits > 0;

        let codeSnippet = "";
        if (codeLines.length >= startLine) {
            if (startLine === endLine && typeof endCol === "number" && endCol > startCol) {
                codeSnippet = codeLines[startLine - 1].slice(startCol, endCol).trim();
            } else {
                codeSnippet = codeLines[startLine - 1].slice(startCol).trim();
            }
        }
        if (!codeSnippet && codeLines[startLine - 1]) {
            codeSnippet = codeLines[startLine - 1].trim();
        }

        let type = "statement";
        if (/^\s*(if|switch)\b/.test(codeSnippet) || codeSnippet.includes(" ? ")) {
            type = "condition";
        } else if (/^\s*return\b/.test(codeSnippet)) {
            type = "return";
        } else if (/^\s*throw\b/.test(codeSnippet)) {
            type = "throw";
        } else if (/(?:const|let|var|function|export)\s+/.test(codeSnippet)) {
            type = "declaration";
        } else if (/^[a-zA-Z0-9_$]+\(/.test(codeSnippet)) {
            type = "call";
        }

        return {
            id,
            stepIndex: index + 1,
            startLine,
            endLine,
            startCol,
            endCol,
            hits,
            covered,
            type,
            codeSnippet: codeSnippet.slice(0, 150)
        };
    });
};

/**
 * Extracts branch decision points, conditions, paths (True/False or switch cases), and hit counts.
 */
export const extractBranchFlow = (fileCoverageData, sourceCode = "") => {
    if (!fileCoverageData || !fileCoverageData.branchMap) return [];
    const codeLines = sourceCode ? sourceCode.split("\n") : [];

    return Object.entries(fileCoverageData.branchMap).map(([id, branch]) => {
        const line = branch.line || branch.loc?.start?.line || 1;
        const type = branch.type || "if";
        const counts = fileCoverageData.b?.[id] || [];
        const totalHits = counts.reduce((sum, c) => sum + (c || 0), 0);
        const rawLine = (codeLines[line - 1] || "").trim();

        let condition = rawLine;
        if (type === "if") {
            const match = rawLine.match(/if\s*\((.*?)\)/);
            if (match && match[1]) condition = match[1];
        } else if (type === "cond-expr") {
            const match = rawLine.match(/(?:(?:const|let|var)\s+\w+\s*=\s*)?(.*?)\s*\?\s*(.*?)\s*:\s*(.*)/);
            if (match && match[1]) {
                condition = match[1].trim();
            } else {
                const qIdx = rawLine.indexOf("?");
                if (qIdx !== -1) condition = rawLine.slice(0, qIdx).trim();
            }
        } else if (type === "switch") {
            const match = rawLine.match(/switch\s*\((.*?)\)/);
            if (match && match[1]) condition = `switch (${match[1]})`;
        }

        const isFullyCovered = counts.length > 0 && counts.every(c => (c || 0) > 0);
        const isPartiallyCovered = !isFullyCovered && counts.some(c => (c || 0) > 0);
        const status = isFullyCovered ? "fully_covered" : (isPartiallyCovered ? "partially_covered" : "uncovered");

        let paths = [];
        if (type === "if" || type === "cond-expr") {
            const hit0 = counts[0] ?? 0;
            const hit1 = counts[1] ?? 0;
            const truePct = totalHits > 0 ? Math.round((hit0 / totalHits) * 100) : 0;
            const falsePct = totalHits > 0 ? Math.round((hit1 / totalHits) * 100) : 0;

            let trueSnippet = "";
            let falseSnippet = "";

            if (type === "cond-expr") {
                const ternaryMatch = rawLine.match(/\?\s*(.*?)\s*:\s*(.*)/);
                if (ternaryMatch) {
                    trueSnippet = ternaryMatch[1].trim();
                    falseSnippet = ternaryMatch[2].replace(/;$/, "").trim();
                } else {
                    trueSnippet = "Expression when condition is true (? ...)";
                    falseSnippet = "Expression when condition is false (: ...)";
                }
            } else {
                const loc0 = branch.locations?.[0];
                if (loc0?.start?.line && codeLines[loc0.start.line - 1]) {
                    const l = codeLines[loc0.start.line - 1];
                    trueSnippet = loc0.start.line === loc0.end?.line
                        ? l.slice(loc0.start.column || 0, loc0.end?.column).trim()
                        : l.slice(loc0.start.column || 0).trim();
                }
                if (!trueSnippet) {
                    trueSnippet = rawLine.replace(/if\s*\(.*?\)\s*/, "").trim() || "Execute if block";
                }

                const nextLine = (codeLines[line] || "").trim();
                if (rawLine.includes("else")) {
                    falseSnippet = rawLine.replace(/.*else\s*/, "").trim();
                } else if (nextLine) {
                    falseSnippet = nextLine;
                } else {
                    falseSnippet = "Bypass if / proceed to next statement";
                }
            }

            const isTernary = type === "cond-expr";
            paths = [
                {
                    index: 0,
                    type: "True",
                    label: isTernary ? "True branch (? when true)" : "True branch (Condition met)",
                    hits: hit0,
                    pct: truePct,
                    covered: hit0 > 0,
                    codeSnippet: trueSnippet.slice(0, 120),
                    startLine: branch.locations?.[0]?.start?.line || line
                },
                {
                    index: 1,
                    type: "False",
                    label: isTernary ? "False branch (: when false)" : "False branch (Condition not met / continue)",
                    hits: hit1,
                    pct: falsePct,
                    covered: hit1 > 0,
                    codeSnippet: falseSnippet.slice(0, 120),
                    startLine: branch.locations?.[1]?.start?.line || line + 1
                }
            ];
        } else if (type === "switch") {
            paths = (branch.locations || []).map((loc, idx) => {
                const hits = counts[idx] ?? 0;
                const locLine = loc.start?.line || line;
                const codeSnippet = (codeLines[locLine - 1] || "").trim();
                const isDefault = codeSnippet.includes("default");
                const caseMatch = codeSnippet.match(/case\s+([^:]+):/i);
                const caseLabel = isDefault
                    ? "Default branch"
                    : (caseMatch ? `Case ${caseMatch[1].trim()}` : `Case #${idx + 1}`);

                return {
                    index: idx,
                    type: isDefault ? "Default" : `Case ${idx + 1}`,
                    label: caseLabel,
                    hits,
                    pct: totalHits > 0 ? Math.round((hits / totalHits) * 100) : 0,
                    covered: hits > 0,
                    codeSnippet: codeSnippet.slice(0, 120),
                    startLine: locLine
                };
            });
        } else {
            paths = (branch.locations || []).map((loc, idx) => {
                const hits = counts[idx] ?? 0;
                const locLine = loc.start?.line || line;
                const codeSnippet = (codeLines[locLine - 1] || "").trim();
                return {
                    index: idx,
                    type: `Branch ${idx + 1}`,
                    label: `Branch #${idx + 1}`,
                    hits,
                    pct: totalHits > 0 ? Math.round((hits / totalHits) * 100) : 0,
                    covered: hits > 0,
                    codeSnippet: codeSnippet.slice(0, 120),
                    startLine: locLine
                };
            });
        }

        return {
            id,
            line,
            type,
            condition: condition.slice(0, 120),
            fullConditionText: rawLine.slice(0, 160),
            totalHits,
            status,
            paths
        };
    });
};

/**
 * Extracts function / method flow, resolving arrow function names to variable names.
 */
export const extractFunctionFlow = (fileCoverageData, sourceCode = "") => {
    if (!fileCoverageData || !fileCoverageData.fnMap) return [];
    const codeLines = sourceCode ? sourceCode.split("\n") : [];

    return Object.entries(fileCoverageData.fnMap).map(([id, fnMeta]) => {
        const line = fnMeta.line || fnMeta.loc?.start?.line || 1;
        const startLine = fnMeta.loc?.start?.line || fnMeta.decl?.start?.line || line;
        const endLine = fnMeta.loc?.end?.line || fnMeta.decl?.end?.line || line;
        const hits = fileCoverageData.f?.[id] ?? 0;
        const rawName = fnMeta.name || "";
        const lineText = (codeLines[line - 1] || "").trim();

        let realName = rawName;
        if (!rawName || rawName.startsWith("(") || rawName.startsWith("anonymous")) {
            const match = lineText.match(/(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/i) ||
                lineText.match(/([a-zA-Z0-9_$]+)\s*[:=]\s*(?:async\s*)?\(/i) ||
                lineText.match(/(?:function\s+)?([a-zA-Z0-9_$]+)\s*\(/i);
            if (match && match[1]) {
                realName = match[1];
            } else {
                realName = `anonymous_${id}`;
            }
        }

        return {
            id,
            name: rawName,
            realName,
            line,
            startLine,
            endLine,
            hits,
            covered: hits > 0,
            status: hits > 0 ? "covered" : "uncovered",
            codeSnippet: lineText.slice(0, 120)
        };
    });
};

/**
 * Searches the project root directory for an existing or suggested test file associated with a source file.
 */
export const findAssociatedTestFile = (rootDir, rawSourceFilePath, framework = null) => {
    if (!rootDir || !fs.existsSync(rootDir) || !rawSourceFilePath) {
        return { found: false, filePath: null, fileName: null, suggestedFilePath: null, testCode: "", framework: "jest" };
    }

    const normSource = cleanRelativePath(rootDir, rawSourceFilePath);
    const isAlreadyTestFile = /(^|\/)(tests?|__tests__|specs?)\//i.test(normSource) || /\.(test|spec|steps?)\.[a-z0-9]+$/i.test(normSource);
    if (isAlreadyTestFile) {
        const fullTest = path.join(rootDir, normSource);
        const exists = fs.existsSync(fullTest);
        const testCode = exists ? fs.readFileSync(fullTest, "utf8") : "";
        return {
            found: exists,
            filePath: normSource,
            fileName: path.basename(normSource),
            suggestedFilePath: normSource,
            testCode,
            framework: testCode.includes("vitest") ? "vitest" : (framework || "jest")
        };
    }

    const ext = path.extname(normSource) || ".js";
    const rawBaseName = path.basename(normSource, ext);
    const baseName = rawBaseName.replace(/\.(test|spec|steps?)$/i, "");
    const dirName = path.dirname(normSource);
    const parts = normSource.split("/").filter(Boolean);
    const isMultiPackage = ["packages", "apps", "services", "examples", "modules"].includes(parts[0]);
    const subprojectPrefix = isMultiPackage && parts.length > 2 ? parts.slice(0, 2).join("/") : "";

    // 1. Scan existing test files in project with smart import & naming scoring
    let bestImportMatch = null;
    let bestScore = -999;

    const scanDir = (dir, depth = 0) => {
        if (depth > 6) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (["node_modules", ".git", "coverage", "dist", "build", ".next", ".vite"].includes(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                scanDir(full, depth + 1);
            } else if (e.isFile() && /\.(test|spec|steps?)\.[a-z0-9]+$/i.test(e.name)) {
                try {
                    const rel = normalizePath(path.relative(rootDir, full));
                    let score = 0;

                    const content = fs.readFileSync(full, "utf8");

                    // If caller specifically requested vitest, skip files that lack vitest syntax
                    if (framework === "vitest" && !content.includes("vitest")) {
                        continue;
                    }

                    // Match subproject prefix only in monorepos / multi-package repositories
                    if (subprojectPrefix) {
                        if (rel.startsWith(subprojectPrefix)) score += 100;
                        else score -= 100;
                    }

                    // Match file extension (.ts with .ts vs .js with .js)
                    const testExt = path.extname(rel);
                    if ((ext === ".ts" || ext === ".tsx") && (testExt === ".ts" || testExt === ".tsx")) score += 30;
                    else if ((ext === ".js" || ext === ".jsx") && (testExt === ".js" || testExt === ".jsx")) score += 30;

                    // Direct import/require match - highest confidence!
                    const hasDirectImport = (
                        content.includes("/" + baseName + "'") ||
                        content.includes("/" + baseName + '"') ||
                        content.includes("./" + baseName) ||
                        content.includes("/" + baseName + ".") ||
                        content.includes("/" + baseName + "/") ||
                        content.includes("from '" + baseName) ||
                        content.includes('from "' + baseName)
                    );

                    if (hasDirectImport) {
                        score += 160;
                    } else if (content.includes(baseName)) {
                        score += 50;
                    }

                    // File name matching
                    const testBaseName = path.basename(rel, testExt).replace(/\.(test|spec|steps?)$/i, "");
                    if (testBaseName === baseName) {
                        score += 120;
                    } else if (testBaseName.startsWith(baseName) || testBaseName.endsWith(baseName) || testBaseName.includes(baseName)) {
                        score += 80;
                    }

                    // Directory similarity (e.g. clients/ or handlers/)
                    if (dirName && dirName !== "." && dirName !== "src") {
                        const cleanDirParts = dirName.replace(/^src\/?/, "").split("/").filter(Boolean);
                        for (const dp of cleanDirParts) {
                            if (rel.includes("/" + dp + "/") || rel.includes("/" + dp)) {
                                score += 40;
                                break;
                            }
                        }
                    }

                    // Penalize placeholder/stub files
                    if (content.length < 80 || content.includes("// No additional snippets needed")) {
                        score -= 60;
                    }

                    if (score > bestScore && score > 0) {
                        bestScore = score;
                        bestImportMatch = { full, rel, content };
                    }
                } catch { }
            }
        }
    };
    try { scanDir(rootDir); } catch { }

    if (bestImportMatch) {
        return {
            found: true,
            filePath: bestImportMatch.rel,
            fileName: path.basename(bestImportMatch.rel),
            suggestedFilePath: bestImportMatch.rel,
            testCode: bestImportMatch.content,
            framework: bestImportMatch.content.includes("vitest") ? "vitest" : (framework || "jest")
        };
    }

    // 2. Vitest-specific candidate paths
    if (framework === "vitest") {
        const vitestCandidates = [
            path.join("tests", `${baseName}.vitest.test${ext}`),
            path.join("tests", `${baseName}.vitest${ext}`),
            path.join("tests", `${baseName}.spec${ext}`),
            path.join("tests", `vitest.test${ext}`),
            path.join("tests", `vitest.spec${ext}`),
            path.join(dirName, `${baseName}.vitest.test${ext}`),
            path.join(dirName, `${baseName}.spec${ext}`),
            path.join(dirName, "__tests__", `${baseName}.vitest.test${ext}`),
        ];

        for (const candidate of vitestCandidates) {
            const fullPath = path.join(rootDir, candidate);
            if (fs.existsSync(fullPath)) {
                const content = fs.readFileSync(fullPath, "utf8");
                const rel = normalizePath(candidate);
                return {
                    found: true,
                    filePath: rel,
                    fileName: path.basename(rel),
                    suggestedFilePath: rel,
                    testCode: content,
                    framework: "vitest"
                };
            }
        }

        const genericTestPath = path.join("tests", `${baseName}.test${ext}`);
        if (fs.existsSync(path.join(rootDir, genericTestPath))) {
            const content = fs.readFileSync(path.join(rootDir, genericTestPath), "utf8");
            if (content.includes("vitest") || content.includes("from 'vitest'") || content.includes('from "vitest"')) {
                const rel = normalizePath(genericTestPath);
                return {
                    found: true,
                    filePath: rel,
                    fileName: path.basename(rel),
                    suggestedFilePath: rel,
                    testCode: content,
                    framework: "vitest"
                };
            }
        }

        const defaultVitestPath = fs.existsSync(path.join(rootDir, genericTestPath))
            ? normalizePath(path.join("tests", `${baseName}.vitest.test${ext}`))
            : normalizePath(path.join("tests", `${baseName}.test${ext}`));

        return {
            found: false,
            filePath: null,
            suggestedFilePath: defaultVitestPath,
            fileName: path.basename(defaultVitestPath),
            testCode: "",
            framework: "vitest"
        };
    }

    // 3. Conventional candidate paths (including specs, step-definitions, subpackages)
    const candidates = [
        path.join("tests", `${baseName}.test${ext}`),
        path.join("tests", `${baseName}.spec${ext}`),
        path.join("tests", dirName, `${baseName}.test${ext}`),
        path.join(dirName, `${baseName}.test${ext}`),
        path.join(dirName, `${baseName}.spec${ext}`),
        path.join(dirName, `${baseName}.steps${ext}`),
        path.join(dirName, "__tests__", `${baseName}.test${ext}`),
        path.join(dirName, "__tests__", `${baseName}.spec${ext}`),
        path.join("specs", `${baseName}.test${ext}`),
        path.join("specs", `${baseName}.steps${ext}`),
        path.join("specs", "step-definitions", `${baseName}.steps${ext}`)
    ];

    if (dirName.includes("src")) {
        candidates.push(
            path.join(dirName.replace("src", "specs"), "step-definitions", `${baseName}.steps${ext}`),
            path.join(dirName.replace("src", "specs"), `${baseName}.test${ext}`),
            path.join(dirName.replace("src", "tests"), `${baseName}.test${ext}`)
        );
    }

    for (const candidate of candidates) {
        const fullPath = path.join(rootDir, candidate);
        if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, "utf8");
            const rel = normalizePath(candidate);
            return {
                found: true,
                filePath: rel,
                fileName: path.basename(rel),
                suggestedFilePath: rel,
                testCode: content,
                framework: content.includes("vitest") ? "vitest" : "jest"
            };
        }
    }

    let defaultNewTestPath = normalizePath(path.join("tests", `${baseName}.test${ext}`));
    const hasTestsUnit = fs.existsSync(path.join(rootDir, "tests", "unit"));
    if (dirName.includes("src")) {
        const subRel = dirName.replace(/^src\/?/, "");
        defaultNewTestPath = hasTestsUnit
            ? normalizePath(`tests/unit/${subRel}/${baseName}.test${ext}`.replace(/\/+/g, "/"))
            : normalizePath(dirName.replace("src", "tests") + `/${baseName}.test${ext}`);
    } else if (hasTestsUnit) {
        defaultNewTestPath = normalizePath(`tests/unit/${baseName}.test${ext}`);
    }

    return {
        found: false,
        filePath: null,
        suggestedFilePath: defaultNewTestPath,
        fileName: path.basename(defaultNewTestPath),
        testCode: "",
        framework: "jest"
    };
};

/**
 * Locates coverage-final.json or test-results.json coverageMap for snapshot and returns file coverage.
 */
export const getFileCoverageDetails = async (snapshotId, targetFilePath, userId) => {
    if (!snapshotId || !targetFilePath) {
        throw new ServiceError("snapshotId and filePath are required", 400);
    }

    const snapshot = await prisma.projectSnapshot.findUnique({
        where: { id: snapshotId },
        include: {
            project: { select: { id: true, ownerId: true } },
            coverageFiles: {
                where: {
                    filePath: {
                        contains: path.basename(targetFilePath)
                    }
                }
            }
        }
    });

    if (!snapshot) {
        throw new ServiceError("Snapshot not found", 404);
    }
    if (snapshot.project.ownerId !== userId) {
        throw new ServiceError("Forbidden: Unauthorized project access", 403);
    }

    const resolveRootDir = (r) => {
        if (!r) return null;
        if (fs.existsSync(r)) return r;
        if (r.startsWith("/app/")) {
            const hostCandidate = path.resolve(process.cwd(), r.replace(/^\/app\//, ""));
            if (fs.existsSync(hostCandidate)) return hostCandidate;
        }
        return r;
    };

    const rootDir = resolveRootDir(snapshot.rootDir);
    if (!rootDir || !fs.existsSync(rootDir)) {
        return {
            filePath: targetFilePath,
            lines: {},
            summary: null,
            coveredLines: [],
            uncoveredLines: [],
            failedLines: [],
            statements: [],
            branches: [],
            functions: [],
            sourceCode: "",
            testFile: { found: false, filePath: null, fileName: null, suggestedFilePath: null, testCode: "", framework: "jest" }
        };
    }

    const cleanPath = cleanRelativePath(rootDir, targetFilePath);
    const testFile = findAssociatedTestFile(rootDir, cleanPath);

    const getDiskSourceCode = () => {
        const candidatePaths = [
            path.join(rootDir, cleanPath),
            path.join(rootDir, targetFilePath),
            targetFilePath,
            path.join(rootDir, "src", path.basename(cleanPath))
        ];
        for (const cp of candidatePaths) {
            if (cp && fs.existsSync(cp)) {
                try { return fs.readFileSync(cp, "utf8"); } catch {}
            }
        }
        return "";
    };

    const candidateCoveragePaths = [
        path.join(rootDir, "coverage", "coverage-final.json"),
        path.join(rootDir, "coverage-final.json")
    ];

    let coverageData = null;
    for (const p of candidateCoveragePaths) {
        if (fs.existsSync(p)) {
            try {
                coverageData = JSON.parse(fs.readFileSync(p, "utf8"));
                break;
            } catch (err) {
                console.warn(`[fileCoverage] Failed parsing ${p}:`, err.message);
            }
        }
    }

    // Check test-results.json
    const candidateResultPaths = [
        path.join(rootDir, "coverage", "test-results.json"),
        path.join(rootDir, "coverage", "test-result.json"),
        path.join(rootDir, "test-results.json"),
        path.join(rootDir, "test-result.json")
    ];

    let testResultsObj = null;
    for (const p of candidateResultPaths) {
        if (fs.existsSync(p)) {
            try {
                testResultsObj = JSON.parse(fs.readFileSync(p, "utf8"));
                if (!coverageData && testResultsObj.coverageMap) {
                    coverageData = testResultsObj.coverageMap;
                }
                break;
            } catch (err) {
                console.warn(`[fileCoverage] Failed parsing ${p}:`, err.message);
            }
        }
    }

    if (!coverageData) {
        return {
            filePath: targetFilePath,
            lines: {},
            summary: null,
            coveredLines: [],
            uncoveredLines: [],
            failedLines: [],
            statements: [],
            branches: [],
            functions: [],
            sourceCode: getDiskSourceCode(),
            testFile
        };
    }

    // Find the file key in coverageData
    let matchedFileCoverage = null;
    let matchedKey = null;

    for (const [key, val] of Object.entries(coverageData)) {
        if (matchesFilePath(key, targetFilePath)) {
            matchedFileCoverage = val;
            matchedKey = key;
            break;
        }
    }

    if (!matchedFileCoverage) {
        return {
            filePath: targetFilePath,
            lines: {},
            summary: null,
            coveredLines: [],
            uncoveredLines: [],
            failedLines: [],
            statements: [],
            branches: [],
            functions: [],
            sourceCode: getDiskSourceCode(),
            testFile
        };
    }

    // Parse assertion failures specifically pointing to this file
    const assertionFailures = parseAssertionFailuresForFile(testResultsObj, targetFilePath);

    // Extract line coverage
    const lineCoverage = extractLineCoverage(matchedFileCoverage, assertionFailures);

    // Summary calculation
    const calcPct = (covered, total) => total > 0 ? Number(((covered / total) * 100).toFixed(1)) : 100;
    const rawStmtsTotal = Object.keys(matchedFileCoverage.s || {}).length;
    const rawStmtsCovered = Object.values(matchedFileCoverage.s || {}).filter(c => c > 0).length;
    const rawFuncsTotal = Object.keys(matchedFileCoverage.f || {}).length;
    const rawFuncsCovered = Object.values(matchedFileCoverage.f || {}).filter(c => c > 0).length;

    let rawBranchesTotal = 0;
    let rawBranchesCovered = 0;
    for (const counts of Object.values(matchedFileCoverage.b || {})) {
        if (Array.isArray(counts)) {
            rawBranchesTotal += counts.length;
            rawBranchesCovered += counts.filter(c => c > 0).length;
        }
    }

    // Read official summary from coverage-summary.json or prisma.coverageFile
    let officialSummary = null;
    const summaryCandidatePaths = [
        path.join(rootDir, "coverage", "coverage-summary.json"),
        path.join(rootDir, "coverage", "jest-coverage-summary.json"),
        path.join(rootDir, "coverage", "vitest-coverage-summary.json"),
        path.join(rootDir, "coverage-summary.json")
    ];
    for (const sp of summaryCandidatePaths) {
        if (fs.existsSync(sp)) {
            try {
                const sObj = JSON.parse(fs.readFileSync(sp, "utf8"));
                for (const [k, v] of Object.entries(sObj)) {
                    if (k !== "total" && matchesFilePath(k, targetFilePath)) {
                        officialSummary = v;
                        break;
                    }
                }
                if (officialSummary) break;
            } catch (_) { }
        }
    }

    let dbCoverageFile = null;
    try {
        dbCoverageFile = await prisma.coverageFile.findFirst({
            where: {
                snapshotId: snapshot.id,
                OR: [
                    { filePath: { endsWith: targetFilePath } },
                    { filePath: { contains: targetFilePath } }
                ]
            }
        });
    } catch (_) { }

    const branchesTotal = officialSummary?.branches?.total ?? rawBranchesTotal;
    const branchesCovered = officialSummary?.branches?.covered ?? rawBranchesCovered;
    const branchesPct = officialSummary?.branches?.pct ?? (dbCoverageFile?.branchesPct ?? calcPct(branchesCovered, branchesTotal));

    const stmtsTotal = officialSummary?.statements?.total ?? rawStmtsTotal;
    const stmtsCovered = officialSummary?.statements?.covered ?? rawStmtsCovered;
    const stmtsPct = officialSummary?.statements?.pct ?? (dbCoverageFile?.stmtsPct ?? calcPct(stmtsCovered, stmtsTotal));

    const linesTotal = officialSummary?.lines?.total ?? (lineCoverage.coveredLines.length + lineCoverage.uncoveredLines.length);
    const linesCovered = officialSummary?.lines?.covered ?? lineCoverage.coveredLines.length;
    const linesPct = officialSummary?.lines?.pct ?? (dbCoverageFile?.linesPct ?? calcPct(linesCovered, linesTotal));

    const funcsTotal = officialSummary?.functions?.total ?? rawFuncsTotal;
    const funcsCovered = officialSummary?.functions?.covered ?? rawFuncsCovered;
    const funcsPct = officialSummary?.functions?.pct ?? (dbCoverageFile?.funcsPct ?? calcPct(funcsCovered, funcsTotal));

    // If branches are not 100% covered, make sure branch lines are registered in uncoveredLines
    if (branchesPct < 100 && matchedFileCoverage.branchMap) {
        for (const [id, branch] of Object.entries(matchedFileCoverage.branchMap)) {
            const bLine = branch.line || branch.loc?.start?.line;
            if (bLine && !lineCoverage.uncoveredLines.includes(bLine)) {
                lineCoverage.uncoveredLines.push(bLine);
                lineCoverage.lines[bLine] = {
                    status: "uncovered",
                    icon: "⚑",
                    reason: `Uncovered branch (${branchesCovered}/${branchesTotal} branches covered, ${branchesPct}%)`,
                    hits: 0
                };
            }
        }
    }

    const summary = {
        linesPct,
        branchesPct,
        funcsPct,
        stmtsPct,
        linesTotal,
        linesCovered,
        branchesTotal,
        branchesCovered,
        funcsTotal,
        funcsCovered,
        stmtsTotal,
        stmtsCovered
    };

    // Locate physical file on disk to extract source code for flow diagrams
    let sourceCode = getDiskSourceCode();
    if (!sourceCode) {
        const candidateSourcePaths = [
            matchedKey,
            path.join(rootDir, cleanPath),
            path.join(rootDir, targetFilePath),
            targetFilePath,
            path.join(rootDir, "src", path.basename(cleanPath))
        ];
        for (const cp of candidateSourcePaths) {
            if (cp && fs.existsSync(cp)) {
                try {
                    sourceCode = fs.readFileSync(cp, "utf8");
                    break;
                } catch { }
            }
        }
    }
    if (!sourceCode && rootDir && fs.existsSync(rootDir)) {
        try {
            const targetBase = path.basename(targetFilePath);
            const searchFile = (dir, depth = 0) => {
                if (depth > 6) return null;
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "dist") {
                            const found = searchFile(full, depth + 1);
                            if (found) return found;
                        }
                    } else if (entry.isFile() && entry.name === targetBase) {
                        return full;
                    }
                }
                return null;
            };
            const foundPath = searchFile(rootDir);
            if (foundPath) {
                sourceCode = fs.readFileSync(foundPath, "utf8");
            }
        } catch { }
    }

    const statements = extractStatementFlow(matchedFileCoverage, sourceCode);
    const branches = extractBranchFlow(matchedFileCoverage, sourceCode);
    const functions = extractFunctionFlow(matchedFileCoverage, sourceCode);

    return {
        filePath: targetFilePath,
        resolvedKey: matchedKey,
        summary,
        statements,
        branches,
        functions,
        sourceCode,
        testFile,
        ...lineCoverage
    };
};

