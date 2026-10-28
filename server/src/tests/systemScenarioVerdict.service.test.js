import { describe, it, expect } from '@jest/globals';
import { deriveScenarioVerdict, buildSystemGaps, scoreSystemSuite } from '../services/systemScenarioVerdict.service.js';

const scenario = { scenarioKey: 'key', filePath: 'tests/cart.spec.js', title: 'cart', reviewState: 'REVIEWED', criterionIds: ['CART'] };
const run = (index, status) => ({ index, testRun: { status: status === 'passed' ? 'PASSED' : 'FAILED', skippedTests: 0, flakyTests: 0, scenarios: [{ testFile: scenario.filePath, title: scenario.title, status }] } });
const requirements = { criteria: [{ id: 'CART', verified: true, expectedOutcome: 'Item appears' }] };

describe('System Test verdict and score', () => {
    it('keeps a failed repeated behavior as FAIL and identifies the missing checkpoint', () => {
        const runs = [run(1, 'failed'), run(2, 'failed')];
        const verdict = deriveScenarioVerdict({ scenario, runs, requirements });
        expect(verdict).toMatchObject({ executionStatus: 'FAIL', qualityStatus: 'STRONG' });
        const report = { requirements, runs, gaps: [], staticAnalysis: [] };
        expect(buildSystemGaps({ report, verdicts: [verdict] })[0].kind).toBe('FAILED_BEHAVIOR');
        const score = scoreSystemSuite({ report, catalog: [scenario], verdicts: [verdict], artifacts: [] });
        expect(score.counts.requiredArtifacts).toBe(3);
        expect(score.components.evidence).toBe(0);
    });
    it('marks a fail followed by pass as weak and keeps both attempts', () => {
        const verdict = deriveScenarioVerdict({ scenario, runs: [run(1, 'failed'), run(2, 'passed')], requirements });
        expect(verdict.executionStatus).toBe('WEAK');
        expect(verdict.qualityStatus).toBe('FLAKY');
        expect(verdict.attempts).toHaveLength(2);
    });
    it('does not calculate a score without a confirmed denominator or supported analysis', () => {
        expect(scoreSystemSuite({ report: { requirements: { criteria: [] }, runs: [run(1, 'passed')] }, catalog: [scenario], verdicts: [], artifacts: [] }).status).toBe('NOT_CALCULATED');
        expect(scoreSystemSuite({ report: { requirements, runs: [run(1, 'passed')], staticAnalysis: [{ unsupportedFeatures: ['CUSTOM_FIXTURE'] }] }, catalog: [scenario], verdicts: [], artifacts: [] }).reason).toBe('UNSUPPORTED_ASSERTION_ANALYSIS');
    });
});
