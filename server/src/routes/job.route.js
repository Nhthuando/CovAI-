import { listProjectJobs, getJobDetail, ingestJob, listUserJobs, cancelJobController, streamJobStatus } from "../controllers/job.controller.js"
import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js"
import { uploadSingleArchive } from "../middlewares/upload.middleware.js"

const router = express.Router();

router.get("/user", authMiddleware, listUserJobs);
router.get("/:projectId/jobs", authMiddleware, listProjectJobs);
router.get("/:jobId/stream", authMiddleware, streamJobStatus);
router.get("/:jobId", authMiddleware, getJobDetail);
router.post("/:jobId/cancel", authMiddleware, cancelJobController);
router.post("/:projectId/ingest", authMiddleware, uploadSingleArchive, ingestJob);

export default router;
