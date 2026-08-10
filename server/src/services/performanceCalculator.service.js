const PERFORMANCE_CONFIG = Object.freeze({
    weights: Object.freeze({ coverage: 0.4, complexity: 0.3, execution: 0.3 }),
    algorithmVersion: 'v2',
    thresholds: Object.freeze({
        complexityHigh: 15,
        riskHigh: 80,
        riskMedium: 50,
        slowFunctionRisk: 80,
        execution: Object.freeze([
            Object.freeze({ max: 5000, score: 100 }),
            Object.freeze({ max: 10000, score: 90 }),
            Object.freeze({ max: 20000, score: 75 }),
            Object.freeze({ max: 50000, score: 50 }),
            Object.freeze({ max: Infinity, score: 25 })
        ])
    })
});

const normalizeExecutionTime = (timeMs) => Number.isFinite(timeMs) && timeMs >= 0 ? Math.ceil(timeMs) : 0;

export const calculatePipelineExecutionScore = (timeMs) => {
    const normalizedTime = normalizeExecutionTime(timeMs);
    return PERFORMANCE_CONFIG.thresholds.execution.find((threshold) => normalizedTime <= threshold.max)?.score ?? 25;
};

export const detectHighRiskFunctions = (cyclomatics = [], coverageFunctions = []) => {
    const coverageMap = new Map(coverageFunctions.map((functionCoverage) => [
        `${functionCoverage.filePath}:${functionCoverage.functionName}`,
        functionCoverage
    ]));
    return cyclomatics.map((cyclomatic) => {
        const coverage = coverageMap.get(`${cyclomatic.filePath}:${cyclomatic.functionName}`);
        const isUncovered = !coverage || coverage.hit === 0;
        const riskScore = cyclomatic.value * 5 + (isUncovered ? 50 : 0);
        return { ...cyclomatic, complexity: cyclomatic.value, riskScore, isUncovered };
    }).sort((left, right) => right.riskScore - left.riskScore);
};

export const detectSlowFunctions = (cyclomatics, coverageFunctions) =>
    detectHighRiskFunctions(cyclomatics, coverageFunctions).filter((functionMetric) =>
        functionMetric.value >= PERFORMANCE_CONFIG.thresholds.complexityHigh ||
        functionMetric.riskScore >= PERFORMANCE_CONFIG.thresholds.slowFunctionRisk
    );

const calculateAverageComplexity = (cyclomatics = []) => {
    if (!cyclomatics.length) return 0;
    return cyclomatics.reduce((total, cyclomatic) => total + cyclomatic.value, 0) / cyclomatics.length;
};

const getRiskLevel = (score) => score >= PERFORMANCE_CONFIG.thresholds.riskHigh ? 'HIGH' :
    score >= PERFORMANCE_CONFIG.thresholds.riskMedium ? 'MEDIUM' : 'LOW';

/** Pure calculation: no Prisma, filesystem, or external state. */
export const calculatePerformance = ({ snapshotId, cyclomatics = [], coverageData = {}, executionTimeMs = 0 }) => {
    const normalizedExecutionTimeMs = normalizeExecutionTime(executionTimeMs);
    const coverageScore = coverageData.summary?.linesPct ?? 0;
    const averageComplexity = calculateAverageComplexity(cyclomatics);
    const executionScore = calculatePipelineExecutionScore(normalizedExecutionTimeMs);
    const performanceScore = coverageScore * PERFORMANCE_CONFIG.weights.coverage +
        averageComplexity * PERFORMANCE_CONFIG.weights.complexity + executionScore * PERFORMANCE_CONFIG.weights.execution;
    const highRiskFunctions = detectHighRiskFunctions(cyclomatics, coverageData.functions ?? []);

    return {
        snapshotId,
        executionTimeMs: normalizedExecutionTimeMs,
        executionScore,
        pipelineExecutionScore: executionScore,
        performanceScore,
        coverageScore,
        averageComplexity,
        riskLevel: getRiskLevel(performanceScore),
        highRiskFunctions,
        slowFunctions: detectSlowFunctions(cyclomatics, coverageData.functions ?? []),
        algorithmVersion: PERFORMANCE_CONFIG.algorithmVersion
    };
};
