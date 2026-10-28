import fs from "fs";
import path from "path";
import { ServiceError } from "../utils/serviceError.js";

/**
 * Unified Code Coverage & Execution Line Tracing Engine (CovAI)
 * 
 * Provides unified line-by-line coverage parsing, execution tracing,
 * and reverse mapping across all 3 testing paradigms:
 * 1. Unit Testing (Jest / Vitest)
 * 2. Integration Testing (Supertest / Playwright API)
 * 3. System Testing (Playwright / Cypress E2E)
 */

/**
 * Normalizes file paths to forward slashes and strips extraneous host/repo prefixes.
 *
 * @param {string} p - File path to normalize
 * @param {string} [rootDir] - Optional root directory to make path relative to
 * @returns {string} Clean relative path
 */
export const normalizeFilePath = (p = "", rootDir = null) => {
    if (!p || typeof p !== "string") return "";
    let clean = p.replace(/\\/g, "/").trim();

    if (rootDir) {
        const normRoot = rootDir.replace(/\\/g, "/").replace(/\/+$/, "");
        if (clean.startsWith(normRoot)) {
            clean = clean.slice(normRoot.length);
        } else {
            const strippedRoot = normRoot.replace(/^[a-zA-Z]:\/?/, "").replace(/^\/+/, "");
            const strippedClean = clean.replace(/^[a-zA-Z]:\/?/, "").replace(/^\/+/, "");
            if (strippedClean.startsWith(strippedRoot)) {
                clean = strippedClean.slice(strippedRoot.length);
            }
        }
    }

    // Strip common storage / container path prefixes
    clean = clean.replace(/^.*?\/storage\/projects\/[^/]+\/[^/]+\/[^/]+\/repo\//i, "");
    clean = clean.replace(/^.*?\/repo\//i, "");
    clean = clean.replace(/^[a-zA-Z]:[\\/]/, "");
    clean = clean.replace(/^\/+/, "");

    return clean;
};

/**
 * Calculates percentage safely avoiding division by zero.
 */
const safePct = (covered, total) => {
    if (!total || total === 0) return 100;
    return Number(((covered / total) * 100).toFixed(2));
};

/**
 * Normalizes raw Istanbul file coverage object into standard CovAI file representation.
 *
 * @param {string} filePath - File path (relative or absolute)
 * @param {Object} rawData - Istanbul file coverage object (containing statementMap, s, branchMap, b, fnMap, f)
 * @param {string} [rootDir] - Optional root directory
 * @returns {Object} Standardized file coverage record
 */
export const normalizeFileCoverage = (filePath, rawData = {}, rootDir = null) => {
    const relativePath = normalizeFilePath(rawData.path || filePath, rootDir);

    const statementMap = rawData.statementMap || {};
    const s = rawData.s || {};
    const branchMap = rawData.branchMap || {};
    const b = rawData.b || {};
    const fnMap = rawData.fnMap || {};
    const f = rawData.f || {};

    // 1. Build Line-by-Line hit count map
    const lineHits = {};
    const lineStatementsCount = {};

    for (const [stmtId, loc] of Object.entries(statementMap)) {
        if (!loc || !loc.start || typeof loc.start.line !== "number") continue;
        const hitCount = s[stmtId] || 0;
        const startLine = loc.start.line;
        const endLine = loc.end?.line || startLine;

        for (let l = startLine; l <= endLine; l++) {
            lineHits[l] = (lineHits[l] || 0) + hitCount;
            lineStatementsCount[l] = (lineStatementsCount[l] || 0) + 1;
        }
    }

    // 2. Identify covered and uncovered lines
    const sortedLines = Object.keys(lineHits).map(Number).sort((x, y) => x - y);
    const coveredLines = [];
    const uncoveredLines = [];
    const lineStatus = {};

    for (const line of sortedLines) {
        const hits = lineHits[line] || 0;
        if (hits > 0) {
            coveredLines.push(line);
            lineStatus[line] = "HIT";
        } else {
            uncoveredLines.push(line);
            lineStatus[line] = "UNHIT";
        }
    }

    // 3. Process Branches
    const uncoveredBranches = [];
    let totalBranchPaths = 0;
    let coveredBranchPaths = 0;

    for (const [branchId, branchMeta] of Object.entries(branchMap)) {
        if (!branchMeta || !branchMeta.loc) continue;
        const branchHits = b[branchId] || [];
        const line = branchMeta.loc.start?.line || 0;

        let branchCovered = true;
        const missingPaths = [];

        branchHits.forEach((hit, idx) => {
            totalBranchPaths++;
            if (hit > 0) {
                coveredBranchPaths++;
            } else {
                branchCovered = false;
                missingPaths.push(idx);
            }
        });

        if (!branchCovered) {
            uncoveredBranches.push({
                branchId,
                line,
                type: branchMeta.type || "if",
                missingPaths,
                totalPaths: branchHits.length,
            });

            // If line had statement hits but missed a branch, mark line as PARTIAL
            if (lineStatus[line] === "HIT" && missingPaths.length > 0 && coveredBranchPaths > 0) {
                lineStatus[line] = "PARTIAL";
            }
        }
    }

    // 4. Process Functions
    const functions = [];
    let totalFunctions = 0;
    let coveredFunctions = 0;

    for (const [fnId, fnMeta] of Object.entries(fnMap)) {
        if (!fnMeta || !fnMeta.decl) continue;
        const hit = f[fnId] || 0;
        const isCovered = hit > 0;
        totalFunctions++;
        if (isCovered) coveredFunctions++;

        const name = fnMeta.name === "(anonymous)" || !fnMeta.name ? `anonymous_${fnId}` : fnMeta.name;
        functions.push({
            name,
            startLine: fnMeta.decl.start?.line || fnMeta.loc?.start?.line || 0,
            endLine: fnMeta.decl.end?.line || fnMeta.loc?.end?.line || 0,
            hit,
            isCovered,
        });
    }

    // 5. Statement metrics
    const statementIds = Object.keys(statementMap);
    const totalStatements = statementIds.length;
    const coveredStatements = statementIds.filter((id) => (s[id] || 0) > 0).length;

    // 6. Metrics Summary for this file
    const totalLinesCount = sortedLines.length;
    const coveredLinesCount = coveredLines.length;

    const metrics = {
        linesPct: safePct(coveredLinesCount, totalLinesCount),
        statementsPct: safePct(coveredStatements, totalStatements),
        branchesPct: safePct(coveredBranchPaths, totalBranchPaths),
        functionsPct: safePct(coveredFunctions, totalFunctions),
        lines: { total: totalLinesCount, covered: coveredLinesCount, skipped: 0, pct: safePct(coveredLinesCount, totalLinesCount) },
        statements: { total: totalStatements, covered: coveredStatements, skipped: 0, pct: safePct(coveredStatements, totalStatements) },
        branches: { total: totalBranchPaths, covered: coveredBranchPaths, skipped: 0, pct: safePct(coveredBranchPaths, totalBranchPaths) },
        functions: { total: totalFunctions, covered: coveredFunctions, skipped: 0, pct: safePct(coveredFunctions, totalFunctions) },
    };

    return {
        filePath: relativePath,
        rawPath: rawData.path || filePath,
        metrics,
        lineHits,
        lineStatus,
        coveredLines,
        uncoveredLines,
        uncoveredBranches,
        functions,
        statementCount: totalStatements,
        branchCount: totalBranchPaths,
        functionCount: totalFunctions,
    };
};

/**
 * Loads, parses, and standardizes coverage data from an Istanbul coverage directory,
 * a coverage-final.json file, or an in-memory coverage map.
 *
 * @param {string|Object} source - Directory path containing coverage-final.json, direct file path, or coverage object
 * @param {string} [rootDir] - Project root directory for relative path calculation
 * @returns {{ summary: Object, files: Object.<string, Object>, fileList: Array<Object> }}
 */
export const parseUnifiedCoverage = (source, rootDir = null) => {
    let rawCoverage = null;

    if (source && typeof source === "object") {
        rawCoverage = source;
    } else if (typeof source === "string") {
        let finalPath = source;
        if (fs.existsSync(source) && fs.statSync(source).isDirectory()) {
            finalPath = path.join(source, "coverage-final.json");
        }

        if (!fs.existsSync(finalPath)) {
            throw new ServiceError(`Coverage artifact not found: ${finalPath}`, 404);
        }

        try {
            rawCoverage = JSON.parse(fs.readFileSync(finalPath, "utf8"));
        } catch (err) {
            throw new ServiceError(`Failed to parse coverage JSON: ${err.message}`, 422);
        }
    } else {
        throw new ServiceError("Invalid coverage source supplied", 400);
    }

    const files = {};
    const fileList = [];

    let totalLines = 0;
    let coveredLines = 0;
    let totalStatements = 0;
    let coveredStatements = 0;
    let totalBranches = 0;
    let coveredBranches = 0;
    let totalFunctions = 0;
    let coveredFunctions = 0;

    for (const [rawKey, rawData] of Object.entries(rawCoverage)) {
        if (!rawData || typeof rawData !== "object") continue;
        const norm = normalizeFileCoverage(rawKey, rawData, rootDir);

        files[norm.filePath] = norm;
        fileList.push(norm);

        totalLines += norm.metrics.lines.total;
        coveredLines += norm.metrics.lines.covered;
        totalStatements += norm.metrics.statements.total;
        coveredStatements += norm.metrics.statements.covered;
        totalBranches += norm.metrics.branches.total;
        coveredBranches += norm.metrics.branches.covered;
        totalFunctions += norm.metrics.functions.total;
        coveredFunctions += norm.metrics.functions.covered;
    }

    const summary = {
        linesPct: safePct(coveredLines, totalLines),
        statementsPct: safePct(coveredStatements, totalStatements),
        branchesPct: safePct(coveredBranches, totalBranches),
        functionsPct: safePct(coveredFunctions, totalFunctions),
        lines: { total: totalLines, covered: coveredLines, pct: safePct(coveredLines, totalLines) },
        statements: { total: totalStatements, covered: coveredStatements, pct: safePct(coveredStatements, totalStatements) },
        branches: { total: totalBranches, covered: coveredBranches, pct: safePct(coveredBranches, totalBranches) },
        functions: { total: totalFunctions, covered: coveredFunctions, pct: safePct(coveredFunctions, totalFunctions) },
        totalFiles: fileList.length,
    };

    return {
        summary,
        files,
        fileList,
    };
};

/**
 * Returns the line execution status for a specific line in a file.
 *
 * @param {Object} fileCoverage - File coverage record from normalizeFileCoverage or parseUnifiedCoverage
 * @param {number} lineNumber - Line number to query
 * @returns {"HIT" | "UNHIT" | "PARTIAL" | "IGNORED"}
 */
export const getLineExecutionStatus = (fileCoverage, lineNumber) => {
    if (!fileCoverage || !fileCoverage.lineStatus) return "IGNORED";
    return fileCoverage.lineStatus[lineNumber] || "IGNORED";
};

/**
 * Formats line coverage status into editor gutter decorations for Monaco / Web Code Viewer.
 *
 * @param {Object} fileCoverage - File coverage record
 * @returns {Array<{ line: number, status: string, hits: number, className: string }>}
 */
export const formatCoverageForGutter = (fileCoverage) => {
    if (!fileCoverage || !fileCoverage.lineHits) return [];
    const gutterList = [];

    for (const [lineStr, hits] of Object.entries(fileCoverage.lineHits)) {
        const line = Number(lineStr);
        const status = fileCoverage.lineStatus[line] || (hits > 0 ? "HIT" : "UNHIT");

        let className = "cov-unhit-line";
        if (status === "HIT") className = "cov-hit-line";
        else if (status === "PARTIAL") className = "cov-partial-line";

        gutterList.push({
            line,
            status,
            hits,
            className,
        });
    }

    return gutterList.sort((a, b) => a.line - b.line);
};

/**
 * Unit Testing Traceability: Maps line coverage to functions/methods within a file.
 * Identifies tested vs untested functions.
 *
 * @param {Object} fileCoverageMap - Map of normalized file records from parseUnifiedCoverage
 * @returns {Array<{ filePath: string, functionName: string, startLine: number, endLine: number, isTested: boolean, hitCount: number }>}
 */
export const traceUnitCoverage = (fileCoverageMap = {}) => {
    const unitTrace = [];

    for (const [filePath, fileData] of Object.entries(fileCoverageMap)) {
        for (const fn of fileData.functions || []) {
            unitTrace.push({
                filePath,
                functionName: fn.name,
                startLine: fn.startLine,
                endLine: fn.endLine,
                isTested: fn.isCovered,
                hitCount: fn.hit,
            });
        }
    }

    return unitTrace;
};

/**
 * System Testing Traceability: Maps page URLs and frontend routes to covered components and lines.
 *
 * @param {Object} fileCoverageMap - Map of normalized file records
 * @param {Array<{ route: string, componentFile?: string }>} routesContext - Known frontend routes
 * @returns {Array<{ route: string, componentFile: string, status: "COVERED" | "UNCOVERED" | "PARTIAL", coveragePct: number }>}
 */
export const traceSystemCoverage = (fileCoverageMap = {}, routesContext = []) => {
    const systemTrace = [];

    for (const routeItem of routesContext) {
        const compFile = routeItem.componentFile ? normalizeFilePath(routeItem.componentFile) : null;
        let matchedData = null;

        if (compFile && fileCoverageMap[compFile]) {
            matchedData = fileCoverageMap[compFile];
        } else if (compFile) {
            // Find by suffix match
            matchedData = Object.values(fileCoverageMap).find((f) => f.filePath.endsWith(compFile) || compFile.endsWith(f.filePath));
        }

        if (matchedData) {
            const pct = matchedData.metrics.linesPct;
            let status = "UNCOVERED";
            if (pct >= 80) status = "COVERED";
            else if (pct > 0) status = "PARTIAL";

            systemTrace.push({
                route: routeItem.route,
                componentFile: matchedData.filePath,
                status,
                coveragePct: pct,
            });
        } else {
            systemTrace.push({
                route: routeItem.route,
                componentFile: routeItem.componentFile || "unknown",
                status: "UNCOVERED",
                coveragePct: 0,
            });
        }
    }

    return systemTrace;
};
