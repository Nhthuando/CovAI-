import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// POST /api/admin/notifications - Create a new notification (Admin only)
router.post('/', authMiddleware, notificationController.createNotification);

export default router;