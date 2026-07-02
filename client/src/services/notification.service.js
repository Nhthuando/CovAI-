import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const notificationApi = axios.create({
    baseURL: `${API_URL}/notifications`,
    withCredentials: true,
});

// Add auth token to requests
notificationApi.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Handle token expiration
notificationApi.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

export const notificationService = {
    /**
     * Get notifications with pagination
     * @param {number} page - Page number (default: 1)
     * @param {number} limit - Items per page (default: 20)
     * @param {boolean} unreadOnly - Filter unread only (default: false)
     * @returns {Promise<Object>} Notifications data with meta info
     */
    getNotifications: async (page = 1, limit = 20, unreadOnly = false) => {
        console.log('[notificationService] getNotifications called:', { page, limit, unreadOnly });
        try {
            const response = await notificationApi.get('/', {
                params: { page, limit, unreadOnly },
            });
            console.log('[notificationService] API response:', response.data);
            return response.data;
        } catch (error) {
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
            const response = await notificationApi.get('/unread-count');
            return response.data.count;
        } catch (error) {
            console.error('Error fetching unread count:', error);
            throw error;
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