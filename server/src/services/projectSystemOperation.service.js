import prisma from '../config/prisma.js';
import { getJobById } from './job.service.js';
import { resolveProjectAccess } from './projectAccess.service.js';
import { withPreparedProjectWorkspace } from './projectWorkspacePreparation.service.js';
import { currentProjectOperation,assertProjectOperationActive } from './projectOperationWorkspace.service.js';
import { projectFileError } from './projectFileVersion.service.js';

// Queue-only boundary: pure runner functions keep their existing injected-client
// APIs for focused tests, while every real queued system job gets a source copy.
export const runPreparedSystemJob = async (jobId,run,lease) => {
    if (currentProjectOperation()?.jobId === jobId) return run();
    const job = await getJobById(jobId);
    const input = JSON.parse(job.payloadJson || '{}');
    const capability = job.type === 'SYSTEM_TEST_IMPROVEMENT' && input.autoApply ? 'evidence.approve' : 'tests.run';
    const access = await resolveProjectAccess({projectId:job.projectId,userId:job.userId,capability});
    const admitted = await prisma.projectOperation.findUnique({where:{primaryJobId:jobId}});
    const publish = job.type === 'SYSTEM_TEST_MUTATION' ? false : job.type === 'SYSTEM_TEST_IMPROVEMENT' ? Boolean(input.autoApply) : true;
    return withPreparedProjectWorkspace({projectId:job.projectId,snapshotId:job.snapshotId,userId:job.userId,capability,
        expectedWorkspaceRevision:admitted?.capturedWorkspaceRevision ?? access.project.workspaceRevision,
        primaryJobId:jobId,type:job.type,input,publish},async context => {
        const assertHeld = lease?.assertHeld;
        if (lease) lease.assertHeld = async () => { await assertHeld.call(lease);await assertProjectOperationActive(undefined); };
        try {
            const result = await run(context);
            const current = await prisma.job.findUnique({where:{id:jobId},select:{status:true,errorMessage:true}});
            if (['FAILED','CANCELED'].includes(current?.status)) throw projectFileError('OPERATION_CANCELED',current.errorMessage || 'System operation did not complete successfully');
            return result;
        } finally { if(lease) lease.assertHeld = assertHeld; }
    });
};
