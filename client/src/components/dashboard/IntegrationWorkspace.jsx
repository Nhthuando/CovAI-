import React, { useCallback, useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getIntegrationWorkspace, runCoverageByType } from "../../services/coverage.service.js";
import { runProjectStructureAnalysisApi } from "../../services/project.service.js";

import IntegrationTargetsPane from "./integration/IntegrationTargetsPane.jsx";
import IntegrationScenariosPane from "./integration/IntegrationScenariosPane.jsx";
import IntegrationLiveProgress from "./integration/IntegrationLiveProgress.jsx";
import IntegrationHistoryPane from "./integration/IntegrationHistoryPane.jsx";

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
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/integration/approve`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ approvedTestIds })
    });
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
    transition: "all 0.15s ease" 
});

const disabledButtonStyle = { 
    background: "rgba(255,255,255,.05)", 
    color: "rgba(255,255,255,.3)", 
    border: "1px solid rgba(255,255,255,.1)", 
    borderRadius: 6, 
    padding: "6px 12px", 
    fontSize: 13,
    fontWeight: 600, 
    cursor: "not-allowed" 
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
        const eventSource = new EventSource(`${BASE_URL}/job/${jobId}/stream?token=${token}`);

        eventSource.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.error) {
                    eventSource.close();
                    onError(new Error(data.error));
                    return;
                }

                if (data.logs) {
                    const parsedLogs = data.logs.map(log => {
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

export default function IntegrationWorkspace({ projectId, snapshotId, onGenerate, generating, onOpenFile, onOpenCFG }) {
    const navigate = useNavigate();
    const [workspace, setWorkspace] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    
    // Active Jobs State
    const [activeJobId, setActiveJobId] = useState(null);
    const [activeJobType, setActiveJobType] = useState(null);
    const [activeJobStatus, setActiveJobStatus] = useState("RUNNING");
    const [selectedTestIds, setSelectedTestIds] = useState([]);

    // UI View State
    const [selectedEndpointIndex, setSelectedEndpointIndex] = useState(null);
    const [rightPaneTab, setRightPaneTab] = useState("LIVE"); // "LIVE" | "HISTORY" | "SUMMARY"

    const load = useCallback(async () => {
        if (!snapshotId) return;
        try {
            const res = await getIntegrationWorkspace(snapshotId);
            setWorkspace(res.data);
            
            if (!activeJobId) {
                const fetchedJobs = res.data.jobs || {};
                let runningJobId = null;
                let runningJobType = null;
                
                if (fetchedJobs.analyze?.status === "RUNNING" || fetchedJobs.analyze?.status === "QUEUED") {
                    runningJobId = fetchedJobs.analyze.id;
                    runningJobType = "ANALYZE";
                } else if (fetchedJobs.generate?.status === "RUNNING" || fetchedJobs.generate?.status === "QUEUED") {
                    runningJobId = fetchedJobs.generate.id;
                    runningJobType = "GENERATE";
                } else if (fetchedJobs.execute?.status === "RUNNING" || fetchedJobs.execute?.status === "QUEUED") {
                    runningJobId = fetchedJobs.execute.id;
                    runningJobType = "EXECUTE";
                }

                if (runningJobId) {
                    setActiveJobId(runningJobId);
                    setActiveJobType(runningJobType);
                    setActiveJobStatus("RUNNING");
                    setRightPaneTab("LIVE");
                }
            }
            
            if (res.data?.aiTests && selectedTestIds.length === 0) {
                const allIds = res.data.aiTests.flatMap(t => t.requests.map(r => `${t.id}::${r.testName}`));
                setSelectedTestIds(allIds);
            }
            setError("");
        } catch (err) {
            setError(err.message || "Failed to load workspace.");
        } finally {
            setLoading(false);
        }
    }, [snapshotId, activeJobId]);

    useEffect(() => { load(); }, [load]);

    const { logs: activeLogs, logsEndRef } = useLiveJobLogs(activeJobId, () => {
        setActiveJobId(null);
        setActiveJobType(null);
        setActiveJobStatus("RUNNING");
        load();
        setRightPaneTab("SUMMARY");
    }, (err) => {
        setActiveJobStatus("FAILED");
        setError(err.message);
    });

    const handleRunAnalysis = async () => {
        if (!projectId || !snapshotId || (activeJobId && activeJobStatus !== "FAILED")) return;
        setError("");
        setRightPaneTab("LIVE");
        try {
            const response = await runProjectStructureAnalysisApi(projectId, snapshotId);
            const jobId = response?.data?.job?.id || response?.job?.id;
            if (jobId) {
                setActiveJobId(jobId);
                setActiveJobType("ANALYZE");
                setActiveJobStatus("RUNNING");
            }
        } catch (err) { setError(err.message || "Project analysis failed."); }
    };

    const handleGenerateClick = async () => {
        if (!workspace?.generation?.hasAnalysis || (activeJobId && activeJobStatus !== "FAILED")) return;
        setError("");
        setRightPaneTab("LIVE");
        try {
            const res = await onGenerate();
            const jobId = res?.data?.job?.id;
            if (jobId) {
                setActiveJobId(jobId);
                setActiveJobType("GENERATE");
                setActiveJobStatus("RUNNING");
            } else throw new Error("Backend failed to return a generation Job ID.");
        } catch (err) { setError(err.message || "Generation failed."); }
    };

    const handleApprove = async () => {
        if (!snapshotId || (activeJobId && activeJobStatus !== "FAILED") || selectedTestIds.length === 0) return;
        setError("");
        try {
            await approveIntegrationTestsApi(snapshotId, selectedTestIds);
            await load();
        } catch (err) { setError(err.message || "Approval failed."); }
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
        } catch (err) { setError(err.message || "Test execution failed."); }
    };

    const parseProgressSteps = (jobType, logs) => {
        const stages = logs.map(l => l.parsedMessage?.stage).filter(Boolean);
        const hasStage = (stageName) => stages.includes(stageName);
        const textLogs = logs.map(l => typeof l.message === 'string' ? l.message : JSON.stringify(l.message)).join("\n");
        let steps = [];

        if (jobType === "ANALYZE") {
            steps = [
                { label: "Load project snapshot", done: true },
                { label: "Analyze source structure", done: hasStage('LOAD_SOURCE') || textLogs.includes("Scanning") || textLogs.includes("Analyzed") },
                { label: "Detect framework", done: hasStage('DETECT_ENDPOINTS') || textLogs.includes("Analyzed") },
                { label: "Discover API endpoints", done: hasStage('DETECT_ENDPOINTS') || textLogs.includes("Analyzed") || textLogs.includes("Saving") },
                { label: "Analyze route/controller/service flow", done: hasStage('MAP_DEPENDENCIES') || textLogs.includes("Saving") },
                { label: "Build AI test context", done: hasStage('MAP_DEPENDENCIES') || textLogs.includes("Saving") || textLogs.includes("completed") },
                { label: "Complete", done: hasStage('COMPLETE') || textLogs.includes("completed") }
            ];
        } else if (jobType === "GENERATE") {
            steps = [
                { label: "Build AI test context", done: hasStage('BUILD_CONTEXT') || textLogs.includes("Building AI Context") || textLogs.includes("Calling Gemini") },
                { label: "Generate AI tests", done: hasStage('GENERATE_AI_TESTS') || textLogs.includes("Calling Gemini") },
                { label: "Validate test scenarios", done: hasStage('VALIDATE_SCENARIOS') || textLogs.includes("Parsing") || textLogs.includes("validating") || textLogs.includes("Saved") || textLogs.includes("Generated") || textLogs.includes("No Supertest") },
                { label: "Complete", done: hasStage('COMPLETE') || textLogs.includes("Saved") || textLogs.includes("Generated") || textLogs.includes("No Supertest") || textLogs.includes("hoàn thành") || textLogs.includes("Hoàn thành") }
            ];
        } else if (jobType === "EXECUTE") {
            steps = [
                { label: "Load approved tests", done: true },
                { label: "Validate snapshot", done: true },
                { label: "Prepare environment", done: hasStage('PREPARE_ENV') || textLogs.includes("Bắt đầu") || textLogs.includes("TestRun") },
                { label: "Execute tests", done: hasStage('RUN_JEST') || textLogs.includes("Bắt đầu") || textLogs.includes("TestRun") },
                { label: "Collect results", done: hasStage('PARSE_COVERAGE') || textLogs.includes("TestRun") || textLogs.includes("hoàn thành") },
                { label: "Map tests to endpoints", done: hasStage('MAP_RESULTS') || textLogs.includes("TestRun") || textLogs.includes("hoàn thành") },
                { label: "Collect coverage", done: hasStage('MAP_RESULTS') || textLogs.includes("TestRun") || textLogs.includes("hoàn thành") },
                { label: "Build report", done: hasStage('COMPLETE') || textLogs.includes("hoàn thành") }
            ];
        }
        return steps;
    };

    if (loading && !workspace) return <div style={{ padding: 40, color: "#e6edf3" }}>Loading workspace...</div>;

    const { generation, endpoints = [], aiTests = [], summary, execution } = workspace || {};
    const hasAnalysis = generation?.hasAnalysis;
    const hasGeneratedTests = generation?.hasGeneratedTests;
    const isApproved = generation?.isApproved;
    const isJobActive = activeJobId && activeJobStatus !== "FAILED";

    const selectedEndpoint = selectedEndpointIndex !== null ? endpoints[selectedEndpointIndex] : null;

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0d1117", color: "#e6edf3" }}>
            {/* TOP BAR */}
            <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,.1)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#161b22" }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, display: "flex", alignItems: "center", gap: 12 }}>
                        Integration Testing Workbench
                        <span style={{ fontSize: 11, padding: "2px 8px", background: "rgba(167,139,250,.1)", color: "#a78bfa", borderRadius: 12, border: "1px solid rgba(167,139,250,.2)", fontWeight: 600 }}>Phase 2</span>
                    </h1>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={handleRunAnalysis} disabled={isJobActive} style={isJobActive ? disabledButtonStyle : buttonStyle("#8b949e")}>
                        Analyze Project
                    </button>
                    <button onClick={handleGenerateClick} disabled={!hasAnalysis || isJobActive} style={(!hasAnalysis || isJobActive) ? disabledButtonStyle : buttonStyle("#a78bfa")}>
                        Generate Tests
                    </button>
                    <button onClick={handleApprove} disabled={!hasGeneratedTests || isApproved || isJobActive} style={(!hasGeneratedTests || isApproved || isJobActive) ? disabledButtonStyle : buttonStyle("#fbbf24")}>
                        {isApproved ? "Approved" : "Approve Selected"}
                    </button>
                    <button onClick={handleRunApprovedTests} disabled={!isApproved || isJobActive} style={(!isApproved || isJobActive) ? disabledButtonStyle : buttonStyle("#3b82f6")}>
                        Run Tests
                    </button>
                    <button onClick={() => navigate(`/project/${projectId}/reports/integration`)} style={buttonStyle("#10b981")}>
                        View Report
                    </button>
                </div>
            </div>

            {error && (
                <div style={{ margin: "16px 24px 0", padding: "12px 16px", background: "rgba(248,113,113,.1)", color: "#fca5a5", border: "1px solid rgba(248,113,113,.2)", borderRadius: 8, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
                    <span>{error}</span>
                    <button onClick={() => setError("")} style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer" }}>✕</button>
                </div>
            )}

            {/* 3-PANE LAYOUT */}
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                
                {/* LEFT PANE: Targets */}
                <div style={{ width: 280, minWidth: 240, borderRight: "1px solid rgba(255,255,255,.05)", background: "#161b22", display: "flex", flexDirection: "column" }}>
                    <IntegrationTargetsPane 
                        endpoints={endpoints} 
                        selectedEndpointIndex={selectedEndpointIndex}
                        onSelectEndpoint={setSelectedEndpointIndex}
                        hasAnalysis={hasAnalysis}
                    />
                </div>

                {/* CENTER PANE: Scenarios */}
                <div style={{ flex: 1, minWidth: 350, borderRight: "1px solid rgba(255,255,255,.05)", background: "#0d1117", display: "flex", flexDirection: "column" }}>
                    <IntegrationScenariosPane 
                        aiTests={aiTests}
                        selectedEndpoint={selectedEndpoint}
                        endpoints={endpoints}
                        hasGeneratedTests={hasGeneratedTests}
                        isApproved={isApproved}
                        selectedTestIds={selectedTestIds}
                        setSelectedTestIds={setSelectedTestIds}
                        snapshotId={snapshotId}
                        onScenarioChange={load}
                        onError={setError}
                        onOpenLogic={onOpenCFG}
                    />
                </div>

                {/* RIGHT PANE: Execution & Analysis */}
                <div style={{ width: 400, minWidth: 350, background: "#161b22", display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                        <div onClick={() => setRightPaneTab("LIVE")} style={{ flex: 1, padding: "12px", textAlign: "center", fontSize: 12, fontWeight: 600, cursor: "pointer", color: rightPaneTab === "LIVE" ? "#a78bfa" : "#8b949e", borderBottom: rightPaneTab === "LIVE" ? "2px solid #a78bfa" : "2px solid transparent", transition: "all 0.15s" }}>LIVE PROGRESS</div>
                        <div onClick={() => setRightPaneTab("SUMMARY")} style={{ flex: 1, padding: "12px", textAlign: "center", fontSize: 12, fontWeight: 600, cursor: "pointer", color: rightPaneTab === "SUMMARY" ? "#3b82f6" : "#8b949e", borderBottom: rightPaneTab === "SUMMARY" ? "2px solid #3b82f6" : "2px solid transparent", transition: "all 0.15s" }}>SUMMARY</div>
                        <div onClick={() => setRightPaneTab("HISTORY")} style={{ flex: 1, padding: "12px", textAlign: "center", fontSize: 12, fontWeight: 600, cursor: "pointer", color: rightPaneTab === "HISTORY" ? "#e6edf3" : "#8b949e", borderBottom: rightPaneTab === "HISTORY" ? "2px solid #e6edf3" : "2px solid transparent", transition: "all 0.15s" }}>HISTORY</div>
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
                                <h3 style={{ margin: "0 0 16px", fontSize: 16, color: "#e6edf3" }}>Execution Summary</h3>
                                {!execution ? (
                                    <div style={{ color: "#8b949e", fontSize: 13 }}>No recent executions found.</div>
                                ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                        <div style={{ padding: 16, background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8 }}>
                                            <div style={{ color: execution.status === "PASSED" ? "#22c55e" : "#f87171", fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                                                {execution.status}
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between", color: "#8b949e", fontSize: 13 }}>
                                                <span>Passed: <strong style={{ color: "#e6edf3" }}>{summary?.passedTests || 0}</strong></span>
                                                <span>Failed: <strong style={{ color: "#e6edf3" }}>{summary?.failedTests || 0}</strong></span>
                                                <span>Total: <strong style={{ color: "#e6edf3" }}>{summary?.totalTests || 0}</strong></span>
                                            </div>
                                        </div>
                                        {summary?.codeCoverage && (
                                            <div style={{ padding: 16, background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8 }}>
                                                <div style={{ color: "#8b949e", fontSize: 12, textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>Code Coverage</div>
                                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
                                                    <div>Statements: <strong style={{ color: summary.codeCoverage.statement > 80 ? "#22c55e" : "#fbbf24" }}>{Number(summary.codeCoverage.statement).toFixed(1)}%</strong></div>
                                                    <div>Branches: <strong style={{ color: summary.codeCoverage.branch > 80 ? "#22c55e" : "#fbbf24" }}>{Number(summary.codeCoverage.branch).toFixed(1)}%</strong></div>
                                                    <div>Functions: <strong style={{ color: summary.codeCoverage.function > 80 ? "#22c55e" : "#fbbf24" }}>{Number(summary.codeCoverage.function).toFixed(1)}%</strong></div>
                                                    <div>Lines: <strong style={{ color: summary.codeCoverage.line > 80 ? "#22c55e" : "#fbbf24" }}>{Number(summary.codeCoverage.line).toFixed(1)}%</strong></div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        {rightPaneTab === "HISTORY" && (
                            <IntegrationHistoryPane snapshotId={snapshotId} />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
