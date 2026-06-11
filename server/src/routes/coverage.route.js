import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getCoverageSummary, runCoverage } from "../controllers/coverage.controller.js";

const router = express.Router();

// GET /api/coverage/:snapshotId/summary — lấy kết quả coverage
router.get("/:snapshotId/summary", authMiddleware, getCoverageSummary);

// POST /api/coverage/:snapshotId/run — trigger pipeline INSTALL_DEPS → RUN_TESTS
router.post("/:snapshotId/run", authMiddleware, runCoverage);

export default router;
