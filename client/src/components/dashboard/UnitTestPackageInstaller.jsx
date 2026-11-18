import React, { useState } from "react";
import {
  Package,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Terminal,
  FolderTree,
  ChevronDown,
  ChevronUp,
  Plus,
} from "lucide-react";

/**
 * UnitTestPackageInstaller
 *
 * Dedicated package installer placed directly under Guided Unit Test Workflow.
 * Allows users to auto-install detected missing dependencies (e.g. 'mathjs')
 * or manually install any npm package into root or monorepo subpackages,
 * immediately triggering test rerun and coverage dashboard refresh.
 */
export default function UnitTestPackageInstaller({
  snapshotId,
  missingDependency = null,
  onInstallDependency,
  isInstalling = false,
  onRerunTests,
  isLight = false,
}) {
  const [packageNameInput, setPackageNameInput] = useState("");
  const [isDev, setIsDev] = useState(false);
  const [targetSubDir, setTargetSubDir] = useState("");
  const [installOutput, setInstallOutput] = useState(null);
  const [installError, setInstallError] = useState(null);
  const [showConsole, setShowConsole] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  React.useEffect(() => {
    if (missingDependency?.importedFrom) {
      const match = missingDependency.importedFrom.match(/^(?:.*[\\/])?(backend|server|app|client|frontend|web)[\\/]/i);
      if (match) {
        setTargetSubDir(match[1]);
      }
    }
  }, [missingDependency]);

  const handleInstallAuto = async () => {
    if (!missingDependency?.packageName || isInstalling) return;
    setInstallError(null);
    setInstallOutput(null);
    try {
      const res = await onInstallDependency(
        missingDependency.packageName,
        false,
        missingDependency.importedFrom || null
      );
      if (res?.installResult) {
        setInstallOutput(res.installResult.stdout || res.installResult.stderr || "Installation succeeded.");
      }
    } catch (err) {
      setInstallError(err.message || `Failed to install ${missingDependency.packageName}`);
    }
  };

  const handleInstallManual = async (e) => {
    if (e) e.preventDefault();
    const pkg = packageNameInput.trim();
    if (!pkg || isInstalling) return;
    setInstallError(null);
    setInstallOutput(null);

    const importedFromCandidate = targetSubDir.trim() ? `${targetSubDir.trim()}/package.json` : null;

    try {
      const res = await onInstallDependency(
        pkg,
        isDev,
        importedFromCandidate
      );
      if (res?.installResult) {
        setInstallOutput(res.installResult.stdout || res.installResult.stderr || "Installation succeeded.");
      }
      setPackageNameInput("");
    } catch (err) {
      setInstallError(err.message || `Failed to install ${pkg}`);
    }
  };

  return (
    <section
      data-snapshot-id={snapshotId || undefined}
      data-light={isLight ? "true" : "false"}
      className={`mb-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden transition-colors ${
        missingDependency ? "border-l-2 border-l-rose-400/65" : ""
      }`}
    >
      {/* Header bar */}
      <div
        onClick={() => setIsExpanded((prev) => !prev)}
        className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-[var(--color-surface-secondary)]/40 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center shrink-0 text-[var(--color-text-secondary)]">
            <Package size={14} className={missingDependency ? "text-rose-400/80" : ""} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-[var(--color-text)]">
                Project Dependency Manager
              </span>
              {missingDependency ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/[0.06] text-rose-300/85 border border-rose-500/20">
                  <AlertTriangle size={11} />
                  <span>Missing package</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
                  Workspace packages
                </span>
              )}
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] m-0 mt-0.5 truncate">
              Install missing packages into your project or monorepo subpackages and automatically re-run test suites.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer shrink-0"
          title={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 pt-3 border-t border-[var(--color-border)] space-y-3">
          {/* 1. Auto-detected Missing Dependency Quick Action Banner */}
          {missingDependency && (
            <div className="p-3 rounded-md bg-rose-500/[0.06] border border-rose-500/20 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle size={15} className="text-rose-400/80 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--color-text)]">
                    Missing package required by tests:{" "}
                    <code className="font-mono text-rose-300/90">{missingDependency.packageName}</code>
                  </div>
                  {missingDependency.importedFrom && (
                    <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5 font-mono truncate">
                      Imported from: {missingDependency.importedFrom}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleInstallAuto}
                disabled={isInstalling}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-primary)]/90 hover:bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                {isInstalling ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Installing & Running Tests...</span>
                  </>
                ) : (
                  <>
                    <Download size={13} />
                    <span>Install &apos;{missingDependency.packageName}&apos; &amp; Rerun Tests</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* 2. Manual Package Installer Form */}
          <form
            onSubmit={handleInstallManual}
            className="flex flex-wrap items-center gap-2.5"
          >
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Package name (e.g. mathjs, lodash, @types/jest)"
                value={packageNameInput}
                onChange={(e) => setPackageNameInput(e.target.value)}
                disabled={isInstalling}
                className="w-full px-3 py-1.5 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] font-mono"
              />
            </div>

            <div className="w-40 relative flex items-center">
              <FolderTree size={12} className="absolute left-2.5 text-[var(--color-text-muted)] pointer-events-none" />
              <input
                type="text"
                placeholder="Target (e.g. backend)"
                value={targetSubDir}
                onChange={(e) => setTargetSubDir(e.target.value)}
                disabled={isInstalling}
                title="Target subpackage folder (e.g. backend, server, app). Leave blank for root project."
                className="w-full pl-7 pr-2.5 py-1.5 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] font-mono"
              />
            </div>

            <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] cursor-pointer select-none whitespace-nowrap font-mono">
              <input
                type="checkbox"
                checked={isDev}
                onChange={(e) => setIsDev(e.target.checked)}
                disabled={isInstalling}
                className="rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer"
              />
              <span>--save-dev</span>
            </label>

            <button
              type="submit"
              disabled={isInstalling || !packageNameInput.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {isInstalling ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  <span>Installing...</span>
                </>
              ) : (
                <>
                  <Plus size={13} />
                  <span>Install & Rerun Tests</span>
                </>
              )}
            </button>

            {onRerunTests && !packageNameInput.trim() && (
              <span className="sr-only">Rerun available</span>
            )}
          </form>

          {/* Feedback messages */}
          {installError && (
            <div className="px-3 py-2 rounded-md border border-rose-500/20 bg-rose-500/[0.06] text-rose-300/85 text-xs flex items-center justify-between gap-2">
              <span>{installError}</span>
              <button
                type="button"
                onClick={() => setShowConsole((v) => !v)}
                className="text-[11px] underline text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer shrink-0"
              >
                {showConsole ? "Hide Log" : "View Output"}
              </button>
            </div>
          )}

          {installOutput && (
            <div className="px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={13} className="text-emerald-500/75 shrink-0" />
                <span>Package installed successfully. Tests re-run triggered.</span>
              </div>
              <button
                type="button"
                onClick={() => setShowConsole((v) => !v)}
                className="text-[11px] underline text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer shrink-0"
              >
                {showConsole ? "Hide Log" : "View Output"}
              </button>
            </div>
          )}

          {showConsole && (installOutput || installError) && (
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-[11px] text-[var(--color-text-secondary)] max-h-44 overflow-y-auto whitespace-pre-wrap custom-scrollbar">
              <div className="flex items-center gap-1.5 mb-1.5 text-[var(--color-text-muted)]">
                <Terminal size={12} />
                <span>npm install output</span>
              </div>
              {installOutput || installError}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
