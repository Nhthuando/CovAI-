import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

/**
 * Custom hook for Socket.IO connection management
 * @param {string} userId - User ID to subscribe to notifications
 * @param {Function} onNotification - Callback when notification received
 * @returns {Object} Socket instance and connection status
 */
export const useSocket = (userId, onNotification) => {
    const socketRef = useRef(null);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState(null);
    const onNotificationRef = useRef(onNotification);

    // luôn cập nhật ref, không gây re-run effect
    useEffect(() => {
        onNotificationRef.current = onNotification;
    }, [onNotification]);

    useEffect(() => {
        if (!userId) return;

        const socket = io(SOCKET_URL, { /* ... giữ nguyên config */ });
        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('[Socket.IO] Connected to server, subscribing user:', userId);
            setIsConnected(true);
            setError(null);
            socket.emit('subscribe_notifications', userId);
            console.log('[Socket.IO] Emitted subscribe_notifications for user:', userId);
        });

        socket.on('disconnect', () => setIsConnected(false));
        socket.on('connect_error', (err) => {
            setError(err.message);
            setIsConnected(false);
        });

        socket.on('notification', (notification) => {
            console.log('[Socket.IO] Received notification:', notification);
            console.log('[Socket.IO] onNotificationRef.current:', onNotificationRef.current);
            onNotificationRef.current?.(notification);
        });

        return () => socket.disconnect();
    }, [userId]); // ✅ chỉ phụ thuộc userId, không phụ thuộc callback nữa

    return { socket: socketRef.current, isConnected, error };
};