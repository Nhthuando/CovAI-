import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Bell } from "lucide-react";
import { notificationService } from "../services/notification.service";
import { useSocket } from "../hooks/useSocket";

/**
 * Notification Center component with dropdown, infinite scroll, and real-time updates
 */
export const NotificationCenter = ({ userId, theme = "dark", size = 14 }) => {
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
  const handleNewNotification = useCallback(
    (notification) => {
      setNotifications((prev) => [notification, ...prev]);
      setUnreadCount((prev) => prev + 1);
      const toastEvent = new CustomEvent("showToast", {
        detail: {
          title: notification.title,
          message: notification.message,
          type:
            notification.type === "SYSTEM"
              ? "info"
              : notification.type === "AI_READY"
                ? "success"
                : notification.type === "JOB_FINISHED"
                  ? "success"
                  : "info",
          duration: 4500,
        },
      });
      window.dispatchEvent(toastEvent);
    },
    [setNotifications, setUnreadCount],
  );

  // Use Socket.IO hook
  useSocket(userId, handleNewNotification);

  // Fetch notifications
  const isFetchingRef = useRef(false);

  const fetchNotifications = async (pageNum = 1, reset = false) => {
    if (!userId || !localStorage.getItem("token")) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const result = await notificationService.getNotifications(pageNum, LIMIT);
      if (reset) {
        setNotifications(result.data || []);
      } else {
        setNotifications((prev) => [...prev, ...(result.data || [])]);
      }
      setUnreadCount(result.meta?.unreadCount ?? 0);
      setHasMore(pageNum < (result.meta?.pagination?.totalPages ?? 0));
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load notifications");
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  // Fetch unread count (polling fallback)
  const fetchUnreadCount = async () => {
    if (!userId || !localStorage.getItem("token")) {
      setUnreadCount(0);
      return;
    }

    try {
      const count = await notificationService.getUnreadCount();
      setUnreadCount(count ?? 0);
    } catch {
      setUnreadCount(0);
    }
  };

  // Mark notification as read
  const handleMarkAsRead = async (notificationId) => {
    try {
      await notificationService.markAsRead(notificationId);

      setNotifications((prev) =>
        prev.map((notif) =>
          notif.id === notificationId
            ? { ...notif, readAt: new Date().toISOString() }
            : notif,
        ),
      );

      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Error marking notification as read:", err);
      setError("Failed to mark notification as read");
    }
  };

  // Mark all as read
  const handleMarkAllAsRead = useCallback(async () => {
    try {
      await notificationService.markAllAsRead();

      setNotifications((prev) =>
        prev.map((notif) => ({ ...notif, readAt: new Date().toISOString() })),
      );

      setUnreadCount(0);
    } catch (err) {
      console.error("Error marking all notifications as read:", err);
      setError("Failed to mark all notifications as read");
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
    if (userId) {
      fetchNotifications(1, true);

      // Polling fallback every 20 seconds
      const pollInterval = setInterval(fetchUnreadCount, 20000);
      return () => clearInterval(pollInterval);
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

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!userId) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="relative p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer flex items-center justify-center border-0 bg-transparent"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={size} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-[var(--color-danger)] text-white rounded-full min-w-[15px] h-[15px] px-0.5 text-[9px] font-bold flex items-center justify-center pointer-events-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </motion.button>

      {dropdownOpen && (
        <div className="absolute top-full right-0 mt-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] w-[360px] sm:w-[380px] max-h-[480px] flex flex-col overflow-hidden z-[1000] text-[var(--color-text)]">
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between shrink-0 bg-[var(--color-surface)]">
            <span className="font-semibold text-xs text-[var(--color-text)] tracking-tight">
              Notifications
            </span>
            <button
              type="button"
              onClick={handleMarkAllAsRead}
              disabled={unreadCount === 0}
              className="text-[11px] font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer bg-transparent border-0 p-0"
            >
              Mark all as read
            </button>
          </div>

          <div className="max-h-[360px] overflow-y-auto divide-y divide-[var(--color-border)]">
            {error ? (
              <div className="p-4 text-center text-xs text-[var(--color-danger)]">
                {error}
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--color-text-secondary)]">
                No notifications
              </div>
            ) : (
              <div>
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => handleMarkAsRead(notification.id)}
                    className={`p-3.5 cursor-pointer transition-colors ${
                      !notification.readAt
                        ? "bg-[var(--color-primary-light)]/40 hover:bg-[var(--color-primary-light)]/70"
                        : "bg-transparent hover:bg-[var(--color-surface-secondary)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs text-[var(--color-text)] truncate">
                        {notification.title}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)] font-mono shrink-0">
                        {new Date(notification.createdAt).toLocaleTimeString(
                          [],
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)] leading-relaxed">
                      {notification.message}
                    </p>
                    {notification.project?.name && (
                      <div className="mt-1.5 text-[10px] text-[var(--color-text-muted)] font-mono">
                        Project: {notification.project.name}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {loading && (
              <div className="p-4 text-center text-xs text-[var(--color-text-secondary)]">
                Loading...
              </div>
            )}
            {!loading && hasMore && notifications.length > 0 && (
              <button
                type="button"
                onClick={handleLoadMore}
                className="w-full py-2.5 text-center text-xs font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-hover)] border-t border-[var(--color-border)] transition-colors cursor-pointer bg-transparent"
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
