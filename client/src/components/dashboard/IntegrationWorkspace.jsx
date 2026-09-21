import { useCallback, useEffect, useState, useRef } from "react";
import { getIntegrationWorkspace, runCoverageByType } from "../../services/coverage.service.js";
import { runAnalysisApi } from "../../services/project.service.js";
import { getJobDetailApi } from "../../services/job.service.js";

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

async function approveIntegrationTestsApi(snapshotId) {
    const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/integration/approve`, {
        method: "POST",
        headers: getAuthHeaders(),
    });
    return handleResponse(res);
}

function formatDistanceToNow(dateInput) {
    const date = new Date(dateInput);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000); // in seconds
    
    if (diff < 60) return `${diff} seconds`;
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours`;
    return `${Math.floor(diff / 86400)} days`;
}

const cardStyle = { background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.075)", borderRadius: 12, padding: 17 };
const buttonStyle = (color) => ({ background: `${color}18`, color, border: `1px solid ${color}55`, borderRadius: 8, padding: "8px 14px", fontWeight: 650, cursor: "pointer", opacity: 1 });
const disabledButtonStyle = { background: "rgba(255,255,255,.05)", color: "rgba(255,255,255,.3)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, padding: "8px 14px", fontWeight: 650, cursor: "not-allowed" };

const statusColor = (status) => {
    if (status === "Covered" || status === "PASSED" || status === "APPROVED") return "#22c55e";
    if (status === "Partial" || status === "DRAFT") return "#fbbf24";
    if (status === "Uncovered" || status === "FAILED") return "#f87171";
    if (status === "Not Executed") return "#9ca3af";
    return "#9ca3af";
};

// Polling Hook for active job logs
function useLiveJobLogs(jobId, onComplete, onError) {
    const [logs, setLogs] = useState([]);
    const [status, setStatus] = useState(null);
    const logsEndRef = useRef(null);

    useEffect(() => {
        if (!jobId) {
            setLogs([]);
            setStatus(null);
            return;
        }

        let isActive = true;
        const poll = async () => {
            while (isActive) {
                try {
                    const res = await getJobDetailApi(jobId);
                    if (res?.job) {
                        setLogs(res.job.logs || []);
                        setStatus(res.job.status);
                        
                        if (["SUCCESS", "FAILED", "CANCELED"].includes(res.job.status)) {
                            if (res.job.status === "SUCCESS") onComplete && onComplete();
                            else onError && onError(new Error(res.job.errorMessage || `Job ${res.job.status}`));
                            break;
                        }
                    }
                } catch (err) {
                    console.error("Failed to poll job", err);
                }
                await new Promise(r => setTimeout(r, 2000));
            }
        };
        poll();
        return () => { isActive = false; };
    }, [jobId, onComplete, onError]);

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    return { logs, status, logsEndRef };
}

export default function IntegrationWorkspace({ projectId, snapshotId, onGenerate, generating }) {
    const [workspace, setWorkspace] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [activeTab, setActiveTab] = useState("ANALYZE");
    const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);

    // Active Jobs State
    const [activeJobId, setActiveJobId] = useState(null);

    const load = useCallback(async () => {
        if (!snapshotId) return;
        try {
            const res = await getIntegrationWorkspace(snapshotId);
            setWorkspace(res.data);
            
            // Auto-switch tab based on state if no job is active
            if (!activeJobId) {
                if (res.data.execution) setActiveTab("EXECUTE");
                else if (res.data.generation?.hasGeneratedTests && !res.data.generation?.isApproved) setActiveTab("REVIEW");
                else if (res.data.generation?.hasAnalysis) setActiveTab("GENERATE");
                else setActiveTab("ANALYZE");
            }
            setError("");
        } catch (err) {
            setError(err.message || "Failed to load workspace.");
        } finally {
            setLoading(false);
        }
    }, [snapshotId, activeJobId]);

    useEffect(() => {
        load();
    }, [load]);

    // Live Logs Hook
    const { logs: activeLogs, logsEndRef } = useLiveJobLogs(activeJobId, () => {
        setActiveJobId(null);
        load();
    }, (err) => {
        setActiveJobId(null);
        setError(err.message);
        load();
    });

    const handleRunAnalysis = async () => {
        if (!projectId || !snapshotId || activeJobId) return;
        setError("");
        setActiveTab("ANALYZE");
        try {
            const response = await runAnalysisApi(projectId, { snapshotId, testType: "JEST" });
            if (response.data?.job?.id) setActiveJobId(response.data.job.id);
        } catch (err) {
            setError(err.message || "Project analysis failed.");
        }
    };

    const handleGenerateClick = () => {
        if (!workspace?.generation?.hasAnalysis) {
            setShowAnalyzeModal(true);
        } else {
            setActiveTab("GENERATE");
            onGenerate(); 
            setTimeout(() => load(), 2000); 
        }
    };

    useEffect(() => {
        if (generating && !activeJobId && workspace?.jobs?.generate?.status === "RUNNING") {
            setActiveJobId(workspace.jobs.generate.id);
        }
    }, [generating, activeJobId, workspace]);

    const handleApprove = async () => {
        if (!snapshotId || activeJobId) return;
        setError("");
        try {
            await approveIntegrationTestsApi(snapshotId);
            await load();
            setActiveTab("EXECUTE");
        } catch (err) {
            setError(err.message || "Approval failed.");
        }
    };

    const handleRunApprovedTests = async () => {
        if (!snapshotId || activeJobId) return;
        setError("");
        setActiveTab("EXECUTE");
        try {
            const response = await runCoverageByType(snapshotId, "integration");
            if (response.data?.job?.id) setActiveJobId(response.data.job.id);
        } catch (err) {
            setError(err.message || "Test execution failed.");
        }
    };

    const { summary, generation, endpoints = [], execution, aiTests = [], snapshot, jobs } = workspace || {};
    const hasAnalysis = generation?.hasAnalysis;
    const hasGeneratedTests = generation?.hasGeneratedTests;
    const isApproved = generation?.isApproved;

    if (loading && !workspace) return <div style={{ padding: 40, color: "#e6edf3" }}>Loading workspace...</div>;
    
    // Renders the LIVE PROGRESS UI if a job is active
    const parseProgressSteps = (jobType, logs) => {
        const textLogs = logs.map(l => l.message).join("\n");
        let steps = [];
        if (jobType === "ANALYZE") {
            steps = [
                { label: "Load project snapshot", done: true },
                { label: "Analyze source structure", done: textLogs.includes("Analyzed") || textLogs.includes("Discovered") },
                { label: "Detect framework", done: textLogs.includes("Analyzed") || textLogs.includes("Discovered") },
                { label: "Discover API endpoints", done: textLogs.includes("Discovered") },
                { label: "Analyze route/controller/service flow", done: textLogs.includes("Saving") },
                { label: "Build AI test context", done: textLogs.includes("Saving") || textLogs.includes("Analysis completed") },
                { label: "Complete", done: textLogs.includes("Analysis completed") }
            ];
        } else if (jobType === "GENERATE") {
            steps = [
                { label: "Build AI test context", done: textLogs.includes("Building AI Context") || textLogs.includes("Calling Gemini") },
                { label: "Generate AI tests", done: textLogs.includes("Calling Gemini") },
                { label: "Validate test scenarios", done: textLogs.includes("Parsing") || textLogs.includes("validating") || textLogs.includes("Saved") || textLogs.includes("Generated") || textLogs.includes("No Supertest") },
                { label: "Complete", done: textLogs.includes("Saved") || textLogs.includes("Generated") || textLogs.includes("No Supertest") || textLogs.includes("hoàn thành") || textLogs.includes("Hoàn thành") }
            ];
        } else if (jobType === "EXECUTE") {
            steps = [
                { label: "Load approved tests", done: true },
                { label: "Validate snapshot", done: true },
                { label: "Prepare environment", done: textLogs.includes("Bắt đầu") || textLogs.includes("TestRun") },
                { label: "Execute tests", done: textLogs.includes("Bắt đầu") || textLogs.includes("TestRun") },
                { label: "Collect results", done: textLogs.includes("TestRun") || textLogs.includes("hoàn thành") },
                { label: "Map tests to endpoints", done: textLogs.includes("TestRun") || textLogs.includes("hoàn thành") },
                { label: "Collect coverage", done: textLogs.includes("TestRun") || textLogs.includes("hoàn thành") },
                { label: "Build report", done: textLogs.includes("hoàn thành") }
            ];
        }
        return steps;
    };

    const renderLiveProgress = (jobType) => {
        const steps = parseProgressSteps(jobType, activeLogs);
        return (
            <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 12, padding: 24, animation: "fadeIn 0.2s" }}>
                <h3 style={{ margin: "0 0 20px", fontSize: 18, color: "#e6edf3" }}>
                    {jobType === "ANALYZE" && "Analyzing Project Architecture..."}
                    {jobType === "GENERATE" && "Generating AI Test Scenarios..."}
                    {jobType === "EXECUTE" && "Executing Test Suite..."}
                </h3>
                
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
                    {steps.map((step, idx) => (
                        <div key={idx} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{
                                width: 20, height: 20, borderRadius: "50%", 
                                background: step.done ? "#22c55e" : "transparent",
                                border: step.done ? "1px solid #22c55e" : "1px solid #8b949e",
                                display: "flex", alignItems: "center", justifyContent: "center"
                            }}>
                                {step.done && <span style={{ color: "#000", fontSize: 12, fontWeight: "bold" }}>✓</span>}
                            </div>
                            <span style={{ color: step.done ? "#e6edf3" : "#8b949e", fontWeight: step.done ? 600 : 400 }}>
                                {step.label}
                            </span>
                        </div>
                    ))}
                </div>

                <details style={{ background: "#000", border: "1px solid #30363d", borderRadius: 8, padding: "12px 16px" }}>
                    <summary style={{ color: "#8b949e", fontSize: 13, cursor: "pointer", userSelect: "none" }}>View raw processing logs</summary>
                    <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 12, maxHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                        {activeLogs.map((log, i) => (
                            <div key={i} style={{ color: log.level === "ERROR" ? "#f87171" : log.level === "WARN" ? "#fbbf24" : "#e6edf3" }}>
                                <span style={{ color: "#8b949e", marginRight: 8 }}>[{new Date(log.createdAt).toLocaleTimeString()}]</span>
                                {log.message}
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </details>
            </div>
        );
    };

    // REPORT VIEWS
    const renderAnalysisReport = () => {
        if (activeJobId && activeTab === "ANALYZE") return renderLiveProgress("ANALYZE");
        if (!hasAnalysis) return <div style={{ color: "#8b949e" }}>No analysis has been run yet.</div>;
        
        return (
            <div style={{ animation: "fadeIn 0.2s" }}>
                <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 150 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Project Framework</div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{snapshot?.framework || "Express"}</div>
                    </div>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 150 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Test Framework</div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{snapshot?.testFramework || "Jest"}</div>
                    </div>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 150 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Source Files</div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{snapshot?.sourceFilesAnalyzed || 0} analyzed</div>
                    </div>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 150 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>APIs Discovered</div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{summary?.discoveredApis} endpoints</div>
                    </div>
                </div>

                <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
                    <div style={{ ...cardStyle, flex: 1, borderColor: "rgba(251,191,36,.2)", background: "rgba(251,191,36,.02)" }}>
                        <div style={{ color: "#fbbf24", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Analysis Warnings</div>
                        <div style={{ fontSize: 14, color: "#8b949e", marginTop: 4 }}>{summary?.analysisWarnings || "None"}</div>
                    </div>
                    <div style={{ ...cardStyle, flex: 1, borderColor: "rgba(251,191,36,.2)", background: "rgba(251,191,36,.02)" }}>
                        <div style={{ color: "#fbbf24", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Analysis Limitations</div>
                        <div style={{ fontSize: 14, color: "#8b949e", marginTop: 4 }}>{summary?.analysisLimitations || "None detected"}</div>
                    </div>
                </div>

                <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                        <thead>
                            <tr style={{ background: "rgba(255,255,255,.03)", borderBottom: "1px solid rgba(255,255,255,.05)", textAlign: "left" }}>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e", width: "10%" }}>Method</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Path</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Source File</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Controller</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Service</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Analysis Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {endpoints.map((ep, idx) => (
                                <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,.03)" }}>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span style={{ 
                                            background: ep.method === "GET" ? "#3b82f633" : ep.method === "POST" ? "#22c55e33" : ep.method === "PUT" ? "#fbbf2433" : ep.method === "DELETE" ? "#f8717133" : "#6b728033",
                                            color: ep.method === "GET" ? "#60a5fa" : ep.method === "POST" ? "#4ade80" : ep.method === "PUT" ? "#fcd34d" : ep.method === "DELETE" ? "#fca5a5" : "#9ca3af",
                                            padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700 
                                        }}>{ep.method}</span>
                                    </td>
                                    <td style={{ padding: "12px 16px", fontFamily: "monospace" }}>{ep.path}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.source?.sourceFile || "N/A"}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.source?.controller || "N/A"}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.source?.service || "N/A"}</td>
                                    <td style={{ padding: "12px 16px", color: "#22c55e" }}>Analyzed</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderGenerationReport = () => {
        if (activeJobId && activeTab === "GENERATE") return renderLiveProgress("GENERATE");
        if (!hasGeneratedTests) return <div style={{ color: "#8b949e" }}>No AI tests have been generated yet.</div>;
        
        return (
            <div style={{ animation: "fadeIn 0.2s" }}>
                 <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 150 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Endpoints Analyzed</div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{summary?.discoveredApis}</div>
                    </div>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 150 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Scenarios Generated</div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{generation?.generatedScenarios}</div>
                    </div>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 150 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Generated Files</div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{generation?.generatedFiles}</div>
                    </div>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 150 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Validation Result</div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: "#22c55e" }}>Valid</div>
                    </div>
                </div>

                <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                        <thead>
                            <tr style={{ background: "rgba(255,255,255,.03)", borderBottom: "1px solid rgba(255,255,255,.05)", textAlign: "left" }}>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Endpoint</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Scenario Name</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Scenario Type/Category</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Testing Purpose</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Generated File</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Validation Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {aiTests.flatMap(t => t.requests.map((r, idx) => (
                                <tr key={`${t.id}-${idx}`} style={{ borderBottom: "1px solid rgba(255,255,255,.03)" }}>
                                    <td style={{ padding: "12px 16px", fontFamily: "monospace", color: "#a78bfa" }}>
                                        {r.method.toUpperCase()} {r.path}
                                    </td>
                                    <td style={{ padding: "12px 16px", color: "#e6edf3" }}>{r.testName}</td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span style={{ padding: "2px 6px", background: "rgba(255,255,255,.05)", borderRadius: 4, fontSize: 12 }}>{r.category || "Standard"}</span>
                                    </td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e", fontSize: 13 }}>Validate {r.method} behavior for {r.path}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e", fontFamily: "monospace", fontSize: 12 }}>{t.filePath}</td>
                                    <td style={{ padding: "12px 16px", color: "#22c55e" }}>Valid</td>
                                </tr>
                            )))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderReviewState = () => {
        if (!hasGeneratedTests) return <div style={{ color: "#8b949e" }}>Nothing to review. Generate tests first.</div>;

        return (
            <div style={{ animation: "fadeIn 0.2s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 18 }}>Draft Integration Tests</h3>
                        <p style={{ margin: "4px 0 0", color: "#8b949e", fontSize: 14 }}>Review the AI-generated test suite before approving them for execution.</p>
                    </div>
                    {!isApproved ? (
                        <button onClick={handleApprove} style={{ ...buttonStyle("#fbbf24"), background: "#fbbf24", color: "#000" }}>Approve All Tests</button>
                    ) : (
                        <div style={{ color: "#22c55e", fontWeight: 600 }}>✓ All Tests Approved</div>
                    )}
                </div>

                <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                        <thead>
                            <tr style={{ background: "rgba(255,255,255,.03)", borderBottom: "1px solid rgba(255,255,255,.05)", textAlign: "left" }}>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Endpoint</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Scenario</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Testing Purpose</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Generated Test Location</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Current State</th>
                            </tr>
                        </thead>
                        <tbody>
                            {aiTests.flatMap(t => t.requests.map((r, idx) => (
                                <tr key={`${t.id}-${idx}`} style={{ borderBottom: "1px solid rgba(255,255,255,.03)" }}>
                                    <td style={{ padding: "12px 16px", fontFamily: "monospace", color: "#a78bfa" }}>
                                        {r.method.toUpperCase()} {r.path}
                                    </td>
                                    <td style={{ padding: "12px 16px", color: "#e6edf3" }}>{r.testName}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e", fontSize: 13 }}>Verify endpoint logic</td>
                                    <td style={{ padding: "12px 16px", fontFamily: "monospace", color: "#8b949e", fontSize: 12 }}>{t.filePath}</td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span style={{ color: statusColor(isApproved ? "APPROVED" : t.status), fontWeight: 600, fontSize: 12 }}>
                                            ● {isApproved ? "APPROVED" : (t.status || "DRAFT")}
                                        </span>
                                    </td>
                                </tr>
                            )))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderExecutionReport = () => {
        if (activeJobId && activeTab === "EXECUTE") return renderLiveProgress("EXECUTE");
        if (!execution) return <div style={{ color: "#8b949e" }}>Tests have not been executed yet. Approve and run tests first.</div>;
        
        return (
            <div style={{ animation: "fadeIn 0.2s" }}>
                <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 200 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Execution Summary</div>
                        <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 16, fontWeight: 600 }}>
                            <span style={{ color: "#e6edf3" }}>{summary?.totalTests || 0} Total</span>
                            <span style={{ color: "#22c55e" }}>{summary?.passedTests || 0} Passed</span>
                            <span style={{ color: "#f87171" }}>{summary?.failedTests || 0} Failed</span>
                            <span style={{ color: "#fbbf24" }}>{summary?.skippedTests || 0} Skipped</span>
                        </div>
                    </div>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 200 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>API Coverage</div>
                        <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 14 }}>
                            <span style={{ color: "#22c55e" }}>Tested: <strong>{summary?.testedApis || 0}/{summary?.discoveredApis || 0}</strong></span>
                            <span style={{ color: "#f87171" }}>Uncovered: <strong>{summary?.uncoveredApis || 0}</strong></span>
                            <span style={{ color: "#9ca3af" }}>Not Executed: <strong>{summary?.notExecutedApis || 0}</strong></span>
                        </div>
                    </div>
                    <div style={{ ...cardStyle, flex: 2, minWidth: 300 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Code Coverage</div>
                        {summary?.codeCoverage ? (
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 14 }}>
                                <span>Statements: <strong style={{ color: summary.codeCoverage.statement > 80 ? "#22c55e" : "#fbbf24" }}>{Number(summary.codeCoverage.statement).toFixed(1)}%</strong></span>
                                <span>Branches: <strong style={{ color: summary.codeCoverage.branch > 80 ? "#22c55e" : "#fbbf24" }}>{Number(summary.codeCoverage.branch).toFixed(1)}%</strong></span>
                                <span>Functions: <strong style={{ color: summary.codeCoverage.function > 80 ? "#22c55e" : "#fbbf24" }}>{Number(summary.codeCoverage.function).toFixed(1)}%</strong></span>
                                <span>Lines: <strong style={{ color: summary.codeCoverage.line > 80 ? "#22c55e" : "#fbbf24" }}>{Number(summary.codeCoverage.line).toFixed(1)}%</strong></span>
                            </div>
                        ) : <div style={{ color: "#8b949e", fontSize: 14, marginTop: 4 }}>N/A</div>}
                    </div>
                </div>

                <h3 style={{ margin: "0 0 16px", fontSize: 18 }}>Per-Endpoint Analysis</h3>
                <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                        <thead>
                            <tr style={{ background: "rgba(255,255,255,.03)", borderBottom: "1px solid rgba(255,255,255,.05)", textAlign: "left" }}>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Method</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Endpoint</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Generated Scenarios</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Approved Scenarios</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Executed Scenarios</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Passed</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Failed</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {endpoints.map((ep, idx) => (
                                <tr key={idx} style={{ borderBottom: "1px solid rgba(255,255,255,.03)" }}>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span style={{ 
                                            background: ep.method === "GET" ? "#3b82f633" : ep.method === "POST" ? "#22c55e33" : ep.method === "PUT" ? "#fbbf2433" : ep.method === "DELETE" ? "#f8717133" : "#6b728033",
                                            color: ep.method === "GET" ? "#60a5fa" : ep.method === "POST" ? "#4ade80" : ep.method === "PUT" ? "#fcd34d" : ep.method === "DELETE" ? "#fca5a5" : "#9ca3af",
                                            padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700 
                                        }}>{ep.method}</span>
                                    </td>
                                    <td style={{ padding: "12px 16px", fontFamily: "monospace" }}>{ep.path}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.testCount}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.testCount}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.testCount}</td>
                                    <td style={{ padding: "12px 16px", color: "#22c55e" }}>{ep.passedCount}</td>
                                    <td style={{ padding: "12px 16px", color: ep.failedCount > 0 ? "#f87171" : "#8b949e" }}>{ep.failedCount}</td>
                                    <td style={{ padding: "12px 16px", color: statusColor(ep.status), fontWeight: 600 }}>{ep.status}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div style={{ display: "flex", minHeight: "100%", color: "#e6edf3", background: "#0d1117", boxSizing: "border-box" }}>
            <div style={{ flex: 1, padding: "28px 34px", overflowY: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 30 }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.5px" }}>Integration Test</h1>
                        <p style={{ margin: "6px 0 0", color: "#8b949e", fontSize: 14 }}>Discover APIs, generate tests, approve, and execute.</p>
                    </div>
                </div>

                {error && <div style={{ background: "#f8717118", border: "1px solid #f8717155", padding: 16, borderRadius: 8, color: "#f87171", marginBottom: 20 }}>{error}</div>}

                {/* WORKFLOW PIPELINE / NAVIGATOR */}
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
                    
                    {/* 1. Analyze */}
                    <div 
                        onClick={() => setActiveTab("ANALYZE")}
                        style={{ ...cardStyle, flex: 1, minWidth: 200, cursor: "pointer", border: activeTab === "ANALYZE" ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,.075)", borderLeft: hasAnalysis ? "4px solid #22c55e" : "4px solid #8b949e" }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>① Analyze Project</div>
                        {activeJobId === jobs?.analyze?.id ? (
                            <div style={{ color: "#fbbf24", fontWeight: 600 }}>● Analyzing...</div>
                        ) : hasAnalysis ? (
                            <div>
                                <div style={{ color: "#22c55e", fontWeight: 600, marginBottom: 4 }}>✓ Completed</div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>{summary?.discoveredApis} API endpoints discovered</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={(e) => { e.stopPropagation(); setActiveTab("ANALYZE"); }} style={buttonStyle(activeTab === "ANALYZE" ? "#a78bfa" : "#8b949e")}>View Report</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleRunAnalysis(); }} style={buttonStyle("#8b949e")}>Re-analyze</button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Discover API endpoints and prepare AI context.</div>
                                <button onClick={(e) => { e.stopPropagation(); handleRunAnalysis(); }} style={buttonStyle("#fbbf24")}>Analyze Now</button>
                            </div>
                        )}
                    </div>

                    {/* 2. Generate */}
                    <div 
                        onClick={() => hasAnalysis && setActiveTab("GENERATE")}
                        style={{ ...cardStyle, flex: 1, minWidth: 200, cursor: hasAnalysis ? "pointer" : "default", border: activeTab === "GENERATE" ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,.075)", borderLeft: hasGeneratedTests ? "4px solid #22c55e" : "4px solid #8b949e" }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>② Generate AI Tests</div>
                        {activeJobId === jobs?.generate?.id ? (
                            <div style={{ color: "#fbbf24", fontWeight: 600 }}>● Generating...</div>
                        ) : !hasAnalysis ? (
                            <div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Locked: Analyze first.</div>
                                <button onClick={(e) => { e.stopPropagation(); handleGenerateClick(); }} style={disabledButtonStyle}>Generate</button>
                            </div>
                        ) : hasGeneratedTests ? (
                            <div>
                                <div style={{ color: "#22c55e", fontWeight: 600, marginBottom: 4 }}>✓ {generation?.generatedScenarios} scenarios</div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>{generation?.targetedApis}/{summary?.discoveredApis} APIs targeted</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={(e) => { e.stopPropagation(); setActiveTab("GENERATE"); }} style={buttonStyle(activeTab === "GENERATE" ? "#a78bfa" : "#8b949e")}>View Report</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleGenerateClick(); }} style={buttonStyle("#8b949e")}>Re-generate</button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>AI creates integration test scenarios.</div>
                                <button onClick={(e) => { e.stopPropagation(); handleGenerateClick(); }} style={buttonStyle("#a78bfa")}>Generate Tests</button>
                            </div>
                        )}
                    </div>

                    {/* 3. Review & Approve */}
                    <div 
                        onClick={() => hasGeneratedTests && setActiveTab("REVIEW")}
                        style={{ ...cardStyle, flex: 1, minWidth: 200, cursor: hasGeneratedTests ? "pointer" : "default", border: activeTab === "REVIEW" ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,.075)", borderLeft: isApproved ? "4px solid #22c55e" : "4px solid #8b949e" }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>③ Review & Approve</div>
                        {!hasGeneratedTests ? (
                            <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Locked: Generate first.</div>
                        ) : isApproved ? (
                            <div>
                                <div style={{ color: "#22c55e", fontWeight: 600, marginBottom: 4 }}>✓ {generation?.generatedFiles} files approved</div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Ready for execution.</div>
                                <button onClick={(e) => { e.stopPropagation(); setActiveTab("REVIEW"); }} style={buttonStyle(activeTab === "REVIEW" ? "#a78bfa" : "#8b949e")}>View Details</button>
                            </div>
                        ) : (
                            <div>
                                <div style={{ fontSize: 13, color: "#fbbf24", fontWeight: 600, marginBottom: 4 }}>Pending Approval</div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Review, modify, approve.</div>
                                <button onClick={(e) => { e.stopPropagation(); setActiveTab("REVIEW"); }} style={buttonStyle(activeTab === "REVIEW" ? "#a78bfa" : "#fbbf24")}>Review Tests</button>
                            </div>
                        )}
                    </div>

                    {/* 4. Execution */}
                    <div 
                        onClick={() => isApproved && setActiveTab("EXECUTE")}
                        style={{ ...cardStyle, flex: 1, minWidth: 200, cursor: isApproved ? "pointer" : "default", border: activeTab === "EXECUTE" ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,.075)", borderLeft: execution ? "4px solid #22c55e" : "4px solid #8b949e" }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>④ Execute Tests</div>
                        {activeJobId === jobs?.execute?.id ? (
                            <div style={{ color: "#fbbf24", fontWeight: 600 }}>● Running...</div>
                        ) : !isApproved ? (
                            <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Locked: Approve first.</div>
                        ) : execution ? (
                            <div>
                                <div style={{ color: execution.status === "PASSED" ? "#22c55e" : "#f87171", fontWeight: 600, marginBottom: 4 }}>
                                    {execution.status === "PASSED" ? "✓ " : "✕ "}{summary?.passedTests}/{summary?.totalTests} passed
                                </div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Completed {formatDistanceToNow(new Date(execution.completedAt))} ago.</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={(e) => { e.stopPropagation(); setActiveTab("EXECUTE"); }} style={buttonStyle(activeTab === "EXECUTE" ? "#a78bfa" : "#8b949e")}>View Report</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleRunApprovedTests(); }} style={buttonStyle("#3b82f6")}>Run Again</button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Execute approved tests.</div>
                                <button onClick={(e) => { e.stopPropagation(); handleRunApprovedTests(); }} style={buttonStyle("#3b82f6")}>Run Tests</button>
                            </div>
                        )}
                    </div>
                </div>

                {/* DYNAMIC REPORT PANEL */}
                <div style={{ background: "rgba(255,255,255,.01)", borderTop: "1px solid rgba(255,255,255,.05)", paddingTop: 32 }}>
                    <h2 style={{ fontSize: 20, margin: "0 0 24px" }}>
                        {activeTab === "ANALYZE" && "Project Analysis Report"}
                        {activeTab === "GENERATE" && "AI Test Generation Report"}
                        {activeTab === "REVIEW" && "Review Test Scenarios"}
                        {activeTab === "EXECUTE" && "Execution Report"}
                    </h2>
                    
                    {activeTab === "ANALYZE" && renderAnalysisReport()}
                    {activeTab === "GENERATE" && renderGenerationReport()}
                    {activeTab === "REVIEW" && renderReviewState()}
                    {activeTab === "EXECUTE" && renderExecutionReport()}
                </div>
            </div>

            {/* Analyze Project Modal */}
            {showAnalyzeModal && (
                <div style={{
                    position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
                    background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
                }}>
                    <div style={{
                        background: "#161b22", padding: 32, borderRadius: 12, width: 400,
                        border: "1px solid #30363d", boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
                    }}>
                        <h2 style={{ margin: "0 0 16px", color: "#e6edf3", fontSize: 20 }}>Analyze Project First</h2>
                        <p style={{ margin: "0 0 24px", color: "#8b949e", fontSize: 14, lineHeight: 1.5 }}>
                            COVAI needs to analyze the project and discover API endpoints before generating integration test scenarios.
                        </p>
                        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                            <button onClick={() => setShowAnalyzeModal(false)} style={buttonStyle("#8b949e")}>
                                Cancel
                            </button>
                            <button onClick={() => {
                                setShowAnalyzeModal(false);
                                handleRunAnalysis();
                            }} style={{ ...buttonStyle("#fbbf24"), background: "#fbbf24", color: "#000" }}>
                                Analyze Project Now
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
