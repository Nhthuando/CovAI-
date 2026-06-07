import { motion } from "framer-motion";
import { useInView } from "framer-motion";
import { useRef } from "react";

const CODE_LINES = [
  { num: 1,  text: "import { processPayment } from './payment';", cov: "covered" },
  { num: 2,  text: "import { sendEmail } from './mailer';",        cov: "covered" },
  { num: 3,  text: "",                                              cov: null },
  { num: 4,  text: "export function checkout(cart, user) {",       cov: "covered" },
  { num: 5,  text: "  if (!cart || cart.items.length === 0) {",    cov: "covered" },
  { num: 6,  text: "    throw new Error('Cart is empty');",        cov: "uncovered" },
  { num: 7,  text: "  }",                                          cov: "covered" },
  { num: 8,  text: "",                                              cov: null },
  { num: 9,  text: "  const total = cart.items.reduce(",           cov: "covered" },
  { num: 10, text: "    (sum, item) => sum + item.price, 0",       cov: "covered" },
  { num: 11, text: "  );",                                         cov: "covered" },
  { num: 12, text: "",                                              cov: null },
  { num: 13, text: "  if (user.balance < total) {",                cov: "partial" },
  { num: 14, text: "    throw new Error('Insufficient funds');",   cov: "uncovered" },
  { num: 15, text: "  }",                                          cov: "partial" },
  { num: 16, text: "",                                              cov: null },
  { num: 17, text: "  const receipt = processPayment(total);",     cov: "covered" },
  { num: 18, text: "  sendEmail(user.email, receipt);",            cov: "covered" },
  { num: 19, text: "  return receipt;",                            cov: "covered" },
  { num: 20, text: "}",                                            cov: "covered" },
];

const AI_SUGGESTIONS = [
  {
    type: "missing",
    icon: "⚠",
    color: "#f97316",
    title: "Line 6: Empty cart error",
    desc: "Add test: expect(() => checkout([], user)).toThrow()",
  },
  {
    type: "missing",
    icon: "⚠",
    color: "#ef4444",
    title: "Line 14: Insufficient funds",
    desc: "Branch not covered — 0% hit rate",
  },
  {
    type: "suggest",
    icon: "✦",
    color: "#22d3ee",
    title: "Generate test skeleton",
    desc: "3 tests ready to inject into checkout.test.js",
  },
  {
    type: "info",
    icon: "✓",
    color: "#4ade80",
    title: "Overall coverage: 72%",
    desc: "Lines 1–5, 9–12, 17–20 fully covered",
  },
];

function getCovColor(cov) {
  if (cov === "covered")   return "rgba(74,222,128,0.15)";
  if (cov === "uncovered") return "rgba(239,68,68,0.18)";
  if (cov === "partial")   return "rgba(251,191,36,0.12)";
  return "transparent";
}

function getBarColor(cov) {
  if (cov === "covered")   return "#4ade80";
  if (cov === "uncovered") return "#ef4444";
  if (cov === "partial")   return "#fbbf24";
  return "transparent";
}

function tokenizeLine(text) {
  if (!text) return null;
  // Simple syntax coloring
  return text
    .replace(/(import|export|function|const|if|throw|return)/g, '<kw>$1</kw>')
    .replace(/('.*?'|".*?")/g,  '<str>$1</str>')
    .replace(/(\/\/.*)/g,       '<cmt>$1</cmt>')
    .replace(/(\d+)/g,          '<num>$1</num>');
}

