import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { processRunTestsJob } from './runTestsJob.service.js';
import { processAnalysisJob } from './analysisJob.service.js';
import { processAiTestsJob } from './aiTestsJob.service.js';
import { processAiSuggestJob } from './aiSuggestJob.service.js';
import { processBuildCfgJob } from './buildCfgJob.service.js';
import { processIngestJob } from './ingestJob.service.js';
import { processInstallDepsJob } from './installDeps.service.js';
import { processCoverageJob } from './coverageRunner.service.js';
import { getJobById, markJobFailed, markQueuedJobFailed, createRunTestsJob } from './job.service.js';
import prisma from "../config/prisma.js";

const redisOptions = {
    maxRetriesPerRequest: null,
};

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', redisOptions);

export const jobQueue = new Queue('covai-jobs', { connection });

// Initialize Worker
const worker = new Worker('covai-jobs', async (job) => {
    const { type, jobId, ...customData } = job.data;
    console.log(`[Queue] Bắt đầu xử lý Job ${jobId} (Type: ${type})`);

    try {
        switch (type) {
            case 'RUN_TESTS':
                await processRunTestsJob(jobId);
                break;
            case 'ANALYSIS':
                await processAnalysisJob(jobId);
                break;
            case 'AI_TESTS':
                await processAiTestsJob(jobId);
                break;
            case 'AI_SUGGEST':
                await processAiSuggestJob(jobId);
                break;
            case 'BUILD_CFG':
                const dbJob = await getJobById(jobId);
                if (!dbJob) throw new Error(`Job ${jobId} not found`);
                await processBuildCfgJob(dbJob);
                break;
            case 'INGEST':
                await processIngestJob(jobId);
                break;
            case 'INSTALL_DEPS':
                await processInstallDepsJob(jobId);
                break;
            case 'COVERAGE':
                await processCoverageJob(jobId);
                break;
            case 'COVERAGE_PIPELINE':
                // Custom pipeline cho coverage
                await processInstallDepsJob(jobId); // jobId lúc này là installJobId
                const updatedInstallJob = await prisma.job.findUnique({ where: { id: jobId } });
                if (updatedInstallJob?.status !== "SUCCESS") {
                    console.error(`[Queue] INSTALL_DEPS thất bại, dừng COVERAGE_PIPELINE`);
                    return;
                }
                const runJob = await createRunTestsJob({
                    projectId: customData.projectId,
                    snapshotId: customData.snapshotId,
                    userId: customData.userId,
                });
                await processCoverageJob(runJob.id);
                break;
            default:
                throw new Error(`Unknown job type: ${type}`);
        }
        console.log(`[Queue] Hoàn thành Job ${jobId} (Type: ${type})`);
    } catch (error) {
        console.error(`[Queue] Lỗi xử lý Job ${jobId} (Type: ${type}):`, error);
        // Fallback to mark job failed if the handler didn't do it itself
        try {
            const dbJob = await getJobById(jobId);
            if (dbJob && dbJob.status === 'RUNNING') {
                await markJobFailed(jobId, error);
            } else if (dbJob && dbJob.status === 'QUEUED') {
                await markQueuedJobFailed(jobId, error);
            }
        } catch (fallbackError) {
            console.error(`[Queue] Không thể markJobFailed cho Job ${jobId}:`, fallbackError);
        }
        throw error; // Let BullMQ know it failed
    }
}, { connection });

worker.on('failed', (job, err) => {
    console.error(`[Queue] BullMQ báo Job ${job?.data?.jobId} failed với lỗi: ${err.message}`);
});

export const addJobToQueue = async (type, jobId, customData = {}) => {
    await jobQueue.add(type, { type, jobId, ...customData });
    console.log(`[Queue] Đã đưa Job ${jobId} (Type: ${type}) vào hàng đợi.`);
};
