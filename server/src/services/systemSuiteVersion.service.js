import { assertSystemSuiteStorage } from './systemSuiteAvailability.service.js';
import { parse } from '@babel/parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import prisma from '../config/prisma.js';
import { resolveSnapshotAccess, withProjectGuard } from './projectAccess.service.js';
import { assertEditorReplacementAllowed } from './projectEditorBridge.service.js';
import { projectEditableWorkspaceRoot } from './projectFileVersion.service.js';
import { withPreparedProjectWorkspace } from './projectWorkspacePreparation.service.js';
import { stagePreparedPublication } from './projectOperationWorkspace.service.js';
import { containedPath } from './fullSystemConfig.service.js';
import { captureSystemSuiteManifest, suiteDigest } from './systemSuiteManifest.service.js';
import { syncSystemScenarioCatalog } from './systemScenarioCatalog.service.js';
import { ServiceError } from '../utils/serviceError.js';

export const readSystemSuiteVersion = async ({snapshotId,versionId,userId,db=prisma}) => {
    const access = await resolveSnapshotAccess({snapshotId,userId,capability:'project.read',db});
    const version = await db.systemSuiteVersion.findFirst({where:{id:versionId,snapshotId}});
    if (!version) throw new ServiceError('Test version not found',404);
    return {...access,version};
};

export const commitSystemSuiteVersion = async ({tx,snapshotId,capture,userId,requestId,action='APPLY',baseline,restoredFromVersionId=null,provenance={}}) => {
    const requestHash = suiteDigest({action,suiteHash:capture.suiteHash,restoredFromVersionId,...provenance});
    const prior = await tx.systemSuiteVersion.findUnique({where:{snapshotId_requestId:{snapshotId,requestId}}});
    if(prior) {
        if(prior.actorId!==userId || prior.requestHash!==requestHash) throw new ServiceError('Request identifier was reused for another test change',409);
        return prior;
    }
    let state = await tx.systemSuiteState.findUnique({where:{snapshotId}});
    if (!state && action!=='BASELINE' && baseline) await commitSystemSuiteVersion({tx,snapshotId,capture:baseline,userId,requestId:'initial-baseline',action:'BASELINE'});
    state = await tx.systemSuiteState.findUnique({where:{snapshotId}});
    for (const blob of capture.blobs) await tx.systemTestBlob.upsert({where:{sha256:blob.sha256},create:blob,update:{}});
    const scenarios = await tx.systemScenario.findMany({where:{snapshotId}});
    const version = await tx.systemSuiteVersion.create({data:{snapshotId,sequence:(state?.revision||0)+1,action,parentVersionId:state?.headVersionId||null,restoredFromVersionId,suiteHash:capture.suiteHash,sourceHash:capture.sourceHash,configHash:capture.configHash,manifestJson:capture.manifest,scenarioSnapshotJson:scenarios,provenanceJson:{identityVersion:capture.identityVersion,dependencies:capture.dependencies,...provenance},actorId:userId,requestId,requestHash}});
    await tx.systemSuiteState.upsert({where:{snapshotId},create:{snapshotId,headVersionId:version.id,revision:version.sequence},update:{headVersionId:version.id,revision:version.sequence}});
    return version;
};

export const systemSuiteHistory = async ({snapshotId,userId,limit=20,cursor,db=prisma}) => {
    const {snapshot,project} = await resolveSnapshotAccess({snapshotId,userId,capability:'project.read',db});
    assertSystemSuiteStorage(db);
    const state = await db.systemSuiteState.findUnique({where:{snapshotId}});
    const where = {snapshotId};
    if(cursor) {const row=await db.systemSuiteVersion.findFirst({where:{snapshotId,id:cursor}});if(!row)throw new ServiceError('Version cursor not found',404);where.sequence={lt:row.sequence};}
    const items = await db.systemSuiteVersion.findMany({where,orderBy:{sequence:'desc'},take:limit+1});
    const current = await captureSystemSuiteManifest({rootDir:projectEditableWorkspaceRoot(snapshot)});
    const head = state?.headVersionId ? await db.systemSuiteVersion.findUnique({where:{id:state.headVersionId}}) : null;
    return {initialized:!!state,headId:state?.headVersionId||null,workingChanges:!!head && current.suiteHash!==head.suiteHash,suiteHash:current.suiteHash,sourceHash:current.sourceHash,workspaceRevision:project.workspaceRevision,items:items.slice(0,limit).map(({manifestJson,scenarioSnapshotJson,...row})=>({...row,fileCount:manifestJson.length,scenarioCount:scenarioSnapshotJson.length})),nextCursor:items.length>limit?items[limit-1].id:null};
};

