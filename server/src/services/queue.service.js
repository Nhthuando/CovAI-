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
    if (times > 2) return null;
    return 500;
  },
  enableOfflineQueue: false,
};

const connection = new IORedis(
  process.env.REDIS_URL || 'redis://localhost:6379',
  redisOptions,
);

connection.on('connect', () => {
  isRedisConnected = true;
  console.log('[Queue] Connected to Redis successfully.');
});

connection.on('error', (err) => {
  isRedisConnected = false;
});

export const jobQueue = new Queue('covai-jobs', { connection });
export const flowProducer = new FlowProducer({ connection });

jobQueue.on('error', () => { isRedisConnected = false; });

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
      console.log(`[Queue] Hoàn thành Job ${jobId} (Type: ${type})`);
    } catch (error) {
      console.error(`[Queue] Lỗi xử lý Job ${jobId} (Type: ${type}):`, error);
      throw error;
    }
  },
  { connection },
);

worker.on('failed', (job, err) => {
  console.error(
    `[Queue] BullMQ báo Job ${job?.data?.jobId} failed với lỗi: ${err.message}`,
  );
});

export const addJobToQueue = async (type, jobId, customData = {}, jobOptions = {}) => {
  if (!isRedisConnected) {
    console.warn(`[Queue] Redis không khả dụng. Thực thi Job ${jobId} (${type}) trực tiếp in-memory...`);
    setTimeout(() => executeJobDirectly(type, jobId, customData), 10);
    return;
  }

  try {
    const dedupeKey = `${type}-${jobId}`.replace(/[^A-Za-z0-9_-]/g, '-');
    await jobQueue.add(type, { type, jobId, ...customData }, { jobId: dedupeKey, ...jobOptions });
    console.log(`[Queue] Đã đưa Job ${jobId} (Type: ${type}) vào hàng đợi với dedupe key ${dedupeKey}.`);
  } catch (redisErr) {
    console.warn(`[Queue] Lỗi khi thêm job vào Redis (${redisErr.message}). Chuyển sang thực thi trực tiếp in-memory...`);
    setTimeout(() => executeJobDirectly(type, jobId, customData), 10);
  }
};

/**
 * Creates a Supertest coverage pipeline with proper BullMQ dependency direction.
 */
export const addSupertestCoveragePipeline = async (installJobId, supertestJobId, options = {}) => {
  const pipelineJobId = `${supertestJobId}-pipeline`;

  if (!isRedisConnected) {
    console.warn(`[Queue] Redis không khả dụng cho Supertest pipeline. Chạy trực tiếp in-memory...`);
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
