import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

/**
 * Normalizes file paths across Windows/Linux, stripping leading slashes and dot-slashes.
 */
export const normalizePath = (p = "") => {
    return p.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
};

/**
 * Checks if a candidate path from Istanbul coverage or stack traces matches the target file.
 */
export const matchesFilePath = (candidatePath = "", targetPath = "") => {
    const normCandidate = normalizePath(candidatePath);
    const normTarget = normalizePath(targetPath);
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
                            const firstLine = msg.split("\n")[0].trim() || "Assertion failed";
                            if (!failedLines[lineNumber]) {
                                failedLines[lineNumber] = {
                                    line: lineNumber,
                                    message: firstLine,
                                    fullStack: msg.slice(0, 500)
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
                    trueSnippet = "Biểu thức khi điều kiện đúng (? ...)";
                    falseSnippet = "Biểu thức khi điều kiện sai (: ...)";
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
                    trueSnippet = rawLine.replace(/if\s*\(.*?\)\s*/, "").trim() || "Thực thi khối if";
                }

                const nextLine = (codeLines[line] || "").trim();
                if (rawLine.includes("else")) {
                    falseSnippet = rawLine.replace(/.*else\s*/, "").trim();
                } else if (nextLine) {
                    falseSnippet = nextLine;
                } else {
                    falseSnippet = "Bỏ qua if / Đi tiếp câu lệnh sau";
                }
            }

            const isTernary = type === "cond-expr";
            paths = [
                {
                    index: 0,
                    type: "True",
                    label: isTernary ? "Nhánh True (? khi đúng)" : "Nhánh True (Thoả điều kiện if)",
                    hits: hit0,
                    pct: truePct,
                    covered: hit0 > 0,
                    codeSnippet: trueSnippet.slice(0, 120),
                    startLine: branch.locations?.[0]?.start?.line || line
                },
                {
                    index: 1,
                    type: "False",
                    label: isTernary ? "Nhánh False (: khi sai)" : "Nhánh False (Không thoả điều kiện / Đi tiếp)",
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
                    ? "Nhánh Default"
                    : (caseMatch ? `Case ${caseMatch[1].trim()}` : `Trường hợp #${idx + 1}`);

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
                    label: `Rẽ nhánh #${idx + 1}`,
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

    const rootDir = snapshot.rootDir;
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
            sourceCode: ""
        };
    }

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
            sourceCode: ""
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
            sourceCode: ""
        };
    }

    // Parse assertion failures specifically pointing to this file
    const assertionFailures = parseAssertionFailuresForFile(testResultsObj, targetFilePath);

    // Extract line coverage
    const lineCoverage = extractLineCoverage(matchedFileCoverage, assertionFailures);

    // Summary calculation
    const calcPct = (covered, total) => total > 0 ? Number(((covered / total) * 100).toFixed(1)) : 100;
    const stmtsTotal = Object.keys(matchedFileCoverage.s || {}).length;
    const stmtsCovered = Object.values(matchedFileCoverage.s || {}).filter(c => c > 0).length;
    const funcsTotal = Object.keys(matchedFileCoverage.f || {}).length;
    const funcsCovered = Object.values(matchedFileCoverage.f || {}).filter(c => c > 0).length;

    let branchesTotal = 0;
    let branchesCovered = 0;
    for (const counts of Object.values(matchedFileCoverage.b || {})) {
        if (Array.isArray(counts)) {
            branchesTotal += counts.length;
            branchesCovered += counts.filter(c => c > 0).length;
        }
    }

    const linesTotal = lineCoverage.coveredLines.length + lineCoverage.uncoveredLines.length;
    const linesCovered = lineCoverage.coveredLines.length;

    const summary = {
        linesPct: calcPct(linesCovered, linesTotal),
        branchesPct: calcPct(branchesCovered, branchesTotal),
        funcsPct: calcPct(funcsCovered, funcsTotal),
        stmtsPct: calcPct(stmtsCovered, stmtsTotal),
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
    let sourceCode = "";
    const candidateSourcePaths = [
        matchedKey,
        path.join(rootDir, targetFilePath),
        path.join(rootDir, normalizePath(targetFilePath)),
        path.join(rootDir, "src", path.basename(targetFilePath))
    ];
    for (const cp of candidateSourcePaths) {
        if (cp && fs.existsSync(cp)) {
            try {
                sourceCode = fs.readFileSync(cp, "utf8");
                break;
            } catch { }
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
        ...lineCoverage
    };
};

