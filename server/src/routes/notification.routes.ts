import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

router.use(authMiddleware);

// GET /api/notifications - Get user's notifications with pagination
router.get('/', notificationController.getNotifications);

// GET /api/notifications/unread-count - Get unread notification count
router.get('/unread-count', notificationController.getUnreadCount);

// PATCH /api/notifications/read-all - Mark all notifications as read
router.patch('/read-all', notificationController.markAllAsRead);

// PATCH /api/notifications/:id/read - Mark a specific notification as read
router.patch('/:id/read', notificationController.markNotificationAsRead);

export default router;