import React, { useRef, useEffect } from "react";

export default function IntegrationLiveProgress({
    activeJobId,
    activeJobType,
    activeJobStatus,
    error,
    activeLogs,
    parseProgressSteps
}) {
    const logsEndRef = useRef(null);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [activeLogs]);

    if (!activeJobId && activeLogs.length === 0) {
        return (
            <div style={{ padding: 48, color: "#8b949e", textAlign: "center", display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ fontSize: 32 }}>⏱️</div>
                <div style={{ fontSize: 14 }}>
                    <p>No active pipeline execution.</p>
                    <p>Run <strong>Analyze</strong>, <strong>Generate</strong>, or <strong>Run Tests</strong> to see live progress.</p>
                </div>
            </div>
        );
    }

    const steps = parseProgressSteps(activeJobType, activeLogs);

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", animation: "fadeIn 0.2s" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: 16, color: "#e6edf3" }}>
                        {activeJobType === "ANALYZE" && "Analyzing Project Architecture..."}
                        {activeJobType === "GENERATE" && "Generating AI Test Scenarios..."}
                        {activeJobType === "EXECUTE" && "Executing Test Suite..."}
                    </h3>
                    <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>
                        Status: {activeJobStatus === "FAILED" ? "Failed" : activeJobStatus === "SUCCESS" ? "Completed" : "Running..."}
                    </div>
                </div>
                
                {activeJobStatus === "FAILED" && (
                    <div style={{ background: "rgba(248,113,113,.1)", color: "#f87171", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600, border: "1px solid rgba(248,113,113,.2)" }}>
                        ✕ Job Failed
                    </div>
                )}
            </div>

            <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
                {activeJobStatus === "FAILED" && error && (
                    <div style={{ background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.2)", padding: "12px 16px", borderRadius: 8, color: "#fca5a5", fontSize: 13, marginBottom: 24, fontFamily: "monospace", overflowX: "auto" }}>
                        <strong>Error:</strong> {error}
                    </div>
                )}
                
                <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
                    {steps.map((step, idx) => {
                        const isCurrent = !step.done && (idx === 0 || steps[idx - 1].done);
                        return (
                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 12, opacity: (step.done || isCurrent) ? 1 : 0.4 }}>
                                <div style={{
                                    width: 24, height: 24, borderRadius: "50%", 
                                    background: step.done ? "#22c55e" : isCurrent ? "rgba(167,139,250,.2)" : "transparent",
                                    border: step.done ? "1px solid #22c55e" : isCurrent ? "1px solid #a78bfa" : "1px solid #8b949e",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    boxShadow: isCurrent ? "0 0 0 3px rgba(167,139,250,.1)" : "none"
                                }}>
                                    {step.done && <span style={{ color: "#000", fontSize: 14, fontWeight: "bold" }}>✓</span>}
                                    {isCurrent && activeJobStatus !== "FAILED" && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#a78bfa", animation: "pulse 1.5s infinite" }} />}
                                </div>
                                <span style={{ color: step.done ? "#e6edf3" : isCurrent ? "#a78bfa" : "#8b949e", fontWeight: (step.done || isCurrent) ? 600 : 400, fontSize: 14 }}>
                                    {step.label}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, display: "flex", flexDirection: "column", height: 250 }}>
                    <div style={{ padding: "8px 12px", borderBottom: "1px solid #30363d", color: "#8b949e", fontSize: 11, textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.5px" }}>
                        Raw Processing Logs
                    </div>
                    <div style={{ padding: 12, flex: 1, fontFamily: "monospace", fontSize: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                        {activeLogs.map((log, i) => (
                            <div key={i} style={{ color: log.level === "ERROR" ? "#f87171" : log.level === "WARN" ? "#fbbf24" : "#e6edf3" }}>
                                <span style={{ color: "#8b949e", marginRight: 8 }}>[{new Date(log.createdAt).toLocaleTimeString()}]</span>
                                {log.parsedMessage?.label || log.message}
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </div>
            </div>
            <style>{`
                @keyframes pulse {
                    0% { transform: scale(0.95); opacity: 0.5; }
                    50% { transform: scale(1.1); opacity: 1; }
                    100% { transform: scale(0.95); opacity: 0.5; }
                }
            `}</style>
        </div>
    );
}
