import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {jest,it,expect,beforeEach,afterEach} from '@jest/globals';
import { createMutationTestClient } from './helpers/mutationClient.js';
const client={job:{findFirst:jest.fn()},systemTestAssessment:{findFirst:jest.fn(),findUnique:jest.fn(),create:jest.fn()},testRun:{create:jest.fn()},$transaction:jest.fn(),systemRequirementRevision:{findFirst:jest.fn()},systemTestProposal:{findMany:jest.fn(),update:jest.fn(),updateMany:jest.fn(),findUnique:jest.fn(),findFirst:jest.fn()}};
const getJobById=jest.fn(),markJobSuccess=jest.fn(),markJobFailed=jest.fn(),assess=jest.fn(),optimize=jest.fn(),updateJobProgress=jest.fn();
await jest.unstable_mockModule('../config/prisma.js',()=>({default:client}));
await jest.unstable_mockModule('../services/job.service.js',()=>({getJobById,markJobRunning:jest.fn(),markJobSuccess,markJobFailed,addJobLog:jest.fn(),updateJobProgress}));
await jest.unstable_mockModule('../services/systemTestBooster.service.js',()=>({optimizeSystemTest:optimize}));
await jest.unstable_mockModule('../services/systemAssessmentJob.service.js',()=>({assessSystemWorkspace:assess}));
const {processSystemImprovementJob}=await import('../services/systemTestImprovementJob.service.js');
const {snapshotIdentity}=await import('../services/systemAssessmentWorkspace.service.js');
const {digest}=await import('../services/systemTestStaticAnalysis.service.js');
const filePath='tests/app.spec.js';
const before="import {test,expect} from '@playwright/test';test('old',async({page})=>{await expect(page.getByText('item')).toBeVisible();});";
const additional=title=>`test('${title}',async({page})=>{await expect(page.getByText('${title}')).toBeVisible();});`;
const candidate=before+additional('new');
let root,record,identity;
const report=(covered=4,{added=true,failed=false,missingOld=false,negative=false,extra=[]}={})=>({
    ...identity,scopeHash:'scope',runtimeHash:'runtime',requirements:{criteria:[]},gaps:[{id:'gap',filePath:'client/App.jsx',line:8}],
    coverage:{tiers:{frontend:{status:'MEASURED',counters:Object.fromEntries(['lines','branches','functions','statements'].map(metric=>[metric,{covered:negative&&metric==='branches'?3:covered,total:10,pct:(negative&&metric==='branches'?3:covered)*10}]))}}},
    stability:{runs:2,passedRuns:failed?0:2},
    runs:Array.from({length:2},()=>({testRun:{status:failed?'FAILED':'PASSED',skippedTests:0,flakyTests:0,scenarios:[...(!missingOld?[{status:'passed',testFile:filePath,title:'old'}]:[]),...(added?[{status:failed?'failed':'passed',testFile:filePath,title:'new',failureMessages:failed?['Error: locator.fill: timeout']:[],domSnapshot:'{"controls":[{"icons":["lucide-edit-2"]}]}'}]:[]),...extra.map(title=>({status:'passed',testFile:filePath,title}))]}})),
});
beforeEach(()=>{
    jest.resetAllMocks();
    client.$transaction.mockImplementation(fn=>fn(client));
    client.testRun.create.mockResolvedValue({id:'run'});
    client.systemTestAssessment.create.mockResolvedValue({id:'published'});
    root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-improve-'));
    const {$transaction: transactionBoundary,...mutationModels} = createMutationTestClient({rootDir:root,snapshotId:'snapshot'});
    Object.assign(client,mutationModels);
    fs.mkdirSync(path.join(root,'tests'));fs.writeFileSync(path.join(root,filePath),before);
    identity=snapshotIdentity(root);
    const assessment={...identity,requirementRevisionId:null,reportJson:{input:{testFiles:[filePath]},gaps:[{id:'gap',filePath:'client/App.jsx',line:8}]}};
    record={id:'proposal',filePath,baseTestHash:digest(before),assessment};
    client.systemTestAssessment.findFirst.mockResolvedValue(assessment);
    client.systemRequirementRevision.findFirst.mockResolvedValue(null);
    client.systemTestProposal.findMany.mockResolvedValue([]);
    client.systemTestProposal.update.mockImplementation(async({data})=>Object.assign(record,data));
    client.systemTestProposal.findUnique.mockResolvedValue(record);client.systemTestProposal.findFirst.mockResolvedValue(record);
    getJobById.mockResolvedValue({id:'job',snapshotId:'snapshot',userId:'owner',snapshot:{rootDir:root},payloadJson:JSON.stringify({assessmentId:'assessment',filePath,gapIds:['gap'],expectedTestHash:digest(before),autoApply:true,model:'gemini-3.1-flash-lite'})});
    optimize.mockResolvedValue({optimizedCode:candidate});
    assess.mockResolvedValue(report(10)).mockResolvedValueOnce(report(4,{added:false}));
});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
const execute=()=>processSystemImprovementJob('job',{assertHeld:async()=>{}});
it('re-verifies a passing subset twice instead of discarding it with a failing experimental test',async()=>{
    const mixed=candidate+additional('broken');
    optimize.mockResolvedValue({optimizedCode:mixed});
    const failed=report(7);failed.stability.passedRuns=0;
    for(const run of failed.runs)run.testRun.scenarios.push({title:'broken',testFile:filePath,status:'failed'});
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValueOnce(failed).mockImplementation(async options=>{expect(fs.readFileSync(path.join(options.rootDir,filePath),'utf8')).toBe(candidate);return report(10);});
    await execute();
    expect(record.state).toBe('APPLIED');expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(candidate);
    expect(assess).toHaveBeenCalledTimes(3);expect(optimize).toHaveBeenCalledTimes(1);
    expect(record.verificationJson.candidate.stability.passedRuns).toBe(2);
});
it('reports database readiness as setup failure without calling AI or claiming the operation deadline',async()=>{
    const error=Object.assign(Error('Database did not become ready'),{code:'SYSTEM_RUNTIME_SERVICE_NOT_READY',statusCode:503,details:{service:'mysql',state:{exitCode:137}}});
    assess.mockReset().mockRejectedValueOnce(error);
    await expect(execute()).rejects.toBe(error);
    expect(client.systemTestProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({state:'FAILED_VERIFICATION',verificationJson:expect.objectContaining({goal:expect.objectContaining({stopReason:'SETUP_FAILED'}),aiUsage:expect.objectContaining({requests:0}),error:expect.objectContaining({details:{service:'mysql',state:{exitCode:137}}})})})}));
    expect(optimize).not.toHaveBeenCalled();expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
});
it('applies only after two passing runs and a coverage gain; measures baseline once',async()=>{
    await execute();
    expect(record.state).toBe('APPLIED');expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(candidate);
    expect(assess).toHaveBeenCalledTimes(2);expect(optimize).toHaveBeenCalledTimes(1);
    expect(assess.mock.calls[1][0].environmentRoot).toBe(root);
    expect(optimize).toHaveBeenCalledWith(expect.objectContaining({model:'gemini-3.1-flash-lite'}));
    expect(record.verificationJson.quality.addedAssertions).toBe(1);
    expect(record.verificationJson.coverageChanges.frontend.lines.percentagePoints).toBe(60);
    expect(markJobFailed).not.toHaveBeenCalled();
    expect(record.verificationJson.publishedAssessmentId).toBe('published');
    expect(client.testRun.create).toHaveBeenCalledTimes(2);
    expect(client.systemTestAssessment.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({jobId:'job',status:'COMPLETED',snapshotId:'snapshot'})}));
});
it.each([{covered:4,negative:false,state:'NO_MEASURED_IMPROVEMENT',reason:'NO_COVERAGE_GAIN'},{covered:5,negative:true,state:'FAILED_VERIFICATION',reason:'COVERAGE_REGRESSION'}])('rejects $reason after three rounds',async({covered,negative,state,reason})=>{
    assess.mockReset().mockResolvedValue(report(covered,{negative})).mockResolvedValueOnce(report(4,{added:false}));
    await execute();
    expect(record.state).toBe(state);expect(record.verificationJson.reasonCode).toBe(reason);
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
    expect(optimize).toHaveBeenCalledTimes(3);expect(assess).toHaveBeenCalledTimes(4);
    expect(record.verificationJson.attempts).toHaveLength(3);
    expect(JSON.parse(optimize.mock.calls[1][0].instruction).previousVerificationFailure.reasonCode).toBe(reason);
    const progress=updateJobProgress.mock.calls.map(([,value])=>value);
    expect(progress).toEqual([...progress].sort((a,b)=>a-b));
});
it('feeds no-gain measurements into a later successful round and resets rejected code',async()=>{
    const better=before+additional('better');
    optimize.mockImplementation(async options=>{expect(fs.readFileSync(path.join(options.rootDir,filePath),'utf8')).toBe(before);return{optimizedCode:optimize.mock.calls.length===1?candidate:better};});
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValueOnce(report(4)).mockResolvedValueOnce(report(10));
    await execute();
    expect(optimize).toHaveBeenCalledTimes(2);expect(assess).toHaveBeenCalledTimes(3);
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(better);
    const feedback=JSON.parse(optimize.mock.calls[1][0].instruction).previousVerificationFailure;
    expect(feedback.coverageDelta.frontend.lines).toBe(0);expect(feedback.remainingGaps[0].id).toBe('gap');
});
it('repairs failed additions once per round and requires re-verification',async()=>{
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValueOnce(report(4,{failed:true})).mockResolvedValueOnce(report(10));
    await execute();
    expect(record.state).toBe('APPLIED');expect(optimize).toHaveBeenCalledTimes(2);expect(assess).toHaveBeenCalledTimes(3);
    expect(optimize.mock.calls[1][0].mode).toBe('FIX_BREAKPOINT');
    expect(optimize.mock.calls[1][0].scenarioData.failures[0].renderedControls).toContain('lucide-edit-2');
    expect(JSON.parse(optimize.mock.calls[1][0].instruction).gaps[0].id).toBe('gap');
});
it('never repairs original scenario regressions',async()=>{
    assess.mockReset().mockResolvedValue(report(5,{missingOld:true})).mockResolvedValueOnce(report(4,{added:false}));
    await execute();expect(record.state).toBe('FAILED_VERIFICATION');
    expect(optimize.mock.calls.every(([options])=>options.mode!=='FIX_BREAKPOINT')).toBe(true);
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
});
it('retries invalid generation without executing the rejected code',async()=>{
    optimize.mockResolvedValueOnce({optimizedCode:before+"test('empty',async({page})=>{await page.goto('/');});"});
    await execute();expect(optimize).toHaveBeenCalledTimes(2);expect(assess).toHaveBeenCalledTimes(2);
    expect(record.verificationJson.attempts[0].reasonCode).toBe('CANDIDATE_INVALID');expect(record.state).toBe('APPLIED');
    expect(JSON.parse(optimize.mock.calls[1][0].instruction).previousVerificationFailure.rejectedAdditionalTests).toContain("test('empty'");
});
it('retains measured candidate evidence when a later generation is statically rejected',async()=>{
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValue(report(4));
    optimize.mockResolvedValueOnce({optimizedCode:candidate}).mockRejectedValue(Object.assign(new Error('Additional test has no outcome assertion'),{statusCode:422}));
    await execute();
    expect(record.state).toBe('FAILED_VERIFICATION');
    expect(record.verificationJson).toMatchObject({accepted:false,reasonCode:'CANDIDATE_INVALID',candidate:{stability:{passedRuns:2}},error:{message:'Additional test has no outcome assertion'}});
    expect(record.verificationJson.attempts).toHaveLength(3);
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
});
it('retains original bytes when the provider is unavailable',async()=>{
    optimize.mockRejectedValue(Object.assign(new Error('Provider unavailable'),{statusCode:503}));
    await expect(execute()).rejects.toThrow('Provider unavailable');
    expect(markJobFailed).toHaveBeenCalled();expect(optimize).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
});
it('reports a time budget failure honestly and retains completed baseline evidence',async()=>{
    const {operationTimeout}=await import('../services/systemOperationError.service.js');
    optimize.mockRejectedValue(operationTimeout());
    await expect(execute()).rejects.toMatchObject({code:'SYSTEM_OPERATION_TIMEOUT'});
    const saved=client.systemTestProposal.updateMany.mock.calls.at(-1)[0].data;
    expect(saved).toMatchObject({state:'FAILED_VERIFICATION',verificationJson:{error:{code:'SYSTEM_OPERATION_TIMEOUT'},baseline:{stability:{passedRuns:2}}}});
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
    expect(assess.mock.calls[0][0].stopOnFailure).toBe(true);
});
it('does not classify a lost operation lease as changed source',async()=>{
    optimize.mockRejectedValue(Object.assign(new Error('System operation lease was lost'),{statusCode:409}));
    await expect(execute()).rejects.toThrow('lease was lost');
    expect(client.systemTestProposal.updateMany.mock.calls.at(-1)[0].data.state).toBe('FAILED_VERIFICATION');
});
it('stops a canceled job before measurement and keeps its terminal state',async()=>{
    getJobById.mockResolvedValue({...await getJobById(),status:'CANCELED'});
    await execute();
    expect(assess).not.toHaveBeenCalled();expect(optimize).not.toHaveBeenCalled();
    expect(markJobFailed).not.toHaveBeenCalled();
    expect(client.systemTestProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({state:'CANCELED'})}));
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
});
it('accumulates verified gains and continues past 90% until every metric reaches 95%',async()=>{
    const second=candidate+additional('second');
    optimize.mockImplementation(async options=>{
        const current=fs.readFileSync(path.join(options.rootDir,filePath),'utf8');
        expect(current).toBe(optimize.mock.calls.length===1?before:candidate);
        return {optimizedCode:optimize.mock.calls.length===1?candidate:second};
    });
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValueOnce(report(9)).mockResolvedValueOnce(report(10,{extra:['second']}));
    await execute();
    expect(record.state).toBe('APPLIED');
    expect(optimize).toHaveBeenCalledTimes(2);
    expect(assess).toHaveBeenCalledTimes(3);
    expect(record.verificationJson.goal).toMatchObject({target:95,reached:true,stopReason:'TARGET_REACHED',acceptedRounds:2});
    expect(record.verificationJson.quality.addedScenarios).toHaveLength(2);
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(second);
});
it('rejects a decrease against the best verified candidate even when it beats the initial baseline',async()=>{
    const next=candidate+additional('second');
    const regressed=report(7,{extra:['second']});regressed.coverage.tiers.frontend.counters.branches={covered:5,total:10,pct:50};
    optimize.mockResolvedValue({optimizedCode:next}).mockResolvedValueOnce({optimizedCode:candidate});
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValueOnce(report(6)).mockResolvedValue(regressed);
    await execute();
    expect(record.state).toBe('APPLIED');
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(candidate);
    expect(record.verificationJson.goal).toMatchObject({reached:false,stopReason:'NO_FURTHER_GAIN',acceptedRounds:1});
    expect(record.verificationJson.attempts.slice(1).every(item=>item.reasonCode==='COVERAGE_REGRESSION')).toBe(true);
});
it('saves the verified best result when the provider cannot continue',async()=>{
    optimize.mockResolvedValueOnce({optimizedCode:candidate}).mockRejectedValue(Object.assign(new Error('Provider unavailable'),{statusCode:503}));
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValueOnce(report(6));
    await execute();
    expect(record.state).toBe('APPLIED');
    expect(record.verificationJson.goal.stopReason).toBe('PROVIDER_LIMIT');
    expect(record.verificationJson.candidate.stability.passedRuns).toBe(2);
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(candidate);
});
it('finalizes only previously verified tests after a controlled timeout while checking lease ownership',async()=>{
    const {operationTimeout}=await import('../services/systemOperationError.service.js');
    const controller=new AbortController(),assertOwnership=jest.fn(async()=>{});
    optimize.mockResolvedValueOnce({optimizedCode:candidate}).mockImplementation(async()=>{controller.abort(operationTimeout());throw controller.signal.reason;});
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValueOnce(report(6));
    await processSystemImprovementJob('job',{signal:controller.signal,assertOwnership,assertHeld:async()=>{if(controller.signal.aborted)throw controller.signal.reason;}});
    expect(record.state).toBe('APPLIED');
    expect(record.verificationJson.goal.stopReason).toBe('TIME_LIMIT');
    expect(assertOwnership).toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(candidate);
});
it('does not save verified partial gains after the user cancels',async()=>{
    const running=await getJobById();
    optimize.mockResolvedValueOnce({optimizedCode:candidate}).mockImplementation(async()=>{getJobById.mockResolvedValue({...running,status:'CANCELED'});throw Object.assign(new Error('Canceled'),{statusCode:409});});
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValueOnce(report(6));
    await execute();
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
    expect(client.systemTestProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({state:'CANCELED'})}));
    expect(markJobFailed).not.toHaveBeenCalled();
});
it('does not overwrite concurrent source changes when finalizing partial gains',async()=>{
    optimize.mockResolvedValueOnce({optimizedCode:candidate}).mockImplementation(async()=>{fs.writeFileSync(path.join(root,filePath),before+'\n// external edit');throw Object.assign(new Error('Provider unavailable'),{statusCode:503});});
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValueOnce(report(6));
    await expect(execute()).rejects.toThrow('Snapshot changed');
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before+'\n// external edit');
    expect(client.systemTestProposal.updateMany.mock.calls.at(-1)[0].data.state).toBe('STALE');
});
it('enforces the provider request ceiling across cumulative rounds, including retries',async()=>{
    const {currentAiJobBudget}=await import('../services/aiJobBudget.service.js');
    const names=[];
    optimize.mockImplementation(async options=>{
        const budget=currentAiJobBudget();await budget.beforeRequest();await budget.beforeRequest();
        const name=`round-${names.length+1}`;names.push(name);
        return {optimizedCode:fs.readFileSync(path.join(options.rootDir,filePath),'utf8')+additional(name)};
    });
    assess.mockReset().mockImplementation(async()=>assess.mock.calls.length===1?report(1,{added:false}):report(1+names.length,{added:false,extra:names}));
    await execute();
    expect(optimize).toHaveBeenCalledTimes(6);
    expect(record.verificationJson.aiUsage).toMatchObject({requests:12,maxRequests:12});
    expect(record.verificationJson.goal).toMatchObject({stopReason:'REQUEST_LIMIT',acceptedRounds:6,reached:false});
    expect(record.state).toBe('APPLIED');
    expect(record.verificationJson.quality.addedScenarios).toHaveLength(6);
});
it('sends no AI requests when all metrics already meet the target',async()=>{
    assess.mockReset().mockResolvedValue(report(10,{added:false}));
    await execute();
    expect(optimize).not.toHaveBeenCalled();
    expect(record.verificationJson.goal).toMatchObject({reached:true,stopReason:'TARGET_REACHED'});
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
});
it('honors cancellation during finalization before writing the verified candidate',async()=>{
    const running=await getJobById();
    updateJobProgress.mockImplementation(async(_jobId,value)=>{if(value===96)getJobById.mockResolvedValue({...running,status:'CANCELED'});});
    await execute();
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
    expect(markJobFailed).not.toHaveBeenCalled();
    expect(client.systemTestProposal.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({state:'CANCELED'})}));
});
it('never bypasses lost ownership while saving a best candidate after timeout',async()=>{
    const {operationTimeout}=await import('../services/systemOperationError.service.js');
    const controller=new AbortController();
    optimize.mockResolvedValueOnce({optimizedCode:candidate}).mockImplementation(async()=>{controller.abort(operationTimeout());throw controller.signal.reason;});
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValueOnce(report(6));
    await expect(processSystemImprovementJob('job',{signal:controller.signal,assertHeld:async()=>{if(controller.signal.aborted)throw controller.signal.reason;},assertOwnership:async()=>{throw Object.assign(new Error('System operation lease was lost'),{statusCode:409});}})).rejects.toThrow('lease was lost');
    expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(before);
});
it('carries actual runtime failures into regeneration when mechanics repair is statically rejected',async()=>{
    optimize.mockReset().mockResolvedValueOnce({optimizedCode:candidate}).mockRejectedValueOnce(Object.assign(new Error('Repair cannot ignore assertions'),{statusCode:422})).mockResolvedValue({optimizedCode:candidate});
    assess.mockReset().mockResolvedValueOnce(report(4,{added:false})).mockResolvedValueOnce(report(4,{failed:true})).mockResolvedValue(report(10));
    await execute();
    expect(record.state).toBe('APPLIED');
    const feedback=JSON.parse(optimize.mock.calls[2][0].instruction).previousVerificationFailure;
    expect(feedback.failures[0].title).toBe('new');
    expect(feedback.failures[0].message).toContain('locator.fill');
    expect(feedback.reason).toBe('Repair cannot ignore assertions');
});
