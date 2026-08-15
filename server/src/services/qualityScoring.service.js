/**
 * Rule-based quality scoring engine.
 * Computes Performance, Coverage, Maintainability, and Overall scores
 * from existing analysis data (CoverageSummary, Cyclomatic, ProjectStructure).
 */

/**
 * Clamps a score to [0, 100] and rounds to 1 decimal place.
 * @param {number} value
 * @returns {number}
 */
export const clampScore = (value) => {
    const clamped = Math.max(0, Math.min(100, value));
    return Math.round(clamped * 10) / 10;
};

/**
 * Returns a letter grade for a numeric score.
 * @param {number} score 0-100
 * @returns {"A"|"B"|"C"|"D"|"F"}
 */
export const getGrade = (score) => {
    if (score >= 90) return "A";
    if (score >= 75) return "B";
    if (score >= 60) return "C";
    if (score >= 40) return "D";
    return "F";
};

/**
 * Computes Coverage Score as the average of 4 coverage metrics.
 * @param {object|null} coverageSummary
 * @returns {{ score: number, details: object }}
 */
export const computeCoverageScore = (coverageSummary) => {
    if (!coverageSummary) {
        return {
            score: 0,
            details: { linesPct: 0, branchesPct: 0, funcsPct: 0, stmtsPct: 0 },
        };
    }
    const { linesPct = 0, branchesPct = 0, funcsPct = 0, stmtsPct = 0 } = coverageSummary;
    const avg = (linesPct + branchesPct + funcsPct + stmtsPct) / 4;
    return {
        score: clampScore(avg),
        details: { linesPct, branchesPct, funcsPct, stmtsPct },
    };
};

/**
 * Scores average CC: CC ≤ 5 → 100, 5-10 → lerp(100,40), 10-20 → lerp(40,10), >20 → 10.
 * @param {number} avgCC
 * @returns {number}
 */
const scoreCCAvg = (avgCC) => {
    if (avgCC <= 5) return 100;
    if (avgCC <= 10) return 100 - ((avgCC - 5) / 5) * 60;
    if (avgCC <= 20) return 40 - ((avgCC - 10) / 10) * 30;
    return 10;
};

/**
 * Computes Performance Score from Cyclomatic Complexity and Project Structure.
 * Weights: avgCC 40%, highCCRatio 30%, moduleCohesion 15%, fileSizeDistribution 15%.
 * @param {Array<{value:number, functionName?:string, filePath?:string}>} cyclomatics
 * @param {object|null} structureResult — parsed ProjectStructureAnalysis resultJson
 * @returns {{ score: number, details: object }}
 */
export const computePerformanceScore = (cyclomatics, structureResult) => {
    if (!cyclomatics || cyclomatics.length === 0) {
        return {
            score: 50,
            details: {
                avgCC: 0, highCCRatio: 0, moduleCohesion: 50,
                fileSizeDistribution: 50, hotspots: [],
            },
        };
    }

    const ccValues = cyclomatics.map((c) => c.value);
    const avgCC = ccValues.reduce((sum, v) => sum + v, 0) / ccValues.length;
    const highCCCount = ccValues.filter((v) => v > 10).length;
    const highCCRatio = highCCCount / ccValues.length;

    const ccAvgScore = scoreCCAvg(avgCC);
    const highCCScore = clampScore(100 - highCCRatio * 200);

    let cohesionScore = 50;
    let fileSizeScore = 50;

    if (structureResult?.graph?.nodes) {
        const nodes = structureResult.graph.nodes;
        if (nodes.length > 0) {
            const totalImports = nodes.reduce((sum, n) => sum + (n.imports?.length || 0), 0);
            const totalExports = nodes.reduce((sum, n) => {
                const exportCount = n.functions?.filter((f) => f.exported)?.length || 0;
                return sum + exportCount;
            }, 0);
            const avgImports = totalImports / nodes.length;
            const avgExports = totalExports / nodes.length;
            cohesionScore = clampScore(
                avgImports <= 5 && avgExports <= 8 ? 90 :
                    avgImports <= 10 && avgExports <= 15 ? 70 : 40
            );

            const funcCounts = nodes.map((n) => n.functions?.length || 0);
            const maxFuncs = Math.max(...funcCounts, 1);
            const avgFuncs = funcCounts.reduce((s, v) => s + v, 0) / funcCounts.length;
            fileSizeScore = clampScore(
                maxFuncs <= 10 ? 95 :
                    maxFuncs <= 20 && avgFuncs <= 8 ? 80 :
                        maxFuncs <= 30 ? 60 : 30
            );
        }
    }

    const score = clampScore(
        ccAvgScore * 0.40 + highCCScore * 0.30 + cohesionScore * 0.15 + fileSizeScore * 0.15
    );

    const hotspots = cyclomatics
        .filter((c) => c.value > 10)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((c) => ({
            functionName: c.functionName || "unknown",
            filePath: c.filePath || "unknown",
            value: c.value,
        }));

    return {
        score,
        details: {
            avgCC: Math.round(avgCC * 10) / 10,
            highCCRatio: Math.round(highCCRatio * 1000) / 10,
            moduleCohesion: cohesionScore,
            fileSizeDistribution: fileSizeScore,
            hotspots,
        },
    };
};

/**
 * Computes Maintainability Score from CC and structure metrics.
 * @param {Array<{value:number}>} cyclomatics
 * @param {object|null} structureResult
 * @returns {{ score: number, details: object }}
 */
export const computeMaintainabilityScore = (cyclomatics, structureResult) => {
    const ccValues = (cyclomatics || []).map((c) => c.value);
    const avgCC = ccValues.length > 0
        ? ccValues.reduce((s, v) => s + v, 0) / ccValues.length
        : 5;
    const ccScore = scoreCCAvg(avgCC);

    let fileOrgScore = 50;
    let formatScore = 50;

    if (structureResult) {
        const nodes = structureResult.graph?.nodes || [];
        if (nodes.length > 0) {
            const roledFiles = nodes.filter((n) => n.role && n.role !== "unknown").length;
            const roleRatio = roledFiles / nodes.length;
            fileOrgScore = clampScore(roleRatio * 100);
        }

        const format = structureResult.summary?.moduleFormat;
        if (format === "ESM" || format === "CommonJS") formatScore = 90;
        else if (format === "Mixed") formatScore = 50;
        else formatScore = 30;
    }

    const score = clampScore(ccScore * 0.50 + fileOrgScore * 0.30 + formatScore * 0.20);

    return {
        score,
        details: {
            avgCC: Math.round(avgCC * 10) / 10,
            fileOrganization: fileOrgScore,
            moduleFormatConsistency: formatScore,
        },
    };
};

/**
 * Computes Overall Quality Score using the weighted formula.
 * Overall = 0.30 × Coverage + 0.25 × Performance + 0.25 × Security + 0.20 × Maintainability
 * @param {number} coverageScore
 * @param {number} performanceScore
 * @param {number} securityScore
 * @param {number} maintainabilityScore
 * @returns {number}
 */
export const computeOverallScore = (coverageScore, performanceScore, securityScore, maintainabilityScore) => {
    return clampScore(
        coverageScore * 0.30 +
        performanceScore * 0.25 +
        securityScore * 0.25 +
        maintainabilityScore * 0.20
    );
};
