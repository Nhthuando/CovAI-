import { chatGreeting, chatScreenLabel, normalizeChatScreenContext, detectChatLanguage } from '../../services/chatScreenContext';
import { AI_MODELS } from "../../shared/aiModels.js";
import { getSelectedAIModel } from "../../services/aiModel.service.js";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  ArrowUp,
  User,
  Copy,
  Check,
  Loader2,
  RotateCcw,
  Undo2,
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
  Paperclip,
  Image as ImageIcon,
  X,
  FileText,
  AtSign,
  Plus,
  History,
  MessageSquare,
  Trash2,
  Edit2,
  Search,
  AlertCircle,
} from "lucide-react";
import CovaiLogo from "../common/CovaiLogo";
import "./portfolio/portfolio.css";

import {
  sendAiChatMessageApi,
  getFileContentApi,
  updateFileContentApi,
  createProjectFileApi,
  deleteProjectEntryApi,
  getProjectTreeApi,
  getChatSessionsApi,
  getChatSessionMessagesApi,
  updateChatSessionApi,
  deleteChatSessionApi,
} from "../../services/project.service";
import {
  suggestUnitTestcase,
  getIntegrationWorkspace,
  applyUnitTestSuggestion,
} from "../../services/coverage.service";
import { mutateIntegrationScenarioApi } from "../../services/integrationScenario.service";
import { getProjectJobsApi } from "../../services/job.service";
import { useToast } from "./ToastContext";
import DiffReviewModal, { countDiffLines } from "./DiffReviewModal";
import AIContextDialog from "./AIContextDialog";
import { branchAiConversation, getAiContext } from "../../services/aiContext.service";
import Button from "../common/Button";
import { useProjectAccess } from "../../hooks/useProjectAccess";
import { invalidateCoverageQueries } from "../../hooks/useCoverageQuery";
import { evaluateUnitTestApplyResponse } from "../../services/unitTestReview";
import { isTestFile } from "./CoverageTypeDashboard";

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
      <span
        className="font-bold text-xs select-none flex items-center justify-center w-4 h-4"
        style={{ color: "var(--ps-cobalt)" }}
      >
        ⚛
      </span>
    );
  }
  if (lower.endsWith(".ts")) {
    return (
      <span
        className="text-[9px] font-bold px-1 py-0.2 rounded ps-mono select-none"
        style={{
          background: "color-mix(in srgb, var(--ps-cobalt) 14%, transparent)",
          color: "var(--ps-cobalt)",
        }}
      >
        TS
      </span>
    );
  }
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
    return (
      <span
        className="text-[9px] font-bold px-1 py-0.2 rounded ps-mono select-none"
        style={{
          background: "color-mix(in srgb, var(--ps-amber) 14%, transparent)",
          color: "var(--ps-amber)",
        }}
      >
        JS
      </span>
    );
  }
  return <TestTube2 size={13} style={{ color: "var(--ps-ink-secondary)" }} className="flex-shrink-0" />;
}

/* ── Flatten File Tree Utility ──────────────────────────── */
function flattenFiles(nodes) {
  const result = [];
  const seen = new Set();

  function traverse(list) {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      if (!node) continue;
      const rawPath = node.path || node.id;
      const normalizedPath = rawPath ? String(rawPath).replace(/\\/g, "/") : "";

      const isFile =
        node.type === "file" ||
        (!node.children &&
          normalizedPath &&
          (!node.children || node.children.length === 0));

      if (isFile && normalizedPath && !seen.has(normalizedPath)) {
        seen.add(normalizedPath);
        result.push({
          id: normalizedPath,
          path: normalizedPath,
          name: node.name || normalizedPath.split("/").pop(),
        });
      }

      if (node.children && Array.isArray(node.children)) {
        traverse(node.children);
      }
    }
  }

  traverse(nodes);
  return result;
}

