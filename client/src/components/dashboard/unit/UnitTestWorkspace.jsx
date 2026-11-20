import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
  Download,
  FileCheck,
  History,
  Layers,
  Loader2,
  Play,
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
  deleteUnitTestCaseApi,
  getUnitTestVersions,
  installMissingDependencies,
  runCoverageByType,
  suggestAllUnitTestcases,
  switchUnitTestVersion,
} from "../../../services/coverage.service.js";
import { cancelJobApi, getJobDetailApi, getProjectJobsApi } from "../../../services/job.service.js";
import {
  applyBatchResultToSuggestionsMap,
  buildUnitTestReviewFiles,
  normalizeReviewTestFile,
  summarizeApplyBatchResult,
} from "../../../services/unitTestReview.js";
import { needsUnitTestSuggestion } from "../../../services/unitTestSuggestionQueue.js";
import { getAccessToken } from "../../../lib/authSession.js";
import { useToast } from "../ToastContext";
import CoverageJobQueueButton from "../CoverageJobQueueButton.jsx";
import UnitTestPackageInstaller from "../UnitTestPackageInstaller.jsx";
import UnitTestVersionHistoryView from "../UnitTestVersionHistoryView.jsx";
import DiffReviewModal, { extractTestCasesFromCode } from "../DiffReviewModal.jsx";
import UnitTestSimulationStudioModal from "../simulation/UnitTestSimulationStudioModal.jsx";
import { ExportUnitTestReportModal } from "../modals/ExportUnitTestReportModal.jsx";
import UnitFileMatrixTable from "./UnitFileMatrixTable.jsx";
import UnitReportEmbed from "./UnitReportEmbed.jsx";
import UnitTestCaseEditorModal from "./UnitTestCaseEditorModal.jsx";
import UnitFileAnalysisModal from "./UnitFileAnalysisModal.jsx";
import { cleanDisplayPath } from "../CoverageTypeDashboard.jsx";
import { extractMissingPackageFromError } from "../UnitTestTraceabilityMatrix.jsx";
import { classifyUnitTestCase, summarizeUnitFailure } from "./unitTestCaseCoverage.js";

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
  return String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function baseNameNoTestExt(filePath = "") {
  return normalizePath(filePath)
    .split("/")
    .pop()
    ?.replace(/(?:\.(?:partial|redundant))?\.(?:test|spec|unit)\.[cm]?[jt]sx?$/i, "")
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
  onOpenJobQueue,
  onChatContextChange,
  focusFile = null,
}) {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const projectAccess = useProjectAccess(projectId);
  const { addToast } = useToast();
  const { getSuggestions, saveSuggestions } = useRunningProcess();

  const [activeTab, setActiveTab] = useState("files");
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

  // Main Query
  const {
    data: dashboardData,
    isLoading,
    isFetching,
    refetch,
  } = useCoverageDashboard(snapshotId, "unit", projectId);

  const summary = dashboardData?.summary || null;
  const rawFiles = dashboardData?.files || [];
  const executions = dashboardData?.executions || {};
  const frameworks = dashboardData?.frameworks || null;
  const functionsList = dashboardData?.functionsList || [];
  const testSuites = dashboardData?.testSuites || [];

  const activeFramework = useMemo(() => {
    const detected = frameworks?.recommended || frameworks?.detected?.[0]?.framework;
    if (detected === "vitest" || detected === "jest") return detected;
    if (executions?.vitest && !executions?.jest) return "vitest";
    return "jest";
  }, [frameworks, executions]);

  // Restore / persist inline suggestions per snapshot
  const lastSnapshotRef = useRef(snapshotId);
  useEffect(() => {
    if (snapshotId && snapshotId !== lastSnapshotRef.current) {
      lastSnapshotRef.current = snapshotId;
      setInlineSuggestions(getSuggestions(snapshotId) || {});
    }
  }, [snapshotId, getSuggestions]);

  useEffect(() => {
    if (snapshotId && inlineSuggestions) {
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
            ["RUN_TESTS", "UNIT_TEST_SUGGEST", "UNIT_TEST_APPLY"].includes(j.type),
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
              for (const s of sugList) {
                const key = cleanDisplayPath(s.sourceFile || "");
                if (!key) continue;
                const existing = next[key] || [];
                const sid = s.suggestionId || s.id;
                const filtered = existing.filter((e) => (e.suggestionId || e.id) !== sid);
                next[key] = [...filtered, s];
              }
              return next;
            });
            setNotice(`Generated ${sugList.length} AI unit test draft(s). Review or click Apply in the matrix.`);
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
            updateCoverageFilesData(snapshotId, "unit", projectId, resultData.perFileResults);
          }
          const summaryRes = summarizeApplyBatchResult(resultData, allIds.size);
          setNotice(summaryRes.message);
          if (summaryRes.errorMessage) setError(summaryRes.errorMessage);
          loadUnitTestVersions();
        } else {
          setNotice("Unit test coverage analysis completed.");
        }
      } catch (err) {
        console.warn("[UnitTestWorkspace] Post-job processing warning:", err?.message);
      } finally {
        invalidateCoverageQueries(snapshotId);
        invalidateProjectTree(projectId);
        await refetch();
      }
    },
    [activeJobType, snapshotId, projectId, inlineSuggestions, addToast, refetch, loadUnitTestVersions],
  );

  const handleJobFailed = useCallback((err) => {
    setActiveJobId(null);
    setActiveJobType(null);
    setPendingAction(null);
    setRunningTargetKey(null);
    setError(err?.message || "Unit test task failed.");
  }, []);

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
      passed = allExecutedScenarios.filter((s) => String(s.status).toLowerCase() === "passed").length;
      failed = allExecutedScenarios.filter((s) => String(s.status).toLowerCase() === "failed").length;
    }
    return { total, passed, failed, durationMs };
  }, [executions, allExecutedScenarios]);

  // Build Unit File Entries (Source Files + Functions + Matched Executed Scenarios + AI Drafts)
  const fileEntries = useMemo(() => {
    const fnMap = new Map();
    for (const fn of functionsList) {
      const fp = cleanDisplayPath(fn.filePath || "");
      if (!fnMap.has(fp)) fnMap.set(fp, []);
      fnMap.get(fp).push(fn);
    }

    const suiteMapByBase = new Map();
    for (const ts of testSuites || []) {
      const tf = cleanDisplayPath(ts.filePath || ts.path || "");
      if (!tf) continue;
      const b = baseNameNoTestExt(tf);
      if (b) suiteMapByBase.set(b, tf);
    }

    // Group executed scenarios by basename heuristic to match source file
    const scenariosByBase = new Map();
    for (const sc of allExecutedScenarios) {
      const b = baseNameNoTestExt(sc.testFile || sc.suiteName || "");
      if (!scenariosByBase.has(b)) scenariosByBase.set(b, []);
      scenariosByBase.get(b).push(sc);
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
      const matchedExecuted = scenariosByBase.get(base) || [];

      const rawSugs = inlineSuggestions[cleanPath] || inlineSuggestions[f.filePath] || [];
      const draftCases = [];
      for (let sIdx = 0; sIdx < rawSugs.length; sIdx++) {
        const sug = rawSugs[sIdx];
        const isApplied = sug.applied === true || ["PASSED", "APPLIED"].includes(sug.status);
        const sugCode =
          sug.fullUpdatedContent ||
          sug.suggestedTestCode ||
          sug.generatedCode ||
          sug.testCode ||
          sug.code ||
          "";
        let testCasesMeta = Array.isArray(sug.testCases) && sug.testCases.length > 0 ? sug.testCases : [];
        if (testCasesMeta.length === 0 && sugCode) {
          const parsedBlocks = extractTestCasesFromCode(sugCode);
          if (parsedBlocks.length > 0) {
            testCasesMeta = parsedBlocks.map((b) => ({
              title: b.title,
              code: b.code,
              category: classifyUnitTestCase({ title: b.title }).category,
            }));
          }
        }
        if (testCasesMeta.length === 0 && Array.isArray(sug.scenarioMatrix) && sug.scenarioMatrix.length > 0) {
          testCasesMeta = sug.scenarioMatrix.map((m, idx) => ({
            title: m.scenario || m.title || m.description || `Case ${idx + 1}`,
            category: m.category || classifyUnitTestCase({ title: m.scenario || m.title }).category,
          }));
        }
        if (testCasesMeta.length === 0) {
          testCasesMeta = [{ title: `AI unit test suite for ${cleanPath.split("/").pop()}`, category: sug.category || "HAPPY_PATH" }];
        }
        for (let tIdx = 0; tIdx < testCasesMeta.length; tIdx++) {
          const tc = testCasesMeta[tIdx];
          const title = tc.title || tc.testName || tc.name || `Draft test ${tIdx + 1}`;
          // Skip draft duplicate if already executed in repo tests with identical title
          if (
            isApplied &&
            matchedExecuted.some(
              (ex) => String(ex.title || "").trim().toLowerCase() === String(title).trim().toLowerCase(),
            )
          ) {
            continue;
          }
          draftCases.push({
            id: `draft::${cleanPath}::${sug.suggestionId || sug.id || sIdx}::${tIdx}`,
            title,
            category: tc.category || classifyUnitTestCase({ title }).category,
            status: isApplied ? "applied" : "draft",
            origin: "AI_DRAFT",
            isApplied,
            code: tc.code || null,
            testFile: cleanDisplayPath(sug.testFile || sug.targetTestFile || suiteMapByBase.get(base) || ""),
            suggestionObj: sug,
            duration: 0,
          });
        }
      }

      const testCases = [...matchedExecuted, ...draftCases];
      const associatedTestFile =
        matchedExecuted[0]?.testFile ||
        draftCases[0]?.testFile ||
        suiteMapByBase.get(base) ||
        "";

      return {
        ...f,
        filePath: cleanPath,
        rawFilePath: f.filePath,
        functions: fnMap.get(cleanPath) || [],
        testCases,
        associatedTestFile,
      };
    });

    if (focusFile) {
      const cleanFocus = cleanDisplayPath(focusFile);
      entries.sort((a, b) => (a.filePath === cleanFocus ? -1 : b.filePath === cleanFocus ? 1 : 0));
    }

    return entries;
  }, [rawFiles, functionsList, testSuites, allExecutedScenarios, inlineSuggestions, focusFile]);

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

  // Handlers
  const handleRunCoverage = async ({ targetFiles = [], targetTestNames = [], targetKey = null } = {}) => {
    if (!snapshotId || isJobActive) return;
    setError("");
    setNotice("");
    setPendingAction("RUN");
    setRunningTargetKey(targetKey);
    try {
      const res = await runCoverageByType(snapshotId, "unit", activeFramework, "full", {
        restart: targetFiles.length === 0 && targetTestNames.length === 0,
        targetFiles,
        targetTestNames,
      });
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

  const handleSuggestFiles = async (targetFilePaths = null) => {
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

    setPendingAction("GENERATE");
    try {
      const res = await suggestAllUnitTestcases(snapshotId, {
        filePaths: paths,
        projectId,
        framework: activeFramework,
        validationMode: "fast",
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
        setNotice(`Generated ${payload.suggestions.length} unit test draft(s).`);
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
        generatedCode: s.generatedCode || s.fullUpdatedContent || s.suggestedTestCode || s.testCode || s.code || "",
        suggestedTestCode: s.fullUpdatedContent || s.generatedCode || s.suggestedTestCode || s.testCode || s.code || "",
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
        const ids = new Set(cleaned.map((s) => s.suggestionId || s.id).filter(Boolean));
        setInlineSuggestions((prev) => applyBatchResultToSuggestionsMap(prev, ids, payload));
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
    try {
      const res = await aiFixUnitTestCaseApi(snapshotId, {
        sourceFile: entry?.filePath || "",
        testFile: tc.testFile,
        testName: tc.title || tc.testName,
        failureMessage: Array.isArray(tc.failureMessages) ? tc.failureMessages.join("\n") : tc.failureSummary || "",
        framework: activeFramework,
      });
      const data = res?.data || res;
      setNotice(`AI Fix applied to "${data.testName || tc.title}". Re-running test to verify...`);
      loadUnitTestVersions();
      await handleRunCoverage({
        targetFiles: [tc.testFile || entry?.filePath].filter(Boolean),
        targetTestNames: [tc.title || tc.testName].filter(Boolean),
        targetKey: entry?.filePath || null,
      });
    } catch (err) {
      setError(err.message || "AI Fix failed for this unit test case.");
    } finally {
      setFixingTestId(null);
    }
  };

  const handleDeleteTestCase = async (tc, entry) => {
    if (!snapshotId) return;
    setError("");
    if (tc.origin === "AI_DRAFT" && !tc.isApplied) {
      setInlineSuggestions((prev) => {
        const key = cleanDisplayPath(entry?.filePath || "");
        const list = prev[key] || [];
        return {
          ...prev,
          [key]: list.filter((s) => (s.suggestionId || s.id) !== (tc.suggestionObj?.suggestionId || tc.suggestionObj?.id)),
        };
      });
      setNotice(`Removed AI draft "${tc.title}".`);
      return;
    }

    try {
      await deleteUnitTestCaseApi(snapshotId, {
        sourceFile: entry?.filePath || "",
        testFile: tc.testFile,
        testName: tc.title || tc.testName,
      });
      setNotice(`Deleted "${tc.title}" (previous version saved in History). Re-running suite...`);
      loadUnitTestVersions();
      await handleRunCoverage({
        targetFiles: [tc.testFile || entry?.filePath].filter(Boolean),
      });
    } catch (err) {
      setError(err.message || "Failed to delete unit test case.");
    }
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

  const linesPct = Number(summary?.coverage?.lines ?? summary?.linesPct ?? 0);
  const branchesPct = Number(summary?.coverage?.branches ?? summary?.branchesPct ?? 0);
  const funcsPct = Number(summary?.coverage?.functions ?? summary?.funcsPct ?? 0);
  const stmtsPct = Number(summary?.coverage?.statements ?? summary?.stmtsPct ?? 0);
  const rawTotals = summary?.rawTotals || null;

  const coveredFilesCount = fileEntries.filter((f) => Number(f.linesPct ?? 0) > 0).length;
  const totalFilesCount = fileEntries.length;
  const passRate = testTotals.total > 0 ? Math.round((testTotals.passed / testTotals.total) * 100) : 0;
  const hasExecuted = testTotals.total > 0 || Boolean(summary?.hasRun);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg)] text-[var(--color-text)] font-sans select-text overflow-hidden">
      {/* ── 1. SLEEK INDUSTRIAL COCKPIT HEADER ── */}
      <header className="shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] z-20 relative">
        {isFetching && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--color-surface-secondary)] overflow-hidden">
            <div className="h-full bg-[var(--color-primary)] animate-pulse w-full" />
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
            <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
              {activeFramework}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {onOpenJobQueue && (
              <CoverageJobQueueButton onClick={onOpenJobQueue} running={isJobActive} />
            )}

            <button
              type="button"
              onClick={() => setSetupDrawerOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors cursor-pointer"
              title="Inspect runner dependencies and hermetic environment setup"
            >
              <SlidersHorizontal size={13} className="text-[var(--color-text-muted)]" />
              <span>Test Setup</span>
              {missingDependencies.length > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 font-mono text-[10px]">
                  {missingDependencies.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching || isJobActive}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => handleRunCoverage()}
              disabled={!projectAccess.can("tests.run") || isJobActive || pendingAction === "RUN"}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors active:scale-[0.98] cursor-pointer disabled:opacity-50"
              title="Run Jest / Vitest unit test suite and measure code coverage"
            >
              {pendingAction === "RUN" || (isJobActive && activeJobType === "RUN") ? (
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
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors cursor-pointer"
            >
              <Download size={13} />
              <span className="hidden md:inline">Export</span>
            </button>

            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                drawerOpen
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30 font-semibold"
                  : "bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)]"
              }`}
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
              <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                <span>Unit code coverage</span>
                <span className="font-mono tabular-nums text-[var(--color-text-muted)] text-[11px]">
                  S {stmtsPct.toFixed(0)}% · B {branchesPct.toFixed(0)}% · F {funcsPct.toFixed(0)}%
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
                    {linesPct.toFixed(1)}%
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">lines</span>
                </div>
                <div className="flex-1 max-w-[160px] bg-[var(--color-surface-secondary)] h-1.5 rounded-sm overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      linesPct >= 80
                        ? "bg-emerald-500"
                        : linesPct >= 50
                          ? "bg-amber-500"
                          : "bg-[var(--color-primary)]"
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, linesPct))}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Source Files & Functions */}
            <div className="lg:col-span-3 px-4 py-3 flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                <span>Source files</span>
                <span className="font-mono tabular-nums text-[11px] text-[var(--color-text-muted)]">
                  {functionsList.length} fns · {testSuites.length} suites
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
                <span className="text-xl font-bold text-[var(--color-text)]">
                  {coveredFilesCount}/{totalFilesCount}
                </span>
                <span className="text-[11px] text-[var(--color-text-muted)]">covered</span>
              </div>
            </div>

            {/* Scenarios / Assertions */}
            <div className="lg:col-span-2 px-4 py-3 flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                <span>Tests</span>
                {testTotals.total > 0 && (
                  <span className="font-mono tabular-nums text-[11px] text-[var(--color-text-muted)]">
                    {passRate}%
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 font-mono tabular-nums">
                <span className="text-xl font-bold text-[var(--color-text)]">
                  {testTotals.passed}
                </span>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  / {testTotals.total} passed
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
                  {(testTotals.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono tabular-nums">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    !hasExecuted
                      ? "bg-[var(--color-text-muted)]"
                      : testTotals.failed === 0
                        ? "bg-emerald-500/75"
                        : "bg-rose-400/80"
                  }`}
                />
                <span
                  className={`text-sm font-medium truncate ${
                    testTotals.failed > 0 ? "text-rose-400" : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {!hasExecuted
                    ? "Not run yet"
                    : testTotals.failed === 0
                      ? "All healthy"
                      : `${testTotals.failed} failed`}
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
                badge: testTotals.failed > 0 ? `${testTotals.failed} failed` : null,
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
                  className={`relative flex items-center gap-1.5 py-2.5 text-xs font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
                    isActive
                      ? "border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                      : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  <Icon
                    size={13}
                    className={isActive ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"}
                  />
                  <span>{tab.label}</span>
                  {tab.badge != null && (
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-mono tabular-nums ${
                        tab.id === "report" && testTotals.failed > 0
                          ? "bg-rose-500/15 text-rose-400"
                          : isActive
                            ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                            : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {isFetching && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-[var(--color-primary)]">
              <RefreshCw size={11} className="animate-spin" /> Syncing...
            </span>
          )}
        </div>
      </header>

      {/* ── MAIN SCROLLABLE WORKSPACE BODY ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Error / Notice Banners */}
        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button type="button" onClick={() => setError("")} className="text-rose-400 hover:text-rose-200 cursor-pointer">
              <X size={14} />
            </button>
          </div>
        )}

        {notice && (
          <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-300 flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")} className="text-emerald-400 hover:text-emerald-200 cursor-pointer">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Setup / Missing Packages Banner */}
        {(setupDrawerOpen || missingDependencies.length > 0) && (
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
                <Loader2 size={15} className="animate-spin text-[var(--color-primary)]" />
                <div>
                  <div className="text-xs font-semibold text-[var(--color-text)]">
                    {activeJobType === "GENERATE"
                      ? "Generating AI Unit Test Drafts..."
                      : activeJobType === "APPLY"
                        ? "Verifying & Applying Unit Tests..."
                        : "Running Unit Test Coverage Analysis..."}
                  </div>
                  <div className="text-[11px] font-mono text-[var(--color-text-muted)]">
                    {statusLabel || "Processing job..."} ({Math.max(5, Math.min(100, Math.round(progress || 10)))}%)
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
                  onClick={() => activeJobId && cancelJobApi(activeJobId).catch(() => {})}
                  className="px-2.5 py-1 rounded border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-[11px] text-rose-400 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>

            <div className="h-1.5 rounded-sm bg-[var(--color-surface-secondary)] overflow-hidden">
              <div
                className="h-full bg-[var(--color-primary)] transition-all duration-300"
                style={{ width: `${Math.max(8, Math.min(100, progress || 15))}%` }}
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
          <UnitFileMatrixTable
            fileEntries={fileEntries}
            hasExecuted={hasExecuted}
            onSuggestSelected={(paths) => handleSuggestFiles(paths)}
            onSuggestAllUncovered={() => handleSuggestFiles(null)}
            onApplySelected={(sugs) => handleApplySuggestions(sugs)}
            onApplySingleDraft={(sug) => handleApplySuggestions([sug])}
            onRunSelectedFiles={(paths) => handleRunCoverage({ targetFiles: paths })}
            onRunSelectedTests={(tests) =>
              handleRunCoverage({
                targetFiles: [...new Set(tests.map((t) => t.testFile || t.sourceFile).filter(Boolean))],
                targetTestNames: tests.map((t) => t.title || t.testName).filter(Boolean),
              })
            }
            onRunFile={(entry) =>
              handleRunCoverage({
                targetFiles: [entry.associatedTestFile || entry.filePath].filter(Boolean),
                targetKey: entry.filePath,
              })
            }
            onRunTestCase={(tc, entry) =>
              handleRunCoverage({
                targetFiles: [tc.testFile || entry?.filePath].filter(Boolean),
                targetTestNames: [tc.title || tc.testName].filter(Boolean),
                targetKey: entry?.filePath || null,
              })
            }
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
            onAIFixTestCase={handleAIFixTestCase}
            onOpenFileAnalysis={(entry) => setAnalysisFile(entry)}
            onOpenSourceFile={onOpenFile}
            onOpenDiffReview={(filePath) => setDiffReviewFilePath(filePath)}
            isGenerating={pendingAction === "GENERATE" || (isJobActive && activeJobType === "GENERATE")}
            isApplying={pendingAction === "APPLY" || (isJobActive && activeJobType === "APPLY")}
            isRunning={pendingAction === "RUN" || (isJobActive && activeJobType === "RUN")}
            fixingTestId={fixingTestId}
            runningTargetKey={runningTargetKey}
          />
        )}

        {/* TAB 2: EXECUTIVE REPORT */}
        {activeTab === "report" && (
          <UnitReportEmbed
            coverageSummary={{
              lines: linesPct,
              branches: branchesPct,
              functions: funcsPct,
              statements: stmtsPct,
            }}
            rawTotals={rawTotals}
            fileEntries={fileEntries}
            executedScenarios={allExecutedScenarios}
            testStats={testTotals}
            hasExecuted={hasExecuted}
            onRunCoverage={() => handleRunCoverage()}
            onOpenExportModal={() => setIsExportModalOpen(true)}
            onAIFixTestCase={handleAIFixTestCase}
            onRunTestCase={(tc, entry) =>
              handleRunCoverage({
                targetFiles: [tc.testFile || entry?.filePath].filter(Boolean),
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
                <h2 className="text-sm font-semibold m-0">Unit Test Version History (v1 / v2)</h2>
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
        onSaved={async (_data, meta) => {
          loadUnitTestVersions();
          setNotice("Unit test saved cleanly.");
          if (meta?.andRun) {
            await handleRunCoverage({
              targetFiles: [meta.testFile || editorModalState.sourceFile].filter(Boolean),
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
            handleApplySuggestions(rf?.suggestions || inlineSuggestions[diffReviewFilePath] || [])
          }
          onApplyAll={() =>
            handleApplySuggestions(reviewFiles.flatMap((rf) => rf.suggestions || []))
          }
          isApplying={pendingAction === "APPLY" || (isJobActive && activeJobType === "APPLY")}
        />
      )}

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
