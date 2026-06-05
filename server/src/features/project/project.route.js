import express from "express";
import projectController from "./project.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authMiddleware);

router.post("/", projectController.createProject);
router.get("/", projectController.listProjects);
router.get("/:id", projectController.getProjectById);
router.delete("/:id", projectController.deleteProject);

export default router;