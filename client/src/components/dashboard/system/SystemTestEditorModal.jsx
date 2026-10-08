import { useState, useEffect } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import {
  X,
  Save,
  Play,
  Sparkles,
  Wrench,
  Check,
  AlertCircle,
  Loader2,
  FileCode2,
  GitCompare,
  Terminal,
} from "lucide-react";
import Button from "../../common/Button.jsx";
import {
  getSystemTestFileContent,
  updateSystemTestFileContent,
  runSingleSystemTest,
  optimizeSystemTest,
} from "../../../services/systemTest.service.js";

export default function SystemTestEditorModal({
  isOpen,
  onClose,
  snapshotId,
  filePath,
  scenarioId = null,
  initialMode = null,
  framework = "playwright",
  onSaved,
  onRunFinished,
}) {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [suggestedContent, setSuggestedContent] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [aiExplanation, setAiExplanation] = useState("");
  const [customInstruction, setCustomInstruction] = useState(
    initialMode === "FIX_BREAKPOINT" ? "Fix selector and locator timeouts" : ""
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [runningSingle, setRunningSingle] = useState(false);
  const [singleRunResult, setSingleRunResult] = useState(null);

  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Check current theme
  const isDarkMode =
    document.documentElement.getAttribute("data-theme") === "dark" ||
    !document.documentElement.hasAttribute("data-theme");

  useEffect(() => {
    if (!isOpen || !snapshotId || !filePath) return;

    let isMounted = true;
    const loadFile = async () => {
      setLoading(true);
      setError(null);
      setSuccessMessage(null);
      setSuggestedContent(null);
      setShowDiff(false);
      setSingleRunResult(null);

      try {
        const res = await getSystemTestFileContent(snapshotId, filePath);
        if (isMounted) {
          const testCode = res.data?.content || "";
          setContent(testCode);
          setOriginalContent(testCode);
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err.response?.data?.message ||
              err.message ||
              "Failed to read test file content."
          );
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadFile();

    return () => {
      isMounted = false;
    };
  }, [isOpen, snapshotId, filePath]);

  if (!isOpen || !filePath) return null;

  // Handle Save
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await updateSystemTestFileContent(
        snapshotId,
        filePath,
        content
      );
      setOriginalContent(content);
      setSuccessMessage("File saved successfully.");
      if (onSaved) onSaved(res.data);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to save test file. Syntax or security validation may have failed."
      );
    } finally {
      setSaving(false);
    }
  };

  // Handle AI Optimization (BOOST_COVERAGE or FIX_BREAKPOINT)
  const handleOptimize = async (mode) => {
    setOptimizing(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await optimizeSystemTest(snapshotId, {
        filePath,
        scenarioId: mode === "FIX_BREAKPOINT" ? scenarioId : null,
        mode,
        instruction: customInstruction.trim(),
      });

      const optCode = res.data?.code || res.data?.content || "";
      const explanation = res.data?.explanation || "Optimization complete.";

      setSuggestedContent(optCode);
      setAiExplanation(explanation);
      setShowDiff(true);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to optimize test file with AI."
      );
    } finally {
      setOptimizing(false);
    }
  };

  // Accept AI Suggestions
  const handleAcceptAI = () => {
    if (suggestedContent) {
      setContent(suggestedContent);
      setSuggestedContent(null);
      setShowDiff(false);
      setSuccessMessage("AI modifications applied to editor. Click Save to persist.");
    }
  };

  // Discard AI Suggestions
  const handleDiscardAI = () => {
    setSuggestedContent(null);
    setShowDiff(false);
    setAiExplanation("");
  };

  // Handle Fast Run Single Test
  const handleRunSingle = async () => {
    setRunningSingle(true);
    setSingleRunResult(null);
    setError(null);

    try {
      const res = await runSingleSystemTest(snapshotId, filePath, framework);
      setSingleRunResult(res.data);
      if (onRunFinished) onRunFinished(res.data);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to execute single test file."
      );
    } finally {
      setRunningSingle(false);
    }
  };

  const isDirty = content !== originalContent;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/75 backdrop-blur-xs font-sans">
      <div className="w-full max-w-6xl h-[92vh] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] shadow-2xl flex flex-col overflow-hidden">
        {/* Top Header Bar */}
        <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-secondary)]/60">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <FileCode2 size={18} className="text-[var(--color-primary)] shrink-0" />
            <div className="overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-[var(--color-text)] truncate">
                  {filePath}
                </span>
                {isDirty && (
                  <span className="text-[10px] font-medium px-1.5 py-0.2 rounded-[var(--radius-sm)] bg-[var(--color-warning)]/20 text-[var(--color-warning)]">
                    Unsaved
                  </span>
                )}
              </div>
              <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                Runner: {framework.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {suggestedContent && (
              <Button
                variant={showDiff ? "primary" : "secondary"}
                size="sm"
                icon={GitCompare}
                onClick={() => setShowDiff(!showDiff)}
                className="text-xs h-8"
              >
                {showDiff ? "Editor View" : "Compare Diff"}
              </Button>
            )}

            <Button
              variant="secondary"
              size="sm"
              icon={runningSingle ? Loader2 : Play}
              loading={runningSingle}
              disabled={loading || optimizing || runningSingle}
              onClick={handleRunSingle}
              className="text-xs h-8"
            >
              Run This Test
            </Button>

            <Button
              variant="primary"
              size="sm"
              icon={saving ? Loader2 : Save}
              loading={saving}
              disabled={loading || saving || !isDirty}
              onClick={handleSave}
              className="text-xs h-8 font-semibold"
            >
              Save File
            </Button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer ml-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* AI & Quick Action Toolbar */}
        <div className="px-5 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              AI Tools:
            </span>

            <Button
              variant="secondary"
              size="sm"
              icon={Sparkles}
              disabled={loading || optimizing || runningSingle}
              onClick={() => handleOptimize("BOOST_COVERAGE")}
              className="text-xs h-7 px-2.5"
            >
              AI Boost Coverage
            </Button>

            <Button
              variant="secondary"
              size="sm"
              icon={Wrench}
              disabled={loading || optimizing || runningSingle}
              onClick={() => handleOptimize("FIX_BREAKPOINT")}
              className="text-xs h-7 px-2.5"
            >
              AI Fix Breakpoint
            </Button>
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-md justify-end">
            <input
              type="text"
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder="Optional AI instruction (e.g. test invalid inputs)..."
              className="w-full bg-[var(--color-surface-secondary)] border border-[var(--color-border)] rounded-[var(--radius-sm)] px-2.5 py-1 text-xs text-[var(--color-text)] focus:outline-hidden focus:border-[var(--color-primary)]"
            />
          </div>
        </div>

        {/* Banners: Alerts / Explanations / Run Result */}
        <div className="px-5 pt-3 space-y-2">
          {error && (
            <div className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 text-[var(--color-danger)] text-xs flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/30 text-[var(--color-success)] text-xs flex items-center gap-2">
              <Check size={15} className="shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* AI Suggestion Banner */}
          {suggestedContent && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 flex items-start justify-between gap-3 text-xs">
              <div>
                <div className="font-semibold text-[var(--color-primary)] flex items-center gap-1.5 mb-0.5">
                  <Sparkles size={14} />
                  <span>AI Generated Improvements Ready</span>
                </div>
                <p className="text-[var(--color-text-secondary)] text-[11px] leading-relaxed m-0">
                  {aiExplanation}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAcceptAI}
                  className="h-7 text-xs"
                >
                  Apply AI Code
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDiscardAI}
                  className="h-7 text-xs text-[var(--color-text-muted)]"
                >
                  Discard
                </Button>
              </div>
            </div>
          )}

          {/* Single Run Result Banner */}
          {singleRunResult && (
            <div
              className={`p-2.5 rounded-[var(--radius-md)] border text-xs flex items-center justify-between ${
                singleRunResult.status === "COMPLETED" || singleRunResult.success
                  ? "bg-[var(--color-success)]/10 border-[var(--color-success)]/30 text-[var(--color-text)]"
                  : "bg-[var(--color-danger)]/10 border-[var(--color-danger)]/30 text-[var(--color-danger)]"
              }`}
            >
              <div className="flex items-center gap-2">
                <Terminal size={14} />
                <span className="font-semibold">Single Test Run:</span>
                <span>{singleRunResult.message || `Status: ${singleRunResult.status}`}</span>
                {singleRunResult.jobId && (
                  <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                    (Job: {singleRunResult.jobId})
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSingleRunResult(null)}
                className="text-xs hover:underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Editor Container */}
        <div className="flex-1 p-5 pt-3 overflow-hidden">
          <div className="h-full border border-[var(--color-border)] rounded-[var(--radius-md)] overflow-hidden">
            {loading ? (
              <div className="h-full flex items-center justify-center text-xs text-[var(--color-text-muted)] gap-2">
                <Loader2 size={16} className="animate-spin text-[var(--color-primary)]" />
                <span>Loading test file content...</span>
              </div>
            ) : showDiff && suggestedContent ? (
              <DiffEditor
                height="100%"
                language="javascript"
                original={content}
                modified={suggestedContent}
                theme={isDarkMode ? "vs-dark" : "light"}
                options={{
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', Consolas, monospace",
                  minimap: { enabled: false },
                  readOnly: false,
                  renderSideBySide: true,
                }}
              />
            ) : (
              <Editor
                height="100%"
                language="javascript"
                value={content}
                onChange={(val) => setContent(val || "")}
                theme={isDarkMode ? "vs-dark" : "light"}
                options={{
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', Consolas, monospace",
                  minimap: { enabled: false },
                  automaticLayout: true,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

