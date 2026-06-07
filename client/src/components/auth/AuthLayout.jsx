import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import AuthForm from "./AuthForm";
import CodePreview from "./CodePreview";

const STATS = [
  { value: "94%", label: "Avg. coverage boost" },
  { value: "10×", label: "Faster test writing" },
  { value: "200+", label: "Teams onboarded" },
];

export default function AuthLayout({ initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode);

  const toggleMode = () => setMode((m) => (m === "login" ? "register" : "login"));

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#0D1117",
        fontFamily: "Inter, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* ── Background ambient glows ───────────────────────── */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-20%",
            left: "-10%",
            width: "600px",
            height: "600px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-20%",
            right: "-10%",
            width: "500px",
            height: "500px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)",
          }}
        />
        {/* Grid */}
        <div
          className="bg-grid"
          style={{ position: "absolute", inset: 0, opacity: 0.3 }}
        />
      </div>

      {/* ══════════════════════════════════════════════════════
          LEFT SIDE — Visual Experience (60%)
          ══════════════════════════════════════════════════════ */}
      <div
        style={{
          flex: "0 0 60%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "2.5rem",
          position: "relative",
          zIndex: 1,
          // Hide on mobile (handled below via media query via inline style trick)
        }}
        className="auth-left-panel"
      >
        {/* Logo */}
        <div>
          <a
            href="/"
            id="auth-logo"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              textDecoration: "none",
              marginBottom: "3rem",
            }}
          >
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #7C3AED 0%, #06B6D4 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                fontWeight: "700",
                color: "white",
                boxShadow: "0 0 16px rgba(124,58,237,0.5)",
              }}
            >
              T
            </div>
            <span
              style={{
                fontSize: "1.05rem",
                fontWeight: "700",
                color: "#f0f6fc",
              }}
            >
              TestCov
              <span
                style={{
                  background: "linear-gradient(90deg, #7C3AED, #06B6D4)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                AI
              </span>
            </span>
          </a>

          {/* Headline */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          >
            <h2
              style={{
                fontSize: "clamp(1.75rem, 3vw, 2.6rem)",
                fontWeight: "800",
                color: "#f0f6fc",
                letterSpacing: "-0.03em",
                lineHeight: "1.15",
                marginBottom: "1rem",
                maxWidth: "520px",
              }}
            >
              Empower your testing{" "}
              <span
                style={{
                  background:
                    "linear-gradient(135deg, #7C3AED 0%, #06B6D4 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                with AI.
              </span>
            </h2>
            <p
              style={{
                color: "#8b949e",
                fontSize: "clamp(0.875rem, 1.4vw, 1rem)",
                lineHeight: "1.75",
                maxWidth: "460px",
              }}
            >
              Automatically generate intelligent edge cases, analyze coverage
              gaps across your microservices, and ship reliable code faster.
            </p>
          </motion.div>
        </div>

        {/* Code Preview */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
          style={{
            display: "flex",
            justifyContent: "center",
            flex: 1,
            alignItems: "center",
            padding: "2rem 0",
          }}
        >
          <CodePreview />
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          style={{
            display: "flex",
            gap: "2.5rem",
            paddingTop: "1.5rem",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {STATS.map((s) => (
            <div key={s.label}>
              <div
                style={{
                  fontSize: "1.5rem",
                  fontWeight: "800",
                  background: "linear-gradient(135deg, #7C3AED, #06B6D4)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  letterSpacing: "-0.03em",
                }}
              >
                {s.value}
              </div>
              <div style={{ color: "#484f58", fontSize: "0.75rem", marginTop: "2px" }}>
                {s.label}
              </div>
            </div>
          ))}
        </motion.div>
      </div>

      {/* ══════════════════════════════════════════════════════
          RIGHT SIDE — Auth Form (40%)
          ══════════════════════════════════════════════════════ */}
      <div
        style={{
          flex: "0 0 40%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          position: "relative",
          zIndex: 1,
          borderLeft: "1px solid rgba(255,255,255,0.05)",
          background:
            "linear-gradient(160deg, rgba(17,24,39,0.98) 0%, rgba(13,17,23,1) 100%)",
          backdropFilter: "blur(20px)",
          padding: "2rem 0",
          minHeight: "100vh",
        }}
        className="auth-right-panel"
      >
        {/* Back to home */}
        <div style={{ padding: "0 1.5rem", marginBottom: "2rem" }}>
          <a
            href="/"
            id="auth-back-home"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              color: "#484f58",
              textDecoration: "none",
              fontSize: "0.8rem",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#8b949e")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#484f58")}
          >
            <ArrowLeft size={13} />
            Back to home
          </a>
        </div>

        {/* Form wrapper with AnimatePresence */}
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            style={{ width: "100%" }}
          >
            <AuthForm mode={mode} onToggleMode={toggleMode} />
          </motion.div>
        </AnimatePresence>

        {/* Footer note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          style={{
            textAlign: "center",
            color: "#30363d",
            fontSize: "0.7rem",
            marginTop: "2.5rem",
            padding: "0 1.5rem",
          }}
        >
          Protected by enterprise-grade encryption. Your code never leaves your machine.
        </motion.p>
      </div>

      {/* Mobile: hide left panel (via CSS in index.css) */}
      <style>{`
        @media (max-width: 768px) {
          .auth-left-panel { display: none !important; }
          .auth-right-panel {
            flex: 1 !important;
            border-left: none !important;
            min-height: 100vh !important;
            justify-content: center !important;
          }
        }
      `}</style>
    </div>
  );
}
