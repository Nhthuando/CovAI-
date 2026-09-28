import React, { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";

export default function IntegrationScenarioEditorModal({
    isOpen,
    onClose,
    onSave,
    initialCode,
    title,
    loading
}) {
    const [code, setCode] = useState(initialCode || "");

    useEffect(() => {
        if (isOpen) setCode(initialCode || "");
    }, [isOpen, initialCode]);

    if (!isOpen) return null;

    return (
        <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.6)", zIndex: 9999,
            display: "flex", justifyContent: "center", alignItems: "center"
        }}>
            <div style={{
                background: "#0d1117", border: "1px solid #30363d",
                borderRadius: 12, width: 800, height: 600,
                display: "flex", flexDirection: "column", overflow: "hidden",
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)"
            }}>
                <div style={{
                    padding: "16px 24px", borderBottom: "1px solid #30363d",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: "#161b22"
                }}>
                    <h3 style={{ margin: 0, fontSize: 16, color: "#e6edf3" }}>{title}</h3>
                    <button onClick={onClose} disabled={loading} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 16 }}>✕</button>
                </div>
                
                <div style={{ flex: 1 }}>
                    <Editor
                        height="100%"
                        defaultLanguage="javascript"
                        theme="vs-dark"
                        value={code}
                        onChange={(value) => setCode(value)}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 14,
                            lineNumbers: "on",
                            scrollBeyondLastLine: false,
                            automaticLayout: true
                        }}
                    />
                </div>

                <div style={{
                    padding: "16px 24px", borderTop: "1px solid #30363d",
                    display: "flex", justifyContent: "flex-end", gap: 12,
                    background: "#161b22"
                }}>
                    <button 
                        onClick={onClose} 
                        disabled={loading}
                        style={{
                            background: "transparent", color: "#e6edf3",
                            border: "1px solid #30363d", borderRadius: 6,
                            padding: "6px 16px", cursor: "pointer"
                        }}
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={() => onSave(code)}
                        disabled={loading}
                        style={{
                            background: "rgba(34,197,94,0.1)", color: "#22c55e",
                            border: "1px solid rgba(34,197,94,0.4)", borderRadius: 6,
                            padding: "6px 16px", cursor: loading ? "not-allowed" : "pointer",
                            fontWeight: 600
                        }}
                    >
                        {loading ? "Saving..." : "Save Scenario"}
                    </button>
                </div>
            </div>
        </div>
    );
}
