import prisma from '../config/prisma.js';
import { loadCoverageData } from './aiContextBuilder.service.js';
import { calculatePerformance } from './performanceCalculator.service.js';
import { storePerformanceMetric } from './performance.service.js';
import { eventDispatcher, PERFORMANCE_COMPLETED_EVENT } from '../utils/eventDispatcher.js';

/** Loads completed pipeline artifacts, calculates once, and persists the performance artifact. */
export const runPerformancePipelineStage = async ({ snapshotId }) => {
    const [coverageData, cyclomatics, testJob] = await Promise.all([
        loadCoverageData(snapshotId),
        prisma.cyclomatic.findMany({ where: { snapshotId } }),
        prisma.job.findFirst({
            where: { snapshotId, type: 'RUN_TESTS', status: 'SUCCESS' },
            orderBy: { finishedAt: 'desc' },
            select: { computeTimeMs: true }
        })
    ]);

    const result = calculatePerformance({
        snapshotId,
        cyclomatics,
        coverageData,
        executionTimeMs: testJob?.computeTimeMs ?? 0
    });
    const metric = await storePerformanceMetric(result);
    eventDispatcher.emit(PERFORMANCE_COMPLETED_EVENT, { snapshotId, metric, result });
    return { metric, result };
};
