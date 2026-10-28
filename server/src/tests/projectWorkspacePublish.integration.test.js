import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma.js';
import { assertCollaborationTestDatabase } from './helpers/collaborationDb.js';
import { captureWorkspaceFiles,publishPreparedWorkspace } from '../services/projectWorkspacePublish.service.js';
import { withPreparedProjectWorkspace } from '../services/projectWorkspacePreparation.service.js';
import { readVersionedProjectFile } from '../services/projectFileVersion.service.js';
import { mutateProjectWorkspace } from '../services/projectMutation.service.js';
import { stagePreparedPublication,currentProjectOperation } from '../services/projectOperationWorkspace.service.js';
import { runPreparedSystemJob } from '../services/projectSystemOperation.service.js';
import { getJobById,markJobRunning,markJobSuccess,cancelJob } from '../services/job.service.js';
import { getProjectTree } from '../services/project.service.js';

const suite = process.env.COLLABORATION_INTEGRATION === 'true' ? describe : describe.skip;
suite('prepared multi-file publication against PostgreSQL', () => {
    let safe = false;
    let root,prepared,owner,editor,project,snapshot;
    const operationDirectories = [];
    beforeAll(() => { assertCollaborationTestDatabase(process.env.DATABASE_URL); safe = true; });
    beforeEach(async () => {
        project = undefined;owner = undefined;editor = undefined;
        root = await fs.mkdtemp(path.join(os.tmpdir(),'covai-bulk-source-'));
        prepared = await fs.mkdtemp(path.join(os.tmpdir(),'covai-bulk-prepared-'));
        await fs.writeFile(path.join(root,'a.js'),'canonical');
        await fs.writeFile(path.join(root,'old.js'),'old');
        await fs.cp(root,prepared,{recursive:true});
        const run = randomUUID();
        [owner,editor] = await Promise.all(['owner','editor'].map(name=>prisma.user.create({data:{email:`${name}-${run}@example.test`,name}})));
        project = await prisma.project.create({data:{name:`bulk-${run}`,ownerId:owner.id}});
        snapshot = await prisma.projectSnapshot.create({data:{projectId:project.id,source:'ZIP',rootDir:root,storagePath:root}});
        await prisma.projectMember.create({data:{projectId:project.id,userId:editor.id,role:'EDITOR'}});
    });
    afterEach(async () => {
        if (!safe) return;
        if (project?.id) await prisma.project.deleteMany({where:{id:project.id}});
        const userIds = [owner?.id,editor?.id].filter(Boolean);
        if (userIds.length) await prisma.user.deleteMany({where:{id:{in:userIds}}});
        for (const directory of [root,prepared,...operationDirectories.splice(0)].filter(Boolean)) {
            if (!path.basename(directory).startsWith('covai-bulk-') && !directory.includes(`${path.sep}.covai-temp${path.sep}collaboration-operations${path.sep}`)) throw new Error('Unsafe test cleanup');
            await fs.rm(directory,{recursive:true,force:true});
        }
    });
    afterAll(async () => { if(safe) await prisma.$disconnect(); });
    const publish = (beforeFiles,extra = {}) => publishPreparedWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:editor.id,
        expectedWorkspaceRevision:0,beforeFiles,preparedRoot:prepared,...extra});
    const read = () => readVersionedProjectFile({projectId:project.id,snapshotId:snapshot.id,userId:owner.id,path:'a.js'});

    test('updates, creates and deletes files in one workspace revision', async () => {
        const before = await captureWorkspaceFiles(root);
        await fs.writeFile(path.join(prepared,'a.js'),'prepared');
        await fs.writeFile(path.join(prepared,'new.js'),'new');
        await fs.unlink(path.join(prepared,'old.js'));
        const result = await publish(before);
        expect(result.workspaceRevision).toBe(1);
        expect(result.changedPaths).toEqual(['a.js','new.js','old.js']);
        expect((await read()).content).toBe('prepared');
        expect(await fs.readFile(path.join(root,'new.js'),'utf8')).toBe('new');
        await expect(fs.access(path.join(root,'old.js'))).rejects.toMatchObject({code:'ENOENT'});
        expect(await prisma.projectFileVersion.findUnique({where:{snapshotId_relativePath:{snapshotId:snapshot.id,relativePath:'old.js'}}})).toMatchObject({deleted:true});
    });
    test('rejects a source edit committed while preparation was running', async () => {
        const before = await captureWorkspaceFiles(root);
        await fs.writeFile(path.join(prepared,'a.js'),'prepared');
        const base = await read();
        await mutateProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:owner.id,path:'a.js',kind:'WRITE_FILE',content:'newer',expectedVersion:base.version});
        await expect(publish(before)).rejects.toMatchObject({code:'SNAPSHOT_CHANGED'});
        expect(await fs.readFile(path.join(root,'a.js'),'utf8')).toBe('newer');
    });
    test('publishes binary Git metadata and source together; Editor cannot publish Git metadata', async () => {
        await fs.mkdir(path.join(root,'.git','objects'),{recursive:true});
        await fs.writeFile(path.join(root,'.git','HEAD'),'ref: refs/heads/main\n');
        await fs.writeFile(path.join(root,'.git','objects','blob'),Buffer.from([0,255,1,2]));
        await fs.cp(path.join(root,'.git'),path.join(prepared,'.git'),{recursive:true});
        const before = await captureWorkspaceFiles(root,{includeGitMetadata:true});
        const bytes = Buffer.from([0,128,255,42,0]);
        await fs.writeFile(path.join(prepared,'.git','objects','blob'),bytes);
        await fs.writeFile(path.join(prepared,'.git','HEAD'),'ref: refs/heads/feature\n');
        await fs.writeFile(path.join(prepared,'a.js'),'branch source');
        await expect(publish(before,{includeGitMetadata:true,capability:'integrations.write'})).rejects.toMatchObject({statusCode:403});
        const result = await publish(before,{userId:owner.id,includeGitMetadata:true,capability:'integrations.write'});
        expect(result.workspaceRevision).toBe(1);
        expect(await fs.readFile(path.join(root,'.git','objects','blob'))).toEqual(bytes);
        expect(await fs.readFile(path.join(root,'.git','HEAD'),'utf8')).toContain('feature');
        expect((await read()).content).toBe('branch source');
    });
    test('recovers all files and binary Git metadata after a database failure', async () => {
        await fs.mkdir(path.join(root,'.git'),{recursive:true});
        const original = Buffer.from([0,255,33,0]);
        await fs.writeFile(path.join(root,'.git','index'),original);
        await fs.cp(path.join(root,'.git'),path.join(prepared,'.git'),{recursive:true});
        const before = await captureWorkspaceFiles(root,{includeGitMetadata:true});
        await fs.writeFile(path.join(prepared,'.git','index'),Buffer.from([42,0,42]));
        await fs.writeFile(path.join(prepared,'a.js'),'candidate');
        await fs.unlink(path.join(prepared,'old.js'));
        await expect(publish(before,{userId:owner.id,includeGitMetadata:true,capability:'integrations.write',afterMutation:()=>{throw new Error('injected SQL publication failure');}})).rejects.toThrow('injected SQL');
        expect((await prisma.project.findUnique({where:{id:project.id}})).workspaceRevision).toBe(0);
        expect((await read()).content).toBe('canonical');
        expect(await fs.readFile(path.join(root,'.git','index'))).toEqual(original);
        expect(await fs.readFile(path.join(root,'old.js'),'utf8')).toBe('old');
        expect(await prisma.projectMutation.count({where:{projectId:project.id}})).toBe(0);
    });
    test('deferred SQL publication commits with the source; revoked preparer publishes neither', async () => {
        const run = async context => {
            operationDirectories.push(context.rootDir);
            await fs.writeFile(path.join(context.rootDir,'a.js'),'prepared');
            await stagePreparedPublication(tx=>tx.project.update({where:{id:project.id},data:{description:'committed with source'}}));
            return {prepared:true};
        };
        const result = await withPreparedProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:editor.id,expectedWorkspaceRevision:0},run);
        expect(result).toMatchObject({prepared:true,workspaceRevision:1});
        expect((await prisma.project.findUnique({where:{id:project.id}})).description).toBe('committed with source');
        expect((await read()).content).toBe('prepared');
        await expect(withPreparedProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:editor.id,expectedWorkspaceRevision:1},async context=>{
            operationDirectories.push(context.rootDir);
            await fs.writeFile(path.join(context.rootDir,'a.js'),'revoked draft');
            await stagePreparedPublication(tx=>tx.project.update({where:{id:project.id},data:{description:'must not publish'}}));
            await prisma.projectMember.delete({where:{projectId_userId:{projectId:project.id,userId:editor.id}}});
        })).rejects.toMatchObject({statusCode:404});
        expect((await read()).content).toBe('prepared');
        expect((await prisma.project.findUnique({where:{id:project.id}})).description).toBe('committed with source');
    });
    test('identical-source metadata publication returns the actual committed revision',async()=>{
        const result = await withPreparedProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:editor.id,expectedWorkspaceRevision:0},async context=>{
            operationDirectories.push(context.rootDir);
            await stagePreparedPublication(async tx=>{
                expect(currentProjectOperation().publicationMetadata.changedPaths).toEqual([]);
                await tx.project.update({where:{id:project.id},data:{workspaceRevision:{increment:1}}});
            });
            return {prepared:true};
        });
        expect(result).toMatchObject({workspaceRevision:1,changedPaths:[]});
        const operation = await prisma.projectOperation.findFirst({where:{projectId:project.id}});
        expect(operation.resultJson.workspaceRevision).toBe(1);
        expect(await prisma.projectEvent.findFirst({where:{projectId:project.id,type:'operation.finished'}})).toMatchObject({revision:1});
        expect((await read()).content).toBe('canonical');
    });
    test('ZIP monorepo keeps frontend siblings and one version identity for canonical and legacy editor paths',async()=>{
        await fs.mkdir(path.join(root,'server','src'),{recursive:true});
        await fs.mkdir(path.join(root,'client'),{recursive:true});
        await fs.writeFile(path.join(root,'server','package.json'),'{}');
        await fs.writeFile(path.join(root,'client','package.json'),'{}');
        await fs.writeFile(path.join(root,'server','src','a.js'),'backend');
        await prisma.projectSnapshot.update({where:{id:snapshot.id},data:{rootDir:path.join(root,'server')}});
        const legacy = await readVersionedProjectFile({projectId:project.id,snapshotId:snapshot.id,userId:editor.id,path:'src/a.js'});
        const canonical = await readVersionedProjectFile({projectId:project.id,snapshotId:snapshot.id,userId:owner.id,path:'server/src/a.js'});
        expect(legacy.path).toBe('server/src/a.js');
        expect(canonical.version).toEqual(legacy.version);
        expect((await getProjectTree(project.id,owner.id)).map(row=>row.name)).toEqual(expect.arrayContaining(['client','server']));
        await mutateProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:editor.id,path:'src/a.js',kind:'WRITE_FILE',content:'changed backend',expectedVersion:legacy.version});
        await expect(mutateProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:owner.id,path:'server/src/a.js',kind:'WRITE_FILE',content:'stale',expectedVersion:canonical.version})).rejects.toMatchObject({code:'FILE_VERSION_CONFLICT'});
        await withPreparedProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:owner.id,expectedWorkspaceRevision:1},async context=>{
            operationDirectories.push(context.rootDir);
            expect(context.analysisRelative).toBe('server');
            expect(await fs.readFile(path.join(context.rootDir,'client','package.json'),'utf8')).toBe('{}');
            await fs.writeFile(path.join(context.rootDir,'client','App.jsx'),'export default 1');
        });
        expect(await fs.readFile(path.join(root,'client','App.jsx'),'utf8')).toBe('export default 1');
    });
    test('system job source and terminal state publish together; a canceled system job publishes neither',async()=>{
        const job = await prisma.job.create({data:{projectId:project.id,snapshotId:snapshot.id,userId:editor.id,type:'SYSTEM_TEST_ANALYSIS',status:'QUEUED'}});
        await runPreparedSystemJob(job.id,async()=>{
            await markJobRunning(job.id);
            const execution = await getJobById(job.id);
            operationDirectories.push(execution.snapshot.rootDir);
            await fs.writeFile(path.join(execution.snapshot.rootDir,'a.js'),'system prepared source');
            await stagePreparedPublication(tx=>tx.project.update({where:{id:project.id},data:{description:'system committed'}}));
            await markJobSuccess(job.id,{fixture:true});
            expect((await prisma.job.findUnique({where:{id:job.id}})).status).toBe('RUNNING');
            expect(await fs.readFile(path.join(root,'a.js'),'utf8')).toBe('canonical');
        });
        expect((await prisma.job.findUnique({where:{id:job.id}})).status).toBe('SUCCESS');
        expect((await read()).content).toBe('system prepared source');
        const canceled = await prisma.job.create({data:{projectId:project.id,snapshotId:snapshot.id,userId:editor.id,type:'SYSTEM_TEST_ANALYSIS',status:'QUEUED'}});
        await expect(runPreparedSystemJob(canceled.id,async()=>{
            await markJobRunning(canceled.id);
            const execution = await getJobById(canceled.id);
            operationDirectories.push(execution.snapshot.rootDir);
            await fs.writeFile(path.join(execution.snapshot.rootDir,'a.js'),'canceled candidate');
            await cancelJob(canceled.id);
        })).rejects.toMatchObject({code:'OPERATION_CANCELED'});
        expect((await read()).content).toBe('system prepared source');
        expect((await prisma.job.findUnique({where:{id:canceled.id}})).status).toBe('CANCELED');
    });
});
