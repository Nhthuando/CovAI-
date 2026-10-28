import { jest } from '@jest/globals';

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: {
        projectSnapshot: { findMany: jest.fn() },
        testRun: { findMany: jest.fn() },
        coverageSummary: { findMany: jest.fn() },
        job: { findMany: jest.fn() },
        aiTest: { findMany: jest.fn() }
    }
}));

jest.unstable_mockModule('./aiContextBuilder.service.js', () => ({
    loadSourceCode: jest.fn()
}));

jest.unstable_mockModule('./apiEndpointParser.service.js', () => ({
    extractValidEndpoints: jest.fn()
}));

jest.unstable_mockModule('./testSourceParser.service.js', () => ({
    extractTestRequests: jest.fn()
}));

const prisma = (await import('../config/prisma.js')).default;
const { getIntegrationAnalytics } = await import('./integrationReport.service.js');
const { loadSourceCode } = await import('./aiContextBuilder.service.js');
const { extractValidEndpoints } = await import('./apiEndpointParser.service.js');
const { extractTestRequests } = await import('./testSourceParser.service.js');

describe('integrationReport.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('11. null optional sections & 5. empty project', async () => {
        prisma.projectSnapshot.findMany.mockResolvedValue([]);
        
        const report = await getIntegrationAnalytics('p1');
        
        expect(report.overview).toBeNull();
        expect(report.latestExecution).toBeNull();
        expect(report.apiCoverage).toBeNull();
        expect(report.projectCodeCoverage).toBeNull();
        expect(report.history.executions.length).toBe(0);
        expect(report.history.coverage.length).toBe(0);
        expect(report.history.generations.length).toBe(0);
    });

    it('calculates metrics successfully', async () => {
        const snap = { id: 's1', createdAt: new Date('2026-09-25T10:00:00Z') };
        prisma.projectSnapshot.findMany.mockResolvedValue([snap]);

        prisma.testRun.findMany.mockResolvedValue([
            { id: 'tr1', snapshotId: 's1', type: 'SUPERTEST', status: 'SUCCESS', totalTests: 10, passedTests: 8, failedTests: 2, skippedTests: 0, durationMs: 1000, createdAt: new Date('2026-09-25T10:05:00Z') },
            { id: 'tr2', snapshotId: 's1', type: 'SUPERTEST', status: 'SUCCESS', totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 0, durationMs: 1200, createdAt: new Date('2026-09-25T10:10:00Z') }
        ]);

        prisma.coverageSummary.findMany.mockResolvedValue([
            { id: 'cs1', snapshotId: 's1', stmtsPct: 80.5, createdAt: new Date('2026-09-25T10:05:00Z') }
        ]);

        prisma.job.findMany.mockResolvedValue([
            { id: 'j1', snapshotId: 's1', type: 'AI_TESTS', status: 'SUCCESS', payloadJson: JSON.stringify({ mode: 'FULL' }), createdAt: new Date('2026-09-25T10:01:00Z') },
            { id: 'j2', snapshotId: 's1', type: 'AI_TESTS', status: 'SUCCESS', payloadJson: JSON.stringify({ mode: 'SUPERTEST_REGENERATE' }), createdAt: new Date('2026-09-25T10:02:00Z') },
            { id: 'j3', snapshotId: 's1', type: 'AI_TESTS', status: 'SUCCESS', payloadJson: JSON.stringify({ mode: 'UNKNOWN_MODE' }), createdAt: new Date('2026-09-25T10:03:00Z') }
        ]);

        prisma.aiTest.findMany.mockResolvedValue([
            { 
                id: 'ai1', snapshotId: 's1', 
                metaJson: JSON.stringify({
                    framework: 'SUPERTEST',
                    requests: [
                        { scenarioId: '1', userEdited: false },
                        { scenarioId: '2', userEdited: true }
                    ]
                }) 
            }
        ]);

        extractValidEndpoints.mockReturnValue([
            { method: 'get', fullPath: '/api/v1/users' },
            { method: 'post', fullPath: '/api/v1/users' }
        ]);

        extractTestRequests.mockReturnValue([
            { method: 'get', path: '/api/v1/users' }
        ]);

        const report = await getIntegrationAnalytics('p1');

        // 1. latest snapshot selection & 3. multiple TestRuns preserved
        expect(report.history.executions.length).toBe(2);
        expect(report.history.executions[0].testRunId).toBe('tr1');
        expect(report.history.executions[1].testRunId).toBe('tr2');

        // 2. latest completed SUPERTEST execution
        expect(report.latestExecution.testRunId).toBe('tr2');
        expect(report.latestExecution.passedTests).toBe(10);

        // 6. generation history filtering & 7. SUPERTEST_REGENERATE identification
        expect(report.history.generations.length).toBe(2);
        expect(report.history.generations[0].mode).toBe('FULL');
        expect(report.history.generations[1].mode).toBe('SUPERTEST_REGENERATE');

        // 8. unmodified vs modified scenario counts
        expect(report.overview.totalScenarios).toBe(2);
        expect(report.overview.unmodifiedAiScenarios).toBe(1);
        expect(report.overview.modifiedScenarios).toBe(1);

        // 9. API Endpoint Coverage calculation
        expect(report.apiCoverage.discoveredApis).toBe(2);
        expect(report.apiCoverage.testedApis).toBe(1);
        expect(report.apiCoverage.uncoveredApis).toBe(1);
        expect(report.apiCoverage.coveragePercentage).toBe(50);
    });

    it('4. missing CoverageSummary & 10. empty historical arrays', async () => {
        const snap = { id: 's1', createdAt: new Date() };
        prisma.projectSnapshot.findMany.mockResolvedValue([snap]);
        prisma.testRun.findMany.mockResolvedValue([]);
        prisma.coverageSummary.findMany.mockResolvedValue([]);
        prisma.job.findMany.mockResolvedValue([]);
        prisma.aiTest.findMany.mockResolvedValue([]);
        extractValidEndpoints.mockReturnValue([]);
        extractTestRequests.mockReturnValue([]);

        const report = await getIntegrationAnalytics('p1');
        
        expect(report.projectCodeCoverage).toBeNull();
        expect(report.latestExecution).toBeNull();
        expect(report.history.executions.length).toBe(0);
        expect(report.history.generations.length).toBe(0);
        expect(report.history.coverage.length).toBe(0);
    });
});
