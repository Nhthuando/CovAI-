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
  Wand2,
  Shield,
  FileCode,
} from "lucide-react";

import {
  sendAiChatMessageApi,
  getAiSuggestionsApi,
  generateSkeletonApi,
  getFileContentApi,
  updateFileContentApi,
  createProjectFileApi,
} from "../../services/project.service";
import { suggestUnitTestcase } from "../../services/coverage.service";
import { getProjectJobsApi } from "../../services/job.service";
import { useToast } from "./ToastContext";
import FrameworkRecommendationPanel from "./FrameworkRecommendationPanel";
import SystemTestPanel from "./SystemTestPanel";

/* ── Initial conversation ───────────────────────────────── */
const INITIAL_MESSAGES = [
  {
    id: 1,
    role: "assistant",
    content:
      "Xin chào! Tôi là **AI Agent** của TestCovAI. Tôi đã được kết nối với API backend.\n\nBạn có câu hỏi nào về source code hoặc cần gợi ý test case không?",
    timestamp: new Date().toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  },
];

/* ── Code Block ─────────────────────────────────────────── */
function CodeBlock({ code, language = "javascript" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="relative mt-3 rounded-xl overflow-hidden group/code"
      style={{ border: "1px solid rgba(124,58,237,0.2)" }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{
          background: "rgba(124,58,237,0.06)",
          borderBottom: "1px solid rgba(124,58,237,0.12)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#f85149",
            }}
          />
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#d29922",
            }}
          />
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#3fb950",
            }}
          />
          <span
            style={{
              color: "#484f58",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              marginLeft: 4,
              letterSpacing: "0.04em",
            }}
          >
            {language}
          </span>
        </div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleCopy}
          className="flex items-center gap-1 opacity-0 group-hover/code:opacity-100 px-2 py-1 rounded-md"
          style={{
            color: copied ? "#4ade80" : "#6e7681",
            fontSize: 10,
            fontFamily: "var(--font-sans)",
            background: "rgba(255,255,255,0.04)",
            transition: "all 0.2s ease",
            cursor: "pointer",
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied!" : "Copy"}
        </motion.button>
      </div>
      <pre
        className="overflow-x-auto"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          lineHeight: 1.75,
          padding: "12px 14px",
          background: "rgba(0,0,0,0.45)",
          color: "#86efac",
          margin: 0,
        }}
      >
        {code}
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

  const [activeFw, setActiveFw] = useState(
    suggestions[0]?.framework || "jest"
  );

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
        border: "1px solid rgba(168, 85, 247, 0.3)",
        background: "rgba(168, 85, 247, 0.05)",
      }}
    >
      {/* Framework Tabs if multi-framework (Jest & Vitest) */}
      {isMulti && (
        <div
          className="flex items-center gap-1.5 px-3 py-2 flex-wrap"
          style={{
            background: "rgba(0,0,0,0.35)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <span className="text-[11px] font-semibold text-slate-400 mr-1">
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
                    ? isVitest
                      ? "rgba(245, 158, 11, 0.25)"
                      : "rgba(124, 58, 237, 0.3)"
                    : "rgba(255, 255, 255, 0.05)",
                  color: isSelected
                    ? isVitest
                      ? "#fcd34d"
                      : "#c084fc"
                    : "#94a3b8",
                  border: isSelected
                    ? isVitest
                      ? "1px solid rgba(245, 158, 11, 0.5)"
                      : "1px solid rgba(124, 58, 237, 0.6)"
                    : "1px solid transparent",
                }}
              >
                <span>{isVitest ? "⚡ Vitest" : "🃏 Jest"}</span>
                {sug.applied && (
                  <Check size={11} className="text-green-400" />
                )}
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
                background: "rgba(34, 197, 94, 0.15)",
                color: "#86efac",
                border: "1px solid rgba(34, 197, 94, 0.35)",
              }}
              title="Tự động áp dụng test case cho cả Jest và Vitest"
            >
              <Sparkles size={11} />
              <span>Apply cả 2</span>
            </button>
          )}
        </div>
      )}

      {/* Target test file info bar */}
      <div
        className="flex items-center justify-between px-3 py-2 text-xs"
        style={{
          background:
            current.framework === "vitest"
              ? "rgba(245, 158, 11, 0.12)"
              : "rgba(168, 85, 247, 0.12)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div className="flex items-center gap-1.5 overflow-hidden">
          <FileCode
            size={13}
            style={{
              color: current.framework === "vitest" ? "#fbbf24" : "#c084fc",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: current.framework === "vitest" ? "#fbbf24" : "#c084fc",
              fontWeight: 600,
            }}
          >
            {current.framework === "vitest" ? "VITEST" : "JEST"} Test:
          </span>
          <span
            className="truncate font-mono"
            style={{ color: "#e6edf3", fontSize: 11 }}
          >
            {current.targetTestFile}
          </span>
        </div>
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{
            background: current.isExisting
              ? "rgba(59, 130, 246, 0.2)"
              : "rgba(34, 197, 94, 0.2)",
            color: current.isExisting ? "#93c5fd" : "#86efac",
          }}
        >
          {current.isExisting ? "File có sẵn" : "File mới"}
        </span>
      </div>

      {/* Code block */}
      <CodeBlock
        code={current.suggestedTestCode}
        language="javascript"
      />

      {/* Actions footer */}
      <div
        className="p-3 flex items-center gap-2 flex-wrap"
        style={{
          background: "rgba(0,0,0,0.25)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
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
              background:
                current.framework === "vitest" ? "#d97706" : "#7c3aed",
              color: "#ffffff",
              border: "none",
              cursor: current.isApplying ? "wait" : "pointer",
              boxShadow:
                current.framework === "vitest"
                  ? "0 0 12px rgba(217, 119, 6, 0.35)"
                  : "0 0 12px rgba(124, 58, 237, 0.35)",
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
                background: "rgba(34, 197, 94, 0.15)",
                color: "#4ade80",
                border: "1px solid rgba(34, 197, 94, 0.3)",
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
                background: "rgba(255, 255, 255, 0.05)",
                color: "#e6edf3",
                border: "1px solid rgba(255, 255, 255, 0.15)",
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
                  background: "rgba(124, 58, 237, 0.2)",
                  color: "#c4b5fd",
                  border: "1px solid rgba(124, 58, 237, 0.4)",
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

/* ── Chat Message ────────────────────────────────────────── */
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

  const handleAction = (label) => {
    if (label === "Copy" || label === "Copied") {
      navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else if (label === "Retry" && onRetry) {
      onRetry();
    }
  };

  const renderContent = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} style={{ color: "#e6edf3", fontWeight: 600 }}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={i}
            style={{
              fontFamily: "var(--font-mono)",
              background: "rgba(124,58,237,0.15)",
              padding: "1px 5px",
              borderRadius: 4,
              fontSize: "0.87em",
              color: "#c4b5fd",
            }}
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative"
    >
      {/* Avatar + Name row */}
      <div className="flex items-center gap-2 mb-1.5" style={{ fontSize: 11 }}>
        <div
          className="flex items-center justify-center rounded-full flex-shrink-0"
          style={{
            width: 20,
            height: 20,
            background: isUser
              ? "rgba(124,58,237,0.2)"
              : msg.type === "error" || msg.type === "quota"
                ? "rgba(248,113,113,0.15)"
                : "linear-gradient(135deg, rgba(124,58,237,0.35), rgba(34,211,238,0.15))",
            border: `1px solid ${isUser ? "rgba(124,58,237,0.3)" : msg.type === "error" || msg.type === "quota" ? "rgba(248,113,113,0.3)" : "rgba(34,211,238,0.2)"}`,
            boxShadow: isUser
              ? "none"
              : msg.type === "error" || msg.type === "quota"
                ? "0 0 8px rgba(248,113,113,0.15)"
                : "0 0 8px rgba(34,211,238,0.1)",
          }}
        >
          {isUser ? (
            <User size={10} style={{ color: "#a78bfa" }} />
          ) : msg.type === "error" || msg.type === "quota" ? (
            <Shield size={10} style={{ color: "#f87171" }} />
          ) : (
            <Bot size={10} style={{ color: "#67e8f9" }} />
          )}
        </div>
        <span
          style={{
            fontWeight: 500,
            color: isUser
              ? "#8b949e"
              : msg.type === "error" || msg.type === "quota"
                ? "#f87171"
                : "#67e8f9",
            fontFamily: "var(--font-sans)",
          }}
        >
          {isUser ? "You" : "AI Agent"}
        </span>
        <span
          style={{
            color: "#30363d",
            marginLeft: "auto",
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
            marginLeft: 28,
            background: "rgba(248,113,113,0.04)",
            border: "1px solid rgba(248,113,113,0.2)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div
            style={{
              height: 3,
              background: "linear-gradient(90deg, #f87171, #fb923c)",
            }}
          />
          <div style={{ padding: "16px 20px" }}>
            <h4
              style={{
                color: "#f87171",
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
            <p style={{ color: "#e6edf3", fontSize: 13, lineHeight: 1.6 }}>
              Bạn đã vượt quá giới hạn lượt chat miễn phí hôm nay để đảm bảo
              chất lượng máy chủ.
            </p>
            <p
              style={{
                color: "#8b949e",
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
          className="relative rounded-xl"
          style={{
            marginLeft: 28,
            padding: "10px 13px",
            background: isUser
              ? "rgba(255,255,255,0.025)"
              : "rgba(124,58,237,0.04)",
            border: `1px solid ${isUser ? "rgba(255,255,255,0.06)" : "rgba(124,58,237,0.1)"}`,
            backdropFilter: isUser ? "none" : "blur(12px)",
          }}
        >
          <div
            className="text-xs space-y-1.5"
            style={{
              color: isUser ? "#c9d1d9" : "#e6edf3",
              lineHeight: 1.65,
              fontFamily: "var(--font-sans)",
            }}
          >
            {msg.content.split("\n").map((line, i) => (
              <p key={i} className={line === "" ? "h-2" : ""}>
                {line === "" ? null : renderContent(line)}
              </p>
            ))}
          </div>

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

          {msg.suggestion && (
            <div
              className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg"
              style={{
                background: "rgba(63,185,80,0.05)",
                border: "1px solid rgba(63,185,80,0.15)",
                color: "#3fb950",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              <span className="flex-shrink-0 mt-0.5">💡</span>
              <span>{msg.suggestion}</span>
            </div>
          )}

          {msg.options && (
            <div
              className="flex gap-3"
              style={{
                marginTop: "16px",
                marginBottom: "8px",
                flexWrap: "wrap",
              }}
            >
              {msg.options.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => opt.onClick && opt.onClick(opt.action)}
                  className="flex-1 rounded-lg transition-colors hover:bg-[rgba(124,58,237,0.2)]"
                  style={{
                    padding: "10px 12px",
                    background: "rgba(124,58,237,0.1)",
                    border: "1px solid rgba(124,58,237,0.3)",
                    color: "#e6edf3",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Hover actions */}
          <AnimatePresence>
            {hovered && !isUser && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.12 }}
                className="absolute -bottom-3 right-2 flex gap-1"
                style={{ zIndex: 10 }}
              >
                {[
                  {
                    icon: copied ? Check : Copy,
                    label: copied ? "Copied" : "Copy",
                  },
                  { icon: RotateCcw, label: "Retry" },
                ].map(({ icon: Icon, label }) => (
                  <motion.button
                    key={label}
                    whileTap={{ scale: 0.9 }}
                    title={label}
                    onClick={() => handleAction(label)}
                    className="flex items-center gap-1.5 rounded-md text-xs cursor-pointer"
                    style={{
                      padding: "6px 10px",
                      background: "#161b22",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color:
                        copied && label === "Copied" ? "#4ade80" : "#6e7681",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    <Icon size={11} />
                    {label}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

/* ── Typing Indicator ────────────────────────────────────── */
function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
    >
      <div className="flex items-center gap-2 mb-1.5" style={{ fontSize: 11 }}>
        <div
          className="flex items-center justify-center rounded-full flex-shrink-0"
          style={{
            width: 20,
            height: 20,
            background:
              "linear-gradient(135deg, rgba(124,58,237,0.35), rgba(34,211,238,0.15))",
            border: "1px solid rgba(34,211,238,0.2)",
          }}
        >
          <Bot size={10} style={{ color: "#67e8f9" }} />
        </div>
        <span
          style={{
            color: "#67e8f9",
            fontSize: 11,
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
          }}
        >
          AI Agent
        </span>
        <span style={{ color: "#484f58", fontSize: 10 }}>thinking…</span>
      </div>
      <div
        className="flex items-center gap-1.5 px-4 py-3 rounded-xl"
        style={{
          marginLeft: 28,
          background: "rgba(124,58,237,0.04)",
          border: "1px solid rgba(124,58,237,0.1)",
          backdropFilter: "blur(12px)",
          width: "max-content",
        }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ scale: [1, 1.6, 1], opacity: [0.3, 1, 0.3] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              delay: i * 0.22,
              ease: "easeInOut",
            }}
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#a78bfa",
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

/* ── Chat Input ──────────────────────────────────────────── */
function ChatInput({ onSend, isTyping }) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef(null);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, []);

  useEffect(() => autoResize(), [input, autoResize]);

  const handleSend = () => {
    if (!input.trim() || isTyping) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = input.trim() && !isTyping;

  return (
    <div className="flex-shrink-0" style={{ padding: "10px 24px 20px" }}>
      <div
        className="relative rounded-2xl overflow-hidden transition-all duration-300"
        style={{
          background: "#21252B",
          border: `1.5px solid ${focused ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.08)"}`,
          boxShadow: focused
            ? "0 0 0 3px rgba(124,58,237,0.08), 0 0 24px rgba(124,58,237,0.12)"
            : "0 2px 10px rgba(0,0,0,0.4)",
        }}
      >
        {/* Spinning gradient ring when AI is thinking */}
        <AnimatePresence>
          {isTyping && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute -inset-[1.5px] rounded-2xl pointer-events-none overflow-hidden"
              style={{ zIndex: 0 }}
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent 0deg, #7c3aed 120deg, #22d3ee 200deg, transparent 360deg)",
                  filter: "blur(5px)",
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div
          className="relative z-10 overflow-hidden"
          style={{
            background: "#0d1117",
            borderRadius: "calc(1rem - 1.5px)",
          }}
        >
          <textarea
            ref={textareaRef}
            id="ai-chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ask TestCovAI anything..."
            rows={1}
            className="w-full resize-none outline-none bg-transparent text-sm"
            style={{
              padding: "16px 16px 8px 16px",
              fontFamily: "var(--font-sans)",
              color: "#e6edf3",
              fontSize: 13,
              lineHeight: 1.5,
              maxHeight: 120,
              caretColor: "#a78bfa",
            }}
          />

          {/* Actions row */}
          <div
            className="flex items-center justify-end"
            style={{ padding: "4px 16px 12px 16px" }}
          >
            <motion.button
              whileHover={canSend ? { scale: 1.08 } : {}}
              whileTap={canSend ? { scale: 0.92 } : {}}
              onClick={handleSend}
              disabled={!canSend}
              className="flex items-center justify-center rounded-full transition-all duration-200"
              style={{
                width: 28,
                height: 28,
                background: canSend ? "#7c3aed" : "rgba(255,255,255,0.05)",
                color: canSend ? "#fff" : "#484f58",
                cursor: canSend ? "pointer" : "not-allowed",
                border: "none",
                boxShadow: canSend ? "0 0 14px rgba(124,58,237,0.4)" : "none",
              }}
              id="ai-send-btn"
            >
              {isTyping ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <ArrowUp size={14} strokeWidth={2.5} />
              )}
            </motion.button>
          </div>
        </div>
      </div>

      <div
        className="mt-1.5 text-center"
        style={{
          color: "#30363d",
          fontSize: 10,
          fontFamily: "var(--font-sans)",
        }}
      >
        Enter ↵ to send · Shift+Enter for new line
      </div>
    </div>
  );
}

/* ── Quick Actions ───────────────────────────────────────── */
function QuickActions({ onAction }) {
  const actions = [
    { label: "Analyze Coverage", icon: Shield, color: "#a78bfa" },
    { label: "View Generated Tests", icon: Wand2, color: "#67e8f9" },
    { label: "Suggest Unit Test", icon: Sparkles, color: "#c084fc" },
  ];
  return (
    <div
      className="flex gap-3 flex-shrink-0"
      style={{
        padding: "8px 24px 12px",
        flexWrap: "wrap",
      }}
    >
      {actions.map(({ label, icon: Icon, color }) => (
        <motion.button
          key={label}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => onAction(label)}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl text-xs"
          style={{
            padding: "10px 14px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "#6e7681",
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
            transition: "all 0.2s ease",
            whiteSpace: "nowrap",
          }}
        >
          <Icon size={14} style={{ color }} />
          {label}
        </motion.button>
      ))}
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
  const bottomRef = useRef(null);
  const messageIdRef = useRef(10);
  const getNextId = () => ++messageIdRef.current;
  const { showToast } = useToast();

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
        message: "Vui lòng chọn hoặc tạo một dự án trước khi sử dụng AI.",
      });
      return;
    }

    const userMsg = {
      id: getNextId(),
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString("vi-VN", {
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
      const res = await sendAiChatMessageApi(projectId, text, currentHistory);

      setMessages((m) => [
        ...m,
        {
          id: getNextId(),
          role: "assistant",
          timestamp: new Date().toLocaleTimeString("vi-VN", {
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
            type: "quota",
            timestamp: new Date().toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            content: "",
          },
        ]);
      } else {
        showToast({
          type: "error",
          title: "Lỗi AI",
          message: "Không thể gọi API Chat, vui lòng thử lại.",
        });
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
            content:
              "❌ Lỗi khi kết nối với backend API. Vui lòng kiểm tra lại log server.",
          },
        ]);
      }
    } finally {
      setIsTyping(false);
    }
  };

  const handleQuickAction = async (label) => {
    if (label === "Suggest Unit Test") {
      handleSend(
        "Hãy gợi ý các test case Jest/Vitest cho những file có độ bao phủ thấp trong dự án.",
      );
      return;
    }

    if (label === "Analyze Coverage") {
      onRunAnalysis?.();
      return;
    }

    if (label === "View Generated Tests") {
      if (!projectId) {
        showToast({
          type: "warning",
          title: "No Project",
          message: "Vui lòng chọn một dự án.",
        });
        return;
      }
      setIsTyping(true);
      try {
        const res = await getAiSuggestionsApi(projectId);
        if (res.data && res.data.tests && res.data.tests.length > 0) {
          setMessages((m) => [
            ...m,
            {
              id: getNextId(),
              role: "assistant",
              timestamp: new Date().toLocaleTimeString("vi-VN", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              content: `**Tôi đã tìm thấy các bộ test đã được generate.**`,
              options: [
                {
                  label: "View Generated Tests",
                  action: "view",
                  onClick: () => {
                    res.data.tests.forEach((test, index) => {
                      setMessages((prev) => [
                        ...prev,
                        {
                          id: getNextId(),
                          role: "assistant",
                          timestamp: new Date().toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                          content: `**Test Suite ${index + 1}: ${test.name}**\n${test.description || ""}`,
                          code: test.code,
                        },
                      ]);
                    });
                  },
                },
              ],
            },
          ]);
        } else {
          setMessages((m) => [
            ...m,
            {
              id: getNextId(),
              role: "assistant",
              timestamp: new Date().toLocaleTimeString("vi-VN", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              content:
                "Chưa có bộ test nào được tạo tự động cho dự án này. Hãy bấm **Suggest testcase** tại danh sách Source file coverage.",
            },
          ]);
        }
      } catch (err) {
        console.error(err);
        showToast({
          type: "error",
          title: "Lỗi tải test",
          message: "Không thể lấy danh sách test đã generate.",
        });
      } finally {
        setIsTyping(false);
      }
    }
  };

  return (
    <motion.div
      className="flex flex-col h-full overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        background: "var(--ide-sidebar)",
        borderLeft: "1px solid var(--ide-border)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* ── Messages Scroll Area ─────────────────────── */}
      <div
        className="flex-1 overflow-y-auto flex flex-col"
        style={{
          gap: 24,
          padding: "24px 24px",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(124,58,237,0.25) transparent",
        }}
      >
        <FrameworkRecommendationPanel
          projectId={projectId}
          snapshotId={snapshotId}
        />
        <SystemTestPanel projectId={projectId} snapshotId={snapshotId} />
        <AnimatePresence>
          {messages.map((msg, index) => (
            <ChatMessage
              key={msg.id}
              msg={msg}
              onApplySuggestion={handleApplySuggestion}
              onUndoSuggestion={handleUndoSuggestion}
              onApplyAllSuggestions={handleApplyAllSuggestions}
              onRunAnalysis={onRunAnalysis}
              onRetry={() => {
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
              }}
            />
          ))}
          {isTyping && <TypingIndicator key="typing" />}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* ── Quick Actions ───────────────────────────── */}
      <QuickActions onAction={handleQuickAction} />

      {/* ── Floating Input ─────────────────────────── */}
      <ChatInput onSend={handleSend} isTyping={isTyping} />
    </motion.div>
  );
}
