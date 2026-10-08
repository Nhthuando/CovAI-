/* eslint-disable react-hooks/refs */
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

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

  // Always update ref without causing effect re-runs
  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    if (!userId) return;

    let token = localStorage.getItem("token");
    try {
      token ||= JSON.parse(localStorage.getItem("user") || "null")?.token;
    } catch { /* An expired session reconnects after login. */ }
    const socket = io(SOCKET_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setError(null);
      socket.emit("subscribe_notifications", userId);
    });

    socket.on("disconnect", () => setIsConnected(false));
    socket.on("connect_error", (err) => {
      setError(err.message);
      setIsConnected(false);
    });

    socket.on("notification", (notification) => {
      // console.log('[Socket.IO] Received notification:', notification);
      // console.log('[Socket.IO] onNotificationRef.current:', onNotificationRef.current);
      onNotificationRef.current?.(notification);
    });

    return () => socket.disconnect();
  }, [userId]); // Only depends on userId, no longer depends on callback

  return { socket: socketRef.current, isConnected, error };
};
