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
} from "../../services/project.service";
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
        background: "#090d13",
        border: "1px solid rgba(255, 255, 255, 0.09)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      }}
    >
      {/* Code Header Bar */}
      <div
        className="flex items-center justify-between px-3.5 py-2"
        style={{
          background: "rgba(255, 255, 255, 0.03)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#ff5f56",
                display: "inline-block",
              }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#ffbd2e",
                display: "inline-block",
              }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#27c93f",
                display: "inline-block",
              }}
            />
          </div>
          <span
            style={{
              color: "#8b949e",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              marginLeft: 6,
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
            color: copied ? "#4ade80" : "#8b949e",
            background: copied
              ? "rgba(34, 197, 94, 0.1)"
              : "rgba(255, 255, 255, 0.04)",
            border: copied
              ? "1px solid rgba(34, 197, 94, 0.3)"
              : "1px solid rgba(255, 255, 255, 0.08)",
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
          color: "#e6edf3",
        }}
      >
        <code>{code}</code>
      </pre>
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
          <strong key={idx} style={{ color: "#f0f6fc", fontWeight: 600 }}>
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
              background: "rgba(124, 58, 237, 0.15)",
              color: "#c4b5fd",
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: "0.9em",
              border: "1px solid rgba(124, 58, 237, 0.25)",
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
                    className="font-semibold text-white pt-1 text-sm flex items-center gap-1.5"
                  >
                    <span className="text-purple-400">#</span>
                    {renderInline(trimmed.slice(4))}
                  </h4>
                );
              }

              if (trimmed.startsWith("## ")) {
                return (
                  <h3
                    key={lIdx}
                    className="font-bold text-white pt-2 text-base"
                  >
                    {renderInline(trimmed.slice(3))}
                  </h3>
                );
              }

              if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                return (
                  <div
                    key={lIdx}
                    className="flex items-start gap-2 pl-1 text-[#c9d1d9]"
                  >
                    <span
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: "50%",
                        background: "#a78bfa",
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
                    className="flex items-start gap-2 pl-1 text-[#c9d1d9]"
                  >
                    <span
                      style={{
                        color: "#a78bfa",
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
                  className="m-0 text-[#c9d1d9]"
                  style={{
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
function ChatMessage({ msg, onRetry }) {
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
              ? "rgba(124, 58, 237, 0.25)"
              : "linear-gradient(135deg, rgba(124,58,237,0.4), rgba(34,211,238,0.2))",
            border: isUser
              ? "1px solid rgba(124, 58, 237, 0.4)"
              : "1px solid rgba(124, 58, 237, 0.5)",
            boxShadow: isUser ? "none" : "0 0 10px rgba(124, 58, 237, 0.25)",
          }}
        >
          {isUser ? (
            <User size={11} style={{ color: "#c4b5fd" }} />
          ) : (
            <Bot size={11} style={{ color: "#67e8f9" }} />
          )}
        </div>

        <span
          style={{
            fontWeight: 600,
            color: isUser ? "#c4b5fd" : "#e6edf3",
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
              background: "rgba(124, 58, 237, 0.2)",
              color: "#a78bfa",
              letterSpacing: "0.04em",
            }}
          >
            AI
          </span>
        )}

        <span
          style={{
            color: "#6e7681",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
          }}
        >
          {msg.timestamp}
        </span>
      </div>

      {/* Message Bubble */}
      <div
        className="relative group rounded-2xl min-w-0"
        style={{
          maxWidth: isUser ? "85%" : "100%",
          padding: isUser ? "10px 15px" : "14px 18px",
          background: isUser
            ? "rgba(124, 58, 237, 0.16)"
            : "rgba(22, 27, 34, 0.7)",
          border: isUser
            ? "1px solid rgba(124, 58, 237, 0.35)"
            : "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
          boxShadow: isUser
            ? "0 2px 10px rgba(124, 58, 237, 0.1)"
            : "0 4px 16px rgba(0, 0, 0, 0.3)",
          backdropFilter: "blur(10px)",
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
                  background: "rgba(124, 58, 237, 0.12)",
                  border: "1px solid rgba(124, 58, 237, 0.35)",
                  color: "#c4b5fd",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(124, 58, 237, 0.25)";
                  e.currentTarget.style.borderColor = "#a78bfa";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(124, 58, 237, 0.12)";
                  e.currentTarget.style.borderColor =
                    "rgba(124, 58, 237, 0.35)";
                }}
              >
                <Sparkles size={11} />
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Hover Actions (Copy / Retry) */}
        {!isUser && hovered && (
          <div
            className="absolute -bottom-3 right-3 flex items-center gap-1 px-1.5 py-0.5 rounded-md"
            style={{
              background: "#161b22",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
              zIndex: 10,
            }}
          >
            <button
              onClick={handleCopy}
              title="Copy message"
              style={{
                background: "transparent",
                border: "none",
                color: copied ? "#4ade80" : "#8b949e",
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
                  color: "#8b949e",
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
            background:
              "linear-gradient(135deg, rgba(124,58,237,0.4), rgba(34,211,238,0.2))",
            border: "1px solid rgba(124, 58, 237, 0.5)",
          }}
        >
          <Bot size={11} style={{ color: "#67e8f9" }} />
        </div>
        <span style={{ fontWeight: 600, color: "#e6edf3", fontSize: 12 }}>
          COV
        </span>
        <span style={{ color: "#8b949e", fontSize: 11 }}>thinking…</span>
      </div>

      <div
        className="flex items-center gap-1.5 px-4 py-3 rounded-2xl"
        style={{
          background: "rgba(22, 27, 34, 0.7)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
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
              background: "#a78bfa",
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
              background: "#161b22",
              border: "1px solid rgba(124, 58, 237, 0.35)",
              borderRadius: 12,
              boxShadow:
                "0 12px 32px rgba(0, 0, 0, 0.7), 0 0 16px rgba(124, 58, 237, 0.2)",
              padding: "6px",
              zIndex: 50,
              backdropFilter: "blur(12px)",
            }}
          >
            <div className="px-2.5 py-1.5 text-[10px] font-semibold tracking-wider text-[#8b949e] uppercase border-b border-white/5 flex items-center justify-between">
              <span>Select AI Model</span>
              <span className="text-purple-400 font-mono">COV Multi-LLM</span>
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
                        ? "rgba(124, 58, 237, 0.18)"
                        : "transparent",
                      border: isSelected
                        ? "1px solid rgba(124, 58, 237, 0.35)"
                        : "1px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background =
                          "rgba(255, 255, 255, 0.04)";
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
                            color: "#e6edf3",
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
                          color: "#8b949e",
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
                        className="text-purple-400 flex-shrink-0 mt-0.5"
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
          background: "rgba(18, 22, 29, 0.95)",
          border: focused
            ? "1.5px solid #7c3aed"
            : "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow: focused
            ? "0 0 0 3px rgba(124, 58, 237, 0.15), 0 8px 24px rgba(0, 0, 0, 0.5)"
            : "0 4px 16px rgba(0, 0, 0, 0.3)",
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
            color: "#e6edf3",
            fontSize: 13,
            lineHeight: "20px",
            height: "24px",
            maxHeight: 160,
            caretColor: "#a78bfa",
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
                ? "rgba(124, 58, 237, 0.2)"
                : "rgba(255, 255, 255, 0.05)",
              border: modelMenuOpen
                ? "1px solid rgba(124, 58, 237, 0.4)"
                : "1px solid rgba(255, 255, 255, 0.08)",
              fontSize: 11,
              color: "#e6edf3",
            }}
            title="Switch AI Model"
          >
            <Sparkles
              size={11}
              style={{ color: selectedModel?.badgeColor || "#a78bfa" }}
            />
            <span style={{ fontWeight: 500 }}>
              {selectedModel?.name || "Gemini 1.5 Pro"}
            </span>
            <ChevronDown
              size={12}
              style={{
                color: "#8b949e",
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
              background: canSend
                ? "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)"
                : "rgba(255, 255, 255, 0.05)",
              color: canSend ? "#fff" : "#484f58",
              border: canSend ? "none" : "1px solid rgba(255, 255, 255, 0.06)",
              boxShadow: canSend ? "0 0 14px rgba(124, 58, 237, 0.5)" : "none",
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
          color: "#484f58",
          fontSize: 10,
          fontFamily: "var(--font-sans)",
        }}
      >
        Press Enter ↵ to send · Shift+Enter for new line
      </div>
    </div>
  );
}

