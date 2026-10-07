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
    getCoverageTestSuites,
    getIntegrationHistory,
    getSystemTestSummary,
    getSystemTestScenarios,
    getSystemTestEvidence,
    runSystemTestCoverage,
    saveAiSystemTest,
    generateColdStartSystemTestsController,
    getSystemTestFileContent,
    updateSystemTestFileContent,
    runSingleSystemTest,
    optimizeSystemTestController,
} from "../controllers/coverage.controller.js";

const router = express.Router();

// GET /api/coverage/:snapshotId/summary — lấy kết quả coverage summary
router.get("/:snapshotId/summary", authMiddleware, getCoverageSummary);
router.get("/:snapshotId/system/summary", authMiddleware, getSystemTestSummary);
router.get("/:snapshotId/system/scenarios", authMiddleware, getSystemTestScenarios);
router.get("/:snapshotId/system/scenarios/:scenarioId/evidence", authMiddleware, getSystemTestEvidence);
router.post("/:snapshotId/system/run", authMiddleware, runSystemTestCoverage);
router.post("/:snapshotId/system/save-ai-test", authMiddleware, saveAiSystemTest);
router.post("/:snapshotId/system/generate-tests", authMiddleware, generateColdStartSystemTestsController);
router.get("/:snapshotId/frameworks", authMiddleware, getCoverageFrameworks);

// Phase 5: Test Editor & AI Coverage Booster
router.get("/:snapshotId/system/tests/content", authMiddleware, getSystemTestFileContent);
router.put("/:snapshotId/system/tests/content", authMiddleware, updateSystemTestFileContent);
router.post("/:snapshotId/system/tests/run-single", authMiddleware, runSingleSystemTest);
router.post("/:snapshotId/system/optimize-test", authMiddleware, optimizeSystemTestController);

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

// Integration Workspace (Phase 2)
router.get("/:snapshotId/integration/history", authMiddleware, getIntegrationHistory);

// Integration Workspace (Phase 3)
import {
    updateScenario,
    addScenario,
    deleteScenario,
    toggleScenario,
    regenerateScenario,
    getScenario
} from "../controllers/coverage.controller.js";

router.get("/:snapshotId/integration/ai-test/:aiTestId/scenario/:scenarioId", authMiddleware, getScenario);
router.put("/:snapshotId/integration/ai-test/:aiTestId/scenario/:scenarioId", authMiddleware, updateScenario);
router.post("/:snapshotId/integration/ai-test/:aiTestId/scenario", authMiddleware, addScenario);
router.delete("/:snapshotId/integration/ai-test/:aiTestId/scenario/:scenarioId", authMiddleware, deleteScenario);
router.patch("/:snapshotId/integration/ai-test/:aiTestId/scenario/:scenarioId/toggle", authMiddleware, toggleScenario);
router.post("/:snapshotId/integration/ai-test/:aiTestId/scenario/:scenarioId/regenerate", authMiddleware, regenerateScenario);

export default router;
