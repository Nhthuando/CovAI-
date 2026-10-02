import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import {
  FileCode,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Filter,
  Edit3,
  Eye,
  Save,
  RotateCcw,
  Check,
  Loader2,
  Code2,
  AlertTriangle,
  FlaskConical,
  Columns,
  Maximize2,
  ExternalLink,
  ChevronRight,
  Layers,
} from "lucide-react";
import MonacoEditor from "@monaco-editor/react";
import { updateFileContentApi } from "../../services/project.service.js";
import { cleanDisplayPath } from "./CoverageTypeDashboard.jsx";
import TestFileViewerPanel from "./TestFileViewerPanel.jsx";

/* ── Extension to Language Mapping ───────────────────────── */
const EXT_LANG_MAP = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".json": "json",
  ".css": "css",
  ".html": "html",
  ".md": "markdown",
  ".py": "python",
  ".java": "java",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".xml": "xml",
  ".sh": "shell",
  ".bash": "shell",
  ".sql": "sql",
  ".txt": "plaintext",
};

const getLanguage = (path) => {
  if (!path) return "javascript";
  const match = path.match(/\.[^.]+$/);
  if (!match) return "javascript";
  return EXT_LANG_MAP[match[0].toLowerCase()] || "javascript";
};

export default function FileCodeExecutionView({
  filePath,
  fileCoverage,
  projectId,
  snapshotId,
  onOpenFile,
  onSuggestTestcase,
  onFileSaved,
  suggestions = [],
  isLoadingSuggestions = false,
  applyingSuggestionIds = new Set(),
  onApplySuggestion,
  onApplyAllSuggestions,
  isLight = false,
}) {
  const initialSourceCode = fileCoverage?.sourceCode || "";
  const linesMap = fileCoverage?.lines || {};
  const statements = fileCoverage?.statements || [];
  const summary = fileCoverage?.summary || {};
  const testFile = fileCoverage?.testFile || null;
  const hasTestFile = Boolean(testFile?.found);
  const testFileName = testFile?.fileName || (testFile?.filePath ? testFile.filePath.split("/").pop() : null);

  // Layout mode: "split" (Side-by-side Source & Test) | "source" (Source code only) | "test" (Test code only)
  const [layoutMode, setLayoutMode] = useState("split");

  // View mode for source code: "coverage" (visual execution flow) or "editor" (in-place Monaco code editor)
  const [viewMode, setViewMode] = useState("coverage");
  const [editorContent, setEditorContent] = useState(initialSourceCode);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | "success" | "error"
  const [errorMessage, setErrorMessage] = useState("");
  const [filterMode, setFilterMode] = useState("all"); // "all" | "covered" | "missed"

  const editorRef = useRef(null);
  const handleSaveRef = useRef(null);

  // Sync editor content with sourceCode when fileCoverage updates and not locally dirty
  useEffect(() => {
    if (!isDirty) {
      setEditorContent(initialSourceCode);
    }
  }, [initialSourceCode, isDirty]);

  const sourceCodeToRender = isDirty && viewMode === "coverage" ? editorContent : initialSourceCode;

  const codeLines = useMemo(() => {
    if (!sourceCodeToRender) return [];
    return sourceCodeToRender.split("\n");
  }, [sourceCodeToRender]);

  // Index statements by line number for fallback and enrichment
  const stmtsByLine = useMemo(() => {
    const map = {};
    statements.forEach((stmt) => {
      const start = stmt.startLine || 1;
      const end = stmt.endLine || start;
      for (let l = start; l <= end; l++) {
        if (!map[l]) map[l] = [];
        map[l].push(stmt);
      }
    });
    return map;
  }, [statements]);

  // Helper to extract line coverage details with full compatibility for object and number forms
  const getLineData = useMemo(() => {
    return (lineNum) => {
      const rawLine = linesMap[lineNum] ?? linesMap[String(lineNum)];
      const stmtsOnLine = stmtsByLine[lineNum] || [];

      let hits = null;
      let status = null;
      let error = null;
      let reason = null;

      if (rawLine !== undefined && rawLine !== null) {
        if (typeof rawLine === "number") {
          hits = rawLine;
          status = rawLine > 0 ? "covered" : "uncovered";
        } else if (typeof rawLine === "object") {
          hits = typeof rawLine.hits === "number" ? rawLine.hits : (rawLine.status === "covered" ? 1 : 0);
          status = rawLine.status || (hits > 0 ? "covered" : "uncovered");
          error = rawLine.error;
          reason = rawLine.reason;
        }
      } else if (stmtsOnLine.length > 0) {
        hits = Math.max(...stmtsOnLine.map((s) => s.hits ?? 0));
        status = hits > 0 ? "covered" : "uncovered";
      }

      const isExecutable = hits !== null;
      const isFailed = status === "failed";
      const isCovered = isExecutable && !isFailed && (status === "covered" || hits > 0);
      const isMissed = isExecutable && !isFailed && (status === "uncovered" || hits === 0);

      return {
        isExecutable,
        hits: hits ?? 0,
        isCovered,
        isMissed,
        isFailed,
        status,
        error,
        reason,
        statements: stmtsOnLine,
      };
    };
  }, [linesMap, stmtsByLine]);

  // Calculate statistics across all lines
  const { executableLines, coveredLines, missedLines, failedLines, maxHits } = useMemo(() => {
    let exec = 0;
    let cov = 0;
    let miss = 0;
    let fail = 0;
    let max = 1;

    const totalLinesToCheck = codeLines.length > 0 ? codeLines.length : Math.max(...Object.keys(linesMap).map(Number), 0);
    for (let i = 1; i <= totalLinesToCheck; i++) {
      const info = getLineData(i);
      if (info.isExecutable) {
        exec += 1;
        if (info.isFailed) fail += 1;
        else if (info.isCovered) cov += 1;
        else if (info.isMissed) miss += 1;
        if (info.hits > max) max = info.hits;
      }
    }

    return {
      executableLines: exec,
      coveredLines: cov,
      missedLines: miss,
      failedLines: fail,
      maxHits: max,
    };
  }, [codeLines, linesMap, getLineData]);

  // Statement counts
  const totalStatements = summary?.stmtsTotal ?? statements.length;
  const coveredStatements = summary?.stmtsCovered ?? (statements.length > 0 ? statements.filter((s) => s.covered || (s.hits || 0) > 0).length : coveredLines);
  const stmtsPct = summary?.stmtsPct ?? (totalStatements > 0 ? Math.round((coveredStatements / totalStatements) * 100) : (executableLines > 0 ? Math.round((coveredLines / executableLines) * 100) : 100));

  // Filter lines to display based on active filterMode
  const visibleLineEntries = useMemo(() => {
    return codeLines.map((codeText, index) => {
      const lineNum = index + 1;
      const info = getLineData(lineNum);
      return { lineNum, codeText, ...info };
    }).filter((item) => {
      if (filterMode === "covered") return item.isCovered;
      if (filterMode === "missed") return item.isMissed || item.isFailed;
      return true;
    });
  }, [codeLines, getLineData, filterMode]);

  // Save handler for inline source editor
  const handleSave = useCallback(async () => {
    if (!projectId || !filePath) {
      setErrorMessage("Missing project ID or file path to save.");
      setSaveStatus("error");
      return;
    }

    setIsSaving(true);
    setSaveStatus(null);
    setErrorMessage("");

    try {
      await updateFileContentApi(projectId, filePath, editorContent);
      setIsDirty(false);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus(null), 3000);
      if (onFileSaved) {
        await onFileSaved(filePath);
      }
    } catch (err) {
      console.error("[FileCodeExecutionView] Failed to save code:", err);
      setSaveStatus("error");
      setErrorMessage(err?.response?.data?.message || err?.message || "Failed to save file.");
    } finally {
      setIsSaving(false);
    }
  }, [projectId, filePath, editorContent, onFileSaved]);

  handleSaveRef.current = handleSave;

  const handleDiscard = useCallback(() => {
    setEditorContent(initialSourceCode);
    setIsDirty(false);
    setSaveStatus(null);
    setErrorMessage("");
  }, [initialSourceCode]);

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveRef.current?.();
    });
  };

  const handleEditorWillMount = (monaco) => {
    monaco.editor.defineTheme("covai-dark-inline", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6e7681", fontStyle: "italic" },
        { token: "keyword", foreground: "c084fc", fontStyle: "bold" },
        { token: "identifier", foreground: "e6edf3" },
        { token: "string", foreground: "7ee787" },
        { token: "number", foreground: "fca5a5" },
        { token: "type", foreground: "67e8f9" },
        { token: "function", foreground: "93c5fd" },
      ],
      colors: {
        "editor.background": "#090d13",
        "editor.foreground": "#e6edf3",
        "editorLineNumber.foreground": "#484f58",
        "editorLineNumber.activeForeground": "#c084fc",
        "editor.lineHighlightBackground": "#ffffff06",
        "editorCursor.foreground": "#a78bfa",
      },
    });
  };

  const lang = getLanguage(filePath);

  /* ── Sub-component: Source Code Panel ─────────────────────── */
  const renderSourcePanel = () => (
    <div
      style={{
        borderRadius: 8,
        border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
        background: isLight ? "#ffffff" : "#0d1117",
        overflow: "hidden",
        boxShadow: isLight ? "0 4px 16px rgba(15, 23, 42, 0.05)" : "0 4px 20px rgba(0, 0, 0, 0.3)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 520,
      }}
    >
      {/* Source Sub-Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: isLight ? "#f8fafc" : "#161b22",
          borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileCode size={14} style={{ color: isLight ? "#6366f1" : "#a78bfa" }} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: isLight ? "#0f172a" : "#e6edf3",
              fontFamily: "var(--font-mono)",
            }}
          >
            {cleanDisplayPath(filePath)}
          </span>

          {/* Mode Switcher: Coverage Flow vs Edit Code */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: isLight ? "#e2e8f0" : "rgba(0, 0, 0, 0.35)",
              borderRadius: 6,
              padding: 2,
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.08)",
              marginLeft: 4,
            }}
          >
            <button
              onClick={() => setViewMode("coverage")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: viewMode === "coverage" ? 700 : 500,
                background: viewMode === "coverage"
                  ? (isLight ? "#ffffff" : "rgba(167, 139, 250, 0.25)")
                  : "transparent",
                color: viewMode === "coverage"
                  ? (isLight ? "#4f46e5" : "#c084fc")
                  : (isLight ? "#64748b" : "#8b949e"),
                border: "none",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="View execution flow and code coverage"
            >
              <Eye size={11} />
              Coverage Flow
            </button>
            <button
              onClick={() => setViewMode("editor")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: viewMode === "editor" ? 700 : 500,
                background: viewMode === "editor"
                  ? (isLight ? "#ffffff" : "rgba(56, 189, 248, 0.22)")
                  : "transparent",
                color: viewMode === "editor"
                  ? (isLight ? "#0284c7" : "#38bdf8")
                  : (isLight ? "#64748b" : "#8b949e"),
                border: "none",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Edit code directly in this view"
            >
              <Edit3 size={11} />
              Edit Code
              {isDirty && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#f59e0b",
                    boxShadow: "0 0 6px #f59e0b",
                  }}
                  title="Unsaved changes"
                />
              )}
            </button>
          </div>
        </div>

        {/* Right side controls of Source Panel */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {viewMode === "coverage" ? (
            <>
              {/* Coverage stats */}
              <span style={{ fontSize: 11, color: isLight ? "#64748b" : "#8b949e" }}>
                Statement:{" "}
                <b style={{ color: stmtsPct >= 80 ? "#16a34a" : stmtsPct >= 60 ? "#d97706" : "#dc2626" }}>
                  {totalStatements > 0 ? `${coveredStatements}/${totalStatements}` : `${coveredLines}/${executableLines}`} ({stmtsPct}%)
                </b>
              </span>

              {missedLines > 0 ? (
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 7px",
                    borderRadius: 8,
                    background: isLight ? "rgba(239, 68, 68, 0.1)" : "rgba(239, 68, 68, 0.15)",
                    color: isLight ? "#dc2626" : "#f87171",
                    fontWeight: 600,
                    border: isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.3)",
                  }}
                >
                  ⚑ {missedLines} missed
                </span>
              ) : executableLines > 0 ? (
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 7px",
                    borderRadius: 8,
                    background: isLight ? "rgba(34, 197, 94, 0.1)" : "rgba(34, 197, 94, 0.15)",
                    color: isLight ? "#16a34a" : "#4ade80",
                    fontWeight: 600,
                    border: isLight ? "1px solid #bbf7d0" : "1px solid rgba(34, 197, 94, 0.3)",
                  }}
                >
                  ✓ 100%
                </span>
              ) : null}

              {/* Quick Line Filters */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  background: isLight ? "#f1f5f9" : "rgba(255,255,255,0.03)",
                  padding: 2,
                  borderRadius: 5,
                  border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <button
                  onClick={() => setFilterMode("all")}
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 3,
                    border: "none",
                    background: filterMode === "all" ? (isLight ? "#ffffff" : "rgba(167, 139, 250, 0.25)") : "transparent",
                    color: filterMode === "all" ? (isLight ? "#4f46e5" : "#c084fc") : (isLight ? "#64748b" : "#8b949e"),
                    cursor: "pointer",
                    fontWeight: filterMode === "all" ? 700 : 500,
                  }}
                >
                  All ({codeLines.length})
                </button>
                <button
                  onClick={() => setFilterMode("covered")}
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 3,
                    border: "none",
                    background: filterMode === "covered" ? (isLight ? "#ffffff" : "rgba(34, 197, 94, 0.2)") : "transparent",
                    color: filterMode === "covered" ? (isLight ? "#16a34a" : "#4ade80") : (isLight ? "#64748b" : "#8b949e"),
                    cursor: "pointer",
                    fontWeight: filterMode === "covered" ? 700 : 500,
                  }}
                >
                  Executed ({coveredLines})
                </button>
                {missedLines > 0 && (
                  <button
                    onClick={() => setFilterMode("missed")}
                    style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      borderRadius: 3,
                      border: "none",
                      background: filterMode === "missed" ? (isLight ? "#ffffff" : "rgba(239, 68, 68, 0.2)") : "transparent",
                      color: filterMode === "missed" ? (isLight ? "#dc2626" : "#f87171") : (isLight ? "#64748b" : "#8b949e"),
                      cursor: "pointer",
                      fontWeight: filterMode === "missed" ? 700 : 500,
                    }}
                  >
                    Missed ({missedLines})
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {/* In Editor mode toolbar */}
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.06)",
                  color: isLight ? "#475569" : "#94a3b8",
                  textTransform: "uppercase",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {lang}
              </span>

              {isDirty && (
                <button
                  onClick={handleDiscard}
                  disabled={isSaving}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    borderRadius: 5,
                    background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)",
                    border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)",
                    color: isLight ? "#475569" : "#94a3b8",
                    fontSize: 11,
                    cursor: isSaving ? "not-allowed" : "pointer",
                  }}
                  className="hover:opacity-90"
                  title="Discard unsaved changes"
                >
                  <RotateCcw size={11} />
                  Discard
                </button>
              )}

              <button
                onClick={handleSave}
                disabled={isSaving || !projectId || !isDirty}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 10px",
                  borderRadius: 5,
                  background: saveStatus === "success"
                    ? (isLight ? "#16a34a" : "rgba(34, 197, 94, 0.2)")
                    : isDirty
                      ? (isLight ? "#2563eb" : "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)")
                      : (isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)"),
                  border: isDirty ? "none" : (isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)"),
                  color: isDirty || saveStatus === "success" ? "#ffffff" : (isLight ? "#94a3b8" : "#64748b"),
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: isSaving || !projectId || !isDirty ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                }}
                title="Save source file to disk (Ctrl+S)"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Saving...
                  </>
                ) : saveStatus === "success" ? (
                  <>
                    <Check size={11} />
                    Saved!
                  </>
                ) : (
                  <>
                    <Save size={11} />
                    Save (Ctrl+S)
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Save Notification Banners */}
      {saveStatus === "success" && (
        <div
          style={{
            padding: "5px 14px",
            background: isLight ? "#dcfce7" : "rgba(34, 197, 94, 0.12)",
            borderBottom: isLight ? "1px solid #bbf7d0" : "1px solid rgba(34, 197, 94, 0.25)",
            color: isLight ? "#15803d" : "#4ade80",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <CheckCircle2 size={12} />
          <span>File saved successfully to project disk!</span>
        </div>
      )}

      {saveStatus === "error" && errorMessage && (
        <div
          style={{
            padding: "5px 14px",
            background: isLight ? "#fee2e2" : "rgba(239, 68, 68, 0.12)",
            borderBottom: isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.25)",
            color: isLight ? "#b91c1c" : "#f87171",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <AlertCircle size={12} />
          <span>Error saving file: {errorMessage}</span>
        </div>
      )}

      {/* Main Content Area */}
      <div style={{ flex: 1, minHeight: 460, position: "relative", overflowY: "auto" }}>
        {viewMode === "editor" ? (
          <div style={{ height: "100%", minHeight: 460 }}>
            <MonacoEditor
              height="100%"
              minHeight="460px"
              language={lang}
              theme={isLight ? "vs" : "covai-dark-inline"}
              value={editorContent}
              onChange={(val) => {
                setEditorContent(val ?? "");
                setIsDirty(true);
              }}
              beforeMount={handleEditorWillMount}
              onMount={handleEditorDidMount}
              options={{
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
                lineHeight: 22,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on",
                renderLineHighlight: "all",
                smoothScrolling: true,
              }}
            />
          </div>
        ) : (
          /* Visual Coverage Execution Flow View */
          <div
            style={{
              padding: "6px 0",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 12,
              lineHeight: "22px",
            }}
          >
            {visibleLineEntries.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: isLight ? "#94a3b8" : "#6e7681" }}>
                {codeLines.length === 0
                  ? "No source code content available for this file."
                  : "No lines match the selected filter."}
              </div>
            ) : (
              visibleLineEntries.map(({ lineNum, codeText, isExecutable, isCovered, isMissed, isFailed, hits, error, reason }) => {
                const lineNumStr = String(lineNum).padStart(2, "0");

                let rowBg = "transparent";
                let borderLeft = "3px solid transparent";

                if (isFailed) {
                  rowBg = isLight ? "rgba(239, 68, 68, 0.12)" : "rgba(239, 68, 68, 0.12)";
                  borderLeft = "3px solid #ef4444";
                } else if (isMissed) {
                  rowBg = isLight ? "rgba(239, 68, 68, 0.06)" : "rgba(239, 68, 68, 0.08)";
                  borderLeft = "3px solid #ef4444";
                } else if (isCovered) {
                  rowBg = isLight ? "rgba(34, 197, 94, 0.05)" : "rgba(34, 197, 94, 0.03)";
                  borderLeft = isLight ? "3px solid #16a34a" : "3px solid #22c55e";
                }

                return (
                  <div
                    key={lineNum}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "2px 14px",
                      background: rowBg,
                      borderLeft: borderLeft,
                      transition: "background 0.1s ease",
                    }}
                    className={isLight ? "hover:bg-slate-100" : "hover:bg-white/[0.04]"}
                    title={
                      error
                        ? `Error: ${error}`
                        : reason
                          ? reason
                          : isCovered
                            ? `Executed ${hits} times`
                            : ""
                    }
                  >
                    {/* Line number */}
                    <span
                      style={{
                        width: 30,
                        color: isMissed || isFailed
                          ? (isLight ? "#dc2626" : "#f87171")
                          : isCovered
                            ? (isLight ? "#475569" : "#8b949e")
                            : (isLight ? "#94a3b8" : "#484f58"),
                        textAlign: "right",
                        userSelect: "none",
                        fontWeight: isCovered || isMissed ? 600 : 400,
                        marginRight: 10,
                      }}
                    >
                      {lineNumStr}
                    </span>

                    {/* Separator */}
                    <span
                      style={{
                        color: isLight ? "#cbd5e1" : "rgba(255, 255, 255, 0.12)",
                        userSelect: "none",
                        marginRight: 12,
                      }}
                    >
                      │
                    </span>

                    {/* Code text */}
                    <span
                      style={{
                        flex: 1,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        color: isMissed || isFailed
                          ? (isLight ? "#b91c1c" : "#fca5a5")
                          : isCovered
                            ? (isLight ? "#0f172a" : "#e6edf3")
                            : (isLight ? "#64748b" : "#8b949e"),
                      }}
                    >
                      {codeText || " "}
                    </span>

                    {/* Hits Badge on the right */}
                    {isExecutable && (
                      <div
                        style={{
                          marginLeft: 12,
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: isFailed
                              ? (isLight ? "rgba(239, 68, 68, 0.15)" : "rgba(239, 68, 68, 0.2)")
                              : isCovered
                                ? (isLight ? "rgba(34, 197, 94, 0.12)" : "rgba(34, 197, 94, 0.14)")
                                : (isLight ? "rgba(239, 68, 68, 0.1)" : "rgba(239, 68, 68, 0.15)"),
                            color: isFailed
                              ? (isLight ? "#dc2626" : "#fca5a5")
                              : isCovered
                                ? (isLight ? "#15803d" : "#4ade80")
                                : (isLight ? "#dc2626" : "#f87171"),
                            border: isFailed
                              ? (isLight ? "1px solid #fca5a5" : "1px solid rgba(239, 68, 68, 0.4)")
                              : isCovered
                                ? (isLight ? "1px solid #86efac" : "1px solid rgba(34, 197, 94, 0.3)")
                                : (isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.3)"),
                          }}
                        >
                          {isFailed
                            ? "× Failed"
                            : isCovered
                              ? `✓ ${hits} hit${hits > 1 ? "s" : ""}`
                              : "⚑ 0 hits"}
                        </span>

                        {isMissed && onSuggestTestcase && (
                          <button
                            onClick={() => onSuggestTestcase(filePath)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 3,
                              padding: "1px 5px",
                              borderRadius: 4,
                              background: isLight ? "#f5f3ff" : "rgba(168, 85, 247, 0.15)",
                              border: isLight ? "1px solid #ddd6fe" : "1px solid rgba(168, 85, 247, 0.35)",
                              color: isLight ? "#7c3aed" : "#c084fc",
                              fontSize: 10,
                              cursor: "pointer",
                            }}
                            title="AI suggest test case covering this line"
                          >
                            <Sparkles size={9} />
                            <span>Suggest</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Source Footer status */}
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
        <span>Source: {cleanDisplayPath(filePath)}</span>
        <span>{codeLines.length} lines · {coveredLines}/{executableLines} covered</span>
      </div>
    </div>
  );

  /* ── Sub-component: Associated Test File Panel ────────────── */
  const renderTestPanel = () => (
    <TestFileViewerPanel
      sourceFilePath={filePath}
      testFile={testFile}
      projectId={projectId}
      snapshotId={snapshotId}
      suggestions={suggestions}
      isLoadingSuggestions={isLoadingSuggestions}
      applyingSuggestionIds={applyingSuggestionIds}
      onApplySuggestion={onApplySuggestion}
      onApplyAllSuggestions={onApplyAllSuggestions}
      onSuggestMissingTest={() => onSuggestTestcase && onSuggestTestcase(filePath)}
      onOpenFile={onOpenFile}
      onTestFileSaved={async (savedPath) => {
        if (onFileSaved) await onFileSaved(savedPath);
      }}
      isLight={isLight}
    />
  );

  return (
    <div
      style={{
        borderRadius: 10,
        border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
        background: isLight ? "#ffffff" : "#090d13",
        overflow: "hidden",
        boxShadow: isLight ? "0 6px 24px rgba(15, 23, 42, 0.06)" : "0 6px 26px rgba(0, 0, 0, 0.45)",
      }}
    >
      {/* ── Top Bar: Layout Selector & Quick Status ───────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: isLight ? "#f8fafc" : "rgba(167, 139, 250, 0.08)",
          borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        {/* Left: Source File and Linked Test Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FileCode size={16} style={{ color: isLight ? "#4f46e5" : "#a78bfa" }} />
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: isLight ? "#0f172a" : "#f0f6fc",
                fontFamily: "var(--font-mono)",
              }}
            >
              {cleanDisplayPath(filePath)}
            </span>
          </div>

          {/* Test connection status badge */}
          {hasTestFile ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 8px",
                borderRadius: 5,
                background: isLight ? "#dcfce7" : "rgba(34, 197, 94, 0.15)",
                border: isLight ? "1px solid #86efac" : "1px solid rgba(34, 197, 94, 0.3)",
                color: isLight ? "#15803d" : "#4ade80",
                fontSize: 11,
                fontWeight: 600,
              }}
              title={`Associated Test File: ${testFile?.filePath}`}
            >
              <FlaskConical size={12} />
              <span>Test: {testFileName}</span>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 8px",
                borderRadius: 5,
                background: isLight ? "#fef3c7" : "rgba(245, 158, 11, 0.15)",
                border: isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.3)",
                color: isLight ? "#b45309" : "#fbbf24",
                fontSize: 11,
                fontWeight: 600,
              }}
              title="File này chưa có file test tương ứng nào được tìm thấy trong dự án"
            >
              <AlertTriangle size={12} />
              <span>Chưa có file test liên kết</span>
            </div>
          )}
        </div>

        {/* Center: Layout Switcher Tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: isLight ? "#e2e8f0" : "rgba(0, 0, 0, 0.4)",
            borderRadius: 7,
            padding: 3,
            border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <button
            onClick={() => setLayoutMode("split")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              borderRadius: 5,
              fontSize: 11,
              fontWeight: layoutMode === "split" ? 700 : 500,
              border: "none",
              background: layoutMode === "split"
                ? (isLight ? "#ffffff" : "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)")
                : "transparent",
              color: layoutMode === "split"
                ? (isLight ? "#4338ca" : "#ffffff")
                : (isLight ? "#64748b" : "#8b949e"),
              cursor: "pointer",
              boxShadow: layoutMode === "split"
                ? (isLight ? "0 2px 4px rgba(0,0,0,0.08)" : "0 2px 6px rgba(124, 58, 237, 0.35)")
                : "none",
              transition: "all 0.15s ease",
            }}
            title="Split View: Hiển thị song song File Code và File Test"
          >
            <Columns size={12} />
            <span>Song song (Code & Test)</span>
          </button>

          <button
            onClick={() => setLayoutMode("source")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              borderRadius: 5,
              fontSize: 11,
              fontWeight: layoutMode === "source" ? 700 : 500,
              border: "none",
              background: layoutMode === "source"
                ? (isLight ? "#ffffff" : "rgba(255, 255, 255, 0.12)")
                : "transparent",
              color: layoutMode === "source"
                ? (isLight ? "#0f172a" : "#ffffff")
                : (isLight ? "#64748b" : "#8b949e"),
              cursor: "pointer",
              boxShadow: layoutMode === "source" ? "0 2px 4px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s ease",
            }}
            title="Chỉ hiển thị mã nguồn"
          >
            <FileCode size={12} />
            <span>Mã nguồn</span>
          </button>

          <button
            onClick={() => setLayoutMode("test")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              borderRadius: 5,
              fontSize: 11,
              fontWeight: layoutMode === "test" ? 700 : 500,
              border: "none",
              background: layoutMode === "test"
                ? (isLight ? "#ffffff" : "rgba(255, 255, 255, 0.12)")
                : "transparent",
              color: layoutMode === "test"
                ? (isLight ? "#0f172a" : "#ffffff")
                : (isLight ? "#64748b" : "#8b949e"),
              cursor: "pointer",
              boxShadow: layoutMode === "test" ? "0 2px 4px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s ease",
            }}
            title="Chỉ hiển thị file test"
          >
            <FlaskConical size={12} />
            <span>File Test</span>
          </button>
        </div>

        {/* Right: Quick Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => onSuggestTestcase && onSuggestTestcase(filePath)}
            disabled={isLoadingSuggestions}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              background: "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",
              color: "#ffffff",
              border: "none",
              cursor: isLoadingSuggestions ? "wait" : "pointer",
              boxShadow: "0 2px 8px rgba(124, 58, 237, 0.35)",
              transition: "all 0.15s ease",
            }}
            className="hover:opacity-95"
            title="Gợi ý unit test mới cho file này"
          >
            {isLoadingSuggestions ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            <span>Suggest Missing Test</span>
          </button>

          <button
            onClick={() => onOpenFile?.(filePath)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "5px 9px",
              borderRadius: 6,
              fontSize: 11,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)",
              border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)",
              color: isLight ? "#334155" : "#cbd5e1",
              cursor: "pointer",
            }}
            className={isLight ? "hover:bg-slate-100" : "hover:bg-white/10 hover:text-white"}
            title="Mở file mã nguồn trong IDE"
          >
            <ExternalLink size={12} />
            <span>IDE</span>
          </button>
        </div>
      </div>

      {/* ── Main Layout Body ──────────────────────────────────── */}
      {layoutMode === "split" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 0.95fr)",
            gap: 12,
            padding: 12,
            background: isLight ? "#f1f5f9" : "#05070b",
          }}
        >
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            {renderSourcePanel()}
          </div>
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            {renderTestPanel()}
          </div>
        </div>
      )}

      {layoutMode === "source" && (
        <div style={{ padding: 12, background: isLight ? "#f1f5f9" : "#05070b" }}>
          {renderSourcePanel()}
        </div>
      )}

      {layoutMode === "test" && (
        <div style={{ padding: 12, background: isLight ? "#f1f5f9" : "#05070b" }}>
          {renderTestPanel()}
        </div>
      )}
    </div>
  );
}
