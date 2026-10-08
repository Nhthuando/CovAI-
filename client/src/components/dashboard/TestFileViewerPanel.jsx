import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  FlaskConical,
  FileCode,
  Edit3,
  Eye,
  Save,
  Check,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Code2,
  Copy,
  PlusCircle,
  FileQuestion,
  RotateCcw,
  Layers,
  ExternalLink,
  X,
  TrendingUp,
} from "lucide-react";
import MonacoEditor from "@monaco-editor/react";
import { updateFileContentApi, createProjectFileApi } from "../../services/project.service.js";
import { cleanDisplayPath } from "./CoverageTypeDashboard.jsx";

/* ── Extension to Language Mapping ───────────────────────── */
const EXT_LANG_MAP = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".json": "json",
};

const getLanguage = (filePath) => {
  if (!filePath) return "javascript";
  const match = filePath.match(/\.[^.]+$/);
  if (!match) return "javascript";
  return EXT_LANG_MAP[match[0].toLowerCase()] || "javascript";
};

const getStatusBadge = (status, isLight) => {
  switch (status) {
    case "APPLYING":
      return {
        bg: isLight ? "#eff6ff" : "rgba(59, 130, 246, 0.15)",
        border: isLight ? "#bfdbfe" : "rgba(59, 130, 246, 0.4)",
        text: isLight ? "#1d4ed8" : "#60a5fa",
        label: "Applying...",
        icon: Loader2,
        spin: true,
      };
    case "PASSED":
    case "APPLIED":
      return {
        bg: isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.15)",
        border: isLight ? "#bbf7d0" : "rgba(34, 197, 94, 0.4)",
        text: isLight ? "#15803d" : "#4ade80",
        label: "✓ Applied & Passed",
        icon: Check,
      };
    case "FAILED":
      return {
        bg: isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.15)",
        border: isLight ? "#fecaca" : "rgba(239, 68, 68, 0.4)",
        text: isLight ? "#b91c1c" : "#f87171",
        label: "✗ Test Failed",
        icon: X,
      };
    case "EDITED":
      return {
        bg: isLight ? "#f5f3ff" : "rgba(168, 85, 247, 0.15)",
        border: isLight ? "#ddd6fe" : "rgba(168, 85, 247, 0.4)",
        text: isLight ? "#7c3aed" : "#c084fc",
        label: "Edited",
        icon: Edit3,
      };
    case "REJECTED":
      return {
        bg: isLight ? "#f1f5f9" : "rgba(107, 114, 128, 0.15)",
        border: isLight ? "#cbd5e1" : "rgba(107, 114, 128, 0.4)",
        text: isLight ? "#64748b" : "#9ca3af",
        label: "Rejected",
        icon: X,
      };
    default:
      return {
        bg: isLight ? "#f0f9ff" : "rgba(56, 189, 248, 0.12)",
        border: isLight ? "#bae6fd" : "rgba(56, 189, 248, 0.3)",
        text: isLight ? "#0369a1" : "#38bdf8",
        label: "Ready to Apply",
        icon: Sparkles,
      };
  }
};

