import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,expect,jest,afterEach} from '@jest/globals';
await jest.unstable_mockModule('../config/prisma.js',()=>({default:{}}));
const {assessSystemWorkspace}=await import('../services/systemAssessmentJob.service.js');
const roots=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it.each([
    {status:'failed',stopOnFailure:true,expected:1},
    {status:'skipped',stopOnFailure:true,expected:1},
    {status:'flaky',stopOnFailure:true,expected:1},
    {status:'passed',stopOnFailure:true,expected:2},
    {status:'failed',stopOnFailure:false,expected:2},
])('executes $expected actual runs for $status with early stop=$stopOnFailure',async({status,stopOnFailure,expected})=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-repeat-'));roots.push(root);
    fs.mkdirSync(path.join(root,'tests'));
    fs.writeFileSync(path.join(root,'tests/app.spec.js'),"import {test,expect} from '@playwright/test';test('outcome',async({page})=>{await expect(page.getByText('saved')).toBeVisible();});");
    const run=jest.fn(async({execution})=>{
        fs.writeFileSync(path.join(execution.reportDirectory,'source-map.json'),'{}');
        fs.writeFileSync(execution.reportPath,JSON.stringify({suites:[{file:'tests/app.spec.js',specs:[{title:'outcome',tests:[{status:status==='passed'?'expected':status==='flaky'?'flaky':status==='skipped'?'skipped':'unexpected',results:[{status:status==='flaky'?'passed':status,duration:10}]}]}]}]}));
        return {reportPath:execution.reportPath,exitCode:status==='failed'?1:0};
    });
    const report=await assessSystemWorkspace({rootDir:root,input:{runner:'playwright',executionMode:'frontend',repeatRuns:2,testFiles:['tests/app.spec.js'],coverageScope:{}},stopOnFailure,dependencies:{run}});
    expect(run).toHaveBeenCalledTimes(expected);
    expect(report.runs).toHaveLength(expected);
    expect(report.stability.passedRuns).toBe(status==='passed'?2:0);
    if(expected===2)expect(run.mock.calls[0][0].rootDir).not.toBe(run.mock.calls[1][0].rootDir);
});
