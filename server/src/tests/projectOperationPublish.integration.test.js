import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma.js';
import {assertCollaborationTestDatabase} from "./helpers/collaborationDb.js";
import { admitProjectOperation,publishOperationResults } from '../services/projectOperation.service.js';
import { withOperationWorkspace,operationSnapshot,runJobInOperationWorkspace,stagePreparedFailure } from '../services/projectOperationWorkspace.service.js';
import {markJobRunning,markJobSuccess,markJobFailed} from '../services/job.service.js';
import {parseCoverageSummary} from '../services/coverageSummaryParser.service.js';
import {readVersionedProjectFile} from '../services/projectFileVersion.service.js';
import {mutateProjectWorkspace} from '../services/projectMutation.service.js';
import {failInterruptedProjectOperation} from '../services/projectOperationRecovery.service.js';

const suite = process.env.COLLABORATION_INTEGRATION === 'true' ? describe : describe.skip;
suite('project operation admission and publication on PostgreSQL', () => {
    let disposableVerified = false;
    let root,owner,editor,project,snapshot;
    const operationDirectories = [];
    beforeAll(() => { assertCollaborationTestDatabase(process.env.DATABASE_URL); disposableVerified = true; });
    beforeEach(async () => {
        project = undefined; owner = undefined; editor = undefined;
        root = await fs.mkdtemp(path.join(os.tmpdir(),'covai-operation-db-'));
        await fs.writeFile(path.join(root,'a.js'),'canonical');
        await fs.writeFile(path.join(root,'.env'),'PRIVATE_TEST_SENTINEL');
        const run = randomUUID();
        [owner,editor] = await Promise.all(['owner','editor'].map(name=>prisma.user.create({data:{email:`${name}-${run}@example.test`,name}})));
        project = await prisma.project.create({data:{name:`operation-${run}`,ownerId:owner.id}});
        snapshot = await prisma.projectSnapshot.create({data:{projectId:project.id,source:'ZIP',rootDir:root,storagePath:root}});
        await prisma.projectMember.create({data:{projectId:project.id,userId:editor.id,role:'EDITOR'}});
    });
    afterEach(async () => {
        if (!disposableVerified) return;
        if (project) await prisma.project.delete({where:{id:project.id}});
        const userIds = [owner,editor].filter(Boolean).map(user=>user.id);
        if (userIds.length) await prisma.user.deleteMany({where:{id:{in:userIds}}});
        if (root) await fs.rm(root,{recursive:true,force:true});
        for (const directory of operationDirectories.splice(0)) {
            if (!directory.includes(`${path.sep}.covai-temp${path.sep}collaboration-operations${path.sep}`)) throw new Error('Unsafe cleanup target');
            await fs.rm(directory,{recursive:true,force:true});
        }
    });
    afterAll(async () => { if(disposableVerified) await prisma.$disconnect(); });
    const admit = (user,input = {},requestId) => admitProjectOperation({projectId:project.id,snapshotId:snapshot.id,userId:user.id,type:'RUN_TESTS',input,requestId});
    test('simultaneous equivalent work shares one primary job across actors', async () => {
        const results = await Promise.all([admit(owner,{mode:'FULL'},'owner-a'),admit(editor,{mode:'FULL'},'editor-a')]);
        expect(new Set(results.map(item=>item.jobId)).size).toBe(1);
        expect(results.filter(item=>item.reused)).toHaveLength(1);
        expect(await prisma.projectOperation.count({where:{projectId:project.id}})).toBe(1);
        expect(await prisma.projectOperationRequest.count({where:{projectId:project.id}})).toBe(2);
        await expect(admit(editor,{mode:'CHANGED'},'editor-b')).rejects.toMatchObject({code:'OPERATION_BUSY'});
        await prisma.job.update({where:{id:results[0].jobId},data:{status:'SUCCESS',finishedAt:new Date()}});
        await prisma.projectOperation.update({where:{id:results[0].operationId},data:{status:'SUCCESS'}});
        // A later revision must not turn an already admitted actor/request key
        // into a fresh execution, including the actor who lost the first race.
        await prisma.project.update({where:{id:project.id},data:{workspaceRevision:{increment:1}}});
        for (const [actor,key] of [[owner,'owner-a'],[editor,'editor-a']]) {
            expect(await admit(actor,{mode:'FULL'},key)).toMatchObject({jobId:results[0].jobId,reused:true,status:'SUCCESS'});
            await expect(admit(actor,{mode:'OTHER'},key)).rejects.toMatchObject({code:'REQUEST_ID_REUSED'});
        }
        expect(await prisma.job.count({where:{projectId:project.id}})).toBe(1);
    });
    test.each(['owner','editor'])('a durable secondary alias survives completion when %s owns the primary job',async primaryActor=>{
        const primary=primaryActor === 'owner' ? owner : editor;
        const secondary=primaryActor === 'owner' ? editor : owner;
        const first=await admit(primary,{mode:'FULL'},'primary-request');
        const joined=await admit(secondary,{mode:'FULL'},'secondary-request');
        expect(joined).toMatchObject({jobId:first.jobId,reused:true});
        await prisma.job.update({where:{id:first.jobId},data:{status:'FAILED',finishedAt:new Date()}});
        await prisma.projectOperation.update({where:{id:first.operationId},data:{status:'FAILED'}});
        expect(await admit(secondary,{mode:'FULL'},'secondary-request')).toMatchObject({jobId:first.jobId,reused:true,status:'FAILED'});
        await expect(admit(secondary,{mode:'OTHER'},'secondary-request')).rejects.toMatchObject({code:'REQUEST_ID_REUSED'});
        expect(await prisma.projectOperationRequest.count({where:{operationId:first.operationId}})).toBe(2);
        expect(await prisma.job.count({where:{projectId:project.id}})).toBe(1);
    });
    test('same actor/request retries are idempotent and cannot change their input', async () => {
        const first = await admit(owner,{mode:'FULL'},'fixed-request');
        expect((await admit(owner,{mode:'FULL'},'fixed-request')).jobId).toBe(first.jobId);
        await expect(admit(owner,{mode:'OTHER'},'fixed-request')).rejects.toMatchObject({code:'REQUEST_ID_REUSED'});
    });
    test('missing snapshot is rejected by actual DB admission before a job is created',async()=>{
        await expect(admitProjectOperation({projectId:project.id,snapshotId:'missing-snapshot',userId:owner.id,type:'RUN_TESTS'})).rejects.toMatchObject({statusCode:404});
        expect(await prisma.job.count({where:{projectId:project.id}})).toBe(0);
    });
    test('operation workspace changes cannot modify canonical source or copy project secrets', async () => {
        const operation = await admit(editor,{mode:'FULL'});
        await withOperationWorkspace(operation.operationId,async context => {
            operationDirectories.push(context.rootDir);
            const isolated = operationSnapshot(snapshot);
            expect(isolated.id).toBe(snapshot.id);
            expect(isolated.rootDir).not.toBe(root);
            expect(await fs.readFile(path.join(isolated.rootDir,'a.js'),'utf8')).toBe('canonical');
            await expect(fs.access(path.join(isolated.rootDir,'.env'))).rejects.toMatchObject({code:'ENOENT'});
            await fs.writeFile(path.join(isolated.rootDir,'a.js'),'generated during test');
            expect(await fs.readFile(path.join(root,'a.js'),'utf8')).toBe('canonical');
            await prisma.job.update({where:{id:operation.jobId},data:{status:'SUCCESS',resultJson:'{"tests":1}'}});
        });
        expect((await prisma.projectOperation.findUnique({where:{id:operation.operationId}})).status).toBe('SUCCESS');
        expect(await withOperationWorkspace(operation.operationId,()=>{throw new Error('duplicate execution');})).toMatchObject({skipped:true});
    });
    test('changed source makes publication STALE; revoked actor cannot publish at all', async () => {
        const operation = await admit(editor,{mode:'FULL'});
        await prisma.project.update({where:{id:project.id},data:{workspaceRevision:{increment:1}}});
        expect(await publishOperationResults({operationId:operation.operationId,result:{old:true}})).toMatchObject({stale:true});
        const next = await admit(editor,{mode:'FULL'});
        await prisma.projectMember.delete({where:{projectId_userId:{projectId:project.id,userId:editor.id}}});
        await expect(publishOperationResults({operationId:next.operationId,result:{denied:true}})).rejects.toMatchObject({statusCode:404});
    });
    const prepareMetrics = async context => {
        operationDirectories.push(context.rootDir);
        const directory = path.join(context.rootDir,'coverage');
        await fs.mkdir(directory,{recursive:true});
        const metric = {total:10,covered:9,skipped:0,pct:90};
        const entry = {lines:metric,statements:metric,functions:metric,branches:metric};
        await fs.writeFile(path.join(directory,'coverage-summary.json'),JSON.stringify({total:entry,'a.js':entry}));
        return parseCoverageSummary(directory,snapshot.id);
    };
    const baselineMetrics = () => prisma.coverageSummary.create({data:{snapshotId:snapshot.id,linesPct:10,branchesPct:10,funcsPct:10,stmtsPct:10}});
    test('coverage metrics and terminal success stay uncommitted until the final guarded transaction',async()=>{
        await baselineMetrics();
        const operation = await admit(owner,{mode:'FULL'});
        await runJobInOperationWorkspace(operation.jobId,async context=>{
            await markJobRunning(operation.jobId);
            expect((await prepareMetrics(context)).summary.linesPct).toBe(90);
            expect((await prisma.coverageSummary.findUnique({where:{snapshotId:snapshot.id}})).linesPct).toBe(10);
            await markJobSuccess(operation.jobId,{coverage:90});
            expect((await prisma.job.findUnique({where:{id:operation.jobId}})).status).toBe('RUNNING');
        });
        expect((await prisma.coverageSummary.findUnique({where:{snapshotId:snapshot.id}})).linesPct).toBe(90);
        expect((await prisma.job.findUnique({where:{id:operation.jobId}})).status).toBe('SUCCESS');
        expect((await prisma.projectOperation.findUnique({where:{id:operation.operationId}})).status).toBe('SUCCESS');
    });
    test('a source edit during metric preparation preserves the prior complete summary',async()=>{
        await baselineMetrics();
        const base = await readVersionedProjectFile({projectId:project.id,snapshotId:snapshot.id,userId:owner.id,path:'a.js'});
        const operation = await admit(owner,{mode:'FULL'});
        await expect(runJobInOperationWorkspace(operation.jobId,async context=>{
            await markJobRunning(operation.jobId);
            await prepareMetrics(context);
            await mutateProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:editor.id,path:'a.js',kind:'WRITE_FILE',content:'new source',expectedVersion:base.version});
            await markJobSuccess(operation.jobId,{coverage:90});
        })).rejects.toMatchObject({code:'OPERATION_STALE'});
        expect((await prisma.coverageSummary.findUnique({where:{snapshotId:snapshot.id}})).linesPct).toBe(10);
        expect((await prisma.job.findUnique({where:{id:operation.jobId}})).status).toBe('FAILED');
    });
    test('failed execution retains its failed test-run evidence without replacing current coverage',async()=>{
        await baselineMetrics();
        const operation = await admit(owner,{mode:'FULL'});
        await runJobInOperationWorkspace(operation.jobId,async context=>{
            await markJobRunning(operation.jobId);
            await prepareMetrics(context);
            await stagePreparedFailure(tx=>tx.testRun.create({data:{snapshotId:snapshot.id,type:'JEST',totalTests:1,passedTests:0,failedTests:1,skippedTests:0,durationMs:0,status:'FAILED',startedAt:new Date(),finishedAt:new Date()}}));
            await markJobFailed(operation.jobId,new Error('test fixture failure'));
        });
        expect((await prisma.coverageSummary.findUnique({where:{snapshotId:snapshot.id}})).linesPct).toBe(10);
        expect(await prisma.testRun.count({where:{snapshotId:snapshot.id,status:'FAILED'}})).toBe(1);
        expect((await prisma.projectOperation.findUnique({where:{id:operation.operationId}})).status).toBe('FAILED');
    });
    test('a legacy worker without operation admission cannot reach its runner',async()=>{
        let called = false;
        await expect(runJobInOperationWorkspace('unadmitted-job',()=>{called = true;})).rejects.toMatchObject({code:'OPERATION_CONTEXT_REQUIRED'});
        expect(called).toBe(false);
    });
    test('a stalled retry fences RUNNING work and cannot publish or reuse its workspace',async()=>{
        const operation = await admit(owner,{mode:'FULL'});
        await prisma.projectOperation.update({where:{id:operation.operationId},data:{status:'RUNNING'}});
        await prisma.job.update({where:{id:operation.jobId},data:{status:'RUNNING'}});
        expect(await failInterruptedProjectOperation({jobId:operation.jobId})).toMatchObject({interrupted:true});
        expect((await prisma.projectOperation.findUnique({where:{id:operation.operationId}})).status).toBe('FAILED');
        expect((await prisma.job.findUnique({where:{id:operation.jobId}})).errorMessage).toContain('WORKER_INTERRUPTED');
        await expect(publishOperationResults({operationId:operation.operationId,result:{stale:true}})).rejects.toMatchObject({code:'OPERATION_CANCELED'});
        expect((await admit(owner,{mode:'FULL'})).jobId).not.toBe(operation.jobId);
    });
    test('retry reconciles a terminal job without falsely failing its completed evidence',async()=>{
        const operation = await admit(owner,{mode:'FULL'});
        await prisma.projectOperation.update({where:{id:operation.operationId},data:{status:'RUNNING'}});
        await prisma.job.update({where:{id:operation.jobId},data:{status:'SUCCESS',resultJson:'{"complete":true}'}});
        expect(await failInterruptedProjectOperation({jobId:operation.jobId})).toMatchObject({interrupted:false,reconciled:true});
        expect((await prisma.projectOperation.findUnique({where:{id:operation.operationId}})).status).toBe('SUCCESS');
        expect((await prisma.job.findUnique({where:{id:operation.jobId}})).resultJson).toBe('{"complete":true}');
    });
});
