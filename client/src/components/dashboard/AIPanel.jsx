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
              title="Tự động áp dụng test case cho cả Jest và Vitest"
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
          {current.isExisting ? "File có sẵn" : "File mới"}
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
            title={`Ghi test case ${current.framework?.toUpperCase()} vào ${current.targetTestFile}`}
          >
            {current.isApplying ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Check size={13} />
            )}
            <span>Apply vào {current.targetTestFile}</span>
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
              <span>Đã apply ({current.framework?.toUpperCase()})</span>
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
              title="Hoàn tác file test về trạng thái trước khi Apply"
            >
              {current.isUndoing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RotateCcw size={13} />
              )}
              <span>Undo (Hoàn tác)</span>
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
                title="Chạy lại Unit Test Coverage để xác nhận độ bao phủ tăng"
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
              Bạn đã vượt quá giới hạn lượt chat miễn phí hôm nay để đảm bảo
              chất lượng máy chủ.
            </p>
            <p
              style={{
                color: "var(--color-text-secondary)",
                fontSize: 12,
                marginTop: 10,
                fontStyle: "italic",
              }}
            >
              Hãy quay lại vào ngày mai nhé! Cảm ơn bạn đã sử dụng hệ thống.
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

          {/* AI Unit Test Suggestion Card (supports Jest & Vitest) */}
          {(msg.testSuggestions?.length > 0 || msg.testSuggestion) && (
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
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const bottomRef = useRef(null);
  const messageIdRef = useRef(10);
  const getNextId = () => ++messageIdRef.current;
  const { showToast } = useToast();

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
        message: "Vui lòng chọn hoặc tạo một dự án trước khi sử dụng AI.",
      });
      return;
    }

    const isTest = isTestFile(filePath);

    const userMsg = {
      id: getNextId(),
      role: "user",
      content: isTest
        ? `✨ Hãy gợi ý test case bổ sung cho file test \`${filePath}\``
        : `✨ Hãy gợi ý test case Jest & Vitest cho file \`${filePath}\``,
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
        throw new Error("Không nhận được dữ liệu gợi ý test case từ server.");
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
          `Tôi đã phân tích file **\`${data.sourceFile || filePath}\`** và đề xuất bộ test cho cả **Jest** và **Vitest**:\n\n` +
          suggestionsList
            .map(
              (s) =>
                `- **${s.framework?.toUpperCase()}**: file \`${s.targetTestFile}\` (${s.isExisting ? "Đã có sẵn - sẽ cập nhật" : "File mới"})`,
            )
            .join("\n") +
          `\n- **Dòng chưa cover**: ${data.uncoveredLines?.length ? data.uncoveredLines.join(", ") : "100% dòng đã được kiểm thử"}\n` +
          `- **Lỗi assertion**: ${data.failedLines?.length ? data.failedLines.join(", ") : "0 lỗi"}\n\n` +
          `Bạn có thể chuyển đổi giữa các tab **JEST** và **VITEST** bên dưới để xem mã test và bấm **Apply** vào từng file test tương ứng (hoặc bấm **Apply cả 2**)!`;
      } else {
        const single = suggestionsList[0];
        summaryText = isTest
          ? `Tôi đã phân tích và đề xuất bổ sung test case cho file test **\`${single.targetTestFile}\`** (${single.framework?.toUpperCase()}):\n\n` +
            (single.sourceFile && single.sourceFile !== single.targetTestFile
              ? `- **File mã nguồn tương ứng**: \`${single.sourceFile}\`\n`
              : "") +
            `- **Dòng chưa cover trong mã nguồn**: ${data.uncoveredLines?.length ? data.uncoveredLines.join(", ") : "100% dòng đã được kiểm thử"}\n` +
            `- **Lỗi assertion**: ${data.failedLines?.length ? data.failedLines.join(", ") : "0 lỗi"}\n` +
            `- **File test**: \`${single.targetTestFile}\` (${single.isExisting ? "Đã có sẵn - sẽ cập nhật test case" : "File mới"})\n\n` +
            `${single.explanation}`
          : `Tôi đã phân tích file **\`${single.sourceFile}\`** (${single.framework?.toUpperCase()}):\n\n` +
            `- **Dòng chưa cover**: ${data.uncoveredLines?.length ? data.uncoveredLines.join(", ") : "100% dòng đã được kiểm thử"}\n` +
            `- **Lỗi assertion**: ${data.failedLines?.length ? data.failedLines.join(", ") : "0 lỗi"}\n` +
            `- **File test đích**: \`${single.targetTestFile}\` (${single.isExisting ? "Đã có sẵn - sẽ nối thêm" : "File mới"})\n\n` +
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
          content: `❌ Lỗi khi gợi ý testcase cho \`${filePath}\`: ${err.message || "Không thể kết nối API AI."}`,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  // Watch for external suggest trigger (e.g. from Coverage table or Editor)
  useEffect(() => {
    if (!pendingAiSuggestion || !pendingAiSuggestion.filePath) return;
    const targetFile = pendingAiSuggestion.filePath;
    onClearPendingSuggestion?.();
    handleSuggestForFile(targetFile);
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
        message: `Đã áp dụng test case ${suggestion.framework?.toUpperCase()} vào ${suggestion.targetTestFile}`,
      });

      onOpenFile?.(suggestion.targetTestFile);
    } catch (err) {
      showToast({
        type: "error",
        title: "Apply Failed",
        message: err.message || "Không thể áp dụng test case vào file.",
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
        message: `Đã hoàn tác file ${suggestion.targetTestFile} về trạng thái trước đó.`,
      });

      onOpenFile?.(suggestion.targetTestFile);
    } catch (err) {
      showToast({
        type: "error",
        title: "Undo Failed",
        message: err.message || "Không thể hoàn tác file test.",
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
    </motion.div>
  );
}
