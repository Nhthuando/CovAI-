import prisma from '../config/prisma.js';
import { calculatePerformance } from './performanceCalculator.service.js';
import { storePerformanceMetric } from './performance.service.js';
import { eventDispatcher, PERFORMANCE_COMPLETED_EVENT } from '../utils/eventDispatcher.js';

/** Loads completed pipeline artifacts, calculates once, and persists the performance artifact. */
export const runPerformancePipelineStage = async ({ snapshotId }) => {
    const [summary, files, functions, cyclomatics, testJob, supertestJob] = await Promise.all([
        prisma.coverageSummary.findUnique({ where: { snapshotId } }),
        prisma.coverageFile.findMany({ where: { snapshotId } }),
        prisma.coverageFunction.findMany({ where: { snapshotId } }),
        prisma.cyclomatic.findMany({ where: { snapshotId } }),
        prisma.job.findFirst({
            where: { snapshotId, type: 'RUN_TESTS', status: 'SUCCESS' },
            orderBy: { finishedAt: 'desc' },
            select: { computeTimeMs: true }
        }),
        prisma.job.findFirst({
            where: { snapshotId, type: 'SUPERTEST_COVERAGE', status: 'SUCCESS' }
        })
    ]);

    const testExecutionType = supertestJob ? 'JEST_AND_SUPERTEST' : 'JEST_UNIT';

    const result = calculatePerformance({
        snapshotId,
        cyclomatics,
        coverageData: { summary, files, functions },
        executionTimeMs: testJob?.computeTimeMs ?? 0,
        testExecutionType
    });
    const metric = await storePerformanceMetric(result);
    eventDispatcher.emit(PERFORMANCE_COMPLETED_EVENT, { snapshotId, metric, result });
    return { metric, result };
};
