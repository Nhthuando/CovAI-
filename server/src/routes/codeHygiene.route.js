import { enforceProjectEndpointPolicy } from '../middlewares/projectEndpointPolicy.js';
import express from 'express';
import * as controller from '../controllers/codeHygiene.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

const router = express.Router();
router.use(authMiddleware, enforceProjectEndpointPolicy('code-hygiene'));

router.post('/snapshot/:snapshotId/run', authMiddleware, controller.runAnalysis);
router.get('/snapshot/:snapshotId', authMiddleware, controller.getReport);
router.get('/project/:projectId', authMiddleware, controller.getProjectStats);

export default router;
