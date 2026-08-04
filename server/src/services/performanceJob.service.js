import { createCodeHygieneJob, getJobById, markJobFailed, markJobRunning, markJobSuccess, updateJobProgress } from './job.service.js';
import { addJobToQueue } from './queue.service.js';
import { runPerformancePipelineStage } from './performancePipelineStage.service.js';

/** Dedicated automatic pipeline job; no caller-facing trigger exists. */
export const processPerformanceAnalysisJob = async (jobId) => {
    try {
        await markJobRunning(jobId);
        const job = await getJobById(jobId);
        if (!job.snapshotId) throw new Error('Performance analysis job is missing snapshotId.');

        await updateJobProgress(jobId, 25);
        const { metric, result } = await runPerformancePipelineStage({ snapshotId: job.snapshotId });
        await updateJobProgress(jobId, 90);
        await markJobSuccess(jobId, { snapshotId: job.snapshotId, metricId: metric.id, slowFunctionCount: result.slowFunctions.length });

        const hygieneJob = await createCodeHygieneJob({
            projectId: job.projectId,
            snapshotId: job.snapshotId,
            userId: job.userId
        });
        await addJobToQueue('CODE_HYGIENE', hygieneJob.id);
    } catch (error) {
        console.error(`[PerformanceAnalysisJob ${jobId}] Failed:`, error);
        try { await markJobFailed(jobId, error); } catch (markError) {
            console.error(`[PerformanceAnalysisJob ${jobId}] Unable to mark job as failed:`, markError);
        }
    }
};
