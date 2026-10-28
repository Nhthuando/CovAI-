import {describe,it,expect} from '@jest/globals';
import {evaluateSystemImprovement} from '../services/systemImprovementPolicy.service.js';

const report = (covered = 4) => ({
    sourceHash:'source',testHash:'tests',scopeHash:'scope',configHash:'config',runtimeHash:'runtime',
    requirements:{criteria:[]},
    stability:{runs:2,passedRuns:2},
    runs:Array.from({length:2},()=>({testRun:{status:'PASSED',skippedTests:0,flakyTests:0,scenarios:[{testFile:'app.spec.js',title:'old',status:'passed'}]}})),
    coverage:{tiers:{frontend:{status:'MEASURED',counters:Object.fromEntries(['lines','branches','functions','statements'].map(metric=>[metric,{covered,total:10,pct:covered*10}]))}}},
});

describe('measured AI improvement acceptance',()=>{
    it('requires a real measured gain with no lost coverage',()=>{
        expect(evaluateSystemImprovement({baseline:report(),candidate:report()}).state).toBe('NO_MEASURED_IMPROVEMENT');
        const result=evaluateSystemImprovement({baseline:report(),candidate:report(5)});
        expect(result.accepted).toBe(true);
        expect(result.coverageChanges.frontend.lines).toEqual({before:40,after:50,percentagePoints:10,coveredDelta:1,total:10});
    });
    it('does not let positive line coverage mask decreasing branch coverage',()=>{
        const candidate=report(5);candidate.coverage.tiers.frontend.counters.branches={covered:3,total:10,pct:30};
        const result=evaluateSystemImprovement({baseline:report(),candidate});
        expect(result.accepted).toBe(false);expect(result.reasonCode).toBe('COVERAGE_REGRESSION');
    });
    it.each(['failed','skipped','flaky'])('rejects %s scenarios even when a summary claims two passing runs',status=>{
        const candidate=report(5);candidate.runs[1].testRun.scenarios.push({testFile:'app.spec.js',title:'new',status});
        expect(evaluateSystemImprovement({baseline:report(),candidate}).accepted).toBe(false);
    });
    it('checks original scenarios from both baseline runs',()=>{
        const baseline=report();baseline.runs[1].testRun.scenarios.push({testFile:'other.spec.js',title:'second run only',status:'passed'});
        expect(evaluateSystemImprovement({baseline,candidate:report(5)}).regression).toBe(true);
    });
    it('rejects changed denominators and missing previously measured tiers',()=>{
        const candidate=report(5);candidate.coverage.tiers.frontend.counters.lines.total=11;
        expect(evaluateSystemImprovement({baseline:report(),candidate}).reasonCode).toBe('INCOMPARABLE_MEASUREMENTS');
        const missing=report(5);missing.coverage.tiers.frontend={status:'NOT_MEASURED'};
        expect(evaluateSystemImprovement({baseline:report(),candidate:missing}).accepted).toBe(false);
    });
    it('never displays unknown or empty coverage as a measured percentage',()=>{
        const baseline=report(),candidate=report(5);
        baseline.coverage.tiers.frontend.counters.functions={covered:0,total:0,pct:null};
        candidate.coverage.tiers.frontend.counters.functions={covered:0,total:0,pct:null};
        expect(evaluateSystemImprovement({baseline,candidate}).coverageChanges.frontend.functions).toEqual({before:null,after:null,percentagePoints:null,coveredDelta:0,total:0});
    });
});
