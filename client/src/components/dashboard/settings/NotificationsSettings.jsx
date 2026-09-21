import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Bell,
  CheckCheck,
  Loader2,
  Sliders,
  Mail,
  Volume2,
  AlertCircle,
  Sparkles,
  ShieldAlert,
  Clock,
} from "lucide-react";
import { notificationService } from "../../../services/notification.service";
import { useToast } from "../ToastContext";

export default function NotificationsSettings() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState("preferences");
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const isFetchingRef = useRef(false);
  const LIMIT = 30;

  // Preferences state
  const [prefs, setPrefs] = useState({
    emailFailures: true,
    emailWeekly: false,
    inAppAiDone: true,
    inAppCoverageDrop: true,
    inAppJobUpdates: true,
    soundAlerts: true,
  });

  const fetchNotifications = useCallback(async (pageNum = 1, reset = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await notificationService.getNotifications(pageNum, LIMIT);
      setNotifications((prev) =>
        reset ? result.data : [...prev, ...result.data],
      );
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
        prev.map((n) =>
          n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: new Date().toISOString() })),
      );
      setUnreadCount(0);
      showToast({
        type: "success",
        title: "All Read",
        message: "All notifications have been marked as read.",
      });
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

  const handleSavePreferences = () => {
    showToast({
      type: "success",
      title: "Preferences Saved",
      message: "Your notification settings have been updated.",
    });
  };

  return (
    <div
      style={{
        maxWidth: "920px",
        padding: "32px 28px 64px",
        fontFamily: "var(--font-sans)",
        color: "#e6edf3",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1
          style={{
            fontSize: "22px",
            fontWeight: 700,
            color: "#e6edf3",
            marginBottom: "6px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <Bell size={22} style={{ color: "#a78bfa" }} />
          Notifications & Alerts
        </h1>
        <p style={{ color: "#8b949e", fontSize: "13px", margin: 0 }}>
          Manage your notification preferences, alert channels, and view recent
          history.
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "24px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          paddingBottom: "12px",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("preferences")}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            background:
              activeTab === "preferences"
                ? "rgba(124, 58, 237, 0.15)"
                : "transparent",
            color: activeTab === "preferences" ? "#c4b5fd" : "#8b949e",
            border:
              activeTab === "preferences"
                ? "1px solid rgba(124, 58, 237, 0.3)"
                : "1px solid transparent",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Sliders size={14} />
          Notification Preferences
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("history")}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            background:
              activeTab === "history"
                ? "rgba(124, 58, 237, 0.15)"
                : "transparent",
            color: activeTab === "history" ? "#c4b5fd" : "#8b949e",
            border:
              activeTab === "history"
                ? "1px solid rgba(124, 58, 237, 0.3)"
                : "1px solid transparent",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Clock size={14} />
          Recent History
          {unreadCount > 0 && (
            <span
              style={{
                fontSize: "10px",
                background: "#7c3aed",
                color: "#fff",
                padding: "1px 6px",
                borderRadius: "999px",
                fontWeight: 700,
              }}
            >
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === "preferences" ? (
        /* Preferences Tab */
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Email Notifications */}
          <div
            style={{
              background: "rgba(255, 255, 255, 0.025)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "14px",
              padding: "24px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(124, 58, 237, 0.12)",
                  border: "1px solid rgba(124, 58, 237, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Mail size={16} style={{ color: "#a78bfa" }} />
              </div>
              <div>
                <h3
                  style={{
                    fontSize: "15px",
                    fontWeight: 600,
                    color: "#e6edf3",
                    margin: 0,
                  }}
                >
                  Email Alerts
                </h3>
                <p
                  style={{
                    fontSize: "12px",
                    color: "#8b949e",
                    margin: "2px 0 0",
                  }}
                >
                  Configure automated email dispatch for critical project
                  events.
                </p>
              </div>
            </div>

            <div
              style={{ display: "flex", flexDirection: "column", gap: "14px" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#e6edf3",
                    }}
                  >
                    Test Execution Failures
                  </div>
                  <div style={{ fontSize: "12px", color: "#8b949e" }}>
                    Send email whenever a test run fails on a monitored snapshot
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.emailFailures}
                  onChange={(e) =>
                    setPrefs({ ...prefs, emailFailures: e.target.checked })
                  }
                  style={{
                    width: "18px",
                    height: "18px",
                    accentColor: "#7c3aed",
                    cursor: "pointer",
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#e6edf3",
                    }}
                  >
                    Weekly Summary Digest
                  </div>
                  <div style={{ fontSize: "12px", color: "#8b949e" }}>
                    Receive a weekly report on project coverage gains and AI
                    tests generated
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.emailWeekly}
                  onChange={(e) =>
                    setPrefs({ ...prefs, emailWeekly: e.target.checked })
                  }
                  style={{
                    width: "18px",
                    height: "18px",
                    accentColor: "#7c3aed",
                    cursor: "pointer",
                  }}
                />
              </div>
            </div>
          </div>

          {/* In-App Notifications */}
          <div
            style={{
              background: "rgba(255, 255, 255, 0.025)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "14px",
              padding: "24px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(34, 211, 238, 0.12)",
                  border: "1px solid rgba(34, 211, 238, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Bell size={16} style={{ color: "#22d3ee" }} />
              </div>
              <div>
                <h3
                  style={{
                    fontSize: "15px",
                    fontWeight: 600,
                    color: "#e6edf3",
                    margin: 0,
                  }}
                >
                  In-App Notification Triggers
                </h3>
                <p
                  style={{
                    fontSize: "12px",
                    color: "#8b949e",
                    margin: "2px 0 0",
                  }}
                >
                  Select which events create in-app notifications in the
                  notification center.
                </p>
              </div>
            </div>

            <div
              style={{ display: "flex", flexDirection: "column", gap: "14px" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#e6edf3",
                    }}
                  >
                    AI Test Generation Ready
                  </div>
                  <div style={{ fontSize: "12px", color: "#8b949e" }}>
                    Notify when Gemini AI finishes generating skeleton or full
                    test suites
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.inAppAiDone}
                  onChange={(e) =>
                    setPrefs({ ...prefs, inAppAiDone: e.target.checked })
                  }
                  style={{
                    width: "18px",
                    height: "18px",
                    accentColor: "#7c3aed",
                    cursor: "pointer",
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#e6edf3",
                    }}
                  >
                    Coverage Drop Alert
                  </div>
                  <div style={{ fontSize: "12px", color: "#8b949e" }}>
                    Trigger alert if statement or branch coverage decreases
                    below 80%
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.inAppCoverageDrop}
                  onChange={(e) =>
                    setPrefs({ ...prefs, inAppCoverageDrop: e.target.checked })
                  }
                  style={{
                    width: "18px",
                    height: "18px",
                    accentColor: "#7c3aed",
                    cursor: "pointer",
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#e6edf3",
                    }}
                  >
                    Job Queue Status Updates
                  </div>
                  <div style={{ fontSize: "12px", color: "#8b949e" }}>
                    Notify on completion or cancellation of background worker
                    jobs
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.inAppJobUpdates}
                  onChange={(e) =>
                    setPrefs({ ...prefs, inAppJobUpdates: e.target.checked })
                  }
                  style={{
                    width: "18px",
                    height: "18px",
                    accentColor: "#7c3aed",
                    cursor: "pointer",
                  }}
                />
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              paddingTop: "12px",
            }}
          >
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleSavePreferences}
              style={{
                padding: "9px 22px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",
                border: "none",
                fontSize: "13px",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 2px 10px rgba(124, 58, 237, 0.35)",
              }}
            >
              Save Preferences
            </motion.button>
          </div>
        </div>
      ) : (
        /* History Tab */
        <div
          style={{
            background: "rgba(255, 255, 255, 0.025)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "14px",
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "18px",
            }}
          >
            <div style={{ fontSize: "14px", color: "#8b949e" }}>
              {unreadCount > 0
                ? `${unreadCount} unread`
                : "You're all caught up"}
            </div>

            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "rgba(124, 58, 237, 0.12)",
                  color: "#c4b5fd",
                  border: "1px solid rgba(124, 58, 237, 0.25)",
                  borderRadius: "8px",
                  padding: "6px 12px",
                  fontSize: "12px",
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
            <div
              style={{
                padding: "16px",
                color: "#f85149",
                fontSize: "13px",
                textAlign: "center",
              }}
            >
              {error}
            </div>
          )}

          {!error && notifications.length === 0 && !loading && (
            <div
              style={{
                padding: "60px 0",
                textAlign: "center",
                color: "#6e7681",
                border: "1px dashed rgba(255, 255, 255, 0.1)",
                borderRadius: "12px",
              }}
            >
              <Bell size={28} style={{ margin: "0 auto 10px", opacity: 0.5 }} />
              <div style={{ fontSize: "13px" }}>No notifications yet</div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.readAt && handleMarkAsRead(n.id)}
                style={{
                  padding: "14px 16px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  background: n.readAt
                    ? "rgba(0, 0, 0, 0.2)"
                    : "rgba(124, 58, 237, 0.08)",
                  cursor: n.readAt ? "default" : "pointer",
                  transition: "background-color 0.2s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "12px",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: "13px",
                      color: n.readAt ? "#c9d1d9" : "#fff",
                    }}
                  >
                    {n.title}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#6e7681",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {new Date(n.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: "12px",
                    color: "#8b949e",
                    lineHeight: 1.5,
                  }}
                >
                  {n.message}
                </p>
                {n.project?.name && (
                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "11px",
                      color: "#a78bfa",
                    }}
                  >
                    Project: {n.project.name}
                  </div>
                )}
              </div>
            ))}
          </div>

          {loading && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "20px",
                color: "#8b949e",
              }}
            >
              <Loader2 size={16} className="animate-spin" />
            </div>
          )}

          {!loading && hasMore && notifications.length > 0 && (
            <button
              onClick={handleLoadMore}
              style={{
                width: "100%",
                marginTop: "16px",
                padding: "10px",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "8px",
                color: "#c9d1d9",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
