import { useState, useEffect, useCallback } from "react";
import { io } from "socket.io-client";
import { RefreshCw, RotateCcw } from "lucide-react";
import { useToast } from "../ToastContext";
import ConfirmDialog from "../../common/ConfirmDialog";
import {
  getAiQuotasApi,
  resetAiQuotasApi,
} from "../../../services/aiQuotaSettings.service";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

/**
 * Antigravity-style circular progress indicator
 */
function CircularProgress({ percent = 100, status = "ACTIVE", size = 26, strokeWidth = 3 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  let strokeColor = "#3fb950"; // healthy green
  if (status === "RATE_LIMITED" || status === "MISSING_KEY") {
    strokeColor = "#f85149";
  } else if (clamped <= 10) {
    strokeColor = "#f85149"; // red
  } else if (clamped <= 25) {
    strokeColor = "#d29922"; // amber
  }

  return (
    <svg width={size} height={size} className="transform -rotate-90 shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="#21262d"
        strokeWidth={strokeWidth}
        fill="transparent"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        fill="transparent"
        className="transition-all duration-500 ease-out"
      />
    </svg>
  );
}

export default function Usage({ isActive = true }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [quotaData, setQuotaData] = useState(null);

  // Confirmation dialog state for reset
  const [resetConfirm, setResetConfirm] = useState({
    isOpen: false,
    channelId: null,
    channelLabel: null,
  });

  const fetchQuotas = useCallback(
    async ({ silent = false, isRefresh = false } = {}) => {
      if (isRefresh) setRefreshing(true);
      else if (!silent) setLoading(true);

      try {
        const data = await getAiQuotasApi();
        setQuotaData(data);
        if (isRefresh) {
          showToast({
            type: "success",
            title: "Usage Refreshed",
            message: "Model usage metrics updated from server.",
          });
        }
      } catch (err) {
        console.error("[Usage] Failed to load quota settings:", err);
        if (!silent) {
          showToast({
            type: "error",
            title: "Load Failed",
            message: err.message || "Failed to load model usage data.",
          });
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showToast]
  );

  // 1. Initial mount
  useEffect(() => {
    fetchQuotas();
  }, [fetchQuotas]);

  // 2. Auto-fetch when tab becomes active
  useEffect(() => {
    if (isActive) {
      fetchQuotas({ silent: true });
    }
  }, [isActive, fetchQuotas]);

  // 3. Auto-fetch on window focus / document visibility change
  useEffect(() => {
    const handleFocus = () => {
      if (isActive) fetchQuotas({ silent: true });
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isActive) {
        fetchQuotas({ silent: true });
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isActive, fetchQuotas]);

  // 4. Minute ticker for relative reset time updates
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  // 5. Real-time WebSocket listener (silent background update)
  useEffect(() => {
    let token = localStorage.getItem("token") || "";
    try {
      token ||= JSON.parse(localStorage.getItem("user") || "null")?.token || "";
    } catch {
      // ignore
    }
    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on("ai_quotas:updated", (newSnapshot) => {
      if (newSnapshot) {
        setQuotaData(newSnapshot);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleConfirmReset = async () => {
    const { channelId, channelLabel } = resetConfirm;
    setResetConfirm({ isOpen: false, channelId: null, channelLabel: null });

    try {
      const updated = await resetAiQuotasApi(channelId);
      setQuotaData(updated);
      showToast({
        type: "success",
        title: "Usage Counters Reset",
        message: channelId
          ? `Usage for ${channelLabel} has been reset to 0.`
          : "All token usage counters have been reset to 0.",
      });
    } catch (err) {
      console.error("[Usage] Failed to reset usage:", err);
      showToast({
        type: "error",
        title: "Reset Failed",
        message: err.message || "Failed to reset token usage counters.",
      });
    }
  };

  const formatNumber = (num) => {
    if (typeof num !== "number" || isNaN(num)) return "0";
    return num.toLocaleString();
  };

  const formatRelativeTime = (isoString) => {
    if (!isoString) return "Never";
    const date = new Date(isoString);
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 0) return "Just now";
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const formatTimeUntilReset = (isoString) => {
    if (!isoString) return "at midnight";
    const target = new Date(isoString).getTime();
    const diffMs = target - Date.now();
    if (diffMs <= 0) return "in a few seconds";
    const diffMin = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMin / 60);
    const minutes = diffMin % 60;
    if (hours > 0 && minutes > 0) {
      return `in ${hours} ${hours === 1 ? "hour" : "hours"}, ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    }
    if (hours > 0) {
      return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
    }
    return `in ${Math.max(1, minutes)} ${minutes === 1 ? "minute" : "minutes"}`;
  };

  if (loading && !quotaData) {
    return (
      <div className="max-w-[760px] p-6 sm:p-8 font-sans text-[var(--color-text)]">
        <div className="flex items-center justify-center py-20 text-[var(--color-text-secondary)] text-xs gap-2">
          <RefreshCw size={15} className="animate-spin text-[var(--color-primary)]" />
          Loading model quota and usage...
        </div>
      </div>
    );
  }

  const summary = quotaData?.summary || {};
  const channels = quotaData?.channels || [];
  const poolUsagePercent =
    summary.totalQuotaPool > 0
      ? Math.min(100, Number(((summary.totalEffectiveUsedTokens / summary.totalQuotaPool) * 100).toFixed(1)))
      : 0;
  const poolRemainingPercent = Math.max(0, 100 - poolUsagePercent);

  return (
    <div className="max-w-[760px] p-6 sm:p-8 font-sans text-[var(--color-text)] select-none">
      {/* Header matching Antigravity Models & Usage */}
      <div className="mb-7 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
            <span>Models &amp; Usage</span>
            <button
              type="button"
              onClick={() => fetchQuotas({ isRefresh: true })}
              disabled={refreshing}
              className="p-1 rounded-full text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh usage"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin text-[var(--color-primary)]" : ""} />
            </button>
          </h1>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            Manage your model quota and credits.
          </p>
        </div>

        {summary.totalEffectiveUsedTokens > 0 && (
          <button
            type="button"
            onClick={() =>
              setResetConfirm({
                isOpen: true,
                channelId: null,
                channelLabel: "All Channels",
              })
            }
            className="text-xs text-[var(--color-text-muted)] hover:text-[#f85149] transition-colors cursor-pointer font-medium"
          >
            Reset usage counters
          </button>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {/* Section 1: Main Gemini Model Quota Limit */}
        <div>
          <div className="text-xs font-semibold text-[var(--color-text)] mb-2.5">
            Gemini Models
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4 sm:p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  Daily Limit Remaining
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                  {summary.totalEffectiveUsedTokens > 0 ? (
                    <>
                      You have used {poolUsagePercent}% of your daily limit ({formatNumber(summary.totalEffectiveUsedTokens)} / {formatNumber(summary.totalQuotaPool)} tokens), it will fully refresh {formatTimeUntilReset(summary.nextResetAt)}.
                    </>
                  ) : (
                    <>
                      You have not used any of your daily limit ({formatNumber(summary.totalQuotaPool)} tokens), it will fully refresh {formatTimeUntilReset(summary.nextResetAt)}.
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-bold font-mono tabular-nums text-[var(--color-text)]">
                  {poolRemainingPercent}%
                </span>
                <CircularProgress percent={poolRemainingPercent} size={28} strokeWidth={3} />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Engine Usage Breakdown */}
        <div>
          <div className="text-xs font-semibold text-[var(--color-text)] mb-2.5">
            Usage by Engine
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] divide-y divide-[var(--color-border)] overflow-hidden">
            {channels.map((ch) => {
              const channelTokens = ch.channelUsedTokens.totalTokens;
              const channelPercentOfTotal =
                summary.totalEffectiveUsedTokens > 0
                  ? Math.round((channelTokens / summary.totalEffectiveUsedTokens) * 100)
                  : 0;

              return (
                <div
                  key={ch.channelId}
                  className="p-4 sm:p-4.5 flex items-center justify-between gap-4 hover:bg-[var(--color-surface-secondary)]/30 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--color-text)]">
                        {ch.label}
                      </span>
                      {ch.keyMode === "DEDICATED" && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#3fb950]/10 text-[#3fb950] border border-[#3fb950]/25">
                          Dedicated
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--color-text-secondary)] mt-1 truncate">
                      {channelTokens > 0 ? (
                        <>
                          {formatNumber(channelTokens)} tokens consumed across {ch.channelUsedTokens.requestCount} {ch.channelUsedTokens.requestCount === 1 ? "call" : "calls"}
                          {ch.lastUsedAt && ` • Last active ${formatRelativeTime(ch.lastUsedAt)}`}
                        </>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">No tokens consumed today</span>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono font-semibold tabular-nums text-[var(--color-text)]">
                      {formatNumber(channelTokens)} <span className="text-xs font-normal text-[var(--color-text-muted)]">tok</span>
                    </div>
                    {channelTokens > 0 && summary.totalEffectiveUsedTokens > 0 && (
                      <div className="text-[11px] font-mono text-[var(--color-text-muted)] mt-0.5">
                        {channelPercentOfTotal}% of total
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Clean Reset Confirmation Dialog */}
      <ConfirmDialog
        isOpen={resetConfirm.isOpen}
        onClose={() => setResetConfirm({ isOpen: false, channelId: null, channelLabel: null })}
        onConfirm={handleConfirmReset}
        title="Reset Token Usage Counters"
        message="Are you sure you want to reset all Gemini token usage counters back to 0 for today?"
        confirmText="Reset Counters"
        cancelText="Cancel"
        variant="danger"
        icon={RotateCcw}
      />
    </div>
  );
}
