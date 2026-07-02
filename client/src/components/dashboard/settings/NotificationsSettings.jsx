import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { notificationService } from "../../../services/notification.service";

export default function NotificationsSettings() {
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [error, setError] = useState(null);
    const isFetchingRef = useRef(false);
    const LIMIT = 30;

    const fetchNotifications = useCallback(async (pageNum = 1, reset = false) => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;
        setLoading(true);
        setError(null);
        try {
            const result = await notificationService.getNotifications(pageNum, LIMIT);
            setNotifications((prev) => (reset ? result.data : [...prev, ...result.data]));
            setUnreadCount(result.meta.unreadCount);
            setHasMore(pageNum < result.meta.pagination.totalPages);
        } catch (err) {
            setError(err.response?.data?.message || "Failed to load notifications");
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
        }
    }, []);

    useEffect(() => {
        fetchNotifications(1, true);
    }, [fetchNotifications]);

    const handleMarkAsRead = async (id) => {
        try {
            await notificationService.markAsRead(id);
            setNotifications((prev) =>
                prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
            );
            setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch (err) {
            console.error("Error marking notification as read:", err);
        }
    };

    const handleMarkAllAsRead = async () => {
        try {
            await notificationService.markAllAsRead();
            setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
            setUnreadCount(0);
        } catch (err) {
            console.error("Error marking all notifications as read:", err);
        }
    };

    const handleLoadMore = () => {
        if (loading || !hasMore) return;
        const next = page + 1;
        setPage(next);
        fetchNotifications(next, false);
    };

    return (
        <div
            style={{
                maxWidth: 720,
                margin: "0 auto",
                padding: "40px 24px",
                color: "#e6edf3",
                fontFamily: "var(--font-sans)",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                        style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            background: "rgba(124,58,237,0.12)",
                            border: "1px solid rgba(124,58,237,0.25)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <Bell size={18} color="#a78bfa" />
                    </div>
                    <div>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>Notifications</div>
                        <div style={{ fontSize: 12, color: "#8b949e" }}>
                            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
                        </div>
                    </div>
                </div>

                {unreadCount > 0 && (
                    <button
                        onClick={handleMarkAllAsRead}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: "rgba(124,58,237,0.12)",
                            color: "#c4b5fd",
                            border: "1px solid rgba(124,58,237,0.25)",
                            borderRadius: 8,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                        }}
                    >
                        <CheckCheck size={13} />
                        Mark all as read
                    </button>
                )}
            </div>

            {error && (
                <div style={{ padding: 16, color: "#f85149", fontSize: 13, textAlign: "center" }}>{error}</div>
            )}

            {!error && notifications.length === 0 && !loading && (
                <div
                    style={{
                        padding: "60px 0",
                        textAlign: "center",
                        color: "#6e7681",
                        border: "1px dashed #30363d",
                        borderRadius: 12,
                    }}
                >
                    <Bell size={28} style={{ margin: "0 auto 10px", opacity: 0.5 }} />
                    <div style={{ fontSize: 13 }}>No notifications yet</div>
                </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {notifications.map((n) => (
                    <div
                        key={n.id}
                        onClick={() => !n.readAt && handleMarkAsRead(n.id)}
                        style={{
                            padding: "14px 16px",
                            borderRadius: 10,
                            border: "1px solid #21262d",
                            background: n.readAt ? "transparent" : "rgba(124,58,237,0.06)",
                            cursor: n.readAt ? "default" : "pointer",
                            transition: "background-color 0.2s",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{n.title}</span>
                            <span style={{ fontSize: 11, color: "#6e7681", whiteSpace: "nowrap" }}>
                                {new Date(n.createdAt).toLocaleString([], {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}
                            </span>
                        </div>
                        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#8b949e", lineHeight: 1.5 }}>{n.message}</p>
                        {n.project?.name && (
                            <div style={{ marginTop: 6, fontSize: 11, color: "#6e7681" }}>Project: {n.project.name}</div>
                        )}
                    </div>
                ))}
            </div>

            {loading && (
                <div style={{ display: "flex", justifyContent: "center", padding: 20, color: "#8b949e" }}>
                    <Loader2 size={16} className="animate-spin" />
                </div>
            )}

            {!loading && hasMore && notifications.length > 0 && (
                <button
                    onClick={handleLoadMore}
                    style={{
                        width: "100%",
                        marginTop: 16,
                        padding: "10px",
                        background: "#161b22",
                        border: "1px solid #30363d",
                        borderRadius: 8,
                        color: "#c9d1d9",
                        fontSize: 13,
                        cursor: "pointer",
                    }}
                >
                    Load more
                </button>
            )}
        </div>
    );
}