import {it,expect} from '@jest/globals';
import {coverageGoal} from '../../../shared/systemImprovement.js';
import {prioritizeImprovementGaps} from '../services/systemImprovementTargets.service.js';
const tier=(pct=95)=>({status:'MEASURED',counters:Object.fromEntries(['lines','branches','functions','statements'].map(metric=>[metric,{total:100,covered:pct,pct}]))});
it('requires 95% for every measured metric and keeps 90% as a milestone',()=>{
    const report={coverage:{tiers:{frontend:tier(),backend:tier()}}};
    expect(coverageGoal(report).reached).toBe(true);
    report.coverage.tiers.backend.counters.branches.pct=90;
    report.coverage.tiers.backend.counters.branches.covered=90;
    expect(coverageGoal(report)).toMatchObject({reached:false,milestoneReached:true,lowestPct:90});
});
it('does not count unavailable configured tiers or zero-denominator metrics as 100%',()=>{
    const report={input:{coverageScope:{frontend:{},backend:{}}},coverage:{tiers:{frontend:tier(),backend:{status:'NOT_MEASURED'}}}};
    expect(coverageGoal(report)).toMatchObject({reached:false,unmeasured:['backend']});
    report.input.coverageScope.backend=null;
    report.coverage.tiers.frontend.counters.branches={total:0,covered:0,pct:null};
    expect(coverageGoal(report).reached).toBe(true);
    expect(coverageGoal({}).reached).toBe(false);
});
it('prioritizes low branch/function coverage while spreading work across files',()=>{
    const report={coverage:{tiers:{frontend:tier()}},gaps:[{id:'line',tier:'frontend',filePath:'a.js',kind:'MEASURED_UNCOVERED_LINE'},{id:'branch',tier:'frontend',filePath:'a.js',kind:'MEASURED_UNCOVERED_BRANCH'},{id:'fn',tier:'frontend',filePath:'b.js',kind:'MEASURED_UNCOVERED_FUNCTION'}]};
    report.coverage.tiers.frontend.counters.branches.pct=30;
    report.coverage.tiers.frontend.counters.functions.pct=40;
    expect(prioritizeImprovementGaps(report).map(g=>g.id)).toEqual(['branch','fn','line']);
    expect(prioritizeImprovementGaps(report,{avoidIds:['branch']})[0].id).not.toBe('branch');
});
