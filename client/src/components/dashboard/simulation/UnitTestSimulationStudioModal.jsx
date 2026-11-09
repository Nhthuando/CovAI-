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
import { buildPlaybackState } from "../../../services/unitTestPlayback.js";
import useUnitTestSimulation, { CATEGORY_METADATA } from "../../../hooks/useUnitTestSimulation.js";
import SimulationPlaybackBar from "./SimulationPlaybackBar.jsx";
import SimulationInspectorTabs from "./SimulationInspectorTabs.jsx";
import { applyUnitTestSuggestion } from "../../../services/coverage.service.js";
import { invalidateCoverageQueries } from "../../../hooks/useCoverageQuery.js";

const METRIC_LABELS = {statements:'Statements',branches:'Branches',functions:'Functions',lines:'Lines'};
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
  const [showDetails, setShowDetails] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const [splitRatio, setSplitRatio] = useState(50);
  const [editorGeneration, setEditorGeneration] = useState(0);
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
  const summary = simulationTrace?.mode === 'RECORDED' ? simulationTrace.summary : null;
  const playback = useMemo(() => buildPlaybackState(simulationTrace, currentStepIndex), [simulationTrace, currentStepIndex]);
  const casePlayback = useMemo(() => buildPlaybackState(simulationTrace, currentStepIndex, currentStep?.testId), [simulationTrace, currentStepIndex, currentStep?.testId]);
  const isRecorded = simulationTrace?.mode === 'RECORDED';

  // Authoring Handlers
  const handleApplyToProject = async () => {
    const targetFile = selectedSourceFile || initialSourceFile;
    const targetTest = selectedTestFile || initialTestFile;
    const codeToApply = customTestCode || testCode;
    if (!snapshotId || !targetFile || !codeToApply) {
      setApplyErrorMessage("A snapshot, source file and test code are required to apply this test.");
      return;
    }
    try {
      setIsApplying(true);
      setApplyErrorMessage(null);
      setApplySuccessMessage(null);
      const res = await applyUnitTestSuggestion(snapshotId, {
        suggestion: {
          sourceFile: targetFile,
          testFile: targetTest || simulationTrace?.testFilePath || undefined,
          suggestedTestCode: codeToApply,
          functionName: selectedFunctionName || undefined,
        },
        projectId,
      });
      const result = res?.data || res;
      if (result?.success === true) {
        setApplySuccessMessage("✓ The test was applied, verified and saved to the project test file.");
        invalidateCoverageQueries(snapshotId);
      } else {
        throw new Error(result?.status === 'WAITING_FOR_ENV' ? `${result.message} Required environment variables: ${(result.environment?.missingRequired || []).join(', ')}.` : result?.message || "Unable to apply this test to the project.");
      }
    } catch (err) {
      setApplyErrorMessage(err.message || "Failed to apply the test.");
    } finally {
      setIsApplying(false);
    }
  };

  const handleSimulateCustom = async () => {
    const codeToSim = customTestCode || testCode;
    if (!codeToSim || !codeToSim.trim()) {
      setApplyErrorMessage("Enter test code before starting the illustration.");
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
      setApplyErrorMessage(err.message || "Unable to illustrate this test.");
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
    setEditorGeneration(value => value + 1);
    monacoRef.current = monaco;
  };

  const handleTestEditorMount = (editor, monaco) => {
    testEditorRef.current = editor;
    setEditorGeneration(value => value + 1);
    monacoRef.current = monaco;
  };

  // Both editors consume the same event; accumulated hits are rebuilt on seek.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    const decorate = (editor, ref, lines, location) => {
      if (!editor || editor.getModel()?.isDisposed()) return;
      const maxLine = editor.getModel()?.getLineCount() || 0;
      const decorations = lines.filter(line => line > 0 && line <= maxLine).map(line => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: 'monaco-sim-covered-line', linesDecorationsClassName: 'monaco-sim-covered-glyph' },
      }));
      if (location?.line > 0 && location.line <= maxLine) {
        decorations.push({ range: new monaco.Range(location.line, 1, Math.min(location.endLine || location.line, maxLine), 1),
          options: { isWholeLine: true, className: 'monaco-sim-active-line', linesDecorationsClassName: 'monaco-sim-glyph-marker' } });
        if (autoFollow) editor.revealLineInCenterIfOutsideViewport(location.line);
      }
      ref.current = editor.deltaDecorations(ref.current, decorations);
    };
    decorate(sourceEditorRef.current, sourceDecorationsRef, playback.sourceLines, currentStep?.sourceLocation);
    decorate(testEditorRef.current, testDecorationsRef, playback.testLines, currentStep?.testLocation);
  }, [currentStep, playback, autoFollow, editorGeneration, activeCodeView]);

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
      .monaco-sim-covered-line { background: rgba(16,185,129,.13) !important; }
      .monaco-sim-covered-glyph { border-left: 3px solid #10b981; }
      .sim-code-pane { position: relative; min-width: 0; padding-top: 26px; }
      .sim-pane-title { position: absolute; top: 0; left: 0; right: 0; padding: 4px 12px; font-size: 11px; font-weight: 700; background: rgba(99,102,241,.1); }
      .sim-toolbar-button { padding: 5px 10px; font-size: 11px; font-weight: 600; border: 1px solid #94a3b855; border-radius: 5px; background: rgba(99,102,241,.08); color: inherit; cursor: pointer; }
      .sim-toolbar-button:disabled { opacity: .45; cursor: wait; }
      .sim-toolbar-button:hover:not(:disabled) { background: rgba(99,102,241,.18); }
      @media(max-width: 760px) {
        .sim-code-split { flex-direction: column; }
        .sim-code-pane { min-height: 220px; flex: 1 !important; }
        .sim-studio-container { height: auto !important; min-height: 0 !important; overflow: visible !important; }
        .sim-studio-container > div { flex-shrink: 0; }
        .sim-studio-body { flex: none !important; height: 520px; min-height: 520px !important; }
        .sim-studio-overlay { align-items: flex-start !important; overflow-y: auto; }
      }
      @media(prefers-reduced-motion: reduce) { .monaco-sim-active-line { transition: none; } }
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
      className="sim-studio-container"
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
                title="Replay mode: inspect execution steps, state and branch decisions"
              >
                <Play size={12} fill={studioMode === "playback" ? "#ffffff" : "currentColor"} />
                <span>Execution Replay</span>
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
                title="Test authoring mode: write tests, insert scenario templates and preview their logic"
              >
                <Edit3 size={12} />
                <span>Write Test Cases</span>
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
                title="Select a source file to inspect test execution"
              >
                {displaySources.length === 0 ? (
                  <option value="">(Loading source files...)</option>
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
                title="Select a target function in this source file"
              >
                {availableFunctions.length === 0 ? (
                  <option value="">(All logic / Main body)</option>
                ) : (
                  <>
                    <option value="">(All functions / Entire file)</option>
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
              Scenario:
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
                    title={`Illustrate scenario: ${cat.name}`}
                  >
                    {cat.shortName}
                  </button>
                );
              })}
            </div>

            {/* Outcome Badge */}
            {summary && isRecorded && simulationTrace?.completeness === 'COMPLETE' && (
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
              title="Data source: a recorded test run or an unverified AST illustration"
            >
              <ShieldCheck size={11} /> {isRecorded ? 'Runtime record' : 'Illustration • Unverified'}
            </span>
          </div>
        </div>

        <div style={{ padding: '9px 14px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', borderBottom: '1px solid #64748b40' }}>
          <strong style={{ fontSize: 12 }}>{isRecorded ? 'Recorded Test Replay' : 'Logic illustration — not verified by a test runner'}</strong>
          {isRecorded && <span style={{ fontSize: 11 }}>Run {simulationTrace.runId?.slice(0, 8)} · {simulationTrace.completeness === 'COMPLETE' ? 'Complete recording' : 'Incomplete recording'}</span>}
          <button className="sim-toolbar-button" type="button" onClick={() => actions.captureRuntimeTrace('test')} disabled={traceLoading || !simulationTrace?.testFilePath || simulationTrace?.isVirtualScenario}>
            {traceLoading ? 'Recording…' : 'Record This Test'}
          </button>
          <button className="sim-toolbar-button" type="button" onClick={() => actions.captureRuntimeTrace('suite')} disabled={traceLoading || !simulationTrace?.testFilePath || simulationTrace?.isVirtualScenario}>Record Entire Suite</button>
          <button className="sim-toolbar-button" type="button" onClick={() => setShowDetails(value => !value)} aria-expanded={showDetails}>{showDetails ? 'Hide Technical Details' : 'Show Technical Details'}</button>
          <label style={{fontSize: 11}}><input type="checkbox" checked={autoFollow} onChange={event => setAutoFollow(event.target.checked)} /> Follow execution</label>
          {activeCodeView === 'split' && <label style={{fontSize: 11}}>Test width <input aria-label="Test pane width" type="range" min="25" max="75" value={splitRatio} onChange={event => setSplitRatio(Number(event.target.value))} /></label>}
        </div>
        <div role="status" aria-live="polite" style={{padding:'8px 14px',fontSize:12,background:isLight?'#eff6ff':'#172033'}}>
          ▶ {currentStep?.description || 'Select a test to inspect its execution step by step.'}
          {currentStep?.testLocation && currentStep?.sourceLocation && <div style={{fontWeight:650,marginTop:4}}>Test line {currentStep.testLocation.line} → Source line {currentStep.sourceLocation.line}</div>}
          {isRecorded && currentStep?.testId && <div>Test case: {currentStep.testId === '<suite setup>' ? 'Suite setup' : currentStep.testId}</div>}
          <div style={{fontSize:11,marginTop:5}}>▶ Current step · ✓ Visited · Unvisited branches retain their background. Replay progress is separate from code coverage.</div>
          {playback.coverage ? <div style={{marginTop:6}}>Cumulative recording coverage: {Object.entries(playback.coverage).map(([name,metric]) => <span key={name} style={{marginRight:16}}>{METRIC_LABELS[name] || name}: {metric.covered}/{metric.total} ({metric.pct == null ? 'N/A' : metric.pct.toFixed(1)+'%'})</span>)}{simulationTrace.scope === 'suite' && <div>Current test coverage: {Object.entries(casePlayback.coverage).map(([name,metric]) => <span key={name} style={{marginRight:16}}>{METRIC_LABELS[name] || name}: {metric.covered}/{metric.total}</span>)}</div>}</div> : <div style={{marginTop:6}}>Coverage: {isRecorded ? 'The recording is incomplete' : 'Not measured in illustration mode'}</div>}
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
                <span>Insert scenario template:</span>
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
                  title={`Insert a complete test template for ${cat.name}`}
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
                title="Restore the original test code"
              >
                <RotateCcw size={12} />
                <span>Restore Original</span>
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
                title="Preview the authored test using an unverified AST illustration"
              >
                {isSimulatingCustom ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Zap size={13} fill="#ffffff" />
                )}
                <span>⚡ Preview Test Logic</span>
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
                title="Apply this test to the project, verify the batch and refresh coverage"
              >
                {isApplying ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Save size={13} />
                )}
                <span>💾 Apply to Project</span>
              </button>
            </div>
          </div>
        )}

        {/* ── MODAL BODY: RESPONSIVE SPLIT-PANE (60% CODE / 40% INSPECTORS) ── */}
        <div className="sim-studio-body" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
          {/* LEFT PANE: MONACO CODE VIEWER (60%) */}
          <div
            style={{
              flex: 1,
              minHeight: 300,
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
                    ✏️ Edit the test in Monaco · Select Preview Test Logic to inspect its behavior
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
                <div className="sim-code-split" style={{ display: "flex", height: "100%", width: "100%" }}>
                  {/* Left: Source Code */}
                  <div className="sim-code-pane" style={{ order: 1, flex: 100 - splitRatio, height: "100%" }}>
                    <div className="sim-pane-title">CODE · {simulationTrace?.sourceFilePath || selectedSourceFile}</div>
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
                  <div className="sim-code-pane" style={{ order: 0, flex: splitRatio, height: "100%", borderRight: "1px solid #64748b40" }}>
                    <div className="sim-pane-title">TEST · {simulationTrace?.testFilePath || selectedTestFile}</div>
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
          <div style={{ display: showDetails ? "block" : "none", maxHeight: 300, overflow: "auto" }}>
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
                Test authoring mode: you are editing unit test code. Select{" "}
                <strong style={{ color: "#6366f1" }}>"⚡ Preview Test Logic"</strong> to inspect the AST execution illustration
                and review assertions. Run the actual test to verify its result.
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
                <span>View Current Replay</span>
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
                <span>⚡ Preview Test Logic</span>
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
                <span>💾 Apply to Project</span>
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
        className="sim-studio-overlay"
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
