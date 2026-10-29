import prisma from '../config/prisma.js';

const publicMetric = row => {
    if (!row) return row;
    let metrics = {};
    try { metrics = JSON.parse(row.metricsJson || '{}'); } catch { /* Legacy malformed payload remains readable. */ }
    return { ...metrics, ...row };
};
export const upsertPerformanceMetric = async (result,db = prisma,id) => {
    const data = {
        performanceScore: result.performanceScore,
        executionScore: result.executionScore,
        executionTimeMs: result.executionTimeMs,
        coverageScore: result.coverageScore,
        averageComplexity: result.averageComplexity,
        highRiskFunctionCount: result.highRiskFunctions.length,
        testExecutionType: result.testExecutionType,
        riskLevel: result.riskLevel
    };
    const metric = await db.performanceMetric.upsert({
        where: { snapshotId: result.snapshotId },
        create: { ...(id ? {id} : {}), snapshotId: result.snapshotId, metricsJson: JSON.stringify(data) },
        update: { metricsJson: JSON.stringify(data) }
    });
    return publicMetric(metric);
};

export const findPerformanceReportData = (snapshotId) => Promise.all([
    prisma.performanceMetric.findUnique({ where: { snapshotId } }).then(publicMetric),
    prisma.cyclomatic.findMany({ where: { snapshotId } }),
    prisma.coverageFunction.findMany({ where: { snapshotId } })
]);
