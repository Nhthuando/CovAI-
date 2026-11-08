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

import IntegrationFrameworkDetectionBanner from "./integration/IntegrationFrameworkDetectionBanner.jsx";
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

  const [workspace, setWorkspace] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [detectionInfo, setDetectionInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

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

  // Active navigation tab (endpoints, scenarios, report)
  const [activeTab, setActiveTab] = useState(() => {
    if (activeView === "report") return "report";
    const params = new URLSearchParams(location.search);
    const focusSection = params.get("focusSection");
    const view = params.get("view");
    if (view === "report" || focusSection === "section-report" || focusSection === "section-failures") return "report";
    if (focusSection === "section-scenarios") return "scenarios";
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
    if (id === "section-failures" || id === "section-report") setActiveTab("report");
    else if (id === "section-scenarios") setActiveTab("scenarios");
    else if (id === "section-matrix") setActiveTab("endpoints");
    else if (id === "section-execution") setActiveTab("execution");
    else setActiveTab("endpoints");
  };

  const toggleCallstack = (key) => {
    setExpandedCallstacks((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // 1. Data Loader: Workspace, Detection, Report
  const load = useCallback(async () => {
    if (!snapshotId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (workspace) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");

    try {
      const [workspaceRes, detectionRes, reportRes] = await Promise.allSettled([
        getIntegrationWorkspace(snapshotId),
        getIntegrationDetection(snapshotId),
        projectId
          ? fetchIntegrationReport(projectId)
          : Promise.resolve({ data: null }),
      ]);

      if (workspaceRes.status === "fulfilled") {
        setWorkspace(workspaceRes.value.data);

        // Check running background jobs
        if (!activeJobId) {
          const fetchedJobs = workspaceRes.value.data.jobs || {};
          let runningJobId = null;
          let runningJobType = null;

          if (
            fetchedJobs.analyze?.status === "RUNNING" ||
            fetchedJobs.analyze?.status === "QUEUED"
          ) {
            runningJobId = fetchedJobs.analyze.id;
            runningJobType = "ANALYZE";
          } else if (
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
          const aiIds = (workspaceRes.value.data?.aiTests || []).flatMap((t) =>
            (t?.requests || []).map(
              (r) => `${t.id}::${r.scenarioId || r.testName}`,
            ),
          );
          const epIds = (workspaceRes.value.data?.endpoints || []).flatMap((ep) =>
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
        setDetectionInfo(detectionRes.value.data || detectionRes.value);
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
  }, [snapshotId, projectId, activeJobId]);

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
    try {
      await load();
      if (snapshotId) {
        invalidateCoverageQueries(snapshotId);
      }
      if (activeJobType === "EXECUTE") {
        showToast({
          type: "success",
          title: "Test Run Completed",
          message: "API test suite execution finished. Results updated.",
        });
      } else if (activeJobType === "GENERATE") {
        showToast({
          type: "success",
          title: "AI Synthesis Finished",
          message: "New test scenarios generated and ready for review.",
        });
      } else if (activeJobType === "ANALYZE") {
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
      setTimeout(() => {
        setActiveJobId(null);
        setActiveJobType(null);
        setActiveJobStatus("SUCCESS");
        setIsCancelling(false);
        setPendingAction(null);
      }, 500);
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

  // Run All Approved Tests
  const handleRunApprovedTests = async () => {
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

    const allAiTests = workspace?.aiTests || [];
    const allScenarioIds = allAiTests.flatMap((t) => {
      let meta = {};
      try {
        meta =
          typeof t.metaJson === "string"
            ? JSON.parse(t.metaJson)
            : t.metaJson || {};
      } catch (e) {}
      return (meta.requests || []).map(
        (r) => `${t.id}::${r.scenarioId || r.testName}`,
      );
    });
    const hasProjectTests =
      (detectionInfo?.testFiles || []).length > 0 ||
      (detectionInfo?.supertestFiles || []).length > 0;

    if (allScenarioIds.length === 0 && !hasProjectTests) {
      await handleGenerateClick();
      return;
    }

    setPendingAction("RUN");
    try {
      if (allScenarioIds.length > 0) {
        await approveIntegrationTestsApi(snapshotId, allScenarioIds).catch(
          () => {},
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
      if (workspace?.aiTests && workspace.aiTests.length > 0 && scId) {
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
  const editableScenario = sc => {
    for (const test of workspace?.aiTests || []) {
      const request = (test.requests || []).find(r =>
        r.scenarioId === sc?.scenarioId || r.scenarioId === sc?.id ||
        test.id + '::' + r.scenarioId === sc?.id ||
        r.testName === (sc?.testName || sc?.title || sc?.name));
      if (request) return {aiTestId:test.id,scenarioId:request.scenarioId,expectedVersion:test.version};
    }
    const fallbackTest = workspace?.aiTests?.[0];
    return {
      aiTestId: fallbackTest?.id || "fallback",
      scenarioId: sc?.scenarioId || sc?.id || "scenario_1",
      expectedVersion: fallbackTest?.version || 1,
    };
  };
  const handleAIFixScenario = async (ep, sc) => {
    if (!projectAccess.can('ai.use') || !snapshotId || !sc) return;
    setError('');
    try {
      const result = await mutateIntegrationScenarioApi({snapshotId,...editableScenario(sc),action:'REGENERATE'});
      const jobId = result?.data?.job?.id || result?.job?.id || result?.data?.jobId || result?.jobId;
      if (jobId) {setActiveJobId(jobId);setActiveJobType('GENERATE');setActiveJobStatus('RUNNING');}
      await load();
    } catch(err) {setError(err.message || 'Failed to fix scenario with AI.');}
  };
  const handleOpenApplyModal = (targetIds = null) => {
    if (!projectAccess.can('files.write')) return;
    setApplyModalTestIds(targetIds?.length ? targetIds : selectedTestIds);
    setApplyModalOpen(true);
  };
  const handleOpenEditScenario = async (sc,ep = null) => {
    if (!projectAccess.can('files.write')) return;
    try {
      const identity = editableScenario(sc);
      const result = await getIntegrationScenarioApi(snapshotId,identity.aiTestId,identity.scenarioId);
      setEditorModalScenario({...sc,...identity,expectedVersion:result.version || result.aiTest?.version,code:result.code});
      setEditorModalEndpoint(ep);setIsAddScenarioMode(false);setEditorModalOpen(true);
    } catch(err) {setError(err.message);}
  };
  const handleOpenAddScenario = ep => {
    if (!projectAccess.can('files.write')) return;
    const tests = workspace?.aiTests || [];
    const test = tests.find(t => t.requests?.some(r=>r.method===ep?.method && r.path===ep?.path)) || tests[0];
    if (!test) {setError('Generate a test file before adding new scenarios.');return;}
    setEditorModalScenario({aiTestId:test.id,expectedVersion:test.version});
    setEditorModalEndpoint(ep);setIsAddScenarioMode(true);setEditorModalOpen(true);
  };
  const handleSaveScenario = async savedData => {
    if (!projectAccess.can('files.write') || !snapshotId) return false;
    setError('');
    try {
      await mutateIntegrationScenarioApi({snapshotId,aiTestId:editorModalScenario.aiTestId,
        scenarioId:editorModalScenario.scenarioId,expectedVersion:editorModalScenario.expectedVersion,
        action:isAddScenarioMode ? 'ADD' : 'UPDATE',code:typeof savedData === "string" ? savedData : savedData.code,endpoint:editorModalEndpoint});
      setEditorModalOpen(false);await load();return true;
    } catch(err) {setError(err.message || 'Failed to save scenario.');return false;}
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

    // 1. Ingest scenarios from AI tests / workspace.aiTests
    (workspace?.aiTests || []).forEach((t) => {
      if (!t) return;
      (t.requests || []).forEach((r, idx) => {
        if (!r) return;
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
      badge: endpoints.length,
    },
    {
      id: "scenarios",
      label: "Test Scenarios",
      icon: FileCode,
      badge: overallStats.totalScenariosCount,
    },
    {
      id: "report",
      label: "Executive Report",
      icon: FileText,
      badge: "Audit",
      badgeColor: "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-semibold",
    },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg)] text-[var(--color-text)] font-sans select-text overflow-hidden">
      {/* ── 1. COMPACT STICKY COCKPIT HEADER ── */}
      <header className="shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] z-20 shadow-xs no-print relative">
        {refreshing && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--color-surface-secondary)] overflow-hidden z-30">
            <div className="h-full bg-[var(--color-primary)] animate-pulse w-full" />
          </div>
        )}
        {/* Top Control Bar */}
        <div className="px-5 py-2.5 flex flex-wrap items-center justify-between gap-3">
          {/* Left: Title & Live State Badge */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center">
              <Network size={15} />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-[var(--color-text)] tracking-tight m-0">
                Integration Test Cockpit
              </h1>
              <span className="px-2 py-0.5 rounded font-mono text-[10px] font-semibold bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                #{snapshotId?.substring(0, 8) || "active"}
              </span>
              {detectionInfo?.targetFramework && (
                <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-sky-500/10 text-sky-400 border border-sky-500/25">
                  {detectionInfo.targetFramework.toUpperCase()}
                </span>
              )}
              {/* Dynamic Health Pill */}
              {isJobActive ? (
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/25">
                  <Loader2 size={10} className="animate-spin" />
                  Running...
                </span>
              ) : failedScenariosList.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveTab("report")}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/25 cursor-pointer hover:bg-rose-500/20 transition-colors"
                >
                  <AlertTriangle size={10} />
                  {failedScenariosList.length} Failed
                </button>
              ) : overallStats.passedScenariosCount > 0 ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/25">
                  <CheckCircle2 size={10} />
                  {overallStats.passedScenariosCount} Passed
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                  Ready
                </span>
              )}
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* Run All Tests Button */}
            <button
              type="button"
              onClick={handleRunApprovedTests}
              disabled={!projectAccess.can("tests.run") || isJobActive || pendingAction === "RUN"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-xs disabled:opacity-50"
            >
              {pendingAction === "RUN" || (isJobActive && activeJobType === "EXECUTE") ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} fill="currentColor" />
              )}
              <span>
                {pendingAction === "RUN"
                  ? "Starting..."
                  : isJobActive && activeJobType === "EXECUTE"
                  ? "Running tests..."
                  : "Run All Tests"}
              </span>
            </button>

            {/* AI Test Generation Button */}
            <button
              type="button"
              onClick={() => handleGenerateClick()}
              disabled={!projectAccess.can("ai.use") || isJobActive || pendingAction === "GENERATE"}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              title="Generate additional API test scenarios using AI"
            >
              {pendingAction === "GENERATE" || (isJobActive && activeJobType === "GENERATE") ? (
                <Loader2 size={12} className="animate-spin text-[var(--color-primary)]" />
              ) : (
                <Zap size={12} className="text-[var(--color-primary)]" />
              )}
              <span>
                {pendingAction === "GENERATE" || (isJobActive && activeJobType === "GENERATE")
                  ? "Synthesizing..."
                  : "Generate AI Tests"}
              </span>
            </button>

            {/* AI Generation Telemetry Pill */}
            {(workspace?.generation?.telemetry || workspace?.aiTests?.[0]?.telemetry) && (
              <div
                className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[11px] font-mono text-[var(--color-text-secondary)] shadow-2xs"
                title={`Last API Test Generation: ${(workspace.generation?.telemetry || workspace.aiTests?.[0]?.telemetry)?.durationSeconds || 0}s, ${(workspace.generation?.telemetry || workspace.aiTests?.[0]?.telemetry)?.tokens?.total || 0} tokens`}
              >
                <Clock size={11} className="text-indigo-400" />
                <span>{((workspace.generation?.telemetry || workspace.aiTests?.[0]?.telemetry)?.durationSeconds || 0)}s</span>
                <span className="text-[var(--color-border)] opacity-60">•</span>
                <Zap size={11} className="text-amber-400" />
                <span>{((workspace.generation?.telemetry || workspace.aiTests?.[0]?.telemetry)?.tokens?.total || 0).toLocaleString()} tok</span>
              </div>
            )}

            <div className="h-4 w-px bg-[var(--color-border)] mx-0.5 hidden sm:block" />

            {/* Apply to Repo Button */}
            <button
              type="button"
              onClick={() => handleOpenApplyModal()}
              disabled={isJobActive}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium transition-colors cursor-pointer shadow-xs"
              title="Apply test suites to project repository"
            >
              <HardDriveDownload size={13} />
              <span className="hidden md:inline">Apply to Repo</span>
            </button>

            {/* Version History Drawer Button */}
            <button
              type="button"
              onClick={() => setDrawerOpen(drawerOpen ? null : "history")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium border transition-colors cursor-pointer shadow-xs ${
                drawerOpen
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30 font-semibold"
                  : "bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)]"
              }`}
              title="View execution history and before/after comparisons"
            >
              <Clock size={13} />
              <span className="hidden md:inline">History</span>
            </button>

            {/* Executive Report Button */}
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === "report" ? "endpoints" : "report")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium border transition-colors cursor-pointer shadow-xs ${
                activeTab === "report"
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-transparent font-semibold shadow-xs"
                  : "bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)]"
              }`}
              title="View full executive integration test report"
            >
              <FileText size={13} className={activeTab === "report" ? "text-current" : "text-[var(--color-primary)]"} />
              <span className="hidden md:inline">Report</span>
            </button>

            {/* Print / PDF Report Button */}
            <button
              type="button"
              onClick={() => window.print()}
              className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] transition-colors cursor-pointer shadow-xs"
              title="Print or export test report to PDF"
              aria-label="Export PDF"
            >
              <Printer size={13} />
            </button>
          </div>
        </div>

        {/* ── 2. HIGH-DENSITY COMPACT KPI SUMMARY BAR ── */}
        <div className="px-5 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/25">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {/* KPI 1: Scenarios Execution */}
            <div className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block">
                  Scenarios Run
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-base font-bold font-mono text-[var(--color-text)]">
                    {overallStats.passedScenariosCount}
                  </span>
                  <span className="text-xs font-mono text-[var(--color-text-muted)]">
                    / {overallStats.totalScenariosCount}
                  </span>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                overallStats.scenarioPassRate === 100 && overallStats.totalScenariosCount > 0
                  ? "bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/25"
                  : overallStats.failedScenariosCount > 0
                  ? "bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/25"
                  : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)]"
              }`}>
                {overallStats.totalScenariosCount > 0 ? `${overallStats.scenarioPassRate}% Pass` : "Unrun"}
              </span>
            </div>

            {/* KPI 2: Route Coverage */}
            <div className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block">
                  Endpoint Coverage
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-base font-bold font-mono text-[var(--color-primary)]">
                    {overallStats.apiCoverageRate}%
                  </span>
                  <span className="text-xs font-mono text-[var(--color-text-muted)]">
                    ({overallStats.testedApis}/{overallStats.totalApis} routes)
                  </span>
                </div>
              </div>
              <div className="w-12 bg-[var(--color-surface-secondary)] h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[var(--color-primary)] h-full transition-all duration-300"
                  style={{ width: `${overallStats.apiCoverageRate}%` }}
                />
              </div>
            </div>

            {/* KPI 3: Failure Diagnostics */}
            <div
              onClick={() => setActiveTab("report")}
              className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-between shadow-2xs cursor-pointer hover:border-[var(--color-primary)]/40 transition-colors"
              title="View 5-layer diagnostics and regression audit in Executive Report"
            >
              <div>
                <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block">
                  5-Layer Health
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className={`text-base font-bold font-mono ${
                    failedScenariosList.length === 0
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-danger)]"
                  }`}>
                    {failedScenariosList.length === 0 ? "0 Regressions" : `${failedScenariosList.length} Failures`}
                  </span>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                failedScenariosList.length === 0
                  ? "bg-emerald-500/10 text-[var(--color-success)]"
                  : "bg-rose-500/10 text-[var(--color-danger)]"
              }`}>
                {failedScenariosList.length === 0 ? "All Healthy" : "Review"}
              </span>
            </div>

            {/* KPI 4: Duration / Run Status */}
            <div className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider block">
                  Execution Time
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-base font-bold font-mono text-[var(--color-text)]">
                    {((execution?.durationMs || 0) / 1000).toFixed(1)}s
                  </span>
                  <span className="text-xs font-mono text-[var(--color-text-muted)] truncate max-w-[80px]">
                    {execution?.timestamp ? new Date(execution.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Never"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRunAnalysis}
                disabled={isJobActive || pendingAction === "ANALYZE"}
                className="text-[10px] text-[var(--color-primary)] hover:underline font-semibold cursor-pointer disabled:opacity-50 flex items-center gap-1"
                title="Rescan AST Structure"
              >
                {pendingAction === "ANALYZE" || (isJobActive && activeJobType === "ANALYZE") ? (
                  <>
                    <Loader2 size={9} className="animate-spin" />
                    <span>Scanning...</span>
                  </>
                ) : (
                  <span>Rescan AST</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── 3. SHADCN-STYLE WORKSPACE TABS ── */}
        <div className="px-5 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between overflow-x-auto custom-scrollbar">
          <div className="inline-flex items-center p-0.5 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs">
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
                  className={`relative flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-colors cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-focus)] ${
                    isActive
                      ? "text-[var(--color-primary)] font-semibold"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]/60"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-integration-tab-pill"
                      className="absolute inset-0 rounded-[var(--radius-sm)] bg-[var(--color-bg)] border border-[var(--color-border)] shadow-xs -z-0"
                      transition={{ type: "spring", stiffness: 450, damping: 32 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    {tab.pulsing ? (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    ) : (
                      <Icon
                        size={13}
                        className={isActive ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"}
                      />
                    )}
                    <span>{tab.label}</span>
                    {tab.badge != null && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                          tab.badgeColor ||
                          (isActive
                            ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                            : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)]")
                        }`}
                      >
                        {tab.badge}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] shrink-0 font-mono">
            {refreshing && (
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
        <IntegrationErrorBoundary onRetry={load}>
          {/* Modern Live Pipeline Progress Card (Active Execution & Analysis HUD) */}
          {isJobActive && (
            <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-primary)]/30 bg-[var(--color-surface)] shadow-xs overflow-hidden animate-in fade-in duration-200 no-print">
              <div className="px-4 py-3 bg-[var(--color-primary)]/5 border-b border-[var(--color-primary)]/15 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center shrink-0">
                    <Loader2 size={15} className="animate-spin" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[var(--color-text)]">
                        {activeJobType === "EXECUTE"
                          ? "Executing Integration Tests & API Coverage Analysis (Supertest Runner)..."
                          : activeJobType === "GENERATE"
                          ? "Analyzing Controllers & Synthesizing AI Test Scenarios..."
                          : "Scanning & Analyzing AST Route Architecture..."}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20">
                        Job #{activeJobId?.substring(0, 8) || "running"}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--color-text-secondary)] m-0 mt-0.5">
                      {activeJobType === "EXECUTE"
                        ? "Running test suite in an isolated runner environment and mapping reverse line coverage."
                        : "AI is analyzing controller flows and generating runnable test scenarios."}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1">
                    <Clock size={12} />
                    <span>{liveDurationText}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCancelActiveJob(activeJobId)}
                    disabled={isCancelling}
                    className="px-2.5 py-1 rounded-[var(--radius-sm)] bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/25 hover:bg-rose-500/20 text-xs font-medium cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {isCancelling ? "Canceling..." : "Cancel Task"}
                  </button>
                </div>
              </div>

              {/* Stepper Progress Bar */}
              <div className="p-3.5 bg-[var(--color-surface-secondary)]/25 space-y-3">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  {parseProgressSteps(activeJobType, activeLogs).map((st, i, arr) => (
                    <React.Fragment key={i}>
                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            st.done
                              ? "bg-emerald-500/15 text-[var(--color-success)] border border-emerald-500/30"
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
                        <ChevronRight size={12} className="text-[var(--color-border)] shrink-0 hidden sm:inline" />
                      )}
                    </React.Fragment>
                  ))}
                </div>

                {/* Collapsible live log stream toggle */}
                <div className="pt-1 border-t border-[var(--color-border)]/60 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setShowLiveLogsDetails((prev) => !prev)}
                    className="text-[11px] font-mono text-[var(--color-primary)] hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Terminal size={11} />
                    <span>
                      {showLiveLogsDetails ? "Hide console logs" : `View console logs (${activeLogs.length} lines)`}
                    </span>
                  </button>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                    Auto-syncing coverage results upon completion
                  </span>
                </div>

                {/* Collapsed Console Logs Stream */}
                {showLiveLogsDetails && (
                  <div className="p-3 bg-[#090D12] text-slate-300 font-mono text-[11px] max-h-48 overflow-y-auto custom-scrollbar rounded border border-[var(--color-border)]">
                    {activeLogs.length === 0 ? (
                      <div className="text-slate-500 italic">Waiting for runner events...</div>
                    ) : (
                      activeLogs.map((log, idx) => (
                        <div key={idx} className="leading-relaxed hover:bg-slate-800/40 px-1 rounded flex items-start gap-2">
                          <span className="text-slate-600 select-none text-[9px] w-6 shrink-0">{idx + 1}</span>
                          <span className="text-slate-300 break-all">
                            {typeof log.message === "string" ? log.message : JSON.stringify(log.message)}
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

          {/* Framework Setup Banner */}
          {detectionInfo &&
            (detectionInfo.isZeroTestProject ||
              detectionInfo.needsDependencyInstall) && (
              <div className="mb-4">
                <IntegrationFrameworkDetectionBanner
                  detectionInfo={detectionInfo}
                  onGenerateTests={handleGenerateByBannerFramework}
                  onInstallDependencies={handleInstallDependencies}
                  isInstalling={isInstallingDeps}
                  isGenerating={isGeneratingWithBanner}
                />
              </div>
            )}

          {/* TAB 1: ENDPOINTS MATRIX */}
          {activeTab === "endpoints" && (
            <div className="space-y-4">
              <IntegrationRouteMatrixTable
                endpoints={endpoints}
                hasExecuted={overallStats.hasExecuted}
                onRunEndpoint={handleRunEndpoint}
                onGenerateThisEndpoint={(key) => handleGenerateClick([key])}
                onOpenFile={onOpenFile}
                onViewScenarioCode={handleViewScenarioCode}
                onRetryScenario={handleRetryScenario}
                onAIFixScenario={handleAIFixScenario}
                isJobActive={isJobActive}
                pendingAction={pendingAction}
              />
            </div>
          )}

          {/* TAB 2: TEST SCENARIOS */}
          {activeTab === "scenarios" && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs p-4">
              <IntegrationScenariosPane
                readOnly={!projectAccess.can("files.write")}
                canGenerate={projectAccess.can("ai.use")}
                canApprove={projectAccess.can("evidence.approve")}
                aiTests={workspace?.aiTests || []}
                selectedEndpoint={null}
                onClearSelectedEndpoint={() => {}}
                hasGeneratedTests={
                  Boolean(
                    generation?.hasGeneratedTests ||
                    overallStats.totalScenariosCount > 0 ||
                    (endpoints || []).some((ep) => (ep.scenarios || []).length > 0) ||
                    (workspace?.aiTests || []).length > 0
                  )
                }
                hasAnalysis={generation?.hasAnalysis}
                onRunAnalysis={handleRunAnalysis}
                isApproved={Boolean(generation?.isApproved)}
                selectedTestIds={selectedTestIds}
                setSelectedTestIds={setSelectedTestIds}
                snapshotId={snapshotId}
                endpoints={endpoints}
                generationHistory={reportData?.history?.generations || []}
                executionHistory={reportData?.history?.executions || []}
                onOpenHistory={() => setDrawerOpen("history")}
                onOpenCFG={onOpenCFG}
                onSuggestTestcase={onSuggestTestcase}
                onOpenArchitecture={onOpenArchitecture}
                onScenarioChange={load}
                onError={setError}
                onGenerateThisEndpoint={(key) => handleGenerateClick([key])}
                onRunEndpoint={handleRunEndpoint}
                onRunScenario={handleRetryScenario}
                isRunningTests={
                  Boolean(
                    pendingAction === "RUN_ENDPOINT" ||
                    pendingAction === "RETRY_SCENARIO" ||
                    pendingAction === "RUN" ||
                    (activeJobId && activeJobType === "EXECUTE")
                  )
                }
                runningTargetKey={runningTargetKey}
                isGenerating={
                  pendingAction === "GENERATE" ||
                  (activeJobId && activeJobType === "GENERATE")
                }
                onApproveAndRun={async (ids) => {
                  if (!projectAccess.can("evidence.approve")) return;
                  setSelectedTestIds(ids);
                  if (workspace?.aiTests && workspace.aiTests.length > 0) {
                    try {
                      await approveIntegrationTestsApi(snapshotId, ids);
                    } catch (_) {}
                  }
                  await handleRunApprovedTests();
                }}
                isApprovingAndRunning={pendingAction === "RUN"}
                onOpenApplyModal={handleOpenApplyModal}
                onReGenerateSelected={(targets) =>
                  handleGenerateClick(targets)
                }
              />
            </div>
          )}

          {/* TAB 3: EXECUTIVE REPORT */}
          {activeTab === "report" && (
            <IntegrationReportEmbed
              projectId={projectId}
              snapshotId={snapshotId}
              report={reportData}
              workspace={workspace}
              endpoints={endpoints}
              onNavigateTab={setActiveTab}
              onGenerateEndpoint={(key) => handleGenerateClick([key])}
              loading={loading}
              onRefreshReport={load}
            />
          )}
        </IntegrationErrorBoundary>
      </div>

      {/* 3. SLIDE-OVER DRAWER (Version History & Before/After Diff) */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200 no-print">
          <div className="w-full max-w-2xl h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl flex flex-col overflow-hidden">
            {/* Drawer Header */}
            <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface)]">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-[var(--color-primary)]" />
                <h3 className="text-sm font-bold text-[var(--color-text)] m-0">
                  Version History & Diff
                </h3>
              </div>

              <div className="flex items-center gap-2">
                {/* Tabs */}
                <div className="flex items-center gap-1 bg-[var(--color-surface-secondary)] p-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-xs">
                  <button
                    type="button"
                    onClick={() => setDrawerOpen("history")}
                    className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                      drawerOpen === "history"
                        ? "bg-[var(--color-surface)] text-[var(--color-text)] font-bold shadow-xs border border-[var(--color-border)]"
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
                        ? "bg-[var(--color-surface)] text-[var(--color-text)] font-bold shadow-xs border border-[var(--color-border)]"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    Before / After Comparison
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setDrawerOpen(null)}
                  className="p-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] cursor-pointer"
                  title="Close (Esc)"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Drawer Content */}
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

      {/* 4. MODALS */}
      {/* View Test Scenario in Source Code Modal */}
      <SourceCodeViewerModal
        isOpen={sourceViewerOpen}
        onClose={() => setSourceViewerOpen(false)}
        projectId={projectId}
        snapshotId={snapshotId}
        fileOptions={sourceViewerOptions}
        onOpenFile={onOpenFile}
      />

      {/* Apply Tests to Source Code Modal */}
      <IntegrationApplyTestsModal
        isOpen={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
        snapshotId={snapshotId}
        testIds={applyModalTestIds}
        onTriggerRerun={() => {
          setApplyModalOpen(false);
          handleRunApprovedTests();
        }}
      />

      {/* Monaco Scenario Editor Modal */}
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