export default function TestFileViewerPanel({
  sourceFilePath,
  testFile,
  projectId,
  snapshotId,
  suggestions = [],
  isLoadingSuggestions = false,
  applyingSuggestionIds = new Set(),
  onApplySuggestion,
  onApplyAllSuggestions,
  onRejectSuggestion,
  onUpdateSuggestionCode,
  lastApplyResult,
  progressStep,
  onSuggestMissingTest,
  onOpenFile,
  onTestFileSaved,
  isLight = false,
  isGlobalSaving = false,
  globalSaveSuccess = false,
  onRegisterTestSaver,
  onTestDirtyChange,
  onSaveBoth,
}) {
  const isFound = Boolean(testFile?.found);
  const testFilePath = testFile?.filePath || testFile?.suggestedFilePath || "";
  const testFileName = testFile?.fileName || (testFilePath ? testFilePath.split("/").pop() : "test-file.js");
  const rawTestCode = testFile?.testCode || "";
  const framework = (testFile?.framework || "jest").toUpperCase();

  const [viewMode, setViewMode] = useState("code"); // "code" | "editor" | "suggestions"
  const [editorContent, setEditorContent] = useState(rawTestCode);
  const [isTestDirty, setIsTestDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [copied, setCopied] = useState(false);
  const [editedCodes, setEditedCodes] = useState({});

  // Sync editor content whenever raw test code changes from disk
  useEffect(() => {
    setEditorContent(rawTestCode);
    setIsTestDirty(false);
    onTestDirtyChange?.(false);
  }, [rawTestCode, onTestDirtyChange]);

  const saveTestFileInternal = useCallback(async () => {
    if (!projectId || !testFilePath) return testFilePath;
    if (isFound) {
      await updateFileContentApi(projectId, testFilePath, editorContent);
    } else {
      await createProjectFileApi(projectId, testFilePath, editorContent);
    }
    setIsTestDirty(false);
    onTestDirtyChange?.(false);
    return testFilePath;
  }, [projectId, testFilePath, isFound, editorContent, onTestDirtyChange]);

  useEffect(() => {
    if (onRegisterTestSaver) {
      onRegisterTestSaver(saveTestFileInternal);
    }
  }, [saveTestFileInternal, onRegisterTestSaver]);

  const onSaveBothRef = useRef(onSaveBoth || handleSaveTestFile);
  onSaveBothRef.current = onSaveBoth || handleSaveTestFile;

  const handleEditorDidMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveBothRef.current?.();
    });
  };

  // If new suggestions arrive or finished loading, switch to suggestions tab automatically
  const prevLoadingRef = useRef(isLoadingSuggestions);
  useEffect(() => {
    if (prevLoadingRef.current && !isLoadingSuggestions && suggestions.length > 0) {
      setViewMode("suggestions");
    }
    prevLoadingRef.current = isLoadingSuggestions;
  }, [isLoadingSuggestions, suggestions.length]);

  useEffect(() => {
    if (!isFound && suggestions.length > 0) {
      setViewMode("suggestions");
    }
  }, [isFound, suggestions.length]);

  const testLines = useMemo(() => {
    if (!editorContent) return [];
    return editorContent.split("\n");
  }, [editorContent]);

  const isTestOver100 = testLines.length > 100;

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveTestFile = async () => {
    if (!projectId || !testFilePath) return;
    setIsSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    try {
      if (isFound) {
        await updateFileContentApi(projectId, testFilePath, editorContent);
      } else {
        await createProjectFileApi(projectId, testFilePath, editorContent);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      setViewMode("code");
      if (onTestFileSaved) {
        onTestFileSaved(testFilePath);
      }
    } catch (err) {
      console.error("[TestFileViewerPanel] Save error:", err);
      setSaveError(err.message || "Failed to save test file");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      style={{
        background: isLight ? "#ffffff" : "#0d1117",
        border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: 672,
        maxHeight: 672,
        minHeight: 672,
        boxShadow: isLight
          ? "0 4px 16px rgba(15, 23, 42, 0.05)"
          : "0 4px 20px rgba(0, 0, 0, 0.3)",
        transition: "all 0.2s ease",
      }}
    >
      {/* ── Panel Header ────────────────────────────────────── */}
      <div
        style={{
          padding: "10px 14px",
          background: isLight ? "#f8fafc" : "#161b22",
          borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {/* Left: Test File identity and status */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: isFound
                ? isLight
                  ? "rgba(16, 185, 129, 0.12)"
                  : "rgba(34, 197, 94, 0.15)"
                : isLight
                  ? "rgba(245, 158, 11, 0.12)"
                  : "rgba(245, 158, 11, 0.15)",
              color: isFound
                ? isLight
                  ? "#059669"
                  : "#4ade80"
                : isLight
                  ? "#d97706"
                  : "#fbbf24",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <FlaskConical size={15} />
          </div>

          <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: isLight ? "#0f172a" : "#f0f6fc",
                  fontFamily: "var(--font-mono, monospace)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={cleanDisplayPath(testFilePath)}
              >
                {testFileName}
              </span>

              {/* Status Badge */}
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 7px",
                  borderRadius: 10,
                  fontWeight: 600,
                  background: isFound
                    ? isLight
                      ? "#f0fdf4"
                      : "rgba(34, 197, 94, 0.15)"
                    : isLight
                      ? "#fffbeb"
                      : "rgba(245, 158, 11, 0.15)",
                  color: isFound
                    ? isLight
                      ? "#15803d"
                      : "#4ade80"
                    : isLight
                      ? "#b45309"
                      : "#fbbf24",
                  border: isFound
                    ? isLight
                      ? "1px solid #bbf7d0"
                      : "1px solid rgba(34, 197, 94, 0.3)"
                    : isLight
                      ? "1px solid #fde68a"
                      : "1px solid rgba(245, 158, 11, 0.3)",
                }}
              >
                {isFound ? `✓ Test Linked (${framework})` : "⚠ No test file"}
              </span>

              {suggestions.filter((s) => s.status !== "REJECTED").length > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 7px",
                    borderRadius: 10,
                    fontWeight: 600,
                    background: isLight ? "#f5f3ff" : "rgba(168, 85, 247, 0.15)",
                    color: isLight ? "#7c3aed" : "#c084fc",
                    border: isLight ? "1px solid #ddd6fe" : "1px solid rgba(168, 85, 247, 0.35)",
                  }}
                >
                  ✨ {suggestions.filter((s) => s.status !== "REJECTED").length} suggestion{suggestions.filter((s) => s.status !== "REJECTED").length > 1 ? "s" : ""}
                </span>
              )}
            </div>

            <span
              style={{
                fontSize: 10,
                color: isLight ? "#64748b" : "#8b949e",
                fontFamily: "var(--font-mono, monospace)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {isFound ? cleanDisplayPath(testFilePath) : (testFilePath ? `Suggested: ${cleanDisplayPath(testFilePath)}` : "")}
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {isFound && (
            <>
              {/* Toggle View / Edit */}
              <div
                style={{
                  display: "flex",
                  background: isLight ? "#e2e8f0" : "rgba(255,255,255,0.06)",
                  borderRadius: 5,
                  padding: 2,
                }}
              >
                <button
                  onClick={() => setViewMode("code")}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: viewMode === "code" ? 700 : 500,
                    border: "none",
                    background: viewMode === "code" ? (isLight ? "#ffffff" : "rgba(255,255,255,0.12)") : "transparent",
                    color: viewMode === "code" ? (isLight ? "#0f172a" : "#ffffff") : (isLight ? "#64748b" : "#8b949e"),
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Eye size={11} />
                  View
                </button>
                <button
                  onClick={() => setViewMode("editor")}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: viewMode === "editor" ? 700 : 500,
                    border: "none",
                    background: viewMode === "editor" ? (isLight ? "#ffffff" : "rgba(255,255,255,0.12)") : "transparent",
                    color: viewMode === "editor" ? (isLight ? "#0f172a" : "#ffffff") : (isLight ? "#64748b" : "#8b949e"),
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Edit3 size={11} />
                  Edit
                </button>
              </div>

              {/* Save button if in editor mode */}
              {viewMode === "editor" && (
                <button
                  onClick={() => {
                    if (onSaveBoth) onSaveBoth();
                    else handleSaveTestFile();
                  }}
                  disabled={isSaving || isGlobalSaving}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 9px",
                    borderRadius: 5,
                    fontSize: 11,
                    fontWeight: 600,
                    background: (saveSuccess || globalSaveSuccess)
                      ? "#16a34a"
                      : isTestDirty
                      ? (isLight ? "#2563eb" : "#3b82f6")
                      : (isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.08)"),
                    color: isTestDirty || saveSuccess || globalSaveSuccess
                      ? "#ffffff"
                      : (isLight ? "#64748b" : "#8b949e"),
                    border: isTestDirty || saveSuccess || globalSaveSuccess
                      ? "none"
                      : (isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)"),
                    cursor: (isSaving || isGlobalSaving) ? "wait" : "pointer",
                    transition: "all 0.15s ease",
                  }}
                  title="Save test file & source code (Ctrl+S)"
                >
                  {(isSaving || isGlobalSaving) ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (saveSuccess || globalSaveSuccess) ? (
                    <Check size={12} />
                  ) : (
                    <Save size={12} />
                  )}
                  <span>
                    {(isSaving || isGlobalSaving)
                      ? "Saving..."
                      : (saveSuccess || globalSaveSuccess)
                      ? "Saved!"
                      : "Save (Ctrl+S)"}
                  </span>
                </button>
              )}

              {/* Open file in full editor */}
              <button
                onClick={() => onOpenFile?.(testFilePath)}
                style={{
                  padding: "4px 8px",
                  borderRadius: 5,
                  fontSize: 11,
                  background: isLight ? "#ffffff" : "rgba(255,255,255,0.05)",
                  border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
                  color: isLight ? "#334155" : "#c9d1d9",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                title="Open in full IDE editor"
              >
                <ExternalLink size={11} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Sub Navigation Tabs (when suggestions or editor active) ──── */}
      {(suggestions.length > 0 || isFound) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "6px 14px",
            background: isLight ? "#f1f5f9" : "rgba(0,0,0,0.2)",
            borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.05)",
            fontSize: 11,
          }}
        >
          {isFound && (
            <button
              onClick={() => setViewMode(viewMode === "editor" ? "editor" : "code")}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: "2px 0",
                borderBottom: viewMode !== "suggestions" ? "2px solid #7c3aed" : "2px solid transparent",
                color: viewMode !== "suggestions" ? (isLight ? "#0f172a" : "#f0f6fc") : (isLight ? "#64748b" : "#8b949e"),
                fontWeight: viewMode !== "suggestions" ? 700 : 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>Test File Code ({testLines.length} lines)</span>
            </button>
          )}

          {suggestions.filter((s) => s.status !== "REJECTED").length > 0 && (
            <button
              onClick={() => setViewMode("suggestions")}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: "2px 0",
                borderBottom: viewMode === "suggestions" ? "2px solid #7c3aed" : "2px solid transparent",
                color: viewMode === "suggestions" ? (isLight ? "#0f172a" : "#f0f6fc") : (isLight ? "#64748b" : "#8b949e"),
                fontWeight: viewMode === "suggestions" ? 700 : 500,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Sparkles size={11} className={isLight ? "text-purple-600" : "text-purple-400"} />
              <span>Suggested Tests ({suggestions.filter((s) => s.status !== "REJECTED").length})</span>
            </button>
          )}
        </div>
      )}

      {/* ── Main Content Area ───────────────────────────────── */}
      <div
        className="file-panel-scrollbar"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "auto",
          overscrollBehavior: "contain",
          position: "relative",
        }}
      >
        {/* State 1: Test file NOT found yet */}
        {!isFound && viewMode !== "suggestions" && suggestions.length === 0 && (
          <div
            style={{
              padding: "40px 24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              height: "100%",
              minHeight: 380,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: isLight ? "rgba(245, 158, 11, 0.12)" : "rgba(245, 158, 11, 0.15)",
                border: isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: isLight ? "#d97706" : "#fbbf24",
                marginBottom: 16,
              }}
            >
              <FlaskConical size={26} />
            </div>

            <h4
              style={{
                margin: "0 0 6px 0",
                fontSize: 14,
                fontWeight: 700,
                color: isLight ? "#0f172a" : "#f0f6fc",
              }}
            >
              No Linked Test File
            </h4>

            <p
              style={{
                margin: "0 0 16px 0",
                fontSize: 12,
                color: isLight ? "#64748b" : "#8b949e",
                maxWidth: 380,
                lineHeight: 1.5,
              }}
            >
              This source file currently has no corresponding test file in the project directory structure.
            </p>

            <div
              style={{
                background: isLight ? "#f1f5f9" : "rgba(255,255,255,0.04)",
                border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.08)",
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 11,
                fontFamily: "var(--font-mono, monospace)",
                color: isLight ? "#334155" : "#cbd5e1",
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ color: isLight ? "#64748b" : "#8b949e" }}>Suggested location:</span>
              <span style={{ fontWeight: 600, color: isLight ? "#7c3aed" : "#c084fc" }}>
                {testFilePath || `tests/${testFileName}`}
              </span>
            </div>

            <button
              onClick={() => onSuggestMissingTest?.()}
              disabled={isLoadingSuggestions}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 16px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 600,
                background: "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",
                color: "#ffffff",
                border: "none",
                cursor: isLoadingSuggestions ? "wait" : "pointer",
                boxShadow: "0 4px 14px rgba(124, 58, 237, 0.35)",
                transition: "all 0.15s ease",
              }}
              className="hover:opacity-95"
            >
              {isLoadingSuggestions ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Sparkles size={15} />
              )}
              <span>Suggest Missing Test Cases</span>
            </button>
          </div>
        )}

        {/* State 2: AI Suggestions Panel (Active when viewing suggestions tab or generated for missing file) */}
        {(viewMode === "suggestions" || (!isFound && suggestions.length > 0)) && (
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Header banner */}
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 6,
                background: isLight ? "#f5f3ff" : "rgba(124, 58, 237, 0.12)",
                border: isLight ? "1px solid #ddd6fe" : "1px solid rgba(124, 58, 237, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={16} className={isLight ? "text-purple-600" : "text-purple-400"} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isLight ? "#6b21a8" : "#d8b4fe" }}>
                    {isFound
                      ? `Add test cases to file: ${testFileName}`
                      : `Create new test file in project structure`}
                  </div>
                  <div style={{ fontSize: 11, color: isLight ? "#64748b" : "#94a3b8", fontFamily: "var(--font-mono, monospace)" }}>
                    📁 {cleanDisplayPath(testFilePath) || testFilePath}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {isFound && (
                  <button
                    onClick={() => setViewMode("code")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "5px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.08)",
                      border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.15)",
                      color: isLight ? "#475569" : "#cbd5e1",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                    title="Switch to viewing the linked test file"
                  >
                    <Eye size={12} />
                    <span>View Linked Test File</span>
                  </button>
                )}

                {onApplyAllSuggestions && suggestions.filter((s) => s.status !== "REJECTED" && s.status !== "PASSED").length > 1 && (
                  <button
                    onClick={() => {
                      const sugsToApply = suggestions
                        .filter((s) => s.status !== "REJECTED")
                        .map((s) => {
                          const sid = s.suggestionId || s.id;
                          const code = editedCodes[sid] !== undefined ? editedCodes[sid] : (s.generatedCode || s.suggestedTestCode || s.code);
                          return {
                            ...s,
                            generatedCode: code,
                            suggestedTestCode: code,
                            fullUpdatedContent: s.fullUpdatedContent,
                          };
                        });
                      onApplyAllSuggestions(sugsToApply);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 12px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      background: "linear-gradient(135deg, #059669 0%, #047857 100%)",
                      color: "#ffffff",
                      border: "none",
                      cursor: "pointer",
                      boxShadow: "0 2px 8px rgba(5, 150, 105, 0.3)",
                    }}
                  >
                    <Layers size={13} />
                    <span>Apply all to project ({suggestions.filter((s) => s.status !== "REJECTED").length})</span>
                  </button>
                )}
              </div>
            </div>

            {/* Active apply progress banner */}
            {progressStep && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: isLight ? "#eff6ff" : "rgba(59, 130, 246, 0.12)",
                  border: isLight ? "1px solid #bfdbfe" : "1px solid rgba(59, 130, 246, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11,
                  color: isLight ? "#1d4ed8" : "#60a5fa",
                }}
              >
                <Loader2 size={13} className="animate-spin" />
                <span>{progressStep}</span>
              </div>
            )}

            {/* Last verified apply result banner */}
            {lastApplyResult?.newCoverage && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.12)",
                  border: isLight ? "1px solid #bbf7d0" : "1px solid rgba(34, 197, 94, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: isLight ? "#15803d" : "#4ade80",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                  <TrendingUp size={13} />
                  <span>Verified Coverage Increase:</span>
                </div>
                <div style={{ display: "flex", gap: 12, fontFamily: "var(--font-mono, monospace)" }}>
                  <span>Lines: {lastApplyResult.oldCoverage?.lines ?? 0}% → {lastApplyResult.newCoverage?.lines ?? 0}%</span>
                  <span>Branches: {lastApplyResult.oldCoverage?.branches ?? 0}% → {lastApplyResult.newCoverage?.branches ?? 0}%</span>
                </div>
              </div>
            )}

            {/* List of suggestion cards */}
            {suggestions.filter((s) => s.status !== "REJECTED").map((sug, idx) => {
              const sugId = sug.suggestionId || sug.id || idx;
              const isApplying = applyingSuggestionIds.has(sugId);
              const currentCode = editedCodes[sugId] !== undefined
                ? editedCodes[sugId]
                : (sug.generatedCode || sug.suggestedTestCode || sug.code || "");
              const originalCode = sug.originalGeneratedCode || sug.suggestedTestCode || sug.generatedCode || "";
              const isModified = Boolean(originalCode && currentCode !== originalCode);
              const badge = getStatusBadge(sug.status, isLight);
              const BadgeIcon = badge.icon;
              const lines = (currentCode || "").split("\n");

              return (
                <div
                  key={sugId}
                  style={{
                    background: isLight ? "#ffffff" : "#090d16",
                    border: isLight
                      ? isModified
                        ? "1px solid #c084fc"
                        : "1px solid #cbd5e1"
                      : isModified
                        ? "1px solid rgba(168, 85, 247, 0.4)"
                        : "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 7,
                    overflow: "hidden",
                    boxShadow: isLight ? "0 1px 3px rgba(0,0,0,0.05)" : "none",
                  }}
                >
                  {/* Card Header */}
                  <div
                    style={{
                      padding: "8px 12px",
                      background: isLight ? "#f8fafc" : "rgba(255,255,255,0.03)",
                      borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.06)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Code2 size={13} style={{ color: isLight ? "#7c3aed" : "#c084fc" }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: isLight ? "#0f172a" : "#f0f6fc" }}>
                        {sug.reason || `Suggested test case #${idx + 1}`}
                      </span>

                      {/* Status Badge */}
                      <span
                        style={{
                          fontSize: 10,
                          padding: "1px 7px",
                          borderRadius: 10,
                          fontWeight: 600,
                          background: badge.bg,
                          color: badge.text,
                          border: `1px solid ${badge.border}`,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        {BadgeIcon && <BadgeIcon size={10} className={badge.spin ? "animate-spin" : ""} />}
                        <span>{badge.label}</span>
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {/* Reset button if edited */}
                      {isModified && (
                        <button
                          onClick={() => {
                            setEditedCodes((prev) => ({ ...prev, [sugId]: originalCode }));
                            onUpdateSuggestionCode?.(sugId, originalCode);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 3,
                            padding: "3px 7px",
                            borderRadius: 4,
                            fontSize: 10,
                            background: isLight ? "#f5f3ff" : "rgba(168, 85, 247, 0.15)",
                            border: isLight ? "1px solid #ddd6fe" : "1px solid rgba(168, 85, 247, 0.3)",
                            color: isLight ? "#7c3aed" : "#c084fc",
                            cursor: "pointer",
                          }}
                          title="Reset to AI original generated code"
                        >
                          <RotateCcw size={10} />
                          <span>Reset</span>
                        </button>
                      )}

                      {/* Copy button */}
                      <button
                        onClick={() => handleCopyCode(currentCode)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "3px 7px",
                          borderRadius: 4,
                          fontSize: 10,
                          background: isLight ? "#ffffff" : "rgba(255,255,255,0.05)",
                          border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.1)",
                          color: isLight ? "#475569" : "#cbd5e1",
                          cursor: "pointer",
                        }}
                      >
                        {copied ? <Check size={11} /> : <Copy size={11} />}
                        {copied ? "Copied" : "Copy"}
                      </button>

                      {/* Reject Button */}
                      {onRejectSuggestion && sug.status !== "REJECTED" && (
                        <button
                          onClick={() => onRejectSuggestion(sugId)}
                          disabled={isApplying}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 3,
                            padding: "3px 8px",
                            borderRadius: 4,
                            fontSize: 10,
                            background: isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.1)",
                            border: isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.3)",
                            color: isLight ? "#b91c1c" : "#f87171",
                            cursor: isApplying ? "wait" : "pointer",
                          }}
                          title="Reject this suggestion"
                        >
                          <X size={11} />
                          <span>Reject</span>
                        </button>
                      )}

                      {/* Single Apply Button */}
                      <button
                        onClick={() => onApplySuggestion?.({ ...sug, generatedCode: currentCode, suggestedTestCode: currentCode, code: currentCode, fullUpdatedContent: sug.fullUpdatedContent })}
                        disabled={isApplying || sug.status === "PASSED"}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "4px 10px",
                          borderRadius: 5,
                          fontSize: 11,
                          fontWeight: 700,
                          background: sug.status === "PASSED"
                            ? isLight ? "#15803d" : "#16a34a"
                            : isLight ? "#16a34a" : "#22c55e",
                          color: "#ffffff",
                          border: "none",
                          cursor: isApplying ? "wait" : sug.status === "PASSED" ? "default" : "pointer",
                          boxShadow: "0 2px 6px rgba(22, 163, 74, 0.25)",
                        }}
                      >
                        {isApplying ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : sug.status === "PASSED" ? (
                          <Check size={12} />
                        ) : (
                          <Check size={12} />
                        )}
                        <span>
                          {isApplying
                            ? "Applying..."
                            : sug.status === "PASSED"
                              ? "Applied"
                              : "Apply to Project"}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Diagnostic Error Banner if Test Failed */}
                  {(sug.status === "FAILED" || sug.testRunError) && (
                    <div
                      style={{
                        padding: "8px 12px",
                        background: isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.12)",
                        borderLeft: "3px solid #ef4444",
                        borderBottom: isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.2)",
                        fontSize: 11,
                        color: isLight ? "#991b1b" : "#fca5a5",
                      }}
                    >
                      <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                        <AlertCircle size={12} />
                        <span>Test Execution Failed</span>
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: 10,
                          maxHeight: 90,
                          overflowY: "auto",
                        }}
                      >
                        {sug.testRunError || "Runner returned exit code 1. Check module imports or assertions."}
                      </pre>
                    </div>
                  )}

                  {/* Interactive Code Editor */}
                  <div
                    style={{
                      position: "relative",
                      background: isLight ? "#f8fafc" : "#0d1117",
                      display: "flex",
                    }}
                  >
                    {/* Line numbers gutter */}
                    <div
                      style={{
                        padding: "10px 8px 10px 10px",
                        textAlign: "right",
                        color: isLight ? "#94a3b8" : "#475569",
                        fontSize: 11,
                        fontFamily: "var(--font-mono, monospace)",
                        lineHeight: "19px",
                        userSelect: "none",
                        borderRight: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255,255,255,0.06)",
                        minWidth: 34,
                        boxSizing: "border-box",
                      }}
                    >
                      {lines.map((_, i) => (
                        <div key={i} style={{ height: "19px", lineHeight: "19px" }}>{i + 1}</div>
                      ))}
                    </div>

                    {/* Editable textarea with matching line height */}
                    <textarea
                      value={currentCode}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditedCodes((prev) => ({ ...prev, [sugId]: val }));
                        onUpdateSuggestionCode?.(sugId, val);
                      }}
                      style={{
                        flex: 1,
                        margin: 0,
                        padding: "10px 12px 14px 12px",
                        fontSize: 11,
                        fontFamily: "var(--font-mono, monospace)",
                        lineHeight: "19px",
                        height: `${Math.max(lines.length, 4) * 19 + 24}px`,
                        color: isLight ? "#0f172a" : "#e6edf3",
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        resize: "none",
                        whiteSpace: "pre",
                        overflowX: "auto",
                        overflowY: "hidden",
                        boxSizing: "border-box",
                      }}
                      spellCheck={false}
                      placeholder="Enter unit test code here..."
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* State 3: Test file found & View Mode (Syntax-highlighted code) */}
        {isFound && viewMode === "code" && (
          <div
            style={{
              padding: "10px 0",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              lineHeight: 1.6,
              color: isLight ? "#0f172a" : "#e2e8f0",
            }}
          >
            {testLines.map((line, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  padding: "1px 12px",
                  transition: "background 0.1s ease",
                }}
                className={isLight ? "hover:bg-slate-100" : "hover:bg-white/[0.03]"}
              >
                {/* Line number */}
                <span
                  style={{
                    width: 38,
                    flexShrink: 0,
                    textAlign: "right",
                    marginRight: 16,
                    color: isLight ? "#94a3b8" : "#475569",
                    userSelect: "none",
                    fontSize: 11,
                  }}
                >
                  {idx + 1}
                </span>

                {/* Line code */}
                <span
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    flex: 1,
                  }}
                >
                  {line || " "}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* State 4: Test file found & Editor Mode */}
        {isFound && viewMode === "editor" && (
          <div style={{ flex: 1, minHeight: 0, height: "100%", width: "100%" }}>
            <MonacoEditor
              height="100%"
              minHeight="100%"
              language={getLanguage(testFilePath)}
              theme={isLight ? "vs" : "vs-dark"}
              value={editorContent}
              onChange={(val) => {
                setEditorContent(val || "");
                setIsTestDirty(true);
                onTestDirtyChange?.(true);
              }}
              onMount={handleEditorDidMount}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on",
                scrollbar: {
                  vertical: isTestOver100 ? "visible" : "auto",
                  verticalScrollbarSize: 10,
                  horizontal: "auto",
                  horizontalScrollbarSize: 10,
                  alwaysConsumeMouseWheel: true,
                },
              }}
            />
          </div>
        )}
      </div>

      {/* ── Footer status bar ───────────────────────────────── */}
      <div
        style={{
          padding: "6px 14px",
          background: isLight ? "#f8fafc" : "#161b22",
          borderTop: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11,
          color: isLight ? "#64748b" : "#8b949e",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>Path:</span>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              color: isLight ? "#334155" : "#cbd5e1",
            }}
          >
            {cleanDisplayPath(testFilePath) || testFilePath}
          </span>
          {testLines.length > 0 && (
            <span style={{ color: isLight ? "#64748b" : "#8b949e", fontSize: 10 }}>
              ({testLines.length} lines)
            </span>
          )}
        </div>

        <div>
          {isFound ? (
            <span style={{ color: isLight ? "#15803d" : "#4ade80" }}>
              ✓ Linked to source file
            </span>
          ) : (
            <span style={{ color: isLight ? "#b45309" : "#fbbf24" }}>
              Not saved on disk
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
