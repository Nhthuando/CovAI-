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
  Wand2,
  Shield,
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
    content: "Tôi đã sinh **Jest test runnable** cho `coverage.service.js`:",
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

/* ── Code Block ─────────────────────────────────────────── */
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
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{
          background: "rgba(124,58,237,0.06)",
          borderBottom: "1px solid rgba(124,58,237,0.12)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#f85149" }} />
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#d29922" }} />
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#3fb950" }} />
          <span
            style={{
              color: "#484f58",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              marginLeft: 4,
              letterSpacing: "0.04em",
            }}
          >
            javascript
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

/* ── Chat Message ────────────────────────────────────────── */
function ChatMessage({ msg }) {
  const isUser = msg.role === "user";
  const [hovered, setHovered] = useState(false);

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
              : "linear-gradient(135deg, rgba(124,58,237,0.35), rgba(34,211,238,0.15))",
            border: `1px solid ${isUser ? "rgba(124,58,237,0.3)" : "rgba(34,211,238,0.2)"}`,
            boxShadow: isUser ? "none" : "0 0 8px rgba(34,211,238,0.1)",
          }}
        >
          {isUser ? (
            <User size={10} style={{ color: "#a78bfa" }} />
          ) : (
            <Bot size={10} style={{ color: "#67e8f9" }} />
          )}
        </div>
        <span
          style={{
            fontWeight: 500,
            color: isUser ? "#8b949e" : "#67e8f9",
            fontFamily: "var(--font-sans)",
          }}
        >
          {isUser ? "You" : "AI Agent"}
        </span>
        <span style={{ color: "#30363d", marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10 }}>
          {msg.timestamp}
        </span>
      </div>

      {/* Message Bubble */}
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
          WebkitBackdropFilter: isUser ? "none" : "blur(12px)",
          fontSize: 13,
          lineHeight: 1.7,
          color: "#8b949e",
          fontFamily: "var(--font-sans)",
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
                { icon: Copy, label: "Copy" },
                { icon: RotateCcw, label: "Retry" },
              ].map(({ icon: Icon, label }) => (
                <motion.button
                  key={label}
                  whileTap={{ scale: 0.9 }}
                  title={label}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs"
                  style={{
                    background: "#161b22",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#6e7681",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  <Icon size={10} />
                  {label}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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
            width: 20, height: 20,
            background: "linear-gradient(135deg, rgba(124,58,237,0.35), rgba(34,211,238,0.15))",
            border: "1px solid rgba(34,211,238,0.2)",
          }}
        >
          <Bot size={10} style={{ color: "#67e8f9" }} />
        </div>
        <span style={{ color: "#67e8f9", fontSize: 11, fontFamily: "var(--font-sans)", fontWeight: 500 }}>
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
        }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ scale: [1, 1.6, 1], opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.22, ease: "easeInOut" }}
            style={{ width: 5, height: 5, borderRadius: "50%", background: "#a78bfa" }}
          />
        ))}
      </div>
    </motion.div>
  );
}

/* ── Chat Input ──────────────────────────────────────────── */
function ChatInput({ onSend, isTyping }) {
  const [input, setInput]   = useState("");
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
    <div
      className="flex-shrink-0"
      style={{ padding: "8px 14px 10px" }}
    >
      <div
        className="relative rounded-2xl overflow-hidden transition-all duration-300"
        style={{
          background: "#0d1117",
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
            className="w-full resize-none outline-none bg-transparent px-4 pt-3.5 pb-1 text-sm"
            style={{
              fontFamily: "var(--font-sans)",
              color: "#e6edf3",
              fontSize: 13,
              lineHeight: 1.5,
              maxHeight: 120,
              caretColor: "#a78bfa",
            }}
          />

          {/* Actions row */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
            <div className="flex items-center gap-0.5">
              <motion.button
                whileTap={{ scale: 0.9 }}
                title="Attach file"
                className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                style={{ color: "#484f58" }}
              >
                <Paperclip size={14} />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
                style={{ color: "#484f58", fontSize: 11, fontFamily: "var(--font-mono)" }}
              >
                <Wand2 size={12} />
                <span>Gemini</span>
                <ChevronDown size={10} />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                title="Voice input"
                className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                style={{ color: "#484f58" }}
              >
                <Mic size={14} />
              </motion.button>
            </div>

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
        style={{ color: "#30363d", fontSize: 10, fontFamily: "var(--font-sans)" }}
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
    { label: "Generate Tests",   icon: Wand2,  color: "#67e8f9" },
  ];
  return (
    <div
      className="flex gap-2 flex-shrink-0"
      style={{ padding: "6px 16px 8px" }}
    >
      {actions.map(({ label, icon: Icon, color }) => (
        <motion.button
          key={label}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => onAction(label)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "#6e7681",
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          <Icon size={12} style={{ color }} />
          {label}
        </motion.button>
      ))}
    </div>
  );
}

/* ── AI Agent Panel — Main Export ────────────────────────── */
export default function AIPanel() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [isTyping, setIsTyping]   = useState(false);
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
    <motion.div
      className="flex flex-col h-full flex-shrink-0"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: 0.15 }}
      style={{
        width: 340,
        background: "#0d1117",
        borderLeft: "1px solid var(--ide-border)",
      }}
    >
      {/* ── Header ──────────────────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          height: 52,
          padding: "0 18px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "linear-gradient(180deg, rgba(124,58,237,0.04) 0%, transparent 100%)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center rounded-lg"
            style={{
              width: 28,
              height: 28,
              background: "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(34,211,238,0.1))",
              border: "1px solid rgba(124,58,237,0.4)",
              boxShadow: "0 0 10px rgba(124,58,237,0.2)",
            }}
          >
            <Sparkles size={13} style={{ color: "#a78bfa" }} />
          </div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#e6edf3",
              fontFamily: "var(--font-sans)",
              letterSpacing: "-0.01em",
            }}
          >
            AI Agent
          </span>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: 10,
              color: "#484f58",
              fontFamily: "var(--font-mono)",
            }}
          >
            READY
          </span>
          <div className="relative flex items-center justify-center" style={{ width: 10, height: 10 }}>
            <div
              className="absolute inset-0 rounded-full animate-ping"
              style={{ background: "#3fb950", opacity: 0.4, animationDuration: "1.5s" }}
            />
            <div
              className="relative rounded-full"
              style={{
                width: 6,
                height: 6,
                background: "#3fb950",
                boxShadow: "0 0 8px rgba(63,185,80,0.6)",
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Messages ───────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto flex flex-col"
        style={{
          gap: 20,
          padding: "16px 16px",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(124,58,237,0.25) transparent",
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

      {/* ── Quick Actions ───────────────────────────── */}
      <QuickActions onAction={handleSend} />

      {/* ── Floating Input ─────────────────────────── */}
      <ChatInput onSend={handleSend} isTyping={isTyping} />
    </motion.div>
  );
}
