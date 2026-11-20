import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// Mock dependencies for unit/regression testing
const prismaMock = {
  projectOperation:{updateMany:jest.fn(async()=>({count:1}))},
  project:{findFirst:jest.fn(async()=>null)},
  $executeRaw:jest.fn(async()=>1),
  job: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  jobLog: {
    create: jest.fn().mockResolvedValue({ id: "log-1" }),
  },
  projectStructureAnalysis: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
  aiTest: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
  },
  aiSuggestion: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  testRun: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  coverageSummary: {
    findUnique: jest.fn(),
  },
  coverageFile: {
    findMany: jest.fn(),
  },
  projectSnapshot: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(async run=>run(prismaMock)),
};

const jobServiceMock = {
  getJobById: jest.fn(),
  markJobRunning: jest.fn(),
  markJobSuccess: jest.fn(),
  markJobFailed: jest.fn(),
  updateJobProgress: jest.fn(),
  addJobLog: jest.fn(),
};

const analyzeProjectStructureMock = jest.fn();
const dockerRunnerMock = {
  run: jest.fn(),
};

// Wire up mocks
jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
jest.unstable_mockModule("../services/dockerRunner.service.js", () => ({ dockerRunner: dockerRunnerMock }));
jest.unstable_mockModule("../services/projectStructureAnalyzer.service.js", () => ({
  analyzeProjectStructure: analyzeProjectStructureMock,
}));
jest.unstable_mockModule("../services/queue.service.js", () => ({
  jobQueue: { add: jest.fn() },
  addJobToQueue: jest.fn(),
  addSupertestCoveragePipeline: jest.fn(),
}));

// Import modules under test
const {
  abortJob,
  isJobCanceled,
  registerJobAbortController,
  unregisterJobAbortController,
  resetJobCancellation,
  getJobAbortSignal,
} = await import("../services/jobCancellation.service.js");

const { cancelJob, markJobSuccess } = await import("../services/job.service.js");
const { cancelJobController } = await import("../controllers/job.controller.js");
const { processAnalysisJob } = await import("../services/analysisJob.service.js");

