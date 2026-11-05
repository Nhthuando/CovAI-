import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  X,
  ExternalLink,
  Copy,
  Check,
  FileCode,
  FileCheck,
  Layers,
  GitBranch,
  Cpu,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Clock,
  Sparkles,
  Target,
} from "lucide-react";
import MonacoEditor from "@monaco-editor/react";
import { getFileCoverage } from "../../services/coverage.service.js";
import { getFileContentApi } from "../../services/project.service.js";
import { resolveTestOrFunctionLine } from "../../services/navigation.service.js";
import { cleanDisplayPath } from "./CoverageTypeDashboard.jsx";
import FileCodeExecutionView from "./FileCodeExecutionView.jsx";

const EXT_LANG_MAP = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".json": "json",
  ".html": "html",
  ".css": "css",
  ".md": "markdown",
};

const getLanguage = (path) => {
  if (!path) return "javascript";
  const match = path.match(/\.[^.]+$/);
  if (!match) return "javascript";
  return EXT_LANG_MAP[match[0].toLowerCase()] || "javascript";
};

/**
 * InPlaceCoverageFileModal
 * 
 * Opens source and test files directly inside the Unit Test dashboard without
 * redirecting to another page or switching tabs.
 */
export default function InPlaceCoverageFileModal({
  isOpen = false,
  onClose,
  filePath,
  targetLine = null,
  functionName = null,
  endLine = null,
  testInfo = null,
  projectId,
  snapshotId,
  onOpenInExternalEditor,
  isLight = false,
  testSuites = [],
}) {
  const [loading, setLoading] = useState(true);
  const [fileCoverage, setFileCoverage] = useState(null);
  const [rawFileContent, setRawFileContent] = useState("");
  const [activeTab, setActiveTab] = useState("code"); // "code" | "assertions"
  const [copied, setCopied] = useState(false);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsRef = useRef([]);

  const isTestFile = useMemo(() => {
    if (!filePath) return false;
    return (
      /\.(test|spec|testcase|steps?)\.[a-z0-9]+$/i.test(filePath) ||
      filePath.includes("__tests__") ||
      filePath.includes("tests/") ||
      filePath.includes("test/")
    );
  }, [filePath]);

  // Auto-resolve exact line of test scenario or function
  const resolvedTargetLine = useMemo(() => {
    if (targetLine && Number(targetLine) > 0) return Number(targetLine);
    const content = rawFileContent || fileCoverage?.sourceCode || "";
    if (!content) return null;
    const target = (isTestFile ? testInfo?.testTitle : null) || functionName || testInfo?.testTitle;
    if (!target) return null;
    return resolveTestOrFunctionLine(content, target, isTestFile);
  }, [targetLine, functionName, testInfo?.testTitle, rawFileContent, fileCoverage, isTestFile]);

  // Find linked test suite metadata if this is a test file
  const linkedSuite = useMemo(() => {
    if (!filePath || !Array.isArray(testSuites)) return null;
    const cleanP = filePath.replace(/\\/g, "/").toLowerCase();
    return (
      testSuites.find((s) => {
        const sPath = (s.filePath || "").replace(/\\/g, "/").toLowerCase();
        return sPath === cleanP || sPath.endsWith(cleanP) || cleanP.endsWith(sPath);
      }) || null
    );
  }, [filePath, testSuites]);

  // Jump to specific line and apply highlight decoration
  const jumpToLine = useCallback(
    (lineNum) => {
      if (!editorRef.current || !lineNum || lineNum <= 0) return;
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      try {
        editor.revealLineInCenter(lineNum);
        editor.setPosition({ lineNumber: lineNum, column: 1 });
        editor.focus();

        if (monaco) {
          const safeEnd = endLine && endLine >= lineNum ? endLine : lineNum;
          decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
            {
              range: new monaco.Range(lineNum, 1, safeEnd, 1),
              options: {
                isWholeLine: true,
                className: "monaco-test-highlight-line",
                linesDecorationsClassName: "monaco-test-glyph-marker",
                overviewRuler: {
                  color: "#6366f1",
                  position: monaco.editor.OverviewRulerLane.Full,
                },
              },
            },
          ]);
        }
      } catch (err) {
        console.warn("Failed to reveal line in Monaco editor:", err);
      }
    },
    [endLine]
  );

  // Jump when resolved line, content or tab becomes ready
  useEffect(() => {
    if (resolvedTargetLine && activeTab === "code" && editorRef.current) {
      const timer = setTimeout(() => {
        jumpToLine(resolvedTargetLine);
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [resolvedTargetLine, rawFileContent, activeTab, jumpToLine]);

  // Load file data
  useEffect(() => {
    if (!isOpen || !filePath) return;

    let isMounted = true;
    setLoading(true);

    const loadData = async () => {
      try {
        if (!isTestFile && snapshotId) {
          // Attempt to load detailed file coverage first
          try {
            const covRes = await getFileCoverage(snapshotId, filePath);
            if (isMounted && covRes?.data) {
              setFileCoverage(covRes.data);
              setLoading(false);
              return;
            }
          } catch (e) {
            console.warn("Failed to load file coverage, falling back to raw file content:", e);
          }
        }

        // Fallback or Test file: Load raw content
        if (projectId) {
          const contentRes = await getFileContentApi(projectId, filePath);
          if (isMounted) {
            setRawFileContent(contentRes?.data?.content || contentRes?.content || "");
            setFileCoverage(null);
          }
        }
      } catch (err) {
        console.error("Failed to load file for in-place modal:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, filePath, isTestFile, snapshotId, projectId]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Monaco jump to target line
  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    const lineToJump = resolvedTargetLine || (targetLine && Number(targetLine) > 0 ? Number(targetLine) : null);
    if (lineToJump) {
      setTimeout(() => {
        jumpToLine(lineToJump);
      }, 150);
    }
  };

  const handleCopyPath = () => {
    if (!filePath) return;
    navigator.clipboard?.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen || !filePath) return null;

  const fileName = filePath.split("/").pop() || filePath;
  const summary = fileCoverage?.summary || null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: "95vw",
          maxWidth: 1380,
          height: "90vh",
          maxHeight: 920,
          background: isLight ? "#ffffff" : "#0d1117",
          border: isLight ? "1px solid #cbd5e1" : "1px solid #30363d",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.65)",
          overflow: "hidden",
        }}
      >
        {/* ── MODAL HEADER ── */}
        <div
          style={{
            padding: "12px 18px",
            borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid #21262d",
            background: isLight ? "#f8fafc" : "#161b22",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {/* File Title & Info */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: isTestFile
                  ? (isLight ? "rgba(99, 102, 241, 0.12)" : "rgba(129, 140, 248, 0.15)")
                  : (isLight ? "rgba(16, 185, 129, 0.12)" : "rgba(52, 211, 153, 0.15)"),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: isTestFile ? "#6366f1" : "#10b981",
                flexShrink: 0,
              }}
            >
              {isTestFile ? <FileCheck size={18} /> : <FileCode size={18} />}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 750,
                    color: isLight ? "#0f172a" : "#f0f6fc",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {fileName}
                </span>

                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 4,
                    background: isTestFile
                      ? (isLight ? "rgba(99, 102, 241, 0.15)" : "rgba(99, 102, 241, 0.25)")
                      : (isLight ? "rgba(16, 185, 129, 0.15)" : "rgba(16, 185, 129, 0.25)"),
                    color: isTestFile ? "#4f46e5" : "#059669",
                  }}
                >
                  {isTestFile ? "🧪 Unit Test Suite" : "📁 Source File"}
                </span>

                {(resolvedTargetLine || targetLine) && (
                  <button
                    onClick={() => jumpToLine(resolvedTargetLine || targetLine)}
                    style={{
                      fontSize: 10.5,
                      fontWeight: 650,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: isLight ? "#eff6ff" : "rgba(99, 102, 241, 0.18)",
                      border: isLight ? "1px solid #bfdbfe" : "1px solid rgba(99, 102, 241, 0.35)",
                      color: isLight ? "#1d4ed8" : "#a5b4fc",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title="Click to jump to this line in source code"
                  >
                    <Target size={11} className="text-indigo-400" />
                    <span>
                      Line {resolvedTargetLine || targetLine}
                      {functionName ? ` (${functionName.length > 30 ? functionName.substring(0, 30) + "..." : functionName})` : ""}
                    </span>
                  </button>
                )}
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: isLight ? "#64748b" : "#8b949e",
                  fontFamily: "var(--font-mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 620,
                  marginTop: 2,
                }}
                title={filePath}
              >
                {cleanDisplayPath(filePath)}
              </div>
            </div>
          </div>

          {/* Right Header Badges & Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Source Coverage Quick Badges */}
            {summary && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)",
                  border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
              >
                <span title="Statements">Stmts: <strong style={{ color: (summary.statements?.pct ?? 0) >= 100 ? "#10b981" : (summary.statements?.pct ?? 0) > 0 ? "#f59e0b" : "#ef4444" }}>{summary.statements?.pct ?? 0}%</strong></span>
                <span style={{ color: "#94a3b8" }}>·</span>
                <span title="Branches">Branch: <strong style={{ color: (summary.branches?.pct ?? 0) >= 100 ? "#10b981" : (summary.branches?.pct ?? 0) > 0 ? "#f59e0b" : "#ef4444" }}>{summary.branches?.pct ?? 0}%</strong></span>
                <span style={{ color: "#94a3b8" }}>·</span>
                <span title="Functions">Funcs: <strong style={{ color: (summary.functions?.pct ?? 0) >= 100 ? "#10b981" : (summary.functions?.pct ?? 0) > 0 ? "#f59e0b" : "#ef4444" }}>{summary.functions?.pct ?? 0}%</strong></span>
                <span style={{ color: "#94a3b8" }}>·</span>
                <span title="Lines">Lines: <strong style={{ color: (summary.lines?.pct ?? 0) >= 100 ? "#10b981" : (summary.lines?.pct ?? 0) > 0 ? "#f59e0b" : "#ef4444" }}>{summary.lines?.pct ?? 0}%</strong></span>
              </div>
            )}

            {/* Test Suite Assertions Count */}
            {isTestFile && linkedSuite && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: isLight ? "#ecfdf5" : "rgba(16, 185, 129, 0.12)",
                  color: "#10b981",
                  fontSize: 11,
                  fontWeight: 650,
                }}
              >
                <CheckCircle2 size={12} />
                <span>{linkedSuite.passedTests || linkedSuite.assertions?.length || 0} passed</span>
              </div>
            )}

            {/* Copy Path */}
            <button
              onClick={handleCopyPath}
              style={{
                padding: "6px 9px",
                borderRadius: 6,
                background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.06)",
                border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)",
                color: isLight ? "#334155" : "#e2e8f0",
                fontSize: 11,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
              title="Copy file path"
            >
              {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>

            {/* Open in Full Editor (Optional fallback) */}
            {onOpenInExternalEditor && (
              <button
                onClick={() => onOpenInExternalEditor(filePath, resolvedTargetLine || targetLine, functionName, endLine)}
                style={{
                  padding: "6px 11px",
                  borderRadius: 6,
                  background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.08)",
                  border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.15)",
                  color: isLight ? "#1e293b" : "#f1f5f9",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
                title="Open in full screen editor"
              >
                <span>Full Editor</span>
                <ExternalLink size={11} />
              </button>
            )}

            {/* Close Button */}
            <button
              onClick={onClose}
              style={{
                padding: 6,
                borderRadius: 6,
                background: "transparent",
                border: "none",
                color: isLight ? "#64748b" : "#8b949e",
                cursor: "pointer",
              }}
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── MODAL BODY ── */}
        <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
          {loading ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                color: isLight ? "#64748b" : "#8b949e",
              }}
            >
              <Loader2 size={28} className="animate-spin text-indigo-500" />
              <div style={{ fontSize: 13, fontWeight: 600 }}>Loading file content and execution coverage...</div>
            </div>
          ) : !isTestFile && fileCoverage ? (
            /* SOURCE FILE WITH COVERAGE VIEW */
            <div style={{ height: "100%", overflowY: "auto" }}>
              <FileCodeExecutionView
                filePath={filePath}
                fileCoverage={fileCoverage}
                projectId={projectId}
                snapshotId={snapshotId}
                onOpenFile={onOpenInExternalEditor}
                initialTargetLine={resolvedTargetLine || targetLine}
                functionName={functionName}
                targetEndLine={endLine}
                testInfo={testInfo}
                isLight={isLight}
              />
            </div>
          ) : (
            /* TEST FILE OR RAW CODE VIEW */
            <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
              {isTestFile && linkedSuite?.assertions?.length > 0 && (
                <div
                  style={{
                    padding: "8px 16px",
                    borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid #21262d",
                    background: isLight ? "#f8fafc" : "#161b22",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <button
                    onClick={() => setActiveTab("code")}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 5,
                      background: activeTab === "code" ? (isLight ? "#4f46e5" : "#6366f1") : "transparent",
                      color: activeTab === "code" ? "#ffffff" : (isLight ? "#64748b" : "#8b949e"),
                      border: "none",
                      fontSize: 11.5,
                      fontWeight: 650,
                      cursor: "pointer",
                    }}
                  >
                    Test File Source
                  </button>
                  <button
                    onClick={() => setActiveTab("assertions")}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 5,
                      background: activeTab === "assertions" ? (isLight ? "#4f46e5" : "#6366f1") : "transparent",
                      color: activeTab === "assertions" ? "#ffffff" : (isLight ? "#64748b" : "#8b949e"),
                      border: "none",
                      fontSize: 11.5,
                      fontWeight: 650,
                      cursor: "pointer",
                    }}
                  >
                    Executed Assertions ({linkedSuite.assertions.length})
                  </button>
                </div>
              )}

              {activeTab === "assertions" && linkedSuite ? (
                <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {linkedSuite.assertions.map((a, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          setActiveTab("code");
                          const line = resolveTestOrFunctionLine(rawFileContent, a.title || a.fullName, true);
                          if (line) {
                            setTimeout(() => jumpToLine(line), 120);
                          }
                        }}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 6,
                          background: isLight ? "#f8fafc" : "#161b22",
                          border: isLight ? "1px solid #e2e8f0" : "1px solid #30363d",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          cursor: "pointer",
                        }}
                        className="hover:border-indigo-500/50 transition-colors"
                        title="Click to open this test case source code directly"
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span style={{ color: a.status === "passed" ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                            {a.status === "passed" ? "✓" : "✗"}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: isLight ? "#1e293b" : "#e2e8f0" }}>
                            {a.title || a.fullName}
                          </span>
                          {a.category && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: a.category === "ERROR_HANDLING" ? "rgba(239, 68, 68, 0.15)" : a.category === "BOUNDARY_VALUES" ? "rgba(245, 158, 11, 0.15)" : a.category === "BRANCH_TOGGLING" ? "rgba(2, 132, 199, 0.15)" : "rgba(16, 185, 129, 0.15)",
                                color: a.category === "ERROR_HANDLING" ? "#ef4444" : a.category === "BOUNDARY_VALUES" ? "#f59e0b" : a.category === "BRANCH_TOGGLING" ? "#0284c7" : "#10b981",
                              }}
                            >
                              {a.categoryBadge || a.category}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#8b949e" }}>
                          <Clock size={11} />
                          <span>{a.duration || 0}ms</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0 }}>
                  <MonacoEditor
                    height="100%"
                    language={getLanguage(filePath)}
                    theme={isLight ? "vs" : "vs-dark"}
                    value={rawFileContent || fileCoverage?.sourceCode || "// No content available"}
                    options={{
                      readOnly: true,
                      minimap: { enabled: true },
                      fontSize: 12.5,
                      lineNumbers: "on",
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      automaticLayout: true,
                    }}
                    onMount={(editor, monaco) => handleEditorMount(editor, monaco)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
