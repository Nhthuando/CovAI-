import { useState, useEffect, useRef, useMemo } from "react";
import {
  X,
  Maximize2,
  Minimize2,
  FileCode,
  FileCheck,
  Split,
  CheckCircle2,
  XCircle,
  Zap,
  Loader2,
  AlertCircle,
  Edit3,
  Save,
  RotateCcw,
  Sparkles,
  Check,
  Play,
  Terminal,
  ShieldCheck,
} from "lucide-react";
import MonacoEditor from "@monaco-editor/react";
import useUnitTestSimulation, { CATEGORY_METADATA } from "../../../hooks/useUnitTestSimulation.js";
import SimulationPlaybackBar from "./SimulationPlaybackBar.jsx";
import SimulationInspectorTabs from "./SimulationInspectorTabs.jsx";
import { applyUnitTestSuggestion } from "../../../services/coverage.service.js";
import { invalidateCoverageQueries } from "../../../hooks/useCoverageQuery.js";

const EXT_LANG_MAP = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".json": "json",
  ".html": "html",
  ".css": "css",
};

const getLanguage = (path) => {
  if (!path || typeof path !== "string") return "javascript";
  const match = path.match(/\.[^.]+$/);
  if (!match) return "javascript";
  return EXT_LANG_MAP[match[0].toLowerCase()] || "javascript";
};

export function generateTestTemplate(category, functionName = "myFunction", sourceFileName = "service.js") {
  const cleanFn = functionName || "myFunction";
  switch (category) {
    case "BOUNDARY":
      return `describe("${cleanFn} - Boundary Values", () => {
  it("should handle boundary values such as 0, empty inputs, or edge limits", () => {
    // Category B: Boundary Value Analysis
    const result = ${cleanFn}(0);
    expect(result).toBeDefined();
  });
});\n`;
    case "BRANCH_TOGGLE":
      return `describe("${cleanFn} - Branch Toggling", () => {
  it("should evaluate alternate conditional logic and fallback branches", () => {
    // Category C: Branch Toggling (Testing falsy, nullish, or fallback paths)
    const result = ${cleanFn}(false);
    expect(result).toBeDefined();
  });
});\n`;
    case "ERROR_HANDLING":
      return `describe("${cleanFn} - Error Handling", () => {
  it("should gracefully handle invalid inputs and guard exceptions", () => {
    // Category D: Error & Exception Handling
    expect(() => {
      ${cleanFn}(null);
    }).toThrow();
  });
});\n`;
    case "HAPPY_PATH":
    default:
      return `describe("${cleanFn} - Happy Path", () => {
  it("should execute successfully with standard valid inputs and expected state transitions", () => {
    // Category A: Standard Valid Input & Normal Operation
    const result = ${cleanFn}("sample_input");
    expect(result).toBeDefined();
  });
});\n`;
  }
}

/**
 * UnitTestSimulationStudioModal
 * 
 * Interactive, educational per-file unit test execution simulation studio modal.
 * Features:
 * - Responsive split-pane layout (60% Monaco code viewer, 40% inspector tabs)
 * - Monaco active line and branch True/False decision highlight badges
 * - Playback bar with play/pause, step controls, speed selector, scrubber, keyboard shortcuts
 * - Educational guidance across 4-Category Decision Table Matrix
 * - Universal RAM Mock Isolation tracking (Rule 4)
 * - Full light and dark mode theming
 * - Storage Code Immutability Guard (strictly read-only)
 */
