import { Queue, Worker, FlowProducer } from 'bullmq';
import IORedis from 'ioredis';
import { processRunTestsJob } from './runTestsJob.service.js';
import { processAnalysisJob } from './analysisJob.service.js';
import { processAiTestsJob } from './aiTestsJob.service.js';
import { processAiSuggestJob } from './aiSuggestJob.service.js';
import { processBuildCfgJob } from './buildCfgJob.service.js';
import { processIngestJob } from './ingestJob.service.js';
import { processInstallDepsJob } from './installDeps.service.js';
import { processCoverageJob } from './coverageRunner.service.js';
import { processCodeHygieneJob } from './codeHygieneJob.service.js';
import { processPerformanceAnalysisJob } from './performanceJob.service.js';
import { processSupertestCoverageJob } from './supertestCoverageJob.service.js';
import { getJobById, markJobRunning, markJobFailed, createRunTestsJob } from './job.service.js';
import prisma from "../config/prisma.js";

const redisOptions = {
    maxRetriesPerRequest: null,
};

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', redisOptions);

export const jobQueue = new Queue('covai-jobs', { connection });
export const flowProducer = new FlowProducer({ connection });

// Initialize Worker
const worker = new Worker('covai-jobs', async (job) => {
    const { type, jobId, ...customData } = job.data;
    console.log(`[Queue] ${type} BullMQ job started: bullJobId=${job.id}, prismaJobId=${jobId}`);

    try {
        console.log(`[Queue] job.data = ${JSON.stringify({ type, jobId, ...customData })}`);
        switch (type) {
            case 'RUN_TESTS':
                await processRunTestsJob(jobId);
                break;
            case 'SUPERTEST_COVERAGE':
                console.log(`[Queue] processSupertestCoverageJob started for prisma job ${jobId}`);
                await processSupertestCoverageJob(jobId);
                break;
            case 'SUPERTEST_COVERAGE_PIPELINE': {
                const installJobId = customData.installJobId ?? jobId;
                const supertestJobId = customData.supertestJobId;
                console.log(`[Queue] SUPERTEST_COVERAGE_PIPELINE started: installJob=${installJobId}, supertestJob=${supertestJobId}`);

                const installJob = await prisma.job.findUnique({ where: { id: installJobId }, select: { status: true } });
                const installStatus = installJob?.status ?? "UNKNOWN";
                console.log(`[Queue] SUPERTEST_COVERAGE_PIPELINE reads INSTALL_DEPS status: installJob=${installJobId}, status=${installStatus}`);

                if (["QUEUED", "RUNNING"].includes(installStatus)) {
                    console.log(`[Queue] INSTALL_DEPS remains ${installStatus}; parent not released yet, so pipeline waits for child completion.`);
                    return;
                }

                if (["FAILED", "CANCELED"].includes(installStatus)) {
                    const message = "Dependency installation failed; Supertest was not started.";
                    console.error(`[Queue] Install deps failed => parent will not start Supertest. installJobStatus=${installStatus}, supertestJob=${supertestJobId}`);
                    if (supertestJobId) {
                        const supertestJob = await prisma.job.findUnique({
                            where: { id: supertestJobId },
                            select: { id: true, status: true }
                        });

                        if (supertestJob && ["QUEUED", "RUNNING"].includes(supertestJob.status)) {
                            await prisma.job.update({
                                where: { id: supertestJobId },
                                data: {
                                    status: "FAILED",
                                    errorMessage: message,
                                    finishedAt: new Date(),
                                },
                            });
                            console.log(`[Queue] Marked Supertest job ${supertestJobId} FAILED because dependency install failed.`);
                        }
                    }
                    return;
                }

                if (installStatus !== "SUCCESS") {
                    console.warn(`[Queue] INSTALL_DEPS status is ${installStatus}; not eligible to run Supertest yet.`);
                    return;
                }

                console.log(`[Queue] SUPERTEST_COVERAGE_PIPELINE became runnable: installJob=${installJobId} reached SUCCESS; starting processSupertestCoverageJob(${supertestJobId})`);
                if (supertestJobId) {
                    await processSupertestCoverageJob(supertestJobId);
                }
                break;
            }
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
            case 'PERFORMANCE_ANALYSIS':
                await processPerformanceAnalysisJob(jobId);
                break;
            case 'INGEST':
                await processIngestJob(jobId);
                break;
            case 'INSTALL_DEPS':
                console.log(`[Queue] INSTALL_DEPS BullMQ job started: bullJobId=${job.id}, prismaJobId=${jobId}`);
                await processInstallDepsJob(jobId);
                break;
            case 'COVERAGE':
                await processCoverageJob(jobId);
                break;
            case 'CODE_HYGIENE':
                await processCodeHygieneJob(jobId);
                break;
            case 'COVERAGE_PIPELINE':
                // Custom pipeline cho coverage
                await processInstallDepsJob(jobId); // jobId lúc này là installJobId
                const updatedInstallJob = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
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

export const addJobToQueue = async (type, jobId, customData = {}, jobOptions = {}) => {
    const dedupeKey = `${type}-${jobId}`.replace(/[^A-Za-z0-9_-]/g, "-");
    await jobQueue.add(type, { type, jobId, ...customData }, { jobId: dedupeKey, ...jobOptions });
    console.log(`[Queue] Đã đưa Job ${jobId} (Type: ${type}) vào hàng đợi với dedupe key ${dedupeKey}. options=${JSON.stringify(jobOptions)}`);
};

/**
 * Creates a Supertest coverage pipeline with proper BullMQ dependency direction.
 *
 * DEPENDENCY TREE:
 *   SUPERTEST_COVERAGE_PIPELINE (Parent)
 *   └── INSTALL_DEPS (Child)
 *
 * BullMQ Semantics:
 * - Parent waits for children to complete before executing
 * - SUPERTEST_COVERAGE_PIPELINE waits for INSTALL_DEPS to finish
 * - INSTALL_DEPS must complete BEFORE SUPERTEST_COVERAGE_PIPELINE starts
 *
 * @param {string} installJobId - ID of the INSTALL_DEPS job
 * @param {string} supertestJobId - ID of the SUPERTEST_COVERAGE job
 * @param {object} options - Optional FlowProducer options
 * @returns {Promise<object>} FlowProducer result with pipeline job info
 */
export const addSupertestCoveragePipeline = async (installJobId, supertestJobId, options = {}) => {
    const pipelineJobId = `${supertestJobId}-pipeline`;

    try {
        console.log(`[Queue] Creating Supertest pipeline: installJobId=${installJobId}, supertestJobId=${supertestJobId}, pipelineJobId=${pipelineJobId}`);

        const installQueueJobId = `INSTALL_DEPS-${installJobId}`.replace(/[^A-Za-z0-9_-]/g, "-");
        const pipelineQueueJobId = `SUPERTEST_COVERAGE_PIPELINE-${pipelineJobId}`.replace(/[^A-Za-z0-9_-]/g, "-");

        const flow = await flowProducer.add({
            name: 'SUPERTEST_COVERAGE_PIPELINE',
            queueName: 'covai-jobs',
            data: {
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: pipelineJobId,
                installJobId,
                supertestJobId,
            },
            opts: {
                jobId: pipelineQueueJobId,
                ...options,
            },
            children: [
                {
                    name: 'INSTALL_DEPS',
                    queueName: 'covai-jobs',
                    data: {
                        type: 'INSTALL_DEPS',
                        jobId: installJobId,
                    },
                    opts: {
                        jobId: installQueueJobId,
                        ...options,
                    },
                },
            ],
        });

        console.log(`[Queue] Supertest pipeline created with flow=${JSON.stringify(flow)}`);
        return flow;
    } catch (error) {
        console.error(`[Queue] Error creating Supertest pipeline:`, error);
        throw error;
    }
};
