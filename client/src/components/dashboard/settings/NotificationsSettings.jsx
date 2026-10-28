import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Bell,
  CheckCheck,
  Loader2,
  Sliders,
  Mail,
  Volume2,
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
    <div className="max-w-[920px] p-6 sm:p-8 font-sans text-[var(--color-text)]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-[var(--color-text)] mb-1.5 flex items-center gap-2.5">
          <Bell size={20} className="text-[var(--color-primary)]" />
          Notifications & Alerts
        </h1>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Manage your notification preferences, alert channels, and view recent
          history.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-[var(--color-border)] pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("preferences")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-medium cursor-pointer border transition-colors ${
            activeTab === "preferences"
              ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30 font-semibold"
              : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text)]"
          }`}
        >
          <Sliders size={13} />
          Notification Preferences
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-medium cursor-pointer border transition-colors ${
            activeTab === "history"
              ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30 font-semibold"
              : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text)]"
          }`}
        >
          <Clock size={13} />
          Recent History
          {unreadCount > 0 && (
            <span className="text-[10px] bg-[var(--color-primary)] text-white px-1.5 py-0.2 rounded-full font-bold">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === "preferences" ? (
        /* Preferences Tab */
        <div className="flex flex-col gap-6">
          {/* Email Notifications */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] shrink-0">
                <Mail size={15} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text)]">
                  Email Alerts
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Configure automated email dispatch for critical project
                  events.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
                <div>
                  <div className="text-xs font-semibold text-[var(--color-text)]">
                    Test Execution Failures
                  </div>
                  <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
                    Send email whenever a test run fails on a monitored snapshot
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={prefs.emailFailures}
                  onChange={(e) =>
                    setPrefs({ ...prefs, emailFailures: e.target.checked })
                  }
                  className="w-4 h-4 rounded cursor-pointer accent-[var(--color-primary)]"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
                <div>
                  <div className="text-xs font-semibold text-[var(--color-text)]">
                    Weekly Summary Digest
                  </div>
                  <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
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
                  className="w-4 h-4 rounded cursor-pointer accent-[var(--color-primary)]"
                />
              </div>
            </div>
          </div>

          {/* In-App Notifications */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] shrink-0">
                <Bell size={15} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text)]">
                  In-App Notification Triggers
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Select which events create in-app notifications in the
                  notification center.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
                <div>
                  <div className="text-xs font-semibold text-[var(--color-text)]">
                    AI Test Generation Ready
                  </div>
                  <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
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
                  className="w-4 h-4 rounded cursor-pointer accent-[var(--color-primary)]"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
                <div>
                  <div className="text-xs font-semibold text-[var(--color-text)]">
                    Coverage Drop Alert
                  </div>
                  <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
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
                  className="w-4 h-4 rounded cursor-pointer accent-[var(--color-primary)]"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
                <div>
                  <div className="text-xs font-semibold text-[var(--color-text)]">
                    Job Queue Status Updates
                  </div>
                  <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
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
                  className="w-4 h-4 rounded cursor-pointer accent-[var(--color-primary)]"
                />
              </div>
            </div>
          </div>

          {/* Sound & Feedback */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] shrink-0">
                <Volume2 size={15} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text)]">
                  Audio & Feedback
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Sound chime on test completion or task error.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
              <div>
                <div className="text-xs font-semibold text-[var(--color-text)]">
                  Play Notification Chimes
                </div>
                <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
                  Play an auditory cue when background long-running tasks
                  terminate
                </div>
              </div>
              <input
                type="checkbox"
                checked={prefs.soundAlerts}
                onChange={(e) =>
                  setPrefs({ ...prefs, soundAlerts: e.target.checked })
                }
                className="w-4 h-4 rounded cursor-pointer accent-[var(--color-primary)]"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleSavePreferences}
              className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer shadow-xs"
            >
              Save Preferences
            </motion.button>
          </div>
        </div>
      ) : (
        /* History Tab */
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-[var(--color-text-secondary)] font-medium">
              {unreadCount > 0
                ? `${unreadCount} unread`
                : "You're all caught up"}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/25 text-xs font-semibold hover:bg-[var(--color-primary)]/20 transition-colors cursor-pointer"
              >
                <CheckCheck size={13} />
                Mark all as read
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 text-center text-xs text-[var(--color-danger)] bg-[var(--color-danger)]/10 rounded-[var(--radius-md)] mb-3">
              {error}
            </div>
          )}

          {!error && notifications.length === 0 && !loading && (
            <div className="py-12 text-center text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)]">
              <Bell
                size={24}
                className="mx-auto mb-2 opacity-40 text-[var(--color-text-secondary)]"
              />
              <div className="text-xs">No notifications yet</div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.readAt && handleMarkAsRead(n.id)}
                className={`p-3.5 rounded-[var(--radius-md)] border transition-colors ${
                  !n.readAt
                    ? "bg-[var(--color-primary-light)]/40 hover:bg-[var(--color-primary-light)]/70 border-[var(--color-primary)]/25 cursor-pointer"
                    : "bg-[var(--color-bg)] border-[var(--color-border)] cursor-default"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-xs text-[var(--color-text)] truncate">
                    {n.title}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-mono shrink-0">
                    {new Date(n.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  {n.message}
                </p>
                {n.project?.name && (
                  <div className="mt-1.5 text-[10px] text-[var(--color-text-muted)] font-mono">
                    Project: {n.project.name}
                  </div>
                )}
              </div>
            ))}
          </div>

          {loading && (
            <div className="flex justify-center p-4 text-[var(--color-text-secondary)]">
              <Loader2
                size={16}
                className="animate-spin text-[var(--color-primary)]"
              />
            </div>
          )}

          {!loading && hasMore && notifications.length > 0 && (
            <button
              type="button"
              onClick={handleLoadMore}
              className="w-full mt-4 py-2 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
