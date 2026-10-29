import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma.js';
import {assertCollaborationTestDatabase} from "./helpers/collaborationDb.js";
import { readVersionedProjectFile } from '../services/projectFileVersion.service.js';
import { mutateProjectWorkspace } from '../services/projectMutation.service.js';

const enabled = process.env.COLLABORATION_INTEGRATION === 'true';
const suite = enabled ? describe : describe.skip;
suite('project file mutation against real PostgreSQL', () => {
    let disposableVerified = false;
    let root;
    let owner;
    let editor;
    let viewer;
    let project;
    let snapshot;
    beforeAll(() => { assertCollaborationTestDatabase(process.env.DATABASE_URL); disposableVerified = true; });
    beforeEach(async () => {
        project = undefined; owner = undefined; editor = undefined; viewer = undefined;
        root = await fs.mkdtemp(path.join(os.tmpdir(),'covai-file-db-'));
        await fs.writeFile(path.join(root,'a.js'),'original');
        const run = randomUUID();
        [owner,editor,viewer] = await Promise.all(['owner','editor','viewer'].map(name => prisma.user.create({data:{email:`${name}-${run}@example.test`,name}})));
        project = await prisma.project.create({data:{ownerId:owner.id,name:`file-${run}`}});
        snapshot = await prisma.projectSnapshot.create({data:{projectId:project.id,source:'ZIP',storagePath:root,rootDir:root}});
        await prisma.projectMember.createMany({data:[{projectId:project.id,userId:editor.id,role:'EDITOR'},{projectId:project.id,userId:viewer.id,role:'VIEWER'}]});
    });
    afterEach(async () => {
        if (!disposableVerified) return;
        if (project) await prisma.project.delete({where:{id:project.id}});
        const userIds = [owner,editor,viewer].filter(Boolean).map(user=>user.id);
        if (userIds.length) await prisma.user.deleteMany({where:{id:{in:userIds}}});
        if (root) await fs.rm(root,{recursive:true,force:true});
    });
    afterAll(async () => { if(disposableVerified) await prisma.$disconnect(); });

    const read = actor => readVersionedProjectFile({projectId:project.id,snapshotId:snapshot.id,userId:actor.id,path:'a.js'});
    const save = (actor,version,content,extra = {}) => mutateProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,
        userId:actor.id,path:'a.js',content,expectedVersion:version,kind:'WRITE_FILE',...extra});
    test('two saves from one version commit exactly once and retain the winning bytes', async () => {
        const base = await read(owner);
        const outcomes = await Promise.allSettled([save(owner,base.version,'owner edit'),save(editor,base.version,'editor edit')]);
        expect(outcomes.filter(result=>result.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.find(result=>result.status === 'rejected').reason).toMatchObject({code:'FILE_VERSION_CONFLICT'});
        const after = await read(viewer);
        expect(['owner edit','editor edit']).toContain(after.content);
        expect(after.version.revision).toBe(base.version.revision + 1);
        expect(after.workspaceRevision).toBe(1);
    });
    test('Viewer cannot save even with a valid version and removal denies the former Editor', async () => {
        const base = await read(viewer);
        await expect(save(viewer,base.version,'forged')).rejects.toMatchObject({statusCode:403});
        await prisma.projectMember.delete({where:{projectId_userId:{projectId:project.id,userId:editor.id}}});
        await expect(save(editor,base.version,'removed')).rejects.toMatchObject({statusCode:404});
        expect(await fs.readFile(path.join(root,'a.js'),'utf8')).toBe('original');
    });
    test('missing version/snapshot fails closed and snapshot from another project cannot be selected', async () => {
        await expect(save(owner,undefined,'missing')).rejects.toMatchObject({statusCode:428});
        const base = await read(owner);
        await expect(save(owner,base.version,'wrong',{snapshotId:'not-this-project'})).rejects.toMatchObject({code:'SNAPSHOT_CHANGED'});
    });
    test('delete/recreate never accepts a stale pre-delete version', async () => {
        const base = await read(owner);
        await mutateProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:owner.id,path:'a.js',kind:'DELETE_ENTRY',expectedWorkspaceRevision:0});
        await mutateProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:owner.id,path:'a.js',content:'original',kind:'CREATE_FILE',expectedWorkspaceRevision:1});
        await expect(save(editor,base.version,'stale edit')).rejects.toMatchObject({code:'FILE_VERSION_CONFLICT'});
        expect((await read(owner)).version.revision).toBeGreaterThan(base.version.revision);
    });
});
