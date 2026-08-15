import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const prismaMock = { projectStructureAnalysis: { upsert: jest.fn() } };
const lifecycle = {
  getJobById: jest.fn(),
  markJobFailed: jest.fn(),
  markJobRunning: jest.fn(),
  markJobSuccess: jest.fn(),
  updateJobProgress: jest.fn(),
};
const analyzeProjectStructure = jest.fn();

jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
jest.unstable_mockModule("../services/job.service.js", () => lifecycle);
jest.unstable_mockModule("../services/projectStructureAnalyzer.service.js", () => ({ analyzeProjectStructure }));

const { processAnalysisJob } = await import("../services/analysisJob.service.js");

const completeResult = {
  schemaVersion: 1,
  snapshotId: "snapshot-1",
  analyzedAt: "2026-08-05T00:00:00.000Z",
  summary: { totalFiles: 2, totalFunctions: 1 },
  graph: { nodes: [], edges: [], externalDependencies: [] },
  tree: [],
  functions: [],
  architecture: { layers: [], flows: [], algorithmFlows: [], onboarding: {} },
  diagnostics: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  lifecycle.markJobRunning.mockResolvedValue({ id: "job-1" });
  lifecycle.getJobById.mockResolvedValue({ id: "job-1", snapshotId: "snapshot-1", snapshot: { rootDir: "C:/internal/snapshot" } });
  lifecycle.updateJobProgress.mockResolvedValue({ id: "job-1" });
  lifecycle.markJobSuccess.mockResolvedValue({ id: "job-1", status: "SUCCESS" });
  lifecycle.markJobFailed.mockResolvedValue({ id: "job-1", status: "FAILED" });
  prismaMock.projectStructureAnalysis.upsert.mockResolvedValue({ id: "analysis-1" });
  analyzeProjectStructure.mockReturnValue(completeResult);
});

describe("architecture analysis worker", () => {
  it("persists the full graph before marking the job successful", async () => {
    await processAnalysisJob("job-1");

    expect(analyzeProjectStructure).toHaveBeenCalledWith("C:/internal/snapshot", { snapshotId: "snapshot-1" });
    expect(prismaMock.projectStructureAnalysis.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { snapshotId: "snapshot-1" },
      create: expect.objectContaining({ schemaVersion: 1, resultJson: JSON.stringify(completeResult) }),
    }));
    expect(lifecycle.markJobSuccess).toHaveBeenCalledWith("job-1", expect.objectContaining({
      analysisId: "analysis-1", snapshotId: "snapshot-1", summary: completeResult.summary,
    }));
  });

  it("does not replace the saved result when analysis fails", async () => {
    analyzeProjectStructure.mockImplementation(() => { throw new Error("Malformed source"); });

    await processAnalysisJob("job-1");

    expect(prismaMock.projectStructureAnalysis.upsert).not.toHaveBeenCalled();
    expect(lifecycle.markJobFailed).toHaveBeenCalledWith("job-1", expect.objectContaining({ message: "Malformed source" }));
  });
});
