import request from "supertest";
import express from "express";
import { describe, expect, it, jest } from "@jest/globals";

const controller = {
  createProject: (_req, res) => res.status(200).json({ success: true }),
  listProjects: (_req, res) => res.status(200).json({ success: true }),
  getProjectById: (_req, res) => res.status(200).json({ success: true }),
  listSnapshots: (_req, res) => res.status(200).json({ success: true, data: [] }),
  getProjectTree: (_req, res) => res.status(200).json({ success: true, data: [] }),
  getFileContent: (_req, res) => res.status(200).json({ success: true, data: {} }),
  getStructureAnalysis: (_req, res) => res.status(200).json({ success: true, data: { schemaVersion: 1 } }),
  uploadZip: (_req, res) => res.status(200).json({ success: true }),
  runCoverageAnalysis: (_req, res) => res.status(201).json({ success: true, data: { job: { type: "RUN_TESTS" } } }),
  runStructureAnalysis: (_req, res) => res.status(201).json({ success: true, needsTests: false, reused: false, job: { type: "ANALYSIS" }, data: { job: { type: "ANALYSIS" } } }),
  buildCfg: (_req, res) => res.status(200).json({ success: true }),
  parseCoverageFiles: (_req, res) => res.status(200).json({ success: true }),
  parseCoverageFunctions: (_req, res) => res.status(200).json({ success: true }),
  deleteProject: (_req, res) => res.status(200).json({ success: true }),
  detectJestConfig: (_req, res) => res.status(200).json({ success: true }),
  importGitHub: (_req, res) => res.status(200).json({ success: true }),
  runAiSuggest: (_req, res) => res.status(200).json({ success: true }),
  runAiTests: (_req, res) => res.status(200).json({ success: true }),
  chat: (_req, res) => res.status(200).json({ success: true }),
  getCfg: (_req, res) => res.status(200).json({ success: true }),
  getCc: (_req, res) => res.status(200).json({ success: true }),
  getAiTests: (_req, res) => res.status(200).json({ success: true }),
  getAiTest: (_req, res) => res.status(200).json({ success: true }),
  generateFullTest: (_req, res) => res.status(200).json({ success: true }),
  updateFileContent: (_req, res) => res.status(200).json({ success: true }),
  createFile: (_req, res) => res.status(200).json({ success: true }),
  createFolder: (_req, res) => res.status(200).json({ success: true }),
  renameEntry: (_req, res) => res.status(200).json({ success: true }),
  deleteEntry: (_req, res) => res.status(200).json({ success: true }),
  detectPlaywrightConfig: (_req, res) => res.status(200).json({ success: true }),
  detectVitestConfig: (_req, res) => res.status(200).json({ success: true }),
  runPlaywrightTests: (_req, res) => res.status(200).json({ success: true }),
  runCypressTests: (_req, res) => res.status(200).json({ success: true }),
  runSystemTestAnalysis: (_req, res) => res.status(202).json({ success: true, data: { job: { type: "SYSTEM_TEST_ANALYSIS" } } }),
  runIntegrationTests: (_req, res) => res.status(200).json({ success: true }),
  generateIntegrationTest: (_req, res) => res.status(200).json({ success: true }),
  runVitestTests: (_req, res) => res.status(200).json({ success: true }),
  detectFrameworks: (_req, res) => res.status(200).json({ success: true, data: {} }),
  getFrameworkRecommendation: (_req, res) => res.status(200).json({ success: true, data: { recommendedFramework: "vitest" } }),
  selectTestingFramework: (_req, res) => res.status(200).json({ success: true, data: { selectedTestingFramework: "jest" } }),
};

await jest.unstable_mockModule("../controllers/project.controller.js", () => ({ default: controller }));
await jest.unstable_mockModule("../middlewares/auth.middleware.js", () => ({ authMiddleware: (req, _res, next) => { req.user = { id: "owner-1" }; next(); } }));
await jest.unstable_mockModule("../middlewares/upload.middleware.js", () => ({ uploadSingleArchive: (_req, _res, next) => next() }));
await jest.unstable_mockModule("../controllers/quality.controller.js", () => ({
  runQualityAnalysis: (_req, res) => res.status(200).json({ success: true }),
  fetchQualityReport: (_req, res) => res.status(200).json({ success: true }),
}));

const { default: projectRouter } = await import("../routes/project.route.js");

const app = express();
app.use(express.json());
app.use("/api/projects", projectRouter);

describe("project structure route contract", () => {
  it("keeps the Run Tests route separate from architecture analysis", async () => {
    const response = await request(app).post("/api/projects/project-1/run-analysis").send({});
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, data: { job: { type: "RUN_TESTS" } } });
  });

  it("starts static architecture analysis from its explicit route", async () => {
    const response = await request(app).post("/api/projects/project-1/structure-analysis").send({ snapshotId: "snapshot-1" });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ success: true, job: { type: "ANALYSIS" }, data: { job: { type: "ANALYSIS" } } });
  });

  it("exposes a read-only persisted-result route", async () => {
    const response = await request(app).get("/api/projects/project-1/structure-analysis?snapshotId=snapshot-1");
    expect(response.status).toBe(200);
    expect(response.body.data.schemaVersion).toBe(1);
  });

  it("exposes framework recommendation and selection routes", async () => {
    const recommendation = await request(app).get("/api/projects/project-1/test-framework-recommendation?snapshotId=snapshot-1");
    const selection = await request(app).put("/api/projects/project-1/test-framework-selection").send({ snapshotId: "snapshot-1", framework: "jest" });
    expect(recommendation.status).toBe(200);
    expect(recommendation.body.data.recommendedFramework).toBe("vitest");
    expect(selection.status).toBe(200);
    expect(selection.body.data.selectedTestingFramework).toBe("jest");
  });
});
