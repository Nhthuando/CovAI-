import React, { useState, useEffect, useRef, useCallback } from "react";
import { Zap, Clock, ShieldCheck, ChevronDown, Sparkles, RefreshCw, Layers } from "lucide-react";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const token =
    localStorage.getItem("token") ||
    (localStorage.getItem("user")
      ? JSON.parse(localStorage.getItem("user")).token
      : null);
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
      const res = await fetch(`${BASE_URL}/users/ai-quota`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setQuota({
          dailyLimit: data.dailyLimit ?? 50,
          usedToday: data.usedToday ?? 0,
          remainingRequests: data.remainingRequests ?? Math.max(0, (data.dailyLimit ?? 50) - (data.usedToday ?? 0)),
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

  const usedPct = Math.min(100, Math.round(((quota.usedToday || 0) / Math.max(1, quota.dailyLimit || 50)) * 100));
  const isWarning = usedPct >= 75 && usedPct < 90;
  const isCritical = usedPct >= 90;

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Top Bar Pill Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] text-xs font-mono border transition-all cursor-pointer select-none shadow-2xs ${
          isOpen
            ? "bg-[var(--color-surface)] border-[var(--color-primary)] text-[var(--color-text)] shadow-xs"
            : "bg-[var(--color-surface-secondary)]/80 hover:bg-[var(--color-surface-hover)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
        }`}
        title="View AI Token Usage & Daily Quota"
        aria-label="AI Token Quota Hub"
      >
        <Zap
          size={12}
          className={
            isCritical
              ? "text-rose-400 fill-rose-400"
              : isWarning
              ? "text-amber-400 fill-amber-400"
              : "text-[var(--color-primary)] group-hover:scale-110 transition-transform"
          }
        />
        <span className="font-semibold text-[var(--color-text)]">
          {quota.remainingRequests}
          <span className="text-[10px] text-[var(--color-text-muted)] font-normal font-sans ml-0.5">reqs</span>
        </span>
        <span className="text-[var(--color-border)] opacity-60">|</span>
        <span className="text-[11px] text-[var(--color-text-muted)] font-sans hidden md:inline">
          {(quota.totalTokens || 0).toLocaleString()} <span className="text-[10px]">tok</span>
        </span>
        <ChevronDown size={11} className={`opacity-60 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Popover Card */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl z-50 p-4 text-xs font-sans animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <Sparkles size={14} />
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
              <span className="text-[var(--color-text-secondary)] font-medium">Daily Requests Budget</span>
              <span className="font-mono font-bold text-[var(--color-text)]">
                {quota.usedToday} / {quota.dailyLimit}{" "}
                <span className="text-[10px] text-[var(--color-text-muted)]">({quota.remainingRequests} left)</span>
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-[var(--color-surface-secondary)] overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  isCritical
                    ? "bg-rose-500"
                    : isWarning
                    ? "bg-amber-500"
                    : "bg-[var(--color-primary)]"
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
          </div>

          {/* Cumulative Token Telemetry */}
          <div className="py-3 space-y-2 border-b border-[var(--color-border)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)] text-[11px]">
                <Zap size={13} className="text-amber-400" />
                <span>Total Tokens Consumed</span>
              </div>
              <span className="text-base font-bold font-mono text-[var(--color-text)]">
                {(quota.totalTokens || 0).toLocaleString()}
              </span>
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] m-0 leading-relaxed">
              Tokens are dynamically metered during AST branch synthesis, Supertest contract creation, and Playwright journeys.
            </p>
          </div>

          {/* Level Status & Reset Window */}
          <div className="pt-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
              <span className="flex items-center gap-1">
                <Clock size={11} />
                <span>Daily Reset</span>
              </span>
              <span className="font-mono font-semibold text-[var(--color-text-secondary)]">
                00:00 (UTC+7)
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-1 text-center font-mono text-[10px]">
              <div className="p-1 rounded bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)]">
                <span className="text-[var(--color-text-muted)] block text-[9px] font-sans">Unit</span>
                <span className="text-emerald-400 font-bold">Active</span>
              </div>
              <div className="p-1 rounded bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)]">
                <span className="text-[var(--color-text-muted)] block text-[9px] font-sans">Integration</span>
                <span className="text-emerald-400 font-bold">Active</span>
              </div>
              <div className="p-1 rounded bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)]">
                <span className="text-[var(--color-text-muted)] block text-[9px] font-sans">System</span>
                <span className="text-emerald-400 font-bold">Active</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

