import { jest } from '@jest/globals';
const upsert = jest.fn(async input => ({ id: 'metric', ...input.create }));
await jest.unstable_mockModule('../config/prisma.js', () => ({ default: { performanceMetric: { upsert } } }));
const { upsertPerformanceMetric } = await import('../services/performance.repository.js');
test('performance persistence matches metricsJson Prisma schema and preserves dashboard fields', async () => {
    const metric = await upsertPerformanceMetric({ snapshotId: 's', performanceScore: 80, executionScore: 90,
        executionTimeMs: 1000, coverageScore: 75, averageComplexity: 2, highRiskFunctions: [], testExecutionType: 'JEST_UNIT', riskLevel: 'LOW' });
    expect(Object.keys(upsert.mock.calls[0][0].create).sort()).toEqual(['metricsJson', 'snapshotId']);
    expect(metric).toMatchObject({ id: 'metric', performanceScore: 80, highRiskFunctionCount: 0 });
});
