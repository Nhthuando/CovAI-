import { createPortal } from "react-dom";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  X,
  Zap,
  ChevronRight,
  CheckCircle2,
  Lock,
  FolderGit2,
  Shield,
  HelpCircle,
  Code2,
  GitBranch,
} from "lucide-react";
import LocalUpload from "./LocalUpload";
import GitHubImport from "./GitHubImport";
import { ToastProvider } from "../ToastContext";
import { getUserProfileApi } from "../../../services/project.service";

/* ── GitHub SVG Icon ──────────────────────────────────────── */
function GithubIcon({ size = 16, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

/* ── Animation variants ───────────────────────────────────── */
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.25, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.2, ease: "easeIn" } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.3, ease: "easeOut" },
  },
  exit: { opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.2 } },
};

export default function ImportLayout({ onClose, onSuccess }) {
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [hasGithub, setHasGithub] = useState(null); // null = loading, true/false = resolved

  useEffect(() => {
    getUserProfileApi()
      .then((data) => {
        const githubId = data?.githubUserId || data?.user?.githubUserId;
        setHasGithub(!!githubId);
      })
      .catch((err) => {
        console.error("[ImportLayout] Failed to fetch user profile:", err);
        setHasGithub(false);
      });
  }, []);

  // Keyboard shortcut: Esc to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleImportSuccess = () => {
    setShowSuccessOverlay(true);
    setTimeout(() => {
      onSuccess?.();
    }, 1200);
  };

  return createPortal(
    <ToastProvider>
      <motion.div
        className="fixed inset-0 z-50 flex flex-col bg-[#090d13] text-neutral-100 selection:bg-violet-500/30 font-sans overflow-hidden"
        variants={overlayVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        {/* ── Ambient gradient glow ────────────────────────────── */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-b from-violet-600/10 via-indigo-600/5 to-transparent blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-600/5 blur-3xl pointer-events-none" />

        {/* ── Top Bar ──────────────────────────────────────────── */}
        <header className="h-14 px-6 border-b border-white/5 bg-[#090d13]/80 backdrop-blur-xl flex items-center justify-between flex-shrink-0 z-20">
          {/* Left: Brand */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/20 ring-1 ring-white/20">
              <Shield size={16} className="text-white" />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-white text-base">
                CovAI
              </span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20 font-semibold">
                Import Hub
              </span>
            </div>
          </div>

          {/* Right: Close action */}
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex items-center gap-2 cursor-pointer"
              id="import-cancel-btn"
            >
              <span>Close</span>
              <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-white/10 text-neutral-400">
                Esc
              </span>
            </button>
          </div>
        </header>

        {/* ── Main Scrollable Area ──────────────────────────────── */}
        <div className="flex-1 overflow-y-auto z-10 flex flex-col items-center py-8 px-4 sm:px-8">
          <motion.div
            className="w-full max-w-6xl flex flex-col gap-6"
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {/* Breadcrumb row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={onClose}
                  className="flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors font-medium cursor-pointer"
                  id="import-back-btn"
                >
                  <ArrowLeft size={14} />
                  <span>Back to Workspaces</span>
                </button>
                <ChevronRight size={12} className="text-neutral-600" />
                <span className="text-neutral-400 font-medium">
                  New Project
                </span>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-neutral-500 font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Parser Engine Ready</span>
              </div>
            </div>

            {/* ── Split Layout Card ───────────────────────────────── */}
            <div className="rounded-2xl border border-white/10 bg-[#0d1117]/90 backdrop-blur-xl shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[580px]">
              {/* Left Panel: Local Archive Upload (5 cols) */}
              <div className="lg:col-span-5 p-7 border-b lg:border-b-0 lg:border-r border-white/5 flex flex-col justify-between bg-gradient-to-b from-white/[0.015] to-transparent">
                <div className="flex flex-col gap-5">
                  <div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-semibold uppercase tracking-wider mb-3">
                      <Zap size={12} />
                      Local Ingest
                    </div>
                    <h2 className="text-lg font-bold text-white tracking-tight">
                      Upload Project Package
                    </h2>
                    <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                      Upload a compressed codebase (
                      <code className="text-neutral-300 font-mono">.zip</code>{" "}
                      or{" "}
                      <code className="text-neutral-300 font-mono">.rar</code>).
                      We extract and initialize AST & CFG models automatically.
                    </p>
                  </div>

                  {/* Local Upload Component */}
                  <LocalUpload
                    onClose={onClose}
                    onSuccess={handleImportSuccess}
                  />
                </div>

                {/* Left footer note */}
                <div className="pt-4 border-t border-white/5 flex items-center gap-2 text-[11px] text-neutral-500">
                  <Shield
                    size={13}
                    className="text-emerald-400 flex-shrink-0"
                  />
                  <span>
                    Safe upload: archives are scanned & cleaned from sensitive
                    files.
                  </span>
                </div>
              </div>

              {/* Right Panel: GitHub Integration (7 cols) */}
              <div className="lg:col-span-7 p-7 flex flex-col relative bg-gradient-to-b from-white/[0.005] to-transparent">
                {/* When GitHub is not linked */}
                {hasGithub === false && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-8 bg-[#0d1117]/95 backdrop-blur-md">
                    <div className="flex flex-col items-center text-center max-w-sm gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-xl">
                        <GithubIcon size={28} className="text-neutral-300" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white tracking-tight">
                          Connect GitHub Account
                        </h3>
                        <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">
                          Link your GitHub profile to import any public or
                          private repository with 1 click, track commits, and
                          automate test coverage suites.
                        </p>
                      </div>

                      <a
                        href={`https://github.com/login/oauth/authorize?client_id=${
                          import.meta.env.VITE_GITHUB_CLIENT_ID || ""
                        }&scope=repo,user:email`}
                        className="mt-2 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 shadow-lg shadow-violet-500/25 border border-white/20 transition-all flex items-center gap-2 cursor-pointer"
                        id="connect-github-btn"
                      >
                        <GithubIcon size={16} />
                        <span>Connect with GitHub</span>
                      </a>

                      <p className="text-[11px] text-neutral-500 mt-2">
                        You can still upload local archives on the left without
                        connecting GitHub.
                      </p>
                    </div>
                  </div>
                )}

                {/* When connected */}
                <div
                  className={`flex-1 flex flex-col ${
                    hasGithub === false
                      ? "opacity-10 pointer-events-none filter blur-[1px]"
                      : ""
                  }`}
                >
                  <GitHubImport
                    onClose={onClose}
                    onSuccess={handleImportSuccess}
                  />
                </div>
              </div>
            </div>

            {/* Bottom Help */}
            <div className="flex items-center justify-center gap-2 text-xs text-neutral-500 pt-2">
              <HelpCircle size={13} className="text-neutral-600" />
              <span>Need help importing?</span>
              <a
                href="#"
                className="text-violet-400 hover:text-violet-300 underline underline-offset-2 transition-colors"
              >
                View docs
              </a>
              <span>or contact support.</span>
            </div>
          </motion.div>
        </div>

        {/* ── Success Overlay ─────────────────────────────────── */}
        <AnimatePresence>
          {showSuccessOverlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-[#090d13]/80 backdrop-blur-md"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 15 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center rounded-2xl p-8 bg-[#111827] border border-emerald-500/30 shadow-2xl max-w-sm text-center"
              >
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mb-4 text-emerald-400">
                  <CheckCircle2 size={32} strokeWidth={2.5} />
                </div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Import Initialized!
                </h3>
                <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                  Your project package has been queued. Redirecting to
                  workspace...
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </ToastProvider>,
    document.body,
  );
}
