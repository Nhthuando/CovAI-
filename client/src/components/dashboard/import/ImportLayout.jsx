import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ArrowLeft, X, Zap, ChevronRight } from "lucide-react";
import LocalUpload from "./LocalUpload";
import GitHubImport from "./GitHubImport";

/* ── Animation variants ───────────────────────────────────── */
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.2, ease: "easeIn" } },
};

const contentVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1],
      staggerChildren: 0.08,
      delayChildren: 0.15,
    },
  },
  exit: {
    opacity: 0,
    y: 16,
    scale: 0.98,
    transition: { duration: 0.25 },
  },
};

const childVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: "easeOut" },
  },
};


export default function ImportLayout({ onClose }) {
  return createPortal(
    <motion.div
      className="fixed inset-0 flex flex-col"
      style={{
        zIndex: 100,
        background: "#0a0e14",
      }}
      variants={overlayVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {/* ── Background ambient glow ──────────────────────────── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 40% at 50% 0%, rgba(124,58,237,0.06) 0%, transparent 70%)",
        }}
      />

      {/* ── Top Bar ──────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0 relative z-10"
        style={{
          height: 52,
          padding: "0 24px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Left: Brand */}
        <div className="flex items-center" style={{ gap: 10 }}>
          <div
            className="flex items-center justify-center rounded-lg"
            style={{
              width: 30,
              height: 30,
              background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
              boxShadow: "0 0 12px rgba(124,58,237,0.4)",
            }}
          >
            <Zap size={14} style={{ color: "#fff" }} strokeWidth={2.5} />
          </div>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#a78bfa",
              fontFamily: "var(--font-sans)",
              letterSpacing: "-0.02em",
            }}
          >
            TestCovAI
          </span>
        </div>

        {/* Right: Cancel */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onClose}
          className="flex items-center cursor-pointer"
          style={{
            gap: 8,
            padding: "8px 16px",
            background: "transparent",
            border: "none",
            color: "#8b949e",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
          }}
          id="import-cancel-btn"
        >

        </motion.button>
      </div>

      {/* ── Main Scrollable Content ───────────────────── */}
      <div className="flex-1 overflow-y-auto relative z-10 flex flex-col items-center">
        <motion.div
          className="flex flex-col w-full"
          style={{
            maxWidth: 1700,
            margin: "0 auto",
            padding: "40px 32px 48px",
          }}
          variants={contentVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {/* ── Breadcrumb ─────────────────────────────────────── */}
          <motion.div
            variants={childVariants}
            className="flex items-center"
            style={{ gap: 8, marginBottom: 40 }}
          >
            <motion.button
              whileHover={{ x: -3 }}
              whileTap={{ scale: 0.97 }}
              onClick={onClose}
              className="flex items-center cursor-pointer"
              style={{
                gap: 8,
                background: "transparent",
                border: "none",
                color: "#a78bfa",
                fontSize: 14,
                fontWeight: 500,
                fontFamily: "var(--font-sans)",
              }}
              id="import-back-btn"
            >
              <ArrowLeft size={16} />
              <span>Back to Dashboard</span>
            </motion.button>
            <ChevronRight size={14} style={{ color: "#30363d" }} />
            <span
              style={{
                fontSize: 14,
                color: "#e6edf3",
                fontWeight: 500,
                fontFamily: "var(--font-sans)",
              }}
            >
              New Project
            </span>
          </motion.div>

          {/* ── Main Card (Split Layout) ───────────────────────── */}
          <motion.div
            variants={childVariants}
            className="rounded-2xl overflow-hidden"
            style={{
              background: "#111827",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow:
                "0 8px 64px rgba(0,0,0,0.5), 0 0 80px rgba(124,58,237,0.04)",
            }}
          >
            <div
              className="flex flex-col lg:flex-row"
              style={{ minHeight: 610 }}
            >
              {/* ── Left Panel: Import Info + Local Upload ── */}
              <motion.div
                variants={childVariants}
                className="flex flex-col lg:w-[38%]"
                style={{
                  padding: "40px 32px",
                  borderRight: "1px solid rgba(255,255,255,0.06)",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 100%)",
                  gap: 28,
                }}
              >
                {/* Title section */}
                <div className="flex flex-col" style={{ gap: 12 }}>
                  <h2
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "#e6edf3",
                      fontFamily: "var(--font-sans)",
                      letterSpacing: "-0.02em",
                      lineHeight: 1.2,
                      margin: 0,
                    }}
                  >
                    Import Repository
                  </h2>
                  <p
                    style={{
                      fontSize: 14,
                      color: "#6e7681",
                      fontFamily: "var(--font-sans)",
                      lineHeight: 1.6,
                      margin: 0,
                    }}
                  >
                    Connect your codebase to TestCovAI to begin automated test
                    generation and coverage analysis.
                  </p>
                </div>

                {/* Local Upload Dropzone */}
                <LocalUpload onClose={onClose} />
              </motion.div>

              {/* ── Right Panel: GitHub Import ── */}
              <motion.div
                variants={childVariants}
                className="flex flex-col flex-1 lg:w-[62%]"
                style={{
                  padding: "40px 32px",
                }}
              >
                <GitHubImport onClose={onClose} />
              </motion.div>
            </div>
          </motion.div>

          {/* ── Bottom Help Text ───────────────────────────────── */}
          <motion.div
            variants={childVariants}
            className="flex items-center justify-center"
            style={{
              marginTop: 32,
              fontSize: 13,
              color: "#484f58",
              fontFamily: "var(--font-sans)",
              gap: 6,
            }}
          >
            <span>Need help connecting?</span>
            <a
              href="#"
              style={{
                color: "#a78bfa",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              View documentation
            </a>
            <span>or</span>
            <a
              href="#"
              style={{
                color: "#a78bfa",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              configure SSH keys
            </a>
            <span>.</span>
          </motion.div>
        </motion.div>
      </div>

      {/* ── Footer ───────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between flex-shrink-0 relative z-10"
        style={{
          padding: "14px 32px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          fontSize: 12,
          color: "#30363d",
          fontFamily: "var(--font-sans)",
        }}
      >
        <span>© 2024 TestCovAI. Powered by LLMs.</span>
        <div className="flex items-center" style={{ gap: 20 }}>
          {["Documentation", "API", "Status", "Privacy"].map((link) => (
            <a
              key={link}
              href="#"
              style={{
                color: "#484f58",
                textDecoration: "none",
                transition: "color 0.15s ease",
              }}
              onMouseEnter={(e) => (e.target.style.color = "#8b949e")}
              onMouseLeave={(e) => (e.target.style.color = "#484f58")}
            >
              {link}
            </a>
          ))}
        </div>
      </div>
    </motion.div>,
    document.body
  );
}
