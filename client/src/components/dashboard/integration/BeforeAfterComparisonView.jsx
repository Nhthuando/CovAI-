import { useState, useEffect, useMemo } from "react";
import {
  GitCompare,
  FileCode,
  Zap,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  RefreshCw,
  Search,
  Filter,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  Eye,
  Sliders,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Code
} from "lucide-react";
import { DiffEditor } from "@monaco-editor/react";
import {
  getBeforeAfterComparison,
  getSourceFileDiff,
  getIntegrationVersionHistory
} from "../../../services/coverage.service.js";

const CONCLUSION_STYLES = {
  NO_SOURCE_CODE_CHANGES: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
  SOURCE_CHANGED: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  TEST_COVERAGE_INCREASED: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
  TEST_COVERAGE_DECREASED: "bg-rose-500/10 border-rose-500/30 text-rose-400",
  TEST_COVERAGE_UNCHANGED: "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text-secondary)]",
  RUNTIME_REGRESSION_DETECTED: "bg-rose-500/10 border-rose-500/30 text-rose-400 font-bold",
  RUNTIME_IMPROVEMENT_OBSERVED: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
  RUNTIME_STABLE: "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text)]",
  INSUFFICIENT_EVIDENCE: "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text-muted)]"
};

export default function BeforeAfterComparisonView({
  projectId,
  snapshotId,
  initialBaselineId,
  onBackToWorkspace
}) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Comparison State
  const [comparison, setComparison] = useState(null);
  const [activeTab, setActiveTab] = useState("SOURCE"); // SOURCE | TEST_SUITE | RUNTIME | ENDPOINTS

  // Selectors State
  const [versionHistory, setVersionHistory] = useState(null);
  const [baselineSnapshotId, setBaselineSnapshotId] = useState(() => {
    if (initialBaselineId) return initialBaselineId;
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      return p.get("baselineId") || "";
    }
    return "";
  });
  const [currentSnapshotId, setCurrentSnapshotId] = useState(snapshotId || "");
  const [baselineRunId, setBaselineRunId] = useState("");
  const [currentRunId, setCurrentRunId] = useState("");

  // Source Diff File Viewer
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileDiffData, setFileDiffData] = useState(null);
  const [fileDiffLoading, setFileDiffLoading] = useState(false);
  const [showExcludedFiles, setShowExcludedFiles] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");

  // Load version history to populate dropdown selectors
  useEffect(() => {
    if (!snapshotId) return;
    getIntegrationVersionHistory(snapshotId)
      .then((res) => {
        if (res.success && res.data) {
          setVersionHistory(res.data);
          const effectiveBaseline = baselineSnapshotId || (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("baselineId") : "");
          if (!effectiveBaseline || effectiveBaseline === snapshotId) {
            const trs = res.data.timeline?.filter(t => t.opType === "RUN_TESTS" && t.status !== "RUNNING") || [];
            if (trs.length >= 2) {
              setCurrentRunId(trs[0].id);
              setBaselineRunId(trs[1].id);
            } else if (trs.length === 1) {
              setCurrentRunId(trs[0].id);
            }
          }
        }
      })
      .catch((err) => console.error("Error loading version history:", err));
  }, [snapshotId, baselineSnapshotId]);

  // Load line-by-line file diff when clicking a file in Source Code tab
  const handleSelectFile = async (filePath, optBaselineId, optCurrentId) => {
    setSelectedFile(filePath);
    setFileDiffLoading(true);
    try {
      const bId = optBaselineId || comparison?.baselineSnapshotId || baselineSnapshotId || (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("baselineId") : "");
      const cId = optCurrentId || comparison?.currentSnapshotId || currentSnapshotId || snapshotId;
      const res = await getSourceFileDiff(projectId, {
        baselineSnapshotId: bId,
        currentSnapshotId: cId,
        filePath
      });
      if (res.success && res.data) {
        setFileDiffData(res.data);
      }
    } catch (err) {
      console.error("Failed to load file diff:", err);
    } finally {
      setFileDiffLoading(false);
    }
  };

  // Load Before/After Comparison
  const loadComparison = async (isManual = false) => {
    if (!projectId) return;
    if (isManual) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const effectiveBaseline = baselineSnapshotId || (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("baselineId") : undefined) || undefined;
      const effectiveCurrent = currentSnapshotId || snapshotId || undefined;

      const res = await getBeforeAfterComparison(projectId, {
        baselineSnapshotId: effectiveBaseline,
        currentSnapshotId: effectiveCurrent,
        baselineRunId: baselineRunId || undefined,
        currentRunId: currentRunId || undefined
      });

      if (res.success && res.data) {
        setComparison(res.data);
        if (!baselineSnapshotId && res.data.baselineSnapshotId) {
          setBaselineSnapshotId(res.data.baselineSnapshotId);
        }
        if (!currentSnapshotId && res.data.currentSnapshotId) {
          setCurrentSnapshotId(res.data.currentSnapshotId);
        }
        // Auto-select first changed file
        if (res.data.sourceDiff?.files?.length > 0) {
          handleSelectFile(
            res.data.sourceDiff.files[0].filePath,
            res.data.baselineSnapshotId || effectiveBaseline,
            res.data.currentSnapshotId || effectiveCurrent
          );
        } else {
          setSelectedFile(null);
          setFileDiffData(null);
        }
      } else {
        setError(res.message || "Could not retrieve before/after comparison data.");
      }
    } catch (err) {
      setError(err.message || "Failed to load before/after comparison.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadComparison();
  }, [projectId, baselineSnapshotId, currentSnapshotId, baselineRunId, currentRunId]);

  // Filtered source files list
  const filteredFiles = useMemo(() => {
    if (!comparison?.sourceDiff?.files) return [];
    if (!fileSearchQuery.trim()) return comparison.sourceDiff.files;
    const q = fileSearchQuery.toLowerCase();
    return comparison.sourceDiff.files.filter(f => f.filePath.toLowerCase().includes(q));
  }, [comparison?.sourceDiff?.files, fileSearchQuery]);

  if (loading && !comparison) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-12 text-center text-xs text-[var(--color-text-secondary)] font-sans">
        <RefreshCw size={24} className="animate-spin text-[var(--color-primary)] mb-3" />
        <span>Computing Evidence-Based Before/After Comparison...</span>
      </div>
    );
  }

  if (error && !comparison) {
    return (
      <div className="p-8 text-center text-xs text-[var(--color-danger)] font-sans flex flex-col items-center justify-center gap-3">
        <AlertTriangle size={28} />
        <p>{error}</p>
        <button
          onClick={() => loadComparison(true)}
          className="px-3 py-1.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)] text-xs font-semibold cursor-pointer"
        >
          Retry Comparison
        </button>
      </div>
    );
  }

  const conclusions = comparison?.conclusions || {};
  const sourceDiff = comparison?.sourceDiff || {};
  const testDiff = comparison?.testDiff || {};
  const runtimeDiff = comparison?.runtimeDiff || {};
  const coverageDiff = comparison?.coverageDiff || {};

  return (
    <div className="flex flex-col h-full font-sans text-[var(--color-text)] overflow-hidden">
      {/* 1. Header Bar with Version Selectors & Actions */}
      <div className="px-6 py-3.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center font-bold">
            <GitCompare size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[var(--color-text)]">
                Before / After Comparison & Quality Analysis
              </h3>
              <span className="text-[10px] uppercase font-bold font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/25">
                Evidence Verified
              </span>
            </div>
            <p className="text-[11px] text-[var(--color-text-secondary)] font-mono">
              Baseline: <span className="text-[var(--color-text)] font-semibold">{comparison?.baselineSnapshotId?.substring(0, 8) || "N/A"}</span>
              {comparison?.baselineCommit && <span> ({comparison.baselineCommit.substring(0, 7)})</span>}
              {" → "}
              Current: <span className="text-[var(--color-text)] font-semibold">{comparison?.currentSnapshotId?.substring(0, 8) || "N/A"}</span>
              {comparison?.currentCommit && <span> ({comparison.currentCommit.substring(0, 7)})</span>}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {onBackToWorkspace && (
            <button
              onClick={onBackToWorkspace}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)] cursor-pointer"
            >
              Back to Workspace
            </button>
          )}
          <button
            onClick={() => loadComparison(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)]/90 cursor-pointer disabled:opacity-50"
            title="Recalculate diffs and evidence metrics"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            <span>Re-Compare</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        {/* 2. Rigorous Evidence-Based Conclusions Banner */}
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Source Status Badge */}
            <div className={`p-3 rounded-[var(--radius-md)] border flex flex-col justify-between ${CONCLUSION_STYLES[conclusions.sourceStatus] || CONCLUSION_STYLES.INSUFFICIENT_EVIDENCE}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider font-mono">1. Source Code</span>
                {conclusions.sourceStatus === "NO_SOURCE_CODE_CHANGES" ? (
                  <ShieldCheck size={16} />
                ) : (
                  <FileCode size={16} />
                )}
              </div>
              <div className="font-bold text-xs">
                {conclusions.sourceStatus === "NO_SOURCE_CODE_CHANGES" ? "NO SOURCE CODE CHANGES" : "SOURCE CODE MODIFIED"}
              </div>
              <div className="text-[11px] opacity-80 mt-1">
                {conclusions.sourceStatus === "NO_SOURCE_CODE_CHANGES"
                  ? "Identical files and SHA-256 tree fingerprint. Running tests does not alter source code."
                  : `${sourceDiff.summary?.newFilesCount || 0} new, ${sourceDiff.summary?.modifiedFilesCount || 0} modified, ${sourceDiff.summary?.deletedFilesCount || 0} deleted.`}
              </div>
            </div>

            {/* Test Coverage Status Badge */}
            <div className={`p-3 rounded-[var(--radius-md)] border flex flex-col justify-between ${CONCLUSION_STYLES[conclusions.testCoverageStatus] || CONCLUSION_STYLES.INSUFFICIENT_EVIDENCE}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider font-mono">2. Endpoint Coverage</span>
                <Zap size={16} />
              </div>
              <div className="font-bold text-xs">
                {conclusions.testCoverageStatus || "INSUFFICIENT_EVIDENCE"}
              </div>
              <div className="text-[11px] opacity-80 mt-1">
                {coverageDiff.metrics?.endpointCoverage ? (
                  <span>
                    Baseline: {coverageDiff.metrics.endpointCoverage.baseline?.covered}/{coverageDiff.metrics.endpointCoverage.baseline?.total} APIs ({coverageDiff.metrics.endpointCoverage.baseline?.pct.toFixed(0)}%)
                    {" → "}
                    Current: {coverageDiff.metrics.endpointCoverage.current?.covered}/{coverageDiff.metrics.endpointCoverage.current?.total} APIs ({coverageDiff.metrics.endpointCoverage.current?.pct.toFixed(0)}%)
                  </span>
                ) : (
                  "Evaluated across distinct endpoint inventories."
                )}
              </div>
            </div>

            {/* Runtime Status Badge */}
            <div className={`p-3 rounded-[var(--radius-md)] border flex flex-col justify-between ${CONCLUSION_STYLES[conclusions.runtimeStatus] || CONCLUSION_STYLES.INSUFFICIENT_EVIDENCE}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider font-mono">3. Runtime Execution</span>
                {conclusions.runtimeStatus === "RUNTIME_REGRESSION_DETECTED" ? (
                  <ShieldAlert size={16} />
                ) : (
                  <PlayCircle size={16} />
                )}
              </div>
              <div className="font-bold text-xs">
                {conclusions.runtimeStatus || "INSUFFICIENT_EVIDENCE"}
              </div>
              <div className="text-[11px] opacity-80 mt-1">
                {runtimeDiff.summary ? (
                  <span>
                    {runtimeDiff.summary.regressionsCount} regressions (Pass→Fail), {runtimeDiff.summary.fixesCount} fixes (Fail→Pass).
                  </span>
                ) : (
                  "Run-to-run comparison transitions."
                )}
              </div>
            </div>
          </div>

          {/* Comparability Warnings */}
          {conclusions.warnings?.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/25 p-3 rounded-[var(--radius-md)] text-xs text-amber-400 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle size={14} />
                <span>Comparability Considerations & Divergence:</span>
              </div>
              <ul className="list-disc pl-5 text-[11px] flex flex-col gap-0.5">
                {conclusions.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* 3. Summary Statistics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-center font-mono text-xs">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 rounded-[var(--radius-md)]">
            <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Source Files</div>
            <div className="font-bold text-sm text-[var(--color-text)] mt-0.5">
              {sourceDiff.files?.length || 0} changed
            </div>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 rounded-[var(--radius-md)]">
            <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Lines Added/Deleted</div>
            <div className="font-bold text-sm mt-0.5">
              <span className="text-emerald-400">+{sourceDiff.summary?.totalAdditions || 0}</span>
              {" / "}
              <span className="text-rose-400">-{sourceDiff.summary?.totalDeletions || 0}</span>
            </div>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 rounded-[var(--radius-md)]">
            <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Test Cases Diff</div>
            <div className="font-bold text-sm mt-0.5">
              <span className="text-emerald-400">+{testDiff.summary?.tests?.newCount || 0}</span>
              {" / "}
              <span className="text-amber-400">~{testDiff.summary?.tests?.modifiedCount || 0}</span>
              {" / "}
              <span className="text-rose-400">-{testDiff.summary?.tests?.removedCount || 0}</span>
            </div>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 rounded-[var(--radius-md)]">
            <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Endpoints Tested</div>
            <div className="font-bold text-sm text-[var(--color-text)] mt-0.5">
              {coverageDiff.metrics?.endpointCoverage?.baseline?.covered || 0} → {coverageDiff.metrics?.endpointCoverage?.current?.covered || 0}
            </div>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 rounded-[var(--radius-md)]">
            <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Regressions</div>
            <div className={`font-bold text-sm mt-0.5 ${runtimeDiff.summary?.regressionsCount > 0 ? "text-rose-400 font-extrabold" : "text-[var(--color-text)]"}`}>
              {runtimeDiff.summary?.regressionsCount || 0}
            </div>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 rounded-[var(--radius-md)]">
            <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Fixes (Fail→Pass)</div>
            <div className="font-bold text-sm text-emerald-400 mt-0.5">
              {runtimeDiff.summary?.fixesCount || 0}
            </div>
          </div>
        </div>

        {/* 4. Sub-Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2 font-sans">
          {[
            { id: "SOURCE", label: "Source Code Diff", icon: FileCode, count: sourceDiff.files?.length || 0 },
            { id: "TEST_SUITE", label: "Test Suite Diff", icon: Zap, count: testDiff.summary?.tests?.newCount ? `+${testDiff.summary.tests.newCount}` : null },
            { id: "RUNTIME", label: "Runtime Executions", icon: PlayCircle, count: runtimeDiff.summary?.totalCompared || 0 },
            { id: "ENDPOINTS", label: "Endpoint Coverage Gaps", icon: Filter, count: coverageDiff.endpointComparisons?.length || 0 }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer border ${
                  isActive
                    ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                    : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text)]"
                }`}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
                {tab.count != null && (
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                    isActive ? "bg-white/20 text-white" : "bg-[var(--color-surface-secondary)] text-[var(--color-text)]"
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 5. Tab Content Views */}

        {/* TAB 1: SOURCE CODE DIFF */}
        {activeTab === "SOURCE" && (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden flex flex-col">
            {sourceDiff.status === "NO_SOURCE_CODE_CHANGES" ? (
              <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 size={28} />
                </div>
                <h4 className="text-sm font-bold text-[var(--color-text)]">
                  NO SOURCE CODE CHANGES DETECTED
                </h4>
                <p className="text-xs text-[var(--color-text-secondary)] max-w-md">
                  All tracked files in the workspace match the baseline revision with identical SHA-256 tree checksums.
                  Running test executions does not modify application source files.
                </p>
                <div className="flex items-center gap-2 text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-bg)] px-3 py-1.5 rounded border border-[var(--color-border)]">
                  <span>Tracked files: {sourceDiff.summary?.totalFilesA || 0}</span>
                  <span>•</span>
                  <span>Tree hash: {sourceDiff.baseline?.compositeHash?.substring(0, 16)}</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-12 min-h-[500px]">
                {/* Left: Files List */}
                <div className="md:col-span-4 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface-secondary)]/30">
                  <div className="p-3 border-b border-[var(--color-border)] flex flex-col gap-2">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--color-text-muted)]" />
                      <input
                        type="text"
                        placeholder="Filter modified files..."
                        value={fileSearchQuery}
                        onChange={(e) => setFileSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-muted)]"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-[var(--color-text-muted)]">
                      <span>{filteredFiles.length} changed files</span>
                      <button
                        onClick={() => setShowExcludedFiles(!showExcludedFiles)}
                        className="text-[var(--color-primary)] hover:underline cursor-pointer"
                      >
                        {showExcludedFiles ? "Hide Excluded" : `Excluded (${sourceDiff.excludedFiles?.length || 0})`}
                      </button>
                    </div>
                  </div>

                  {/* Excluded Files Panel */}
                  {showExcludedFiles && (
                    <div className="p-3 bg-amber-500/5 border-b border-amber-500/20 text-[11px] font-mono max-h-40 overflow-y-auto">
                      <div className="font-bold text-amber-400 mb-1">Excluded from Source Diff:</div>
                      <ul className="text-[var(--color-text-muted)] flex flex-col gap-0.5">
                        {sourceDiff.excludedFiles?.map((ex, i) => (
                          <li key={i}>{ex}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Files Item List */}
                  <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)]/50">
                    {filteredFiles.map((file) => {
                      const isSelected = selectedFile === file.filePath;
                      const statusColor =
                        file.status === "NEW"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                          : file.status === "DELETED"
                          ? "bg-rose-500/10 text-rose-400 border-rose-500/25"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/25";

                      return (
                        <div
                          key={file.filePath}
                          onClick={() => handleSelectFile(file.filePath)}
                          className={`p-3 text-xs cursor-pointer transition-colors flex flex-col gap-1 ${
                            isSelected
                              ? "bg-[var(--color-primary)]/10 border-l-2 border-[var(--color-primary)]"
                              : "hover:bg-[var(--color-surface-secondary)] border-l-2 border-transparent"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-medium text-[var(--color-text)] truncate flex-1" title={file.filePath}>
                              {file.filePath}
                            </span>
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono border ${statusColor}`}>
                              {file.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--color-text-muted)]">
                            <span className="text-emerald-400">+{file.additions}</span>
                            <span className="text-rose-400">-{file.deletions}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right: Monaco Diff Editor / File Content */}
                <div className="md:col-span-8 flex flex-col h-[550px] bg-[var(--color-bg)]">
                  {selectedFile ? (
                    <div className="flex flex-col h-full">
                      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-between text-xs font-mono bg-[var(--color-surface)]">
                        <span className="font-bold text-[var(--color-text)]">{selectedFile}</span>
                        <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-secondary)]">
                          <span>Baseline: {fileDiffData?.existsInBaseline ? "Present" : "Deleted / Absent"}</span>
                          <span>•</span>
                          <span>Current: {fileDiffData?.existsInCurrent ? "Present" : "Deleted"}</span>
                        </div>
                      </div>

                      <div className="flex-1 overflow-hidden">
                        {fileDiffLoading ? (
                          <div className="flex items-center justify-center h-full text-xs text-[var(--color-text-secondary)]">
                            <RefreshCw size={18} className="animate-spin text-[var(--color-primary)] mr-2" />
                            <span>Loading file diff...</span>
                          </div>
                        ) : (
                          <DiffEditor
                            original={fileDiffData?.oldContent || ""}
                            modified={fileDiffData?.newContent || ""}
                            language={selectedFile.endsWith(".json") ? "json" : "javascript"}
                            theme="vs-dark"
                            options={{
                              readOnly: true,
                              minimap: { enabled: false },
                              fontSize: 12,
                              renderSideBySide: true,
                              scrollBeyondLastLine: false
                            }}
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-xs text-[var(--color-text-muted)]">
                      Select a file from the list to view before/after line-by-line diff.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: TEST SUITE DIFF */}
        {activeTab === "TEST_SUITE" && (
          <div className="flex flex-col gap-4">
            {/* Scenarios Added by Category */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4">
              <h4 className="text-xs font-bold text-[var(--color-text)] mb-3">
                Scenarios by Functional Category & Intent
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                <div className="p-3 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <div className="text-[10px] uppercase font-bold">Happy Path</div>
                  <div className="text-sm font-bold mt-1">200 / 201 / OK</div>
                  <div className="text-[11px] text-[var(--color-text-muted)] mt-1">Confirmed successful processing</div>
                </div>
                <div className="p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <div className="text-[10px] uppercase font-bold">Validation</div>
                  <div className="text-sm font-bold mt-1">400 / 422</div>
                  <div className="text-[11px] text-[var(--color-text-muted)] mt-1">Invalid fields, missing params</div>
                </div>
                <div className="p-3 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  <div className="text-[10px] uppercase font-bold">Authorization</div>
                  <div className="text-sm font-bold mt-1">401 / 403</div>
                  <div className="text-[11px] text-[var(--color-text-muted)] mt-1">Missing token, forbidden access</div>
                </div>
                <div className="p-3 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400">
                  <div className="text-[10px] uppercase font-bold">Negative Path</div>
                  <div className="text-sm font-bold mt-1">404 / 500</div>
                  <div className="text-[11px] text-[var(--color-text-muted)] mt-1">Not found, error envelopes</div>
                </div>
              </div>
            </div>

            {/* Test Quality & Anomaly Checks */}
            {testDiff.anomalies && (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 flex flex-col gap-3">
                <h4 className="text-xs font-bold text-[var(--color-text)]">
                  Quality Heuristics & Anomaly Flags
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
                  <div className="p-3 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
                    <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Duplicate Tests</div>
                    <div className={`text-sm font-bold mt-1 ${testDiff.anomalies.duplicateTests?.length > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                      {testDiff.anomalies.duplicateTests?.length || 0}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-muted)] mt-1">
                      {testDiff.anomalies.duplicateTests?.length > 0 ? "Multiple tests on same endpoint" : "Zero duplicates detected"}
                    </div>
                  </div>

                  <div className="p-3 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
                    <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Weak Assertions</div>
                    <div className={`text-sm font-bold mt-1 ${testDiff.anomalies.weakAssertions?.length > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                      {testDiff.anomalies.weakAssertions?.length || 0}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-muted)] mt-1">
                      Status-only check without payload schema
                    </div>
                  </div>

                  <div className="p-3 rounded bg-[var(--color-bg)] border border-[var(--color-border)]">
                    <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Unmapped Tests</div>
                    <div className={`text-sm font-bold mt-1 ${testDiff.anomalies.unmappedTests?.length > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                      {testDiff.anomalies.unmappedTests?.length || 0}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-muted)] mt-1">
                      Test target not located in static API routes
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: RUNTIME EXECUTIONS */}
        {activeTab === "RUNTIME" && (
          <div className="flex flex-col gap-4">
            {runtimeDiff.summary ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[var(--color-text)]">
                    Test Execution Transitions (Run #{runtimeDiff.previousRunId?.substring(0, 8)} → Run #{runtimeDiff.currentRunId?.substring(0, 8)})
                  </h4>
                  <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                    Duration Δ: {runtimeDiff.durationDiffMs ? `${runtimeDiff.durationDiffMs}ms` : "0ms"}
                  </span>
                </div>

                {/* Transition Matrix List */}
                <div className="max-h-80 overflow-y-auto divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md">
                  {runtimeDiff.transitions?.map((tr, i) => {
                    const isRegression = tr.statusA === "PASSED" && tr.statusB === "FAILED";
                    const isFix = tr.statusA === "FAILED" && tr.statusB === "PASSED";

                    return (
                      <div key={i} className="p-3 flex items-center justify-between text-xs font-mono hover:bg-[var(--color-surface-secondary)]/40 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            isRegression
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                              : isFix
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                              : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                          }`}>
                            {tr.statusA || "UNRUN"} → {tr.statusB || "UNRUN"}
                          </span>
                          <span className="font-semibold text-[var(--color-text)]">{tr.testName}</span>
                        </div>
                        {tr.durationMs && (
                          <span className="text-[11px] text-[var(--color-text-muted)]">{tr.durationMs}ms</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-[var(--color-text-muted)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
                At least two TestRuns are required to compute runtime execution transitions.
              </div>
            )}
          </div>
        )}

        {/* TAB 4: ENDPOINT COVERAGE GAPS */}
        {activeTab === "ENDPOINTS" && (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-[var(--color-text)]">
                  Endpoint Coverage Gaps & Tested Scope
                </h4>
                <p className="text-[11px] text-[var(--color-text-secondary)]">
                  Compares mapped integration tests per endpoint across baseline and current versions.
                </p>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md">
              {coverageDiff.endpointComparisons?.map((ep, i) => {
                const statusBadge =
                  ep.coverageStatus === "COVERED_IN_BOTH"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                    : ep.coverageStatus === "NEWLY_COVERED"
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/25"
                    : ep.coverageStatus === "LOST_COVERAGE"
                    ? "bg-rose-500/10 text-rose-400 border-rose-500/25"
                    : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]";

                return (
                  <div key={i} className="p-3 flex flex-col gap-1.5 text-xs font-mono hover:bg-[var(--color-surface-secondary)]/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusBadge}`}>
                          {ep.coverageStatus}
                        </span>
                        <span className="font-bold text-[var(--color-text)]">{ep.identity}</span>
                      </div>
                      <div className="text-[11px] text-[var(--color-text-muted)]">
                        Tests: {ep.testCountA} → <strong className="text-[var(--color-text)]">{ep.testCountB}</strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
