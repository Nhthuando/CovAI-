import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  BellOff,
  Check,
  AlertCircle,
  Sparkles,
  Terminal,
  RefreshCw,
} from "lucide-react";
import { notificationService } from "../services/notification.service";
import { useSocket } from "../hooks/useSocket";
import { getAccessToken } from "../lib/authSession";

function getNotificationMeta(notification) {
  const title = String(notification?.title || "");
  const message = String(notification?.message || "");
  const type = String(notification?.type || "");
  const combined = `${title} ${message}`.toUpperCase();

  if (combined.includes("FAIL") || combined.includes("ERROR")) {
    return {
      toastType: "error",
      Icon: AlertCircle,
      iconClass: "text-rose-400/80",
    };
  }
  if (
    type === "AI_READY" ||
    combined.includes("AI RESULT") ||
    combined.includes("SUGGESTION")
  ) {
    return {
      toastType: "success",
      Icon: Sparkles,
      iconClass: "text-[var(--color-text-muted)]",
    };
  }
  if (
    type === "JOB_FINISHED" ||
    combined.includes("SUCCESS") ||
    combined.includes("PASSED")
  ) {
    return {
      toastType: "success",
      Icon: Check,
      iconClass: "text-[var(--color-text-secondary)]",
    };
  }
  return {
    toastType: "info",
    Icon: Terminal,
    iconClass: "text-[var(--color-text-muted)]",
  };
}

function formatNotificationTime(isoDate) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Notification Center component with filter tabs, semantic status badges, and real-time updates
 */
