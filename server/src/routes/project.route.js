import express from "express";
import projectController from "./../controllers/project.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { uploadSingleArchive } from "../middlewares/upload.middleware.js";

const router = express.Router();

router.use(authMiddleware);

router.post("/", projectController.createProject);
router.get("/", projectController.listProjects);
router.get("/:id", projectController.getProjectById);
router.get("/:id/tree", projectController.getProjectTree);
router.get("/:id/file-content", projectController.getFileContent);
router.post("/:id/upload-zip", uploadSingleArchive, projectController.uploadZip);
router.post("/:id/run-analysis", projectController.runAnalysis);
router.post("/:id/coverage/parse", projectController.parseCoverageFiles);
router.post(
  "/:id/coverage/functions/parse",
  projectController.parseCoverageFunctions,
);
router.delete("/:id", projectController.deleteProject);
router.post("/:id/detect-jest", projectController.detectJestConfig);
router.post("/:id/import-github", projectController.importGitHub);
router.post("/:id/ai-suggest", projectController.runAiSuggest);
router.post("/:id/chat", projectController.chat);

export default router;
