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
import { storeCoverageOutputs } from "./coverageStorage.service.js";
import { resolveSystemTestExecution } from "./systemTestDetection.service.js";
import { runSystemTests } from "./systemTestRunner.service.js";
import { parseSystemTestResult } from "./systemTestResultParser.service.js";
import { storeScenarioScreenshot } from "./systemTestEvidence.service.js";
import { calculateSystemCoverage } from "./systemCoverageEngine.service.js";
import { collectSystemGenerationContext } from "./systemGenerationContext.service.js";
import crypto from "node:crypto";

const readPayload = (payloadJson) => {
  if (!payloadJson) return {};
  try {
    const payload = JSON.parse(payloadJson);
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    throw new ServiceError("System test job payload is invalid", 422);
  }
};

const testTypeFor = (runner) =>
  runner === "playwright" ? "PLAYWRIGHT" : "CYPRESS";

const persistCoverageIfPresent = async ({
  job,
  coverageDir,
  jobId,
  startedAt,
}) => {
  const summaryPath = path.join(coverageDir, "coverage-summary.json");
  const finalPath = path.join(coverageDir, "coverage-final.json");
  // Never feed E2E artifacts into the shared Unit/Integration coverage tables.
  if (
    [summaryPath, finalPath].every(
      (file) =>
        fs.existsSync(file) && fs.statSync(file).mtimeMs >= startedAt.getTime(),
    )
  ) {
    try {
      let coverageStorage = null;
      try {
        coverageStorage = await storeCoverageOutputs(
          job.snapshotId,
          job.projectId,
          coverageDir,
        );
      } catch (error) {
        await addJobLog(
          jobId,
          "WARN",
          `E2E coverage upload failed: ${error.message}`,
        );
      }
      await addJobLog(
        jobId,
        "INFO",
        "Fresh E2E coverage artifacts preserved separately from Unit test metrics.",
      );
      return { coverageAvailable: false, coverageStorage };
    } catch (error) {
      await addJobLog(
        jobId,
        "WARN",
        `E2E coverage processing failed: ${error.message}`,
      );
    }
  }
  await addJobLog(
    jobId,
    "INFO",
    "Black-box E2E: scenario results are available; source coverage is not measured.",
  );
  return { coverageAvailable: false, coverageStorage: null };
};

const failOnce = async (jobId, error) => {
  try {
    const job = await getJobById(jobId);
    if (job.status === "RUNNING") await markJobFailed(jobId, error);
  } catch (finalizationError) {
    console.error(
      `[SystemTestAnalysisJob ${jobId}] Failed to record failure:`,
      finalizationError,
    );
  }
};

const broadcastJobProgress = async (
  jobId,
  {
    progress,
    stage,
    message,
    status = "RUNNING",
    userId = null,
    snapshotId = null,
    runner = null,
  },
) => {
  try {
    if (progress !== undefined) {
      try {
        const p = updateJobProgress(jobId, progress);
        if (p && typeof p.catch === "function") await p.catch(() => { });
      } catch (_) { }
    }
    if (message) {
      try {
        const l = addJobLog(jobId, "INFO", message);
        if (l && typeof l.catch === "function") await l.catch(() => { });
      } catch (_) { }
    }
    if (global.io) {
      const payload = {
        jobId,
        snapshotId,
        progress,
        stage: stage || message,
        message,
        status,
        runner,
        updatedAt: new Date().toISOString(),
      };
      if (userId) {
        global.io.to(`user:${userId}`).emit("job:progress", payload);
      }
      if (snapshotId) {
        global.io.to(`snapshot:${snapshotId}`).emit("job:progress", payload);
      }
      global.io.to(`job:${jobId}`).emit("job:progress", payload);
    }
  } catch (err) {
    console.warn(`[broadcastJobProgress] Error for job ${jobId}:`, err.message);
  }
};

