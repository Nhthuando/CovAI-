import { useState, useEffect, useMemo } from "react";
import {
  GitCompare,
  FileCode,
  Zap,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  Filter,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Code,
  Layers,
  FileText,
  Clock,
  ExternalLink,
  Info,
  Check,
  Flame,
  Activity,
  Maximize2
} from "lucide-react";
import { DiffEditor } from "@monaco-editor/react";
import {
  getBeforeAfterComparison,
  getSourceFileDiff,
  getIntegrationVersionHistory
} from "../../../services/coverage.service.js";
import { getProjectSnapshotsApi } from "../../../services/project.service.js";

const HTTP_METHOD_COLORS = {
  GET: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25",
  POST: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
  PUT: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
  PATCH: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
  DELETE: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25"
};

const CATEGORY_COLORS = {
  HAPPY_PATH: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  VALIDATION: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  AUTHORIZATION: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  NEGATIVE_PATH: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  OTHER: "bg-gray-500/10 text-gray-500 border-gray-500/20"
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

  // Comparison Data
  const [comparison, setComparison] = useState(null);

  // 3 Primary Segregated Dimension Tabs:
  // OUTCOMES: Comparable Test Runs & Execution Transitions
  // TESTS: Test Suite (Scenarios, Test Files & Endpoint Scope)
  // CODE: Project Source Code Diff (Non-test application files)
  const [activeTab, setActiveTab] = useState("OUTCOMES");

  // Selectors State
  const [availableSnapshots, setAvailableSnapshots] = useState([]);
  const [baselineSnapshotId, setBaselineSnapshotId] = useState(() => {
    if (initialBaselineId) return initialBaselineId;
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      return p.get("baselineId") || "";
    }
    return "";
  });
  const [currentSnapshotId, setCurrentSnapshotId] = useState(snapshotId || "");

  const [baselineRuns, setBaselineRuns] = useState([]);
  const [currentRuns, setCurrentRuns] = useState([]);
  const [baselineRunId, setBaselineRunId] = useState("");
  const [currentRunId, setCurrentRunId] = useState("");

  // Dimension 1: Execution Outcomes Filter State
  const [scenarioFilter, setScenarioFilter] = useState("ALL"); // ALL | REGRESSIONS | FIXES | STABLE_PASS | STABLE_FAIL | UNEXECUTED | NEW
  const [scenarioSearchQuery, setScenarioSearchQuery] = useState("");
  const [expandedScenarios, setExpandedScenarios] = useState({});

  // Dimension 2: Test Suite Filter State
  const [testSuiteSubTab, setTestSuiteSubTab] = useState("ENDPOINTS"); // ENDPOINTS | SCENARIOS
  const [endpointFilter, setEndpointFilter] = useState("ALL"); // ALL | NEWLY_COVERED | LOST_COVERAGE | COVERED_IN_BOTH | UNCOVERED
  const [endpointSearchQuery, setEndpointSearchQuery] = useState("");
  const [expandedEndpoints, setExpandedEndpoints] = useState({});

  const [scenarioSuiteFilter, setScenarioSuiteFilter] = useState("ALL"); // ALL | NEW | MODIFIED | REMOVED | UNCHANGED
  const [scenarioSuiteSearch, setScenarioSuiteSearch] = useState("");

  // Dimension 3: Project Code Filter State
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileDiffData, setFileDiffData] = useState(null);
  const [fileDiffLoading, setFileDiffLoading] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");

  // Dark Mode detection for Monaco
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof document !== "undefined") {
      return (
        document.documentElement.classList.contains("dark") ||
        document.documentElement.getAttribute("data-theme") === "dark"
      );
    }
    return true;
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const dark =
        document.documentElement.classList.contains("dark") ||
        document.documentElement.getAttribute("data-theme") === "dark";
      setIsDarkMode(dark);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"]
    });
    return () => observer.disconnect();
  }, []);

  // 1. Load project snapshots for dropdown
  useEffect(() => {
    if (!projectId) return;
    getProjectSnapshotsApi(projectId)
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setAvailableSnapshots(res.data);
          if (!baselineSnapshotId && res.data.length >= 2) {
            setBaselineSnapshotId(res.data[1].id);
          } else if (!baselineSnapshotId && res.data.length === 1) {
            setBaselineSnapshotId(res.data[0].id);
          }
        }
      })
      .catch((err) => console.warn("Could not load snapshots list:", err));
  }, [projectId]);

  // 2. Load test runs for baseline and current snapshots
  useEffect(() => {
    const effBaseline = baselineSnapshotId || snapshotId;
    if (effBaseline) {
      getIntegrationVersionHistory(effBaseline)
        .then((res) => {
          if (res.success && res.data?.timeline) {
            const trs = res.data.timeline.filter(
              (t) => t.opType === "RUN_TESTS" && t.status !== "RUNNING"
            );
            setBaselineRuns(trs);
          }
        })
        .catch(() => setBaselineRuns([]));
    }
  }, [baselineSnapshotId, snapshotId]);

  useEffect(() => {
    const effCurrent = currentSnapshotId || snapshotId;
    if (effCurrent) {
      getIntegrationVersionHistory(effCurrent)
        .then((res) => {
          if (res.success && res.data?.timeline) {
            const trs = res.data.timeline.filter(
              (t) => t.opType === "RUN_TESTS" && t.status !== "RUNNING"
            );
            setCurrentRuns(trs);
          }
        })
        .catch(() => setCurrentRuns([]));
    }
  }, [currentSnapshotId, snapshotId]);

  // Load line-by-line file diff when clicking a file in Project Code
  const handleSelectFile = async (filePath, optBaselineId, optCurrentId) => {
    setSelectedFile(filePath);
    setFileDiffLoading(true);
    try {
      const bId =
        optBaselineId ||
        comparison?.baselineSnapshotId ||
        baselineSnapshotId ||
        snapshotId;
      const cId =
        optCurrentId ||
        comparison?.currentSnapshotId ||
        currentSnapshotId ||
        snapshotId;
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

  // Load Comparison Payload
  const loadComparison = async (isManual = false) => {
    if (!projectId) return;
    if (isManual) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const effBaseline =
        baselineSnapshotId ||
        (typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("baselineId")
          : undefined) ||
        undefined;
      const effCurrent = currentSnapshotId || snapshotId || undefined;

      const res = await getBeforeAfterComparison(projectId, {
        baselineSnapshotId: effBaseline,
        currentSnapshotId: effCurrent,
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

        // Auto-select first source file if any changed
        const sourceFiles = res.data.projectCodeComparison?.files || [];
        if (sourceFiles.length > 0) {
          handleSelectFile(
            sourceFiles[0].filePath,
            res.data.baselineSnapshotId || effBaseline,
            res.data.currentSnapshotId || effCurrent
          );
        } else {
          setSelectedFile(null);
          setFileDiffData(null);
        }
      } else {
        setError(res.message || "Could not retrieve comparison evidence.");
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

  // Deep-linking helper handlers
  const jumpToOutcomes = (filterType = "ALL", searchQuery = "") => {
    setActiveTab("OUTCOMES");
    setScenarioFilter(filterType);
    if (searchQuery) setScenarioSearchQuery(searchQuery);
  };

  const jumpToTestSuite = (subTab = "ENDPOINTS", filterType = "ALL", searchQuery = "") => {
    setActiveTab("TESTS");
    setTestSuiteSubTab(subTab);
    if (subTab === "ENDPOINTS") {
      setEndpointFilter(filterType);
      if (searchQuery) setEndpointSearchQuery(searchQuery);
    } else {
      setScenarioSuiteFilter(filterType);
      if (searchQuery) setScenarioSuiteSearch(searchQuery);
    }
  };

  const jumpToProjectCode = (filePath = null) => {
    setActiveTab("CODE");
    if (filePath) {
      handleSelectFile(filePath);
    }
  };

  const toggleScenarioExpand = (key) => {
    setExpandedScenarios((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleEndpointExpand = (key) => {
    setExpandedEndpoints((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Filtered Scenario Transitions (Dimension 1)
  const transitionsList =
    comparison?.executionOutcomesComparison?.transitionsList ||
    comparison?.runtimeDiff?.transitions ||
    [];

  const filteredScenarios = useMemo(() => {
    let list = transitionsList;

    if (scenarioFilter === "REGRESSIONS") {
      list = list.filter((t) => t.statusA === "PASSED" && t.statusB === "FAILED");
    } else if (scenarioFilter === "FIXES") {
      list = list.filter((t) => t.statusA === "FAILED" && t.statusB === "PASSED");
    } else if (scenarioFilter === "STABLE_PASS") {
      list = list.filter((t) => t.statusA === "PASSED" && t.statusB === "PASSED");
    } else if (scenarioFilter === "STABLE_FAIL") {
      list = list.filter((t) => t.statusA === "FAILED" && t.statusB === "FAILED");
    } else if (scenarioFilter === "UNEXECUTED") {
      list = list.filter(
        (t) =>
          t.transitionType === "UNEXECUTED" ||
          t.statusB === "UNEXECUTED" ||
          t.statusB === "SKIPPED" ||
          t.statusB === "PENDING"
      );
    } else if (scenarioFilter === "NEW") {
      list = list.filter((t) => !t.statusA && t.statusB && t.statusB !== "UNEXECUTED");
    }

    if (!scenarioSearchQuery.trim()) return list;
    const q = scenarioSearchQuery.toLowerCase();
    return list.filter(
      (t) =>
        (t.testName || "").toLowerCase().includes(q) ||
        (t.suiteName || "").toLowerCase().includes(q) ||
        (t.testFile || "").toLowerCase().includes(q)
    );
  }, [transitionsList, scenarioFilter, scenarioSearchQuery]);

  // Filtered Endpoint Comparisons (Dimension 2)
  const endpointList = comparison?.coverageDiff?.endpointComparisons || [];
  const filteredEndpoints = useMemo(() => {
    let list = endpointList;
    if (endpointFilter !== "ALL") {
      list = list.filter((e) => e.coverageStatus === endpointFilter);
    }
    if (!endpointSearchQuery.trim()) return list;
    const q = endpointSearchQuery.toLowerCase();
    return list.filter((e) => (e.identity || "").toLowerCase().includes(q));
  }, [endpointList, endpointFilter, endpointSearchQuery]);

  // Filtered Test Suite Scenarios (Dimension 2)
  const suiteScenariosList = comparison?.testSuiteComparison?.scenariosDiff?.tests || [];
  const filteredSuiteScenarios = useMemo(() => {
    let list = suiteScenariosList;
    if (scenarioSuiteFilter !== "ALL") {
      list = list.filter((s) => s.diffStatus === scenarioSuiteFilter);
    }
    if (!scenarioSuiteSearch.trim()) return list;
    const q = scenarioSuiteSearch.toLowerCase();
    return list.filter(
      (s) =>
        (s.testName || s.name || "").toLowerCase().includes(q) ||
        (s.path || "").toLowerCase().includes(q) ||
        (s.filePath || "").toLowerCase().includes(q)
    );
  }, [suiteScenariosList, scenarioSuiteFilter, scenarioSuiteSearch]);

  // Filtered Source Files (Dimension 3 - Strictly Non-Test Files!)
  const sourceFilesList = comparison?.projectCodeComparison?.files || [];
  const filteredSourceFiles = useMemo(() => {
    if (!fileSearchQuery.trim()) return sourceFilesList;
    const q = fileSearchQuery.toLowerCase();
    return sourceFilesList.filter((f) => f.filePath.toLowerCase().includes(q));
  }, [sourceFilesList, fileSearchQuery]);

  if (loading && !comparison) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-12 text-center font-sans">
        <RefreshCw size={24} className="animate-spin text-[var(--color-primary)] mb-3" />
        <span className="font-semibold text-sm text-[var(--color-text)]">
          Rebuilding Evidence-Based Comparison...
        </span>
        <span className="text-xs text-[var(--color-text-muted)] mt-1">
          Traceable correlation across Project Code, Test Suite, and Execution Outcomes
        </span>
      </div>
    );
  }

  if (error && !comparison) {
    return (
      <div className="p-8 text-center text-xs font-sans flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)] flex items-center justify-center">
          <AlertTriangle size={20} />
        </div>
        <p className="font-semibold text-sm text-[var(--color-danger)]">{error}</p>
        <p className="text-xs text-[var(--color-text-secondary)] max-w-md">
          Unable to generate comparison across specified snapshots. Verify snapshots exist and belong to the project.
        </p>
        <button
          onClick={() => loadComparison(true)}
          className="mt-2 px-3.5 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] text-xs font-semibold cursor-pointer"
        >
          Retry Comparison
        </button>
      </div>
    );
  }

  const conclusions = comparison?.conclusions || {};
  const outcomes = comparison?.executionOutcomesComparison || {};
  const testSuite = comparison?.testSuiteComparison || {};
  const projectCode = comparison?.projectCodeComparison || {};
  const diagnostics = comparison?.selectionDiagnostics || {};
  const actionableFindings = comparison?.actionableFindings || [];

  const isSameSnapshot =
    comparison?.isSameSnapshot || comparison?.comparisonMode === "SAME_SNAPSHOT_RUN_DIFF";
  const regressionsCount = outcomes.scenarioTransitions?.regressions?.length || 0;
  const fixesCount = outcomes.scenarioTransitions?.fixes?.length || 0;
  const unexecutedCount = outcomes.scenarioTransitions?.unexecuted?.length || 0;

  return (
    <div
      id="before-after-comparison-view"
      className="flex flex-col h-full font-sans text-[var(--color-text)] bg-[var(--color-bg)] overflow-hidden"
    >
      {/* 1. TOP TOOLBAR: Selectors, Diagnostics & Direct Navigation */}
      <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)]">
              <GitCompare size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wide">
                  Before / After Comparison
                </h3>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                    isSameSnapshot
                      ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/25"
                      : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25"
                  }`}
                >
                  {isSameSnapshot ? "Same-Snapshot Run Diff" : "Project Version Diff"}
                </span>
              </div>
              <span className="text-[11px] text-[var(--color-text-muted)]">
                Traceable 3-Dimension Evidence: Code • Test Suite • Execution Outcomes
              </span>
            </div>
          </div>

          {/* Selectors Strip */}
          <div className="flex flex-wrap items-center gap-2 bg-[var(--color-bg)] p-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] text-xs font-mono">
            {/* Baseline Snapshot */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] pl-1">
                Baseline:
              </span>
              <select
                id="select-baseline-snapshot"
                value={baselineSnapshotId || ""}
                onChange={(e) => {
                  setBaselineSnapshotId(e.target.value);
                  setBaselineRunId("");
                }}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-0.5 text-xs text-[var(--color-text)] focus:outline-none"
              >
                {availableSnapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    Snap {s.id.substring(0, 8)} {s.commitSha ? `(${s.commitSha.substring(0, 7)})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <ArrowRight size={13} className="text-[var(--color-text-muted)]" />

            {/* Current Snapshot */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] pl-1">
                Current:
              </span>
              <select
                id="select-current-snapshot"
                value={currentSnapshotId || ""}
                onChange={(e) => {
                  setCurrentSnapshotId(e.target.value);
                  setCurrentRunId("");
                }}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-0.5 text-xs text-[var(--color-text)] focus:outline-none"
              >
                {availableSnapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    Snap {s.id.substring(0, 8)} {s.commitSha ? `(${s.commitSha.substring(0, 7)})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Test Run Pickers */}
            {(baselineRuns.length > 0 || currentRuns.length > 0) && (
              <>
                <div className="h-4 w-px bg-[var(--color-border)] mx-1" />
                <div className="flex items-center gap-1">
                  <span className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">
                    Run A:
                  </span>
                  <select
                    id="select-baseline-run"
                    value={baselineRunId || ""}
                    onChange={(e) => setBaselineRunId(e.target.value)}
                    className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-xs text-[var(--color-text)] focus:outline-none max-w-[130px]"
                  >
                    <option value="">Latest Run</option>
                    {baselineRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id.substring(0, 7)} ({r.status})
                      </option>
                    ))}
                  </select>
                </div>

                <ArrowRight size={12} className="text-[var(--color-text-muted)]" />

                <div className="flex items-center gap-1">
                  <span className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">
                    Run B:
                  </span>
                  <select
                    id="select-current-run"
                    value={currentRunId || ""}
                    onChange={(e) => setCurrentRunId(e.target.value)}
                    className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-xs text-[var(--color-text)] focus:outline-none max-w-[130px]"
                  >
                    <option value="">Latest Run</option>
                    {currentRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id.substring(0, 7)} ({r.status})
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {onBackToWorkspace && (
            <button
              onClick={onBackToWorkspace}
              className="px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
            >
              Back to Workspace
            </button>
          )}
          <button
            onClick={() => loadComparison(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90 cursor-pointer disabled:opacity-50"
            title="Recalculate evidence and diffs"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            <span>Re-Compare</span>
          </button>
        </div>
      </div>

      {/* 2. DIAGNOSTICS & AMBIGUITY ALERTS BANNER */}
      {diagnostics?.isSameRun && (
        <div className="px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/25 flex items-center justify-between text-xs text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            <span>
              <strong>Identical Test Runs Selected:</strong> Cannot compare a test run with itself. Select two distinct execution runs to trace transitions.
            </span>
          </div>
          {currentRuns.length > 1 && (
            <button
              onClick={() => {
                if (currentRuns.length >= 2) {
                  setBaselineRunId(currentRuns[1].id);
                  setCurrentRunId(currentRuns[0].id);
                }
              }}
              className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-xs font-semibold cursor-pointer border border-amber-500/30"
            >
              Auto-Select Distinct Runs
            </button>
          )}
        </div>
      )}

      {diagnostics?.isAmbiguousBaseline && diagnostics?.ambiguityNotice && !diagnostics.isSameRun && (
        <div className="px-5 py-2 bg-blue-500/10 border-b border-blue-500/20 flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
          <Info size={14} className="shrink-0" />
          <span>{diagnostics.ambiguityNotice}</span>
        </div>
      )}

      {/* SCROLLABLE MAIN BODY */}
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        {/* 3. ACTIONABLE FINDINGS HERO RIBBON (What Changed & Why It Matters) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] font-mono">
              Actionable Findings & Verification Verdict
            </span>
            <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
              Click any finding to inspect evidence proof
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Card 1: Regressions Status */}
            <div
              onClick={() => jumpToOutcomes("REGRESSIONS")}
              className={`p-3.5 rounded-[var(--radius-md)] border flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.01] ${
                regressionsCount > 0
                  ? "bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300 shadow-sm"
                  : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider font-mono">
                  1. Regressions
                </span>
                {regressionsCount > 0 ? (
                  <ShieldAlert size={16} className="text-rose-500" />
                ) : (
                  <ShieldCheck size={16} className="text-[var(--color-success)]" />
                )}
              </div>
              <div>
                <div className="text-sm font-extrabold flex items-center gap-1.5">
                  <span>{regressionsCount} Regression(s)</span>
                </div>
                <p className="text-[11px] opacity-85 mt-1 leading-snug">
                  {regressionsCount > 0
                    ? `${regressionsCount} scenario(s) that previously passed are now failing.`
                    : "Zero scenario regressions detected between compared runs."}
                </p>
              </div>
              <div className="mt-2 pt-2 border-t border-current/15 flex items-center justify-between text-[10px] font-semibold">
                <span>{regressionsCount > 0 ? "Inspect broken scenarios" : "Status stable"}</span>
                <ChevronRight size={12} />
              </div>
            </div>

            {/* Card 2: Fixes & Improvements */}
            <div
              onClick={() => jumpToOutcomes("FIXES")}
              className={`p-3.5 rounded-[var(--radius-md)] border flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.01] ${
                fixesCount > 0
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 shadow-sm"
                  : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider font-mono">
                  2. Verified Fixes
                </span>
                <CheckCircle2
                  size={16}
                  className={fixesCount > 0 ? "text-emerald-500" : "text-[var(--color-text-muted)]"}
                />
              </div>
              <div>
                <div className="text-sm font-extrabold">
                  <span>{fixesCount} Fix(es) Verified</span>
                </div>
                <p className="text-[11px] opacity-85 mt-1 leading-snug">
                  {fixesCount > 0
                    ? `${fixesCount} scenario(s) that previously failed are now passing.`
                    : "No failing scenarios transitioned to passing in this execution."}
                </p>
              </div>
              <div className="mt-2 pt-2 border-t border-current/15 flex items-center justify-between text-[10px] font-semibold">
                <span>{fixesCount > 0 ? "Review resolved bugs" : "No fixes recorded"}</span>
                <ChevronRight size={12} />
              </div>
            </div>

            {/* Card 3: Test Suite Evolution & Scope */}
            <div
              onClick={() => jumpToTestSuite("ENDPOINTS")}
              className="p-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.01]"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-[var(--color-text-secondary)]">
                  3. Test Suite Evolution
                </span>
                <Zap size={16} className="text-[var(--color-primary)]" />
              </div>
              <div>
                <div className="text-sm font-extrabold text-[var(--color-text)]">
                  {testSuite.scenariosDiff?.summary?.newTestsCount || 0} New / {testSuite.scenariosDiff?.summary?.modifiedTestsCount || 0} Mod
                </div>
                <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 leading-snug">
                  {comparison?.coverageDiff?.comparisonAvailable &&
                  comparison?.coverageDiff?.metrics?.endpointCoverage ? (
                    <span>
                      Endpoints: {comparison.coverageDiff.metrics.endpointCoverage.baseline?.covered}/{comparison.coverageDiff.metrics.endpointCoverage.baseline?.total} → {comparison.coverageDiff.metrics.endpointCoverage.current?.covered}/{comparison.coverageDiff.metrics.endpointCoverage.current?.total}
                      {comparison.coverageDiff.metrics.endpointCoverage.deltaPct != null && (
                        <strong className="ml-1">
                          ({comparison.coverageDiff.metrics.endpointCoverage.deltaPct > 0 ? "+" : ""}
                          {comparison.coverageDiff.metrics.endpointCoverage.deltaPct.toFixed(1)}%)
                        </strong>
                      )}
                    </span>
                  ) : (
                    <span>{conclusions.reasons?.testCoverage || "Discovered endpoints compared."}</span>
                  )}
                </p>
              </div>
              <div className="mt-2 pt-2 border-t border-[var(--color-border)] flex items-center justify-between text-[10px] font-semibold text-[var(--color-text-muted)]">
                <span>Explore Suite & Endpoints</span>
                <ChevronRight size={12} />
              </div>
            </div>

            {/* Card 4: Project Application Code */}
            <div
              onClick={() => jumpToProjectCode()}
              className="p-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.01]"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-[var(--color-text-secondary)]">
                  4. Project Code Revision
                </span>
                <FileCode size={16} className="text-amber-500" />
              </div>
              <div>
                <div className="text-sm font-extrabold text-[var(--color-text)]">
                  {projectCode.status === "NO_SOURCE_CODE_CHANGES"
                    ? "Code Unchanged"
                    : `${projectCode.modifiedCount || 0} Modified Files`}
                </div>
                <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 leading-snug">
                  {projectCode.status === "NO_SOURCE_CODE_CHANGES"
                    ? isSameSnapshot
                      ? "Identical snapshot revision. Running tests does not alter source code."
                      : "Source trees have identical SHA-256 tree fingerprints."
                    : `${projectCode.newCount || 0} added, ${projectCode.modifiedCount || 0} modified, ${projectCode.deletedCount || 0} deleted source files.`}
                </p>
              </div>
              <div className="mt-2 pt-2 border-t border-[var(--color-border)] flex items-center justify-between text-[10px] font-semibold text-[var(--color-text-muted)]">
                <span>View line-level diffs</span>
                <ChevronRight size={12} />
              </div>
            </div>
          </div>
        </div>

        {/* 4. THREE SEGREGATED DIMENSION TABS */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2 font-sans">
          {/* Dimension 1 Tab */}
          <button
            id="tab-execution-outcomes"
            onClick={() => setActiveTab("OUTCOMES")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold cursor-pointer border transition-colors ${
              activeTab === "OUTCOMES"
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text)]"
            }`}
          >
            <PlayCircle size={14} />
            <span>1. Execution Outcomes</span>
            {regressionsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-500 text-white font-bold">
                {regressionsCount} Regr
              </span>
            )}
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-black/10">
              {transitionsList.length}
            </span>
          </button>

          {/* Dimension 2 Tab */}
          <button
            id="tab-test-suite"
            onClick={() => setActiveTab("TESTS")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold cursor-pointer border transition-colors ${
              activeTab === "TESTS"
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text)]"
            }`}
          >
            <Zap size={14} />
            <span>2. Test Suite & Endpoints</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-black/10">
              {endpointList.length} routes
            </span>
          </button>

          {/* Dimension 3 Tab */}
          <button
            id="tab-project-code"
            onClick={() => setActiveTab("CODE")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold cursor-pointer border transition-colors ${
              activeTab === "CODE"
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text)]"
            }`}
          >
            <FileCode size={14} />
            <span>3. Project Source Code</span>
            {projectCode.status === "NO_SOURCE_CODE_CHANGES" ? (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[var(--color-success)]/10 text-[var(--color-success)] font-semibold">
                Unchanged
              </span>
            ) : (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">
                {sourceFilesList.length} files
              </span>
            )}
          </button>
        </div>

        {/* 5. TAB CONTENT PANES */}

        {/* ===================== PANE 1: EXECUTION OUTCOMES ===================== */}
        {activeTab === "OUTCOMES" && (
          <div className="flex flex-col gap-3">
            {!outcomes.comparisonAvailable ? (
              <div className="p-10 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col items-center justify-center text-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)] flex items-center justify-center">
                  <PlayCircle size={24} />
                </div>
                <h4 className="text-sm font-bold text-[var(--color-text)]">
                  Execution Outcomes Comparison Unavailable
                </h4>
                <p className="text-xs text-[var(--color-text-secondary)] max-w-md font-mono leading-relaxed">
                  {outcomes.reason ||
                    "At least two distinct TestRun execution records are required to trace Pass/Fail transitions."}
                </p>
                {outcomes.nextAction && (
                  <div className="text-xs font-semibold text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-3.5 py-1.5 rounded-md border border-[var(--color-primary)]/20 mt-1">
                    Next Action: {outcomes.nextAction}
                  </div>
                )}
                {onBackToWorkspace && (
                  <button
                    onClick={onBackToWorkspace}
                    className="mt-2 px-4 py-2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs font-semibold hover:bg-[var(--color-surface-hover)] cursor-pointer"
                  >
                    Go to Workspace (Run Tests)
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Metrics Summary Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 text-center font-mono text-xs">
                  <div className="bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 rounded-[var(--radius-md)]">
                    <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Compared</div>
                    <div className="font-bold text-sm text-[var(--color-text)] mt-0.5">
                      {transitionsList.length}
                    </div>
                  </div>

                  <div
                    className={`p-2.5 rounded-[var(--radius-md)] border ${
                      regressionsCount > 0
                        ? "bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400"
                        : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]"
                    }`}
                  >
                    <div className="text-[10px] uppercase font-bold opacity-80">Regressions</div>
                    <div className="font-extrabold text-sm mt-0.5">{regressionsCount}</div>
                  </div>

                  <div
                    className={`p-2.5 rounded-[var(--radius-md)] border ${
                      fixesCount > 0
                        ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]"
                    }`}
                  >
                    <div className="text-[10px] uppercase font-bold opacity-80">Fixes</div>
                    <div className="font-extrabold text-sm mt-0.5">{fixesCount}</div>
                  </div>

                  <div className="bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 rounded-[var(--radius-md)]">
                    <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Stable Pass</div>
                    <div className="font-bold text-sm text-[var(--color-success)] mt-0.5">
                      {outcomes.scenarioTransitions?.stablePass?.length || 0}
                    </div>
                  </div>

                  <div className="bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 rounded-[var(--radius-md)]">
                    <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Unexecuted</div>
                    <div className="font-bold text-sm text-amber-500 mt-0.5">
                      {unexecutedCount}
                    </div>
                  </div>

                  <div className="bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 rounded-[var(--radius-md)]">
                    <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Duration Δ</div>
                    <div className="font-bold text-sm text-[var(--color-text)] mt-0.5">
                      {outcomes.durationDiffMs != null
                        ? `${outcomes.durationDiffMs > 0 ? "+" : ""}${outcomes.durationDiffMs.toFixed(0)}ms`
                        : "N/A"}
                    </div>
                  </div>

                  <div className="bg-[var(--color-surface)] border border-[var(--color-border)] p-2.5 rounded-[var(--radius-md)]">
                    <div className="text-[10px] uppercase text-[var(--color-text-muted)]">Line Cov Δ</div>
                    <div className="font-bold text-sm text-[var(--color-text)] mt-0.5">
                      {outcomes.coverageArtifactDiff?.comparable &&
                      outcomes.coverageArtifactDiff?.deltaLinesPct != null
                        ? `${outcomes.coverageArtifactDiff.deltaLinesPct > 0 ? "+" : ""}${outcomes.coverageArtifactDiff.deltaLinesPct.toFixed(1)}%`
                        : "Unavailable"}
                    </div>
                  </div>
                </div>

                {/* Scenario Transitions Table */}
                <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden flex flex-col">
                  {/* Filter Toolbar */}
                  <div className="p-3 border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--color-surface-secondary)]/30">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {[
                        { id: "ALL", label: `All (${transitionsList.length})` },
                        {
                          id: "REGRESSIONS",
                          label: `Regressions (${regressionsCount})`,
                          alert: regressionsCount > 0
                        },
                        { id: "FIXES", label: `Fixes (${fixesCount})` },
                        {
                          id: "STABLE_PASS",
                          label: `Stable Pass (${outcomes.scenarioTransitions?.stablePass?.length || 0})`
                        },
                        {
                          id: "STABLE_FAIL",
                          label: `Stable Fail (${outcomes.scenarioTransitions?.stableFail?.length || 0})`
                        },
                        {
                          id: "UNEXECUTED",
                          label: `Unexecuted (${unexecutedCount})`,
                          amber: unexecutedCount > 0
                        },
                        {
                          id: "NEW",
                          label: `New Runs (${outcomes.scenarioTransitions?.newScenarios?.length || 0})`
                        }
                      ].map((f) => (
                        <button
                          key={f.id}
                          onClick={() => setScenarioFilter(f.id)}
                          className={`px-2.5 py-1 rounded text-[11px] font-mono cursor-pointer transition-colors border ${
                            scenarioFilter === f.id
                              ? f.alert
                                ? "bg-rose-500 text-white border-rose-500 font-bold"
                                : f.amber
                                ? "bg-amber-500 text-white border-amber-500 font-bold"
                                : "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)] font-semibold"
                              : f.alert
                              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 font-bold"
                              : f.amber
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 font-bold"
                              : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    <div className="relative min-w-[220px]">
                      <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--color-text-muted)]" />
                      <input
                        type="text"
                        placeholder="Search scenario, suite, endpoint..."
                        value={scenarioSearchQuery}
                        onChange={(e) => setScenarioSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none font-mono"
                      />
                    </div>
                  </div>

                  {/* Scenarios List */}
                  <div className="max-h-[520px] overflow-y-auto divide-y divide-[var(--color-border)]/60">
                    {filteredScenarios.length === 0 ? (
                      <div className="p-10 text-center text-xs text-[var(--color-text-muted)] font-mono">
                        No test scenarios match current filter criteria.
                      </div>
                    ) : (
                      filteredScenarios.map((sc, i) => {
                        const isRegression = sc.statusA === "PASSED" && sc.statusB === "FAILED";
                        const isFix = sc.statusA === "FAILED" && sc.statusB === "PASSED";
                        const isUnexecuted =
                          sc.transitionType === "UNEXECUTED" || sc.statusB === "UNEXECUTED";
                        const isExpanded = expandedScenarios[sc.testName || i];

                        return (
                          <div
                            key={i}
                            className={`p-3.5 flex flex-col gap-2 text-xs font-mono transition-colors ${
                              isRegression
                                ? "bg-rose-500/5 hover:bg-rose-500/10"
                                : isFix
                                ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                                : "hover:bg-[var(--color-surface-secondary)]/30"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                {/* Transition Badge */}
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${
                                    isRegression
                                      ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40"
                                      : isFix
                                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
                                      : isUnexecuted
                                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40"
                                      : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                                  }`}
                                >
                                  {sc.statusA || "UNRUN"} → {sc.statusB || "UNRUN"}
                                </span>

                                <div className="flex items-center gap-1.5 truncate">
                                  {sc.suiteName && (
                                    <span className="text-[var(--color-text-muted)] shrink-0">
                                      {sc.suiteName} &gt;
                                    </span>
                                  )}
                                  <span
                                    className="font-bold text-[var(--color-text)] truncate"
                                    title={sc.testName}
                                  >
                                    {sc.testName}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 shrink-0 text-[11px] text-[var(--color-text-muted)]">
                                {sc.testFile && (
                                  <button
                                    onClick={() => jumpToProjectCode(sc.testFile)}
                                    className="text-[10px] text-[var(--color-primary)] hover:underline flex items-center gap-1"
                                    title={`View ${sc.testFile}`}
                                  >
                                    <FileCode size={11} />
                                    <span>{sc.testFile.split("/").pop()}</span>
                                  </button>
                                )}

                                {sc.durationMs != null && <span>{sc.durationMs.toFixed(0)}ms</span>}

                                {(sc.failureMessages?.length > 0 || sc.error || sc.unexecutedReason) && (
                                  <button
                                    onClick={() => toggleScenarioExpand(sc.testName || i)}
                                    className={`flex items-center gap-1 text-[11px] font-semibold cursor-pointer ${
                                      isRegression
                                        ? "text-rose-600 dark:text-rose-400"
                                        : "text-[var(--color-primary)]"
                                    }`}
                                  >
                                    <span>Details</span>
                                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Expandable Technical Failure & Execution Details */}
                            {isExpanded && (
                              <div className="mt-1 p-3 rounded bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col gap-2 text-[11px]">
                                {sc.unexecutedReason && (
                                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold">
                                    <AlertTriangle size={13} />
                                    <span>{sc.unexecutedReason}</span>
                                  </div>
                                )}

                                {sc.failureStep && (
                                  <div className="text-[var(--color-text-secondary)]">
                                    <strong>Failure Step:</strong> {sc.failureStep}
                                  </div>
                                )}

                                {(sc.failureMessages?.length > 0 || sc.error) && (
                                  <div className="p-2.5 rounded bg-rose-500/5 border border-rose-500/25 text-rose-600 dark:text-rose-400 whitespace-pre-wrap overflow-x-auto font-mono text-[10px]">
                                    {sc.failureMessages?.join("\n") || sc.error}
                                  </div>
                                )}
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
          </div>
        )}

        {/* ===================== PANE 2: TEST SUITE & ENDPOINTS ===================== */}
        {activeTab === "TESTS" && (
          <div className="flex flex-col gap-3">
            {/* Sub-tab Switcher: Endpoints Scope vs Scenarios Inventory */}
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTestSuiteSubTab("ENDPOINTS")}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer border ${
                    testSuiteSubTab === "ENDPOINTS"
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border)]"
                      : "bg-transparent text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text)]"
                  }`}
                >
                  Endpoint Coverage Scope ({endpointList.length})
                </button>
                <button
                  onClick={() => setTestSuiteSubTab("SCENARIOS")}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer border ${
                    testSuiteSubTab === "SCENARIOS"
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border)]"
                      : "bg-transparent text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text)]"
                  }`}
                >
                  Scenario Inventory Diff ({suiteScenariosList.length})
                </button>
              </div>

              {testSuiteSubTab === "ENDPOINTS" && comparison?.coverageDiff?.comparisonAvailable && (
                <div className="text-xs font-mono text-[var(--color-text-secondary)]">
                  Endpoint Delta:{" "}
                  <strong className="text-[var(--color-text)]">
                    {comparison.coverageDiff.metrics.endpointCoverage.deltaPct > 0 ? "+" : ""}
                    {comparison.coverageDiff.metrics.endpointCoverage.deltaPct?.toFixed(1)}%
                  </strong>
                </div>
              )}
            </div>

            {/* Sub-view A: Endpoint Coverage Scope */}
            {testSuiteSubTab === "ENDPOINTS" && (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden flex flex-col">
                <div className="p-3 border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--color-surface-secondary)]/30">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {[
                      { id: "ALL", label: `All (${endpointList.length})` },
                      { id: "NEWLY_COVERED", label: "Newly Covered" },
                      { id: "LOST_COVERAGE", label: "Lost Coverage" },
                      { id: "COVERED_IN_BOTH", label: "Covered in Both" },
                      { id: "UNCOVERED", label: "Untested Gaps" }
                    ].map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setEndpointFilter(f.id)}
                        className={`px-2.5 py-1 rounded text-[11px] font-mono cursor-pointer border transition-colors ${
                          endpointFilter === f.id
                            ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)] font-semibold"
                            : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative min-w-[200px]">
                    <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--color-text-muted)]" />
                    <input
                      type="text"
                      placeholder="Search route or method..."
                      value={endpointSearchQuery}
                      onChange={(e) => setEndpointSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none font-mono"
                    />
                  </div>
                </div>

                {/* Endpoint Items List */}
                <div className="max-h-[500px] overflow-y-auto divide-y divide-[var(--color-border)]/60">
                  {filteredEndpoints.length === 0 ? (
                    <div className="p-10 text-center text-xs text-[var(--color-text-muted)] font-mono">
                      No endpoint records match current filter criteria.
                    </div>
                  ) : (
                    filteredEndpoints.map((ep, i) => {
                      const [method, route] = ep.identity.split(" ");
                      const methodColor =
                        HTTP_METHOD_COLORS[method] ||
                        "bg-gray-500/10 text-gray-500 border-gray-500/20";
                      const statusColor =
                        ep.coverageStatus === "COVERED_IN_BOTH"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                          : ep.coverageStatus === "NEWLY_COVERED"
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25"
                          : ep.coverageStatus === "LOST_COVERAGE"
                          ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25"
                          : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]";

                      const isExpanded = expandedEndpoints[ep.identity];
                      const totalScenarios = (ep.scenariosB?.length || 0) + (ep.scenariosA?.length || 0);

                      return (
                        <div
                          key={i}
                          className="p-3.5 flex flex-col gap-2 text-xs font-mono hover:bg-[var(--color-surface-secondary)]/25 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border shrink-0 ${methodColor}`}
                              >
                                {method}
                              </span>
                              <span
                                className="font-bold text-[var(--color-text)] truncate"
                                title={route}
                              >
                                {route}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[9px] font-bold border shrink-0 ${statusColor}`}
                              >
                                {ep.coverageStatus}
                              </span>
                            </div>

                            <div className="flex items-center gap-3 shrink-0 text-[11px] text-[var(--color-text-muted)]">
                              <span>
                                Tests: {ep.testCountA} &rarr;{" "}
                                <strong className="text-[var(--color-text)]">{ep.testCountB}</strong>
                              </span>
                              {totalScenarios > 0 && (
                                <button
                                  onClick={() => toggleEndpointExpand(ep.identity)}
                                  className="text-[var(--color-primary)] hover:underline cursor-pointer flex items-center gap-0.5 font-semibold"
                                >
                                  <span>Scenarios</span>
                                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Scenarios breakdown */}
                          {isExpanded && (
                            <div className="mt-1 p-3 rounded bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col gap-2 text-[11px]">
                              <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)]">
                                Current Scenarios ({ep.scenariosB?.length || 0}):
                              </div>
                              {ep.scenariosB?.length === 0 ? (
                                <span className="text-[var(--color-text-muted)]">
                                  No active test scenarios mapped to this route.
                                </span>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {ep.scenariosB?.map((s, idx) => (
                                    <div
                                      key={idx}
                                      className="px-2.5 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center gap-2"
                                    >
                                      <span
                                        className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                                          CATEGORY_COLORS[s] || CATEGORY_COLORS.OTHER
                                        }`}
                                      >
                                        {s}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Sub-view B: Scenario Inventory Diff */}
            {testSuiteSubTab === "SCENARIOS" && (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden flex flex-col">
                <div className="p-3 border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--color-surface-secondary)]/30">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {[
                      { id: "ALL", label: `All (${suiteScenariosList.length})` },
                      {
                        id: "NEW",
                        label: `New (${testSuite.scenariosDiff?.summary?.newTestsCount || 0})`
                      },
                      {
                        id: "MODIFIED",
                        label: `Modified (${testSuite.scenariosDiff?.summary?.modifiedTestsCount || 0})`
                      },
                      {
                        id: "REMOVED",
                        label: `Removed (${testSuite.scenariosDiff?.summary?.removedTestsCount || 0})`
                      },
                      {
                        id: "UNCHANGED",
                        label: `Unchanged (${testSuite.scenariosDiff?.summary?.unchangedTestsCount || 0})`
                      }
                    ].map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setScenarioSuiteFilter(f.id)}
                        className={`px-2.5 py-1 rounded text-[11px] font-mono cursor-pointer border transition-colors ${
                          scenarioSuiteFilter === f.id
                            ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)] font-semibold"
                            : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative min-w-[200px]">
                    <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--color-text-muted)]" />
                    <input
                      type="text"
                      placeholder="Search scenario title..."
                      value={scenarioSuiteSearch}
                      onChange={(e) => setScenarioSuiteSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <div className="max-h-[500px] overflow-y-auto divide-y divide-[var(--color-border)]/60">
                  {filteredSuiteScenarios.length === 0 ? (
                    <div className="p-10 text-center text-xs text-[var(--color-text-muted)] font-mono">
                      No test scenarios match current filter criteria.
                    </div>
                  ) : (
                    filteredSuiteScenarios.map((sc, i) => (
                      <div
                        key={i}
                        className="p-3.5 flex flex-col gap-1.5 text-xs font-mono hover:bg-[var(--color-surface-secondary)]/25 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 truncate">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-bold border shrink-0 ${
                                sc.diffStatus === "NEW"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                                  : sc.diffStatus === "MODIFIED"
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25"
                                  : sc.diffStatus === "REMOVED"
                                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25"
                                  : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                              }`}
                            >
                              {sc.diffStatus}
                            </span>
                            <span className="font-bold text-[var(--color-text)] truncate">
                              {sc.testName || sc.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 text-[11px] text-[var(--color-text-muted)]">
                            {sc.expectedStatus && <span>status: {sc.expectedStatus}</span>}
                            {sc.filePath && <span>{sc.filePath.split("/").pop()}</span>}
                          </div>
                        </div>

                        {sc.changedFields?.length > 0 && (
                          <div className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/5 px-2 py-1 rounded border border-amber-500/20">
                            Changed: {sc.changedFields.join(", ")}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================== PANE 3: PROJECT SOURCE CODE ===================== */}
        {activeTab === "CODE" && (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden flex flex-col">
            {projectCode.status === "NO_SOURCE_CODE_CHANGES" ? (
              <div className="p-12 text-center flex flex-col items-center justify-center gap-3 font-sans">
                <div className="w-12 h-12 rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)] flex items-center justify-center">
                  <CheckCircle2 size={26} />
                </div>
                <h4 className="text-sm font-bold text-[var(--color-text)]">
                  NO SOURCE CODE CHANGES DETECTED
                </h4>
                <p className="text-xs text-[var(--color-text-secondary)] max-w-md font-mono leading-relaxed">
                  All tracked application files match the baseline revision with identical SHA-256 tree fingerprints.
                  Running integration tests does not modify project application source files.
                </p>
                <div className="flex items-center gap-2 text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-bg)] px-3 py-1.5 rounded border border-[var(--color-border)] mt-2">
                  <span>Tracked files: {comparison?.sourceDiff?.summary?.totalFilesA || 0}</span>
                  <span>•</span>
                  <span>
                    Composite Hash:{" "}
                    {comparison?.sourceDiff?.baseline?.compositeHash?.substring(0, 16) || "Verified"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-12 min-h-[520px]">
                {/* Left: Changed Source Files List */}
                <div className="md:col-span-4 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface-secondary)]/20">
                  <div className="p-3 border-b border-[var(--color-border)] flex flex-col gap-2">
                    <span className="text-[10px] font-bold uppercase font-mono text-[var(--color-text-secondary)]">
                      Modified Application Files ({sourceFilesList.length})
                    </span>
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--color-text-muted)]" />
                      <input
                        type="text"
                        placeholder="Filter source files..."
                        value={fileSearchQuery}
                        onChange={(e) => setFileSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)]/50">
                    {filteredSourceFiles.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[var(--color-text-muted)] font-mono">
                        No matching source files.
                      </div>
                    ) : (
                      filteredSourceFiles.map((file) => {
                        const isSelected = selectedFile === file.filePath;
                        const statusColor =
                          file.status === "NEW"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                            : file.status === "DELETED"
                            ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25";

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
                            <div className="flex items-center justify-between gap-1.5">
                              <span
                                className="font-mono font-medium text-[var(--color-text)] truncate flex-1"
                                title={file.filePath}
                              >
                                {file.filePath}
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono border ${statusColor}`}
                              >
                                {file.status}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--color-text-muted)]">
                              <span className="text-[var(--color-success)]">+{file.additions}</span>
                              <span className="text-[var(--color-danger)]">-{file.deletions}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Right: Monaco Diff Editor */}
                <div className="md:col-span-8 flex flex-col h-[520px] bg-[var(--color-bg)]">
                  {selectedFile ? (
                    <div className="flex flex-col h-full">
                      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center justify-between text-xs font-mono bg-[var(--color-surface)]">
                        <span className="font-bold text-[var(--color-text)] truncate">{selectedFile}</span>
                        <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-secondary)] shrink-0">
                          <span>
                            Baseline: {fileDiffData?.existsInBaseline ? "Present" : "Absent"}
                          </span>
                          <span>&bull;</span>
                          <span>
                            Current: {fileDiffData?.existsInCurrent ? "Present" : "Absent"}
                          </span>
                        </div>
                      </div>

                      <div className="flex-1 overflow-hidden">
                        {fileDiffLoading ? (
                          <div className="flex items-center justify-center h-full text-xs text-[var(--color-text-secondary)]">
                            <RefreshCw size={16} className="animate-spin text-[var(--color-primary)] mr-2" />
                            <span>Loading file diff...</span>
                          </div>
                        ) : (
                          <DiffEditor
                            original={fileDiffData?.oldContent || ""}
                            modified={fileDiffData?.newContent || ""}
                            keepCurrentOriginalModel={true}
                            keepCurrentModifiedModel={true}
                            language={selectedFile.endsWith(".json") ? "json" : "javascript"}
                            theme={isDarkMode ? "vs-dark" : "light"}
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
                    <div className="flex items-center justify-center h-full text-xs text-[var(--color-text-muted)] font-mono">
                      Select a modified source file from the left to view line-level diff.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
