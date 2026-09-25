import React, { useCallback, useEffect, useState, useRef } from "react";
import { getIntegrationWorkspace, runCoverageByType } from "../../services/coverage.service.js";
import { runProjectStructureAnalysisApi } from "../../services/project.service.js";
import { getJobDetailApi } from "../../services/job.service.js";
import { readFile } from "../../services/file.service.js";

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
                    setLogs(data.logs);
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

export default function IntegrationWorkspace({ projectId, snapshotId, onGenerate, generating, onOpenFile }) {
    const [workspace, setWorkspace] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [infoMessage, setInfoMessage] = useState("");
    const [activeTab, setActiveTab] = useState("ANALYZE");
    const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);

    // Active Jobs State
    const [activeJobId, setActiveJobId] = useState(null);
    const [activeJobType, setActiveJobType] = useState(null);
    const [activeJobStatus, setActiveJobStatus] = useState("RUNNING");
    const [selectedTestIds, setSelectedTestIds] = useState([]);

    // Drill-Down Interactive State
    const [executionFilter, setExecutionFilter] = useState(null); // null | "PASSED" | "FAILED" | "SKIPPED"
    const [expandedAnalysisRow, setExpandedAnalysisRow] = useState(null); // endpoint index
    const [expandedGenRow, setExpandedGenRow] = useState(null); // scenario key
    const [expandedExecRow, setExpandedExecRow] = useState(null); // endpoint index
    const [expandedReviewRow, setExpandedReviewRow] = useState(null); // scenario key
    const [codeModal, setCodeModal] = useState(null); // { title, code, filePath }
    const [expandedCard, setExpandedCard] = useState(null); // card key for inline expand
    const [generatedFilesModal, setGeneratedFilesModal] = useState(false);
    const [validationModal, setValidationModal] = useState(false);
    const [coverageBreakdownModal, setCoverageBreakdownModal] = useState(false);
    const [selectedFileCode, setSelectedFileCode] = useState(null); // { filePath, code }

    // Refs for scroll-to-table
    const analysisTableRef = useRef(null);
    const genTableRef = useRef(null);
    const execTableRef = useRef(null);

    const load = useCallback(async () => {
        if (!snapshotId) return;
        try {
            const res = await getIntegrationWorkspace(snapshotId);
            setWorkspace(res.data);
            
            // Auto-switch tab based on state if no job is active locally
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
                    setActiveTab(runningJobType);
                } else if (!window.__integrationWorkspaceLoaded) {
                    window.__integrationWorkspaceLoaded = true; // Use window or a ref for initial load
                    const gen = res.data.generation;
                    if (gen?.hasAnalysis && gen?.isApproved && res.data.execution) {
                        setActiveTab("EXECUTE");
                        setInfoMessage("Restored previous execution results.");
                    }
                    else if (gen?.hasAnalysis && gen?.hasGeneratedTests && gen?.isApproved) {
                        setActiveTab("EXECUTE");
                        setInfoMessage("Restored approved tests. Ready for execution.");
                    }
                    else if (gen?.hasAnalysis && gen?.hasGeneratedTests) {
                        setActiveTab("REVIEW");
                        setInfoMessage("Restored generated scenarios. Pending your review.");
                    }
                    else if (gen?.hasAnalysis) {
                        setActiveTab("GENERATE");
                        setInfoMessage("Restored analysis data. Ready to generate tests.");
                    }
                    else setActiveTab("ANALYZE");
                }
            }
            
            // Pre-select all tests by default for convenience
            if (res.data?.aiTests) {
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

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (infoMessage) {
            const t = setTimeout(() => setInfoMessage(""), 6000);
            return () => clearTimeout(t);
        }
    }, [infoMessage]);

    // Live Logs Hook
    const { logs: activeLogs, logsEndRef } = useLiveJobLogs(activeJobId, () => {
        setActiveJobId(null);
        setActiveJobType(null);
        setActiveJobStatus("RUNNING");
        load();
    }, (err) => {
        setActiveJobStatus("FAILED");
        setError(err.message);
    });

    const handleRunAnalysis = async () => {
        if (!projectId || !snapshotId || (activeJobId && activeJobStatus !== "FAILED")) return;
        setShowAnalyzeModal(false);
        setActiveTab("ANALYZE");
        setError("");
        try {
            const response = await runProjectStructureAnalysisApi(projectId, snapshotId);
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
        if (!workspace?.generation?.hasAnalysis) {
            setShowAnalyzeModal(true);
        } else {
            if (activeJobId && activeJobStatus !== "FAILED") return;
            setActiveTab("GENERATE");
            try {
                const res = await onGenerate();
                const jobId = res?.data?.job?.id;
                if (jobId) {
                    setActiveJobId(jobId);
                    setActiveJobType("GENERATE");
                    setActiveJobStatus("RUNNING");
                } else {
                    throw new Error("Backend failed to return a generation Job ID.");
                }
            } catch (err) {
                setError(err.message || "Generation failed.");
            }
        }
    };


    const handleApprove = async () => {
        if (!snapshotId || (activeJobId && activeJobStatus !== "FAILED") || selectedTestIds.length === 0) return;
        setError("");
        try {
            await approveIntegrationTestsApi(snapshotId, selectedTestIds);
            await load();
            setActiveTab("EXECUTE");
        } catch (err) {
            setError(err.message || "Approval failed.");
        }
    };

    const handleRunApprovedTests = async () => {
        if (!snapshotId || (activeJobId && activeJobStatus !== "FAILED")) return;
        setError("");
        setActiveTab("EXECUTE");
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
                { label: "Analyze source structure", done: textLogs.includes("Scanning") || textLogs.includes("Analyzed") },
                { label: "Detect framework", done: textLogs.includes("Analyzed") },
                { label: "Discover API endpoints", done: textLogs.includes("Analyzed") || textLogs.includes("Saving") },
                { label: "Analyze route/controller/service flow", done: textLogs.includes("Saving") },
                { label: "Build AI test context", done: textLogs.includes("Saving") || textLogs.includes("completed") },
                { label: "Complete", done: textLogs.includes("completed") }
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                    <h3 style={{ margin: 0, fontSize: 18, color: "#e6edf3" }}>
                        {jobType === "ANALYZE" && "Analyzing Project Architecture..."}
                        {jobType === "GENERATE" && "Generating AI Test Scenarios..."}
                        {jobType === "EXECUTE" && "Executing Test Suite..."}
                    </h3>
                    {activeJobStatus === "FAILED" && (
                        <div style={{ background: "rgba(248,113,113,.1)", color: "#f87171", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, border: "1px solid rgba(248,113,113,.2)" }}>
                            ✕ Job Failed
                        </div>
                    )}
                </div>
                
                {activeJobStatus === "FAILED" && error && (
                    <div style={{ background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.2)", padding: "12px 16px", borderRadius: 8, color: "#fca5a5", fontSize: 13, marginBottom: 24, fontFamily: "monospace", overflowX: "auto" }}>
                        <strong>Error:</strong> {error}
                    </div>
                )}
                
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
    const clickableCardStyle = (key) => ({
        ...cardStyle, flex: 1, minWidth: 150, cursor: "pointer", transition: "all 0.15s ease",
        border: expandedCard === key ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,.075)",
        ...(expandedCard === key ? { background: "rgba(167,139,250,.05)" } : {})
    });

    const scrollToRef = (ref) => {
        ref?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const renderAnalysisReport = () => {
        if (activeJobId && activeJobType === "ANALYZE") return renderLiveProgress("ANALYZE");
        if (!hasAnalysis) return (
            <div style={{ color: "#8b949e", fontSize: 14, lineHeight: "1.6", maxWidth: 600 }}>
                The system needs to scan your source code (Controllers, Routes) to discover API endpoints and their dependencies. 
                Click <strong style={{ color: "#e6edf3" }}>Start Analysis</strong> to begin. This usually takes 5-10 seconds.
            </div>
        );
        
        return (
            <div style={{ animation: "fadeIn 0.2s" }}>
                <style>{`
                    .hoverable-card { transition: all 0.2s ease; }
                    .hoverable-card:hover {
                        background: rgba(167, 139, 250, 0.08) !important;
                        border-color: rgba(167, 139, 250, 0.6) !important;
                        transform: translateY(-2px);
                        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                    }
                `}</style>
                <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
                    <div className="hoverable-card" onClick={() => setExpandedCard(expandedCard === "framework" ? null : "framework")} style={clickableCardStyle("framework")}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                            Project Framework <span style={{ fontSize: 10 }}>{expandedCard === "framework" ? "▲" : "▼"}</span>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{snapshot?.framework || "Express"}</div>
                        {expandedCard === "framework" && (
                            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.05)", fontSize: 13, color: "#8b949e", display: "flex", flexDirection: "column", gap: 6, animation: "fadeIn 0.15s" }}>
                                <div>Language: <strong style={{ color: "#e6edf3" }}>{snapshot?.language || "JavaScript"}</strong></div>
                                <div>ORM: <strong style={{ color: "#e6edf3" }}>{snapshot?.orm || "Prisma"}</strong></div>
                                <div>Entry Point: <strong style={{ color: "#e6edf3", fontFamily: "monospace", fontSize: 12 }}>{snapshot?.entryPoint || "index.js"}</strong></div>
                            </div>
                        )}
                    </div>
                    <div className="hoverable-card" onClick={() => setExpandedCard(expandedCard === "testfw" ? null : "testfw")} style={clickableCardStyle("testfw")}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                            Test Framework <span style={{ fontSize: 10 }}>{expandedCard === "testfw" ? "▲" : "▼"}</span>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{snapshot?.testFramework || "Jest"}</div>
                        {expandedCard === "testfw" && (
                            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.05)", fontSize: 13, color: "#8b949e", display: "flex", flexDirection: "column", gap: 6, animation: "fadeIn 0.15s" }}>
                                <div>HTTP Client: <strong style={{ color: "#e6edf3" }}>Supertest</strong></div>
                                <div>Assertion: <strong style={{ color: "#e6edf3" }}>Jest Expect</strong></div>
                                <div>Test Runner: <strong style={{ color: "#e6edf3" }}>jest --runInBand</strong></div>
                            </div>
                        )}
                    </div>
                    
                    {(() => {
                        const totalSchemas = endpoints.reduce((acc, ep) => acc + (ep.source?.requestBodySchema?.length || 0), 0);
                        const uniqueDBModels = new Set(endpoints.flatMap(ep => ep.source?.databaseModels || []));
                        
                        return (
                            <>
                                <div className="hoverable-card" style={{ ...cardStyle, flex: 1, minWidth: 150, border: "1px solid rgba(167, 139, 250, 0.3)", background: "rgba(167, 139, 250, 0.05)" }}>
                                    <div style={{ color: "#a78bfa", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>
                                        Payload Schemas
                                    </div>
                                    <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: "#e6edf3" }}>{totalSchemas} Extracted</div>
                                </div>
                                <div className="hoverable-card" style={{ ...cardStyle, flex: 1, minWidth: 150, border: "1px solid rgba(251, 191, 36, 0.3)", background: "rgba(251, 191, 36, 0.05)" }}>
                                    <div style={{ color: "#fbbf24", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>
                                        DB Models
                                    </div>
                                    <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: "#e6edf3" }}>{uniqueDBModels.size} Linked</div>
                                </div>
                            </>
                        );
                    })()}

                    <div className="hoverable-card" onClick={() => scrollToRef(analysisTableRef)} style={{ ...cardStyle, flex: 1, minWidth: 150, cursor: "pointer", transition: "all 0.15s ease" }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                            APIs Discovered <span style={{ fontSize: 10, color: "#a78bfa" }}>↓ view</span>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{summary?.discoveredApis} endpoints</div>
                    </div>
                </div>

                {(!summary?.analysisWarnings && !summary?.analysisLimitations) ? (
                    <div style={{ padding: "12px 16px", background: "rgba(34, 197, 94, 0.05)", border: "1px solid rgba(34, 197, 94, 0.2)", borderRadius: 8, color: "#22c55e", fontSize: 13, marginBottom: 24, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>✓</span> No warnings or limitations detected.
                    </div>
                ) : (
                    <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
                        <div style={{ ...cardStyle, flex: 1, borderColor: "rgba(251,191,36,.2)", background: "rgba(251,191,36,.02)", display: summary?.analysisWarnings ? "block" : "none" }}>
                            <div style={{ color: "#fbbf24", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Analysis Warnings</div>
                            <div style={{ fontSize: 14, color: "#8b949e", marginTop: 4 }}>{summary?.analysisWarnings}</div>
                        </div>
                        <div style={{ ...cardStyle, flex: 1, borderColor: "rgba(251,191,36,.2)", background: "rgba(251,191,36,.02)", display: summary?.analysisLimitations ? "block" : "none" }}>
                            <div style={{ color: "#fbbf24", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Analysis Limitations</div>
                            <div style={{ fontSize: 14, color: "#8b949e", marginTop: 4 }}>{summary?.analysisLimitations}</div>
                        </div>
                    </div>
                )}

                <div ref={analysisTableRef} style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8, overflow: "hidden" }}>
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
                                <React.Fragment key={idx}>
                                <tr onClick={() => setExpandedAnalysisRow(expandedAnalysisRow === idx ? null : idx)} style={{ borderBottom: "1px solid rgba(255,255,255,.03)", cursor: "pointer", background: expandedAnalysisRow === idx ? "rgba(167,139,250,.04)" : "transparent", transition: "background 0.1s" }}>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span style={{ 
                                            background: ep.method === "GET" ? "#3b82f633" : ep.method === "POST" ? "#22c55e33" : ep.method === "PUT" ? "#fbbf2433" : ep.method === "DELETE" ? "#f8717133" : "#6b728033",
                                            color: ep.method === "GET" ? "#60a5fa" : ep.method === "POST" ? "#4ade80" : ep.method === "PUT" ? "#fcd34d" : ep.method === "DELETE" ? "#fca5a5" : "#9ca3af",
                                            padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700 
                                        }}>{ep.method}</span>
                                    </td>
                                    <td style={{ padding: "12px 16px", fontFamily: "monospace" }}>{ep.path}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.source?.sourceFile || <span style={{ opacity: 0.3 }}>-</span>}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.source?.controller || <span style={{ opacity: 0.3 }}>-</span>}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.source?.service || <span style={{ opacity: 0.3 }}>-</span>}</td>
                                    <td style={{ padding: "12px 16px", color: "#22c55e", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        Analyzed <span style={{ fontSize: 10, color: "#8b949e" }}>{expandedAnalysisRow === idx ? "▲" : "▼"}</span>
                                    </td>
                                </tr>
                                {expandedAnalysisRow === idx && (
                                    <tr><td colSpan={6} style={{ padding: 0 }}>
                                        <div style={{ padding: "16px 24px", background: "rgba(167,139,250,.03)", borderLeft: "3px solid #a78bfa", animation: "fadeIn 0.15s" }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3", marginBottom: 12 }}>Endpoint Details — {ep.method} {ep.path}</div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
                                                <div>
                                                    <span style={{ color: "#8b949e" }}>Controller Function: </span>
                                                    <span style={{ color: "#a78bfa", fontFamily: "monospace" }}>{ep.source?.controllerMethod || ep.source?.controller || <span style={{ opacity: 0.3 }}>-</span>}</span>
                                                </div>
                                                <div>
                                                    <span style={{ color: "#8b949e" }}>Service Layer: </span>
                                                    <span style={{ color: "#fbbf24", fontFamily: "monospace" }}>{ep.source?.serviceMethod || ep.source?.service || <span style={{ opacity: 0.3 }}>-</span>}</span>
                                                </div>
                                                <div>
                                                    <span style={{ color: "#8b949e" }}>Route File: </span>
                                                    <span style={{ color: "#e6edf3", fontFamily: "monospace", fontSize: 12 }}>{ep.source?.routeFile || ep.source?.sourceFile || <span style={{ opacity: 0.3 }}>-</span>}</span>
                                                </div>
                                                <div>
                                                    <span style={{ color: "#8b949e" }}>Middleware: </span>
                                                    <span style={{ color: "#e6edf3", fontFamily: "monospace", fontSize: 12 }}>{ep.source?.middleware?.join(", ") || "None detected"}</span>
                                                </div>
                                            </div>
                                            {ep.source?.params && ep.source.params.length > 0 && (
                                                <div style={{ marginTop: 12 }}>
                                                    <span style={{ color: "#8b949e", fontSize: 13 }}>URL Params: </span>
                                                    {ep.source.params.map((p, i) => (
                                                        <span key={i} style={{ background: "rgba(59,130,246,.15)", color: "#60a5fa", padding: "2px 8px", borderRadius: 4, fontSize: 12, marginLeft: 4 }}>:{p}</span>
                                                    ))}
                                                </div>
                                            )}
                                            {ep.source?.requestBodySchema && ep.source.requestBodySchema.length > 0 && (
                                                <div style={{ marginTop: 12 }}>
                                                    <span style={{ color: "#8b949e", fontSize: 13 }}>Payload Schema Detected: </span>
                                                    {ep.source.requestBodySchema.map((p, i) => (
                                                        <span key={i} style={{ background: "rgba(167,139,250,.15)", color: "#a78bfa", padding: "2px 8px", borderRadius: 4, fontSize: 12, marginLeft: 4 }}>{p}</span>
                                                    ))}
                                                </div>
                                            )}
                                            {ep.source?.databaseModels && ep.source.databaseModels.length > 0 && (
                                                <div style={{ marginTop: 12 }}>
                                                    <span style={{ color: "#8b949e", fontSize: 13 }}>Database Models Touched: </span>
                                                    {ep.source.databaseModels.map((p, i) => (
                                                        <span key={i} style={{ background: "rgba(251,191,36,.15)", color: "#fbbf24", padding: "2px 8px", borderRadius: 4, fontSize: 12, marginLeft: 4 }}>{p}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </td></tr>
                                )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderGenerationReport = () => {
        if (activeJobId && activeJobType === "GENERATE") return renderLiveProgress("GENERATE");
        if (!hasAnalysis) return <div style={{ color: "#8b949e" }}>Run analysis first to unlock test generation.</div>;
        if (!hasGeneratedTests) return <div style={{ color: "#8b949e" }}>No AI tests have been generated yet. Click <strong style={{ color: "#e6edf3" }}>Generate Tests</strong> above.</div>;
        
        return (
            <div style={{ animation: "fadeIn 0.2s" }}>
                <style>{`
                    .hoverable-card { transition: all 0.2s ease; }
                    .hoverable-card:hover {
                        background: rgba(167, 139, 250, 0.08) !important;
                        border-color: rgba(167, 139, 250, 0.6) !important;
                        transform: translateY(-2px);
                        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                    }
                `}</style>
                 <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
                    <div className="hoverable-card" onClick={() => { setActiveTab("ANALYZE"); scrollToRef(analysisTableRef); }} style={{ ...cardStyle, flex: 1, minWidth: 150, cursor: "pointer", transition: "all 0.15s ease" }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                            Endpoints Analyzed <span style={{ fontSize: 10, color: "#a78bfa" }}>← view</span>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{summary?.discoveredApis}</div>
                    </div>
                    <div className="hoverable-card" onClick={() => scrollToRef(genTableRef)} style={{ ...cardStyle, flex: 1, minWidth: 150, cursor: "pointer", transition: "all 0.15s ease" }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                            Scenarios Generated <span style={{ fontSize: 10, color: "#a78bfa" }}>↓ view</span>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{generation?.generatedScenarios}</div>
                    </div>
                    <div className="hoverable-card" onClick={() => setGeneratedFilesModal(true)} style={clickableCardStyle("genfiles")}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                            Generated Files <span style={{ fontSize: 10, color: "#a78bfa" }}>↓ view</span>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{generation?.generatedFiles}</div>
                    </div>
                    <div className="hoverable-card" onClick={() => setValidationModal(true)} style={clickableCardStyle("validation")}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                            Validation Result <span style={{ fontSize: 10, color: "#a78bfa" }}>↓ view</span>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: generation?.isValid === false ? "#f87171" : "#22c55e" }}>
                            {generation?.isValid === false ? "Invalid" : "Valid"}
                        </div>
                    </div>
                </div>

                <div ref={genTableRef} style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8, overflow: "hidden" }}>
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
                            {(() => {
                                const scenariosByEndpoint = {};
                                aiTests.forEach(t => {
                                    t.requests.forEach(r => {
                                        const epKey = `${r.method.toUpperCase()} ${r.path}`;
                                        if (!scenariosByEndpoint[epKey]) {
                                            scenariosByEndpoint[epKey] = { 
                                                method: r.method.toUpperCase(), 
                                                path: r.path, 
                                                isValid: t.isValid,
                                                filePath: t.filePath,
                                                scenarios: [] 
                                            };
                                        }
                                        scenariosByEndpoint[epKey].scenarios.push(r);
                                    });
                                });

                                return Object.keys(scenariosByEndpoint).length === 0 ? (
                                    <tr><td colSpan={6} style={{ padding: "24px 16px", textAlign: "center", color: "#8b949e" }}>No scenarios generated.</td></tr>
                                ) : Object.entries(scenariosByEndpoint).map(([epKey, data], idx) => (
                                    <React.Fragment key={idx}>
                                    <tr onClick={() => setExpandedGenRow(expandedGenRow === epKey ? null : epKey)} style={{ borderBottom: "1px solid rgba(255,255,255,.03)", cursor: "pointer", background: expandedGenRow === epKey ? "rgba(167,139,250,.04)" : "transparent", transition: "background 0.1s" }}>
                                        <td style={{ padding: "12px 16px", fontFamily: "monospace", color: "#a78bfa" }}>
                                            <span style={{ 
                                                background: data.method === "GET" ? "#3b82f633" : data.method === "POST" ? "#22c55e33" : data.method === "PUT" ? "#fbbf2433" : data.method === "DELETE" ? "#f8717133" : "#6b728033",
                                                color: data.method === "GET" ? "#60a5fa" : data.method === "POST" ? "#4ade80" : data.method === "PUT" ? "#fcd34d" : data.method === "DELETE" ? "#fca5a5" : "#9ca3af",
                                                padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700, marginRight: 8
                                            }}>{data.method}</span>
                                            {data.path}
                                        </td>
                                        <td style={{ padding: "12px 16px", color: "#e6edf3", fontWeight: 600 }}>{data.scenarios.length} Scenarios</td>
                                        <td colSpan={2} style={{ padding: "12px 16px", color: "#8b949e", fontSize: 13 }}>Grouped scenarios for this API</td>
                                        <td style={{ padding: "12px 16px", color: "#8b949e", fontFamily: "monospace", fontSize: 12 }}>{data.filePath}</td>
                                        <td style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <span style={{ color: data.isValid === false ? "#f87171" : "#22c55e" }}>{data.isValid === false ? "Invalid" : "Valid"}</span>
                                            <span style={{ fontSize: 10, color: "#8b949e" }}>{expandedGenRow === epKey ? "▲" : "▼"}</span>
                                        </td>
                                    </tr>
                                    {expandedGenRow === epKey && (
                                        <tr><td colSpan={6} style={{ padding: 0 }}>
                                            <div style={{ padding: "16px 24px", background: "rgba(167,139,250,.03)", borderLeft: "3px solid #a78bfa", animation: "fadeIn 0.15s" }}>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                                                    <div style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>Test Scenarios for {epKey}</div>
                                                    <button onClick={(e) => { e.stopPropagation(); if (onOpenFile) onOpenFile(data.filePath); }} style={{ ...buttonStyle("#a78bfa"), padding: "4px 10px", fontSize: 12 }}>View Full Code</button>
                                                </div>
                                                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                                    {data.scenarios.map((r, i) => (
                                                        <div key={i} style={{ background: "rgba(0,0,0,.2)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 6, padding: 12 }}>
                                                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                                                <strong style={{ color: "#e6edf3" }}>{r.testName}</strong>
                                                                <span style={{ padding: "2px 6px", background: "rgba(255,255,255,.1)", borderRadius: 4, fontSize: 11, color: "#a78bfa" }}>{r.category || "Standard"}</span>
                                                            </div>
                                                            <div style={{ color: "#8b949e", fontSize: 12 }}>Expected Status: <strong style={{ color: "#22c55e" }}>{r.expectedStatus || "200"}</strong></div>
                                                            {r.requestBody && (
                                                                <div style={{ marginTop: 8 }}>
                                                                    <div style={{ color: "#8b949e", fontSize: 11, marginBottom: 4 }}>Payload Shape:</div>
                                                                    <pre style={{ background: "#000", padding: 8, borderRadius: 4, fontSize: 11, color: "#e6edf3", overflow: "auto", maxHeight: 80, margin: 0 }}>{typeof r.requestBody === "string" ? r.requestBody : JSON.stringify(r.requestBody, null, 2)}</pre>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </td></tr>
                                    )}
                                    </React.Fragment>
                                ));
                            })()}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderReviewState = () => {
        if (!hasAnalysis) return <div style={{ color: "#8b949e" }}>Run analysis first to unlock this step.</div>;
        if (!hasGeneratedTests) return <div style={{ color: "#8b949e" }}>Nothing to review. Generate tests first.</div>;

        const totalScenarios = aiTests.flatMap(t => t.requests).length;
        const allSelected = totalScenarios > 0 && selectedTestIds.length === totalScenarios;

        return (
            <div style={{ animation: "fadeIn 0.2s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 18 }}>Draft Integration Tests</h3>
                        <p style={{ margin: "4px 0 0", color: "#8b949e", fontSize: 14 }}>Review the AI-generated test suite before approving them for execution.</p>
                    </div>
                    {!isApproved ? (
                        <button 
                            onClick={handleApprove} 
                            disabled={selectedTestIds.length === 0}
                            style={selectedTestIds.length === 0 ? disabledButtonStyle : { ...buttonStyle("#fbbf24"), background: "#fbbf24", color: "#000" }}>
                            Approve Selected ({selectedTestIds.length})
                        </button>
                    ) : (
                        <div style={{ color: "#22c55e", fontWeight: 600 }}>✓ All Tests Approved</div>
                    )}
                </div>

                <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                        <thead>
                            <tr style={{ background: "rgba(255,255,255,.03)", borderBottom: "1px solid rgba(255,255,255,.05)", textAlign: "left" }}>
                                <th style={{ padding: "12px 16px", width: "40px" }}>
                                    <input 
                                        type="checkbox" 
                                        checked={allSelected}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                const allIds = aiTests.flatMap(t => t.requests.map(r => `${t.id}::${r.testName}`));
                                                setSelectedTestIds(allIds);
                                            } else {
                                                setSelectedTestIds([]);
                                            }
                                        }}
                                        style={{ cursor: "pointer" }}
                                    />
                                </th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Endpoint</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Scenario</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Testing Purpose</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Generated Test Location</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Current State</th>
                            </tr>
                        </thead>
                        <tbody>
                            {aiTests.flatMap(t => t.requests.map((r, idx) => {
                                const id = `${t.id}::${r.testName}`;
                                return (
                                <tr key={`${t.id}-${idx}`} style={{ borderBottom: "1px solid rgba(255,255,255,.03)" }}>
                                    <td style={{ padding: "12px 16px" }}>
                                        <input 
                                            type="checkbox" 
                                            checked={selectedTestIds.includes(id)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setSelectedTestIds(prev => [...prev, id]);
                                                } else {
                                                    setSelectedTestIds(prev => prev.filter(x => x !== id));
                                                }
                                            }}
                                            style={{ cursor: "pointer" }}
                                        />
                                    </td>
                                    <td style={{ padding: "12px 16px", fontFamily: "monospace", color: "#a78bfa" }}>
                                        {r.method.toUpperCase()} {r.path}
                                    </td>
                                    <td style={{ padding: "12px 16px", color: "#e6edf3" }}>{r.testName}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e", fontSize: 13 }}>Verify endpoint logic</td>
                                    <td style={{ padding: "12px 16px", fontFamily: "monospace", color: "#8b949e", fontSize: 12 }}>{t.filePath}</td>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span title={isApproved ? `Approved by User on ${new Date().toLocaleDateString()}` : "Pending Approval"} style={{ color: statusColor(isApproved ? "APPROVED" : t.status), fontWeight: 600, fontSize: 12 }}>
                                            ● {isApproved ? "APPROVED" : (t.status || "DRAFT")}
                                        </span>
                                    </td>
                                </tr>
                            )}))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderExecutionReport = () => {
        if (activeJobId && activeJobType === "EXECUTE") return renderLiveProgress("EXECUTE");
        if (!hasAnalysis || !isApproved) return <div style={{ color: "#8b949e" }}>Complete analysis, generation, and approval to unlock execution reports.</div>;
        if (!execution) return <div style={{ color: "#8b949e" }}>Tests have not been executed yet. Click <strong style={{ color: "#e6edf3" }}>Run Tests</strong> above.</div>;
        
        const filterBtnStyle = (filterValue, color) => ({
            cursor: "pointer", padding: "4px 12px", borderRadius: 6, fontSize: 14, fontWeight: 600,
            background: executionFilter === filterValue ? `${color}22` : "transparent",
            color: color,
            border: executionFilter === filterValue ? `1px solid ${color}55` : "1px solid transparent",
            transition: "all 0.15s ease"
        });

        // Apply filter to endpoints
        const filteredEndpoints = executionFilter
            ? endpoints.filter(ep => {
                if (executionFilter === "PASSED") return ep.passedCount > 0;
                if (executionFilter === "FAILED") return ep.failedCount > 0;
                if (executionFilter === "SKIPPED") return ep.status === "Not Executed" || ep.executedCount === 0;
                if (executionFilter === "COVERED") return ep.status === "Covered" || ep.status === "PASSED";
                if (executionFilter === "UNCOVERED") return ep.status === "Uncovered";
                return true;
            })
            : endpoints;

        return (
            <div style={{ animation: "fadeIn 0.2s" }}>
                <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 200 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>Execution Summary</div>
                        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                            <span onClick={() => { setExecutionFilter(null); scrollToRef(execTableRef); }} style={filterBtnStyle(null, "#e6edf3")}>{summary?.totalTests || 0} Total</span>
                            <span onClick={() => { setExecutionFilter(executionFilter === "PASSED" ? null : "PASSED"); scrollToRef(execTableRef); }} style={filterBtnStyle("PASSED", "#22c55e")}>{summary?.passedTests || 0} Passed</span>
                            <span onClick={() => { setExecutionFilter(executionFilter === "FAILED" ? null : "FAILED"); scrollToRef(execTableRef); }} style={filterBtnStyle("FAILED", "#f87171")}>{summary?.failedTests || 0} Failed</span>
                            <span onClick={() => { setExecutionFilter(executionFilter === "SKIPPED" ? null : "SKIPPED"); scrollToRef(execTableRef); }} style={filterBtnStyle("SKIPPED", "#fbbf24")}>{summary?.skippedTests || 0} Skipped</span>
                        </div>
                    </div>
                    <div style={{ ...cardStyle, flex: 1, minWidth: 200 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>API Coverage</div>
                        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                            <span onClick={() => { setExecutionFilter(executionFilter === "COVERED" ? null : "COVERED"); scrollToRef(execTableRef); }} style={{ ...filterBtnStyle("COVERED", "#22c55e"), fontSize: 13 }}>Tested: <strong>{summary?.testedApis || 0}/{summary?.discoveredApis || 0}</strong></span>
                            <span onClick={() => { setExecutionFilter(executionFilter === "UNCOVERED" ? null : "UNCOVERED"); scrollToRef(execTableRef); }} style={{ ...filterBtnStyle("UNCOVERED", "#f87171"), fontSize: 13 }}>Uncovered: <strong>{summary?.uncoveredApis || 0}</strong></span>
                            <span onClick={() => { setExecutionFilter(executionFilter === "SKIPPED" ? null : "SKIPPED"); scrollToRef(execTableRef); }} style={{ ...filterBtnStyle("SKIPPED", "#9ca3af"), fontSize: 13 }}>Not Executed: <strong>{summary?.notExecutedApis || 0}</strong></span>
                        </div>
                    </div>
                    <div className="hoverable-card" onClick={() => setCoverageBreakdownModal(true)} style={{ ...clickableCardStyle("codecov"), flex: 2, minWidth: 300 }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                            Code Coverage <span style={{ fontSize: 10, color: "#a78bfa" }}>↓ view</span>
                        </div>
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

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 16px" }}>
                    <h3 style={{ margin: 0, fontSize: 18 }}>Per-Endpoint Analysis</h3>
                    {executionFilter && (
                        <button onClick={() => setExecutionFilter(null)} style={{ background: "rgba(167,139,250,.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,.3)", borderRadius: 20, padding: "4px 12px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                            Filtering: {executionFilter} <span style={{ fontWeight: 700 }}>✕</span>
                        </button>
                    )}
                </div>
                <div ref={execTableRef} style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                        <thead>
                            <tr style={{ background: "rgba(255,255,255,.03)", borderBottom: "1px solid rgba(255,255,255,.05)", textAlign: "left" }}>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Method</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Endpoint</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Generated</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Approved</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Executed</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Passed</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Failed</th>
                                <th style={{ padding: "12px 16px", fontWeight: 600, color: "#8b949e" }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredEndpoints.length === 0 ? (
                                <tr><td colSpan={8} style={{ padding: "24px 16px", textAlign: "center", color: "#8b949e" }}>No endpoints match the current filter.</td></tr>
                            ) : filteredEndpoints.map((ep, idx) => (
                                <React.Fragment key={idx}>
                                <tr onClick={() => setExpandedExecRow(expandedExecRow === idx ? null : idx)} style={{ borderBottom: "1px solid rgba(255,255,255,.03)", cursor: "pointer", background: expandedExecRow === idx ? "rgba(167,139,250,.04)" : "transparent", transition: "background 0.1s" }}>
                                    <td style={{ padding: "12px 16px" }}>
                                        <span style={{ 
                                            background: ep.method === "GET" ? "#3b82f633" : ep.method === "POST" ? "#22c55e33" : ep.method === "PUT" ? "#fbbf2433" : ep.method === "DELETE" ? "#f8717133" : "#6b728033",
                                            color: ep.method === "GET" ? "#60a5fa" : ep.method === "POST" ? "#4ade80" : ep.method === "PUT" ? "#fcd34d" : ep.method === "DELETE" ? "#fca5a5" : "#9ca3af",
                                            padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700 
                                        }}>{ep.method}</span>
                                    </td>
                                    <td style={{ padding: "12px 16px", fontFamily: "monospace" }}>{ep.path}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.generatedCount || 0}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.approvedCount || 0}</td>
                                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>{ep.executedCount || 0}</td>
                                    <td style={{ padding: "12px 16px", color: ep.passedCount > 0 ? "#22c55e" : "#8b949e", fontWeight: ep.passedCount > 0 ? 600 : 400 }}>{ep.passedCount || 0}</td>
                                    <td style={{ padding: "12px 16px", color: ep.failedCount > 0 ? "#f87171" : "#8b949e", fontWeight: ep.failedCount > 0 ? 600 : 400 }}>{ep.failedCount || 0}</td>
                                    <td style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ color: statusColor(ep.status), fontWeight: 600 }}>{ep.status}</span>
                                        <span style={{ fontSize: 10, color: "#8b949e" }}>{expandedExecRow === idx ? "▲" : "▼"}</span>
                                    </td>
                                </tr>
                                {expandedExecRow === idx && (
                                    <tr><td colSpan={8} style={{ padding: 0 }}>
                                        <div style={{ padding: "16px 24px", background: "rgba(167,139,250,.03)", borderLeft: "3px solid #a78bfa", animation: "fadeIn 0.15s" }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3", marginBottom: 12 }}>Test Results — {ep.method} {ep.path}</div>
                                            {ep.testResults && ep.testResults.length > 0 ? (
                                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                                    {ep.testResults.map((tr, ti) => (
                                                        <div key={ti} style={{ padding: "8px 12px", background: "rgba(0,0,0,.3)", borderRadius: 6, fontSize: 13 }}>
                                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                                <span style={{ color: "#e6edf3" }}>{tr.testName || tr.name || `Test ${ti + 1}`}</span>
                                                                <span style={{ color: tr.status === "PASSED" ? "#22c55e" : tr.status === "FAILED" ? "#f87171" : "#fbbf24", fontWeight: 600, fontSize: 12 }}>● {tr.status}</span>
                                                            </div>
                                                            {tr.duration && <div style={{ color: "#8b949e", fontSize: 12, marginTop: 4 }}>Duration: {tr.duration}ms</div>}
                                                            {tr.errorMessage && (
                                                                <pre style={{ background: "rgba(248,113,113,.08)", color: "#fca5a5", padding: 8, borderRadius: 4, fontSize: 11, marginTop: 6, overflow: "auto", maxHeight: 80, margin: "6px 0 0", border: "1px solid rgba(248,113,113,.15)" }}>{tr.errorMessage}</pre>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
                                                    <div><span style={{ color: "#8b949e" }}>Generated Scenarios: </span><span style={{ color: "#e6edf3" }}>{ep.generatedCount || 0}</span></div>
                                                    <div><span style={{ color: "#8b949e" }}>Approved: </span><span style={{ color: "#e6edf3" }}>{ep.approvedCount || 0}</span></div>
                                                    <div><span style={{ color: "#8b949e" }}>Pass Rate: </span><span style={{ color: (ep.passedCount || 0) > 0 ? "#22c55e" : "#8b949e" }}>{ep.executedCount ? Math.round(((ep.passedCount || 0) / ep.executedCount) * 100) : 0}%</span></div>
                                                    <div><span style={{ color: "#8b949e" }}>Coverage Status: </span><span style={{ color: statusColor(ep.status), fontWeight: 600 }}>{ep.status}</span></div>
                                                </div>
                                            )}
                                        </div>
                                    </td></tr>
                                )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div style={{ color: "#e6edf3", fontFamily: "system-ui, -apple-system, sans-serif", fontSize: 14, minHeight: "100%", padding: 24 }}>
            {error && <div style={{ background: "rgba(248,113,113,.1)", color: "#f87171", padding: "12px 16px", borderRadius: 6, marginBottom: 20, display: "flex", justifyContent: "space-between", border: "1px solid rgba(248,113,113,.2)" }}>
                <span>{error}</span>
                <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer" }}>×</button>
            </div>}

            {infoMessage && <div style={{ background: "rgba(59,130,246,.08)", color: "#60a5fa", padding: "12px 16px", borderRadius: 6, marginBottom: 20, display: "flex", justifyContent: "space-between", border: "1px solid rgba(59,130,246,.2)", animation: "fadeIn 0.3s", alignItems: "center" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 16 }}>ℹ</span> {infoMessage}
                </span>
                <button onClick={() => setInfoMessage("")} style={{ background: "none", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
            </div>}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
                        Integration Test Pipeline
                        <span style={{ fontSize: 11, padding: "2px 8px", background: "rgba(167,139,250,.1)", color: "#a78bfa", borderRadius: 12, border: "1px solid rgba(167,139,250,.2)" }}>Beta</span>
                    </h1>
                    <p style={{ margin: "4px 0 0", color: "#8b949e", fontSize: 14 }}>End-to-end API testing powered by AI & Supertest.</p>
                </div>
            </div>

            {/* Pipeline Stage Tracker */}
            <div style={{ marginBottom: 32 }}>
                <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
                    {/* 1. Analysis */}
                    <div 
                        onClick={() => setActiveTab("ANALYZE")}
                        style={{ ...cardStyle, background: activeTab === "ANALYZE" ? "rgba(167,139,250,.08)" : cardStyle.background, flex: 1, minWidth: 200, cursor: "pointer", border: activeTab === "ANALYZE" ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,.075)", borderLeft: hasAnalysis ? "4px solid #22c55e" : "4px solid #8b949e" }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>① Analyze Project</div>
                        {activeJobId && activeJobType === "ANALYZE" ? (
                            <div>
                                <div style={{ fontSize: 13, color: "#fbbf24", fontWeight: 600, marginBottom: 4 }}>● Analyzing...</div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Please wait.</div>
                            </div>
                        ) : hasAnalysis ? (
                            <div>
                                <div style={{ color: "#22c55e", fontWeight: 600, marginBottom: 4 }}>✓ Analysis Complete</div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>{summary?.discoveredApis || 0} API endpoints discovered.</div>
                                <button onClick={(e) => { e.stopPropagation(); if(!activeJobId) setShowAnalyzeModal(true); }} style={activeJobId ? disabledButtonStyle : buttonStyle("#8b949e")}>Re-analyze</button>
                            </div>
                        ) : (
                            <div>
                                <div style={{ fontSize: 13, color: "#fbbf24", fontWeight: 600, marginBottom: 4 }}>Pending Analysis</div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Discover endpoints to test.</div>
                                <button className="animate-pulse" onClick={(e) => { e.stopPropagation(); if(!activeJobId) setShowAnalyzeModal(true); }} style={activeJobId ? disabledButtonStyle : buttonStyle(activeTab === "ANALYZE" ? "#a78bfa" : "#fbbf24")}>Start Analysis</button>
                            </div>
                        )}
                    </div>

                    {/* 2. Generation */}
                    <div 
                        onClick={() => hasAnalysis && setActiveTab("GENERATE")}
                        style={{ ...cardStyle, background: activeTab === "GENERATE" ? "rgba(167,139,250,.08)" : cardStyle.background, flex: 1, minWidth: 200, cursor: hasAnalysis ? "pointer" : "default", opacity: hasAnalysis ? 1 : 0.5, border: activeTab === "GENERATE" ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,.075)", borderLeft: (hasAnalysis && hasGeneratedTests) ? "4px solid #22c55e" : "4px solid #8b949e" }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>② Generate Tests</div>
                        {activeJobId && activeJobType === "GENERATE" ? (
                            <div>
                                <div style={{ color: "#fbbf24", fontWeight: 600, marginBottom: 4 }}>● Generating...</div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Please wait.</div>
                            </div>
                        ) : !hasAnalysis ? (
                            <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Locked: Analyze first.</div>
                        ) : hasGeneratedTests ? (
                            <div>
                                <div style={{ color: "#22c55e", fontWeight: 600, marginBottom: 4 }}>✓ Tests Generated</div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>{generation?.generatedScenarios || 0} scenarios ready.</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={(e) => { e.stopPropagation(); setActiveTab("GENERATE"); }} style={buttonStyle(activeTab === "GENERATE" ? "#a78bfa" : "#8b949e")}>View Tests</button>
                                    <button onClick={(e) => { e.stopPropagation(); if(!activeJobId) handleGenerateClick(); }} style={activeJobId ? disabledButtonStyle : buttonStyle("#8b949e")}>Re-generate</button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <div style={{ fontSize: 13, color: "#fbbf24", fontWeight: 600, marginBottom: 4 }}>Ready for Generation</div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Let AI build your test suite.</div>
                                <button onClick={(e) => { e.stopPropagation(); if(!activeJobId) handleGenerateClick(); }} style={activeJobId ? disabledButtonStyle : buttonStyle(activeTab === "GENERATE" ? "#a78bfa" : "#a78bfa")}>Generate Tests</button>
                            </div>
                        )}
                    </div>

                    {/* 3. Review & Approve */}
                    <div 
                        onClick={() => (hasAnalysis && hasGeneratedTests) && setActiveTab("REVIEW")}
                        style={{ ...cardStyle, background: activeTab === "REVIEW" ? "rgba(167,139,250,.08)" : cardStyle.background, flex: 1, minWidth: 200, cursor: (hasAnalysis && hasGeneratedTests) ? "pointer" : "default", opacity: (hasAnalysis && hasGeneratedTests) ? 1 : 0.5, border: activeTab === "REVIEW" ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,.075)", borderLeft: (hasAnalysis && hasGeneratedTests && isApproved) ? "4px solid #22c55e" : "4px solid #8b949e" }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>③ Review & Approve</div>
                        {(!hasAnalysis || !hasGeneratedTests) ? (
                            <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Locked: Generate first.</div>
                        ) : isApproved ? (
                            <div>
                                <div style={{ color: "#22c55e", fontWeight: 600, marginBottom: 4 }}>✓ {aiTests.flatMap(t => t.requests).length || 0} scenarios approved</div>
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
                        onClick={() => (hasAnalysis && isApproved) && setActiveTab("EXECUTE")}
                        style={{ ...cardStyle, background: activeTab === "EXECUTE" ? "rgba(167,139,250,.08)" : cardStyle.background, flex: 1, minWidth: 200, cursor: (hasAnalysis && isApproved) ? "pointer" : "default", opacity: (hasAnalysis && isApproved) ? 1 : 0.5, border: activeTab === "EXECUTE" ? "1px solid #a78bfa" : "1px solid rgba(255,255,255,.075)", borderLeft: (hasAnalysis && isApproved && execution) ? "4px solid #22c55e" : "4px solid #8b949e" }}>
                        <div style={{ color: "#8b949e", fontSize: 12, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>④ Execute Tests</div>
                        {activeJobId && activeJobType === "EXECUTE" ? (
                            <div>
                                <div style={{ color: activeJobStatus === "FAILED" ? "#f87171" : "#fbbf24", fontWeight: 600, marginBottom: 4 }}>● {activeJobStatus === "FAILED" ? "Failed" : "Running..."}</div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>{activeJobStatus === "FAILED" ? "Execution crashed." : "Please wait."}</div>
                            </div>
                        ) : (!hasAnalysis || !isApproved) ? (
                            <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Locked: Approve first.</div>
                        ) : execution ? (
                            <div>
                                <div style={{ color: execution.status === "PASSED" ? "#22c55e" : "#f87171", fontWeight: 600, marginBottom: 4 }}>
                                    {execution.status === "PASSED" ? "✓ " : "✕ "}{summary?.passedTests || 0}/{summary?.totalTests || 0} passed
                                </div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Completed {execution.completedAt ? formatDistanceToNow(new Date(execution.completedAt)) + " ago" : "Unknown"}.</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={(e) => { e.stopPropagation(); setActiveTab("EXECUTE"); }} style={buttonStyle(activeTab === "EXECUTE" ? "#a78bfa" : "#8b949e")}>View Report</button>
                                    <button onClick={(e) => { e.stopPropagation(); if(!activeJobId) handleRunApprovedTests(); }} style={activeJobId ? disabledButtonStyle : buttonStyle("#3b82f6")}>Run Again</button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <div style={{ fontSize: 13, color: "#8b949e", marginBottom: 12 }}>Execute approved tests.</div>
                                <button onClick={(e) => { e.stopPropagation(); if(!activeJobId) handleRunApprovedTests(); }} style={activeJobId ? disabledButtonStyle : buttonStyle("#3b82f6")}>Run Tests</button>
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

            {/* Code Viewer Modal */}
            {codeModal && (
                <div style={{
                    position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
                    background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
                }}>
                    <div style={{
                        background: "#161b22", borderRadius: 12, width: "80%", maxWidth: 1000, height: "80vh",
                        border: "1px solid #30363d", boxShadow: "0 8px 32px rgba(0,0,0,0.8)", display: "flex", flexDirection: "column"
                    }}>
                        <div style={{ padding: "16px 24px", borderBottom: "1px solid #30363d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                                <h2 style={{ margin: 0, color: "#e6edf3", fontSize: 18 }}>{codeModal.title}</h2>
                                {codeModal.filePath && <div style={{ color: "#8b949e", fontSize: 12, marginTop: 4, fontFamily: "monospace" }}>{codeModal.filePath}</div>}
                            </div>
                            <button onClick={() => setCodeModal(null)} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 20 }}>✕</button>
                        </div>
                        <div style={{ flex: 1, padding: 24, overflow: "auto", background: "#0d1117" }}>
                            <pre style={{ margin: 0, color: "#e6edf3", fontFamily: "monospace", fontSize: 13, lineHeight: 1.5 }}>
                                {codeModal.code}
                            </pre>
                        </div>
                        <div style={{ padding: "16px 24px", borderTop: "1px solid #30363d", display: "flex", justifyContent: "flex-end" }}>
                            <button onClick={() => setCodeModal(null)} style={buttonStyle("#a78bfa")}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Generated Files Modal */}
            {generatedFilesModal && (
                <div style={{
                    position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
                    background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
                }}>
                    <div style={{
                        background: "#161b22", borderRadius: 12, width: "80%", maxWidth: 1200, height: "80vh",
                        border: "1px solid #30363d", boxShadow: "0 8px 32px rgba(0,0,0,0.8)", display: "flex"
                    }}>
                        {/* Sidebar: File List */}
                        <div style={{ width: 300, borderRight: "1px solid #30363d", display: "flex", flexDirection: "column" }}>
                            <div style={{ padding: "16px 24px", borderBottom: "1px solid #30363d" }}>
                                <h2 style={{ margin: 0, color: "#e6edf3", fontSize: 16 }}>Generated Files</h2>
                            </div>
                            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
                                {aiTests.map((t, i) => (
                                    <div 
                                        key={i} 
                                        onClick={async () => {
                                            try {
                                                const data = await readFile(t.filePath);
                                                setSelectedFileCode({ filePath: t.filePath, code: data });
                                            } catch (e) {
                                                setSelectedFileCode({ filePath: t.filePath, code: "// Failed to load file from disk." });
                                            }
                                        }}
                                        style={{ padding: "10px 12px", cursor: "pointer", borderRadius: 6, background: selectedFileCode?.filePath === t.filePath ? "rgba(167,139,250,.1)" : "transparent", color: selectedFileCode?.filePath === t.filePath ? "#a78bfa" : "#8b949e", fontSize: 13, display: "flex", alignItems: "center", gap: 8, transition: "background 0.15s" }}>
                                        📄 {t.filePath.split("/").pop()}
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Main Content: Code Viewer */}
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#0d1117", borderTopRightRadius: 12, borderBottomRightRadius: 12 }}>
                            <div style={{ padding: "16px 24px", borderBottom: "1px solid #30363d", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#161b22", borderTopRightRadius: 12 }}>
                                <div style={{ color: "#e6edf3", fontSize: 14, fontFamily: "monospace" }}>
                                    {selectedFileCode ? selectedFileCode.filePath : "Select a file to view"}
                                </div>
                                <button onClick={() => setGeneratedFilesModal(false)} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 20 }}>✕</button>
                            </div>
                            <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
                                {selectedFileCode ? (
                                    <pre style={{ margin: 0, color: "#e6edf3", fontFamily: "monospace", fontSize: 13, lineHeight: 1.5 }}>{selectedFileCode.code}</pre>
                                ) : (
                                    <div style={{ color: "#8b949e", display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>No file selected.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Validation Modal */}
            {validationModal && (
                <div style={{
                    position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
                    background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
                }}>
                    <div style={{
                        background: "#161b22", borderRadius: 12, width: 600,
                        border: "1px solid #30363d", boxShadow: "0 8px 32px rgba(0,0,0,0.8)", display: "flex", flexDirection: "column"
                    }}>
                        <div style={{ padding: "16px 24px", borderBottom: "1px solid #30363d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h2 style={{ margin: 0, color: "#e6edf3", fontSize: 18 }}>Validation Results</h2>
                            <button onClick={() => setValidationModal(false)} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 20 }}>✕</button>
                        </div>
                        <div style={{ padding: 24, maxHeight: "60vh", overflowY: "auto" }}>
                            {generation?.isValid === false ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                    {aiTests.filter(t => t.isValid === false).map((t, i) => (
                                        <div key={i} style={{ background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.2)", padding: 12, borderRadius: 6 }}>
                                            <div style={{ color: "#f87171", fontFamily: "monospace", fontSize: 13, marginBottom: 8, fontWeight: 600 }}>{t.filePath}</div>
                                            <div style={{ color: "#e6edf3", fontSize: 12, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>{t.validationError || "AST Parsing failed: Invalid syntax generated by AI."}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ color: "#22c55e", textAlign: "center", padding: "32px 0" }}>
                                    <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                                    <div style={{ fontSize: 16 }}>All {aiTests.length} generated test files passed syntax validation!</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Coverage Breakdown Modal */}
            {coverageBreakdownModal && (
                <div style={{
                    position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
                    background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
                }}>
                    <div style={{
                        background: "#161b22", borderRadius: 12, width: 900, height: "70vh",
                        border: "1px solid #30363d", boxShadow: "0 8px 32px rgba(0,0,0,0.8)", display: "flex", flexDirection: "column"
                    }}>
                        <div style={{ padding: "16px 24px", borderBottom: "1px solid #30363d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h2 style={{ margin: 0, color: "#e6edf3", fontSize: 18 }}>Code Coverage Breakdown</h2>
                            <button onClick={() => setCoverageBreakdownModal(false)} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 20 }}>✕</button>
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", padding: 0 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                <thead style={{ position: "sticky", top: 0, background: "#161b22", boxShadow: "0 1px 0 rgba(255,255,255,0.1)" }}>
                                    <tr>
                                        <th style={{ padding: "12px 24px", textAlign: "left", color: "#8b949e", fontWeight: 600 }}>File Path</th>
                                        <th style={{ padding: "12px 24px", textAlign: "right", color: "#8b949e", fontWeight: 600 }}>Statements</th>
                                        <th style={{ padding: "12px 24px", textAlign: "right", color: "#8b949e", fontWeight: 600 }}>Branches</th>
                                        <th style={{ padding: "12px 24px", textAlign: "right", color: "#8b949e", fontWeight: 600 }}>Functions</th>
                                        <th style={{ padding: "12px 24px", textAlign: "right", color: "#8b949e", fontWeight: 600 }}>Lines</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {summary?.fileCoverages && summary.fileCoverages.length > 0 ? (
                                        summary.fileCoverages.map((f, i) => (
                                            <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                                                <td style={{ padding: "12px 24px", fontFamily: "monospace", color: "#e6edf3" }}>{f.filePath}</td>
                                                <td style={{ padding: "12px 24px", textAlign: "right", color: f.statement > 80 ? "#22c55e" : f.statement > 50 ? "#fbbf24" : "#f87171", fontWeight: 600 }}>{Number(f.statement).toFixed(1)}%</td>
                                                <td style={{ padding: "12px 24px", textAlign: "right", color: f.branch > 80 ? "#22c55e" : f.branch > 50 ? "#fbbf24" : "#f87171", fontWeight: 600 }}>{Number(f.branch).toFixed(1)}%</td>
                                                <td style={{ padding: "12px 24px", textAlign: "right", color: f.function > 80 ? "#22c55e" : f.function > 50 ? "#fbbf24" : "#f87171", fontWeight: 600 }}>{Number(f.function).toFixed(1)}%</td>
                                                <td style={{ padding: "12px 24px", textAlign: "right", color: f.line > 80 ? "#22c55e" : f.line > 50 ? "#fbbf24" : "#f87171", fontWeight: 600 }}>{Number(f.line).toFixed(1)}%</td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr><td colSpan={5} style={{ padding: 48, textAlign: "center", color: "#8b949e" }}>No file coverage data available.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
