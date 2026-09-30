import React, { useState } from "react";
import {
    Check,
    X,
    Edit2,
    Save,
    RotateCcw,
    Sparkles,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Loader2,
    Code,
    Layers,
    ArrowRight,
    FileCode
} from "lucide-react";

/**
 * Status badge color helper
 */
const getStatusBadge = (status) => {
    switch (status) {
        case "APPLYING":
            return {
                bg: "rgba(59, 130, 246, 0.15)",
                border: "rgba(59, 130, 246, 0.4)",
                text: "#60a5fa",
                label: "Applying..."
            };
        case "TESTING":
            return {
                bg: "rgba(234, 179, 8, 0.15)",
                border: "rgba(234, 179, 8, 0.4)",
                text: "#facc15",
                label: "Testing runner..."
            };
        case "PASSED":
        case "APPLIED":
            return {
                bg: "rgba(34, 197, 94, 0.15)",
                border: "rgba(34, 197, 94, 0.4)",
                text: "#4ade80",
                label: "✓ Applied & Passed"
            };
        case "FAILED":
            return {
                bg: "rgba(239, 68, 68, 0.15)",
                border: "rgba(239, 68, 68, 0.4)",
                text: "#f87171",
                label: "✗ Test Failed"
            };
        case "EDITED":
            return {
                bg: "rgba(168, 85, 247, 0.15)",
                border: "rgba(168, 85, 247, 0.4)",
                text: "#c084fc",
                label: "Edited"
            };
        case "REJECTED":
            return {
                bg: "rgba(107, 114, 128, 0.15)",
                border: "rgba(107, 114, 128, 0.4)",
                text: "#9ca3af",
                label: "Rejected"
            };
        default:
            return {
                bg: "rgba(56, 189, 248, 0.12)",
                border: "rgba(56, 189, 248, 0.3)",
                text: "#38bdf8",
                label: "Generated"
            };
    }
};

