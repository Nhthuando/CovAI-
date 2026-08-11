import prisma from '../config/prisma.js';

export const upsertPerformanceMetric = (result) => {
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
    return prisma.performanceMetric.upsert({
        where: { snapshotId: result.snapshotId },
        create: { snapshotId: result.snapshotId, ...data },
        update: data
    });
};

export const findPerformanceReportData = (snapshotId) => Promise.all([
    prisma.performanceMetric.findUnique({ where: { snapshotId } }),
    prisma.cyclomatic.findMany({ where: { snapshotId } }),
    prisma.coverageFunction.findMany({ where: { snapshotId } })
]);
