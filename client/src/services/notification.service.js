import axios from 'axios';
import {
    API_BASE,
    getAccessToken,
    installAxiosAuthRefresh,
} from '../lib/authSession.js';

const API_URL = API_BASE;

const notificationApi = axios.create({
    baseURL: `${API_URL}/notifications`,
    withCredentials: true,
});

// Handle token attachment + expiration: renew the session and retry before logging out.
installAxiosAuthRefresh(notificationApi);

export const notificationService = {
    /**
     * Get notifications with pagination
     * @param {number} page - Page number (default: 1)
     * @param {number} limit - Items per page (default: 20)
     * @param {boolean} unreadOnly - Filter unread only (default: false)
     * @returns {Promise<Object>} Notifications data with meta info
     */
    getNotifications: async (page = 1, limit = 20, unreadOnly = false) => {
        try {
            const token = getAccessToken();
            if (!token) {
                return {
                    success: true,
                    data: [],
                    meta: {
                        unreadCount: 0,
                        pagination: { page, limit, total: 0, totalPages: 0 },
                    },
                };
            }

            const response = await notificationApi.get('/', {
                params: { page, limit, unreadOnly },
            });
            return response.data;
        } catch (error) {
            if (error?.response?.status === 401 || error?.code === 'ERR_NETWORK' || !navigator.onLine) {
                return {
                    success: true,
                    data: [],
                    meta: {
                        unreadCount: 0,
                        pagination: { page, limit, total: 0, totalPages: 0 },
                    },
                };
            }
            console.error('[notificationService] Error fetching notifications:', error);
            throw error;
        }
    },

    /**
     * Get unread notification count
     * @returns {Promise<number>} Unread count
     */
    getUnreadCount: async () => {
        try {
            const token = getAccessToken();
            if (!token) {
                return 0;
            }

            const response = await notificationApi.get('/unread-count');
            return response.data.count ?? 0;
        } catch {
            return 0;
        }
    },

    /**
     * Mark a single notification as read
     * @param {string} id - Notification ID
     * @returns {Promise<Object>} Updated notification
     */
    markAsRead: async (id) => {
        try {
            const response = await notificationApi.patch(`/${id}/read`);
            return response.data.data;
        } catch (error) {
            console.error('Error marking notification as read:', error);
            throw error;
        }
    },

    /**
     * Mark all notifications as read
     * @returns {Promise<Object>} Result with updated count
     */
    markAllAsRead: async () => {
        try {
            const response = await notificationApi.patch('/read-all');
            return response.data;
        } catch (error) {
            console.error('Error marking all notifications as read:', error);
            throw error;
        }
    },

    /**
     * Create a notification (admin only)
     * @param {Object} data - Notification data
     * @returns {Promise<Object>} Created notification
     */
    createNotification: async (data) => {
        try {
            const response = await notificationApi.post('/', data);
            return response.data.data;
        } catch (error) {
            console.error('Error creating notification:', error);
            throw error;
        }
    },
};
