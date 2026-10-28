import { enforceProjectEndpointPolicy } from '../middlewares/projectEndpointPolicy.js';
import express from "express";
import { listAiTests, generateCypressTests } from "../controllers/aiTest.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();
router.use(authMiddleware, enforceProjectEndpointPolicy('ai-tests'));

// GET /ai-tests?projectId=xxx — list AI-generated tests for a project
router.get("/", authMiddleware, listAiTests);

// POST /ai-tests/generate-cypress — queue Cypress E2E test generation
// Body: { projectId: string, snapshotId?: string }
// Returns: { success, jobId, snapshotId } with 202 Accepted
router.post("/generate-cypress", authMiddleware, generateCypressTests);

export default router;