import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { cleanStorageText, cleanStoragePath } from "../utils/pathSanitizer.js";
import { analyzeSourceAst, mapCoverageGaps } from "./businessLogicAstAnalyzer.service.js";
import { findTestsImportingSource, countTestCases } from "./testDependencyResolver.service.js";

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
        if (norm.startsWith(normRoot)) return norm.slice(normRoot.length).replace(/^\/+/, "");
        const rootStorageIdx = normRoot.indexOf("storage/projects/");
        const targetStorageIdx = norm.indexOf("storage/projects/");
        if (rootStorageIdx !== -1 && targetStorageIdx !== -1) {
            const rootSub = normRoot.slice(rootStorageIdx);
            const targetSub = norm.slice(targetStorageIdx);
            if (targetSub.startsWith(rootSub)) {
                return targetSub.slice(rootSub.length).replace(/^\/+/, "");
            }
        }
        const testMatch = norm.match(/(?:tests?|__tests__|src)\/[^:\s\r\n]+\.(?:test|spec)\.[cm]?[jt]sx?/);
        if (testMatch) {
            return testMatch[0];
        }
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
        } else if (/^\s*(for|while|do)\b/.test(codeSnippet)) {
            type = "loop";
        } else if (/^\s*(try|catch|finally)\b/.test(codeSnippet)) {
            type = "exception";
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
 * Extracts branch decision points, conditions, paths (True/False, binary/logical, switch cases), and hit counts.
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
        } else if (type === "binary-expr" || type === "logical-expr") {
            const hit0 = counts[0] ?? 0;
            const hit1 = counts[1] ?? 0;
            const p0Pct = totalHits > 0 ? Math.round((hit0 / totalHits) * 100) : 0;
            const p1Pct = totalHits > 0 ? Math.round((hit1 / totalHits) * 100) : 0;

            const isNullish = rawLine.includes("??");
            const isOr = rawLine.includes("||");
            const isAnd = rawLine.includes("&&");

            let label0 = "Left operand path";
            let label1 = "Right operand path";
            let type0 = "Left";
            let type1 = "Right";

            if (isNullish) {
                type0 = "Defined";
                label0 = "Left operand defined / non-nullish";
                type1 = "Fallback (??)";
                label1 = "Left operand null/undefined (fallback to right)";
            } else if (isOr) {
                type0 = "Truthy";
                label0 = "Left operand truthy (short-circuit ||)";
                type1 = "Falsy";
                label1 = "Left operand falsy (evaluate ||)";
            } else if (isAnd) {
                type0 = "Falsy";
                label0 = "Left operand falsy (short-circuit &&)";
                type1 = "Truthy";
                label1 = "Left operand truthy (evaluate &&)";
            }

            paths = [
                {
                    index: 0,
                    type: type0,
                    label: label0,
                    hits: hit0,
                    pct: p0Pct,
                    covered: hit0 > 0,
                    codeSnippet: rawLine.slice(0, 120),
                    startLine: branch.locations?.[0]?.start?.line || line
                },
                {
                    index: 1,
                    type: type1,
                    label: label1,
                    hits: hit1,
                    pct: p1Pct,
                    covered: hit1 > 0,
                    codeSnippet: rawLine.slice(0, 120),
                    startLine: branch.locations?.[1]?.start?.line || line
                }
            ];
        } else if (type === "default-arg") {
            const hit0 = counts[0] ?? 0;
            const hit1 = counts[1] ?? 0;
            paths = [
                {
                    index: 0,
                    type: "Supplied",
                    label: "Argument supplied (overrides default)",
                    hits: hit0,
                    pct: totalHits > 0 ? Math.round((hit0 / totalHits) * 100) : 0,
                    covered: hit0 > 0,
                    codeSnippet: rawLine.slice(0, 120),
                    startLine: branch.locations?.[0]?.start?.line || line
                },
                {
                    index: 1,
                    type: "Default",
                    label: "Argument undefined (uses default parameter)",
                    hits: hit1,
                    pct: totalHits > 0 ? Math.round((hit1 / totalHits) * 100) : 0,
                    covered: hit1 > 0,
                    codeSnippet: rawLine.slice(0, 120),
                    startLine: branch.locations?.[1]?.start?.line || line
                }
            ];
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

        const missedTrue = counts[0] === 0;
        const missedFalse = counts.length > 1 && counts[1] === 0;
        const uncoveredPathsCount = counts.filter(c => (c || 0) === 0).length;

        return {
            id,
            line,
            type,
            condition: condition.slice(0, 120),
            fullConditionText: rawLine.slice(0, 160),
            totalHits,
            status,
            missedTrue,
            missedFalse,
            uncoveredPathsCount,
            totalPathsCount: counts.length,
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
 * Calculates quantitative priority score for a linked test file according to Section 2.4:
 * Score(tj, bi) = S_relation + S_name + S_count + S_location
 *
 * @param {Object} item - Linked test candidate
 * @param {string} baseName - Source base name (without extension)
 * @param {string} dirName - Source directory relative to root
 * @returns {number} Score
 */
export const calculateTraceabilityScore = (item, baseName = "", dirName = "") => {
    let score = 0;

    // 1. S_relation (Điểm loại liên kết)
    switch (item.relationType) {
        case "DIRECT_IMPORT":
            score += 1000;
            break;
        case "EXECUTION_TRACE":
            score += 800;
            break;
        case "TRANSITIVE":
        case "TRANSITIVE_DEPENDENCY":
            score += 600;
            break;
        case "NAME_CONVENTION":
            score += 100;
            break;
        default:
            score += 0;
            break;
    }

    // 2. S_name (Điểm tương đồng tên gọi)
    if (baseName && item.fileName) {
        const lowerBase = baseName.toLowerCase();
        const lowerFile = item.fileName.toLowerCase();
        if (lowerFile.includes(lowerBase)) {
            score += 500;
        }
    }

    // 3. S_count (Điểm số lượng test case)
    score += (Number(item.testCount) || 0) * 10;

    // 4. S_location (Điểm vị trí thư mục)
    if (dirName && dirName !== "." && dirName !== "src" && item.filePath) {
        const cleanDirParts = dirName.replace(/^(?:.*?\/)?src\/?/, "").split("/").filter(Boolean);
        const normFilePath = normalizePath(item.filePath);
        const matchesLocation = cleanDirParts.some(dp =>
            normFilePath.includes("/" + dp + "/") || normFilePath.includes("/" + dp + ".")
        );
        if (matchesLocation) {
            score += 200;
        }
    }

    return score;
};

/**
 * Discovers all test files associated with a source file, combining:
 * 1. Static AST dependency resolution (DIRECT_IMPORT) - test files that import/require this source
 * 2. Smart naming & directory structure matching (NAME_CONVENTION)
 * 3. Conventional candidate test paths
 *
 * @param {string} rootDir
 * @param {string} rawSourceFilePath
 * @param {string} [framework=null]
 * @returns {{ primaryTestFile: Object, linkedTestFiles: Array<Object>, suggestedNewTestPath: string, hasExecutingTests: boolean }}
 */
export const findAllAssociatedTestFiles = (rootDir, rawSourceFilePath, framework = null) => {
    if (!rootDir || !fs.existsSync(rootDir) || !rawSourceFilePath) {
        const empty = { found: false, filePath: null, fileName: null, suggestedFilePath: null, testCode: "", framework: "jest", relationType: "NONE" };
        return { primaryTestFile: empty, linkedTestFiles: [], suggestedNewTestPath: null, hasExecutingTests: false };
    }

    const normSource = cleanRelativePath(rootDir, rawSourceFilePath);
    const isAlreadyTestFile = /(^|\/)(tests?|__tests__|specs?)\//i.test(normSource) || /\.(test|spec|steps?)\.[a-z0-9]+$/i.test(normSource);
    if (isAlreadyTestFile) {
        const fullTest = path.join(rootDir, normSource);
        const exists = fs.existsSync(fullTest);
        const testCode = exists ? fs.readFileSync(fullTest, "utf8") : "";
        const primary = {
            found: exists,
            filePath: normSource,
            fileName: path.basename(normSource),
            suggestedFilePath: normSource,
            testCode,
            framework: testCode.includes("vitest") ? "vitest" : (framework || "jest"),
            relationType: "SELF",
            isPrimary: true
        };
        return {
            primaryTestFile: primary,
            linkedTestFiles: exists ? [primary] : [],
            suggestedNewTestPath: normSource,
            hasExecutingTests: exists
        };
    }

    const ext = path.extname(normSource) || ".js";
    const rawBaseName = path.basename(normSource, ext);
    const baseName = rawBaseName.replace(/\.(test|spec|steps?)$/i, "");
    const dirName = path.dirname(normSource);
    const parts = normSource.split("/").filter(Boolean);
    const isMultiPackage = ["packages", "apps", "services", "examples", "modules"].includes(parts[0]);
    const subprojectPrefix = isMultiPackage && parts.length > 2 ? parts.slice(0, 2).join("/") : "";

    // Calculate default new test path
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

    const linkedMap = new Map();

    // 1. TẦNG 1: STATIC AST DEPENDENCY RESOLUTION (DIRECT_IMPORT)
    // Find all test files in the project that actually import or require this source file
    try {
        const astImports = findTestsImportingSource(rootDir, normSource);
        for (const match of astImports) {
            linkedMap.set(match.filePath, {
                found: true,
                filePath: match.filePath,
                fileName: match.fileName,
                suggestedFilePath: match.filePath,
                relationType: "DIRECT_IMPORT",
                confidence: 1.0,
                testCode: match.testCode,
                testCount: match.testCount,
                framework: match.framework || (framework || "jest"),
                isPrimary: false
            });
        }
    } catch (_) { }

    // 2. TẦNG 2: SCAN EXISTING TEST FILES (NAMING & TEXT HEURISTICS)
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

                    if (framework === "vitest" && !content.includes("vitest")) {
                        continue;
                    }

                    if (subprojectPrefix) {
                        if (rel.startsWith(subprojectPrefix)) score += 10;
                        else score -= 500;
                    }

                    const testExt = path.extname(rel);
                    if ((ext === ".ts" || ext === ".tsx") && (testExt === ".ts" || testExt === ".tsx")) score += 10;
                    else if ((ext === ".js" || ext === ".jsx") && (testExt === ".js" || testExt === ".jsx")) score += 10;

                    const isGenericName = ["index", "app", "main", "config", "server", "default", "constants"].includes(baseName.toLowerCase());
                    const testBaseName = path.basename(rel, testExt).replace(/\.(test|spec|steps?)$/i, "");
                    const cleanDirParts = (dirName && dirName !== "." && dirName !== "src")
                        ? dirName.replace(/^(?:.*?\/)?src\/?/, "").split("/").filter(Boolean)
                        : [];

                    let dirMatched = false;
                    for (const dp of cleanDirParts) {
                        if (rel.includes("/" + dp + "/") || rel.includes("/" + dp + ".")) {
                            score += 60;
                            dirMatched = true;
                            break;
                        }
                    }

                    if (isGenericName && !dirMatched) {
                        score -= 300;
                    }

                    // Direct import/require match - checks actual import/require statements
                    const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const hasDirectImport = new RegExp(`(?:import|require|jest\\.mock|unstable_mockModule)\\s*\\(?\\s*['"][^'"]*\\b${escapedBase}(?:\\.[a-z0-9]+)?['"]`).test(content);

                    const isNameMatch = (testBaseName === baseName) ||
                        testBaseName.startsWith(baseName) ||
                        testBaseName.endsWith(baseName) ||
                        testBaseName.includes(baseName);

                    if (!hasDirectImport && !isNameMatch) {
                        continue;
                    }

                    if (hasDirectImport && (!isGenericName || dirMatched)) {
                        score += 180;
                    } else if (content.includes(baseName) && (testBaseName === baseName || dirMatched)) {
                        score += 40;
                    }

                    if (testBaseName === baseName) {
                        score += (isGenericName && !dirMatched) ? 10 : 160;
                    } else if (isNameMatch) {
                        score += (isGenericName && !dirMatched) ? 5 : 60;
                    }

                    if (content.length < 80 || content.includes("// No additional snippets needed")) {
                        score -= 60;
                    }

                    if (score >= 120 && !linkedMap.has(rel)) {
                        linkedMap.set(rel, {
                            found: true,
                            filePath: rel,
                            fileName: path.basename(rel),
                            suggestedFilePath: rel,
                            relationType: hasDirectImport ? "DIRECT_IMPORT" : "NAME_CONVENTION",
                            confidence: hasDirectImport ? 0.95 : 0.8,
                            testCode: content,
                            testCount: countTestCases(content),
                            framework: content.includes("vitest") ? "vitest" : (framework || "jest"),
                            isPrimary: false
                        });
                    }

                    if (score > bestScore && score >= 120) {
                        bestScore = score;
                        bestImportMatch = { full, rel, content };
                    }
                } catch { }
            }
        }
    };
    try { scanDir(rootDir); } catch { }

    // 3. TẦNG 3: CANDIDATE PATH CHECK (VITEST & CONVENTIONAL)
    if (linkedMap.size === 0) {
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
                path.join("tests", `${baseName}.test${ext}`)
            ];
            for (const cand of vitestCandidates) {
                const fullP = path.join(rootDir, cand);
                if (fs.existsSync(fullP)) {
                    const content = fs.readFileSync(fullP, "utf8");
                    const rel = normalizePath(cand);
                    linkedMap.set(rel, {
                        found: true,
                        filePath: rel,
                        fileName: path.basename(rel),
                        suggestedFilePath: rel,
                        relationType: "NAME_CONVENTION",
                        confidence: 0.85,
                        testCode: content,
                        testCount: countTestCases(content),
                        framework: "vitest",
                        isPrimary: false
                    });
                    break;
                }
            }
        } else {
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
            for (const cand of candidates) {
                const fullP = path.join(rootDir, cand);
                if (fs.existsSync(fullP)) {
                    const content = fs.readFileSync(fullP, "utf8");
                    const rel = normalizePath(cand);
                    linkedMap.set(rel, {
                        found: true,
                        filePath: rel,
                        fileName: path.basename(rel),
                        suggestedFilePath: rel,
                        relationType: "NAME_CONVENTION",
                        confidence: 0.85,
                        testCode: content,
                        testCount: countTestCases(content),
                        framework: content.includes("vitest") ? "vitest" : "jest",
                        isPrimary: false
                    });
                    break;
                }
            }
        }
    }

    const linkedList = Array.from(linkedMap.values());
    if (linkedList.length > 0) {
        for (const item of linkedList) {
            item.score = calculateTraceabilityScore(item, baseName, dirName);
        }

        linkedList.sort((a, b) => (b.score || 0) - (a.score || 0));

        linkedList[0].isPrimary = true;
        return {
            primaryTestFile: linkedList[0],
            linkedTestFiles: linkedList,
            suggestedNewTestPath: defaultNewTestPath,
            hasExecutingTests: true
        };
    }

    const fallback = {
        found: false,
        filePath: null,
        fileName: path.basename(defaultNewTestPath),
        suggestedFilePath: defaultNewTestPath,
        relationType: "NONE",
        score: 0,
        testCode: "",
        testCount: 0,
        framework: framework === "vitest" ? "vitest" : "jest",
        isPrimary: true
    };

    return {
        primaryTestFile: fallback,
        linkedTestFiles: [],
        suggestedNewTestPath: defaultNewTestPath,
        hasExecutingTests: false
    };
};

