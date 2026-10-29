import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma.js';
import { withProjectGuard } from './projectAccess.service.js';
import { withOperationWorkspace,beginPreparedPublications,flushPreparedPublications,assertProjectOperationActive,deliverPreparedCommits,deferPreparedCommit,currentProjectOperation } from './projectOperationWorkspace.service.js';
import { publishProjectEvent,deliverProjectEvent } from './projectEvent.service.js';
import { captureWorkspaceFiles,publishPreparedWorkspace } from './projectWorkspacePublish.service.js';
import { projectFileError } from './projectFileVersion.service.js';

export const withPreparedProjectWorkspace = async ({projectId,snapshotId,userId,capability = 'files.write',
    expectedWorkspaceRevision,type = 'PREPARE_WORKSPACE',input = {},publish = true,includeGitMetadata = false,primaryJobId},run) => {
    if (!Number.isSafeInteger(expectedWorkspaceRevision)) throw projectFileError('FILE_VERSION_REQUIRED','Regenerate the proposal to capture the current workspace version',428);
    const operation = await withProjectGuard({projectId,userId,capability},async(tx,access) => {
        if (primaryJobId) {
            const existing = await tx.projectOperation.findUnique({where:{primaryJobId}});
            if (existing) return existing;
            const job = await tx.job.findUnique({where:{id:primaryJobId}});
            if (!job || job.projectId !== projectId || job.snapshotId !== snapshotId || job.userId !== userId) throw projectFileError('RESOURCE_NOT_FOUND','Job does not match this workspace change',404);
        }
        if (access.project.workspaceRevision !== expectedWorkspaceRevision) throw projectFileError('SNAPSHOT_CHANGED','Workspace changed after this proposal was generated');
        const snapshot = await tx.projectSnapshot.findFirst({where:{id:snapshotId,projectId}});
        if (!snapshot?.rootDir) throw projectFileError('SNAPSHOT_CHANGED','Snapshot is unavailable');
        const nonce = randomUUID();
        return tx.projectOperation.create({data:{projectId,snapshotId,actorId:userId,capability,type,inputJson:input,
            requestId:nonce,semanticKey:nonce,capturedWorkspaceRevision:expectedWorkspaceRevision,status:'QUEUED',primaryJobId}});
    });
    return withOperationWorkspace(operation.id,async context => {
        const beforeFiles = await captureWorkspaceFiles(context.rootDir,{includeGitMetadata});
        beginPreparedPublications();
        const result = await run(context);
        const shouldPublish = typeof publish === 'function' ? publish(result) : publish;
        const complete = async (tx,publication) => {
            await assertProjectOperationActive(undefined,tx);
            currentProjectOperation().publicationMetadata = publication;
            await flushPreparedPublications(tx);
            const current = await tx.project.findUnique({where:{id:projectId},select:{workspaceRevision:true}});
            publication.workspaceRevision = current.workspaceRevision + (publication.changedPaths.length ? 1 : 0);
            const status = result?.success === false ? 'FAILED' : 'SUCCESS';
            await tx.projectOperation.update({where:{id:operation.id},data:{status,resultJson:{workspaceRevision:publication.workspaceRevision,changedPaths:publication.changedPaths}}});
            const event = await publishProjectEvent({tx,projectId,type:'operation.finished',actorId:userId,resourceId:primaryJobId || operation.id,
                revision:publication.workspaceRevision,payload:{operationId:operation.id,status}});
            deferPreparedCommit(()=>deliverProjectEvent(event));
        };
        const publication = shouldPublish ? await publishPreparedWorkspace({projectId,snapshotId,userId,capability,
            expectedWorkspaceRevision,beforeFiles,preparedRoot:context.rootDir,requestId:operation.id,afterMutation:complete,includeGitMetadata,
            emitCommittedEvent:async event=>deferPreparedCommit(()=>deliverProjectEvent(event))}) : null;
        if (!shouldPublish) await withProjectGuard({projectId,userId,capability},tx=>complete(tx,{workspaceRevision:expectedWorkspaceRevision,changedPaths:[]}));
        await deliverPreparedCommits();
        return result && typeof result === 'object' ? {...result,...(publication ? {workspaceRevision:publication.workspaceRevision,changedPaths:publication.changedPaths} : {})} : result;
    },{includeGitMetadata});
};
