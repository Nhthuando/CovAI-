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

  it("stores a valid failed report and marks the job failed once", async () => {
    runSystemTests.mockResolvedValue({ success: false, exitCode: 1 });
    parseSystemTestResult.mockReturnValue({ ...testRun, passedTests: 1, failedTests: 1, status: "FAILED" });
    lifecycle.getJobById.mockResolvedValueOnce(job).mockResolvedValueOnce(job);
    await expect(processSystemTestAnalysisJob("job-1")).rejects.toThrow("System tests failed");
    expect(prismaMock.testRun.create).toHaveBeenCalled();
    expect(lifecycle.markJobFailed).toHaveBeenCalledTimes(1);
  });
});
