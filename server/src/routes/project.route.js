import express from "express";
import projectController from "./../controllers/project.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { uploadSingleArchive } from "../middlewares/upload.middleware.js";
import {
  runQualityAnalysis,
  fetchQualityReport,
} from "../controllers/quality.controller.js";

const router = express.Router();

router.use(authMiddleware);

router.post("/", projectController.createProject);
router.get("/", projectController.listProjects);
router.get("/:id", projectController.getProjectById);
router.get("/:id/snapshots", projectController.listSnapshots);
router.get("/:id/structure-analysis", projectController.getStructureAnalysis);
router.get("/:id/tree", projectController.getProjectTree);
router.get("/:id/file-content", projectController.getFileContent);
router.put("/:id/file-content", projectController.updateFileContent);
router.post("/:id/files", projectController.createFile);
router.post("/:id/folders", projectController.createFolder);
router.patch("/:id/entries", projectController.renameEntry);
router.delete("/:id/entries", projectController.deleteEntry);
router.post(
  "/:id/upload-zip",
  uploadSingleArchive,
  projectController.uploadZip,
);
router.post("/:id/run-analysis", projectController.runCoverageAnalysis);
router.post("/:id/structure-analysis", projectController.runStructureAnalysis);
router.post("/:id/quality-analysis", runQualityAnalysis);
router.get("/:id/quality-report", fetchQualityReport);
router.post("/:id/cfg/build", projectController.buildCfg);
router.post("/:id/coverage/parse", projectController.parseCoverageFiles);
router.post(
  "/:id/coverage/functions/parse",
  projectController.parseCoverageFunctions,
);
router.delete("/:id", projectController.deleteProject);
router.post("/:id/detect-jest", projectController.detectJestConfig);
router.post("/:id/detect-playwright", projectController.detectPlaywrightConfig);
router.post("/:id/detect-vitest", projectController.detectVitestConfig);
router.get("/:id/detect-frameworks", projectController.detectFrameworks);
router.post("/:id/run-playwright", projectController.runPlaywrightTests);
router.post("/:id/run-cypress", projectController.runCypressTests.bind(projectController));
router.post("/:id/system-test-analysis", projectController.runSystemTestAnalysis.bind(projectController));
router.post(
  "/:id/run-integration-tests",
  projectController.runIntegrationTests,
);
router.post("/:id/import-github", projectController.importGitHub);
router.post("/:id/ai-suggest", projectController.runAiSuggest);
router.post("/:id/ai-tests", projectController.runAiTests);
router.post("/:id/chat", projectController.chat);
router.get("/:id/cfg", projectController.getCfg);
router.get("/:id/cc", projectController.getCc);
router.get("/:id/ai/tests", projectController.getAiTests);
router.get("/:id/ai/tests/:testId", projectController.getAiTest);
router.post(
  "/:id/ai/generate-integration-test",
  projectController.generateIntegrationTest,
);
router.post(
  "/:id/run-vitest",
  authMiddleware,
  projectController.runVitestTests.bind(projectController),
);

export default router;
