import {createHash} from 'node:crypto';
import {createRunTestsJob} from './job.service.js';
import {addJobToQueue} from './queue.service.js';

export async function scheduleUnitTestPostApplyAnalysis({result,projectId,snapshotId,userId,requestId,skipBackgroundJob}) {
    if (skipBackgroundJob === true || !result?.success || result.fileUpdated === false ||
        ['NO_CHANGES','VERIFIED_DRAFT','WAITING_FOR_ENV'].includes(result.status)) return null;
    const identity = result.runId || requestId;
    const analysisRequestId = identity ? `unit-apply-analysis-${createHash('sha256').update(`${snapshotId}:${identity}`).digest('hex')}` : undefined;
    const job = await createRunTestsJob({projectId,snapshotId,userId,mode:'FULL',testType:'unit',chainBuildCfg:true,
        ...(analysisRequestId ? {requestId:analysisRequestId} : {})});
    const status = job.status || 'QUEUED';
    // Retried HTTP requests reuse the same operation, including completed runs.
    if (status === 'QUEUED') await addJobToQueue('RUN_TESTS',job.id);
    return {id:job.id,type:'RUN_TESTS',status};
}
