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
  X,
  Code,
  GitCompare
} from "lucide-react";
import MetricProvenancePopover from "./MetricProvenancePopover.jsx";
import {
  getIntegrationVersionHistory,
  getHistoricalWorkspaceVersion,
  compareIntegrationVersions
} from "../../../services/coverage.service.js";

const STATUS_BADGE = {
  SUCCESS: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  PASSED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  FAILED: "bg-rose-500/10 text-rose-400 border-rose-500/25",
  CANCELED: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  CANCELLED: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  RUNNING: "bg-blue-500/10 text-blue-400 border-blue-500/25 animate-pulse",
  QUEUED: "bg-purple-500/10 text-purple-400 border-purple-500/25"
};

const OP_ICONS = {
  ANALYZE: Search,
  GENERATE: Zap,
  RUN_TESTS: PlayCircle
};

export default function IntegrationHistoryPane({ snapshotId, onSelectHistoricalVersion, onOpenComparison }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [selectedOp, setSelectedOp] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [activeDiffTab, setActiveDiffTab] = useState("ANALYZE");

  // Historical Version Modal Preview
  const [previewVersion, setPreviewVersion] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

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
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewVersion({
      opType: item.opType,
      id: item.id,
      startedAt: item.startedAt,
      status: item.status,
      loading: true,
      data: null
    });

    try {
      const res = await getHistoricalWorkspaceVersion(snapshotId, item.id, item.opType);
      if (res.success && res.data) {
        setPreviewVersion((prev) => ({
          ...prev,
          loading: false,
          data: res.data.data,
          artifactTimestamp: res.data.timestamp
        }));
      } else {
        setPreviewError(res.message || "Could not retrieve historical artifact.");
        setPreviewVersion((prev) => ({ ...prev, loading: false }));
      }
    } catch (err) {
      setPreviewError(err.message || "Failed to fetch historical artifact.");
      setPreviewVersion((prev) => ({ ...prev, loading: false }));
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
      return true;
    });
  }, [data?.timeline, selectedOp, selectedStatus]);

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

  const diffs = data?.diffs || {};
  const analyzeDiff = diffs.analyze;
  const generateDiff = diffs.generate;
  const runTestsDiff = diffs.runTests;

  return (
    <div className="flex flex-col h-full font-sans text-[var(--color-text)] overflow-hidden">
      {/* 1. Header with Counters & Controls */}
      <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center font-bold">
            <History size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--color-text)]">
              Version History & Provenance
            </h3>
            <p className="text-[11px] text-[var(--color-text-secondary)] font-mono">
              Snapshot: <span className="text-[var(--color-text)] font-semibold">{snapshotId.substring(0, 10)}</span>
              {data?.commitSha && <span> • Git: {data.commitSha.substring(0, 7)}</span>}
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchHistory(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors disabled:opacity-50 cursor-pointer"
          title="Refresh accurate version counters from database"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin text-[var(--color-primary)]" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        {/* 2. Operation Counters (Total, Success, Failed, Canceled) */}
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">
            Operation Summary & Accurate Counters
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Analyze Card */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Search size={15} className="text-cyan-400" />
                  <span className="text-xs font-bold text-[var(--color-text)]">Analyze Endpoint Discovery</span>
                </div>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {counters.analyze.total} total
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] font-mono pt-2 border-t border-[var(--color-border)]/60">
                <div className="bg-emerald-500/10 text-emerald-400 rounded py-1 border border-emerald-500/20">
                  <div className="font-bold text-xs">{counters.analyze.success}</div>
                  <div className="text-[9px] uppercase">Success</div>
                </div>
                <div className="bg-rose-500/10 text-rose-400 rounded py-1 border border-rose-500/20">
                  <div className="font-bold text-xs">{counters.analyze.failed}</div>
                  <div className="text-[9px] uppercase">Failed</div>
                </div>
                <div className="bg-amber-500/10 text-amber-400 rounded py-1 border border-amber-500/20">
                  <div className="font-bold text-xs">{counters.analyze.canceled}</div>
                  <div className="text-[9px] uppercase">Canceled</div>
                </div>
                <div className="bg-blue-500/10 text-blue-400 rounded py-1 border border-blue-500/20">
                  <div className="font-bold text-xs">{counters.analyze.running}</div>
                  <div className="text-[9px] uppercase">Running</div>
                </div>
              </div>
            </div>

            {/* Generate Card */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Zap size={15} className="text-amber-400" />
                  <span className="text-xs font-bold text-[var(--color-text)]">Generate Test Cases</span>
                </div>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {counters.generate.total} total
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] font-mono pt-2 border-t border-[var(--color-border)]/60">
                <div className="bg-emerald-500/10 text-emerald-400 rounded py-1 border border-emerald-500/20">
                  <div className="font-bold text-xs">{counters.generate.success}</div>
                  <div className="text-[9px] uppercase">Success</div>
                </div>
                <div className="bg-rose-500/10 text-rose-400 rounded py-1 border border-rose-500/20">
                  <div className="font-bold text-xs">{counters.generate.failed}</div>
                  <div className="text-[9px] uppercase">Failed</div>
                </div>
                <div className="bg-amber-500/10 text-amber-400 rounded py-1 border border-amber-500/20">
                  <div className="font-bold text-xs">{counters.generate.canceled}</div>
                  <div className="text-[9px] uppercase">Canceled</div>
                </div>
                <div className="bg-blue-500/10 text-blue-400 rounded py-1 border border-blue-500/20">
                  <div className="font-bold text-xs">{counters.generate.running}</div>
                  <div className="text-[9px] uppercase">Running</div>
                </div>
              </div>
            </div>

            {/* Run Tests Card */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <PlayCircle size={15} className="text-purple-400" />
                  <span className="text-xs font-bold text-[var(--color-text)]">Run Tests Executions</span>
                </div>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  {counters.runTests.total} total
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] font-mono pt-2 border-t border-[var(--color-border)]/60">
                <div className="bg-emerald-500/10 text-emerald-400 rounded py-1 border border-emerald-500/20">
                  <div className="font-bold text-xs">{counters.runTests.success}</div>
                  <div className="text-[9px] uppercase">Passed</div>
                </div>
                <div className="bg-rose-500/10 text-rose-400 rounded py-1 border border-rose-500/20">
                  <div className="font-bold text-xs">{counters.runTests.failed}</div>
                  <div className="text-[9px] uppercase">Failed</div>
                </div>
                <div className="bg-amber-500/10 text-amber-400 rounded py-1 border border-amber-500/20">
                  <div className="font-bold text-xs">{counters.runTests.canceled}</div>
                  <div className="text-[9px] uppercase">Canceled</div>
                </div>
                <div className="bg-blue-500/10 text-blue-400 rounded py-1 border border-blue-500/20">
                  <div className="font-bold text-xs">{counters.runTests.running}</div>
                  <div className="text-[9px] uppercase">Running</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Automated Old vs New Tracking Diff Box */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3 bg-[var(--color-surface-secondary)]/40">
            <div>
              <h4 className="text-xs font-bold text-[var(--color-text)]">
                Automated Old vs New Tracking (Previous vs Current)
              </h4>
              <p className="text-[11px] text-[var(--color-text-secondary)]">
                Identifies changes, new additions, removals, and regressions strictly from successive completed sessions.
              </p>
            </div>

            <div className="flex items-center gap-1 bg-[var(--color-bg)] p-1 rounded-md border border-[var(--color-border)]">
              <button
                onClick={() => setActiveDiffTab("ANALYZE")}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                  activeDiffTab === "ANALYZE"
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                }`}
              >
                Endpoints ({analyzeDiff?.summary?.totalCurrent || 0})
              </button>
              <button
                onClick={() => setActiveDiffTab("GENERATE")}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                  activeDiffTab === "GENERATE"
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                }`}
              >
                Test Cases ({generateDiff?.summary?.tests?.currentTotal || 0})
              </button>
              <button
                onClick={() => setActiveDiffTab("RUN_TESTS")}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                  activeDiffTab === "RUN_TESTS"
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                }`}
              >
                Run Transitions ({runTestsDiff?.summary?.totalCompared || 0})
              </button>
              {onOpenComparison && (
                <button
                  onClick={onOpenComparison}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)]/90 transition-colors ml-1 cursor-pointer"
                  title="Open full Before/After Comparison view"
                >
                  <GitCompare size={12} />
                  <span>Before/After View</span>
                </button>
              )}
            </div>
          </div>

          <div className="p-4">
            {/* Tab: ANALYZE Endpoints Diff */}
            {activeDiffTab === "ANALYZE" && (
              <div>
                {analyzeDiff ? (
                  <div>
                    {/* Summary Chips */}
                    <div className="flex flex-wrap items-center gap-2 mb-4 font-mono text-xs">
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                        NEW: {analyzeDiff.summary?.newCount || 0}
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                        CHANGED: {analyzeDiff.summary?.changedCount || 0}
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-bold">
                        UNCHANGED: {analyzeDiff.summary?.unchangedCount || 0}
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-bold">
                        REMOVED: {analyzeDiff.summary?.removedCount || 0}
                      </span>
                    </div>

                    {/* Endpoints Table / List */}
                    <div className="max-h-72 overflow-y-auto border border-[var(--color-border)] rounded-md divide-y divide-[var(--color-border)]">
                      {analyzeDiff.endpoints?.length > 0 ? (
                        analyzeDiff.endpoints.map((ep, idx) => {
                          const statusColor =
                            ep.diffStatus === "NEW"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                              : ep.diffStatus === "CHANGED"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                              : ep.diffStatus === "REMOVED"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                              : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]";

                          return (
                            <div key={idx} className="p-2.5 hover:bg-[var(--color-surface-secondary)]/50 transition-colors flex flex-col gap-1 text-xs">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${statusColor}`}>
                                    {ep.diffStatus}
                                  </span>
                                  <span className="font-mono font-bold text-[var(--color-text)]">
                                    {ep.method} {ep.path}
                                  </span>
                                </div>
                                <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                                  {ep.sourceFile || "Declared route"}
                                </span>
                              </div>

                              {ep.diffStatus === "CHANGED" && ep.changedFields?.length > 0 && (
                                <div className="mt-1 pl-6 text-[11px] text-amber-400 font-mono flex flex-wrap gap-2">
                                  <span>Changed fields: {ep.changedFields.join(", ")}</span>
                                  {ep.diffDetails && (
                                    <span className="text-[var(--color-text-secondary)]">
                                      ({Object.keys(ep.diffDetails).length} modified properties)
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="p-4 text-center text-xs text-[var(--color-text-muted)]">
                          No endpoint differences to display.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs text-[var(--color-text-muted)]">
                    Requires at least two successful Analyze sessions to generate old vs new diffs.
                  </div>
                )}
              </div>
            )}

            {/* Tab: GENERATE Test Suite Diff */}
            {activeDiffTab === "GENERATE" && (
              <div>
                {generateDiff ? (
                  <div>
                    {/* Summary Chips */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 text-center font-mono text-xs">
                      <div className="p-2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                        <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Test Files</div>
                        <div className="font-bold text-[var(--color-text)] mt-0.5">
                          +{generateDiff.summary?.files?.newCount || 0} / ~{generateDiff.summary?.files?.modifiedCount || 0} / -{generateDiff.summary?.files?.removedCount || 0}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                        <div className="text-[10px] uppercase">New Scenarios</div>
                        <div className="font-bold text-sm mt-0.5">+{generateDiff.summary?.tests?.newCount || 0}</div>
                      </div>
                      <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
                        <div className="text-[10px] uppercase">Modified Scenarios</div>
                        <div className="font-bold text-sm mt-0.5">~{generateDiff.summary?.tests?.modifiedCount || 0}</div>
                      </div>
                      <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400">
                        <div className="text-[10px] uppercase">Removed Scenarios</div>
                        <div className="font-bold text-sm mt-0.5">-{generateDiff.summary?.tests?.removedCount || 0}</div>
                      </div>
                    </div>

                    {/* Scenarios / Test Cases List */}
                    <div className="max-h-72 overflow-y-auto border border-[var(--color-border)] rounded-md divide-y divide-[var(--color-border)]">
                      {generateDiff.tests?.length > 0 ? (
                        generateDiff.tests.map((test, idx) => {
                          const statusColor =
                            test.diffStatus === "NEW"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                              : test.diffStatus === "MODIFIED"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                              : test.diffStatus === "REMOVED"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                              : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]";

                          return (
                            <div key={idx} className="p-2.5 hover:bg-[var(--color-surface-secondary)]/50 transition-colors flex items-center justify-between text-xs font-mono">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusColor}`}>
                                  {test.diffStatus}
                                </span>
                                <span className="font-semibold text-[var(--color-text)]">
                                  {test.name || test.title || test.testName || "Integration Scenario"}
                                </span>
                              </div>
                              <span className="text-[11px] text-[var(--color-text-muted)]">
                                {test.filePath || test.targetFile || ""}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="p-4 text-center text-xs text-[var(--color-text-muted)]">
                          No test scenario differences detected.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs text-[var(--color-text-muted)]">
                    Requires at least two successful Generate sessions to compute test suite diffs.
                  </div>
                )}
              </div>
            )}

            {/* Tab: RUN_TESTS Comparison */}
            {activeDiffTab === "RUN_TESTS" && (
              <div>
                {runTestsDiff ? (
                  <div>
                    {/* Summary Metrics */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 text-center font-mono text-xs">
                      <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400">
                        <div className="text-[10px] uppercase font-bold">Regressions (Pass → Fail)</div>
                        <div className="font-bold text-base mt-0.5">{runTestsDiff.summary?.regressionsCount || 0}</div>
                      </div>
                      <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                        <div className="text-[10px] uppercase font-bold">Fixes (Fail → Pass)</div>
                        <div className="font-bold text-base mt-0.5">{runTestsDiff.summary?.fixesCount || 0}</div>
                      </div>
                      <div className="p-2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                        <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Consistent Pass</div>
                        <div className="font-bold text-base text-[var(--color-text)] mt-0.5">{runTestsDiff.summary?.passToPassCount || 0}</div>
                      </div>
                      <div className="p-2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                        <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Coverage Delta</div>
                        <div className="font-bold text-base text-[var(--color-text)] mt-0.5">
                          {runTestsDiff.summary?.coverageDelta != null ? `${runTestsDiff.summary.coverageDelta > 0 ? "+" : ""}${runTestsDiff.summary.coverageDelta.toFixed(1)}%` : "N/A"}
                        </div>
                      </div>
                    </div>

                    {/* Transition details */}
                    <div className="max-h-72 overflow-y-auto border border-[var(--color-border)] rounded-md divide-y divide-[var(--color-border)]">
                      {runTestsDiff.transitions?.length > 0 ? (
                        runTestsDiff.transitions.map((tr, idx) => {
                          const isRegression = tr.statusA === "PASSED" && tr.statusB === "FAILED";
                          const isFix = tr.statusA === "FAILED" && tr.statusB === "PASSED";

                          return (
                            <div key={idx} className="p-2.5 hover:bg-[var(--color-surface-secondary)]/50 transition-colors flex items-center justify-between text-xs font-mono">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  isRegression
                                    ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                    : isFix
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                    : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
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
                        <div className="p-4 text-center text-xs text-[var(--color-text-muted)]">
                          No test transitions recorded.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs text-[var(--color-text-muted)]">
                    Requires at least two completed TestRun executions to compare run transitions.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 4. Unified Activity Timeline */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              Activity Timeline ({filteredTimeline.length} events)
            </h4>

            {/* Filter buttons */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1 bg-[var(--color-surface)] p-1 rounded border border-[var(--color-border)]">
                {["ALL", "ANALYZE", "GENERATE", "RUN_TESTS"].map((op) => (
                  <button
                    key={op}
                    onClick={() => setSelectedOp(op)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                      selectedOp === op
                        ? "bg-[var(--color-primary)] text-white"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {op === "ALL" ? "All Operations" : op}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 bg-[var(--color-surface)] p-1 rounded border border-[var(--color-border)]">
                {["ALL", "SUCCESS", "FAILED", "CANCELED", "RUNNING"].map((st) => (
                  <button
                    key={st}
                    onClick={() => setSelectedStatus(st)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                      selectedStatus === st
                        ? "bg-[var(--color-primary)] text-white"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {st === "ALL" ? "All Status" : st}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Timeline Cards */}
          <div className="flex flex-col gap-2.5">
            {filteredTimeline.length > 0 ? (
              filteredTimeline.map((item) => {
                const OpIcon = OP_ICONS[item.opType] || Clock;
                const statusStyle = STATUS_BADGE[item.status] || "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border)]";

                return (
                  <div
                    key={item.id}
                    className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3.5 hover:border-[var(--color-border)]/80 transition-colors flex flex-col gap-2"
                  >
                    {/* Header Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded bg-[var(--color-surface-secondary)] flex items-center justify-center text-[var(--color-text)]">
                          <OpIcon size={14} />
                        </div>
                        <span className="font-bold text-xs text-[var(--color-text)]">
                          {item.opType}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                          #{item.id.substring(0, 8)}
                        </span>
                        {item.isLatestSuccess && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 uppercase">
                            Current Active
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border font-mono ${statusStyle}`}>
                          {item.status}
                        </span>
                        <button
                          onClick={() => handleOpenHistoricalPreview(item)}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-border)] text-[11px] font-semibold text-[var(--color-text)] transition-colors cursor-pointer"
                          title="Open and inspect historical artifact without overwriting active workspace"
                        >
                          <Eye size={12} />
                          <span>Inspect Version</span>
                        </button>
                      </div>
                    </div>

                    {/* Metadata Details Row */}
                    <div className="flex flex-wrap items-center justify-between text-[11px] text-[var(--color-text-secondary)] font-mono pt-1.5 border-t border-[var(--color-border)]/50 gap-2">
                      <div className="flex items-center gap-3">
                        <span>Started: {new Date(item.startedAt).toLocaleTimeString()}</span>
                        {item.durationMs && (
                          <span>Duration: {item.durationMs > 1000 ? `${(item.durationMs / 1000).toFixed(1)}s` : `${item.durationMs}ms`}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        {item.inputRevision && (
                          <span title="Input Revision / Snapshot ID">
                            Input: <strong className="text-[var(--color-text)]">{item.inputRevision.substring(0, 8)}</strong>
                          </span>
                        )}
                        {item.artifactCount != null && (
                          <span>
                            Artifacts: <strong className="text-[var(--color-text)]">{item.artifactCount}</strong>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Error or Cancellation message */}
                    {item.errorReason && (
                      <div className="text-[11px] font-mono text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2 rounded">
                        {item.errorReason}
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

      {/* 5. Historical Version Preview Modal */}
      {previewVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden font-sans">
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-secondary)]/50 shrink-0">
              <div className="flex items-center gap-2.5">
                <FileCode size={16} className="text-[var(--color-primary)]" />
                <h3 className="text-sm font-bold text-[var(--color-text)]">
                  Historical Version Artifact Inspector
                </h3>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                  {previewVersion.opType} #{previewVersion.id.substring(0, 8)}
                </span>
              </div>
              <button
                onClick={() => setPreviewVersion(null)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] p-1 rounded hover:bg-[var(--color-surface-secondary)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-5">
              {previewVersion.loading ? (
                <div className="flex flex-col items-center justify-center p-12 text-xs text-[var(--color-text-secondary)]">
                  <RefreshCw size={24} className="animate-spin text-[var(--color-primary)] mb-2" />
                  <span>Loading archived version snapshot from disk...</span>
                </div>
              ) : previewError ? (
                <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded text-rose-400 text-xs font-mono">
                  {previewError}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between text-xs font-mono text-[var(--color-text-secondary)] bg-[var(--color-bg)] p-3 rounded border border-[var(--color-border)]">
                    <div>
                      <span>Version ID: <strong className="text-[var(--color-text)]">{previewVersion.id}</strong></span>
                      {previewVersion.artifactTimestamp && (
                        <span className="ml-3">Archived At: {new Date(previewVersion.artifactTimestamp).toLocaleString()}</span>
                      )}
                    </div>
                    <span className="text-emerald-400 font-bold">Read-Only Immutable Snapshot</span>
                  </div>

                  <div className="text-xs font-semibold text-[var(--color-text)]">
                    Archived Artifact Payload:
                  </div>

                  <pre className="p-4 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)] overflow-x-auto max-h-[50vh] leading-relaxed">
                    {JSON.stringify(previewVersion.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-secondary)]/30 shrink-0">
              <span className="text-[11px] text-[var(--color-text-muted)]">
                Viewing historical version without modifying current workspace pointers.
              </span>
              <button
                onClick={() => setPreviewVersion(null)}
                className="px-4 py-1.5 rounded bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary)]/90 cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
