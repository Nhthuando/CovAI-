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
  missingDependencies = [],
  onInstallDependencies,
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
    <div
      style={{
        marginTop: 14,
        marginBottom: 20,
        background: isLight
          ? "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)"
          : "linear-gradient(180deg, #161b22 0%, #0d1117 100%)",
        border: pendingPackages.length
          ? isLight ? "1px solid #f87171" : "1px solid rgba(239, 68, 68, 0.45)"
          : isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: 10,
        padding: "16px 20px",
        boxShadow: pendingPackages.length
          ? "0 4px 20px rgba(239, 68, 68, 0.15)"
          : isLight ? "0 2px 8px rgba(0,0,0,0.04)" : "0 4px 14px rgba(0, 0, 0, 0.35)",
        transition: "all 0.2s ease",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: pendingPackages.length
                ? "rgba(239, 68, 68, 0.15)"
                : isLight ? "rgba(99, 102, 241, 0.12)" : "rgba(99, 102, 241, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: pendingPackages.length ? "#ef4444" : "#818cf8",
            }}
          >
            <Package size={17} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: isLight ? "#0f172a" : "#f1f5f9" }}>
                Project Dependency Manager
              </span>
              {pendingPackages.length > 0 ? (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    background: "rgba(239, 68, 68, 0.2)",
                    color: "#f87171",
                    padding: "2px 8px",
                    borderRadius: 999,
                    letterSpacing: "0.4px",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <AlertTriangle size={11} /> {pendingPackages.length} MISSING
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 650,
                    background: isLight ? "rgba(100, 116, 139, 0.12)" : "rgba(255, 255, 255, 0.08)",
                    color: isLight ? "#475569" : "#94a3b8",
                    padding: "1px 7px",
                    borderRadius: 999,
                  }}
                >
                  Workspace Packages
                </span>
              )}
            </div>
            <p style={{ margin: "2px 0 0 0", fontSize: 11.5, color: isLight ? "#64748b" : "#94a3b8" }}>
              Install missing packages into your project or monorepo subpackages and automatically re-run test suites.
            </p>
          </div>
        </div>

        <button
          type="button"
          style={{
            background: "transparent",
            border: "none",
            color: isLight ? "#64748b" : "#94a3b8",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
          }}
          title={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {isExpanded && (
        <div style={{ marginTop: 14 }}>
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
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {/* Package Name Input */}
            <div style={{ flex: "1 1 240px", minWidth: 180, position: "relative" }}>
              <input
                type="text"
                aria-label="Package names"
                placeholder="Package names separated by commas or spaces"
                value={packageNameInput}
                onChange={(e) => setPackageNameInput(e.target.value)}
                disabled={isInstalling}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: 12.5,
                  borderRadius: 6,
                  border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.16)",
                  background: isLight ? "#ffffff" : "rgba(0, 0, 0, 0.35)",
                  color: isLight ? "#0f172a" : "#f1f5f9",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Subpackage Target (Optional for Monorepo) */}
            <div style={{ flex: "0 1 150px", minWidth: 120 }}>
              <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
                <FolderTree size={13} style={{ position: "absolute", left: 8, color: isLight ? "#64748b" : "#94a3b8" }} />
                <input
                  type="text"
                  placeholder="Target (e.g. backend)"
                  value={targetSubDir}
                  onChange={(e) => setTargetSubDir(e.target.value)}
                  disabled={isInstalling}
                  title="Target subpackage folder (e.g. backend, server, app). Leave blank for root project."
                  style={{
                    width: "100%",
                    padding: "8px 10px 8px 26px",
                    fontSize: 12,
                    borderRadius: 6,
                    border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.16)",
                    background: isLight ? "#ffffff" : "rgba(0, 0, 0, 0.35)",
                    color: isLight ? "#0f172a" : "#f1f5f9",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            {/* Save as devDependency Checkbox */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                color: isLight ? "#475569" : "#cbd5e1",
                cursor: "pointer",
                userSelect: "none",
                whiteSpace: "nowrap",
              }}
            >
              <input
                type="checkbox"
                checked={isDev}
                onChange={(e) => setIsDev(e.target.checked)}
                disabled={isInstalling}
                style={{ cursor: "pointer" }}
              />
              <span>--save-dev</span>
            </label>

            {/* Install & Rerun Tests Button */}
            <button
              type="submit"
              disabled={isInstalling || !packageNameInput.trim()}
              style={{
                background: isInstalling || !packageNameInput.trim()
                  ? isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.08)"
                  : "#4f46e5",
                border: "none",
                color: isInstalling || !packageNameInput.trim()
                  ? isLight ? "#94a3b8" : "rgba(255, 255, 255, 0.3)"
                  : "#ffffff",
                padding: "8px 16px",
                borderRadius: 6,
                fontSize: 12.5,
                fontWeight: 650,
                cursor: isInstalling || !packageNameInput.trim() ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.15s ease",
              }}
            >
              {isInstalling ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Installing...</span>
                </>
              ) : (
                <>
                  <Plus size={14} />
                  <span>Install & Rerun Tests</span>
                </>
              )}
            </button>
          </form>

          {/* Feedback messages */}
          {installError && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#f87171",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span className="whitespace-pre-line">{installError}</span>
              <button
                type="button"
                onClick={() => setShowConsole((v) => !v)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#fca5a5",
                  fontSize: 11,
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                {showConsole ? "Hide Log" : "View Output"}
              </button>
            </div>
          )}

          {installOutput && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(34, 197, 94, 0.1)",
                border: "1px solid rgba(34, 197, 94, 0.25)",
                color: isLight ? "#15803d" : "#4ade80",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={14} />
                <span>Installed {installedCount} {installedCount === 1 ? "package" : "packages"}. Test rerun queued.</span>
              </div>
              <button
                type="button"
                onClick={() => setShowConsole((v) => !v)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: isLight ? "#15803d" : "#4ade80",
                  fontSize: 11,
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                {showConsole ? "Hide Log" : "View Output"}
              </button>
            </div>
          )}

          {/* Expandable Console Log */}
          {showConsole && (installOutput || installError) && (
            <div
              style={{
                marginTop: 10,
                background: "#090d13",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: 6,
                padding: "10px 12px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "#94a3b8",
                maxHeight: 180,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, color: "#64748b" }}>
                <Terminal size={12} />
                <span>npm install output</span>
              </div>
              {installOutput || installError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

