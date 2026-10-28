import {it,expect} from '@jest/globals';
import {improvementTiming,proposalProgress} from '../services/systemImprovementProgress.service.js';

const now=Date.parse('2026-10-15T10:10:00Z');
const job={status:'RUNNING',startedAt:'2026-10-15T10:00:00Z'};
it('corrects historical service timeouts without claiming the AI time budget expired',async()=>{
    const record={state:'FAILED_VERIFICATION',verificationJson:{goal:{target:95,stopReason:'TIME_LIMIT'},error:{code:'SYSTEM_RUNTIME_START_FAILED',message:'Disposable mysql did not become ready'}}};
    const result=await proposalProgress({client:{job:{findUnique:async()=>({status:'FAILED'})}},record});
    expect(result.verificationJson.goal.stopReason).toBe('SETUP_FAILED');
    expect(record.verificationJson.goal.stopReason).toBe('TIME_LIMIT');
});
it('does not infer remaining time from stage progress or insufficient history',()=>{
    const result=improvementTiming({job:{...job,progress:96},history:[{computeTimeMs:1200000}],now});
    expect(result).toMatchObject({elapsedMs:600000,remaining:null,estimateStatus:'LEARNING'});
});
it('returns a bounded range based on historical durations',()=>{
    const result=improvementTiming({job,history:[900000,1000000,1200000,1300000].map(computeTimeMs=>({computeTimeMs})),now});
    expect(result.remaining.minMs).toBeGreaterThan(0);
    expect(result.remaining.maxMs).toBeGreaterThan(result.remaining.minMs);
    expect(result.estimateStatus).toBe('ESTIMATED');
});
it('learns remaining time from measured runs when a project has no history',()=>{
    const result=improvementTiming({job:{...job,logs:[
        {message:'Improvement stage: Existing tests: Preparing independent run 1/2',createdAt:'2026-10-15T10:00:10Z'},
        {message:'Improvement stage: Existing tests: Run 1/2: collecting runtime coverage and assertion results',createdAt:'2026-10-15T10:01:10Z'},
    ]},now});
    expect(result).toMatchObject({estimateStatus:'ESTIMATED',estimateBasis:'OBSERVED_RUNS',sampledAt:'2026-10-15T10:10:00.000Z'});
    expect(result.remaining.maxMs).toBeLessThanOrEqual(600000);
    expect(result.remaining.minMs).toBeGreaterThan(0);
});
it('repairs the displayed state of legacy canceled operations incorrectly saved as stale',async()=>{
    const result=await proposalProgress({client:{job:{findUnique:async()=>({status:'FAILED',startedAt:'2026-10-15T10:00:00Z',finishedAt:'2026-10-15T10:20:13Z'})}},record:{jobId:'old',state:'STALE',verificationJson:{error:{message:'System improvement canceled'}}}});
    expect(result.state).toBe('FAILED_VERIFICATION');
    expect(result.verificationJson.error.code).toBe('SYSTEM_OPERATION_TIMEOUT');
    const stale=await proposalProgress({client:{job:{findUnique:async()=>({status:'FAILED'})}},record:{jobId:'old',state:'STALE',verificationJson:{error:{message:'Assessment is stale'}}}});
    expect(stale.state).toBe('STALE');
});
it('does not display zero time remaining after overrunning history',()=>{
    const result=improvementTiming({job,history:Array(3).fill({computeTimeMs:100000}),now});
    expect(result).toMatchObject({remaining:null,estimateStatus:'OVERRUN'});
});
it('freezes elapsed time for terminal jobs and leaves queued time unknown',()=>{
    expect(improvementTiming({job:{...job,status:'SUCCESS',finishedAt:'2026-10-15T10:03:00Z'},now}).elapsedMs).toBe(180000);
    expect(improvementTiming({job:{status:'QUEUED'},now})).toMatchObject({elapsedMs:0,remaining:null,estimateStatus:'QUEUED'});
});
