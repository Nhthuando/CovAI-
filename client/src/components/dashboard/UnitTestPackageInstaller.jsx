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
  RotateCcw,
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

  // Auto-fill subpackage if missingDependency has importedFrom (e.g. backend/src/...)
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
    <div
      style={{
        marginTop: 14,
        marginBottom: 20,
        background: isLight
          ? "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)"
          : "linear-gradient(180deg, #161b22 0%, #0d1117 100%)",
        border: missingDependency
          ? isLight ? "1px solid #f87171" : "1px solid rgba(239, 68, 68, 0.45)"
          : isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: 10,
        padding: "16px 20px",
        boxShadow: missingDependency
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
              background: missingDependency
                ? "rgba(239, 68, 68, 0.15)"
                : isLight ? "rgba(99, 102, 241, 0.12)" : "rgba(99, 102, 241, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: missingDependency ? "#ef4444" : "#818cf8",
            }}
          >
            <Package size={17} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: isLight ? "#0f172a" : "#f1f5f9" }}>
                Project Dependency Manager
              </span>
              {missingDependency ? (
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
                  <AlertTriangle size={11} /> MISSING PACKAGE DETECTED
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
          {missingDependency && (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                background: isLight ? "#fef2f2" : "rgba(239, 68, 68, 0.12)",
                border: isLight ? "1px solid #fecaca" : "1px solid rgba(239, 68, 68, 0.35)",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 260 }}>
                <AlertTriangle size={18} style={{ color: "#ef4444", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: isLight ? "#991b1b" : "#fca5a5" }}>
                    Missing package required by tests: <code style={{ fontWeight: 800, color: "#f87171" }}>{missingDependency.packageName}</code>
                  </div>
                  {missingDependency.importedFrom && (
                    <div style={{ fontSize: 11, color: isLight ? "#b91c1c" : "#cbd5e1", marginTop: 2 }}>
                      Imported from: <span style={{ fontFamily: "var(--font-mono)" }}>{missingDependency.importedFrom}</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleInstallAuto}
                disabled={isInstalling}
                style={{
                  background: "#dc2626",
                  border: "1px solid #b91c1c",
                  color: "#ffffff",
                  padding: "8px 16px",
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: isInstalling ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  boxShadow: "0 2px 8px rgba(220, 38, 38, 0.35)",
                  transition: "all 0.15s ease",
                }}
                className="hover:opacity-90"
              >
                {isInstalling ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Installing & Running Tests...</span>
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    <span>Install '{missingDependency.packageName}' & Rerun Tests</span>
                  </>
                )}
              </button>
            </div>
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
                placeholder="Package name (e.g. mathjs, lodash, @types/jest)"
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
              <span>{installError}</span>
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
                <span>Package installed successfully. Tests re-run triggered.</span>
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

