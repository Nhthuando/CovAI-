import { buildCfgForSnapshot } from './buildCfg.service.js';
import { markJobRunning, markJobSuccess, markJobFailed } from './job.service.js';

export async function processBuildCfgJob(job) {
    try {
        await markJobRunning(job.id);
        const count = await buildCfgForSnapshot(job.snapshotId);
        await markJobSuccess(job.id, { count });
    } catch (error) {
        await markJobFailed(job.id, error);
    }
}