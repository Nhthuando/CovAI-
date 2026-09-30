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
import { processQualityAnalysisJob } from './qualityAnalysisJob.service.js';
import { processSecurityAnalysisJob } from './securityScanJob.service.js';
import { processRunVitestJob } from "./runVitestJob.service.js";
import { processSystemTestAnalysisJob } from "./systemTestAnalysisJob.service.js";
import { processVitestCoverageJob } from './vitestCoverageJob.service.js';
import { processCypressSystemCoverageJob } from './cypressSystemCoverageJob.service.js';
import { processCypressSystemTestJob } from './runCypressSystemTestJob.service.js';
import { processRunPlaywrightJob } from './runPlaywrightJob.service.js';
import { processPlaywrightSystemCoverageJob } from './playwrightSystemCoverageJob.service.js';
import {
  getJobById,
  markJobRunning,
  markJobFailed,
  markQueuedJobFailed,
  createRunTestsJob,
} from './job.service.js';
import prisma from '../config/prisma.js';

let isRedisConnected = false;

const redisOptions = {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    if (process.env.NODE_ENV === 'test') {
      if (times > 2) return null;
      return 500;
    }
    return Math.min(times * 500, 3000);
  },
  enableOfflineQueue: true,
};

const connection = new IORedis(
  process.env.REDIS_URL || 'redis://localhost:6379',
  redisOptions,
);

if (connection && typeof connection.on === 'function') {
  connection.on('connect', () => {
    isRedisConnected = true;
    console.log('[Queue] Connected to Redis successfully.');
  });

  connection.on('ready', () => {
    isRedisConnected = true;
  });

  connection.on('close', () => {
    isRedisConnected = false;
  });

  connection.on('error', (err) => {
    isRedisConnected = false;
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[Queue] Redis connection error: ${err.message}`);
    }
  });
}

export const jobQueue = new Queue('covai-jobs', { connection });
export const flowProducer = new FlowProducer({ connection });

if (jobQueue && typeof jobQueue.on === 'function') {
  jobQueue.on('error', () => { isRedisConnected = false; });
}
if (flowProducer && typeof flowProducer.on === 'function') {
  flowProducer.on('error', () => {});
}

export const executeJobDirectly = async (type, jobId, customData = {}) => {
  console.log(`[DirectExecutor] Running job directly: type=${type}, jobId=${jobId}`);
  try {
    switch (type) {
      case 'RUN_TESTS':
        await processRunTestsJob(jobId);
        break;
      case 'SUPERTEST_COVERAGE':
        await processSupertestCoverageJob(jobId);
        break;
      case 'SUPERTEST_COVERAGE_PIPELINE': {
        const installJobId = customData.installJobId ?? jobId;
        const supertestJobId = customData.supertestJobId;
        console.log(`[Queue] SUPERTEST_COVERAGE_PIPELINE started: installJob=${installJobId}, supertestJob=${supertestJobId}`);

        const installJob = await prisma.job.findUnique({ where: { id: installJobId }, select: { status: true, errorMessage: true } });
        const installStatus = installJob?.status ?? 'UNKNOWN';
        console.log(`[Queue] SUPERTEST_COVERAGE_PIPELINE reads INSTALL_DEPS status: installJob=${installJobId}, status=${installStatus}`);

        if (['QUEUED', 'RUNNING'].includes(installStatus)) {
          console.log(`[Queue] INSTALL_DEPS remains ${installStatus}; parent not released yet, so pipeline waits for child completion.`);
          return;
        }

        if (['FAILED', 'CANCELED'].includes(installStatus)) {
          const message = `Dependency installation failed; Supertest was not started. Reason: ${installJob?.errorMessage || 'Unknown error'}`;
          console.error(`[Queue] Install deps failed => parent will not start Supertest. installJobStatus=${installStatus}, supertestJob=${supertestJobId}`);
          if (supertestJobId) {
            const supertestJob = await prisma.job.findUnique({
              where: { id: supertestJobId },
              select: { id: true, status: true }
            });

            if (supertestJob && ['QUEUED', 'RUNNING'].includes(supertestJob.status)) {
              await prisma.job.update({
                where: { id: supertestJobId },
                data: {
                  status: 'FAILED',
                  errorMessage: message,
                  finishedAt: new Date(),
                },
              });
              console.log(`[Queue] Marked Supertest job ${supertestJobId} FAILED because dependency install failed.`);
            }
          }
          return;
        }

        if (installStatus !== 'SUCCESS') {
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
      case 'QUALITY_ANALYSIS':
        await processQualityAnalysisJob(jobId);
        break;
      case 'SECURITY_ANALYSIS':
        await processSecurityAnalysisJob(jobId);
        break;
      case 'AI_TESTS':
        await processAiTestsJob(jobId);
        break;
      case 'AI_SUGGEST':
        await processAiSuggestJob(jobId);
        break;
      case 'BUILD_CFG': {
        const dbJob = await getJobById(jobId);
        if (dbJob) await processBuildCfgJob(dbJob);
        break;
      }
      case 'PERFORMANCE_ANALYSIS':
        await processPerformanceAnalysisJob(jobId);
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
      case 'COVERAGE_PIPELINE': {
        await processInstallDepsJob(jobId);
        const updatedInstallJob = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
        if (updatedInstallJob?.status !== 'SUCCESS') {
          console.error(`[Queue] INSTALL_DEPS failed, stopping COVERAGE_PIPELINE`);
          return;
        }
        const runJob = await createRunTestsJob({
          projectId: customData.projectId,
          snapshotId: customData.snapshotId,
          userId: customData.userId,
        });
        await processCoverageJob(runJob.id);
        break;
      }
      case 'CODE_HYGIENE':
        await processCodeHygieneJob(jobId);
        break;
      case 'RUN_VITEST_TESTS':
        await processRunVitestJob(jobId);
        break;
      case 'SYSTEM_TEST_ANALYSIS':
        await processSystemTestAnalysisJob(jobId);
        break;
      case 'VITEST_COVERAGE':
        await processVitestCoverageJob(jobId);
        break;
      case 'CYPRESS_SYSTEM_TEST':
        await processCypressSystemTestJob(jobId);
        break;
      case 'CYPRESS_SYSTEM_COVERAGE':
        await processCypressSystemCoverageJob(jobId);
        break;
      case 'PLAYWRIGHT_SYSTEM_TEST':
        await processRunPlaywrightJob(jobId);
        break;
      case 'PLAYWRIGHT_SYSTEM_COVERAGE':
        await processPlaywrightSystemCoverageJob(jobId);
        break;
      default:
        console.warn(`[DirectExecutor] Unknown job type: ${type}`);
    }
  } catch (error) {
    console.error(`[DirectExecutor] Error executing job ${jobId} (${type}):`, error);
    try {
      const dbJob = await getJobById(jobId);
      if (dbJob && ['QUEUED', 'RUNNING'].includes(dbJob.status)) {
        await markJobFailed(jobId, error);
      }
    } catch (_) { }
  }
};

// Initialize Worker
const worker = new Worker(
  'covai-jobs',
  async (job) => {
    const { type, jobId, ...customData } = job.data;
    console.log(`[Queue] ${type} BullMQ job started: bullJobId=${job.id}, prismaJobId=${jobId}`);

    try {
      console.log(`[Queue] job.data = ${JSON.stringify({ type, jobId, ...customData })}`);
      await executeJobDirectly(type, jobId, customData);
      console.log(`[Queue] Job ${jobId} completed (Type: ${type})`);
    } catch (error) {
      console.error(`[Queue] Error processing Job ${jobId} (Type: ${type}):`, error);
      throw error;
    }
  },
  { connection },
);

worker.on('failed', (job, err) => {
  console.error(
    `[Queue] BullMQ reported Job ${job?.data?.jobId} failed with error: ${err.message}`,
  );
});

worker.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[Queue Worker] Error: ${err.message}`);
  }
});

