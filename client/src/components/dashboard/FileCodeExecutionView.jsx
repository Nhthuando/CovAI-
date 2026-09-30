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
} from "lucide-react";
import MonacoEditor from "@monaco-editor/react";
import { updateFileContentApi } from "../../services/project.service.js";
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
}) {
  const initialSourceCode = fileCoverage?.sourceCode || "";
  const linesMap = fileCoverage?.lines || {};
  const statements = fileCoverage?.statements || [];
  const summary = fileCoverage?.summary || {};

  // View mode: "coverage" (visual execution flow) or "editor" (in-place Monaco code editor)
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

  // Save handler for inline editor
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
      onFileSaved?.(filePath, editorContent);
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      console.error("Failed to save file content:", err);
      setSaveStatus("error");
      setErrorMessage(err.message || "Failed to save file to disk.");
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

  // Keyboard shortcut Ctrl+S / Cmd+S in Editor mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        if (viewMode === "editor") {
          e.preventDefault();
          handleSaveRef.current?.();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewMode]);

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

  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid rgba(255, 255, 255, 0.08)",
        background: "#090d13",
        overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
      }}
    >
      {/* View Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "rgba(167, 139, 250, 0.08)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FileCode size={15} style={{ color: "#a78bfa" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#e6edf3", fontFamily: "var(--font-mono)" }}>
            {cleanDisplayPath(filePath)}
          </span>

          {/* Mode Switcher Tabs */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(0, 0, 0, 0.35)",
              borderRadius: 6,
              padding: 2,
              border: "1px solid rgba(255, 255, 255, 0.08)",
              marginLeft: 6,
            }}
          >
            <button
              onClick={() => setViewMode("coverage")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 9px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: viewMode === "coverage" ? 700 : 500,
                background: viewMode === "coverage" ? "rgba(167, 139, 250, 0.25)" : "transparent",
                color: viewMode === "coverage" ? "#c084fc" : "#8b949e",
                border: "none",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Xem luồng thực thi và độ bao phủ code"
            >
              <Eye size={12} />
              Coverage Flow
            </button>
            <button
              onClick={() => setViewMode("editor")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 9px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: viewMode === "editor" ? 700 : 500,
                background: viewMode === "editor" ? "rgba(56, 189, 248, 0.22)" : "transparent",
                color: viewMode === "editor" ? "#38bdf8" : "#8b949e",
                border: "none",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Sửa code trực tiếp ngay trong giao diện này"
            >
              <Edit3 size={12} />
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
                  title="Có thay đổi chưa lưu"
                />
              )}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {viewMode === "coverage" ? (
            <>
              {/* Statement & Line summary */}
              <span style={{ fontSize: 11, color: "var(--color-text-secondary, #8b949e)" }}>
                Bao phủ câu lệnh:{" "}
                <b style={{ color: stmtsPct >= 80 ? "#4ade80" : stmtsPct >= 60 ? "#fbbf24" : "#f87171" }}>
                  {totalStatements > 0 ? `${coveredStatements}/${totalStatements}` : `${coveredLines}/${executableLines}`} ({stmtsPct}%)
                </b>
                {executableLines > 0 && (
                  <span style={{ marginLeft: 6, color: "var(--color-text-muted, #6e7681)" }}>
                    ({coveredLines}/{executableLines} dòng)
                  </span>
                )}
              </span>

              {missedLines > 0 ? (
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 10,
                    background: "rgba(239, 68, 68, 0.15)",
                    color: "#f87171",
                    fontWeight: 600,
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                  }}
                >
                  ⚑ {missedLines} dòng chưa chạy
                </span>
              ) : executableLines > 0 ? (
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 10,
                    background: "rgba(34, 197, 94, 0.15)",
                    color: "#4ade80",
                    fontWeight: 600,
                    border: "1px solid rgba(34, 197, 94, 0.3)",
                  }}
                >
                  ✓ 100% Bao phủ
                </span>
              ) : null}

              {/* Quick Line Filters */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  background: "rgba(255,255,255,0.03)",
                  padding: 2,
                  borderRadius: 5,
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <button
                  onClick={() => setFilterMode("all")}
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 3,
                    border: "none",
                    background: filterMode === "all" ? "rgba(167, 139, 250, 0.25)" : "transparent",
                    color: filterMode === "all" ? "#c084fc" : "#8b949e",
                    cursor: "pointer",
                    fontWeight: filterMode === "all" ? 700 : 500,
                  }}
                >
                  Tất cả ({codeLines.length})
                </button>
                <button
                  onClick={() => setFilterMode("covered")}
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 3,
                    border: "none",
                    background: filterMode === "covered" ? "rgba(34, 197, 94, 0.2)" : "transparent",
                    color: filterMode === "covered" ? "#4ade80" : "#8b949e",
                    cursor: "pointer",
                    fontWeight: filterMode === "covered" ? 700 : 500,
                  }}
                >
                  Đã chạy ({coveredLines})
                </button>
                {missedLines > 0 && (
                  <button
                    onClick={() => setFilterMode("missed")}
                    style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      borderRadius: 3,
                      border: "none",
                      background: filterMode === "missed" ? "rgba(239, 68, 68, 0.2)" : "transparent",
                      color: filterMode === "missed" ? "#f87171" : "#8b949e",
                      cursor: "pointer",
                      fontWeight: filterMode === "missed" ? 700 : 500,
                    }}
                  >
                    Chưa chạy ({missedLines})
                  </button>
                )}
              </div>

              {/* Button to toggle to Editor */}
              <button
                onClick={() => setViewMode("editor")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 9px",
                  borderRadius: 5,
                  background: "rgba(56, 189, 248, 0.12)",
                  border: "1px solid rgba(56, 189, 248, 0.3)",
                  color: "#38bdf8",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                className="hover:opacity-90"
                title="Chỉnh sửa mã nguồn trực tiếp tại đây"
              >
                <Edit3 size={12} />
                Edit Code
              </button>
            </>
          ) : (
            <>
              {/* In Editor mode toolbar */}
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "rgba(255, 255, 255, 0.06)",
                  color: "#94a3b8",
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
                    padding: "4px 9px",
                    borderRadius: 5,
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    color: "#94a3b8",
                    fontSize: 11,
                    cursor: isSaving ? "not-allowed" : "pointer",
                  }}
                  className="hover:bg-white/10 hover:text-white"
                  title="Hủy các thay đổi chưa lưu"
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
                  gap: 6,
                  padding: "4px 12px",
                  borderRadius: 5,
                  background: saveStatus === "success"
                    ? "rgba(34, 197, 94, 0.2)"
                    : isDirty
                      ? "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)"
                      : "rgba(255, 255, 255, 0.05)",
                  border: saveStatus === "success"
                    ? "1px solid rgba(34, 197, 94, 0.4)"
                    : isDirty
                      ? "1px solid rgba(56, 189, 248, 0.5)"
                      : "1px solid rgba(255, 255, 255, 0.1)",
                  color: saveStatus === "success"
                    ? "#4ade80"
                    : isDirty
                      ? "#ffffff"
                      : "#64748b",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: isSaving || !projectId || !isDirty ? "not-allowed" : "pointer",
                  boxShadow: isDirty ? "0 2px 8px rgba(2, 132, 199, 0.25)" : "none",
                  transition: "all 0.15s ease",
                }}
                className={isDirty && !isSaving ? "hover:opacity-90" : ""}
                title="Lưu file vào đĩa (Ctrl+S)"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Saving...
                  </>
                ) : saveStatus === "success" ? (
                  <>
                    <Check size={12} />
                    Saved!
                  </>
                ) : (
                  <>
                    <Save size={12} />
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
            padding: "6px 16px",
            background: "rgba(34, 197, 94, 0.12)",
            borderBottom: "1px solid rgba(34, 197, 94, 0.25)",
            color: "#4ade80",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <CheckCircle2 size={13} />
          <span>Đã lưu file thành công vào đĩa dự án!</span>
        </div>
      )}

      {saveStatus === "error" && errorMessage && (
        <div
          style={{
            padding: "6px 16px",
            background: "rgba(239, 68, 68, 0.12)",
            borderBottom: "1px solid rgba(239, 68, 68, 0.25)",
            color: "#f87171",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <AlertCircle size={13} />
          <span>Lỗi khi lưu file: {errorMessage}</span>
        </div>
      )}

      {/* Unsaved changes notice if looking at coverage view */}
      {viewMode === "coverage" && isDirty && (
        <div
          style={{
            padding: "6px 16px",
            background: "rgba(245, 158, 11, 0.12)",
            borderBottom: "1px solid rgba(245, 158, 11, 0.25)",
            color: "#fbbf24",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={13} />
            <span>Bạn có thay đổi chưa lưu trong chế độ soạn thảo mã nguồn.</span>
          </div>
          <button
            onClick={() => setViewMode("editor")}
            style={{
              background: "transparent",
              border: "underline",
              color: "#fde047",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Chuyển sang Edit Code để lưu →
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {viewMode === "editor" ? (
        <div style={{ height: 480, position: "relative" }}>
          <MonacoEditor
            height="100%"
            language={lang}
            theme="covai-dark-inline"
            value={editorContent}
            onChange={(val) => {
              setEditorContent(val ?? "");
              setIsDirty(true);
            }}
            beforeMount={handleEditorWillMount}
            onMount={handleEditorDidMount}
            options={{
              fontSize: 12.5,
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
            maxHeight: 480,
            overflowY: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 12,
            lineHeight: "22px",
            padding: "6px 0",
          }}
        >
          {visibleLineEntries.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#6e7681" }}>
              {codeLines.length === 0
                ? "Chưa có nội dung mã nguồn của file này."
                : "Không có dòng nào phù hợp với bộ lọc đã chọn."}
            </div>
          ) : (
            visibleLineEntries.map(({ lineNum, codeText, isExecutable, isCovered, isMissed, isFailed, hits, error, reason }) => {
              const lineNumStr = String(lineNum).padStart(2, "0");

              let rowBg = "transparent";
              let borderLeft = "3px solid transparent";

              if (isFailed) {
                rowBg = "rgba(239, 68, 68, 0.12)";
                borderLeft = "3px solid #ef4444";
              } else if (isMissed) {
                rowBg = "rgba(239, 68, 68, 0.08)";
                borderLeft = "3px solid #ef4444";
              } else if (isCovered) {
                rowBg = "rgba(34, 197, 94, 0.03)";
                borderLeft = "3px solid #22c55e";
              }

              return (
                <div
                  key={lineNum}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "2px 16px",
                    background: rowBg,
                    borderLeft: borderLeft,
                    transition: "background 0.1s ease",
                  }}
                  className="hover:bg-white/[0.04]"
                  title={
                    error
                      ? `Lỗi: ${error}`
                      : reason
                        ? reason
                        : isCovered
                          ? `Đã thực thi ${hits} lần`
                          : ""
                  }
                >
                  {/* Line number */}
                  <span
                    style={{
                      width: 32,
                      color: isMissed || isFailed ? "#f87171" : isCovered ? "#8b949e" : "#484f58",
                      textAlign: "right",
                      userSelect: "none",
                      fontWeight: isCovered || isMissed ? 600 : 400,
                      marginRight: 12,
                    }}
                  >
                    {lineNumStr}
                  </span>

                  {/* Separator */}
                  <span
                    style={{
                      color: "rgba(255, 255, 255, 0.12)",
                      userSelect: "none",
                      marginRight: 14,
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
                        ? "#fca5a5"
                        : isCovered
                          ? "#e6edf3"
                          : "#8b949e",
                    }}
                  >
                    {codeText || " "}
                  </span>

                  {/* Hits Badge on the right */}
                  {isExecutable && (
                    <div
                      style={{
                        marginLeft: 16,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "1px 7px",
                          borderRadius: 4,
                          background: isFailed
                            ? "rgba(239, 68, 68, 0.2)"
                            : isCovered
                              ? "rgba(34, 197, 94, 0.14)"
                              : "rgba(239, 68, 68, 0.15)",
                          color: isFailed ? "#fca5a5" : isCovered ? "#4ade80" : "#f87171",
                          border: isFailed
                            ? "1px solid rgba(239, 68, 68, 0.4)"
                            : isCovered
                              ? "1px solid rgba(34, 197, 94, 0.3)"
                              : "1px solid rgba(239, 68, 68, 0.3)",
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
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "rgba(168, 85, 247, 0.15)",
                            border: "1px solid rgba(168, 85, 247, 0.35)",
                            color: "#c084fc",
                            fontSize: 10,
                            cursor: "pointer",
                          }}
                          title="AI gợi ý test case bao phủ dòng này"
                        >
                          <Sparkles size={10} />
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
  );
}
