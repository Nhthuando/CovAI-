import { jest, beforeEach, describe, expect, it } from "@jest/globals";

const lifecycle = {
  addJobLog: jest.fn(), getJobById: jest.fn(), markJobFailed: jest.fn(),
  markJobRunning: jest.fn(), markJobSuccess: jest.fn(), updateJobProgress: jest.fn(),
};
const prismaMock = { testRun: { create: jest.fn() } };
const saveJobOutput = jest.fn();
const resolveSystemTestExecution = jest.fn();
const runSystemTests = jest.fn();
const parseSystemTestResult = jest.fn();

await jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
await jest.unstable_mockModule("../services/job.service.js", () => lifecycle);
await jest.unstable_mockModule("../services/jobOutput.service.js", () => ({ saveJobOutput }));
await jest.unstable_mockModule("../services/systemTestDetection.service.js", () => ({ resolveSystemTestExecution }));
await jest.unstable_mockModule("../services/systemTestRunner.service.js", () => ({ runSystemTests }));
await jest.unstable_mockModule("../services/systemTestResultParser.service.js", () => ({ parseSystemTestResult }));
await jest.unstable_mockModule("../services/coverageSummaryParser.service.js", () => ({ parseCoverageSummary: jest.fn() }));
await jest.unstable_mockModule("../services/coverageFileParser.service.js", () => ({ parseCoverageFilesForSnapshot: jest.fn() }));
await jest.unstable_mockModule("../services/coverageFunctionParser.service.js", () => ({ parseCoverageFunctionsForSnapshot: jest.fn() }));
await jest.unstable_mockModule("../services/coverageStorage.service.js", () => ({ storeCoverageOutputs: jest.fn() }));

const { processSystemTestAnalysisJob } = await import("../services/systemTestAnalysisJob.service.js");

const job = {
  id: "job-1", status: "RUNNING", projectId: "project-1", snapshotId: "snapshot-1", userId: "user-1",
  payloadJson: JSON.stringify({ runner: "playwright" }), snapshot: { rootDir: "C:/snapshot" },
};
const execution = { runner: "playwright", reportDirectory: "C:/snapshot/.covai-system-test", reportPath: "report.json", coverageDir: "missing-coverage" };
const testRun = { totalTests: 2, passedTests: 2, failedTests: 0, skippedTests: 0, durationMs: 12, status: "PASSED", startedAt: new Date(), finishedAt: new Date() };

describe("processSystemTestAnalysisJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lifecycle.getJobById.mockResolvedValue(job);
    resolveSystemTestExecution.mockReturnValue(execution);
    runSystemTests.mockResolvedValue({ success: true, exitCode: 0 });
    parseSystemTestResult.mockReturnValue(testRun);
  });

  it("stores a passing TestRun and completes the job", async () => {
    await expect(processSystemTestAnalysisJob("job-1")).resolves.toMatchObject({ runner: "playwright", coverageAvailable: false });
    expect(prismaMock.testRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ snapshotId: "snapshot-1", type: "PLAYWRIGHT", passedTests: 2 }) });
    expect(lifecycle.markJobSuccess).toHaveBeenCalledWith("job-1", expect.objectContaining({ exitCode: 0, coverageAvailable: false }));
  });

  it("stores a valid report with test failures and still marks the job success", async () => {
    runSystemTests.mockResolvedValue({ success: false, exitCode: 1 });
    parseSystemTestResult.mockReturnValue({ ...testRun, passedTests: 1, failedTests: 1, status: "FAILED" });
    await expect(processSystemTestAnalysisJob("job-1")).resolves.toMatchObject({
      runner: "playwright",
      exitCode: 1,
      coverageAvailable: false,
    });
    expect(prismaMock.testRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ snapshotId: "snapshot-1", type: "PLAYWRIGHT", passedTests: 1, failedTests: 1, status: "FAILED" }),
    });
    expect(lifecycle.markJobSuccess).toHaveBeenCalledWith("job-1", expect.objectContaining({ exitCode: 1 }));
    expect(lifecycle.markJobFailed).not.toHaveBeenCalled();
  });

  it("marks the job failed once when infrastructure execution crashes", async () => {
    runSystemTests.mockRejectedValue(new Error("Docker daemon crash"));
    lifecycle.getJobById.mockResolvedValueOnce(job).mockResolvedValueOnce(job);
    await expect(processSystemTestAnalysisJob("job-1")).rejects.toThrow("Docker daemon crash");
    expect(prismaMock.testRun.create).not.toHaveBeenCalled();
    expect(lifecycle.markJobFailed).toHaveBeenCalledTimes(1);
  });

  it("persists flaky tests and nested test scenarios into TestRun and completes job", async () => {
    parseSystemTestResult.mockReturnValue({
      totalTests: 3,
      passedTests: 2,
      failedTests: 0,
      flakyTests: 1,
      skippedTests: 0,
      durationMs: 1500,
      status: "PASSED",
      startedAt: new Date(),
      finishedAt: new Date(),
      scenarios: [
        { title: "scenario 1", suiteName: "auth.spec.js", status: "passed", durationMs: 400, failureMessages: [], testFile: "auth.spec.js" },
        { title: "scenario 2", suiteName: "auth.spec.js", status: "flaky", durationMs: 1100, failureMessages: ["flaky error"], testFile: "auth.spec.js" },
      ],
    });
    await expect(processSystemTestAnalysisJob("job-1")).resolves.toMatchObject({
      runner: "playwright",
      coverageAvailable: false,
    });
    expect(prismaMock.testRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshotId: "snapshot-1",
        type: "PLAYWRIGHT",
        flakyTests: 1,
        scenarios: {
          create: expect.arrayContaining([
            expect.objectContaining({ title: "scenario 1", status: "passed" }),
            expect.objectContaining({ title: "scenario 2", status: "flaky" }),
          ]),
        },
      }),
    });
    expect(lifecycle.markJobSuccess).toHaveBeenCalledWith("job-1", expect.objectContaining({ coverageAvailable: false }));
  });
});
