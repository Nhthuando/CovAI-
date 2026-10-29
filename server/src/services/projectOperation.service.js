import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma.js';
import { withProjectGuard } from './projectAccess.service.js';
import { projectFileError } from './projectFileVersion.service.js';
import { canonicalizeOperationInput, hashOperationInput } from '../utils/projectOperationIdentity.js';
import { publishProjectEvent, deliverProjectEvent } from './projectEvent.service.js';

export { canonicalizeOperationInput };
export const ACTIVE_PROJECT_OPERATIONS = ['ADMITTED','QUEUED','RUNNING','PUBLISHING'];

export const admitProjectOperation = async ({projectId,snapshotId,userId,type,input = {},requestId = randomUUID(),db = prisma}) => {
    if (typeof requestId !== 'string' || !requestId || requestId.length > 200) throw projectFileError('INVALID_REQUEST_ID','Invalid operation request identifier',400);
    const capability = type.startsWith('AI_') ? 'ai.use' : 'tests.run';
    return withProjectGuard({projectId,userId,capability,db},async (tx,access) => {
        const snapshot = await tx.projectSnapshot.findFirst({where:{id:snapshotId,projectId}});
        if (!snapshot) throw projectFileError('RESOURCE_NOT_FOUND','Snapshot not found',404);
        if (!snapshot.rootDir) throw projectFileError('SNAPSHOT_NOT_READY','Project snapshot is not ready for analysis',409);
        const aliasKey = {projectId_actorId_requestId:{projectId,actorId:userId,requestId}};
        const alias = await tx.projectOperationRequest.findUnique({where:aliasKey,include:{operation:true}});
        const prior = alias?.operation || await tx.projectOperation.findUnique({where:aliasKey});
        if (prior) {
            if (prior.type !== type || prior.snapshotId !== snapshotId || canonicalizeOperationInput(prior.inputJson) !== canonicalizeOperationInput(input)) {
                throw projectFileError('REQUEST_ID_REUSED','Operation identifier was already used for different input');
            }
            const job = await tx.job.findUnique({where:{id:prior.primaryJobId}});
            if (!alias) await tx.projectOperationRequest.create({data:{projectId,actorId:userId,requestId,operationId:prior.id}});
            return {operationId:prior.id,jobId:prior.primaryJobId,reused:true,status:prior.status,snapshotId,job};
        }
        const semanticKey = hashOperationInput({projectId,snapshotId,type,workspaceRevision:access.project.workspaceRevision,
            sourceIdentity:snapshot.checksum || snapshot.commitSha || null,
            runnerIdentity:{jestConfigPath:snapshot.jestConfigPath,jestCommand:snapshot.jestCommand,
                vitestConfigPath:snapshot.vitestConfigPath,vitestCommand:snapshot.vitestCommand,
                selectedTestingFramework:snapshot.selectedTestingFramework},input});
        const active = await tx.projectOperation.findFirst({where:{projectId,semanticKey,status:{in:ACTIVE_PROJECT_OPERATIONS}}});
        if (active) {
            const job = active.primaryJobId ? await tx.job.findUnique({where:{id:active.primaryJobId}}) : null;
            if (job && ['QUEUED','RUNNING'].includes(job.status)) {
                await tx.projectOperationRequest.create({data:{projectId,actorId:userId,requestId,operationId:active.id}});
                return {operationId:active.id,jobId:active.primaryJobId,reused:true,status:active.status,snapshotId,job};
            }
            await tx.projectOperation.update({where:{id:active.id},data:{status:job?.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED'}});
        }
        // Other configurations targeting the same summary serialize rather than
        // racing to replace one snapshot's current result.
        const incompatible = await tx.projectOperation.findFirst({where:{projectId,snapshotId,type,status:{in:ACTIVE_PROJECT_OPERATIONS}}});
        if (incompatible) throw projectFileError('OPERATION_BUSY','Another configuration is already running for this snapshot');
        const legacy = await tx.job.findFirst({where:{projectId,snapshotId,type,status:{in:['QUEUED','RUNNING']}},select:{id:true}});
        if (legacy) throw projectFileError('OPERATION_BUSY','A previous job is still running for this snapshot');
        const job = await tx.job.create({data:{projectId,snapshotId,userId,type,status:'QUEUED',progress:0,payloadJson:JSON.stringify(input)}});
        const operation = await tx.projectOperation.create({data:{projectId,snapshotId,actorId:userId,capability,type,
            requestId,semanticKey,capturedWorkspaceRevision:access.project.workspaceRevision,status:'QUEUED',primaryJobId:job.id,inputJson:input}});
        await tx.projectOperationRequest.create({data:{projectId,actorId:userId,requestId,operationId:operation.id}});
        await tx.jobLog.create({data:{jobId:job.id,level:'INFO',message:`Job admitted (${type})`}});
        return {operationId:operation.id,jobId:job.id,reused:false,status:operation.status,snapshotId,job};
    });
};

export const publishOperationResults = async ({operationId,result,expectedWorkspaceRevision,db = prisma}) => {
    const operation = await db.projectOperation.findUnique({where:{id:operationId}});
    if (!operation) throw projectFileError('RESOURCE_NOT_FOUND','Operation not found',404);
    const output = await withProjectGuard({projectId:operation.projectId,userId:operation.actorId,capability:operation.capability,db},async (tx,access) => {
        const current = await tx.projectOperation.findUnique({where:{id:operationId}});
        const job = current.primaryJobId ? await tx.job.findUnique({where:{id:current.primaryJobId}}) : null;
        if (!ACTIVE_PROJECT_OPERATIONS.includes(current.status) || job?.status === 'CANCELED') throw projectFileError('OPERATION_CANCELED','Operation is no longer active');
        const requiredRevision = expectedWorkspaceRevision ?? current.capturedWorkspaceRevision;
        if (requiredRevision !== current.capturedWorkspaceRevision || access.project.workspaceRevision !== requiredRevision) {
            await tx.projectOperation.update({where:{id:operationId},data:{status:'STALE',resultJson:result}});
            if (current.primaryJobId) await tx.job.updateMany({where:{id:current.primaryJobId,status:{in:['QUEUED','RUNNING']}},
                data:{status:'FAILED',finishedAt:new Date(),errorMessage:'OPERATION_STALE: source changed before result publication'}});
            return {stale:true,operationId};
        }
        const updated = await tx.projectOperation.update({where:{id:operationId},data:{status:'SUCCESS',resultJson:result}});
        const event = await publishProjectEvent({tx,projectId:current.projectId,type:'operation.finished',actorId:current.actorId,
            resourceId:current.primaryJobId,revision:requiredRevision,payload:{operationId,status:updated.status}});
        return {operation:updated,event};
    });
    if (output.event) await deliverProjectEvent(output.event).catch(()=>{});
    return output;
};
