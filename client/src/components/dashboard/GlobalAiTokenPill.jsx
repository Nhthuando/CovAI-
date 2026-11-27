import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Gauge,
  Clock,
  ShieldCheck,
  ChevronDown,
  Coins,
  RefreshCw,
  Layers,
} from "lucide-react";
import {
  API_BASE,
  authAwareFetch,
  getAccessToken,
} from "../../lib/authSession.js";

const BASE_URL = API_BASE;

function getAuthHeaders() {
  const token = getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

export default function GlobalAiTokenPill() {
  const [quota, setQuota] = useState({
    dailyLimit: 50,
    usedToday: 0,
    remainingRequests: 50,
    totalTokens: 0,
    usageDate: null,
  });
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  const fetchQuota = useCallback(async () => {
    try {
      const res = await authAwareFetch(fetch, `${BASE_URL}/users/ai-quota`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setQuota({
          dailyLimit: data.dailyLimit ?? 50,
          usedToday: data.usedToday ?? 0,
          remainingRequests:
            data.remainingRequests ??
            Math.max(0, (data.dailyLimit ?? 50) - (data.usedToday ?? 0)),
          totalTokens: data.totalTokens ?? 0,
          usageDate: data.usageDate ?? null,
        });
      }
    } catch {
      // Keep optimistic fallback state on network error
    }
  }, []);

  useEffect(() => {
    fetchQuota();

    const handleUsageUpdated = () => {
      fetchQuota();
    };

    window.addEventListener("covai:ai-usage-updated", handleUsageUpdated);
    window.addEventListener("focus", handleUsageUpdated);

    return () => {
      window.removeEventListener("covai:ai-usage-updated", handleUsageUpdated);
      window.removeEventListener("focus", handleUsageUpdated);
    };
  }, [fetchQuota]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const usedPct = Math.min(
    100,
    Math.round(
      ((quota.usedToday || 0) / Math.max(1, quota.dailyLimit || 50)) * 100,
    ),
  );
  const isWarning = usedPct >= 75 && usedPct < 90;
  const isCritical = usedPct >= 90;

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Top Bar Pill Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono border transition-colors duration-150 cursor-pointer select-none ${
          isOpen
            ? "bg-[var(--ps-surface-2)] border-[var(--ps-line-strong)] text-[var(--ps-ink)]"
            : "bg-[var(--ps-inset)] hover:bg-[var(--ps-surface-2)] border-[var(--ps-line)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)]"
        }`}
        title="View AI Token Usage & Daily Quota"
        aria-label="AI Token Quota Hub"
      >
        <Gauge
          size={12}
          className={
            isCritical
              ? "text-[var(--ps-rose)]"
              : isWarning
                ? "text-[var(--ps-amber)]"
                : "text-[var(--ps-cobalt)]"
          }
        />
        <span className="font-semibold text-[var(--ps-ink)] tabular-nums">
          {quota.remainingRequests}
          <span className="text-[10px] text-[var(--ps-ink-muted)] font-normal font-sans ml-0.5">
            reqs
          </span>
        </span>
        <span className="text-[var(--ps-line-strong)]">|</span>
        <span className="text-[11px] text-[var(--ps-ink-muted)] font-sans hidden md:inline tabular-nums">
          {(quota.totalTokens || 0).toLocaleString()}{" "}
          <span className="text-[10px]">tok</span>
        </span>
        <ChevronDown
          size={11}
          className={`opacity-60 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Popover Card */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl z-50 p-4 text-xs font-sans animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <Gauge size={14} />
              </div>
              <div>
                <h4 className="font-bold text-sm text-[var(--color-text)] leading-tight">
                  AI Token &amp; Quota Hub
                </h4>
                <p className="text-[10px] text-[var(--color-text-muted)] m-0">
                  Global telemetry across all test levels
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                setLoading(true);
                await fetchQuota();
                setLoading(false);
              }}
              className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors rounded cursor-pointer"
              title="Refresh quota"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {/* Daily Request Budget Gauge */}
          <div className="py-3 space-y-1.5 border-b border-[var(--color-border)]">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--color-text-secondary)] font-medium">
                Daily Requests Budget
              </span>
              <span className="font-mono font-bold text-[var(--color-text)]">
                {quota.usedToday} / {quota.dailyLimit}{" "}
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  ({quota.remainingRequests} left)
                </span>
              </span>
            </div>
            <div className="w-full h-1.5 rounded-sm bg-[var(--ps-inset)] border border-[var(--ps-line)] overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-sm ${
                  isCritical
                    ? "bg-[var(--ps-rose)]"
                    : isWarning
                      ? "bg-[var(--ps-amber)]"
                      : "bg-[var(--ps-cobalt)]"
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
          </div>

          {/* Cumulative Token Telemetry */}
          <div className="py-3 space-y-2 border-b border-[var(--ps-line)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[var(--ps-ink-secondary)] text-[11px]">
                <Coins size={13} className="text-[var(--color-text-muted)]" />
                <span>Tokens used</span>
              </div>
              <span className="text-base font-bold ps-mono text-[var(--ps-ink)]">
                {(quota.totalTokens || 0).toLocaleString()}
              </span>
            </div>
            <p className="text-[10px] text-[var(--ps-ink-muted)] m-0 leading-relaxed">
              Tokens are dynamically metered during AST branch synthesis,
              Supertest contract creation, and Playwright journeys.
            </p>
          </div>

          {/* Level Status & Reset Window */}
          <div className="pt-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] text-[var(--ps-ink-muted)]">
              <span className="flex items-center gap-1">
                <Clock size={11} />
                <span>Daily Reset</span>
              </span>
              <span className="ps-mono font-semibold text-[var(--ps-ink-secondary)]">
                00:00 (UTC+7)
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-1 text-center ps-mono text-[10px]">
              <div className="p-1.5 rounded-md bg-[var(--ps-inset)] border border-[var(--ps-line)]">
                <span className="text-[var(--ps-ink-muted)] block text-[9px] font-sans">
                  Unit
                </span>
                <span className="text-[var(--ps-emerald)] font-medium">
                  Active
                </span>
              </div>
              <div className="p-1.5 rounded-md bg-[var(--ps-inset)] border border-[var(--ps-line)]">
                <span className="text-[var(--ps-ink-muted)] block text-[9px] font-sans">
                  Integration
                </span>
                <span className="text-[var(--ps-emerald)] font-medium">
                  Active
                </span>
              </div>
              <div className="p-1.5 rounded-md bg-[var(--ps-inset)] border border-[var(--ps-line)]">
                <span className="text-[var(--ps-ink-muted)] block text-[9px] font-sans">
                  System
                </span>
                <span className="text-[var(--ps-emerald)] font-medium">
                  Active
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
