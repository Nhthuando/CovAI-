import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest, it, expect } from '@jest/globals';
const client = {systemTestAssessment:{findFirst:jest.fn()},systemRequirementRevision:{findFirst:jest.fn()},systemTestProposal:{update:jest.fn(),updateMany:jest.fn(),findUnique:jest.fn(),findFirst:jest.fn()}};
const getJobById=jest.fn(), markJobSuccess=jest.fn(), markJobFailed=jest.fn(), assess=jest.fn(), optimize=jest.fn();
await jest.unstable_mockModule('../config/prisma.js',()=>({default:client}));
await jest.unstable_mockModule('../services/job.service.js',()=>({getJobById,markJobRunning:jest.fn(),markJobSuccess,markJobFailed}));
await jest.unstable_mockModule('../services/systemTestBooster.service.js',()=>({optimizeSystemTest:optimize}));
await jest.unstable_mockModule('../services/systemAssessmentJob.service.js',()=>({assessSystemWorkspace:assess}));
await jest.unstable_mockModule('../services/systemAssessment.service.js',()=>({compareSystemAssessments:()=>({comparable:true,coverageDelta:{frontend:{lines:1}}})}));
const {processSystemImprovementJob}=await import('../services/systemTestImprovementJob.service.js');
const {snapshotIdentity}=await import('../services/systemAssessmentWorkspace.service.js');
const {digest}=await import('../services/systemTestStaticAnalysis.service.js');

it.each([true,false])('auto apply keeps the file safe when candidate passing=%s',async passing=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-auto-job-'));
    try {
        jest.clearAllMocks();
        const filePath='tests/app.spec.js', before="import {test,expect} from '@playwright/test';test('old',async({page})=>{await expect(page.getByText('item')).toBeVisible();});", candidate=before+"test('new',async({page})=>{await expect(page.getByText('other')).toBeVisible();});";
        fs.mkdirSync(path.join(root,'tests')); fs.writeFileSync(path.join(root,filePath),before);
        const identity=snapshotIdentity(root), assessment={...identity,requirementRevisionId:null,reportJson:{input:{testFiles:[filePath]},gaps:[{id:'gap'}]}};
        const record={id:'proposal',filePath,baseTestHash:digest(before),assessment};
        client.systemTestAssessment.findFirst.mockResolvedValue(assessment);
        client.systemRequirementRevision.findFirst.mockResolvedValue(null);
        client.systemTestProposal.update.mockImplementation(async({data})=>Object.assign(record,data));
        client.systemTestProposal.findUnique.mockResolvedValue(record);
        client.systemTestProposal.findFirst.mockResolvedValue(record);
        getJobById.mockResolvedValue({id:'job',snapshotId:'snapshot',userId:'owner',snapshot:{rootDir:root},payloadJson:JSON.stringify({assessmentId:'assessment',filePath,gapIds:['gap'],expectedTestHash:digest(before),autoApply:true})});
        optimize.mockResolvedValue({optimizedCode:candidate});
        const run={testRun:{scenarios:[{status:'passed',testFile:filePath,title:'old'}]}};
        assess.mockReset().mockResolvedValueOnce({stability:{passedRuns:2},runs:[run,run]}).mockResolvedValueOnce({stability:{passedRuns:passing?2:0},runs:[run,run]});
        await processSystemImprovementJob('job',{assertHeld:async()=>{}});
        expect(fs.readFileSync(path.join(root,filePath),'utf8')).toBe(passing?candidate:before);
        expect(record.state).toBe(passing?'APPLIED':'FAILED_VERIFICATION');
        expect(assess.mock.calls[1][0].environmentRoot).toBe(root);
        expect(markJobSuccess).toHaveBeenCalled();
        expect(markJobFailed).not.toHaveBeenCalled();
    } finally {fs.rmSync(root,{recursive:true,force:true});}
});
