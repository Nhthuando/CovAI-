import React, { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  getIntegrationWorkspace,
  runCoverageByType,
} from "../../services/coverage.service.js";
import { runProjectStructureAnalysisApi } from "../../services/project.service.js";
import { cancelJobApi } from "../../services/job.service.js";
import { Search, Zap, CheckCircle2, PlayCircle, BarChart3, ChevronRight, Play, ChevronDown, Clock, AlertTriangle, RefreshCw, X, GitCompare } from "lucide-react";

import IntegrationTargetsPane from "./integration/IntegrationTargetsPane.jsx";
import IntegrationScenariosPane from "./integration/IntegrationScenariosPane.jsx";
import IntegrationLiveProgress from "./integration/IntegrationLiveProgress.jsx";
import IntegrationHistoryPane from "./integration/IntegrationHistoryPane.jsx";
import BeforeAfterComparisonView from "./integration/BeforeAfterComparisonView.jsx";
import MetricProvenancePopover from "./integration/MetricProvenancePopover.jsx";
import IntegrationEndpointDetail from "./integration/IntegrationEndpointDetail.jsx";
import IntegrationErrorBoundary from "./integration/IntegrationErrorBoundary.jsx";
import IntegrationAnalysisOverview from "./integration/IntegrationAnalysisOverview.jsx";
import IntegrationRunResultsPane from "./integration/IntegrationRunResultsPane.jsx";
import IntegrationFrameworkDetectionBanner from "./integration/IntegrationFrameworkDetectionBanner.jsx";
import IntegrationApplyTestsModal from "./integration/IntegrationApplyTestsModal.jsx";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const token = localStorage.getItem("token");
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

const buttonStyle = (color, isActive = false) => ({
  background: isActive ? `color-mix(in srgb, ${color} 22%, transparent)` : `color-mix(in srgb, ${color} 10%, transparent)`,
  color,
  border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
  borderRadius: "var(--radius-md)",
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.15s ease",
});

