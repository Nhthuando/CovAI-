import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { getIntegrationReport, getIntegrationGuidanceController } from '../controllers/report.controller.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/project/:projectId/integration', getIntegrationReport);
router.get('/project/:projectId/integration/guidance', getIntegrationGuidanceController);

export default router;
