import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const prismaMock = { projectStructureAnalysis: { findUnique: jest.fn(), upsert: jest.fn() } };
const lifecycle = {
  getJobById: jest.fn(),
  markJobFailed: jest.fn(),
  markJobRunning: jest.fn(),
  markJobSuccess: jest.fn(),
  updateJobProgress: jest.fn(),
  addJobLog: jest.fn(),
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
  prismaMock.projectStructureAnalysis.findUnique.mockResolvedValue(null);
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

  it("preserves prior integration metadata when persisting architecture analysis", async () => {
    prismaMock.projectStructureAnalysis.findUnique.mockResolvedValue({
      id: "analysis-1",
      resultJson: JSON.stringify({
        integrationScan: { explicitlyScanned: true, discoveredEndpoints: [{ method: "GET", path: "/api/health" }] },
        peakIntegrationReport: { isPeakCoverageReport: true },
        deletedIntegrationScenarios: [{ testName: "obsolete" }],
      }),
    });

    await processAnalysisJob("job-1");

    const upsertCall = prismaMock.projectStructureAnalysis.upsert.mock.calls[0][0];
    const saved = JSON.parse(upsertCall.update.resultJson);
    expect(saved.summary).toEqual(completeResult.summary);
    expect(saved.graph).toEqual(completeResult.graph);
    expect(saved.integrationScan).toEqual({ explicitlyScanned: true, discoveredEndpoints: [{ method: "GET", path: "/api/health" }] });
    expect(saved.peakIntegrationReport).toEqual({ isPeakCoverageReport: true });
    expect(saved.deletedIntegrationScenarios).toEqual([{ testName: "obsolete" }]);
  });
});