/**
 * Backward-compatible helper returning the primary associated test file.
 */
export const findAssociatedTestFile = (rootDir, rawSourceFilePath, framework = null) => {
    const result = findAllAssociatedTestFiles(rootDir, rawSourceFilePath, framework);
    return result.primaryTestFile;
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
            testFile: { found: false, filePath: null, fileName: null, suggestedFilePath: null, testCode: "", framework: "jest", relationType: "NONE" },
            linkedTestFiles: [],
            testTraceability: { hasExecutingTests: false, totalLinkedTests: 0, primaryRelation: "NONE", suggestedNewTestPath: null }
        };
    }

    const cleanPath = cleanRelativePath(rootDir, targetFilePath);
    const associatedInfo = findAllAssociatedTestFiles(rootDir, cleanPath);
    const testFile = associatedInfo.primaryTestFile;
    const linkedTestFiles = associatedInfo.linkedTestFiles;

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
            testFile,
            linkedTestFiles,
            testTraceability: {
                hasExecutingTests: associatedInfo.hasExecutingTests,
                totalLinkedTests: linkedTestFiles.length,
                primaryRelation: testFile?.relationType || "NONE",
                suggestedNewTestPath: associatedInfo.suggestedNewTestPath
            }
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
            testFile,
            linkedTestFiles,
            testTraceability: {
                hasExecutingTests: associatedInfo.hasExecutingTests,
                totalLinkedTests: linkedTestFiles.length,
                primaryRelation: testFile?.relationType || "NONE",
                suggestedNewTestPath: associatedInfo.suggestedNewTestPath
            }
        };
    }

    // Parse assertion failures specifically pointing to this file
    const assertionFailures = parseAssertionFailuresForFile(testResultsObj, targetFilePath);

    // Extract line coverage
    const lineCoverage = extractLineCoverage(matchedFileCoverage, assertionFailures);

    // Summary calculation
    const calcPct = (covered, total) => total > 0 ? Number(((covered / total) * 100).toFixed(1)) : (covered === 0 ? 0 : 100);
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

    const stmtsTotal = officialSummary?.statements?.total ?? rawStmtsTotal;
    const stmtsCovered = officialSummary?.statements?.covered ?? rawStmtsCovered;
    const stmtsPct = officialSummary?.statements?.pct ?? (dbCoverageFile?.stmtsPct ?? calcPct(stmtsCovered, stmtsTotal));

    const linesTotal = officialSummary?.lines?.total ?? (lineCoverage.coveredLines.length + lineCoverage.uncoveredLines.length);
    const linesCovered = officialSummary?.lines?.covered ?? lineCoverage.coveredLines.length;
    const linesPct = officialSummary?.lines?.pct ?? (dbCoverageFile?.linesPct ?? calcPct(linesCovered, linesTotal));

    const branchesTotal = officialSummary?.branches?.total ?? rawBranchesTotal;
    const branchesCovered = officialSummary?.branches?.covered ?? rawBranchesCovered;
    let branchesPct = officialSummary?.branches?.pct ?? (dbCoverageFile?.branchesPct ?? calcPct(branchesCovered, branchesTotal));
    if ((branchesTotal === 0 || branchesCovered === 0) && (stmtsCovered === 0 || linesCovered === 0)) {
        branchesPct = 0;
    }

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

    let astMetadata = null;
    let coverageGapAnalysis = null;
    if (sourceCode) {
        try {
            astMetadata = analyzeSourceAst(sourceCode);
            coverageGapAnalysis = mapCoverageGaps({
                astMetadata,
                fileCoverageData: matchedFileCoverage,
                sourceCode,
                uncoveredLinesList: lineCoverage.uncoveredLines
            });
        } catch (_) { }
    }

    const uncoveredBranches = branches.filter(b => b.status !== "fully_covered");
    const uncoveredStatements = statements.filter(s => !s.covered);
    const uncoveredFunctionsList = functions.filter(f => !f.covered);

    const decisionPoints = (astMetadata?.decisionPoints || []).map(dp => {
        const isLineUncovered = lineCoverage.uncoveredLines.includes(dp.line);
        const matchedBranch = uncoveredBranches.find(ub => Math.abs(ub.line - dp.line) <= 1);
        return {
            ...dp,
            isCovered: !isLineUncovered && (!matchedBranch || matchedBranch.status === "fully_covered"),
            missedTrue: matchedBranch?.missedTrue ?? false,
            missedFalse: matchedBranch?.missedFalse ?? false
        };
    });

    return {
        filePath: targetFilePath,
        resolvedKey: matchedKey,
        summary,
        statements,
        branches,
        functions,
        uncoveredBranches,
        uncoveredStatements,
        uncoveredFunctionsList,
        decisionPoints,
        sourceCode,
        testFile,
        linkedTestFiles,
        testTraceability: {
            hasExecutingTests: associatedInfo.hasExecutingTests || (officialSummary?.statements?.covered > 0 || rawStmtsCovered > 0),
            totalLinkedTests: linkedTestFiles.length,
            primaryRelation: testFile?.relationType || "NONE",
            primaryScore: testFile?.score || 0,
            suggestedNewTestPath: associatedInfo.suggestedNewTestPath
        },
        rawCoverageData: matchedFileCoverage,
        astMetadata,
        coverageGapAnalysis,
        ...lineCoverage
    };
};