export const processSystemTestAnalysisJob = async (jobId) => {
  let jobOwnerId = null;
  let jobSnapshotId = null;
  try {
    await markJobRunning(jobId);
    const job = await getJobById(jobId);
    if (!job.snapshotId || !job.snapshot?.rootDir || !job.userId) {
      throw new ServiceError(
        "System test job requires a ready snapshot and owner.",
        422,
      );
    }
    jobOwnerId = job.userId;
    jobSnapshotId = job.snapshotId;

    await saveJobOutput(jobId, { stdout: "", stderr: "" });
    const payload = readPayload(job.payloadJson);
    const executionMode =
      payload.executionMode ||
      (payload.runner === "cypress" ? "frontend" : "full");
    if (!["full", "frontend"].includes(executionMode)) {
      throw new ServiceError(
        "System Test supports 'full' or 'frontend' execution mode only",
        400,
      );
    }
    const execution = resolveSystemTestExecution({
      rootDir: job.snapshot.rootDir,
      runner: payload.runner ?? null,
    });

    if (payload.testFile) {
      execution.testFile = payload.testFile;
      if (execution.runner === "cypress" && !execution.command.includes("--spec")) {
        const redirection = execution.command.indexOf(" > ");
        const specArg = ` --spec "${payload.testFile}"`;
        execution.command = redirection < 0
          ? execution.command + specArg
          : execution.command.slice(0, redirection) + specArg + execution.command.slice(redirection);
      }
    }

    await broadcastJobProgress(jobId, {
      progress: 15,
      stage: "Starting AUT server...",
      message: `Selected ${execution.runner} system-test runner. Starting AUT server...`,
      userId: job.userId,
      snapshotId: jobSnapshotId,
      runner: execution.runner,
    });

    const startedAt = new Date();
    const executionResult = await runSystemTests({
      jobId,
      rootDir: job.snapshot.rootDir,
      execution,
      executionMode,
      onReady: () =>
        broadcastJobProgress(jobId, {
          progress: 35,
          stage: `Executing ${execution.runner === "playwright" ? "Playwright" : "Cypress"} tests...`,
          message: `Executing ${execution.runner} tests in ${executionMode} mode...`,
          userId: job.userId,
          snapshotId: jobSnapshotId,
          runner: execution.runner,
        }),
    });
    const finishedAt = new Date();

    await broadcastJobProgress(jobId, {
      progress: 70,
      stage: "Parsing results...",
      message: "Parsing system test execution results and scenarios...",
      userId: job.userId,
      snapshotId: jobSnapshotId,
      runner: execution.runner,
    });

    const testRun = parseSystemTestResult({
      runner: execution.runner,
      resultPath: executionResult.reportPath || execution.reportPath,
      startedAt,
      finishedAt,
      rootDir: job.snapshot.rootDir,
    });
    if (executionResult.exitCode !== 0 && testRun.status === "PASSED") {
      throw new ServiceError(
        `System test runner exited with code ${executionResult.exitCode} despite a passing report`,
        422,
      );
    }

    let harvestedContext = {};
    try {
      harvestedContext = collectSystemGenerationContext(job.snapshot.rootDir);
    } catch (_) { }

    const systemCoverage = calculateSystemCoverage({
      rootDir: job.snapshot.rootDir,
      coverageDir: execution.coverageDir,
      scenarios: testRun.scenarios || [],
      testFiles: [execution.testFile].filter(Boolean),
      harvestedContext,
    });

    const { scenarios = [], ...testRunData } = testRun;
    const mappingFile = executionResult.reportPath && path.join(path.dirname(executionResult.reportPath), 'source-map.json');
    const sourceMap = mappingFile && fs.existsSync(mappingFile) ? JSON.parse(fs.readFileSync(mappingFile, 'utf8')) : {};
    const createdTestRun = await prisma.testRun.create({
      data: {
        snapshotId: job.snapshotId,
        type: testTypeFor(execution.runner),
        executionMode,
        ...testRunData,
        coverageLinesPct: systemCoverage.summary.linesPct,
        coverageBranchesPct: systemCoverage.summary.branchesPct,
        coverageStatementsPct: systemCoverage.summary.statementsPct,
        coverageFunctionsPct: systemCoverage.summary.functionsPct,
        ...(scenarios.length > 0
          ? {
            scenarios: {
              create: scenarios.map((s) => ({
                title: s.title,
                suiteName: s.suiteName || null,
                status: s.status,
                durationMs: s.durationMs || null,
                failureMessages: s.failureMessages || [],
                testFile: sourceMap[path.basename(s.testFile || '')] || s.testFile || null,
                screenshotPath: storeScenarioScreenshot({
                  rootDir: job.snapshot.rootDir,
                  source: s.screenshotSource,
                  runKey: crypto.randomUUID(),
                }),
                failureStep: s.failureStep || null,
                failureCategory: s.failureCategory || null,
                failureCodeSnippet: s.failureCodeSnippet || null,
                domSnapshot: s.domSnapshot || null,
                coverageLinesPct:
                  systemCoverage.scenarioContributions?.[s.title]?.linesPct ||
                  null,
                coverageBranchesPct:
                  systemCoverage.scenarioContributions?.[s.title]
                    ?.branchesPct || null,
              })),
            },
          }
          : {}),
      },
    });

    if (
      prisma.systemTestFile &&
      createdTestRun?.id &&
      Array.isArray(systemCoverage.fileBreakdown)
    ) {
      for (const fileItem of systemCoverage.fileBreakdown) {
        try {
          await prisma.systemTestFile.create({
            data: {
              testRunId: createdTestRun.id,
              filePath: fileItem.filePath,
              suiteCount: fileItem.suiteCount,
              scenarioCount: fileItem.scenarioCount,
              status: fileItem.status,
              durationMs: fileItem.durationMs,
              coverageLinesPct: fileItem.coverageLinesPct,
            },
          });
        } catch (_) { }
      }
    }

    await broadcastJobProgress(jobId, {
      progress: 85,
      stage: "Measuring coverage...",
      message: `System test coverage: ${systemCoverage.summary.linesPct}% lines, ${systemCoverage.summary.branchesPct}% branches`,
      userId: job.userId,
      snapshotId: jobSnapshotId,
      runner: execution.runner,
    });

    const coverage = await persistCoverageIfPresent({
      job,
      coverageDir: execution.coverageDir,
      startedAt,
      rootDir: job.snapshot.rootDir,
      jobId,
    });
    const result = {
      runner: execution.runner,
      exitCode: executionResult.exitCode,
      testRun: {
        ...testRun,
        coverage: systemCoverage.summary,
      },
      coverage: systemCoverage.summary,
      ...coverage,
    };

    if (testRun.status === "FAILED") {
      await addJobLog(
        jobId,
        "WARN",
        `System tests finished with ${testRun.failedTests} failed, ${testRun.flakyTests || 0} flaky, ${testRun.passedTests} passed test(s).`,
      );
    } else {
      await addJobLog(
        jobId,
        "INFO",
        `System tests finished successfully: ${testRun.passedTests} passed, ${testRun.flakyTests || 0} flaky test(s).`,
      );
    }

    await markJobSuccess(jobId, result);
    await broadcastJobProgress(jobId, {
      progress: 100,
      stage: "Completed",
      message: "System test analysis completed successfully.",
      status: "SUCCESS",
      userId: job.userId,
      snapshotId: jobSnapshotId,
      runner: execution.runner,
    });

    return result;
  } catch (error) {
    try {
      await addJobLog(
        jobId,
        "ERROR",
        `System test analysis failed: ${error.message}`,
      );
    } catch {
      // Preserve the original execution error when log persistence is unavailable.
    }
    await broadcastJobProgress(jobId, {
      progress: 100,
      stage: "Failed",
      message: `System test analysis failed: ${error.message}`,
      status: "FAILED",
      userId: jobOwnerId,
      snapshotId: jobSnapshotId,
    });
    await failOnce(jobId, error);
    throw error;
  }
};
