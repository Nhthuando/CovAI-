import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { inspect, accept, decline } from '../controllers/projectMember.controller.js';
const router = Router();
router.use(authMiddleware);
router.post('/inspect', inspect);
router.post('/accept', accept);
router.post('/decline', decline);
export default router;
