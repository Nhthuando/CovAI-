import { detectSlowFunctions } from './performanceCalculator.service.js';
import { findPerformanceReportData, upsertPerformanceMetric } from './performance.repository.js';

// Compatibility exports for existing callers; implementations remain pure in performanceCalculator.service.js.
export { calculatePerformance, calculatePipelineExecutionScore, detectHighRiskFunctions, detectSlowFunctions } from './performanceCalculator.service.js';

export const storePerformanceMetric = upsertPerformanceMetric;

/** Read-only report assembly for dashboard and API consumers. */
export const getPerformanceReport = async (snapshotId) => {
    const [metric, cyclomatics, coverageFunctions] = await findPerformanceReportData(snapshotId);
    if (!metric) return null;
    return {
        metric,
        slowFunctions: detectSlowFunctions(cyclomatics, coverageFunctions),
        slowFunctionDetection: 'STATIC_RISK_PROXY'
    };
};
