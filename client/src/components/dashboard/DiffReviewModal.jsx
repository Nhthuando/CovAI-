import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileDiff,
  Check,
  RotateCcw,
  Sparkles,
  X,
  Columns,
  Rows,
  ChevronLeft,
  ChevronRight,
  TestTube2,
  FileCode2,
  Play,
  Loader2,
} from "lucide-react";
import { DiffEditor } from "@monaco-editor/react";

/* ── Helper to resolve file icon ── */
function getFileIcon(fileName = "") {
  const lower = fileName.toLowerCase();
  if (lower.includes(".test.") || lower.includes(".spec.")) {
    return <TestTube2 size={13} className="text-purple-400 flex-shrink-0" />;
  }
  return <FileCode2 size={13} className="text-cyan-400 flex-shrink-0" />;
}

export default function DiffReviewModal({
  isOpen,
  onClose,
  files = [],
  initialFileIndex = 0,
  onApplyFile,
  onUndoFile,
  onApplyAll,
  onRunAnalysis,
  isApplying = false,
}) {
  const [activeIdx, setActiveIdx] = useState(initialFileIndex);
  const [sideBySide, setSideBySide] = useState(true);

  // Sync initialFileIndex when it changes
  React.useEffect(() => {
    if (initialFileIndex >= 0 && initialFileIndex < files.length) {
      setActiveIdx(initialFileIndex);
    }
  }, [initialFileIndex, files.length]);

  const activeFile = files[activeIdx] || files[0];

  // Framework switching if the file has multi-framework suggestions
  const [activeFw, setActiveFw] = useState(activeFile?.framework || "vitest");
  React.useEffect(() => {
    if (activeFile?.framework) {
      setActiveFw(activeFile.framework);
    }
  }, [activeFile]);

  // Current suggestion data based on active framework
  const currentSuggestion = useMemo(() => {
    if (!activeFile) return null;
    if (Array.isArray(activeFile.suggestions) && activeFile.suggestions.length > 0) {
      return (
        activeFile.suggestions.find((s) => s.framework === activeFw) ||
        activeFile.suggestions[0]
      );
    }
    return activeFile;
  }, [activeFile, activeFw]);

  if (!isOpen || !activeFile) return null;

  const originalCode = currentSuggestion?.originalContent || activeFile?.originalContent || "";
  const modifiedCode =
    currentSuggestion?.fullUpdatedContent ||
    currentSuggestion?.suggestedTestCode ||
    activeFile?.fullUpdatedContent ||
    activeFile?.suggestedTestCode ||
    "";

  const isApplied = currentSuggestion?.applied ?? activeFile?.applied;
  const anyUnapplied = files.some((f) => !f.applied);
  const anyApplied = files.some((f) => f.applied);

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
        style={{
          background: "rgba(0, 0, 0, 0.78)",
          backdropFilter: "blur(8px)",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="w-full max-w-6xl h-[88vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
          style={{
            background: "#0d1117",
            border: "1px solid rgba(168, 85, 247, 0.35)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.8), 0 0 32px rgba(124,58,237,0.18)",
          }}
        >
          {/* ── Top Header ── */}
          <div
            className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{
              background: "#161b22",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="flex items-center justify-center w-8 h-8 rounded-lg"
                style={{
                  background: "rgba(168, 85, 247, 0.15)",
                  border: "1px solid rgba(168, 85, 247, 0.35)",
                }}
              >
                <FileDiff size={17} className="text-purple-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white tracking-wide">
                    Review Code Changes
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold"
                    style={{
                      background: "rgba(34, 197, 94, 0.15)",
                      color: "#4ade80",
                      border: "1px solid rgba(34, 197, 94, 0.3)",
                    }}
                  >
                    +{activeFile.linesAdded || 0} lines
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono truncate max-w-md">
                  {currentSuggestion?.targetTestFile || activeFile.targetTestFile}
                </div>
              </div>
            </div>

            {/* Right Header Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Framework Switcher (if multi-framework) */}
              {Array.isArray(activeFile.suggestions) && activeFile.suggestions.length > 1 && (
                <div
                  className="flex items-center rounded-lg p-0.5"
                  style={{
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                  }}
                >
                  {activeFile.suggestions.map((s) => (
                    <button
                      key={s.framework}
                      onClick={() => setActiveFw(s.framework)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${activeFw === s.framework
                          ? s.framework === "vitest"
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            : "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                          : "text-slate-400 hover:text-white"
                        }`}
                    >
                      {s.framework === "vitest" ? "⚡ Vitest" : "🃏 Jest"}
                    </button>
                  ))}
                </div>
              )}

              {/* Side-by-Side vs Inline Diff Toggle */}
              <button
                type="button"
                onClick={() => setSideBySide(!sideBySide)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                }}
                title={sideBySide ? "Switch to Unified view" : "Switch to Split view"}
              >
                {sideBySide ? <Rows size={13} /> : <Columns size={13} />}
                <span>{sideBySide ? "Split Diff" : "Inline Diff"}</span>
              </button>

              {/* Apply / Undo Button for Current File */}
              {!isApplied ? (
                <button
                  type="button"
                  disabled={isApplying}
                  onClick={() => onApplyFile?.(activeFile, currentSuggestion)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all cursor-pointer"
                  style={{
                    background: "linear-gradient(135deg, #7c3aed, #9333ea)",
                    boxShadow: "0 0 14px rgba(124, 58, 237, 0.4)",
                  }}
                >
                  {isApplying ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  <span>Apply this file</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onUndoFile?.(activeFile, currentSuggestion)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                  style={{
                    background: "rgba(239, 68, 68, 0.15)",
                    color: "#f87171",
                    border: "1px solid rgba(239, 68, 68, 0.35)",
                  }}
                  title="Undo added test cases"
                >
                  <RotateCcw size={13} />
                  <span>Undo</span>
                </button>
              )}

              {/* Apply All Button */}
              {anyUnapplied && files.length > 1 && (
                <button
                  type="button"
                  disabled={isApplying}
                  onClick={() => onApplyAll?.()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                  style={{
                    background: "rgba(34, 197, 94, 0.18)",
                    color: "#86efac",
                    border: "1px solid rgba(34, 197, 94, 0.4)",
                  }}
                  title="Apply all test files"
                >
                  <Sparkles size={13} />
                  <span>Apply all {files.length} files</span>
                </button>
              )}

              {/* Run Analysis Button (if any applied) */}
              {anyApplied && onRunAnalysis && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRunAnalysis();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-200 transition-all cursor-pointer"
                  style={{
                    background: "rgba(147, 51, 234, 0.25)",
                    border: "1px solid rgba(168, 85, 247, 0.5)",
                  }}
                  title="Re-run tests to confirm coverage increase"
                >
                  <Play size={12} className="fill-purple-300" />
                  <span>Run Analysis Unit ↵</span>
                </button>
              )}

              {/* Close Button */}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
                style={{ background: "rgba(255, 255, 255, 0.05)" }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* ── File Tabs Bar (Horizontal IDE Style) ── */}
          {files.length > 1 && (
            <div
              className="flex items-center gap-1 px-3 py-1.5 overflow-x-auto custom-scrollbar flex-shrink-0"
              style={{
                background: "#090d13",
                borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
              }}
            >
              {files.map((file, idx) => {
                const isSelected = idx === activeIdx;
                return (
                  <button
                    key={file.targetTestFile || idx}
                    type="button"
                    onClick={() => setActiveIdx(idx)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex-shrink-0"
                    style={{
                      background: isSelected
                        ? "rgba(124, 58, 237, 0.2)"
                        : "transparent",
                      color: isSelected ? "#ffffff" : "#94a3b8",
                      border: isSelected
                        ? "1px solid rgba(124, 58, 237, 0.45)"
                        : "1px solid transparent",
                    }}
                  >
                    {getFileIcon(file.fileName)}
                    <span className="font-mono">{file.fileName}</span>
                    <span
                      className="text-[10px] font-mono px-1 py-0.2 rounded"
                      style={{
                        background: "rgba(34, 197, 94, 0.15)",
                        color: "#4ade80",
                      }}
                    >
                      +{file.linesAdded || 0}
                    </span>
                    {file.applied && (
                      <Check size={12} className="text-green-400" />
                    )}
                  </button>
                );
              })}

              {/* Prev / Next Shortcuts */}
              <div className="ml-auto flex items-center gap-1 text-slate-400 pl-2">
                <button
                  type="button"
                  disabled={activeIdx === 0}
                  onClick={() => setActiveIdx((prev) => Math.max(0, prev - 1))}
                  className="p-1 rounded hover:text-white disabled:opacity-30 cursor-pointer"
                  title="Previous file"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-[11px] font-mono">
                  {activeIdx + 1} / {files.length}
                </span>
                <button
                  type="button"
                  disabled={activeIdx === files.length - 1}
                  onClick={() => setActiveIdx((prev) => Math.min(files.length - 1, prev + 1))}
                  className="p-1 rounded hover:text-white disabled:opacity-30 cursor-pointer"
                  title="File sau"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* ── Monaco Diff Editor Body ── */}
          <div className="flex-1 min-h-0 relative">
            <DiffEditor
              height="100%"
              original={originalCode}
              modified={modifiedCode}
              language="javascript"
              theme="vs-dark"
              loading={
                <div className="flex items-center justify-center h-full text-slate-400 gap-2">
                  <Loader2 size={16} className="animate-spin text-purple-400" />
                  <span className="text-xs">Loading Diff Viewer...</span>
                </div>
              }
              options={{
                readOnly: true,
                renderSideBySide: sideBySide,
                scrollBeyondLastLine: false,
                minimap: { enabled: false },
                automaticLayout: true,
                lineNumbers: "on",
                wordWrap: "on",
                diffWordWrap: "on",
                renderIndicators: true,
                useInlineViewWhenSpaceIsLimited: true,
                fontSize: 12.5,
              }}
            />
          </div>

          {/* ── Footer Info & Explanation ── */}
          <div
            className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 text-xs"
            style={{
              background: "#161b22",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <div className="flex items-center gap-2 text-slate-300 truncate mr-4">
              <span className="text-purple-400 font-semibold flex-shrink-0">
                💡 Goal:
              </span>
              <span className="truncate">
                {currentSuggestion?.explanation || activeFile.explanation || "Add test cases for uncovered branches."}
              </span>
            </div>

            <div className="flex items-center gap-3 text-slate-400 flex-shrink-0 text-[11px] font-mono">
              <span>Red: Original code</span>
              <span>•</span>
              <span className="text-green-400 font-semibold">Green: Proposed additions</span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
