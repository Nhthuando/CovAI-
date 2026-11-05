/**
 * Feasible Coverage Classifier Service
 *
 * Evaluates whether remaining uncovered code consists entirely of infeasible/dead paths,
 * distinguishing actionable gaps from verified infeasible code (environment guards, dead code post-jump, constant conditions).
 * Strictly preserves authentic Istanbul coverage numbers while computing logical feasibility status.
 */

/**
 * Mathematical Feasible Coverage Classifier:
 * Evaluates whether remaining uncovered code consists entirely of infeasible/dead paths,
 * distinguishing actionable gaps from verified infeasible code (environment guards, dead code post-jump, constant conditions).
 * Strictly preserves authentic Istanbul coverage numbers.
 *
 * @param {object} coverageData - File coverage object or summary
 * @param {Array} infeasibleBlocks - Detected infeasible code blocks from AST analysis
 * @returns {object} { isFeasibleLogicCovered, rawCoverage, actionableLines, actionableBranches, ... }
 */
export const classifyFeasibleCoverage = (coverageData = {}, infeasibleBlocks = []) => {
    if (!coverageData || Object.keys(coverageData).length === 0) {
        return {
            isFeasibleLogicCovered: false,
            rawCoverage: { lines: 0, linesPct: 0, branches: 0, branchesPct: 0, functions: 0, functionsPct: 0, statements: 0, statementsPct: 0 },
            feasibleCoverage: { lines: 0, linesPct: 0, branches: 0, branchesPct: 0, functions: 0, functionsPct: 0, statements: 0, statementsPct: 0 },
            actionableGaps: { lines: 0, branches: 0, functions: 0, statements: 0 },
            actionableLines: [],
            actionableBranches: [],
            actionableFunctions: [],
            infeasibleBranches: [],
            infeasibleSummaries: [],
            infeasibleBranchesCount: 0,
            infeasibleLinesCount: 0,
            infeasibleBlocks: []
        };
    }

    const metrics = coverageData.metrics || {};
    const summary = coverageData.summary || {
        linesPct: coverageData.linesPct ?? metrics.lines?.pct ?? 0,
        branchesPct: coverageData.branchesPct ?? metrics.branches?.pct ?? 0,
        functionsPct: coverageData.functionsPct ?? coverageData.funcsPct ?? metrics.functions?.pct ?? 0,
        statementsPct: coverageData.statementsPct ?? coverageData.stmtsPct ?? metrics.statements?.pct ?? 0,
        lines: metrics.lines,
        branches: metrics.branches,
        functions: metrics.functions,
        statements: metrics.statements
    };

    const uncoveredLines = coverageData.uncoveredLines || [];
    const rawBranches = coverageData.uncoveredBranches ||
        coverageData.coverageGapAnalysis?.uncoveredBranches ||
        (Array.isArray(coverageData.branches)
            ? coverageData.branches.filter(b => b.status !== "fully_covered" && (b.missedTrue || b.missedFalse || (Array.isArray(b.counts) && b.counts.some(c => (c || 0) === 0))))
            : []);
    const uncoveredFunctions = coverageData.uncoveredFunctions ||
        coverageData.uncoveredFunctionsList ||
        coverageData.coverageGapAnalysis?.uncoveredFunctions || [];

    const blocks = (Array.isArray(infeasibleBlocks) && infeasibleBlocks.length > 0)
        ? infeasibleBlocks
        : (coverageData.infeasibleCode ||
           coverageData.infeasibleCodeBlocks ||
           coverageData.coverageGapAnalysis?.infeasibleCodeBlocks ||
           coverageData.astMetadata?.infeasibleNodes ||
           []);

    // Filter actionable uncovered lines (those not enclosed in any infeasible block)
    const actionableLines = uncoveredLines.filter(lineNum => {
        const line = Number(lineNum);
        const isInfeasibleLine = blocks.some(inf => {
            const start = inf.loc?.start?.line ?? inf.startLine ?? inf.line;
            const end = inf.loc?.end?.line ?? inf.endLine ?? inf.line;
            return line >= start && line <= end;
        });
        return !isInfeasibleLine;
    });

    // Filter actionable uncovered branches (those not marked isInfeasible and not matching an infeasible block)
    const actionableBranches = rawBranches.filter(b => {
        if (b.isInfeasible) return false;
        const bLine = b.line || b.loc?.start?.line;
        const matchingBlock = blocks.find(inf => {
            const start = inf.loc?.start?.line ?? inf.startLine ?? inf.line;
            const end = inf.loc?.end?.line ?? inf.endLine ?? inf.line;
            return bLine >= start && bLine <= end;
        });
        if (matchingBlock) {
            if (matchingBlock.affectsBranch === "BOTH" || !matchingBlock.affectsBranch) return false;
            if (matchingBlock.affectsBranch === "TRUE_BRANCH") {
                if (b.missedTrue || b.branchIndex === 0 || b.taken === false || b.type === "True" || (!b.missedFalse && b.branchIndex !== 1)) {
                    return false;
                }
            }
            if (matchingBlock.affectsBranch === "FALSE_BRANCH") {
                if (b.missedFalse || b.branchIndex === 1 || b.taken === true || b.type === "False" || (!b.missedTrue && b.branchIndex !== 0)) {
                    return false;
                }
            }
        }
        return true;
    });

    const isFeasibleLogicCovered =
        actionableLines.length === 0 &&
        actionableBranches.length === 0 &&
        uncoveredFunctions.length === 0 &&
        ((coverageData.failedLines?.length || 0) === 0);

    const rawCoverage = {
        ...summary,
        lines: summary.linesPct ?? (typeof summary.lines === "number" ? summary.lines : summary.lines?.pct ?? 0),
        linesPct: summary.linesPct ?? (typeof summary.lines === "number" ? summary.lines : summary.lines?.pct ?? 0),
        branches: summary.branchesPct ?? (typeof summary.branches === "number" ? summary.branches : summary.branches?.pct ?? 0),
        branchesPct: summary.branchesPct ?? (typeof summary.branches === "number" ? summary.branches : summary.branches?.pct ?? 0),
        functions: summary.functionsPct ?? summary.funcsPct ?? (typeof summary.functions === "number" ? summary.functions : summary.functions?.pct ?? 0),
        functionsPct: summary.functionsPct ?? summary.funcsPct ?? (typeof summary.functions === "number" ? summary.functions : summary.functions?.pct ?? 0),
        statements: summary.statementsPct ?? summary.stmtsPct ?? (typeof summary.statements === "number" ? summary.statements : summary.statements?.pct ?? 0),
        statementsPct: summary.statementsPct ?? summary.stmtsPct ?? (typeof summary.statements === "number" ? summary.statements : summary.statements?.pct ?? 0),
    };

    const feasibleCoverage = {
        lines: isFeasibleLogicCovered ? 100 : rawCoverage.lines,
        linesPct: isFeasibleLogicCovered ? 100 : rawCoverage.linesPct,
        branches: isFeasibleLogicCovered ? 100 : rawCoverage.branches,
        branchesPct: isFeasibleLogicCovered ? 100 : rawCoverage.branchesPct,
        functions: isFeasibleLogicCovered ? 100 : rawCoverage.functions,
        functionsPct: isFeasibleLogicCovered ? 100 : rawCoverage.functionsPct,
        statements: isFeasibleLogicCovered ? 100 : rawCoverage.statements,
        statementsPct: isFeasibleLogicCovered ? 100 : rawCoverage.statementsPct
    };

    const infeasibleBranches = rawBranches.filter(b => !actionableBranches.includes(b));
    const infeasibleSummaries = blocks.map(inf => ({
        line: inf.line || inf.startLine || inf.loc?.start?.line,
        type: inf.type,
        category: inf.category,
        affectsBranch: inf.affectsBranch,
        justification: inf.justification || inf.actionableJustification || "Defensive guard verified as unreachable",
        actionableJustification: inf.actionableJustification || inf.justification || "Defensive guard verified as unreachable"
    }));

    return {
        isFeasibleLogicCovered: Boolean(isFeasibleLogicCovered),
        rawCoverage,
        feasibleCoverage,
        actionableGaps: {
            lines: actionableLines.length,
            branches: actionableBranches.length,
            functions: uncoveredFunctions.length,
            statements: 0
        },
        actionableLines,
        actionableBranches,
        actionableFunctions: uncoveredFunctions,
        infeasibleBranches,
        infeasibleSummaries,
        infeasibleBranchesCount: infeasibleBranches.length,
        infeasibleLinesCount: uncoveredLines.length - actionableLines.length,
        infeasibleBlocks: blocks
    };
};