export default function IDEPreview() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="ide-preview"
      ref={ref}
      style={{
        padding: "6rem 1.5rem",
        background: "var(--surface-main)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background glow */}
      <div style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "600px",
        height: "400px",
        borderRadius: "50%",
        background: "radial-gradient(ellipse, rgba(124,58,237,0.08) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        {/* Section label */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          style={{ textAlign: "center", marginBottom: "3.5rem" }}
        >
          <span className="glass-pill" style={{
            padding: "0.375rem 1rem",
            fontSize: "0.7rem",
            fontWeight: "700",
            letterSpacing: "0.14em",
            color: "#7C3AED",
            textTransform: "uppercase",
          }}>
            INTEGRATED DEVELOPER ENVIRONMENT
          </span>
          <h2 style={{
            marginTop: "1.25rem",
            fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
            fontWeight: "700",
            color: "#f0f6fc",
            letterSpacing: "-0.02em",
          }}>
            Coverage at a glance,{" "}
            <span className="text-gradient-violet">inside your IDE</span>
          </h2>
          <p style={{ color: "#8b949e", marginTop: "0.75rem", fontSize: "1rem", maxWidth: "500px", margin: "0.75rem auto 0" }}>
            Real-time heatmap overlays show exactly which branches need attention.
          </p>
        </motion.div>

        {/* IDE Window */}
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.97 }}
          animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
          transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
          className="glow-violet"
          style={{
            borderRadius: "14px",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "#0D1117",
          }}
        >
          {/* Title bar */}
          <div style={{
            background: "#161b22",
            padding: "0.75rem 1rem",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ display: "flex", gap: "6px" }}>
              {["#ef4444","#fbbf24","#4ade80"].map((c) => (
                <div key={c} style={{ width: "12px", height: "12px", borderRadius: "50%", background: c, opacity: 0.8 }} />
              ))}
            </div>
            <div style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
            }}>
              <span style={{ color: "#484f58", fontSize: "0.75rem" }}>📁 src /</span>
              <span style={{ color: "#8b949e", fontSize: "0.75rem", fontFamily: "monospace" }}>checkout.js</span>
              <span style={{
                fontSize: "0.65rem",
                padding: "2px 8px",
                borderRadius: "4px",
                background: "rgba(124,58,237,0.2)",
                color: "#9d5cf5",
                fontFamily: "monospace",
              }}>72% coverage</span>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <span style={{ color: "#484f58", fontSize: "0.7rem", padding: "2px 6px", background: "#0D1117", borderRadius: "4px" }}>JS</span>
            </div>
          </div>

          {/* Editor body */}
          <div style={{ display: "flex", minHeight: "400px" }}>
            {/* Sidebar file tree */}
            <div style={{
              width: "160px",
              background: "#0d1117",
              borderRight: "1px solid rgba(255,255,255,0.04)",
              padding: "0.75rem 0",
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: "2px",
            }}>
              {["📁 src", "  📄 checkout.js", "  📄 payment.js", "  📄 mailer.js", "📁 __tests__", "  📄 checkout.test.js"].map((item, i) => (
                <div key={i} style={{
                  padding: "3px 12px",
                  fontSize: "0.72rem",
                  fontFamily: "monospace",
                  color: i === 1 ? "#22d3ee" : "#484f58",
                  background: i === 1 ? "rgba(34,211,238,0.06)" : "transparent",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {item}
                </div>
              ))}
            </div>

            {/* Code editor */}
            <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.8rem", lineHeight: "1.65" }}>
                {CODE_LINES.map((line) => (
                  <div
                    key={line.num}
                    style={{
                      display: "flex",
                      alignItems: "stretch",
                      background: getCovColor(line.cov),
                      position: "relative",
                    }}
                  >
                    {/* Coverage bar */}
                    <div style={{
                      width: "3px",
                      background: getBarColor(line.cov),
                      flexShrink: 0,
                    }} />
                    {/* Line number */}
                    <div style={{
                      width: "40px",
                      padding: "0 8px",
                      color: "#484f58",
                      userSelect: "none",
                      flexShrink: 0,
                      textAlign: "right",
                    }}>
                      {line.num}
                    </div>
                    {/* Code */}
                    <div
                      style={{ padding: "0 12px", color: "#c9d1d9", whiteSpace: "pre" }}
                      dangerouslySetInnerHTML={{
                        __html: (line.text || " ")
                          .replace(/(import|export|function|const|if|throw|return|new)/g,
                            '<span style="color:#ff7b72">$1</span>')
                          .replace(/('.*?'|".*?")/g,
                            '<span style="color:#a5d6ff">$1</span>')
                          .replace(/(\d+)/g,
                            '<span style="color:#79c0ff">$1</span>')
                          .replace(/(\/\/.*)/g,
                            '<span style="color:#8b949e">$1</span>')
                          .replace(/(\bError\b|\bcart\b|\buser\b|\btotal\b|\breceipt\b|\bsum\b|\bitem\b)/g,
                            '<span style="color:#d2a8ff">$1</span>'),
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* AI Suggestions Panel */}
            <div style={{
              width: "260px",
              background: "#111827",
              borderLeft: "1px solid rgba(255,255,255,0.06)",
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
            }}>
              <div style={{
                padding: "0.75rem 1rem",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}>
                <span style={{ fontSize: "0.75rem", fontWeight: "600", color: "#f0f6fc" }}>
                  ✦ AI Suggestions
                </span>
                <span style={{
                  marginLeft: "auto",
                  fontSize: "0.65rem",
                  padding: "2px 6px",
                  borderRadius: "20px",
                  background: "rgba(239,68,68,0.15)",
                  color: "#f87171",
                }}>
                  2 issues
                </span>
              </div>
              <div style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {AI_SUGGESTIONS.map((s, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: 20 }}
                    animate={isInView ? { opacity: 1, x: 0 } : {}}
                    transition={{ delay: 0.5 + i * 0.1, duration: 0.4 }}
                    style={{
                      padding: "0.625rem",
                      borderRadius: "8px",
                      background: "rgba(255,255,255,0.02)",
                      border: `1px solid ${s.color}22`,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.25rem" }}>
                      <span style={{ color: s.color, fontSize: "0.75rem" }}>{s.icon}</span>
                      <span style={{ color: "#f0f6fc", fontSize: "0.72rem", fontWeight: "600", fontFamily: "monospace" }}>
                        {s.title}
                      </span>
                    </div>
                    <p style={{ color: "#8b949e", fontSize: "0.68rem", lineHeight: "1.5", fontFamily: "monospace" }}>
                      {s.desc}
                    </p>
                  </motion.div>
                ))}
              </div>

              {/* Coverage bar chart */}
              <div style={{ padding: "0.75rem", marginTop: "auto", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ fontSize: "0.7rem", color: "#484f58", marginBottom: "0.5rem" }}>COVERAGE SUMMARY</div>
                {[
                  { label: "Statements", pct: 78, color: "#7C3AED" },
                  { label: "Branches",   pct: 55, color: "#f97316" },
                  { label: "Functions",  pct: 85, color: "#22d3ee" },
                  { label: "Lines",      pct: 72, color: "#4ade80" },
                ].map((item) => (
                  <div key={item.label} style={{ marginBottom: "0.4rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "#8b949e", marginBottom: "2px" }}>
                      <span>{item.label}</span>
                      <span style={{ color: item.color }}>{item.pct}%</span>
                    </div>
                    <div style={{ height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.06)" }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={isInView ? { width: `${item.pct}%` } : {}}
                        transition={{ duration: 1, delay: 0.8, ease: "easeOut" }}
                        style={{ height: "100%", borderRadius: "2px", background: item.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Status bar */}
          <div style={{
            background: "#161b22",
            borderTop: "1px solid rgba(255,255,255,0.04)",
            padding: "0.375rem 1rem",
            display: "flex",
            alignItems: "center",
            gap: "1.5rem",
            fontSize: "0.68rem",
            color: "#484f58",
          }}>
            <span style={{ color: "#4ade80" }}>● Connected to AI</span>
            <span>UTF-8</span>
            <span>JavaScript</span>
            <span style={{ marginLeft: "auto", color: "#7C3AED" }}>TestCovAI v1.0</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
