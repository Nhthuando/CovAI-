import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
    getCoverageSummary,
    runCoverage,
    runSupertestCoverage,
    getCoverageFiles,
    getCoverageFunctions,
    getTestExecution,
    getCoverageFrameworks,
    runCoverageByType,
    getIntegrationWorkspace,
    approveIntegrationTests,
    getFileCoverage,
    suggestUnitTestcase,
    getCoverageTestSuites
} from "../controllers/coverage.controller.js";

const router = express.Router();

// GET /api/coverage/:snapshotId/summary — lấy kết quả coverage summary
router.get("/:snapshotId/summary", authMiddleware, getCoverageSummary);
router.get("/:snapshotId/frameworks", authMiddleware, getCoverageFrameworks);

// SCRUM-155: GET /api/coverage/:snapshotId/files — lấy danh sách CoverageFile
// Query: ?sortBy=filePath|linesPct|branchesPct|funcsPct|stmtsPct&order=asc|desc&page=1&limit=50
router.get("/:snapshotId/files", authMiddleware, getCoverageFiles);

// GET /api/coverage/:snapshotId/file-coverage — lấy line-by-line coverage & assertion failures
router.get("/:snapshotId/file-coverage", authMiddleware, getFileCoverage);

// POST /api/coverage/:snapshotId/suggest-testcase — đề xuất unit testcase bằng AI cho file nguồn
router.post("/:snapshotId/suggest-testcase", authMiddleware, suggestUnitTestcase);

// POST /api/coverage/:snapshotId/run — trigger pipeline INSTALL_DEPS → RUN_TESTS
router.post("/:snapshotId/run", authMiddleware, runCoverage);

router.post("/:snapshotId/supertest/run", authMiddleware, runSupertestCoverage);
router.post("/:snapshotId/:coverageType/run", authMiddleware, runCoverageByType);

// SCRUM-160: GET /api/coverage/:snapshotId/functions — lấy danh sách CoverageFunction
// Query: ?filePath=<filter>&sortBy=functionName|filePath|hit|startLine&order=asc|desc&page=1&limit=50
router.get("/:snapshotId/functions", authMiddleware, getCoverageFunctions);

router.get("/:snapshotId/test-execution", authMiddleware, getTestExecution);

// Integration Workspace (Phase 1)
router.get("/:snapshotId/integration/workspace", authMiddleware, getIntegrationWorkspace);
router.post("/:snapshotId/integration/approve", authMiddleware, approveIntegrationTests);
router.get("/:snapshotId/test-suites", authMiddleware, getCoverageTestSuites);

export default router;
