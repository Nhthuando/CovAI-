import { createPortal } from "react-dom";
import { useState, useEffect } from "react";
import {
  X,
  CheckCircle2,
  FolderGit2,
  Shield,
  HelpCircle,
  Zap,
} from "lucide-react";
import LocalUpload from "./LocalUpload";
import GitHubImport from "./GitHubImport";
import { ToastProvider } from "../ToastContext";
import { getUserProfileApi } from "../../../services/project.service";
import Button from "../../common/Button";
import Badge from "../../common/Badge";

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
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-5xl max-h-[90vh] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-xl)] shadow-xl flex flex-col overflow-hidden text-[var(--color-text)] font-sans relative"
        >
          {/* ── Modal Header ────────────────────────────────────────── */}
          <div className="h-14 px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white flex items-center justify-center shrink-0">
                <FolderGit2 size={16} />
              </div>
              <div className="flex items-center gap-2">
                <h2
                  id="import-modal-title"
                  className="font-bold text-sm tracking-tight text-[var(--color-text)]"
                >
                  Import Project
                </h2>
                <Badge variant="primary" size="sm">
                  Hub
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-block text-[11px] font-mono text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-[var(--radius-sm)] px-1.5 py-0.5">
                Esc
              </span>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                title="Close"
                aria-label="Close"
                id="import-cancel-btn"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* ── Modal Body: 2 Column Layout ─────────────────────────── */}
          <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 min-h-[500px]">
            {/* Left Column: Local Archive Upload (5 cols) */}
            <div className="lg:col-span-5 p-6 border-b lg:border-b-0 lg:border-r border-[var(--color-border)] flex flex-col justify-between bg-[var(--color-surface)]">
              <div className="flex flex-col gap-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-2">
                    <Zap size={13} />
                    Local Ingest
                  </div>
                  <h3 className="text-base font-bold text-[var(--color-text)] tracking-tight">
                    Upload Codebase Archive
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                    Upload a compressed archive (
                    <code className="text-[var(--color-text)] font-mono">
                      .zip
                    </code>{" "}
                    or{" "}
                    <code className="text-[var(--color-text)] font-mono">
                      .rar
                    </code>
                    ). AST and cyclomatic complexity graphs are synthesized
                    automatically.
                  </p>
                </div>

                {/* Local Upload Component */}
                <LocalUpload
                  onClose={onClose}
                  onSuccess={handleImportSuccess}
                />
              </div>

              {/* Left footer note */}
              <div className="pt-4 mt-4 border-t border-[var(--color-border)] flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
                <Shield
                  size={13}
                  className="text-[var(--color-success)] shrink-0"
                />
                <span>
                  Safe upload: archives are scanned and cleaned of secrets
                  locally.
                </span>
              </div>
            </div>

            {/* Right Column: GitHub Integration (7 cols) */}
            <div className="lg:col-span-7 p-6 flex flex-col relative bg-[var(--color-surface)]">
              {/* When GitHub is not linked */}
              {hasGithub === false && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-8 bg-[var(--color-surface)]/95 backdrop-blur-xs">
                  <div className="flex flex-col items-center text-center max-w-sm gap-3.5">
                    <div className="w-12 h-12 rounded-[var(--radius-lg)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text)]">
                      <GithubIcon size={24} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-[var(--color-text)] tracking-tight">
                        Connect GitHub Account
                      </h4>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                        Link your GitHub account to import public or private
                        repositories with one click and track test branch
                        coverage.
                      </p>
                    </div>

                    <a
                      href={`https://github.com/login/oauth/authorize?client_id=${
                        import.meta.env.VITE_GITHUB_CLIENT_ID || ""
                      }&scope=repo,user:email`}
                      className="mt-2 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-[var(--radius-md)] text-xs font-semibold text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer shadow-xs"
                      id="connect-github-btn"
                    >
                      <GithubIcon size={14} />
                      <span>Connect with GitHub</span>
                    </a>

                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
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

          {/* ── Modal Footer ────────────────────────────────────────── */}
          <div className="h-11 px-6 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between text-xs text-[var(--color-text-muted)] shrink-0">
            <div className="flex items-center gap-1.5">
              <HelpCircle size={13} />
              <span>Need help? Check our workspace import guide.</span>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
            >
              Cancel
            </Button>
          </div>

          {/* ── Success Overlay ─────────────────────────────────────── */}
          {showSuccessOverlay && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
              <div className="flex flex-col items-center justify-center rounded-[var(--radius-xl)] p-6 bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl max-w-sm text-center">
                <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/25 flex items-center justify-center mb-3 text-[var(--color-success)]">
                  <CheckCircle2 size={24} strokeWidth={2.5} />
                </div>
                <h3 className="text-base font-bold text-[var(--color-text)] tracking-tight">
                  Import Initialized!
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                  Your project package has been queued. Redirecting to
                  workspace...
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </ToastProvider>,
    document.body,
  );
}