export default function UnitTestSimulationStudioModal({
  isOpen = false,
  onClose,
  snapshotId,
  projectId,
  availableSourceFiles = [],
  availableFunctionsList = [],
  availableTestSuites = [],
  initialSourceFile = null,
  initialTestFile = null,
  initialTestCaseId = null,
  initialFunctionName = null,
  initialTestCode = null,
  initialCategory = "HAPPY_PATH",
  isLight = false,
  isEmbedded = false,
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [studioMode, setStudioMode] = useState("playback"); // "playback" | "author"
  const [isApplying, setIsApplying] = useState(false);
  const [applySuccessMessage, setApplySuccessMessage] = useState(null);
  const [applyErrorMessage, setApplyErrorMessage] = useState(null);
  const [isSimulatingCustom, setIsSimulatingCustom] = useState(false);

  // Hook managing playback state machine, traces, scrubber, keyboard shortcuts
  const {
    selectedSourceFile,
    selectedTestFile,
    selectedFunctionName,
    selectedCategory,
    activeCodeView,
    currentStepIndex,
    isPlaying,
    playbackSpeed,
    sourcesData,
    sourcesLoading,
    simulationTrace,
    steps,
    currentStep,
    traceLoading,
    traceError,
    customTestCode,
    actions,
  } = useUnitTestSimulation({
    snapshotId,
    projectId,
    availableSourceFiles,
    availableFunctionsList,
    availableTestSuites,
    initialSourceFile,
    initialTestFile,
    initialTestCaseId,
    initialFunctionName,
    initialTestCode,
    initialCategory,
    enabled: isOpen,
  });

  // Editor refs & decorations
  const sourceEditorRef = useRef(null);
  const testEditorRef = useRef(null);
  const monacoRef = useRef(null);
  const sourceDecorationsRef = useRef([]);
  const testDecorationsRef = useRef([]);

  // Source and Test codes
  const sourceCode = simulationTrace?.sourceCode || "// Source code loading...";
  const testCode = simulationTrace?.testCode || initialTestCode || "// Test code loading...";
  const summary = simulationTrace?.summary || null;

  // Authoring Handlers
  const handleApplyToProject = async () => {
    const targetFile = selectedSourceFile || initialSourceFile;
    const targetTest = selectedTestFile || initialTestFile;
    const codeToApply = customTestCode || testCode;
    if (!snapshotId || !targetFile || !codeToApply) {
      setApplyErrorMessage("Thiếu thông tin snapshot, tệp nguồn hoặc mã test để lưu.");
      return;
    }
    try {
      setIsApplying(true);
      setApplyErrorMessage(null);
      setApplySuccessMessage(null);
      const res = await applyUnitTestSuggestion(snapshotId, {
        suggestion: {
          filePath: targetFile,
          testFilePath: targetTest || undefined,
          code: codeToApply,
          functionName: selectedFunctionName || undefined,
        },
        projectId,
      });
      if (res?.success || res?.status === "ok" || res?.appliedCount > 0) {
        setApplySuccessMessage("✓ Test case đã được áp dụng và lưu thành công vào tệp test của dự án!");
        invalidateCoverageQueries(snapshotId);
      } else {
        throw new Error(res?.message || "Không thể lưu test case vào dự án.");
      }
    } catch (err) {
      setApplyErrorMessage(err.message || "Lỗi khi áp dụng test case.");
    } finally {
      setIsApplying(false);
    }
  };

  const handleSimulateCustom = async () => {
    const codeToSim = customTestCode || testCode;
    if (!codeToSim || !codeToSim.trim()) {
      setApplyErrorMessage("Vui lòng nhập nội dung mã test case trước khi chạy mô phỏng.");
      return;
    }
    try {
      setIsSimulatingCustom(true);
      setApplyErrorMessage(null);
      setApplySuccessMessage(null);
      const trace = await actions.simulateCustomTest(codeToSim);
      if (trace) {
        setStudioMode("playback");
        if (activeCodeView === "source") {
          actions.setActiveCodeView("split");
        }
      }
    } catch (err) {
      setApplyErrorMessage(err.message || "Lỗi khi chạy mô phỏng bài test.");
    } finally {
      setIsSimulatingCustom(false);
    }
  };

  const handleInsertTemplate = (category) => {
    const fnName = selectedFunctionName || "myFunction";
    const tpl = generateTestTemplate(category, fnName, selectedSourceFile);
    actions.setCustomTestCode(tpl);
    actions.setSelectedCategory(category);
  };

  const handleResetCode = () => {
    actions.setCustomTestCode(simulationTrace?.testCode || initialTestCode || "");
    setApplySuccessMessage(null);
    setApplyErrorMessage(null);
  };

  // Synchronize customTestCode with newly loaded trace testCode if not modified
  useEffect(() => {
    if (simulationTrace?.testCode && !customTestCode) {
      actions.setCustomTestCode(simulationTrace.testCode);
    }
  }, [simulationTrace?.testCode, customTestCode, actions]);

  // Escape key handler
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

  // Handle Monaco editor mount
  const handleSourceEditorMount = (editor, monaco) => {
    sourceEditorRef.current = editor;
    monacoRef.current = monaco;
  };

  const handleTestEditorMount = (editor, monaco) => {
    testEditorRef.current = editor;
    monacoRef.current = monaco;
  };

  // Synchronize line highlights and reveal active line in Monaco editors
  useEffect(() => {
    if (!currentStep || !monacoRef.current) return;
    const monaco = monacoRef.current;
    const isBranchStep = currentStep.phase === "BRANCH_DECISION";
    const branchOutcome = currentStep.branchEvaluation?.branchTaken; // "TRUE" | "FALSE"

    // Decorate Source Editor
    if (sourceEditorRef.current && currentStep.line && currentStep.line > 0) {
      const editor = sourceEditorRef.current;
      const targetLine = currentStep.line;
      const endLine = currentStep.endLine && currentStep.endLine >= targetLine ? currentStep.endLine : targetLine;

      let lineClassName = "monaco-sim-active-line";
      let glyphClassName = "monaco-sim-glyph-marker";
      let rulerColor = "#6366f1";

      if (isBranchStep) {
        if (branchOutcome === "TRUE") {
          lineClassName = "monaco-sim-branch-true";
          glyphClassName = "monaco-sim-glyph-true";
          rulerColor = "#10b981";
        } else {
          lineClassName = "monaco-sim-branch-false";
          glyphClassName = "monaco-sim-glyph-false";
          rulerColor = "#f59e0b";
        }
      }

      try {
        sourceDecorationsRef.current = editor.deltaDecorations(sourceDecorationsRef.current, [
          {
            range: new monaco.Range(targetLine, 1, endLine, 1),
            options: {
              isWholeLine: true,
              className: lineClassName,
              linesDecorationsClassName: glyphClassName,
              overviewRuler: {
                color: rulerColor,
                position: monaco.editor.OverviewRulerLane.Full,
              },
            },
          },
        ]);
        editor.revealLineInCenter(targetLine);
      } catch (err) {
        console.warn("Could not apply decorations to source editor:", err);
      }
    }

    // Decorate Test Editor if current step has testLine or is assertion/mock setup
    if (testEditorRef.current) {
      const editor = testEditorRef.current;
      const testLine = currentStep.testLine || (currentStep.phase === "ASSERTION" ? currentStep.line : null);

      if (testLine && testLine > 0) {
        try {
          testDecorationsRef.current = editor.deltaDecorations(testDecorationsRef.current, [
            {
              range: new monaco.Range(testLine, 1, testLine, 1),
              options: {
                isWholeLine: true,
                className: "monaco-sim-active-line",
                linesDecorationsClassName: "monaco-sim-glyph-marker",
                overviewRuler: {
                  color: "#10b981",
                  position: monaco.editor.OverviewRulerLane.Full,
                },
              },
            },
          ]);
          editor.revealLineInCenter(testLine);
        } catch (err) {
          console.warn("Could not apply decorations to test editor:", err);
        }
      } else {
        testDecorationsRef.current = editor.deltaDecorations(testDecorationsRef.current, []);
      }
    }
  }, [currentStep]);

  // Available sources (merging backend sourcesData with availableSourceFiles prop)
  const displaySources = useMemo(() => {
    const map = new Map();
    if (Array.isArray(availableSourceFiles)) {
      for (const f of availableSourceFiles) {
        const p = f.filePath || f.path;
        if (p) {
          map.set(p, {
            filePath: p,
            fileName: f.fileName || f.name || p.split("/").pop(),
            functions: f.functions || [],
          });
        }
      }
    }
    if (Array.isArray(sourcesData)) {
      for (const s of sourcesData) {
        const p = s.filePath || s.path;
        if (p) {
          const existing = map.get(p) || {};
          map.set(p, {
            ...existing,
            ...s,
            filePath: p,
            fileName: s.fileName || existing.fileName || p.split("/").pop(),
            functions: (s.functions && s.functions.length > 0) ? s.functions : (existing.functions || []),
          });
        }
      }
    }
    return Array.from(map.values());
  }, [sourcesData, availableSourceFiles]);

  // Available functions in selected source file
  const currentSourceMeta = useMemo(() => {
    if (!selectedSourceFile) return null;
    return (
      displaySources.find(
        (s) =>
          s?.filePath === selectedSourceFile ||
          s?.filePath?.endsWith(selectedSourceFile) ||
          selectedSourceFile?.endsWith(s?.filePath)
      ) || null
    );
  }, [displaySources, selectedSourceFile]);

  const availableFunctions = useMemo(() => {
    if (currentSourceMeta?.functions && currentSourceMeta.functions.length > 0) {
      return currentSourceMeta.functions;
    }
    if (Array.isArray(availableFunctionsList) && availableFunctionsList.length > 0 && selectedSourceFile) {
      const fns = availableFunctionsList
        .filter((fn) => {
          const fnPath = fn.filePath || "";
          return (
            fnPath === selectedSourceFile ||
            fnPath.endsWith(selectedSourceFile) ||
            selectedSourceFile.endsWith(fnPath)
          );
        })
        .map((fn) => ({
          name: fn.name || fn.cleanName || fn.functionName || "anonymous",
          startLine: fn.startLine || fn.line || 1,
          endLine: fn.endLine || fn.startLine || 1,
        }));
      if (fns.length > 0) return fns;
    }
    return [];
  }, [currentSourceMeta, availableFunctionsList, selectedSourceFile]);

  if (!isOpen) return null;

  const decorationsStyle = (
    <style>{`
      .monaco-sim-active-line {
        background: rgba(99, 102, 241, 0.22) !important;
        border-left: 3px solid #6366f1 !important;
      }
      .monaco-sim-branch-true {
        background: rgba(16, 185, 129, 0.22) !important;
        border-left: 3px solid #10b981 !important;
      }
      .monaco-sim-branch-false {
        background: rgba(245, 158, 11, 0.22) !important;
        border-left: 3px solid #f59e0b !important;
      }
      .monaco-sim-glyph-marker {
        background: #6366f1;
        border-radius: 50%;
        width: 7px !important;
        height: 7px !important;
        margin-left: 5px;
        margin-top: 6px;
      }
      .monaco-sim-glyph-true {
        background: #10b981;
        border-radius: 50%;
        width: 7px !important;
        height: 7px !important;
        margin-left: 5px;
        margin-top: 6px;
      }
      .monaco-sim-glyph-false {
        background: #f59e0b;
        border-radius: 50%;
        width: 7px !important;
        height: 7px !important;
        margin-left: 5px;
        margin-top: 6px;
      }
    `}</style>
  );

  const containerContent = (
    <div
      style={{
        width: isFullscreen ? "100vw" : isEmbedded ? "100%" : "96vw",
        maxWidth: isFullscreen || isEmbedded ? "none" : 1680,
        height: isFullscreen ? "100vh" : isEmbedded ? "calc(100vh - 240px)" : "92vh",
        minHeight: isEmbedded ? 680 : undefined,
        background: isLight ? "#ffffff" : "#0d1117",
        border: isFullscreen ? "none" : isLight ? "1px solid #cbd5e1" : "1px solid #30363d",
        borderRadius: isFullscreen ? 0 : 12,
        display: "flex",
        flexDirection: "column",
        boxShadow: isEmbedded && !isFullscreen
          ? (isLight ? "0 1px 3px rgba(15, 23, 42, 0.05)" : "0 4px 14px rgba(0, 0, 0, 0.35)")
          : "0 25px 50px -12px rgba(0, 0, 0, 0.75)",
        overflow: "hidden",
      }}
    >
        {/* ── MODAL HEADER ROW 1: Title & Studio Mode ── */}
        <div
          style={{
            padding: "8px 18px",
            borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid #21262d",
            background: isLight ? "#f8fafc" : "#161b22",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {/* Left Title */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                boxShadow: "0 2px 8px rgba(99, 102, 241, 0.4)",
                flexShrink: 0,
              }}
            >
              <Zap size={16} fill="#ffffff" />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 750,
                  color: isLight ? "#0f172a" : "#f0f6fc",
                  letterSpacing: "-0.01em",
                }}
              >
                Unit Test Simulation Studio
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: isLight ? "rgba(99, 102, 241, 0.12)" : "rgba(99, 102, 241, 0.25)",
                  color: isLight ? "#4f46e5" : "#a5b4fc",
                }}
              >
                Interactive Player
              </span>
              {traceLoading && (
                <Loader2 size={13} className="animate-spin text-indigo-400" />
              )}
            </div>
          </div>

          {/* Right Header Controls (Studio Mode, View Mode, Fullscreen, Close) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* Mode Switcher: Playback vs Authoring Sandbox */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                borderRadius: 8,
                background: isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.08)",
                padding: 2,
                border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)",
              }}
            >
              <button
                onClick={() => setStudioMode("playback")}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  background:
                    studioMode === "playback"
                      ? "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)"
                      : "transparent",
                  color: studioMode === "playback" ? "#ffffff" : isLight ? "#475569" : "#94a3b8",
                  border: "none",
                  fontSize: 11,
                  fontWeight: studioMode === "playback" ? 750 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  boxShadow:
                    studioMode === "playback" ? "0 2px 6px rgba(99, 102, 241, 0.35)" : "none",
                  transition: "all 0.15s ease",
                }}
                title="Chế độ Trình phát Mô phỏng: Xem chi tiết từng bước thực thi AST, trạng thái biến và rẽ nhánh"
              >
                <Play size={12} fill={studioMode === "playback" ? "#ffffff" : "currentColor"} />
                <span>Trình phát mô phỏng</span>
              </button>

              <button
                onClick={() => {
                  setStudioMode("author");
                  if (!customTestCode && testCode) {
                    actions.setCustomTestCode(testCode);
                  }
                  if (activeCodeView === "source") {
                    actions.setActiveCodeView("split");
                  }
                }}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  background:
                    studioMode === "author"
                      ? "linear-gradient(135deg, #059669 0%, #10b981 100%)"
                      : "transparent",
                  color: studioMode === "author" ? "#ffffff" : isLight ? "#475569" : "#94a3b8",
                  border: "none",
                  fontSize: 11,
                  fontWeight: studioMode === "author" ? 750 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  boxShadow:
                    studioMode === "author" ? "0 2px 6px rgba(16, 185, 129, 0.35)" : "none",
                  transition: "all 0.15s ease",
                }}
                title="Chế độ Tự viết Test Case: Tự soạn thảo test case, dùng template 4-category và chạy thử nghiệm"
              >
                <Edit3 size={12} />
                <span>Tự viết Test Case</span>
              </button>
            </div>

            {/* Code View Mode Toggle Tabs */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                borderRadius: 6,
                background: isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.06)",
                padding: 2,
              }}
            >
              <button
                onClick={() => actions.setActiveCodeView("source")}
                style={{
                  padding: "4px 8px",
                  borderRadius: 5,
                  background:
                    activeCodeView === "source"
                      ? isLight
                        ? "#ffffff"
                        : "#21262d"
                      : "transparent",
                  color:
                    activeCodeView === "source"
                      ? isLight
                        ? "#0f172a"
                        : "#f0f6fc"
                      : isLight
                      ? "#64748b"
                      : "#8b949e",
                  border: "none",
                  fontSize: 11,
                  fontWeight: activeCodeView === "source" ? 700 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                title="View Source Code"
              >
                <FileCode size={12} />
                <span>Source</span>
              </button>

              <button
                onClick={() => actions.setActiveCodeView("test")}
                style={{
                  padding: "4px 8px",
                  borderRadius: 5,
                  background:
                    activeCodeView === "test"
                      ? isLight
                        ? "#ffffff"
                        : "#21262d"
                      : "transparent",
                  color:
                    activeCodeView === "test"
                      ? isLight
                        ? "#0f172a"
                        : "#f0f6fc"
                      : isLight
                      ? "#64748b"
                      : "#8b949e",
                  border: "none",
                  fontSize: 11,
                  fontWeight: activeCodeView === "test" ? 700 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                title="View Test Suite"
              >
                <FileCheck size={12} />
                <span>Test Suite</span>
              </button>

              <button
                onClick={() => actions.setActiveCodeView("split")}
                style={{
                  padding: "4px 8px",
                  borderRadius: 5,
                  background:
                    activeCodeView === "split"
                      ? isLight
                        ? "#ffffff"
                        : "#21262d"
                      : "transparent",
                  color:
                    activeCodeView === "split"
                      ? isLight
                        ? "#0f172a"
                        : "#f0f6fc"
                      : isLight
                      ? "#64748b"
                      : "#8b949e",
                  border: "none",
                  fontSize: 11,
                  fontWeight: activeCodeView === "split" ? 700 : 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                title="Split Side-by-Side View"
              >
                <Split size={12} />
                <span>Split</span>
              </button>
            </div>

            {/* Fullscreen Toggle */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              style={{
                padding: 6,
                borderRadius: 6,
                background: "transparent",
                border: "none",
                color: isLight ? "#64748b" : "#8b949e",
                cursor: "pointer",
              }}
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>

            {/* Close Button (shown in modal mode or fullscreen) */}
            {(!isEmbedded || isFullscreen) && onClose && (
              <button
                onClick={() => {
                  if (isFullscreen) {
                    setIsFullscreen(false);
                  } else {
                    onClose?.();
                  }
                }}
                style={{
                  padding: 6,
                  borderRadius: 6,
                  background: "transparent",
                  border: "none",
                  color: isLight ? "#64748b" : "#8b949e",
                  cursor: "pointer",
                }}
                title={isFullscreen ? "Exit Fullscreen" : "Close (Esc)"}
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* ── MODAL HEADER ROW 2: Dedicated File, Function & Scenario Bar ── */}
        <div
          style={{
            padding: "8px 18px",
            borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid #21262d",
            background: isLight ? "#f1f5f9" : "#13171f",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          {/* Left: File & Function Dropdowns */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {/* Target File Dropdown */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <FileCode size={13} style={{ color: "#6366f1", flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: isLight ? "#475569" : "#94a3b8",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                File:
              </span>
              <select
                value={selectedSourceFile || (displaySources[0]?.filePath || "")}
                onChange={(e) => actions.setSelectedSourceFile(e.target.value)}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: isLight ? "#ffffff" : "#0d1117",
                  border: isLight ? "1px solid #cbd5e1" : "1px solid #30363d",
                  color: isLight ? "#0f172a" : "#f1f5f9",
                  fontSize: 11.5,
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                  minWidth: 200,
                  maxWidth: 320,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
                title="Chọn tập tin nguồn để chạy mô phỏng kiểm thử"
              >
                {displaySources.length === 0 ? (
                  <option value="">(Đang tải danh sách tập tin...)</option>
                ) : (
                  displaySources.filter(Boolean).map((src, idx) => {
                    const fPath = src?.filePath || "";
                    const fnCount = src?.functions?.length || 0;
                    return (
                      <option key={fPath || idx} value={fPath}>
                        {fPath || src?.fileName || "source.js"} {fnCount > 0 ? `(${fnCount} fns)` : ""}
                      </option>
                    );
                  })
                )}
              </select>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: isLight ? "#e2e8f0" : "#21262d",
                  color: isLight ? "#475569" : "#94a3b8",
                }}
              >
                {displaySources.length} files
              </span>
              {sourcesLoading && <Loader2 size={11} className="animate-spin text-indigo-400" />}
            </div>

            {/* Target Function Dropdown */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Terminal size={13} style={{ color: "#10b981", flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: isLight ? "#475569" : "#94a3b8",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                Func:
              </span>
              <select
                value={selectedFunctionName || ""}
                onChange={(e) => actions.setSelectedFunctionName(e.target.value)}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: isLight ? "#ffffff" : "#0d1117",
                  border: isLight ? "1px solid #cbd5e1" : "1px solid #30363d",
                  color: isLight ? "#0f172a" : "#f1f5f9",
                  fontSize: 11.5,
                  fontFamily: "var(--font-mono)",
                  cursor: "pointer",
                  minWidth: 150,
                  maxWidth: 220,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
                title="Chọn hàm mục tiêu trong tập tin để chạy mô phỏng"
              >
                {availableFunctions.length === 0 ? (
                  <option value="">(Tất cả logic / Main body)</option>
                ) : (
                  <>
                    <option value="">(Tất cả hàm / Toàn bộ file)</option>
                    {availableFunctions.map((fn) => (
                      <option key={fn.name} value={fn.name}>
                        {fn.name}() {fn.startLine ? `[L${fn.startLine}–L${fn.endLine || fn.startLine}]` : ""}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
          </div>

          {/* Right: 4-Category Scenario Buttons & Badges */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: isLight ? "#475569" : "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              Kịch bản:
            </span>

            {/* 4-Category Selector Buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {Object.values(CATEGORY_METADATA).map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => actions.setSelectedCategory(cat.id)}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 5,
                      background: isSelected
                        ? cat.color
                        : isLight
                        ? "#ffffff"
                        : "rgba(255, 255, 255, 0.05)",
                      color: isSelected ? "#ffffff" : isLight ? "#334155" : "#cbd5e1",
                      border: isSelected
                        ? `1px solid ${cat.color}`
                        : isLight
                        ? "1px solid #cbd5e1"
                        : "1px solid rgba(255, 255, 255, 0.08)",
                      fontSize: 10.5,
                      fontWeight: isSelected ? 750 : 500,
                      cursor: "pointer",
                      transition: "all 0.12s ease",
                      boxShadow: isSelected ? "0 1px 4px rgba(0,0,0,0.15)" : "none",
                    }}
                    title={`Chạy kịch bản mô phỏng: ${cat.name}`}
                  >
                    {cat.shortName}
                  </button>
                );
              })}
            </div>

            {/* Outcome Badge */}
            {summary && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px",
                  borderRadius: 5,
                  background: summary.allAssertionsPassed
                    ? isLight
                      ? "#ecfdf5"
                      : "rgba(16, 185, 129, 0.15)"
                    : isLight
                    ? "#fef2f2"
                    : "rgba(239, 68, 68, 0.15)",
                  color: summary.allAssertionsPassed ? "#10b981" : "#ef4444",
                  fontSize: 10.5,
                  fontWeight: 700,
                  border: `1px solid ${summary.allAssertionsPassed ? "#10b981" : "#ef4444"}40`,
                }}
              >
                {summary.allAssertionsPassed ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                <span>{summary.allAssertionsPassed ? "PASSED" : "FAILED"}</span>
              </div>
            )}

            {/* Universal RAM Mock Badge */}
            <span
              style={{
                fontSize: 10,
                color: "#10b981",
                fontWeight: 650,
                display: "flex",
                alignItems: "center",
                gap: 3,
                background: isLight ? "rgba(16, 185, 129, 0.08)" : "rgba(16, 185, 129, 0.15)",
                padding: "2px 6px",
                borderRadius: 4,
                border: "1px solid rgba(16, 185, 129, 0.25)",
              }}
              title="Mọi phụ thuộc database/network (Prisma, Axios, Redis) được cô lập an toàn trong RAM"
            >
              <ShieldCheck size={11} /> RAM Mocks
            </span>
          </div>
        </div>

        {/* ── ERROR BANNER IF ANY ── */}
        {traceError && (
          <div
            style={{
              padding: "6px 14px",
              background: isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.15)",
              borderBottom: "1px solid rgba(239, 68, 68, 0.25)",
              color: "#ef4444",
              fontSize: 11.5,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <AlertCircle size={14} />
            <span>Trace notification: {traceError}. Interactive simulation fallback active.</span>
          </div>
        )}

        {/* ── APPLY SUCCESS NOTIFICATION ── */}
        {applySuccessMessage && (
          <div
            style={{
              padding: "7px 16px",
              background: isLight ? "#ecfdf5" : "rgba(16, 185, 129, 0.15)",
              borderBottom: "1px solid rgba(16, 185, 129, 0.3)",
              color: isLight ? "#065f46" : "#34d399",
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Check size={14} className="text-emerald-500" />
              <span>{applySuccessMessage}</span>
            </div>
            <button
              onClick={() => setApplySuccessMessage(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* ── APPLY / CUSTOM SIMULATION ERROR NOTIFICATION ── */}
        {applyErrorMessage && (
          <div
            style={{
              padding: "7px 16px",
              background: isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.15)",
              borderBottom: "1px solid rgba(239, 68, 68, 0.3)",
              color: isLight ? "#991b1b" : "#f87171",
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AlertCircle size={14} className="text-red-500" />
              <span>{applyErrorMessage}</span>
            </div>
            <button
              onClick={() => setApplyErrorMessage(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* ── AUTHORING TOOLBAR (VISIBLE IN AUTHOR MODE) ── */}
        {studioMode === "author" && (
          <div
            style={{
              padding: "8px 18px",
              background: isLight ? "#f1f5f9" : "#13171e",
              borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid #21262d",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            {/* Quick Template Chips */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: isLight ? "#475569" : "#94a3b8", display: "flex", alignItems: "center", gap: 4 }}>
                <Sparkles size={13} className="text-indigo-400" />
                <span>Chèn mẫu test 4-Category:</span>
              </span>
              {Object.values(CATEGORY_METADATA).map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleInsertTemplate(cat.id)}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 5,
                    background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)",
                    border: `1px solid ${cat.color}60`,
                    color: isLight ? "#1e293b" : "#f1f5f9",
                    fontSize: 10.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    transition: "all 0.12s ease",
                  }}
                  title={`Chèn mẫu test hoàn chỉnh cho ${cat.name}`}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = cat.color;
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isLight ? "#ffffff" : "rgba(255, 255, 255, 0.05)";
                    e.currentTarget.style.color = isLight ? "#1e293b" : "#f1f5f9";
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: cat.color }} />
                  <span>{cat.shortName}</span>
                </button>
              ))}
            </div>

            {/* Authoring Actions: Simulate & Apply */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={handleResetCode}
                style={{
                  padding: "5px 10px",
                  borderRadius: 6,
                  background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.06)",
                  border: isLight ? "1px solid #cbd5e1" : "1px solid #30363d",
                  color: isLight ? "#475569" : "#94a3b8",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
                title="Khôi phục lại mã test ban đầu"
              >
                <RotateCcw size={12} />
                <span>Khôi phục gốc</span>
              </button>

              <button
                onClick={handleSimulateCustom}
                disabled={isSimulatingCustom}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: isSimulatingCustom ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: isSimulatingCustom ? 0.7 : 1,
                  boxShadow: "0 2px 6px rgba(99, 102, 241, 0.35)",
                }}
                title="Chạy mô phỏng từng bước AST đối với mã test vừa viết trên project code trong RAM"
              >
                {isSimulatingCustom ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Zap size={13} fill="#ffffff" />
                )}
                <span>⚡ Chạy mô phỏng test vừa viết</span>
              </button>

              <button
                onClick={handleApplyToProject}
                disabled={isApplying}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: isApplying ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: isApplying ? 0.7 : 1,
                  boxShadow: "0 2px 6px rgba(16, 185, 129, 0.35)",
                }}
                title="Lưu mã test này vào tệp test thực tế của dự án trên ổ đĩa và kích hoạt cập nhật độ phủ"
              >
                {isApplying ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Save size={13} />
                )}
                <span>💾 Lưu vào tệp test dự án</span>
              </button>
            </div>
          </div>
        )}

        {/* ── MODAL BODY: RESPONSIVE SPLIT-PANE (60% CODE / 40% INSPECTORS) ── */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          {/* LEFT PANE: MONACO CODE VIEWER (60%) */}
          <div
            style={{
              flex: 6,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              background: isLight ? "#ffffff" : "#0d1117",
            }}
          >
            {/* Code Header Bar with current file indicator & Active Line Indicator */}
            <div
              style={{
                padding: "6px 14px",
                borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid #21262d",
                background: isLight ? "#f8fafc" : "#161b22",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 11.5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, color: isLight ? "#0f172a" : "#f1f5f9", fontFamily: "var(--font-mono)" }}>
                  {activeCodeView === "test"
                    ? (selectedTestFile || "test.js")
                    : (selectedSourceFile || "source.js")}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: activeCodeView === "test"
                      ? (isLight ? "rgba(99, 102, 241, 0.15)" : "rgba(99, 102, 241, 0.25)")
                      : (isLight ? "rgba(16, 185, 129, 0.15)" : "rgba(16, 185, 129, 0.25)"),
                    color: activeCodeView === "test" ? "#4f46e5" : "#059669",
                  }}
                >
                  {activeCodeView === "test" ? "Test Suite" : "Source"}
                </span>

                {studioMode === "author" && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 3,
                      background: isLight ? "rgba(16, 185, 129, 0.15)" : "rgba(16, 185, 129, 0.25)",
                      color: "#10b981",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Edit3 size={10} />
                    <span>Editable Test Code</span>
                  </span>
                )}
              </div>

              {/* Active execution pointer indicator OR Author Mode guidance */}
              {studioMode === "author" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: isLight ? "#059669" : "#34d399", fontWeight: 600 }}>
                    ✏️ Soạn thảo mã test trong khung Monaco · Nhấp "Chạy mô phỏng" để kiểm tra tức thì
                  </span>
                </div>
              ) : currentStep && currentStep.line ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: currentStep.phase === "BRANCH_DECISION"
                        ? (currentStep.branchEvaluation?.branchTaken === "TRUE" ? "#10b981" : "#f59e0b")
                        : "#6366f1",
                    }}
                  />
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: isLight ? "#475569" : "#94a3b8" }}>
                    Line {currentStep.line}
                    {currentStep.branchEvaluation ? ` [${currentStep.branchEvaluation.branchTaken}: ${currentStep.branchEvaluation.condition}]` : ""}
                  </span>
                </div>
              ) : null}
            </div>

            {/* Monaco Editor Container */}
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              {activeCodeView === "split" ? (
                /* SIDE-BY-SIDE SPLIT VIEW */
                <div style={{ display: "flex", height: "100%", width: "100%" }}>
                  {/* Left: Source Code */}
                  <div style={{ flex: 1, height: "100%", borderRight: isLight ? "1px solid #e2e8f0" : "1px solid #21262d" }}>
                    <MonacoEditor
                      height="100%"
                      language={getLanguage(selectedSourceFile)}
                      theme={isLight ? "vs" : "vs-dark"}
                      value={sourceCode}
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        automaticLayout: true,
                      }}
                      onMount={handleSourceEditorMount}
                    />
                  </div>

                  {/* Right: Test Code */}
                  <div style={{ flex: 1, height: "100%" }}>
                    <MonacoEditor
                      height="100%"
                      language={getLanguage(selectedTestFile || "test.js")}
                      theme={isLight ? "vs" : "vs-dark"}
                      value={studioMode === "author" ? (customTestCode !== undefined ? customTestCode : testCode) : testCode}
                      onChange={studioMode === "author" ? (val) => actions.setCustomTestCode(val || "") : undefined}
                      options={{
                        readOnly: studioMode !== "author",
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        automaticLayout: true,
                      }}
                      onMount={handleTestEditorMount}
                    />
                  </div>
                </div>
              ) : activeCodeView === "test" ? (
                /* SINGLE TEST CODE VIEW */
                <MonacoEditor
                  height="100%"
                  language={getLanguage(selectedTestFile || "test.js")}
                  theme={isLight ? "vs" : "vs-dark"}
                  value={studioMode === "author" ? (customTestCode !== undefined ? customTestCode : testCode) : testCode}
                  onChange={studioMode === "author" ? (val) => actions.setCustomTestCode(val || "") : undefined}
                  options={{
                    readOnly: studioMode !== "author",
                    minimap: { enabled: true },
                    fontSize: 12.5,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    automaticLayout: true,
                  }}
                  onMount={handleTestEditorMount}
                />
              ) : (
                /* SINGLE SOURCE CODE VIEW */
                <MonacoEditor
                  height="100%"
                  language={getLanguage(selectedSourceFile)}
                  theme={isLight ? "vs" : "vs-dark"}
                  value={sourceCode}
                  options={{
                    readOnly: true,
                    minimap: { enabled: true },
                    fontSize: 12.5,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    automaticLayout: true,
                  }}
                  onMount={handleSourceEditorMount}
                />
              )}
            </div>
          </div>

          {/* RIGHT PANE: CONTEXT INSPECTOR TABS (40%) */}
          <div style={{ flex: 4, minWidth: 340, height: "100%" }}>
            <SimulationInspectorTabs
              step={currentStep}
              category={selectedCategory}
              summary={summary}
              initialMocks={simulationTrace?.initialMocks || []}
              isLight={isLight}
            />
          </div>
        </div>

        {/* ── BOTTOM BAR: PLAYBACK CONTROLS OR AUTHORING STATUS ── */}
        {studioMode === "playback" ? (
          <SimulationPlaybackBar
            steps={steps}
            currentStepIndex={currentStepIndex}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            onPlay={actions.play}
            onPause={actions.pause}
            onStepForward={actions.stepForward}
            onStepBackward={actions.stepBackward}
            onReset={actions.reset}
            onJumpToEnd={actions.jumpToEnd}
            onJumpToStep={actions.jumpToStep}
            onSetSpeed={actions.setPlaybackSpeed}
            isLight={isLight}
          />
        ) : (
          <div
            style={{
              padding: "10px 20px",
              borderTop: isLight ? "1px solid #e2e8f0" : "1px solid #21262d",
              background: isLight ? "#f8fafc" : "#161b22",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#10b981",
                  boxShadow: "0 0 8px rgba(16, 185, 129, 0.6)",
                }}
              />
              <span style={{ fontSize: 12, color: isLight ? "#334155" : "#e2e8f0", fontWeight: 600 }}>
                Chế độ Tự Viết & Thử Nghiệm: Bạn đang chỉnh sửa mã unit test trực tiếp. Bấm{" "}
                <strong style={{ color: "#6366f1" }}>"⚡ Chạy mô phỏng test vừa viết"</strong> để xem luồng thực thi AST
                và kiểm tra assertions trên mã nguồn thực tế trong RAM.
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setStudioMode("playback")}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.08)",
                  border: isLight ? "1px solid #cbd5e1" : "1px solid #30363d",
                  color: isLight ? "#475569" : "#cbd5e1",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Play size={12} fill="currentColor" />
                <span>Xem mô phỏng hiện tại</span>
              </button>

              <button
                onClick={handleSimulateCustom}
                disabled={isSimulatingCustom}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: isSimulatingCustom ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  boxShadow: "0 2px 8px rgba(99, 102, 241, 0.4)",
                }}
              >
                {isSimulatingCustom ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} fill="#ffffff" />}
                <span>⚡ Chạy mô phỏng test vừa viết</span>
              </button>

              <button
                onClick={handleApplyToProject}
                disabled={isApplying}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                  border: "none",
                  color: "#ffffff",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: isApplying ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  boxShadow: "0 2px 8px rgba(16, 185, 129, 0.4)",
                }}
              >
                {isApplying ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                <span>💾 Lưu vào tệp test dự án</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );

    if (isEmbedded && !isFullscreen) {
      return (
        <div style={{ width: "100%", position: "relative" }}>
          {decorationsStyle}
          {containerContent}
        </div>
      );
    }

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(0, 0, 0, 0.8)",
          backdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: isFullscreen ? 0 : 16,
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose?.();
        }}
      >
        {decorationsStyle}
        {containerContent}
      </div>
    );
  }
