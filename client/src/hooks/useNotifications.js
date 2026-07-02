import { useState, useCallback } from 'react';
import { notificationService } from '../services/notification.service';

/**
 * Custom hook for managing notification state and operations
 * @param {string} userId - User ID
 * @returns {Object} Notification state and handlers
 */
export const useNotifications = (userId) => {
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
    });

    // Fetch notifications
    const fetchNotifications = useCallback(
        async (page = 1, limit = 20, unreadOnly = false) => {
            if (!userId) return;

            setLoading(true);
            setError(null);

            try {
                const result = await notificationService.getNotifications(page, limit, unreadOnly);

                setNotifications(result.data);
                setUnreadCount(result.meta.unreadCount);
                setPagination(result.meta.pagination);

                return result;
            } catch (err) {
                const errorMsg = err.response?.data?.message || 'Failed to load notifications';
                setError(errorMsg);
                throw err;
            } finally {
                setLoading(false);
            }
        },
        [userId]
    );

    // Add new notification to list (for real-time updates)
    const addNotification = useCallback((notification) => {
        setNotifications(prev => {
            // Avoid duplicates
            if (prev.some(n => n.id === notification.id)) {
                return prev;
            }
            return [notification, ...prev];
        });
        setUnreadCount(prev => prev + 1);
    }, []);

    // Mark single notification as read
    const markAsRead = useCallback(async (notificationId) => {
        try {
            await notificationService.markAsRead(notificationId);

            setNotifications(prev =>
                prev.map(notif =>
                    notif.id === notificationId
                        ? { ...notif, readAt: new Date().toISOString() }
                        : notif
                )
            );

            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (err) {
            console.error('Error marking notification as read:', err);
            throw err;
        }
    }, []);

    // Mark all notifications as read
    const markAllAsRead = useCallback(async () => {
        try {
            await notificationService.markAllAsRead();

            setNotifications(prev =>
                prev.map(notif => ({
                    ...notif,
                    readAt: new Date().toISOString(),
                }))
            );

            setUnreadCount(0);
        } catch (err) {
            console.error('Error marking all notifications as read:', err);
            throw err;
        }
    }, []);

    // Get unread count
    const getUnreadCount = useCallback(async () => {
        try {
            const count = await notificationService.getUnreadCount();
            setUnreadCount(count);
            return count;
        } catch (err) {
            console.error('Error fetching unread count:', err);
            throw err;
        }
    }, []);

    return {
        notifications,
        unreadCount,
        loading,
        error,
        pagination,
        fetchNotifications,
        addNotification,
        markAsRead,
        markAllAsRead,
        getUnreadCount,
        setNotifications,
    };
};