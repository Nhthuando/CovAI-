import { useProjectAccess } from "../../hooks/useProjectAccess";
import { useChatTestContext } from "../../hooks/useChatTestContext";
import {
  getIntegrationScenarioApi,
  mutateIntegrationScenarioApi,
  bulkDeleteIntegrationScenariosApi,
} from "../../services/integrationScenario.service";
import {
  loadStagedOps,
  saveStagedOps,
  stageAddOp,
  stageUpdateOp,
  stageDeleteOp,
  countStagedOps,
  matchesStagedTarget,
  extractBlockTitle,
} from "../../lib/stagedScenarioOps.js";
import React, {
  useCallback,
  useEffect,
  useState,
  useRef,
  useMemo,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  getIntegrationWorkspace,
  runCoverageByType,
  getIntegrationDetection,
  installIntegrationDependencies,
  generateIntegrationTests,
  regenerateIntegrationScenario,
  updateIntegrationScenario,
} from "../../services/coverage.service.js";
import { fetchIntegrationReport } from "../../services/report.service.js";
import { runProjectStructureAnalysisApi } from "../../services/project.service.js";
import { cancelJobApi } from "../../services/job.service.js";
import { invalidateCoverageQueries } from "../../hooks/useCoverageQuery.js";
import {
  Search,
  Zap,
  CheckCircle2,
  XCircle,
  PlayCircle,
  BarChart3,
  ChevronRight,
  ChevronDown,
  Play,
  Clock,
  AlertTriangle,
  RefreshCw,
  X,
  GitCompare,
  Layers,
  Terminal,
  FileCode,
  HardDriveDownload,
  Printer,
  Download,
  SlidersHorizontal,
  Code2,
  FileCheck,
  ShieldCheck,
  Activity,
  ExternalLink,
  Network,
  FileText,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "./ToastContext";

import IntegrationRouteMatrixTable from "./integration/IntegrationRouteMatrixTable.jsx";
import { saveMatrixSelection } from "../../lib/matrixSelectionStorage.js";
import IntegrationReportEmbed from "./integration/IntegrationReportEmbed.jsx";
import IntegrationScenariosPane from "./integration/IntegrationScenariosPane.jsx";
import IntegrationLiveProgress from "./integration/IntegrationLiveProgress.jsx";
import IntegrationHistoryPane from "./integration/IntegrationHistoryPane.jsx";
import BeforeAfterComparisonView from "./integration/BeforeAfterComparisonView.jsx";
import MetricProvenancePopover from "./integration/MetricProvenancePopover.jsx";
import IntegrationErrorBoundary from "./integration/IntegrationErrorBoundary.jsx";
import IntegrationApplyTestsModal from "./integration/IntegrationApplyTestsModal.jsx";
import IntegrationScenarioEditorModal from "./integration/IntegrationScenarioEditorModal.jsx";
import SourceCodeViewerModal from "./integration/SourceCodeViewerModal.jsx";
import IntegrationSimulationStudioModal from "./integration/IntegrationSimulationStudioModal.jsx";
import {
  getEndpointCaseCoverage,
  getEpIdentityKey,
  getScenarioIdentityKey,
} from "./integration/integrationCaseCoverage.js";

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

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Failed API call");
  return data;
}

async function approveIntegrationTestsApi(snapshotId, approvedTestIds) {
  const res = await fetch(
    `${BASE_URL}/coverage/${snapshotId}/integration/approve`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ approvedTestIds }),
    },
  );
  return handleResponse(res);
}

const FAILURE_LAYERS_META = {
  ROUTER_NOT_FOUND: {
    label: "Router (404)",
    code: "[ROUTER_NOT_FOUND]",
    style: "bg-orange-500/10 text-orange-400 border-orange-500/25",
    desc: "Route path or URL mount point does not match Express router.",
  },
  MIDDLEWARE_REJECTED: {
    label: "Middleware (401/403)",
    code: "[MIDDLEWARE_REJECTED]",
    style: "bg-amber-500/10 text-amber-400 border-amber-500/25",
    desc: "Rejected by Authentication, JWT token, CORS, or Request Validator.",
  },
  CONTROLLER_CRASH: {
    label: "Controller (500)",
    code: "[CONTROLLER_CRASH]",
    style: "bg-rose-500/10 text-rose-400 border-rose-500/25",
    desc: "Runtime crash (TypeError, ReferenceError) in controller handler.",
  },
  DATABASE_FAILURE: {
    label: "Database / ORM",
    code: "[DATABASE_FAILURE]",
    style: "bg-purple-500/10 text-purple-400 border-purple-500/25",
    desc: "Database connection failure, schema constraint violation, or query error.",
  },
  ASSERTION_FAILED: {
    label: "Assertion Mismatch",
    code: "[ASSERTION_FAILED]",
    style: "bg-sky-500/10 text-sky-400 border-sky-500/25",
    desc: "HTTP response status code or JSON body does not match expected value.",
  },
};

const METHOD_STYLES = {
  GET: "bg-sky-500/10 text-sky-400 border-sky-500/25",
  POST: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  PUT: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  PATCH: "bg-purple-500/10 text-purple-400 border-purple-500/25",
  DELETE: "bg-rose-500/10 text-rose-400 border-rose-500/25",
  DEFAULT:
    "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

function useLiveJobLogs(jobId, onComplete, onError, onCanceled) {
  const [logs, setLogs] = useState([]);
  const logsEndRef = useRef(null);

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
      return;
    }

    let isClosed = false;
    const token = localStorage.getItem("token");
    const eventSource = new EventSource(
      `${BASE_URL}/job/${jobId}/stream?token=${token}`,
    );

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.error) {
          isClosed = true;
          eventSource.close();
          onErrorRef.current(new Error(data.error));
          return;
        }

        if (data.logs) {
          const parsedLogs = data.logs.map((log) => {
            try {
              const parsedMsg = JSON.parse(log.message);
              return { ...log, parsedMessage: parsedMsg };
            } catch {
              return log;
            }
          });
          setLogs(parsedLogs);
        }

        if (data.status === "SUCCESS") {
          isClosed = true;
          eventSource.close();
          onCompleteRef.current();
        } else if (data.status === "FAILED") {
          isClosed = true;
          eventSource.close();
          onErrorRef.current(new Error(data.errorMessage || "Job failed"));
        } else if (data.status === "CANCELED") {
          isClosed = true;
          eventSource.close();
          if (onCanceledRef.current) {
            onCanceledRef.current();
          } else {
            onErrorRef.current(new Error("Job was canceled"));
          }
        }
      } catch (err) {
        console.error("Failed to parse SSE message:", err);
      }
    };

    eventSource.onerror = (err) => {
      if (isClosed) return;
      console.error("EventSource error:", err);
      isClosed = true;
      eventSource.close();
      onErrorRef.current(new Error("Lost connection to job stream"));
    };

    return () => {
      isClosed = true;
      eventSource.close();
    };
  }, [jobId]);

  return { logs, logsEndRef };
}

