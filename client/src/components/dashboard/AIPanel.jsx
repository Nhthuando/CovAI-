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
  Paperclip,
  Mic,
  RotateCcw,
  ChevronDown,
} from "lucide-react";

/* ── Initial conversation ───────────────────────────────── */
const INITIAL_MESSAGES = [
  {
    id: 1,
    role: "assistant",
    content:
      "Xin chào! Tôi là **AI Agent** của TestCovAI. Tôi đã phân tích source code của bạn và sẵn sàng hỗ trợ:\n\n- Phân tích **Test Coverage** và tìm điểm yếu\n- Gợi ý **test case** còn thiếu\n- Sinh **Jest test** tự động\n- Giải thích **Cyclomatic Complexity**\n\nBạn cần giúp gì không?",
    timestamp: "14:22",
  },
  {
    id: 2,
    role: "user",
    content: "Hãy phân tích coverage của file coverage.service.js",
    timestamp: "14:23",
  },
  {
    id: 3,
    role: "assistant",
    content:
      "Đã phân tích `coverage.service.js`. Kết quả:\n\n**Coverage hiện tại:** 71% branches\n\n3 nhánh chưa được kiểm thử:",
    timestamp: "14:23",
    code: `// ⚠️ Uncovered branches detected
function calculateCoverage(lines, tested) {
  if (!lines || lines.length === 0) {
    return 0; // ❌ Branch not tested
  }
  
  const ratio = tested / lines.length;
  
  if (ratio > 1) {
    throw new Error('Invalid data'); // ❌ Not tested
  }
  
  return Math.round(ratio * 100);
}`,
    suggestion: "Gợi ý: Thêm test cho trường hợp `lines = null` và `ratio > 1`",
  },
];

/* ── AI Responses pool ──────────────────────────────────── */
const AI_RESPONSES = [
  {
    content:
      "Đã phân tích! Tôi tìm thấy **4 test case** còn thiếu trong file này.\n\nHàm `parseZip()` có **CC = 6** nhưng chỉ có 2/6 nhánh được test.",
    code: `// 🤖 AI Generated Test — Jest Skeleton
describe('parseZip', () => {
  test('should handle empty zip', async () => {
    const result = await parseZip(emptyBuffer);
    expect(result).toEqual([]);
  });

  test('should reject invalid zip format', async () => {
    await expect(parseZip(invalidBuffer))
      .rejects.toThrow('Invalid ZIP');
  });

  test.todo('Handle corrupted entries');
  test.todo('Handle nested directories');
});`,
    suggestion: "Coverage sau khi thêm test này: ~89% (+18%)",
  },
  {
    content:
      "Cyclomatic Complexity của dự án:\n\n- `zipExtraction.service.js`: **CC = 8** ⚠️\n- `ingestJob.service.js`: **CC = 5** ✅\n- `upload.controller.js`: **CC = 3** ✅\n\nFile có CC cao nhất cần ưu tiên refactor.",
  },
  {
    content:
      "Tôi đã sinh **Jest test runnable** cho `coverage.service.js`:",
    code: `import { calculateCoverage } from './coverage.service';

describe('calculateCoverage', () => {
  test('returns 0 for empty lines', () => {
    expect(calculateCoverage([], 0)).toBe(0);
  });

  test('returns null for null input', () => {
    expect(calculateCoverage(null, 0)).toBe(0);
  });

  test('calculates correct percentage', () => {
    expect(calculateCoverage([1,2,3,4], 3)).toBe(75);
  });

  test('throws for invalid ratio', () => {
    expect(() => calculateCoverage([1], 5)).toThrow();
  });
});`,
    suggestion: "Run: jest --coverage để kiểm tra kết quả",
  },
];

/* ────────────────────────────────────────────────────────── */
/*  ChatMessage component                                    */
/* ────────────────────────────────────────────────────────── */
function CodeBlock({ code }) {
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
      {/* Language label + copy button */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{
          background: "rgba(124,58,237,0.08)",
          borderBottom: "1px solid rgba(124,58,237,0.15)",
        }}
      >
        <span
          style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.04em",
          }}
        >
          javascript
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 opacity-0 group-hover/code:opacity-100 transition-all duration-200 px-2 py-1 rounded-md hover:bg-white/5"
          style={{
            color: copied ? "#86EFAC" : "var(--text-muted)",
            fontSize: 11,
            fontFamily: "var(--font-sans)",
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre
        className="overflow-x-auto"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          lineHeight: 1.7,
          padding: "14px 16px",
          background: "rgba(0,0,0,0.5)",
          color: "#86EFAC",
          margin: 0,
        }}
      >
        {code}
      </pre>
    </div>
  );
}

