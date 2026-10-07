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
    applySuggestion,
    getCoverageTestSuites,
    getIntegrationHistory,
    getSystemTestSummary,
    getSystemTestEvidence,
    saveAiSystemTest,
} from "../controllers/coverage.controller.js";

const router = express.Router();

// GET /api/coverage/:snapshotId/summary — fetch coverage summary result
router.get("/:snapshotId/summary", authMiddleware, getCoverageSummary);
router.get("/:snapshotId/system/summary", authMiddleware, getSystemTestSummary);
router.get("/:snapshotId/system/scenarios/:scenarioId/evidence", authMiddleware, getSystemTestEvidence);
router.post("/:snapshotId/system/save-ai-test", authMiddleware, saveAiSystemTest);
router.get("/:snapshotId/frameworks", authMiddleware, getCoverageFrameworks);

// GET /api/coverage/:snapshotId/files — fetch CoverageFile list
// Query: ?sortBy=filePath|linesPct|branchesPct|funcsPct|stmtsPct&order=asc|desc&page=1&limit=50
router.get("/:snapshotId/files", authMiddleware, getCoverageFiles);

// GET /api/coverage/:snapshotId/file-coverage — fetch line-by-line coverage & assertion failures
router.get("/:snapshotId/file-coverage", authMiddleware, getFileCoverage);

// POST /api/coverage/:snapshotId/suggest-testcase — suggest AI unit testcases for source file
router.post("/:snapshotId/suggest-testcase", authMiddleware, suggestUnitTestcase);

// POST /api/coverage/:snapshotId/apply-suggestion — write testcase to disk, rerun test, collect new coverage
router.post("/:snapshotId/apply-suggestion", authMiddleware, applySuggestion);

// POST /api/coverage/:snapshotId/run — trigger pipeline INSTALL_DEPS → RUN_TESTS
router.post("/:snapshotId/run", authMiddleware, runCoverage);

router.post("/:snapshotId/supertest/run", authMiddleware, runSupertestCoverage);
router.post("/:snapshotId/:coverageType/run", authMiddleware, runCoverageByType);

// GET /api/coverage/:snapshotId/functions — fetch CoverageFunction list
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
