/**
 * @file unitTestQueueJob.service.js
 * @description Background BullMQ job processors for Unit Test AI Suggestions
 *   (UNIT_TEST_SUGGEST) and Unit Test Apply & Verification (UNIT_TEST_APPLY),
 *   persisting progress and final results in PostgreSQL Job.resultJson so
 *   switching projects or reloading never loses the active session.
 */

import prisma from '../config/prisma.js';
import {
  markJobRunning,
  markJobSuccess,
  markJobFailed,
  updateJobProgress,
  addJobLog,
} from './job.service.js';
import { isJobCanceled } from './jobCancellation.service.js';
import { suggestUnitTestcases } from './unitTestSuggestion.service.js';
import { applyUnitTestSuggestion } from './applyTestSuggestion.service.js';
import { scheduleUnitTestPostApplyAnalysis } from './unitTestPostApplyAnalysis.service.js';
import { ServiceError } from '../utils/serviceError.js';

function safeParseJson(raw, fallback = {}) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function withJobHeartbeat(jobId, label, fn) {
  const interval = setInterval(() => {
    if (isJobCanceled(jobId)) return;
    void addJobLog(jobId, 'INFO', `${label} still running...`).catch(() => {});
  }, 30_000);
  if (typeof interval.unref === 'function') {
    interval.unref();
  }
  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
}

export async function processUnitTestSuggestJob(jobId) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      projectId: true,
      snapshotId: true,
      userId: true,
      status: true,
      payloadJson: true,
    },
  });

  if (!job) {
    throw new ServiceError(`Job ${jobId} not found`, 404);
  }
  if (job.status === 'CANCELED' || isJobCanceled(jobId)) {
    return null;
  }

  const payload = safeParseJson(job.payloadJson, {});
  const projectId = payload.projectId || job.projectId;
  const snapshotId = payload.snapshotId || job.snapshotId;
  const userId = payload.userId || job.userId;

  await markJobRunning(jobId);
  await updateJobProgress(jobId, 10);
  await addJobLog(
    jobId,
    'INFO',
    `Starting UNIT_TEST_SUGGEST for ${
      Array.isArray(payload.filePaths) && payload.filePaths.length > 0
        ? `${payload.filePaths.length} files`
        : payload.filePath || 'all'
    }`
  );

  try {
    let lastReportedPct = 10;
    const result = await withJobHeartbeat(jobId, 'UNIT_TEST_SUGGEST', () =>
      suggestUnitTestcases({
        projectId,
        snapshotId,
        filePath: payload.filePath || 'all',
        filePaths: Array.isArray(payload.filePaths) ? payload.filePaths : undefined,
        validationMode: payload.validationMode || 'fast',
        userId,
        framework: payload.framework,
        selectedAiModel: payload.selectedAiModel,
        shouldCancel: () => isJobCanceled(jobId),
        onProgress: async ({ completedCount, totalCount, currentFile, failed }) => {
          if (isJobCanceled(jobId) || !totalCount) return;
          const pct = Math.min(95, 10 + Math.round((completedCount / totalCount) * 85));
          await addJobLog(
            jobId,
            failed ? 'WARN' : 'INFO',
            `[${completedCount}/${totalCount}] ${failed ? 'Skipped' : 'Generated'} ${currentFile}`
          ).catch(() => {});
          if (pct > lastReportedPct) {
            lastReportedPct = pct;
            await updateJobProgress(jobId, pct).catch(() => {});
          }
        },
      })
    );

    if (isJobCanceled(jobId)) {
      return null;
    }

    await addJobLog(
      jobId,
      'INFO',
      `Generated ${Array.isArray(result?.suggestions) ? result.suggestions.length : 0} test suggestion(s).`
    );
    await markJobSuccess(jobId, result);
    return result;
  } catch (error) {
    console.error(`[processUnitTestSuggestJob] Job ${jobId} failed:`, error);
    if (!isJobCanceled(jobId)) {
      await markJobFailed(jobId, error);
    }
    throw error;
  }
}

export async function processUnitTestApplyJob(jobId) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      projectId: true,
      snapshotId: true,
      userId: true,
      status: true,
      payloadJson: true,
    },
  });

  if (!job) {
    throw new ServiceError(`Job ${jobId} not found`, 404);
  }
  if (job.status === 'CANCELED' || isJobCanceled(jobId)) {
    return null;
  }

  const payload = safeParseJson(job.payloadJson, {});
  const projectId = payload.projectId || job.projectId;
  const snapshotId = payload.snapshotId || job.snapshotId;
  const userId = payload.userId || job.userId;

  await markJobRunning(jobId);
  await updateJobProgress(jobId, 10);
  const sugCount = Array.isArray(payload.suggestions)
    ? payload.suggestions.length
    : payload.suggestion
    ? 1
    : 0;
  await addJobLog(jobId, 'INFO', `Starting UNIT_TEST_APPLY for ${sugCount} suggestion(s).`);

  try {
    const result = await withJobHeartbeat(jobId, 'UNIT_TEST_APPLY', () =>
      applyUnitTestSuggestion({
        snapshotId,
        projectId,
        userId,
        suggestion: payload.suggestion,
        suggestions: payload.suggestions,
        requestId: payload.requestId,
        requireCoverageGoal: payload.requireCoverageGoal === true,
      })
    );

    if (isJobCanceled(jobId)) {
      return null;
    }

    let backgroundJob = null;
    let postApplyAnalysisError = null;
    if (snapshotId && projectId) {
      try {
        backgroundJob = await scheduleUnitTestPostApplyAnalysis({
          result,
          projectId,
          snapshotId,
          userId,
          requestId: payload.requestId,
          skipBackgroundJob: payload.skipBackgroundJob,
        });
      } catch (jobErr) {
        postApplyAnalysisError =
          'Automatic coverage refresh could not be queued. Run Analysis to refresh project coverage.';
        console.warn('[processUnitTestApplyJob] Warning scheduling post-apply analysis:', jobErr.message);
      }
    }

    const finalResult = {
      ...result,
      backgroundJob,
      ...(postApplyAnalysisError ? { postApplyAnalysisError } : {}),
    };

    await addJobLog(jobId, 'INFO', 'Completed unit test apply & verification.');
    await markJobSuccess(jobId, finalResult);
    return finalResult;
  } catch (error) {
    console.error(`[processUnitTestApplyJob] Job ${jobId} failed:`, error);
    if (!isJobCanceled(jobId)) {
      await markJobFailed(jobId, error);
    }
    throw error;
  }
}
