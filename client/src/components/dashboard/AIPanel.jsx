import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  ArrowUp,
  User,
  Bot,
  Copy,
  Check,
  Loader2,
  RotateCcw,
  Shield,
  FileCode,
  Wand2,
  Zap,
  ChevronDown,
  ChevronRight,
  TestTube2,
  Layers,
  Workflow,
  FileDiff,
  Eye,
  Play,
} from "lucide-react";

import {
  sendAiChatMessageApi,
  getAiSuggestionsApi,
  generateSkeletonApi,
  getFileContentApi,
  updateFileContentApi,
  createProjectFileApi,
} from "../../services/project.service";
import {
  suggestUnitTestcase,
  getIntegrationWorkspace,
} from "../../services/coverage.service";
import { getProjectJobsApi } from "../../services/job.service";
import { useToast } from "./ToastContext";
import DiffReviewModal from "./DiffReviewModal";

/* ── Clean and Normalize Path Utilities ─────────────────── */
export function cleanFilePath(pathStr = "") {
  if (!pathStr) return "";
  let clean = String(pathStr).replace(/\\/g, "/");
  clean = clean.replace(/^.*\/repo\//, "");
  clean = clean.replace(/^\/+/, "");
  return clean;
}

export function shortenDirPath(filePath = "") {
  const clean = cleanFilePath(filePath);
  const parts = clean.split("/");
  if (parts.length <= 1) return "";
  const dirParts = parts.slice(0, -1);
  return `.../${dirParts.join("/")}`;
}

export function getFileName(filePath = "") {
  const clean = cleanFilePath(filePath);
  return clean.split("/").pop() || clean;
}

function getIdeFileIcon(fileName = "") {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jsx") || lower.endsWith(".tsx")) {
    return (
      <span className="text-cyan-400 font-bold text-xs select-none flex items-center justify-center w-4 h-4">
        ⚛
      </span>
    );
  }
  if (lower.endsWith(".ts")) {
    return (
      <span
        className="text-[9px] font-bold px-1 py-0.2 rounded font-mono select-none"
        style={{ background: "rgba(56, 189, 248, 0.2)", color: "#38bdf8" }}
      >
        TS
      </span>
    );
  }
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
    return (
      <span
        className="text-[9px] font-bold px-1 py-0.2 rounded font-mono select-none"
        style={{ background: "rgba(251, 191, 36, 0.2)", color: "#fbbf24" }}
      >
        JS
      </span>
    );
  }
  return <TestTube2 size={13} className="text-purple-400 flex-shrink-0" />;
}

/* ── Initial conversation (English) ─────────────────────── */
const INITIAL_MESSAGES = [
  {
    id: 1,
    role: "assistant",
    content:
      "Hello! I am **COV**, your AI testing assistant for TestCovAI.\n\nI can help you analyze code logic, discover edge cases, and automatically generate comprehensive test suites. How can I help you today?",
    timestamp: new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  },
];