const disabledButtonStyle = {
  background: "var(--color-surface-secondary)",
  color: "var(--color-text-disabled)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "not-allowed",
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
  onContextChange
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [workspace, setWorkspace] = useState(() => {
    return (initialContext && initialContext.snapshotId === snapshotId && initialContext.projectId === projectId)
      ? (initialContext.cachedWorkspace || null)
      : null;
  });
  const [loading, setLoading] = useState(!workspace);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Active Jobs State
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeJobType, setActiveJobType] = useState(null);
  const [activeJobStatus, setActiveJobStatus] = useState("RUNNING");
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationNotice, setCancellationNotice] = useState("");
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [detectionInfo, setDetectionInfo] = useState(null);
  const [isInstallingDeps, setIsInstallingDeps] = useState(false);
  const [isGeneratingWithBanner, setIsGeneratingWithBanner] = useState(false);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [applyModalTestIds, setApplyModalTestIds] = useState([]);

  // UI View State
  const [selectedEndpointId, setSelectedEndpointId] = useState(() => {
    return (initialContext && initialContext.snapshotId === snapshotId) 
      ? (initialContext.selectedEndpointId ?? null) 
      : null;
  });
  const [activeStage, setActiveStage] = useState(() => {
    const params = new URLSearchParams(location.search);
    const s = params.get("stage") || "ANALYZE";
    return s === "APPROVE" ? "GENERATE" : s;
  });
  const [pendingAction, setPendingAction] = useState(null);
  const [selectedTargetEndpoints, setSelectedTargetEndpoints] = useState(new Set());
  const [expandedScenarios, setExpandedScenarios] = useState({});
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(false);
  const [activeScopeFilter, setActiveScopeFilter] = useState({ type: "ALL", value: null });

  const toggleExpandScenario = (scenarioKey) => {
    setExpandedScenarios((prev) => ({
      ...prev,
      [scenarioKey]: !prev[scenarioKey]
    }));
  };

  const handleToggleSelectEndpoint = (endpointKey) => {
    setSelectedTargetEndpoints((prev) => {
      const next = new Set(prev);
      if (next.has(endpointKey)) {
        next.delete(endpointKey);
      } else {
        next.add(endpointKey);
      }
      return next;
    });
  };

  const handleToggleSelectModule = (moduleEndpoints) => {
    setSelectedTargetEndpoints((prev) => {
      const next = new Set(prev);
      const allSelected = moduleEndpoints.every((ep) => next.has(`${ep.method} ${ep.path}`));
      if (allSelected) {
        moduleEndpoints.forEach((ep) => next.delete(`${ep.method} ${ep.path}`));
      } else {
        moduleEndpoints.forEach((ep) => next.add(`${ep.method} ${ep.path}`));
      }
      return next;
    });
  };

  const handleSelectAllEndpoints = (allList) => {
    setSelectedTargetEndpoints(new Set(allList.map((ep) => `${ep.method} ${ep.path}`)));
  };

  const handleClearSelectedEndpoints = () => {
    setSelectedTargetEndpoints(new Set());
  };

  // 1. Sync context upwards when it changes
  useEffect(() => {
    if (onContextChange && snapshotId && projectId) {
      onContextChange({
        snapshotId,
        projectId,
        activeStage,
        selectedEndpointId,
        cachedWorkspace: workspace
      });
    }
  }, [activeStage, selectedEndpointId, snapshotId, projectId, workspace, onContextChange]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("stage") !== activeStage) {
      params.set("stage", activeStage);
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    }
  }, [activeStage, navigate, location.search, location.pathname]);


  // 3. Fallback safely if selected endpoint id is out of bounds
  useEffect(() => {
    if (workspace?.endpoints && selectedEndpointId !== null) {
      const exists = workspace.endpoints.some(e => `${e.method} ${e.path}` === selectedEndpointId);
      if (!exists) {
        setSelectedEndpointId(null);
      }
    }
  }, [workspace?.endpoints, selectedEndpointId]);

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
    try {
      const res = await getIntegrationWorkspace(snapshotId);
      setWorkspace(res.data);

      if (!activeJobId) {
        const fetchedJobs = res.data.jobs || {};
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
          setActiveStage(runningJobType === "EXECUTE" ? "RUN" : runningJobType);
        } else if (!initialContext || initialContext.snapshotId !== snapshotId) {
          setActiveStage((prev) => {
            if (prev === "RUN" || prev === "REPORT" || prev === "COMPARE" || prev === "HISTORY") return prev;
            if (res.data?.aiTests?.length > 0) return "GENERATE";
            if (fetchedJobs.analyze?.status === "SUCCESS") return "ANALYZE";
            return prev;
          });
        }
      }

      // Preserve previously selected test ids if they still exist, otherwise reset to all
      if (res.data?.aiTests && selectedTestIds.length === 0) {
        const allIds = (res.data.aiTests || []).flatMap((t) =>
          (t?.requests || []).map((r) => `${t.id}::${r.scenarioId || r.testName}`),
        );
        setSelectedTestIds(allIds);
      }
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load workspace.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [snapshotId, activeJobId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleJobComplete = useCallback(async () => {
    setActiveJobStatus("SUCCESS");
    try {
      await load();
    } catch (err) {
      console.error("[IntegrationWorkspace] Failed to reload workspace after job:", err);
    } finally {
      // Graceful transition: small delay so user sees 100% completed state before switching view
      setTimeout(() => {
        setActiveJobId(null);
        setActiveJobType(null);
        setActiveJobStatus("SUCCESS");
        setIsCancelling(false);
        setPendingAction(null);
      }, 350);
    }
  }, [load]);

  const handleJobCanceled = useCallback(async () => {
    setActiveJobStatus("CANCELED");
    setCancellationNotice("Task successfully cancelled.");
    try {
      await load();
    } catch (err) {
      console.error("[IntegrationWorkspace] Failed to reload workspace after cancel:", err);
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

  const handleCancelActiveJob = useCallback(async (targetJobId = null) => {
    const jId = targetJobId || activeJobId;
    if (!jId || isCancelling) return;
    setIsCancelling(true);
    setError("");
    try {
      await cancelJobApi(jId);
      setActiveJobStatus("CANCELED");
      setCancellationNotice("Task successfully cancelled.");
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
  }, [activeJobId, isCancelling, load]);

  const { logs: activeLogs, logsEndRef } = useLiveJobLogs(
    activeJobId,
    handleJobComplete,
    (err) => {
      setActiveJobStatus("FAILED");
      setError(err.message);
      setIsCancelling(false);
    },
    handleJobCanceled,
  );

  const handleInstallDependencies = async () => {
    if (!snapshotId || isInstallingDeps) return;
    setIsInstallingDeps(true);
    setError("");
    try {
      await installIntegrationDependencies(snapshotId);
      await load();
    } catch (err) {
      setError(err.message || "Failed to install test libraries.");
    } finally {
      setIsInstallingDeps(false);
    }
  };

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
        setActiveStage("GENERATE");
      } else {
        await load();
      }
    } catch (err) {
      setError(err.message || "Failed to generate tests via AI Cold-Start.");
    } finally {
      setIsGeneratingWithBanner(false);
    }
  };

  const handleAIFixScenario = async (ep, sc) => {
    if (!snapshotId) return;
    setError("");
    try {
      await regenerateIntegrationScenario(snapshotId, {
        scenarioId: sc.id || sc.scenarioId,
        framework: detectionInfo?.targetFramework || "supertest",
        failureContext: {
          failureLayer: sc.failureLayer,
          actualStatus: sc.actualStatus ?? sc.actualStatusFromRuntime,
          expectedStatus: sc.expectedStatus,
          errorMessage: (sc.failureMessages || []).join("\n") || sc.failureDetails?.raw || "",
        },
      });
      await load();
    } catch (err) {
      setError(err.message || "Failed to repair test scenario with AI.");
    }
  };

  const handleOpenApplyModal = (targetIds = null) => {
    const ids = (targetIds && targetIds.length > 0) ? targetIds : selectedTestIds;
    setApplyModalTestIds(ids);
    setApplyModalOpen(true);
  };

  const handleRunAnalysis = async () => {
    if (
      !projectId ||
      !snapshotId ||
      (activeJobId && activeJobStatus !== "FAILED")
    )
      return;
    setError("");
    setActiveStage("ANALYZE");
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
      setError(err.message || "Project analysis failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleGenerateClick = async (explicitTargets = null) => {
    if (
      !workspace?.generation?.hasAnalysis ||
      (activeJobId && activeJobStatus !== "FAILED")
    )
      return;
    setError("");
    setActiveStage("GENERATE");
    setPendingAction("GENERATE");
    try {
      let targets = explicitTargets;
      if (!targets && selectedTargetEndpoints.size > 0) {
        targets = Array.from(selectedTargetEndpoints);
      }
      const res = await onGenerate(targets);
      if (res === undefined) return; // User was shown the overwrite confirm modal
      const jobId = res?.data?.job?.id;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("GENERATE");
        setActiveJobStatus("RUNNING");
      } else throw new Error("Backend failed to return a generation Job ID.");
    } catch (err) {
      setError(err.message || "Generation failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleApprove = async () => {
    if (
      !snapshotId ||
      (activeJobId && activeJobStatus !== "FAILED") ||
      selectedTestIds.length === 0
    )
      return;
    setError("");
    setPendingAction("APPROVE");
    try {
      await approveIntegrationTestsApi(snapshotId, selectedTestIds);
      await load();
    } catch (err) {
      setError(err.message || "Approval failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleApproveAndRun = async (targetIds = null) => {
    const idsToRun = targetIds && Array.isArray(targetIds) && targetIds.length > 0 ? targetIds : selectedTestIds;
    if (
      !snapshotId ||
      (activeJobId && activeJobStatus !== "FAILED") ||
      idsToRun.length === 0
    )
      return;
    setError("");
    setPendingAction("APPROVE_AND_RUN");
    try {
      // 1. Approve selected scenarios
      await approveIntegrationTestsApi(snapshotId, idsToRun);
      // 2. Trigger test execution
      const response = await runCoverageByType(snapshotId, "integration");
      if (response?.data?.job?.id) {
        setActiveJobId(response.data.job.id);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
        setActiveStage("RUN");
      } else {
        throw new Error("Backend failed to start test execution job.");
      }
    } catch (err) {
      setError(err.message || "Failed to approve and run tests.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleRunApprovedTests = async () => {
    if (!snapshotId || pendingAction) return;
    if (activeJobId && (activeJobStatus === "RUNNING" || activeJobStatus === "QUEUED")) {
      setError("A test run is already in progress.");
      return;
    }
    setError("");
    setActiveStage("RUN");
    setPendingAction("RUN");
    try {
      const response = await runCoverageByType(snapshotId, "integration");
      if (response.data?.job?.id) {
        setActiveJobId(response.data.job.id);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
      }
    } catch (err) {
      setError(err.message || "Test execution failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleRunRemainingEndpoints = async (specificEndpoints = null, targetScenarioId = null) => {
    if (!snapshotId || pendingAction) return;
    if (activeJobId && (activeJobStatus === "RUNNING" || activeJobStatus === "QUEUED")) {
      setError("A test execution job is already in progress.");
      return;
    }

    setError("");
    setPendingAction("RUN_REMAINING");

    try {
      const remainingList = specificEndpoints || (workspace?.endpoints || []).filter((ep) => {
        const hasTests = (ep.generatedCount > 0) || (ep.scenarios && ep.scenarios.length > 0);
        if (!hasTests) return false;
        const hasUnexecuted = (ep.unexecutedCount > 0) || (ep.generatedCount > 0 && ep.executedCount === 0);
        const hasFailures = (ep.failedCount > 0) || (ep.testScriptErrorCount > 0);
        const hasUnrunInScenarios = (ep.scenarios || []).some((s) => 
          s.status === "not_run" || s.executionVerdict === "NOT_EXECUTED" || !s.status || s.status === "pending" || s.status === "skipped" ||
          s.status === "failed" || s.executionVerdict === "FAIL" || s.executionVerdict === "SCRIPT_ERROR" || s.classification === "TEST_SCRIPT_ERROR"
        );
        return hasUnexecuted || hasFailures || hasUnrunInScenarios;
      });

      if (remainingList.length === 0 && !targetScenarioId) {
        setError("All generated scenarios have already been executed with no retryable failures.");
        setPendingAction(null);
        return;
      }

      // Check if any of these remaining endpoints do not have AI tests generated
      const ungenerated = remainingList.filter((ep) => (ep.generatedCount || 0) === 0 && (ep.unexecutedCount || 0) === 0 && (ep.scenarios || []).length === 0);
      if (ungenerated.length > 0 && !targetScenarioId) {
        setPendingAction(null);
        const targetIds = ungenerated.map((ep) => `${ep.method} ${ep.path || ep.route || ep.fullPath}`);
        setSelectedTargetEndpoints(new Set(targetIds));
        setActiveStage("GENERATE");
        await handleGenerateClick(targetIds);
        return;
      }

      // 1. Gather all scenario identifiers for remaining / retryable endpoints
      const remainingScenarioIds = new Set();

      if (targetScenarioId) {
        remainingScenarioIds.add(targetScenarioId);
      } else {
        remainingList.forEach((ep) => {
          (ep.scenarios || []).forEach((s) => {
            const isUnexecuted = s.status === "not_run" || s.executionVerdict === "NOT_EXECUTED" || !s.status || s.status === "pending" || s.status === "skipped";
            const isRetryableFailure = s.status === "failed" || s.executionVerdict === "FAIL" || s.executionVerdict === "SCRIPT_ERROR" || s.classification === "TEST_SCRIPT_ERROR" || (s.status === "failed" && s.isSuiteLevelFailure);
            if (isUnexecuted || isRetryableFailure) {
              if (s.id) remainingScenarioIds.add(s.id);
              if (s.testId && s.scenarioId) remainingScenarioIds.add(`${s.testId}::${s.scenarioId}`);
              if (s.testId && s.testName) remainingScenarioIds.add(`${s.testId}::${s.testName}`);
            }
          });
        });
      }

      if (remainingScenarioIds.size === 0) {
        setPendingAction(null);
        const targetIds = remainingList.map((ep) => `${ep.method} ${ep.path || ep.route || ep.fullPath}`);
        if (targetIds.length > 0) {
          setSelectedTargetEndpoints(new Set(targetIds));
          setActiveStage("GENERATE");
          await handleGenerateClick(targetIds);
        } else {
          setError("No unexecuted or retryable test scenarios remain.");
        }
        return;
      }

      const finalApprovedIds = Array.from(remainingScenarioIds);

      // 2. Update selectedTestIds state
      setSelectedTestIds(finalApprovedIds);

      // 3. Approve targeted scenarios for runner
      await approveIntegrationTestsApi(snapshotId, finalApprovedIds);

      // 4. Trigger test execution
      const response = await runCoverageByType(snapshotId, "integration");
      const jobId = response?.data?.job?.id || response?.job?.id;

      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
        setActiveStage("RUN");
      } else {
        throw new Error("Backend did not return a Job ID when starting test execution.");
      }
    } catch (err) {
      console.error("[handleRunRemainingEndpoints] Error:", err);
      setError(err.message || "Unable to execute remaining endpoints.");
    } finally {
      setPendingAction(null);
    }
  };

  const parseProgressSteps = (jobType, logs = []) => {
    const safeLogs = Array.isArray(logs) ? logs : [];
    const stages = safeLogs.map((l) => l.parsedMessage?.stage).filter(Boolean);
    const hasStage = (stageName) => stages.includes(stageName);
    const textLogs = safeLogs
      .map((l) =>
        typeof l?.message === "string" ? l.message : JSON.stringify(l?.message || l || "")
      )
      .join("\n");
    let steps = [];

    if (jobType === "ANALYZE") {
      steps = [
        { label: "Load project snapshot", done: true },
        {
          label: "Analyze source structure",
          done:
            hasStage("LOAD_SOURCE") ||
            textLogs.includes("Scanning") ||
            textLogs.includes("Analyzed"),
        },
        {
          label: "Detect framework",
          done: hasStage("DETECT_ENDPOINTS") || textLogs.includes("Analyzed"),
        },
        {
          label: "Discover API endpoints",
          done:
            hasStage("DETECT_ENDPOINTS") ||
            textLogs.includes("Analyzed") ||
            textLogs.includes("Saving"),
        },
        {
          label: "Analyze route/controller/service flow",
          done: hasStage("MAP_DEPENDENCIES") || textLogs.includes("Saving"),
        },
        {
          label: "Build AI test context",
          done:
            hasStage("MAP_DEPENDENCIES") ||
            textLogs.includes("Saving") ||
            textLogs.includes("completed"),
        },
        {
          label: "Complete",
          done: hasStage("COMPLETE") || textLogs.includes("completed"),
        },
      ];
    } else if (jobType === "GENERATE") {
      steps = [
        {
          label: "Build AI test context",
          done:
            hasStage("BUILD_CONTEXT") ||
            textLogs.includes("Building AI Context") ||
            textLogs.includes("Calling Gemini"),
        },
        {
          label: "Generate AI tests",
          done:
            hasStage("GENERATE_AI_TESTS") ||
            textLogs.includes("Calling Gemini"),
        },
        {
          label: "Validate test scenarios",
          done:
            hasStage("VALIDATE_SCENARIOS") ||
            textLogs.includes("Parsing") ||
            textLogs.includes("validating") ||
            textLogs.includes("Saved") ||
            textLogs.includes("Generated") ||
            textLogs.includes("No Supertest"),
        },
        {
          label: "Complete",
          done:
            hasStage("COMPLETE") ||
            activeJobStatus === "SUCCESS" ||
            textLogs.includes("Saved") ||
            textLogs.includes("Generated") ||
            textLogs.includes("No Supertest") ||
            textLogs.toLowerCase().includes("complete") ||
            textLogs.toLowerCase().includes("finish"),
        },
      ];
    } else if (jobType === "EXECUTE") {
      steps = [
        { label: "Load approved tests", done: true },
        { label: "Validate snapshot", done: true },
        {
          label: "Prepare environment",
          done:
            hasStage("PREPARE_ENV") ||
            textLogs.toLowerCase().includes("start") ||
            textLogs.includes("TestRun"),
        },
        {
          label: "Execute tests",
          done:
            hasStage("RUN_JEST") ||
            textLogs.toLowerCase().includes("start") ||
            textLogs.includes("TestRun"),
        },
        {
          label: "Collect results",
          done:
            hasStage("PARSE_COVERAGE") ||
            textLogs.includes("TestRun") ||
            textLogs.toLowerCase().includes("complete"),
        },
        {
          label: "Map tests to endpoints",
          done:
            hasStage("MAP_RESULTS") ||
            textLogs.includes("TestRun") ||
            textLogs.toLowerCase().includes("complete"),
        },
        {
          label: "Collect coverage",
          done:
            hasStage("MAP_RESULTS") ||
            textLogs.includes("TestRun") ||
            textLogs.toLowerCase().includes("complete"),
        },
        {
          label: "Build report",
          done: hasStage("COMPLETE") || textLogs.toLowerCase().includes("complete"),
        },
      ];
    }
    return steps;
  };

  if (!snapshotId && !workspace) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 360, padding: 40, textAlign: "center", color: "var(--color-text)" }}>
        <AlertTriangle size={36} style={{ color: "var(--color-warning)", marginBottom: 14 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text)", marginBottom: 8 }}>No Project Snapshot Selected</h3>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", maxWidth: 440, lineHeight: 1.6, marginBottom: 16 }}>
          Please select a snapshot from the list or run project analysis before using Integration Testing.
        </p>
      </div>
    );
  }

  if (error && !workspace) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 360, padding: 40, textAlign: "center", color: "var(--color-text)" }}>
        <AlertTriangle size={36} style={{ color: "var(--color-danger)", marginBottom: 14 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text)", marginBottom: 8 }}>Failed to Load Integration Workspace Data</h3>
        <p style={{ fontSize: 13, color: "var(--color-danger)", maxWidth: 440, lineHeight: 1.6, marginBottom: 18 }}>{error}</p>
        <button
          type="button"
          onClick={() => { setError(""); load(); }}
          style={{
            padding: "8px 18px",
            background: "var(--color-primary)",
            color: "var(--color-primary-foreground)",
            border: "none",
            borderRadius: "var(--radius-md)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6
          }}
        >
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  if (loading && !workspace) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 360, padding: 40, color: "var(--color-text)" }}>
        <div style={{
          width: 38,
          height: 38,
          border: "3px solid color-mix(in srgb, var(--color-primary) 20%, transparent)",
          borderTopColor: "var(--color-primary)",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
          marginBottom: 16
        }} />
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text)", marginBottom: 6 }}>
          Loading Integration Test Workspace...
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", maxWidth: 400, textAlign: "center", lineHeight: 1.5 }}>
          Connecting Snapshot ({snapshotId ? snapshotId.substring(0, 10) + "..." : ""}) and preparing API endpoint data...
        </div>
      </div>
    );
  }

  const {
    generation,
    endpoints = [],
    aiTests = [],
    summary,
    execution,
  } = workspace || {};
  const hasAnalysis = generation?.hasAnalysis;
  const hasGeneratedTests = generation?.hasGeneratedTests;
  const isApproved = Boolean(generation?.isApproved);
  const isJobActive = Boolean((activeJobId && (activeJobStatus === "RUNNING" || activeJobStatus === "QUEUED")) || isCancelling);
  const remainingEndpoints = (endpoints || []).filter((ep) => {
    const hasTests = (ep.generatedCount > 0) || (ep.scenarios && ep.scenarios.length > 0);
    if (!hasTests) return false;
    const hasUnexecuted = (ep.unexecutedCount > 0) || (ep.generatedCount > 0 && ep.executedCount === 0);
    const hasFailures = (ep.failedCount > 0) || (ep.testScriptErrorCount > 0);
    const hasUnrunInScenarios = (ep.scenarios || []).some((s) => 
      s.status === "not_run" || s.executionVerdict === "NOT_EXECUTED" || !s.status || s.status === "pending" || s.status === "skipped" ||
      s.status === "failed" || s.executionVerdict === "FAIL" || s.executionVerdict === "SCRIPT_ERROR" || s.classification === "TEST_SCRIPT_ERROR"
    );
    return hasUnexecuted || hasFailures || hasUnrunInScenarios;
  });

  const totalRemainingScenarios = remainingEndpoints.reduce((acc, ep) => {
    const remainingInScenarios = (ep.scenarios || []).filter((s) => {
      const isUnexecuted = s.status === "not_run" || s.executionVerdict === "NOT_EXECUTED" || !s.status || s.status === "pending" || s.status === "skipped";
      const isRetryable = s.status === "failed" || s.executionVerdict === "FAIL" || s.executionVerdict === "SCRIPT_ERROR" || s.classification === "TEST_SCRIPT_ERROR";
      return isUnexecuted || isRetryable;
    }).length;
    if (remainingInScenarios > 0) return acc + remainingInScenarios;
    if (ep.unexecutedCount > 0) return acc + ep.unexecutedCount;
    if (ep.failedCount > 0) return acc + ep.failedCount;
    if (ep.generatedCount > 0 && ep.executedCount === 0) return acc + ep.generatedCount;
    return acc;
  }, 0);

  const selectedEndpoint =
    selectedEndpointId !== null ? endpoints.find(e => `${e.method} ${e.path}` === selectedEndpointId) : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        background: "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      {/* DEVELOPER COMMAND BAR & PIPELINE TABS */}
      <div className="h-12 px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center shrink-0 select-none">
        <div className="flex items-center gap-1 h-full overflow-x-auto custom-scrollbar">
          {[
            { id: "ANALYZE", label: "Analyze", icon: Search, step: "1" },
            { id: "GENERATE", label: "Generate & Review", icon: Zap, step: "2" },
            { id: "RUN", label: "Run Tests", icon: PlayCircle, step: "3" },
            { id: "HISTORY", label: "Version History", icon: Clock },
            { id: "COMPARE", label: "Before/After Comparison", icon: GitCompare },
            { id: "REPORT", label: "Report", icon: BarChart3 }
          ].map((stage) => {
            const isActive = activeStage === stage.id;
            const Icon = stage.icon;
            
            return (
              <button
                key={stage.id}
                onClick={() => {
                  if (stage.id === "REPORT") {
                    navigate(`/project/${projectId}/reports/integration`);
                  } else {
                    setActiveStage(stage.id);
                  }
                }}
                className={`relative flex items-center gap-2 px-3.5 h-full text-xs font-semibold tracking-wide transition-colors cursor-pointer border-b-2 ${
                  isActive 
                    ? "text-[var(--color-primary)] border-[var(--color-primary)] bg-[var(--color-surface)]" 
                    : "text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]/50"
                }`}
              >
                <Icon size={14} className={isActive ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"} />
                <span>{stage.label}</span>
                {stage.step && (
                  <span className={`text-[10px] font-mono px-1 rounded ${
                    isActive ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-bold" : "text-[var(--color-text-muted)] bg-[var(--color-surface-secondary)]"
                  }`}>
                    0{stage.step}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {cancellationNotice && (
        <div
          style={{
            margin: "16px 24px 0",
            padding: "10px 16px",
            background: "rgba(245, 158, 11, 0.1)",
            color: "var(--color-warning, #f59e0b)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            borderRadius: 8,
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{cancellationNotice}</span>
          <button
            onClick={() => setCancellationNotice("")}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            margin: "16px 24px 0",
            padding: "12px 16px",
            background: "rgba(248,113,113,.1)",
            color: "var(--color-danger)",
            border: "1px solid var(--color-danger)",
            borderRadius: 8,
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError("")}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-danger)",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* MASTER-DETAIL LAYOUT */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* LEFT PANE (MASTER): Targets */}
        <div
          style={{
            flexShrink: 0,
            width: isLeftPaneCollapsed ? 40 : 250,
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            borderRight: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            transition: "width 0.2s ease-in-out",
          }}
        >
          {activeStage === "ANALYZE" || activeStage === "GENERATE" || activeStage === "RUN" || activeStage === "HISTORY" || activeStage === "COMPARE" ? (
             <IntegrationTargetsPane
               endpoints={endpoints}
               onAIFixScenario={handleAIFixScenario}
                      selectedEndpointId={selectedEndpointId}
               onSelectEndpoint={setSelectedEndpointId}
               hasAnalysis={hasAnalysis}
               selectedTargetEndpoints={selectedTargetEndpoints}
               onToggleSelectEndpoint={handleToggleSelectEndpoint}
               onToggleSelectModule={handleToggleSelectModule}
               onSelectAllEndpoints={handleSelectAllEndpoints}
               onClearSelectedEndpoints={handleClearSelectedEndpoints}
               activeScopeFilter={activeScopeFilter}
               onSelectScopeFilter={setActiveScopeFilter}
               isCollapsed={isLeftPaneCollapsed}
               onToggleCollapse={() => setIsLeftPaneCollapsed(!isLeftPaneCollapsed)}
             />
          ) : null}
        </div>

        {/* RIGHT PANE (DETAIL): Context */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            background: "var(--color-bg)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
          }}
        >
          <IntegrationErrorBoundary onRetry={load}>
          {activeJobId && !selectedEndpointId && (activeJobType === activeStage || (activeStage === "RUN" && activeJobType === "EXECUTE")) ? (
             <IntegrationLiveProgress
               activeJobId={activeJobId}
               activeJobType={activeJobType}
               activeJobStatus={activeJobStatus}
               error={error}
               activeLogs={activeLogs}
               parseProgressSteps={parseProgressSteps}
               onCancel={() => handleCancelActiveJob(activeJobId)}
               isCancelling={isCancelling}
               onInspectEndpoints={() => {
                 if (endpoints && endpoints.length > 0) {
                   setSelectedEndpointId(`${endpoints[0].method} ${endpoints[0].path}`);
                 }
               }}
             />
          ) : selectedEndpointId !== null ? (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
              {activeJobId && (
                <div style={{
                  padding: "8px 16px",
                  background: "rgba(59,130,246,0.1)",
                  borderBottom: "1px solid rgba(59,130,246,0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 12,
                  flexShrink: 0,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <RefreshCw size={14} className="animate-spin text-blue-400" />
                    <span>
                      <strong>{activeJobType === "ANALYZE" ? "Analyzing Project" : activeJobType === "GENERATE" ? "Generating AI Tests" : "Running Test Suite"}</strong> in progress...
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setSelectedEndpointId(null)}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--color-primary)",
                        borderRadius: 4,
                        padding: "3px 10px",
                        color: "var(--color-primary)",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      View Live Logs
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelActiveJob(activeJobId)}
                      disabled={isCancelling}
                      style={{
                        background: "rgba(239,68,68,0.12)",
                        border: "1px solid var(--color-danger, #ef4444)",
                        borderRadius: 4,
                        padding: "3px 10px",
                        color: "var(--color-danger, #ef4444)",
                        cursor: isCancelling ? "not-allowed" : "pointer",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {isCancelling ? "Cancelling..." : "Cancel"}
                    </button>
                  </div>
                </div>
              )}
              <IntegrationEndpointDetail
                endpoint={selectedEndpoint}
                aiTests={aiTests}
                hasGeneratedTests={hasGeneratedTests}
              hasAnalysis={hasAnalysis}
              onRunAnalysis={handleRunAnalysis}
                isApproved={isApproved}
                selectedTestIds={selectedTestIds}
                setSelectedTestIds={setSelectedTestIds}
                snapshotId={snapshotId}
                projectId={projectId}
                endpoints={endpoints}
                onOpenCFG={onOpenCFG}
                onSuggestTestcase={onSuggestTestcase}
                onOpenArchitecture={onOpenArchitecture}
                onScenarioChange={load}
                onError={setError}
                onGenerateThisEndpoint={(ep) => handleGenerateClick([`${ep.method} ${ep.path || ep.route}`])}
                onOpenFile={onOpenFile}
                onBackToTargets={() => setSelectedEndpointId(null)}
                isGenerating={pendingAction === "GENERATE" || (activeJobId && activeJobType === "GENERATE")}
              />
            </div>
          ) : activeStage === "GENERATE" ? (
            <IntegrationScenariosPane
              aiTests={aiTests}
              selectedEndpoint={selectedEndpoint}
              onClearSelectedEndpoint={() => setSelectedEndpointId(null)}
              hasGeneratedTests={hasGeneratedTests}
              isApproved={isApproved}
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
              isGenerating={pendingAction === "GENERATE" || (activeJobId && activeJobType === "GENERATE")}
              onApproveAndRun={handleApproveAndRun}
              isApprovingAndRunning={pendingAction === "APPROVE_AND_RUN"}
              onOpenApplyModal={handleOpenApplyModal}
              onReGenerateSelected={(explicitTargets = null) =>
                handleGenerateClick(
                  explicitTargets ||
                    (selectedTargetEndpoints && selectedTargetEndpoints.size > 0
                      ? Array.from(selectedTargetEndpoints)
                      : null)
                )
              }
            />
          ) : (
            <div className="flex flex-col h-full bg-[var(--color-surface)]">



              {/* Task 5.2: Framework Detection Banner (Zero-Test & Missing Dependencies) */}
              {detectionInfo && (detectionInfo.isZeroTestProject || detectionInfo.needsDependencyInstall) && (
                <div className="p-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                  <IntegrationFrameworkDetectionBanner
                    detectionInfo={detectionInfo}
                    onGenerateTests={handleGenerateByBannerFramework}
                    onInstallDependencies={handleInstallDependencies}
                    isInstalling={isInstallingDeps}
                    isGenerating={isGeneratingWithBanner}
                  />
                </div>
              )}

              <div style={{ flex: 1, overflow: "hidden" }}>
                {activeStage === "ANALYZE" && !selectedEndpointId ? (
                   !hasAnalysis ? (
                     <div className="flex flex-col items-center justify-center h-full p-8 text-center font-sans">
                       <div className="w-14 h-14 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center mb-4">
                         <Search size={26} />
                       </div>
                       <h3 className="text-base font-bold text-[var(--color-text)] mb-2">
                         API Endpoint Analysis Required
                       </h3>
                       <p className="text-xs text-[var(--color-text-secondary)] max-w-md mb-6 leading-relaxed">
                         CovAI needs to scan your project's codebase AST to discover Express/Node routes, controller handlers, middleware chains, and data models.
                       </p>
                       <button
                         type="button"
                         onClick={handleRunAnalysis}
                         disabled={isJobActive || pendingAction === "ANALYZE"}
                         className="px-5 py-2.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer inline-flex items-center gap-2 shadow-sm disabled:opacity-50"
                       >
                         <Search size={14} />
                         <span>{pendingAction === "ANALYZE" ? "Analyzing Project..." : "Analyze Project"}</span>
                       </button>
                     </div>
                   ) : (
                     <IntegrationAnalysisOverview
                       endpoints={endpoints}
                       snapshotId={snapshotId}
                       selectedEndpointId={selectedEndpointId}
                       onSelectEndpoint={setSelectedEndpointId}
                       onGenerateSelected={() => handleGenerateClick()}
                       selectedTargetEndpoints={selectedTargetEndpoints}
                       onToggleSelectEndpoint={handleToggleSelectEndpoint}
                       onRunAnalysis={handleRunAnalysis}
                       isAnalyzing={pendingAction === "ANALYZE" || (activeJobId && activeJobType === "ANALYZE")}
                       activeScopeFilter={activeScopeFilter}
                       onClearScopeFilter={() => setActiveScopeFilter({ type: "ALL", value: null })}
                     />
                   )
                ) : activeStage === "REPORT" ? (
                   <div style={{padding: 24, color: "var(--color-text-secondary)"}}>Redirecting to Report...</div>
                ) : activeStage === "RUN" && (
                  !hasAnalysis ? (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center font-sans">
                      <div className="w-14 h-14 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center mb-4">
                        <Search size={26} />
                      </div>
                      <h3 className="text-base font-bold text-[var(--color-text)] mb-2">
                        API Endpoint Analysis Required
                      </h3>
                      <p className="text-xs text-[var(--color-text-secondary)] max-w-md mb-6 leading-relaxed">
                        Please analyze the project and generate test scenarios before executing tests.
                      </p>
                      <button
                        type="button"
                        onClick={handleRunAnalysis}
                        disabled={isJobActive || pendingAction === "ANALYZE"}
                        className="px-5 py-2.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer inline-flex items-center gap-2 shadow-sm disabled:opacity-50"
                      >
                        <Search size={14} />
                        <span>{pendingAction === "ANALYZE" ? "Analyzing Project..." : "Analyze Project"}</span>
                      </button>
                    </div>
                  ) : !hasGeneratedTests ? (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center font-sans">
                      <div className="w-14 h-14 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center mb-4">
                        <Zap size={26} />
                      </div>
                      <h3 className="text-base font-bold text-[var(--color-text)] mb-2">
                        Test Scenarios Required
                      </h3>
                      <p className="text-xs text-[var(--color-text-secondary)] max-w-md mb-6 leading-relaxed">
                        Generate integration test scenarios before executing test suites.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveStage("GENERATE")}
                        className="px-5 py-2.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer inline-flex items-center gap-2 shadow-sm"
                      >
                        <Zap size={14} />
                        <span>Go to Generate & Review</span>
                      </button>
                    </div>
                  ) : (
                    <IntegrationRunResultsPane
                      workspace={workspace}
                      summary={summary}
                      execution={execution}
                      endpoints={endpoints}
                      isApproved={isApproved}
                      isJobActive={isJobActive}
                      pendingAction={pendingAction}
                      remainingEndpoints={remainingEndpoints}
                      totalRemainingScenarios={totalRemainingScenarios}
                      onRunAllTests={handleRunApprovedTests}
                      onRunRemaining={() => handleRunRemainingEndpoints()}
                      onRunEndpoint={(ep) => handleRunRemainingEndpoints([ep])}
                      onRetryScenario={(ep, sc) => handleRunRemainingEndpoints([ep], sc.id || (sc.testId && sc.scenarioId ? `${sc.testId}::${sc.scenarioId}` : null))}
                      onAIFixScenario={handleAIFixScenario}
                      selectedEndpointId={selectedEndpointId}
                      onSelectEndpoint={setSelectedEndpointId}
                    />
                  )
                )}
                {activeStage === "HISTORY" && (
                  <IntegrationHistoryPane
                    snapshotId={snapshotId}
                    onOpenComparison={() => setActiveStage("COMPARE")}
                  />
                )}
                {activeStage === "COMPARE" && (
                  <BeforeAfterComparisonView
                    projectId={projectId}
                    snapshotId={snapshotId}
                    initialBaselineId={new URLSearchParams(location.search).get("baselineId")}
                    onBackToWorkspace={() => setActiveStage("ANALYZE")}
                  />
                )}
              </div>
            </div>
          )}
          {/* Task 5.4: Apply Tests To Source Code Modal */}
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
          </IntegrationErrorBoundary>
        </div>
      </div>
    </div>
  );
}
