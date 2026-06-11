import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getCoverageSummary, runCoverage, getCoverageFiles } from "../controllers/coverage.controller.js";

const router = express.Router();

// GET /api/coverage/:snapshotId/summary — lấy kết quả coverage summary
router.get("/:snapshotId/summary", authMiddleware, getCoverageSummary);

// SCRUM-155: GET /api/coverage/:snapshotId/files — lấy danh sách CoverageFile
// Query: ?sortBy=filePath|linesPct|branchesPct|funcsPct|stmtsPct&order=asc|desc&page=1&limit=50
router.get("/:snapshotId/files", authMiddleware, getCoverageFiles);

// POST /api/coverage/:snapshotId/run — trigger pipeline INSTALL_DEPS → RUN_TESTS
router.post("/:snapshotId/run", authMiddleware, runCoverage);

export default router;