export const addJobToQueue = async (type, jobId, customData = {}, jobOptions = {}) => {
  if (!isRedisConnected && process.env.NODE_ENV !== 'test') {
    console.warn(`[Queue] Redis unavailable. Executing Job ${jobId} (${type}) directly in-memory...`);
    setTimeout(() => executeJobDirectly(type, jobId, customData), 10);
    return;
  }

  try {
    const dedupeKey = `${type}-${jobId}`.replace(/[^A-Za-z0-9_-]/g, '-');
    await jobQueue.add(type, { type, jobId, ...customData }, { jobId: dedupeKey, ...jobOptions });
    console.log(`[Queue] Queued Job ${jobId} (Type: ${type}) with dedupe key ${dedupeKey}.`);
  } catch (redisErr) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[Queue] Error adding job to Redis (${redisErr.message}). Falling back to direct in-memory execution...`);
      setTimeout(() => executeJobDirectly(type, jobId, customData), 10);
    } else {
      throw redisErr;
    }
  }
};

/**
 * Creates a Supertest coverage pipeline with proper BullMQ dependency direction.
 */
export const addSupertestCoveragePipeline = async (installJobId, supertestJobId, options = {}) => {
  const pipelineJobId = `${supertestJobId}-pipeline`;

  if (!isRedisConnected && process.env.NODE_ENV !== 'test') {
    console.warn(`[Queue] Redis unavailable for Supertest pipeline. Running directly in-memory...`);
    setTimeout(async () => {
      await executeJobDirectly('INSTALL_DEPS', installJobId);
      await executeJobDirectly('SUPERTEST_COVERAGE', supertestJobId);
    }, 10);
    return { name: 'SUPERTEST_COVERAGE_PIPELINE' };
  }

  try {
    console.log(`[Queue] Creating Supertest pipeline: installJobId=${installJobId}, supertestJobId=${supertestJobId}, pipelineJobId=${pipelineJobId}`);

    const installQueueJobId = `INSTALL_DEPS-${installJobId}`.replace(/[^A-Za-z0-9_-]/g, '-');
    const pipelineQueueJobId = `SUPERTEST_COVERAGE_PIPELINE-${pipelineJobId}`.replace(/[^A-Za-z0-9_-]/g, '-');

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
    console.warn(`[Queue] Error creating Supertest pipeline in Redis (${error.message}). Running in-memory...`);
    setTimeout(async () => {
      await executeJobDirectly('INSTALL_DEPS', installJobId);
      await executeJobDirectly('SUPERTEST_COVERAGE', supertestJobId);
    }, 10);
    return { name: 'SUPERTEST_COVERAGE_PIPELINE' };
  }
};
