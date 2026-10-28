import { jest } from '@jest/globals';

jest.unstable_mockModule('../services/integrationReport.service.js', () => ({
    getIntegrationAnalytics: jest.fn()
}));

const { getIntegrationAnalytics } = await import('../services/integrationReport.service.js');
const { getIntegrationGuidance } = await import('../services/integrationGuidance.service.js');

describe('integrationGuidance.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns RULE_NO_DATA when no data is available', async () => {
        getIntegrationAnalytics.mockResolvedValue({
            snapshotId: 'snap123',
            overview: null,
            history: { executions: [], coverage: [] }
        });

        const res = await getIntegrationGuidance('proj1');
        expect(res.success).toBe(true);
        expect(res.data.rules[0].id).toBe('RULE_NO_DATA');
        expect(res.data.rules[0].finding).toBe('No Integration Test Data');
        expect(res.data.rules[0].evidence.snapshotId).toBe('snap123');
    });

    it('returns RULE_NO_EXECUTION when scenarios exist but no test runs exist', async () => {
        getIntegrationAnalytics.mockResolvedValue({
            snapshotId: 'snap123',
            overview: { totalScenarios: 5 },
            latestExecution: null,
            history: { executions: [], coverage: [] }
        });

        const res = await getIntegrationGuidance('proj1');
        expect(res.success).toBe(true);
        expect(res.data.rules[0].id).toBe('RULE_NO_EXECUTION');
        expect(res.data.rules[0].actionType).toBe('EXECUTE_TESTS');
    });

    it('returns RULE_INFRASTRUCTURE_FAILURE when tests fail to execute entirely', async () => {
        getIntegrationAnalytics.mockResolvedValue({
            snapshotId: 'snap123',
            overview: { totalScenarios: 5 },
            latestExecution: {
                totalTests: 0,
                jobId: 'job123'
            },
            history: { executions: [], coverage: [] }
        });

        const res = await getIntegrationGuidance('proj1');
        expect(res.data.rules.find(r => r.id === 'RULE_INFRASTRUCTURE_FAILURE')).toBeDefined();
    });

    it('returns RULE_SOME_FAILED when tests fail', async () => {
        getIntegrationAnalytics.mockResolvedValue({
            snapshotId: 'snap123',
            overview: { totalScenarios: 5 },
            latestExecution: {
                id: 'testrun1',
                totalTests: 5,
                failedTests: 2,
                passedTests: 3
            },
            history: { executions: [], coverage: [] }
        });

        const res = await getIntegrationGuidance('proj1');
        const failRule = res.data.rules.find(r => r.id === 'RULE_SOME_FAILED');
        expect(failRule).toBeDefined();
        expect(failRule.calculation).toBe('2 / 5');
        expect(failRule.actionType).toBe('REVIEW_SCENARIOS');
    });

    it('returns RULE_ENDPOINTS_UNCOVERED when endpoints are uncovered', async () => {
        getIntegrationAnalytics.mockResolvedValue({
            snapshotId: 'snap123',
            overview: { totalScenarios: 5 },
            latestExecution: {
                totalTests: 5,
                failedTests: 0,
                passedTests: 5,
                skippedTests: 0
            },
            apiCoverage: { uncoveredApis: 2, discoveredApis: 10, testedApis: 8 },
            history: { executions: [], coverage: [] }
        });

        const res = await getIntegrationGuidance('proj1');
        const uncoverRule = res.data.rules.find(r => r.id === 'RULE_ENDPOINTS_UNCOVERED');
        expect(uncoverRule).toBeDefined();
        expect(uncoverRule.actionType).toBe('OPEN_GENERATE_MODAL');
        expect(uncoverRule.calculation).toBe('2 / 10');
    });

    it('returns RULE_SKIPPED_SCENARIOS when tests are skipped', async () => {
        getIntegrationAnalytics.mockResolvedValue({
            snapshotId: 'snap123',
            overview: { totalScenarios: 5 },
            latestExecution: {
                id: 'run1',
                totalTests: 5,
                failedTests: 0,
                passedTests: 4,
                skippedTests: 1
            },
            history: { executions: [], coverage: [] }
        });

        const res = await getIntegrationGuidance('proj1');
        const skipRule = res.data.rules.find(r => r.id === 'RULE_SKIPPED_SCENARIOS');
        expect(skipRule).toBeDefined();
        expect(skipRule.calculation).toBe('Skipped Tests == 1');
    });

    it('returns RULE_COVERAGE_MISSING when executed but no coverage is found', async () => {
        getIntegrationAnalytics.mockResolvedValue({
            snapshotId: 'snap123',
            overview: { totalScenarios: 5 },
            latestExecution: {
                id: 'run1',
                totalTests: 5,
                failedTests: 0,
                passedTests: 5,
                skippedTests: 0
            },
            history: { executions: [], coverage: [] }
        });

        const res = await getIntegrationGuidance('proj1');
        const covRule = res.data.rules.find(r => r.id === 'RULE_COVERAGE_MISSING');
        expect(covRule).toBeDefined();
    });

    it('returns RULE_COVERAGE_ZERO when coverage is found but is 0%', async () => {
        getIntegrationAnalytics.mockResolvedValue({
            snapshotId: 'snap123',
            overview: { totalScenarios: 5 },
            latestExecution: {
                id: 'run1',
                totalTests: 5,
                failedTests: 0,
                passedTests: 5,
                skippedTests: 0
            },
            history: { 
                executions: [], 
                coverage: [{ snapshotId: 'snap123', stmtsPct: 0 }] 
            }
        });

        const res = await getIntegrationGuidance('proj1');
        const covRule = res.data.rules.find(r => r.id === 'RULE_COVERAGE_ZERO');
        expect(covRule).toBeDefined();
        expect(covRule.evidence.details).toContain('0%');
    });
});
