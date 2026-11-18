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
 * Allows users to select detected missing dependencies or enter npm packages
 * to install into root or monorepo subpackages,
 * immediately triggering test rerun and coverage dashboard refresh.
 */
export default function UnitTestPackageInstaller({
  snapshotId = null,
  missingDependencies = [],
  onInstallDependencies,
  onRerunTests = null,
  isInstalling = false,
  isLight = false,
}) {
  const [packageNameInput, setPackageNameInput] = useState("");
  const [isDev, setIsDev] = useState(false);
  const [targetSubDir, setTargetSubDir] = useState("");
  const [installOutput, setInstallOutput] = useState(null);
  const [installError, setInstallError] = useState(null);
  const [showConsole, setShowConsole] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [excludedPackages, setExcludedPackages] = useState(new Set());
  const [installedPackages, setInstalledPackages] = useState(new Set());
  const [installedCount, setInstalledCount] = useState(0);
  const packageKey = dependency => JSON.stringify([dependency.packageName, dependency.targetPackage || dependency.importedFrom]);
  const pendingPackages = missingDependencies.filter(dependency => !installedPackages.has(packageKey(dependency)));
  const selectedPackages = pendingPackages.filter(dependency => !excludedPackages.has(packageKey(dependency)));
  const manualPackages = [...new Set(packageNameInput.trim().split(/[\s,]+/).filter(Boolean))];

  const install = async (dependencies) => {
    if (!dependencies.length || isInstalling) return null;
    setInstallError(null);
    setInstallOutput(null);
    try {
      const result = await onInstallDependencies(dependencies);
      setInstalledPackages(previous => new Set([...previous, ...result.installed.map(packageKey)]));
      if (result.failed.length) {
        const failures = result.failed.map(item => `${item.packageName}: ${item.message}`).join("\n");
        const installed = result.installed.length ? `Installed ${result.installed.length} package(s).\n` : "";
        setInstallError(`${installed}${failures}\nTests were not queued. Retry the remaining packages.`);
      } else {
        setInstalledCount(result.installed.length);
        setInstallOutput(result.installed.map(item =>
          item.installResult?.stdout || item.installResult?.stderr || `${item.packageName} installed.`).join("\n"));
      }
      return result;
    } catch (err) {
      setInstallError(err.message || "Package installation failed.");
      return null;
    }
  };

  const handleInstallAuto = () => install(selectedPackages.map(dependency => ({
    ...dependency,
    isDev: /^(?:@testing-library\/|@types\/|@vitest\/|vitest$|jest(?:-|$)|jsdom$|happy-dom$)/.test(dependency.packageName),
  })));

  const handleInstallManual = async (e) => {
    e.preventDefault();
    const targetPackage = targetSubDir.trim() ? `${targetSubDir.trim()}/package.json` : "package.json";
    const result = await install(manualPackages.map(packageName => ({ packageName, isDev, targetPackage })));
    if (!result) return;
    const completed = new Set(result.installed.map(item => item.packageName));
    setPackageNameInput(manualPackages.filter(packageName => !completed.has(packageName)).join(", "));
  };

  return (
    <section
      data-snapshot-id={snapshotId || undefined}
      data-light={isLight ? "true" : "false"}
      className={`mb-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden transition-colors ${
        pendingPackages.length > 0 ? "border-l-2 border-l-rose-400/65" : ""
      }`}
    >
      {/* Header bar */}
      <div
        onClick={() => setIsExpanded((prev) => !prev)}
        className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-[var(--color-surface-secondary)]/40 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center shrink-0 text-[var(--color-text-secondary)]">
            <Package size={14} className={pendingPackages.length > 0 ? "text-rose-400/80" : ""} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-[var(--color-text)]">
                Project Dependency Manager
              </span>
              {pendingPackages.length > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/[0.06] text-rose-300/85 border border-rose-500/20">
                  <AlertTriangle size={11} />
                  <span>{pendingPackages.length} Missing</span>
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
          {pendingPackages.length > 0 && (
            <fieldset className="mb-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3">
              <legend className="px-1 text-xs font-medium text-[var(--color-warning)]">Packages reported missing by the test runner</legend>
              <div className="divide-y divide-[var(--color-border)]">
                {pendingPackages.map(dependency => {
                  const key = packageKey(dependency);
                  return (
                    <label key={key} className="flex items-center gap-2 py-2 text-xs text-[var(--color-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={!excludedPackages.has(key)}
                        disabled={isInstalling}
                        onChange={event => {
                          const checked = event.target.checked;
                          setExcludedPackages(previous => {
                            const next = new Set(previous);
                            if (checked) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        }}
                      />
                      <code className="font-mono text-[var(--color-text)]">{dependency.packageName}</code>
                      {dependency.targetPackage && <span className="font-mono">{dependency.targetPackage}</span>}
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={handleInstallAuto}
                disabled={isInstalling || !selectedPackages.length}
                className="mt-2 inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isInstalling ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                {isInstalling ? "Installing packages…" : `Install ${selectedPackages.length} & Rerun Tests`}
              </button>
            </fieldset>
          )}

          {/* 2. Manual Package Installer Form */}
          <form
            onSubmit={handleInstallManual}
            className="flex flex-wrap items-center gap-2.5"
          >
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                aria-label="Package names"
                placeholder="Package names separated by commas or spaces"
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
              <span className="whitespace-pre-line">{installError}</span>
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
                <span>Installed {installedCount} {installedCount === 1 ? "package" : "packages"}. Test rerun queued.</span>
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
