import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getCoverageSummary } from "../controllers/coverage.controller.js";

const router = express.Router();

// SCRUM-151: Coverage Summary endpoint
// GET /api/coverage/:snapshotId/summary
router.get("/:snapshotId/summary", authMiddleware, getCoverageSummary);

export default router;
