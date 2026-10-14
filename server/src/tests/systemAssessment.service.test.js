import { describe, expect, it } from '@jest/globals';
import { requirementCoverage } from '../services/systemRequirement.service.js';
import { classifyMutation, enumerateMutations } from '../services/systemMutation.service.js';
import { instrumentReviewedAssertions, verifyAssertionEvents } from '../services/systemAssertionEvidence.service.js';
import { analyzeSystemTestFile, digest } from '../services/systemTestStaticAnalysis.service.js';

describe('Evidence-based requirement and fault detection', () => {
    it('does not count drafts, titles, or failures as verified requirements', () => {
        const revision = { id: 'revision', status: 'CONFIRMED', contentJson: { criteria: [{ id: 'create' }, { id: 'blank' }] } };
        expect(requirementCoverage({ revision: { ...revision, status: 'DRAFT' } }).verifiedPct).toBeNull();
        const result = requirementCoverage({ revision, bindings: [{ id: 'binding', criterionId: 'create', status: 'APPROVED' }], runs: [{ criterionEvidence: [{ bindingId: 'binding', verified: false }] }] });
        expect(result.total).toBe(2); expect(result.designed).toBe(1); expect(result.verified).toBe(0);
    });
    it('records only matching reviewed assertion sites and successful outcomes', () => {
        const content = "import {test,expect} from '@playwright/test'; test('create',async({page})=>{await expect(page.getByText('item')).toBeVisible();});";
        const analysis = analyzeSystemTestFile({ content, filePath: 'tests/test.spec.js' });
        const binding = { id: 'b', criterionId: 'create', status: 'APPROVED', testFile: 'tests/test.spec.js', testHash: digest(content), assertionId: analysis.assertionSites[0].id, scenarioId: analysis.scenarioSites[0].id, bindingJson: { scenarioTitle: 'create', expectedOutcome: 'item visible' } };
        expect(instrumentReviewedAssertions({ content, filePath: binding.testFile, bindings: [binding], helperImport: '' })).toContain('__covaiAssertion');
        const event = { bindingId: 'b', assertionId: binding.assertionId, testHash: binding.testHash, expectedContractHash: digest(binding.bindingJson), scenarioTitle: 'create', outcome: 'passed', measurementId: 'run-a' };
        const verify = events => verifyAssertionEvents({ bindings: [binding], events, measurementId: 'run-a', testRun: { scenarios: [{ title: 'create', status: 'passed' }] } })[0].verified;
        expect(verify([])).toBe(false); expect(verify([event])).toBe(true); expect(verify([{ ...event, outcome: 'failed' }])).toBe(false); expect(verify([{ ...event, measurementId: 'foreign' }])).toBe(false);
    });
    it('distinguishes healthy assertion detection from startup failure, timeout, and unrelated failures', () => {
        expect(classifyMutation({ startupHealthy: false, timedOut: true }).status).toBe('INFRA_ERROR');
        expect(classifyMutation({ startupHealthy: true, activated: true, targetExecuted: true, assertionFailures: [{ bindingId: 'reviewed' }], approvedTargetBindingIds: ['reviewed'] }).status).toBe('KILLED_ASSERTION');
        expect(classifyMutation({ startupHealthy: true, activated: true, targetExecuted: true }).status).toBe('SURVIVED');
        expect(classifyMutation({ startupHealthy: true, activated: true, targetExecuted: false }).status).toBe('NOT_EXERCISED');
        expect(classifyMutation({ startupHealthy: true, activated: true, targetExecuted: true, assertionFailures: [{ bindingId: 'other' }], approvedTargetBindingIds: ['reviewed'] }).status).toBe('AMBIGUOUS');
    });
    it('enumerates an exact bounded source edit', () => {
        const content = 'export const valid = n => n > 0;';
        const mutation = enumerateMutations({ content, filePath: 'server/src/valid.js' })[0];
        expect(content.slice(mutation.start, mutation.end)).toBe(mutation.original);
        expect(mutation.replacement).toBe('n >= 0');
    });
});
