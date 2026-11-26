import { createPortal } from "react-dom";
import { useState, useEffect, useCallback } from "react";
import { X, CheckCircle2, ShieldCheck, Layers } from "lucide-react";
import LocalUpload from "./LocalUpload";
import GitHubImport from "./GitHubImport";
import { ToastProvider } from "../ToastContext";
import { getUserProfileApi } from "../../../services/project.service";
import CovaiLogo from "../../common/CovaiLogo";
import "../portfolio/portfolio.css";

export default function ImportLayout({ onClose, onSuccess }) {
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [hasGithub, setHasGithub] = useState(null);
  const [profileError, setProfileError] = useState("");
  const [profileRetrySeq, setProfileRetrySeq] = useState(0);

  const loadGithubStatus = useCallback(() => {
    setProfileError("");
    setHasGithub(null);
    setProfileRetrySeq((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let active = true;
    getUserProfileApi()
      .then((data) => {
        if (!active) return;
        const githubId = data?.githubUserId || data?.user?.githubUserId;
        setProfileError("");
        setHasGithub(!!githubId);
      })
      .catch((err) => {
        if (!active) return;
        console.error("[ImportLayout] Failed to fetch user profile:", err);
        setProfileError(
          err instanceof TypeError
            ? "Unable to reach CovAI server. Please verify the backend is running."
            : err?.message || "Unable to verify GitHub connection status.",
        );
        setHasGithub(false);
      });
    return () => {
      active = false;
    };
  }, [profileRetrySeq]);

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
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-[2px]"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="portfolio-studio w-full max-w-[960px] max-h-[90vh] bg-[var(--ps-surface)] border border-[var(--ps-line-strong)] rounded-[12px] shadow-2xl flex flex-col overflow-hidden text-[var(--ps-ink)] relative"
        >
          {/* ── Top Sheet Header ────────────────────────────────────── */}
          <div className="px-6 py-4 border-b border-[var(--ps-line)] bg-[var(--ps-surface)] flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <CovaiLogo size={26} />
              <div className="min-w-0">
                <h2
                  id="import-modal-title"
                  className="ps-display text-[15px] font-semibold text-[var(--ps-ink)] leading-tight"
                >
                  Add repository
                </h2>
                <p className="text-xs text-[var(--ps-ink-muted)] mt-0.5 truncate">
                  Import a local archive or connect a GitHub repository for AST
                  and test synthesis
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-[var(--ps-line)] bg-[var(--ps-surface-2)]/60 hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors cursor-pointer shrink-0"
              title="Close (Esc)"
              aria-label="Close"
              id="import-cancel-btn"
            >
              <span className="hidden sm:inline text-[11px] ps-mono text-[var(--ps-ink-muted)]">
                Esc
              </span>
              <X size={14} />
            </button>
          </div>

          {/* ── Two-Pane Workspace ──────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 min-h-[480px]">
            {/* Left Pane: Archive Upload (5 cols, subtle recessed tray) */}
            <div className="lg:col-span-5 p-5 sm:p-6 bg-[var(--ps-inset)] border-b lg:border-b-0 lg:border-r border-[var(--ps-line)] flex flex-col justify-between gap-4">
              <div className="flex flex-col gap-3.5 flex-1">
                <div>
                  <h3 className="text-xs font-semibold text-[var(--ps-ink)]">
                    Codebase archive
                  </h3>
                  <p className="text-[11.5px] text-[var(--ps-ink-secondary)] mt-1 leading-relaxed">
                    Upload a compressed project bundle (
                    <span className="ps-mono text-[var(--ps-ink)]">.zip</span>,{" "}
                    <span className="ps-mono text-[var(--ps-ink)]">.rar</span>,
                    or{" "}
                    <span className="ps-mono text-[var(--ps-ink)]">
                      .tar.gz
                    </span>
                    ) to generate call graphs and test suites.
                  </p>
                </div>

                <LocalUpload
                  onClose={onClose}
                  onSuccess={handleImportSuccess}
                />
              </div>

              <div className="pt-3 border-t border-[var(--ps-line)] flex items-center gap-2 text-[11px] text-[var(--ps-ink-muted)]">
                <ShieldCheck
                  size={14}
                  style={{ color: "var(--ps-emerald)" }}
                  className="shrink-0"
                />
                <span>
                  Secrets and credential files are filtered before indexing.
                </span>
              </div>
            </div>

            {/* Right Pane: GitHub Source (7 cols) */}
            <div className="lg:col-span-7 p-5 sm:p-6 bg-[var(--ps-surface)] flex flex-col relative min-h-[380px]">
              <GitHubImport
                onClose={onClose}
                onSuccess={handleImportSuccess}
                hasGithub={hasGithub}
                profileError={profileError}
                onRetryProfile={loadGithubStatus}
              />
            </div>
          </div>

          {/* ── Minimal Footer ──────────────────────────────────────── */}
          <div className="h-12 px-6 border-t border-[var(--ps-line)] bg-[var(--ps-inset)] flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center gap-2 text-[11px] text-[var(--ps-ink-muted)]">
              <Layers size={13} className="shrink-0" />
              <span>
                Supports JavaScript &amp; TypeScript workspaces (Node, React,
                Express)
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-7 px-3 rounded-md border border-[var(--ps-line)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-2)] text-xs font-medium text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {/* ── Success Overlay ─────────────────────────────────────── */}
          {showSuccessOverlay && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4">
              <div className="flex flex-col items-center justify-center rounded-xl p-6 bg-[var(--ps-surface)] border border-[var(--ps-line-strong)] shadow-2xl max-w-xs w-full text-center">
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center mb-3 border"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--ps-emerald) 12%, transparent)",
                    borderColor:
                      "color-mix(in srgb, var(--ps-emerald) 30%, transparent)",
                    color: "var(--ps-emerald)",
                  }}
                >
                  <CheckCircle2 size={22} strokeWidth={2.2} />
                </div>
                <h3 className="ps-display text-sm font-semibold text-[var(--ps-ink)]">
                  Import queued
                </h3>
                <p className="text-xs text-[var(--ps-ink-secondary)] mt-1 leading-relaxed">
                  Indexing codebase structure and redirecting to your
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
