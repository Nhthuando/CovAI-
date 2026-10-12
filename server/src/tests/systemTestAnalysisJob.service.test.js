import { jest, beforeEach, describe, expect, it } from "@jest/globals";
import { Prisma } from "@prisma/client";

const lifecycle = {
  addJobLog: jest.fn(), getJobById: jest.fn(), markJobFailed: jest.fn(),
  markJobRunning: jest.fn(), markJobSuccess: jest.fn(), updateJobProgress: jest.fn(),
};
const prismaMock = { testRun: { create: jest.fn() }, aiTest:{create:jest.fn()} };
const saveJobOutput = jest.fn();
const resolveSystemTestExecution = jest.fn();
const runSystemTests = jest.fn();
const parseSystemTestResult = jest.fn();
const prepareFullSystemExecution = jest.fn();

await jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
await jest.unstable_mockModule("../services/job.service.js", () => lifecycle);
await jest.unstable_mockModule("../services/jobOutput.service.js", () => ({ saveJobOutput }));
await jest.unstable_mockModule("../services/systemTestDetection.service.js", () => ({ resolveSystemTestExecution }));
await jest.unstable_mockModule("../services/systemTestRunner.service.js", () => ({ runSystemTests }));
await jest.unstable_mockModule("../services/systemTestResultParser.service.js", () => ({ parseSystemTestResult }));
await jest.unstable_mockModule('../services/fullSystemExecutionPreparation.service.js',()=>({prepareFullSystemExecution}));
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
const testRun = { totalTests: 2, passedTests: 2, failedTests: 0, skippedTests: 0, stabilityScorePct: 100, durationMs: 12, status: "PASSED", startedAt: new Date(), finishedAt: new Date() };

describe("processSystemTestAnalysisJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lifecycle.getJobById.mockResolvedValue(job);
    resolveSystemTestExecution.mockReturnValue(execution);
    runSystemTests.mockResolvedValue({ success: true, exitCode: 0 });
    prepareFullSystemExecution.mockImplementation(async ({execution})=>({execution}));
    parseSystemTestResult.mockReturnValue(testRun);
    // Model the real Prisma boundary instead of accepting unsupported fields silently.
    prismaMock.testRun.create.mockImplementation(async ({ data }) => {
      const fields = new Set(Prisma.dmmf.datamodel.models.find((model) => model.name === "TestRun").fields.map((field) => field.name));
      for (const field of Object.keys(data)) {
        if (!fields.has(field)) throw new Error(`Unknown TestRun field: ${field}`);
      }
      return { id: "test-run-1", ...data };
    });
  });

  it('generates a verified full suite for a fresh import and stores its mode separately',async()=>{
    resolveSystemTestExecution.mockImplementationOnce(()=>{throw new Error('No executable Playwright configuration was found');});
    const generated={filePath:'tests/system/ai-generated.spec.js',code:'verified content',verificationRuns:2};
    prepareFullSystemExecution.mockImplementationOnce(async({execution})=>({execution:{...execution,testDirectory:'tests/system'},generated}));
    await processSystemTestAnalysisJob('job-1');
    expect(prismaMock.aiTest.create).toHaveBeenCalledWith({data:expect.objectContaining({projectId:'project-1',snapshotId:'snapshot-1',status:'VERIFIED',content:'verified content',metaJson:expect.stringContaining('"executionMode":"full"')})});
    expect(runSystemTests).toHaveBeenCalledWith(expect.objectContaining({executionMode:'full',execution:expect.objectContaining({testDirectory:'tests/system'})}));
  });

  it('finalizes provider failures during generation without starting a runner or creating reports',async()=>{
    prepareFullSystemExecution.mockRejectedValueOnce(new Error('Gemini service unavailable (503)'));
    await expect(processSystemTestAnalysisJob('job-1')).rejects.toThrow('503');
    expect(lifecycle.markJobFailed).toHaveBeenCalledTimes(1);expect(runSystemTests).not.toHaveBeenCalled();expect(prismaMock.testRun.create).not.toHaveBeenCalled();
  });

  it("stores a passing TestRun and completes the job", async () => {
    await expect(processSystemTestAnalysisJob("job-1")).resolves.toMatchObject({ runner: "playwright", coverageAvailable: false });
    expect(prismaMock.testRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ snapshotId: "snapshot-1", type: "PLAYWRIGHT", passedTests: 2 }) });
    expect(lifecycle.markJobSuccess).toHaveBeenCalledWith("job-1", expect.objectContaining({ exitCode: 0, coverageAvailable: false }));
    expect(prismaMock.testRun.create.mock.calls[0][0].data).not.toHaveProperty("stabilityScorePct");
    expect(lifecycle.markJobSuccess.mock.calls[0][1].testRun.stabilityScorePct).toBe(100);
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

  it('stores bounded attempt detail and preserves a meaningful zero duration', async () => {
    const executionDetails = { version: 1, runner: 'playwright', attempts: [{ index: 0, status: 'passed', durationMs: 0, steps: [] }] };
    parseSystemTestResult.mockReturnValue({ ...testRun, scenarios: [{ title: 'Zero duration', status: 'passed', durationMs: 0, executionDetails }] });
    await processSystemTestAnalysisJob('job-1');
    const stored = prismaMock.testRun.create.mock.calls[0][0].data.scenarios.create[0];
    expect(stored).toMatchObject({ durationMs: 0, executionDetails });
    const fields = Prisma.dmmf.datamodel.models.find(model => model.name === 'TestScenario').fields.map(field => field.name);
    expect(fields).toContain('executionDetails');
    expect(Object.keys(stored).every(field => fields.includes(field))).toBe(true);
  });

  it("finalizes preparation failures without saving a test result", async () => {
    runSystemTests.mockImplementationOnce(async ({onPreparing}) => {
      await onPreparing(22, 'Generating missing Full Stack setup');
      throw new Error('Full Stack setup needs more information: schema');
    });
    await expect(processSystemTestAnalysisJob('job-1')).rejects.toThrow('setup needs more information');
    expect(lifecycle.updateJobProgress).toHaveBeenCalled();
    expect(lifecycle.markJobFailed).toHaveBeenCalledTimes(1);
    expect(prismaMock.testRun.create).not.toHaveBeenCalled();
    expect(lifecycle.markJobSuccess).not.toHaveBeenCalled();
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
