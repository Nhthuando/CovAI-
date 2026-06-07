import express from "express";
import projectController from "../controllers/project.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authMiddleware);

router.post("/", projectController.createProject);
router.get("/", projectController.listProjects);
router.get("/:id", projectController.getProjectById);
router.delete("/:id", projectController.deleteProject);
router.post("/:id/detect-jest", projectController.detectJestConfig);

export default router;