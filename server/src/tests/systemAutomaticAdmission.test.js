import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,expect,jest,beforeEach,afterEach} from '@jest/globals';
await jest.unstable_mockModule('../config/prisma.js',()=>({default:{}}));
const {createAssessmentControllers}=await import('../controllers/systemAssessment.controller.js');
let root,client,createJob,enqueue,controller;
const originalFlags={enabled:process.env.SYSTEM_ASSESSMENT_ENABLED,coverage:process.env.SYSTEM_MEASURED_COVERAGE_ENABLED};
beforeEach(()=>{
    process.env.SYSTEM_ASSESSMENT_ENABLED='true';process.env.SYSTEM_MEASURED_COVERAGE_ENABLED='true';
    root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-auto-admit-'));
    fs.writeFileSync(path.join(root,'package.json'),'{}');
    client={projectSnapshot:{findFirst:jest.fn(async()=>({id:'snapshot',projectId:'project',rootDir:root}))},project:{findFirst:jest.fn(async()=>({id:'project',ownerId:'owner'}))},job:{findFirst:jest.fn(async()=>null)},systemTestAssessment:{create:jest.fn(async()=>({id:'assessment'}))}};
    createJob=jest.fn(async()=>({id:'job'}));enqueue=jest.fn();
    const redis={set:jest.fn(async()=>'OK'),eval:jest.fn(async()=>1)};
    controller=createAssessmentControllers({client,createJob,queue:async()=>({getSystemEvidenceRedis:()=>redis,addJobToQueue:enqueue})});
});
afterEach(()=>{
    fs.rmSync(root,{recursive:true,force:true});
    for(const [name,value] of [['SYSTEM_ASSESSMENT_ENABLED',originalFlags.enabled],['SYSTEM_MEASURED_COVERAGE_ENABLED',originalFlags.coverage]])if(value===undefined)delete process.env[name];else process.env[name]=value;
});
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}});
const request=()=>({params:{snapshotId:'snapshot'},user:{id:'owner'},body:{autoDiscover:true,allowGenerate:true,runner:'playwright',executionMode:'full'},headers:{}});
it('queues automatic execution before test discovery and leaves source untouched',async()=>{
    const res=response();await controller.assess(request(),res);
    expect(res.statusCode).toBe(202);
    expect(res.body.data).toMatchObject({jobId:'job',assessmentId:'assessment'});
    expect(createJob.mock.calls[0][0].payloadJson).toMatchObject({autoDiscover:true,allowGenerate:true,executionMode:'full'});
    expect(enqueue).toHaveBeenCalledWith('SYSTEM_TEST_ASSESSMENT','job');
    expect(fs.readdirSync(root)).toEqual(['package.json']);
});
it('denies a foreign snapshot before checking AI permissions or creating jobs',async()=>{
    client.projectSnapshot.findFirst.mockResolvedValue(null);
    const res=response();await controller.assess(request(),res);
    expect(res.statusCode).toBe(404);expect(createJob).not.toHaveBeenCalled();expect(client.project.findFirst).not.toHaveBeenCalled();
});
it('does not let a viewer trigger automatic execution or AI spending',async()=>{
    client.project.findFirst.mockResolvedValue({id:'project',ownerId:'someone-else'});
    client.projectMember={findUnique:jest.fn(async()=>({role:'VIEWER'}))};
    const res=response();await controller.assess(request(),res);
    expect(res.statusCode).toBe(403);expect(createJob).not.toHaveBeenCalled();
});
it('does not admit a second automatic operation while one is queued',async()=>{
    client.job.findFirst.mockResolvedValue({id:'already-queued'});
    const res=response();await controller.assess(request(),res);
    expect(res.statusCode).toBe(409);expect(createJob).not.toHaveBeenCalled();
});
