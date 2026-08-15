import express from 'express';
import { getFiles } from '../controllers/file.controller.js';
import { storeAiTestResult } from '../controllers/aiTest.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Endpoint: GET /api/files?projectId=...&snapshotId=...
router.get('/', authMiddleware, getFiles);
// Preserve the former nested URL only with the same safe contract.
router.get('/files', authMiddleware, getFiles);

// Endpoint: POST /api/files/ai-test-results
router.post('/ai-test-results', authMiddleware, storeAiTestResult);

export default router;
