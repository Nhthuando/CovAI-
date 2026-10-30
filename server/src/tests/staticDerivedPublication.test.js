import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {jest,beforeEach,afterEach,test,expect} from '@jest/globals';

let root;
let publications;
let afterCommit;
const rawWrite = jest.fn(()=>{throw new Error('Unstaged global write');});
const emit = jest.fn();
const prisma = {
    projectSnapshot:{findUnique:jest.fn(async()=>({rootDir:'/not-the-operation-source'}))},
    cfg:{create:rawWrite,deleteMany:rawWrite},cyclomatic:{deleteMany:rawWrite,upsert:rawWrite,findMany:jest.fn(async()=>[])},
    coverageSummary:{findUnique:jest.fn(async()=>null)},coverageFile:{findMany:jest.fn(async()=>[])},coverageFunction:{findMany:jest.fn(async()=>[])},
    job:{findFirst:jest.fn(async()=>null)},performanceMetric:{findUnique:jest.fn(async()=>null),upsert:rawWrite},
    $transaction:rawWrite,
};
await jest.unstable_mockModule('../config/prisma.js',()=>({default:prisma}));
await jest.unstable_mockModule('../services/projectOperationWorkspace.service.js',()=>({
    operationSnapshot:snapshot=>({...snapshot,rootDir:root}),
    currentProjectOperation:()=>({preparedPublications:[]}),
    stagePreparedPublication:async run=>{publications.push(run);return null;},
    deferPreparedCommit:run=>{afterCommit.push(run);},
}));
await jest.unstable_mockModule('../utils/eventDispatcher.js',()=>({eventDispatcher:{emit},PERFORMANCE_COMPLETED_EVENT:'performance.completed'}));
const {buildCfgForSnapshot} = await import('../services/buildCfg.service.js');
const {runPerformancePipelineStage} = await import('../services/performancePipelineStage.service.js');
const {saveCodeHygieneReport} = await import('../services/codeHygiene.service.js');

beforeEach(()=>{
    jest.clearAllMocks();publications=[];afterCommit=[];
    root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-derived-unit-'));
    fs.writeFileSync(path.join(root,'a.js'),'export function add(a,b) { return a + b; }');
});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));

test('CFG computation reads its operation copy and stages deletion/graph/complexity writes',async()=>{
    const result=await buildCfgForSnapshot('s');
    expect(result.functionCount).toBe(1);
    expect(rawWrite).not.toHaveBeenCalled();
    const tx={cfg:{deleteMany:jest.fn(),create:jest.fn(async({data})=>({id:'cfg-id',...data}))},
        cyclomatic:{deleteMany:jest.fn(),upsert:jest.fn()}};
    for(const publish of publications) await publish(tx);
    expect(tx.cfg.deleteMany).toHaveBeenCalledWith({where:{snapshotId:'s'}});
    expect(tx.cfg.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({snapshotId:'s',filePath:'a.js',functionName:'add'})}));
    expect(tx.cyclomatic.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({snapshotId:'s',cfgId:'cfg-id'})}));
    expect(rawWrite).not.toHaveBeenCalled();
});

test('performance metric uses the publication transaction and emits completion only after commit',async()=>{
    const result=await runPerformancePipelineStage({snapshotId:'s'});
    expect(result.metric.id).toBeTruthy();
    expect(rawWrite).not.toHaveBeenCalled();expect(emit).not.toHaveBeenCalled();
    const tx={performanceMetric:{upsert:jest.fn(async({create})=>create)}};
    for(const publish of publications) await publish(tx);
    expect(tx.performanceMetric.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({id:result.metric.id,snapshotId:'s'})}));
    expect(emit).not.toHaveBeenCalled();
    for(const delivery of afterCommit) await delivery();
    expect(emit).toHaveBeenCalledWith('performance.completed',expect.objectContaining({snapshotId:'s',metric:expect.objectContaining({id:result.metric.id})}));
});

test('hygiene replacement is staged and stays within the supplied publication transaction',async()=>{
    const issues=[{type:'DEBUGGER',severity:'HIGH',filePath:'a.js',line:1,message:'debugger'}];
    const summary={totalIssues:1,infoCount:0,warningCount:0,highCount:1,hygieneScore:90};
    await saveCodeHygieneReport('s',issues,summary);
    expect(rawWrite).not.toHaveBeenCalled();
    const tx={codeHygieneIssue:{deleteMany:jest.fn(),createMany:jest.fn()},codeHygieneSummary:{deleteMany:jest.fn(),create:jest.fn()}};
    for(const publish of publications) await publish(tx);
    expect(tx.codeHygieneIssue.deleteMany).toHaveBeenCalledWith({where:{snapshotId:'s'}});
    expect(tx.codeHygieneIssue.createMany).toHaveBeenCalledWith({data:[{...issues[0],snapshotId:'s'}]});
    expect(tx.codeHygieneSummary.create).toHaveBeenCalledWith({data:{...summary,snapshotId:'s'}});
    expect(rawWrite).not.toHaveBeenCalled();
});
