import {createHash} from 'node:crypto';
import {createRunTestsJob} from './job.service.js';
import {addJobToQueue} from './queue.service.js';
import {WORKFLOW_STATES} from './coverageVerification.service.js';

export async function scheduleUnitTestPostApplyAnalysis({result,projectId,snapshotId,userId,requestId,skipBackgroundJob}) {
    if (skipBackgroundJob === true || !result?.success || ['VERIFIED_DRAFT','WAITING_FOR_ENV'].includes(result.status)) return null;
    const baselineVerified = result.status === 'NO_CHANGES' &&
        result.workflowState === WORKFLOW_STATES.BASELINE_ALREADY_FULLY_COVERED;
    if (!baselineVerified && (result.fileUpdated === false || result.status === 'NO_CHANGES')) return null;
    const identity = result.runId || requestId;
    const analysisRequestId = identity ? `unit-apply-analysis-${createHash('sha256').update(`${snapshotId}:${identity}`).digest('hex')}` : undefined;
    const job = await createRunTestsJob({projectId,snapshotId,userId,mode:'FULL',testType:'unit',chainBuildCfg:true,
        verifyPublishedUnitTests: baselineVerified || result.qualityGate?.status === 'ACCEPTED',
        ...(analysisRequestId ? {requestId:analysisRequestId} : {})});
    const status = job.status || 'QUEUED';
    // Retried HTTP requests reuse the same operation, including completed runs.
    if (status === 'QUEUED') await addJobToQueue('RUN_TESTS',job.id);
    return {id:job.id,type:'RUN_TESTS',status};
}
