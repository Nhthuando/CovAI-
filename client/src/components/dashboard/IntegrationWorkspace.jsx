import React, { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  getIntegrationWorkspace,
  runCoverageByType,
} from "../../services/coverage.service.js";
import { runProjectStructureAnalysisApi } from "../../services/project.service.js";
import { Search, Zap, CheckCircle2, PlayCircle, BarChart3, ChevronRight, Play, ChevronDown, Clock, AlertTriangle, RefreshCw } from "lucide-react";

import IntegrationTargetsPane from "./integration/IntegrationTargetsPane.jsx";
import IntegrationScenariosPane from "./integration/IntegrationScenariosPane.jsx";
import IntegrationLiveProgress from "./integration/IntegrationLiveProgress.jsx";
import IntegrationHistoryPane from "./integration/IntegrationHistoryPane.jsx";
import MetricProvenancePopover from "./integration/MetricProvenancePopover.jsx";
import IntegrationEndpointDetail from "./integration/IntegrationEndpointDetail.jsx";
import IntegrationErrorBoundary from "./integration/IntegrationErrorBoundary.jsx";

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
  background: isActive ? `${color}33` : `${color}18`,
  color,
  border: `1px solid ${color}55`,
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.15s ease",
});

const disabledButtonStyle = {
  background: "rgba(255,255,255,.05)",
  color: "rgba(255,255,255,.3)",
  border: "1px solid rgba(255,255,255,.1)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "not-allowed",
};

