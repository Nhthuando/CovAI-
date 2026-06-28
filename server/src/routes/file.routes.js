import express from 'express';
import { getFiles } from '../controllers/file.controller.js';
import { storeAiTestResult } from '../controllers/aiTest.controller.js';

const router = express.Router();

// Endpoint: GET /api/files?rootDir=...
router.get('/files', getFiles);

// Endpoint: POST /api/files/ai-test-results
router.post('/ai-test-results', storeAiTestResult);

export default router;
