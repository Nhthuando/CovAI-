import express from 'express';
import { createSuggestion } from '../controllers/aiSuggestion.controller.js';
const router = express.Router();
router.post('/', createSuggestion);
export default router;
