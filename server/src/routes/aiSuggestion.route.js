import { enforceProjectEndpointPolicy } from '../middlewares/projectEndpointPolicy.js';
import express from 'express';
import * as aiSuggestionController from '../controllers/aiSuggestion.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

const router = express.Router();
router.use(authMiddleware, enforceProjectEndpointPolicy('ai-suggestions'));

router.get('/', authMiddleware, aiSuggestionController.getAiSuggestions);
router.post('/refresh/:projectId', authMiddleware, aiSuggestionController.refreshAiSuggestions);

export default router;
