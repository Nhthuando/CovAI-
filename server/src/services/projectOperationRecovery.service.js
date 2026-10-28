import prisma from '../config/prisma.js';
import {publishProjectEvent,deliverProjectEvent} from './projectEvent.service.js';

// Trusted queue recovery, never an HTTP/user authorization shortcut. A stalled
// delivery lost queue ownership: fence the old writer rather than reuse its
// half-computed workspace. Retain all files/journals for normal guarded recovery.
export const failInterruptedProjectOperation = async ({jobId,db = prisma}) => {
    const operation = await db.projectOperation.findUnique({where:{primaryJobId:jobId}});
    if (!operation) return {interrupted:false};
    const result = await db.$transaction(async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${operation.projectId}, 0))`;
        const current = await tx.projectOperation.findUnique({where:{id:operation.id}});
        const job = await tx.job.findUnique({where:{id:jobId}});
        if (!current || !job || !['ADMITTED','QUEUED','RUNNING','PUBLISHING'].includes(current.status)) return {interrupted:false};
        const terminal = ['SUCCESS','FAILED','CANCELED'].includes(job.status);
        const status = terminal ? job.status : 'FAILED';
        await tx.projectOperation.update({where:{id:current.id},data:{status}});
        if (!terminal) await tx.job.update({where:{id:jobId},data:{status:'FAILED',finishedAt:new Date(),
            errorMessage:'WORKER_INTERRUPTED: queue ownership was lost. Retained evidence requires a fresh run.'}});
        const event = await publishProjectEvent({tx,projectId:current.projectId,type:'operation.finished',actorId:null,
            resourceId:jobId,revision:current.capturedWorkspaceRevision,payload:{operationId:current.id,status,reason:'WORKER_INTERRUPTED'}});
        return {interrupted:!terminal,reconciled:terminal,event};
    },{maxWait:10000,timeout:15000});
    if (result.event) { await deliverProjectEvent(result.event).catch(()=>{});delete result.event; }
    return result;
};

// Admission commits before enqueue. A transport outage leaves durable QUEUED
// rows; retry their original primary job identities instead of creating jobs.
export const recoverQueuedProjectOperations = async ({limit = 50} = {}) => {
    const operations = await prisma.projectOperation.findMany({where:{status:'QUEUED',primaryJobId:{not:null}},orderBy:{createdAt:'asc'},take:limit,
        include:{primaryJob:{select:{id:true,type:true,status:true}}}});
    const { addJobToQueue } = await import('./queue.service.js');
    const results = [];
    for (const operation of operations) {
        if (!operation.primaryJob || operation.primaryJob.status !== 'QUEUED') {
            await prisma.projectOperation.updateMany({where:{id:operation.id,status:'QUEUED'},data:{status:operation.primaryJob?.status === 'CANCELED' ? 'CANCELED' : 'FAILED'}});
            continue;
        }
        try {
            await addJobToQueue(operation.primaryJob.type,operation.primaryJob.id);
            results.push({operationId:operation.id,queued:true});
        } catch(error) { results.push({operationId:operation.id,queued:false,code:error.code || 'DEPENDENCY_UNAVAILABLE'}); }
    }
    return results;
};
