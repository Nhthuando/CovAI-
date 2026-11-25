import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  Clock,
  Download,
  FileCheck,
  History,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTheme } from "../../../contexts/ThemeContext";
import { useRunningProcess } from "../../../contexts/RunningProcessContext.jsx";
import { useProjectAccess } from "../../../hooks/useProjectAccess";
import { useChatTestContext } from "../../../hooks/useChatTestContext";
import {
  useCoverageDashboard,
  invalidateCoverageQueries,
  invalidateProjectTree,
  updateCoverageFilesData,
} from "../../../hooks/useCoverageQuery.js";
import {
  applyUnitTestSuggestion,
  aiFixUnitTestCaseApi,
  addUnitTestCaseApi,
  updateUnitTestCaseApi,
  deleteUnitTestCaseApi,
  getUnitTestVersions,
  installMissingDependencies,
  runCoverageByType,
  suggestAllUnitTestcases,
  switchUnitTestVersion,
} from "../../../services/coverage.service.js";
import {
  loadStagedOps,
  saveStagedOps,
  stageAddOp,
  stageUpdateOp,
  stageDeleteOp,
  countStagedOps,
  matchesStagedTarget,
  extractBlockTitle,
} from "../../../lib/stagedScenarioOps.js";
import {
  cancelJobApi,
  getJobDetailApi,
  getProjectJobsApi,
} from "../../../services/job.service.js";
import {
  applyBatchResultToSuggestionsMap,
  buildUnitTestReviewFiles,
  normalizeReviewTestFile,
  summarizeApplyBatchResult,
} from "../../../services/unitTestReview.js";
import { needsUnitTestSuggestion } from "../../../services/unitTestSuggestionQueue.js";
import { getAccessToken } from "../../../lib/authSession.js";
import { saveMatrixSelection } from "../../../lib/matrixSelectionStorage.js";
import { useToast } from "../ToastContext";
import UnitTestPackageInstaller from "../UnitTestPackageInstaller.jsx";
import UnitTestVersionHistoryView from "../UnitTestVersionHistoryView.jsx";
import DiffReviewModal, {
  extractTestCasesFromCode,
} from "../DiffReviewModal.jsx";
import UnitTestSimulationStudioModal from "../simulation/UnitTestSimulationStudioModal.jsx";
import { ExportUnitTestReportModal } from "../modals/ExportUnitTestReportModal.jsx";
import UnitFileMatrixTable from "./UnitFileMatrixTable.jsx";
import UnitReportEmbed from "./UnitReportEmbed.jsx";
import UnitTestCaseEditorModal from "./UnitTestCaseEditorModal.jsx";
import UnitFileAnalysisModal from "./UnitFileAnalysisModal.jsx";
import ConfirmDialog from "../../common/ConfirmDialog.jsx";
import { TEST_UI, calmProgressFillClass } from "../shared/testingUiTokens.js";
import { cleanDisplayPath } from "../CoverageTypeDashboard.jsx";
import { extractMissingPackageFromError } from "../UnitTestTraceabilityMatrix.jsx";
import {
  classifyUnitTestCase,
  summarizeUnitFailure,
} from "./unitTestCaseCoverage.js";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function parseJobResultPayload(detail) {
  const raw = detail?.job?.result ?? detail?.job?.resultJson;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

function normalizePath(p = "") {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
}

function baseNameNoTestExt(filePath = "") {
  return normalizePath(filePath)
    .split("/")
    .pop()
    ?.replace(
      /(?:\.(?:partial|redundant))?\.(?:test|spec|unit)\.[cm]?[jt]sx?$/i,
      "",
    )
    .replace(/\.[cm]?[jt]sx?$/i, "")
    .toLowerCase();
}

function useUnitJobStream(jobId, onComplete, onError, onCanceled) {
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [statusLabel, setStatusLabel] = useState("");
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  const onCanceledRef = useRef(onCanceled);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
    onCanceledRef.current = onCanceled;
  }, [onComplete, onError, onCanceled]);

  useEffect(() => {
    if (!jobId) {
      setLogs([]);
      setProgress(0);
      setStatusLabel("");
      return;
    }

    let isClosed = false;
    const token = getAccessToken();
    const es = new EventSource(
      `${BASE_URL}/job/${jobId}/stream?token=${encodeURIComponent(token || "")}`,
    );

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.error) {
          isClosed = true;
          es.close();
          onErrorRef.current?.(new Error(data.error));
          return;
        }
        if (typeof data.progress === "number") setProgress(data.progress);
        if (Array.isArray(data.logs)) {
          setLogs(data.logs);
          const last = data.logs[data.logs.length - 1];
          if (last?.message) setStatusLabel(last.message);
        }
        if (data.status === "SUCCESS") {
          isClosed = true;
          es.close();
          onCompleteRef.current?.(jobId);
        } else if (data.status === "FAILED") {
          isClosed = true;
          es.close();
          onErrorRef.current?.(new Error(data.errorMessage || "Job failed"));
        } else if (data.status === "CANCELED") {
          isClosed = true;
          es.close();
          onCanceledRef.current?.();
        }
      } catch (err) {
        console.error("[UnitTestWorkspace] Failed to parse SSE:", err);
      }
    };

    es.onerror = () => {
      if (isClosed) return;
      isClosed = true;
      es.close();
      onErrorRef.current?.(new Error("Lost connection to job stream"));
    };

    return () => {
      isClosed = true;
      es.close();
    };
  }, [jobId]);

  return { logs, progress, statusLabel };
}

function UnitCockpitSkeleton() {
  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg)] font-sans overflow-hidden">
      <div className="shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-5 py-3 flex items-center justify-between">
        <div className="h-5 w-44 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
        <div className="flex items-center gap-2">
          <div className="h-7 w-24 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
          <div className="h-7 w-28 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
        </div>
      </div>
      <div className="p-5 space-y-4">
        <div className="h-24 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
        <div className="h-64 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
      </div>
    </div>
  );
}

