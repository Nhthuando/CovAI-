import { useEffect, useState, useMemo } from "react";
import {
  Clock,
  History,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  Zap,
  PlayCircle,
  ArrowRight,
  Filter,
  Eye,
  FileCode,
  Layers,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  X,
  Code,
  GitCompare,
  Database,
  ShieldCheck,
  Terminal,
  ExternalLink
} from "lucide-react";
import {
  getIntegrationVersionHistory,
  getHistoricalWorkspaceVersion,
  compareIntegrationVersions
} from "../../../services/integrationVersionHistory.service.js";

const STATUS_BADGE = {
  SUCCESS: "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30",
  PASSED: "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30",
  FAILED: "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30",
  CANCELED: "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30",
  CANCELLED: "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30",
  RUNNING: "bg-[var(--color-info)]/10 text-[var(--color-info)] border-[var(--color-info)]/30",
  QUEUED: "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30"
};

const OP_ICONS = {
  ANALYZE: Search,
  GENERATE: Zap,
  RUN_TESTS: PlayCircle
};

const METHOD_BADGES = {
  GET: "bg-[var(--color-info)]/10 text-[var(--color-info)] border-[var(--color-info)]/30",
  POST: "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30",
  PUT: "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30",
  PATCH: "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30",
  DELETE: "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30"
};