export default function InlineTestSuggestions({
    filePath,
    suggestions = [],
    isLoading = false,
    onApply,
    onApplyAll,
    onReject,
    onUpdateSuggestionCode,
    applyingIds = new Set(),
    lastApplyResult = null,
    progressStep = "",
}) {
    const [editingId, setEditingId] = useState(null);
    const [editedCode, setEditedCode] = useState({});

    if (isLoading) {
        return (
            <div
                style={{
                    padding: "20px",
                    background: "rgba(15, 23, 42, 0.6)",
                    borderRadius: 8,
                    border: "1px dashed rgba(56, 189, 248, 0.3)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                    color: "#94a3b8",
                    fontSize: 12,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#38bdf8" }}>
                    <Loader2 size={16} className="animate-spin" />
                    <span style={{ fontWeight: 600 }}>Analyzing uncovered code & generating unit tests...</span>
                </div>
                <span>Target: {filePath}</span>
            </div>
        );
    }

    if (!suggestions || suggestions.length === 0) {
        return null;
    }

    const activeSuggestions = suggestions.filter(s => s.status !== "REJECTED");
    const canApplyAll = activeSuggestions.length > 1 && !activeSuggestions.every(s => s.status === "PASSED");

    const startEditing = (sug) => {
        setEditingId(sug.suggestionId || sug.id);
        setEditedCode(prev => ({
            ...prev,
            [sug.suggestionId || sug.id]: sug.generatedCode || sug.suggestedTestCode || ""
        }));
    };

    const saveEditing = (sugId) => {
        if (onUpdateSuggestionCode && editedCode[sugId] !== undefined) {
            onUpdateSuggestionCode(sugId, editedCode[sugId]);
        }
        setEditingId(null);
    };

    const cancelEditing = () => {
        setEditingId(null);
    };

    return (
        <div
            style={{
                marginTop: 12,
                background: "rgba(10, 14, 23, 0.75)",
                border: "1px solid rgba(56, 189, 248, 0.2)",
                borderRadius: 8,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 14,
            }}
        >
            {/* Header bar */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                    paddingBottom: 10,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Sparkles size={16} style={{ color: "#38bdf8" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
                        Suggested Tests for <code style={{ color: "#7dd3fc", background: "rgba(255,255,255,0.05)", padding: "1px 5px", borderRadius: 4 }}>{filePath}</code>
                    </span>
                    <span
                        style={{
                            fontSize: 11,
                            background: "rgba(56, 189, 248, 0.15)",
                            color: "#38bdf8",
                            padding: "2px 8px",
                            borderRadius: 12,
                            fontWeight: 500,
                        }}
                    >
                        {activeSuggestions.length} suggestion{activeSuggestions.length > 1 ? "s" : ""}
                    </span>
                </div>

                {canApplyAll && onApplyAll && (
                    <button
                        onClick={() => onApplyAll(activeSuggestions)}
                        style={{
                            padding: "5px 12px",
                            background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                            border: "1px solid rgba(56, 189, 248, 0.5)",
                            borderRadius: 6,
                            color: "#ffffff",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            boxShadow: "0 2px 8px rgba(2, 132, 199, 0.25)",
                            transition: "all 0.15s ease",
                        }}
                        className="hover:opacity-90"
                    >
                        <Layers size={13} />
                        Apply All ({activeSuggestions.length})
                    </button>
                )}
            </div>

            {/* Progress notification banner if currently applying */}
            {progressStep && (
                <div
                    style={{
                        padding: "8px 12px",
                        background: "rgba(2, 132, 199, 0.12)",
                        border: "1px solid rgba(56, 189, 248, 0.3)",
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#38bdf8",
                        fontSize: 12,
                    }}
                >
                    <Loader2 size={14} className="animate-spin" />
                    <span>{progressStep}</span>
                </div>
            )}

            {/* Before / After Coverage comparison banner if recent apply occurred */}
            {lastApplyResult && lastApplyResult.oldCoverage && lastApplyResult.newCoverage && (
                <div
                    style={{
                        padding: "10px 14px",
                        background: "rgba(34, 197, 94, 0.1)",
                        border: "1px solid rgba(34, 197, 94, 0.3)",
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: 12,
                        color: "#4ade80",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <CheckCircle2 size={15} />
                        <span style={{ fontWeight: 600 }}>Coverage verified from test runner:</span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <div>
                            <span style={{ color: "#94a3b8", marginRight: 4 }}>Statements:</span>
                            <span style={{ textDecoration: "line-through", color: "#94a3b8", marginRight: 4 }}>
                                {lastApplyResult.oldCoverage.statements}%
                            </span>
                            <ArrowRight size={11} style={{ display: "inline", margin: "0 2px" }} />
                            <span style={{ fontWeight: 700, color: "#86efac" }}>
                                {lastApplyResult.newCoverage.statements}%
                            </span>
                        </div>

                        <div>
                            <span style={{ color: "#94a3b8", marginRight: 4 }}>Branches:</span>
                            <span style={{ textDecoration: "line-through", color: "#94a3b8", marginRight: 4 }}>
                                {lastApplyResult.oldCoverage.branches}%
                            </span>
                            <ArrowRight size={11} style={{ display: "inline", margin: "0 2px" }} />
                            <span style={{ fontWeight: 700, color: "#86efac" }}>
                                {lastApplyResult.newCoverage.branches}%
                            </span>
                        </div>

                        <div>
                            <span style={{ color: "#94a3b8", marginRight: 4 }}>Lines:</span>
                            <span style={{ textDecoration: "line-through", color: "#94a3b8", marginRight: 4 }}>
                                {lastApplyResult.oldCoverage.lines}%
                            </span>
                            <ArrowRight size={11} style={{ display: "inline", margin: "0 2px" }} />
                            <span style={{ fontWeight: 700, color: "#86efac" }}>
                                {lastApplyResult.newCoverage.lines}%
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* List of Suggestions */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {suggestions.map((sug, idx) => {
                    const sugId = sug.suggestionId || sug.id || `sug-${idx}`;
                    const isApplying = applyingIds.has ? applyingIds.has(sugId) : (applyingIds === sugId);
                    const isEditing = editingId === sugId;
                    const status = isApplying ? "APPLYING" : (sug.status || "GENERATED");
                    const badge = getStatusBadge(status);

                    const currentCode = isEditing
                        ? (editedCode[sugId] ?? (sug.generatedCode || sug.suggestedTestCode || ""))
                        : (sug.generatedCode || sug.suggestedTestCode || "");

                    return (
                        <div
                            key={sugId}
                            style={{
                                background: "rgba(15, 23, 42, 0.65)",
                                border: "1px solid rgba(255, 255, 255, 0.08)",
                                borderRadius: 7,
                                padding: 14,
                                display: "flex",
                                flexDirection: "column",
                                gap: 10,
                            }}
                        >
                            {/* Suggestion item header */}
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    flexWrap: "wrap",
                                    gap: 8,
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>
                                        Suggestion #{idx + 1}
                                    </span>

                                    <span
                                        style={{
                                            fontSize: 10,
                                            fontWeight: 600,
                                            padding: "2px 7px",
                                            borderRadius: 10,
                                            background: badge.bg,
                                            border: `1px solid ${badge.border}`,
                                            color: badge.text,
                                        }}
                                    >
                                        {badge.label}
                                    </span>

                                    {sug.framework && (
                                        <span
                                            style={{
                                                fontSize: 10,
                                                padding: "2px 6px",
                                                borderRadius: 4,
                                                background: "rgba(255, 255, 255, 0.05)",
                                                color: "#94a3b8",
                                                textTransform: "uppercase",
                                            }}
                                        >
                                            {sug.framework}
                                        </span>
                                    )}
                                </div>

                                {/* Target Metadata */}
                                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#94a3b8" }}>
                                    {sug.testFile && (
                                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                            <FileCode size={12} style={{ color: "#38bdf8" }} />
                                            <span style={{ color: "#cbd5e1" }}>{sug.testFile}</span>
                                        </div>
                                    )}

                                    {sug.targetLines && sug.targetLines.length > 0 && (
                                        <div>
                                            Target: <span style={{ color: "#facc15", fontWeight: 600 }}>Line {sug.targetLines.join(", ")}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Reason / Explanation */}
                            {(sug.reason || sug.explanation) && (
                                <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.4 }}>
                                    <span style={{ color: "#94a3b8", fontWeight: 500 }}>Reason: </span>
                                    {sug.reason || sug.explanation}
                                </div>
                            )}

                            {/* Code block or Inline Editor */}
                            <div
                                style={{
                                    position: "relative",
                                    background: "#0d1117",
                                    border: "1px solid rgba(255, 255, 255, 0.1)",
                                    borderRadius: 6,
                                    overflow: "hidden",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        padding: "6px 12px",
                                        background: "rgba(255, 255, 255, 0.03)",
                                        borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                                        fontSize: 11,
                                        color: "#64748b",
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                        <Code size={12} />
                                        <span>{isEditing ? "Editing Test Code" : "Generated Test Code"}</span>
                                    </div>

                                    {!isEditing && (
                                        <button
                                            onClick={() => startEditing(sug)}
                                            style={{
                                                background: "transparent",
                                                border: "none",
                                                color: "#94a3b8",
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 4,
                                                fontSize: 11,
                                                padding: "2px 6px",
                                                borderRadius: 4,
                                            }}
                                            className="hover:text-white hover:bg-white/10"
                                            title="Edit generated test inline"
                                        >
                                            <Edit2 size={11} />
                                            Edit
                                        </button>
                                    )}
                                </div>

                                {isEditing ? (
                                    <div style={{ padding: 8 }}>
                                        <textarea
                                            value={currentCode}
                                            onChange={(e) => setEditedCode(prev => ({ ...prev, [sugId]: e.target.value }))}
                                            rows={Math.min(18, Math.max(6, currentCode.split("\n").length + 1))}
                                            style={{
                                                width: "100%",
                                                background: "#0d1117",
                                                color: "#e2e8f0",
                                                fontFamily: "monospace",
                                                fontSize: 12,
                                                lineHeight: 1.5,
                                                border: "1px solid rgba(56, 189, 248, 0.4)",
                                                borderRadius: 4,
                                                padding: 8,
                                                outline: "none",
                                                resize: "vertical",
                                            }}
                                        />
                                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
                                            <button
                                                onClick={cancelEditing}
                                                style={{
                                                    padding: "4px 10px",
                                                    background: "rgba(255, 255, 255, 0.06)",
                                                    border: "1px solid rgba(255, 255, 255, 0.1)",
                                                    borderRadius: 4,
                                                    color: "#cbd5e1",
                                                    fontSize: 11,
                                                    cursor: "pointer",
                                                }}
                                                className="hover:bg-white/10"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={() => saveEditing(sugId)}
                                                style={{
                                                    padding: "4px 10px",
                                                    background: "#0284c7",
                                                    border: "1px solid #38bdf8",
                                                    borderRadius: 4,
                                                    color: "#ffffff",
                                                    fontSize: 11,
                                                    fontWeight: 600,
                                                    cursor: "pointer",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 4,
                                                }}
                                                className="hover:opacity-90"
                                            >
                                                <Save size={11} />
                                                Save Changes
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <pre
                                        style={{
                                            margin: 0,
                                            padding: "10px 14px",
                                            color: "#e2e8f0",
                                            fontFamily: "monospace",
                                            fontSize: 12,
                                            lineHeight: 1.5,
                                            overflowX: "auto",
                                            maxHeight: 260,
                                        }}
                                    >
                                        <code>{currentCode}</code>
                                    </pre>
                                )}
                            </div>

                            {/* Action Buttons bar */}
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "flex-end",
                                    gap: 8,
                                    paddingTop: 4,
                                }}
                            >
                                {onReject && sug.status !== "REJECTED" && (
                                    <button
                                        onClick={() => onReject(sugId)}
                                        disabled={isApplying}
                                        style={{
                                            padding: "5px 10px",
                                            background: "rgba(255, 255, 255, 0.04)",
                                            border: "1px solid rgba(255, 255, 255, 0.1)",
                                            borderRadius: 5,
                                            color: "#94a3b8",
                                            fontSize: 11,
                                            cursor: isApplying ? "not-allowed" : "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 4,
                                            transition: "all 0.15s ease",
                                        }}
                                        className="hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30"
                                    >
                                        <X size={12} />
                                        Reject
                                    </button>
                                )}

                                {onApply && (
                                    <button
                                        onClick={() => onApply({ ...sug, generatedCode: currentCode })}
                                        disabled={isApplying || status === "PASSED"}
                                        style={{
                                            padding: "5px 14px",
                                            background: status === "PASSED"
                                                ? "rgba(34, 197, 94, 0.15)"
                                                : isApplying
                                                    ? "rgba(2, 132, 199, 0.5)"
                                                    : "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                                            border: status === "PASSED"
                                                ? "1px solid rgba(34, 197, 94, 0.4)"
                                                : "1px solid rgba(56, 189, 248, 0.4)",
                                            borderRadius: 5,
                                            color: status === "PASSED" ? "#4ade80" : "#ffffff",
                                            fontSize: 11,
                                            fontWeight: 600,
                                            cursor: (isApplying || status === "PASSED") ? "not-allowed" : "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            boxShadow: status === "PASSED" ? "none" : "0 2px 6px rgba(2, 132, 199, 0.2)",
                                            transition: "all 0.15s ease",
                                        }}
                                        className={status !== "PASSED" && !isApplying ? "hover:opacity-90" : ""}
                                    >
                                        {isApplying ? (
                                            <>
                                                <Loader2 size={12} className="animate-spin" />
                                                Applying...
                                            </>
                                        ) : status === "PASSED" ? (
                                            <>
                                                <Check size={12} />
                                                Applied
                                            </>
                                        ) : (
                                            <>
                                                <Check size={12} />
                                                Apply
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

