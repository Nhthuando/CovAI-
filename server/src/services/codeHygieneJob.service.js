import fs from 'fs';
import { markJobRunning, markJobSuccess, markJobFailed, updateJobProgress, getJobById } from './job.service.js';
import { runCodeHygieneAnalysis } from './codeHygiene.orchestrator.js';

export const processCodeHygieneJob = async (jobId) => {
    try {
        await markJobRunning(jobId);
        const job = await getJobById(jobId);
        const rootDir = job.snapshot?.rootDir || job.snapshot?.storagePath;

        if (!rootDir || !fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
            throw new Error('Snapshot source directory is unavailable; ingest the snapshot before running code hygiene analysis.');
        }

        await updateJobProgress(jobId, 20);
        const report = await runCodeHygieneAnalysis(job.snapshotId, rootDir);
        await updateJobProgress(jobId, 100);
        await markJobSuccess(jobId, { snapshotId: job.snapshotId, summary: report.summary });
        console.log(`[Job ${jobId}] Code Hygiene job completed.`);
    } catch (error) {
        console.error(`[Job ${jobId}] Code Hygiene job failed:`, error);
        try {
            await markJobFailed(jobId, error);
        } catch (markError) {
            console.error(`[Job ${jobId}] Unable to mark Code Hygiene job as failed:`, markError);
        }
    }
};
