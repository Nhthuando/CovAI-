import express from 'express';
import * as aiSuggestionController from '../controllers/aiSuggestion.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.get('/', authMiddleware, aiSuggestionController.getAiSuggestions);

export default router;