/* ── Chat Session Date & Grouping Helpers ────────────────── */
function formatSessionTime(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  const now = new Date();
  const diffMs = now - d;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function groupSessionsByDate(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return [];

  const groups = {
    today: [],
    yesterday: [],
    previous7Days: [],
    older: [],
  };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekAgoStart = new Date(todayStart);
  weekAgoStart.setDate(weekAgoStart.getDate() - 7);

  for (const session of sessions) {
    const sDate = new Date(session.updatedAt || session.createdAt);
    if (sDate >= todayStart) {
      groups.today.push(session);
    } else if (sDate >= yesterdayStart) {
      groups.yesterday.push(session);
    } else if (sDate >= weekAgoStart) {
      groups.previous7Days.push(session);
    } else {
      groups.older.push(session);
    }
  }

  return [
    { label: "Today", items: groups.today },
    { label: "Yesterday", items: groups.yesterday },
    { label: "Previous 7 Days", items: groups.previous7Days },
    { label: "Older", items: groups.older },
  ].filter((g) => g.items.length > 0);
}

/* ── Initial conversation; the UI follows the current screen until the first send. ── */
const INITIAL_MESSAGES = [
  {
    id: 1,
    isGreeting: true,
    role: "assistant",
    content:
      "How can I help with your project?",
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
              <span>Apply Both</span>
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

      {/* Inline Apply Error & Source Defect Isolation Diagnostics */}
      {(current.testRunError || (Array.isArray(current.isolatedDefects) && current.isolatedDefects.length > 0)) && (
        <div
          className="px-3 py-2 space-y-2"
          style={{
            background: "var(--color-surface)",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          {current.testRunError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md px-3 py-2 text-xs border"
              style={{
                background: "color-mix(in srgb, var(--ps-rose) 8%, transparent)",
                color: "var(--ps-rose)",
                borderColor: "color-mix(in srgb, var(--ps-rose) 25%, transparent)",
              }}
            >
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span className="ps-mono break-words">{current.testRunError}</span>
            </div>
          )}
          {Array.isArray(current.isolatedDefects) && current.isolatedDefects.length > 0 && (
            <div
              role="status"
              className="rounded-md px-3 py-2 text-xs border space-y-1 ps-mono"
              style={{
                background: "color-mix(in srgb, var(--ps-amber) 8%, transparent)",
                color: "var(--ps-amber)",
                borderColor: "color-mix(in srgb, var(--ps-amber) 25%, transparent)",
              }}
            >
              <div className="font-semibold flex items-center gap-1.5">
                <AlertCircle size={13} className="shrink-0" />
                <span>Isolated target source defect(s):</span>
              </div>
              {current.isolatedDefects.map((defect, idx) => (
                <div key={`${defect.symbol || "defect"}-${defect.file || ""}-${defect.line || idx}`} className="pl-5 text-[11px] text-[var(--ps-ink-secondary)]">
                  <span className="font-semibold text-[var(--ps-ink)]">{defect.symbol || "Source defect"}</span>
                  {defect.file && (
                    <span> ({defect.file}{defect.line ? `:${defect.line}` : ""})</span>
                  )}
                  {": "}
                  <span>{defect.diagnostic || defect.reason || defect.message || "Unfixable target source defect"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            disabled={current.isApplying}
            onClick={() => onApplySuggestion?.(msg.id, current)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ps-btn-contrast"
            style={{
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
              title="Revert test file to previous state before Apply"
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
                <span>Run Analysis Unit ↵</span>
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
      className="mt-3.5 rounded-xl overflow-hidden select-text"
      style={{
        background: "var(--ps-surface)",
        border: "1px solid var(--ps-line-strong)",
      }}
    >
      {/* ── IDE Widget Top Header ── */}
      <div
        className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer select-none"
        style={{
          background: "var(--ps-inset)",
          borderBottom: expanded ? "1px solid var(--ps-line)" : "none",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Left: File count & additions/deletions stats */}
        <div className="flex items-center gap-2">
          <span className="text-[var(--ps-ink-muted)] text-xs flex items-center">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="text-xs font-semibold text-[var(--ps-ink)]">
            {totalFiles} file{totalFiles > 1 ? "s" : ""} changed
          </span>
          <div className="flex items-center gap-1 ps-mono text-[11px] font-medium">
            <span style={{ color: "var(--ps-emerald)" }}>+{totalAdded}</span>
            <span style={{ color: "var(--ps-rose)" }}>-{totalDeleted}</span>
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
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] bg-[var(--ps-surface)] border border-[var(--ps-line)] hover:border-[var(--ps-line-strong)] transition-colors cursor-pointer"
            title="Open Review & Diff for comprehensive comparison"
          >
            <FileDiff size={12} style={{ color: "var(--ps-cobalt)" }} />
            <span>Review</span>
          </button>

          {/* Quick Apply All Button */}
          {!allApplied ? (
            <button
              type="button"
              disabled={anyApplying}
              onClick={onApplyAll}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs ps-btn-contrast cursor-pointer disabled:opacity-50"
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
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border"
              style={{
                background: "color-mix(in srgb, var(--ps-emerald) 10%, transparent)",
                color: "var(--ps-emerald)",
                borderColor: "color-mix(in srgb, var(--ps-emerald) 28%, transparent)",
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
        <div className="divide-y divide-[var(--ps-line)]">
          {files.map((file, idx) => {
            const isApplied = file.applied;
            const isApplying = file.isApplying;
            const isUndoing = file.isUndoing;
            const fileName = getFileName(file.targetTestFile);
            const dirPath = shortenDirPath(file.targetTestFile);

            return (
              <div
                key={file.targetTestFile || idx}
                className="flex items-center justify-between px-3.5 py-2 hover:bg-[var(--ps-surface-2)]/60 transition-colors group text-xs"
              >
                {/* File info */}
                <div
                  className="flex items-center gap-2 min-w-0 cursor-pointer flex-1 mr-2"
                  onClick={() => onReviewFile?.(file, idx)}
                  title={`Click to review diff of ${file.targetTestFile}`}
                >
                  {getIdeFileIcon(fileName)}
                  <span className="font-medium text-[var(--ps-ink)] truncate group-hover:text-[var(--ps-cobalt)] transition-colors">
                    {fileName}
                  </span>
                  {dirPath && (
                    <span className="text-[11px] text-[var(--ps-ink-muted)] ps-mono truncate hidden sm:inline">
                      {dirPath}
                    </span>
                  )}
                  <span
                    className="text-[10px] ps-mono px-1 py-0.2 rounded font-medium ml-1 flex-shrink-0"
                    style={{
                      background: "color-mix(in srgb, var(--ps-emerald) 10%, transparent)",
                      color: "var(--ps-emerald)",
                    }}
                  >
                    +{file.linesAdded || 0}
                  </span>
                  {file.framework && (
                    <span
                      className="text-[9.5px] uppercase font-semibold ps-mono px-1.5 py-0.2 rounded flex-shrink-0 border"
                      style={{
                        background: "var(--ps-inset)",
                        color: file.framework === "vitest" ? "var(--ps-amber)" : "var(--ps-cobalt)",
                        borderColor: "var(--ps-line)",
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
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] hover:bg-[var(--ps-surface-2)] transition-colors cursor-pointer"
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
                      className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] ps-btn-contrast cursor-pointer disabled:opacity-50"
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
                          background: "color-mix(in srgb, var(--ps-emerald) 10%, transparent)",
                          color: "var(--ps-emerald)",
                        }}
                      >
                        <Check size={11} />
                        <span>Applied</span>
                      </span>
                      <button
                        type="button"
                        disabled={isUndoing}
                        onClick={() => onUndoFile?.(file)}
                        className="p-1 rounded text-[var(--ps-ink-muted)] hover:text-[var(--ps-rose)] hover:bg-[var(--ps-surface-2)] transition-colors cursor-pointer"
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
            background: "var(--ps-inset)",
            borderTop: "1px solid var(--ps-line)",
          }}
        >
          <div className="text-[11px] text-[var(--ps-ink-secondary)] font-medium">
            Test files written. Re-run analysis to verify coverage gain:
          </div>
          <button
            type="button"
            onClick={onRunAnalysis}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs ps-btn-contrast ml-auto cursor-pointer"
            title="Re-run Analysis Unit"
          >
            <Play size={11} className="fill-current" />
            <span>Run Analysis Unit ↵</span>
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
  onEditMessage,
  onUndoMessage,
  messageActionsBusy,
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
  const [editText, setEditText] = useState(null);

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
        className="flex items-center gap-2 mb-1.5 px-0.5"
        style={{
          fontSize: 11,
          flexDirection: isUser ? "row-reverse" : "row",
        }}
      >
        {isUser ? (
          <div
            className="flex items-center justify-center rounded-md flex-shrink-0 border"
            style={{
              width: 20,
              height: 20,
              background: "var(--ps-surface-2)",
              borderColor: "var(--ps-line-strong)",
            }}
          >
            <User size={11} style={{ color: "var(--ps-ink-secondary)" }} />
          </div>
        ) : (
          <CovaiLogo size={18} />
        )}

        <span
          style={{
            fontWeight: 600,
            color: isUser ? "var(--ps-ink-secondary)" : "var(--ps-ink)",
            fontFamily: "var(--font-sans)",
            fontSize: 11.5,
          }}
        >
          {isUser ? "You" : "COV"}
        </span>

        <span
          className="ps-mono"
          style={{
            color: "var(--ps-ink-muted)",
            fontSize: 10,
          }}
        >
          {msg.timestamp}
        </span>
      </div>

      {editText !== null && onEditMessage ? (
        <form className="w-full space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2" onSubmit={async event => {
          event.preventDefault();
          const text = editText.trim();
          if (text && text !== msg.content && !messageActionsBusy && await onEditMessage(text)) setEditText(null);
        }}>
          <textarea
            aria-label="Edit message"
            value={editText}
            onChange={event => setEditText(event.target.value)}
            disabled={messageActionsBusy}
            autoFocus
            rows={3}
            maxLength={16000}
            className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-2 text-sm text-[var(--color-text)]"
            onKeyDown={event => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                if (!messageActionsBusy) setEditText(null);
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={messageActionsBusy} onClick={() => setEditText(null)}>Cancel</Button>
            <Button size="sm" type="submit" disabled={messageActionsBusy || !editText.trim() || editText.trim() === msg.content}>Send</Button>
          </div>
        </form>
      ) : (
      <>
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
              You have reached today's free AI chat limit to ensure service stability.
            </p>
            <p
              style={{
                color: "var(--color-text-secondary)",
                fontSize: 12,
                marginTop: 10,
                fontStyle: "italic",
              }}
            >
              Please come back tomorrow! Thank you for using the system.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="relative group min-w-0"
          style={{
            maxWidth: isUser ? "86%" : "100%",
            padding: isUser ? "9px 13px" : "12px 15px",
            background: isUser
              ? "var(--ps-surface-2)"
              : "var(--ps-surface)",
            border: isUser
              ? "1px solid var(--ps-line-strong)"
              : "1px solid var(--ps-line)",
            borderRadius: isUser ? "12px 4px 12px 12px" : "4px 12px 12px 12px",
            boxShadow: "none",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
            wordWrap: "break-word",
          }}
        >
          {/* Attached items (Images, Files, Project references) */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2.5">
              {msg.attachments.map((att) => {
                if (
                  att.type === "image" ||
                  att.mimeType?.startsWith("image/")
                ) {
                  return (
                    <div
                      key={att.id || att.name}
                      className="relative rounded-lg overflow-hidden border border-[var(--ps-line)] bg-[var(--ps-inset)]"
                      style={{ maxHeight: 180 }}
                    >
                      <img
                        src={att.previewUrl || att.data}
                        alt={att.name || "Attachment"}
                        className="max-h-40 object-contain rounded-lg"
                      />
                    </div>
                  );
                }
                if (att.type === "project_file") {
                  return (
                    <div
                      key={att.id || att.path}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] ps-mono border"
                      style={{
                        background: "var(--ps-inset)",
                        borderColor: "var(--ps-line-strong)",
                        color: "var(--ps-cobalt)",
                      }}
                    >
                      <AtSign size={11} />
                      <span className="truncate max-w-[200px]">{att.path}</span>
                    </div>
                  );
                }
                return (
                  <div
                    key={att.id || att.name}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono"
                    style={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text)",
                    }}
                  >
                    <FileText
                      size={11}
                      className="text-[var(--color-primary)]"
                    />
                    <span className="truncate max-w-[200px]">{att.name}</span>
                  </div>
                );
              })}
            </div>
          )}

          {msg.isRegenerating ? <TypingIndicator /> : <FormattedMessage content={msg.content} />}

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
          {!isUser && (hovered || msg.failed) && !msg.isRegenerating && (
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
      {onEditMessage && (
        <div className="mt-1 flex gap-1">
          <Button size="sm" variant="ghost" icon={Edit2} disabled={messageActionsBusy} onClick={() => setEditText(msg.content)}>Edit</Button>
          <Button size="sm" variant="ghost" icon={Undo2} disabled={messageActionsBusy || !onUndoMessage} onClick={onUndoMessage} title="Return this message to the composer">Undo</Button>
        </div>
      )}
      </>
      )}
    </motion.div>
  );
}

/* ── Typing Indicator ────────────────────────────────────── */
function TypingIndicator() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      className="flex flex-col items-start"
    >
      <div
        className="flex items-center gap-2 mb-1.5 px-0.5"
        style={{ fontSize: 11 }}
      >
        <CovaiLogo size={18} />
        <span
          style={{ fontWeight: 600, color: "var(--ps-ink)", fontSize: 11.5 }}
        >
          COV
        </span>
        <span role="status" className="ps-mono" style={{ color: "var(--ps-ink-muted)", fontSize: 10.5 }}>
          {elapsed >= 8 ? 'Analyzing…' : 'Thinking…'} <span aria-hidden="true">{elapsed}s</span>
        </span>
      </div>

      <div
        className="flex items-center gap-1.5 px-3.5 py-2.5"
        style={{
          background: "var(--ps-surface)",
          border: "1px solid var(--ps-line)",
          borderRadius: "4px 12px 12px 12px",
        }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ scale: [1, 1.35, 1], opacity: [0.3, 0.9, 0.3] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              delay: i * 0.2,
              ease: "easeInOut",
            }}
            style={{
              width: 4.5,
              height: 4.5,
              borderRadius: "50%",
              background: "var(--ps-cobalt)",
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

/* ── AI Model Options (Loaded from shared catalog) ── */
/* ── Modern Prompt Input (Compact & Dynamic Auto-Resize) ─── */
function ChatInput({
  onSend,
  isTyping,
  isRevising,
  fileTree = [],
  projectId,
  input,
  setInput,
  attachments,
  setAttachments,
}) {
  const [focused, setFocused] = useState(false);

  // @ mention autocomplete state
  const [atMentionOpen, setAtMentionOpen] = useState(false);
  const [atMentionQuery, setAtMentionQuery] = useState("");
  const [atMentionIndex, setAtMentionIndex] = useState(0);

  const textareaRef = useRef(null);
  const atMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  const selectedMentionItemRef = useRef(null);

  const allProjectFiles = useMemo(() => {
    return flattenFiles(fileTree);
  }, [fileTree]);

  const filteredMentionFiles = useMemo(() => {
    if (!allProjectFiles || allProjectFiles.length === 0) return [];
    if (!atMentionQuery) return allProjectFiles;
    const q = atMentionQuery.toLowerCase();
    return allProjectFiles.filter(
      (f) =>
        f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q),
    );
  }, [allProjectFiles, atMentionQuery]);

  // Keep highlighted item visible during keyboard navigation
  useEffect(() => {
    if (atMentionOpen && selectedMentionItemRef.current) {
      selectedMentionItemRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [atMentionIndex, atMentionOpen]);

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

  // Click outside to close menus
  useEffect(() => {
    const handleClickOutside = (e) => {
if (atMenuRef.current && !atMenuRef.current.contains(e.target)) {
        setAtMentionOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Clipboard paste handler: handles pasted images silently without toast
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    let imageFound = false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type && item.type.startsWith("image/")) {
        imageFound = true;
        const file = item.getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = (ev) => {
          const base64 = ev.target.result;
          const newAtt = {
            id:
              "img-" +
              Date.now() +
              "-" +
              Math.random().toString(36).substr(2, 5),
            type: "image",
            name: `Pasted_Image_${new Date().toLocaleTimeString().replace(/:/g, "-")}.png`,
            mimeType: file.type || "image/png",
            data: base64,
            previewUrl: base64,
            size: file.size,
          };
          setAttachments((prev) => [...prev, newAtt]);
        };
        reader.readAsDataURL(file);
      }
    }

    if (imageFound) {
      e.preventDefault();
    }
  }, []);

  // System file picker handler: attach files / images from system
  const handleSystemFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach((file) => {
      if (file.type && file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setAttachments((prev) => [
            ...prev,
            {
              id:
                "img-" +
                Date.now() +
                "-" +
                Math.random().toString(36).substr(2, 5),
              type: "image",
              name: file.name,
              mimeType: file.type || "image/png",
              data: ev.target.result,
              previewUrl: ev.target.result,
              size: file.size,
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setAttachments((prev) => [
            ...prev,
            {
              id:
                "file-" +
                Date.now() +
                "-" +
                Math.random().toString(36).substr(2, 5),
              type: "file",
              name: file.name,
              size: file.size,
              content: ev.target.result,
            },
          ]);
        };
        reader.readAsText(file);
      }
    });

    e.target.value = "";
  };

  const removeAttachment = (id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // Text input change & @ mention detection
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInput(val);

    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursor);

    // Look for @ or @/ right before cursor
    const match = textBeforeCursor.match(/(?:^|\s)@(\/?[\w\.\-\/]*)$/);

    if (match) {
      const rawQuery = match[1];
      const query = rawQuery.startsWith("/") ? rawQuery.slice(1) : rawQuery;
      setAtMentionQuery(query);
      setAtMentionOpen(true);
      setAtMentionIndex(0);
    } else {
      setAtMentionOpen(false);
    }
  };

  // Selecting a file from @ mention
  const handleSelectMentionFile = async (file) => {
    const cursor = textareaRef.current
      ? textareaRef.current.selectionStart
      : input.length;
    const textBeforeCursor = input.slice(0, cursor);
    const textAfterCursor = input.slice(cursor);

    const replacedBefore = textBeforeCursor.replace(
      /(?:^|\s)@(\/?[\w\.\-\/]*)$/,
      (match) => {
        const prefix = match.startsWith(" ") ? " " : "";
        return `${prefix}@${file.path} `;
      },
    );

    setInput(replacedBefore + textAfterCursor);
    setAtMentionOpen(false);

    // The chat service reads the referenced file from the authorized snapshot.
    if (!attachments.some((a) => a.path === file.path)) {
      const newAtt = {
        id: "proj-" + file.path,
        type: "project_file",
        name: file.name,
        path: file.path,
      };
      setAttachments((prev) => [...prev, newAtt]);


    }

    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  // Keyboard navigation for @ mention and send
  const handleKeyDown = (e) => {
    if (atMentionOpen && filteredMentionFiles.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAtMentionIndex((prev) => (prev + 1) % filteredMentionFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAtMentionIndex(
          (prev) =>
            (prev - 1 + filteredMentionFiles.length) %
            filteredMentionFiles.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleSelectMentionFile(filteredMentionFiles[atMentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAtMentionOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!input.trim() || isTyping) return;
    if (!onSend(input.trim(), attachments)) return;
    setInput("");
    setAttachments([]);
    setAtMentionOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "24px";
    }
  };

  const canSend = Boolean(input.trim()) && !isTyping;

  return (
    <div
      className="flex-shrink-0 relative"
      style={{ padding: "6px 14px 12px" }}
      onPaste={handlePaste}
      inert={isRevising}
    >
      {/* Hidden file input for system file attachment */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleSystemFileSelect}
      />

      {/* ── @ Project File Autocomplete Dropdown ── */}
      <AnimatePresence>
        {atMentionOpen && (
          <motion.div
            ref={atMenuRef}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            style={{
              position: "absolute",
              bottom: "calc(100% - 2px)",
              left: 14,
              width: 320,
              maxHeight: 280,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              boxShadow: "var(--shadow-lg)",
              padding: "6px",
              zIndex: 60,
              overflowY: "auto",
            }}
            className="custom-scrollbar"
          >
            <div
              className="px-2.5 py-1.5 text-[10px] font-semibold tracking-wider uppercase flex items-center justify-between"
              style={{
                color: "var(--color-text-secondary)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span className="flex items-center gap-1.5">
                <AtSign size={11} className="text-[var(--color-primary)]" />
                <span>Reference Project File</span>
              </span>
              <span
                style={{
                  color: "var(--color-text-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {filteredMentionFiles.length}{" "}
                {filteredMentionFiles.length === 1 ? "file" : "files"}
                {allProjectFiles.length > filteredMentionFiles.length
                  ? ` (of ${allProjectFiles.length})`
                  : ""}
              </span>
            </div>

            <div className="flex flex-col gap-0.5 mt-1">
              {filteredMentionFiles.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-[var(--color-text-muted)] font-mono">
                  {allProjectFiles.length === 0
                    ? "No files in project yet"
                    : "No matching files found"}
                </div>
              ) : (
                filteredMentionFiles.map((file, idx) => {
                  const isSelected = idx === atMentionIndex;
                  return (
                    <button
                      key={file.path}
                      ref={isSelected ? selectedMentionItemRef : null}
                      type="button"
                      onClick={() => handleSelectMentionFile(file)}
                      onMouseEnter={() => setAtMentionIndex(idx)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer w-full"
                      style={{
                        background: isSelected
                          ? "var(--ps-surface-2)"
                          : "transparent",
                        border: isSelected
                          ? "1px solid var(--ps-line-strong)"
                          : "1px solid transparent",
                      }}
                    >
                      <FileCode
                        size={14}
                        className={
                          isSelected
                            ? "text-[var(--ps-cobalt)] shrink-0"
                            : "text-[var(--ps-ink-muted)] shrink-0"
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-xs ps-mono font-medium truncate"
                          style={{
                            color: isSelected
                              ? "var(--ps-ink)"
                              : "var(--ps-ink-secondary)",
                          }}
                        >
                          {file.name}
                        </div>
                        <div
                          className="text-[10px] ps-mono truncate"
                          style={{ color: "var(--ps-ink-muted)" }}
                        >
                          {file.path}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Input Box ── */}
      <div
        className="relative rounded-xl transition-colors duration-150"
        style={{
          background: "var(--ps-surface)",
          border: focused
            ? "1px solid var(--ps-cobalt)"
            : "1px solid var(--ps-line-strong)",
          padding: "10px 12px 8px",
        }}
      >
        {/* Attachments chip row */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pb-2 mb-2 border-b border-[var(--ps-line)]">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="group/att flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded-md text-xs border"
                style={{
                  background: "var(--ps-inset)",
                  borderColor: "var(--ps-line-strong)",
                  color:
                    att.type === "project_file"
                      ? "var(--ps-cobalt)"
                      : "var(--ps-ink)",
                }}
              >
                {att.type === "image" ? (
                  <div className="w-5 h-5 rounded overflow-hidden flex-shrink-0 border border-[var(--ps-line)] bg-[var(--ps-bg)]">
                    <img
                      src={att.previewUrl || att.data}
                      alt="Thumbnail"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : att.type === "project_file" ? (
                  <AtSign size={12} className="flex-shrink-0" />
                ) : (
                  <FileText
                    size={12}
                    className="flex-shrink-0"
                    style={{ color: "var(--ps-cobalt)" }}
                  />
                )}

                <span className="ps-mono text-[11px] truncate max-w-[140px]">
                  {att.type === "project_file" ? `@${att.path}` : att.name}
                </span>

                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="p-0.5 rounded hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-muted)] hover:text-[var(--ps-rose)] cursor-pointer transition-colors"
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Ask COV or type @ to reference a file..."
          rows={1}
          className="w-full resize-none outline-none bg-transparent custom-scrollbar"
          style={{
            padding: "2px 2px 6px",
            fontFamily: "var(--font-sans)",
            color: "var(--ps-ink)",
            fontSize: 13,
            lineHeight: "20px",
            height: "24px",
            maxHeight: 160,
            caretColor: "var(--ps-cobalt)",
          }}
        />

        {/* Compact Single Footer Row */}
        <div className="flex items-center justify-between pt-1.5 gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-7 px-2 rounded-md inline-flex items-center gap-1 text-[11px] font-medium border border-[var(--ps-line)] bg-[var(--ps-inset)] hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors cursor-pointer shrink-0"
              title="Attach file or image"
            >
              <Plus size={13} />
              <span>Attach</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = input ? `${input}${input.endsWith(" ") ? "" : " "}@` : "@";
                setInput(next);
                setAtMentionQuery("");
                setAtMentionOpen(true);
                setAtMentionIndex(0);
                textareaRef.current?.focus();
              }}
              className="h-7 px-2 rounded-md inline-flex items-center gap-1 text-[11px] ps-mono text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink-secondary)] hover:bg-[var(--ps-surface-2)] transition-colors cursor-pointer shrink-0"
              title="Reference a repository file (@)"
            >
              <AtSign size={12} />
              <span>File</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all ${
              canSend
                ? "ps-btn-contrast cursor-pointer"
                : "bg-[var(--ps-inset)] text-[var(--ps-ink-muted)] border border-[var(--ps-line)] cursor-not-allowed opacity-60"
            }`}
          >
            {isTyping ? (
              <Loader2 size={13} className="animate-spin" style={{ color: "var(--ps-cobalt)" }} />
            ) : (
              <ArrowUp size={14} strokeWidth={2.2} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ── AI Agent Panel — Main Export ────────────────────────── */
export default function AIPanel({
  onClose,
  projectId,
  snapshotId,
  screenContext,
  fileTree = [],
  pendingAiSuggestion,
  onClearPendingSuggestion,
  onOpenFile,
  onRunAnalysis,
}) {
  const [internalTree, setInternalTree] = useState(fileTree || []);

  useEffect(() => {
    if (Array.isArray(fileTree) && fileTree.length > 0) {
      setInternalTree(fileTree);
    } else if (projectId) {
      getProjectTreeApi(projectId)
        .then((res) => {
          const list = Array.isArray(res?.data)
            ? res.data
            : Array.isArray(res?.tree)
              ? res.tree
              : [];
          if (list.length > 0) {
            setInternalTree(list);
          }
        })
        .catch((err) => console.error("Unable to refresh project tree", err));
    }
  }, [fileTree, projectId]);

  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [draftText, setDraftText] = useState("");
  const [draftAttachments, setDraftAttachments] = useState([]);
  const [isRevising, setIsRevising] = useState(false);
  const revisionRef = useRef(false);
  const access = useProjectAccess(projectId);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModel] = useState(() => {
    const curId = typeof getSelectedAIModel === "function" ? getSelectedAIModel() : null;
    return AI_MODELS.find((m) => m.id === curId) || AI_MODELS[0];
  });
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewFiles, setReviewFiles] = useState([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const bottomRef = useRef(null);
  const messageIdRef = useRef(10);
  const getNextId = () => ++messageIdRef.current;
  const { showToast } = useToast();

  const handleOpenReviewModal = (files, initialIndex = 0) => {
    setReviewFiles(files || []);
    setReviewIndex(initialIndex || 0);
    setReviewModalOpen(true);
  };

  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [useProjectMemory, setUseProjectMemory] = useState(true);
  const [memoryAvailable, setMemoryAvailable] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [contextDialog, setContextDialog] = useState(null);
  const [integrationFixContext, setIntegrationFixContext] = useState(null);
  const contextRequestRef = useRef(0);
  const sendRef = useRef(false);
  const storageKey = useMemo(() => {
    try {
      const payload = JSON.parse(atob(localStorage.getItem("token").split(".")[1]));
      return payload.userId && projectId ? `covai_chat_${payload.userId}_${projectId}` : null;
    } catch { return null; }
  }, [projectId]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isFetchingSessions, setIsFetchingSessions] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");

  const fetchSessions = useCallback(async () => {
    if (!projectId) return;
    setIsFetchingSessions(true);
    try {
      const res = await getChatSessionsApi(projectId);
      if (res?.success && Array.isArray(res.data)) {
        setSessions(res.data);
      }
    } catch (err) {
      console.error("Failed to fetch chat sessions:", err);
    } finally {
      setIsFetchingSessions(false);
    }
  }, [projectId]);

  const handleSelectSession = useCallback(async (sessionId, throwOnError = false, fromRevision = false) => {
    if (!sessionId || (revisionRef.current && !fromRevision)) return;
    const request = ++contextRequestRef.current;
    setIsLoadingSession(true);
    try {
      const res = await getChatSessionMessagesApi(projectId, sessionId);
      if (request !== contextRequestRef.current) return;
      if (!res?.success || !res.data) throw new Error("Could not load conversation.");
      const session = res.data.session;
      const formatted = (res.data.messages || []).map(m => ({
        id: m.id, savedMessageId: m.id, role: m.role, content: m.content, model: m.model,
        attachments: (m.attachments || []).map((att, index) => ({ ...att, id: att.id || `${m.id}_${index}`, previewUrl: att.type === "image" ? att.data : undefined })),
        timestamp: new Date(m.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      }));
      setActiveSessionId(sessionId);
      setUseProjectMemory(session.useMemory ?? true);
      setMessages(formatted.length ? formatted : INITIAL_MESSAGES); setIsHistoryOpen(false);
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ id: sessionId, useMemory: session.useMemory ?? true }));
      if (res.data.truncated) showToast({ type: "info", title: "Recent history loaded", message: "Only the latest 2,000 messages are shown. Older stored context may be summarized." });
      return true;
    } catch (err) {
      if (request === contextRequestRef.current) showToast({ type: "error", title: "Load failed", message: err.message });
      if (throwOnError) throw err;
    } finally { if (request === contextRequestRef.current) setIsLoadingSession(false); }
  }, [projectId, storageKey, showToast]);

  useEffect(() => {
    let cancelled = false;
    const requestState = contextRequestRef;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setIsRestoring(true); setMessages(INITIAL_MESSAGES); setActiveSessionId(null);
      fetchSessions();
      if (projectId && projectId !== "undefined") {
        getAiContext(projectId).then(config => { if (!cancelled) setMemoryAvailable(config?.automaticMemory ?? false); }).catch(() => { if (!cancelled) setMemoryAvailable(false); });
      } else if (!cancelled) {
        setMemoryAvailable(false);
      }
      let stored = null;
      try { stored = storageKey ? JSON.parse(localStorage.getItem(storageKey)) : null; } catch { /* Invalid local pointer cannot grant access. */ }
      if (stored?.id) {
        try { await handleSelectSession(stored.id, true); if (!cancelled && typeof stored.useMemory === "boolean") setUseProjectMemory(stored.useMemory); }
        catch { if (storageKey && !cancelled) localStorage.removeItem(storageKey); }
      } else if (!cancelled) setUseProjectMemory(stored?.useMemory ?? true);
      if (!cancelled) setIsRestoring(false);
    });
    return () => { cancelled = true; requestState.current++; };
  }, [projectId, storageKey, fetchSessions, handleSelectSession]);

  const handleNewChat = (memory = useProjectMemory) => {
    if (isTyping || isRestoring || isLoadingSession || revisionRef.current) return;
    contextRequestRef.current++;
    setUseProjectMemory(typeof memory === "boolean" ? memory : useProjectMemory);
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ id: null, useMemory: typeof memory === "boolean" ? memory : useProjectMemory }));
    setActiveSessionId(null);
    setMessages(INITIAL_MESSAGES);
    setIsHistoryOpen(false);
    showToast({
      type: "info",
      title: "New Session",
      message: "Started a fresh conversation. Previous chats are saved in history.",
    });
  };

  const handleStartRenameSession = (session, e) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title || "");
  };

  const handleSaveRenameSession = async (sessionId) => {
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setEditingSessionId(null);
      return;
    }
    try {
      const res = await updateChatSessionApi(projectId, sessionId, trimmed);
      if (res?.success) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title: trimmed } : s)),
        );
        showToast({
          type: "success",
          title: "Renamed",
          message: "Conversation title updated.",
        });
      }
    } catch (err) {
      console.error("Failed to rename session:", err);
      showToast({
        type: "error",
        title: "Error",
        message: "Failed to rename conversation.",
      });
    } finally {
      setEditingSessionId(null);
    }
  };

  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation();
    try {
      const res = await deleteChatSessionApi(projectId, sessionId);
      if (res?.success) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
          if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ id: null, useMemory: useProjectMemory }));
          setMessages(INITIAL_MESSAGES);
        }
        showToast({
          type: "info",
          title: "Deleted",
          message: "Conversation has been deleted.",
        });
      }
    } catch (err) {
      console.error("Failed to delete session:", err);
      showToast({
        type: "error",
        title: "Error",
        message: "Failed to delete conversation.",
      });
    }
  };

  const filteredSessions = useMemo(() => {
    if (!historySearchQuery.trim()) return sessions;
    const q = historySearchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title?.toLowerCase().includes(q) ||
        s.messages?.[0]?.content?.toLowerCase().includes(q),
    );
  }, [sessions, historySearchQuery]);

  const filteredGroupedSessions = useMemo(() => {
    return groupSessionsByDate(filteredSessions);
  }, [filteredSessions]);

  const activeSessionTitle = useMemo(() => {
    if (!activeSessionId) return null;
    const found = sessions.find((s) => s.id === activeSessionId);
    return found?.title || null;
  }, [sessions, activeSessionId]);

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
      timestamp: new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((m) => [...m.map(message => message.isGreeting ? { ...message, isGreeting: false, content: chatGreeting(screenContext) } : message), userMsg]);
    setIsTyping(true);

    try {
      const res = await suggestUnitTestcase(snapshotId, filePath, projectId, isTest ? undefined : "all");
      const data = res?.data;

      if (!data) {
        throw new Error("Did not receive test case suggestions from server.");
      }

      if (data.isFullyCovered) {
        const assistantMsg = {
          id: getNextId(),
          role: "assistant",
          timestamp: new Date().toLocaleTimeString("en-US", {
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
                originalCode: data.originalCode,
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
        timestamp: new Date().toLocaleTimeString("en-US", {
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
          timestamp: new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          content: `❌ Error suggesting test cases for \`${filePath}\`: ${err.message || "Unable to connect to AI API."}`,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const readTestFile = async (path) => {
    try {
      const { data } = await getFileContentApi(projectId, path, { snapshotId, forceFresh: true });
      return data;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  };

  const writeTestFile = (path, content, current) =>
    updateFileContentApi(projectId, path, content, {
      snapshotId,
      expectedVersion: current.version,
      expectedWorkspaceRevision: current.workspaceRevision,
    });

  const revertTestFile = async (suggestion, previousContent) => {
    const path = suggestion.targetTestFile;
    const current = await readTestFile(path);
    if (!current) throw new Error("The applied file no longer exists.");
    const appliedCode = suggestion.fullUpdatedContent || suggestion.suggestedTestCode;
    if (current.content !== appliedCode) {
      throw new Error("The file changed after applying this suggestion. Review it before undoing.");
    }
    if (suggestion.isExisting) {
      await writeTestFile(path, previousContent, current);
    } else {
      await deleteProjectEntryApi(projectId, path, { snapshotId, expectedVersion: current.version, expectedWorkspaceRevision: current.workspaceRevision });
    }
    if (snapshotId) invalidateCoverageQueries(snapshotId);
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

      const current = await readTestFile(targetPath);
      if (current) {
        if (current.content !== (target.originalContent ?? target.originalCode ?? file.originalContent)) {
          throw new Error("The file changed since this suggestion was generated. Generate a fresh suggestion.");
        }
        await writeTestFile(targetPath, contentToWrite, current);
      } else {
        await createProjectFileApi(projectId, targetPath, contentToWrite, { snapshotId });
      }

      setMessages((prev) =>
        prev.map((m) => {
          if (!m.ideChanges) return m;
          const updated = m.ideChanges.files.map((f) =>
            f.targetTestFile === file.targetTestFile
              ? { ...f, ...target, originalContent: current?.content ?? "", isExisting: Boolean(current), applied: true, isApplying: false }
              : f
          );
          return { ...m, ideChanges: { ...m.ideChanges, files: updated } };
        })
      );

      // Update modal state if open
      setReviewFiles((prev) =>
        prev.map((f) =>
          f.targetTestFile === file.targetTestFile ? { ...f, ...target, originalContent: current?.content ?? "", isExisting: Boolean(current), applied: true } : f
        )
      );

      if (snapshotId) {
        invalidateCoverageQueries(snapshotId);
      }

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
      await revertTestFile(file, orig);

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
    if (snapshotId) {
      invalidateCoverageQueries(snapshotId);
    }
  };

  const handleSuggestBulk = async (arg1, arg2) => {
    if (isTyping || isRestoring || isLoadingSession) return;
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
          linesPct: 0,
        }))
        : []);

    const testCountDisplay = options.totalTestSuitesCount || 20;

    // Send single user prompt message
    const userMsg = {
      id: getNextId(),
      role: "user",
      content: "✨ Suggest unit test cases for uncovered logic and branches",
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
      content: `⚡ **Analyzing project coverage and generating test cases...**\n\nDetecting uncovered branches and synthesizing test cases...`,
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
      let failedRequests = 0;

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
                content: `⚡ **Generating test cases... (${completedCount}/${totalTargets} files completed)**\n\n` +
                  (recentFile ? `↳ Just processed: \`${cleanFilePath(recentFile)}\`\n` : "") +
                  `Synthesizing test cases for uncovered branches...`,
                ideChanges: fileChanges.length > 0 ? {
                  totalFiles: fileChanges.length,
                  totalAdded: fileChanges.reduce((sum, f) => sum + (f.linesAdded || 0), 0),
                  totalDeleted: fileChanges.reduce((sum, file) => sum + file.linesDeleted, 0),
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
              if (!cleanTargetTest) continue;

              let originalContent = primary.originalCode ?? primary.existingContent;
              if (originalContent == null && primary.isExisting) {
                try {
                  const prevRes = await getFileContentApi(
                    effectiveProjectId,
                    cleanTargetTest,
                    { snapshotId: effectiveSnapshotId, forceFresh: true },
                  );
                  originalContent = prevRes?.data?.content || "";
                } catch (error) {
                  console.warn("Unable to read the existing test file:", error);
                  return;
                }
              }

              const fullUpdatedContent =
                primary.fullUpdatedContent || primary.suggestedTestCode || "";
              const { added, removed } = countDiffLines(originalContent ?? "", fullUpdatedContent);

              if (fileChanges.some(file => file.targetTestFile === cleanTargetTest)) continue;
              fileChanges.push({
                id: `fc-${item.filePath || item.sourceFile}`,
                sourceFile: cleanSource,
                targetTestFile: cleanTargetTest,
                fileName: getFileName(cleanTargetTest),
                framework: primary.framework || "vitest",
                isExisting: Boolean(primary.isExisting),
                originalContent: originalContent ?? "",
                fullUpdatedContent,
                suggestedTestCode: primary.suggestedTestCode || fullUpdatedContent,
                linesAdded: added,
                linesDeleted: removed,
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
                  originalContent: s.originalCode ?? s.existingContent ?? originalContent ?? "",
                  fullUpdatedContent: s.fullUpdatedContent || s.suggestedTestCode,
                  linesAdded: added,
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
            failedRequests += 1;
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
      const totalDeleted = fileChanges.reduce((sum, file) => sum + file.linesDeleted, 0);

      // 1. Overview Markdown content
      let overviewContent = "";

      if (fileChanges.length > 0) {
        overviewContent = `### ⚡ Suggested Test Cases (${fileChanges.length} test files)\n\n` +
          `Generated complete testcases covering missing branches. Click **Review** to inspect detailed code diffs before applying, or click **Apply all** to update all test files in the project.`;
      } else {
        overviewContent =
          `🎉 **All source files have reached comprehensive coverage!**\n\n` +
          `- All conditional branches and functions are covered.\n` +
          `- No additional testcase suggestions are needed.`;
      }

      if (failedRequests) {
        overviewContent = fileChanges.length
          ? overviewContent + "\n\nCould not generate suggestions for " + failedRequests + " source files."
          : "Could not generate unit test suggestions. Please try again.";
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

  // Watch for external suggest trigger (e.g. from Coverage table, Integration AI Fix, or Editor)
  useEffect(() => {
    if (!pendingAiSuggestion) return;
    if (isRestoring || isLoadingSession || isTyping) return;
    const {
      filePath,
      isBulk,
      promptText,
      attachments: pendingAttachments,
      fixContext,
    } = pendingAiSuggestion;
    onClearPendingSuggestion?.();
    if (fixContext) {
      setIntegrationFixContext(fixContext);
    }
    if (isBulk) {
      // Bulk test generation is handled exclusively by UnitTestGuidedWorkflow and UnitTestTraceabilityMatrix
      handleSuggestBulk(pendingAiSuggestion);
    } else if (filePath) {
      handleSuggestForFile(filePath);
    } else if (promptText) {
      handleSend(
        typeof promptText === "string" ? promptText : String(promptText),
        Array.isArray(pendingAttachments) ? pendingAttachments : [],
        null,
        null,
        fixContext || null,
      );
    }
  }, [pendingAiSuggestion, isRestoring, isLoadingSession, isTyping]);

  const isMatchingSuggestion = (s, target) => {
    if (!s || !target) return false;
    if (target.suggestionId && s.suggestionId) return s.suggestionId === target.suggestionId;
    if (target.id && s.id) return s.id === target.id;
    return s.framework === target.framework;
  };

  const handleApplySuggestion = async (msgId, suggestion) => {
    if (!projectId || !suggestion) return;

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const updatedList = (m.testSuggestions || []).map((s) =>
          isMatchingSuggestion(s, suggestion)
            ? { ...s, isApplying: true, testRunError: null, isolatedDefects: null }
            : s,
        );
        return {
          ...m,
          testSuggestions: updatedList,
          testSuggestion: isMatchingSuggestion(m.testSuggestion, suggestion)
            ? { ...m.testSuggestion, isApplying: true, testRunError: null, isolatedDefects: null }
            : m.testSuggestion,
        };
      }),
    );

    try {
      let previousContent = "";
      const current = await readTestFile(suggestion.targetTestFile);
      if (current) {
        previousContent = current.content;
        if (suggestion.originalCode != null && previousContent !== suggestion.originalCode) {
          throw new Error("The file changed since this suggestion was generated. Generate a fresh suggestion.");
        }
      }

      let applyWarning = null;
      let applyDefects = null;
      let applyWasWritten = true;
      let applyMessage = null;

      if (snapshotId) {
        const res = await applyUnitTestSuggestion(snapshotId, {
          suggestion: {
            ...suggestion,
            projectId,
            targetTestFile: suggestion.targetTestFile,
            suggestedTestCode: suggestion.suggestedTestCode || suggestion.code,
            fullUpdatedContent: suggestion.fullUpdatedContent,
            framework: suggestion.framework,
          },
          projectId,
          skipBackgroundJob: true,
        });

        const evalResult = evaluateUnitTestApplyResponse(res, suggestion);
        if (!evalResult.ok) {
          const applyErr = new Error(evalResult.error);
          applyErr.isolatedDefects = evalResult.isolatedDefects;
          throw applyErr;
        }

        applyDefects = evalResult.isolatedDefects?.length ? evalResult.isolatedDefects : null;
        applyWarning = evalResult.warning || null;
        applyWasWritten = Boolean(evalResult.applied);
        applyMessage = evalResult.message || null;

        if (evalResult.outcome === "NO_CHANGES") {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== msgId) return m;
              const updatedList = (m.testSuggestions || []).map((s) =>
                isMatchingSuggestion(s, suggestion)
                  ? {
                      ...s,
                      applied: false,
                      isApplying: false,
                      testRunError: null,
                      isolatedDefects: applyDefects,
                    }
                  : s,
              );
              return {
                ...m,
                testSuggestions: updatedList,
                testSuggestion: isMatchingSuggestion(m.testSuggestion, suggestion)
                  ? {
                      ...m.testSuggestion,
                      applied: false,
                      isApplying: false,
                      testRunError: null,
                      isolatedDefects: applyDefects,
                    }
                  : m.testSuggestion,
              };
            }),
          );
          invalidateCoverageQueries(snapshotId);
          showToast({
            type: "info",
            title: "No Changes Needed",
            message: evalResult.message,
          });
          return;
        }
      } else {
        const contentToWrite =
          suggestion.fullUpdatedContent || suggestion.suggestedTestCode || suggestion.code;

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
            { snapshotId },
          );
        }
      }

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId) return m;
          const updatedList = (m.testSuggestions || []).map((s) =>
            isMatchingSuggestion(s, suggestion)
              ? {
                  ...s,
                  applied: applyWasWritten,
                  previousContent,
                  isExisting: Boolean(current),
                  isApplying: false,
                  testRunError: null,
                  isolatedDefects: applyDefects,
                }
              : s,
          );
          return {
            ...m,
            testSuggestions: updatedList,
            testSuggestion: isMatchingSuggestion(m.testSuggestion, suggestion)
              ? {
                  ...m.testSuggestion,
                  applied: applyWasWritten,
                  previousContent,
                  isExisting: Boolean(current),
                  isApplying: false,
                  testRunError: null,
                  isolatedDefects: applyDefects,
                }
              : m.testSuggestion,
          };
        }),
      );

      if (snapshotId && applyWasWritten) {
        invalidateCoverageQueries(snapshotId);
      }

      if (!applyWasWritten) {
        showToast({
          type: "info",
          title: "Draft Verified (Not Applied)",
          message:
            applyWarning ||
            applyMessage ||
            `Verified ${suggestion.framework?.toUpperCase() || "test"} draft without writing ${suggestion.targetTestFile} to disk.`,
        });
      } else if (applyWarning) {
        showToast({
          type: "warning",
          title: "Test Applied with Warnings",
          message: applyWarning,
        });
      } else {
        showToast({
          type: "success",
          title: "Test Applied",
          message: `Applied ${suggestion.framework?.toUpperCase()} test case to ${suggestion.targetTestFile}`,
        });
      }
      // Stays in current view without redirecting
    } catch (err) {
      const errMsg = err.message || "Unable to apply test case to file.";
      const errDefects = Array.isArray(err.isolatedDefects) && err.isolatedDefects.length > 0
        ? err.isolatedDefects
        : null;
      showToast({
        type: "error",
        title: "Apply Failed",
        message: errMsg,
      });
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId) return m;
          const updatedList = (m.testSuggestions || []).map((s) =>
            isMatchingSuggestion(s, suggestion)
              ? { ...s, applied: false, isApplying: false, testRunError: errMsg, isolatedDefects: errDefects }
              : s,
          );
          return {
            ...m,
            testSuggestions: updatedList,
            testSuggestion: isMatchingSuggestion(m.testSuggestion, suggestion)
              ? { ...m.testSuggestion, applied: false, isApplying: false, testRunError: errMsg, isolatedDefects: errDefects }
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
          isMatchingSuggestion(s, suggestion) ? { ...s, isUndoing: true } : s,
        );
        return {
          ...m,
          testSuggestions: updatedList,
          testSuggestion: isMatchingSuggestion(m.testSuggestion, suggestion)
            ? { ...m.testSuggestion, isUndoing: true }
            : m.testSuggestion,
        };
      }),
    );

    try {
      await revertTestFile(suggestion, suggestion.previousContent ?? "");

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId) return m;
          const updatedList = (m.testSuggestions || []).map((s) =>
            isMatchingSuggestion(s, suggestion)
              ? { ...s, applied: false, isUndoing: false }
              : s,
          );
          return {
            ...m,
            testSuggestions: updatedList,
            testSuggestion: isMatchingSuggestion(m.testSuggestion, suggestion)
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
            isMatchingSuggestion(s, suggestion)
              ? { ...s, isUndoing: false }
              : s,
          );
          return {
            ...m,
            testSuggestions: updatedList,
            testSuggestion: isMatchingSuggestion(m.testSuggestion, suggestion)
              ? { ...m.testSuggestion, isUndoing: false }
              : m.testSuggestion,
          };
        }),
      );
    }
  };

  const extractScenarioCodeFromReply = (text = "") => {
    const blocks = [];
    const regex = /```(?:javascript|js|typescript|ts)?\s*\n([\s\S]*?)```/gi;
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (m[1]?.trim()) blocks.push(m[1].trim());
    }
    if (blocks.length === 0) return null;
    const testBlock = blocks.find((b) => /\b(it|test)\s*\(/.test(b));
    return testBlock || blocks[0];
  };

  const handleApplyIntegrationFix = useCallback(
    async (ctx, code) => {
      if (!ctx?.snapshotId || !ctx?.aiTestId || !ctx?.scenarioId || !code) return;
      try {
        const res = await mutateIntegrationScenarioApi({
          snapshotId: ctx.snapshotId,
          aiTestId: ctx.aiTestId,
          scenarioId: ctx.scenarioId,
          expectedVersion: ctx.expectedVersion ?? 1,
          action: "UPDATE",
          code,
        });
        const newVersion = res?.data?.version || res?.version;
        if (newVersion) {
          setIntegrationFixContext((prev) =>
            prev ? { ...prev, expectedVersion: newVersion } : prev,
          );
        }
        invalidateCoverageQueries(ctx.snapshotId);
        window.dispatchEvent(
          new CustomEvent("covai:integration-updated", {
            detail: { snapshotId: ctx.snapshotId },
          }),
        );
        showToast({
          type: "success",
          title: "Scenario Fix Applied",
          message: `Updated "${ctx.testName}" for ${ctx.endpointLabel}. Re-run coverage to verify.`,
        });
      } catch (err) {
        showToast({
          type: "error",
          title: "Failed to Apply Fix",
          message: err?.message || "Could not update the integration test scenario.",
        });
      }
    },
    [showToast],
  );

  const handleSend = (text, attachments = [], retryContext = null, replaceFailedMessageId = null, activeFixCtx = integrationFixContext) => {
    if (typeof text !== "string" || !text.trim() || sendRef.current || revisionRef.current || isRestoring || isLoadingSession || isTyping) return;
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
      requestContext: retryContext || { sessionId: activeSessionId, snapshotId, model: selectedModel.id, useMemory: useProjectMemory, screenContext: normalizeChatScreenContext(screenContext), clientRequestId: crypto.randomUUID() },
      attachments: attachments || [],
      timestamp: new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    const currentHistory = []; // The server reconstructs authoritative history from the session.
    sendRef.current = true;
    const requestScope = contextRequestRef.current;
    setMessages(previous => {
      const failedIndex = previous.findIndex(message => message.id === replaceFailedMessageId);
      return [...(failedIndex < 0 ? previous : previous.slice(0, failedIndex)), userMsg];
    });
    setIsTyping(true);

    return finishSend(userMsg, requestScope, currentHistory, activeFixCtx);
  };

  const finishSend = async (userMsg, requestScope, currentHistory, activeFixCtx = integrationFixContext) => {
    const { content: text, attachments } = userMsg;
    try {
      const resolvedAttachments = (await Promise.all((attachments || []).map(async (attachment) => {
        if (!["file", "project_file"].includes(attachment.type) || attachment.content != null) return attachment;
        try {
          const { data } = await getFileContentApi(projectId, attachment.path, { snapshotId });
          if (typeof data?.content !== "string") throw new Error("File content is unavailable.");
          return { ...attachment, content: data.content };
        } catch (err) {
          console.error("Unable to load AI attachment", err);
          showToast({ type: "error", title: "Attachment skipped", message: `Could not load ${attachment.path || attachment.name}: ${err.message}` });
          return null;
        }
      }))).filter(attachment => attachment && (attachment.type !== "image" || attachment.data));
      if (requestScope !== contextRequestRef.current) return;
      const res = await sendAiChatMessageApi(
        projectId,
        text,
        currentHistory,
        selectedModel.id,
        resolvedAttachments,
        activeSessionId,
        userMsg.requestContext,
      );
      if (requestScope !== contextRequestRef.current) return;

      if (res?.data?.sessionId) {
        setMessages(previous => previous.map(message => message.id === userMsg.id ? { ...message, savedMessageId: res.data.userMessageId, requestContext: { ...userMsg.requestContext, clientRequestId: crypto.randomUUID(), sessionId: res.data.sessionId, screenContext: { ...userMsg.requestContext.screenContext, workspaceRevision: res.data.context?.workspaceRevision } } } : message));
        setActiveSessionId(res.data.sessionId);
        if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ id: res.data.sessionId, useMemory: useProjectMemory }));
        fetchSessions();
      }

      const fixTarget = activeFixCtx || integrationFixContext;
      const candidateCode =
        fixTarget && !fixTarget.isProjectExisting && fixTarget.aiTestId && fixTarget.scenarioId
          ? extractScenarioCodeFromReply(res.data.reply)
          : null;

      const answer = {
        id: res.data.assistantMessageId || getNextId(),
        role: "assistant",
        timestamp: new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        content: res.data.reply,
        usedContext: res.data.context?.screenContext,
        ...(candidateCode
          ? {
              options: [
                {
                  label: "Apply Fix to Scenario",
                  action: "apply_integration_fix",
                  onClick: () => handleApplyIntegrationFix(fixTarget, candidateCode),
                },
              ],
            }
          : {}),
      };
      setMessages((m) => [...m, answer]);
      return true;
    } catch (err) {
      if (requestScope !== contextRequestRef.current) return;
      // A transport failure can hide a committed reply: reuse its ID to replay it.
      // A definite HTTP failure requires a new ID because failed requests are immutable.
      if (err.status) setMessages(previous => previous.map(message => message.id === userMsg.id ? { ...message, requestContext: { ...userMsg.requestContext, clientRequestId: crypto.randomUUID() } } : message));
      const isVi = detectChatLanguage(text) === "vi";
      setMessages(previous => [...previous, {
        id: getNextId(),
        role: "assistant",
        failed: true,
        timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
        content: isVi
          ? `Không thể phản hồi lúc này.\n\n${err.message || "Vui lòng thử lại sau giây lát."}`
          : `I couldn’t respond just now.\n\n${err.message || "Please try again in a moment."}`,
      }]);
      return false;
    } finally {
      sendRef.current = false;
      setIsTyping(false);
    }
  };

  const handleReviseMessage = async (message, editedText) => {
    if (sendRef.current || revisionRef.current || isLoadingSession || !activeSessionId || !message.savedMessageId) return false;
    revisionRef.current = true;
    setIsRevising(true);
    const scope = contextRequestRef.current;
    let branch;
    try {
      branch = await branchAiConversation(projectId, activeSessionId, {
        beforeMessageId: message.savedMessageId,
        snapshotId,
        useMemory: useProjectMemory,
      });
      if (scope !== contextRequestRef.current) return false;
      if (!branch?.id) throw new Error("Could not open a revised conversation.");
      if (!await handleSelectSession(branch.id, true, true)) return false;
      fetchSessions();
      if (editedText === undefined) {
        setDraftText(message.content);
        setDraftAttachments(message.attachments || []);
      }
    } catch (error) {
      showToast({ type: "error", title: "Unable to revise message", message: error.message });
      return false;
    } finally {
      revisionRef.current = false;
      setIsRevising(false);
    }
    if (editedText !== undefined) {
      handleSend(editedText, message.attachments || [], {
        sessionId: branch.id,
        snapshotId,
        useMemory: useProjectMemory,
        screenContext: normalizeChatScreenContext(screenContext),
        clientRequestId: crypto.randomUUID(),
      });
    }
    return true;
  };

  const chatBusy = isTyping || isRestoring || isLoadingSession || isRevising;

  return (
    <motion.div
      className="portfolio-studio flex flex-col h-full flex-shrink-0 relative overflow-hidden"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      style={{
        background: "var(--ps-bg)",
        borderLeft: "1px solid var(--ps-line)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* ── Top Header ──────────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-2 flex-shrink-0 px-3.5"
        style={{
          height: 48,
          borderBottom: "1px solid var(--ps-line)",
          background: "var(--ps-surface)",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <CovaiLogo size={20} />
          <div className="flex items-center gap-2 min-w-0">
            <span className="ps-display text-[13px] font-semibold text-[var(--ps-ink)]">
              COV
            </span>
            {activeSessionTitle && (
              <span
                title={activeSessionTitle}
                className="truncate hidden sm:inline-block text-[11px] ps-mono text-[var(--ps-ink-muted)] bg-[var(--ps-inset)] px-1.5 py-0.5 rounded border border-[var(--ps-line)] max-w-[130px]"
              >
                {activeSessionTitle}
              </span>
            )}
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            aria-label="What AI knows"
            disabled={isTyping || isRestoring || isLoadingSession}
            onClick={() => setContextDialog("context")}
            className="h-7 px-2 rounded-md border border-[var(--ps-line)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-2)] text-[11px] font-medium text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors cursor-pointer disabled:opacity-45"
          >
            Context
          </button>

          <button
            type="button"
            onClick={() => {
              if (!isHistoryOpen) fetchSessions();
              setIsHistoryOpen((prev) => !prev);
            }}
            disabled={isTyping || isRestoring || isLoadingSession}
            className={`h-7 px-2 rounded-md border text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-45 ${
              isHistoryOpen
                ? "border-[var(--ps-line-strong)] bg-[var(--ps-surface-2)] text-[var(--ps-ink)]"
                : "border-[var(--ps-line)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)]"
            }`}
            title="View chat history"
          >
            <History size={12} />
            <span>History</span>
            {sessions.length > 0 && (
              <span className="text-[10px] ps-mono px-1 rounded bg-[var(--ps-inset)] border border-[var(--ps-line)] text-[var(--ps-ink-muted)]">
                {sessions.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleNewChat()}
            disabled={isTyping || isRestoring || isLoadingSession}
            className="h-7 px-2 rounded-md border border-[var(--ps-line)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-2)] text-[11px] font-medium text-[var(--ps-ink)] inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-45"
            title="Start a new chat session"
          >
            <Plus size={12} />
            <span>New</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close AI Chatbot"
              title="Close AI Chatbot"
              className="w-7 h-7 rounded-md inline-flex items-center justify-center text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] hover:bg-[var(--ps-surface-2)] transition-colors cursor-pointer"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* ── Active Integration AI Fix Context Banner ── */}
      {integrationFixContext && (
        <div className="px-3.5 py-2 border-b border-[var(--ps-line)] bg-[var(--ps-inset)] flex items-center justify-between gap-2 text-[11px]">
          <div className="min-w-0 flex items-center gap-1.5">
            <span
              className="px-1.5 py-0.5 rounded ps-mono font-medium shrink-0 border"
              style={{
                background: "color-mix(in srgb, var(--ps-amber) 10%, transparent)",
                color: "var(--ps-amber)",
                borderColor: "color-mix(in srgb, var(--ps-amber) 25%, transparent)",
              }}
            >
              AI Fix
            </span>
            <span className="ps-mono text-[var(--ps-ink)] truncate">
              {integrationFixContext.endpointLabel}
            </span>
            <span className="text-[var(--ps-ink-muted)] truncate">
              · {integrationFixContext.testName}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIntegrationFixContext(null)}
            className="text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] cursor-pointer shrink-0"
            title="Clear AI Fix context"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <AnimatePresence>
        {isHistoryOpen && (
          <motion.div
            initial={{ opacity: 0, x: -280 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -280 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="absolute inset-0 z-30 flex flex-col"
            style={{
              background: "var(--color-surface)",
              boxShadow: "4px 0 24px rgba(0,0,0,0.15)",
            }}
          >
            {/* History Header */}
            <div
              className="flex items-center justify-between flex-shrink-0 px-3.5"
              style={{
                height: 48,
                borderBottom: "1px solid var(--color-border)",
                background: "var(--color-surface)",
              }}
            >
              <div className="flex items-center gap-2">
                <History size={15} style={{ color: "var(--color-primary)" }} />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--color-text)",
                  }}
                >
                  Chat History
                </span>
                {sessions.length > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: 10,
                      background: "var(--color-bg)",
                      color: "var(--color-text-secondary)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {sessions.length}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleNewChat()}
                  disabled={isTyping || isRestoring || isLoadingSession}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] ps-btn-contrast cursor-pointer disabled:opacity-45"
                  title="Start a new chat session"
                >
                  <Plus size={12} />
                  <span>New Chat</span>
                </button>
                <button
                  onClick={() => setIsHistoryOpen(false)}
                  className="p-1.5 rounded-md cursor-pointer hover:opacity-80 transition-colors"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--color-text-muted)",
                  }}
                  title="Close History"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Search Bar */}
            <div
              className="p-3 border-b flex-shrink-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                style={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <Search
                  size={13}
                  style={{ color: "var(--color-text-muted)", flexShrink: 0 }}
                />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  className="w-full bg-transparent outline-none"
                  style={{
                    fontSize: 12,
                    color: "var(--color-text)",
                  }}
                />
                {historySearchQuery && (
                  <button
                    onClick={() => setHistorySearchQuery("")}
                    className="p-0.5 cursor-pointer hover:opacity-80"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Sessions List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
              {isFetchingSessions ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted">
                  <Loader2
                    size={18}
                    className="animate-spin"
                    style={{ color: "var(--color-primary)" }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Loading history...
                  </span>
                </div>
              ) : filteredGroupedSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
                    style={{
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <MessageSquare
                      size={18}
                      style={{ color: "var(--color-text-muted)" }}
                    />
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      margin: 0,
                      color: "var(--color-text)",
                    }}
                  >
                    {historySearchQuery
                      ? "No matching conversations"
                      : "No conversation history yet"}
                  </p>
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-muted)",
                      marginTop: 4,
                      maxWidth: 240,
                    }}
                  >
                    {historySearchQuery
                      ? "Try searching with a different term"
                      : "Chats you have with COV will automatically appear here"}
                  </p>
                </div>
              ) : (
                filteredGroupedSessions.map((group) => (
                  <div key={group.label} className="space-y-1">
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "var(--color-text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        padding: "4px 8px",
                      }}
                    >
                      {group.label}
                    </div>
                    <div className="space-y-1">
                      {group.items.map((session) => {
                        const isActive = session.id === activeSessionId;
                        const isEditing = editingSessionId === session.id;
                        const lastMsg = session.messages?.[0]?.content || "";

                        return (
                          <div
                            key={session.id}
                            onClick={() =>
                              !isEditing && handleSelectSession(session.id)
                            }
                            className="group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all relative"
                            style={{
                              background: isActive
                                ? "var(--color-bg)"
                                : "transparent",
                              border: `1px solid ${
                                isActive ? "var(--color-border)" : "transparent"
                              }`,
                            }}
                            onMouseEnter={(e) => {
                              if (!isActive)
                                e.currentTarget.style.background =
                                  "var(--color-bg)";
                            }}
                            onMouseLeave={(e) => {
                              if (!isActive)
                                e.currentTarget.style.background =
                                  "transparent";
                            }}
                          >
                            <div className="flex items-start gap-2.5 min-w-0 flex-1 mr-2">
                              <MessageSquare
                                size={14}
                                className="mt-0.5 flex-shrink-0"
                                style={{
                                  color: isActive
                                    ? "var(--color-primary)"
                                    : "var(--color-text-muted)",
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                {isEditing ? (
                                  <form
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      handleSaveRenameSession(session.id);
                                    }}
                                    className="flex items-center gap-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      autoFocus
                                      type="text"
                                      value={editingTitle}
                                      onChange={(e) =>
                                        setEditingTitle(e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Escape")
                                          setEditingSessionId(null);
                                      }}
                                      className="w-full px-1.5 py-0.5 rounded text-xs outline-none"
                                      style={{
                                        background: "var(--color-surface)",
                                        border:
                                          "1px solid var(--color-primary)",
                                        color: "var(--color-text)",
                                      }}
                                    />
                                    <button
                                      type="submit"
                                      className="p-1 cursor-pointer hover:opacity-80"
                                      style={{ color: "var(--color-success)" }}
                                      title="Save"
                                    >
                                      <Check size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingSessionId(null)}
                                      className="p-1 cursor-pointer hover:opacity-80"
                                      style={{
                                        color: "var(--color-text-muted)",
                                      }}
                                      title="Cancel"
                                    >
                                      <X size={12} />
                                    </button>
                                  </form>
                                ) : (
                                  <>
                                    <div className="flex items-center justify-between gap-1">
                                      <span
                                        className="truncate"
                                        style={{
                                          fontSize: 12,
                                          fontWeight: isActive ? 600 : 500,
                                          color: isActive
                                            ? "var(--color-text)"
                                            : "var(--color-text-secondary)",
                                        }}
                                      >
                                        {session.title || "New Chat"}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: 10,
                                          color: "var(--color-text-muted)",
                                          flexShrink: 0,
                                        }}
                                      >
                                        {formatSessionTime(
                                          session.updatedAt ||
                                            session.createdAt,
                                        )}
                                      </span>
                                    </div>
                                    {lastMsg && (
                                      <div
                                        className="truncate"
                                        style={{
                                          fontSize: 11,
                                          color: "var(--color-text-muted)",
                                          marginTop: 2,
                                        }}
                                      >
                                        {lastMsg}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Actions on hover */}
                            {!isEditing && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                <button
                                  onClick={(e) =>
                                    handleStartRenameSession(session, e)
                                  }
                                  className="p-1 rounded cursor-pointer hover:opacity-80"
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    color: "var(--color-text-muted)",
                                  }}
                                  title="Rename conversation"
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button
                                  onClick={(e) =>
                                    handleDeleteSession(session.id, e)
                                  }
                                  className="p-1 rounded cursor-pointer hover:opacity-80"
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    color: "var(--color-danger, #ef4444)",
                                  }}
                                  title="Delete conversation"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
        {/* Welcome View when conversation has not started */}
        {messages.length === 1 && (
          <div className="my-auto py-3 space-y-5">
            {/* Airy Typography-led Greeting (shown once) */}
            <div className="px-1 space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] ps-mono text-[var(--ps-ink-muted)]">
                <CovaiLogo size={16} />
                <span>{chatScreenLabel(screenContext)}</span>
              </div>
              <h3 className="ps-display text-[17px] font-semibold text-[var(--ps-ink)] tracking-tight leading-snug">
                {chatGreeting(screenContext)}
              </h3>
              <p className="text-xs text-[var(--ps-ink-secondary)] leading-relaxed">
                Pick a starting prompt or ask anything below. Type <span className="ps-mono text-[var(--ps-cobalt)]">@</span> to attach a source file.
              </p>
            </div>

            {/* Screen-Specific Prompt Starters */}
            <div className="rounded-[10px] border border-[var(--ps-line)] bg-[var(--ps-surface)] divide-y divide-[var(--ps-line)] overflow-hidden">
              {(() => {
                const activity = screenContext?.activity;
                const testType = screenContext?.testType;
                if (activity === "projects-portfolio" || testType === "portfolio") {
                  return [
                    {
                      icon: Shield,
                      title: "Highest risk repositories",
                      desc: "Surface failing suites and thin testing layers across your portfolio",
                      prompt: "Which project in my portfolio needs attention first based on current failures and coverage gaps?",
                    },
                    {
                      icon: Zap,
                      title: "Summarize portfolio coverage gaps",
                      desc: "Compare Unit, API, and System E2E deficits across repositories",
                      prompt: "Summarize coverage gaps across my imported repositories across Unit, API, and System testing.",
                    },
                    {
                      icon: Sparkles,
                      title: "Prioritize next test runs",
                      desc: "Recommend which repository and layer to strengthen next",
                      prompt: "Recommend where to focus test generation first across my portfolio.",
                    },
                  ];
                }
                if (activity === "overview" || testType === "overview") {
                  const s = screenContext?.unifiedSummary;
                  return [
                    {
                      icon: Shield,
                      title: "Diagnose cross-layer failures",
                      desc: "Root-cause breakdown across Unit, API, and System E2E",
                      prompt: s
                        ? `Analyze our Unified Quality Overview and diagnose current failures.\n- Health Score: ${s.healthScore ?? "N/A"} (${s.healthGrade || "-"})\n- Tests: ${s.passedTests || 0}/${s.totalExecutedTests || 0} passed (${s.failedTests || 0} failed)\n- Coverage: ${s.overallCoveragePct ?? 0}% overall (Unit ${s.unitLinesPct ?? 0}%, API ${s.apiCoveragePct ?? 0}%, E2E ${s.systemFlowPct ?? 0}%)`
                        : "Analyze our Unified Quality Overview and diagnose current failures across Unit, Integration API, and System E2E suites.",
                    },
                    {
                      icon: Zap,
                      title: "Close API & branch coverage gaps",
                      desc: "Target uncovered routes and low-branch-coverage files",
                      prompt: `We have ${s?.uncoveredApis ?? 0} uncovered API endpoint(s) (API coverage ${s?.apiCoveragePct ?? 0}%) and Unit Line coverage at ${s?.unitLinesPct ?? 0}%. Recommend a prioritized test plan.`,
                    },
                    {
                      icon: Sparkles,
                      title: "Balance the Testing Pyramid",
                      desc: "Review Unit, API, and E2E ratios in the current snapshot",
                      prompt: `Evaluate our current Testing Pyramid distribution (${s?.pyramidShape || "current state"}) and suggest what to improve next.`,
                    },
                  ];
                }
                if (testType === "system") {
                  return [
                    {
                      icon: Shield,
                      title: "Diagnose failed E2E scenarios",
                      desc: "Inspect selector, timeout, and assertion failures on this run",
                      prompt: "Analyze the latest System Test results and explain the root causes of any failed or flaky E2E scenarios.",
                    },
                    {
                      icon: Workflow,
                      title: "Suggest missing user journeys",
                      desc: "Identify unverified end-to-end flows in this application",
                      prompt: "Review this project and suggest critical end-to-end Playwright user journeys we are still missing in System Test.",
                    },
                    {
                      icon: Sparkles,
                      title: "Explain System Test summary",
                      desc: "Break down scenario pass rate, execution mode, and stability",
                      prompt: "Summarize what the displayed System Test numbers and current snapshot evidence tell us.",
                    },
                  ];
                }
                if (testType === "integration") {
                  return [
                    {
                      icon: Layers,
                      title: "Find uncovered API endpoints",
                      desc: "Locate routes and HTTP handlers missing Supertest checks",
                      prompt: "Identify uncovered API endpoints in this project and suggest integration scenarios to cover them.",
                    },
                    {
                      icon: Shield,
                      title: "Debug failed endpoint assertions",
                      desc: "Trace route, middleware, controller, or database errors",
                      prompt: "Diagnose any failed API integration scenarios and explain which layer is causing them.",
                    },
                    {
                      icon: Sparkles,
                      title: "Strengthen error & auth paths",
                      desc: "Add negative status codes (400/401/403/404) for endpoints",
                      prompt: "Suggest negative and boundary-case Supertest integration tests (auth, validation, 404/409) for our endpoints.",
                    },
                  ];
                }
                if (testType === "unit") {
                  return [
                    {
                      icon: Wand2,
                      title: "Generate tests for uncovered files",
                      desc: "Propose unit test suites for files in this snapshot",
                      onClick: () => {
                        if (snapshotId && internalTree.length) {
                          const uncoveredFiles = flattenFiles(internalTree)
                            .map((file) => file.path)
                            .filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !isTestFile(path));
                          handleSuggestBulk({ uncoveredFiles });
                        } else {
                          handleSend("Identify uncovered source files and generate unit tests for them.");
                        }
                      },
                    },
                    {
                      icon: Zap,
                      title: "Explain low branch coverage",
                      desc: "Spot untested conditional paths and edge cases",
                      prompt: "Explain the unit coverage gaps and identify which branches or functions need unit tests most.",
                    },
                    {
                      icon: Shield,
                      title: "Analyze failing unit tests",
                      desc: "Inspect assertion errors from the latest unit run",
                      prompt: "Analyze any failing unit tests in the latest run and explain how to fix them.",
                    },
                  ];
                }
                return [
                  {
                    icon: FileCode,
                    title: screenContext?.filePath ? `Review ${getFileName(screenContext.filePath)}` : "Review active source code",
                    desc: "Check edge cases, error handling, and boundary inputs",
                    prompt: screenContext?.filePath
                      ? `Review ${screenContext.filePath} for edge cases, boundary conditions, and potential bugs.`
                      : "Analyze the project source code for critical edge cases and potential runtime bugs.",
                  },
                  {
                    icon: TestTube2,
                    title: screenContext?.filePath ? `Suggest unit tests for ${getFileName(screenContext.filePath)}` : "Suggest unit tests",
                    desc: "Generate focused test assertions for core logic",
                    prompt: screenContext?.filePath
                      ? `Suggest unit tests covering normal paths and edge cases for ${screenContext.filePath}.`
                      : "Suggest unit tests for the core functions and services in this project.",
                  },
                  {
                    icon: Zap,
                    title: "Explain workspace test status",
                    desc: "Summarize current structure and recommended next step",
                    prompt: "Summarize this project's structure and what tests we should run or improve next.",
                  },
                ];
              })().map((item) => {
                const IconComp = item.icon;
                return (
                  <button
                    key={item.title}
                    type="button"
                    onClick={item.onClick || (() => handleSend(item.prompt))}
                    className="group w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--ps-surface-2)]/70 transition-colors cursor-pointer"
                  >
                    <IconComp
                      size={14}
                      className="text-[var(--ps-ink-muted)] group-hover:text-[var(--ps-cobalt)] transition-colors shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-[var(--ps-ink)]">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-[var(--ps-ink-muted)] truncate">
                        {item.desc}
                      </div>
                    </div>
                    <ChevronRight
                      size={13}
                      className="text-[var(--ps-ink-muted)] group-hover:text-[var(--ps-ink)] transition-colors shrink-0"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Message Stream (avoid duplicating initial greeting on empty chat) */}
        <AnimatePresence>
          {messages.map((msg, index) => {
            if (messages.length === 1 && msg.isGreeting) {
              return null;
            }
            const canRevise = msg.role === "user" && msg.savedMessageId && access.can("chat.write");
            return (
            <ChatMessage
              key={msg.id}
              msg={msg.isGreeting ? { ...msg, content: chatGreeting(screenContext) } : msg}
              onEditMessage={canRevise ? text => handleReviseMessage(msg, text) : undefined}
              onUndoMessage={canRevise && !draftText && !draftAttachments.length ? () => handleReviseMessage(msg) : undefined}
              messageActionsBusy={chatBusy}
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
                index === messages.length - 1 && msg.role === "assistant" && !msg.testSuggestions && !msg.ideChanges
                  ? () => {
                      let userMsg = null;
                      for (let i = index - 1; i >= 0; i--) {
                        if (messages[i].role === "user") {
                          userMsg = messages[i];
                          break;
                        }
                      }
                      if (userMsg) {
                        handleSend(userMsg.content, userMsg.attachments || [], userMsg.requestContext || null, msg.failed ? userMsg.id : null);
                      }
                    }
                  : null
              }
            />
            );
          })}
          {isTyping && !messages.some(message => message.isRegenerating) && <TypingIndicator key="typing" />}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* ── Modern Prompt Input ──────────────────────────── */}
      <ChatInput
        onSend={handleSend}
        isTyping={chatBusy}
        isRevising={isRevising}
        input={draftText}
        setInput={setDraftText}
        attachments={draftAttachments}
        setAttachments={setDraftAttachments}
        fileTree={internalTree}
      />

      {/* ── Monaco Code Review Diff Modal ────────────────── */}
      {contextDialog && projectId && <AIContextDialog
        projectId={projectId} snapshotId={snapshotId} sessionId={activeSessionId} useMemory={useProjectMemory}
        screenContext={screenContext}
        initialTab={contextDialog} onNew={handleNewChat} onSelect={id => handleSelectSession(id, true)}
        onClose={() => {
          setContextDialog(null);
          fetchSessions();
          if (projectId && projectId !== "undefined") {
            getAiContext(projectId).then(config => setMemoryAvailable(config?.automaticMemory ?? false)).catch((err) => console.error("Unable to refresh AI context", err));
          }
        }}
      />}
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