export default function IntegrationHistoryPane({ snapshotId, onOpenComparison }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [selectedOp, setSelectedOp] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Transition tracking drawer
  const [showTransitions, setShowTransitions] = useState(false);
  const [activeDiffTab, setActiveDiffTab] = useState("ANALYZE");

  // Historical Version Artifact Inspector Modal
  const [previewVersion, setPreviewVersion] = useState(null);
  const [inspectorFilter, setInspectorFilter] = useState("");

  const fetchHistory = async (isManualRefresh = false) => {
    if (!snapshotId) return;
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await getIntegrationVersionHistory(snapshotId);
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.message || "Failed to load version history.");
      }
    } catch (err) {
      setError(err.message || "Network error loading history.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [snapshotId]);

  const handleOpenHistoricalPreview = async (item) => {
    setInspectorFilter("");
    setPreviewVersion({
      opType: item.opType,
      id: item.id,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      durationMs: item.durationMs,
      status: item.status,
      revision: item.revision || snapshotId,
      loading: true,
      data: null,
      error: null,
      source: null,
      isReadOnly: true
    });

    try {
      const res = await getHistoricalWorkspaceVersion(snapshotId, item.id, item.opType);
      if (res.success && res.data) {
        setPreviewVersion((prev) => ({
          ...prev,
          loading: false,
          data: res.data.data,
          artifactTimestamp: res.data.timestamp,
          source: res.data.source || "ARCHIVED_ARTIFACT",
          isReadOnly: true,
          jobMetadata: res.data.jobMetadata || null
        }));
      } else {
        setPreviewVersion((prev) => ({
          ...prev,
          loading: false,
          error: res.message || "Could not retrieve historical artifact."
        }));
      }
    } catch (err) {
      setPreviewVersion((prev) => ({
        ...prev,
        loading: false,
        error: err.message || "Failed to fetch historical artifact."
      }));
    }
  };

  // Filtered timeline
  const filteredTimeline = useMemo(() => {
    if (!data?.timeline) return [];
    return data.timeline.filter((item) => {
      if (selectedOp !== "ALL" && item.opType !== selectedOp) return false;
      if (selectedStatus !== "ALL") {
        if (selectedStatus === "SUCCESS" && !["SUCCESS", "PASSED"].includes(item.status)) return false;
        if (selectedStatus === "FAILED" && item.status !== "FAILED") return false;
        if (selectedStatus === "CANCELED" && !["CANCELED", "CANCELLED"].includes(item.status)) return false;
        if (selectedStatus === "RUNNING" && !["RUNNING", "QUEUED"].includes(item.status)) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = item.id.toLowerCase().includes(q);
        const matchesOp = item.opType.toLowerCase().includes(q);
        const matchesStatus = item.status.toLowerCase().includes(q);
        if (!matchesId && !matchesOp && !matchesStatus) return false;
      }
      return true;
    });
  }, [data?.timeline, selectedOp, selectedStatus, searchQuery]);

  // Format duration helper
  const formatDuration = (ms) => {
    if (ms == null) return "Not recorded";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Format date helper
  const formatDate = (dateStr) => {
    if (!dateStr) return "Not recorded";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return "Not recorded";
      return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
    } catch (_) {
      return "Not recorded";
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-12 text-center text-xs text-[var(--color-text-secondary)] font-sans">
        <RefreshCw size={24} className="animate-spin text-[var(--color-primary)] mb-3" />
        <span>Loading Version History & Provenance...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-8 text-center text-xs text-[var(--color-danger)] font-sans flex flex-col items-center justify-center gap-3">
        <AlertCircle size={28} />
        <p>{error}</p>
        <button
          onClick={() => fetchHistory(true)}
          className="px-3 py-1.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)] text-xs font-semibold cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const counters = data?.counters || {
    analyze: { total: 0, success: 0, failed: 0, canceled: 0, running: 0 },
    generate: { total: 0, success: 0, failed: 0, canceled: 0, running: 0 },
    runTests: { total: 0, success: 0, failed: 0, canceled: 0, running: 0 }
  };

  const currentVersions = data?.currentVersions || {};
  const diffs = data?.diffs || {};
  const analyzeDiff = diffs.analyze;
  const generateDiff = diffs.generate;
  const runTestsDiff = diffs.runTests;

  // Has any transition tracking data
  const hasTransitionData = Boolean(analyzeDiff || generateDiff || runTestsDiff);

  return (
    <div className="flex flex-col h-full font-sans text-[var(--color-text)] overflow-hidden bg-[var(--color-bg)]">
      {/* 1. Header with Snapshot Info & Refresh */}
      <div className="px-6 py-3.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] flex items-center justify-center font-bold">
            <History size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[var(--color-text)]">
                Version History
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                Provenance & Immutable Artifacts
              </span>
            </div>
            <p className="text-[11px] text-[var(--color-text-secondary)] font-mono mt-0.5">
              Snapshot: <span className="text-[var(--color-text)] font-semibold">{snapshotId ? snapshotId.substring(0, 10) : "Not recorded"}</span>
              {data?.commitSha ? (
                <span> • Git: <strong className="text-[var(--color-text)]">{data.commitSha.substring(0, 7)}</strong></span>
              ) : (
                <span> • Git: <span className="text-[var(--color-text-muted)]">Not recorded</span></span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onOpenComparison && (
            <button
              onClick={onOpenComparison}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              title="Open Before / After Comparison Workspace"
            >
              <GitCompare size={13} />
              <span>Before / After View</span>
            </button>
          )}

          <button
            onClick={() => fetchHistory(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50 cursor-pointer"
            title="Reconcile latest counters and history from database"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin text-[var(--color-primary)]" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
        {/* 2. Streamlined Operation Summary (Analyze, Generate, Run Tests) */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              Operation Summary
            </h4>
            <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
              Reconciled strictly from database records
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Analyze Summary Column */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Search size={14} className="text-[var(--color-text)]" />
                  <span className="text-xs font-bold text-[var(--color-text)]">Analyze</span>
                </div>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]">
                  {counters.analyze.total} total
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 py-2 border-y border-[var(--color-border)] text-center font-mono">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase text-[var(--color-text-muted)]">Success</span>
                  <span className="font-bold text-xs text-[var(--color-success)]">{counters.analyze.success}</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase text-[var(--color-text-muted)]">Failed</span>
                  <span className={`font-bold text-xs ${counters.analyze.failed > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}>{counters.analyze.failed}</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase text-[var(--color-text-muted)]">Canceled</span>
                  <span className={`font-bold text-xs ${counters.analyze.canceled > 0 ? "text-[var(--color-warning)]" : "text-[var(--color-text-muted)]"}`}>{counters.analyze.canceled}</span>
                </div>
              </div>

              <div className="text-[11px] font-mono text-[var(--color-text-muted)] pt-2 flex items-center justify-between">
                <span>Active Version:</span>
                <span className="text-[var(--color-text)] font-semibold">
                  {currentVersions.analyze ? `#${currentVersions.analyze.jobId.substring(0, 8)}` : "None"}
                </span>
              </div>
            </div>

            {/* Generate Summary Column */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-[var(--color-text)]" />
                  <span className="text-xs font-bold text-[var(--color-text)]">Generate</span>
                </div>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]">
                  {counters.generate.total} total
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 py-2 border-y border-[var(--color-border)] text-center font-mono">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase text-[var(--color-text-muted)]">Success</span>
                  <span className="font-bold text-xs text-[var(--color-success)]">{counters.generate.success}</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase text-[var(--color-text-muted)]">Failed</span>
                  <span className={`font-bold text-xs ${counters.generate.failed > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}>{counters.generate.failed}</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase text-[var(--color-text-muted)]">Canceled</span>
                  <span className={`font-bold text-xs ${counters.generate.canceled > 0 ? "text-[var(--color-warning)]" : "text-[var(--color-text-muted)]"}`}>{counters.generate.canceled}</span>
                </div>
              </div>

              <div className="text-[11px] font-mono text-[var(--color-text-muted)] pt-2 flex items-center justify-between">
                <span>Active Version:</span>
                <span className="text-[var(--color-text)] font-semibold">
                  {currentVersions.generate ? `#${currentVersions.generate.jobId.substring(0, 8)}` : "None"}
                </span>
              </div>
            </div>

            {/* Run Tests Summary Column */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3.5 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <PlayCircle size={14} className="text-[var(--color-text)]" />
                  <span className="text-xs font-bold text-[var(--color-text)]">Run Tests</span>
                </div>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]">
                  {counters.runTests.total} total
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 py-2 border-y border-[var(--color-border)] text-center font-mono">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase text-[var(--color-text-muted)]">Passed</span>
                  <span className="font-bold text-xs text-[var(--color-success)]">{counters.runTests.success}</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase text-[var(--color-text-muted)]">Failed</span>
                  <span className={`font-bold text-xs ${counters.runTests.failed > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}>{counters.runTests.failed}</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase text-[var(--color-text-muted)]">Canceled</span>
                  <span className={`font-bold text-xs ${counters.runTests.canceled > 0 ? "text-[var(--color-warning)]" : "text-[var(--color-text-muted)]"}`}>{counters.runTests.canceled}</span>
                </div>
              </div>

              <div className="text-[11px] font-mono text-[var(--color-text-muted)] pt-2 flex items-center justify-between">
                <span>Active Run:</span>
                <span className="text-[var(--color-text)] font-semibold">
                  {currentVersions.testRun ? `#${currentVersions.testRun.testRunId.substring(0, 8)}` : "None"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Compact Automated Transition Tracking Drawer (Previous vs Current) */}
        {hasTransitionData && (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden">
            <div className="px-4 py-2.5 flex items-center justify-between gap-3 bg-[var(--color-surface-secondary)]/50">
              <div className="flex items-center gap-2.5">
                <GitCompare size={14} className="text-[var(--color-text-secondary)]" />
                <span className="text-xs font-bold text-[var(--color-text)]">
                  Automated Transition Tracking
                </span>
                <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                  (Latest Completed vs Previous Completed)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowTransitions(!showTransitions)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                >
                  {showTransitions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  <span>{showTransitions ? "Hide Details" : "Show Details"}</span>
                </button>
              </div>
            </div>

            {/* Quick summary strip when collapsed */}
            {!showTransitions && (
              <div className="px-4 py-2 flex flex-wrap items-center justify-between text-xs font-mono text-[var(--color-text-secondary)] gap-2">
                <div className="flex items-center gap-4">
                  {analyzeDiff?.summary && (
                    <span>
                      Endpoints: <strong className="text-[var(--color-success)]">+{analyzeDiff.summary.newCount || 0}</strong> / <strong className="text-[var(--color-warning)]">~{analyzeDiff.summary.changedCount || 0}</strong> / <strong className="text-[var(--color-danger)]">-{analyzeDiff.summary.removedCount || 0}</strong>
                    </span>
                  )}
                  {generateDiff?.summary?.tests && (
                    <span>
                      Scenarios: <strong className="text-[var(--color-success)]">+{generateDiff.summary.tests.newCount || 0}</strong> / <strong className="text-[var(--color-warning)]">~{generateDiff.summary.tests.modifiedCount || 0}</strong>
                    </span>
                  )}
                  {runTestsDiff?.summary && (
                    <span>
                      Run Regressions: <strong className={runTestsDiff.summary.regressionsCount > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}>{runTestsDiff.summary.regressionsCount || 0}</strong> • Fixes: <strong className="text-[var(--color-success)]">{runTestsDiff.summary.fixesCount || 0}</strong>
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  Expand details for field-level diffs
                </span>
              </div>
            )}

            {/* Expanded Transition Tabs & Content */}
            {showTransitions && (
              <div className="p-4 border-t border-[var(--color-border)]">
                <div className="flex items-center gap-1 mb-4 bg-[var(--color-bg)] p-1 rounded border border-[var(--color-border)] w-fit">
                  <button
                    onClick={() => setActiveDiffTab("ANALYZE")}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                      activeDiffTab === "ANALYZE"
                        ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    Endpoints ({analyzeDiff?.summary?.totalCurrent || 0})
                  </button>
                  <button
                    onClick={() => setActiveDiffTab("GENERATE")}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                      activeDiffTab === "GENERATE"
                        ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    Test Cases ({generateDiff?.summary?.tests?.currentTotal || 0})
                  </button>
                  <button
                    onClick={() => setActiveDiffTab("RUN_TESTS")}
                    className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                      activeDiffTab === "RUN_TESTS"
                        ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    Run Transitions ({runTestsDiff?.summary?.totalCompared || 0})
                  </button>
                </div>

                {activeDiffTab === "ANALYZE" && (
                  <div>
                    {analyzeDiff ? (
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-3 font-mono text-xs">
                          <span className="px-2 py-0.5 rounded bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/30 font-semibold">
                            NEW: {analyzeDiff.summary?.newCount || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/30 font-semibold">
                            CHANGED: {analyzeDiff.summary?.changedCount || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-semibold">
                            UNCHANGED: {analyzeDiff.summary?.unchangedCount || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30 font-semibold">
                            REMOVED: {analyzeDiff.summary?.removedCount || 0}
                          </span>
                        </div>

                        <div className="max-h-60 overflow-y-auto border border-[var(--color-border)] rounded divide-y divide-[var(--color-border)]">
                          {analyzeDiff.endpoints?.length > 0 ? (
                            analyzeDiff.endpoints.map((ep, idx) => (
                              <div key={idx} className="p-2 hover:bg-[var(--color-surface-secondary)]/40 transition-colors flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 font-mono">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                    ep.diffStatus === "NEW" ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30" :
                                    ep.diffStatus === "CHANGED" ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30" :
                                    ep.diffStatus === "REMOVED" ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30" :
                                    "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                                  }`}>
                                    {ep.diffStatus}
                                  </span>
                                  <span className="font-semibold text-[var(--color-text)]">
                                    {ep.method} {ep.path}
                                  </span>
                                </div>
                                <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                                  {ep.sourceFile || "Declared route"}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="p-3 text-center text-xs text-[var(--color-text-muted)]">
                              No endpoint differences recorded.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-xs text-[var(--color-text-muted)]">
                        Requires at least two completed Analyze sessions to track endpoint transitions.
                      </div>
                    )}
                  </div>
                )}

                {activeDiffTab === "GENERATE" && (
                  <div>
                    {generateDiff ? (
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-3 font-mono text-xs">
                          <span className="px-2 py-0.5 rounded bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/30 font-semibold">
                            NEW SCENARIOS: +{generateDiff.summary?.tests?.newCount || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/30 font-semibold">
                            MODIFIED: ~{generateDiff.summary?.tests?.modifiedCount || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30 font-semibold">
                            REMOVED: -{generateDiff.summary?.tests?.removedCount || 0}
                          </span>
                        </div>

                        <div className="max-h-60 overflow-y-auto border border-[var(--color-border)] rounded divide-y divide-[var(--color-border)]">
                          {generateDiff.tests?.length > 0 ? (
                            generateDiff.tests.map((t, idx) => (
                              <div key={idx} className="p-2 hover:bg-[var(--color-surface-secondary)]/40 transition-colors flex items-center justify-between text-xs font-mono">
                                <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                    t.diffStatus === "NEW" ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30" :
                                    t.diffStatus === "MODIFIED" ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30" :
                                    "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                                  }`}>
                                    {t.diffStatus}
                                  </span>
                                  <span className="font-semibold text-[var(--color-text)]">
                                    {t.name || t.title || t.testName || "Integration Scenario"}
                                  </span>
                                </div>
                                <span className="text-[11px] text-[var(--color-text-muted)]">
                                  {t.filePath || ""}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="p-3 text-center text-xs text-[var(--color-text-muted)]">
                              No test scenario differences recorded.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-xs text-[var(--color-text-muted)]">
                        Requires at least two completed Generate sessions to track test suite transitions.
                      </div>
                    )}
                  </div>
                )}

                {activeDiffTab === "RUN_TESTS" && (
                  <div>
                    {runTestsDiff ? (
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-3 font-mono text-xs">
                          <span className="px-2 py-0.5 rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30 font-semibold">
                            REGRESSIONS: {runTestsDiff.summary?.regressionsCount || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/30 font-semibold">
                            FIXES: {runTestsDiff.summary?.fixesCount || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-semibold">
                            CONSISTENT PASS: {runTestsDiff.summary?.passToPassCount || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-semibold">
                            COVERAGE DELTA: {runTestsDiff.summary?.coverageDelta != null ? `${runTestsDiff.summary.coverageDelta > 0 ? "+" : ""}${runTestsDiff.summary.coverageDelta.toFixed(1)}%` : "Not recorded"}
                          </span>
                        </div>

                        <div className="max-h-60 overflow-y-auto border border-[var(--color-border)] rounded divide-y divide-[var(--color-border)]">
                          {runTestsDiff.transitions?.length > 0 ? (
                            runTestsDiff.transitions.map((tr, idx) => {
                              const isRegression = tr.statusA === "PASSED" && tr.statusB === "FAILED";
                              const isFix = tr.statusA === "FAILED" && tr.statusB === "PASSED";
                              return (
                                <div key={idx} className="p-2 hover:bg-[var(--color-surface-secondary)]/40 transition-colors flex items-center justify-between text-xs font-mono">
                                  <div className="flex items-center gap-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                      isRegression ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30" :
                                      isFix ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30" :
                                      "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                                    }`}>
                                      {tr.statusA || "UNRUN"} → {tr.statusB || "UNRUN"}
                                    </span>
                                    <span className="font-semibold text-[var(--color-text)]">
                                      {tr.testName}
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-[var(--color-text-muted)]">
                                    {tr.durationMs ? `${tr.durationMs}ms` : ""}
                                  </span>
                                </div>
                              );
                            })
                          ) : (
                            <div className="p-3 text-center text-xs text-[var(--color-text-muted)]">
                              No test transitions recorded.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-xs text-[var(--color-text-muted)]">
                        Requires at least two completed TestRun executions to track run transitions.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 4. Activity Timeline with Compact Chronological List */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                Activity Timeline
              </h4>
              <span className="text-xs font-mono text-[var(--color-text-muted)]">
                ({filteredTimeline.length} of {data?.timeline?.length || 0} events)
              </span>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Operation type buttons */}
              <div className="flex items-center gap-1 bg-[var(--color-surface)] p-1 rounded border border-[var(--color-border)]">
                {["ALL", "ANALYZE", "GENERATE", "RUN_TESTS"].map((op) => (
                  <button
                    key={op}
                    onClick={() => setSelectedOp(op)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                      selectedOp === op
                        ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {op === "ALL" ? "All Operations" : op}
                  </button>
                ))}
              </div>

              {/* Status filter buttons */}
              <div className="flex items-center gap-1 bg-[var(--color-surface)] p-1 rounded border border-[var(--color-border)]">
                {["ALL", "SUCCESS", "FAILED", "CANCELED", "RUNNING"].map((st) => (
                  <button
                    key={st}
                    onClick={() => setSelectedStatus(st)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                      selectedStatus === st
                        ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {st === "ALL" ? "All Status" : st}
                  </button>
                ))}
              </div>

              {/* Search input */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter events..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-36 px-2 py-1 text-xs rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Chronological List of Operations */}
          <div className="flex flex-col gap-2">
            {filteredTimeline.length > 0 ? (
              filteredTimeline.map((item) => {
                const OpIcon = OP_ICONS[item.opType] || Clock;
                const statusStyle = STATUS_BADGE[item.status] || "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border)]";
                const isCurrent = Boolean(item.isCurrent || item.isLatestSuccess);

                return (
                  <div
                    key={item.id}
                    className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3.5 hover:border-[var(--color-border-strong)] transition-colors flex flex-col gap-2"
                  >
                    {/* Header Row: Operation, ID, Status, Inspect Action */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text)] shrink-0">
                          <OpIcon size={13} />
                        </div>
                        <span className="font-bold text-xs text-[var(--color-text)]">
                          {item.opType}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--color-text-muted)]" title={`Full ID: ${item.id}`}>
                          #{item.id.substring(0, 8)}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                          {item.entityType || "JOB"}
                        </span>
                        {isCurrent && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/30 uppercase font-mono">
                            Current Active
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border font-mono ${statusStyle}`}>
                          {item.status}
                        </span>
                        <button
                          onClick={() => handleOpenHistoricalPreview(item)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-xs font-semibold text-[var(--color-text)] transition-colors cursor-pointer"
                          title="Inspect historical artifact and evidence without altering workspace"
                        >
                          <Eye size={12} />
                          <span>Inspect Version</span>
                        </button>
                      </div>
                    </div>

                    {/* Metadata Details Row */}
                    <div className="flex flex-wrap items-center justify-between text-[11px] text-[var(--color-text-secondary)] font-mono pt-1.5 border-t border-[var(--color-border)] gap-2">
                      <div className="flex items-center gap-3">
                        <span>Started: <strong className="text-[var(--color-text)]">{formatDate(item.startedAt || item.createdAt)}</strong></span>
                        <span>Duration: <strong className="text-[var(--color-text)]">{formatDuration(item.durationMs ?? item.computeTimeMs)}</strong></span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span>
                          Artifacts: <strong className="text-[var(--color-text)]">
                            {item.artifactCount != null ? item.artifactCount : "Not recorded"}
                          </strong>
                        </span>
                        <span>
                          Revision: <strong className="text-[var(--color-text)]" title={item.revision || snapshotId}>
                            {(item.revision || snapshotId).substring(0, 8)}
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* Error banner if recorded */}
                    {item.errorMessage && (
                      <div className="text-[11px] font-mono text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 p-2 rounded">
                        Error: {item.errorMessage}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center text-xs text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)]">
                No activity records matched your filter criteria.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 5. Historical Version Artifact Inspector Modal (Structured & Read-Only) */}
      {previewVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden font-sans">
            {/* Modal Header */}
            <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-secondary)]/60 shrink-0">
              <div className="flex items-center gap-2.5">
                <FileCode size={16} className="text-[var(--color-text)]" />
                <h3 className="text-sm font-bold text-[var(--color-text)]">
                  Artifact Inspector
                </h3>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] font-semibold">
                  {previewVersion.opType} #{previewVersion.id.substring(0, 8)}
                </span>
                <span className="flex items-center gap-1 text-[11px] font-mono text-[var(--color-success)] px-2 py-0.5 rounded bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 font-semibold">
                  <ShieldCheck size={12} />
                  <span>Read-Only Guarantee</span>
                </span>
              </div>
              <button
                onClick={() => setPreviewVersion(null)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1 rounded hover:bg-[var(--color-surface)] cursor-pointer"
                title="Close Inspector"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              {previewVersion.loading ? (
                <div className="flex flex-col items-center justify-center p-12 text-xs text-[var(--color-text-secondary)]">
                  <RefreshCw size={24} className="animate-spin text-[var(--color-primary)] mb-2" />
                  <span>Loading historical artifact evidence...</span>
                </div>
              ) : previewVersion.error ? (
                <div className="p-4 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded text-[var(--color-danger)] text-xs font-mono">
                  {previewVersion.error}
                </div>
              ) : (
                <>
                  {/* Provenance Metadata Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-[var(--color-bg)] p-3 rounded border border-[var(--color-border)]">
                    <div>
                      <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Target Operation ID</div>
                      <div className="text-[var(--color-text)] font-bold mt-0.5" title={previewVersion.id}>
                        #{previewVersion.id.substring(0, 10)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Execution Status</div>
                      <div className="text-[var(--color-text)] font-bold mt-0.5">
                        {previewVersion.status || "COMPLETED"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Duration</div>
                      <div className="text-[var(--color-text)] font-bold mt-0.5">
                        {formatDuration(previewVersion.durationMs || previewVersion.jobMetadata?.durationMs)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Provenance Source</div>
                      <div className="text-[var(--color-text)] font-bold mt-0.5">
                        {previewVersion.source || "Database Record"}
                      </div>
                    </div>
                  </div>

                  {/* Structured Inspection View by Operation */}
                  {/* 1. ANALYZE Endpoints View */}
                  {previewVersion.opType === "ANALYZE" && (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-[var(--color-text)]">
                          Discovered Endpoints Inventory (
                          {Array.isArray(previewVersion.data?.endpoints) ? previewVersion.data.endpoints.length : 0} endpoints)
                        </div>
                        {Array.isArray(previewVersion.data?.endpoints) && previewVersion.data.endpoints.length > 5 && (
                          <input
                            type="text"
                            placeholder="Search endpoints..."
                            value={inspectorFilter}
                            onChange={(e) => setInspectorFilter(e.target.value)}
                            className="px-2 py-1 text-xs rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none"
                          />
                        )}
                      </div>

                      {Array.isArray(previewVersion.data?.endpoints) && previewVersion.data.endpoints.length > 0 ? (
                        <div className="max-h-72 overflow-y-auto border border-[var(--color-border)] rounded divide-y divide-[var(--color-border)]">
                          {previewVersion.data.endpoints
                            .filter((ep) => {
                              if (!inspectorFilter.trim()) return true;
                              const q = inspectorFilter.toLowerCase();
                              return (
                                (ep.path || "").toLowerCase().includes(q) ||
                                (ep.method || "").toLowerCase().includes(q) ||
                                (ep.controllerMethod || "").toLowerCase().includes(q) ||
                                (ep.sourceFile || "").toLowerCase().includes(q)
                              );
                            })
                            .map((ep, idx) => {
                              const methodBadge = METHOD_BADGES[ep.method] || "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border)]";
                              return (
                                <div key={idx} className="p-2.5 hover:bg-[var(--color-surface-secondary)]/30 transition-colors flex flex-col gap-1 text-xs">
                                  <div className="flex items-center justify-between font-mono">
                                    <div className="flex items-center gap-2">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${methodBadge}`}>
                                        {ep.method}
                                      </span>
                                      <span className="font-semibold text-[var(--color-text)]">
                                        {ep.path}
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-[var(--color-text-muted)]">
                                      {ep.sourceFile || ep.controllerFile || "Declared route"}
                                    </span>
                                  </div>
                                  {(ep.controllerMethod || (ep.middlewares && ep.middlewares.length > 0)) && (
                                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[var(--color-text-secondary)] pl-7">
                                      {ep.controllerMethod && (
                                        <span>Handler: <strong className="text-[var(--color-text)]">{ep.controllerMethod}</strong></span>
                                      )}
                                      {ep.middlewares && ep.middlewares.length > 0 && (
                                        <span>• Middlewares: {ep.middlewares.map(m => typeof m === "string" ? m : m.name).join(", ")}</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      ) : (
                        <div className="p-6 text-center text-xs text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded">
                          No endpoints recorded in this artifact.
                        </div>
                      )}
                    </div>
                  )}

                  {/* 2. GENERATE Test Suites View */}
                  {previewVersion.opType === "GENERATE" && (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-[var(--color-text)]">
                          Generated Test Suites (
                          {Array.isArray(previewVersion.data?.tests) ? previewVersion.data.tests.length : (previewVersion.data?.count || 0)} test items)
                        </div>
                        {Array.isArray(previewVersion.data?.tests) && previewVersion.data.tests.length > 5 && (
                          <input
                            type="text"
                            placeholder="Search test scenarios..."
                            value={inspectorFilter}
                            onChange={(e) => setInspectorFilter(e.target.value)}
                            className="px-2 py-1 text-xs rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none"
                          />
                        )}
                      </div>

                      {Array.isArray(previewVersion.data?.tests) && previewVersion.data.tests.length > 0 ? (
                        <div className="max-h-72 overflow-y-auto border border-[var(--color-border)] rounded divide-y divide-[var(--color-border)]">
                          {previewVersion.data.tests
                            .filter((t) => {
                              if (!inspectorFilter.trim()) return true;
                              const q = inspectorFilter.toLowerCase();
                              return (
                                (t.name || t.testName || t.title || "").toLowerCase().includes(q) ||
                                (t.filePath || "").toLowerCase().includes(q)
                              );
                            })
                            .map((t, idx) => (
                              <div key={idx} className="p-2.5 hover:bg-[var(--color-surface-secondary)]/30 transition-colors flex flex-col gap-1 text-xs font-mono">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <FileCode size={13} className="text-[var(--color-text-muted)]" />
                                    <span className="font-semibold text-[var(--color-text)]">
                                      {t.name || t.testName || t.title || "Integration Scenario"}
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-[var(--color-text-muted)]">
                                    {t.filePath || t.targetFile || "test file"}
                                  </span>
                                </div>
                                {t.expectedStatus && (
                                  <div className="text-[11px] text-[var(--color-text-secondary)] pl-5">
                                    Expected Status: <strong className="text-[var(--color-text)]">{t.expectedStatus}</strong>
                                    {t.method && <span className="ml-2">• Method: {t.method}</span>}
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className="p-6 text-center text-xs text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded">
                          No test suites recorded in this artifact.
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. RUN_TESTS Execution & Scenarios View */}
                  {previewVersion.opType === "RUN_TESTS" && (
                    <div className="flex flex-col gap-3">
                      <div className="text-xs font-bold text-[var(--color-text)]">
                        TestRun Execution Results & Scenarios
                      </div>

                      {/* Run verdict summary pills */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs font-mono">
                        <div className="p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
                          <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Total Tests</div>
                          <div className="font-bold text-sm text-[var(--color-text)] mt-0.5">
                            {previewVersion.data?.totalTests ?? previewVersion.data?.scenarios?.length ?? "Not recorded"}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 text-[var(--color-success)]">
                          <div className="text-[10px] uppercase font-semibold">Passed</div>
                          <div className="font-bold text-sm mt-0.5">
                            {previewVersion.data?.passedTests ?? (previewVersion.data?.scenarios?.filter(s => s.status === "PASSED").length) ?? 0}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 text-[var(--color-danger)]">
                          <div className="text-[10px] uppercase font-semibold">Failed</div>
                          <div className="font-bold text-sm mt-0.5">
                            {previewVersion.data?.failedTests ?? (previewVersion.data?.scenarios?.filter(s => s.status === "FAILED").length) ?? 0}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
                          <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Coverage</div>
                          <div className="font-bold text-sm text-[var(--color-text)] mt-0.5">
                            {previewVersion.data?.coveragePct != null ? `${previewVersion.data.coveragePct.toFixed(1)}%` : "Not recorded"}
                          </div>
                        </div>
                      </div>

                      {/* Scenarios breakdown */}
                      {Array.isArray(previewVersion.data?.scenarios) && previewVersion.data.scenarios.length > 0 ? (
                        <div className="max-h-60 overflow-y-auto border border-[var(--color-border)] rounded divide-y divide-[var(--color-border)]">
                          {previewVersion.data.scenarios.map((sc, idx) => {
                            const isPassed = sc.status === "PASSED";
                            const isFailed = sc.status === "FAILED";
                            return (
                              <div key={idx} className="p-2.5 hover:bg-[var(--color-surface-secondary)]/30 transition-colors flex items-center justify-between text-xs font-mono">
                                <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                    isPassed ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30" :
                                    isFailed ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30" :
                                    "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                                  }`}>
                                    {sc.status || "UNRUN"}
                                  </span>
                                  <span className="font-semibold text-[var(--color-text)]">
                                    {sc.testName || sc.title || "Test Scenario"}
                                  </span>
                                </div>
                                <span className="text-[11px] text-[var(--color-text-muted)]">
                                  {sc.durationMs ? `${sc.durationMs}ms` : ""}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-4 text-center text-xs text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded">
                          No scenario breakdown recorded for this test execution.
                        </div>
                      )}
                    </div>
                  )}

                  {/* 4. Collapsible Technical Details & Raw JSON Payload */}
                  <details className="border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)] mt-2">
                    <summary className="px-4 py-2.5 text-xs font-mono font-semibold cursor-pointer select-none text-[var(--color-text-secondary)] hover:text-[var(--color-text)] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Code size={13} />
                        <span>Technical Details & Raw JSON Payload</span>
                      </div>
                      <span className="text-[11px] text-[var(--color-text-muted)] font-normal">Click to expand</span>
                    </summary>
                    <pre className="p-4 bg-[var(--color-bg)] font-mono text-xs text-[var(--color-text)] overflow-x-auto max-h-64 border-t border-[var(--color-border)] leading-relaxed">
                      {JSON.stringify(previewVersion.data, null, 2)}
                    </pre>
                  </details>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-secondary)]/40 shrink-0">
              <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                Inspecting historical records does not alter current workspace state or rerun jobs.
              </span>
              <button
                onClick={() => setPreviewVersion(null)}
                className="px-4 py-1.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
