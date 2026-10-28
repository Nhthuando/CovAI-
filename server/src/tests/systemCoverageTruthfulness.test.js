import { describe, expect, it } from '@jest/globals';
import { calculateSystemCoverage } from '../services/systemCoverageEngine.service.js';
import { counter, canCompareAssessments, validateMeasurement } from '../services/systemAssessmentContract.service.js';
describe('System metrics require evidence', () => {
    it.each([[[]], [[{ title: 'body visible /login', status: 'passed' }]], [[{ title: '/', status: 'failed' }]]])('never infers coverage from scenarios %j', scenarios => {
        const result = calculateSystemCoverage({ scenarios, harvestedContext: { routes: ['/login'] } });
        expect(result.status).toBe('NOT_MEASURED');
        expect(result.summary.linesPct).toBeNull();
        expect(result.scenarioContributions).toEqual({});
    });
    it('uses null for an empty denominator and rejects corrupt counters', () => {
        expect(counter(0, 0).pct).toBeNull();
        expect(() => counter(2, 1)).toThrow();
        expect(() => counter(NaN, 2)).toThrow();
        expect(() => validateMeasurement({ schemaVersion: 1, status: 'MEASURED' })).toThrow();
    });
    it('does not compare different scopes or execution modes', () => {
        expect(canCompareAssessments({ sourceHash: 's', scopeHash: 'a', executionMode: 'full' }, { sourceHash: 's', scopeHash: 'b', executionMode: 'frontend' }).comparable).toBe(false);
    });
});
