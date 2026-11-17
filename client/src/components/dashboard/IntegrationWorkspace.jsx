import { useProjectAccess } from "../../hooks/useProjectAccess";
import { getIntegrationScenarioApi, mutateIntegrationScenarioApi } from "../../services/integrationScenario.service";
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
            <div key={row} className="p-3 flex items-center justify-between gap-4">
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
  projectId,
  snapshotId,
  onGenerate,
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
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationNotice, setCancellationNotice] = useState("");
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);

  // Framework Installation & Banner
  const [isInstallingDeps, setIsInstallingDeps] = useState(false);
  const [isGeneratingWithBanner, setIsGeneratingWithBanner] = useState(false);

  // Modals & Drawer State
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [applyModalTestIds, setApplyModalTestIds] = useState([]);
  const [applyModalInitialKeys, setApplyModalInitialKeys] = useState(null);
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [editorModalScenario, setEditorModalScenario] = useState(null);
  const [editorModalEndpoint, setEditorModalEndpoint] = useState(null);
  const [isAddScenarioMode, setIsAddScenarioMode] = useState(false);
  const [sourceViewerOpen, setSourceViewerOpen] = useState(false);
  const [sourceViewerOptions, setSourceViewerOptions] = useState([]);
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
    if (activeJobId && (activeJobStatus === "RUNNING" || activeJobStatus === "QUEUED")) {
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
      const shouldSkipAutoScan = !shouldScanNow && !hasScanned;

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
            setHasScanned(true);
          } else if (shouldSkipAutoScan) {
            setHasScanned(false);
          }

          // Check running background jobs
          if (!activeJobId) {
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
          if (det?.targetFramework) {
            setSetupFramework(
              det.targetFramework.toUpperCase().includes("PLAYWRIGHT")
                ? "PLAYWRIGHT_API"
                : "SUPERTEST",
            );
          }
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
    [snapshotId, projectId, activeJobId, hasScanned],
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

  // Job completion handlers
  const handleJobComplete = useCallback(async () => {
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
          message: "API test suite execution finished. Coverage & diagnostics updated.",
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

  const handleCancelActiveJob = useCallback(
    async (targetJobId = null) => {
      const jId = targetJobId || activeJobId;
      if (!jId || isCancelling) return;
      setIsCancelling(true);
      setError("");
      try {
        await cancelJobApi(jId);
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
      const jId = res?.data?.jobId || res?.jobId;
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

  // Run AI Test Generator
  const handleGenerateClick = async (explicitTargets = null) => {
    if (!projectAccess.can("ai.use")) return;
    if (isJobActive || pendingAction === "GENERATE") {
      return;
    }
    if (endpoints.length === 0 && !workspace?.generation?.hasAnalysis) {
      setError("Please run project analysis to discover API endpoints before generating test scenarios.");
      showToast({
        type: "warning",
        title: "Analysis Needed",
        message: "No API endpoints detected yet. Run analysis first to discover routes.",
      });
      return;
    }
    setError("");
    setPendingAction("GENERATE");
    try {
      const res = await onGenerate(explicitTargets);
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
            ? `Generating tests for ${explicitTargets.length} endpoint(s)...`
            : "Generating integration test scenarios with AI...",
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
    const needsDeps = Boolean(detectionInfo?.needsDependencyInstall);

    // If no test cases exist yet or testing library is missing, present the Smart Setup & 100% API Suite Modal
    if (
      !forceDirectRun &&
      (needsDeps || (allScenarioIds.length === 0 && !hasProjectTests))
    ) {
      setSetupAutoRun(true);
      setSetupModalOpen(true);
      return;
    }

    setPendingAction("RUN");
    try {
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
      const jobId =
        response.data?.job?.id || response.data?.jobId || response.jobId;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
      }
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
          framework: setupFramework,
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
            message: `Synthesizing ${setupFramework === "PLAYWRIGHT_API" ? "Playwright API" : "Supertest + Jest"} scenarios for all discovered endpoints...`,
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
      setError(
        `Endpoint ${epKey} has no test scenarios yet.`,
      );
      return;
    }
    setError("");
    setPendingAction("RUN_ENDPOINT");
    setRunningTargetKey(epKey);
    try {
      if (workspace?.aiTests && workspace.aiTests.length > 0 && scenarioIds.length > 0) {
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
      const jobId =
        response.data?.job?.id || response.data?.jobId || response.jobId;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
      }
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
    if (!snapshotId || pendingAction || !Array.isArray(selectedEps) || selectedEps.length === 0) return;

    const allScenarios = selectedEps.flatMap((ep) => ep.scenarios || []);
    const scenarioIds = allScenarios
      .map((s) => s.id || `${s.testId}::${s.scenarioId || s.testName}`)
      .filter(Boolean);
    const targetTestNames = allScenarios
      .map((s) => s.title || s.testName)
      .filter(Boolean);

    const targetEndpoints = selectedEps.map(
      (ep) => `${(ep.method || "GET").toUpperCase()} ${ep.fullPath || ep.path || ep.route || "/"}`,
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
      if (workspace?.aiTests && workspace.aiTests.length > 0 && scenarioIds.length > 0) {
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
      const jobId =
        response.data?.job?.id || response.data?.jobId || response.jobId;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
      }
    } catch (err) {
      setError(err.message || "Failed to execute tests for selected endpoints.");
      setRunningTargetKey(null);
    } finally {
      setPendingAction(null);
    }
  };

  // Run Coverage for Specific Selected Scenarios (Cross-Endpoint Multi-Select)
  const handleRunSelectedScenarios = async (selectedScenarios = []) => {
    if (!projectAccess.can("tests.run")) return;
    if (!snapshotId || pendingAction || !Array.isArray(selectedScenarios) || selectedScenarios.length === 0) return;

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
      const jobId =
        response.data?.job?.id || response.data?.jobId || response.jobId;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
      }
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
      if (workspace?.aiTests && workspace.aiTests.length > 0 && scId && sc.enabled === false) {
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
      const jobId =
        response.data?.job?.id || response.data?.jobId || response.jobId;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
      }
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
    cleanPath = cleanPath.replace(/^(?:\/?app\/)?\.?covai-temp\/collaboration-operations\/[^/]+\//i, "");
    cleanPath = cleanPath.replace(/^(?:\/?app\/)?\.?covai-temp\/[^/]+\//i, "");
    cleanPath = cleanPath.replace(/^(?:\/?app\/)?storage\/projects\/[^/]+\/(?:snapshots\/[^/]+\/)?/i, "");
    cleanPath = cleanPath.replace(/^(?:\/?app\/)/i, "");
    cleanPath = cleanPath.replace(/^[a-zA-Z]:\//i, "");
    cleanPath = cleanPath.replace(/^\/+/, "");

    // Look for matching in-memory AI test or source test from workspace
    const matchingTest = (workspace?.aiTests || []).find(
      (t) =>
        (cleanPath && (t.filePath === cleanPath || t.filePath?.endsWith(cleanPath) || cleanPath.endsWith(t.filePath || ""))) ||
        (sc?.title && (t.content?.includes(sc.title) || (t.requests || []).some((r) => r.testName === sc.title)))
    );

    const targetPath =
      cleanPath ||
      matchingTest?.filePath ||
      ep?.sourceFile ||
      ep?.filePath ||
      "tests/integration/cart.test.js";

    const codeSnippet =
      sc?.code ||
      sc?.sourceCode ||
      matchingTest?.content ||
      null;

    setSourceViewerOptions([
      {
        label: sc?.title || sc?.testName || (ep ? `${ep.method} ${ep.path}` : "Test Scenario"),
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

  // Resolve runtime results to the versioned editable artifact.
  const editableScenario = (sc) => {
    if (sc?.aiTestId && sc?.scenarioId) {
      return {
        aiTestId: sc.aiTestId,
        scenarioId: sc.scenarioId,
        expectedVersion: sc.version ?? 1,
      };
    }
    for (const test of workspace?.aiTests || []) {
      const request = (test.requests || []).find(
        (r) =>
          r.scenarioId === sc?.scenarioId ||
          r.scenarioId === sc?.id ||
          test.id + "::" + r.scenarioId === sc?.id ||
          r.testName === (sc?.testName || sc?.title || sc?.name) ||
          r.title === (sc?.testName || sc?.title || sc?.name),
      );
      if (request)
        return {
          aiTestId: test.id,
          scenarioId: request.scenarioId,
          expectedVersion: test.version,
        };
    }
    const fallbackTest = workspace?.aiTests?.[0];
    return {
      aiTestId: fallbackTest?.id || "fallback",
      scenarioId: sc?.scenarioId || sc?.id || "scenario_1",
      expectedVersion: fallbackTest?.version || 1,
    };
  };

  const handleAIFixScenario = async (scOrEp, maybeEp) => {
    const sc = scOrEp?.title || scOrEp?.scenarioId ? scOrEp : maybeEp;
    if (!projectAccess.can("ai.use") || !snapshotId || !sc) return;
    setError("");
    try {
      const result = await mutateIntegrationScenarioApi({
        snapshotId,
        ...editableScenario(sc),
        action: "REGENERATE",
      });
      const jobId =
        result?.data?.job?.id ||
        result?.job?.id ||
        result?.data?.jobId ||
        result?.jobId;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("GENERATE");
        setActiveJobStatus("RUNNING");
      }
      await load({ scan: true });
    } catch (err) {
      setError(err.message || "Failed to fix scenario with AI.");
    }
  };

  const handleDeleteScenario = async (sc) => {
    if (!projectAccess.can("files.write") || !snapshotId || !sc) return;
    setError("");
    try {
      const identity = editableScenario(sc);
      await mutateIntegrationScenarioApi({
        snapshotId,
        ...identity,
        action: "DELETE",
      });
      showToast({
        type: "info",
        title: "Scenario Deleted",
        message: `Removed "${sc.title || sc.scenarioId}" from test suite.`,
      });
      await load({ scan: true });
    } catch (err) {
      setError(err.message || "Failed to delete scenario.");
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
      await load({ scan: true });
    } catch (err) {
      setError(err.message || "Failed to toggle scenario state.");
    }
  };

  const handleOpenApplyModal = (targetIds = null, initialScenarioKeys = null) => {
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
    const identity = editableScenario(sc);
    const inMemoryCode = sc?.code || sc?.fullFileCode || "";

    // Open immediately if code is already in memory to avoid UI lag
    if (inMemoryCode) {
      setEditorModalScenario({
        ...sc,
        ...identity,
        code: inMemoryCode,
      });
      setEditorModalEndpoint(ep);
      setIsAddScenarioMode(false);
      setEditorModalOpen(true);

      // Sync latest version silently in background if missing
      if (identity.aiTestId && identity.aiTestId !== "fallback" && !identity.expectedVersion) {
        getIntegrationScenarioApi(snapshotId, identity.aiTestId, identity.scenarioId)
          .then((result) => {
            if (result) {
              setEditorModalScenario((prev) =>
                prev
                  ? {
                      ...prev,
                      expectedVersion: result.version || result.aiTest?.version || prev.expectedVersion,
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
      if (identity.aiTestId && identity.aiTestId !== "fallback") {
        const result = await getIntegrationScenarioApi(
          snapshotId,
          identity.aiTestId,
          identity.scenarioId,
        );
        setEditorModalScenario({
          ...sc,
          ...identity,
          expectedVersion:
            result.version || result.aiTest?.version || identity.expectedVersion,
          code: result.code || "",
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
    const tests = workspace?.aiTests || [];
    const test =
      tests.find((t) =>
        t.requests?.some(
          (r) => r.method === ep?.method && r.path === ep?.path,
        ),
      ) || tests[0];
    if (!test) {
      setSetupAutoRun(false);
      setSetupModalOpen(true);
      return;
    }
    setEditorModalScenario({
      aiTestId: test.id,
      expectedVersion: test.version,
    });
    setEditorModalEndpoint(ep);
    setIsAddScenarioMode(true);
    setEditorModalOpen(true);
  };

  const handleSaveScenario = async (savedData) => {
    if (!projectAccess.can("files.write") || !snapshotId) return false;
    setError("");
    try {
      await mutateIntegrationScenarioApi({
        snapshotId,
        aiTestId: editorModalScenario.aiTestId,
        scenarioId: editorModalScenario.scenarioId,
        expectedVersion: editorModalScenario.expectedVersion,
        action: isAddScenarioMode ? "ADD" : "UPDATE",
        code: typeof savedData === "string" ? savedData : savedData.code,
        endpoint: editorModalEndpoint,
      });
      setEditorModalOpen(false);
      await load({ scan: false });
      return true;
    } catch (err) {
      setError(err.message || "Failed to save scenario.");
      return false;
    }
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
  const { endpoints = [], summary, execution, generation } = workspace || {};

  const availableApplyScenarios = useMemo(() => {
    const statusByTitle = new Map();
    for (const ep of endpoints || []) {
      for (const sc of ep.scenarios || []) {
        const key = String(sc.title || sc.name || "").trim().toLowerCase();
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
        const cleanRoute = (ep.path || ep.route || ep.fullPath || "").replace(/\/+$/, "") || "/";
        const regexStr = "^" + cleanRoute.replace(/\./g, "\\.").replace(/:[a-zA-Z0-9_]+/g, "[^/]+") + "$";
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
        const epMethod = matchedEp ? (matchedEp.method || "GET").toUpperCase() : rMethod;
        const epPath = matchedEp
          ? (matchedEp.path || matchedEp.route || matchedEp.fullPath || "/")
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
        } else if (epPassed > 0) {
          passedApis++;
          testedApis++;
        }
      }

      if (!scenariosByEndpointMap[epKey]) {
        scenariosByEndpointMap[epKey] = [];
      }

      epScenarios.forEach((s, idx) => {
        const scStatusUpper = String(s.status || "").toUpperCase();
        const isExecuted = scStatusUpper === "PASSED" || scStatusUpper === "PASS" || scStatusUpper === "FAILED" || scStatusUpper === "FAIL";
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
            (ex.testName && (ex.testName === sTitle || ex.testName === s.testName))
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
          if (s.executionVerdict) existing.executionVerdict = s.executionVerdict;
          if (s.actualStatus !== undefined) existing.actualStatus = s.actualStatus;
          if (s.failureDiagnostics) existing.failureDiagnostics = s.failureDiagnostics;
        }
      });
    });

    const uncoveredApis = Math.max(0, totalApis - testedApis);
    const executedApisCount = passedApis + failedApis;
    const apiPassRate =
      executedApisCount > 0 ? Math.round((passedApis / executedApisCount) * 100) : 0;
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
      dedupedScenarios.length > 0
        ? dedupPassed
        : execution?.passedTests || 0;

    const failedScenariosCount =
      dedupedScenarios.length > 0
        ? dedupFailed
        : execution?.failedTests || 0;

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
      failedApis,
      uncoveredApis,
      apiPassRate,
      apiCoverageRate,
      totalScenariosCount,
      passedScenariosCount,
      failedScenariosCount,
      scenarioPassRate,
      scenarioCoverageRate,
    };
  }, [endpoints, execution, generation, workspace]);

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
          Please select a valid snapshot from the project list before using API Integration Testing features.
        </p>
      </div>
    );
  }

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
        failedScenariosList.length > 0
          ? `${failedScenariosList.length} failed`
          : overallStats.passedScenariosCount > 0
            ? `${overallStats.apiCoverageRate}%`
            : null,
      badgeColor:
        failedScenariosList.length > 0
          ? "bg-rose-500/10 text-rose-400 border border-rose-500/25 font-semibold"
          : "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-semibold",
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
            <div className="w-7 h-7 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-primary)] flex items-center justify-center">
              <Network size={15} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm font-semibold text-[var(--color-text)] tracking-tight m-0">
                API Integration Testing
              </h1>
              {hasScanned && detectionInfo?.targetFramework && (
                <span className="px-2 py-0.5 rounded font-mono text-[10px] font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                  {detectionInfo.targetFramework.toUpperCase()}
                </span>
              )}
              {/* Dynamic Health Badge */}
              {isJobActive ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-sky-500/10 text-sky-400 border border-sky-500/25">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
                  </span>
                  Running...
                </span>
              ) : failedScenariosList.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveTab("report")}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/25 cursor-pointer hover:bg-rose-500/20 transition-colors"
                >
                  <AlertTriangle size={10} />
                  {failedScenariosList.length} failed
                </button>
              ) : overallStats.passedScenariosCount > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  <CheckCircle2 size={10} />
                  {overallStats.passedScenariosCount} passed
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                  {hasScanned
                    ? `${overallStats.totalApis} ${overallStats.totalApis === 1 ? "route" : "routes"} discovered`
                    : "Not scanned yet"}
                </span>
              )}
            </div>
          </div>

          {/* Right: Header Utilities (Initial Scan, Framework Setup, History) */}
          <div className="flex items-center gap-2 flex-wrap">
            {!hasScanned ? (
              <button
                type="button"
                onClick={handleScanEndpoints}
                disabled={isScanningEndpoints || isJobActive}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white transition-colors duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                title="Scan Express/Node AST to discover API routes and controllers"
              >
                <RefreshCw
                  size={12}
                  className={isScanningEndpoints ? "animate-spin" : "text-white"}
                />
                <span>{isScanningEndpoints ? "Scanning APIs..." : "Scan APIs"}</span>
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
                  title="Configure test framework (Supertest / Playwright API) and dependencies"
                >
                  <SlidersHorizontal size={13} className="text-[var(--color-primary)]" />
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
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                  title="Run existing project integration tests & approved scenarios to measure coverage"
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
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2 font-mono tabular-nums">
                    <span
                      className={`text-2xl font-bold tracking-tight ${
                        overallStats.apiCoverageRate === 100 && overallStats.totalApis > 0
                          ? "text-emerald-400"
                          : "text-[var(--color-primary)]"
                      }`}
                    >
                      {overallStats.apiCoverageRate}%
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      verified
                    </span>
                  </div>
                  <div className="flex-1 max-w-[160px] bg-[var(--color-surface-secondary)] h-1.5 rounded-sm overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        overallStats.apiCoverageRate === 100 && overallStats.totalApis > 0
                          ? "bg-emerald-400"
                          : "bg-[var(--color-primary)]"
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
                  <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                    Discovered
                  </span>
                  <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
                    <span className="text-xl font-bold tracking-tight text-[var(--color-text)]">
                      {overallStats.totalApis}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-muted)] truncate">
                      {overallStats.uncoveredApis > 0
                        ? `${overallStats.uncoveredApis} uncovered`
                        : "all covered"}
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
                          overallStats.scenarioPassRate === 100
                            ? "text-emerald-400"
                            : overallStats.failedScenariosCount > 0
                              ? "text-rose-400"
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
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        overallStats.passedScenariosCount + overallStats.failedScenariosCount === 0
                          ? "bg-[var(--color-text-muted)]"
                          : failedScenariosList.length === 0
                            ? "bg-emerald-400"
                            : "bg-rose-400"
                      }`}
                    />
                    <span
                      className={`text-sm font-semibold truncate ${
                        overallStats.passedScenariosCount + overallStats.failedScenariosCount === 0
                          ? "text-[var(--color-text-secondary)]"
                          : failedScenariosList.length === 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                      }`}
                    >
                      {overallStats.passedScenariosCount + overallStats.failedScenariosCount === 0
                        ? "Not run yet"
                        : failedScenariosList.length === 0
                          ? "All healthy"
                          : `${failedScenariosList.length} failed`}
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
                onOpenAddScenario={
                  projectAccess.can("files.write")
                    ? handleOpenAddScenario
                    : null
                }
                onOpenEditScenario={handleOpenEditScenario}
                onDeleteScenario={
                  projectAccess.can("files.write")
                    ? handleDeleteScenario
                    : null
                }
                onToggleScenario={
                  projectAccess.can("files.write")
                    ? handleToggleScenario
                    : null
                }
                onAIFixScenario={
                  projectAccess.can("ai.use") ? handleAIFixScenario : null
                }
                onOpenSourceFile={onOpenFile}
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
              />
            </div>
          )}

          {/* TAB 2: EXECUTIVE REPORT */}
          {activeTab === "report" && (
            <IntegrationReportEmbed
              projectId={projectId}
              snapshotId={snapshotId}
              report={reportData}
              workspace={workspace}
              endpoints={endpoints}
              hasScanned={hasScanned}
              hasExecutedCoverage={
                Boolean(reportData?.apiCoverage?.hasExecutedCoverage) ||
                (execution?.totalTests || 0) > 0 ||
                overallStats.passedScenariosCount + overallStats.failedScenariosCount > 0
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

              {/* 2. Choose Testing Framework */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Select Integration Test Runner Library
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    {
                      id: "SUPERTEST",
                      title: "Supertest + Jest",
                      badge: "Recommended",
                      desc: "In-memory Express app testing with fast HTTP status/body assertions and V8/Istanbul line coverage.",
                    },
                    {
                      id: "PLAYWRIGHT_API",
                      title: "Playwright API Runner",
                      badge: "Contract",
                      desc: "Full HTTP APIRequestContext testing for REST endpoints, headers, and multi-step workflows.",
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
                  <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-center">
                    2xx Happy Path
                  </span>
                  <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-center">
                    400 Validation
                  </span>
                  <span className="px-2 py-1 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 text-center">
                    401/403 Auth
                  </span>
                  <span className="px-2 py-1 rounded bg-zinc-500/10 text-zinc-300 border border-zinc-500/20 text-center">
                    404 Not Found
                  </span>
                  <span className="px-2 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-center">
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
                {overallStats.totalScenariosCount > 0 && (
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
                    Run Existing Tests Only ({overallStats.totalScenariosCount})
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
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white transition-colors cursor-pointer disabled:opacity-50"
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
        onTriggerRerun={() => {
          setApplyModalOpen(false);
          handleRunApprovedTests(true);
        }}
      />

      <IntegrationScenarioEditorModal
        isOpen={editorModalOpen}
        onClose={() => setEditorModalOpen(false)}
        onSave={handleSaveScenario}
        initialCode={editorModalScenario?.code || ""}
        title={
          editorModalScenario?.title ||
          (editorModalEndpoint
            ? `Add Scenario for ${editorModalEndpoint.method} ${editorModalEndpoint.path}`
            : "Edit Test Scenario")
        }
        targetEndpoint={editorModalEndpoint}
        availableEndpoints={endpoints}
        isAddMode={isAddScenarioMode}
      />
    </div>
  );
}
