import { listProjectJobs, getJobDetail, ingestJob } from "../controllers/job.controller.js"
import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js"
import { uploadSingleZip } from "../middlewares/upload.middleware.js"

const router = express.Router();

router.get("/:projectId/jobs", authMiddleware, listProjectJobs);
router.get("/:jobId", authMiddleware, getJobDetail);
router.post("/:projectId/ingest", authMiddleware, uploadSingleZip, ingestJob);

export default router;
