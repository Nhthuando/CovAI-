import { createPortal } from "react-dom";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, X, Zap, ChevronRight, CheckCircle2, Lock } from "lucide-react";

/* ── GitHub SVG Icon ──────────────────────────────────────── */
function GithubIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}
import LocalUpload from "./LocalUpload";
import GitHubImport from "./GitHubImport";
import { ToastProvider } from "../ToastContext";
import { getUserProfileApi } from "../../../services/project.service";

/* ── Animation variants ───────────────────────────────────── */
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.2, ease: "easeIn" } },
};

const contentVariants = {
  hidden: { opacity: 0, y: 15, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.3,
      ease: "easeOut",
    },
  },
  exit: {
    opacity: 0,
    y: 10,
    scale: 0.98,
    transition: { duration: 0.2 },
  },
};


export default function ImportLayout({ onClose, onSuccess }) {
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [hasGithub, setHasGithub] = useState(null); // null = loading, true/false = resolved

  useEffect(() => {
    getUserProfileApi()
      .then((data) => {
        // The /user/me endpoint returns the user object directly (not wrapped)
        const githubId = data?.githubUserId || data?.user?.githubUserId;
        console.log("[ImportLayout] User profile:", data, "hasGithub:", !!githubId);
        setHasGithub(!!githubId);
      })
      .catch((err) => {
        console.error("[ImportLayout] Failed to fetch user profile:", err);
        setHasGithub(false);
      });
  }, []);

  const handleImportSuccess = () => {
    onSuccess?.();
  };

  return createPortal(
    <ToastProvider>
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
            <X size={16} />
            Cancel
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
              className="rounded-2xl overflow-hidden"
              style={{
                background: "#111827",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                willChange: "transform, opacity"
              }}
            >
              <div
                className="flex flex-col lg:flex-row"
                style={{ minHeight: 610 }}
              >
                {/* ── Left Panel: Import Info + Local Upload ── */}
                <motion.div
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
                  <LocalUpload onClose={onClose} onSuccess={handleImportSuccess} />
                </motion.div>

                {/* ── Right Panel: GitHub Import ── */}
                <motion.div
                  className="flex flex-col flex-1 lg:w-[62%] relative"
                  style={{
                    padding: "40px 32px",
                  }}
                >
                  {hasGithub === false && (
                    /* ── Disabled Overlay when GitHub not linked ── */
                    <div
                      className="absolute inset-0 z-10 flex flex-col items-center justify-center"
                      style={{
                        background: "rgba(10, 14, 20, 0.9)",
                        borderRadius: "0 16px 16px 0",
                      }}
                    >
                      <div
                        className="flex flex-col items-center"
                        style={{ gap: 16, maxWidth: 320, textAlign: "center" }}
                      >
                        <div
                          className="flex items-center justify-center rounded-2xl"
                          style={{
                            width: 64,
                            height: 64,
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          <Lock size={28} style={{ color: "#6e7681" }} />
                        </div>
                        <h3
                          style={{
                            fontSize: 18,
                            fontWeight: 600,
                            color: "#e6edf3",
                            fontFamily: "var(--font-sans)",
                            margin: 0,
                          }}
                        >
                          GitHub Not Connected
                        </h3>
                        <p
                          style={{
                            fontSize: 13,
                            color: "#6e7681",
                            fontFamily: "var(--font-sans)",
                            lineHeight: 1.6,
                            margin: 0,
                          }}
                        >
                          Connect your GitHub account to import repositories directly.
                          You can still upload project files using the local upload on the left.
                        </p>
                        <a
                          href={`https://github.com/login/oauth/authorize?client_id=${import.meta.env.VITE_GITHUB_CLIENT_ID || ""}&scope=repo,user:email`}
                          className="flex items-center rounded-xl"
                          style={{
                            gap: 8,
                            padding: "10px 24px",
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            color: "#8b949e",
                            fontSize: 13,
                            fontWeight: 500,
                            fontFamily: "var(--font-sans)",
                            textDecoration: "none",
                            transition: "all 0.2s ease",
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                            e.currentTarget.style.color = "#e6edf3";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                            e.currentTarget.style.color = "#8b949e";
                          }}
                          id="connect-github-btn"
                        >
                          <GithubIcon size={16} />
                          Connect GitHub
                        </a>
                      </div>
                    </div>
                  )}
                  {/* Only render GitHubImport when GitHub is connected to avoid 401 redirect */}
                  <div style={{ opacity: hasGithub === false ? 0.15 : 1, pointerEvents: hasGithub === false ? "none" : "auto", filter: hasGithub === false ? "blur(2px)" : "none", transition: "all 0.3s ease" }}>
                    {hasGithub ? (
                      <GitHubImport onClose={onClose} onSuccess={handleImportSuccess} />
                    ) : (
                      /* Placeholder skeleton when GitHub not connected */
                      <div className="flex flex-col" style={{ gap: 28 }}>
                        <div className="flex flex-col" style={{ gap: 14 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#484f58", fontFamily: "var(--font-sans)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Import via GitHub URL</span>
                          <div className="flex items-center" style={{ gap: 12 }}>
                            <div className="flex-1 rounded-xl" style={{ height: 48, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }} />
                            <div className="rounded-xl" style={{ height: 48, width: 100, background: "rgba(124,58,237,0.15)" }} />
                          </div>
                        </div>
                        <div className="flex items-center" style={{ gap: 16 }}>
                          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.05)" }} />
                          <span style={{ fontSize: 11, color: "#30363d", fontFamily: "var(--font-sans)" }}>OR SELECT FROM ACCOUNT</span>
                          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.05)" }} />
                        </div>
                        <div className="flex flex-col" style={{ gap: 8 }}>
                          {[1, 2, 3].map((i) => (
                            <div key={i} className="rounded-xl" style={{ height: 60, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            </motion.div>

            {/* ── Bottom Help Text ───────────────────────────────── */}
            <motion.div
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

        <AnimatePresence>
          {showSuccessOverlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center"
              style={{ background: "rgba(10, 14, 20, 0.8)", backdropFilter: "blur(12px)" }}
            >
              <motion.div
                initial={{ scale: 0.8, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="flex flex-col items-center justify-center rounded-3xl"
                style={{ padding: "40px 48px", background: "rgba(17, 24, 39, 0.9)", border: "1px solid rgba(63, 185, 80, 0.3)", boxShadow: "0 20px 60px rgba(0, 0, 0, 0.6), 0 0 80px rgba(63, 185, 80, 0.1)" }}
              >
                <motion.div
                   initial={{ scale: 0 }}
                   animate={{ scale: 1 }}
                   transition={{ delay: 0.15, type: "spring", stiffness: 300, damping: 20 }}
                   className="flex items-center justify-center rounded-full mb-6"
                   style={{ width: 72, height: 72, background: "rgba(63, 185, 80, 0.15)" }}
                >
                   <CheckCircle2 size={36} strokeWidth={2.5} style={{ color: "#3fb950" }} />
                </motion.div>
                <h3 style={{ fontSize: 26, fontWeight: 700, color: "#e6edf3", marginBottom: 12, fontFamily: "var(--font-sans)", letterSpacing: "-0.01em" }}>Import Successful</h3>
                <p style={{ color: "#8b949e", fontSize: 15, fontFamily: "var(--font-sans)" }}>Preparing your project workspace...</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </ToastProvider>,
    document.body
  );
}
