import { describe, it, expect } from '@jest/globals';
import { renderSystemTestPdf } from '../services/systemTestPdf.service.js';

describe('System Test PDF', () => {
    it('renders an owned persisted assessment with Vietnamese text and unavailable evidence labels', async () => {
        const pdf = await renderSystemTestPdf({
            assessment: {
                id: 'assessment-1', snapshotId: 'snapshot-1', status: 'COMPLETED', runner: 'playwright', executionMode: 'frontend', sourceHash: 'source', testHash: 'tests', requirementRevisionId: 'revision-1',
                reportJson: { runs: [{ index: 1, testRun: { status: 'PASSED', passedTests: 1, failedTests: 0, skippedTests: 0, scenarios: [{ title: 'Đăng nhập', status: 'passed' }] } }], requirements: { verified: 1, total: 1, designed: 1, criteria: [{ id: 'LOGIN', verified: true, expectedOutcome: 'Hiện trang chủ' }] }, coverage: { tiers: { frontend: { status: 'UNAVAILABLE', reasonCodes: ['NO_INSTRUMENTATION'] } } }, gaps: [] },
            },
        });
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.length).toBeGreaterThan(3000);
    });
});