function ChatMessage({ msg }) {
  const isUser = msg.role === "user";
  const [hovered, setHovered] = useState(false);

  /* Simple markdown: **bold** and `code` */
  const renderContent = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} style={{ color: "var(--text-primary)", fontWeight: 600 }}>
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
              background: "rgba(124,58,237,0.12)",
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: "0.88em",
              color: "var(--primary-light)",
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative"
    >
      {/* Role label */}
      <div
        className="flex items-center gap-2 mb-2"
        style={{ fontSize: 12, fontWeight: 500 }}
      >
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 22,
            height: 22,
            background: isUser
              ? "rgba(124,58,237,0.25)"
              : "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(34,211,238,0.2))",
            border: `1px solid ${
              isUser ? "rgba(124,58,237,0.4)" : "rgba(34,211,238,0.25)"
            }`,
          }}
        >
          {isUser ? (
            <User size={11} style={{ color: "var(--primary-light)" }} />
          ) : (
            <Bot size={11} style={{ color: "var(--accent-cyan)" }} />
          )}
        </div>
        <span
          style={{
            color: isUser ? "var(--text-secondary)" : "var(--accent-cyan-light)",
          }}
        >
          {isUser ? "You" : "AI Agent"}
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 10, marginLeft: "auto" }}>
          {msg.timestamp}
        </span>
      </div>

      {/* Bubble */}
      <div
        className="relative rounded-2xl transition-all duration-200"
        style={{
          marginLeft: 30,
          padding: isUser ? "10px 14px" : "14px 16px",
          background: isUser
            ? "rgba(255,255,255,0.03)"
            : "rgba(124,58,237,0.05)",
          border: `1px solid ${
            isUser ? "rgba(255,255,255,0.06)" : "rgba(124,58,237,0.1)"
          }`,
          backdropFilter: isUser ? "none" : "blur(12px)",
          WebkitBackdropFilter: isUser ? "none" : "blur(12px)",
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          lineHeight: 1.7,
          color: "var(--text-secondary)",
        }}
      >
        <div>
          {msg.content.split("\n").map((line, i) => (
            <p key={i} className={line === "" ? "h-2" : ""}>
              {line === "" ? null : renderContent(line)}
            </p>
          ))}
        </div>

        {msg.code && <CodeBlock code={msg.code} />}

        {msg.suggestion && (
          <div
            className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg"
            style={{
              background: "rgba(134,239,172,0.05)",
              border: "1px solid rgba(134,239,172,0.15)",
              color: "#86EFAC",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <span className="flex-shrink-0 mt-0.5">💡</span>
            <span>{msg.suggestion}</span>
          </div>
        )}

        {/* Hover actions — Retry / Copy */}
        <AnimatePresence>
          {hovered && !isUser && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="absolute -bottom-3 right-3 flex gap-1"
            >
              {[
                { icon: Copy, label: "Copy" },
                { icon: RotateCcw, label: "Retry" },
              ].map(({ icon: Icon, label }) => (
                <button
                  key={label}
                  title={label}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-all hover:bg-white/10"
                  style={{
                    background: "#1c2128",
                    border: "1px solid var(--ide-border)",
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  <Icon size={11} />
                  <span>{label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  Typing indicator                                         */
/* ────────────────────────────────────────────────────────── */
function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
    >
      <div className="flex items-center gap-2 mb-2" style={{ fontSize: 12, fontWeight: 500 }}>
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 22, height: 22,
            background: "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(34,211,238,0.2))",
            border: "1px solid rgba(34,211,238,0.25)",
          }}
        >
          <Bot size={11} style={{ color: "var(--accent-cyan)" }} />
        </div>
        <span style={{ color: "var(--accent-cyan-light)" }}>AI Agent</span>
      </div>
      <div
        className="flex items-center gap-1.5 px-4 py-3 rounded-2xl"
        style={{
          marginLeft: 30,
          background: "rgba(124,58,237,0.05)",
          border: "1px solid rgba(124,58,237,0.1)",
          backdropFilter: "blur(12px)",
        }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.2, ease: "easeInOut" }}
            style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "var(--primary-light)",
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  ChatInput component                                      */
/* ────────────────────────────────────────────────────────── */
function ChatInput({ onSend, isTyping }) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef(null);

  /* Auto-resize textarea */
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
    <div className="px-3 pb-3 pt-2 flex-shrink-0">
      <div
        className="relative rounded-2xl transition-all duration-300"
        style={{
          background: "#111827",
          border: `1.5px solid ${focused ? "var(--primary)" : "rgba(255,255,255,0.08)"}`,
          boxShadow: focused
            ? "0 0 20px rgba(124,58,237,0.15), 0 0 0 3px rgba(124,58,237,0.06)"
            : "0 2px 8px rgba(0,0,0,0.3)",
        }}
      >
        {/* Gradient border animation when AI is thinking */}
        <AnimatePresence>
          {isTyping && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute -inset-px rounded-2xl overflow-hidden pointer-events-none"
              style={{ zIndex: 0 }}
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent, var(--primary), var(--accent-cyan), transparent)",
                  filter: "blur(4px)",
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="relative z-10 rounded-2xl overflow-hidden" style={{ background: "#111827" }}>
          {/* Textarea */}
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
            className="w-full resize-none outline-none bg-transparent px-4 pt-3.5 pb-1 text-sm"
            style={{
              fontFamily: "var(--font-sans)",
              color: "var(--text-primary)",
              fontSize: 13,
              lineHeight: 1.5,
              maxHeight: 120,
            }}
          />

          {/* Bottom actions row */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
            {/* Left: action buttons */}
            <div className="flex items-center gap-0.5">
              <button
                title="Attach file"
                className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
              >
                <Paperclip size={14} />
              </button>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors hover:bg-white/5"
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                }}
              >
                <span>Gemini</span>
                <ChevronDown size={10} />
              </button>
              <button
                title="Voice input"
                className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
              >
                <Mic size={14} />
              </button>
            </div>

            {/* Right: send button */}
            <motion.button
              whileHover={canSend ? { scale: 1.08, brightness: 1.2 } : {}}
              whileTap={canSend ? { scale: 0.92 } : {}}
              onClick={handleSend}
              disabled={!canSend}
              className="flex items-center justify-center rounded-full transition-all duration-200"
              style={{
                width: 30,
                height: 30,
                background: canSend
                  ? "var(--primary)"
                  : "rgba(255,255,255,0.06)",
                color: canSend ? "#fff" : "var(--text-muted)",
                cursor: canSend ? "pointer" : "not-allowed",
                border: "none",
                boxShadow: canSend ? "0 0 12px rgba(124,58,237,0.3)" : "none",
              }}
              id="ai-send-btn"
            >
              {isTyping ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowUp size={15} strokeWidth={2.5} />
              )}
            </motion.button>
          </div>
        </div>
      </div>

      {/* Helper text */}
      <div
        className="mt-2 text-center"
        style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-sans)" }}
      >
        Enter to send · Shift+Enter for new line
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  AIAgentPanel — main export                               */
/* ────────────────────────────────────────────────────────── */
export default function AIPanel() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = (text) => {
    const userMsg = {
      id: Date.now(),
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((m) => [...m, userMsg]);
    setIsTyping(true);

    setTimeout(() => {
      const resp = AI_RESPONSES[Math.floor(Math.random() * AI_RESPONSES.length)];
      setMessages((m) => [
        ...m,
        {
          id: Date.now() + 1,
          role: "assistant",
          timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
          ...resp,
        },
      ]);
      setIsTyping(false);
    }, 1400 + Math.random() * 800);
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: 360,
        flexShrink: 0,
        background: "#0d1117",
        borderLeft: "1px solid var(--ide-border)",
      }}
    >
      {/* ── Cinematic Header ─────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-3.5 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center rounded-lg"
            style={{
              width: 30,
              height: 30,
              background: "linear-gradient(135deg, rgba(124,58,237,0.25), rgba(34,211,238,0.1))",
              border: "1px solid rgba(124,58,237,0.35)",
            }}
          >
            <Sparkles size={14} style={{ color: "var(--primary-light)" }} />
          </div>
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
            }}
          >
            AI Agent
          </span>
        </div>

        {/* Status indicator with ping */}
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            Gemini AI
          </span>
          <div className="relative flex items-center justify-center" style={{ width: 10, height: 10 }}>
            <div
              className="absolute inset-0 rounded-full animate-ping"
              style={{
                background: "var(--primary-light)",
                opacity: 0.4,
              }}
            />
            <div
              className="relative rounded-full"
              style={{
                width: 6, height: 6,
                background: "var(--primary-light)",
                boxShadow: "0 0 8px var(--primary-glow)",
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Messages area — custom thin scrollbar ────────── */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(124,58,237,0.3) transparent",
        }}
      >
        <AnimatePresence>
          {messages.map((msg) => (
            <ChatMessage key={msg.id} msg={msg} />
          ))}
          {isTyping && <TypingIndicator key="typing" />}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* ── Floating Input Area ──────────────────────────── */}
      <ChatInput onSend={handleSend} isTyping={isTyping} />
    </div>
  );
}