export const recordCurrentSystemSuite = async ({snapshotId,userId,input,db=prisma}) => {
    const {snapshot} = await resolveSnapshotAccess({snapshotId,userId,capability:'evidence.approve',db});
    const capture=await captureSystemSuiteManifest({rootDir:projectEditableWorkspaceRoot(snapshot)});
    if(capture.suiteHash!==input.expectedSuiteHash || capture.sourceHash!==input.expectedSourceHash)throw new ServiceError('Workspace changed. Review the current test files again.',409);
    return withProjectGuard({projectId:snapshot.projectId,userId,capability:'evidence.approve',db},async(tx,access)=>{
        const latest=await tx.projectSnapshot.findFirst({where:{projectId:snapshot.projectId},orderBy:{createdAt:'desc'},select:{id:true}});
        if(latest?.id!==snapshotId || access.project.workspaceRevision!==input.expectedWorkspaceRevision)throw new ServiceError('The active workspace changed',409);
        if(await tx.job.findFirst({where:{snapshotId,status:{in:['QUEUED','RUNNING']}}}))throw new ServiceError('Wait for the active job before recording test changes',409);
        await assertEditorReplacementAllowed({tx,projectId:snapshot.projectId,snapshotId,paths:capture.manifest.map(file=>file.path)});
        const state=await tx.systemSuiteState.findUnique({where:{snapshotId}});
        if((state?.headVersionId||null)!==(input.expectedHeadId||null))throw new ServiceError('Test version changed. Refresh the history.',409);
        return commitSystemSuiteVersion({tx,snapshotId,capture,userId,requestId:input.requestId,action:state?'APPLY':'BASELINE',provenance:{source:'REVIEWED_WORKING_CHANGES'}});
    });
};

export const compareSystemSuiteVersions = async ({snapshotId,from,to,userId,db=prisma}) => {
    const {version:a} = await readSystemSuiteVersion({snapshotId,versionId:from,userId,db});
    const {version:b} = await readSystemSuiteVersion({snapshotId,versionId:to,userId,db});
    const before = new Map(a.manifestJson.map(file=>[file.path,file])),after = new Map(b.manifestJson.map(file=>[file.path,file]));
    const files = [];
    for(const name of new Set([...before.keys(),...after.keys()])) if(before.get(name)?.sha256!==after.get(name)?.sha256) {
        const content = async file => file ? (await db.systemTestBlob.findUnique({where:{sha256:file.sha256}}))?.content ?? null : null;
        files.push({path:name,status:!before.has(name)?'ADDED':!after.has(name)?'DELETED':'MODIFIED',before:await content(before.get(name)),after:await content(after.get(name))});
    }
    const identity=row=>`${row.filePath||''}\0${row.title}`;
    const oldScenarios=new Map(a.scenarioSnapshotJson.map(row=>[identity(row),row])),newScenarios=new Map(b.scenarioSnapshotJson.map(row=>[identity(row),row]));
    const scenarios=[];
    for(const name of new Set([...oldScenarios.keys(),...newScenarios.keys()])){
        const before=oldScenarios.get(name),after=newScenarios.get(name);
        const signature=row=>row?JSON.stringify([row.flowJson,row.inputJson,row.expectedJson,row.criterionIds,row.reviewState]):null;
        if(signature(before)!==signature(after))scenarios.push({title:(after||before).title,filePath:(after||before).filePath,status:!before?'ADDED':!after?'DELETED':'MODIFIED'});
    }
    return {from:a.id,to:b.id,files,scenarios,canCompareMeasurements:a.sourceHash===b.sourceHash && a.configHash===b.configHash};
};

