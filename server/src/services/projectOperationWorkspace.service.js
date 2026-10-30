import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import prisma from '../config/prisma.js';
import { withProjectGuard, resolveProjectAccess } from './projectAccess.service.js';
import { projectFileError,projectEditableWorkspaceRoot } from './projectFileVersion.service.js';
import { runtimeIgnoredDirectories } from './projectRuntimePlan.service.js';
import { ACTIVE_PROJECT_OPERATIONS, publishOperationResults } from './projectOperation.service.js';
import { recoverProjectMutationMarkers } from './projectMutationRecovery.service.js';
import { publishProjectEvent,deliverProjectEvent } from './projectEvent.service.js';

const contexts = new AsyncLocalStorage();
const serverRoot = fileURLToPath(new URL('../../',import.meta.url));
export const currentProjectOperation = () => contexts.getStore();
export const beginPreparedPublications = () => { const context = contexts.getStore(); if (context) context.preparedPublications = []; };
export const stagePreparedPublication = async (run,{failureSafe = false} = {}) => {
    const context = contexts.getStore();
    if (context?.flushingPreparedPublications && context.publicationTx) return run(context.publicationTx);
    if (context?.preparedPublications) { if(failureSafe) run.failureSafe = true;context.preparedPublications.push(run); return null; }
    return withOperationPublishGuard(run);
};
export const stagePreparedFailure = run => stagePreparedPublication(run,{failureSafe:true});
export const stagePreparedValue = async (run,placeholder) => {
    if (contexts.getStore()?.preparedPublications) { await stagePreparedPublication(run);return placeholder; }
    return withOperationPublishGuard(run);
};
export const flushPreparedPublications = async (tx,{failureOnly = false} = {}) => {
    const context = contexts.getStore();
    if (context) { context.flushingPreparedPublications = true;context.publicationTx = tx; }
    try {
        for (const run of context?.preparedPublications || []) { if(!failureOnly || run.failureSafe) await run(tx); }
        if (context) context.preparedPublications = [];
    } finally { if (context) { context.flushingPreparedPublications = false;delete context.publicationTx; } }
};
export const deferPreparedCommit = run => {
    const context = contexts.getStore();
    if (context) { context.afterCommit ||= [];context.afterCommit.push(run); }
};
export const deliverPreparedCommits = async () => {
    const context = contexts.getStore();
    for (const run of context?.afterCommit || []) { try { await run(); } catch { /* Persisted state is repaired by normal refetch/replay. */ } }
    if (context) context.afterCommit = [];
};
export const operationSnapshot = snapshot => {
    const context = contexts.getStore();
    if (!context || context.snapshotId !== snapshot?.id) return snapshot;
    return {...snapshot,rootDir:path.join(context.rootDir,context.analysisRelative),storagePath:context.rootDir,
        originalRootDir:path.join(context.originalRootDir,context.analysisRelative),originalStoragePath:context.originalRootDir,
        jestConfigPath:snapshot.jestConfigPath && path.isAbsolute(snapshot.jestConfigPath)
            ? path.join(context.rootDir,path.relative(context.originalRootDir,snapshot.jestConfigPath)) : snapshot.jestConfigPath};
};

export const assertProjectOperationActive = async (context = contexts.getStore(),db = prisma) => {
    if (!context) return;
    const {project} = await resolveProjectAccess({projectId:context.projectId,userId:context.userId,capability:context.capability,db});
    const operation = await db.projectOperation.findUnique({where:{id:context.operationId}});
    const job = context.jobId ? await db.job.findUnique({where:{id:context.jobId}}) : null;
    if (!operation || !ACTIVE_PROJECT_OPERATIONS.includes(operation.status) || job?.status === 'CANCELED') throw projectFileError('OPERATION_CANCELED','Operation was canceled');
    if (project.workspaceRevision !== context.workspaceRevision) {
        if (operation?.type === 'APPLY_UNIT_SUGGESTION') {
            context.workspaceRevision = project.workspaceRevision;
        } else {
            throw projectFileError('OPERATION_STALE','Source changed while this operation was running');
        }
    }
};

export const withOperationPublishGuard = async run => {
    const context = contexts.getStore();
    if (!context) return run(prisma);
    if (context.flushingPreparedPublications && context.publicationTx) return run(context.publicationTx);
    return withProjectGuard({projectId:context.projectId,userId:context.userId,capability:context.capability},async tx => {
        await assertProjectOperationActive(context,tx);
        return run(tx);
    });
};

