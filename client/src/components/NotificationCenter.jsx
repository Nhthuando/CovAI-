import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Bell } from 'lucide-react';
import { notificationService } from '../services/notification.service';
import { useSocket } from '../hooks/useSocket';

/**
 * Notification Center component with dropdown, infinite scroll, and real-time updates
 */
export const
    NotificationCenter = ({ userId, theme = "dark", size = 14 }) => {
        const [notifications, setNotifications] = useState([]);
        const [unreadCount, setUnreadCount] = useState(0);
        const [loading, setLoading] = useState(false);
        const [page, setPage] = useState(1);
        const [hasMore, setHasMore] = useState(true);
        const [error, setError] = useState(null);
        const [dropdownOpen, setDropdownOpen] = useState(false);
        const dropdownRef = useRef(null);
        const LIMIT = 20;


        // Handle new notification from Socket.IO
        const handleNewNotification = useCallback((notification) => {
            console.log('[NotificationCenter] Received new notification:', notification);
            console.log('[NotificationCenter] Current unreadCount before update:', unreadCount); // Log current unreadCount
            setNotifications(prev => [notification, ...prev]);
            setUnreadCount(prev => prev + 1);
            console.log('[NotificationCenter] New unreadCount after update:', unreadCount + 1); // Log new unreadCount
            const toastEvent = new CustomEvent('showToast', {
                detail: {
                    title: notification.title,
                    message: notification.message,
                    type: notification.type === 'SYSTEM' ? 'info' :
                        notification.type === 'AI_READY' ? 'success' :
                            notification.type === 'JOB_FINISHED' ? 'success' : 'info'
                }
            });
            window.dispatchEvent(toastEvent);
        }, [setNotifications, setUnreadCount]); // Added dependencies for useCallback

        // Use Socket.IO hook
        useSocket(userId, handleNewNotification);

        // Fetch notifications
        const isFetchingRef = useRef(false);

        const fetchNotifications = async (pageNum = 1, reset = false) => {
            if (isFetchingRef.current) return;
            isFetchingRef.current = true;
            setLoading(true);
            setError(null);

            try {
                const result = await notificationService.getNotifications(pageNum, LIMIT);
                if (reset) {
                    setNotifications(result.data);
                } else {
                    setNotifications(prev => [...prev, ...result.data]);
                }
                setUnreadCount(result.meta.unreadCount);
                setHasMore(pageNum < result.meta.pagination.totalPages);
            } catch (err) {
                setError(err.response?.data?.message || 'Failed to load notifications');
            } finally {
                setLoading(false);
                isFetchingRef.current = false;
            }
        };

        // Fetch unread count (polling fallback)
        const fetchUnreadCount = async () => {
            try {
                console.log('Fetching unread count...');
                const count = await notificationService.getUnreadCount();
                console.log('Unread count received:', count);
                setUnreadCount(count);
            } catch (err) {
                console.error('Error fetching unread count:', err);
            }
        };

        // Mark notification as read
        const handleMarkAsRead = async (notificationId) => {
            try {
                console.log('Marking notification as read:', notificationId);
                await notificationService.markAsRead(notificationId);

                setNotifications(prev =>
                    prev.map(notif =>
                        notif.id === notificationId ? { ...notif, readAt: new Date().toISOString() } : notif
                    )
                );

                setUnreadCount(prev => Math.max(0, prev - 1));
                console.log('Notification marked as read successfully');
            } catch (err) {
                console.error('Error marking notification as read:', err);
                setError('Failed to mark notification as read');
            }
        };

        // Mark all as read
        const handleMarkAllAsRead = useCallback(async () => {
            try {
                console.log('Marking all notifications as read');
                await notificationService.markAllAsRead();

                setNotifications(prev =>
                    prev.map(notif => ({ ...notif, readAt: new Date().toISOString() }))
                );

                setUnreadCount(0);
                console.log('All notifications marked as read');
            } catch (err) {
                console.error('Error marking all notifications as read:', err);
                setError('Failed to mark all notifications as read');
            }
        }, []);

        // Load more notifications
        const handleLoadMore = () => {
            if (!loading && hasMore) {
                const nextPage = page + 1;
                setPage(nextPage);
                fetchNotifications(nextPage, false);
            }
        };

        // Initialize and handle clicks outside dropdown
        useEffect(() => {
            console.log('NotificationCenter useEffect triggered, userId:', userId);
            if (userId) {
                console.log('Fetching notifications for user:', userId);
                fetchNotifications(1, true);

                // Polling fallback every 20 seconds
                const pollInterval = setInterval(fetchUnreadCount, 20000);
                return () => clearInterval(pollInterval);
            } else {
                console.log('No userId, skipping notification fetch');
            }
        }, [userId]);

        // Mark all notifications as read when dropdown opens
        useEffect(() => {
            if (dropdownOpen && unreadCount > 0) {
                handleMarkAllAsRead();
            }
        }, [dropdownOpen]);

        useEffect(() => {
            const handleClickOutside = (event) => {
                if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                    setDropdownOpen(false);
                }
            };

            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }, []);

        if (!userId) {
            console.log('NotificationCenter: userId is falsy, returning null');
            return null;
        }

        const isDark = theme === "dark";
        const dropdownBg = isDark ? "#161b22" : "white";
        const dropdownBorder = isDark ? "#30363d" : "#e5e7eb";
        const textPrimary = isDark ? "#e6edf3" : "#111827";
        const textSecondary = isDark ? "#8b949e" : "#6b7280";
        const rowBorder = isDark ? "#21262d" : "#f3f4f6";
        const unreadBg = isDark ? "rgba(124,58,237,0.08)" : "#f0f9ff";

        if (!userId) return null;

        return (
            <div style={{ position: 'relative' }} ref={dropdownRef}>
                <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    style={{
                        color: "#484f58",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px 6px",
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        position: "relative"
                    }}
                >
                    <Bell size={size} />
                    {unreadCount > 0 && (
                        <span
                            style={{
                                position: 'absolute',
                                top: '0px',
                                right: '0px',
                                background: '#ef4444',
                                color: 'white',
                                borderRadius: '50%',
                                width: '14px',
                                height: '14px',
                                fontSize: '9px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold'
                            }}
                        >
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </motion.button>

                {dropdownOpen && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: 8,
                            background: dropdownBg,
                            border: `1px solid ${dropdownBorder}`,
                            borderRadius: '8px',
                            boxShadow: isDark
                                ? '0 8px 24px rgba(0,0,0,0.5)'
                                : '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                            width: '380px',
                            maxHeight: '480px',
                            overflow: 'auto',
                            zIndex: 1000
                        }}
                    >
                        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${dropdownBorder}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 700, fontSize: '14px', color: textPrimary }}>Notifications</span>
                                <button
                                    onClick={handleMarkAllAsRead}
                                    style={{
                                        background: isDark ? 'rgba(124,58,237,0.15)' : '#3b82f6',
                                        color: isDark ? '#c4b5fd' : 'white',
                                        border: isDark ? '1px solid rgba(124,58,237,0.3)' : 'none',
                                        padding: '4px 8px',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        cursor: 'pointer',
                                        opacity: unreadCount > 0 ? 1 : 0.5,
                                        pointerEvents: unreadCount > 0 ? 'auto' : 'none'
                                    }}
                                >
                                    Mark all as read
                                </button>
                            </div>
                        </div>

                        <div style={{ maxHeight: '360px', overflow: 'auto' }}>
                            {error ? (
                                <div style={{ padding: '16px', color: '#ef4444', textAlign: 'center', fontSize: 13 }}>
                                    {error}
                                </div>
                            ) : notifications.length === 0 ? (
                                <div style={{ padding: '32px', textAlign: 'center', color: textSecondary, fontSize: 13 }}>
                                    No notifications
                                </div>
                            ) : (
                                <div>
                                    {notifications.map(notification => (
                                        <div
                                            key={notification.id}
                                            onClick={() => handleMarkAsRead(notification.id)}
                                            style={{
                                                padding: '12px 16px',
                                                borderBottom: `1px solid ${rowBorder}`,
                                                cursor: 'pointer',
                                                backgroundColor: !notification.readAt ? unreadBg : 'transparent',
                                                transition: 'background-color 0.2s'
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span style={{ fontWeight: 600, fontSize: '13px', color: textPrimary }}>
                                                    {notification.title}
                                                </span>
                                                <span style={{ fontSize: '11px', color: textSecondary }}>
                                                    {new Date(notification.createdAt).toLocaleTimeString([], {
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </span>
                                            </div>
                                            <p style={{ margin: '4px 0 0', fontSize: '12px', color: textSecondary }}>
                                                {notification.message}
                                            </p>
                                            {notification.project?.name && (
                                                <div style={{ marginTop: '4px', fontSize: '10px', color: isDark ? '#6e7681' : '#9ca3af' }}>
                                                    Project: {notification.project.name}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {loading && (
                                <div style={{ padding: '16px', textAlign: 'center', color: textSecondary, fontSize: 12 }}>
                                    Loading...
                                </div>
                            )}
                            {!loading && hasMore && notifications.length > 0 && (
                                <button
                                    onClick={handleLoadMore}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        background: 'none',
                                        border: 'none',
                                        borderTop: `1px solid ${dropdownBorder}`,
                                        color: isDark ? '#a78bfa' : '#3b82f6',
                                        cursor: 'pointer',
                                        fontSize: 12
                                    }}
                                >
                                    Load more
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    };