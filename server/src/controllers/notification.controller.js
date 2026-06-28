import * as notificationService from '../services/notification.service.js';

export const listNotifications = async (req, res) => {
    try {
        const { page, limit, unreadOnly } = req.query;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const result = await notificationService.getNotifications({
            userId,
            page,
            limit,
            unreadOnly
        });

        res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        const statusCode = error.status || 500;
        res.status(statusCode).json({ success: false, message: error.message || 'Failed to fetch notifications' });
    }
};

export const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const notification = await notificationService.markAsRead({
            notificationId: id,
            userId
        });

        res.status(200).json({ success: true, data: notification });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        const statusCode = error.status || 500;
        res.status(statusCode).json({ success: false, message: error.message || 'Failed to mark notification as read' });
    }
};

export const markAllAsRead = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const result = await notificationService.markAllAsRead({ userId });

        res.status(200).json({ success: true, message: `Successfully marked ${result.updatedCount} notifications as read` });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        const statusCode = error.status || 500;
        res.status(statusCode).json({ success: false, message: error.message || 'Failed to mark all notifications as read' });
    }
};