function useLiveJobLogs(jobId, onComplete, onError) {
  const [logs, setLogs] = useState([]);
  const logsEndRef = useRef(null);

  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
  }, [onComplete, onError]);

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
          onErrorRef.current(new Error("Job was canceled"));
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
  const [selectedTestIds, setSelectedTestIds] = useState([]);

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
            if (prev === "RUN" || prev === "REPORT") return prev;
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
        setActiveJobStatus("RUNNING");
      }, 350);
    }
  }, [load]);

  const { logs: activeLogs, logsEndRef } = useLiveJobLogs(
    activeJobId,
    handleJobComplete,
    (err) => {
      setActiveJobStatus("FAILED");
      setError(err.message);
    },
  );

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

  const handleApproveAndRun = async () => {
    if (
      !snapshotId ||
      (activeJobId && activeJobStatus !== "FAILED") ||
      selectedTestIds.length === 0
    )
      return;
    setError("");
    setPendingAction("APPROVE_AND_RUN");
    try {
      // 1. Approve selected scenarios
      await approveIntegrationTestsApi(snapshotId, selectedTestIds);
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
    if (!snapshotId || (activeJobId && activeJobStatus !== "FAILED")) return;
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

  const handleRunRemainingEndpoints = async (specificEndpoints = null) => {
    if (!snapshotId || (activeJobId && activeJobStatus !== "FAILED") || pendingAction) return;

    setError("");
    setPendingAction("RUN_REMAINING");

    try {
      const remainingList = specificEndpoints || (workspace?.endpoints || []).filter((ep) => ep.executedCount === 0);
      if (remainingList.length === 0) {
        throw new Error("Không có endpoint nào còn lại để chạy.");
      }

      // Check if any of these remaining endpoints do not have AI tests generated
      const ungenerated = remainingList.filter((ep) => (ep.generatedCount || 0) === 0);
      if (ungenerated.length > 0) {
        setPendingAction(null);
        const targetIds = ungenerated.map((ep) => `${ep.method} ${ep.path || ep.route || ep.fullPath}`);
        setSelectedTargetEndpoints(new Set(targetIds));
        setActiveStage("GENERATE");
        await handleGenerateClick(targetIds);
        return;
      }

      // Helper function to check if request matches an endpoint
      const isRequestMatchEp = (r, ep) => {
        if (!r || !ep) return false;
        if ((r.method || "GET").toUpperCase() !== ep.method.toUpperCase()) return false;
        const cleanReq = (r.path || "").split("?")[0].replace(/\/+$/, "") || "/";
        const cleanRoute = (ep.path || ep.route || ep.fullPath || "").replace(/\/+$/, "") || "/";
        const regexStr = "^" + cleanRoute.replace(/\./g, "\\.").replace(/:[a-zA-Z0-9_]+/g, "[^/]+") + "$";
        if (new RegExp(regexStr, "i").test(cleanReq)) return true;

        const suite = (r.suiteName || "").toUpperCase();
        const title = (r.testName || "").toUpperCase();
        const epMethod = ep.method.toUpperCase();
        const epPath = cleanRoute.toUpperCase();
        if (suite.includes(epMethod) || title.includes(epMethod)) {
          if (epPath.includes(":")) {
            const prefix = epPath.split("/:")[0];
            return suite.includes(epPath) || (suite.includes(prefix) && /\b(BY\s+ID|USER\s+ID|WITH\s+ID)\b/i.test(title));
          } else {
            return !suite.includes(epPath + "/:") && !/\b(BY\s+ID|USER\s+ID|WITH\s+ID)\b/i.test(title) && suite.includes(epPath);
          }
        }
        return false;
      };

      // 1. Gather all scenario identifiers for remaining endpoints
      const remainingScenarioIds = [];
      (workspace?.aiTests || []).forEach((t) => {
        (t.requests || []).forEach((r) => {
          const isTarget = remainingList.some((ep) => isRequestMatchEp(r, ep));
          if (isTarget) {
            if (r.scenarioId) remainingScenarioIds.push(`${t.id}::${r.scenarioId}`);
            if (r.testName) remainingScenarioIds.push(`${t.id}::${r.testName}`);
          }
        });
      });

      if (remainingScenarioIds.length === 0) {
        setPendingAction(null);
        const targetIds = remainingList.map((ep) => `${ep.method} ${ep.path || ep.route || ep.fullPath}`);
        setSelectedTargetEndpoints(new Set(targetIds));
        setActiveStage("GENERATE");
        await handleGenerateClick(targetIds);
        return;
      }

      // 2. Combine with previously approved scenarios to preserve cumulative test results
      const combinedScenarioIds = new Set(remainingScenarioIds);
      (workspace?.aiTests || []).forEach((t) => {
        if (t.status === "APPROVED") {
          (t.requests || []).forEach((r) => {
            if (r.scenarioId) combinedScenarioIds.add(`${t.id}::${r.scenarioId}`);
            if (r.testName) combinedScenarioIds.add(`${t.id}::${r.testName}`);
          });
        }
      });

      // Also preserve anything currently in selectedTestIds
      (selectedTestIds || []).forEach((id) => combinedScenarioIds.add(id));

      const finalApprovedIds = Array.from(combinedScenarioIds);

      // 3. Update selectedTestIds state
      setSelectedTestIds(finalApprovedIds);

      // 4. Call approveIntegrationTestsApi
      await approveIntegrationTestsApi(snapshotId, finalApprovedIds);

      // 5. Trigger test execution
      const response = await runCoverageByType(snapshotId, "integration");
      const jobId = response?.data?.job?.id || response?.job?.id;

      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
        setActiveStage("RUN");
      } else {
        throw new Error("Backend không trả về Job ID khi khởi động chạy kiểm thử.");
      }
    } catch (err) {
      console.error("[handleRunRemainingEndpoints] Error:", err);
      setError(err.message || "Không thể chạy các endpoint còn lại.");
    } finally {
      setPendingAction(null);
    }
  };

  const parseProgressSteps = (jobType, logs) => {
    const stages = logs.map((l) => l.parsedMessage?.stage).filter(Boolean);
    const hasStage = (stageName) => stages.includes(stageName);
    const textLogs = logs
      .map((l) =>
        typeof l.message === "string" ? l.message : JSON.stringify(l.message),
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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 360, padding: 40, textAlign: "center", color: "#e6edf3" }}>
        <AlertTriangle size={36} style={{ color: "#eab308", marginBottom: 14 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f0f6fc", marginBottom: 8 }}>Chưa chọn Snapshot dự án</h3>
        <p style={{ fontSize: 13, color: "#8b949e", maxWidth: 440, lineHeight: 1.6, marginBottom: 16 }}>
          Vui lòng chọn một Snapshot từ danh sách hoặc chạy phân tích dự án (Run Analysis) trước khi sử dụng tính năng Integration Test.
        </p>
      </div>
    );
  }

  if (error && !workspace) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 360, padding: 40, textAlign: "center", color: "#e6edf3" }}>
        <AlertTriangle size={36} style={{ color: "#f87171", marginBottom: 14 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f0f6fc", marginBottom: 8 }}>Không thể nạp dữ liệu Integration Workspace</h3>
        <p style={{ fontSize: 13, color: "#fca5a5", maxWidth: 440, lineHeight: 1.6, marginBottom: 18 }}>{error}</p>
        <button
          type="button"
          onClick={() => { setError(""); load(); }}
          style={{
            padding: "8px 18px",
            background: "#2563eb",
            color: "#ffffff",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6
          }}
        >
          <RefreshCw size={14} /> Thử lại
        </button>
      </div>
    );
  }

  if (loading && !workspace) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 360, padding: 40, color: "#e6edf3" }}>
        <div style={{
          width: 38,
          height: 38,
          border: "3px solid rgba(59, 130, 246, 0.2)",
          borderTopColor: "#3b82f6",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
          marginBottom: 16
        }} />
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#f0f6fc", marginBottom: 6 }}>
          Đang nạp không gian kiểm thử tích hợp...
        </div>
        <div style={{ fontSize: 12, color: "#8b949e", maxWidth: 400, textAlign: "center", lineHeight: 1.5 }}>
          Đang kết nối Snapshot ({snapshotId ? snapshotId.substring(0, 10) + "..." : ""}) và chuẩn bị dữ liệu API Endpoints
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
  const isApproved = generation?.isApproved;
  const isJobActive = activeJobId && activeJobStatus !== "FAILED";
  const remainingEndpoints = endpoints.filter((ep) => ep.executedCount === 0);

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
      {/* PIPELINE STAGE HEADER */}
      <div
        style={{
          padding: "0 24px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--color-surface)",
        }}
      >
        <div className="flex gap-2 flex-1 items-center py-4">
          {[
            { id: "ANALYZE", label: "Analyze", icon: Search },
            { id: "GENERATE", label: "Generate & Review", icon: Zap },
            { id: "RUN", label: "Run Tests", icon: PlayCircle },
            { id: "REPORT", label: "Report", icon: BarChart3 }
          ].map((stage, idx, arr) => {
            const isActive = activeStage === stage.id;
            const isPast = arr.findIndex(s => s.id === activeStage) > idx;
            const Icon = stage.icon;
            
            return (
              <React.Fragment key={stage.id}>
                <button
                  onClick={() => {
                    if (stage.id === "REPORT") {
                      navigate(`/project/${projectId}/reports/integration`);
                    } else {
                      setActiveStage(stage.id);
                    }
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-200 border text-sm font-semibold ${
                    isActive 
                      ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30 shadow-[0_0_10px_var(--color-primary-light)]" 
                      : isPast
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-border)]"
                      : "bg-transparent text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
                  }`}
                >
                  <Icon size={16} className={isActive ? "text-[var(--color-primary)]" : isPast ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"} />
                  {stage.label}
                </button>
                {idx < arr.length - 1 && (
                  <ChevronRight size={16} className="text-[var(--color-border)] mx-1" />
                )}
              </React.Fragment>
            );
          })}
        </div>
        
        {/* Commands (Action Buttons for Current Stage) */}
        <div style={{ display: "flex", gap: 8, padding: "12px 0" }}>
          {activeStage === "ANALYZE" && (
             <button
               onClick={handleRunAnalysis}
               disabled={isJobActive || pendingAction === "ANALYZE"}
               style={isJobActive || pendingAction === "ANALYZE" ? disabledButtonStyle : buttonStyle("var(--color-text-secondary)", true)}
             >
               {pendingAction === "ANALYZE" ? "Analyzing..." : (hasAnalysis ? "Re-analyze Project" : "Analyze Project")}
             </button>
          )}
          {activeStage === "GENERATE" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => handleGenerateClick()}
                disabled={!hasAnalysis || isJobActive || pendingAction === "GENERATE"}
                style={!hasAnalysis || isJobActive || pendingAction === "GENERATE" ? disabledButtonStyle : buttonStyle("var(--color-primary)", false)}
              >
                {pendingAction === "GENERATE"
                  ? "Generating..."
                  : selectedTargetEndpoints.size > 0
                    ? `Generate Selected (${selectedTargetEndpoints.size})`
                    : (hasGeneratedTests ? "Regenerate All Tests" : "Generate Tests")}
              </button>
              {selectedTargetEndpoints.size > 0 && (
                <button
                  type="button"
                  onClick={handleClearSelectedEndpoints}
                  style={buttonStyle("var(--color-surface-secondary)", false)}
                  title="Clear endpoint selections"
                >
                  Clear ({selectedTargetEndpoints.size})
                </button>
              )}
              {hasGeneratedTests && (
                <button
                  onClick={handleApproveAndRun}
                  disabled={isJobActive || selectedTestIds.length === 0 || pendingAction === "APPROVE_AND_RUN"}
                  style={
                    isJobActive || selectedTestIds.length === 0 || pendingAction === "APPROVE_AND_RUN"
                      ? disabledButtonStyle
                      : buttonStyle("var(--color-success, #22c55e)", true)
                  }
                  title="Approve selected scenarios and execute tests immediately"
                >
                  {pendingAction === "APPROVE_AND_RUN"
                    ? "Starting Run..."
                    : `Approve & Run Selected (${selectedTestIds.length})`}
                </button>
              )}
            </div>
          )}
          {activeStage === "RUN" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {remainingEndpoints.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleRunRemainingEndpoints()}
                  disabled={isJobActive || pendingAction === "RUN_REMAINING" || pendingAction === "GENERATE"}
                  style={
                    isJobActive || pendingAction === "RUN_REMAINING" || pendingAction === "GENERATE"
                      ? disabledButtonStyle
                      : {
                          ...buttonStyle("#22c55e", true),
                          background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                          color: "#ffffff",
                          border: "none",
                          boxShadow: "0 2px 8px rgba(16, 185, 129, 0.25)",
                        }
                  }
                  title={
                    remainingEndpoints.some((ep) => (ep.generatedCount || 0) === 0)
                      ? "Tự động tạo kịch bản và chạy nốt các endpoint chưa kiểm thử"
                      : "Chạy nốt các endpoint chưa được kiểm thử trong đợt này"
                  }
                >
                  <Play size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }} fill="#ffffff" />
                  {pendingAction === "RUN_REMAINING" || pendingAction === "GENERATE"
                    ? "Starting Remaining..."
                    : remainingEndpoints.some((ep) => (ep.generatedCount || 0) === 0)
                      ? `Generate & Run Remaining (${remainingEndpoints.length})`
                      : `Run Remaining Endpoints (${remainingEndpoints.length})`}
                </button>
              )}
              <button
                type="button"
                onClick={handleRunApprovedTests}
                disabled={!isApproved || isJobActive || pendingAction === "RUN" || pendingAction === "RUN_REMAINING"}
                style={!isApproved || isJobActive || pendingAction === "RUN" || pendingAction === "RUN_REMAINING" ? disabledButtonStyle : buttonStyle("var(--color-info, #3b82f6)", false)}
              >
                {pendingAction === "RUN" ? "Starting..." : (execution ? "Run Tests Again" : "Run Tests")}
              </button>
            </div>
          )}
        </div>
      </div>

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
            width: 320,
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            borderRight: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {activeStage === "ANALYZE" || activeStage === "GENERATE" || activeStage === "RUN" ? (
             <IntegrationTargetsPane
               endpoints={endpoints}
               selectedEndpointId={selectedEndpointId}
               onSelectEndpoint={setSelectedEndpointId}
               hasAnalysis={hasAnalysis}
               selectedTargetEndpoints={selectedTargetEndpoints}
               onToggleSelectEndpoint={handleToggleSelectEndpoint}
               onToggleSelectModule={handleToggleSelectModule}
               onSelectAllEndpoints={handleSelectAllEndpoints}
               onClearSelectedEndpoints={handleClearSelectedEndpoints}
               onGenerateSelected={() => handleGenerateClick()}
               isGenerating={pendingAction === "GENERATE" || (activeJobId && activeJobType === "GENERATE")}
             />
          ) : activeStage === "HISTORY" ? (
             <div style={{padding: 16, color: "var(--color-text-secondary)"}}>History Mode</div>
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
          {activeJobId && (activeJobType === activeStage || (activeStage === "RUN" && activeJobType === "EXECUTE")) ? (
             <IntegrationLiveProgress
               activeJobId={activeJobId}
               activeJobType={activeJobType}
               activeJobStatus={activeJobStatus}
               error={error}
               activeLogs={activeLogs}
               parseProgressSteps={parseProgressSteps}
             />
          ) : selectedEndpointId !== null ? (
            <IntegrationEndpointDetail
              endpoint={selectedEndpoint}
              aiTests={aiTests}
              hasGeneratedTests={hasGeneratedTests}
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
              isGenerating={pendingAction === "GENERATE" || (activeJobId && activeJobType === "GENERATE")}
            />
          ) : activeStage === "GENERATE" ? (
            <IntegrationScenariosPane
              aiTests={aiTests}
              selectedEndpoint={selectedEndpoint}
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
            />
          ) : (
            <div className="flex flex-col h-full bg-[var(--color-surface)]">



              <div style={{ flex: 1, overflow: "hidden" }}>
                {activeStage === "ANALYZE" && hasAnalysis && !selectedEndpointId ? (
                   <div style={{padding: 24, color: "var(--color-text-secondary)"}}>Select an endpoint from the left to view analysis details.</div>
                ) : activeStage === "REPORT" ? (
                   <div style={{padding: 24, color: "var(--color-text-secondary)"}}>Redirecting to Report...</div>
                ) : activeStage === "RUN" && (
                  <div style={{ padding: 24, overflowY: "auto", height: "100%" }}>
                    {/* SCENARIO GENERATION */}
                    <div
                      style={{
                        padding: 16,
                        background: "rgba(255,255,255,.02)",
                        border: "1px solid rgba(255,255,255,.05)",
                        borderRadius: 8,
                        marginBottom: 24,
                      }}
                    >
                      <div
                        style={{
                          color: "#8b949e",
                          fontSize: 12,
                          textTransform: "uppercase",
                          fontWeight: 600,
                          marginBottom: 12,
                          display: "flex",
                          justifyContent: "space-between"
                        }}
                      >
                        <MetricProvenancePopover provenance={summary?.provenance?.scenarioCount}>
                          <span>Test Generation</span>
                        </MetricProvenancePopover>
                      </div>
                      
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#8b949e", marginBottom: 8 }}>
                        <span>Status</span>
                        <span style={{ 
                          color: !generation?.hasAnalysis ? "#8b949e" : (!generation?.hasGeneratedTests ? "#fbbf24" : "#22c55e"),
                          fontWeight: "bold" 
                        }}>
                          {!generation?.hasAnalysis ? "NOT GENERATED" : (!generation?.hasGeneratedTests ? "NO SCENARIOS" : "READY")}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#8b949e", marginBottom: 8 }}>
                        <span>Targeted APIs</span>
                        <span style={{ color: "#e6edf3", fontWeight: "bold" }}>{generation?.targetedApis || 0}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#8b949e" }}>
                        <span>Generated Scenarios</span>
                        <span style={{ color: "#e6edf3", fontWeight: "bold" }}>{generation?.generatedScenarios || 0}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <MetricProvenancePopover provenance={summary?.provenance?.execution}>
                        <h3 style={{ margin: 0, fontSize: 16, color: "#e6edf3" }}>
                          Execution Summary
                        </h3>
                      </MetricProvenancePopover>
                    </div>
                    {!execution ? (
                      <div style={{ color: "#8b949e", fontSize: 13 }}>
                        No recent executions found.
                      </div>
                    ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                      }}
                    >
                      {(() => {
                        const { semanticState, executionJobId, testRunId } = summary || {};
                        let title = "Unknown Status";
                        let description = "";
                        let color = "#8b949e";
                        
                        if (pendingAction === "RUN" || pendingAction === "RUN_REMAINING" || (activeJobType === "EXECUTE" && activeJobStatus === "RUNNING" && semanticState === "NOT_EXECUTED")) {
                          title = "Queued / Starting";
                          description = "Execution request has been sent and is starting...";
                          color = "var(--color-primary)";
                        } else if (semanticState === "RUNNING" || (activeJobType === "EXECUTE" && activeJobStatus === "RUNNING")) {
                          title = "Running";
                          description = "Execution is currently in progress.";
                          color = "var(--color-primary)";
                        } else if (semanticState === "CANCELED") {
                          title = "Canceled";
                          description = "Execution was canceled by the user.";
                          color = "var(--color-warning)";
                        } else if (semanticState === "TESTS_FAILED") {
                          title = "Tests Failed";
                          description = "Execution completed, but some tests failed.";
                          color = "#f87171";
                        } else if (semanticState === "FAILED_BEFORE_TEST_EXECUTION") {
                          title = "Infrastructure Failure";
                          description = workspace?.jobs?.execute?.errorMessage || "Test runner did not complete.";
                          color = "#f87171";
                        } else if (semanticState === "NO_TESTS_EXECUTED") {
                          title = "No Tests Executed";
                          description = "Pipeline completed but no tests were executed.";
                          color = "var(--color-warning)";
                        } else if (semanticState === "SKIPPED") {
                          title = "Skipped";
                          description = "Tests were skipped.";
                          color = "var(--color-warning)";
                        } else if (semanticState === "CONTRACT_VERIFICATION_REQUIRED") {
                          title = "Runner Assertions Passed — Contract Verification Required";
                          description = `${summary?.passedTests || 0}/${summary?.totalTests || 0} runner assertions passed, but ${summary?.qualityClassification?.contractUnverified || 0} scenarios require contract verification.`;
                          color = "#f59e0b";
                        } else if (semanticState === "SUCCESS") {
                          title = "All Tests Contract-Verified";
                          description = "All executed tests passed and verified against API contracts.";
                          color = "#22c55e";
                        } else {
                          title = semanticState || "No Status";
                        }

                        return (
                          <div
                            style={{
                              padding: 16,
                              background: "rgba(255,255,255,.02)",
                              border: "1px solid rgba(255,255,255,.05)",
                              borderRadius: 8,
                            }}
                          >
                            <div
                              style={{
                                color,
                                fontSize: 20,
                                fontWeight: 700,
                                marginBottom: 4,
                              }}
                            >
                              {title}
                            </div>
                            <div style={{ color: "#8b949e", fontSize: 13, marginBottom: 16, lineHeight: 1.4 }}>
                              {description}
                            </div>
                            {(() => {
                              const passed = summary?.passedTests || 0;
                              const failed = summary?.failedTests || 0;
                              const skipped = summary?.skippedTests || 0;
                              const total = summary?.totalTests || 0;
                              const executed = passed + failed;
                              const passRate = executed > 0 ? Math.round((passed / executed) * 100) : 0;
                              const unexecuted = summary?.qualityClassification?.notExecuted || 0;

                              return (
                                <div>
                                  <div
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                                      gap: 8,
                                      marginBottom: 12,
                                    }}
                                  >
                                    <div style={{ background: "rgba(34,197,94,0.06)", padding: "10px 12px", borderRadius: 6, border: "1px solid rgba(34,197,94,0.18)" }}>
                                      <div style={{ fontSize: 11, color: "var(--color-success)", fontWeight: 600 }}>RUNNER PASS</div>
                                      <div style={{ fontSize: 18, fontWeight: 700, color: "#e6edf3", marginTop: 2 }}>{passed}</div>
                                    </div>
                                    <div style={{ background: failed > 0 ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.02)", padding: "10px 12px", borderRadius: 6, border: failed > 0 ? "1px solid rgba(239,68,68,0.25)" : "1px solid rgba(255,255,255,0.05)" }}>
                                      <div style={{ fontSize: 11, color: failed > 0 ? "var(--color-danger)" : "#8b949e", fontWeight: 600 }}>RUNNER FAIL</div>
                                      <div style={{ fontSize: 18, fontWeight: 700, color: failed > 0 ? "var(--color-danger)" : "#e6edf3", marginTop: 2 }}>{failed}</div>
                                    </div>
                                    <div style={{ background: "rgba(245,158,11,0.06)", padding: "10px 12px", borderRadius: 6, border: "1px solid rgba(245,158,11,0.18)" }}>
                                      <div style={{ fontSize: 11, color: "var(--color-warning)", fontWeight: 600 }}>SKIPPED</div>
                                      <div style={{ fontSize: 18, fontWeight: 700, color: "#e6edf3", marginTop: 2 }}>{skipped}</div>
                                    </div>
                                    <div style={{ background: "rgba(255,255,255,0.02)", padding: "10px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)" }}>
                                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", fontWeight: 600 }} title="Tỷ lệ assertions thành công của test runner Jest">Runner Assertion Pass Rate</div>
                                      <div style={{ fontSize: 18, fontWeight: 700, color: passRate >= 80 ? "var(--color-success)" : passRate > 0 ? "var(--color-warning)" : "#8b949e", marginTop: 2 }}>
                                        {passRate}%
                                      </div>
                                    </div>
                                    <div style={{ background: "rgba(56,189,248,0.06)", padding: "10px 12px", borderRadius: 6, border: "1px solid rgba(56,189,248,0.18)" }}>
                                      <div style={{ fontSize: 11, color: "#38bdf8", fontWeight: 600 }} title="Thời gian phản hồi trung bình của từng HTTP request thực tế">AVG REQUEST LATENCY</div>
                                      <div style={{ fontSize: 18, fontWeight: 700, color: "#e6edf3", marginTop: 2 }}>
                                        {summary?.avgRequestLatencyMs ?? (summary?.avgEndpointLatencyMs || 0)}<span style={{ fontSize: 12, fontWeight: 500, color: "#8b949e" }}>ms</span>
                                      </div>
                                    </div>
                                  </div>

                                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, fontSize: 12, color: "#8b949e", padding: "0 2px" }}>
                                    <span>Tổng kịch bản: <strong style={{ color: "#e6edf3" }}>{total}</strong></span>
                                    <span>Đã chạy: <strong style={{ color: "#e6edf3" }}>{executed}</strong> (Pass: {passed} | Fail: {failed})</span>
                                    <span>Bỏ qua: <strong style={{ color: "var(--color-warning)" }}>{skipped}</strong></span>
                                    <span>Chưa chạy: <strong style={{ color: "#8b949e" }}>{unexecuted}</strong></span>
                                    <span>Avg Endpoint Latency: <strong style={{ color: "#38bdf8" }}>{summary?.avgEndpointLatencyMs || 0}ms</strong></span>
                                    <span>Thời lượng Suite: <strong style={{ color: "#a5d6ff" }}>{summary?.durationMs || 0}ms</strong></span>
                                  </div>

                                  {/* QA Trustworthy Quality Classification Breakdown */}
                                  {summary?.qualityClassification && (
                                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: "#e6edf3", display: "flex", alignItems: "center", gap: 6 }}>
                                          <span>🎯 Phân loại chất lượng kiểm thử (Trustworthy QA Classification)</span>
                                        </div>
                                        <div style={{ fontSize: 11, color: "#8b949e" }}>
                                          Kịch bản hợp lệ đã chạy: <strong style={{ color: "#38bdf8" }}>{summary.qualityClassification.validExecuted}</strong> / {summary.qualityClassification.total}
                                        </div>
                                      </div>
                                      <div
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                                          gap: 6,
                                          fontSize: 11,
                                        }}
                                      >
                                        <div style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 5, padding: "6px 8px" }}>
                                          <div style={{ color: "#22c55e", fontWeight: 600 }}>Passed (Code)</div>
                                          <div style={{ fontSize: 14, fontWeight: 700, color: "#e6edf3", marginTop: 2 }}>{summary.qualityClassification.passed}</div>
                                        </div>
                                        <div style={{ background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.15)", borderRadius: 5, padding: "6px 8px" }}>
                                          <div style={{ color: "#38bdf8", fontWeight: 600 }}>Consistent</div>
                                          <div style={{ fontSize: 14, fontWeight: 700, color: "#e6edf3", marginTop: 2 }}>{summary.qualityClassification.implementationConsistent ?? summary.qualityClassification.passed}</div>
                                        </div>
                                        <div style={{ background: summary.qualityClassification.assertionFailures > 0 ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.02)", border: summary.qualityClassification.assertionFailures > 0 ? "1px solid rgba(239,68,68,0.25)" : "1px solid rgba(255,255,255,0.05)", borderRadius: 5, padding: "6px 8px" }}>
                                          <div style={{ color: summary.qualityClassification.assertionFailures > 0 ? "#f87171" : "#8b949e", fontWeight: 600 }}>Assertion Failures</div>
                                          <div style={{ fontSize: 14, fontWeight: 700, color: summary.qualityClassification.assertionFailures > 0 ? "#f87171" : "#e6edf3", marginTop: 2 }}>{summary.qualityClassification.assertionFailures}</div>
                                        </div>
                                        <div style={{ background: summary.qualityClassification.testScriptErrors > 0 ? "rgba(249,115,22,0.08)" : "rgba(255,255,255,0.02)", border: summary.qualityClassification.testScriptErrors > 0 ? "1px solid rgba(249,115,22,0.25)" : "1px solid rgba(255,255,255,0.05)", borderRadius: 5, padding: "6px 8px" }}>
                                          <div style={{ color: summary.qualityClassification.testScriptErrors > 0 ? "#fb923c" : "#8b949e", fontWeight: 600 }} title="Lỗi cú pháp hoặc mock functions không hợp lệ trong file test">Test-Script Errors</div>
                                          <div style={{ fontSize: 14, fontWeight: 700, color: summary.qualityClassification.testScriptErrors > 0 ? "#fb923c" : "#e6edf3", marginTop: 2 }}>{summary.qualityClassification.testScriptErrors}</div>
                                        </div>
                                        <div style={{ background: summary.qualityClassification.invalidTests > 0 ? "rgba(168,85,247,0.08)" : "rgba(255,255,255,0.02)", border: summary.qualityClassification.invalidTests > 0 ? "1px solid rgba(168,85,247,0.25)" : "1px solid rgba(255,255,255,0.05)", borderRadius: 5, padding: "6px 8px" }}>
                                          <div style={{ color: summary.qualityClassification.invalidTests > 0 ? "#c084fc" : "#8b949e", fontWeight: 600 }} title="Kỳ vọng không hợp lệ hoặc test đặt tên lỗi nhà cung cấp nhưng không kích hoạt lỗi">Invalid Tests</div>
                                          <div style={{ fontSize: 14, fontWeight: 700, color: summary.qualityClassification.invalidTests > 0 ? "#c084fc" : "#e6edf3", marginTop: 2 }}>{summary.qualityClassification.invalidTests}</div>
                                        </div>
                                        <div style={{ background: summary.qualityClassification.contractUnverified > 0 ? "rgba(234,179,8,0.08)" : "rgba(255,255,255,0.02)", border: summary.qualityClassification.contractUnverified > 0 ? "1px solid rgba(234,179,8,0.25)" : "1px solid rgba(255,255,255,0.05)", borderRadius: 5, padding: "6px 8px" }}>
                                          <div style={{ color: summary.qualityClassification.contractUnverified > 0 ? "#facc15" : "#8b949e", fontWeight: 600 }} title="Khớp hành vi 500 hiện tại của backend nhưng chưa có đặc tả API contract độc lập">Contract Unverified</div>
                                          <div style={{ fontSize: 14, fontWeight: 700, color: summary.qualityClassification.contractUnverified > 0 ? "#facc15" : "#e6edf3", marginTop: 2 }}>{summary.qualityClassification.contractUnverified || 0}</div>
                                        </div>
                                        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 5, padding: "6px 8px" }}>
                                          <div style={{ color: "#8b949e", fontWeight: 600 }} title="Số kịch bản có căn cứ API Contract độc lập (OpenAPI/Swagger)">Contract Verified</div>
                                          <div style={{ fontSize: 14, fontWeight: 700, color: "#8b949e", marginTop: 2 }}>{summary.qualityClassification.contractVerified || 0}</div>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {generation?.generatedScenarios && generation.generatedScenarios !== total && (
                                    <div style={{ 
                                      marginTop: 10, 
                                      fontSize: 11, 
                                      color: "#a5d6ff", 
                                      background: "rgba(56, 139, 253, 0.08)", 
                                      padding: "6px 10px", 
                                      borderRadius: 6, 
                                      border: "1px solid rgba(56, 139, 253, 0.2)",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6
                                    }}>
                                      <span>ℹ️</span>
                                      <span>Lần chạy gần nhất ghi nhận <strong>{total}</strong> kịch bản. Mã nguồn hiện có <strong>{generation.generatedScenarios}</strong> kịch bản (chạy lại test để cập nhật toàn bộ).</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12, fontSize: 11, color: "var(--color-text-muted)" }}>
                              <strong>Evidence Linkage:</strong>
                              <ul style={{ paddingLeft: 16, margin: "4px 0 0 0" }}>
                                {executionJobId && <li>Job ID: <code style={{ color: "var(--color-primary)" }}>{executionJobId}</code></li>}
                                {testRunId && <li>TestRun ID: <code style={{ color: "var(--color-primary)" }}>{testRunId}</code></li>}
                                {workspace?.jobs?.execute?.createdAt && <li>Started At: {new Date(workspace.jobs.execute.createdAt).toLocaleString()}</li>}
                                {summary?.durationMs > 0 && <li>Duration: {summary.durationMs}ms</li>}
                              </ul>
                            </div>
                          </div>
                        );
                      })()}

                      {/* TARGETED ENDPOINTS VERIFICATION BREAKDOWN */}
                      <div
                        style={{
                          padding: 16,
                          background: "rgba(255,255,255,.02)",
                          border: "1px solid rgba(255,255,255,.05)",
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                          <div>
                            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#e6edf3" }}>
                              Chi tiết kiểm thử từng API Endpoint
                            </h4>
                            <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>
                              Chỉ rõ endpoint nào đã được test, tính nhất quán code và xác minh contract độc lập
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(34,197,94,0.12)", color: "#22c55e", fontWeight: 600 }} title="Số endpoint đã kiểm thử nhất quán với implementation code">
                              {summary?.implementationConsistentApis ?? summary?.executedApis ?? (summary?.testedApis || 0)} Khớp Code (Consistent)
                            </span>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(234,179,8,0.12)", color: "#facc15", fontWeight: 600 }} title="Số endpoint được xác minh theo tài liệu API Contract độc lập (OpenAPI/Swagger)">
                              {summary?.contractVerifiedApis ?? 0} Xác minh Contract (UNVERIFIED)
                            </span>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(56,189,248,0.12)", color: "#38bdf8", fontWeight: 600 }} title="Số endpoint có request HTTP thực tế được gửi và chạy">
                              {summary?.executedApis !== undefined ? summary.executedApis : (summary?.testedApis || 0)} Đã thực thi
                            </span>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(139,148,158,0.12)", color: "#8b949e", fontWeight: 600 }}>
                              {(summary?.discoveredApis || 0) - (summary?.testedApis || 0)} Chưa chạy
                            </span>
                          </div>
                        </div>

                        {/* ENDPOINT LIST */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {endpoints.map((ep) => {
                            const isTested = ep.executedCount > 0;
                            const isCovered = ep.status === "Covered";
                            const isPartial = ep.status === "Partial";

                            let badgeBg = "rgba(139,148,158,0.12)";
                            let badgeBorder = "rgba(139,148,158,0.25)";
                            let badgeColor = "#8b949e";
                            let badgeText = "Chưa test trong đợt này";

                            if (isCovered) {
                              badgeBg = "rgba(34,197,94,0.12)";
                              badgeBorder = "rgba(34,197,94,0.3)";
                              badgeColor = "#22c55e";
                              badgeText = `Đã test (Pass ${ep.passedCount}/${ep.executedCount})`;
                            } else if (isPartial) {
                              badgeBg = "rgba(245,158,11,0.12)";
                              badgeBorder = "rgba(245,158,11,0.3)";
                              badgeColor = "#fbbf24";
                              badgeText = `Một phần (Pass ${ep.passedCount}/${ep.executedCount})`;
                            } else if (ep.failedCount > 0) {
                              badgeBg = "rgba(239,68,68,0.12)";
                              badgeBorder = "rgba(239,68,68,0.3)";
                              badgeColor = "#f87171";
                              badgeText = `Thất bại (${ep.failedCount} lỗi)`;
                            }

                            const methodColor = ep.method === "GET" ? "#38bdf8" : ep.method === "POST" ? "#4ade80" : ep.method === "DELETE" ? "#f87171" : "#fbbf24";

                            return (
                              <div
                                key={`${ep.method}-${ep.path}`}
                                style={{
                                  background: "rgba(255,255,255,0.015)",
                                  border: isTested ? "1px solid rgba(34,197,94,0.18)" : "1px solid rgba(255,255,255,0.05)",
                                  borderRadius: 6,
                                  padding: "10px 14px",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 6,
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{ 
                                      fontSize: 11, 
                                      fontWeight: 700, 
                                      color: methodColor, 
                                      background: "rgba(255,255,255,0.05)", 
                                      padding: "2px 6px", 
                                      borderRadius: 4,
                                      fontFamily: "monospace"
                                    }}>
                                      {ep.method}
                                    </span>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3", fontFamily: "monospace" }}>
                                      {ep.path}
                                    </span>
                                    {ep.source?.controllerMethod && (
                                      <span style={{ fontSize: 11, color: "#8b949e" }}>
                                        → {ep.source.controllerMethod}
                                      </span>
                                    )}

                                    {/* LATENCY PER ENDPOINT */}
                                    {isTested && ep.avgDurationMs > 0 && (
                                      <span
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 600,
                                          color: ep.latencyStatus === "FAST" ? "#22c55e" : ep.latencyStatus === "SLOW" ? "#f87171" : "#fbbf24",
                                          background: ep.latencyStatus === "FAST" ? "rgba(34,197,94,0.1)" : ep.latencyStatus === "SLOW" ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.1)",
                                          border: `1px solid ${ep.latencyStatus === "FAST" ? "rgba(34,197,94,0.25)" : ep.latencyStatus === "SLOW" ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.25)"}`,
                                          padding: "2px 7px",
                                          borderRadius: 4,
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 4,
                                        }}
                                        title={`Thời gian phản hồi trung bình: ${ep.avgDurationMs}ms (Min: ${ep.minDurationMs}ms | Max: ${ep.maxDurationMs}ms)`}
                                      >
                                        <Clock size={11} />
                                        <span>{ep.avgDurationMs}ms</span>
                                        {ep.latencyStatus === "SLOW" && <span style={{ fontSize: 10, fontWeight: 700 }}>(Chậm)</span>}
                                      </span>
                                    )}
                                  </div>

                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{
                                      fontSize: 11,
                                      fontWeight: 600,
                                      color: badgeColor,
                                      background: badgeBg,
                                      border: `1px solid ${badgeBorder}`,
                                      padding: "2px 8px",
                                      borderRadius: 4,
                                    }}>
                                      {badgeText}
                                    </span>

                                    {!isTested && (
                                      <button
                                        type="button"
                                        onClick={() => handleRunRemainingEndpoints([ep])}
                                        disabled={isJobActive || pendingAction === "RUN_REMAINING" || pendingAction === "GENERATE"}
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 4,
                                          background: "rgba(56, 189, 248, 0.12)",
                                          color: "#38bdf8",
                                          border: "1px solid rgba(56, 189, 248, 0.3)",
                                          borderRadius: 4,
                                          padding: "2px 8px",
                                          fontSize: 11,
                                          fontWeight: 600,
                                          cursor: isJobActive || pendingAction === "RUN_REMAINING" || pendingAction === "GENERATE" ? "not-allowed" : "pointer",
                                          opacity: isJobActive || pendingAction === "RUN_REMAINING" || pendingAction === "GENERATE" ? 0.6 : 1,
                                          transition: "all 0.15s ease",
                                        }}
                                        title={
                                          (ep.generatedCount || 0) > 0
                                            ? "Chạy kiểm thử riêng endpoint này"
                                            : "Tạo kịch bản kiểm thử cho riêng endpoint này"
                                        }
                                      >
                                        <Play size={10} fill="#38bdf8" />
                                        <span>
                                          {(ep.generatedCount || 0) > 0 ? "Chạy endpoint này" : "Tạo test endpoint này"}
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Scenarios executed details & Failure Diff Viewer */}
                                {ep.scenarios && ep.scenarios.length > 0 ? (
                                  <div style={{ 
                                    marginTop: 4, 
                                    paddingTop: 6, 
                                    borderTop: "1px solid rgba(255,255,255,0.04)", 
                                    display: "flex", 
                                    flexDirection: "column", 
                                    gap: 6 
                                  }}>
                                    {ep.scenarios.map((sc, scIdx) => {
                                      const scKey = `${ep.method}-${ep.path}-${sc.title}-${scIdx}`;
                                      const isFailed = sc.status === "failed";
                                      const isExpanded = expandedScenarios[scKey] ?? isFailed;

                                      return (
                                        <div key={scIdx} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                          <div
                                            onClick={() => toggleExpandScenario(scKey)}
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "space-between",
                                              fontSize: 11,
                                              padding: "6px 10px",
                                              borderRadius: 5,
                                              background: isFailed ? "rgba(239,68,68,0.08)" : isExpanded ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
                                              border: isFailed ? "1px solid rgba(239,68,68,0.25)" : "1px solid rgba(255,255,255,0.03)",
                                              cursor: "pointer",
                                              transition: "all 0.15s ease",
                                            }}
                                          >
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#c9d1d9", flexWrap: "wrap" }}>
                                              <span style={{ color: sc.status === "passed" ? "#22c55e" : isFailed ? "#f87171" : sc.status === "not_run" ? "#eab308" : "#8b949e", fontWeight: "bold" }}>
                                                {sc.status === "passed" ? "✓" : isFailed ? "✗" : "○"}
                                              </span>

                                              {/* Scenario Type Badge */}
                                              {(() => {
                                                const sType = sc.scenarioType || (sc.title?.toLowerCase().includes("happy") ? "HAPPY_PATH" : "NEGATIVE");
                                                const color = sType === "HAPPY_PATH" ? "#38bdf8" : sType === "VALIDATION" ? "#c084fc" : sType === "EDGE_CASE" ? "#818cf8" : "#fb923c";
                                                const bg = sType === "HAPPY_PATH" ? "rgba(56,189,248,0.12)" : sType === "VALIDATION" ? "rgba(192,132,252,0.12)" : sType === "EDGE_CASE" ? "rgba(129,140,248,0.12)" : "rgba(251,146,60,0.12)";
                                                return (
                                                  <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, fontWeight: 700, background: bg, color, border: `1px solid ${color}33`, letterSpacing: "0.5px" }}>
                                                    {sType.replace(/_/g, " ")}
                                                  </span>
                                                );
                                              })()}

                                              {/* Resolved URL Badge */}
                                              <code style={{ fontSize: 10, color: "#7ee787", background: "rgba(126,231,135,0.08)", padding: "1px 5px", borderRadius: 3, fontFamily: "monospace" }} title="Resolved Request URL">
                                                {sc.resolvedUrl || sc.path || ep.path}
                                              </code>

                                              <span style={{ fontWeight: isFailed ? 600 : 400, color: isFailed ? "#fca5a5" : sc.status === "not_run" ? "#94a3b8" : "#e6edf3" }}>
                                                {sc.title}
                                              </span>

                                              {/* Runner Verdict Badge */}
                                              <span style={{
                                                fontSize: 9,
                                                padding: "1px 5px",
                                                borderRadius: 3,
                                                fontWeight: 700,
                                                background: sc.executionVerdict === "PASS" ? "rgba(34,197,94,0.12)" : sc.executionVerdict === "FAIL" ? "rgba(239,68,68,0.15)" : "rgba(234,179,8,0.15)",
                                                color: sc.executionVerdict === "PASS" ? "#22c55e" : sc.executionVerdict === "FAIL" ? "#f87171" : "#facc15",
                                                border: `1px solid ${sc.executionVerdict === "PASS" ? "#22c55e33" : sc.executionVerdict === "FAIL" ? "#f8717133" : "#facc1533"}`
                                              }}>
                                                RUNNER: {sc.executionVerdict || (sc.status === "passed" ? "PASS" : "FAIL")}
                                              </span>

                                              {/* QA Classification Badge */}
                                              <span style={{
                                                fontSize: 9,
                                                padding: "1px 5px",
                                                borderRadius: 3,
                                                fontWeight: 700,
                                                background: sc.classification === "PASSED" ? "rgba(34,197,94,0.12)" : sc.classification === "CONTRACT_UNVERIFIED" ? "rgba(234,179,8,0.15)" : sc.classification === "INVALID_TEST" ? "rgba(168,85,247,0.15)" : "rgba(239,68,68,0.15)",
                                                color: sc.classification === "PASSED" ? "#22c55e" : sc.classification === "CONTRACT_UNVERIFIED" ? "#facc15" : sc.classification === "INVALID_TEST" ? "#c084fc" : "#f87171",
                                                border: `1px solid ${sc.classification === "PASSED" ? "#22c55e33" : sc.classification === "CONTRACT_UNVERIFIED" ? "#facc1533" : sc.classification === "INVALID_TEST" ? "#c084fc33" : "#f8717133"}`
                                              }} title={sc.classificationReason || ""}>
                                                QA: {(sc.classification || "UNKNOWN").replace(/_/g, " ")}
                                              </span>

                                              {sc.status === "not_run" && (
                                                <span style={{ fontSize: 9, background: "rgba(234,179,8,0.15)", color: "#facc15", padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>
                                                  CHƯA CHẠY
                                                </span>
                                              )}
                                            </div>

                                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                              {/* Latency per scenario */}
                                              {sc.durationMs > 0 && (
                                                <span style={{ fontSize: 10, color: sc.durationMs > 250 ? "#f87171" : sc.durationMs > 80 ? "#fbbf24" : "#8b949e", fontFamily: "monospace" }}>
                                                  ⏱️ {sc.durationMs}ms
                                                </span>
                                              )}

                                              <span style={{ 
                                                fontSize: 10, 
                                                color: sc.status === "passed" ? "#22c55e" : isFailed ? "#f87171" : sc.status === "not_run" ? "#eab308" : "#8b949e",
                                                textTransform: "uppercase",
                                                fontWeight: 600
                                              }}>
                                                {sc.status === "not_run" ? "CHƯA CHẠY" : (sc.category || sc.status)}
                                              </span>

                                              <span style={{ fontSize: 10, color: isFailed ? "#f87171" : "#58a6ff", display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 500 }}>
                                                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                <span>{isFailed ? "Chi tiết lỗi & Diff" : "Payload"}</span>
                                              </span>
                                            </div>
                                          </div>

                                          {/* Expanded Failure Diff & Payload View */}
                                          {isExpanded && (
                                            <div
                                              style={{
                                                margin: "2px 0 6px 12px",
                                                padding: 12,
                                                background: isFailed ? "rgba(239,68,68,0.04)" : "rgba(255,255,255,0.02)",
                                                border: isFailed ? "1px solid rgba(239,68,68,0.2)" : "1px solid rgba(255,255,255,0.06)",
                                                borderRadius: 6,
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: 10,
                                              }}
                                            >
                                              {/* QA Classification Advisory Callout */}
                                              {isFailed && (sc.classification === "TEST_SCRIPT_ERROR" || sc.classification === "INVALID_TEST") && (
                                                <div style={{
                                                  padding: "8px 12px",
                                                  borderRadius: 5,
                                                  background: sc.classification === "TEST_SCRIPT_ERROR" ? "rgba(249,115,22,0.08)" : "rgba(168,85,247,0.08)",
                                                  border: sc.classification === "TEST_SCRIPT_ERROR" ? "1px solid rgba(249,115,22,0.25)" : "1px solid rgba(168,85,247,0.25)",
                                                  fontSize: 11,
                                                  color: sc.classification === "TEST_SCRIPT_ERROR" ? "#fdba74" : "#d8b4fe",
                                                  lineHeight: 1.4
                                                }}>
                                                  {sc.classification === "TEST_SCRIPT_ERROR"
                                                    ? "⚠️ Test Script Error: Lỗi runtime trong script kiểm thử (hàm mock bị gọi sai trên module CommonJS). Đây không phải lỗi từ backend API."
                                                    : "⚠️ Invalid Test: Kịch bản kiểm thử không hợp lệ (ví dụ: mong đợi HTTP 500 nhưng gửi dữ liệu mà backend xử lý thành công trả về 200 mà không kích hoạt lỗi nhà cung cấp)."}
                                                </div>
                                              )}
                                              {/* 1. FAILURE STEP & BROKEN CODE LINE */}
                                              {isFailed && sc.failureDetails && (
                                                <div>
                                                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 11, fontWeight: 700, color: "#f87171" }}>
                                                    <AlertTriangle size={14} />
                                                    <span>Dòng code bị gãy:</span>
                                                    {sc.failureDetails.brokenLineText && (
                                                      <code style={{ background: "rgba(239,68,68,0.15)", padding: "2px 6px", borderRadius: 4, color: "#fca5a5" }}>
                                                        {sc.failureDetails.brokenLineText}
                                                      </code>
                                                    )}
                                                    {sc.failureDetails.file && sc.failureDetails.line && (
                                                      <span style={{ color: "#8b949e", fontWeight: 400 }}>
                                                        ({sc.failureDetails.file}:{sc.failureDetails.line})
                                                      </span>
                                                    )}
                                                  </div>

                                                  {sc.failureDetails.codeSnippet && (
                                                    <pre
                                                      style={{
                                                        margin: 0,
                                                        padding: "8px 12px",
                                                        background: "#090d16",
                                                        border: "1px solid rgba(239,68,68,0.2)",
                                                        borderRadius: 5,
                                                        fontSize: 11,
                                                        fontFamily: "monospace",
                                                        color: "#fca5a5",
                                                        overflowX: "auto",
                                                        whiteSpace: "pre-wrap",
                                                        lineHeight: 1.5,
                                                      }}
                                                    >
                                                      {sc.failureDetails.codeSnippet}
                                                    </pre>
                                                  )}
                                                </div>
                                              )}

                                              {/* 2. GRID: PAYLOAD SENT vs RESPONSE RECEIVED / DIFF */}
                                              <div style={{ display: "grid", gridTemplateColumns: isFailed ? "1fr 1fr" : "1fr", gap: 10 }}>
                                                {/* Payload đã gửi */}
                                                <div style={{ background: "rgba(0,0,0,0.25)", padding: "8px 10px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.04)" }}>
                                                  <div style={{ fontSize: 11, fontWeight: 600, color: "#38bdf8", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                                                    <span>📤 Payload đã gửi ({ep.method}):</span>
                                                    {sc.queryParams && <span style={{ fontSize: 10, color: "#8b949e" }}>Query: {JSON.stringify(sc.queryParams)}</span>}
                                                  </div>
                                                  {sc.requestPayload && Object.keys(sc.requestPayload).length > 0 ? (
                                                    <pre
                                                      style={{
                                                        margin: 0,
                                                        fontSize: 11,
                                                        fontFamily: "monospace",
                                                        color: "#e6edf3",
                                                        background: "#0d1117",
                                                        padding: 8,
                                                        borderRadius: 4,
                                                        overflowX: "auto",
                                                      }}
                                                    >
                                                      {JSON.stringify(sc.requestPayload, null, 2)}
                                                    </pre>
                                                  ) : (
                                                    <div style={{ fontSize: 11, color: "#8b949e", fontStyle: "italic", padding: "4px 0" }}>
                                                      {ep.method === "GET" ? "GET request không có body (No payload body)." : "Empty body payload: {}"}
                                                    </div>
                                                  )}
                                                </div>

                                                {/* Response nhận được & Diff (if failed) */}
                                                {isFailed && sc.failureDetails && (
                                                  <div style={{ background: "rgba(0,0,0,0.25)", padding: "8px 10px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.04)" }}>
                                                    <div style={{ fontSize: 11, fontWeight: 600, color: "#fbbf24", marginBottom: 4 }}>
                                                      📥 Response nhận được & Sai lệch (Diff):
                                                    </div>
                                                    <div style={{ fontSize: 11, marginBottom: 4 }}>
                                                      <span style={{ color: "#8b949e" }}>Kỳ vọng (Expected): </span>
                                                      <strong style={{ color: "#22c55e" }}>{sc.failureDetails?.expected ? `HTTP ${sc.failureDetails.expected}` : sc.expectedStatus ? `HTTP ${sc.expectedStatus}` : "NOT_CAPTURED"}</strong>
                                                      {"  |  "}
                                                      <span style={{ color: "#8b949e" }}>Thực tế (Received): </span>
                                                      <strong style={{ color: "#f87171" }}>{sc.failureDetails?.received ? `HTTP ${sc.failureDetails.received}` : sc.actualStatus ? `HTTP ${sc.actualStatus}` : "NOT_CAPTURED"}</strong>
                                                    </div>
                                                    {sc.failureDetails.diff && (
                                                      <pre
                                                        style={{
                                                          margin: 0,
                                                          fontSize: 11,
                                                          fontFamily: "monospace",
                                                          color: "#e6edf3",
                                                          background: "#0d1117",
                                                          padding: 8,
                                                          borderRadius: 4,
                                                          overflowX: "auto",
                                                        }}
                                                      >
                                                        {sc.failureDetails.diff}
                                                      </pre>
                                                    )}
                                                  </div>
                                                )}
                                              </div>

                                              {/* Raw failure message fallback if no structured snippet */}
                                              {isFailed && sc.failureMessages && sc.failureMessages.length > 0 && !sc.failureDetails?.codeSnippet && (
                                                <div style={{ marginTop: 2 }}>
                                                  <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 2 }}>Thông báo lỗi từ Jest:</div>
                                                  <pre
                                                    style={{
                                                      margin: 0,
                                                      fontSize: 10,
                                                      color: "#fca5a5",
                                                      background: "#090d16",
                                                      padding: 8,
                                                      borderRadius: 4,
                                                      overflowX: "auto",
                                                      whiteSpace: "pre-wrap",
                                                    }}
                                                  >
                                                    {sc.failureMessages.join("\n")}
                                                  </pre>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: 11, color: "#8b949e", fontStyle: "italic", paddingTop: 2 }}>
                                    Endpoint này không được chọn trong đợt chạy test vừa rồi (0 kịch bản thực thi).
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* API ENDPOINT COVERAGE */}
                      {(() => {
                        const prov = summary?.provenance?.apiCoverage;
                        return (
                          <div
                            style={{
                              padding: 16,
                              background: "rgba(255,255,255,.02)",
                              border: "1px solid rgba(255,255,255,.05)",
                              borderRadius: 8,
                            }}
                          >
                            <div
                              style={{
                                color: "#8b949e",
                                fontSize: 12,
                                textTransform: "uppercase",
                                fontWeight: 600,
                                marginBottom: 12,
                                display: "flex",
                                justifyContent: "space-between"
                              }}
                            >
                              <MetricProvenancePopover provenance={prov}>
                                <span>API Endpoint Coverage</span>
                              </MetricProvenancePopover>
                            </div>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                fontSize: 13,
                              }}
                            >
                              <div style={{ color: "#e6edf3" }}>
                                <strong>{summary?.testedApis || 0}</strong> / {summary?.discoveredApis || 0} endpoints tested
                              </div>
                              <div style={{ color: summary?.testedApis > 0 ? "#22c55e" : "#fbbf24", fontWeight: "bold", fontSize: 16 }}>
                                {summary?.discoveredApis > 0 ? Math.round(((summary?.testedApis || 0) / summary.discoveredApis) * 100) : 0}%
                              </div>
                            </div>
                            {summary?.testedApis < summary?.discoveredApis && (
                              <div style={{ marginTop: 8, fontSize: 11, color: "#8b949e" }}>
                                ℹ️ Trong đợt này đã kiểm thử thành công <strong>{summary?.testedApis || 0}</strong> endpoints. Còn <strong>{(summary?.discoveredApis || 0) - (summary?.testedApis || 0)}</strong> endpoint chưa đưa vào lượt chạy này.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      
                      {/* COVERAGE SEMANTICS */}
                      {(() => {
                        const cov = summary?.codeCoverage;
                        if (!cov) {
                          return (
                            <div
                              style={{
                                padding: 16,
                                background: "rgba(255,255,255,.02)",
                                border: "1px solid rgba(255,255,255,.05)",
                                borderRadius: 8,
                                color: "#8b949e",
                                fontSize: 13
                              }}
                            >
                              <div style={{ color: "#e6edf3", fontWeight: 600, marginBottom: 4 }}>Coverage Not Collected</div>
                              Coverage data is unavailable for this execution.
                            </div>
                          );
                        }

                        const renderMetric = (label, value) => {
                          const num = Number(value);
                          const isZero = num === 0;
                          const color = isZero ? "#f87171" : num > 80 ? "#22c55e" : "#fbbf24";
                          return (
                            <div>
                              {label}:{" "}
                              <strong style={{ color }}>
                                {num.toFixed(1)}%
                              </strong>
                            </div>
                          );
                        };

                        return (
                          <div
                            style={{
                              padding: 16,
                              background: "rgba(255,255,255,.02)",
                              border: "1px solid rgba(255,255,255,.05)",
                              borderRadius: 8,
                            }}
                          >
                            <div
                              style={{
                                color: "#8b949e",
                                fontSize: 12,
                                textTransform: "uppercase",
                                fontWeight: 600,
                                marginBottom: 12,
                                display: "flex",
                                justifyContent: "space-between"
                              }}
                            >
                              <MetricProvenancePopover provenance={summary?.provenance?.codeCoverage}>
                                <span>Code Coverage</span>
                              </MetricProvenancePopover>
                              <span style={{ fontSize: 10, textTransform: "none", color: "var(--color-text-muted)" }}>Source: TestRun Artifacts</span>
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 12,
                                fontSize: 13,
                              }}
                            >
                              {renderMetric("Statements", cov.statement)}
                              {renderMetric("Branches", cov.branch)}
                              {renderMetric("Functions", cov.function)}
                              {renderMetric("Lines", cov.line)}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    )}
                  </div>
                )}
                {activeStage === "HISTORY" && (
                  <IntegrationHistoryPane snapshotId={snapshotId} />
                )}
              </div>
            </div>
          )}
          </IntegrationErrorBoundary>
        </div>
      </div>
    </div>
  );
}
