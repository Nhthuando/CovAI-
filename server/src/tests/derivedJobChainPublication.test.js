import {jest,beforeEach,test,expect} from '@jest/globals';

let context;
let afterCommit;
const createPerformanceAnalysisJob = jest.fn(async()=>({id:'performance'}));
const createCodeHygieneJob = jest.fn(async()=>({id:'hygiene'}));
const addJobToQueue = jest.fn();
await jest.unstable_mockModule('../services/projectOperationWorkspace.service.js',()=>({
    currentProjectOperation:()=>context,
    deferPreparedCommit:run=>afterCommit.push(run),
}));
await jest.unstable_mockModule('../services/job.service.js',()=>({
    markJobRunning:jest.fn(),markJobSuccess:jest.fn(),markJobFailed:jest.fn(),updateJobProgress:jest.fn(),
    createPerformanceAnalysisJob,createCodeHygieneJob,
    getJobById:jest.fn(async()=>({id:'performance',projectId:'p',snapshotId:'s',userId:'u'})),
}));
await jest.unstable_mockModule('../services/buildCfg.service.js',()=>({buildCfgForSnapshot:jest.fn(async()=>({functionCount:1}))}));
await jest.unstable_mockModule('../services/performancePipelineStage.service.js',()=>({runPerformancePipelineStage:jest.fn(async()=>({metric:{id:'metric'},result:{slowFunctions:[]}}))}));
await jest.unstable_mockModule('../services/queue.service.js',()=>({addJobToQueue}));
const {processBuildCfgJob} = await import('../services/buildCfgJob.service.js');
const {processPerformanceAnalysisJob} = await import('../services/performanceJob.service.js');

beforeEach(()=>{jest.clearAllMocks();context={preparedPublications:[]};afterCommit=[];});
test('CFG dependent admission waits until parent publication commits',async()=>{
    await processBuildCfgJob({id:'cfg',projectId:'p',snapshotId:'s',userId:'u'});
    expect(createPerformanceAnalysisJob).not.toHaveBeenCalled();
    expect(addJobToQueue).not.toHaveBeenCalled();
    for(const deliver of afterCommit) await deliver();
    expect(createPerformanceAnalysisJob).toHaveBeenCalledWith({projectId:'p',snapshotId:'s',userId:'u'});
    expect(addJobToQueue).toHaveBeenCalledWith('PERFORMANCE_ANALYSIS','performance');
});
test('performance dependent admission waits until parent publication commits',async()=>{
    await processPerformanceAnalysisJob('performance');
    expect(createCodeHygieneJob).not.toHaveBeenCalled();
    expect(addJobToQueue).not.toHaveBeenCalled();
    for(const deliver of afterCommit) await deliver();
    expect(createCodeHygieneJob).toHaveBeenCalledWith({projectId:'p',snapshotId:'s',userId:'u'});
    expect(addJobToQueue).toHaveBeenCalledWith('CODE_HYGIENE','hygiene');
});
test('legacy direct execution still starts its dependent after success',async()=>{
    context=undefined;
    await processPerformanceAnalysisJob('performance');
    expect(addJobToQueue).toHaveBeenCalledWith('CODE_HYGIENE','hygiene');
});
