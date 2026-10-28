import {it,expect} from '@jest/globals';
import {summarizeImprovementVerification,buildImprovementRepairFeedback} from '../services/systemImprovementFeedback.service.js';
it('retains actual SVG classes and complete call log for model repair while bounding UI feedback',()=>{
    const message='Error: locator.click: timeout\nCall log:\n'+ ' '.repeat(450) + "waiting for svg.lucide-edit2";
    const scenario={testFile:'app.spec.js',title:'edit',status:'failed',failureMessages:[message],domSnapshot:JSON.stringify({controls:[{tag:'button',icons:['lucide lucide-pencil']}]})};
    const verification={candidate:{stability:{passedRuns:0,runs:2},runs:[{testRun:{scenarios:[scenario]}},{testRun:{scenarios:[scenario]}}]}};
    const result=buildImprovementRepairFeedback(verification);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toContain('svg.lucide-edit2');
    expect(result.failures[0].renderedControls).toContain('lucide-pencil');
    expect(summarizeImprovementVerification(verification).failures[0].message.length).toBeLessThanOrEqual(400);
});
it('summarizes repeated failed scenarios without ANSI codes or internal Windows paths',()=>{
    const run={testRun:{scenarios:[{title:'UPDATE task',testFile:'test.spec.js',status:'failed',failureMessages:['Timeout',"Error: locator.fill: timeout\nwaiting for input\nC:\\Users\\private\\file.js:1"]}]}};
    const result=summarizeImprovementVerification({baseline:{stability:{passedRuns:2,runs:2}},candidate:{stability:{passedRuns:0,runs:2},runs:[run,run]},comparison:{comparable:true}});
    expect(result.candidatePassedRuns).toBe(0);expect(result.baselinePassedRuns).toBe(2);
    expect(result.failures).toHaveLength(1);expect(result.failures[0].message).toContain('locator.fill');expect(result.failures[0].message).not.toContain('private');
});
it('distinguishes incompatible comparisons and regressions from failing candidate runs',()=>{
    const candidate={stability:{passedRuns:2,runs:2},runs:[]};
    expect(summarizeImprovementVerification({candidate,comparison:{comparable:false,reasonCodes:['DIFFERENT_RUNTIMEHASH']}}).reason).toContain('compared');
    expect(summarizeImprovementVerification({candidate,regression:true}).reason).toContain('regressed');
    expect(summarizeImprovementVerification({})).toBeNull();
});
