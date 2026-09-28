import React, { useState } from "react";
import IntegrationScenarioEditorModal from "./IntegrationScenarioEditorModal.jsx";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
    const token = localStorage.getItem("token");
    return {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
    };
}

const statusColor = (status) => {
    if (status === "Covered" || status === "PASSED" || status === "APPROVED") return "#22c55e";
    if (status === "Partial" || status === "DRAFT") return "#fbbf24";
    if (status === "Uncovered" || status === "FAILED") return "#f87171";
    if (status === "Not Executed") return "#9ca3af";
    return "#9ca3af";
};

export default function IntegrationScenariosPane({
    aiTests,
    selectedEndpoint,
    hasGeneratedTests,
    isApproved,
    selectedTestIds,
    setSelectedTestIds,
    snapshotId,
    onScenarioChange,
    onError
}) {
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorCode, setEditorCode] = useState("");
    const [editorTitle, setEditorTitle] = useState("");
    const [editorLoading, setEditorLoading] = useState(false);
    
    // Edit mode state
    const [editingScenario, setEditingScenario] = useState(null); // { aiTestId, scenarioName }
    // Add mode state
    const [addingToEndpoint, setAddingToEndpoint] = useState(null); // { aiTestId, endpoint }

    const [processingScenarioId, setProcessingScenarioId] = useState(null);

    const handleEditClick = (scenario) => {
        // Fetch raw code from backend (since frontend doesn't have it parsed)
        // Wait, for edit we can just open the modal with an empty string and then fetch it?
        // Actually, the simplest is to just fetch the whole file and let the user edit it? NO, Phase 3 says "Allow editing only the selected scenario."
        // I need an endpoint to GET a single scenario, OR I can just pass the whole file to Babel in backend.
        // I didn't create a GET endpoint for scenario! 
        // But wait, the frontend doesn't have the scenario code. It only has the aiTest.content which is the full file!
        // The user says: "Do not open or expose the entire generated test file unless necessary."
        // I forgot to add `GET /scenario` to fetch it. I can just write a quick regex on the frontend to guess it, OR I can add a GET endpoint, OR I can just let the user edit the entire AiTest in the modal if I can't GET it.
        // Wait, I can just add `export const getScenario = ...` in the backend real quick! But I can also just send `aiTest.content` down, and use a basic string split here... NO, Phase 3 explicitly says "Do not modify raw test code using string replacement or regex."
        // The *backend* uses Babel to extract it. I should add a GET endpoint in the backend.
    };

    if (!hasGeneratedTests) {
        return (
            <div style={{ padding: 48, color: "#8b949e", textAlign: "center", display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ fontSize: 32 }}>🤖</div>
                <div style={{ fontSize: 14 }}>
                    <p>No test scenarios have been generated yet.</p>
                    <p>Run <strong>Generate Tests</strong> to let AI create test cases for your endpoints.</p>
                </div>
            </div>
        );
    }

    // Group tests by endpoint for the view
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
                    scenarios: [],
                    testFileId: t.id,
                    fileStatus: t.status
                };
            }
            scenariosByEndpoint[epKey].scenarios.push({
                ...r,
                id: `${t.id}::${r.scenarioId}`,
                enabled: r.enabled !== false,
                userEdited: r.userEdited
            });
        });
    });

    const endpointKeys = selectedEndpoint 
        ? [`${selectedEndpoint.method} ${selectedEndpoint.path}`]
        : Object.keys(scenariosByEndpoint);

    const actionButtonStyle = {
        background: "transparent",
        border: "none",
        color: "#8b949e",
        cursor: "pointer",
        fontSize: 12,
        padding: "4px 8px",
        borderRadius: 4,
        fontWeight: 600,
        transition: "all 0.15s ease"
    };

    const handleAction = async (action, scenario, data = {}) => {
        if (processingScenarioId) return;
        setProcessingScenarioId(scenario.id);
        
        try {
            const parts = scenario.id.split("::");
            const aiTestId = parts[0];
            const scenarioId = encodeURIComponent(parts.slice(1).join("::"));
            
            let url = `${BASE_URL}/coverage/${snapshotId}/integration/ai-test/${aiTestId}/scenario/${scenarioId}`;
            let method = "POST";
            let body = {};

            if (action === "DELETE") {
                method = "DELETE";
            } else if (action === "TOGGLE") {
                url += "/toggle";
                method = "PATCH";
                body = { enable: !scenario.enabled };
            } else if (action === "REGENERATE") {
                url += "/regenerate";
            }

            const res = await fetch(url, {
                method,
                headers: getAuthHeaders(),
                body: method !== "DELETE" ? JSON.stringify(body) : undefined
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.message);
            if (result.jobId) {
                while (true) {
                    await new Promise(r => setTimeout(r, 2000));
                    const jobRes = await fetch(`${BASE_URL}/job/${result.jobId}`, { headers: getAuthHeaders() });
                    if (!jobRes.ok) break;
                    const jobData = await jobRes.json();
                    if (jobData.data.status === "SUCCESS") {
                        break;
                    }
                    if (jobData.data.status === "FAILED" || jobData.data.status === "CANCELED") {
                        throw new Error(jobData.data.errorMessage || "Regeneration failed");
                    }
                }
            }
            
            if (onScenarioChange) onScenarioChange();
        } catch (err) {
            if (onError) onError(err.message);
        } finally {
            setProcessingScenarioId(null);
        }
    };

    // We will just let the user Add a scenario for now by typing the code.
    const handleAddClick = (data) => {
        setAddingToEndpoint({ aiTestId: data.testFileId, endpoint: { method: data.method, path: data.path } });
        setEditorTitle(`Add Scenario to ${data.method} ${data.path}`);
        setEditorCode(`it('should handle a new case', async () => {\n  // Arrange\n  \n  // Act\n  \n  // Assert\n  expect(true).toBe(true);\n});`);
        setEditorOpen(true);
    };

    const handleSaveEditor = async (code) => {
        setEditorLoading(true);
        try {
            if (addingToEndpoint) {
                const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/integration/ai-test/${addingToEndpoint.aiTestId}/scenario`, {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ code, endpoint: addingToEndpoint.endpoint })
                });
                const result = await res.json();
                if (!res.ok) throw new Error(result.message);
            } else if (editingScenario) {
                const scenarioId = encodeURIComponent(editingScenario.scenarioId);
                const res = await fetch(`${BASE_URL}/coverage/${snapshotId}/integration/ai-test/${editingScenario.aiTestId}/scenario/${scenarioId}`, {
                    method: "PUT",
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ code })
                });
                const result = await res.json();
                if (!res.ok) throw new Error(result.message);
            }
            
            setEditorOpen(false);
            if (onScenarioChange) onScenarioChange();
        } catch (err) {
            if (onError) onError(err.message);
        } finally {
            setEditorLoading(false);
        }
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.05)", background: "rgba(255,255,255,.02)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#e6edf3", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Test Scenarios
                </h3>
                <div style={{ fontSize: 12, color: "#8b949e", display: "flex", gap: 12 }}>
                    <span>Total: {aiTests.reduce((acc, t) => acc + t.requests.length, 0)}</span>
                    <span style={{ color: isApproved ? "#22c55e" : "#fbbf24" }}>
                        Status: {isApproved ? "Approved" : "Pending Review"}
                    </span>
                </div>
            </div>
            
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                {endpointKeys.length === 0 || !scenariosByEndpoint[endpointKeys[0]] ? (
                    <div style={{ textAlign: "center", color: "#8b949e", marginTop: 40, fontSize: 13 }}>
                        No scenarios found for this endpoint.
                    </div>
                ) : (
                    endpointKeys.map(key => {
                        const data = scenariosByEndpoint[key];
                        if (!data) return null;
                        
                        return (
                            <div key={key} style={{ marginBottom: 24, background: "rgba(255,255,255,.01)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 8, overflow: "hidden" }}>
                                <div style={{ padding: "12px 16px", background: "rgba(255,255,255,.03)", borderBottom: "1px solid rgba(255,255,255,.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div>
                                        <div style={{ fontFamily: "monospace", fontSize: 13, color: "#a78bfa", fontWeight: 600 }}>{key}</div>
                                        <div style={{ fontSize: 11, color: "#8b949e", fontFamily: "monospace", marginTop: 4 }}>{data.filePath}</div>
                                    </div>
                                    <button 
                                        onClick={() => handleAddClick(data)}
                                        disabled={isApproved}
                                        style={{ ...actionButtonStyle, background: "rgba(167,139,250,.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,.2)" }}
                                    >
                                        + Add Scenario
                                    </button>
                                </div>
                                
                                {data.scenarios.map((scenario, idx) => {
                                    const isProcessing = processingScenarioId === scenario.id;
                                    return (
                                        <div key={idx} style={{ 
                                            padding: "12px 16px", 
                                            borderBottom: idx < data.scenarios.length - 1 ? "1px solid rgba(255,255,255,.03)" : "none",
                                            display: "flex",
                                            alignItems: "flex-start",
                                            gap: 12,
                                            opacity: (scenario.enabled && !isProcessing) ? 1 : 0.5,
                                            background: isProcessing ? "rgba(255,255,255,.02)" : "transparent"
                                        }}>
                                            <div style={{ marginTop: 2 }}>
                                                <input 
                                                    type="checkbox"
                                                    checked={selectedTestIds.includes(scenario.id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedTestIds(prev => [...prev, scenario.id]);
                                                        } else {
                                                            setSelectedTestIds(prev => prev.filter(x => x !== scenario.id));
                                                        }
                                                    }}
                                                    disabled={isApproved || !scenario.enabled}
                                                    style={{ cursor: (isApproved || !scenario.enabled) ? "default" : "pointer" }}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ color: "#e6edf3", fontSize: 13, fontWeight: 500, marginBottom: 4, textDecoration: !scenario.enabled ? "line-through" : "none" }}>
                                                    {scenario.testName}
                                                </div>
                                                <div style={{ color: "#8b949e", fontSize: 12, display: "flex", gap: 16 }}>
                                                    <span>{scenario.userEdited ? "Custom" : "AI Generated"}</span>
                                                    <span style={{ 
                                                        color: !scenario.enabled ? "#8b949e" : statusColor(isApproved ? "APPROVED" : data.fileStatus), 
                                                        fontWeight: 600 
                                                    }}>
                                                        ● {!scenario.enabled ? "DISABLED" : (isApproved ? "APPROVED" : (data.fileStatus || "DRAFT"))}
                                                    </span>
                                                </div>
                                                
                                                {!isApproved && (
                                                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                                        <button 
                                                            disabled={isProcessing}
                                                            onClick={() => {
                                                                // Fetch isn't implemented for GET, so we will use the backend's GET endpoint if I add it, or just let user type the new code.
                                                                // I'll add the GET route in backend next.
                                                                const parts = scenario.id.split("::");
                                                                const aiTestId = parts[0];
                                                                const scenarioId = parts.slice(1).join("::");
                                                                fetch(`${BASE_URL}/coverage/${snapshotId}/integration/ai-test/${aiTestId}/scenario/${encodeURIComponent(scenarioId)}`, { headers: getAuthHeaders() })
                                                                    .then(r => r.json())
                                                                    .then(res => {
                                                                        if (res.success) {
                                                                            setEditingScenario({ aiTestId, scenarioId });
                                                                            setAddingToEndpoint(null);
                                                                            setEditorTitle(`Edit Scenario: ${scenario.testName}`);
                                                                            setEditorCode(res.data.code);
                                                                            setEditorOpen(true);
                                                                        }
                                                                    });
                                                            }}
                                                            style={{ ...actionButtonStyle, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)" }}
                                                        >
                                                            Edit
                                                        </button>
                                                        <button 
                                                            disabled={isProcessing}
                                                            onClick={() => handleAction("REGENERATE", scenario)}
                                                            style={{ ...actionButtonStyle, background: "rgba(167,139,250,.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,.2)" }}
                                                        >
                                                            {isProcessing && processingScenarioId === scenario.id ? "Working..." : "✨ Regenerate"}
                                                        </button>
                                                        <button 
                                                            disabled={isProcessing}
                                                            onClick={() => handleAction("TOGGLE", scenario)}
                                                            style={{ ...actionButtonStyle, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)" }}
                                                        >
                                                            {scenario.enabled ? "Disable" : "Enable"}
                                                        </button>
                                                        <button 
                                                            disabled={isProcessing}
                                                            onClick={() => {
                                                                if (window.confirm("Delete this scenario permanently?")) {
                                                                    handleAction("DELETE", scenario);
                                                                }
                                                            }}
                                                            style={{ ...actionButtonStyle, color: "#f87171", background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.2)" }}
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })
                )}
            </div>

            <IntegrationScenarioEditorModal
                isOpen={editorOpen}
                onClose={() => setEditorOpen(false)}
                onSave={handleSaveEditor}
                initialCode={editorCode}
                title={editorTitle}
                loading={editorLoading}
            />
        </div>
    );
}
