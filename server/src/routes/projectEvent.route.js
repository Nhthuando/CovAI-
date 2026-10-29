import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { getProjectEvents } from '../controllers/projectEvent.controller.js';

const router = Router();
router.get('/:id/events',authMiddleware,getProjectEvents);
export default router;
