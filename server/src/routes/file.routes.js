import express from 'express';
import { getFiles } from '../controllers/file.controller.js';

const router = express.Router();

// Endpoint: GET /api/files?rootDir=...
router.get('/files', getFiles);

export default router;