export const withOperationWorkspace = async (operationId,run,{includeGitMetadata = false,deferResults = false} = {}) => {
    const operation = await prisma.projectOperation.findUnique({where:{id:operationId}});
    if (!operation) throw projectFileError('RESOURCE_NOT_FOUND','Operation not found',404);
    const workspaceParent = path.join(serverRoot,'.covai-temp','collaboration-operations');
    // operation IDs are DB-created, but still validate before forming disk paths.
    if (!/^[A-Za-z0-9_-]+$/.test(operationId)) throw projectFileError('INVALID_OPERATION','Invalid operation identity',400);
    const rootDir = path.join(workspaceParent,operationId);
    let context;
    await withProjectGuard({projectId:operation.projectId,userId:operation.actorId,capability:operation.capability,maxWait:60000,timeout:120000},async (tx,access) => {
        const current = await tx.projectOperation.findUnique({where:{id:operationId}});
        if (!['QUEUED','ADMITTED'].includes(current?.status)) return;
        if (access.project.workspaceRevision !== current.capturedWorkspaceRevision) {
            throw projectFileError('OPERATION_STALE','Source changed before the operation could start');
        }
        const snapshot = await tx.projectSnapshot.findFirst({where:{id:operation.snapshotId,projectId:operation.projectId}});
        if (!snapshot?.rootDir) throw projectFileError('SNAPSHOT_CHANGED','Snapshot is unavailable');
        const originalRootDir = projectEditableWorkspaceRoot(snapshot);
        await recoverProjectMutationMarkers({tx,project:access.project,snapshot,root:originalRootDir});
        await fs.mkdir(workspaceParent,{recursive:true});
        try { await fs.access(rootDir); throw projectFileError('RECOVERY_REQUIRED','An interrupted operation workspace needs recovery'); }
        catch(error) { if (error.code !== 'ENOENT') throw error; }
        await fs.cp(originalRootDir,rootDir,{recursive:true,dereference:false,errorOnExist:true,
            filter:async source => {
                const name = path.basename(source);
                const relative = path.relative(originalRootDir,source).replaceAll('\\','/');
                const inGit = includeGitMetadata && (relative === '.git' || relative.startsWith('.git/'));
                if (!inGit && source !== originalRootDir && (runtimeIgnoredDirectories.has(name) || name === '.env' || name.startsWith('.env.'))) return false;
                const stat = await fs.lstat(source);
                return !stat.isSymbolicLink();
            }});
        context = {operationId,projectId:operation.projectId,snapshotId:snapshot.id,userId:operation.actorId,
            capability:operation.capability,jobId:operation.primaryJobId,workspaceRevision:operation.capturedWorkspaceRevision,
            rootDir,originalRootDir,analysisRelative:path.relative(originalRootDir,snapshot.rootDir)};
        await tx.projectOperation.update({where:{id:operationId},data:{status:'RUNNING'}});
    });
    if (!context) return {skipped:true,operationId};
    try {
        const result = await contexts.run(context,async()=>{
            if (deferResults) beginPreparedPublications();
            const value = await run({...context,assertActive:()=>assertProjectOperationActive(context)});
            if (deferResults) {
                await withProjectGuard({projectId:context.projectId,userId:context.userId,capability:context.capability,maxWait:30000,timeout:60000},async tx=>{
                    await assertProjectOperationActive(context,tx);
                    const before = await tx.job.findUnique({where:{id:context.jobId}});
                    await flushPreparedPublications(tx,{failureOnly:before?.status === 'FAILED'});
                    const completed = await tx.job.findUnique({where:{id:context.jobId}});
                    if (!['SUCCESS','FAILED'].includes(completed?.status)) throw projectFileError('OPERATION_INCOMPLETE','Worker returned without completing its job',500);
                    const result = completed.resultJson ? JSON.parse(completed.resultJson) : {};
                    await tx.projectOperation.update({where:{id:operationId},data:{status:completed.status,resultJson:result}});
                    const event = await publishProjectEvent({tx,projectId:context.projectId,type:'operation.finished',actorId:context.userId,
                        resourceId:context.jobId,revision:context.workspaceRevision,payload:{operationId,status:completed.status}});
                    deferPreparedCommit(()=>deliverProjectEvent(event));
                });
                await deliverPreparedCommits();
            }
            return value;
        });
        if (!operation.primaryJobId) return result;
        const completed = await prisma.projectOperation.findUnique({where:{id:operationId},select:{status:true}});
        if (completed?.status === 'SUCCESS') return result;
        const job = await prisma.job.findUnique({where:{id:operation.primaryJobId}});
        if (job.status === 'SUCCESS') {
            await publishOperationResults({operationId,result:job.resultJson ? JSON.parse(job.resultJson) : {},expectedWorkspaceRevision:context.workspaceRevision});
        } else if (['FAILED','CANCELED'].includes(job.status)) {
            await prisma.projectOperation.updateMany({where:{id:operationId,status:{in:ACTIVE_PROJECT_OPERATIONS}},data:{status:job.status}});
        } else throw projectFileError('OPERATION_INCOMPLETE','Worker returned without completing its job',500);
        return result;
    }
    catch(error) {
        const status = error.code === 'OPERATION_STALE' ? 'STALE' : error.code === 'OPERATION_CANCELED' ? 'CANCELED' : 'FAILED';
        await prisma.projectOperation.updateMany({where:{id:operationId,status:{in:ACTIVE_PROJECT_OPERATIONS}},data:{status}}).catch(()=>{});
        throw error;
    }
    // Workspace is kept for diagnostic artifacts, not copied back to source.
};

export const runJobInOperationWorkspace = async (jobId,run) => {
    const operation = await prisma.projectOperation.findUnique({where:{primaryJobId:jobId}});
    if (!operation) throw projectFileError('OPERATION_CONTEXT_REQUIRED','This legacy job has no guarded operation context. Submit it again.',409);
    try { return await withOperationWorkspace(operation.id,run,{deferResults:true}); }
    catch(error) {
        const status = error.code === 'OPERATION_STALE' ? 'STALE' : error.code === 'OPERATION_CANCELED' ? 'CANCELED' : 'FAILED';
        await prisma.projectOperation.updateMany({where:{id:operation.id,status:{in:ACTIVE_PROJECT_OPERATIONS}},data:{status}}).catch(()=>{});
        await prisma.job.updateMany({where:{id:jobId,status:{in:['QUEUED','RUNNING']}},data:{status:'FAILED',finishedAt:new Date(),
            errorMessage:error.statusCode ? `${error.code || 'OPERATION_FAILED'}: ${error.message}` : 'Guarded operation failed; inspect the job log'}}).catch(()=>{});
        throw error;
    }
};
