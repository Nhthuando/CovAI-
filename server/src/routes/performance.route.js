import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { getSnapshotPerformanceReport } from '../controllers/performance.controller.js';

const router = express.Router();

router.get('/snapshot/:snapshotId', authMiddleware, getSnapshotPerformanceReport);

export default router;
