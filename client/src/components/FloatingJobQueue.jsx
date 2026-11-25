import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  ListOrdered,
  GripVertical,
  X,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  Search,
  Terminal,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { getAccessToken } from "../lib/authSession.js";
import {
  FLOATING_QUEUE_OPEN_EVENT,
  FLOATING_QUEUE_VISIBILITY_EVENT,
  JOB_DOMAIN_BADGES,
  JOB_DOMAIN_TABS,
  clampFloatingPos,
  getJobTypeMeta,
  isFloatingJobQueueVisible,
  loadFloatingJobQueuePos,
  saveFloatingJobQueuePos,
  setFloatingJobQueueVisible,
} from "../lib/floatingJobQueuePrefs.js";
import {
  cancelJobApi,
  getJobDetailApi,
  getProjectJobsApi,
  getUserJobsApi,
} from "../services/job.service.js";
import { useToast } from "./dashboard/ToastContext.jsx";

const PUBLIC_PATHS = ["/", "/login", "/register", "/reset-password", "/privacy", "/terms", "/telemetry", "/auth/github/callback"];
const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);
const DRAG_THRESHOLD_PX = 5;

const STATUS_BADGE = {
  QUEUED: {
    label: "Queued",
    textClass: "text-[var(--color-text-muted)]",
    dotClass: "bg-[var(--color-text-muted)]",
    iconClass: "text-[var(--color-text-muted)]",
    icon: Clock,
  },
  RUNNING: {
    label: "Running",
    textClass: "text-[var(--color-text)]",
    dotClass: "bg-[var(--color-text)]",
    iconClass: "text-[var(--color-text)]",
    icon: Loader2,
  },
  SUCCESS: {
    label: "Completed",
    textClass: "text-[var(--color-text-secondary)]",
    dotClass: "bg-emerald-500/70",
    iconClass: "text-[var(--color-text-secondary)]",
    icon: CheckCircle2,
  },
  FAILED: {
    label: "Failed",
    textClass: "text-rose-300/90",
    dotClass: "bg-rose-400/80",
    iconClass: "text-rose-400/85",
    icon: XCircle,
  },
  CANCELED: {
    label: "Canceled",
    textClass: "text-[var(--color-text-muted)]",
    dotClass: "bg-[var(--color-border-strong)]",
    iconClass: "text-[var(--color-text-muted)]",
    icon: Ban,
  },
};

