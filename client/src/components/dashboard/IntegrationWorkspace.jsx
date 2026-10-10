import React, { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  getIntegrationWorkspace,
  runCoverageByType,
} from "../../services/coverage.service.js";
import { runProjectStructureAnalysisApi } from "../../services/project.service.js";
import { Search, Zap, CheckCircle2, PlayCircle, BarChart3, ChevronRight } from "lucide-react";

import IntegrationTargetsPane from "./integration/IntegrationTargetsPane.jsx";
import IntegrationScenariosPane from "./integration/IntegrationScenariosPane.jsx";
import IntegrationLiveProgress from "./integration/IntegrationLiveProgress.jsx";
import IntegrationHistoryPane from "./integration/IntegrationHistoryPane.jsx";
import MetricProvenancePopover from "./integration/MetricProvenancePopover.jsx";
import IntegrationEndpointDetail from "./integration/IntegrationEndpointDetail.jsx";

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

    const token = localStorage.getItem("token");
    const eventSource = new EventSource(
      `${BASE_URL}/job/${jobId}/stream?token=${token}`,
    );
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.error) {
          eventSource.close();
          onError(new Error(data.error));
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
          eventSource.close();
          onCompleteRef.current();
        } else if (data.status === "FAILED") {
          eventSource.close();
          onErrorRef.current(new Error(data.errorMessage || "Job failed"));
        } else if (data.status === "CANCELED") {
          eventSource.close();
          onErrorRef.current(new Error("Job was canceled"));
        }
      } catch (err) {
        console.error("Failed to parse SSE message:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("EventSource error:", err);
      eventSource.close();
      onErrorRef.current(new Error("Lost connection to job stream"));
    };

    return () => eventSource.close();
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
    return params.get("stage") || "ANALYZE";
  });
  const [pendingAction, setPendingAction] = useState(null);
  const [selectedTargetEndpoints, setSelectedTargetEndpoints] = useState(new Set());

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
    if (!snapshotId) return;
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
            if (prev === "RUN" || prev === "REPORT" || prev === "APPROVE") return prev;
            if (res.data?.aiTests?.length > 0) return "GENERATE";
            if (fetchedJobs.analyze?.status === "SUCCESS") return "ANALYZE";
            return prev;
          });
        }
      }

      // Preserve previously selected test ids if they still exist, otherwise reset to all
      if (res.data?.aiTests && selectedTestIds.length === 0) {
        const allIds = res.data.aiTests.flatMap((t) =>
          t.requests.map((r) => `${t.id}::${r.testName}`),
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

  const { logs: activeLogs, logsEndRef } = useLiveJobLogs(
    activeJobId,
    () => {
      setActiveJobId(null);
      setActiveJobType(null);
      setActiveJobStatus("RUNNING");
      load();
    },
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

  if (loading && !workspace)
    return (
      <div style={{ padding: 40, color: "#e6edf3" }}>Loading workspace...</div>
    );

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
            { id: "GENERATE", label: "Generate", icon: Zap },
            { id: "APPROVE", label: "Approve", icon: CheckCircle2 },
            { id: "RUN", label: "Run", icon: PlayCircle },
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
                style={!hasAnalysis || isJobActive || pendingAction === "GENERATE" ? disabledButtonStyle : buttonStyle("var(--color-primary)", true)}
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
            </div>
          )}
          {activeStage === "APPROVE" && (
             <button
               onClick={handleApprove}
               disabled={!hasGeneratedTests || isJobActive || selectedTestIds.length === 0 || pendingAction === "APPROVE"}
               style={!hasGeneratedTests || isJobActive || selectedTestIds.length === 0 || pendingAction === "APPROVE" ? disabledButtonStyle : buttonStyle("var(--color-warning, #fbbf24)", true)}
             >
               {pendingAction === "APPROVE" ? "Approving..." : (isApproved ? "Update Approval" : "Approve Selected")}
             </button>
          )}
          {activeStage === "RUN" && (
             <button
               onClick={handleRunApprovedTests}
               disabled={!isApproved || isJobActive || pendingAction === "RUN"}
               style={!isApproved || isJobActive || pendingAction === "RUN" ? disabledButtonStyle : buttonStyle("var(--color-info, #3b82f6)", true)}
             >
               {pendingAction === "RUN" ? "Starting..." : (execution ? "Run Tests Again" : "Run Tests")}
             </button>
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
          {activeStage === "ANALYZE" || activeStage === "GENERATE" || activeStage === "APPROVE" ? (
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
          ) : activeStage === "RUN" ? (
             <div style={{padding: 16, color: "var(--color-text-secondary)"}}>Execution Results</div>
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
          {activeJobId && (activeJobType === activeStage || (activeStage === "RUN" && activeJobType === "EXECUTE")) ? (
             <IntegrationLiveProgress
               activeJobId={activeJobId}
               activeJobType={activeJobType}
               activeJobStatus={activeJobStatus}
               error={error}
               activeLogs={activeLogs}
               parseProgressSteps={parseProgressSteps}
             />
          ) : activeStage === "ANALYZE" && selectedEndpointId !== null ? (
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
              isGenerating={pendingAction === "GENERATE" || (activeJobId && activeJobType === "GENERATE")}
            />
          ) : (activeStage === "GENERATE" || activeStage === "APPROVE") ? (
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
                        
                        if (pendingAction === "RUN" || (activeJobType === "EXECUTE" && activeJobStatus === "RUNNING" && semanticState === "NOT_EXECUTED")) {
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
                        } else if (semanticState === "SUCCESS") {
                          title = "Success";
                          description = "All tests passed successfully.";
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
                            
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                color: "#8b949e",
                                fontSize: 13,
                              }}
                            >
                              <span>
                                Passed:{" "}
                                <strong style={{ color: "#e6edf3" }}>
                                  {summary?.passedTests || 0}
                                </strong>
                              </span>
                              <span>
                                Failed:{" "}
                                <strong style={{ color: "#e6edf3" }}>
                                  {summary?.failedTests || 0}
                                </strong>
                              </span>
                              <span>
                                Skipped:{" "}
                                <strong style={{ color: "#e6edf3" }}>
                                  {summary?.skippedTests || 0}
                                </strong>
                              </span>
                              <span>
                                Total:{" "}
                                <strong style={{ color: "#e6edf3" }}>
                                  {summary?.totalTests || 0}
                                </strong>
                              </span>
                            </div>

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
        </div>
      </div>
    </div>
  );
}
