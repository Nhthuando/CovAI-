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
} from "lucide-react";

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
    desc: "Đường dẫn Route hoặc URL mount point không khớp router Express.",
  },
  MIDDLEWARE_REJECTED: {
    label: "Middleware (401/403)",
    code: "[MIDDLEWARE_REJECTED]",
    style: "bg-amber-500/10 text-amber-400 border-amber-500/25",
    desc: "Bị chặn bởi Authentication, JWT token, CORS hoặc Request Validator.",
  },
  CONTROLLER_CRASH: {
    label: "Controller (500)",
    code: "[CONTROLLER_CRASH]",
    style: "bg-rose-500/10 text-rose-400 border-rose-500/25",
    desc: "Lỗi runtime crash (TypeError, ReferenceError) trong controller handler.",
  },
  DATABASE_FAILURE: {
    label: "Database / ORM",
    code: "[DATABASE_FAILURE]",
    style: "bg-purple-500/10 text-purple-400 border-purple-500/25",
    desc: "Lỗi kết nối database, schema constraint hoặc Prisma query failure.",
  },
  ASSERTION_FAILED: {
    label: "Assertion Mismatch",
    code: "[ASSERTION_FAILED]",
    style: "bg-sky-500/10 text-sky-400 border-sky-500/25",
    desc: "HTTP response status code hoặc JSON body không khớp với giá trị mong đợi.",
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
}) {
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
  const [drawerOpen, setDrawerOpen] = useState(null); // 'history' | 'compare' | null
  const [activeFailureLayerFilter, setActiveFailureLayerFilter] =
    useState("ALL");
  const [expandedCallstacks, setExpandedCallstacks] = useState({});

  // Active navigation anchor
  const [activeAnchor, setActiveAnchor] = useState("kpis");

  const scrollToSection = (id) => {
    setActiveAnchor(id);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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

        // Initialize selectedTestIds
        if (workspaceRes.value.data?.aiTests && selectedTestIds.length === 0) {
          const allIds = (workspaceRes.value.data.aiTests || []).flatMap((t) =>
            (t?.requests || []).map(
              (r) => `${t.id}::${r.scenarioId || r.testName}`,
            ),
          );
          setSelectedTestIds(allIds);
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
  }, [load]);

  const handleJobCanceled = useCallback(async () => {
    setActiveJobStatus("CANCELED");
    setCancellationNotice("Tác vụ đã được hủy bỏ thành công.");
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
  }, [load]);

  const handleCancelActiveJob = useCallback(
    async (targetJobId = null) => {
      const jId = targetJobId || activeJobId;
      if (!jId || isCancelling) return;
      setIsCancelling(true);
      setError("");
      try {
        await cancelJobApi(jId);
        setActiveJobStatus("CANCELED");
        setCancellationNotice("Tác vụ đã được hủy bỏ thành công.");
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
        setError(err.message || "Không thể hủy tác vụ. Vui lòng thử lại.");
        await load();
        setIsCancelling(false);
      }
    },
    [activeJobId, isCancelling, load],
  );

  const { logs: activeLogs } = useLiveJobLogs(
    activeJobId,
    handleJobComplete,
    (err) => {
      setActiveJobStatus("FAILED");
      setError(err.message);
      setIsCancelling(false);
    },
    handleJobCanceled,
  );

  // Install missing test libraries
  const handleInstallDependencies = async () => {
    if (!snapshotId || isInstallingDeps) return;
    setIsInstallingDeps(true);
    setError("");
    try {
      await installIntegrationDependencies(snapshotId);
      await load();
    } catch (err) {
      setError(err.message || "Cài đặt thư viện kiểm thử thất bại.");
    } finally {
      setIsInstallingDeps(false);
    }
  };

  // Generate tests via framework detection banner
  const handleGenerateByBannerFramework = async (targetFramework) => {
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
      }
    } catch (err) {
      setError(err.message || "Không thể sinh kiểm thử tự động.");
    } finally {
      setIsGeneratingWithBanner(false);
    }
  };

  // Run AST Project Analysis
  const handleRunAnalysis = async () => {
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
      setError(err.message || "Phân tích cấu trúc dự án thất bại.");
    } finally {
      setPendingAction(null);
    }
  };

  // Run AI Test Generator
  const handleGenerateClick = async (explicitTargets = null) => {
    if (
      !workspace?.generation?.hasAnalysis ||
      (activeJobId && activeJobStatus !== "FAILED")
    )
      return;
    setError("");
    setPendingAction("GENERATE");
    try {
      const res = await onGenerate(explicitTargets);
      if (res === undefined) return;
      const jobId = res?.data?.job?.id || res?.jobId;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("GENERATE");
        setActiveJobStatus("RUNNING");
      } else {
        await load();
      }
    } catch (err) {
      setError(err.message || "Sinh kịch bản kiểm thử thất bại.");
    } finally {
      setPendingAction(null);
    }
  };

  // Run All Approved Tests
  const handleRunApprovedTests = async () => {
    if (!snapshotId || pendingAction) return;
    if (
      activeJobId &&
      (activeJobStatus === "RUNNING" || activeJobStatus === "QUEUED")
    ) {
      setError("Một tác vụ kiểm thử đang được thực thi.");
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
      setError(err.message || "Khởi chạy kiểm thử tích hợp thất bại.");
    } finally {
      setPendingAction(null);
    }
  };

  // Run Specific Endpoint
  const handleRunEndpoint = async (ep) => {
    if (!snapshotId || pendingAction || !ep) return;
    const epScenarios = ep.scenarios || [];
    const scenarioIds = epScenarios
      .map((s) => s.id || `${s.testId}::${s.scenarioId || s.testName}`)
      .filter(Boolean);
    if (scenarioIds.length === 0) {
      setError(
        `Endpoint ${ep.method} ${ep.path} chưa có kịch bản kiểm thử nào.`,
      );
      return;
    }
    setError("");
    setPendingAction("RUN_ENDPOINT");
    try {
      await approveIntegrationTestsApi(snapshotId, scenarioIds);
      const response = await runCoverageByType(snapshotId, "integration");
      const jobId =
        response.data?.job?.id || response.data?.jobId || response.jobId;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
      }
    } catch (err) {
      setError(err.message || "Không thể thực thi kiểm thử cho endpoint này.");
    } finally {
      setPendingAction(null);
    }
  };

  // Retry Single Scenario
  const handleRetryScenario = async (ep, sc) => {
    if (!snapshotId || pendingAction || !sc) return;
    const scId = sc.id || `${sc.testId}::${sc.scenarioId || sc.testName}`;
    if (!scId) return;
    setError("");
    setPendingAction("RETRY_SCENARIO");
    try {
      await approveIntegrationTestsApi(snapshotId, [scId]);
      const response = await runCoverageByType(snapshotId, "integration");
      const jobId =
        response.data?.job?.id || response.data?.jobId || response.jobId;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
      }
    } catch (err) {
      setError(err.message || "Không thể chạy lại kịch bản này.");
    } finally {
      setPendingAction(null);
    }
  };

  // AI Booster Repair Scenario
  const handleAIFixScenario = async (ep, sc) => {
    if (!snapshotId || !sc) return;
    setError("");
    try {
      await regenerateIntegrationScenario(snapshotId, {
        scenarioId: sc.id || sc.scenarioId,
        framework: detectionInfo?.targetFramework || "supertest",
        failureContext: {
          failureLayer: sc.failureLayer,
          actualStatus: sc.actualStatus ?? sc.actualStatusFromRuntime,
          expectedStatus: sc.expectedStatus,
          errorMessage:
            (sc.failureMessages || []).join("\n") ||
            sc.failureDetails?.raw ||
            "",
        },
      });
      await load();
    } catch (err) {
      setError(err.message || "Không thể sửa kịch bản bằng AI.");
    }
  };

  // Open Apply Tests Modal
  const handleOpenApplyModal = (targetIds = null) => {
    const ids = targetIds && targetIds.length > 0 ? targetIds : selectedTestIds;
    setApplyModalTestIds(ids);
    setApplyModalOpen(true);
  };

  // Open Scenario Monaco Editor Modal
  const handleOpenEditScenario = (sc, ep = null) => {
    setEditorModalScenario(sc);
    setEditorModalEndpoint(ep);
    setIsAddScenarioMode(false);
    setEditorModalOpen(true);
  };

  const handleOpenAddScenario = (ep) => {
    setEditorModalScenario(null);
    setEditorModalEndpoint(ep);
    setIsAddScenarioMode(true);
    setEditorModalOpen(true);
  };

  const handleSaveScenario = async (savedData) => {
    if (!snapshotId) return;
    setError("");
    try {
      if (isAddScenarioMode) {
        // Add new scenario via API
        const targetEp = editorModalEndpoint;
        const res = await fetch(
          `${BASE_URL}/coverage/${snapshotId}/integration/scenarios`,
          {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({
              endpointId: `${targetEp?.method} ${targetEp?.path}`,
              title: savedData.name,
              category: savedData.category,
              expectedStatus: savedData.expectedStatus,
              code: savedData.code,
            }),
          },
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || "Thêm kịch bản thất bại.");
        }
      } else if (editorModalScenario) {
        const scId = editorModalScenario.id || editorModalScenario.scenarioId;
        await updateIntegrationScenario(snapshotId, scId, {
          title: savedData.name,
          category: savedData.category,
          expectedStatus: savedData.expectedStatus,
          code: savedData.code,
        });
      }
      setEditorModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message || "Lưu kịch bản thất bại.");
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
        { label: "Nạp snapshot dự án", done: true },
        {
          label: "Quét cấu trúc mã nguồn AST",
          done:
            hasStage("LOAD_SOURCE") ||
            textLogs.includes("Scanning") ||
            textLogs.includes("Analyzed"),
        },
        {
          label: "Nhận diện framework kiểm thử",
          done: hasStage("DETECT_ENDPOINTS") || textLogs.includes("Analyzed"),
        },
        {
          label: "Khám phá endpoint API Express/Node",
          done: hasStage("DETECT_ENDPOINTS") || textLogs.includes("Saving"),
        },
        {
          label: "Lập bản đồ phụ thuộc route/controller",
          done: hasStage("MAP_DEPENDENCIES") || textLogs.includes("Saving"),
        },
        {
          label: "Hoàn tất phân tích",
          done: hasStage("COMPLETE") || textLogs.includes("completed"),
        },
      ];
    } else if (jobType === "GENERATE") {
      return [
        {
          label: "Xây dựng AI context cho API",
          done:
            hasStage("BUILD_CONTEXT") || textLogs.includes("Calling Gemini"),
        },
        {
          label: "Sinh bộ test đa kịch bản với LLM",
          done:
            hasStage("GENERATE_AI_TESTS") ||
            textLogs.includes("Calling Gemini"),
        },
        {
          label: "Xác thực cú pháp & Jest assertions",
          done:
            hasStage("VALIDATE_SCENARIOS") ||
            textLogs.includes("Saved") ||
            textLogs.includes("Generated"),
        },
        {
          label: "Hoàn tất sinh kiểm thử",
          done: hasStage("COMPLETE") || activeJobStatus === "SUCCESS",
        },
      ];
    } else {
      return [
        { label: "Nạp danh sách kịch bản đã duyệt", done: true },
        {
          label: "Khởi tạo môi trường cô lập",
          done:
            hasStage("PREPARE_ENV") ||
            textLogs.includes("start") ||
            textLogs.includes("TestRun"),
        },
        {
          label: "Thực thi Jest & Supertest runner",
          done: hasStage("RUN_JEST") || textLogs.includes("TestRun"),
        },
        {
          label: "Bóc tách độ bao phủ API & Tracing",
          done: hasStage("PARSE_COVERAGE") || textLogs.includes("complete"),
        },
        {
          label: "Bóc tách 5 tầng lỗi & Báo cáo",
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

    // Collect deduplicated scenarios across endpoints to prevent duplicate counts
    const uniqueScenariosMap = new Map();

    endpoints.forEach((ep) => {
      const epScenarios = ep.scenarios || [];
      const hasTests = epScenarios.length > 0 || (ep.generatedCount || 0) > 0;
      if (hasTests) testedApis++;

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

      if (epFailed > 0) failedApis++;
      else if (epPassed > 0) passedApis++;

      epScenarios.forEach((sc) => {
        const key = sc.id || sc.scenarioId || sc.title;
        if (key && !uniqueScenariosMap.has(key)) {
          uniqueScenariosMap.set(key, sc);
        }
      });
    });

    const uncoveredApis = Math.max(0, totalApis - testedApis);
    const apiPassRate =
      testedApis > 0 ? Math.round((passedApis / testedApis) * 100) : 0;
    const apiCoverageRate =
      totalApis > 0 ? Math.round((testedApis / totalApis) * 100) : 0;

    const dedupedScenarios = Array.from(uniqueScenariosMap.values());
    const dedupPassed = dedupScenarios.filter(
      (s) =>
        s.status === "passed" ||
        s.rawJestStatus === "passed" ||
        s.executionVerdict === "PASS",
    ).length;
    const dedupFailed = dedupScenarios.filter(
      (s) =>
        s.status === "failed" ||
        s.rawJestStatus === "failed" ||
        s.executionVerdict === "FAIL",
    ).length;

    // Synchronize with authoritative test runner execution object if available
    const hasExecutionRun = Boolean(
      execution &&
      (execution.totalTests > 0 ||
        execution.passedTests > 0 ||
        execution.failedTests > 0),
    );
    const totalScenariosCount = hasExecutionRun
      ? execution.totalTests
      : dedupedScenarios.length > 0
        ? dedupedScenarios.length
        : generation?.generatedScenarios || 0;

    const passedScenariosCount = hasExecutionRun
      ? execution.passedTests
      : dedupPassed;

    const failedScenariosCount = hasExecutionRun
      ? execution.failedTests
      : dedupFailed;

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
  }, [endpoints, execution, generation]);

  // Loading State
  if (loading && !workspace) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-[var(--color-text)]">
        <div className="w-10 h-10 border-3 border-[var(--color-primary)]/20 border-t-[var(--color-primary)] rounded-full animate-spin mb-4" />
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">
          Đang nạp Integration Testing Workbench...
        </h3>
        <p className="text-xs text-[var(--color-text-secondary)] font-mono">
          Kết nối Snapshot #{snapshotId?.substring(0, 8)} • Quét ma trận API và
          kết quả kiểm thử
        </p>
      </div>
    );
  }

  // Empty Snapshot State
  if (!snapshotId && !workspace) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center text-[var(--color-text)]">
        <AlertTriangle size={36} className="text-[var(--color-warning)] mb-3" />
        <h3 className="text-base font-bold text-[var(--color-text)] mb-1">
          Chưa chọn Snapshot dự án
        </h3>
        <p className="text-xs text-[var(--color-text-secondary)] max-w-md mb-4 leading-relaxed">
          Vui lòng chọn một snapshot hợp lệ từ danh sách dự án trước khi sử dụng
          tính năng Kiểm thử Tích hợp API.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg)] text-[var(--color-text)] font-sans select-text overflow-hidden">
      {/* 1. TOP STICKY COCKPIT HEADER */}
      <header className="shrink-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] z-20 shadow-xs no-print">
        {/* Main Header Row */}
        <div className="px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          {/* Left: Title & Metadata Badge */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center">
              <Layers size={18} />
            </div>
            <div>
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
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)] font-mono m-0 mt-0.5">
                Kiểm thử tích hợp API endpoint tự động • Trực quan hóa độ bao
                phủ & Chẩn đoán 5 tầng lỗi
              </p>
            </div>
          </div>

          {/* Right: Primary Command Buttons */}
          <div className="flex items-center gap-2">
            {/* Run All Tests */}
            <button
              type="button"
              onClick={handleRunApprovedTests}
              disabled={isJobActive || pendingAction === "RUN"}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Play size={13} fill="currentColor" />
              <span>
                {isJobActive && activeJobType === "EXECUTE"
                  ? "Đang chạy test..."
                  : "Chạy tất cả test"}
              </span>
            </button>

            {/* AI Test Generation */}
            <button
              type="button"
              onClick={() => handleGenerateClick()}
              disabled={isJobActive || pendingAction === "GENERATE"}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              title="Sinh thêm kịch bản API test bằng AI"
            >
              <Zap size={13} className="text-[var(--color-primary)]" />
              <span>Sinh test AI</span>
            </button>

            {/* Apply to Repo */}
            <button
              type="button"
              onClick={() => handleOpenApplyModal()}
              disabled={isJobActive}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold transition-colors cursor-pointer shadow-xs"
              title="Ghi các kịch bản test vào file trong thư mục dự án"
            >
              <HardDriveDownload size={13} />
              <span>Áp dụng vào Repo</span>
            </button>

            {/* Print / PDF Report */}
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold transition-colors cursor-pointer shadow-xs"
              title="In hoặc xuất file PDF báo cáo này"
            >
              <Printer size={13} />
              <span>In PDF</span>
            </button>

            {/* Version History & Diff Drawer Toggle */}
            <button
              type="button"
              onClick={() => setDrawerOpen(drawerOpen ? null : "history")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold border transition-colors cursor-pointer shadow-xs ${
                drawerOpen
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30"
                  : "bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)]"
              }`}
              title="Xem lịch sử các lần chạy và so sánh phiên bản Trước/Sau"
            >
              <Clock size={13} />
              <span>Lịch sử & So sánh</span>
            </button>
          </div>
        </div>

        {/* Anchor Quick-Jump Strip */}
        <div className="px-6 py-1.5 border-t border-[var(--color-border)]/60 bg-[var(--color-surface-secondary)]/30 flex items-center justify-between overflow-x-auto custom-scrollbar">
          <div className="flex items-center gap-1 text-xs">
            <span className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider mr-2 shrink-0">
              Chuyển nhanh:
            </span>

            {[
              { id: "section-kpis", label: "Tổng quan & KPIs" },
              ...(detectionInfo?.isZeroTestProject ||
              detectionInfo?.needsDependencyInstall
                ? [
                    {
                      id: "section-framework",
                      label: "Cài đặt & Thư viện",
                      alert: true,
                    },
                  ]
                : []),
              {
                id: "section-execution",
                label: "Thực thi & Logs",
                pulsing: isJobActive,
              },
              {
                id: "section-failures",
                label: "Chẩn đoán lỗi (5 Tầng)",
                badge: failedScenariosList.length,
                badgeColor: "bg-rose-500/20 text-[var(--color-danger)]",
              },
              {
                id: "section-matrix",
                label: "Ma trận API Endpoints",
                count: endpoints.length,
              },
              { id: "section-scenarios", label: "Kịch bản Test & Monaco" },
              { id: "section-report", label: "Báo cáo Tích hợp & In ấn" },
            ].map((nav) => {
              const isActive = activeAnchor === nav.id;
              return (
                <button
                  key={nav.id}
                  type="button"
                  onClick={() => scrollToSection(nav.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    isActive
                      ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-bold border border-[var(--color-primary)]/30"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
                  }`}
                >
                  {nav.pulsing && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                  <span>{nav.label}</span>
                  {nav.badge != null && nav.badge > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${nav.badgeColor}`}
                    >
                      {nav.badge}
                    </span>
                  )}
                  {nav.count != null && (
                    <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                      ({nav.count})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] shrink-0 font-mono">
            {refreshing && (
              <span className="flex items-center gap-1 text-[var(--color-primary)]">
                <RefreshCw size={11} className="animate-spin" /> Đang đồng bộ...
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Cancellation Notice Banner */}
      {cancellationNotice && (
        <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-xs text-[var(--color-warning)] flex items-center justify-between no-print">
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
        <div className="px-6 py-2.5 bg-rose-500/10 border-b border-rose-500/20 text-xs text-[var(--color-danger)] flex items-center justify-between no-print">
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

      {/* 2. MAIN SCROLLABLE DASHBOARD VIEW */}
      <div className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth px-6 py-6 space-y-8">
        <IntegrationErrorBoundary onRetry={load}>
          {/* SECTION 1: Framework Detection & Auto-Setup Banner */}
          {detectionInfo &&
            (detectionInfo.isZeroTestProject ||
              detectionInfo.needsDependencyInstall) && (
              <section id="section-framework" className="scroll-mt-24">
                <IntegrationFrameworkDetectionBanner
                  detectionInfo={detectionInfo}
                  onGenerateTests={handleGenerateByBannerFramework}
                  onInstallDependencies={handleInstallDependencies}
                  isInstalling={isInstallingDeps}
                  isGenerating={isGeneratingWithBanner}
                />
              </section>
            )}

          {/* SECTION 2: High-Density Metric Overview Cards */}
          <section id="section-kpis" className="scroll-mt-24 space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {/* Card 1: API Pass Rate */}
              <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                    API Pass Rate
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-2xl font-bold font-mono ${overallStats.apiPassRate >= 80 ? "text-[var(--color-success)]" : overallStats.apiPassRate > 0 ? "text-amber-400" : "text-[var(--color-text-muted)]"}`}
                    >
                      {overallStats.apiPassRate}%
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)] font-mono">
                      ({overallStats.passedApis}/{overallStats.testedApis}{" "}
                      tested APIs)
                    </span>
                  </div>
                </div>
                <div className="text-[10px] text-[var(--color-text-secondary)] mt-2">
                  Tỉ lệ endpoint API vượt qua 100% kịch bản kiểm thử
                </div>
              </div>

              {/* Card 2: API Coverage */}
              <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                    API Endpoint Coverage
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold font-mono text-[var(--color-primary)]">
                      {overallStats.apiCoverageRate}%
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)] font-mono">
                      ({overallStats.testedApis}/{overallStats.totalApis}{" "}
                      routes)
                    </span>
                  </div>
                </div>
                <div className="w-full bg-[var(--color-surface-secondary)] h-1.5 rounded-full overflow-hidden mt-2">
                  <div
                    className="bg-[var(--color-primary)] h-full transition-all duration-300"
                    style={{ width: `${overallStats.apiCoverageRate}%` }}
                  />
                </div>
              </div>

              {/* Card 3: Uncovered API Endpoints */}
              <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                    Uncovered API Endpoints
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-2xl font-bold font-mono ${overallStats.uncoveredApis > 0 ? "text-amber-400" : "text-[var(--color-success)]"}`}
                    >
                      {overallStats.uncoveredApis}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)] font-mono">
                      / {overallStats.totalApis} endpoints
                    </span>
                  </div>
                </div>
                <div className="text-[10px] text-[var(--color-text-secondary)] mt-2 flex items-center justify-between">
                  <span>Chưa có kịch bản test</span>
                  {overallStats.uncoveredApis > 0 && (
                    <button
                      type="button"
                      onClick={() => handleGenerateClick()}
                      className="text-[var(--color-primary)] hover:underline font-semibold cursor-pointer"
                    >
                      + Sinh test AI
                    </button>
                  )}
                </div>
              </div>

              {/* Card 4: Endpoint Status Triage */}
              <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                    Endpoint Status Triage
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1 font-mono text-xs">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/20 font-bold">
                      ✓ {overallStats.passedApis} Passed
                    </span>
                    <span className="px-2 py-0.5 rounded bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/20 font-bold">
                      ✗ {overallStats.failedApis} Failed
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)] font-semibold">
                      ○ {overallStats.uncoveredApis} Uncovered
                    </span>
                  </div>
                </div>
                <div className="text-[10px] text-[var(--color-text-secondary)] mt-2">
                  Phân loại trạng thái kiểm thử theo từng route
                </div>
              </div>
            </div>

            {/* Compact Execution Summary Bar */}
            <div className="border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)] overflow-hidden shadow-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-x divide-y sm:divide-y-0 divide-[var(--color-border)] text-center text-xs">
                <div className="p-2.5">
                  <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider">
                    Tổng kịch bản
                  </div>
                  <div className="text-base font-bold font-mono text-[var(--color-text)] mt-0.5">
                    {overallStats.totalScenariosCount}
                  </div>
                </div>
                <div className="p-2.5 bg-emerald-500/5">
                  <div className="text-[10px] uppercase font-bold text-[var(--color-success)] tracking-wider">
                    Passed
                  </div>
                  <div className="text-base font-bold font-mono text-[var(--color-success)] mt-0.5">
                    {overallStats.passedScenariosCount}
                  </div>
                </div>
                <div
                  className={`p-2.5 ${overallStats.failedScenariosCount > 0 ? "bg-rose-500/10" : ""}`}
                >
                  <div
                    className={`text-[10px] uppercase font-bold tracking-wider ${overallStats.failedScenariosCount > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}
                  >
                    Failed
                  </div>
                  <div
                    className={`text-base font-bold font-mono ${overallStats.failedScenariosCount > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"} mt-0.5`}
                  >
                    {overallStats.failedScenariosCount}
                  </div>
                </div>
                <div className="p-2.5">
                  <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider">
                    Skipped
                  </div>
                  <div className="text-base font-bold font-mono text-[var(--color-text-secondary)] mt-0.5">
                    {execution?.skippedTests || 0}
                  </div>
                </div>
                <div className="p-2.5">
                  <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider">
                    Pass Rate
                  </div>
                  <div
                    className={`text-base font-bold font-mono ${overallStats.scenarioPassRate >= 80 ? "text-[var(--color-success)]" : overallStats.scenarioPassRate > 0 ? "text-amber-400" : "text-[var(--color-text-muted)]"} mt-0.5`}
                  >
                    {overallStats.scenarioPassRate}%
                  </div>
                </div>
                <div className="p-2.5">
                  <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider">
                    Độ bao phủ
                  </div>
                  <div className="text-base font-bold font-mono text-[var(--color-text)] mt-0.5">
                    {overallStats.scenarioCoverageRate}%
                  </div>
                </div>
                <div className="p-2.5">
                  <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider">
                    Thời lượng
                  </div>
                  <div className="text-base font-bold font-mono text-[var(--color-text)] mt-0.5">
                    {((execution?.durationMs || 0) / 1000).toFixed(1)}s
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 3: Live Execution Pipeline & Terminal Logs */}
          <section id="section-execution" className="scroll-mt-24">
            {isJobActive ? (
              <div className="rounded-[var(--radius-md)] border border-sky-500/30 bg-[var(--color-surface)] shadow-xs overflow-hidden">
                <div className="px-4 py-3 bg-sky-500/10 border-b border-sky-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <RefreshCw
                      size={16}
                      className="animate-spin text-sky-400"
                    />
                    <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                      Tác Vụ Đang Thực Thi:{" "}
                      {activeJobType === "ANALYZE"
                        ? "Phân tích dự án"
                        : activeJobType === "GENERATE"
                          ? "Sinh kiểm thử AI"
                          : "Chạy bộ kiểm thử"}
                    </span>
                    <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                      Job #{activeJobId?.substring(0, 8)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCancelActiveJob(activeJobId)}
                    disabled={isCancelling}
                    className="px-3 py-1 rounded bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/30 hover:bg-rose-500/20 text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {isCancelling ? "Đang hủy..." : "Hủy tác vụ"}
                  </button>
                </div>

                {/* Pipeline Steps Tracker */}
                <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30">
                  <div className="flex flex-wrap items-center gap-2">
                    {parseProgressSteps(activeJobType, activeLogs).map(
                      (st, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-medium ${
                              st.done
                                ? "bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/25"
                                : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                            }`}
                          >
                            {st.done ? (
                              <CheckCircle2 size={13} />
                            ) : (
                              <span className="w-2 h-2 rounded-full border border-current animate-pulse" />
                            )}
                            <span>{st.label}</span>
                          </span>
                          {i <
                            parseProgressSteps(activeJobType, activeLogs)
                              .length -
                              1 && (
                            <ChevronRight
                              size={13}
                              className="text-[var(--color-border)]"
                            />
                          )}
                        </div>
                      ),
                    )}
                  </div>
                </div>

                {/* Terminal Console Logs */}
                <div className="p-4 bg-[#090D12] text-slate-300 font-mono text-xs max-h-64 overflow-y-auto custom-scrollbar">
                  {activeLogs.length === 0 ? (
                    <div className="text-slate-500 italic">
                      Đang thiết lập kết nối luồng sự kiện SSE...
                    </div>
                  ) : (
                    activeLogs.map((log, idx) => (
                      <div
                        key={idx}
                        className="leading-relaxed hover:bg-slate-800/40 px-1 rounded flex items-start gap-2"
                      >
                        <span className="text-slate-600 select-none text-[10px] w-8 shrink-0">
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
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-[var(--color-success)] flex items-center justify-center">
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[var(--color-text)]">
                      Hệ Thống Sẵn Sàng Thực Thi Kiểm Thử
                    </div>
                    <div className="text-[11px] text-[var(--color-text-secondary)] font-mono mt-0.5">
                      Lần chạy gần nhất:{" "}
                      {execution?.timestamp
                        ? new Date(execution.timestamp).toLocaleTimeString()
                        : overallStats.passedScenariosCount > 0 ||
                            overallStats.failedScenariosCount > 0
                          ? "Vừa hoàn tất"
                          : "Chưa chạy"}{" "}
                      • {overallStats.totalScenariosCount} tests (
                      {overallStats.passedScenariosCount} pass,{" "}
                      {overallStats.failedScenariosCount} fail)
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRunAnalysis}
                    className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Quét lại cấu trúc AST
                  </button>
                  <button
                    type="button"
                    onClick={handleRunApprovedTests}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                  >
                    <Play size={12} fill="currentColor" />
                    <span>Chạy lại kiểm thử ngay</span>
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 4: Failure Inspector (Chẩn Đoán 5 Tầng Lỗi) */}
          <section id="section-failures" className="scroll-mt-24">
            {failedScenariosList.length > 0 ? (
              <div className="rounded-[var(--radius-md)] border border-rose-500/30 bg-[var(--color-surface)] shadow-xs overflow-hidden">
                {/* Failure Header */}
                <div className="px-4 py-3 bg-rose-500/10 border-b border-rose-500/20 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      size={18}
                      className="text-[var(--color-danger)]"
                    />
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-danger)] m-0">
                        Chẩn Đoán 5 Tầng Lỗi ({failedScenariosList.length} Thất
                        bại)
                      </h3>
                      <p className="text-[11px] text-[var(--color-text-secondary)] m-0 mt-0.5">
                        Phân tầng Router, Middleware, Controller, Database và
                        Assertion kèm vị trí dòng mã gãy
                      </p>
                    </div>
                  </div>

                  {/* Filter by failure layer */}
                  <div className="flex items-center gap-1 font-mono text-[11px] bg-[var(--color-surface)] p-0.5 rounded border border-[var(--color-border)]">
                    <button
                      type="button"
                      onClick={() => setActiveFailureLayerFilter("ALL")}
                      className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                        activeFailureLayerFilter === "ALL"
                          ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-bold"
                          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                      }`}
                    >
                      Tất cả ({failedScenariosList.length})
                    </button>
                    {Object.entries(FAILURE_LAYERS_META).map(
                      ([layerKey, meta]) => {
                        const count = failedScenariosList.filter(
                          (f) => f.layer === layerKey,
                        ).length;
                        if (count === 0) return null;
                        return (
                          <button
                            key={layerKey}
                            type="button"
                            onClick={() =>
                              setActiveFailureLayerFilter(layerKey)
                            }
                            className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                              activeFailureLayerFilter === layerKey
                                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-bold"
                                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                            }`}
                          >
                            {meta.label} ({count})
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>

                {/* Failure Cards List */}
                <div className="divide-y divide-[var(--color-border)]">
                  {filteredFailures.map(
                    ({ endpoint: ep, scenario: sc, layer, key }) => {
                      const layerMeta =
                        FAILURE_LAYERS_META[layer] ||
                        FAILURE_LAYERS_META.ASSERTION_FAILED;
                      const methodClass =
                        METHOD_STYLES[ep.method] || METHOD_STYLES.DEFAULT;
                      const actualHttp =
                        sc.actualStatus ??
                        sc.actualStatusFromRuntime ??
                        (sc.failureDetails?.received &&
                        /^\d{3}$/.test(
                          String(sc.failureDetails.received).trim(),
                        )
                          ? Number(sc.failureDetails.received)
                          : 500);
                      const expectedHttp =
                        sc.expectedStatus ??
                        (sc.failureDetails?.expected &&
                        /^\d{3}$/.test(
                          String(sc.failureDetails.expected).trim(),
                        )
                          ? Number(sc.failureDetails.expected)
                          : 200);
                      const failDetails = sc.failureDetails || {};
                      const isCallstackOpen = Boolean(expandedCallstacks[key]);

                      return (
                        <div
                          key={key}
                          className="p-4 space-y-3 bg-[var(--color-surface)]"
                        >
                          {/* Title Bar */}
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span
                                className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border tracking-tight ${methodClass}`}
                              >
                                {ep.method}
                              </span>
                              <span className="font-mono text-xs font-semibold text-[var(--color-text)]">
                                {ep.path}
                              </span>
                              <span className="text-[var(--color-text-muted)]">
                                •
                              </span>
                              <span className="text-xs font-medium text-[var(--color-text)] truncate max-w-sm">
                                {sc.title}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${layerMeta.style}`}
                              >
                                {layerMeta.code}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleAIFixScenario(ep, sc)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                                title="Tự động sửa kịch bản bằng AI"
                              >
                                <Zap size={12} />
                                <span>Sửa bằng AI</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRetryScenario(ep, sc)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-xs font-semibold transition-colors cursor-pointer"
                                title="Chạy lại kịch bản này"
                              >
                                <Play size={11} fill="currentColor" />
                                <span>Chạy lại</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEditScenario(sc, ep)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-xs font-semibold transition-colors cursor-pointer"
                                title="Mở trình soạn thảo Monaco Editor"
                              >
                                <Code2 size={12} />
                                <span>Sửa Monaco</span>
                              </button>
                            </div>
                          </div>

                          {/* Expected vs Actual Status Banner */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div className="p-2.5 rounded bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)]">
                              <span className="text-[10px] font-semibold text-[var(--color-text-secondary)]">
                                HTTP Status Mong Đợi (Expected):
                              </span>
                              <div className="font-mono font-bold text-xs text-[var(--color-success)] mt-0.5">
                                HTTP {expectedHttp}
                              </div>
                            </div>
                            <div className="p-2.5 rounded bg-rose-500/5 border border-rose-500/20">
                              <span className="text-[10px] font-semibold text-[var(--color-danger)]">
                                HTTP Status Thực Tế (Received):
                              </span>
                              <div className="font-mono font-bold text-xs text-[var(--color-danger)] mt-0.5">
                                HTTP {actualHttp}
                              </div>
                            </div>
                          </div>

                          {/* Code Frame with line highlight */}
                          {failDetails.codeFrame && (
                            <div className="rounded border border-[var(--color-border)] bg-[#0B0F14] text-slate-300 font-mono text-[11px] p-3 overflow-x-auto custom-scrollbar">
                              <div className="text-[10px] text-slate-500 mb-1">
                                File:{" "}
                                {failDetails.file
                                  ? failDetails.file
                                      .split(/[\\/]/)
                                      .slice(-2)
                                      .join("/")
                                  : "test"}
                                :{failDetails.line || 1}
                              </div>
                              <pre className="whitespace-pre-wrap text-rose-300 leading-relaxed m-0">
                                {failDetails.codeFrame}
                              </pre>
                            </div>
                          )}

                          {/* Error Message & Callstack */}
                          <div className="text-xs">
                            <button
                              type="button"
                              onClick={() => toggleCallstack(key)}
                              className="text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text)] inline-flex items-center gap-1 cursor-pointer"
                            >
                              {isCallstackOpen ? (
                                <ChevronDown size={12} />
                              ) : (
                                <ChevronRight size={12} />
                              )}
                              <span>
                                {isCallstackOpen
                                  ? "Ẩn callstack chi tiết"
                                  : "Xem callstack lỗi chi tiết"}
                              </span>
                            </button>

                            {isCallstackOpen && (
                              <div className="mt-2 p-3 rounded bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)] font-mono text-[11px] text-rose-400 whitespace-pre-wrap overflow-x-auto max-h-48 custom-scrollbar">
                                {(sc.failureMessages || []).join("\n") ||
                                  failDetails.raw ||
                                  "Không có thông tin callstack chi tiết."}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-[var(--radius-md)] border border-emerald-500/30 bg-emerald-500/5 flex items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/15 text-[var(--color-success)] flex items-center justify-center">
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-[var(--color-success)] uppercase tracking-wider m-0">
                      Không Có Lỗi Phát Sinh (Zero Failures)
                    </h4>
                    <p className="text-[11px] text-[var(--color-text-secondary)] m-0 mt-0.5">
                      Toàn bộ {overallStats.passedScenariosCount} kịch bản đã
                      thực thi đều vượt qua bài kiểm tra thành công!
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 5: Route Coverage Matrix Table */}
          <section id="section-matrix" className="scroll-mt-24">
            <IntegrationRouteMatrixTable
              endpoints={endpoints}
              onRunEndpoint={handleRunEndpoint}
              onGenerateThisEndpoint={(key) => handleGenerateClick([key])}
              onOpenFile={onOpenFile}
              onAddScenario={handleOpenAddScenario}
              onEditScenario={handleOpenEditScenario}
              onRetryScenario={handleRetryScenario}
              onAIFixScenario={handleAIFixScenario}
              isJobActive={isJobActive}
              pendingAction={pendingAction}
            />
          </section>

          {/* SECTION 6: Test Scenarios Management & Monaco Editor */}
          <section id="section-scenarios" className="scroll-mt-24">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs overflow-hidden">
              <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
                    Bộ Kịch Bản Test (Test Scenarios Suite)
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)] m-0 mt-0.5">
                    Quản lý danh sách test case, lọc theo danh mục, chỉnh sửa mã
                    nguồn Monaco và áp dụng vào dự án
                  </p>
                </div>
              </div>

              <div className="p-4">
                <IntegrationScenariosPane
                  aiTests={workspace?.aiTests || []}
                  selectedEndpoint={null}
                  onClearSelectedEndpoint={() => {}}
                  hasGeneratedTests={generation?.hasGeneratedTests}
                  hasAnalysis={generation?.hasAnalysis}
                  onRunAnalysis={handleRunAnalysis}
                  isApproved={Boolean(generation?.isApproved)}
                  selectedTestIds={selectedTestIds}
                  setSelectedTestIds={setSelectedTestIds}
                  snapshotId={snapshotId}
                  endpoints={endpoints}
                  onOpenCFG={onOpenCFG}
                  onSuggestTestcase={onSuggestTestcase}
                  onOpenArchitecture={onOpenArchitecture}
                  onScenarioChange={load}
                  onError={setError}
                  onGenerateThisEndpoint={(key) => handleGenerateClick([key])}
                  isGenerating={
                    pendingAction === "GENERATE" ||
                    (activeJobId && activeJobType === "GENERATE")
                  }
                  onApproveAndRun={async (ids) => {
                    setSelectedTestIds(ids);
                    await approveIntegrationTestsApi(snapshotId, ids);
                    await handleRunApprovedTests();
                  }}
                  isApprovingAndRunning={pendingAction === "RUN"}
                  onOpenApplyModal={handleOpenApplyModal}
                  onReGenerateSelected={(targets) =>
                    handleGenerateClick(targets)
                  }
                />
              </div>
            </div>
          </section>

          {/* SECTION 7: Comprehensive Embedded Report & PDF Print */}
          <section id="section-report" className="scroll-mt-24">
            <IntegrationReportEmbed
              projectId={projectId}
              snapshotId={snapshotId}
              report={reportData}
              workspace={workspace}
              loading={loading}
              onRefreshReport={load}
            />
          </section>
        </IntegrationErrorBoundary>
      </div>

      {/* 3. SLIDE-OVER DRAWER (Lịch Sử Phiên Bản & So Sánh Trước/Sau) */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200 no-print">
          <div className="w-full max-w-2xl h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl flex flex-col overflow-hidden">
            {/* Drawer Header */}
            <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface)]">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-[var(--color-primary)]" />
                <h3 className="text-sm font-bold text-[var(--color-text)] m-0">
                  Lịch Sử Phiên Bản & So Sánh
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
                    Lịch sử Snapshots
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
                    So sánh Before / After
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setDrawerOpen(null)}
                  className="p-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] cursor-pointer"
                  title="Đóng (Esc)"
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
            ? `Thêm kịch bản cho ${editorModalEndpoint.method} ${editorModalEndpoint.path}`
            : "Soạn thảo kịch bản")
        }
        targetEndpoint={editorModalEndpoint}
        availableEndpoints={endpoints}
        isAddMode={isAddScenarioMode}
      />
    </div>
  );
}