function IntegrationCockpitSkeleton() {
  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg)] font-sans select-none overflow-hidden animate-in fade-in duration-150">
      {/* Top Header Skeleton */}
      <header className="shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-5 py-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] animate-pulse" />
            <div className="h-5 w-48 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
            <div className="h-4 w-16 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
            <div className="h-4 w-20 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-7 w-28 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
            <div className="h-7 w-32 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
            <div className="h-7 w-24 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
          </div>
        </div>
      </header>

      {/* KPI Cards Skeleton */}
      <div className="px-5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/25">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xs space-y-2"
            >
              <div className="h-2.5 w-20 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
              <div className="flex items-baseline justify-between">
                <div className="h-5 w-16 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
                <div className="h-4 w-14 rounded-full bg-[var(--color-surface-secondary)] animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs Skeleton */}
      <div className="px-5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="inline-flex items-center gap-1 p-0.5 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
          {[24, 28, 22, 32, 26].map((w, i) => (
            <div
              key={i}
              className="h-6 rounded-[var(--radius-sm)] bg-[var(--color-surface)]/80 animate-pulse"
              style={{ width: `${w * 4}px` }}
            />
          ))}
        </div>
      </div>

      {/* Content Skeleton: Table Rows */}
      <div className="flex-1 overflow-hidden p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="h-8 w-64 rounded bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
          <div className="flex items-center gap-2">
            <div className="h-7 w-24 rounded bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
            <div className="h-7 w-20 rounded bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs overflow-hidden divide-y divide-[var(--color-border)]">
          <div className="p-3 bg-[var(--color-surface-secondary)]/40 flex items-center justify-between">
            <div className="h-3.5 w-32 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
            <div className="h-3.5 w-24 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
          </div>
          {[1, 2, 3, 4, 5, 6].map((row) => (
            <div
              key={row}
              className="p-3 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                <div className="h-4 w-12 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
                <div className="h-4 w-48 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-5 w-20 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
                <div className="h-6 w-6 rounded bg-[var(--color-surface-secondary)] animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function IntegrationWorkspace({
  onChatContextChange,
  projectId,
  snapshotId,
  onGenerate: _onGenerate,
  generating,
  onOpenFile,
  onOpenCFG,
  onSuggestTestcase,
  onOpenArchitecture,
  initialContext,
  onContextChange,
  activeView,
}) {
  const { showToast } = useToast();
  const projectAccess = useProjectAccess(projectId);
  const navigate = useNavigate();
  const location = useLocation();

  const [workspace, setWorkspace] = useState(
    initialContext?.cachedWorkspace || null,
  );
  const [reportData, setReportData] = useState(null);
  const [detectionInfo, setDetectionInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isScanningEndpoints, setIsScanningEndpoints] = useState(false);
  const [hasScanned, setHasScanned] = useState(
    Boolean(
      initialContext?.cachedWorkspace?.generation?.hasScannedEndpoints ||
      (initialContext?.cachedWorkspace?.endpoints || []).length > 0,
    ),
  );
  const [error, setError] = useState("");

  // Smart Coverage & 100% API Test Suite Setup Modal State
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [setupFramework, setSetupFramework] = useState("SUPERTEST");
  const [setupAutoRun, setSetupAutoRun] = useState(true);
  const [isRunningSetupFlow, setIsRunningSetupFlow] = useState(false);
  const autoRunAfterGenerateRef = useRef(false);

  // Active Jobs State
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeJobType, setActiveJobType] = useState(null);
  const [activeJobStatus, setActiveJobStatus] = useState("RUNNING");
  const activeJobIdRef = useRef(null);
  const pendingExecuteJobIdRef = useRef(null);
  const hasScannedRef = useRef(hasScanned);
  hasScannedRef.current = hasScanned;
  activeJobIdRef.current = activeJobId;
  const matrixRef = useRef(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationNotice, setCancellationNotice] = useState("");
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);

  // Framework Installation & Banner
  const [isInstallingDeps, setIsInstallingDeps] = useState(false);
  const [isGeneratingWithBanner, setIsGeneratingWithBanner] = useState(false);

  const [pendingOps, setPendingOps] = useState(() =>
    loadStagedOps("integration", snapshotId),
  );
  const [isApplyingPending, setIsApplyingPending] = useState(false);

  useEffect(() => {
    setPendingOps(loadStagedOps("integration", snapshotId));
  }, [snapshotId]);

  useEffect(() => {
    saveStagedOps("integration", snapshotId, pendingOps);
  }, [snapshotId, pendingOps]);

  const pendingOpsCount = countStagedOps(pendingOps);

  // Modals & Drawer State
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [applyModalTestIds, setApplyModalTestIds] = useState([]);
  const [applyModalInitialKeys, setApplyModalInitialKeys] = useState(null);
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [editorModalScenario, setEditorModalScenario] = useState(null);
  const [editorModalEndpoint, setEditorModalEndpoint] = useState(null);
  const [isAddScenarioMode, setIsAddScenarioMode] = useState(false);
  const [savingScenario, setSavingScenario] = useState(false);
  const [editorSaveError, setEditorSaveError] = useState("");
  const [sourceViewerOpen, setSourceViewerOpen] = useState(false);
  const [sourceViewerOptions, setSourceViewerOptions] = useState([]);
  const [simulationModalState, setSimulationModalState] = useState({
    isOpen: false,
    endpoint: null,
    scenario: null,
    autoPlay: true,
  });
  const [showLiveLogsDetails, setShowLiveLogsDetails] = useState(false);
  const [jobElapsedSeconds, setJobElapsedSeconds] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(null); // 'history' | 'compare' | null
  const [activeFailureLayerFilter, setActiveFailureLayerFilter] =
    useState("ALL");
  const [expandedCallstacks, setExpandedCallstacks] = useState({});

  // Active navigation tab (only 2 tabs: 'endpoints' and 'report')
  const [activeTab, setActiveTab] = useState(() => {
    if (activeView === "report") return "report";
    const params = new URLSearchParams(location.search);
    const focusSection = params.get("focusSection");
    const view = params.get("view");
    if (
      view === "report" ||
      focusSection === "section-report" ||
      focusSection === "section-failures"
    )
      return "report";
    return "endpoints";
  });

  useEffect(() => {
    let interval = null;
    if (
      activeJobId &&
      (activeJobStatus === "RUNNING" || activeJobStatus === "QUEUED")
    ) {
      setJobElapsedSeconds(0);
      interval = setInterval(() => {
        setJobElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setJobElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeJobId, activeJobStatus]);

  const liveDurationText = `${Math.floor(jobElapsedSeconds / 60)}m ${jobElapsedSeconds % 60}s`;

  useEffect(() => {
    if (activeView === "report") {
      setActiveTab("report");
    } else if (activeView === "dashboard" && activeTab === "report") {
      setActiveTab("endpoints");
    }
  }, [activeView]);

  const scrollToSection = (id) => {
    if (id === "section-failures" || id === "section-report")
      setActiveTab("report");
    else setActiveTab("endpoints");
  };

  const toggleCallstack = (key) => {
    setExpandedCallstacks((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // 1. Data Loader: Instant History Load (does NOT auto-scan AST unless already scanned/executed)
  const load = useCallback(
    async (loadOptions = {}) => {
      if (!snapshotId) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      setRefreshing(true);
      setError("");

      const shouldScanNow = Boolean(loadOptions.scan);
      const shouldSkipAutoScan = !shouldScanNow && !hasScannedRef.current;

      try {
        const [workspaceRes, detectionRes, reportRes] =
          await Promise.allSettled([
            getIntegrationWorkspace(snapshotId, {
              skipAutoScan: shouldSkipAutoScan,
              scan: shouldScanNow,
            }),
            getIntegrationDetection(snapshotId),
            projectId
              ? fetchIntegrationReport(projectId)
              : Promise.resolve({ data: null }),
          ]);

        if (workspaceRes.status === "fulfilled") {
          const wsData = workspaceRes.value.data;
          setWorkspace(wsData);

          if (
            shouldScanNow ||
            Boolean(wsData?.generation?.hasScannedEndpoints) ||
            Boolean(wsData?.generation?.hasPriorHistory)
          ) {
            hasScannedRef.current = true;
            setHasScanned(true);
          } else if (shouldSkipAutoScan) {
            hasScannedRef.current = false;
            setHasScanned(false);
          }

          // Check running background jobs
          if (!activeJobIdRef.current) {
            const fetchedJobs = wsData?.jobs || {};
            let runningJobId = null;
            let runningJobType = null;

            if (
              fetchedJobs.generate?.status === "RUNNING" ||
              fetchedJobs.generate?.status === "QUEUED"
            ) {
              runningJobId = fetchedJobs.generate.id;
              runningJobType = "GENERATE";
            } else if (
              fetchedJobs.execute?.status === "RUNNING" ||
              fetchedJobs.execute?.status === "QUEUED"
            ) {
              runningJobId = fetchedJobs.execute.id;
              runningJobType = "EXECUTE";
            }

            if (runningJobId) {
              setActiveJobId(runningJobId);
              setActiveJobType(runningJobType);
              setActiveJobStatus("RUNNING");
            }
          }

          // Initialize selectedTestIds from both aiTests and discovered endpoint scenarios
          if (selectedTestIds.length === 0) {
            const aiIds = (wsData?.aiTests || []).flatMap((t) =>
              (t?.requests || []).map(
                (r) => `${t.id}::${r.scenarioId || r.testName}`,
              ),
            );
            const epIds = (wsData?.endpoints || []).flatMap((ep) =>
              (ep.scenarios || []).map(
                (s, idx) =>
                  s.id ||
                  `${(ep.method || "GET").toUpperCase()} ${ep.path || ep.route || "/"}::scenario_${idx}`,
              ),
            );
            const allIds = Array.from(new Set([...aiIds, ...epIds]));
            if (allIds.length > 0) {
              setSelectedTestIds(allIds);
            }
          }
        } else {
          throw new Error(
            workspaceRes.reason?.message || "Failed to load workspace.",
          );
        }

        if (detectionRes.status === "fulfilled") {
          const det = detectionRes.value.data || detectionRes.value;
          setDetectionInfo(det);
          setSetupFramework("SUPERTEST");
        }

        if (reportRes.status === "fulfilled" && reportRes.value?.data) {
          setReportData(reportRes.value.data);
        }
      } catch (err) {
        setError(err.message || "Failed to load integration test workspace.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [snapshotId, projectId],
  );

  const flushPendingOps = useCallback(
    async ({ reload = true } = {}) => {
      if (!snapshotId || countStagedOps(pendingOps) === 0) return true;
      setIsApplyingPending(true);
      try {
        for (const d of pendingOps.deletes || []) {
          await mutateIntegrationScenarioApi({
            snapshotId,
            aiTestId: d.aiTestId,
            scenarioId: d.scenarioId,
            expectedVersion: d.expectedVersion ?? 1,
            filePath: d.filePath,
            testName: d.testName,
            origin: d.origin,
            action: "DELETE",
          });
        }
        for (const u of pendingOps.updates || []) {
          await mutateIntegrationScenarioApi({
            snapshotId,
            aiTestId: u.aiTestId || "default",
            scenarioId: u.scenarioId,
            expectedVersion: u.expectedVersion,
            action: "UPDATE",
            code: u.code,
            endpoint: u.endpoint,
            filePath: u.filePath,
            testName: u.originalTestName || u.testName,
            origin: u.origin,
          });
        }
        for (const a of pendingOps.adds || []) {
          await mutateIntegrationScenarioApi({
            snapshotId,
            aiTestId: a.aiTestId || "default",
            expectedVersion: a.expectedVersion,
            action: "ADD",
            code: a.code,
            endpoint: a.endpoint,
            filePath: a.filePath,
            testName: a.testName,
            origin: a.origin,
          });
        }
        const cleared = { deletes: [], updates: [], adds: [] };
        setPendingOps(cleared);
        saveStagedOps("integration", snapshotId, cleared);
        if (reload) await load({ scan: false });
        return true;
      } catch (err) {
        setError(err.message || "Failed to apply pending scenario changes.");
        return false;
      } finally {
        setIsApplyingPending(false);
      }
    },
    [snapshotId, pendingOps, load],
  );

  // Explicit AST API Endpoint Discovery Triggered from Endpoints Matrix
  const handleScanEndpoints = useCallback(async () => {
    if (!snapshotId || isScanningEndpoints) return;
    setIsScanningEndpoints(true);
    setError("");
    setCancellationNotice("");
    try {
      const [wsRes, detRes] = await Promise.allSettled([
        getIntegrationWorkspace(snapshotId, { scan: true }),
        getIntegrationDetection(snapshotId),
      ]);
      if (wsRes.status === "fulfilled" && wsRes.value?.data) {
        const wsData = wsRes.value.data;
        setWorkspace(wsData);
        setHasScanned(true);
        const count = (wsData.endpoints || []).length;
        showToast({
          type: "success",
          title: "API Scan Completed",
          message: `Discovered ${count} API endpoint${count === 1 ? "" : "s"} across Express/Node routes.`,
        });
      } else {
        throw new Error(
          wsRes.reason?.message || "Failed to scan API endpoints.",
        );
      }
      if (detRes.status === "fulfilled") {
        setDetectionInfo(detRes.value.data || detRes.value);
      }
    } catch (err) {
      setError(err.message || "Failed to scan API endpoints.");
    } finally {
      setIsScanningEndpoints(false);
    }
  }, [snapshotId, isScanningEndpoints, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  // Sync upwards context
  useEffect(() => {
    if (onContextChange && snapshotId && projectId) {
      onContextChange({
        snapshotId,
        projectId,
        cachedWorkspace: workspace,
      });
    }
  }, [snapshotId, projectId, workspace, onContextChange]);

  const startExecutionTracking = useCallback((response) => {
    const jobs = response?.data?.jobs || [];
    const installJob = jobs.find(
      (j) => j?.type === "INSTALL_DEPS" && j?.status !== "SUCCESS",
    );
    const supertestJob =
      jobs.find((j) => j?.type === "SUPERTEST_COVERAGE") || response?.data?.job;
    const supertestJobId =
      supertestJob?.id || response?.data?.jobId || response?.jobId || null;

    if (installJob?.id && supertestJobId && installJob.id !== supertestJobId) {
      pendingExecuteJobIdRef.current = supertestJobId;
      setActiveJobId(installJob.id);
      setActiveJobType("EXECUTE");
      setActiveJobStatus("RUNNING");
      return;
    }

    pendingExecuteJobIdRef.current = null;
    if (supertestJobId) {
      setActiveJobId(supertestJobId);
      setActiveJobType("EXECUTE");
      setActiveJobStatus("RUNNING");
    }
  }, []);

  // Job completion handlers
  const handleJobComplete = useCallback(async () => {
    if (pendingExecuteJobIdRef.current) {
      const nextExecuteJobId = pendingExecuteJobIdRef.current;
      pendingExecuteJobIdRef.current = null;
      setActiveJobId(nextExecuteJobId);
      setActiveJobType("EXECUTE");
      setActiveJobStatus("RUNNING");
      return;
    }
    setActiveJobStatus("SUCCESS");
    const completedType = activeJobType;
    try {
      await load();
      if (snapshotId) {
        invalidateCoverageQueries(snapshotId);
      }
      if (completedType === "EXECUTE") {
        showToast({
          type: "success",
          title: "Coverage Run Completed",
          message:
            "API test suite execution finished. Coverage & diagnostics updated.",
        });
      } else if (completedType === "GENERATE") {
        showToast({
          type: "success",
          title: "100% API Test Suite Generated",
          message: autoRunAfterGenerateRef.current
            ? "Test scenarios ready. Starting coverage execution automatically..."
            : "New test scenarios generated and ready in Endpoints Matrix.",
        });
      } else if (completedType === "ANALYZE") {
        showToast({
          type: "info",
          title: "AST Analysis Complete",
          message: "Express route catalog and dependency map updated.",
        });
      }
    } catch (err) {
      console.error(
        "[IntegrationWorkspace] Failed to reload workspace after job:",
        err,
      );
    } finally {
      const shouldAutoRun =
        completedType === "GENERATE" && autoRunAfterGenerateRef.current;
      autoRunAfterGenerateRef.current = false;
      setTimeout(async () => {
        setActiveJobId(null);
        setActiveJobType(null);
        setActiveJobStatus("SUCCESS");
        setIsCancelling(false);
        setPendingAction(null);
        if (shouldAutoRun && snapshotId) {
          try {
            const response = await runCoverageByType(snapshotId, "integration");
            const nextJobId =
              response?.data?.job?.id ||
              response?.data?.jobId ||
              response?.jobId;
            if (nextJobId) {
              setActiveJobId(nextJobId);
              setActiveJobType("EXECUTE");
              setActiveJobStatus("RUNNING");
            }
          } catch (runErr) {
            console.error(
              "[IntegrationWorkspace] Auto-run after generation failed:",
              runErr,
            );
            setError(
              runErr.message || "Failed to auto-run coverage after generation.",
            );
          }
        }
      }, 450);
    }
  }, [load, snapshotId, activeJobType, showToast]);

  const handleJobCanceled = useCallback(async () => {
    setActiveJobStatus("CANCELED");
    setCancellationNotice("Task canceled successfully.");
    showToast({
      type: "warning",
      title: "Task Canceled",
      message: "The running task was terminated.",
    });
    try {
      await load();
    } catch (err) {
      console.error(
        "[IntegrationWorkspace] Failed to reload workspace after cancel:",
        err,
      );
    } finally {
      setTimeout(() => {
        setActiveJobId(null);
        setActiveJobType(null);
        setActiveJobStatus("CANCELED");
        setIsCancelling(false);
        setPendingAction(null);
      }, 500);
    }
  }, [load, showToast]);

  useEffect(() => {
    const onIntegrationUpdated = (e) => {
      const targetSnap = e?.detail?.snapshotId;
      if (!targetSnap || targetSnap === snapshotId) {
        load({ scan: false });
      }
    };
    window.addEventListener("covai:integration-updated", onIntegrationUpdated);
    return () =>
      window.removeEventListener(
        "covai:integration-updated",
        onIntegrationUpdated,
      );
  }, [load, snapshotId]);

  const handleCancelActiveJob = useCallback(
    async (targetJobId = null) => {
      const jId = targetJobId || activeJobId;
      if (!jId || isCancelling) return;
      setIsCancelling(true);
      setError("");
      try {
        const pendingId = pendingExecuteJobIdRef.current;
        pendingExecuteJobIdRef.current = null;
        await cancelJobApi(jId);
        if (pendingId && pendingId !== jId) {
          await cancelJobApi(pendingId).catch(() => {});
        }
        setActiveJobStatus("CANCELED");
        setCancellationNotice("Task canceled successfully.");
        await load();
        setTimeout(() => {
          setActiveJobId(null);
          setActiveJobType(null);
          setActiveJobStatus("RUNNING");
          setIsCancelling(false);
          setPendingAction(null);
        }, 500);
      } catch (err) {
        console.error("[IntegrationWorkspace] Failed to cancel job:", err);
        setError(err.message || "Failed to cancel task. Please try again.");
        await load();
        setIsCancelling(false);
      }
    },
    [activeJobId, isCancelling, load],
  );

  const { logs: activeLogs, logsEndRef } = useLiveJobLogs(
    activeJobId,
    handleJobComplete,
    async (err) => {
      setActiveJobStatus("FAILED");
      setError(err.message);
      setIsCancelling(false);
      showToast({
        type: "error",
        title: "Task Failed",
        message: err.message || "Execution encountered an error.",
      });
      try {
        await load();
      } catch (_) {}
      setTimeout(() => {
        setActiveJobId(null);
        setActiveJobType(null);
        setPendingAction(null);
      }, 1200);
    },
    handleJobCanceled,
  );

  // Install missing test libraries
  const handleInstallDependencies = async () => {
    if (!projectAccess.can("integrations.write")) return;
    if (!snapshotId || isInstallingDeps) return;
    setIsInstallingDeps(true);
    setError("");
    try {
      await installIntegrationDependencies(snapshotId);
      await load();
    } catch (err) {
      setError(err.message || "Failed to install testing libraries.");
    } finally {
      setIsInstallingDeps(false);
    }
  };

  // Generate tests via framework detection banner
  const handleGenerateByBannerFramework = async (targetFramework) => {
    if (!projectAccess.can("ai.use")) return;
    if (!snapshotId || isGeneratingWithBanner) return;
    setIsGeneratingWithBanner(true);
    setError("");
    try {
      const res = await generateIntegrationTests(snapshotId, {
        framework: targetFramework,
        force: true,
      });
      const jId =
        res?.data?.job?.id || res?.data?.jobId || res?.job?.id || res?.jobId;
      if (jId) {
        setActiveJobId(jId);
        setActiveJobType("GENERATE");
        setActiveJobStatus("RUNNING");
      } else {
        await load();
        if (snapshotId) {
          invalidateCoverageQueries(snapshotId);
        }
      }
    } catch (err) {
      setError(err.message || "Failed to generate tests automatically.");
    } finally {
      setIsGeneratingWithBanner(false);
    }
  };

  // Run AST Project Analysis
  const handleRunAnalysis = async () => {
    if (!projectAccess.can("tests.run")) return;
    if (
      !projectId ||
      !snapshotId ||
      (activeJobId && activeJobStatus !== "FAILED")
    )
      return;
    setError("");
    setPendingAction("ANALYZE");
    try {
      const response = await runProjectStructureAnalysisApi(
        projectId,
        snapshotId,
      );
      const jobId = response?.data?.job?.id || response?.job?.id;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("ANALYZE");
        setActiveJobStatus("RUNNING");
      }
    } catch (err) {
      setError(err.message || "Project structure analysis failed.");
    } finally {
      setPendingAction(null);
    }
  };

  // Run AI Test Generator (3-rule framework selection: installed lib -> syntax inference -> 1-of-2 choice when zero libs & zero tests)
  const handleGenerateClick = async (
    explicitTargets = null,
    explicitFramework = null,
  ) => {
    if (!projectAccess.can("ai.use")) return;
    if (isJobActive || pendingAction === "GENERATE") {
      return;
    }
    if (endpoints.length === 0 && !workspace?.generation?.hasAnalysis) {
      setError(
        "Please run project analysis to discover API endpoints before generating test scenarios.",
      );
      showToast({
        type: "warning",
        title: "Analysis Needed",
        message:
          "No API endpoints detected yet. Run analysis first to discover routes.",
      });
      return;
    }

    // Integration Test exclusively generates and runs Supertest + Jest
    void explicitFramework;
    const resolvedFramework = "SUPERTEST";

    setError("");
    setPendingAction("GENERATE");
    try {
      const res = await generateIntegrationTests(snapshotId, {
        framework: resolvedFramework,
        targetEndpoints: Array.isArray(explicitTargets) ? explicitTargets : [],
        force: true,
      });
      if (res === undefined || res === null) return;
      const jobId =
        res?.data?.job?.id ||
        res?.data?.jobId ||
        res?.data?.job?.jobId ||
        res?.jobId;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("GENERATE");
        setActiveJobStatus("RUNNING");
        showToast({
          type: "info",
          title: "AI Test Generation Started",
          message: explicitTargets?.length
            ? `Generating Supertest + Jest tests for ${explicitTargets.length} endpoint(s)...`
            : "Generating Supertest + Jest integration scenarios with AI...",
        });
      } else {
        await load();
      }
    } catch (err) {
      const msg = err.message || "Failed to generate test scenarios.";
      setError(msg);
      showToast({
        type: "error",
        title: "Generation Failed",
        message: msg,
      });
    } finally {
      setPendingAction(null);
    }
  };

  // Select all APIs & run coverage (Run Coverage button at top = select all APIs + run)
  const selectAllApisInMatrix = useCallback(() => {
    if (matrixRef.current?.selectAllEndpoints) {
      matrixRef.current.selectAllEndpoints();
    }
    const wsEndpoints = workspace?.endpoints || [];
    if (snapshotId && wsEndpoints.length > 0) {
      const parentSet = new Set();
      const childSet = new Set();
      for (const ep of wsEndpoints) {
        const epKey = getEpIdentityKey(ep);
        parentSet.add(epKey);
        for (const sc of ep.scenarios || []) {
          const scKey = getScenarioIdentityKey(sc, epKey);
          if (scKey) childSet.add(scKey);
        }
      }
      saveMatrixSelection("integration", snapshotId, parentSet, childSet);
    }
  }, [snapshotId, workspace?.endpoints]);

  // Run All Approved Tests (or Open Smart Setup Modal if missing tests/dependencies)
  const handleRunApprovedTests = async (forceDirectRun = false) => {
    if (!projectAccess.can("tests.run")) return;
    if (!snapshotId || pendingAction) return;
    if (
      activeJobId &&
      (activeJobStatus === "RUNNING" || activeJobStatus === "QUEUED")
    ) {
      setError("A test execution job is already running.");
      return;
    }
    setError("");
    setCancellationNotice("");

    // Select all API endpoints & their scenarios in Endpoints Matrix when Run Coverage is triggered
    selectAllApisInMatrix();

    const allAiTests = workspace?.aiTests || [];
    const allScenarioIds = allAiTests.flatMap((t) => {
      const reqs = Array.isArray(t.requests) ? t.requests : [];
      if (reqs.length > 0) {
        return reqs.map((r) => `${t.id}::${r.scenarioId || r.testName}`);
      }
      let meta = {};
      try {
        meta =
          typeof t.metaJson === "string"
            ? JSON.parse(t.metaJson)
            : t.metaJson || {};
      } catch (e) {
        console.warn("[IntegrationWorkspace] Failed to parse metaJson:", e);
      }
      return (meta.requests || []).map(
        (r) => `${t.id}::${r.scenarioId || r.testName}`,
      );
    });
    const epScenarioCount = (workspace?.endpoints || []).reduce(
      (sum, ep) => sum + ((ep.scenarios || []).length || 0),
      0,
    );
    const hasProjectTests =
      (detectionInfo?.testFiles || []).length > 0 ||
      (detectionInfo?.supertestFiles || []).length > 0 ||
      epScenarioCount > 0;
    const hasAnyRunnableTests = allScenarioIds.length > 0 || hasProjectTests;

    // Only open Smart Setup & 100% API Suite Modal when zero tests exist anywhere in the project;
    // when existing or approved tests already exist, Run Coverage always executes them directly.
    if (!forceDirectRun && !hasAnyRunnableTests) {
      setSetupAutoRun(true);
      setSetupModalOpen(true);
      return;
    }

    setPendingAction("RUN");
    try {
      if (pendingOpsCount > 0) {
        const ok = await flushPendingOps({ reload: false });
        if (!ok) return;
      }
      if (allScenarioIds.length > 0) {
        await approveIntegrationTestsApi(snapshotId, allScenarioIds).catch(
          (err) => {
            console.warn(
              "[IntegrationWorkspace] Auto-approve before run warning:",
              err,
            );
          },
        );
      }
      const response = await runCoverageByType(snapshotId, "integration");
      startExecutionTracking(response);
    } catch (err) {
      setError(err.message || "Failed to start integration test run.");
    } finally {
      setPendingAction(null);
    }
  };

  // Execute Smart Setup Flow: Install missing libraries (if needed) + Generate 100% API Suite + Auto-Run Coverage
  const handleConfirmSetupAndRun = async ({
    generateSuite = true,
    autoRun = true,
  } = {}) => {
    if (!snapshotId || isRunningSetupFlow) return;
    setIsRunningSetupFlow(true);
    setError("");
    setCancellationNotice("");
    try {
      // Step 1: Ensure endpoints are scanned first if not yet scanned
      if (!hasScanned && (workspace?.endpoints || []).length === 0) {
        await handleScanEndpoints();
      }

      // Step 2: Install missing test libraries if needed
      if (
        detectionInfo?.needsDependencyInstall &&
        projectAccess.can("integrations.write")
      ) {
        setIsInstallingDeps(true);
        try {
          await installIntegrationDependencies(snapshotId);
        } finally {
          setIsInstallingDeps(false);
        }
      }

      setSetupModalOpen(false);

      // Step 3: Either generate 100% API test suite (with optional auto-run) or run existing tests directly
      if (generateSuite) {
        autoRunAfterGenerateRef.current = Boolean(autoRun);
        setPendingAction("GENERATE");
        const res = await generateIntegrationTests(snapshotId, {
          framework: "SUPERTEST",
          force: true,
        });
        const jId =
          res?.data?.job?.id ||
          res?.data?.jobId ||
          res?.data?.job?.jobId ||
          res?.jobId;
        if (jId) {
          setActiveJobId(jId);
          setActiveJobType("GENERATE");
          setActiveJobStatus("RUNNING");
          showToast({
            type: "info",
            title: "Generating 100% API Test Suite",
            message:
              "Synthesizing Supertest + Jest scenarios for all discovered endpoints...",
          });
        } else {
          await load({ scan: true });
          if (autoRun) {
            await handleRunApprovedTests(true);
          }
        }
      } else {
        await handleRunApprovedTests(true);
      }
    } catch (err) {
      autoRunAfterGenerateRef.current = false;
      setError(err.message || "Failed to complete integration test setup.");
    } finally {
      setIsRunningSetupFlow(false);
      setPendingAction(null);
    }
  };

  // Run Specific Endpoint (Targeted Single-Endpoint Execution)
  const [runningTargetKey, setRunningTargetKey] = useState(null);

  const handleRunEndpoint = async (ep) => {
    if (!projectAccess.can("tests.run")) return;
    if (!snapshotId || pendingAction || !ep) return;
    const epPath = ep.path || ep.fullPath || ep.route || "/";
    const epKey = `${(ep.method || "GET").toUpperCase()} ${epPath}`;
    const epScenarios = ep.scenarios || [];
    const scenarioIds = epScenarios
      .map((s) => s.id || `${s.testId}::${s.scenarioId || s.testName}`)
      .filter(Boolean);
    const targetTestNames = epScenarios
      .map((s) => s.title || s.testName)
      .filter(Boolean);
    if (scenarioIds.length === 0 && targetTestNames.length === 0) {
      setError(`Endpoint ${epKey} has no test scenarios yet.`);
      return;
    }
    setError("");
    setPendingAction("RUN_ENDPOINT");
    setRunningTargetKey(epKey);
    try {
      if (pendingOpsCount > 0) {
        const ok = await flushPendingOps({ reload: false });
        if (!ok) return;
      }
      if (
        workspace?.aiTests &&
        workspace.aiTests.length > 0 &&
        scenarioIds.length > 0
      ) {
        try {
          await approveIntegrationTestsApi(snapshotId, scenarioIds);
        } catch (_) {}
      }
      const response = await runCoverageByType(
        snapshotId,
        "integration",
        null,
        null,
        {
          targetEndpoint: epKey,
          targetEndpoints: [epKey],
          targetTestNames,
          selectedScenarioIds: scenarioIds,
        },
      );
      startExecutionTracking(response);
    } catch (err) {
      setError(err.message || "Failed to execute tests for this endpoint.");
      setRunningTargetKey(null);
    } finally {
      setPendingAction(null);
    }
  };

  // Run Coverage for Multiple Selected Endpoints (Targeted Batch Execution)
  const handleRunSelectedEndpoints = async (selectedEps = []) => {
    if (!projectAccess.can("tests.run")) return;
    if (
      !snapshotId ||
      pendingAction ||
      !Array.isArray(selectedEps) ||
      selectedEps.length === 0
    )
      return;

    const allScenarios = selectedEps.flatMap((ep) => ep.scenarios || []);
    const scenarioIds = allScenarios
      .map((s) => s.id || `${s.testId}::${s.scenarioId || s.testName}`)
      .filter(Boolean);
    const targetTestNames = allScenarios
      .map((s) => s.title || s.testName)
      .filter(Boolean);

    const targetEndpoints = selectedEps.map(
      (ep) =>
        `${(ep.method || "GET").toUpperCase()} ${ep.fullPath || ep.path || ep.route || "/"}`,
    );
    const targetLabel =
      selectedEps.length === 1
        ? targetEndpoints[0]
        : `${selectedEps.length} selected endpoints`;

    setError("");
    setCancellationNotice("");
    setPendingAction("RUN_ENDPOINT");
    setRunningTargetKey(targetLabel);
    try {
      if (pendingOpsCount > 0) {
        const ok = await flushPendingOps({ reload: false });
        if (!ok) return;
      }
      if (
        workspace?.aiTests &&
        workspace.aiTests.length > 0 &&
        scenarioIds.length > 0
      ) {
        try {
          await approveIntegrationTestsApi(snapshotId, scenarioIds);
        } catch (_) {}
      }
      const response = await runCoverageByType(
        snapshotId,
        "integration",
        null,
        null,
        {
          targetEndpoint: targetLabel,
          targetEndpoints,
          targetTestNames,
          selectedScenarioIds: scenarioIds,
        },
      );
      startExecutionTracking(response);
    } catch (err) {
      setError(
        err.message || "Failed to execute tests for selected endpoints.",
      );
      setRunningTargetKey(null);
    } finally {
      setPendingAction(null);
    }
  };

  // Run Coverage for Specific Selected Scenarios (Cross-Endpoint Multi-Select)
  const handleRunSelectedScenarios = async (selectedScenarios = []) => {
    if (!projectAccess.can("tests.run")) return;
    if (
      !snapshotId ||
      pendingAction ||
      !Array.isArray(selectedScenarios) ||
      selectedScenarios.length === 0
    )
      return;

    const scenarioIds = selectedScenarios
      .map((s) => s.id || `${s.testId}::${s.scenarioId || s.testName}`)
      .filter(Boolean);
    const targetTestNames = selectedScenarios
      .map((s) => s.title || s.testName)
      .filter(Boolean);

    if (scenarioIds.length === 0 && targetTestNames.length === 0) return;

    const targetEndpoints = Array.from(
      new Set(
        selectedScenarios
          .filter((s) => s.method || s.path)
          .map(
            (s) =>
              `${(s.method || "GET").toUpperCase()} ${s.fullPath || s.path || "/"}`,
          ),
      ),
    );
    const targetLabel = `${selectedScenarios.length} selected scenario${selectedScenarios.length > 1 ? "s" : ""}`;
    setError("");
    setCancellationNotice("");
    setPendingAction("RETRY_SCENARIO");
    setRunningTargetKey(targetLabel);
    try {
      if (pendingOpsCount > 0) {
        const ok = await flushPendingOps({ reload: false });
        if (!ok) return;
      }
      const response = await runCoverageByType(
        snapshotId,
        "integration",
        null,
        null,
        {
          targetEndpoint: targetLabel,
          ...(targetEndpoints.length > 0 ? { targetEndpoints } : {}),
          targetTestNames,
          selectedScenarioIds: scenarioIds,
        },
      );
      startExecutionTracking(response);
    } catch (err) {
      setError(err.message || "Failed to execute selected test scenarios.");
      setRunningTargetKey(null);
    } finally {
      setPendingAction(null);
    }
  };

  // Retry Single Scenario (Targeted Single-Scenario Execution)
  const handleRetryScenario = async (ep, sc) => {
    if (!projectAccess.can("tests.run")) return;
    if (!snapshotId || pendingAction || !sc) return;
    const scId = sc.id || `${sc.testId}::${sc.scenarioId || sc.testName}`;
    const scTitle = sc.title || sc.testName;
    if (!scId && !scTitle) return;
    const epKey = ep
      ? `${(ep.method || "GET").toUpperCase()} ${ep.path || ep.fullPath || ep.route || "/"}`
      : null;
    setError("");
    setPendingAction("RETRY_SCENARIO");
    setRunningTargetKey(scId || scTitle);
    try {
      if (
        workspace?.aiTests &&
        workspace.aiTests.length > 0 &&
        scId &&
        sc.enabled === false
      ) {
        try {
          await approveIntegrationTestsApi(snapshotId, [scId]);
        } catch (_) {}
      }
      const response = await runCoverageByType(
        snapshotId,
        "integration",
        null,
        null,
        {
          targetEndpoint: epKey,
          targetTestNames: scTitle ? [scTitle] : [],
          selectedScenarioIds: scId ? [scId] : [],
        },
      );
      startExecutionTracking(response);
    } catch (err) {
      setError(err.message || "Failed to rerun this test scenario.");
      setRunningTargetKey(null);
    } finally {
      setPendingAction(null);
    }
  };

  // View Scenario in Source Code Modal
  const handleViewScenarioCode = (sc, ep) => {
    setError("");
    const rawPath =
      sc?.testFile ||
      sc?.filePath ||
      sc?.sourceFile ||
      ep?.sourceFile ||
      ep?.filePath ||
      "";

    // Clean container and storage prefixes
    let cleanPath = (rawPath || "").replace(/\\/g, "/").trim();
    cleanPath = cleanPath.replace(
      /^(?:\/?app\/)?\.?covai-temp\/collaboration-operations\/[^/]+\//i,
      "",
    );
    cleanPath = cleanPath.replace(/^(?:\/?app\/)?\.?covai-temp\/[^/]+\//i, "");
    cleanPath = cleanPath.replace(
      /^(?:\/?app\/)?storage\/projects\/[^/]+\/(?:snapshots\/[^/]+\/)?/i,
      "",
    );
    cleanPath = cleanPath.replace(/^(?:\/?app\/)/i, "");
    cleanPath = cleanPath.replace(/^[a-zA-Z]:\//i, "");
    cleanPath = cleanPath.replace(/^\/+/, "");

    // Look for matching in-memory AI test or source test from workspace
    const matchingTest = (workspace?.aiTests || []).find(
      (t) =>
        (cleanPath &&
          (t.filePath === cleanPath ||
            t.filePath?.endsWith(cleanPath) ||
            cleanPath.endsWith(t.filePath || ""))) ||
        (sc?.title &&
          (t.content?.includes(sc.title) ||
            (t.requests || []).some((r) => r.testName === sc.title))),
    );

    const targetPath =
      cleanPath ||
      matchingTest?.filePath ||
      ep?.sourceFile ||
      ep?.filePath ||
      "tests/integration/cart.test.js";

    const codeSnippet =
      sc?.code || sc?.sourceCode || matchingTest?.content || null;

    setSourceViewerOptions([
      {
        label:
          sc?.title ||
          sc?.testName ||
          (ep ? `${ep.method} ${ep.path}` : "Test Scenario"),
        filePath: targetPath,
        rawFilePath: rawPath,
        line: sc?.line || sc?.startLine || 1,
        method: ep?.method,
        testName: sc?.title || sc?.testName,
        code: codeSnippet,
        scenario: sc,
        endpoint: ep,
      },
    ]);
    setSourceViewerOpen(true);
  };

  // Resolve runtime results to the versioned editable artifact or repo test metadata.
  const editableScenario = (sc) => {
    const filePath = sc?.filePath || sc?.testFile || undefined;
    const testName = sc?.testName || sc?.title || sc?.name || undefined;
    if (sc?.aiTestId && sc?.scenarioId) {
      return {
        aiTestId: sc.aiTestId,
        scenarioId: sc.scenarioId,
        expectedVersion: sc.version ?? 1,
        filePath,
        testName,
        origin: sc.origin,
      };
    }
    for (const test of workspace?.aiTests || []) {
      const request = (test.requests || []).find(
        (r) =>
          (sc?.scenarioId && r.scenarioId === sc.scenarioId) ||
          (sc?.id && r.scenarioId === sc.id) ||
          test.id + "::" + r.scenarioId === sc?.id ||
          (testName && (r.testName === testName || r.title === testName)),
      );
      if (request)
        return {
          aiTestId: test.id,
          scenarioId:
            request.scenarioId || sc?.scenarioId || testName || "scenario_1",
          expectedVersion: test.version ?? 1,
          filePath: filePath || test.filePath,
          testName: request.testName || testName,
          origin: sc?.origin || request.origin,
        };
    }
    if (sc?.origin === "PROJECT_EXISTING" || filePath || testName) {
      return {
        aiTestId:
          sc?.aiTestId ||
          (sc?.origin === "PROJECT_EXISTING"
            ? "existing_test_lookup"
            : "workspace_scenario_lookup"),
        scenarioId: sc?.scenarioId || sc?.id || testName || "scenario_lookup",
        expectedVersion: 1,
        filePath,
        testName,
        origin: sc?.origin,
      };
    }
    const fallbackTest = workspace?.aiTests?.[0];
    return {
      aiTestId: fallbackTest?.id || "fallback",
      scenarioId: sc?.scenarioId || sc?.id || "scenario_1",
      expectedVersion: fallbackTest?.version || 1,
      filePath,
      testName,
      origin: sc?.origin,
    };
  };

  const handleAIFixScenario = async (scOrEp, maybeEp) => {
    const sc =
      scOrEp?.title || scOrEp?.scenarioId || scOrEp?.testName
        ? scOrEp
        : maybeEp;
    const ep = maybeEp && maybeEp !== sc ? maybeEp : null;
    if (!projectAccess.can("ai.use") || !snapshotId || !sc) return;
    setError("");

    const identity = editableScenario(sc);
    const isProjectExisting =
      sc?.origin === "PROJECT_EXISTING" ||
      String(identity.aiTestId || "").startsWith("existing_test_") ||
      identity.aiTestId === "existing_test_lookup";

    let scenarioCode = sc?.code || sc?.fullFileCode || "";
    if (
      !scenarioCode &&
      !isProjectExisting &&
      identity.aiTestId &&
      identity.aiTestId !== "fallback"
    ) {
      try {
        const fetched = await getIntegrationScenarioApi(
          snapshotId,
          identity.aiTestId,
          identity.scenarioId,
        );
        scenarioCode = fetched?.code || "";
        if (fetched?.version) {
          identity.expectedVersion = fetched.version;
        }
      } catch (err) {
        console.warn(
          "[IntegrationWorkspace] Could not prefetch scenario code for AI Fix:",
          err?.message,
        );
      }
    }

    const endpointMethod = (ep?.method || sc?.method || "API").toUpperCase();
    const endpointPath = ep?.fullPath || ep?.path || sc?.path || "/";
    const endpointLabel = `${endpointMethod} ${endpointPath}`;
    const testTitle =
      sc?.title || sc?.testName || sc?.name || "Failing Scenario";
    const testFilePath =
      sc?.filePath ||
      sc?.testFile ||
      identity.filePath ||
      "tests/integration/api.test.js";
    const controllerSnippet =
      ep?.source?.controllerSnippet || ep?.source?.routeSnippet || "";
    const statusCodes =
      ep?.source?.responseStatusCodes || ep?.responseStatusCodes || [];
    const reqSchema =
      ep?.source?.requestBodySchema || ep?.requestBodySchema || [];
    const failureDetails =
      sc?.executionReason ||
      (Array.isArray(sc?.failureMessages) && sc.failureMessages.length > 0
        ? sc.failureMessages.join("\n")
        : "Assertion or runtime failure occurred.");

    const attachments = [];
    if (scenarioCode) {
      attachments.push({
        id: `fix-test-${identity.scenarioId || Date.now()}`,
        type: "file",
        name: testFilePath.split("/").pop() || "integration.test.js",
        path: testFilePath,
        content: scenarioCode,
      });
    }
    const handlerFile =
      ep?.source?.controllerFile || ep?.source?.sourceFile || ep?.sourceFile;
    if (controllerSnippet && handlerFile) {
      attachments.push({
        id: `fix-endpoint-${Date.now()}`,
        type: "file",
        name: handlerFile.split("/").pop() || "controller.js",
        path: handlerFile,
        content: controllerSnippet,
      });
    }

    const promptLines = [
      `Help me debug and fix this failing integration test scenario for \`${endpointLabel}\`:`,
      `- **Test Scenario**: ${testTitle}`,
      `- **Test File**: \`${testFilePath}\``,
      `- **Failure Layer**: \`${sc?.failureLayer || "ASSERTION_FAILED"}\``,
      `- **Expected vs Actual Status**: Expected \`${Array.isArray(sc?.expectedStatuses) && sc.expectedStatuses.length > 1 ? sc.expectedStatuses.join("/") : (sc?.expectedStatus ?? "unknown")}\`, Actual \`${sc?.actualStatus ?? sc?.actualStatusFromRuntime ?? "N/A"}\``,
      ...(statusCodes.length > 0
        ? [`- **Controller Status Codes**: ${statusCodes.join(", ")}`]
        : []),
      ...(reqSchema.length > 0
        ? [`- **Request Body Schema**: ${reqSchema.join(", ")}`]
        : []),
      "",
      "**Failure Diagnostics:**",
      "```",
      failureDetails.slice(0, 2500),
      "```",
      "",
      "Please explain the root cause of the failure against the endpoint implementation, and provide the corrected single Jest/Supertest `it(...)` test block in a ```javascript code block so I can apply it.",
    ];

    window.dispatchEvent(
      new CustomEvent("covai:prefill-prompt", {
        detail: {
          promptText: promptLines.join("\n"),
          attachments,
          fixContext: {
            snapshotId,
            aiTestId: identity.aiTestId,
            scenarioId: identity.scenarioId,
            expectedVersion: identity.expectedVersion ?? 1,
            testName: testTitle,
            endpointLabel,
            filePath: testFilePath,
            failureLayer: sc?.failureLayer || "ASSERTION_FAILED",
            expectedStatus: sc?.expectedStatus ?? null,
            actualStatus:
              sc?.actualStatus ?? sc?.actualStatusFromRuntime ?? null,
            isProjectExisting,
          },
        },
      }),
    );
  };

  const handleDeleteScenario = async (sc) => {
    if (!projectAccess.can("files.write") || !snapshotId || !sc) return;
    setError("");
    const identity = editableScenario(sc);
    const title = sc.title || sc.testName || sc.scenarioId || "Scenario";
    setPendingOps((prev) =>
      stageDeleteOp(prev, {
        key:
          sc.id ||
          `${identity.aiTestId || "ep"}::${identity.scenarioId || title}`,
        id: sc.id,
        ...identity,
        title,
        testName: identity.testName || title,
        testFile: identity.filePath,
        endpointMethod: sc.method,
        endpointPath: sc.path,
      }),
    );
    showToast({
      type: "info",
      title: "Removed (Temp)",
      message: `Removed "${title}" from view. Click Apply Changes to save.`,
    });
  };

  const handleDeleteSelectedScenarios = async (selectedScenarios = []) => {
    if (!projectAccess.can("files.write") || !snapshotId) return false;
    const validList = Array.isArray(selectedScenarios)
      ? selectedScenarios.filter(Boolean)
      : [];
    if (validList.length === 0) return false;

    setError("");
    setPendingAction("BULK_DELETE");
    try {
      const stagedOnly = validList.filter((sc) => sc.stagedTemp);
      const persistedList = validList.filter((sc) => !sc.stagedTemp);
      let deletedCount = stagedOnly.length;

      if (persistedList.length > 0) {
        const payload = persistedList.map((sc) => ({
          ...editableScenario(sc),
          title: sc.title || sc.testName || sc.scenarioId || undefined,
        }));
        const res = await bulkDeleteIntegrationScenariosApi(
          snapshotId,
          payload,
        );
        deletedCount += res?.data?.deletedCount ?? payload.length;
      }
      const removedKeySet = new Set(
        validList.map(
          (sc) =>
            sc.id ||
            `${sc.aiTestId || "ep"}::${sc.scenarioId || sc.title || sc.testName}`,
        ),
      );
      setPendingOps((prev) => {
        const next = {
          deletes: (prev.deletes || []).filter(
            (d) => !removedKeySet.has(d.key),
          ),
          updates: (prev.updates || []).filter(
            (u) => !removedKeySet.has(u.key),
          ),
          adds: (prev.adds || []).filter((a) => !removedKeySet.has(a.key)),
        };
        saveStagedOps("integration", snapshotId, next);
        return next;
      });
      await load({ scan: false });
      showToast({
        type: "success",
        title: "Scenarios Deleted",
        message: `Removed ${deletedCount} selected scenario${deletedCount === 1 ? "" : "s"}.`,
      });
      return true;
    } catch (err) {
      const msg = err?.message || "Failed to delete selected scenarios.";
      setError(msg);
      showToast({
        type: "error",
        title: "Bulk Delete Failed",
        message: msg,
      });
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  const handleToggleScenario = async (sc, enableState) => {
    if (!projectAccess.can("files.write") || !snapshotId || !sc) return;
    setError("");
    try {
      const identity = editableScenario(sc);
      await mutateIntegrationScenarioApi({
        snapshotId,
        ...identity,
        action: "TOGGLE",
        enable: Boolean(enableState),
      });
      await load({ scan: false });
    } catch (err) {
      setError(err.message || "Failed to toggle scenario state.");
    }
  };

  const handleOpenApplyModal = (
    targetIds = null,
    initialScenarioKeys = null,
  ) => {
    if (!projectAccess.can("files.write")) return;
    const resolvedAiTestIds =
      Array.isArray(targetIds) && targetIds.length > 0
        ? targetIds
        : (workspace?.aiTests || []).map((t) => t.id).filter(Boolean);
    setApplyModalTestIds(
      resolvedAiTestIds.length > 0 ? resolvedAiTestIds : selectedTestIds,
    );
    setApplyModalInitialKeys(initialScenarioKeys);
    setApplyModalOpen(true);
  };

  const handleOpenEditScenario = async (sc, ep = null) => {
    if (!projectAccess.can("files.write")) return;
    setEditorSaveError("");
    const identity = editableScenario(sc);
    const inMemoryCode = sc?.code || "";

    // Open immediately if individual scenario code is already in memory to avoid UI lag
    if (inMemoryCode) {
      setEditorModalScenario({
        ...sc,
        ...identity,
        code: inMemoryCode,
      });
      setEditorModalEndpoint(ep);
      setIsAddScenarioMode(false);
      setEditorModalOpen(true);

      // Sync latest version silently in background if missing real 64-char artifact hash
      if (
        identity.aiTestId &&
        identity.aiTestId !== "fallback" &&
        typeof identity.expectedVersion !== "string"
      ) {
        getIntegrationScenarioApi(
          snapshotId,
          identity.aiTestId,
          identity.scenarioId,
          {
            filePath: identity.filePath,
            testName: identity.testName,
            origin: identity.origin,
          },
        )
          .then((result) => {
            if (result) {
              setEditorModalScenario((prev) =>
                prev
                  ? {
                      ...prev,
                      aiTestId: result.aiTest?.id || prev.aiTestId,
                      expectedVersion:
                        result.version ||
                        result.aiTest?.version ||
                        prev.expectedVersion,
                    }
                  : prev,
              );
            }
          })
          .catch(() => {});
      }
      return;
    }

    try {
      if (identity.aiTestId) {
        const result = await getIntegrationScenarioApi(
          snapshotId,
          identity.aiTestId,
          identity.scenarioId,
          {
            filePath: identity.filePath,
            testName: identity.testName,
            origin: identity.origin,
          },
        );
        setEditorModalScenario({
          ...sc,
          ...identity,
          aiTestId: result?.aiTest?.id || identity.aiTestId,
          expectedVersion:
            result?.version ||
            result?.aiTest?.version ||
            identity.expectedVersion,
          code: result?.code || "",
        });
      } else {
        setEditorModalScenario({
          ...sc,
          ...identity,
          code: "",
        });
      }
      setEditorModalEndpoint(ep);
      setIsAddScenarioMode(false);
      setEditorModalOpen(true);
    } catch (err) {
      setError(err.message || "Unable to open scenario editor.");
    }
  };

  const handleOpenAddScenario = (ep) => {
    if (!projectAccess.can("files.write")) return;
    setEditorSaveError("");
    const tests = workspace?.aiTests || [];
    const test =
      tests.find((t) =>
        t.requests?.some((r) => r.method === ep?.method && r.path === ep?.path),
      ) || tests[0];
    setEditorModalScenario({
      aiTestId: test?.id || "default",
      expectedVersion: test?.version || null,
    });
    setEditorModalEndpoint(ep || endpoints?.[0] || null);
    setIsAddScenarioMode(true);
    setEditorModalOpen(true);
  };

  const handleSaveScenario = async (savedData) => {
    if (!projectAccess.can("files.write") || !snapshotId) return false;
    setError("");
    setEditorSaveError("");
    const codeStr = typeof savedData === "string" ? savedData : savedData.code;
    const nextTitle = extractBlockTitle(
      codeStr,
      editorModalScenario?.testName ||
        editorModalScenario?.title ||
        "New scenario",
    );
    if (isAddScenarioMode) {
      setPendingOps((prev) =>
        stageAddOp(prev, {
          aiTestId: editorModalScenario?.aiTestId || "default",
          expectedVersion: editorModalScenario?.expectedVersion,
          code: codeStr,
          title: nextTitle,
          testName: nextTitle,
          endpoint: editorModalEndpoint,
          endpointMethod: (editorModalEndpoint?.method || "GET").toUpperCase(),
          endpointPath:
            editorModalEndpoint?.path || editorModalEndpoint?.fullPath || "/",
          filePath: editorModalScenario?.filePath,
          testFile: editorModalScenario?.filePath,
        }),
      );
    } else {
      setPendingOps((prev) =>
        stageUpdateOp(prev, {
          key:
            editorModalScenario?.id ||
            `${editorModalScenario?.aiTestId || "ep"}::${editorModalScenario?.scenarioId || editorModalScenario?.testName}`,
          id: editorModalScenario?.id,
          aiTestId: editorModalScenario?.aiTestId || "default",
          scenarioId: editorModalScenario?.scenarioId,
          expectedVersion: editorModalScenario?.expectedVersion,
          originalTestName:
            editorModalScenario?.testName || editorModalScenario?.title,
          testName: nextTitle,
          title: nextTitle,
          code: codeStr,
          endpoint: editorModalEndpoint,
          filePath: editorModalScenario?.filePath,
          testFile: editorModalScenario?.filePath,
          origin: editorModalScenario?.origin,
        }),
      );
    }
    setEditorModalOpen(false);
    showToast({
      type: "success",
      title: isAddScenarioMode
        ? "Scenario Added (Temp)"
        : "Scenario Updated (Temp)",
      message:
        "Saved in temporary workspace. Click Apply Changes to write to source.",
    });
    return true;
  };

  // Parse progress steps for active running job
  const parseProgressSteps = (jobType, logs = []) => {
    const safeLogs = Array.isArray(logs) ? logs : [];
    const stages = safeLogs.map((l) => l.parsedMessage?.stage).filter(Boolean);
    const hasStage = (stageName) => stages.includes(stageName);
    const textLogs = safeLogs
      .map((l) =>
        typeof l?.message === "string"
          ? l.message
          : JSON.stringify(l?.message || l || ""),
      )
      .join("\n");

    if (jobType === "ANALYZE") {
      return [
        { label: "Load project snapshot", done: true },
        {
          label: "Scan source AST structure",
          done:
            hasStage("LOAD_SOURCE") ||
            textLogs.includes("Scanning") ||
            textLogs.includes("Analyzed"),
        },
        {
          label: "Detect test framework",
          done: hasStage("DETECT_ENDPOINTS") || textLogs.includes("Analyzed"),
        },
        {
          label: "Discover Express/Node API endpoints",
          done: hasStage("DETECT_ENDPOINTS") || textLogs.includes("Saving"),
        },
        {
          label: "Map route/controller dependencies",
          done: hasStage("MAP_DEPENDENCIES") || textLogs.includes("Saving"),
        },
        {
          label: "Complete analysis",
          done: hasStage("COMPLETE") || textLogs.includes("completed"),
        },
      ];
    } else if (jobType === "GENERATE") {
      return [
        {
          label: "Build AI context for APIs",
          done:
            hasStage("BUILD_CONTEXT") || textLogs.includes("Calling Gemini"),
        },
        {
          label: "Generate multi-scenario test suite with LLM",
          done:
            hasStage("GENERATE_AI_TESTS") ||
            textLogs.includes("Calling Gemini"),
        },
        {
          label: "Validate syntax & Jest assertions",
          done:
            hasStage("VALIDATE_SCENARIOS") ||
            textLogs.includes("Saved") ||
            textLogs.includes("Generated"),
        },
        {
          label: "Complete test generation",
          done: hasStage("COMPLETE") || activeJobStatus === "SUCCESS",
        },
      ];
    } else {
      return [
        { label: "Load approved test scenarios", done: true },
        {
          label: "Initialize isolated test container",
          done:
            hasStage("PREPARE_ENV") ||
            textLogs.includes("start") ||
            textLogs.includes("TestRun"),
        },
        {
          label: "Execute Jest & Supertest runner",
          done: hasStage("RUN_JEST") || textLogs.includes("TestRun"),
        },
        {
          label: "Extract API coverage & tracing",
          done: hasStage("PARSE_COVERAGE") || textLogs.includes("complete"),
        },
        {
          label: "Diagnose 5 failure layers & compile report",
          done: hasStage("COMPLETE") || textLogs.includes("complete"),
        },
      ];
    }
  };

  // Calculate failed scenarios list across all endpoints
  const {
    endpoints: rawEndpoints = [],
    summary,
    execution,
    generation,
  } = workspace || {};

  const endpoints = useMemo(() => {
    if (!pendingOpsCount) return rawEndpoints;
    const deletes = pendingOps.deletes || [];
    const updates = pendingOps.updates || [];
    const adds = pendingOps.adds || [];
    return rawEndpoints.map((ep) => {
      const m = (ep.method || "GET").toUpperCase();
      const p = ep.path || ep.fullPath || ep.route || "/";
      const baseList = (ep.scenarios || [])
        .filter((sc) => {
          const t = {
            key: sc.id,
            id: sc.id,
            aiTestId: sc.aiTestId,
            scenarioId: sc.scenarioId,
            testFile: sc.filePath || sc.testFile,
            testName: sc.testName || sc.title,
          };
          return !deletes.some((d) => matchesStagedTarget(d, t));
        })
        .map((sc) => {
          const t = {
            key: sc.id,
            id: sc.id,
            aiTestId: sc.aiTestId,
            scenarioId: sc.scenarioId,
            testFile: sc.filePath || sc.testFile,
            testName: sc.testName || sc.title,
          };
          const upd = updates.find((u) => matchesStagedTarget(u, t));
          if (!upd) return sc;
          return {
            ...sc,
            title: upd.title || sc.title,
            testName: upd.testName || sc.testName,
            code: upd.code,
            stagedEdit: true,
          };
        });
      const epAdds = adds
        .filter(
          (a) =>
            (a.endpointMethod || "GET") === m && (a.endpointPath || "/") === p,
        )
        .map((a) => ({
          id: a.id,
          aiTestId: a.aiTestId,
          title: a.title,
          testName: a.testName,
          code: a.code,
          method: m,
          path: p,
          status: "draft",
          origin: "STAGED_ADD",
          stagedTemp: true,
        }));
      return { ...ep, scenarios: [...baseList, ...epAdds] };
    });
  }, [rawEndpoints, pendingOps, pendingOpsCount]);

  const availableApplyScenarios = useMemo(() => {
    const statusByTitle = new Map();
    for (const ep of endpoints || []) {
      for (const sc of ep.scenarios || []) {
        const key = String(sc.title || sc.name || "")
          .trim()
          .toLowerCase();
        if (key && sc.status) statusByTitle.set(key, sc.status);
      }
    }
    const items = [];
    const seen = new Set();
    for (const t of workspace?.aiTests || []) {
      for (const r of t?.requests || []) {
        const title = r.title || r.testName || "";
        const key = `${t.id}::${r.scenarioId || title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          key,
          aiTestId: t.id,
          scenarioId: r.scenarioId || null,
          testName: r.testName || title,
          title,
          method: (r.method || "API").toUpperCase(),
          path: r.path || "/",
          status: statusByTitle.get(title.trim().toLowerCase()) || "ready",
          filePath: t.filePath || null,
        });
      }
    }
    return items;
  }, [workspace?.aiTests, endpoints]);
  const isJobActive = Boolean(
    (activeJobId &&
      (activeJobStatus === "RUNNING" || activeJobStatus === "QUEUED")) ||
    isCancelling,
  );

  const failedScenariosList = useMemo(() => {
    const list = [];
    endpoints.forEach((ep) => {
      (ep.scenarios || []).forEach((sc) => {
        const isFail =
          sc.status === "failed" ||
          sc.rawJestStatus === "failed" ||
          sc.executionVerdict === "FAIL";
        if (isFail) {
          const actualHttp =
            sc.actualStatus ?? sc.actualStatusFromRuntime ?? null;
          let layer = sc.failureLayer;
          if (!layer || !FAILURE_LAYERS_META[layer]) {
            if (actualHttp === 404) layer = "ROUTER_NOT_FOUND";
            else if (actualHttp === 401 || actualHttp === 403)
              layer = "MIDDLEWARE_REJECTED";
            else if (actualHttp === 500) layer = "CONTROLLER_CRASH";
            else layer = "ASSERTION_FAILED";
          }
          list.push({
            endpoint: ep,
            scenario: sc,
            layer,
            key: `${ep.method} ${ep.path}::${sc.id || sc.title}`,
          });
        }
      });
    });
    return list;
  }, [endpoints]);

  const filteredFailures = useMemo(() => {
    if (activeFailureLayerFilter === "ALL") return failedScenariosList;
    return failedScenariosList.filter(
      (f) => f.layer === activeFailureLayerFilter,
    );
  }, [failedScenariosList, activeFailureLayerFilter]);

  // Overall statistics
  const overallStats = useMemo(() => {
    const totalApis = endpoints.length;
    let testedApis = 0;
    let passedApis = 0;
    let partialApis = 0;
    let executedOnlyApis = 0;
    let failedApis = 0;

    const hasExecuted =
      Boolean(execution && (execution.totalTests > 0 || execution.status)) ||
      endpoints.some(
        (ep) =>
          (ep.scenarios || []).some(
            (s) =>
              s.status === "passed" ||
              s.status === "failed" ||
              s.rawJestStatus === "passed" ||
              s.rawJestStatus === "failed" ||
              s.executionVerdict === "PASS" ||
              s.executionVerdict === "FAIL",
          ) ||
          (ep.passedCount || 0) > 0 ||
          (ep.failedCount || 0) > 0,
      );

    // Match executed request URL back to declared API endpoint
    const findMatchingEndpoint = (method, reqPath) => {
      if (!endpoints || endpoints.length === 0) return null;
      const cleanReq = (reqPath || "").split("?")[0].replace(/\/+$/, "") || "/";
      const reqMethod = (method || "").toUpperCase();

      for (const ep of endpoints) {
        if ((ep.method || "").toUpperCase() !== reqMethod) continue;
        const cleanRoute =
          (ep.path || ep.route || ep.fullPath || "").replace(/\/+$/, "") || "/";
        const regexStr =
          "^" +
          cleanRoute.replace(/\./g, "\\.").replace(/:[a-zA-Z0-9_]+/g, "[^/]+") +
          "$";
        if (new RegExp(regexStr, "i").test(cleanReq)) {
          return ep;
        }
      }
      return null;
    };

    // Group and deduplicate scenarios across endpoints and workspace.aiTests
    const scenariosByEndpointMap = {};

    // 1. Ingest scenarios from AI tests / workspace.aiTests (exclude un-executed synthetic repo file wrappers)
    (workspace?.aiTests || []).forEach((t) => {
      if (!t || String(t.id || "").startsWith("existing_test_")) return;
      (t.requests || []).forEach((r, idx) => {
        if (!r || r.origin === "PROJECT_EXISTING") return;
        const rMethod = (r.method || "GET").toUpperCase();
        const rPath = r.path || "";
        const matchedEp = findMatchingEndpoint(rMethod, rPath);
        const epMethod = matchedEp
          ? (matchedEp.method || "GET").toUpperCase()
          : rMethod;
        const epPath = matchedEp
          ? matchedEp.path || matchedEp.route || matchedEp.fullPath || "/"
          : rPath.split("?")[0] || "/";
        const epKey = `${epMethod} ${epPath}`;

        if (!scenariosByEndpointMap[epKey]) {
          scenariosByEndpointMap[epKey] = [];
        }
        scenariosByEndpointMap[epKey].push({
          ...r,
          id: `${t.id}::${r.scenarioId || r.testName || idx}`,
          testName: r.testName || `Scenario ${idx + 1}`,
          status: r.status || "not_run",
        });
      });
    });

    // 2. Ingest existing project scenarios & execution results from endpoints
    endpoints.forEach((ep) => {
      const epMethod = (ep.method || "GET").toUpperCase();
      const epPath = ep.path || ep.route || ep.fullPath || "/";
      const epKey = `${epMethod} ${epPath}`;
      const epScenarios = ep.scenarios || [];
      const epCaseCov =
        ep.caseCoverage || getEndpointCaseCoverage(ep, epScenarios);

      const scFailed = epScenarios.filter(
        (s) =>
          s.status === "failed" ||
          s.rawJestStatus === "failed" ||
          s.executionVerdict === "FAIL",
      ).length;
      const scPassed = epScenarios.filter(
        (s) =>
          s.status === "passed" ||
          s.rawJestStatus === "passed" ||
          s.executionVerdict === "PASS",
      ).length;

      const epFailed = epScenarios.length > 0 ? scFailed : ep.failedCount || 0;
      const epPassed = epScenarios.length > 0 ? scPassed : ep.passedCount || 0;

      if (hasExecuted) {
        if (epFailed > 0) {
          failedApis++;
        } else if (epPassed > 0 && epCaseCov.isFullyVerified) {
          passedApis++;
          testedApis++;
        } else if (epPassed > 0) {
          partialApis++;
          executedOnlyApis++;
        }
      }

      if (!scenariosByEndpointMap[epKey]) {
        scenariosByEndpointMap[epKey] = [];
      }

      epScenarios.forEach((s, idx) => {
        const scStatusUpper = String(s.status || "").toUpperCase();
        const isExecuted =
          scStatusUpper === "PASSED" ||
          scStatusUpper === "PASS" ||
          scStatusUpper === "FAILED" ||
          scStatusUpper === "FAIL";
        const isRepoTest =
          !s.aiTestId ||
          String(s.aiTestId).startsWith("existing_test_") ||
          s.origin === "PROJECT_EXISTING";
        const isUnrunRepoTest = isRepoTest && !isExecuted;
        if (isUnrunRepoTest) return;

        const scenarioId = s.id || `${epKey}::scenario_${idx}`;
        const sTitle = s.title || s.testName || `Scenario ${idx + 1}`;
        const existingIdx = scenariosByEndpointMap[epKey].findIndex(
          (ex) =>
            ex.id === scenarioId ||
            (ex.testName &&
              (ex.testName === sTitle || ex.testName === s.testName)),
        );

        if (existingIdx === -1) {
          scenariosByEndpointMap[epKey].push({
            ...s,
            id: scenarioId,
            testName: sTitle,
            status: s.status || "not_run",
          });
        } else {
          const existing = scenariosByEndpointMap[epKey][existingIdx];
          if (s.status && (s.status !== "not_run" || !existing.status)) {
            existing.status = s.status;
          }
          if (s.rawJestStatus) existing.rawJestStatus = s.rawJestStatus;
          if (s.executionVerdict)
            existing.executionVerdict = s.executionVerdict;
          if (s.actualStatus !== undefined)
            existing.actualStatus = s.actualStatus;
          if (s.failureDiagnostics)
            existing.failureDiagnostics = s.failureDiagnostics;
        }
      });
    });

    const uncoveredApis = Math.max(0, totalApis - testedApis);
    const notFullyCoveredApis = Math.max(
      0,
      totalApis - testedApis - partialApis,
    );
    const executedApisCount = passedApis + partialApis + failedApis;
    const apiPassRate =
      executedApisCount > 0
        ? Math.round((passedApis / executedApisCount) * 100)
        : 0;
    const apiCoverageRate =
      totalApis > 0 ? Math.round((testedApis / totalApis) * 100) : 0;

    const dedupedScenarios = Object.values(scenariosByEndpointMap).flat();
    const dedupPassed = dedupedScenarios.filter(
      (s) =>
        s.status === "passed" ||
        s.rawJestStatus === "passed" ||
        s.executionVerdict === "PASS",
    ).length;
    const dedupFailed = dedupedScenarios.filter(
      (s) =>
        s.status === "failed" ||
        s.rawJestStatus === "failed" ||
        s.executionVerdict === "FAIL",
    ).length;

    // Synchronize scenarios count accurately based on deduplicated scenarios list
    const totalScenariosCount =
      dedupedScenarios.length > 0
        ? dedupedScenarios.length
        : execution?.totalTests > 0
          ? execution.totalTests
          : generation?.generatedScenarios || 0;

    const passedScenariosCount =
      dedupedScenarios.length > 0 ? dedupPassed : execution?.passedTests || 0;

    const failedScenariosCount =
      dedupedScenarios.length > 0 ? dedupFailed : execution?.failedTests || 0;

    const totalExecutedScenarios = passedScenariosCount + failedScenariosCount;
    const scenarioPassRate =
      totalScenariosCount > 0
        ? Math.round((passedScenariosCount / totalScenariosCount) * 100)
        : 0;

    const totalAvailableScenarios =
      generation?.generatedScenarios || totalScenariosCount;
    const scenarioCoverageRate =
      totalAvailableScenarios > 0
        ? Math.min(
            100,
            Math.round(
              (totalExecutedScenarios / totalAvailableScenarios) * 100,
            ),
          )
        : totalExecutedScenarios > 0
          ? 100
          : 0;

    return {
      hasExecuted,
      totalApis,
      testedApis,
      passedApis,
      partialApis,
      executedOnlyApis,
      failedApis,
      uncoveredApis,
      notFullyCoveredApis,
      apiPassRate,
      apiCoverageRate,
      totalScenariosCount,
      passedScenariosCount,
      failedScenariosCount,
      scenarioPassRate,
      scenarioCoverageRate,
    };
  }, [endpoints, execution, generation, workspace]);

  useChatTestContext(activeTab === "report" ? undefined : onChatContextChange, {
    projectId,
    snapshotId,
    testType: "integration",
    testRunId: execution?.testRunId,
    displayedMetrics: {
      kind: "integration",
      tab: activeTab,
      state:
        loading && !workspace
          ? "loading"
          : error && !workspace
            ? "unavailable"
            : overallStats.hasExecuted
              ? "ready"
              : "not-run",
      counts: workspace
        ? {
            endpoints: overallStats.totalApis,
            testedEndpoints: overallStats.testedApis,
            passedEndpoints: overallStats.passedApis,
            failedEndpoints: overallStats.failedApis,
            scenarios: overallStats.totalScenariosCount,
            passedScenarios: overallStats.passedScenariosCount,
            failedScenarios: overallStats.failedScenariosCount,
            apiCoveragePct: overallStats.apiCoverageRate,
            scenarioPassRate: overallStats.scenarioPassRate,
          }
        : undefined,
    },
  });

  const normalizeCoveragePath = (p) =>
    String(p || "")
      .replace(/\\/g, "/")
      .trim()
      .replace(/^\.\/+/, "")
      .replace(/^\/+/, "");

  const apiFiles = Array.from(
    new Set(
      endpoints.map((endpoint) => endpoint.source?.sourceFile).filter(Boolean),
    ),
  );
  const allFileCoverages = summary?.fileCoverages || [];
  const apiFileCoverage = apiFiles
    .map((sourceFile) => {
      const normSrc = normalizeCoveragePath(sourceFile);
      const lowerSrc = normSrc.toLowerCase();
      return (
        allFileCoverages.find(
          (file) => normalizeCoveragePath(file.filePath) === normSrc,
        ) ||
        allFileCoverages.find(
          (file) =>
            normalizeCoveragePath(file.filePath).toLowerCase() === lowerSrc,
        ) ||
        allFileCoverages.find((file) => {
          const lowerCov = normalizeCoveragePath(file.filePath).toLowerCase();
          return (
            lowerCov.endsWith(`/${lowerSrc}`) ||
            lowerSrc.endsWith(`/${lowerCov}`)
          );
        })
      );
    })
    .filter(Boolean);
  const averageCoverage = apiFileCoverage.length
    ? apiFileCoverage.reduce((sum, file) => sum + (file.line ?? 0), 0) /
      apiFileCoverage.length
    : null;
  const coveredApiFilesCount = apiFileCoverage.filter(
    (file) => file.line > 0,
  ).length;

  // Loading State with Authentic Skeleton
  if (loading && !workspace) {
    return <IntegrationCockpitSkeleton />;
  }

  // Empty Snapshot State
  if (!snapshotId && !workspace) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center text-[var(--color-text)]">
        <AlertTriangle size={36} className="text-[var(--color-warning)] mb-3" />
        <h3 className="text-base font-bold text-[var(--color-text)] mb-1">
          No Project Snapshot Selected
        </h3>
        <p className="text-xs text-[var(--color-text-secondary)] max-w-md mb-4 leading-relaxed">
          Please select a valid snapshot from the project list before using API
          Integration Testing features.
        </p>
      </div>
    );
  }

  const suiteLoadErrors = Array.isArray(workspace?.suiteLoadErrors)
    ? workspace.suiteLoadErrors
    : [];
  const effectiveFailedCount = Math.max(
    failedScenariosList.length,
    overallStats.failedScenariosCount || 0,
    workspace?.qualityClassification?.testScriptErrors || 0,
    suiteLoadErrors.length,
  );

  const WORKSPACE_TABS = [
    {
      id: "endpoints",
      label: "Endpoints Matrix",
      icon: Network,
      badge: hasScanned ? `${endpoints.length}` : null,
    },
    {
      id: "report",
      label: "Executive Report",
      icon: FileText,
      badge:
        effectiveFailedCount > 0
          ? `${effectiveFailedCount} failed`
          : overallStats.passedScenariosCount > 0
            ? `${overallStats.apiCoverageRate}%`
            : null,
      badgeColor:
        effectiveFailedCount > 0
          ? "bg-rose-500/[0.06] text-rose-300/85 border border-rose-500/20 font-medium"
          : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-medium",
    },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg)] text-[var(--color-text)] font-sans select-text overflow-hidden">
      {/* ── 1. SLEEK INDUSTRIAL COCKPIT HEADER ── */}
      <header className="shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] z-20 no-print relative">
        {(refreshing || isScanningEndpoints) && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--color-surface-secondary)] overflow-hidden z-30">
            <div className="h-full bg-[var(--color-primary)] animate-pulse w-full" />
          </div>
        )}
        {/* Top Control Bar */}
        <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Left: Title & Live State Badge */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] flex items-center justify-center">
              <Network size={15} />
            </div>
            <h1 className="text-sm font-semibold text-[var(--color-text)] tracking-tight m-0">
              Integration Test Coverage
            </h1>
          </div>

          {/* Right: Header Utilities (Initial Scan, Framework Setup, History) */}
          <div className="flex items-center gap-2 flex-wrap">
            {!hasScanned ? (
              <button
                type="button"
                onClick={handleScanEndpoints}
                disabled={isScanningEndpoints || isJobActive}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] transition-colors duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                title="Scan Express/Node AST to discover API routes and controllers"
              >
                <RefreshCw
                  size={12}
                  className={isScanningEndpoints ? "animate-spin" : ""}
                />
                <span>
                  {isScanningEndpoints ? "Scanning APIs..." : "Scan APIs"}
                </span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setCancellationNotice("");
                    setSetupAutoRun(false);
                    setSetupModalOpen(true);
                  }}
                  disabled={!projectAccess.can("ai.use") || isJobActive}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                  title="Configure Supertest + Jest runner and dependencies"
                >
                  <SlidersHorizontal
                    size={13}
                    className="text-[var(--color-text-muted)]"
                  />
                  <span>Test Setup</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRunApprovedTests(false)}
                  disabled={
                    !projectAccess.can("tests.run") ||
                    isJobActive ||
                    pendingAction === "RUN"
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                  title="Select all API endpoints and run integration test coverage"
                >
                  {pendingAction === "RUN" ||
                  (isJobActive && activeJobType === "EXECUTE") ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Play size={12} fill="currentColor" />
                  )}
                  <span>
                    {pendingAction === "RUN"
                      ? "Starting..."
                      : isJobActive && activeJobType === "EXECUTE"
                        ? "Running Coverage..."
                        : "Run Coverage"}
                  </span>
                </button>
              </>
            )}

            {/* Version History & Diff Drawer Button */}
            <button
              type="button"
              onClick={() => setDrawerOpen(drawerOpen ? null : "history")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors duration-150 cursor-pointer ${
                drawerOpen
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30 font-semibold"
                  : "bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)]"
              }`}
              title="View execution history and before/after comparisons"
            >
              <Clock size={13} />
              <span className="hidden md:inline">History</span>
            </button>
          </div>
        </div>

        {/* ── 2. UNIFIED TELEMETRY STRIP (Asymmetric Hierarchy) ── */}
        {hasScanned && (
          <div className="px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg)]/60">
            <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)] overflow-hidden">
              {/* Primary Anchor: Endpoint Coverage */}
              <div className="lg:col-span-5 px-4 py-3 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                  <span>Endpoint coverage</span>
                  <span className="font-mono tabular-nums text-[var(--color-text-muted)]">
                    {overallStats.testedApis}/{overallStats.totalApis}{" "}
                    {overallStats.totalApis === 1 ? "route" : "routes"}
                    {averageCoverage != null && (
                      <span className="ml-2 text-[var(--color-text-secondary)]">
                        · {averageCoverage.toFixed(1)}% line cov
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2 font-mono tabular-nums">
                    <span className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
                      {overallStats.apiCoverageRate}%
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      verified
                    </span>
                  </div>
                  <div className="flex-1 max-w-[160px] bg-[var(--color-surface-secondary)] h-1.5 rounded-sm overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        overallStats.apiCoverageRate === 100 &&
                        overallStats.totalApis > 0
                          ? "bg-emerald-500/65"
                          : "bg-[var(--color-primary)]/70"
                      }`}
                      style={{ width: `${overallStats.apiCoverageRate}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Supporting Metrics Strip */}
              <div className="lg:col-span-7 grid grid-cols-3 divide-x divide-[var(--color-border)]">
                {/* Discovered Routes */}
                <div className="px-4 py-3 flex flex-col justify-between gap-1">
                  <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                    <span>Discovered</span>
                    {overallStats.totalApis > 0 && (
                      <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
                        {overallStats.uncoveredApis === 0
                          ? "All covered"
                          : overallStats.partialApis > 0
                            ? `${overallStats.partialApis} partial · ${overallStats.notFullyCoveredApis} uncovered`
                            : `${overallStats.uncoveredApis} uncovered`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums">
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-bold tracking-tight text-[var(--color-text)]">
                        {overallStats.totalApis}
                      </span>
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        {overallStats.totalApis === 1 ? "route" : "routes"}
                      </span>
                    </div>
                    <span className="text-[11px] text-[var(--color-text-muted)]">
                      {coveredApiFilesCount}/{apiFiles.length}{" "}
                      {apiFiles.length === 1 ? "file" : "files"}
                    </span>
                  </div>
                </div>

                {/* Test Scenarios */}
                <div className="px-4 py-3 flex flex-col justify-between gap-1">
                  <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                    <span>Scenarios</span>
                    {overallStats.totalScenariosCount > 0 && (
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          overallStats.failedScenariosCount > 0
                            ? "text-rose-300/85"
                            : "text-[var(--color-text-muted)]"
                        }`}
                      >
                        {overallStats.scenarioPassRate}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1 font-mono tabular-nums">
                    <span className="text-xl font-bold tracking-tight text-[var(--color-text)]">
                      {overallStats.passedScenariosCount}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-muted)]">
                      / {overallStats.totalScenariosCount} passed
                    </span>
                  </div>
                </div>

                {/* Execution Health */}
                <button
                  type="button"
                  onClick={() => setActiveTab("report")}
                  className="px-4 py-3 flex flex-col justify-between gap-1 text-left hover:bg-[var(--color-surface-secondary)]/50 transition-colors cursor-pointer"
                  title="Open Executive Report & diagnostics"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                    <span>Health</span>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
                      {((execution?.durationMs || 0) / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <div className="flex items-center gap-2 font-mono tabular-nums">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        overallStats.passedScenariosCount +
                          effectiveFailedCount ===
                        0
                          ? "bg-[var(--color-text-muted)]"
                          : effectiveFailedCount === 0
                            ? "bg-emerald-500/65"
                            : "bg-rose-400/75"
                      }`}
                    />
                    <span
                      className={`text-sm font-medium truncate ${
                        overallStats.passedScenariosCount +
                          effectiveFailedCount ===
                        0
                          ? "text-[var(--color-text-secondary)]"
                          : effectiveFailedCount === 0
                            ? "text-[var(--color-text-secondary)]"
                            : "text-rose-300/85"
                      }`}
                    >
                      {overallStats.passedScenariosCount +
                        effectiveFailedCount ===
                      0
                        ? "Not run yet"
                        : effectiveFailedCount === 0
                          ? "All healthy"
                          : `${effectiveFailedCount} failed`}
                    </span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 3. TWO-TAB NAVIGATION BAR (Underline Style) ── */}
        <div className="px-5 border-t border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between overflow-x-auto custom-scrollbar">
          <div className="flex items-center gap-5 text-xs" role="tablist">
            {WORKSPACE_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`integration-tab-${tab.id}`}
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-1.5 py-2.5 text-xs font-medium transition-colors cursor-pointer select-none outline-none border-b-2 -mb-px ${
                    isActive
                      ? "border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                      : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  <Icon
                    size={13}
                    className={
                      isActive
                        ? "text-[var(--color-primary)]"
                        : "text-[var(--color-text-muted)]"
                    }
                  />
                  <span>{tab.label}</span>
                  {tab.badge != null && (
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-mono tabular-nums ${
                        tab.badgeColor ||
                        (isActive
                          ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]")
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] shrink-0 font-mono">
            {(refreshing || isScanningEndpoints) && (
              <span className="flex items-center gap-1 text-[var(--color-primary)]">
                <RefreshCw size={11} className="animate-spin" /> Syncing...
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Cancellation Notice Banner */}
      {cancellationNotice && (
        <div className="px-5 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-[var(--color-warning)] flex items-center justify-between no-print">
          <span>{cancellationNotice}</span>
          <button
            type="button"
            onClick={() => setCancellationNotice("")}
            className="cursor-pointer text-inherit"
          >
            ✕
          </button>
        </div>
      )}

      {/* Global Error Banner */}
      {error && (
        <div className="px-5 py-2 bg-rose-500/10 border-b border-rose-500/20 text-xs text-[var(--color-danger)] flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError("")}
            className="cursor-pointer text-inherit"
          >
            ✕
          </button>
        </div>
      )}

      {/* Suite-Level Load Failure Banner (Jest failed before scenarios ran) */}
      {suiteLoadErrors.length > 0 && (
        <div className="px-5 py-2.5 bg-rose-500/10 border-b border-rose-500/20 text-xs text-rose-200 space-y-1 no-print">
          <div className="flex items-center gap-2 font-semibold text-rose-300">
            <AlertTriangle size={14} className="shrink-0" />
            <span>
              {suiteLoadErrors.length} test{" "}
              {suiteLoadErrors.length === 1 ? "file" : "files"} failed to load
              before executing scenarios:
            </span>
          </div>
          <div className="space-y-1 pl-5">
            {suiteLoadErrors.slice(0, 4).map((errItem, idx) => (
              <div
                key={errItem.testFile || idx}
                className="font-mono text-[11px] text-[var(--color-text-secondary)]"
              >
                <span className="text-[var(--color-text)] font-semibold">
                  {errItem.testFile}:
                </span>{" "}
                <span className="text-rose-300/90">{errItem.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 4. MAIN TAB CONTENT AREA ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
        <IntegrationErrorBoundary onRetry={() => load({ scan: hasScanned })}>
          {/* Live Pipeline Progress Card */}
          {isJobActive && (
            <div className="mb-4 rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-surface)] overflow-hidden no-print">
              <div className="px-4 py-3 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center shrink-0">
                    <Loader2 size={15} className="animate-spin" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[var(--color-text)]">
                        {activeJobType === "EXECUTE"
                          ? "Executing Integration Coverage Runner..."
                          : activeJobType === "GENERATE"
                            ? "Synthesizing 100% API Test Scenarios..."
                            : "Scanning AST Route Architecture..."}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20">
                        Job #{activeJobId?.substring(0, 8) || "running"}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--color-text-secondary)] m-0 mt-0.5">
                      {activeJobType === "EXECUTE"
                        ? "Executing HTTP assertions in isolated runner and mapping reverse endpoint coverage."
                        : "Generating multi-layer scenarios (Happy Path, Validation 400, Auth 401/403, Not Found 404, Edge Cases)."}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1 tabular-nums">
                    <Clock size={12} />
                    <span>{liveDurationText}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCancelActiveJob(activeJobId)}
                    disabled={isCancelling}
                    className="px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/25 hover:bg-rose-500/20 text-xs font-medium cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {isCancelling ? "Canceling..." : "Cancel Task"}
                  </button>
                </div>
              </div>

              {/* Stepper Progress Bar */}
              <div className="p-3.5 bg-[var(--color-bg)]/50 space-y-3">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  {parseProgressSteps(activeJobType, activeLogs).map(
                    (st, i, arr) => (
                      <React.Fragment key={i}>
                        <div className="flex items-center gap-1.5 font-mono text-[11px]">
                          <span
                            className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                              st.done
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                            }`}
                          >
                            {st.done ? <CheckCircle2 size={12} /> : i + 1}
                          </span>
                          <span
                            className={
                              st.done
                                ? "font-semibold text-[var(--color-text)]"
                                : "text-[var(--color-text-muted)]"
                            }
                          >
                            {st.label}
                          </span>
                        </div>
                        {i < arr.length - 1 && (
                          <ChevronRight
                            size={12}
                            className="text-[var(--color-border)] shrink-0 hidden sm:inline"
                          />
                        )}
                      </React.Fragment>
                    ),
                  )}
                </div>

                {/* Collapsible live log stream toggle */}
                <div className="pt-1 border-t border-[var(--color-border)] flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setShowLiveLogsDetails((prev) => !prev)}
                    className="text-[11px] font-mono text-[var(--color-primary)] hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Terminal size={11} />
                    <span>
                      {showLiveLogsDetails
                        ? "Hide console logs"
                        : `View console logs (${activeLogs.length} lines)`}
                    </span>
                  </button>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                    Auto-syncing coverage results upon completion
                  </span>
                </div>

                {showLiveLogsDetails && (
                  <div className="p-3 bg-[#090D12] text-slate-300 font-mono text-[11px] max-h-48 overflow-y-auto custom-scrollbar rounded border border-[var(--color-border)]">
                    {activeLogs.length === 0 ? (
                      <div className="text-slate-500 italic">
                        Waiting for runner events...
                      </div>
                    ) : (
                      activeLogs.map((log, idx) => (
                        <div
                          key={idx}
                          className="leading-relaxed hover:bg-slate-800/40 px-1 rounded flex items-start gap-2"
                        >
                          <span className="text-slate-600 select-none text-[9px] w-6 shrink-0">
                            {idx + 1}
                          </span>
                          <span className="text-slate-300 break-all">
                            {typeof log.message === "string"
                              ? log.message
                              : JSON.stringify(log.message)}
                          </span>
                        </div>
                      ))
                    )}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 1: UNIFIED ENDPOINTS & SCENARIOS MATRIX */}
          {activeTab === "endpoints" && (
            <div className="space-y-4">
              <IntegrationRouteMatrixTable
                ref={matrixRef}
                key={snapshotId || "integration"}
                snapshotId={snapshotId}
                endpoints={endpoints}
                aiTests={workspace?.aiTests || []}
                hasScanned={hasScanned}
                hasAnalyzedCoverage={Boolean(
                  workspace?.generation?.hasAnalyzedCoverage ||
                  overallStats.totalScenariosCount > 0 ||
                  (workspace?.execution?.totalTests || 0) > 0,
                )}
                isScanning={isScanningEndpoints}
                onScanEndpoints={handleScanEndpoints}
                onOpenSetupModal={() => {
                  setSetupAutoRun(true);
                  setSetupModalOpen(true);
                }}
                onGenerateTest={(ep) =>
                  handleGenerateClick([
                    `${(ep.method || "GET").toUpperCase()} ${ep.fullPath || ep.path || ep.route || "/"}`,
                  ])
                }
                onGenerateSelected={(selectedEps) =>
                  handleGenerateClick(
                    selectedEps.map(
                      (ep) =>
                        `${(ep.method || "GET").toUpperCase()} ${ep.fullPath || ep.path || ep.route || "/"}`,
                    ),
                  )
                }
                onGenerateAllTests={() => handleGenerateClick()}
                onRunEndpoint={handleRunEndpoint}
                onRunSelected={handleRunSelectedEndpoints}
                onRunSelectedScenarios={handleRunSelectedScenarios}
                onRunScenario={handleRetryScenario}
                onApplyScenario={
                  projectAccess.can("files.write")
                    ? (sc) =>
                        handleOpenApplyModal(
                          sc.aiTestId ? [sc.aiTestId] : null,
                          [
                            `${sc.aiTestId}::${sc.scenarioId || sc.title || sc.testName}`,
                          ],
                        )
                    : null
                }
                onApplySelectedScenarios={
                  projectAccess.can("files.write")
                    ? (selectedList = []) => {
                        const aiList = selectedList.filter(
                          (sc) => sc.aiTestId && sc.scenarioId,
                        );
                        if (aiList.length === 0) return;
                        const testIds = Array.from(
                          new Set(
                            aiList.map((sc) => sc.aiTestId).filter(Boolean),
                          ),
                        );
                        const initialKeys = aiList.map(
                          (sc) =>
                            `${sc.aiTestId}::${sc.scenarioId || sc.title || sc.testName}`,
                        );
                        handleOpenApplyModal(testIds, initialKeys);
                      }
                    : null
                }
                onOpenAddScenario={
                  projectAccess.can("files.write")
                    ? handleOpenAddScenario
                    : null
                }
                onOpenEditScenario={handleOpenEditScenario}
                onDeleteScenario={
                  projectAccess.can("files.write") ? handleDeleteScenario : null
                }
                onDeleteSelectedScenarios={
                  projectAccess.can("files.write")
                    ? handleDeleteSelectedScenarios
                    : null
                }
                isDeletingSelected={pendingAction === "BULK_DELETE"}
                onToggleScenario={
                  projectAccess.can("files.write") ? handleToggleScenario : null
                }
                onAIFixScenario={
                  projectAccess.can("ai.use") ? handleAIFixScenario : null
                }
                onOpenSourceFile={onOpenFile}
                onSimulateEndpoint={(ep) =>
                  setSimulationModalState({
                    isOpen: true,
                    endpoint: ep,
                    scenario: ep?.scenarios?.[0] || null,
                    autoPlay: true,
                  })
                }
                onSimulateScenario={(sc, ep) =>
                  setSimulationModalState({
                    isOpen: true,
                    endpoint: ep,
                    scenario: sc,
                    autoPlay: true,
                  })
                }
                isGenerating={
                  pendingAction === "GENERATE" ||
                  (isJobActive && activeJobType === "GENERATE")
                }
                isRunning={
                  pendingAction === "RUN" ||
                  pendingAction === "RUN_ENDPOINT" ||
                  pendingAction === "RETRY_SCENARIO" ||
                  (isJobActive && activeJobType === "EXECUTE")
                }
                runningKey={runningTargetKey}
                pendingOpsCount={pendingOpsCount}
                isApplyingPending={isApplyingPending}
                onApplyPendingChanges={async () => {
                  const ok = await flushPendingOps({ reload: true });
                  if (ok) {
                    showToast({
                      type: "success",
                      title: "Changes Applied",
                      message:
                        "All temporary scenario edits, additions, and deletions have been saved.",
                    });
                  }
                }}
                onDiscardPendingChanges={() => {
                  const cleared = { deletes: [], updates: [], adds: [] };
                  setPendingOps(cleared);
                  saveStagedOps("integration", snapshotId, cleared);
                  showToast({
                    type: "info",
                    title: "Temporary Edits Discarded",
                    message: "Reverted temporary scenario changes in UI.",
                  });
                }}
              />
            </div>
          )}

          {/* TAB 2: EXECUTIVE REPORT */}
          {activeTab === "report" && (
            <IntegrationReportEmbed
              projectId={projectId}
              snapshotId={snapshotId}
              report={
                reportData?.overview?.snapshotId === snapshotId
                  ? reportData
                  : null
              }
              workspace={workspace}
              endpoints={endpoints}
              onChatContextChange={onChatContextChange}
              hasScanned={hasScanned}
              hasExecutedCoverage={
                Boolean(reportData?.apiCoverage?.hasExecutedCoverage) ||
                (execution?.totalTests || 0) > 0 ||
                overallStats.passedScenariosCount +
                  overallStats.failedScenariosCount >
                  0
              }
              onScanApis={() => {
                setActiveTab("routes");
                handleScanEndpoints();
              }}
              onRunCoverage={() => handleRunApprovedTests(false)}
              onNavigateTab={setActiveTab}
              onGenerateEndpoint={(key) => handleGenerateClick([key])}
              loading={loading}
              onRefreshReport={() => load({ scan: hasScanned })}
            />
          )}
        </IntegrationErrorBoundary>
      </div>

      {/* 3. SLIDE-OVER DRAWER (Version History & Before/After Diff) */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/75 transition-opacity no-print">
          <div className="w-full max-w-2xl h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-secondary)]">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-[var(--color-primary)]" />
                <h3 className="text-sm font-bold text-[var(--color-text)] m-0">
                  Version History & Diff
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-[var(--color-bg)] p-0.5 rounded-md border border-[var(--color-border)] text-xs">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen("history")}
                    className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                      drawerOpen === "history"
                        ? "bg-[var(--color-surface)] text-[var(--color-text)] font-bold border border-[var(--color-border)]"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    Snapshot History
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen("compare")}
                    className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                      drawerOpen === "compare"
                        ? "bg-[var(--color-surface)] text-[var(--color-text)] font-bold border border-[var(--color-border)]"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    Before / After Comparison
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setDrawerOpen(null)}
                  className="p-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] cursor-pointer"
                  title="Close (Esc)"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {drawerOpen === "history" && (
                <IntegrationHistoryPane
                  snapshotId={snapshotId}
                  onOpenComparison={() => setDrawerOpen("compare")}
                />
              )}
              {drawerOpen === "compare" && (
                <BeforeAfterComparisonView
                  projectId={projectId}
                  snapshotId={snapshotId}
                  initialBaselineId={new URLSearchParams(location.search).get(
                    "baselineId",
                  )}
                  onBackToWorkspace={() => setDrawerOpen("history")}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4. SMART COVERAGE & 100% API TEST SUITE SETUP MODAL */}
      {setupModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 no-print"
          onClick={() => !isRunningSetupFlow && setSetupModalOpen(false)}
        >
          <div
            className="w-full max-w-xl bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)]">
                  <ShieldCheck size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text)] m-0">
                    100% API Integration Test & Coverage Setup
                  </h3>
                  <p className="text-[11px] text-[var(--color-text-muted)] m-0 mt-0.5">
                    Select testing library, auto-install missing packages, and
                    synthesize standard 5-layer API tests
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSetupModalOpen(false)}
                disabled={isRunningSetupFlow}
                className="p-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 text-xs">
              {/* 1. Dependency / Environment Status */}
              <div className="p-3.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-semibold text-[var(--color-text)] flex items-center gap-2">
                    <span>Project Environment Status</span>
                    {detectionInfo?.needsDependencyInstall ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/25">
                        Missing Test Libraries
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                        Dependencies Ready
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-secondary)]">
                    {detectionInfo?.needsDependencyInstall ? (
                      <>
                        Missing packages:{" "}
                        <code className="font-mono text-amber-400">
                          {(
                            detectionInfo?.missingPackages || [
                              "jest",
                              "supertest",
                            ]
                          ).join(", ")}
                        </code>
                        . CovAI will install them automatically before running.
                      </>
                    ) : (
                      <>
                        Discovered{" "}
                        <strong className="font-mono text-[var(--color-text)]">
                          {endpoints.length}
                        </strong>{" "}
                        API endpoints and{" "}
                        <strong className="font-mono text-[var(--color-text)]">
                          {overallStats.totalScenariosCount}
                        </strong>{" "}
                        existing test scenarios.
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 2. Integration Test Runner */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Integration Test Runner
                </label>
                <div className="grid grid-cols-1 gap-2.5">
                  {[
                    {
                      id: "SUPERTEST",
                      title: "Supertest + Jest",
                      badge: "Active Runner",
                      desc: "In-memory Express app testing with fast HTTP status/body assertions and V8/Istanbul line coverage.",
                    },
                  ].map((fw) => {
                    const selected = setupFramework === fw.id;
                    return (
                      <button
                        key={fw.id}
                        type="button"
                        onClick={() => setSetupFramework(fw.id)}
                        className={`p-3 rounded-md border text-left transition-colors cursor-pointer ${
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
                            className={`px-1.5 py-0.2 rounded text-[9px] font-mono ${
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
              </div>

              {/* 3. Standard 100% API Coverage Matrix Blueprint */}
              <div className="p-3.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text)]">
                    Standard 5-Layer API Test Blueprint (100% Route Coverage)
                  </span>
                  <span className="font-mono text-[11px] text-[var(--color-primary)] font-semibold">
                    {endpoints.length > 0
                      ? `${endpoints.length} APIs Targeted`
                      : "Auto-Scan Included"}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[10px] font-mono">
                  <span className="px-2 py-1 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] text-center">
                    2xx Happy Path
                  </span>
                  <span className="px-2 py-1 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] text-center">
                    400 Validation
                  </span>
                  <span className="px-2 py-1 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] text-center">
                    401/403 Auth
                  </span>
                  <span className="px-2 py-1 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] text-center">
                    404 Not Found
                  </span>
                  <span className="px-2 py-1 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] text-center">
                    500 Resiliency
                  </span>
                </div>
              </div>

              {/* 4. Auto-Run Coverage Checkbox */}
              <label className="flex items-center gap-2.5 p-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={setupAutoRun}
                  onChange={(e) => setSetupAutoRun(e.target.checked)}
                  className="rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-0"
                />
                <span className="text-xs text-[var(--color-text)] font-medium">
                  Automatically execute coverage runner immediately after
                  generating 100% API test suite
                </span>
              </label>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 bg-[var(--color-surface-secondary)] border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSetupModalOpen(false)}
                disabled={isRunningSetupFlow}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] cursor-pointer"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                {(overallStats.totalScenariosCount > 0 ||
                  (detectionInfo?.testFiles || []).length > 0 ||
                  (detectionInfo?.supertestFiles || []).length > 0) && (
                  <button
                    type="button"
                    onClick={() =>
                      handleConfirmSetupAndRun({
                        generateSuite: false,
                        autoRun: true,
                      })
                    }
                    disabled={isRunningSetupFlow}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-bg)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] cursor-pointer"
                  >
                    Run Existing Tests Only (
                    {overallStats.totalScenariosCount ||
                      (detectionInfo?.supertestFiles || []).length ||
                      (detectionInfo?.testFiles || []).length}
                    )
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    handleConfirmSetupAndRun({
                      generateSuite: true,
                      autoRun: setupAutoRun,
                    })
                  }
                  disabled={isRunningSetupFlow}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isRunningSetupFlow ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Configuring & Starting...</span>
                    </>
                  ) : (
                    <>
                      <Zap size={13} />
                      <span>
                        {detectionInfo?.needsDependencyInstall
                          ? "Install & Generate 100% API Tests"
                          : setupAutoRun
                            ? "Generate 100% API Suite & Run Coverage"
                            : "Generate 100% API Suite"}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. OTHER MODALS */}
      <SourceCodeViewerModal
        isOpen={sourceViewerOpen}
        onClose={() => setSourceViewerOpen(false)}
        projectId={projectId}
        snapshotId={snapshotId}
        fileOptions={sourceViewerOptions}
        onOpenFile={onOpenFile}
      />

      <IntegrationApplyTestsModal
        isOpen={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
        snapshotId={snapshotId}
        testIds={applyModalTestIds}
        scenarios={availableApplyScenarios}
        initialSelectedKeys={applyModalInitialKeys}
        onBeforeApply={() => flushPendingOps({ reload: false })}
        onAppliedSuccess={() => load({ scan: false })}
        onTriggerRerun={() => {
          setApplyModalOpen(false);
          handleRunApprovedTests(true);
        }}
      />

      <IntegrationScenarioEditorModal
        isOpen={editorModalOpen}
        onClose={() => {
          if (!savingScenario) {
            setEditorSaveError("");
            setEditorModalOpen(false);
          }
        }}
        onSave={handleSaveScenario}
        loading={savingScenario}
        saveError={editorSaveError}
        initialCode={editorModalScenario?.code || ""}
        title={
          editorModalScenario?.title ||
          (editorModalEndpoint
            ? `Add Scenario for ${editorModalEndpoint.method} ${editorModalEndpoint.path}`
            : "Edit Test Scenario")
        }
        targetEndpoint={editorModalEndpoint}
        availableEndpoints={endpoints}
        onSelectTargetEndpoint={setEditorModalEndpoint}
        existingScenarioTitles={(editorModalEndpoint?.scenarios || [])
          .map((s) => s.title || s.name || "")
          .filter(Boolean)}
        isAddMode={isAddScenarioMode}
      />

      <IntegrationSimulationStudioModal
        isOpen={simulationModalState.isOpen}
        onClose={() =>
          setSimulationModalState((prev) => ({ ...prev, isOpen: false }))
        }
        snapshotId={snapshotId}
        endpoint={simulationModalState.endpoint}
        initialScenario={simulationModalState.scenario}
        autoPlayOnOpen={simulationModalState.autoPlay}
        onOpenSourceFile={onOpenFile}
      />
    </div>
  );
}