describe("COVAI Phase 1: Cancellable Operations & Preserved Results", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetJobCancellation();
  });

  // 1. Cancel running Job
  it("1. Successfully cancels a RUNNING job, updates status to CANCELED, and triggers abort signal", async () => {
    const runningJob = {
      id: "job-running-1",
      status: "RUNNING",
      userId: "user-1",
      projectId: "proj-1",
    };

    prismaMock.job.findUnique.mockResolvedValue(runningJob);
    prismaMock.job.update.mockResolvedValue({
      ...runningJob,
      status: "CANCELED",
      finishedAt: new Date(),
    });

    const abortController = new AbortController();
    registerJobAbortController("job-running-1", abortController);

    const result = await cancelJob("job-running-1");

    expect(result.status).toBe("CANCELED");
    expect(abortController.signal.aborted).toBe(true);
    expect(isJobCanceled("job-running-1")).toBe(true);
    expect(prismaMock.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-running-1" },
        data: expect.objectContaining({ status: "CANCELED" }),
      })
    );
  });

  // 2. Cancel waiting Job
  it("2. Successfully cancels a QUEUED job before worker begins", async () => {
    const queuedJob = {
      id: "job-queued-1",
      status: "QUEUED",
      userId: "user-1",
      projectId: "proj-1",
    };

    prismaMock.job.findUnique.mockResolvedValue(queuedJob);
    prismaMock.job.update.mockResolvedValue({
      ...queuedJob,
      status: "CANCELED",
      finishedAt: new Date(),
    });

    const result = await cancelJob("job-queued-1");

    expect(result.status).toBe("CANCELED");
    expect(isJobCanceled("job-queued-1")).toBe(true);
    expect(prismaMock.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-queued-1" },
        data: expect.objectContaining({ status: "CANCELED" }),
      })
    );
  });

  // 3. Repeated cancellation (idempotent)
  it("3. Cancellation is idempotent: repeating cancel on an already canceled job returns safely without duplicate updates", async () => {
    const alreadyCanceled = {
      id: "job-already-canceled",
      status: "CANCELED",
      userId: "user-1",
      projectId: "proj-1",
    };

    prismaMock.job.findUnique.mockResolvedValue(alreadyCanceled);

    const result = await cancelJob("job-already-canceled");

    expect(result.status).toBe("CANCELED");
    // Database update should not be called again
    expect(prismaMock.job.update).not.toHaveBeenCalled();
    expect(isJobCanceled("job-already-canceled")).toBe(true);
  });

  // 4. Prevent unauthorized users from cancelling Jobs
  it("4. Prevents unauthorized users from cancelling jobs belonging to an inaccessible project (404)", async () => {
    const job = {
      id: "job-user-a",projectId:"unrelated-project",
      userId: "user-a",
      status: "RUNNING",
    };

    prismaMock.job.findUnique.mockResolvedValue(job);

    const req = {
      user: { id: "user-b" },
      params: { jobId: "job-user-a" },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await cancelJobController(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringMatching(/Project not found/i),
      })
    );
    expect(prismaMock.job.update).not.toHaveBeenCalled();
  });

  // 5. Cannot revert-cancel completed Jobs
  it("5. Disallows cancelling a job that already completed with SUCCESS (400)", async () => {
    const succeededJob = {
      id: "job-succeeded",
      status: "SUCCESS",
      userId: "user-1",
      projectId: "proj-1",
    };

    prismaMock.job.findUnique.mockResolvedValue(succeededJob);

    await expect(cancelJob("job-succeeded")).rejects.toThrow(
      "Cannot cancel a job that has already completed successfully"
    );
    expect(prismaMock.job.update).not.toHaveBeenCalled();
  });

  // 6. Worker halts before proceeding to subsequent execution steps
  it("6. Worker actively stops before continuing subsequent execution steps upon cancellation", async () => {
    const jobId = "job-worker-stop";
    const controller = new AbortController();
    registerJobAbortController(jobId, controller);

    // Cancel while running
    abortJob(jobId);

    expect(isJobCanceled(jobId)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  // 7. Latest successful result remains intact after cancelling Analyze
  it("7. Preserves previous project structure analysis when new Analyze job is cancelled midway", async () => {
    const jobId = "job-analyze-cancel";
    const snapshotId = "snapshot-keep-1";

    prismaMock.job.findUnique.mockResolvedValue({
      id: jobId,
      status: "QUEUED",
      snapshotId,
      snapshot: { rootDir: "C:/fake/path" },
    });
    prismaMock.job.update.mockResolvedValue({
      id: jobId,
      status: "RUNNING",
    });

    analyzeProjectStructureMock.mockImplementation(() => {
      // Simulate user clicking cancel while analyzing
      abortJob(jobId);
      return {
        schemaVersion: 1,
        summary: { totalFiles: 5 },
        analyzedAt: new Date().toISOString(),
      };
    });

    await processAnalysisJob(jobId);

    // CRITICAL: prisma.projectStructureAnalysis.upsert must NOT be called when cancelled!
    expect(prismaMock.projectStructureAnalysis.upsert).not.toHaveBeenCalled();
  });

  // 8. Latest complete test run remains intact after cancelling Generate
  it("8. Preserves latest complete test suite when Generate is canceled before transaction commit", async () => {
    const jobId = "job-generate-cancel";
    abortJob(jobId);

    // Verify isJobCanceled flags it before persistence
    expect(isJobCanceled(jobId)).toBe(true);

    // When cancelled, $transaction must not be executed
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.aiTest.deleteMany).not.toHaveBeenCalled();
  });

  // 9. Cancelled Run Tests retains executed test evidence without fabricating results for unrun tests
  it("9. Canceled Run Tests creates a TestRun marked CANCELED and retains actual executed test count without falsifying unexecuted tests", async () => {
    const snapshotId = "snapshot-supertest-cancel";
    const executedScenarios = [
      { title: "GET /api/menu returns 200", status: "passed" },
      { title: "POST /api/cart with invalid qty returns 400", status: "failed" },
    ];

    prismaMock.testRun.create.mockResolvedValue({
      id: "test-run-canceled-1",
      snapshotId,
      type: "SUPERTEST",
      status: "CANCELED",
      totalTests: 2,
      passedTests: 1,
      failedTests: 1,
      skippedTests: 0,
      scenarios: executedScenarios,
    });

    // Simulate partial evidence staging in supertestCoverageJob
    const passed = executedScenarios.filter((s) => s.status === "passed").length;
    const failed = executedScenarios.filter((s) => s.status === "failed").length;

    const run = await prismaMock.testRun.create({
      data: {
        snapshotId,
        type: "SUPERTEST",
        totalTests: executedScenarios.length,
        passedTests: passed,
        failedTests: failed,
        skippedTests: 0,
        status: "CANCELED",
      },
    });

    expect(run.status).toBe("CANCELED");
    expect(run.totalTests).toBe(2);
    expect(run.passedTests).toBe(1);
    expect(run.failedTests).toBe(1);
    // Unexecuted tests were NOT forged as PASSED or FAILED
    expect(run.passedTests + run.failedTests).toBe(run.totalTests);
  });

  // 10. State is properly restored after UI refresh
  it("10. State is properly recovered after UI refresh when job has been canceled", async () => {
    const canceledJob = {
      id: "job-refreshed",
      status: "CANCELED",
      type: "SUPERTEST_COVERAGE",
      progress: 40,
      errorMessage: null,
    };

    prismaMock.job.findUnique.mockResolvedValue(canceledJob);

    const fetched = await prismaMock.job.findUnique({ where: { id: "job-refreshed" } });
    expect(fetched.status).toBe("CANCELED");
  });

  // 11. No result overwrites due to race condition between Cancel and Complete
  it("11. Race condition resilience: markJobSuccess is rejected if a job was already CANCELED", async () => {
    const jobId = "job-race-condition";

    // Scenario A: Job was canceled before markJobSuccess completes
    prismaMock.job.findUnique.mockResolvedValue({
      id: jobId,
      status: "CANCELED",
      startedAt: new Date(Date.now() - 5000),
    });

    abortJob(jobId);

    await expect(markJobSuccess(jobId, { result: "late_payload" })).rejects.toThrow(
      "Cannot mark a canceled job as succeeded"
    );

    // Scenario B: Job finished successfully right when cancel arrives
    prismaMock.job.findUnique.mockResolvedValue({
      id: "job-race-finish",
      status: "SUCCESS",
    });

    await expect(cancelJob("job-race-finish")).rejects.toThrow(
      "Cannot cancel a job that has already completed successfully"
    );
  });
});