export const restoreSystemSuiteVersion = async ({snapshotId,versionId,userId,input,db=prisma}) => {
    const {snapshot,project} = await resolveSnapshotAccess({snapshotId,userId,capability:'evidence.approve',db});
    const {version:target} = await readSystemSuiteVersion({snapshotId,versionId,userId,db});
    const prior = await db.systemSuiteVersion.findUnique({where:{snapshotId_requestId:{snapshotId,requestId:input.requestId}}});
    if(prior) {
        if(prior.actorId!==userId || prior.restoredFromVersionId!==versionId || prior.provenanceJson.requestInputHash!==suiteDigest(input)) throw new ServiceError('Request identifier was reused',409);
        return {versionId:prior.id,suiteHash:prior.suiteHash,reused:true};
    }
    const state = await db.systemSuiteState.findUnique({where:{snapshotId}});
    if(!state || state.headVersionId!==input.expectedHeadId || project.workspaceRevision!==input.expectedWorkspaceRevision) throw new ServiceError('Test version or workspace changed. Refresh before restoring.',409);
    const head = await db.systemSuiteVersion.findUnique({where:{id:state.headVersionId}});
    const root = projectEditableWorkspaceRoot(snapshot);
    const current = await captureSystemSuiteManifest({rootDir:root,excludedPaths:target.manifestJson.map(file=>file.path)});
    if(current.suiteHash!==head.suiteHash || current.suiteHash!==input.expectedSuiteHash) throw new ServiceError('Test files have unrecorded edits. Compare and save your changes before restoring.',409);
    if(current.sourceHash!==input.expectedSourceHash || target.sourceHash!==current.sourceHash || target.configHash!==current.configHash) throw new ServiceError('This version uses different application source or shared setup. Restore its project snapshot first.',409,'VERSION_SOURCE_MISMATCH');
    if(head.id===target.id) return {versionId:head.id,suiteHash:head.suiteHash,reused:true};
    const busy = await db.job.findFirst({where:{snapshotId,status:{in:['QUEUED','RUNNING']}},select:{id:true}});
    if(busy)throw new ServiceError('Wait for the active project job before restoring tests.',409);
    const blobs = new Map();
    for(const file of target.manifestJson) {
        const blob = await db.systemTestBlob.findUnique({where:{sha256:file.sha256}});
        if(!blob || suiteDigest(blob.content)!==file.sha256) throw new ServiceError('Version content is missing or invalid',409);
        if(/\.[cm]?[jt]sx?$/.test(file.path)){try{parse(blob.content,{sourceType:'unambiguous',plugins:['typescript','jsx']});}catch{throw new ServiceError(`Saved test file has invalid syntax: ${file.path}`,422);}}
        blobs.set(file.path,blob.content);
    }
    let restored;
    const result = await withPreparedProjectWorkspace({projectId:snapshot.projectId,snapshotId,userId,capability:'evidence.approve',expectedWorkspaceRevision:input.expectedWorkspaceRevision,type:'SYSTEM_TEST_RESTORE',input:{versionId,requestId:input.requestId}},async context=>{
        for(const file of head.manifestJson) if(!blobs.has(file.path)) await fs.unlink(containedPath(context.rootDir,file.path));
        for(const [name,content] of blobs) {const file=containedPath(context.rootDir,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content,'utf8');}
        const capture = await captureSystemSuiteManifest({rootDir:context.rootDir,specPaths:target.manifestJson.filter(file=>file.role==='SPEC').map(file=>file.path)});
        if(capture.suiteHash!==target.suiteHash) throw new ServiceError('Restored suite does not match its saved manifest',409);
        await stagePreparedPublication(async tx=>{
            const live = await tx.systemSuiteState.findUnique({where:{snapshotId}});
            if(live.headVersionId!==head.id) throw new ServiceError('Test version changed during restore',409);
            await syncSystemScenarioCatalog({client:tx,snapshotId,rootDir:path.join(context.rootDir,context.analysisRelative)});
            await tx.systemScenario.updateMany({where:{snapshotId,filePath:{not:null}},data:{reviewState:'STALE',reviewedAt:null,reviewedByUserId:null}});
            restored = await commitSystemSuiteVersion({tx,snapshotId,capture,userId,requestId:input.requestId,action:'RESTORE',restoredFromVersionId:target.id,provenance:{requestInputHash:suiteDigest(input)}});
        });
        return {};
    });
    return {...result,versionId:restored.id,suiteHash:restored.suiteHash};
};