/* ── Modern Code Block ──────────────────────────────────── */
function CodeBlock({ code, language = "javascript" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="relative my-3 rounded-xl overflow-hidden group/code select-text"
      style={{
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        boxShadow: "none",
      }}
    >
      {/* Code Header Bar */}
      <div
        className="flex items-center justify-between px-3.5 py-2"
        style={{
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <FileCode size={13} style={{ color: "var(--color-primary)" }} />
          <span
            style={{
              color: "var(--color-text-secondary)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              textTransform: "lowercase",
            }}
          >
            {language}
          </span>
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs cursor-pointer"
          style={{
            color: copied
              ? "var(--color-success)"
              : "var(--color-text-secondary)",
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            fontSize: 11,
            fontFamily: "var(--font-sans)",
            transition: "all 0.15s ease",
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </motion.button>
      </div>

      <pre
        className="overflow-x-auto p-3.5 m-0 text-xs"
        style={{
          fontFamily: "var(--font-mono)",
          lineHeight: 1.7,
          color: "var(--color-text)",
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* ── Test Suggestion Card (supports Jest & Vitest) ────────── */
function TestSuggestionCard({
  msg,
  onApplySuggestion,
  onUndoSuggestion,
  onApplyAllSuggestions,
  onRunAnalysis,
}) {
  const suggestions = msg.testSuggestions?.length
    ? msg.testSuggestions
    : msg.testSuggestion
      ? [msg.testSuggestion]
      : [];

  const [activeFw, setActiveFw] = useState(suggestions[0]?.framework || "jest");

  if (suggestions.length === 0) return null;

  const current =
    suggestions.find((s) => s.framework === activeFw) || suggestions[0];
  const isMulti = suggestions.length > 1;
  const allApplied = suggestions.every((s) => s.applied);
  const anyApplying = suggestions.some((s) => s.isApplying);

  return (
    <div
      className="mt-3 rounded-xl overflow-hidden"
      style={{
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      {/* Framework Tabs if multi-framework (Jest & Vitest) */}
      {isMulti && (
        <div
          className="flex items-center gap-1.5 px-3 py-2 flex-wrap"
          style={{
            background: "var(--color-bg)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span
            className="text-[11px] font-semibold mr-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Framework:
          </span>
          {suggestions.map((sug) => {
            const isSelected = activeFw === sug.framework;
            const isVitest = sug.framework === "vitest";
            return (
              <button
                key={sug.framework}
                type="button"
                onClick={() => setActiveFw(sug.framework)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all"
                style={{
                  background: isSelected
                    ? "var(--color-surface)"
                    : "transparent",
                  color: isSelected
                    ? "var(--color-primary)"
                    : "var(--color-text-secondary)",
                  border: isSelected
                    ? "1px solid var(--color-primary)"
                    : "1px solid transparent",
                }}
              >
                <span>{isVitest ? "Vitest" : "Jest"}</span>
                {sug.applied && <Check size={11} className="text-green-500" />}
              </button>
            );
          })}

          {/* Quick Apply All button if multiple */}
          {!allApplied && (
            <button
              type="button"
              disabled={anyApplying}
              onClick={() => onApplyAllSuggestions?.(msg.id, suggestions)}
              className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
              style={{
                background: "var(--color-surface)",
                color: "var(--color-success)",
                border: "1px solid var(--color-border)",
              }}
              title="Automatically apply test cases for both Jest and Vitest"
            >
              <Sparkles size={11} />
              <span>Apply all</span>
            </button>
          )}
        </div>
      )}

      {/* Target test file info bar */}
      <div
        className="flex items-center justify-between px-3 py-2 text-xs"
        style={{
          background: "var(--color-bg)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div className="flex items-center gap-1.5 overflow-hidden">
          <FileCode
            size={13}
            style={{
              color: "var(--color-primary)",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: "var(--color-primary)",
              fontWeight: 600,
            }}
          >
            {current.framework === "vitest" ? "VITEST" : "JEST"} Test:
          </span>
          <span
            className="truncate font-mono"
            style={{ color: "var(--color-text)", fontSize: 11 }}
          >
            {current.targetTestFile}
          </span>
        </div>
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{
            background: "var(--color-surface)",
            color: current.isExisting
              ? "var(--color-info)"
              : "var(--color-success)",
            border: "1px solid var(--color-border)",
          }}
        >
          {current.isExisting ? "Existing file" : "New file"}
        </span>
      </div>

      {/* Code block */}
      <CodeBlock code={current.suggestedTestCode} language="javascript" />

      {/* Actions footer */}
      <div
        className="p-3 flex items-center gap-2 flex-wrap"
        style={{
          background: "var(--color-surface)",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        {!current.applied ? (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={current.isApplying}
            onClick={() => onApplySuggestion?.(msg.id, current)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              background: "var(--color-primary)",
              color: "#ffffff",
              border: "none",
              cursor: current.isApplying ? "wait" : "pointer",
            }}
            title={`Write ${current.framework?.toUpperCase()} test cases to ${current.targetTestFile}`}
          >
            {current.isApplying ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Check size={13} />
            )}
            <span>Apply to {current.targetTestFile}</span>
          </motion.button>
        ) : (
          <>
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: "var(--color-surface)",
                color: "var(--color-success)",
                border: "1px solid var(--color-border)",
              }}
            >
              <Check size={13} />
              <span>Applied ({current.framework?.toUpperCase()})</span>
            </div>

            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={current.isUndoing}
              onClick={() => onUndoSuggestion?.(msg.id, current)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: "var(--color-surface)",
                color: "var(--color-text)",
                border: "1px solid var(--color-border)",
                cursor: current.isUndoing ? "wait" : "pointer",
              }}
              title="Revert test file to state before Apply"
            >
              {current.isUndoing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RotateCcw size={13} />
              )}
              <span>Undo</span>
            </motion.button>

            {onRunAnalysis && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onRunAnalysis}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ml-auto"
                style={{
                  background: "var(--color-surface)",
                  color: "var(--color-primary)",
                  border: "1px solid var(--color-border)",
                  cursor: "pointer",
                }}
                title="Re-run Unit Test Coverage to confirm coverage increase"
              >
                <span>Run Analysis ↵</span>
              </motion.button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── IDE-like Multi-File Changes Widget (like Cursor / Antigravity IDE) ── */
function IdeChangesWidget({
  ideChanges,
  onReviewFile,
  onReviewAll,
  onApplyFile,
  onUndoFile,
  onApplyAll,
  onRunAnalysis,
}) {
  const [expanded, setExpanded] = useState(true);

  if (!ideChanges || !Array.isArray(ideChanges.files) || ideChanges.files.length === 0) {
    return null;
  }

  const files = ideChanges.files;
  const totalFiles = files.length;
  const totalAdded =
    ideChanges.totalAdded ||
    files.reduce((sum, f) => sum + (f.linesAdded || 0), 0);
  const totalDeleted = ideChanges.totalDeleted || 0;
  const allApplied = files.every((f) => f.applied);
  const anyApplied = files.some((f) => f.applied);
  const anyApplying = files.some((f) => f.isApplying);

  return (
    <div
      className="mt-3.5 rounded-xl overflow-hidden shadow-xl select-text"
      style={{
        background: "#161b22",
        border: "1px solid rgba(255, 255, 255, 0.12)",
      }}
    >
      {/* ── IDE Widget Top Header (matches media_1790509595152.png) ── */}
      <div
        className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer select-none"
        style={{
          background: "rgba(255, 255, 255, 0.03)",
          borderBottom: expanded
            ? "1px solid rgba(255, 255, 255, 0.08)"
            : "none",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Left: File count & additions/deletions stats */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-xs flex items-center">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="text-xs font-semibold text-white">
            {totalFiles} file{totalFiles > 1 ? "s" : ""} changed
          </span>
          <div className="flex items-center gap-1 font-mono text-[11px] font-semibold">
            <span style={{ color: "#4ade80" }}>+{totalAdded}</span>
            <span style={{ color: "#f87171" }}>-{totalDeleted}</span>
          </div>
        </div>

        {/* Right: Review & Apply All Buttons */}
        <div
          className="flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Review Button */}
          <button
            type="button"
            onClick={onReviewAll}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-slate-200 hover:text-white transition-all cursor-pointer"
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
            }}
            title="Open Review & Diff for comprehensive comparison"
          >
            <FileDiff size={12} className="text-purple-400" />
            <span>Review</span>
          </button>

          {/* Quick Apply All Button */}
          {!allApplied ? (
            <button
              type="button"
              disabled={anyApplying}
              onClick={onApplyAll}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-white transition-all cursor-pointer"
              style={{
                background: "linear-gradient(135deg, #7c3aed, #9333ea)",
                boxShadow: "0 0 10px rgba(124, 58, 237, 0.35)",
              }}
              title="Apply all suggested test files"
            >
              {anyApplying ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              <span>Apply all</span>
            </button>
          ) : (
            <div
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold"
              style={{
                background: "rgba(34, 197, 94, 0.15)",
                color: "#4ade80",
                border: "1px solid rgba(34, 197, 94, 0.3)",
              }}
            >
              <Check size={12} />
              <span>All Applied</span>
            </div>
          )}
        </div>
      </div>

      {/* ── File List (Collapsible) ── */}
      {expanded && (
        <div className="divide-y divide-white/5">
          {files.map((file, idx) => {
            const isApplied = file.applied;
            const isApplying = file.isApplying;
            const isUndoing = file.isUndoing;
            const fileName = getFileName(file.targetTestFile);
            const dirPath = shortenDirPath(file.targetTestFile);

            return (
              <div
                key={file.targetTestFile || idx}
                className="flex items-center justify-between px-3.5 py-2 hover:bg-white/[0.02] transition-colors group text-xs"
              >
                {/* File info */}
                <div
                  className="flex items-center gap-2 min-w-0 cursor-pointer flex-1 mr-2"
                  onClick={() => onReviewFile?.(file, idx)}
                  title={`Click to review diff of ${file.targetTestFile}`}
                >
                  {getIdeFileIcon(fileName)}
                  <span className="font-semibold text-[#e6edf3] truncate hover:text-purple-300 transition-colors">
                    {fileName}
                  </span>
                  {dirPath && (
                    <span className="text-[11px] text-slate-500 font-mono truncate hidden sm:inline">
                      {dirPath}
                    </span>
                  )}
                  <span
                    className="text-[10px] font-mono px-1 py-0.2 rounded font-semibold ml-1 flex-shrink-0"
                    style={{
                      background: "rgba(34, 197, 94, 0.12)",
                      color: "#4ade80",
                    }}
                  >
                    +{file.linesAdded || 0}
                  </span>
                  {file.framework && (
                    <span
                      className="text-[9.5px] uppercase font-bold px-1.5 py-0.2 rounded flex-shrink-0"
                      style={{
                        background:
                          file.framework === "vitest"
                            ? "rgba(245, 158, 11, 0.15)"
                            : "rgba(124, 58, 237, 0.15)",
                        color:
                          file.framework === "vitest" ? "#fbbf24" : "#c084fc",
                        border:
                          file.framework === "vitest"
                            ? "1px solid rgba(245, 158, 11, 0.3)"
                            : "1px solid rgba(124, 58, 237, 0.3)",
                      }}
                    >
                      {file.framework}
                    </span>
                  )}
                </div>

                {/* File actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Review individual file */}
                  <button
                    type="button"
                    onClick={() => onReviewFile?.(file, idx)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                    title="View Diff details for this file"
                  >
                    <Eye size={12} />
                    <span className="hidden sm:inline">Review</span>
                  </button>

                  {/* Apply individual file */}
                  {!isApplied ? (
                    <button
                      type="button"
                      disabled={isApplying}
                      onClick={() => onApplyFile?.(file)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold text-white transition-all cursor-pointer"
                      style={{
                        background:
                          file.framework === "vitest" ? "#d97706" : "#7c3aed",
                      }}
                      title={`Apply testcases to ${file.targetTestFile}`}
                    >
                      {isApplying ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Check size={11} />
                      )}
                      <span>Apply</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium"
                        style={{
                          background: "rgba(34, 197, 94, 0.15)",
                          color: "#4ade80",
                        }}
                      >
                        <Check size={11} />
                        <span>Applied</span>
                      </span>
                      <button
                        type="button"
                        disabled={isUndoing}
                        onClick={() => onUndoFile?.(file)}
                        className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer"
                        title="Undo this file"
                      >
                        {isUndoing ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <RotateCcw size={11} />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Bottom Bar: Run Analysis button if any applied ── */}
      {anyApplied && onRunAnalysis && (
        <div
          className="flex items-center justify-between px-3.5 py-2.5 flex-wrap gap-2"
          style={{
            background: "rgba(124, 58, 237, 0.08)",
            borderTop: "1px solid rgba(124, 58, 237, 0.2)",
          }}
        >
          <div className="text-[11px] text-purple-300 font-medium">
            💡 Test files have been written to the project. Re-run analysis to verify coverage increase:
          </div>
          <button
            type="button"
            onClick={onRunAnalysis}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all ml-auto cursor-pointer"
            style={{
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              boxShadow: "0 0 12px rgba(124, 58, 237, 0.4)",
            }}
            title="Re-run Analysis"
          >
            <Play size={11} className="fill-white" />
            <span>Run Analysis ↵</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Markdown Formatter ──────────────────────────────────── */
function FormattedMessage({ content }) {
  if (!content) return null;

  // Split code blocks from regular markdown
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        text: content.slice(lastIndex, match.index),
      });
    }
    parts.push({
      type: "code",
      language: match[1] || "javascript",
      code: match[2].trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({
      type: "text",
      text: content.slice(lastIndex),
    });
  }

  const renderInline = (lineText) => {
    const tokens = lineText.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return tokens.map((token, idx) => {
      if (token.startsWith("**") && token.endsWith("**")) {
        return (
          <strong
            key={idx}
            style={{ color: "var(--color-text)", fontWeight: 600 }}
          >
            {token.slice(2, -2)}
          </strong>
        );
      }
      if (token.startsWith("`") && token.endsWith("`")) {
        return (
          <code
            key={idx}
            style={{
              fontFamily: "var(--font-mono)",
              background: "var(--color-bg)",
              color: "var(--color-primary)",
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: "0.9em",
              border: "1px solid var(--color-border)",
            }}
          >
            {token.slice(1, -1)}
          </code>
        );
      }
      return token;
    });
  };

  return (
    <div
      className="space-y-2 text-sm leading-relaxed select-text min-w-0"
      style={{
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        wordWrap: "break-word",
      }}
    >
      {parts.map((part, pIdx) => {
        if (part.type === "code") {
          return (
            <CodeBlock key={pIdx} code={part.code} language={part.language} />
          );
        }

        const lines = part.text.split("\n");
        return (
          <div key={pIdx} className="space-y-1.5">
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (!trimmed) {
                return <div key={lIdx} className="h-1" />;
              }

              if (trimmed.startsWith("### ")) {
                return (
                  <h4
                    key={lIdx}
                    className="font-semibold pt-1 text-sm flex items-center gap-1.5"
                    style={{ color: "var(--color-text)" }}
                  >
                    <span style={{ color: "var(--color-primary)" }}>#</span>
                    {renderInline(trimmed.slice(4))}
                  </h4>
                );
              }

              if (trimmed.startsWith("## ")) {
                return (
                  <h3
                    key={lIdx}
                    className="font-bold pt-2 text-base"
                    style={{ color: "var(--color-text)" }}
                  >
                    {renderInline(trimmed.slice(3))}
                  </h3>
                );
              }

              if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                return (
                  <div
                    key={lIdx}
                    className="flex items-start gap-2 pl-1"
                    style={{ color: "var(--color-text)" }}
                  >
                    <span
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: "50%",
                        background: "var(--color-primary)",
                        marginTop: 8,
                        flexShrink: 0,
                      }}
                    />
                    <span>{renderInline(trimmed.slice(2))}</span>
                  </div>
                );
              }

              const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
              if (numMatch) {
                return (
                  <div
                    key={lIdx}
                    className="flex items-start gap-2 pl-1"
                    style={{ color: "var(--color-text)" }}
                  >
                    <span
                      style={{
                        color: "var(--color-primary)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        fontWeight: 600,
                        marginTop: 2,
                        flexShrink: 0,
                      }}
                    >
                      {numMatch[1]}.
                    </span>
                    <span>{renderInline(numMatch[2])}</span>
                  </div>
                );
              }

              return (
                <p
                  key={lIdx}
                  className="m-0"
                  style={{
                    color: "var(--color-text)",
                    wordBreak: "break-word",
                    overflowWrap: "anywhere",
                    wordWrap: "break-word",
                  }}
                >
                  {renderInline(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ── Chat Message Component ──────────────────────────────── */
function ChatMessage({
  msg,
  onRetry,
  onApplySuggestion,
  onUndoSuggestion,
  onApplyAllSuggestions,
  onRunAnalysis,
  onOpenReviewModal,
  onApplyIdeFile,
  onUndoIdeFile,
  onApplyAllIdeChanges,
}) {
  const isUser = msg.role === "user";
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex flex-col w-full min-w-0"
      style={{
        alignItems: isUser ? "flex-end" : "flex-start",
      }}
    >
      {/* Header Info */}
      <div
        className="flex items-center gap-2 mb-1.5 px-1"
        style={{
          fontSize: 11,
          flexDirection: isUser ? "row-reverse" : "row",
        }}
      >
        <div
          className="flex items-center justify-center rounded-full flex-shrink-0"
          style={{
            width: 22,
            height: 22,
            background: isUser
              ? "rgba(109, 93, 251, 0.15)"
              : "var(--color-surface)",
            border: isUser
              ? "1px solid var(--color-primary)"
              : "1px solid var(--color-border)",
            boxShadow: "none",
          }}
        >
          {isUser ? (
            <User size={11} style={{ color: "var(--color-primary)" }} />
          ) : (
            <Bot size={11} style={{ color: "var(--color-primary)" }} />
          )}
        </div>

        <span
          style={{
            fontWeight: 600,
            color: isUser ? "var(--color-primary)" : "var(--color-text)",
            fontFamily: "var(--font-sans)",
            fontSize: 12,
          }}
        >
          {isUser ? "You" : "COV"}
        </span>

        {!isUser && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "1px 5px",
              borderRadius: 4,
              background: "rgba(109, 93, 251, 0.15)",
              color: "var(--color-primary)",
              letterSpacing: "0.04em",
            }}
          >
            AI
          </span>
        )}

        <span
          style={{
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
          }}
        >
          {msg.timestamp}
        </span>
      </div>

      {/* Message Bubble */}
      {msg.type === "quota" ? (
        <div
          className="relative rounded-xl overflow-hidden"
          style={{
            maxWidth: "100%",
            background: "rgba(239, 68, 68, 0.05)",
            border: "1px solid var(--color-danger)",
          }}
        >
          <div
            style={{
              height: 3,
              background: "var(--color-danger)",
            }}
          />
          <div style={{ padding: "16px 20px" }}>
            <h4
              style={{
                color: "var(--color-danger)",
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 16 }}>🛑</span> Daily Limit Reached
            </h4>
            <p
              style={{
                color: "var(--color-text)",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              You have exceeded the free chat limit today to ensure
              server quality.
            </p>
            <p
              style={{
                color: "var(--color-text-secondary)",
                fontSize: 12,
                marginTop: 10,
                fontStyle: "italic",
              }}
            >
              Please return tomorrow! Thank you for using the platform.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="relative group rounded-2xl min-w-0"
          style={{
            maxWidth: isUser ? "85%" : "100%",
            padding: isUser ? "10px 15px" : "14px 18px",
            background: isUser
              ? "rgba(109, 93, 251, 0.08)"
              : "var(--color-surface)",
            border: isUser
              ? "1px solid var(--color-primary)"
              : "1px solid var(--color-border)",
            borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
            boxShadow: "none",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
            wordWrap: "break-word",
          }}
        >
          <FormattedMessage content={msg.content} />

          {/* Options / Action chips generated by AI */}
          {msg.options && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {msg.options.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => opt.onClick && opt.onClick(opt.action)}
                  className="flex items-center gap-1.5 rounded-lg text-xs font-medium cursor-pointer"
                  style={{
                    padding: "7px 12px",
                    background: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-primary)",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--color-surface)";
                    e.currentTarget.style.borderColor = "var(--color-primary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--color-bg)";
                    e.currentTarget.style.borderColor = "var(--color-border)";
                  }}
                >
                  <Sparkles size={11} />
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {msg.code && <CodeBlock code={msg.code} />}

          {/* IDE Multi-File Changes Widget */}
          {msg.ideChanges && (
            <IdeChangesWidget
              ideChanges={msg.ideChanges}
              onReviewFile={(file, idx) =>
                onOpenReviewModal?.(msg.ideChanges.files, idx)
              }
              onReviewAll={() => onOpenReviewModal?.(msg.ideChanges.files, 0)}
              onApplyFile={onApplyIdeFile}
              onUndoFile={onUndoIdeFile}
              onApplyAll={() => onApplyAllIdeChanges?.(msg.ideChanges)}
              onRunAnalysis={onRunAnalysis}
            />
          )}

          {/* AI Unit Test Suggestion Card (supports Jest & Vitest fallback) */}
          {!msg.ideChanges &&
            (msg.testSuggestions?.length > 0 || msg.testSuggestion) && (
              <TestSuggestionCard
                msg={msg}
                onApplySuggestion={onApplySuggestion}
                onUndoSuggestion={onUndoSuggestion}
                onApplyAllSuggestions={onApplyAllSuggestions}
                onRunAnalysis={onRunAnalysis}
              />
            )}

          {/* Hover Actions (Copy / Retry) */}
          {!isUser && hovered && (
            <div
              className="absolute -bottom-3 right-3 flex items-center gap-1 px-1.5 py-0.5 rounded-md"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                boxShadow: "var(--shadow-sm)",
                zIndex: 10,
              }}
            >
              <button
                onClick={handleCopy}
                title="Copy message"
                style={{
                  background: "transparent",
                  border: "none",
                  color: copied
                    ? "var(--color-success)"
                    : "var(--color-text-secondary)",
                  cursor: "pointer",
                  padding: "3px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
              </button>
              {onRetry && (
                <button
                  onClick={onRetry}
                  title="Regenerate response"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--color-text-secondary)",
                    cursor: "pointer",
                    padding: "3px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <RotateCcw size={11} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

/* ── Typing Indicator ────────────────────────────────────── */
function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      className="flex flex-col items-start"
    >
      <div
        className="flex items-center gap-2 mb-1.5 px-1"
        style={{ fontSize: 11 }}
      >
        <div
          className="flex items-center justify-center rounded-full flex-shrink-0"
          style={{
            width: 22,
            height: 22,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <Bot size={11} style={{ color: "var(--color-primary)" }} />
        </div>
        <span
          style={{ fontWeight: 600, color: "var(--color-text)", fontSize: 12 }}
        >
          COV
        </span>
        <span style={{ color: "var(--color-text-secondary)", fontSize: 11 }}>
          thinking…
        </span>
      </div>

      <div
        className="flex items-center gap-1.5 px-4 py-3 rounded-2xl"
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "4px 16px 16px 16px",
        }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              delay: i * 0.2,
              ease: "easeInOut",
            }}
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--color-primary)",
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

/* ── AI Model Options ────────────────────────────────────── */
const AI_MODELS = [
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "Google",
    badge: "Default",
    badgeColor: "#a78bfa",
    desc: "Complex logic & test generation",
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    provider: "Google",
    badge: "Fast",
    badgeColor: "#38bdf8",
    desc: "Ultra-low latency reasoning",
  },
  {
    id: "claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    badge: "Pro",
    badgeColor: "#f472b6",
    desc: "Advanced refactoring & test design",
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    badge: "Smart",
    badgeColor: "#4ade80",
    desc: "High precision code synthesis",
  },
];

/* ── Modern Prompt Input (Compact & Dynamic Auto-Resize) ─── */
function ChatInput({ onSend, isTyping, selectedModel, setSelectedModel }) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const textareaRef = useRef(null);
  const menuRef = useRef(null);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (!input.trim()) {
      ta.style.height = "24px";
    } else {
      ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
    }
  }, [input]);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  // Click outside to close model dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setModelMenuOpen(false);
      }
    };
    if (modelMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modelMenuOpen]);

  const handleSend = () => {
    if (!input.trim() || isTyping) return;
    onSend(input.trim());
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "24px";
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = input.trim() && !isTyping;

  return (
    <div
      className="flex-shrink-0 relative"
      style={{ padding: "6px 14px 12px" }}
    >
      {/* ── AI Model Selector Dropdown ── */}
      <AnimatePresence>
        {modelMenuOpen && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            style={{
              position: "absolute",
              bottom: "calc(100% - 2px)",
              left: 14,
              width: 270,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              boxShadow: "var(--shadow-lg)",
              padding: "6px",
              zIndex: 50,
            }}
          >
            <div
              className="px-2.5 py-1.5 text-[10px] font-semibold tracking-wider uppercase flex items-center justify-between"
              style={{
                color: "var(--color-text-secondary)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span>Select AI Model</span>
              <span
                style={{
                  color: "var(--color-primary)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                COV Multi-LLM
              </span>
            </div>

            <div className="flex flex-col gap-1 mt-1">
              {AI_MODELS.map((model) => {
                const isSelected = selectedModel?.id === model.id;
                return (
                  <button
                    key={model.id}
                    onClick={() => {
                      setSelectedModel(model);
                      setModelMenuOpen(false);
                    }}
                    className="flex items-start gap-2.5 p-2 rounded-lg text-left transition-colors cursor-pointer"
                    style={{
                      background: isSelected
                        ? "rgba(109, 93, 251, 0.12)"
                        : "transparent",
                      border: isSelected
                        ? "1px solid var(--color-primary)"
                        : "1px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background = "var(--color-bg)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--color-text)",
                          }}
                        >
                          {model.name}
                        </span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: "0 5px",
                            borderRadius: 4,
                            background: `${model.badgeColor}20`,
                            color: model.badgeColor,
                            border: `1px solid ${model.badgeColor}40`,
                          }}
                        >
                          {model.badge}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: "var(--color-text-secondary)",
                          marginTop: 2,
                          lineHeight: 1.3,
                        }}
                      >
                        {model.desc}
                      </div>
                    </div>
                    {isSelected && (
                      <Check
                        size={14}
                        style={{ color: "var(--color-primary)" }}
                        className="flex-shrink-0 mt-0.5"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Input Box ── */}
      <div
        className="relative rounded-2xl transition-all duration-200"
        style={{
          background: "var(--color-surface)",
          border: focused
            ? "1.5px solid var(--color-primary)"
            : "1px solid var(--color-border)",
          boxShadow: focused ? "0 0 0 2px rgba(124, 58, 237, 0.2)" : "none",
          padding: "8px 12px 6px",
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Ask COV anything..."
          rows={1}
          className="w-full resize-none outline-none bg-transparent custom-scrollbar"
          style={{
            padding: "2px 4px 4px",
            fontFamily: "var(--font-sans)",
            color: "var(--color-text)",
            fontSize: 13,
            lineHeight: "20px",
            height: "24px",
            maxHeight: 160,
            caretColor: "var(--color-primary)",
          }}
        />

        {/* Toolbar row inside input box */}
        <div className="flex items-center justify-between pt-1">
          {/* Model Selector Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setModelMenuOpen(!modelMenuOpen)}
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer transition-all"
            style={{
              background: modelMenuOpen
                ? "var(--color-surface)"
                : "var(--color-bg)",
              border: modelMenuOpen
                ? "1px solid var(--color-primary)"
                : "1px solid var(--color-border)",
              fontSize: 11,
              color: "var(--color-text)",
            }}
            title="Switch AI Model"
          >
            <Sparkles
              size={11}
              style={{
                color: selectedModel?.badgeColor || "var(--color-primary)",
              }}
            />
            <span style={{ fontWeight: 500 }}>
              {selectedModel?.name || "Gemini 1.5 Pro"}
            </span>
            <ChevronDown
              size={12}
              style={{
                color: "var(--color-text-secondary)",
                transform: modelMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s ease",
              }}
            />
          </motion.button>

          {/* Send Button */}
          <motion.button
            whileHover={canSend ? { scale: 1.08 } : {}}
            whileTap={canSend ? { scale: 0.92 } : {}}
            onClick={handleSend}
            disabled={!canSend}
            className="flex items-center justify-center rounded-xl cursor-pointer"
            style={{
              width: 28,
              height: 28,
              background: canSend ? "var(--color-primary)" : "var(--color-bg)",
              color: canSend ? "#fff" : "var(--color-text-secondary)",
              border: canSend ? "none" : "1px solid var(--color-border)",
              boxShadow: "none",
              transition: "all 0.2s ease",
            }}
          >
            {isTyping ? (
              <Loader2 size={13} className="animate-spin text-purple-300" />
            ) : (
              <ArrowUp size={14} strokeWidth={2.5} />
            )}
          </motion.button>
        </div>
      </div>

      <div
        className="mt-1 text-center select-none"
        style={{
          color: "var(--color-text-muted)",
          fontSize: 10,
          fontFamily: "var(--font-sans)",
        }}
      >
        Press Enter ↵ to send · Shift+Enter for new line
      </div>
    </div>
  );
}

const isTestFile = (filePath) => {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return (
    /(^|\/)(tests?|__tests__|spec|cypress|e2e)\//i.test(normalized) ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(normalized)
  );
};

/* ── AI Agent Panel — Main Export ────────────────────────── */
export default function AIPanel({
  projectId,
  snapshotId,
  pendingAiSuggestion,
  onClearPendingSuggestion,
  onOpenFile,
  onRunAnalysis,
}) {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModel, setSelectedModel] = useState(AI_MODELS[0]);
  const [generateExpanded, setGenerateExpanded] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewFiles, setReviewFiles] = useState([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const bottomRef = useRef(null);
  const messageIdRef = useRef(10);
  const getNextId = () => ++messageIdRef.current;
  const { showToast } = useToast();

  const handleOpenReviewModal = (files, initialIndex = 0) => {
    setReviewFiles(files || []);
    setReviewIndex(initialIndex || 0);
    setReviewModalOpen(true);
  };

  useEffect(() => {
    if (!snapshotId) return;
    getIntegrationWorkspace(snapshotId)
      .then((res) => {
        setHasAnalysis(!!res?.data?.generation?.hasAnalysis);
      })
      .catch((err) =>
        console.error("Failed to check hasAnalysis for AIPanel:", err),
      );
  }, [snapshotId]);

  const handleNewChat = () => {
    setMessages(INITIAL_MESSAGES);
    showToast({
      type: "info",
      title: "New Session",
      message: "Chat history has been cleared.",
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSuggestForFile = async (filePath) => {
    if (!projectId) {
      showToast({
        type: "warning",
        title: "No Project",
        message: "Please select or create a project before using AI.",
      });
      return;
    }

    const isTest = isTestFile(filePath);

    const userMsg = {
      id: getNextId(),
      role: "user",
      content: isTest
        ? `✨ Please suggest additional test cases for test file \`${filePath}\``
        : `✨ Please suggest Jest & Vitest test cases for file \`${filePath}\``,
      timestamp: new Date().toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((m) => [...m, userMsg]);
    setIsTyping(true);

    try {
      const res = await suggestUnitTestcase(snapshotId, filePath, projectId);
      const data = res?.data;

      if (!data) {
        throw new Error("No test case suggestion data received from server.");
      }

      if (data.isFullyCovered) {
        const assistantMsg = {
          id: getNextId(),
          role: "assistant",
          timestamp: new Date().toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          content:
            `✅ **File \`${data.sourceFile || filePath}\` has reached 100% test coverage!**\n\n` +
            (data.targetTestFile ? `- **File test**: \`${data.targetTestFile}\` (${(data.framework || "jest").toUpperCase()})\n` : "") +
            `- **Coverage**: 100% Statements, 100% Branches, 100% Lines\n` +
            `- **Assertion errors**: 0 errors\n\n` +
            `💬 *Note: This file has passed 100% and reached maximum coverage. No additional testcases needed!*`,
        };
        setMessages((m) => [...m, assistantMsg]);
        return;
      }

      const suggestionsList =
        Array.isArray(data.suggestions) && data.suggestions.length > 0
          ? data.suggestions.map((s, idx) => ({
              ...s,
              id: s.framework || `sug-${idx}`,
              applied: false,
              previousContent: null,
              isApplying: false,
              isUndoing: false,
            }))
          : [
              {
                sourceFile: data.sourceFile,
                targetTestFile: data.targetTestFile,
                isExisting: data.isExisting,
                framework: data.framework || "jest",
                explanation: data.explanation,
                suggestedTestCode: data.suggestedTestCode,
                fullUpdatedContent: data.fullUpdatedContent,
                applied: false,
                previousContent: null,
                isApplying: false,
                isUndoing: false,
              },
            ];

      const hasMultiple = suggestionsList.length > 1;
      let summaryText = "";
      if (hasMultiple) {
        summaryText =
          `I analyzed file **\`${data.sourceFile || filePath}\`** and suggested tests for both **Jest** and **Vitest**:\n\n` +
          suggestionsList
            .map(
              (s) =>
                `- **${s.framework?.toUpperCase()}**: file \`${s.targetTestFile}\` (${s.isExisting ? "Existing file - will update" : "New file"})`,
            )
            .join("\n") +
          `\n- **Uncovered lines**: ${data.uncoveredLines?.length ? data.uncoveredLines.join(", ") : "100% lines covered"}\n` +
          `- **Assertion errors**: ${data.failedLines?.length ? data.failedLines.join(", ") : "0 errors"}\n\n` +
          `You can toggle between **JEST** and **VITEST** tabs below to review test code and click **Apply** to write to test files (or click **Apply both**)!`;
      } else {
        const single = suggestionsList[0];
        summaryText = isTest
          ? `I analyzed and suggested additional test cases for test file **\`${single.targetTestFile}\`** (${single.framework?.toUpperCase()}):\n\n` +
            (single.sourceFile && single.sourceFile !== single.targetTestFile
              ? `- **Corresponding source file**: \`${single.sourceFile}\`\n`
              : "") +
            `- **Uncovered lines in source**: ${data.uncoveredLines?.length ? data.uncoveredLines.join(", ") : "100% lines covered"}\n` +
            `- **Assertion errors**: ${data.failedLines?.length ? data.failedLines.join(", ") : "0 errors"}\n` +
            `- **Test file**: \`${single.targetTestFile}\` (${single.isExisting ? "Existing file - will update test cases" : "New file"})\n\n` +
            `${single.explanation}`
          : `I analyzed file **\`${single.sourceFile}\`** (${single.framework?.toUpperCase()}):\n\n` +
            `- **Uncovered lines**: ${data.uncoveredLines?.length ? data.uncoveredLines.join(", ") : "100% lines covered"}\n` +
            `- **Assertion errors**: ${data.failedLines?.length ? data.failedLines.join(", ") : "0 errors"}\n` +
            `- **Target test file**: \`${single.targetTestFile}\` (${single.isExisting ? "Existing file - will append" : "New file"})\n\n` +
            `${single.explanation}`;
      }

      const assistantMsg = {
        id: getNextId(),
        role: "assistant",
        timestamp: new Date().toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        content: summaryText,
        testSuggestions: suggestionsList,
        testSuggestion: suggestionsList[0],
      };

      setMessages((m) => [...m, assistantMsg]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: getNextId(),
          role: "assistant",
          type: "error",
          timestamp: new Date().toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          content: `❌ Error suggesting testcases for \`${filePath}\`: ${err.message || "Unable to connect to AI API."}`,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleApplyIdeFile = async (file, specificSuggestion = null) => {
    if (!projectId || !file) return;
    const target = specificSuggestion || file;
    const targetPath = target.targetTestFile || file.targetTestFile;

    // Set isApplying in messages
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.ideChanges) return m;
        const updated = m.ideChanges.files.map((f) =>
          f.targetTestFile === file.targetTestFile ? { ...f, isApplying: true } : f
        );
        return { ...m, ideChanges: { ...m.ideChanges, files: updated } };
      })
    );

    try {
      const contentToWrite =
        target.fullUpdatedContent || target.suggestedTestCode;

      if (file.isExisting) {
        await updateFileContentApi(projectId, targetPath, contentToWrite);
      } else {
        await createProjectFileApi(projectId, targetPath, contentToWrite);
      }

      setMessages((prev) =>
        prev.map((m) => {
          if (!m.ideChanges) return m;
          const updated = m.ideChanges.files.map((f) =>
            f.targetTestFile === file.targetTestFile
              ? { ...f, applied: true, isApplying: false }
              : f
          );
          return { ...m, ideChanges: { ...m.ideChanges, files: updated } };
        })
      );

      // Update modal state if open
      setReviewFiles((prev) =>
        prev.map((f) =>
          f.targetTestFile === file.targetTestFile ? { ...f, applied: true } : f
        )
      );

      showToast({
        type: "success",
        title: "Test Applied",
        message: `Applied testcases to ${targetPath}`,
      });
      // Do not redirect view away so user stays in current context
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.ideChanges) return m;
          const updated = m.ideChanges.files.map((f) =>
            f.targetTestFile === file.targetTestFile ? { ...f, isApplying: false } : f
          );
          return { ...m, ideChanges: { ...m.ideChanges, files: updated } };
        })
      );

      showToast({
        type: "error",
        title: "Apply Failed",
        message: err.message || "Unable to write test file.",
      });
    }
  };

  const handleUndoIdeFile = async (file) => {
    if (!projectId || !file) return;
    const targetPath = file.targetTestFile;
    const orig = file.originalContent ?? "";

    setMessages((prev) =>
      prev.map((m) => {
        if (!m.ideChanges) return m;
        const updated = m.ideChanges.files.map((f) =>
          f.targetTestFile === targetPath ? { ...f, isUndoing: true } : f
        );
        return { ...m, ideChanges: { ...m.ideChanges, files: updated } };
      })
    );

    try {
      await updateFileContentApi(projectId, targetPath, orig);

      setMessages((prev) =>
        prev.map((m) => {
          if (!m.ideChanges) return m;
          const updated = m.ideChanges.files.map((f) =>
            f.targetTestFile === targetPath
              ? { ...f, applied: false, isUndoing: false }
              : f
          );
          return { ...m, ideChanges: { ...m.ideChanges, files: updated } };
        })
      );

      setReviewFiles((prev) =>
        prev.map((f) =>
          f.targetTestFile === targetPath ? { ...f, applied: false } : f
        )
      );

      showToast({
        type: "info",
        title: "Reverted",
        message: `Reverted file ${targetPath}`,
      });
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.ideChanges) return m;
          const updated = m.ideChanges.files.map((f) =>
            f.targetTestFile === targetPath ? { ...f, isUndoing: false } : f
          );
          return { ...m, ideChanges: { ...m.ideChanges, files: updated } };
        })
      );

      showToast({
        type: "error",
        title: "Undo Failed",
        message: err.message || "Unable to revert file.",
      });
    }
  };

  const handleApplyAllIdeChanges = async (ideChanges) => {
    const list = ideChanges?.files || reviewFiles;
    if (!Array.isArray(list)) return;
    for (const f of list) {
      if (!f.applied) {
        await handleApplyIdeFile(f);
      }
    }
  };

  const handleSuggestBulk = async (arg1, arg2) => {
    if (!projectId) {
      showToast({
        type: "warning",
        title: "No Project",
        message: "Please select or create a project before using AI.",
      });
      return;
    }

    let options = {};
    if (typeof arg1 === "object" && !Array.isArray(arg1) && arg1 !== null) {
      options = arg1;
    } else {
      options = {
        uncoveredFiles: Array.isArray(arg1) ? arg1 : [],
        hasUncovered: arg2 !== false,
      };
    }

    const {
      allSuitesSummary,
      testSuites = [],
      uncoveredFiles = [],
      totalCount = allSuitesSummary?.total || testSuites.length || uncoveredFiles.length || 10,
    } = options;

    const passed100 =
      allSuitesSummary?.passed100Files ||
      allSuitesSummary?.passed100Suites ||
      [];
    const needImprovement =
      allSuitesSummary?.needImprovementFiles ||
      allSuitesSummary?.needImprovementSuites ||
      (Array.isArray(uncoveredFiles) && uncoveredFiles.length > 0
        ? uncoveredFiles.map((f) => ({
          filePath: f,
          fileName: f.split("/").pop(),
          reason: "Has not reached 100% coverage",
        }))
        : []);

    const testCountDisplay = options.totalTestSuitesCount || 20;

    // Send single user prompt message
    const userMsg = {
      id: getNextId(),
      role: "user",
      content: `✨ Analyze overall project coverage and suggest testcases (${totalCount} source files · ${testCountDisplay} test files)`,
      timestamp: new Date().toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    // Temporary loading status message (will be replaced once suggestions are generated)
    const loadingId = getNextId();
    const loadingMsg = {
      id: loadingId,
      role: "assistant",
      isLoading: true,
      content: `⚡ **Analyzing comprehensive coverage...**\n\nThe system is cross-referencing **Source File Coverage** against **${testCountDisplay} Jest & Vitest test files** to detect missing branches and generate testcase code...`,
      timestamp: new Date().toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((m) => [...m, userMsg, loadingMsg]);
    setIsTyping(true);

    try {
      const effectiveSnapshotId = options.snapshotId || snapshotId;
      const effectiveProjectId = options.projectId || projectId;
      const fileChanges = [];

      // 1. Filter out files that are already 100% or have 0 uncovered lines
      const candidateFiles = needImprovement.filter((item) => {
        const bPct = item.branchesPct ?? 100;
        const sPct = item.stmtsPct ?? 100;
        const lPct = item.linesPct ?? 100;
        const hasUncovered = item.uncoveredLines && item.uncoveredLines.length > 0;
        return bPct < 100 || sPct < 100 || lPct < 100 || hasUncovered;
      });

      // 2. Sort files so that lowest coverage files (branches/stmts) are prioritized first
      candidateFiles.sort((a, b) => {
        const aMin = Math.min(a.branchesPct ?? 100, a.stmtsPct ?? 100, a.linesPct ?? 100);
        const bMin = Math.min(b.branchesPct ?? 100, b.stmtsPct ?? 100, b.linesPct ?? 100);
        return aMin - bMin;
      });

      // 3. For fast response on large projects, cap bulk generation to top 10 most critical files
      const targetFiles = candidateFiles.slice(0, 10);
      let completedCount = 0;
      const totalTargets = targetFiles.length;

      const updateProgressUi = (recentFile) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingId
              ? {
                ...m,
                content: `⚡ **Analyzing comprehensive coverage... (${completedCount}/${totalTargets} files completed)**\n\n` +
                  (recentFile ? `↳ Just processed: \`${cleanFilePath(recentFile)}\`\n` : "") +
                  `The system is running concurrently to detect missing conditional branches and synthesize testcases...`,
                ideChanges: fileChanges.length > 0 ? {
                  totalFiles: fileChanges.length,
                  totalAdded: fileChanges.reduce((sum, f) => sum + (f.linesAdded || 0), 0),
                  totalDeleted: 0,
                  files: [...fileChanges],
                } : null,
              }
              : m
          )
        );
      };

      // 4. Concurrent worker pool with concurrency = 3
      const CONCURRENCY = 3;
      let currentIndex = 0;

      const worker = async () => {
        while (currentIndex < targetFiles.length) {
          const item = targetFiles[currentIndex++];
          try {
            const targetPath = item.filePath || item.sourceFile;
            const primaryFw = item.framework || item.matchingTests?.[0]?.framework || null;
            const res = await suggestUnitTestcase(
              effectiveSnapshotId,
              targetPath,
              effectiveProjectId,
              primaryFw
            );
            const data = res?.data || res;
            if (data && !data.isFullyCovered) {
              const suggestionsList =
                Array.isArray(data.suggestions) && data.suggestions.length > 0
                  ? data.suggestions
                  : [data];

              const primary = suggestionsList[0];
              const cleanSource = cleanFilePath(primary.sourceFile || targetPath);
              const cleanTargetTest = cleanFilePath(
                primary.targetTestFile || primary.filePath,
              );

              let originalContent = primary.existingContent || "";
              if (!originalContent && primary.isExisting) {
                try {
                  const prevRes = await getFileContentApi(
                    effectiveProjectId,
                    cleanTargetTest,
                  );
                  originalContent = prevRes?.data?.content || "";
                } catch (_) { }
              }

              const fullUpdatedContent =
                primary.fullUpdatedContent || primary.suggestedTestCode || "";
              const origLines = (originalContent || "").split("\n").length;
              const updatedLines = (fullUpdatedContent || "").split("\n").length;
              const linesAdded =
                Math.max(1, updatedLines - origLines) ||
                (primary.suggestedTestCode || "").split("\n").length;

              fileChanges.push({
                id: `fc-${item.filePath || item.sourceFile}`,
                sourceFile: cleanSource,
                targetTestFile: cleanTargetTest,
                fileName: getFileName(cleanTargetTest),
                framework: primary.framework || "vitest",
                isExisting: primary.isExisting ?? true,
                originalContent,
                fullUpdatedContent,
                suggestedTestCode: primary.suggestedTestCode || fullUpdatedContent,
                linesAdded,
                linesDeleted: 0,
                explanation:
                  primary.explanation ||
                  "Add test cases for uncovered branches.",
                uncoveredLines: data.uncoveredLines || [],
                failedLines: data.failedLines || [],
                suggestions: suggestionsList.map((s, sIdx) => ({
                  ...s,
                  id: s.framework || `sug-${sIdx}`,
                  sourceFile: cleanFilePath(s.sourceFile || cleanSource),
                  targetTestFile: cleanFilePath(s.targetTestFile || cleanTargetTest),
                  originalContent: s.existingContent || originalContent,
                  fullUpdatedContent: s.fullUpdatedContent || s.suggestedTestCode,
                  linesAdded,
                  applied: false,
                  isApplying: false,
                  isUndoing: false,
                })),
                applied: false,
                isApplying: false,
                isUndoing: false,
              });
            }
          } catch (itemErr) {
            console.warn(
              `[handleSuggestBulk] Error suggesting for ${item.filePath}:`,
              itemErr,
            );
          } finally {
            completedCount++;
            updateProgressUi(item.filePath || item.sourceFile);
          }
        }
      };

      if (targetFiles.length > 0) {
        const workers = Array.from(
          { length: Math.min(CONCURRENCY, targetFiles.length) },
          () => worker()
        );
        await Promise.all(workers);
      }

      const totalAdded = fileChanges.reduce(
        (sum, f) => sum + (f.linesAdded || 0),
        0,
      );
      const totalDeleted = 0;

      // 1. Overview Markdown content
      let overviewContent = `### 📊 Coverage Analysis Report (${totalCount} source files · ${testCountDisplay} Jest & Vitest test files)\n\n`;

      if (passed100.length > 0) {
        overviewContent += `#### ✅ Source files reaching 100% comprehensive coverage (${passed100.length}/${totalCount} files) — No further suggestions needed:\n`;
        overviewContent += passed100
          .map((s, idx) => {
            const testList = s.matchingTests?.length
              ? s.matchingTests
                .map(
                  (t) =>
                    `\`${cleanFilePath(t.filePath)}\` (${(t.framework || "test").toUpperCase()})`,
                )
                .join(", ")
              : s.primaryTestFile
                ? `\`${cleanFilePath(s.primaryTestFile)}\``
                : "Test suite present";
            return `${idx + 1}. \`${cleanFilePath(s.filePath)}\` (Lines: ${s.linesPct ?? 100}% · Branches: ${s.branchesPct ?? 100}% · Funcs: ${s.funcsPct ?? 100}% · Stmts: ${s.stmtsPct ?? 100}%)\n   ↳ Linked test file: ${testList} *(Reached 100% coverage - No suggestions needed)*`;
          })
          .join("\n");
        overviewContent += "\n\n";
      }

      if (fileChanges.length > 0) {
        overviewContent += `#### ⚡ Proposed Test Code Updates (${fileChanges.length} test files):\n`;
        overviewContent += `Complete testcases covering missing branches have been generated. You can click **Review** to inspect detailed code diffs before applying, or click **Apply all** to update all test files in the project.`;
      } else {
        overviewContent +=
          `🎉 **Excellent! All ${totalCount} source files and ${testCountDisplay} Jest & Vitest test files have reached 100% coverage!**\n\n` +
          `- All test cases executed successfully (0 assertion errors).\n` +
          `- Source code has reached 100% coverage (Statements, Branches, Lines, Functions).\n\n` +
          `💬 *Note: All files have reached 100% coverage so no further testcase suggestions are needed.*`;
      }

      const finalAssistantMsg = {
        id: loadingId,
        role: "assistant",
        isLoading: false,
        timestamp: new Date().toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        content: overviewContent,
        ideChanges:
          fileChanges.length > 0
            ? {
              totalFiles: fileChanges.length,
              totalAdded,
              totalDeleted,
              files: fileChanges,
            }
            : null,
      };

      setMessages((prev) =>
        prev.map((m) => (m.id === loadingId ? finalAssistantMsg : m)),
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? {
              id: loadingId,
              role: "assistant",
              type: "error",
              isLoading: false,
              timestamp: new Date().toLocaleTimeString("vi-VN", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              content: `❌ Error auto-generating testcases: ${err.message || "Unable to connect to AI API."}`,
            }
            : m,
        ),
      );
    } finally {
      setIsTyping(false);
    }
  };

  // Watch for external suggest trigger (e.g. from Coverage table or Editor)
  useEffect(() => {
    if (!pendingAiSuggestion) return;
    const { filePath, isBulk } = pendingAiSuggestion;
    onClearPendingSuggestion?.();
    if (isBulk) {
      handleSuggestBulk(pendingAiSuggestion);
    } else if (filePath) {
      handleSuggestForFile(filePath);
    }
  }, [pendingAiSuggestion]);

  const handleApplySuggestion = async (msgId, suggestion) => {
    if (!projectId || !suggestion) return;

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const updatedList = (m.testSuggestions || []).map((s) =>
          s.framework === suggestion.framework ? { ...s, isApplying: true } : s,
        );
        return {
          ...m,
          testSuggestions: updatedList,
          testSuggestion:
            m.testSuggestion?.framework === suggestion.framework
              ? { ...m.testSuggestion, isApplying: true }
              : m.testSuggestion,
        };
      }),
    );

    try {
      let previousContent = "";
      if (suggestion.isExisting) {
        try {
          const prevRes = await getFileContentApi(
            projectId,
            suggestion.targetTestFile,
          );
          previousContent = prevRes?.data?.content || "";
        } catch {
          previousContent = "";
        }
      }

      const contentToWrite =
        suggestion.fullUpdatedContent || suggestion.suggestedTestCode;

      if (suggestion.isExisting) {
        await updateFileContentApi(
          projectId,
          suggestion.targetTestFile,
          contentToWrite,
        );
      } else {
        await createProjectFileApi(
          projectId,
          suggestion.targetTestFile,
          contentToWrite,
        );
      }

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId) return m;
          const updatedList = (m.testSuggestions || []).map((s) =>
            s.framework === suggestion.framework
              ? { ...s, applied: true, previousContent, isApplying: false }
              : s,
          );
          return {
            ...m,
            testSuggestions: updatedList,
            testSuggestion:
              m.testSuggestion?.framework === suggestion.framework
                ? {
                    ...m.testSuggestion,
                    applied: true,
                    previousContent,
                    isApplying: false,
                  }
                : m.testSuggestion,
          };
        }),
      );

      showToast({
        type: "success",
        title: "Test Applied",
        message: `Applied ${suggestion.framework?.toUpperCase()} test case to ${suggestion.targetTestFile}`,
      });
      // Stays in current view without redirecting
    } catch (err) {
      showToast({
        type: "error",
        title: "Apply Failed",
        message: err.message || "Unable to apply test case to file.",
      });
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId) return m;
          const updatedList = (m.testSuggestions || []).map((s) =>
            s.framework === suggestion.framework
              ? { ...s, isApplying: false }
              : s,
          );
          return {
            ...m,
            testSuggestions: updatedList,
            testSuggestion:
              m.testSuggestion?.framework === suggestion.framework
                ? { ...m.testSuggestion, isApplying: false }
                : m.testSuggestion,
          };
        }),
      );
    }
  };

  const handleApplyAllSuggestions = async (msgId, suggestions) => {
    if (!projectId || !Array.isArray(suggestions)) return;
    for (const s of suggestions) {
      if (!s.applied) {
        await handleApplySuggestion(msgId, s);
      }
    }
  };

  const handleUndoSuggestion = async (msgId, suggestion) => {
    if (!projectId || !suggestion) return;

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const updatedList = (m.testSuggestions || []).map((s) =>
          s.framework === suggestion.framework ? { ...s, isUndoing: true } : s,
        );
        return {
          ...m,
          testSuggestions: updatedList,
          testSuggestion:
            m.testSuggestion?.framework === suggestion.framework
              ? { ...m.testSuggestion, isUndoing: true }
              : m.testSuggestion,
        };
      }),
    );

    try {
      const prevContent = suggestion.previousContent ?? "";
      await updateFileContentApi(
        projectId,
        suggestion.targetTestFile,
        prevContent,
      );

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId) return m;
          const updatedList = (m.testSuggestions || []).map((s) =>
            s.framework === suggestion.framework
              ? { ...s, applied: false, isUndoing: false }
              : s,
          );
          return {
            ...m,
            testSuggestions: updatedList,
            testSuggestion:
              m.testSuggestion?.framework === suggestion.framework
                ? { ...m.testSuggestion, applied: false, isUndoing: false }
                : m.testSuggestion,
          };
        }),
      );

      showToast({
        type: "info",
        title: "Undone",
        message: `Reverted file ${suggestion.targetTestFile} to previous state.`,
      });
      // Stays in current view without redirecting
    } catch (err) {
      showToast({
        type: "error",
        title: "Undo Failed",
        message: err.message || "Unable to revert test file.",
      });
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId) return m;
          const updatedList = (m.testSuggestions || []).map((s) =>
            s.framework === suggestion.framework
              ? { ...s, isUndoing: false }
              : s,
          );
          return {
            ...m,
            testSuggestions: updatedList,
            testSuggestion:
              m.testSuggestion?.framework === suggestion.framework
                ? { ...m.testSuggestion, isUndoing: false }
                : m.testSuggestion,
          };
        }),
      );
    }
  };

  const handleSend = async (text) => {
    if (!projectId) {
      showToast({
        type: "warning",
        title: "No Project",
        message: "Please select or create a project before using AI.",
      });
      return;
    }

    const userMsg = {
      id: getNextId(),
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    const currentHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    setMessages((m) => [...m, userMsg]);
    setIsTyping(true);

    try {
      const res = await sendAiChatMessageApi(
        projectId,
        text,
        currentHistory,
        selectedModel.id,
      );

      setMessages((m) => [
        ...m,
        {
          id: getNextId(),
          role: "assistant",
          timestamp: new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          content: res.data.reply,
        },
      ]);
    } catch (err) {
      console.error(err);
      const isQuotaError =
        err.message && err.message.includes("QUOTA_EXCEEDED");

      if (isQuotaError) {
        setMessages((m) => [
          ...m,
          {
            id: getNextId(),
            role: "assistant",
            timestamp: new Date().toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            content:
              "🛑 **Daily Limit Reached**\n\nYou have used all free chat requests for today. Please check back tomorrow or upgrade your plan in **Settings > Billing**.",
          },
        ]);
      } else {
        showToast({
          type: "error",
          title: "AI Error",
          message: "Failed to connect to AI Chat API, please try again.",
        });
        setMessages((m) => [
          ...m,
          {
            id: getNextId(),
            role: "assistant",
            timestamp: new Date().toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            content:
              "❌ **Connection Error**\n\nCould not connect to the backend API service. Please verify server status.",
          },
        ]);
      }
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <motion.div
      className="flex flex-col h-full flex-shrink-0"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      style={{
        background: "var(--color-surface)",
        borderLeft: "1px solid var(--color-border)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* ── Top Header ──────────────────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: 48,
          padding: "0 18px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center rounded-lg"
            style={{
              width: 26,
              height: 26,
              background: "var(--color-primary)",
              color: "#ffffff",
            }}
          >
            <Bot size={14} style={{ color: "#ffffff" }} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--color-text)",
                  fontFamily: "var(--font-sans)",
                  letterSpacing: "-0.01em",
                }}
              >
                COV
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "var(--color-surface)",
                  color: "var(--color-primary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                AI Agent
              </span>
            </div>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 mr-1">
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--color-success)",
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: "var(--color-success)",
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
              }}
            >
              READY
            </span>
          </div>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleNewChat}
            className="flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer"
            style={{
              color: "var(--color-text-secondary)",
              fontSize: 11,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            }}
            title="Start a new chat session"
          >
            <RotateCcw size={11} />
            <span>New</span>
          </motion.button>
        </div>
      </div>

      {/* ── Messages Feed ────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col custom-scrollbar min-w-0 w-full"
        style={{
          gap: 20,
          padding: "20px 18px",
          width: "100%",
          overflowX: "hidden",
        }}
      >
        {/* Welcome Cards when single message */}
        {messages.length === 1 && (
          <div className="mb-2">
            <div
              className="p-3.5 rounded-xl mb-3"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={14} style={{ color: "var(--color-primary)" }} />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                >
                  Quick Capabilities
                </span>
              </div>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--color-text-secondary)",
                  margin: 0,
                }}
              >
                Select an AI action below to analyze or generate tests for your
                project.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {/* 1. Find edge cases */}
              <motion.button
                whileHover={{ scale: 1.01, x: 2 }}
                whileTap={{ scale: 0.99 }}
                onClick={() =>
                  handleSend(
                    "Analyze the project source code and identify critical edge cases, boundary conditions, and potential runtime errors.",
                  )
                }
                className="flex items-center gap-2.5 p-2.5 rounded-xl text-left cursor-pointer transition-all"
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  opacity: hasAnalysis ? 1 : 0.5,
                  pointerEvents: hasAnalysis ? "auto" : "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--color-bg)";
                  e.currentTarget.style.borderColor = "var(--color-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--color-surface)";
                  e.currentTarget.style.borderColor = "var(--color-border)";
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: "rgba(56, 189, 248, 0.1)",
                    border: "1px solid rgba(56, 189, 248, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Shield size={13} style={{ color: "var(--color-primary)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--color-text)",
                    }}
                  >
                    Find edge cases
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-secondary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    Identify boundary conditions & potential failure points
                  </div>
                </div>
                <ChevronRight
                  size={13}
                  style={{ color: "var(--color-text-muted)" }}
                />
              </motion.button>

              {/* 2. Generate tests (Expandable into Unit, Integration, System) */}
              <div
                style={{
                  background: "var(--color-surface)",
                  border: generateExpanded
                    ? "1px solid var(--color-primary)"
                    : "1px solid var(--color-border)",
                  borderRadius: 12,
                  overflow: "hidden",
                  transition: "all 0.2s ease",
                  opacity: hasAnalysis ? 1 : 0.5,
                  pointerEvents: hasAnalysis ? "auto" : "none",
                }}
              >
                <div
                  onClick={() => setGenerateExpanded(!generateExpanded)}
                  className="flex items-center gap-2.5 p-2.5 cursor-pointer select-none"
                  style={{
                    transition: "background 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!generateExpanded) {
                      e.currentTarget.style.background = "var(--color-bg)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!generateExpanded) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      background: "rgba(52, 211, 153, 0.1)",
                      border: "1px solid rgba(52, 211, 153, 0.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Wand2
                      size={13}
                      style={{ color: "var(--color-success)" }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--color-text)",
                        }}
                      >
                        Generate tests
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "1px 5px",
                          borderRadius: 4,
                          background: "rgba(52, 211, 153, 0.15)",
                          color: "var(--color-success)",
                          border: "1px solid rgba(52, 211, 153, 0.3)",
                        }}
                      >
                        3 Levels
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-secondary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      Select test level: Unit, Integration, or System
                    </div>
                  </div>
                  <ChevronDown
                    size={14}
                    style={{
                      color: "var(--color-text-secondary)",
                      transform: generateExpanded
                        ? "rotate(180deg)"
                        : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                </div>

                {/* 3 Sub-items */}
                <AnimatePresence>
                  {generateExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      style={{
                        borderTop: "1px solid var(--color-border)",
                        background: "var(--color-bg)",
                        padding: "6px 8px 8px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {[
                        {
                          id: "unit",
                          title: "Unit Tests",
                          desc: "Test individual functions & component methods",
                          icon: TestTube2,
                          color: "var(--color-primary)",
                          prompt:
                            "Generate comprehensive unit tests for the core functions and classes in this project.",
                        },
                        {
                          id: "integration",
                          title: "Integration Tests",
                          desc: "Test API endpoints & module interactions",
                          icon: Layers,
                          color: "var(--color-info, #38bdf8)",
                          prompt:
                            "Generate integration tests verifying API endpoints and module interactions in this project.",
                        },
                        {
                          id: "system",
                          title: "System Tests",
                          desc: "End-to-end user workflows & scenarios",
                          icon: Workflow,
                          color: "var(--color-success)",
                          prompt:
                            "Generate end-to-end system tests verifying user workflows and full application behavior.",
                        },
                      ].map((sub) => {
                        const SubIcon = sub.icon;
                        return (
                          <motion.button
                            key={sub.id}
                            whileHover={{ scale: 1.01, x: 2 }}
                            whileTap={{ scale: 0.99 }}
                            onClick={() => handleSend(sub.prompt)}
                            className="flex items-center gap-2.5 p-2 rounded-lg text-left cursor-pointer transition-all"
                            style={{
                              background: "var(--color-surface)",
                              border: "1px solid var(--color-border)",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background =
                                "var(--color-bg)";
                              e.currentTarget.style.borderColor =
                                "var(--color-primary)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background =
                                "var(--color-surface)";
                              e.currentTarget.style.borderColor =
                                "var(--color-border)";
                            }}
                          >
                            <div
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 5,
                                background: "var(--color-bg)",
                                border: "1px solid var(--color-border)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <SubIcon size={12} style={{ color: sub.color }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: "var(--color-text)",
                                }}
                              >
                                {sub.title}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "var(--color-text-secondary)",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  lineHeight: 1.3,
                                }}
                              >
                                {sub.desc}
                              </div>
                            </div>
                            <ChevronRight
                              size={12}
                              style={{ color: "var(--color-text-muted)" }}
                            />
                          </motion.button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 3. Explain coverage gaps */}
              <motion.button
                whileHover={{ scale: 1.01, x: 2 }}
                whileTap={{ scale: 0.99 }}
                onClick={() =>
                  handleSend(
                    "Explain the code coverage gaps in this project and identify which logic branches need testing most.",
                  )
                }
                className="flex items-center gap-2.5 p-2.5 rounded-xl text-left cursor-pointer transition-all"
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  opacity: hasAnalysis ? 1 : 0.5,
                  pointerEvents: hasAnalysis ? "auto" : "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--color-bg)";
                  e.currentTarget.style.borderColor = "var(--color-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--color-surface)";
                  e.currentTarget.style.borderColor = "var(--color-border)";
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: "rgba(251, 191, 36, 0.1)",
                    border: "1px solid rgba(251, 191, 36, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Zap
                    size={13}
                    style={{ color: "var(--color-warning, #fbbf24)" }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--color-text)",
                    }}
                  >
                    Explain coverage gaps
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-secondary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    Analyze untested logic branches and risk areas
                  </div>
                </div>
                <ChevronRight
                  size={13}
                  style={{ color: "var(--color-text-muted)" }}
                />
              </motion.button>
            </div>
          </div>
        )}

        {/* Message Stream */}
        <AnimatePresence>
          {messages.map((msg, index) => (
            <ChatMessage
              key={msg.id}
              msg={msg}
              onApplySuggestion={handleApplySuggestion}
              onUndoSuggestion={handleUndoSuggestion}
              onApplyAllSuggestions={handleApplyAllSuggestions}
              onRunAnalysis={onRunAnalysis}
              onOpenReviewModal={(files, idx) =>
                handleOpenReviewModal(files, idx)
              }
              onApplyIdeFile={handleApplyIdeFile}
              onUndoIdeFile={handleUndoIdeFile}
              onApplyAllIdeChanges={handleApplyAllIdeChanges}
              onOpenFile={onOpenFile}
              onRetry={
                index === messages.length - 1 && msg.role === "assistant"
                  ? () => {
                      let userMsg = null;
                      for (let i = index - 1; i >= 0; i--) {
                        if (messages[i].role === "user") {
                          userMsg = messages[i];
                          break;
                        }
                      }
                      if (userMsg) {
                        handleSend(userMsg.content);
                      }
                    }
                  : null
              }
            />
          ))}
          {isTyping && <TypingIndicator key="typing" />}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* ── Modern Prompt Input ──────────────────────────── */}
      <ChatInput
        onSend={handleSend}
        isTyping={isTyping}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
      />

      {/* ── Monaco Code Review Diff Modal ────────────────── */}
      <DiffReviewModal
        isOpen={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        files={reviewFiles}
        initialFileIndex={reviewIndex}
        onApplyFile={handleApplyIdeFile}
        onUndoFile={handleUndoIdeFile}
        onApplyAll={() => handleApplyAllIdeChanges({ files: reviewFiles })}
        onRunAnalysis={onRunAnalysis}
      />
    </motion.div>
  );
}
