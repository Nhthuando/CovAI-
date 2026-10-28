import { jest } from '@jest/globals';

// Mock dependencies before importing the service
jest.unstable_mockModule('../config/prisma.js', () => ({
    default: {
        job: { findMany: jest.fn() },
        testRun: { findFirst: jest.fn(), findMany: jest.fn() },
        projectSnapshot: { findUnique: jest.fn() },
        project: { findUnique: jest.fn() },
        endpoint: { findMany: jest.fn() },
        aiTest: { findMany: jest.fn() },
        coverageSummary: { findUnique: jest.fn() },
        coverageFile: { findMany: jest.fn() },
        coverageFunction: { findMany: jest.fn() },
        sourceCode: { findMany: jest.fn() },
        cfg: { findMany: jest.fn() }
    }
}));

const { default: prisma } = await import('../config/prisma.js');
const { buildIntegrationWorkspace } = await import('../services/integrationWorkspace.service.js');

describe('IntegrationWorkspace Service - Semantic States', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Setup default mocks that won't interfere with execution state logic
        prisma.projectSnapshot.findUnique.mockResolvedValue({ id: 'snap-1', rootDir: '/test' });
        prisma.project.findUnique.mockResolvedValue({ id: 'proj-1' });
        prisma.endpoint.findMany.mockResolvedValue([]);
        prisma.aiTest.findMany.mockResolvedValue([]);
        prisma.testRun.findMany.mockResolvedValue([]);
        prisma.coverageSummary.findUnique.mockResolvedValue(null);
        prisma.coverageFile.findMany.mockResolvedValue([]);
        prisma.coverageFunction.findMany.mockResolvedValue([]);
        prisma.sourceCode.findMany.mockResolvedValue([]);
        prisma.cfg.findMany.mockResolvedValue([]);
    });

    const setupMocks = (executeJob, latestRun, coverageSummary = null) => {
        prisma.job.findMany.mockResolvedValue(executeJob ? [executeJob] : []);
        prisma.testRun.findFirst.mockResolvedValue(latestRun);
        prisma.testRun.findMany.mockResolvedValue(latestRun ? [latestRun] : []);
        prisma.coverageSummary.findUnique.mockResolvedValue(coverageSummary);
    };

    it('1. SUCCESS with tests > 0', async () => {
        setupMocks(
            { id: 'job-1', type: 'COVERAGE_PIPELINE', status: 'SUCCESS', createdAt: new Date('2026-01-01T10:00:00Z') },
            { id: 'run-1', status: 'PASSED', totalTests: 5, passedTests: 5, failedTests: 0, skippedTests: 0, createdAt: new Date('2026-01-01T10:01:00Z') }
        );
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.semanticState).toBe('SUCCESS');
        expect(result.summary.testRunId).toBe('run-1');
        
        // Provenance Check
        expect(result.summary.provenance).toBeDefined();
        expect(result.summary.provenance.execution.jobId).toBe('job-1');
        expect(result.summary.provenance.execution.testRunId).toBe('run-1');
    });

    it('2. FAILED with failedTests > 0', async () => {
        setupMocks(
            { id: 'job-1', type: 'COVERAGE_PIPELINE', status: 'FAILED', createdAt: new Date('2026-01-01T10:00:00Z') },
            { id: 'run-1', status: 'FAILED', totalTests: 5, passedTests: 3, failedTests: 2, skippedTests: 0, createdAt: new Date('2026-01-01T10:01:00Z') }
        );
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.semanticState).toBe('TESTS_FAILED');
    });

    it('3. FAILED before runner execution (Infrastructure Failure)', async () => {
        setupMocks(
            { id: 'job-2', type: 'COVERAGE_PIPELINE', status: 'FAILED', errorMessage: 'Docker failed', createdAt: new Date('2026-01-01T11:00:00Z') },
            { id: 'run-1', status: 'PASSED', totalTests: 5, passedTests: 5, failedTests: 0, skippedTests: 0, createdAt: new Date('2026-01-01T10:01:00Z') }
        );
        // latestRun is older than executeJob, so it's a pre-execution failure for the current job
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.semanticState).toBe('FAILED_BEFORE_TEST_EXECUTION');
        expect(result.jobs.execute.errorMessage).toBe('Docker failed');
        // Because the run is older, it shouldn't link it as the current execution's testRunId
        expect(result.summary.testRunId).toBeNull();
    });

    it('4. SUCCESS with totalTests = 0 (No tests executed)', async () => {
        setupMocks(
            { id: 'job-1', type: 'COVERAGE_PIPELINE', status: 'SUCCESS', createdAt: new Date('2026-01-01T10:00:00Z') },
            { id: 'run-1', status: 'PASSED', totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0, createdAt: new Date('2026-01-01T10:01:00Z') }
        );
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.semanticState).toBe('NO_TESTS_EXECUTED');
    });

    it('5. SKIPPED tests only', async () => {
        setupMocks(
            { id: 'job-1', type: 'COVERAGE_PIPELINE', status: 'SUCCESS', createdAt: new Date('2026-01-01T10:00:00Z') },
            { id: 'run-1', status: 'PASSED', totalTests: 5, passedTests: 0, failedTests: 0, skippedTests: 5, createdAt: new Date('2026-01-01T10:01:00Z') }
        );
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.semanticState).toBe('SKIPPED');
    });

    it('6. Missing coverage', async () => {
        setupMocks(
            { id: 'job-1', type: 'COVERAGE_PIPELINE', status: 'SUCCESS', createdAt: new Date('2026-01-01T10:00:00Z') },
            { id: 'run-1', status: 'PASSED', totalTests: 1, passedTests: 1, failedTests: 0, skippedTests: 0, createdAt: new Date('2026-01-01T10:01:00Z') },
            null // no coverage
        );
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.codeCoverage).toBeNull();
    });

    it('7. Valid 0% coverage', async () => {
        setupMocks(
            { id: 'job-1', type: 'COVERAGE_PIPELINE', status: 'SUCCESS', createdAt: new Date('2026-01-01T10:00:00Z') },
            { id: 'run-1', status: 'PASSED', totalTests: 1, passedTests: 1, failedTests: 0, skippedTests: 0, createdAt: new Date('2026-01-01T10:01:00Z') },
            { stmtsPct: 0, branchesPct: 0, funcsPct: 0, linesPct: 0 }
        );
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.codeCoverage).toEqual({
            statement: 0,
            branch: 0,
            function: 0,
            line: 0
        });
    });

    it('8. Valid non-zero coverage', async () => {
        setupMocks(
            { id: 'job-1', type: 'COVERAGE_PIPELINE', status: 'SUCCESS', createdAt: new Date('2026-01-01T10:00:00Z') },
            { id: 'run-1', status: 'PASSED', totalTests: 1, passedTests: 1, failedTests: 0, skippedTests: 0, createdAt: new Date('2026-01-01T10:01:00Z') },
            { stmtsPct: 85.5, branchesPct: 70.0, funcsPct: 90.0, linesPct: 86.0 }
        );
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.codeCoverage.statement).toBe(85.5);
    });

    it('9. Missing TestRun (Success without tests)', async () => {
        setupMocks(
            { id: 'job-1', type: 'COVERAGE_PIPELINE', status: 'SUCCESS', createdAt: new Date('2026-01-01T10:00:00Z') },
            null
        );
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.semanticState).toBe('NO_TESTS_EXECUTED');
        expect(result.summary.testRunId).toBeNull();
    });

    it('10. Active RUNNING job', async () => {
        setupMocks(
            { id: 'job-1', type: 'COVERAGE_PIPELINE', status: 'RUNNING', createdAt: new Date('2026-01-01T10:00:00Z') },
            { id: 'run-1', status: 'PASSED', totalTests: 5, passedTests: 5, failedTests: 0, skippedTests: 0, createdAt: new Date('2025-01-01T10:01:00Z') }
        );
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.semanticState).toBe('RUNNING');
        // Shouldn't link the old run to this running job
        expect(result.summary.testRunId).toBeNull();
    });

    it('11. API Endpoint Coverage Provenance', async () => {
        setupMocks(null, null);
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.provenance.apiCoverage.metric).toBe('API Endpoint Coverage');
        expect(result.summary.provenance.apiCoverage.snapshotId).toBe('snap-1');
        expect(result.summary.provenance.apiCoverage.limitation).toContain('Static mapping');
    });

    it('12. Code Coverage Provenance', async () => {
        setupMocks(
            { id: 'job-1', type: 'COVERAGE_PIPELINE', status: 'SUCCESS', createdAt: new Date('2026-01-01T10:00:00Z') },
            { id: 'run-1', status: 'PASSED', totalTests: 5, passedTests: 5, failedTests: 0, skippedTests: 0, createdAt: new Date('2026-01-01T10:01:00Z') }
        );
        const result = await buildIntegrationWorkspace('snap-1');
        expect(result.summary.provenance.codeCoverage.metric).toBe('Project Code Coverage');
        expect(result.summary.provenance.codeCoverage.jobId).toBe('job-1');
        expect(result.summary.provenance.codeCoverage.testRunId).toBe('run-1');
    });
});
