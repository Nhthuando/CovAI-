import React, { useEffect, useState } from "react";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
    const token = localStorage.getItem("token");
    return {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
    };
}

export default function IntegrationHistoryPane({ snapshotId }) {
    const [history, setHistory] = useState({ jobs: [], testRuns: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!snapshotId) return;
        setLoading(true);
        fetch(`${BASE_URL}/coverage/${snapshotId}/integration/history`, { headers: getAuthHeaders() })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setHistory(data.data);
                } else {
                    setError(data.message || "Failed to load history.");
                }
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [snapshotId]);

    if (loading) {
        return <div style={{ padding: 24, color: "#8b949e", textAlign: "center" }}>Loading history...</div>;
    }

    if (error) {
        return <div style={{ padding: 24, color: "#f87171", textAlign: "center" }}>{error}</div>;
    }

    const { jobs, testRuns } = history;
    const hasData = jobs.length > 0 || testRuns.length > 0;

    if (!hasData) {
        return (
            <div style={{ padding: 48, color: "#8b949e", textAlign: "center", display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ fontSize: 32 }}>🕰️</div>
                <div style={{ fontSize: 14 }}>
                    <p>No historical data found for this snapshot.</p>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: 16, color: "#e6edf3" }}>Integration History</h3>
            </div>
            
            <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
                {testRuns.length > 0 && (
                    <div>
                        <h4 style={{ color: "#8b949e", fontSize: 12, textTransform: "uppercase", marginBottom: 12 }}>Recent Executions</h4>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {testRuns.map((tr, i) => (
                                <div key={i} style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8, padding: 16 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                        <span style={{ color: "#e6edf3", fontWeight: 600 }}>Test Run</span>
                                        <span style={{ color: tr.status === "PASSED" ? "#22c55e" : "#f87171", fontSize: 13, fontWeight: 600 }}>
                                            {tr.status}
                                        </span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8b949e" }}>
                                        <span>{new Date(tr.createdAt).toLocaleString()}</span>
                                        <span>{tr.totalTests} tests ({tr.passedTests} passed)</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {jobs.length > 0 && (
                    <div>
                        <h4 style={{ color: "#8b949e", fontSize: 12, textTransform: "uppercase", marginBottom: 12 }}>Pipeline Jobs</h4>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {jobs.map((job, i) => (
                                <div key={i} style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8, padding: 16 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                        <span style={{ color: "#e6edf3", fontWeight: 600 }}>{job.type}</span>
                                        <span style={{ color: job.status === "SUCCESS" ? "#22c55e" : job.status === "FAILED" ? "#f87171" : "#fbbf24", fontSize: 13, fontWeight: 600 }}>
                                            {job.status}
                                        </span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8b949e" }}>
                                        <span>{new Date(job.createdAt).toLocaleString()}</span>
                                        {job.computeTimeMs && <span>{Math.round(job.computeTimeMs / 1000)}s</span>}
                                    </div>
                                    {job.errorMessage && (
                                        <div style={{ marginTop: 8, color: "#fca5a5", fontSize: 12, background: "rgba(248,113,113,.1)", padding: 8, borderRadius: 4 }}>
                                            {job.errorMessage}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