export default function UnitTestWorkspace({
  snapshotId,
  projectId,
  onOpenFile,
  onSuggestTestcase,
  onChatContextChange,
  focusFile = null,
}) {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const projectAccess = useProjectAccess(projectId);
  const { addToast } = useToast();
  const { getSuggestions, saveSuggestions } = useRunningProcess();

  const [activeTab, setActiveTab] = useState("files");
  const matrixRef = useRef(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [setupDrawerOpen, setSetupDrawerOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Active async job state (RUN / GENERATE / APPLY)
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeJobType, setActiveJobType] = useState(null); // "RUN" | "GENERATE" | "APPLY"
  const [pendingAction, setPendingAction] = useState(null);
  const [runningTargetKey, setRunningTargetKey] = useState(null);
  const [fixingTestId, setFixingTestId] = useState(null);

  // Draft suggestions map keyed by source filePath
  const [inlineSuggestions, setInlineSuggestions] = useState(() =>
    snapshotId ? getSuggestions(snapshotId) || {} : {},
  );
  const [pendingUnitOps, setPendingUnitOps] = useState(() =>
    loadStagedOps("unit", snapshotId),
  );
  const [isApplyingPending, setIsApplyingPending] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  useEffect(() => {
    setPendingUnitOps(loadStagedOps("unit", snapshotId));
  }, [snapshotId]);

  useEffect(() => {
    saveStagedOps("unit", snapshotId, pendingUnitOps);
  }, [snapshotId, pendingUnitOps]);

  const pendingOpsCount = countStagedOps(pendingUnitOps);
  const [unitTestVersions, setUnitTestVersions] = useState({});
  const [isSwitchingVersion, setIsSwitchingVersion] = useState(false);
  const [switchingVersionFile, setSwitchingVersionFile] = useState(null);
  const [installingDeps, setInstallingDeps] = useState(false);

  // Modals
  const [editorModalState, setEditorModalState] = useState({
    isOpen: false,
    mode: "edit",
    sourceFile: "",
    testCase: null,
  });
  const [analysisFile, setAnalysisFile] = useState(null);
  const [simulationTarget, setSimulationTarget] = useState(null);
  const [diffReviewFilePath, setDiffReviewFilePath] = useState(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [selectedZeroTestFramework, setSelectedZeroTestFramework] =
    useState(null);
  const [unitRunnerPreference, setUnitRunnerPreference] = useState(() => {
    if (!snapshotId) return "auto";
    try {
      const saved = sessionStorage.getItem(`covai_unit_runner_${snapshotId}`);
      return ["auto", "jest", "vitest"].includes(saved) ? saved : "auto";
    } catch {
      return "auto";
    }
  });
  const [lastScopedAnalysis, setLastScopedAnalysis] = useState(() => {
    if (!snapshotId) return null;
    try {
      const raw = sessionStorage.getItem(`covai_unit_scoped_${snapshotId}`);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn("[UnitTestWorkspace] Failed to read scoped analysis:", err);
      return null;
    }
  });
  const [frameworkPickerModal, setFrameworkPickerModal] = useState({
    isOpen: false,
    targetPaths: null,
  });
  const [pickerChoice, setPickerChoice] = useState("jest");

  useEffect(() => {
    setSelectedZeroTestFramework(null);
    if (!snapshotId) {
      setUnitRunnerPreference("auto");
      setLastScopedAnalysis(null);
    } else {
      try {
        const savedRunner = sessionStorage.getItem(
          `covai_unit_runner_${snapshotId}`,
        );
        setUnitRunnerPreference(
          ["auto", "jest", "vitest"].includes(savedRunner)
            ? savedRunner
            : "auto",
        );
      } catch {
        setUnitRunnerPreference("auto");
      }
      try {
        const raw = sessionStorage.getItem(`covai_unit_scoped_${snapshotId}`);
        setLastScopedAnalysis(raw ? JSON.parse(raw) : null);
      } catch (err) {
        console.warn(
          "[UnitTestWorkspace] Failed to restore scoped analysis:",
          err,
        );
        setLastScopedAnalysis(null);
      }
    }
    setFrameworkPickerModal({ isOpen: false, targetPaths: null });
  }, [snapshotId]);

  useEffect(() => {
    if (!snapshotId) return;
    try {
      sessionStorage.setItem(
        `covai_unit_runner_${snapshotId}`,
        unitRunnerPreference,
      );
    } catch (err) {
      console.warn(
        "[UnitTestWorkspace] Failed to persist unit runner preference:",
        err,
      );
    }
  }, [snapshotId, unitRunnerPreference]);

  useEffect(() => {
    if (!snapshotId) return;
    try {
      if (lastScopedAnalysis) {
        sessionStorage.setItem(
          `covai_unit_scoped_${snapshotId}`,
          JSON.stringify(lastScopedAnalysis),
        );
      } else {
        sessionStorage.removeItem(`covai_unit_scoped_${snapshotId}`);
      }
    } catch (err) {
      console.warn(
        "[UnitTestWorkspace] Failed to persist scoped analysis:",
        err,
      );
    }
  }, [snapshotId, lastScopedAnalysis]);

  // Main Query
  const {
    data: dashboardData,
    isLoading,
    isFetching,
    refetch,
  } = useCoverageDashboard(snapshotId, "unit", projectId);

  const summary = dashboardData?.summary || null;
  const rawFiles = dashboardData?.files || [];
  const executions = useMemo(
    () => dashboardData?.executions || {},
    [dashboardData?.executions],
  );
  const frameworks = dashboardData?.frameworks || null;
  const functionsList = dashboardData?.functionsList || [];
  const testSuites = dashboardData?.testSuites || [];

  const unitPermutation = frameworks?.unitPermutation || null;
  const detectedUnitFrameworks = useMemo(() => {
    const supported = Array.isArray(frameworks?.supported?.unit)
      ? frameworks.supported.unit
      : [];
    const set = new Set(supported.map((f) => String(f || "").toLowerCase()));
    if (executions?.jest) set.add("jest");
    if (executions?.vitest) set.add("vitest");
    return Array.from(set).filter((f) => f === "jest" || f === "vitest");
  }, [frameworks, executions]);

  const activeFramework = useMemo(() => {
    if (unitRunnerPreference === "vitest" || unitRunnerPreference === "jest") {
      return unitRunnerPreference;
    }
    if (
      selectedZeroTestFramework === "vitest" ||
      selectedZeroTestFramework === "jest"
    ) {
      return selectedZeroTestFramework;
    }
    const permFw = unitPermutation?.resolvedFramework;
    if (permFw === "vitest" || permFw === "jest") return permFw;
    const detected =
      frameworks?.recommended || frameworks?.detected?.[0]?.framework;
    if (detected === "vitest" || detected === "jest") return detected;
    if (executions?.vitest && !executions?.jest) return "vitest";
    return "jest";
  }, [
    frameworks,
    unitPermutation,
    executions,
    selectedZeroTestFramework,
    unitRunnerPreference,
  ]);

  const effectiveRunFramework = useMemo(() => {
    if (unitRunnerPreference === "jest" || unitRunnerPreference === "vitest") {
      return unitRunnerPreference;
    }
    if (
      selectedZeroTestFramework === "jest" ||
      selectedZeroTestFramework === "vitest"
    ) {
      return selectedZeroTestFramework;
    }
    return "auto";
  }, [unitRunnerPreference, selectedZeroTestFramework]);

  const activeFrameworkBadgeLabel = useMemo(() => {
    if (unitRunnerPreference === "jest") return "JEST";
    if (unitRunnerPreference === "vitest") return "VITEST";
    if (
      detectedUnitFrameworks.includes("jest") &&
      detectedUnitFrameworks.includes("vitest")
    ) {
      return "AUTO · JEST + VITEST";
    }
    return `AUTO · ${String(activeFramework || "jest").toUpperCase()}`;
  }, [unitRunnerPreference, detectedUnitFrameworks, activeFramework]);

  // Restore / persist inline suggestions per snapshot
  const lastSnapshotRef = useRef(snapshotId);
  useEffect(() => {
    if (!snapshotId) return;
    const stored = getSuggestions(snapshotId) || {};
    if (snapshotId !== lastSnapshotRef.current) {
      lastSnapshotRef.current = snapshotId;
      setInlineSuggestions(stored);
    } else if (Object.keys(stored).length > 0) {
      setInlineSuggestions((prev) =>
        Object.keys(prev || {}).length === 0 ? stored : prev,
      );
    }
  }, [snapshotId, getSuggestions]);

  // Hydrate generated suggestions persisted in DB (from completed UNIT_TEST_SUGGEST jobs)
  // so page reloads never lose generated test scenarios until the user explicitly deletes them.
  useEffect(() => {
    const dbPersisted = executions?.persistedSuggestions;
    if (!snapshotId || !dbPersisted || typeof dbPersisted !== "object") return;
    const dbEntries = Object.entries(dbPersisted);
    if (dbEntries.length === 0) return;
    setInlineSuggestions((prev) => {
      let changed = false;
      const next = { ...(prev || {}) };
      for (const [rawKey, sugs] of dbEntries) {
        const key = cleanDisplayPath(rawKey || "");
        if (!key || !Array.isArray(sugs) || sugs.length === 0) continue;
        // If user already has local draft or explicitly emptied `[key]: []` via delete, preserve user's state
        if (Object.prototype.hasOwnProperty.call(next, key)) continue;
        next[key] = sugs;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [snapshotId, executions?.persistedSuggestions]);

  useEffect(() => {
    if (
      snapshotId &&
      inlineSuggestions &&
      Object.keys(inlineSuggestions).length > 0
    ) {
      saveSuggestions(snapshotId, inlineSuggestions);
    }
  }, [snapshotId, inlineSuggestions, saveSuggestions]);

  const loadUnitTestVersions = useCallback(async () => {
    if (!snapshotId) return;
    try {
      const res = await getUnitTestVersions(snapshotId);
      setUnitTestVersions(res?.data?.files || res?.files || {});
    } catch (_) {}
  }, [snapshotId]);

  useEffect(() => {
    loadUnitTestVersions();
  }, [loadUnitTestVersions]);

  // Hydrate running job if user navigated back while job is in flight
  useEffect(() => {
    if (!projectId || !snapshotId) return;
    let cancelled = false;
    getProjectJobsApi(projectId, { limit: 15 })
      .then((res) => {
        if (cancelled) return;
        const jobs = res?.data?.jobs || res?.jobs || [];
        const running = jobs.find(
          (j) =>
            j.snapshotId === snapshotId &&
            ["QUEUED", "RUNNING"].includes(j.status) &&
            ["RUN_TESTS", "UNIT_TEST_SUGGEST", "UNIT_TEST_APPLY"].includes(
              j.type,
            ),
        );
        if (running) {
          setActiveJobId(running.id);
          setActiveJobType(
            running.type === "UNIT_TEST_SUGGEST"
              ? "GENERATE"
              : running.type === "UNIT_TEST_APPLY"
                ? "APPLY"
                : "RUN",
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, snapshotId]);

  const handleJobCompleted = useCallback(
    async (completedJobId) => {
      const finishedType = activeJobType;
      setActiveJobId(null);
      setActiveJobType(null);
      setPendingAction(null);
      setRunningTargetKey(null);

      try {
        if (finishedType === "GENERATE" && completedJobId) {
          const detail = await getJobDetailApi(completedJobId);
          const resultData = parseJobResultPayload(detail);
          const sugList = Array.isArray(resultData?.suggestions)
            ? resultData.suggestions
            : [];
          if (sugList.length > 0) {
            setInlineSuggestions((prev) => {
              const next = { ...prev };
              const grouped = new Map();
              for (const s of sugList) {
                const key = cleanDisplayPath(s.sourceFile || "");
                if (!key) continue;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(s);
              }
              // Replace all previous unapplied AI drafts for each regenerated sourceFile
              // (even if the user switched between Jest & Vitest) while keeping PROJECT_EXISTING tests intact.
              for (const [key, freshSugs] of grouped.entries()) {
                next[key] = freshSugs;
              }
              return next;
            });
            setNotice(
              `Generated ${sugList.length} AI unit test draft(s). Review or click Apply in the matrix.`,
            );
            addToast?.({
              type: "success",
              title: "AI Unit Tests Generated",
              message: `${sugList.length} test draft(s) ready to review & apply.`,
            });
          } else {
            setNotice("AI test generation completed.");
          }
        } else if (finishedType === "APPLY" && completedJobId) {
          const detail = await getJobDetailApi(completedJobId);
          const resultData = parseJobResultPayload(detail);
          const allIds = new Set(
            Object.values(inlineSuggestions)
              .flat()
              .map((s) => s.suggestionId || s.id)
              .filter(Boolean),
          );
          setInlineSuggestions((prev) =>
            applyBatchResultToSuggestionsMap(prev, allIds, resultData),
          );
          if (resultData?.perFileResults) {
            updateCoverageFilesData(
              snapshotId,
              "unit",
              projectId,
              resultData.perFileResults,
            );
          }
          const summaryRes = summarizeApplyBatchResult(resultData, allIds.size);
          setNotice(summaryRes.message);
          if (summaryRes.errorMessage) setError(summaryRes.errorMessage);
          loadUnitTestVersions();
        } else {
          if (completedJobId) {
            const detail = await getJobDetailApi(completedJobId).catch(
              () => null,
            );
            const resultData = parseJobResultPayload(detail);
            if (resultData?.scopedCoverage?.files?.length > 0) {
              setLastScopedAnalysis(resultData.scopedCoverage);
              const lPct = resultData.scopedCoverage.total?.lines?.pct ?? 0;
              setNotice(
                `Scoped coverage analysis completed for ${resultData.scopedCoverage.files.length} selected business logic file(s): ${lPct}% lines coverage.`,
              );
            } else {
              setLastScopedAnalysis(null);
              setNotice("Unit test coverage analysis completed.");
            }
          } else {
            setLastScopedAnalysis(null);
            setNotice("Unit test coverage analysis completed.");
          }
        }
      } catch (err) {
        console.warn(
          "[UnitTestWorkspace] Post-job processing warning:",
          err?.message,
        );
      } finally {
        invalidateCoverageQueries(snapshotId);
        invalidateProjectTree(projectId);
        await refetch();
      }
    },
    [
      activeJobType,
      snapshotId,
      projectId,
      inlineSuggestions,
      addToast,
      refetch,
      loadUnitTestVersions,
    ],
  );

  const handleJobFailed = useCallback(
    (err) => {
      setActiveJobId(null);
      setActiveJobType(null);
      setPendingAction(null);
      setRunningTargetKey(null);
      setError(err?.message || "Unit test task failed.");
      invalidateCoverageQueries(snapshotId);
      refetch?.();
    },
    [snapshotId, refetch],
  );

  const handleJobCanceled = useCallback(() => {
    setActiveJobId(null);
    setActiveJobType(null);
    setPendingAction(null);
    setRunningTargetKey(null);
    setNotice("Unit test task was canceled.");
  }, []);

  const { logs, progress, statusLabel } = useUnitJobStream(
    activeJobId,
    handleJobCompleted,
    handleJobFailed,
    handleJobCanceled,
  );

  const isJobActive = Boolean(activeJobId);

  // Merge executed Jest + Vitest test scenarios
  const allExecutedScenarios = useMemo(() => {
    const out = [];
    for (const runnerKey of ["jest", "vitest"]) {
      const run = executions?.[runnerKey];
      if (!run || !Array.isArray(run.scenarios)) continue;
      for (let i = 0; i < run.scenarios.length; i++) {
        const sc = run.scenarios[i];
        out.push({
          ...sc,
          id: sc.id || `${runnerKey}::${sc.testFile || ""}::${sc.title || i}`,
          runner: runnerKey.toUpperCase(),
          origin: sc.origin || "PROJECT_EXISTING",
          testFile: cleanDisplayPath(sc.testFile || ""),
        });
      }
    }
    return out;
  }, [executions]);

  const testTotals = useMemo(() => {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let durationMs = 0;
    for (const runnerKey of ["jest", "vitest"]) {
      const run = executions?.[runnerKey];
      if (!run) continue;
      total += Number(run.totalTests || 0);
      passed += Number(run.passedTests || 0);
      failed += Number(run.failedTests || 0);
      durationMs += Number(run.durationMs || 0);
    }
    if (total === 0 && allExecutedScenarios.length > 0) {
      total = allExecutedScenarios.length;
      passed = allExecutedScenarios.filter(
        (s) => String(s.status).toLowerCase() === "passed",
      ).length;
      failed = allExecutedScenarios.filter(
        (s) => String(s.status).toLowerCase() === "failed",
      ).length;
    }
    return { total, passed, failed, durationMs };
  }, [executions, allExecutedScenarios]);

  const suiteLoadErrors = useMemo(() => {
    const errors = [];
    const seen = new Set();
    for (const sc of allExecutedScenarios) {
      const msg = Array.isArray(sc.failureMessages)
        ? sc.failureMessages.join("\n").trim()
        : "";
      const isSuiteErr =
        Boolean(sc.isSuiteLevelFailure) ||
        /Test suite failed to run|Cannot find (?:module|package)|Failed to resolve import|ERR_MODULE_NOT_FOUND|SyntaxError:/i.test(
          msg,
        );
      if (!isSuiteErr) continue;
      const key = `${sc.testFile || sc.suiteName || sc.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push({
        testFile: sc.testFile || sc.suiteName || sc.title || "Test Suite",
        message:
          summarizeUnitFailure(sc.failureMessages || msg) ||
          "Test suite failed to load.",
      });
    }
    return errors;
  }, [allExecutedScenarios]);

  // Build Unit File Entries (Source Files + Functions + Matched Executed Scenarios + AI Drafts)
  const fileEntries = useMemo(() => {
    const isExecutedUnit = testTotals.total > 0 || Boolean(summary?.hasRun);

    const fnMap = new Map();
    for (const fn of functionsList) {
      const fp = cleanDisplayPath(fn.filePath || "");
      if (!fnMap.has(fp)) fnMap.set(fp, []);
      fnMap.get(fp).push(isExecutedUnit ? fn : { ...fn, hit: 0 });
    }

    const suiteMapBySource = new Map();
    const suiteMapByBase = new Map();
    const suiteSourceByTestFile = new Map();
    const staticCasesBySource = new Map();
    const staticCasesByBase = new Map();
    const staticCodeByTestAndTitle = new Map();

    for (const ts of testSuites || []) {
      const tf = cleanDisplayPath(ts.filePath || ts.path || "");
      if (!tf) continue;
      const assocSrc = ts.associatedSourceFile
        ? cleanDisplayPath(ts.associatedSourceFile)
        : "";
      const b = baseNameNoTestExt(assocSrc || tf);
      if (assocSrc) {
        if (!suiteMapBySource.has(assocSrc)) suiteMapBySource.set(assocSrc, tf);
        suiteSourceByTestFile.set(tf, assocSrc);
      }
      if (b && !suiteMapByBase.has(b)) suiteMapByBase.set(b, tf);

      const assertions = Array.isArray(ts.assertions) ? ts.assertions : [];
      for (let aIdx = 0; aIdx < assertions.length; aIdx++) {
        const a = assertions[aIdx];
        const title = String(a?.title || a?.testName || "").trim();
        if (!title) continue;
        const codeKey = `${tf.toLowerCase()}::${title.toLowerCase()}`;
        if (a.code && !staticCodeByTestAndTitle.has(codeKey)) {
          staticCodeByTestAndTitle.set(codeKey, a.code);
        }
        const staticCaseObj = {
          id: a.id || `existing::${tf}::${title}::${aIdx}`,
          title,
          testName: title,
          status: a.status || "not_run",
          origin: "PROJECT_EXISTING",
          framework: ts.framework || "jest",
          testFile: tf,
          sourceFile: assocSrc || undefined,
          category: a.category,
          targetFunction: a.targetFunction || null,
          ancestorTitles: a.ancestorTitles || [],
          line: a.line || a.startLine || null,
          code: a.code || null,
          duration: Number(a.duration || 0),
        };
        if (assocSrc) {
          if (!staticCasesBySource.has(assocSrc))
            staticCasesBySource.set(assocSrc, []);
          staticCasesBySource.get(assocSrc).push(staticCaseObj);
        }
        if (b) {
          if (!staticCasesByBase.has(b)) staticCasesByBase.set(b, []);
          staticCasesByBase.get(b).push(staticCaseObj);
        }
      }
    }

    // Group executed scenarios by resolved source file (via suite associatedSourceFile) or basename fallback
    const scenariosBySource = new Map();
    const scenariosByBase = new Map();
    for (const sc of allExecutedScenarios) {
      const tfClean = cleanDisplayPath(sc.testFile || "");
      const codeKey = `${tfClean.toLowerCase()}::${String(sc.title || "")
        .trim()
        .toLowerCase()}`;
      const enrichedSc =
        !sc.code && staticCodeByTestAndTitle.has(codeKey)
          ? { ...sc, code: staticCodeByTestAndTitle.get(codeKey) }
          : sc;
      const assocSrc = suiteSourceByTestFile.get(tfClean);
      if (assocSrc) {
        if (!scenariosBySource.has(assocSrc))
          scenariosBySource.set(assocSrc, []);
        scenariosBySource.get(assocSrc).push(enrichedSc);
      }
      const b = baseNameNoTestExt(sc.testFile || sc.suiteName || "");
      if (!scenariosByBase.has(b)) scenariosByBase.set(b, []);
      scenariosByBase.get(b).push(enrichedSc);
    }

    const isArtifactPath = (p = "") =>
      /(?:^|\/)(?:playwright-report|test-results|blob-report|\.nyc_output|coverage|dist|build)\//i.test(
        cleanDisplayPath(p),
      );

    const entries = (rawFiles || [])
      .filter((f) => !isArtifactPath(f.filePath))
      .map((f) => {
        const cleanPath = cleanDisplayPath(f.filePath || "");
        const base = baseNameNoTestExt(cleanPath);
        const fileFunctions = fnMap.get(cleanPath) || [];
        const rawExecutedForFile = scenariosBySource.has(cleanPath)
          ? scenariosBySource.get(cleanPath)
          : scenariosByBase.get(base) || [];
        const staticForFile = staticCasesBySource.has(cleanPath)
          ? staticCasesBySource.get(cleanPath)
          : staticCasesByBase.get(base) || [];

        const executedKeySet = new Set(
          rawExecutedForFile.map(
            (ex) =>
              `${cleanDisplayPath(ex.testFile || "").toLowerCase()}::${String(
                ex.title || "",
              )
                .trim()
                .toLowerCase()}`,
          ),
        );
        const unexecutedStatic = staticForFile.filter((st) => {
          const key = `${cleanDisplayPath(st.testFile || "").toLowerCase()}::${String(
            st.title || "",
          )
            .trim()
            .toLowerCase()}`;
          return !executedKeySet.has(key);
        });
        const rawMatchedExecuted = [...rawExecutedForFile, ...unexecutedStatic];

        const rawSugs =
          inlineSuggestions[cleanPath] || inlineSuggestions[f.filePath] || [];
        // Keep at most 1 latest suggestion per framework for this file to prevent stacked duplicate drafts
        const latestSugByFw = new Map();
        for (const s of Array.isArray(rawSugs) ? rawSugs : [rawSugs]) {
          if (!s || typeof s !== "object") continue;
          const fw = String(
            s.framework || activeFramework || "jest",
          ).toLowerCase();
          latestSugByFw.set(fw, s);
        }
        const dedupedSugs = Array.from(latestSugByFw.values());

        const stripCasePrefix = (t = "") =>
          String(t || "")
            .trim()
            .replace(/^\[[^\]]+\]\s*[:\-]?\s*/i, "")
            .replace(/^TC-[A-Z0-9_/&\-\s]+:\s*/i, "")
            .trim()
            .toLowerCase();

        const existingDiskTitles = new Set();
        let hasUnappliedNewTestFileDraft = false;
        for (const sug of dedupedSugs) {
          const isApplied =
            sug.applied === true || ["PASSED", "APPLIED"].includes(sug.status);
          const origCode = String(sug.originalCode || "");
          if (origCode.trim()) {
            for (const b of extractTestCasesFromCode(origCode)) {
              const norm = String(b.title || "")
                .trim()
                .toLowerCase();
              if (norm) existingDiskTitles.add(norm);
            }
          } else if (!isApplied && sug.isExisting === false) {
            hasUnappliedNewTestFileDraft = true;
          }
        }

        const draftCases = [];
        for (let sIdx = 0; sIdx < dedupedSugs.length; sIdx++) {
          const sug = dedupedSugs[sIdx];
          const isApplied =
            sug.applied === true || ["PASSED", "APPLIED"].includes(sug.status);
          const sugCode =
            sug.fullUpdatedContent ||
            sug.suggestedTestCode ||
            sug.generatedCode ||
            sug.testCode ||
            sug.code ||
            "";
          const parsedCodeBlocks = sugCode
            ? extractTestCasesFromCode(sugCode)
            : [];
          let testCasesMeta = [];
          if (Array.isArray(sug.testCases) && sug.testCases.length > 0) {
            testCasesMeta = sug.testCases.map((tc) => {
              const matchingBlock = parsedCodeBlocks.find(
                (b) =>
                  String(b.title || "")
                    .trim()
                    .toLowerCase() ===
                  String(tc.title || tc.testName || "")
                    .trim()
                    .toLowerCase(),
              );
              return {
                ...tc,
                title: tc.title || tc.testName || tc.name,
                code: tc.code || matchingBlock?.rawBlock || null,
              };
            });
          } else if (parsedCodeBlocks.length > 0) {
            testCasesMeta = parsedCodeBlocks.map((b) => ({
              title: b.title,
              code: b.rawBlock || b.code || null,
              category: classifyUnitTestCase({ title: b.title }).category,
            }));
          } else if (
            Array.isArray(sug.scenarioMatrix) &&
            sug.scenarioMatrix.length > 0
          ) {
            testCasesMeta = sug.scenarioMatrix.map((m, idx) => ({
              title:
                m.scenario || m.title || m.description || `Case ${idx + 1}`,
              category:
                m.category ||
                classifyUnitTestCase({ title: m.scenario || m.title }).category,
            }));
          } else if (sugCode.trim()) {
            testCasesMeta = [
              {
                title: `[Happy Path] AI unit test suite for ${cleanPath.split("/").pop()}`,
                category: sug.category || "HAPPY_PATH",
              },
            ];
          }

          // Exclude pre-existing user test blocks that were part of sug.originalCode
          if (existingDiskTitles.size > 0) {
            testCasesMeta = testCasesMeta.filter(
              (tc) =>
                !existingDiskTitles.has(
                  String(tc.title || tc.testName || "")
                    .trim()
                    .toLowerCase(),
                ),
            );
          }

          // Deduplicate generated AI test blocks by normalized title while preserving all function test cases
          const seenTitles = new Set();
          const assignedMeta = [];
          for (const tc of testCasesMeta) {
            const t = String(tc.title || tc.testName || "").trim();
            const key = t.toLowerCase();
            if (!key || seenTitles.has(key)) continue;
            seenTitles.add(key);
            const def = classifyUnitTestCase(tc);
            assignedMeta.push({
              ...tc,
              caseKey: tc.caseKey || def.key,
              category: tc.category || def.category,
            });
          }

          for (let tIdx = 0; tIdx < assignedMeta.length; tIdx++) {
            const tc = assignedMeta[tIdx];
            const title =
              tc.title || tc.testName || tc.name || `Draft test ${tIdx + 1}`;
            if (
              isApplied &&
              rawMatchedExecuted.some(
                (ex) =>
                  String(ex.title || "")
                    .trim()
                    .toLowerCase() === String(title).trim().toLowerCase(),
              )
            ) {
              continue;
            }
            draftCases.push({
              id: `draft::${cleanPath}::${sug.suggestionId || sug.id || sIdx}::${tIdx}`,
              title,
              caseKey:
                tc.caseKey ||
                classifyUnitTestCase({ title, category: tc.category }).key,
              category: tc.category || classifyUnitTestCase({ title }).category,
              status: isApplied ? "applied" : "draft",
              origin: "AI_DRAFT",
              isApplied,
              code: tc.code || null,
              testFile: cleanDisplayPath(
                sug.testFile ||
                  sug.targetTestFile ||
                  suiteMapByBase.get(base) ||
                  "",
              ),
              suggestionObj: sug,
              duration: 0,
            });
          }
        }

        // Reconcile executed scenarios: if an executed scenario came from running an unapplied
        // temporary AI draft (not present in existingDiskTitles), attach its run status to the
        // AI_DRAFT scenario instead of duplicating it as a fake PROJECT_EXISTING scenario.
        const matchedExecuted = [];
        for (const ex of rawMatchedExecuted) {
          const exTitleNorm = String(ex.title || "")
            .trim()
            .toLowerCase();
          const exTitleStripped = stripCasePrefix(ex.title);
          const isTrueExistingOnDisk = existingDiskTitles.has(exTitleNorm);

          if (!isTrueExistingOnDisk) {
            const matchingDraft = draftCases.find(
              (dc) =>
                !dc.isApplied &&
                (String(dc.title || "")
                  .trim()
                  .toLowerCase() === exTitleNorm ||
                  (exTitleStripped &&
                    stripCasePrefix(dc.title) === exTitleStripped)),
            );
            if (matchingDraft) {
              matchingDraft.status = ex.status || matchingDraft.status;
              matchingDraft.duration = ex.duration || matchingDraft.duration;
              matchingDraft.failureMessages = ex.failureMessages || [];
              matchingDraft.failureSummary = ex.failureSummary || "";
              continue;
            }
            // If the test file didn't exist on disk at all prior to this unapplied draft,
            // any leftover executed scenarios from an earlier temp draft run of this file are not PROJECT_EXISTING.
            if (hasUnappliedNewTestFileDraft && draftCases.length > 0) {
              continue;
            }
          }
          matchedExecuted.push(ex);
        }

        const baseCases = [...matchedExecuted, ...draftCases]
          .filter((tc) => {
            const t = {
              key: tc.id,
              id: tc.id,
              testFile: tc.testFile,
              testName: tc.title || tc.testName,
            };
            return !(pendingUnitOps.deletes || []).some((d) =>
              matchesStagedTarget(d, t),
            );
          })
          .map((tc) => {
            const t = {
              key: tc.id,
              id: tc.id,
              testFile: tc.testFile,
              testName: tc.title || tc.testName,
            };
            const upd = (pendingUnitOps.updates || []).find((u) =>
              matchesStagedTarget(u, t),
            );
            if (!upd) return tc;
            return {
              ...tc,
              title: upd.testName || tc.title,
              code: upd.code,
              status: "edited",
              stagedEdit: true,
            };
          });

        const stagedAdds = (pendingUnitOps.adds || [])
          .filter(
            (a) =>
              !a.sourceFile || cleanDisplayPath(a.sourceFile) === cleanPath,
          )
          .map((a) => ({
            id: a.id,
            title: a.testName || a.title,
            category: classifyUnitTestCase({ title: a.testName || a.title })
              .category,
            status: "draft",
            origin: "STAGED_ADD",
            isApplied: false,
            stagedTemp: true,
            code: a.code,
            testFile: cleanDisplayPath(
              a.testFile || suiteMapByBase.get(base) || "",
            ),
            duration: 0,
          }));

        const testCases = [...baseCases, ...stagedAdds];
        const associatedTestFile =
          matchedExecuted[0]?.testFile ||
          draftCases[0]?.testFile ||
          stagedAdds[0]?.testFile ||
          suiteMapBySource.get(cleanPath) ||
          suiteMapByBase.get(base) ||
          "";

        return {
          ...f,
          linesPct: isExecutedUnit ? Number(f.linesPct ?? 0) : 0,
          branchesPct: isExecutedUnit ? Number(f.branchesPct ?? 0) : 0,
          funcsPct: isExecutedUnit ? Number(f.funcsPct ?? 0) : 0,
          stmtsPct: isExecutedUnit ? Number(f.stmtsPct ?? 0) : 0,
          filePath: cleanPath,
          rawFilePath: f.filePath,
          functions: fileFunctions,
          testCases,
          associatedTestFile,
        };
      });

    if (focusFile) {
      const cleanFocus = cleanDisplayPath(focusFile);
      entries.sort((a, b) =>
        a.filePath === cleanFocus ? -1 : b.filePath === cleanFocus ? 1 : 0,
      );
    }

    return entries;
  }, [
    rawFiles,
    functionsList,
    testSuites,
    allExecutedScenarios,
    inlineSuggestions,
    pendingUnitOps,
    focusFile,
    activeFramework,
    testTotals.total,
    summary?.hasRun,
  ]);

  const missingDependencies = useMemo(() => {
    const found = new Map();
    for (const sc of allExecutedScenarios) {
      for (const msg of sc.failureMessages || []) {
        const dep = extractMissingPackageFromError(msg);
        if (dep?.packageName) found.set(dep.packageName, dep);
      }
    }
    return Array.from(found.values());
  }, [allExecutedScenarios]);

  const reviewFiles = useMemo(
    () => buildUnitTestReviewFiles(inlineSuggestions),
    [inlineSuggestions],
  );

  const buildDraftTestsForRun = useCallback(
    (targetFiles = []) => {
      const normalizedTargets = Array.isArray(targetFiles)
        ? targetFiles
            .map((t) =>
              String(t || "")
                .replace(/\\/g, "/")
                .replace(/^\/+/, "")
                .trim()
                .toLowerCase(),
            )
            .filter(Boolean)
        : [];
      const targetBasenames = new Set(
        normalizedTargets.map((t) =>
          t
            .split("/")
            .pop()
            .replace(
              /(?:\.(?:partial|redundant))?\.(?:test|spec|unit)\.[cm]?[jt]sx?$/i,
              "",
            )
            .replace(/\.[cm]?[jt]sx?$/i, ""),
        ),
      );
      const byTestFile = new Map();
      for (const item of Object.values(inlineSuggestions || {})) {
        const list = Array.isArray(item) ? item : [item];
        for (const sug of list) {
          const isApplied =
            Boolean(sug?.isApplied) ||
            sug?.applied === true ||
            ["PASSED", "APPLIED"].includes(sug?.status);
          if (
            !sug ||
            typeof sug !== "object" ||
            isApplied ||
            sug.isFullyCovered
          )
            continue;
          const testFile = String(sug.targetTestFile || sug.testFile || "")
            .replace(/\\/g, "/")
            .replace(/^\/+/, "")
            .trim();
          const sourceFile = String(
            sug.targetSourceFile || sug.sourceFile || "",
          )
            .replace(/\\/g, "/")
            .replace(/^\/+/, "")
            .trim();
          const code =
            sug.fullUpdatedContent ||
            sug.suggestedTestCode ||
            sug.generatedCode ||
            sug.testCode ||
            sug.code ||
            "";
          if (!testFile || !code.trim()) continue;
          if (normalizedTargets.length > 0) {
            const normTest = testFile.toLowerCase();
            const normSrc = sourceFile.toLowerCase();
            const testBase = normTest
              .split("/")
              .pop()
              .replace(
                /(?:\.(?:partial|redundant))?\.(?:test|spec|unit)\.[cm]?[jt]sx?$/i,
                "",
              );
            const srcBase = normSrc
              .split("/")
              .pop()
              .replace(/\.[cm]?[jt]sx?$/i, "");
            const matched =
              normalizedTargets.some(
                (t) =>
                  normSrc === t ||
                  normTest === t ||
                  normSrc.endsWith("/" + t) ||
                  normTest.endsWith("/" + t) ||
                  t.endsWith("/" + normSrc) ||
                  t.endsWith("/" + normTest),
              ) ||
              (testBase && targetBasenames.has(testBase)) ||
              (srcBase && targetBasenames.has(srcBase));
            if (!matched) continue;
          }
          byTestFile.set(testFile.toLowerCase(), {
            sourceFile,
            testFile,
            framework:
              sug.framework === "vitest" || sug.framework === "jest"
                ? sug.framework
                : null,
            code,
          });
        }
      }

      // Include staged UI additions/updates (before permanent Apply) when running from workspace
      for (const addOp of pendingUnitOps?.adds || []) {
        const testFile = cleanDisplayPath(addOp?.testFile || "");
        const sourceFile = cleanDisplayPath(addOp?.sourceFile || "");
        const addCode = String(addOp?.code || "").trim();
        if (!testFile || !addCode) continue;
        const normTest = testFile.toLowerCase();
        const normSrc = sourceFile.toLowerCase();
        if (normalizedTargets.length > 0) {
          const matched = normalizedTargets.some(
            (t) =>
              normSrc === t ||
              normTest === t ||
              normSrc.endsWith("/" + t) ||
              normTest.endsWith("/" + t) ||
              t.endsWith("/" + normSrc) ||
              t.endsWith("/" + normTest),
          );
          if (!matched) continue;
        }
        const existing = byTestFile.get(normTest);
        if (existing) {
          existing.code = `${existing.code.trimEnd()}\n\n${addCode}\n`;
        } else {
          byTestFile.set(normTest, {
            sourceFile,
            testFile,
            framework:
              activeFramework === "vitest" || activeFramework === "jest"
                ? activeFramework
                : null,
            code: addCode,
          });
        }
      }

      // Apply staged edits to any draft test file already queued for isolated run
      for (const updOp of pendingUnitOps?.updates || []) {
        const testFile = cleanDisplayPath(updOp?.testFile || "");
        const normTest = testFile.toLowerCase();
        const existing = normTest ? byTestFile.get(normTest) : null;
        const updCode = String(updOp?.code || "").trim();
        if (!existing || !updCode) continue;
        const oldNorm = String(updOp?.originalTestName || updOp?.testName || "")
          .trim()
          .toLowerCase();
        if (!oldNorm) continue;
        const blocks = extractTestCasesFromCode(existing.code);
        const targetBlock = blocks.find(
          (b) =>
            String(b.title || "")
              .trim()
              .toLowerCase() === oldNorm,
        );
        if (targetBlock) {
          existing.code =
            existing.code.slice(0, targetBlock.startIndex) +
            updCode +
            "\n" +
            existing.code.slice(targetBlock.endIndex);
        }
      }

      return Array.from(byTestFile.values());
    },
    [inlineSuggestions, pendingUnitOps, activeFramework],
  );

  // Select all business logic files & their existing tests when top Run Coverage is clicked (mirrors Integration)
  const selectAllUnitFilesInMatrix = useCallback(() => {
    if (matrixRef.current?.selectAllFiles) {
      matrixRef.current.selectAllFiles();
      return;
    }
    if (!snapshotId || !Array.isArray(rawFiles) || rawFiles.length === 0)
      return;
    const parentSet = new Set();
    const childSet = new Set();
    for (const f of rawFiles) {
      const fp = cleanDisplayPath(f.filePath || "");
      if (fp) parentSet.add(fp);
    }
    saveMatrixSelection("unit", snapshotId, parentSet, childSet);
  }, [snapshotId, rawFiles]);

  // Handlers
  const handleRunCoverage = async ({
    targetFiles = [],
    targetTestNames = [],
    targetKey = null,
    includeDrafts = false,
  } = {}) => {
    if (!snapshotId || isJobActive) return;
    const isGlobalFullRun =
      targetFiles.length === 0 && targetTestNames.length === 0;
    if (isGlobalFullRun) {
      selectAllUnitFilesInMatrix();
      setLastScopedAnalysis(null);
    }
    setError("");
    setNotice("");
    setPendingAction("RUN");
    setRunningTargetKey(targetKey);
    try {
      const draftTests = includeDrafts
        ? buildDraftTestsForRun(targetFiles)
        : [];
      const res = await runCoverageByType(
        snapshotId,
        "unit",
        effectiveRunFramework,
        "full",
        {
          restart: isGlobalFullRun,
          targetFiles,
          targetTestNames,
          draftTests,
        },
      );
      const job = res?.data?.job || res?.data?.jobs?.[0] || res?.job;
      if (job?.id) {
        setActiveJobId(job.id);
        setActiveJobType("RUN");
      } else {
        await refetch();
      }
    } catch (err) {
      setError(err.message || "Failed to start unit test coverage run.");
      setRunningTargetKey(null);
    } finally {
      setPendingAction(null);
    }
  };

  const handleSuggestFiles = async (
    targetFilePaths = null,
    explicitFramework = null,
  ) => {
    if (!snapshotId || isJobActive) return;
    setError("");
    setNotice("");
    const paths =
      Array.isArray(targetFilePaths) && targetFilePaths.length > 0
        ? targetFilePaths
        : rawFiles.filter(needsUnitTestSuggestion).map((f) => f.filePath);

    if (paths.length === 0) {
      setNotice("All analyzed source files already meet target unit coverage.");
      return;
    }

    if (
      !explicitFramework &&
      unitRunnerPreference === "auto" &&
      unitPermutation?.needsUserSelection &&
      !selectedZeroTestFramework
    ) {
      setPickerChoice("jest");
      setFrameworkPickerModal({ isOpen: true, targetPaths: paths });
      return;
    }

    const frameworkToSend = explicitFramework
      ? explicitFramework
      : unitRunnerPreference === "jest" || unitRunnerPreference === "vitest"
        ? unitRunnerPreference
        : unitPermutation?.needsUserSelection
          ? selectedZeroTestFramework || "jest"
          : "auto";

    setPendingAction("GENERATE");
    try {
      const res = await suggestAllUnitTestcases(snapshotId, {
        filePaths: paths,
        projectId,
        framework: frameworkToSend,
        validationMode: "full",
        async: true,
      });
      const payload = res?.data || res;
      if (payload?.queued && payload?.job?.id) {
        setActiveJobId(payload.job.id);
        setActiveJobType("GENERATE");
      } else if (Array.isArray(payload?.suggestions)) {
        setInlineSuggestions((prev) => {
          const next = { ...prev };
          for (const s of payload.suggestions) {
            const key = cleanDisplayPath(s.sourceFile || "");
            if (key) next[key] = [s];
          }
          return next;
        });
        setNotice(
          `Generated ${payload.suggestions.length} unit test draft(s).`,
        );
      }
    } catch (err) {
      setError(err.message || "Failed to generate unit test suggestions.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleApplySuggestions = async (suggestionsToApply) => {
    if (!snapshotId || !suggestionsToApply?.length || isJobActive) return;
    setError("");
    setNotice("");
    setPendingAction("APPLY");
    try {
      const cleaned = suggestionsToApply.map((s) => ({
        ...s,
        generatedCode:
          s.generatedCode ||
          s.fullUpdatedContent ||
          s.suggestedTestCode ||
          s.testCode ||
          s.code ||
          "",
        suggestedTestCode:
          s.fullUpdatedContent ||
          s.generatedCode ||
          s.suggestedTestCode ||
          s.testCode ||
          s.code ||
          "",
      }));
      const res = await applyUnitTestSuggestion(snapshotId, {
        suggestions: cleaned,
        projectId,
        skipBackgroundJob: false,
        async: true,
      });
      const payload = res?.data || res;
      if (payload?.queued && payload?.job?.id) {
        setActiveJobId(payload.job.id);
        setActiveJobType("APPLY");
      } else {
        const ids = new Set(
          cleaned.map((s) => s.suggestionId || s.id).filter(Boolean),
        );
        setInlineSuggestions((prev) =>
          applyBatchResultToSuggestionsMap(prev, ids, payload),
        );
        loadUnitTestVersions();
        invalidateCoverageQueries(snapshotId);
        await refetch();
      }
    } catch (err) {
      setError(err.message || "Failed to apply unit test drafts.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleAIFixTestCase = async (tc, entry) => {
    if (!snapshotId || fixingTestId) return;
    setError("");
    setNotice("");
    setFixingTestId(tc.id);
    const isDraftCase = tc.origin === "AI_DRAFT" && !tc.isApplied;
    const draftFullContent = isDraftCase
      ? tc.suggestionObj?.fullUpdatedContent ||
        tc.suggestionObj?.suggestedTestCode ||
        tc.suggestionObj?.generatedCode ||
        tc.suggestionObj?.testCode ||
        tc.suggestionObj?.code ||
        ""
      : "";
    try {
      const res = await aiFixUnitTestCaseApi(snapshotId, {
        sourceFile: entry?.filePath || tc.sourceFile || "",
        testFile: tc.testFile,
        testName: tc.title || tc.testName,
        failureMessage: Array.isArray(tc.failureMessages)
          ? tc.failureMessages.join("\n")
          : tc.failureSummary || "",
        currentCode: tc.code || "",
        fullTestContent: draftFullContent,
        isDraft: isDraftCase,
        framework: activeFramework,
      });
      const data = res?.data || res;
      if (data?.isDraft && data?.updatedContent) {
        const cleanKey = cleanDisplayPath(
          entry?.filePath || tc.sourceFile || "",
        );
        const targetTitleNorm = String(tc.title || tc.testName || "")
          .trim()
          .toLowerCase();
        const targetSugId =
          tc.suggestionObj?.suggestionId || tc.suggestionObj?.id;
        setInlineSuggestions((prev) => {
          const list = Array.isArray(prev[cleanKey]) ? prev[cleanKey] : [];
          if (!list.length) return prev;
          return {
            ...prev,
            [cleanKey]: list.map((s) => {
              const sid = s?.suggestionId || s?.id;
              if (targetSugId && sid && sid !== targetSugId) return s;
              const nextTestCases = Array.isArray(s.testCases)
                ? s.testCases.map((item) =>
                    String(item.title || item.testName || "")
                      .trim()
                      .toLowerCase() === targetTitleNorm
                      ? { ...item, code: data.fixedBlock || item.code }
                      : item,
                  )
                : undefined;
              return {
                ...s,
                fullUpdatedContent: data.updatedContent,
                suggestedTestCode: data.updatedContent,
                generatedCode: data.updatedContent,
                testCode: data.updatedContent,
                ...(nextTestCases ? { testCases: nextTestCases } : {}),
              };
            }),
          };
        });
        setNotice(
          `AI Fix updated draft "${data.testName || tc.title}". Re-running test to verify...`,
        );
      } else {
        setNotice(
          `AI Fix applied to "${data.testName || tc.title}". Re-running test to verify...`,
        );
        loadUnitTestVersions();
      }
      await handleRunCoverage({
        targetFiles: [entry?.filePath || tc.sourceFile || tc.testFile].filter(
          Boolean,
        ),
        targetTestNames: [tc.title || tc.testName].filter(Boolean),
        targetKey: entry?.filePath || null,
        includeDrafts: isDraftCase,
      });
    } catch (err) {
      setError(err.message || "AI Fix failed for this unit test case.");
    } finally {
      setFixingTestId(null);
    }
  };

  const flushPendingUnitOps = async ({ reload = true } = {}) => {
    if (!snapshotId || countStagedOps(pendingUnitOps) === 0) return true;
    setIsApplyingPending(true);
    setError("");
    try {
      for (const d of pendingUnitOps.deletes || []) {
        await deleteUnitTestCaseApi(snapshotId, {
          sourceFile: d.sourceFile || "",
          testFile: d.testFile,
          testName: d.testName || d.title,
        });
      }
      for (const u of pendingUnitOps.updates || []) {
        await updateUnitTestCaseApi(snapshotId, {
          sourceFile: u.sourceFile || "",
          testFile: u.testFile,
          testName: u.originalTestName || u.testName,
          code: u.code,
        });
      }
      for (const a of pendingUnitOps.adds || []) {
        await addUnitTestCaseApi(snapshotId, {
          sourceFile: a.sourceFile || "",
          testFile: a.testFile,
          testName: a.testName,
          code: a.code,
          framework: a.framework || activeFramework,
        });
      }
      const cleared = { deletes: [], updates: [], adds: [] };
      setPendingUnitOps(cleared);
      saveStagedOps("unit", snapshotId, cleared);
      loadUnitTestVersions();
      invalidateCoverageQueries(snapshotId);
      if (reload) await refetch();
      setNotice("Applied all temporary unit test changes to source files.");
      return true;
    } catch (err) {
      setError(err.message || "Failed to apply temporary unit test changes.");
      return false;
    } finally {
      setIsApplyingPending(false);
    }
  };

  const handleDeleteTestCase = async (tc, entry) => {
    if (!snapshotId) return;
    setError("");
    if (tc.origin === "AI_DRAFT" && !tc.isApplied) {
      const targetTitleNorm = String(tc.title || tc.testName || "")
        .trim()
        .toLowerCase();
      const removeSingleBlockFromCode = (codeStr = "") => {
        if (!codeStr || typeof codeStr !== "string") return codeStr;
        const blocks = extractTestCasesFromCode(codeStr);
        const targetBlock = blocks.find(
          (b) =>
            String(b.title || "")
              .trim()
              .toLowerCase() === targetTitleNorm,
        );
        if (!targetBlock) return codeStr;
        return (
          codeStr.slice(0, targetBlock.startIndex) +
          codeStr.slice(targetBlock.endIndex)
        ).replace(/\n{3,}/g, "\n\n");
      };

      setInlineSuggestions((prev) => {
        const key = cleanDisplayPath(entry?.filePath || "");
        const list = Array.isArray(prev[key]) ? prev[key] : [];
        const targetSugId =
          tc.suggestionObj?.suggestionId || tc.suggestionObj?.id;
        const updatedList = [];

        for (const s of list) {
          const sid = s?.suggestionId || s?.id;
          if (sid !== targetSugId) {
            updatedList.push(s);
            continue;
          }
          const nextFull = removeSingleBlockFromCode(
            s.fullUpdatedContent ||
              s.suggestedTestCode ||
              s.generatedCode ||
              s.testCode ||
              "",
          );
          const nextTestCases = Array.isArray(s.testCases)
            ? s.testCases.filter(
                (item) =>
                  String(item.title || item.testName || "")
                    .trim()
                    .toLowerCase() !== targetTitleNorm,
              )
            : [];
          const origTitles = new Set(
            extractTestCasesFromCode(s.originalCode || "").map((b) =>
              String(b.title || "")
                .trim()
                .toLowerCase(),
            ),
          );
          const remainingAiBlocks = extractTestCasesFromCode(nextFull).filter(
            (b) =>
              !origTitles.has(
                String(b.title || "")
                  .trim()
                  .toLowerCase(),
              ),
          );

          if (remainingAiBlocks.length === 0 && nextTestCases.length === 0) {
            continue;
          }
          updatedList.push({
            ...s,
            fullUpdatedContent: nextFull,
            suggestedTestCode: nextFull,
            generatedCode: nextFull,
            testCode: nextFull,
            ...(Array.isArray(s.testCases) ? { testCases: nextTestCases } : {}),
          });
        }

        return {
          ...prev,
          [key]: updatedList,
        };
      });
      setNotice(`Removed AI draft scenario "${tc.title}" (Temp).`);
      return;
    }

    setPendingUnitOps((prev) =>
      stageDeleteOp(prev, {
        key: tc.id,
        id: tc.id,
        sourceFile: entry?.filePath || "",
        testFile: tc.testFile,
        testName: tc.title || tc.testName,
        title: tc.title || tc.testName,
      }),
    );
    setNotice(
      `Removed "${tc.title}" in UI (Temp). Click Apply Changes to update source files.`,
    );
  };

  const handleBulkDeleteTestCases = async (selectedItems = []) => {
    if (
      !snapshotId ||
      !Array.isArray(selectedItems) ||
      selectedItems.length === 0
    )
      return;
    setError("");
    const draftItems = [];
    const existingItems = [];
    for (const tc of selectedItems) {
      if (tc?.origin === "AI_DRAFT" && !tc?.isApplied) draftItems.push(tc);
      else if (tc) existingItems.push(tc);
    }

    if (draftItems.length > 0) {
      setInlineSuggestions((prev) => {
        const next = { ...prev };
        for (const tc of draftItems) {
          const key = cleanDisplayPath(tc.sourceFile || "");
          const list = Array.isArray(next[key]) ? next[key] : [];
          const targetTitleNorm = String(tc.title || tc.testName || "")
            .trim()
            .toLowerCase();
          const targetSugId =
            tc.suggestionObj?.suggestionId || tc.suggestionObj?.id;
          const updatedList = [];
          for (const s of list) {
            const sid = s?.suggestionId || s?.id;
            if (targetSugId && sid && sid !== targetSugId) {
              updatedList.push(s);
              continue;
            }
            const codeStr =
              s.fullUpdatedContent ||
              s.suggestedTestCode ||
              s.generatedCode ||
              s.testCode ||
              "";
            const blocks = extractTestCasesFromCode(codeStr);
            const targetBlock = blocks.find(
              (b) =>
                String(b.title || "")
                  .trim()
                  .toLowerCase() === targetTitleNorm,
            );
            const nextFull = targetBlock
              ? (
                  codeStr.slice(0, targetBlock.startIndex) +
                  codeStr.slice(targetBlock.endIndex)
                ).replace(/\n{3,}/g, "\n\n")
              : codeStr;
            const nextTestCases = Array.isArray(s.testCases)
              ? s.testCases.filter(
                  (item) =>
                    String(item.title || item.testName || "")
                      .trim()
                      .toLowerCase() !== targetTitleNorm,
                )
              : [];
            const origTitles = new Set(
              extractTestCasesFromCode(s.originalCode || "").map((b) =>
                String(b.title || "")
                  .trim()
                  .toLowerCase(),
              ),
            );
            const remainingAiBlocks = extractTestCasesFromCode(nextFull).filter(
              (b) =>
                !origTitles.has(
                  String(b.title || "")
                    .trim()
                    .toLowerCase(),
                ),
            );
            if (remainingAiBlocks.length === 0 && nextTestCases.length === 0)
              continue;
            updatedList.push({
              ...s,
              fullUpdatedContent: nextFull,
              suggestedTestCode: nextFull,
              generatedCode: nextFull,
              testCode: nextFull,
              ...(Array.isArray(s.testCases)
                ? { testCases: nextTestCases }
                : {}),
            });
          }
          next[key] = updatedList;
        }
        return next;
      });
    }

    if (existingItems.length > 0) {
      setPendingUnitOps((prev) => {
        let next = prev;
        for (const tc of existingItems) {
          next = stageDeleteOp(next, {
            key: tc.id,
            id: tc.id,
            sourceFile: tc.sourceFile || "",
            testFile: tc.testFile,
            testName: tc.title || tc.testName,
            title: tc.title || tc.testName,
          });
        }
        return next;
      });
    }

    const parts = [];
    if (draftItems.length > 0) parts.push(`${draftItems.length} AI draft(s)`);
    if (existingItems.length > 0)
      parts.push(
        `${existingItems.length} existing test(s) staged for deletion`,
      );
    setNotice(
      `Removed ${parts.join(" and ")}.${existingItems.length > 0 ? " Click Apply Changes to update source files." : ""}`,
    );
  };

  const handleSwitchVersion = async (payload) => {
    if (!snapshotId) return;
    setIsSwitchingVersion(true);
    setSwitchingVersionFile(payload?.filePath || "all");
    try {
      await switchUnitTestVersion(snapshotId, { ...payload, projectId });
      await loadUnitTestVersions();
      invalidateCoverageQueries(snapshotId);
      await refetch();
      setNotice("Switched unit test version cleanly.");
    } catch (err) {
      setError(err.message || "Failed to switch unit test version.");
    } finally {
      setIsSwitchingVersion(false);
      setSwitchingVersionFile(null);
    }
  };

  const handleInstallDeps = async (deps) => {
    if (!snapshotId || !deps?.length) return;
    setInstallingDeps(true);
    try {
      const res = await installMissingDependencies(snapshotId, deps);
      if (res.newJobId) {
        setActiveJobId(res.newJobId);
        setActiveJobType("RUN");
      }
      setNotice(`Installed ${res.installed.length} missing package(s).`);
    } catch (err) {
      setError(err.message || "Failed to install missing packages.");
    } finally {
      setInstallingDeps(false);
    }
  };

  const hasExecuted = testTotals.total > 0 || Boolean(summary?.hasRun);
  const linesPct = hasExecuted
    ? Number(
        summary?.coverage?.lines ??
          summary?.testExecution?.coverageLinesPct ??
          summary?.previousCoverage?.lines ??
          summary?.linesPct ??
          0,
      )
    : 0;
  const branchesPct = hasExecuted
    ? Number(
        summary?.coverage?.branches ??
          summary?.testExecution?.coverageBranchesPct ??
          summary?.previousCoverage?.branches ??
          summary?.branchesPct ??
          0,
      )
    : 0;
  const funcsPct = hasExecuted
    ? Number(
        summary?.coverage?.functions ??
          summary?.testExecution?.coverageFunctionsPct ??
          summary?.previousCoverage?.functions ??
          summary?.funcsPct ??
          0,
      )
    : 0;
  const stmtsPct = hasExecuted
    ? Number(
        summary?.coverage?.statements ??
          summary?.testExecution?.coverageStatementsPct ??
          summary?.previousCoverage?.statements ??
          summary?.stmtsPct ??
          0,
      )
    : 0;
  const rawTotals = summary?.rawTotals || null;

  const peakUnitReport = summary?.peakReport || null;
  const liveCompositeScore =
    linesPct * 0.4 + branchesPct * 0.25 + funcsPct * 0.2 + stmtsPct * 0.15;
  const peakCompositeScore = peakUnitReport?.peakMeta
    ? Number(peakUnitReport.peakMeta.linesPct || 0) * 0.4 +
      Number(peakUnitReport.peakMeta.branchesPct || 0) * 0.25 +
      Number(peakUnitReport.peakMeta.funcsPct || 0) * 0.2 +
      Number(peakUnitReport.peakMeta.stmtsPct || 0) * 0.15
    : -1;
  const usePeakUnitReport = Boolean(
    peakUnitReport &&
    peakCompositeScore > 0 &&
    peakCompositeScore >= liveCompositeScore,
  );
  const reportCoverageSummary = usePeakUnitReport
    ? {
        lines: Number(
          peakUnitReport.coverageSummary?.lines ??
            peakUnitReport.peakMeta?.linesPct ??
            linesPct,
        ),
        branches: Number(
          peakUnitReport.coverageSummary?.branches ??
            peakUnitReport.peakMeta?.branchesPct ??
            branchesPct,
        ),
        functions: Number(
          peakUnitReport.coverageSummary?.functions ??
            peakUnitReport.peakMeta?.funcsPct ??
            funcsPct,
        ),
        statements: Number(
          peakUnitReport.coverageSummary?.statements ??
            peakUnitReport.peakMeta?.stmtsPct ??
            stmtsPct,
        ),
      }
    : {
        lines: linesPct,
        branches: branchesPct,
        functions: funcsPct,
        statements: stmtsPct,
      };
  const reportRawTotals =
    usePeakUnitReport && peakUnitReport.rawTotals
      ? peakUnitReport.rawTotals
      : rawTotals;
  const reportFileEntries = useMemo(() => {
    if (!usePeakUnitReport || !Array.isArray(peakUnitReport?.fileCoverages))
      return fileEntries;
    const peakByPath = new Map(
      peakUnitReport.fileCoverages.map((pf) => [
        cleanDisplayPath(pf.filePath),
        pf,
      ]),
    );
    return fileEntries.map((entry) => {
      const hit = peakByPath.get(cleanDisplayPath(entry.filePath));
      if (!hit) return entry;
      return {
        ...entry,
        linesPct: hit.linesPct,
        branchesPct: hit.branchesPct,
        funcsPct: hit.funcsPct,
        stmtsPct: hit.stmtsPct,
      };
    });
  }, [usePeakUnitReport, peakUnitReport, fileEntries]);
  const reportTestStats =
    usePeakUnitReport && peakUnitReport.testStats?.total > testTotals.total
      ? peakUnitReport.testStats
      : testTotals;
  const preRunSuiteTestCount = useMemo(
    () =>
      (testSuites || []).reduce(
        (sum, ts) =>
          sum +
          (Array.isArray(ts.assertions)
            ? ts.assertions.length
            : Number(ts.totalTests || 0)),
        0,
      ),
    [testSuites],
  );

  useChatTestContext(onChatContextChange, {
    kind: "unit",
    tab: activeTab,
    summary,
    files: rawFiles,
    testTotals,
  });

  if (isLoading && !dashboardData) {
    return <UnitCockpitSkeleton />;
  }

  const coveredFilesCount = hasExecuted
    ? fileEntries.filter((f) => Number(f.linesPct ?? 0) > 0).length
    : 0;
  const totalFilesCount = fileEntries.length;

  // Header telemetry ALWAYS shows real project-wide Unit Coverage across ALL business logic files
  // (never inflated by a targeted subset), matching Integration Test's header behavior.
  const isCumulativeReportStrip = activeTab === "report" && usePeakUnitReport;
  const reportCoveredFilesCount = reportFileEntries.filter(
    (f) => Number(f.linesPct ?? 0) > 0,
  ).length;

  const displayHasExecuted = isCumulativeReportStrip
    ? hasExecuted || usePeakUnitReport
    : hasExecuted;
  const displayLinesPct = isCumulativeReportStrip
    ? reportCoverageSummary.lines
    : linesPct;
  const displayBranchesPct = isCumulativeReportStrip
    ? reportCoverageSummary.branches
    : branchesPct;
  const displayFuncsPct = isCumulativeReportStrip
    ? reportCoverageSummary.functions
    : funcsPct;
  const displayStmtsPct = isCumulativeReportStrip
    ? reportCoverageSummary.statements
    : stmtsPct;
  const displayCoveredFilesCount = isCumulativeReportStrip
    ? reportCoveredFilesCount
    : coveredFilesCount;
  const displayTotalFilesCount = totalFilesCount;
  const displayFunctionsCount = functionsList.length;
  const displaySuitesCount = testSuites.length;
  const baseDisplayTestTotals = isCumulativeReportStrip
    ? reportTestStats
    : testTotals;
  const displayTestTotals =
    baseDisplayTestTotals.total === 0 && preRunSuiteTestCount > 0
      ? { ...baseDisplayTestTotals, total: preRunSuiteTestCount }
      : baseDisplayTestTotals;
  const passRate =
    displayTestTotals.total > 0
      ? Math.round((displayTestTotals.passed / displayTestTotals.total) * 100)
      : 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg)] text-[var(--color-text)] font-sans select-text overflow-hidden">
      {/* ── 1. SLEEK INDUSTRIAL COCKPIT HEADER ── */}
      <header className="shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] z-20 relative">
        {isFetching && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--color-surface-secondary)] overflow-hidden">
            <div className="h-full bg-[var(--color-text-muted)]/60 animate-pulse w-full" />
          </div>
        )}

        <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] flex items-center justify-center">
              <Layers size={15} />
            </div>
            <h1 className="text-sm font-semibold text-[var(--color-text)] tracking-tight m-0">
              Unit Test Coverage
            </h1>
            <button
              type="button"
              onClick={() => setSetupDrawerOpen(true)}
              className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-muted)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
              title="Click to configure Jest / Vitest runner mode in Test Setup"
            >
              {activeFrameworkBadgeLabel}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setSetupDrawerOpen((v) => !v)}
              className={TEST_UI.btnSecondary}
              title="Inspect runner dependencies and hermetic environment setup"
            >
              <SlidersHorizontal
                size={13}
                className="text-[var(--color-text-muted)]"
              />
              <span>Test Setup</span>
              {missingDependencies.length > 0 && (
                <span className={TEST_UI.badgeWarn}>
                  {missingDependencies.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching || isJobActive}
              className={TEST_UI.btnSecondary}
            >
              <RefreshCw
                size={12}
                className={isFetching ? "animate-spin" : ""}
              />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => handleRunCoverage()}
              disabled={
                !projectAccess.can("tests.run") ||
                isJobActive ||
                pendingAction === "RUN"
              }
              className={TEST_UI.btnPrimary}
              title="Run Jest / Vitest unit test suite and measure code coverage"
            >
              {pendingAction === "RUN" ||
              (isJobActive && activeJobType === "RUN") ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} fill="currentColor" />
              )}
              <span>
                {pendingAction === "RUN"
                  ? "Starting..."
                  : isJobActive && activeJobType === "RUN"
                    ? "Running Coverage..."
                    : "Run Coverage"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsExportModalOpen(true)}
              className={TEST_UI.btnSecondary}
            >
              <Download size={13} />
              <span className="hidden md:inline">Export</span>
            </button>

            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className={
                drawerOpen ? TEST_UI.btnSecondaryActive : TEST_UI.btnSecondary
              }
              title="Unit test version history (v1 / v2) and rollback"
            >
              <Clock size={13} />
              <span className="hidden md:inline">History</span>
            </button>
          </div>
        </div>

        {/* ── 2. UNIFIED TELEMETRY STRIP (Unit Metrics Preserved) ── */}
        <div className="px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg)]/60">
          <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)] overflow-hidden">
            {/* Primary Anchor: Line Coverage + Stmts/Branches/Funcs */}
            <div className="lg:col-span-5 px-4 py-3 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)] gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span>Unit code coverage</span>
                </div>
                <span className="font-mono tabular-nums text-[var(--color-text-muted)] text-[11px] shrink-0">
                  S {displayStmtsPct.toFixed(0)}% · B{" "}
                  {displayBranchesPct.toFixed(0)}% · F{" "}
                  {displayFuncsPct.toFixed(0)}%
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
                    {displayLinesPct.toFixed(1)}%
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    lines
                  </span>
                </div>
                <div
                  className={`flex-1 max-w-[160px] ${TEST_UI.progressTrack}`}
                >
                  <div
                    className={calmProgressFillClass(displayLinesPct)}
                    style={{
                      width: `${Math.min(100, Math.max(0, displayLinesPct))}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Source Files & Functions */}
            <div className="lg:col-span-3 px-4 py-3 flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                <span>Source files</span>
                <span className="font-mono tabular-nums text-[11px] text-[var(--color-text-muted)]">
                  {displayFunctionsCount} fns · {displaySuitesCount} suites
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
                <span className="text-xl font-bold text-[var(--color-text)]">
                  {displayCoveredFilesCount}/{displayTotalFilesCount}
                </span>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  covered
                </span>
              </div>
            </div>

            {/* Scenarios / Assertions */}
            <div className="lg:col-span-2 px-4 py-3 flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                <span>Tests</span>
                {displayTestTotals.total > 0 && (
                  <span className="font-mono tabular-nums text-[11px] text-[var(--color-text-muted)]">
                    {passRate}%
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 font-mono tabular-nums">
                <span className="text-xl font-bold text-[var(--color-text)]">
                  {displayTestTotals.passed}
                </span>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  / {displayTestTotals.total} passed
                </span>
              </div>
            </div>

            {/* Health */}
            <button
              type="button"
              onClick={() => setActiveTab("report")}
              className="lg:col-span-2 px-4 py-3 flex flex-col justify-between gap-1 text-left hover:bg-[var(--color-surface-secondary)]/50 transition-colors cursor-pointer"
              title="Open Executive Report & root cause diagnostics"
            >
              <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                <span>Health</span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
                  {(displayTestTotals.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono tabular-nums">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    suiteLoadErrors.length > 0 || displayTestTotals.failed > 0
                      ? "bg-[var(--color-text)]"
                      : !displayHasExecuted
                        ? "bg-[var(--color-text-muted)]"
                        : "bg-[var(--color-text-secondary)]"
                  }`}
                />
                <span
                  className={`text-sm font-medium truncate ${
                    suiteLoadErrors.length > 0 || displayTestTotals.failed > 0
                      ? "text-[var(--color-text)]"
                      : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {suiteLoadErrors.length > 0
                    ? `Suite load error (${suiteLoadErrors.length})`
                    : !displayHasExecuted
                      ? "Not run yet"
                      : displayTestTotals.failed === 0
                        ? "All healthy"
                        : `${displayTestTotals.failed} failed`}
                </span>
              </div>
            </button>
          </div>
        </div>

        {/* ── 3. TWO-TAB NAVIGATION BAR ── */}
        <div className="px-5 border-t border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between">
          <div className="flex items-center gap-5 text-xs" role="tablist">
            {[
              {
                id: "files",
                label: "Files & Tests Matrix",
                icon: FileCheck,
                badge: totalFilesCount,
              },
              {
                id: "report",
                label: "Executive Report",
                icon: BarChart3,
                badge:
                  reportTestStats.failed > 0
                    ? `${reportTestStats.failed} failed`
                    : null,
              },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  className={`${TEST_UI.tabBase} ${
                    isActive ? TEST_UI.tabActive : TEST_UI.tabInactive
                  }`}
                >
                  <Icon
                    size={13}
                    className={
                      isActive
                        ? "text-[var(--color-text)]"
                        : "text-[var(--color-text-muted)]"
                    }
                  />
                  <span>{tab.label}</span>
                  {tab.badge != null && (
                    <span
                      className={
                        tab.id === "report" && reportTestStats.failed > 0
                          ? TEST_UI.badgeFail
                          : TEST_UI.badgeNeutral
                      }
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {isFetching && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-[var(--color-text-muted)]">
              <RefreshCw size={11} className="animate-spin" /> Syncing...
            </span>
          )}
        </div>
      </header>

      {/* ── MAIN SCROLLABLE WORKSPACE BODY ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Error / Notice Banners */}
        {error && (
          <div className={TEST_UI.bannerError}>
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-rose-400/80 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError("")}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {notice && (
          <div className={TEST_UI.bannerSuccess}>
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice("")}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Suite-Level Load Failure Warning Banner (matches Integration Test) */}
        {suiteLoadErrors.length > 0 && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-4 py-3 text-xs space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium text-rose-300/90">
                <AlertTriangle
                  size={14}
                  className="text-rose-400/80 shrink-0"
                />
                <span>
                  {suiteLoadErrors.length} unit test suite
                  {suiteLoadErrors.length === 1 ? "" : "s"} crashed during
                  load/import before executing assertions
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSetupDrawerOpen(true)}
                className={TEST_UI.btnSecondary}
              >
                Open Test Setup
              </button>
            </div>
            <div className="space-y-1 pl-5 font-mono text-[11px] text-[var(--color-text-secondary)]">
              {suiteLoadErrors.slice(0, 3).map((item, i) => (
                <div key={`${item.testFile}-${i}`} className="truncate">
                  <span className="text-rose-400/80">{item.testFile}:</span>{" "}
                  {item.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Auto-visible Missing Packages Banner when Setup Modal is closed */}
        {!setupDrawerOpen && missingDependencies.length > 0 && (
          <UnitTestPackageInstaller
            snapshotId={snapshotId}
            missingDependencies={missingDependencies}
            onInstallDependencies={handleInstallDeps}
            onRerunTests={() => handleRunCoverage()}
            isInstalling={installingDeps}
            isLight={isLight}
          />
        )}

        {/* Live Job Progress Strip */}
        {isJobActive && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Loader2
                  size={15}
                  className="animate-spin text-[var(--color-primary)]"
                />
                <div>
                  <div className="text-xs font-semibold text-[var(--color-text)]">
                    {activeJobType === "GENERATE"
                      ? "Generating AI Unit Test Drafts..."
                      : activeJobType === "APPLY"
                        ? "Verifying & Applying Unit Tests..."
                        : "Running Unit Test Coverage Analysis..."}
                  </div>
                  <div className="text-[11px] font-mono text-[var(--color-text-muted)]">
                    {statusLabel || "Processing job..."} (
                    {Math.max(5, Math.min(100, Math.round(progress || 10)))}%)
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLogs((v) => !v)}
                  className="px-2.5 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[11px] text-[var(--color-text-secondary)] cursor-pointer"
                >
                  {showLogs ? "Hide logs" : `View logs (${logs.length})`}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    activeJobId && cancelJobApi(activeJobId).catch(() => {})
                  }
                  className="px-2.5 py-1 rounded border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-[11px] text-rose-400 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>

            <div className="h-1.5 rounded-sm bg-[var(--color-surface-secondary)] overflow-hidden">
              <div
                className="h-full bg-[var(--color-primary)] transition-all duration-300"
                style={{
                  width: `${Math.max(8, Math.min(100, progress || 15))}%`,
                }}
              />
            </div>

            {showLogs && logs.length > 0 && (
              <div className="p-2.5 rounded bg-[#0B0F14] border border-[var(--color-border)] max-h-40 overflow-y-auto font-mono text-[11px] text-[var(--color-text-secondary)] space-y-1">
                {logs.slice(-40).map((log, i) => (
                  <div key={log.id || i}>{log.message}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 1: FILES & TESTS MATRIX */}
        {activeTab === "files" && (
          <div className="space-y-4">
            {lastScopedAnalysis?.files?.length > 0 && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-[var(--color-primary)]/15 border border-[var(--color-primary)]/30 text-[10px] font-mono uppercase text-[var(--color-primary)]">
                      Scoped Analysis
                    </span>
                    <span className="text-xs font-semibold text-[var(--color-text)]">
                      Selected Business Logic Coverage (
                      {lastScopedAnalysis.files.length} file(s))
                    </span>
                  </div>
                  <div className="flex items-center gap-4 font-mono tabular-nums text-xs">
                    <span>
                      Lines:{" "}
                      <strong className="text-[var(--color-text)]">
                        {Number(
                          lastScopedAnalysis.total?.lines?.pct ?? 0,
                        ).toFixed(1)}
                        %
                      </strong>
                      <span className="text-[var(--color-text-muted)] ml-1">
                        ({lastScopedAnalysis.total?.lines?.covered ?? 0}/
                        {lastScopedAnalysis.total?.lines?.total ?? 0})
                      </span>
                    </span>
                    <span className="text-[var(--color-text-secondary)]">
                      B{" "}
                      {Number(
                        lastScopedAnalysis.total?.branches?.pct ?? 0,
                      ).toFixed(1)}
                      % · F{" "}
                      {Number(
                        lastScopedAnalysis.total?.functions?.pct ?? 0,
                      ).toFixed(1)}
                      % · S{" "}
                      {Number(
                        lastScopedAnalysis.total?.statements?.pct ?? 0,
                      ).toFixed(1)}
                      %
                    </span>
                    <button
                      type="button"
                      onClick={() => setLastScopedAnalysis(null)}
                      className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                      title="Dismiss scoped analysis summary"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {lastScopedAnalysis.files.map((sf) => (
                    <div
                      key={sf.filePath}
                      className="px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-between gap-2 text-xs font-mono tabular-nums"
                    >
                      <span
                        className="truncate text-[var(--color-text-secondary)]"
                        title={sf.filePath}
                      >
                        {cleanDisplayPath(sf.filePath)}
                      </span>
                      <span
                        className={`shrink-0 font-semibold ${
                          Number(sf.linesPct || 0) >= 80
                            ? "text-emerald-400"
                            : Number(sf.linesPct || 0) > 0
                              ? "text-amber-400"
                              : "text-rose-400"
                        }`}
                      >
                        {Number(sf.linesPct ?? 0).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <UnitFileMatrixTable
              ref={matrixRef}
              key={snapshotId || "unit"}
              snapshotId={snapshotId}
              fileEntries={fileEntries}
              hasExecuted={hasExecuted}
              onSuggestSelected={(paths) => handleSuggestFiles(paths)}
              onSuggestAllUncovered={() => handleSuggestFiles(null)}
              onApplySelected={(sugs) => handleApplySuggestions(sugs)}
              onRunSelectedTests={(tests) => {
                const targetFiles = [
                  ...new Set(
                    tests
                      .map((t) => t.sourceFile || t.testFile)
                      .filter(Boolean),
                  ),
                ];
                const selectedSourceSet = new Set(
                  targetFiles.map((p) => cleanDisplayPath(p)),
                );
                const totalCasesInSelectedFiles = fileEntries
                  .filter((e) =>
                    selectedSourceSet.has(cleanDisplayPath(e.filePath)),
                  )
                  .reduce((sum, e) => sum + (e.testCases?.length || 0), 0);
                const isAllTestsOfSelectedFiles =
                  totalCasesInSelectedFiles > 0 &&
                  tests.length >= totalCasesInSelectedFiles;
                const includesUnappliedDraft = tests.some(
                  (t) =>
                    (t?.origin === "AI_DRAFT" && !t?.isApplied) ||
                    t?.origin === "STAGED_ADD" ||
                    Boolean(t?.stagedTemp) ||
                    Boolean(t?.stagedEdit),
                );
                handleRunCoverage({
                  targetFiles,
                  targetTestNames: isAllTestsOfSelectedFiles
                    ? []
                    : tests.map((t) => t.title || t.testName).filter(Boolean),
                  includeDrafts: includesUnappliedDraft,
                });
              }}
              onOpenAddTest={(entry) =>
                setEditorModalState({
                  isOpen: true,
                  mode: "add",
                  sourceFile: entry.filePath,
                  testCase: { testFile: entry.associatedTestFile || "" },
                })
              }
              onOpenEditTest={(tc, entry) =>
                setEditorModalState({
                  isOpen: true,
                  mode: "edit",
                  sourceFile: entry.filePath,
                  testCase: tc,
                })
              }
              onDeleteTestCase={handleDeleteTestCase}
              onBulkDeleteTestCases={handleBulkDeleteTestCases}
              onAIFixTestCase={handleAIFixTestCase}
              onOpenFileAnalysis={(entry) => setAnalysisFile(entry)}
              onOpenSourceFile={onOpenFile}
              onOpenDiffReview={(filePath) => setDiffReviewFilePath(filePath)}
              isGenerating={
                pendingAction === "GENERATE" ||
                (isJobActive && activeJobType === "GENERATE")
              }
              isApplying={
                pendingAction === "APPLY" ||
                (isJobActive && activeJobType === "APPLY")
              }
              isRunning={
                pendingAction === "RUN" ||
                (isJobActive && activeJobType === "RUN")
              }
              fixingTestId={fixingTestId}
              pendingOpsCount={pendingOpsCount}
              isApplyingPending={isApplyingPending}
              onApplyPendingChanges={() =>
                flushPendingUnitOps({ reload: true })
              }
              onDiscardPendingChanges={() => setShowDiscardConfirm(true)}
            />
          </div>
        )}

        {/* TAB 2: EXECUTIVE REPORT */}
        {activeTab === "report" && (
          <UnitReportEmbed
            coverageSummary={reportCoverageSummary}
            rawTotals={reportRawTotals}
            fileEntries={reportFileEntries}
            executedScenarios={allExecutedScenarios}
            testStats={reportTestStats}
            hasExecuted={hasExecuted || usePeakUnitReport}
            isPeakReport={usePeakUnitReport}
            peakMeta={peakUnitReport?.peakMeta || null}
            onRunCoverage={() => handleRunCoverage()}
            onOpenExportModal={() => setIsExportModalOpen(true)}
            onAIFixTestCase={handleAIFixTestCase}
            onRunTestCase={(tc, entry) =>
              handleRunCoverage({
                targetFiles: [
                  entry?.filePath || tc.sourceFile || tc.testFile,
                ].filter(Boolean),
                targetTestNames: [tc.title || tc.testName].filter(Boolean),
              })
            }
            onOpenFileAnalysis={(entry) => setAnalysisFile(entry)}
            onNavigateTab={setActiveTab}
            fixingTestId={fixingTestId}
            isRunning={isJobActive}
          />
        )}
      </div>

      {/* ── SLIDE-OVER HISTORY DRAWER (v1/v2 Rollback) ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/75">
          <div className="w-full max-w-2xl h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History size={15} className="text-[var(--color-primary)]" />
                <h2 className="text-sm font-semibold m-0">
                  Unit Test Version History (v1 / v2)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <UnitTestVersionHistoryView
                unitTestVersions={unitTestVersions}
                onSwitchVersion={handleSwitchVersion}
                isSwitchingVersion={isSwitchingVersion}
                switchingVersionFile={switchingVersionFile}
                onOpenFile={onOpenFile}
                isLight={isLight}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── MODALS ── */}
      <UnitTestCaseEditorModal
        isOpen={editorModalState.isOpen}
        onClose={() => setEditorModalState((s) => ({ ...s, isOpen: false }))}
        mode={editorModalState.mode}
        snapshotId={snapshotId}
        sourceFile={editorModalState.sourceFile}
        testCase={editorModalState.testCase}
        framework={activeFramework}
        onSaved={async (data, meta) => {
          if (meta?.staged && data?.staged) {
            const resolvedTitle = extractBlockTitle(
              data.code,
              data.testName || "Unit test case",
            );
            const editingTc = editorModalState.testCase;
            if (
              data.mode !== "add" &&
              editingTc?.origin === "AI_DRAFT" &&
              !editingTc?.isApplied
            ) {
              const oldTitleNorm = String(
                data.originalTestName || editingTc.title || "",
              )
                .trim()
                .toLowerCase();
              const replaceSingleBlockInCode = (codeStr = "") => {
                if (!codeStr || typeof codeStr !== "string") return codeStr;
                const blocks = extractTestCasesFromCode(codeStr);
                const targetBlock = blocks.find(
                  (b) =>
                    String(b.title || "")
                      .trim()
                      .toLowerCase() === oldTitleNorm,
                );
                if (!targetBlock) return codeStr;
                return (
                  codeStr.slice(0, targetBlock.startIndex) +
                  data.code.trim() +
                  "\n" +
                  codeStr.slice(targetBlock.endIndex)
                );
              };
              setInlineSuggestions((prev) => {
                const key = cleanDisplayPath(
                  data.sourceFile || editorModalState.sourceFile || "",
                );
                const list = Array.isArray(prev[key]) ? prev[key] : [];
                return {
                  ...prev,
                  [key]: list.map((s) => {
                    const nextFull = replaceSingleBlockInCode(
                      s.fullUpdatedContent ||
                        s.suggestedTestCode ||
                        s.generatedCode ||
                        s.testCode ||
                        "",
                    );
                    const nextTestCases = Array.isArray(s.testCases)
                      ? s.testCases.map((item) =>
                          String(item.title || item.testName || "")
                            .trim()
                            .toLowerCase() === oldTitleNorm
                            ? {
                                ...item,
                                title: resolvedTitle,
                                code: data.code.trim(),
                              }
                            : item,
                        )
                      : undefined;
                    return {
                      ...s,
                      fullUpdatedContent: nextFull,
                      suggestedTestCode: nextFull,
                      generatedCode: nextFull,
                      testCode: nextFull,
                      ...(nextTestCases ? { testCases: nextTestCases } : {}),
                    };
                  }),
                };
              });
              setNotice(
                `Updated AI draft "${resolvedTitle}" in UI (Temp). Click Apply to write to source.`,
              );
              return;
            }
            if (data.mode === "add") {
              setPendingUnitOps((prev) =>
                stageAddOp(prev, {
                  sourceFile: data.sourceFile || editorModalState.sourceFile,
                  testFile: data.testFile,
                  testName: resolvedTitle,
                  title: resolvedTitle,
                  code: data.code,
                  framework: data.framework,
                }),
              );
            } else {
              setPendingUnitOps((prev) =>
                stageUpdateOp(prev, {
                  key: editorModalState.testCase?.id,
                  id: editorModalState.testCase?.id,
                  sourceFile: data.sourceFile || editorModalState.sourceFile,
                  testFile: data.testFile,
                  originalTestName:
                    data.originalTestName || editorModalState.testCase?.title,
                  testName: resolvedTitle,
                  title: resolvedTitle,
                  code: data.code,
                }),
              );
            }
            setNotice(
              `Saved "${resolvedTitle}" in UI (Temp). Click Apply Changes to write to source.`,
            );
            return;
          }
          loadUnitTestVersions();
          setNotice("Unit test saved cleanly.");
          if (meta?.andRun) {
            if (pendingOpsCount > 0)
              await flushPendingUnitOps({ reload: false });
            await handleRunCoverage({
              targetFiles: [
                meta.testFile || editorModalState.sourceFile,
              ].filter(Boolean),
              targetTestNames: meta.testName ? [meta.testName] : [],
            });
          } else {
            await refetch();
          }
        }}
      />

      <UnitFileAnalysisModal
        isOpen={Boolean(analysisFile)}
        onClose={() => setAnalysisFile(null)}
        snapshotId={snapshotId}
        file={analysisFile}
        testSuites={testSuites}
        onOpenFile={onOpenFile}
        onOpenSimulation={(fp) => setSimulationTarget({ sourceFile: fp })}
        onSuggestTestcase={(fp) => handleSuggestFiles([fp])}
      />

      {simulationTarget && (
        <UnitTestSimulationStudioModal
          isOpen={Boolean(simulationTarget)}
          onClose={() => setSimulationTarget(null)}
          snapshotId={snapshotId}
          projectId={projectId}
          availableSourceFiles={fileEntries}
          availableFunctionsList={functionsList}
          availableTestSuites={testSuites}
          initialSourceFile={simulationTarget.sourceFile}
          isLight={isLight}
        />
      )}

      {diffReviewFilePath && reviewFiles.length > 0 && (
        <DiffReviewModal
          isOpen={Boolean(diffReviewFilePath)}
          onClose={() => setDiffReviewFilePath(null)}
          files={reviewFiles}
          initialFileIndex={Math.max(
            0,
            reviewFiles.findIndex(
              (f) =>
                f.sourceFile === diffReviewFilePath ||
                f.filePath === diffReviewFilePath ||
                (f.sourceFiles || []).includes(diffReviewFilePath),
            ),
          )}
          onApplyFile={(rf) =>
            handleApplySuggestions(
              rf?.suggestions || inlineSuggestions[diffReviewFilePath] || [],
            )
          }
          onApplyAll={() =>
            handleApplySuggestions(
              reviewFiles.flatMap((rf) => rf.suggestions || []),
            )
          }
          isApplying={
            pendingAction === "APPLY" ||
            (isJobActive && activeJobType === "APPLY")
          }
        />
      )}

      {/* ── TEST SETUP MODAL (Jest & Vitest Runner Configuration + 4-Category Blueprint) ── */}
      {setupDrawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setSetupDrawerOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] flex items-center justify-center">
                  <SlidersHorizontal size={14} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text)] m-0">
                    Unit Test Setup & Runner Configuration
                  </h3>
                  <p className="text-[11px] text-[var(--color-text-muted)] m-0 mt-0.5">
                    Configure Jest & Vitest execution, AI test generation
                    target, and environment dependencies.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSetupDrawerOpen(false)}
                className="p-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              {/* 1. Detected Environment Summary */}
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3.5 grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
                <div>
                  <div className="text-[10px] text-[var(--color-text-muted)] uppercase">
                    Jest
                  </div>
                  <div className="text-xs font-semibold text-[var(--color-text)] mt-0.5">
                    {detectedUnitFrameworks.includes("jest")
                      ? "Detected"
                      : "Available"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--color-text-muted)] uppercase">
                    Vitest
                  </div>
                  <div className="text-xs font-semibold text-[var(--color-text)] mt-0.5">
                    {detectedUnitFrameworks.includes("vitest")
                      ? "Detected"
                      : "Available"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--color-text-muted)] uppercase">
                    Source Files
                  </div>
                  <div className="text-xs font-semibold text-[var(--color-text)] mt-0.5">
                    {totalFilesCount}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--color-text-muted)] uppercase">
                    Test Suites
                  </div>
                  <div className="text-xs font-semibold text-[var(--color-text)] mt-0.5">
                    {testSuites.length}
                  </div>
                </div>
              </div>

              {/* 2. Runner Selector (Auto / Jest / Vitest) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--color-text)]">
                    Test Runner & AI Generator Engine
                  </span>
                  <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
                    Applies to Run Coverage & Generate AI Tests
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {[
                    {
                      id: "auto",
                      title: "Auto (Per-File)",
                      badge: "Recommended",
                      desc: "Runs both Jest & Vitest in mixed monorepos and matches each file's existing test library.",
                    },
                    {
                      id: "jest",
                      title: "Jest",
                      badge: "Node / CJS",
                      desc: "Forces Jest execution & generates jest.fn / jest.mock suites with Istanbul coverage.",
                    },
                    {
                      id: "vitest",
                      title: "Vitest",
                      badge: "ESM / Vite",
                      desc: "Forces Vitest execution & generates vi.fn / vi.mock suites with V8 coverage.",
                    },
                  ].map((opt) => {
                    const selected = unitRunnerPreference === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setUnitRunnerPreference(opt.id);
                          if (opt.id === "jest" || opt.id === "vitest") {
                            setSelectedZeroTestFramework(opt.id);
                          }
                        }}
                        className={`p-3 rounded-md border text-left transition-colors duration-150 cursor-pointer flex flex-col justify-between gap-1.5 ${
                          selected
                            ? "bg-[var(--color-surface-secondary)] border-[var(--color-border-strong)] text-[var(--color-text)]"
                            : "bg-[var(--color-bg)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-mono font-bold text-xs text-[var(--color-text)] flex items-center gap-1.5">
                            {selected && (
                              <Check
                                size={12}
                                className="text-[var(--color-text)]"
                              />
                            )}
                            {opt.title}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
                              selected
                                ? "bg-[var(--color-text)] text-[var(--color-bg)]"
                                : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                            }`}
                          >
                            {opt.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed m-0">
                          {opt.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Unit Function & Coverage Targets */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-[var(--color-text)]">
                  Unit Function & Code Coverage Targets
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    {
                      title: "Unit Functions Coverage",
                      description:
                        "Every exported function, service method, and helper in business logic files is targeted directly with isolated unit tests.",
                    },
                    {
                      title: "Lines, Branches & Statements",
                      description:
                        "Measures statement, branch, function, and line execution across each source module via Jest (Istanbul) or Vitest (V8).",
                    },
                  ].map((item) => (
                    <div
                      key={item.title}
                      className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 space-y-0.5"
                    >
                      <div className="font-mono text-[11px] font-semibold text-[var(--color-text)]">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-muted)] leading-snug">
                        {item.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 4. Missing Dependencies Installer */}
              {missingDependencies.length > 0 && (
                <UnitTestPackageInstaller
                  snapshotId={snapshotId}
                  missingDependencies={missingDependencies}
                  onInstallDependencies={handleInstallDeps}
                  onRerunTests={() => {
                    setSetupDrawerOpen(false);
                    handleRunCoverage();
                  }}
                  isInstalling={installingDeps}
                  isLight={isLight}
                />
              )}
            </div>

            <div className="px-5 py-3 bg-[var(--color-surface-secondary)] border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSetupDrawerOpen(false)}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] cursor-pointer transition-colors"
              >
                Close
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSetupDrawerOpen(false);
                    handleRunCoverage();
                  }}
                  disabled={!projectAccess.can("tests.run") || isJobActive}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-[var(--color-text)] cursor-pointer disabled:opacity-50"
                >
                  <Play size={11} fill="currentColor" />
                  <span>Run Existing Tests</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSetupDrawerOpen(false);
                    handleSuggestFiles(null);
                  }}
                  disabled={isJobActive}
                  className={TEST_UI.btnPrimary}
                >
                  <Plus size={12} />
                  <span>Generate Uncovered ({activeFrameworkBadgeLabel})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {frameworkPickerModal.isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() =>
            setFrameworkPickerModal({ isOpen: false, targetPaths: null })
          }
        >
          <div
            className="w-full max-w-lg bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text)] m-0">
                  Choose Unit Testing Framework
                </h3>
                <p className="text-[11px] text-[var(--color-text-muted)] m-0 mt-0.5">
                  No unit test library or existing unit test file was detected.
                  Pick 1 of 2 supported runners to generate tests.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setFrameworkPickerModal({ isOpen: false, targetPaths: null })
                }
                className="p-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {[
                {
                  id: "jest",
                  title: "Jest",
                  badge: "Node / CJS",
                  desc: "Standard Node.js runner with built-in mocking (jest.fn / jest.mock) and Istanbul coverage.",
                },
                {
                  id: "vitest",
                  title: "Vitest",
                  badge: "ESM / Vite",
                  desc: "Modern ESM-first runner with vi.mock / vi.fn APIs and fast V8 coverage.",
                },
              ].map((fw) => {
                const selected = pickerChoice === fw.id;
                return (
                  <button
                    key={fw.id}
                    type="button"
                    onClick={() => setPickerChoice(fw.id)}
                    className={`p-3.5 rounded-md border text-left transition-colors duration-150 cursor-pointer ${
                      selected
                        ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)] text-[var(--color-text)]"
                        : "bg-[var(--color-bg)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-bold text-xs text-[var(--color-text)]">
                        {fw.title}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
                          selected
                            ? "bg-[var(--color-primary)] text-white"
                            : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)]"
                        }`}
                      >
                        {fw.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed m-0">
                      {fw.desc}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="px-5 py-3 bg-[var(--color-surface-secondary)] border-t border-[var(--color-border)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setFrameworkPickerModal({ isOpen: false, targetPaths: null })
                }
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] cursor-pointer transition-colors duration-150"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const chosen = pickerChoice;
                  const targets = frameworkPickerModal.targetPaths;
                  setSelectedZeroTestFramework(chosen);
                  setFrameworkPickerModal({ isOpen: false, targetPaths: null });
                  handleSuggestFiles(targets, chosen);
                }}
                className={TEST_UI.btnPrimary}
              >
                Generate with {pickerChoice === "vitest" ? "Vitest" : "Jest"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
        onConfirm={() => {
          const cleared = { deletes: [], updates: [], adds: [] };
          setPendingUnitOps(cleared);
          saveStagedOps("unit", snapshotId, cleared);
          setNotice("Discarded temporary unit test edits.");
          setShowDiscardConfirm(false);
        }}
        title="Discard Pending Unit Test Changes"
        message={`Discard ${pendingOpsCount} staged unit test ${pendingOpsCount === 1 ? "change" : "changes"}? This cannot be undone.`}
        confirmText="Discard Changes"
        variant="danger"
      />

      <ExportUnitTestReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        data={{
          snapshotId,
          projectId,
          summary,
          rawTotals,
          files: fileEntries,
          executions,
          testTotals,
          scenarios: allExecutedScenarios,
          functionsList,
          testSuites,
        }}
      />
    </div>
  );
}
