import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getCoverageSummary, runCoverage, getCoverageFiles, getCoverageFunctions } from "../controllers/coverage.controller.js";

const router = express.Router();

// GET /api/coverage/:snapshotId/summary — lấy kết quả coverage summary
router.get("/:snapshotId/summary", authMiddleware, getCoverageSummary);

// SCRUM-155: GET /api/coverage/:snapshotId/files — lấy danh sách CoverageFile
// Query: ?sortBy=filePath|linesPct|branchesPct|funcsPct|stmtsPct&order=asc|desc&page=1&limit=50
router.get("/:snapshotId/files", authMiddleware, getCoverageFiles);

// POST /api/coverage/:snapshotId/run — trigger pipeline INSTALL_DEPS → RUN_TESTS
router.post("/:snapshotId/run", authMiddleware, runCoverage);

// SCRUM-160: GET /api/coverage/:snapshotId/functions — lấy danh sách CoverageFunction
// Query: ?filePath=<filter>&sortBy=functionName|filePath|hit|startLine&order=asc|desc&page=1&limit=50
router.get("/:snapshotId/functions", authMiddleware, getCoverageFunctions);


export default router;

