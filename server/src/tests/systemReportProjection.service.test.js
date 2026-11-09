import { describe, it, expect } from '@jest/globals';
import { buildSystemReportProjection, projectSystemAssessment } from '../services/systemReportProjection.service.js';
const result = status => ({ index: 1, testRun: { scenarios: [{ testFile: 'auth.spec.js', title: 'Sign in', status }] } });
describe('saved System Test report facts', () => {
    it('does not fabricate API coverage, requirements or a quality score', () => {
        const projection = buildSystemReportProjection({ report: { runs: [result('failed')] } });
        expect(projection.observations.apiEndpoints).toMatchObject({ items: [], pct: null, total: null });
        expect(projection.qualityScore.status).toBe('NOT_CALCULATED');
        expect(projection.requirements.total).toBeNull();
        expect(projection.execution.failed).toBe(1);
        expect(projection.scenarios[0].expected).toEqual([]);
    });
    it('keeps repeat inconsistency and separates identical titles in different files', () => {
        const first = result('failed'), second = { ...result('passed'), index: 2 };
        first.testRun.scenarios.push({ testFile: 'admin.spec.js', title: 'Sign in', status: 'passed' });
        second.testRun.scenarios.push({ testFile: 'admin.spec.js', title: 'Sign in', status: 'passed' });
        const report = buildSystemReportProjection({ report: { runs: [first, second] } });
        expect(report.execution).toMatchObject({ selected: 2, flaky: 1, passed: 1 });
        expect(report.stability).toMatchObject({ status: 'INCONSISTENT', inconsistent: 1, consistent: 1 });
    });
});

// Retention changes artifact availability, not historical measurement values.
it('overlays current artifact expiry on a saved projection without recalculating its score',()=>{
    const saved={id:'assessment',snapshotId:'snapshot',reportJson:{presentation:{identity:{},qualityScore:{status:'CALCULATED',value:88},scenarios:[{scenarioKey:'key',artifacts:[{id:'image',expiredAt:null}]}]}}};
    const projected=projectSystemAssessment(saved,{artifacts:[{id:'image',expiredAt:'2026-11-05T00:00:00Z'}]}).presentation;
    expect(projected.scenarios[0].artifacts[0].expiredAt).toBeTruthy();expect(projected.qualityScore.value).toBe(88);
    expect(saved.reportJson.presentation.scenarios[0].artifacts[0].expiredAt).toBeNull();
});
