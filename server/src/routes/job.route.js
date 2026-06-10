import { listProjectJobs } from "../controllers/job.controller.js"
import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js"

const router = express.Router();

router.get("/:projectId/jobs", authMiddleware, listProjectJobs);

export default router;