import { jest } from '@jest/globals';

const mockGetIntegrationAnalytics = jest.fn();

jest.unstable_mockModule('./integrationReport.service.js', () => ({
    getIntegrationAnalytics: mockGetIntegrationAnalytics,
}));

const { getIntegrationGuidance } = await import('./integrationGuidance.service.js');

describe('Integration Guidance Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const createBaseAnalytics = () => ({
        overview: {
            snapshotId: 'snap-1',
            totalScenarios: 0,
            unmodifiedAiScenarios: 0,
            modifiedScenarios: 0
        },
        latestExecution: null,
        apiCoverage: {
            discoveredApis: 0,
            testedApis: 0,
            uncoveredApis: 0,
            coveragePercentage: 0
        },
        projectCodeCoverage: null,
        history: {
            executions: [],
            coverage: [],
            generations: []
        }
    });

    it('1. should return RULE_NO_DATA when no data exists', async () => {
        const analytics = createBaseAnalytics();
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.success).toBe(true);
        expect(res.data.rules).toHaveLength(1);
        expect(res.data.rules[0].id).toBe('RULE_NO_DATA');
        expect(res.data.rules[0].evidenceData).toEqual({ scenarios: 0, testRuns: 0, coverageSummaries: 0 });
    });

    it('2. should return RULE_NO_EXECUTION when scenarios exist but no execution', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 5;
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.success).toBe(true);
        expect(res.data.rules).toHaveLength(1);
        expect(res.data.rules[0].id).toBe('RULE_NO_EXECUTION');
        expect(res.data.rules[0].evidenceData).toEqual({ scenarios: 5, testRuns: 0 });
    });

    it('3. should return RULE_SOME_FAILED for failed execution', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 10;
        analytics.latestExecution = {
            status: 'FAILED',
            totalTests: 10,
            passedTests: 8,
            failedTests: 2,
            skippedTests: 0
        };
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.data.rules.some(r => r.id === 'RULE_SOME_FAILED')).toBe(true);
        const rule = res.data.rules.find(r => r.id === 'RULE_SOME_FAILED');
        expect(rule.evidenceData).toEqual({ failed: 2, total: 10 });
    });

    it('4. should return RULE_ALL_PASSED when all tests passed', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 10;
        analytics.latestExecution = {
            status: 'SUCCESS',
            totalTests: 10,
            passedTests: 10,
            failedTests: 0,
            skippedTests: 0
        };
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.data.rules.some(r => r.id === 'RULE_ALL_PASSED')).toBe(true);
        const rule = res.data.rules.find(r => r.id === 'RULE_ALL_PASSED');
        expect(rule.evidenceData).toEqual({ passed: 10, failed: 0 });
        expect(rule.finding).toBe("The latest completed Integration Test execution passed all executed scenarios.");
    });

    it('5. should return RULE_ENDPOINTS_UNCOVERED when endpoints are uncovered', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 5;
        analytics.latestExecution = { status: 'SUCCESS', totalTests: 5, passedTests: 5, failedTests: 0, skippedTests: 0 };
        analytics.apiCoverage = { uncoveredApis: 3, discoveredApis: 10, testedApis: 7 };
        
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.data.rules.some(r => r.id === 'RULE_ENDPOINTS_UNCOVERED')).toBe(true);
        const rule = res.data.rules.find(r => r.id === 'RULE_ENDPOINTS_UNCOVERED');
        expect(rule.evidenceData).toEqual({ totalEndpoints: 10, uncoveredEndpoints: 3, testedEndpoints: 7 });
    });

    it('6. should return RULE_COVERAGE_DECREASED when coverage decreases', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 5;
        analytics.latestExecution = { status: 'SUCCESS', totalTests: 5, passedTests: 5, failedTests: 0, skippedTests: 0 };
        analytics.history.coverage = [
            { snapshotId: 'snap-0', stmtsPct: 80 },
            { snapshotId: 'snap-1', stmtsPct: 75 }
        ];
        
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.data.rules.some(r => r.id === 'RULE_COVERAGE_DECREASED')).toBe(true);
        const rule = res.data.rules.find(r => r.id === 'RULE_COVERAGE_DECREASED');
        expect(rule.evidenceData).toEqual({ currentStmtsPct: 75, previousStmtsPct: 80 });
    });

    it('7. should return RULE_COVERAGE_IMPROVED when coverage increases', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 5;
        analytics.latestExecution = { status: 'SUCCESS', totalTests: 5, passedTests: 5, failedTests: 0, skippedTests: 0 };
        analytics.history.coverage = [
            { snapshotId: 'snap-0', stmtsPct: 75 },
            { snapshotId: 'snap-1', stmtsPct: 80 }
        ];
        
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.data.rules.some(r => r.id === 'RULE_COVERAGE_IMPROVED')).toBe(true);
    });

    it('8. should return RULE_SKIPPED_SCENARIOS when tests are skipped', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 10;
        analytics.latestExecution = { status: 'SUCCESS', totalTests: 10, passedTests: 8, failedTests: 0, skippedTests: 2 };
        
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.data.rules.some(r => r.id === 'RULE_SKIPPED_SCENARIOS')).toBe(true);
        const rule = res.data.rules.find(r => r.id === 'RULE_SKIPPED_SCENARIOS');
        expect(rule.evidenceData).toEqual({ skipped: 2 });
    });

    it('9. should return RULE_DIMINISHING_RETURNS for 3 eligible snapshots', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 10;
        analytics.latestExecution = { status: 'SUCCESS', totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 0 };
        
        analytics.history.generations = [
            { snapshotId: 'snap-1', mode: 'FULL' },
            { snapshotId: 'snap-2', mode: 'SKELETON' },
            { snapshotId: 'snap-3', mode: 'FULL' }
        ];
        
        analytics.history.coverage = [
            { snapshotId: 'snap-1', stmtsPct: 70.0 },
            { snapshotId: 'snap-2', stmtsPct: 70.5 },
            { snapshotId: 'snap-3', stmtsPct: 70.8 }
        ];
        
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.data.rules.some(r => r.id === 'RULE_DIMINISHING_RETURNS')).toBe(true);
        const rule = res.data.rules.find(r => r.id === 'RULE_DIMINISHING_RETURNS');
        expect(rule.evidenceData.variance).toBeCloseTo(0.8);
    });

    it('10. should not return RULE_DIMINISHING_RETURNS if fewer than 3 eligible snapshots', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 10;
        analytics.latestExecution = { status: 'SUCCESS', totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 0 };
        
        analytics.history.generations = [
            { snapshotId: 'snap-1', mode: 'FULL' },
            { snapshotId: 'snap-2', mode: 'SKELETON' }
        ];
        
        analytics.history.coverage = [
            { snapshotId: 'snap-1', stmtsPct: 70.0 },
            { snapshotId: 'snap-2', stmtsPct: 70.5 }
        ];
        
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.data.rules.some(r => r.id === 'RULE_DIMINISHING_RETURNS')).toBe(false);
    });

    it('11. should sort multiple matched rules by severity', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 10;
        // triggers SOME_FAILED (ERROR) and SKIPPED (WARNING)
        analytics.latestExecution = { status: 'FAILED', totalTests: 10, passedTests: 7, failedTests: 2, skippedTests: 1 };
        // triggers ENDPOINTS_UNCOVERED (WARNING)
        analytics.apiCoverage = { uncoveredApis: 2, discoveredApis: 10, testedApis: 8 };
        // triggers COVERAGE_IMPROVED (INFO)
        analytics.history.coverage = [
            { snapshotId: 'snap-0', stmtsPct: 50 },
            { snapshotId: 'snap-1', stmtsPct: 60 }
        ];

        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        const ids = res.data.rules.map(r => r.id);
        
        // ERROR first, then WARNINGs in deterministic order, then INFO
        expect(ids).toEqual([
            'RULE_SOME_FAILED', 
            'RULE_ENDPOINTS_UNCOVERED', 
            'RULE_SKIPPED_SCENARIOS', 
            'RULE_COVERAGE_IMPROVED'
        ]);
    });

    it('12. should handle null/empty analytics sections gracefully', async () => {
        mockGetIntegrationAnalytics.mockResolvedValue({
            overview: null,
            latestExecution: null,
            apiCoverage: null,
            projectCodeCoverage: null,
            history: null
        });
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.success).toBe(true);
        expect(res.data.rules[0].id).toBe('RULE_NO_DATA');
    });

    it('13. evidenceData accuracy matches expected keys', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 10;
        analytics.latestExecution = { status: 'FAILED', totalTests: 10, passedTests: 8, failedTests: 2, skippedTests: 0 };
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        const rule = res.data.rules[0];
        expect(Object.keys(rule.evidenceData)).toEqual(['failed', 'total']);
        expect(rule.evidenceData.failed).toBe(2);
        expect(rule.evidenceData.total).toBe(10);
    });

    it('14. unsupported endpoint-concentrated failure is never returned', async () => {
        const analytics = createBaseAnalytics();
        analytics.overview.totalScenarios = 10;
        analytics.latestExecution = { status: 'FAILED', totalTests: 10, passedTests: 0, failedTests: 10, skippedTests: 0 };
        mockGetIntegrationAnalytics.mockResolvedValue(analytics);
        
        const res = await getIntegrationGuidance('proj-1');
        expect(res.data.rules.some(r => r.id === 'RULE_ENDPOINT_CONCENTRATED_FAILURE')).toBe(false);
    });
});
