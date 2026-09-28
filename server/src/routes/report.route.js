import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { getIntegrationReport } from '../controllers/report.controller.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/project/:projectId/integration', getIntegrationReport);

export default router;
