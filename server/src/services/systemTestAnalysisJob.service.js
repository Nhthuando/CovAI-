import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import {
  addJobLog,
  getJobById,
  markJobFailed,
  markJobRunning,
  markJobSuccess,
  updateJobProgress,
} from "./job.service.js";
import { saveJobOutput } from "./jobOutput.service.js";
import { parseCoverageSummary } from "./coverageSummaryParser.service.js";
import { parseCoverageFilesForSnapshot } from "./coverageFileParser.service.js";
import { parseCoverageFunctionsForSnapshot } from "./coverageFunctionParser.service.js";
import { storeCoverageOutputs } from "./coverageStorage.service.js";
import { resolveSystemTestExecution } from "./systemTestDetection.service.js";
import { runSystemTests } from "./systemTestRunner.service.js";
import { parseSystemTestResult } from "./systemTestResultParser.service.js";

const readPayload = (payloadJson) => {
  if (!payloadJson) return {};
  try {
    const payload = JSON.parse(payloadJson);
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    throw new ServiceError("System test job payload is invalid", 422);
  }
};

const testTypeFor = (runner) => (runner === "playwright" ? "PLAYWRIGHT" : "CYPRESS");

const persistCoverageIfPresent = async ({ job, coverageDir, jobId }) => {
  const summaryPath = path.join(coverageDir, "coverage-summary.json");
  const finalPath = path.join(coverageDir, "coverage-final.json");
  const lcovPath = path.join(coverageDir, "lcov.info");
  const present = [summaryPath, finalPath, lcovPath].filter((file) => fs.existsSync(file));
  if (present.length === 0) return { coverageAvailable: false, coverageStorage: null };

  if (!fs.existsSync(summaryPath) || !fs.existsSync(finalPath)) {
    throw new ServiceError(
      "System test coverage is incomplete: coverage-summary.json and coverage-final.json are both required.",
      422,
    );
  }

  let coverageReport;
  try {
    coverageReport = JSON.parse(fs.readFileSync(finalPath, "utf8"));
  } catch (error) {
    throw new ServiceError(`System test coverage-final.json is invalid: ${error.message}`, 422);
  }

  await parseCoverageSummary(coverageDir, job.snapshotId);
  await parseCoverageFilesForSnapshot({
    projectId: job.projectId,
    snapshotId: job.snapshotId,
    userId: job.userId,
    coverageReport,
  });

  // A valid Istanbul report can contain no functions (for example, a JSON-only
  // fixture). That should not invalidate an otherwise usable coverage run.
  try {
    await parseCoverageFunctionsForSnapshot({
      projectId: job.projectId,
      snapshotId: job.snapshotId,
      userId: job.userId,
      coverageReport,
    });
  } catch (error) {
    if (!/No function coverage records found/.test(error.message)) throw error;
    await addJobLog(jobId, "WARN", "Coverage report contains no function records.");
  }

  let coverageStorage = null;
  try {
    coverageStorage = await storeCoverageOutputs(job.snapshotId, job.projectId, coverageDir);
  } catch (error) {
    await addJobLog(jobId, "WARN", `Coverage files were persisted locally but upload failed: ${error.message}`);
  }

  return { coverageAvailable: true, coverageStorage };
};

const failOnce = async (jobId, error) => {
  try {
    const job = await getJobById(jobId);
    if (job.status === "RUNNING") await markJobFailed(jobId, error);
  } catch (finalizationError) {
    console.error(`[SystemTestAnalysisJob ${jobId}] Failed to record failure:`, finalizationError);
  }
};

export const processSystemTestAnalysisJob = async (jobId) => {
  try {
    await markJobRunning(jobId);
    const job = await getJobById(jobId);
    if (!job.snapshotId || !job.snapshot?.rootDir || !job.userId) {
      throw new ServiceError("System test job requires a ready snapshot and owner.", 422);
    }

    await saveJobOutput(jobId, { stdout: "", stderr: "" });
    await updateJobProgress(jobId, 10);
    const payload = readPayload(job.payloadJson);
    const execution = resolveSystemTestExecution({
      rootDir: job.snapshot.rootDir,
      runner: payload.runner ?? null,
    });
    await addJobLog(jobId, "INFO", `Selected ${execution.runner} system-test runner.`);

    await updateJobProgress(jobId, 25);
    const startedAt = new Date();
    const executionResult = await runSystemTests({
      jobId,
      rootDir: job.snapshot.rootDir,
      execution,
    });
    const finishedAt = new Date();

    await updateJobProgress(jobId, 70);
    const testRun = parseSystemTestResult({
      runner: execution.runner,
      resultPath: execution.reportPath,
      startedAt,
      finishedAt,
    });
    await prisma.testRun.create({
      data: {
        snapshotId: job.snapshotId,
        type: testTypeFor(execution.runner),
        ...testRun,
      },
    });

    await updateJobProgress(jobId, 85);
    const coverage = await persistCoverageIfPresent({
      job,
      coverageDir: execution.coverageDir,
      jobId,
    });
    const result = {
      runner: execution.runner,
      exitCode: executionResult.exitCode,
      testRun,
      ...coverage,
    };

    if (!executionResult.success || testRun.status === "FAILED") {
      throw new ServiceError("System tests failed", 422);
    }

    await markJobSuccess(jobId, result);
    await addJobLog(jobId, "INFO", "System test analysis completed.");
    return result;
  } catch (error) {
    try {
      await addJobLog(jobId, "ERROR", `System test analysis failed: ${error.message}`);
    } catch {
      // Preserve the original execution error when log persistence is unavailable.
    }
    await failOnce(jobId, error);
    throw error;
  }
};
