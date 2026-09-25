import React from "react";

const methodColors = {
    GET: { bg: "#3b82f633", text: "#60a5fa" },
    POST: { bg: "#22c55e33", text: "#4ade80" },
    PUT: { bg: "#fbbf2433", text: "#fcd34d" },
    DELETE: { bg: "#f8717133", text: "#fca5a5" },
    DEFAULT: { bg: "#6b728033", text: "#9ca3af" }
};

export default function IntegrationTargetsPane({ 
    endpoints, 
    selectedEndpointIndex, 
    onSelectEndpoint,
    hasAnalysis 
}) {
    if (!hasAnalysis) {
        return (
            <div style={{ padding: 24, color: "#8b949e", textAlign: "center", fontSize: 13 }}>
                <p>No integration targets available.</p>
                <p>Run <strong>Analyze Project</strong> to discover API endpoints.</p>
            </div>
        );
    }

    if (!endpoints || endpoints.length === 0) {
        return (
            <div style={{ padding: 24, color: "#8b949e", textAlign: "center", fontSize: 13 }}>
                <p>Analysis complete, but no endpoints were found.</p>
            </div>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.05)", background: "rgba(255,255,255,.02)" }}>
                <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#8b949e", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    API Endpoints ({endpoints.length})
                </h3>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                <div 
                    onClick={() => onSelectEndpoint(null)}
                    style={{
                        padding: "8px 16px",
                        cursor: "pointer",
                        background: selectedEndpointIndex === null ? "rgba(167,139,250,.1)" : "transparent",
                        borderLeft: selectedEndpointIndex === null ? "3px solid #a78bfa" : "3px solid transparent",
                        color: selectedEndpointIndex === null ? "#e6edf3" : "#8b949e",
                        fontSize: 13,
                        fontWeight: selectedEndpointIndex === null ? 600 : 400,
                        transition: "all 0.15s ease"
                    }}
                >
                    View All Targets
                </div>
                {endpoints.map((ep, idx) => {
                    const colors = methodColors[ep.method] || methodColors.DEFAULT;
                    const isSelected = selectedEndpointIndex === idx;
                    
                    return (
                        <div 
                            key={idx}
                            onClick={() => onSelectEndpoint(idx)}
                            style={{
                                padding: "8px 16px",
                                cursor: "pointer",
                                background: isSelected ? "rgba(167,139,250,.1)" : "transparent",
                                borderLeft: isSelected ? "3px solid #a78bfa" : "3px solid transparent",
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                                transition: "all 0.15s ease"
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{
                                    background: colors.bg,
                                    color: colors.text,
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    minWidth: 40,
                                    textAlign: "center"
                                }}>
                                    {ep.method}
                                </span>
                                <span style={{ 
                                    color: isSelected ? "#e6edf3" : "#c9d1d9", 
                                    fontFamily: "monospace", 
                                    fontSize: 12,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis"
                                }}>
                                    {ep.path}
                                </span>
                            </div>
                            
                            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#8b949e", paddingLeft: 54 }}>
                                {ep.executedCount > 0 ? (
                                    <>
                                        <span style={{ color: ep.passedCount > 0 ? "#22c55e" : "#8b949e" }}>✓ {ep.passedCount || 0}</span>
                                        <span style={{ color: ep.failedCount > 0 ? "#f87171" : "#8b949e" }}>✕ {ep.failedCount || 0}</span>
                                    </>
                                ) : (
                                    <span>{ep.generatedCount || 0} scenarios</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
