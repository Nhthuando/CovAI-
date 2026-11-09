import { randomUUID, createHash } from 'node:crypto';
import prisma from '../config/prisma.js';
import { RESULT_PUBLICATION_TIMEOUT_MS } from '../config/projectTransactions.js';
import { withProjectGuard } from './projectAccess.service.js';
import { withOperationWorkspace,beginPreparedPublications,flushPreparedPublications,assertProjectOperationActive,deliverPreparedCommits,deferPreparedCommit,currentProjectOperation } from './projectOperationWorkspace.service.js';
import { publishProjectEvent,deliverProjectEvent } from './projectEvent.service.js';
import { captureWorkspaceFiles,publishPreparedWorkspace } from './projectWorkspacePublish.service.js';
import { projectFileError } from './projectFileVersion.service.js';
import { recoverProjectMutationMarkers } from './projectMutationRecovery.service.js';
import { measureUnitTestPhase } from './unitTestWork.service.js';

export const withPreparedProjectWorkspace = async ({projectId,snapshotId,userId,capability = 'files.write',
    expectedWorkspaceRevision,type = 'PREPARE_WORKSPACE',input = {},publish = true,includeGitMetadata = false,primaryJobId,requestId, resume = false,validateSnapshot},run) => {
    if (!Number.isSafeInteger(expectedWorkspaceRevision)) throw projectFileError('FILE_VERSION_REQUIRED','Regenerate the proposal to capture the current workspace version',428);
    const semanticKey = requestId ? createHash('sha256').update(JSON.stringify({ type, snapshotId, input })).digest('hex') : null;
    let resuming = false;
    const operation = await withProjectGuard({projectId,userId,capability,maxWait:30000,timeout:60000},async(tx,access) => {
        if (requestId) {
            const existing = await tx.projectOperation.findFirst({ where: { projectId, actorId: userId, requestId } });
            if (existing) {
                if (existing.semanticKey !== semanticKey) throw projectFileError('REQUEST_CONFLICT','This request ID belongs to a different test batch',409);
                if (existing.status === 'WAITING_FOR_ENV' && resume) {
                    if (access.project.workspaceRevision !== existing.capturedWorkspaceRevision) throw projectFileError('OPERATION_STALE','Source changed while waiting for environment configuration',409);
                    resuming = true;
                    return tx.projectOperation.update({ where: { id: existing.id }, data: { status: 'QUEUED' } });
                }
                if (['SUCCESS','FAILED','WAITING_FOR_ENV'].includes(existing.status)) return existing;
                throw projectFileError('OPERATION_BUSY','This batch is already running',409);
            }
        }
        if (validateSnapshot) {
            const snapshot = await tx.projectSnapshot.findFirst({where:{id:snapshotId,projectId}});
            if (!snapshot) throw projectFileError('SNAPSHOT_NOT_READY','Project snapshot is unavailable',409);
            await validateSnapshot(snapshot);
        }
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
            requestId:requestId || nonce,semanticKey:semanticKey || nonce,capturedWorkspaceRevision:expectedWorkspaceRevision,status:'QUEUED',primaryJobId}});
    });
    if (requestId && !resuming && ['SUCCESS','FAILED','WAITING_FOR_ENV'].includes(operation.status)) return { ...operation.resultJson, operationId: operation.id, requestId, reused: true };
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
            const status = result?.status === 'WAITING_FOR_ENV' ? 'WAITING_FOR_ENV' : result?.success === false ? 'FAILED' : 'SUCCESS';
            await tx.projectOperation.update({where:{id:operation.id},data:{status,resultJson:{ ...(requestId ? result : {}), workspaceRevision:publication.workspaceRevision,changedPaths:publication.changedPaths}}});
            const event = await publishProjectEvent({tx,projectId,type:'operation.finished',actorId:userId,resourceId:primaryJobId || operation.id,
                revision:publication.workspaceRevision,payload:{operationId:operation.id,status}});
            deferPreparedCommit(()=>deliverProjectEvent(event));
        };
        const completeNonPublish = async (tx) => {
            await assertProjectOperationActive(undefined, tx);
            const status = result?.status === 'WAITING_FOR_ENV' ? 'WAITING_FOR_ENV' : result?.success === false ? 'FAILED' : 'SUCCESS';
            await tx.projectOperation.update({
                where: { id: operation.id },
                data: {
                    status,
                    resultJson: {
                        ...(requestId ? result : {}),
                        workspaceRevision: expectedWorkspaceRevision,
                        changedPaths: []
                    }
                }
            });
            const event = await publishProjectEvent({
                tx,
                projectId,
                type: 'operation.finished',
                actorId: userId,
                resourceId: primaryJobId || operation.id,
                revision: expectedWorkspaceRevision,
                payload: { operationId: operation.id, status }
            });
            deferPreparedCommit(() => deliverProjectEvent(event));
        };
        let publication;
        try { publication = shouldPublish ? await measureUnitTestPhase('publication', () => publishPreparedWorkspace({projectId,snapshotId,userId,capability,
            expectedWorkspaceRevision,beforeFiles,preparedRoot:context.rootDir,requestId:operation.id,afterMutation:complete,includeGitMetadata,
            provenanceSource:/^(AI_|APPLY_UNIT_SUGGESTION|SYSTEM_TEST_IMPROVEMENT)/.test(type) ? 'AI_APPLY' : 'HUMAN_EDIT',
            emitCommittedEvent:async event=>deferPreparedCommit(()=>deliverProjectEvent(event))})) : null;
        } catch (error) {
            await withProjectGuard({projectId,userId,capability,maxWait:30000,timeout:60000},async(tx,access) => {
                const snapshot = await tx.projectSnapshot.findFirst({where:{id:snapshotId,projectId}});
                await recoverProjectMutationMarkers({tx,project:access.project,snapshot,root:context.originalRootDir});
            });
            throw error;
        }
        if (!shouldPublish) await withProjectGuard({projectId,userId,capability,maxWait:30000,timeout:RESULT_PUBLICATION_TIMEOUT_MS},tx=>completeNonPublish(tx));
        await deliverPreparedCommits();
        return result && typeof result === 'object' ? {...result,operationId:operation.id,...(requestId ? {requestId} : {}),...(publication ? {workspaceRevision:publication.workspaceRevision,changedPaths:publication.changedPaths} : {})} : result;
    },{includeGitMetadata,resumeWorkspace:resuming});
};