function formatTimeAgo(dateStr) {
  if (!dateStr) return "—";
  const ts = new Date(dateStr).getTime();
  if (Number.isNaN(ts)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(ts).toLocaleDateString();
}

function formatDuration(job) {
  if (typeof job?.computeTimeMs === "number" && job.computeTimeMs > 0) {
    const secs = job.computeTimeMs / 1000;
    return secs < 60 ? `${secs.toFixed(1)}s` : `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
  }
  const start = job?.startedAt ? new Date(job.startedAt).getTime() : null;
  const endRaw = job?.finishedAt || job?.completedAt;
  const end = endRaw ? new Date(endRaw).getTime() : ACTIVE_STATUSES.has(job?.status) ? Date.now() : null;
  if (!start || !end || Number.isNaN(start) || Number.isNaN(end)) return "—";
  const secs = Math.max(0, (end - start) / 1000);
  return secs < 60 ? `${secs.toFixed(1)}s` : `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
}

function isPublicRoute(pathname) {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/invitations/")) return true;
  return false;
}

export default function FloatingJobQueue() {
  const location = useLocation();
  const { showToast } = useToast();

  const [hasToken, setHasToken] = useState(() => Boolean(getAccessToken()));
  const [visible, setVisible] = useState(() => isFloatingJobQueueVisible());
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState(() => loadFloatingJobQueuePos());
  const [isDragging, setIsDragging] = useState(false);

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [domainFilter, setDomainFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [cancelingId, setCancelingId] = useState(null);
  const [expandedJobId, setExpandedJobId] = useState(null);
  const [jobDetailsMap, setJobDetailsMap] = useState({});
  const [loadingDetailId, setLoadingDetailId] = useState(null);

  const buttonRef = useRef(null);
  const dragStateRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  // Extract current projectId from query string or /project/:id path
  const currentProjectId = useMemo(() => {
    const queryProjectId = new URLSearchParams(location.search).get("projectId");
    if (queryProjectId) return queryProjectId;
    const match = location.pathname.match(/^\/project\/([^/]+)/);
    return match ? match[1] : null;
  }, [location.pathname, location.search]);

  const hiddenRoute = !hasToken || isPublicRoute(location.pathname);

  // Sync auth & floating visibility events across tabs and Settings
  useEffect(() => {
    const syncAuth = () => setHasToken(Boolean(getAccessToken()));
    const syncVisibility = (e) => {
      const next = typeof e?.detail?.visible === "boolean" ? e.detail.visible : isFloatingJobQueueVisible();
      setVisible(next);
      if (!next) setIsOpen(false);
    };
    const handleOpenEvent = (e) => {
      setVisible(true);
      setIsOpen(true);
      if (e?.detail?.domain) {
        setDomainFilter(e.detail.domain);
      }
    };
    const handleStorage = (e) => {
      if (e.key === "token" || e.key === "user" || e.key === null) syncAuth();
      if (e.key === "covai_floating_job_queue_visible") syncVisibility({});
    };

    window.addEventListener("covai:auth-change", syncAuth);
    window.addEventListener("covai:token-refreshed", syncAuth);
    window.addEventListener(FLOATING_QUEUE_VISIBILITY_EVENT, syncVisibility);
    window.addEventListener(FLOATING_QUEUE_OPEN_EVENT, handleOpenEvent);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("covai:auth-change", syncAuth);
      window.removeEventListener("covai:token-refreshed", syncAuth);
      window.removeEventListener(FLOATING_QUEUE_VISIBILITY_EVENT, syncVisibility);
      window.removeEventListener(FLOATING_QUEUE_OPEN_EVENT, handleOpenEvent);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // Re-check auth asynchronously whenever route changes
  useEffect(() => {
    const id = setTimeout(() => {
      setHasToken(Boolean(getAccessToken()));
    }, 0);
    return () => clearTimeout(id);
  }, [location.pathname, location.search]);

  // Keep button clamped inside viewport when window resizes
  useEffect(() => {
    const handleResize = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      setPosition((prev) => clampFloatingPos(prev, rect?.width || 196, rect?.height || 42));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const fetchJobs = useCallback(
    async (silent = false) => {
      if (hiddenRoute || (!visible && !isOpen)) return;
      if (!silent) setLoading(true);
      try {
        let rows = [];
        if (currentProjectId) {
          try {
            const res = await getProjectJobsApi(currentProjectId);
            rows = res?.jobs || [];
          } catch (projErr) {
            console.warn("[FloatingJobQueue] Project jobs fetch failed, falling back to user jobs:", projErr?.message);
            const userRes = await getUserJobsApi();
            rows = (userRes?.jobs || []).filter((j) => j.projectId === currentProjectId);
          }
        } else {
          const userRes = await getUserJobsApi();
          rows = userRes?.jobs || [];
        }
        setJobs(rows);
        setError(null);
      } catch (err) {
        console.error("[FloatingJobQueue] Failed to load job queue:", err);
        setError(err?.message || "Unable to fetch job queue");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [currentProjectId, hiddenRoute, visible, isOpen],
  );

  // Initial fetch & adaptive polling
  const activeCount = useMemo(
    () => jobs.filter((job) => ACTIVE_STATUSES.has(job.status)).length,
    [jobs],
  );

  useEffect(() => {
    if (hiddenRoute || (!visible && !isOpen)) return undefined;
    const initialTimer = setTimeout(() => {
      fetchJobs(false);
    }, 0);
    const intervalMs = isOpen || activeCount > 0 ? 4000 : 18000;
    const timer = setInterval(() => {
      fetchJobs(true);
    }, intervalMs);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [hiddenRoute, visible, isOpen, activeCount, fetchJobs]);

  // Global pointer drag handling
  const handlePointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target.closest("[data-hide-floating-queue='true']")) return;
    e.preventDefault();
    dragStateRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      originX: position.x,
      originY: position.y,
    };

    const handlePointerMove = (moveEvent) => {
      const state = dragStateRef.current;
      if (!state.active) return;
      const dx = moveEvent.clientX - state.startX;
      const dy = moveEvent.clientY - state.startY;
      if (!state.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        state.moved = true;
        setIsDragging(true);
      }
      if (state.moved) {
        const rect = buttonRef.current?.getBoundingClientRect();
        const clamped = clampFloatingPos(
          { x: state.originX + dx, y: state.originY + dy },
          rect?.width || 196,
          rect?.height || 42,
        );
        setPosition(clamped);
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      const state = dragStateRef.current;
      dragStateRef.current.active = false;
      setIsDragging(false);

      if (state.moved) {
        setPosition((latest) => {
          saveFloatingJobQueuePos(latest);
          return latest;
        });
      } else {
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const handleHideFloatingButton = (e) => {
    e.stopPropagation();
    setFloatingJobQueueVisible(false);
    setVisible(false);
    setIsOpen(false);
    showToast({
      type: "info",
      title: "Job Queue Hidden",
      message: "Re-enable the floating Job Queue anytime in Settings → Appearance.",
    });
  };

  const handleCancelJob = async (jobId) => {
    try {
      setCancelingId(jobId);
      await cancelJobApi(jobId);
      await fetchJobs(true);
    } catch (err) {
      console.error("[FloatingJobQueue] Cancel job failed:", err);
      showToast({
        type: "error",
        title: "Cancel Failed",
        message: err?.message || "Could not cancel job",
      });
    } finally {
      setCancelingId(null);
    }
  };

  const handleToggleDetails = async (job) => {
    if (expandedJobId === job.id) {
      setExpandedJobId(null);
      return;
    }
    setExpandedJobId(job.id);
    if (!jobDetailsMap[job.id] || ACTIVE_STATUSES.has(job.status)) {
      setLoadingDetailId(job.id);
      try {
        const res = await getJobDetailApi(job.id, { summary: true, includeLogs: true });
        if (res?.job) {
          setJobDetailsMap((prev) => ({ ...prev, [job.id]: res.job }));
        }
      } catch (err) {
        console.warn("[FloatingJobQueue] Could not load job logs:", err?.message);
      } finally {
        setLoadingDetailId(null);
      }
    }
  };

  const stats = useMemo(() => {
    const domainCounts = { all: jobs.length, import: 0, unit: 0, integration: 0, system: 0, ai_eval: 0 };
    let active = 0;
    let completed = 0;
    let failed = 0;
    let canceled = 0;

    for (const job of jobs) {
      const meta = getJobTypeMeta(job.type);
      if (domainCounts[meta.domain] !== undefined) {
        domainCounts[meta.domain] += 1;
      }
      if (ACTIVE_STATUSES.has(job.status)) active += 1;
      else if (job.status === "SUCCESS") completed += 1;
      else if (job.status === "FAILED") failed += 1;
      else if (job.status === "CANCELED") canceled += 1;
    }

    return { domainCounts, active, completed, failed, canceled };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return jobs.filter((job) => {
      const meta = getJobTypeMeta(job.type);
      if (domainFilter !== "all" && meta.domain !== domainFilter) return false;
      if (statusFilter === "ACTIVE" && !ACTIVE_STATUSES.has(job.status)) return false;
      if (statusFilter === "COMPLETED" && job.status !== "SUCCESS") return false;
      if (statusFilter === "FAILED" && job.status !== "FAILED") return false;
      if (!needle) return true;
      return (
        meta.label.toLowerCase().includes(needle) ||
        String(job.type || "").toLowerCase().includes(needle) ||
        String(job.project?.name || "").toLowerCase().includes(needle) ||
        String(job.id || "").toLowerCase().includes(needle)
      );
    });
  }, [jobs, domainFilter, statusFilter, searchQuery]);

  if (hiddenRoute) return null;

  return (
    <>
      {visible && (
        <div
          ref={buttonRef}
          onPointerDown={handlePointerDown}
          style={{ left: position.x, top: position.y }}
          role="button"
          tabIndex={0}
          aria-label="Open unified project Job Queue"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsOpen((prev) => !prev);
            }
          }}
          className={`fixed z-[70] flex items-center gap-2 rounded-lg border px-2.5 py-2 select-none shadow-lg transition-colors duration-150 ${
            isDragging ? "cursor-grabbing border-[var(--color-border-strong)]" : "cursor-grab border-[var(--color-border-strong)] hover:border-[var(--color-text-muted)]"
          } bg-[var(--color-surface)] text-[var(--color-text)]`}
          title="Drag to move · Click to open Job Queue"
        >
          <GripVertical size={14} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />

          {activeCount > 0 ? (
            <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-text)] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-text)]" />
            </span>
          ) : (
            <ListOrdered size={14} className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
          )}

          <span className="text-xs font-semibold whitespace-nowrap">
            {activeCount > 0 ? "Jobs Active" : "Job Queue"}
          </span>

          <span
            className={`rounded-md px-1.5 py-0.5 text-[11px] font-mono font-semibold tabular-nums ${
              activeCount > 0
                ? "bg-[var(--color-text)] text-[var(--color-bg)] border border-transparent"
                : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
            }`}
          >
            {activeCount > 0 ? activeCount : jobs.length}
          </span>

          <button
            type="button"
            data-hide-floating-queue="true"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleHideFloatingButton}
            className="ml-0.5 rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors duration-150"
            title="Hide floating Job Queue button (re-enable in Settings → Appearance)"
            aria-label="Hide floating Job Queue button"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="unified-job-queue-title"
            className="flex h-[min(86vh,740px)] w-[min(96vw,980px)] flex-col overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg)] text-[var(--color-text)] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]">
                  <ListOrdered size={14} />
                </div>
                <div className="min-w-0">
                  <h2 id="unified-job-queue-title" className="text-[13px] font-semibold leading-tight truncate">
                    {currentProjectId ? "Project Job Queue" : "All Projects Job Queue"}
                  </h2>
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 truncate">
                    Background execution history across Import, Unit, Integration, System, and AI Evaluation
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => fetchJobs(false)}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)] cursor-pointer transition-colors duration-150 active:scale-[0.98] disabled:opacity-50"
                >
                  <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close Job Queue"
                  className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors duration-150"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Compact Flush Stat Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--color-border)] border-b border-[var(--color-border)] bg-[var(--color-bg)]">
              <div className="flex items-center justify-between px-5 py-2">
                <span className="text-[11px] text-[var(--color-text-muted)]">Running / Queued</span>
                <span className="text-xs font-semibold font-mono tabular-nums text-[var(--color-text)]">{stats.active}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-2">
                <span className="text-[11px] text-[var(--color-text-muted)]">Completed</span>
                <span className="text-xs font-semibold font-mono tabular-nums text-[var(--color-text)]">{stats.completed}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-2">
                <span className="text-[11px] text-[var(--color-text-muted)]">Failed</span>
                <span className={`text-xs font-semibold font-mono tabular-nums ${stats.failed > 0 ? "text-rose-300/90" : "text-[var(--color-text-secondary)]"}`}>
                  {stats.failed}
                </span>
              </div>
              <div className="flex items-center justify-between px-5 py-2">
                <span className="text-[11px] text-[var(--color-text-muted)]">Total</span>
                <span className="text-xs font-semibold font-mono tabular-nums text-[var(--color-text)]">{jobs.length}</span>
              </div>
            </div>

            {/* Domain Underline Tabs */}
            <div className="flex items-center gap-5 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5">
              {JOB_DOMAIN_TABS.map((tab) => {
                const count = stats.domainCounts[tab.id] ?? 0;
                const isActive = domainFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDomainFilter(tab.id)}
                    className={`inline-flex items-center gap-1.5 border-b-2 py-2.5 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors duration-150 ${
                      isActive
                        ? "border-[var(--color-text)] text-[var(--color-text)]"
                        : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`text-[11px] font-mono tabular-nums ${isActive ? "text-[var(--color-text-secondary)]" : "text-[var(--color-text-muted)]/70"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Secondary Filter Toolbar: Status Segmented Control + Search */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-2.5">
              <div className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
                {[
                  { id: "ALL", label: "All" },
                  { id: "ACTIVE", label: "Active" },
                  { id: "COMPLETED", label: "Completed" },
                  { id: "FAILED", label: "Failed" },
                ].map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setStatusFilter(st.id)}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-colors duration-150 ${
                      statusFilter === st.id
                        ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)]"
                        : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 h-7 w-full sm:w-64 focus-within:border-[var(--color-border-strong)]">
                <Search size={12} className="shrink-0 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by task, type, ID..."
                  className="w-full bg-transparent text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                    aria-label="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Jobs List Body — Flat Divided Rows */}
            <div className="flex-1 overflow-y-auto bg-[var(--color-bg)] divide-y divide-[var(--color-border)]">
              {error && (
                <div className="m-4 flex items-center gap-2 rounded-md border border-rose-500/20 bg-rose-500/[0.04] px-3.5 py-2.5 text-xs text-rose-300/85">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {loading && jobs.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-xs text-[var(--color-text-muted)] gap-2">
                  <Loader2 size={15} className="animate-spin text-[var(--color-text-secondary)]" />
                  <span>Loading job queue...</span>
                </div>
              ) : filteredJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <ListOrdered size={22} className="mb-2 text-[var(--color-text-muted)]" />
                  <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                    No tasks match the current filter
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                    Queued or completed jobs from Import, Unit, Integration, System, and Chatbot Evaluation appear here.
                  </p>
                </div>
              ) : (
                filteredJobs.map((job) => {
                  const meta = getJobTypeMeta(job.type);
                  const domainBadge = JOB_DOMAIN_BADGES[meta.domain] || JOB_DOMAIN_BADGES.import;
                  const statusCfg = STATUS_BADGE[job.status] || STATUS_BADGE.QUEUED;
                  const StatusIcon = statusCfg.icon;
                  const isActive = ACTIVE_STATUSES.has(job.status);
                  const progressPct = Math.min(
                    100,
                    Math.max(0, Number(job.progress ?? (job.status === "SUCCESS" ? 100 : 0))),
                  );
                  const isExpanded = expandedJobId === job.id;
                  const detail = jobDetailsMap[job.id];
                  const errText = job.errorMessage || job.error || detail?.errorMessage;

                  return (
                    <div
                      key={job.id}
                      className={`px-5 py-3.5 transition-colors duration-150 ${
                        isExpanded ? "bg-[var(--color-surface)]" : "bg-[var(--color-bg)] hover:bg-[var(--color-surface)]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        {/* Left: Status icon + Title + Meta */}
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className="mt-0.5 shrink-0">
                            <StatusIcon
                              size={15}
                              className={`${statusCfg.iconClass} ${job.status === "RUNNING" ? "animate-spin" : ""}`}
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-medium text-[var(--color-text)]">
                                {meta.label}
                              </span>
                              <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-1.5 py-0.2 text-[10px] font-medium text-[var(--color-text-secondary)]">
                                {domainBadge.label}
                              </span>
                              <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
                                #{String(job.id).slice(0, 8)}
                              </span>
                              {job.project?.name && !currentProjectId && (
                                <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.2 text-[10px] font-mono text-[var(--color-text-secondary)]">
                                  {job.project.name}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-[var(--color-text-muted)] truncate">
                              {meta.description}
                            </p>
                          </div>
                        </div>

                        {/* Right: Timing + Status + Actions */}
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono tabular-nums text-[var(--color-text-muted)]">
                            <span>{formatTimeAgo(job.createdAt)}</span>
                            <span className="opacity-40">·</span>
                            <span>{formatDuration(job)}</span>
                          </div>

                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${statusCfg.textClass}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dotClass}`} />
                            <span>{statusCfg.label}</span>
                          </span>

                          {isActive && (
                            <button
                              type="button"
                              onClick={() => handleCancelJob(job.id)}
                              disabled={cancelingId === job.id}
                              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] font-medium text-rose-400/85 hover:bg-rose-500/10 hover:border-rose-500/25 disabled:opacity-50 cursor-pointer transition-colors duration-150"
                            >
                              {cancelingId === job.id ? "Canceling..." : "Cancel"}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleToggleDetails(job)}
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium cursor-pointer transition-colors duration-150 ${
                              isExpanded
                                ? "border-[var(--color-border-strong)] bg-[var(--color-surface-secondary)] text-[var(--color-text)]"
                                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
                            }`}
                          >
                            <Terminal size={11} />
                            <span>Logs</span>
                            {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                          </button>
                        </div>
                      </div>

                      {/* Mobile timing line */}
                      <div className="mt-1.5 pl-7 flex sm:hidden items-center gap-2 text-[11px] font-mono tabular-nums text-[var(--color-text-muted)]">
                        <span>{formatTimeAgo(job.createdAt)}</span>
                        <span className="opacity-40">·</span>
                        <span>{formatDuration(job)}</span>
                      </div>

                      {isActive && (
                        <div className="mt-2.5 pl-7 flex items-center gap-2.5">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-secondary)]">
                            <div
                              className="h-full bg-[var(--color-text)] transition-all duration-300"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono tabular-nums text-[var(--color-text-secondary)]">
                            {progressPct}%
                          </span>
                        </div>
                      )}

                      {errText && !isExpanded && (
                        <div className="mt-2 ml-7 rounded-md border border-rose-500/20 bg-rose-500/[0.04] px-2.5 py-1.5 text-[11px] text-rose-300/85 truncate">
                          {errText}
                        </div>
                      )}

                      {isExpanded && (
                        <div className="mt-3 ml-7 space-y-2">
                          {errText && (
                            <div className="rounded-md border border-rose-500/20 bg-rose-500/[0.04] px-3 py-2 text-[11px] font-mono text-rose-300/85 whitespace-pre-wrap break-words">
                              {errText}
                            </div>
                          )}
                          <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]">
                            <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-1.5 text-[11px] text-[var(--color-text-muted)]">
                              <span className="font-medium text-[var(--color-text-secondary)]">Execution Logs</span>
                              <div className="flex items-center gap-2 font-mono tabular-nums">
                                {loadingDetailId === job.id ? (
                                  <span className="inline-flex items-center gap-1 text-[var(--color-text-secondary)]">
                                    <Loader2 size={10} className="animate-spin" /> Loading...
                                  </span>
                                ) : (
                                  <span>{detail?.logs?.length || 0} lines</span>
                                )}
                              </div>
                            </div>
                            {detail?.logs?.length ? (
                              <div className="max-h-52 overflow-y-auto px-3 py-2 space-y-1 font-mono text-[11px] leading-relaxed">
                                {[...detail.logs].reverse().map((entry) => (
                                  <div key={entry.id} className="flex items-start gap-3">
                                    <span className="w-20 shrink-0 text-[var(--color-text-muted)] tabular-nums select-none">
                                      {new Date(entry.createdAt).toLocaleTimeString()}
                                    </span>
                                    <span
                                      className={`min-w-0 flex-1 break-words ${
                                        entry.level === "ERROR"
                                          ? "text-rose-400/85"
                                          : "text-[var(--color-text-secondary)]"
                                      }`}
                                    >
                                      {entry.message}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="px-3 py-2.5 text-[11px] text-[var(--color-text-muted)] font-mono">
                                {loadingDetailId === job.id
                                  ? "Fetching logs..."
                                  : "No recorded execution log lines for this job."}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