/* ── AI Agent Panel — Main Export ────────────────────────── */
export default function AIPanel({ projectId }) {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedModel, setSelectedModel] = useState(AI_MODELS[0]);
  const [generateExpanded, setGenerateExpanded] = useState(false);
  const bottomRef = useRef(null);
  const messageIdRef = useRef(0);
  const getNextId = () => ++messageIdRef.current;
  const { showToast } = useToast();

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
        width: "100%",
        background: "#0d1117",
        borderLeft: "1px solid var(--ide-border)",
      }}
    >
      {/* ── Top Header ──────────────────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: 48,
          padding: "0 18px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          background: "rgba(13, 17, 23, 0.8)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center rounded-lg"
            style={{
              width: 26,
              height: 26,
              background:
                "linear-gradient(135deg, rgba(124,58,237,0.4), rgba(34,211,238,0.2))",
              border: "1px solid rgba(124,58,237,0.5)",
              boxShadow: "0 0 10px rgba(124,58,237,0.3)",
            }}
          >
            <Bot size={14} style={{ color: "#67e8f9" }} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#e6edf3",
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
                  background: "rgba(124, 58, 237, 0.15)",
                  color: "#c4b5fd",
                  border: "1px solid rgba(124, 58, 237, 0.3)",
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
                background: "#3fb950",
                boxShadow: "0 0 6px #3fb950",
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: "#4ade80",
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
              color: "#8b949e",
              fontSize: 11,
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
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
                background:
                  "linear-gradient(180deg, rgba(124, 58, 237, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%)",
                border: "1px solid rgba(124, 58, 237, 0.2)",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={14} style={{ color: "#a78bfa" }} />
                <span
                  style={{ fontSize: 12, fontWeight: 600, color: "#f0f6fc" }}
                >
                  Quick Capabilities
                </span>
              </div>
              <p style={{ fontSize: 11, color: "#8b949e", margin: 0 }}>
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
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(124, 58, 237, 0.08)";
                  e.currentTarget.style.borderColor = "rgba(124, 58, 237, 0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background =
                    "rgba(255, 255, 255, 0.02)";
                  e.currentTarget.style.borderColor =
                    "rgba(255, 255, 255, 0.06)";
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
                  <Shield size={13} style={{ color: "#38bdf8" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#e6edf3",
                    }}
                  >
                    Find edge cases
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#8b949e",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    Identify boundary conditions & potential failure points
                  </div>
                </div>
                <ChevronRight size={13} style={{ color: "#6e7681" }} />
              </motion.button>

              {/* 2. Generate tests (Expandable into Unit, Integration, System) */}
              <div
                style={{
                  background: generateExpanded
                    ? "rgba(124, 58, 237, 0.06)"
                    : "rgba(255, 255, 255, 0.02)",
                  border: generateExpanded
                    ? "1px solid rgba(124, 58, 237, 0.35)"
                    : "1px solid rgba(255, 255, 255, 0.06)",
                  borderRadius: 12,
                  overflow: "hidden",
                  transition: "all 0.2s ease",
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
                      e.currentTarget.style.background =
                        "rgba(124, 58, 237, 0.08)";
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
                    <Wand2 size={13} style={{ color: "#34d399" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#e6edf3",
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
                          color: "#6ee7b7",
                          border: "1px solid rgba(52, 211, 153, 0.3)",
                        }}
                      >
                        3 Levels
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#8b949e",
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
                      color: "#8b949e",
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
                        borderTop: "1px solid rgba(124, 58, 237, 0.2)",
                        background: "rgba(0, 0, 0, 0.25)",
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
                          color: "#a78bfa",
                          prompt:
                            "Generate comprehensive unit tests for the core functions and classes in this project.",
                        },
                        {
                          id: "integration",
                          title: "Integration Tests",
                          desc: "Test API endpoints & module interactions",
                          icon: Layers,
                          color: "#38bdf8",
                          prompt:
                            "Generate integration tests verifying API endpoints and module interactions in this project.",
                        },
                        {
                          id: "system",
                          title: "System Tests",
                          desc: "End-to-end user workflows & scenarios",
                          icon: Workflow,
                          color: "#34d399",
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
                              background: "rgba(255, 255, 255, 0.02)",
                              border: "1px solid rgba(255, 255, 255, 0.05)",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background =
                                "rgba(124, 58, 237, 0.12)";
                              e.currentTarget.style.borderColor =
                                "rgba(124, 58, 237, 0.35)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background =
                                "rgba(255, 255, 255, 0.02)";
                              e.currentTarget.style.borderColor =
                                "rgba(255, 255, 255, 0.05)";
                            }}
                          >
                            <div
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 5,
                                background: "rgba(255, 255, 255, 0.04)",
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
                                  color: "#e6edf3",
                                }}
                              >
                                {sub.title}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "#8b949e",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {sub.desc}
                              </div>
                            </div>
                            <ChevronRight
                              size={12}
                              style={{ color: "#6e7681" }}
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
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(124, 58, 237, 0.08)";
                  e.currentTarget.style.borderColor = "rgba(124, 58, 237, 0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background =
                    "rgba(255, 255, 255, 0.02)";
                  e.currentTarget.style.borderColor =
                    "rgba(255, 255, 255, 0.06)";
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
                  <Zap size={13} style={{ color: "#fbbf24" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#e6edf3",
                    }}
                  >
                    Explain coverage gaps
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#8b949e",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    Analyze untested logic branches and risk areas
                  </div>
                </div>
                <ChevronRight size={13} style={{ color: "#6e7681" }} />
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
