import React, { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  getIntegrationWorkspace,
  runCoverageByType,
} from "../../services/coverage.service.js";
import { runProjectStructureAnalysisApi } from "../../services/project.service.js";

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
  const [selectedEndpointIndex, setSelectedEndpointIndex] = useState(() => {
    return (initialContext && initialContext.snapshotId === snapshotId) 
      ? (initialContext.selectedEndpointIndex ?? null) 
      : null;
  });
  const [rightPaneTab, setRightPaneTab] = useState(() => {
    return (initialContext && initialContext.snapshotId === snapshotId) 
      ? (initialContext.rightPaneTab ?? "SUMMARY") 
      : "SUMMARY";
  });

  // 1. Sync context upwards when it changes
  useEffect(() => {
    if (onContextChange && snapshotId && projectId) {
      onContextChange({
        snapshotId,
        projectId,
        rightPaneTab,
        selectedEndpointIndex,
        cachedWorkspace: workspace
      });
    }
  }, [rightPaneTab, selectedEndpointIndex, snapshotId, projectId, workspace, onContextChange]);


  // 3. Fallback safely if selected endpoint index is out of bounds
  useEffect(() => {
    if (workspace?.endpoints && selectedEndpointIndex !== null) {
      if (selectedEndpointIndex >= workspace.endpoints.length) {
        setSelectedEndpointIndex(null);
        setRightPaneTab("SUMMARY");
      }
    }
  }, [workspace?.endpoints, selectedEndpointIndex]);

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
          setRightPaneTab("LIVE");
        } else if (!initialContext || initialContext.snapshotId !== snapshotId) {
          if (fetchedJobs.analyze?.status === "SUCCESS" || res.data?.aiTests?.length > 0) {
            setRightPaneTab((prev) => prev === "LIVE" ? "SUMMARY" : prev);
          }
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

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("subtab") === "history") {
      setRightPaneTab("HISTORY");
    }
  }, [location.search]);

  const { logs: activeLogs, logsEndRef } = useLiveJobLogs(
    activeJobId,
    () => {
      setActiveJobId(null);
      setActiveJobType(null);
      setActiveJobStatus("RUNNING");
      load();
      setRightPaneTab("SUMMARY");
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
    setRightPaneTab("LIVE");
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
    }
  };

  const handleGenerateClick = async () => {
    if (
      !workspace?.generation?.hasAnalysis ||
      (activeJobId && activeJobStatus !== "FAILED")
    )
      return;
    setError("");
    setRightPaneTab("LIVE");
    try {
      const res = await onGenerate();
      if (res === undefined) return; // User was shown the overwrite confirm modal
      const jobId = res?.data?.job?.id;
      if (jobId) {
        setActiveJobId(jobId);
        setActiveJobType("GENERATE");
        setActiveJobStatus("RUNNING");
      } else throw new Error("Backend failed to return a generation Job ID.");
    } catch (err) {
      setError(err.message || "Generation failed.");
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
    try {
      await approveIntegrationTestsApi(snapshotId, selectedTestIds);
      await load();
    } catch (err) {
      setError(err.message || "Approval failed.");
    }
  };

  const handleRunApprovedTests = async () => {
    if (!snapshotId || (activeJobId && activeJobStatus !== "FAILED")) return;
    setError("");
    setRightPaneTab("LIVE");
    try {
      const response = await runCoverageByType(snapshotId, "integration");
      if (response.data?.job?.id) {
        setActiveJobId(response.data.job.id);
        setActiveJobType("EXECUTE");
        setActiveJobStatus("RUNNING");
      }
    } catch (err) {
      setError(err.message || "Test execution failed.");
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
            textLogs.includes("hoàn thành") ||
            textLogs.includes("Hoàn thành"),
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
            textLogs.includes("Bắt đầu") ||
            textLogs.includes("TestRun"),
        },
        {
          label: "Execute tests",
          done:
            hasStage("RUN_JEST") ||
            textLogs.includes("Bắt đầu") ||
            textLogs.includes("TestRun"),
        },
        {
          label: "Collect results",
          done:
            hasStage("PARSE_COVERAGE") ||
            textLogs.includes("TestRun") ||
            textLogs.includes("hoàn thành"),
        },
        {
          label: "Map tests to endpoints",
          done:
            hasStage("MAP_RESULTS") ||
            textLogs.includes("TestRun") ||
            textLogs.includes("hoàn thành"),
        },
        {
          label: "Collect coverage",
          done:
            hasStage("MAP_RESULTS") ||
            textLogs.includes("TestRun") ||
            textLogs.includes("hoàn thành"),
        },
        {
          label: "Build report",
          done: hasStage("COMPLETE") || textLogs.includes("hoàn thành"),
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
    selectedEndpointIndex !== null ? endpoints[selectedEndpointIndex] : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      {/* TOP BAR */}
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--color-surface)",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            Integration Testing Workbench
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                background: "rgba(109,93,251,.1)",
                color: "var(--color-primary)",
                borderRadius: 12,
                border: "1px solid var(--color-primary)",
                fontWeight: 600,
              }}
            >
              Phase 2
            </span>
            {refreshing && (
              <span style={{ fontSize: 11, color: "var(--color-info)", opacity: 0.8, display: "flex", alignItems: "center", gap: 4 }}>
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                Refreshing...
              </span>
            )}
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleRunAnalysis}
            disabled={isJobActive}
            style={
              isJobActive
                ? disabledButtonStyle
                : buttonStyle("var(--color-text-secondary)")
            }
          >
            Analyze Project
          </button>
          <button
            onClick={handleGenerateClick}
            disabled={!hasAnalysis || isJobActive}
            style={
              !hasAnalysis || isJobActive
                ? disabledButtonStyle
                : buttonStyle("var(--color-primary)")
            }
          >
            Generate Tests
          </button>
          <button
            onClick={handleApprove}
            disabled={!hasGeneratedTests || isApproved || isJobActive}
            style={
              !hasGeneratedTests || isApproved || isJobActive
                ? disabledButtonStyle
                : buttonStyle("var(--color-warning, #fbbf24)")
            }
          >
            {isApproved ? "Approved" : "Approve Selected"}
          </button>
          <button
            onClick={handleRunApprovedTests}
            disabled={!isApproved || isJobActive}
            style={
              !isApproved || isJobActive
                ? disabledButtonStyle
                : buttonStyle("var(--color-info, #3b82f6)")
            }
          >
            Run Tests
          </button>
          <button
            onClick={() =>
              navigate(`/project/${projectId}/reports/integration`)
            }
            style={buttonStyle("var(--color-success, #10b981)")}
          >
            View Report
          </button>
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
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* LEFT PANE (MASTER): Targets */}
        <div
          style={{
            width: 300,
            minWidth: 260,
            borderRight: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <IntegrationTargetsPane
            endpoints={endpoints}
            selectedEndpointIndex={selectedEndpointIndex}
            onSelectEndpoint={setSelectedEndpointIndex}
            hasAnalysis={hasAnalysis}
          />
        </div>

        {/* RIGHT PANE (DETAIL): Context */}
        <div
          style={{
            flex: 1,
            minWidth: 500,
            background: "var(--color-bg)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
          }}
        >
          {selectedEndpointIndex !== null ? (
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
            />
          ) : (
            <div className="flex flex-col h-full bg-[var(--color-surface)]">
              <div
                style={{
                  display: "flex",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <div
                  onClick={() => setRightPaneTab("LIVE")}
                  style={{
                    flex: 1,
                    padding: "12px",
                    textAlign: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    color:
                      rightPaneTab === "LIVE"
                        ? "var(--color-primary)"
                        : "var(--color-text-secondary)",
                    borderBottom:
                      rightPaneTab === "LIVE"
                        ? "2px solid var(--color-primary)"
                        : "2px solid transparent",
                    transition: "all 0.15s",
                  }}
                >
                  LIVE PROGRESS
                </div>
                <div
                  onClick={() => setRightPaneTab("SUMMARY")}
                  style={{
                    flex: 1,
                    padding: "12px",
                    textAlign: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    color:
                      rightPaneTab === "SUMMARY"
                        ? "var(--color-info, #3b82f6)"
                        : "var(--color-text-secondary)",
                    borderBottom:
                      rightPaneTab === "SUMMARY"
                        ? "2px solid var(--color-info, #3b82f6)"
                        : "2px solid transparent",
                    transition: "all 0.15s",
                  }}
                >
                  SUMMARY
                </div>
                <div
                  onClick={() => setRightPaneTab("HISTORY")}
                  style={{
                    flex: 1,
                    padding: "12px",
                    textAlign: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    color:
                      rightPaneTab === "HISTORY"
                        ? "var(--color-text)"
                        : "var(--color-text-secondary)",
                    borderBottom:
                      rightPaneTab === "HISTORY"
                        ? "2px solid var(--color-text)"
                        : "2px solid transparent",
                    transition: "all 0.15s",
                  }}
                >
                  HISTORY
                </div>
              </div>

              <div style={{ flex: 1, overflow: "hidden" }}>
                {rightPaneTab === "LIVE" && (
                  <IntegrationLiveProgress
                    activeJobId={activeJobId}
                    activeJobType={activeJobType}
                    activeJobStatus={activeJobStatus}
                    error={error}
                    activeLogs={activeLogs}
                    parseProgressSteps={parseProgressSteps}
                  />
                )}
                {rightPaneTab === "SUMMARY" && (
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
                        
                        if (semanticState === "RUNNING") {
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
                {rightPaneTab === "HISTORY" && (
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