export const NotificationCenter = ({
  userId,
  size = 14,
  variant = "bordered",
}) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all"); // 'all' | 'unread'
  const dropdownRef = useRef(null);
  const LIMIT = 20;

  // Handle new notification from Socket.IO
  const handleNewNotification = useCallback((notification) => {
    setNotifications((prev) => [notification, ...prev]);
    setUnreadCount((prev) => prev + 1);
    const meta = getNotificationMeta(notification);
    const toastEvent = new CustomEvent("showToast", {
      detail: {
        title: notification.title,
        message: notification.message,
        type: meta.toastType,
        duration: 4500,
      },
    });
    window.dispatchEvent(toastEvent);
  }, []);

  // Use Socket.IO hook
  useSocket(userId, handleNewNotification);

  // Fetch notifications
  const isFetchingRef = useRef(false);

  const fetchNotifications = useCallback(
    async (pageNum = 1, reset = false) => {
      if (!userId || !getAccessToken()) {
        setNotifications([]);
        setUnreadCount(0);
        return;
      }

      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      setLoading(true);
      setError(null);

      try {
        const result = await notificationService.getNotifications(
          pageNum,
          LIMIT,
        );
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
    },
    [userId],
  );

  // Fetch unread count (polling fallback)
  const fetchUnreadCount = useCallback(async () => {
    if (!userId || !getAccessToken()) {
      setUnreadCount(0);
      return;
    }

    try {
      const count = await notificationService.getUnreadCount();
      setUnreadCount(count ?? 0);
    } catch {
      setUnreadCount(0);
    }
  }, [userId]);

  // Mark notification as read
  const handleMarkAsRead = async (notification) => {
    if (!notification || notification.readAt) return;
    try {
      await notificationService.markAsRead(notification.id);

      setNotifications((prev) =>
        prev.map((notif) =>
          notif.id === notification.id
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
    if (unreadCount === 0) return;
    try {
      await notificationService.markAllAsRead();

      setNotifications((prev) =>
        prev.map((notif) =>
          notif.readAt ? notif : { ...notif, readAt: new Date().toISOString() },
        ),
      );

      setUnreadCount(0);
    } catch (err) {
      console.error("Error marking all notifications as read:", err);
      setError("Failed to mark all notifications as read");
    }
  }, [unreadCount]);

  // Load more notifications
  const handleLoadMore = () => {
    if (!loading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchNotifications(nextPage, false);
    }
  };

  // Initialize and handle polling
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void fetchNotifications(1, true);
    });
    const pollInterval = setInterval(fetchUnreadCount, 20000);
    return () => {
      cancelled = true;
      clearInterval(pollInterval);
    };
  }, [userId, fetchNotifications, fetchUnreadCount]);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setDropdownOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const visibleNotifications = useMemo(() => {
    if (activeFilter === "unread") {
      return notifications.filter((n) => !n.readAt);
    }
    return notifications;
  }, [notifications, activeFilter]);

  if (!userId) {
    return null;
  }

  const triggerClass =
    variant === "compact"
      ? `relative p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer flex items-center justify-center border ${
          dropdownOpen
            ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border-strong)]"
            : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
        }`
      : `relative w-8 h-8 rounded-[var(--radius-sm)] transition-colors duration-150 cursor-pointer flex items-center justify-center border ${
          dropdownOpen
            ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border-strong)]"
            : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
        }`;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setDropdownOpen((o) => !o)}
        className={`${triggerClass} active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]`}
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={dropdownOpen}
      >
        <Bell size={size} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-[var(--color-text)] text-[var(--color-bg)] rounded-full min-w-[15px] h-[15px] px-1 text-[9px] font-mono font-semibold tabular-nums flex items-center justify-center pointer-events-none ring-2 ring-[var(--color-bg)]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {dropdownOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute top-full right-0 mt-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl w-[356px] sm:w-[388px] max-h-[480px] flex flex-col overflow-hidden z-[1000] text-[var(--color-text)]"
          >
            {/* Header */}
            <div className="px-4 pt-3 pb-0 border-b border-[var(--color-border)] flex flex-col gap-2.5 shrink-0 bg-[var(--color-surface)]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[13px] text-[var(--color-text)] tracking-tight">
                  Notifications
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPage(1);
                      fetchNotifications(1, true);
                    }}
                    disabled={loading}
                    className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer disabled:opacity-40"
                    title="Refresh"
                    aria-label="Refresh notifications"
                  >
                    <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                  </button>
                  <button
                    type="button"
                    onClick={handleMarkAllAsRead}
                    disabled={unreadCount === 0}
                    className="text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] disabled:text-[var(--color-text-muted)] disabled:opacity-45 disabled:pointer-events-none transition-colors cursor-pointer"
                  >
                    Mark all read
                  </button>
                </div>
              </div>

              {/* Minimal Underline Filter Tabs */}
              <div className="flex items-center gap-4 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveFilter("all")}
                  className={`pb-2 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeFilter === "all"
                      ? "border-[var(--color-text)] text-[var(--color-text)] font-medium"
                      : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                  }`}
                >
                  <span>All</span>
                  <span className="font-mono tabular-nums text-[10.5px] text-[var(--color-text-muted)]">
                    {notifications.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter("unread")}
                  className={`pb-2 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                    activeFilter === "unread"
                      ? "border-[var(--color-text)] text-[var(--color-text)] font-medium"
                      : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                  }`}
                >
                  <span>Unread</span>
                  <span className="font-mono tabular-nums text-[10.5px] text-[var(--color-text-muted)]">
                    {unreadCount}
                  </span>
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-[360px] overflow-y-auto divide-y divide-[var(--color-border)] custom-scrollbar bg-[var(--color-surface)]">
              {error ? (
                <div className="m-3 p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-xs text-rose-400/90 text-center">
                  {error}
                </div>
              ) : loading && notifications.length === 0 ? (
                <div className="p-3.5 space-y-3">
                  {[0, 1, 2].map((idx) => (
                    <div key={idx} className="flex items-start gap-2.5 animate-pulse">
                      <div className="w-4 h-4 rounded bg-[var(--color-border)] shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-2/5 rounded bg-[var(--color-border)]" />
                        <div className="h-2.5 w-4/5 rounded bg-[var(--color-border)]/70" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : visibleNotifications.length === 0 ? (
                <div className="py-10 px-6 text-center flex flex-col items-center gap-1.5">
                  <BellOff size={16} className="text-[var(--color-text-muted)] mb-1" />
                  <div className="text-xs font-medium text-[var(--color-text-secondary)]">
                    {activeFilter === "unread" ? "No unread notifications" : "No notifications"}
                  </div>
                  <p className="text-[11px] text-[var(--color-text-muted)] max-w-[230px]">
                    {activeFilter === "unread"
                      ? "You are caught up."
                      : "Updates from test runs and analysis will show here."}
                  </p>
                </div>
              ) : (
                <div>
                  {visibleNotifications.map((notification) => {
                    const meta = getNotificationMeta(notification);
                    const StatusIcon = meta.Icon;
                    const isUnread = !notification.readAt;

                    return (
                      <div
                        key={notification.id}
                        onClick={() => handleMarkAsRead(notification)}
                        className={`px-4 py-3 transition-colors duration-150 flex items-start gap-3 ${
                          isUnread
                            ? "cursor-pointer bg-[var(--color-surface-secondary)]/50 hover:bg-[var(--color-surface-secondary)]"
                            : "bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)]/35"
                        }`}
                      >
                        <div className="pt-0.5 shrink-0 flex items-center gap-1.5">
                          <StatusIcon size={14} className={meta.iconClass} strokeWidth={1.8} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isUnread && (
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text)] shrink-0" />
                              )}
                              <span
                                className={`text-xs truncate ${
                                  isUnread
                                    ? "font-semibold text-[var(--color-text)]"
                                    : "font-medium text-[var(--color-text-secondary)]"
                                }`}
                              >
                                {notification.title}
                              </span>
                            </div>
                            <span
                              className="text-[11px] text-[var(--color-text-muted)] tabular-nums shrink-0"
                              title={new Date(
                                notification.createdAt,
                              ).toLocaleString()}
                            >
                              {formatNotificationTime(notification.createdAt)}
                            </span>
                          </div>

                          <p className="mt-1 text-xs text-[var(--color-text-muted)] leading-relaxed break-words">
                            {notification.message}
                          </p>

                          {notification.project?.name && (
                            <div className="mt-1.5 text-[11px] text-[var(--color-text-muted)] truncate">
                              {notification.project.name}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!loading && hasMore && notifications.length > 0 && activeFilter === "all" && (
                <button
                  type="button"
                  onClick={handleLoadMore}
                  className="w-full py-2.5 text-center text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)]/60 border-t border-[var(--color-border)] transition-colors cursor-pointer"
                >
                  Load more
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
