import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  History,
  RotateCcw,
  Zap,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileDiff,
  X,
  Loader2,
  Clock,
  Layers,
  Sparkles,
  Info
} from "lucide-react";

function sanitizeSummary(summary, version) {
  if (!summary) {
    return version === 1
      ? "Original project test suite before AI suggestions."
      : "AI-suggested unit tests covering untested branches and logic.";
  }
  if (typeof summary !== "string") return "";
  if (summary.includes("Bộ unit tests") || summary.includes("chưa phủ") || summary.includes("AI tạo")) {
    return "AI-suggested unit tests covering untested branches and logic.";
  }
  if (summary.includes("File chưa tồn tại") || summary.includes("Chưa có file")) {
    return "Test file did not exist prior to AI test generation (created as new).";
  }
  if (summary.includes("Gốc") || summary.includes("ban đầu")) {
    return "Original project test suite before AI suggestions.";
  }
  return summary;
}

/**
 * Format relative or localized ISO timestamp
 */
function formatTimestamp(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " " + d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch (_) {
    return "";
  }
}

/**
 * UnitTestVersionPopover
 * 
 * Elegant version management dropdown placed directly on the tab bar.
 * Allows users to inspect all version iterations (v1 Baseline, v2 AI Suggest, v3+),
 * switch/revert all files with 1 click, or inspect and toggle versions per file.
 */
export default function UnitTestVersionPopover({
  unitTestVersions = {},
  onSwitchVersion = null,
  isSwitchingVersion = false,
  switchingVersionFile = null,
  onReviewDiff = null,
  isLight = false,
  className = "",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showFileBreakdown, setShowFileBreakdown] = useState(false);
  const popoverRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on Esc key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const filesList = useMemo(() => {
    return Object.values(unitTestVersions || {});
  }, [unitTestVersions]);

  const totalFiles = filesList.length;

  // Aggregate global version list
  const { versionsMap, currentDominantVersion, hasV1, hasV2, anyOnV2, anyOnV1WithV2 } = useMemo(() => {
    const map = {}; // verNum -> { version, label, count, activeCount, latestTime, summaries }
    let v2Count = 0;
    let v1WithV2Count = 0;

    for (const fileRec of filesList) {
      const vers = fileRec.versions || [];
      const curVer = fileRec.currentVersion || 1;
      if (curVer >= 2) v2Count++;
      if (curVer === 1 && vers.length > 1) v1WithV2Count++;

      for (const v of vers) {
        const num = Number(v.version);
        if (!map[num]) {
          map[num] = {
            version: num,
            label: num === 1 ? "Version 1 (Baseline)" : `Version ${num} (AI Suggest / Applied)`,
            type: v.type,
            status: v.status,
            count: 0,
            activeCount: 0,
            latestTime: v.createdAt || "",
            summaries: new Set()
          };
        }
        map[num].count++;
        if (v.version === curVer) {
          map[num].activeCount++;
        }
        if (v.summary) {
          map[num].summaries.add(v.summary);
        }
        if (v.createdAt && (!map[num].latestTime || v.createdAt > map[num].latestTime)) {
          map[num].latestTime = v.createdAt;
        }
      }
    }

    const sortedVers = Object.values(map).sort((a, b) => b.version - a.version);

    let dominant = 1;
    if (v2Count > 0 && v2Count >= (totalFiles / 2)) {
      dominant = 2;
    }

    return {
      versionsMap: sortedVers,
      currentDominantVersion: dominant,
      hasV1: Boolean(map[1]),
      hasV2: Boolean(map[2]),
      anyOnV2: v2Count > 0,
      anyOnV1WithV2: v1WithV2Count > 0
    };
  }, [filesList, totalFiles]);

  const activeBadgeColor = isLight
    ? currentDominantVersion >= 2 ? "#7c3aed" : "#0284c7"
    : currentDominantVersion >= 2 ? "#c4b5fd" : "#38bdf8";

  const activeBadgeBg = isLight
    ? currentDominantVersion >= 2 ? "#f5f3ff" : "#f0f9ff"
    : currentDominantVersion >= 2 ? "rgba(139, 92, 246, 0.15)" : "rgba(2, 132, 199, 0.15)";

  const activeBadgeBorder = isLight
    ? currentDominantVersion >= 2 ? "#ddd6fe" : "#bae6fd"
    : currentDominantVersion >= 2 ? "rgba(139, 92, 246, 0.35)" : "rgba(2, 132, 199, 0.35)";

  return (
    <div className={`relative inline-block ${className}`} ref={popoverRef}>
      {/* ── Trigger Button on Tab Bar ── */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          background: activeBadgeBg,
          border: `1px solid ${activeBadgeBorder}`,
          color: activeBadgeColor,
          padding: "5px 11px",
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 650,
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          transition: "all 0.15s ease",
          boxShadow: isLight ? "0 1px 2px rgba(0,0,0,0.04)" : "none",
        }}
        className="hover:opacity-90 active:scale-[0.98]"
        title="Manage and view test suite version history"
        aria-expanded={isOpen}
      >
        {isSwitchingVersion && switchingVersionFile === "all" ? (
          <Loader2 size={13} className="animate-spin" />
        ) : currentDominantVersion >= 2 ? (
          <Zap size={13} style={{ color: isLight ? "#7c3aed" : "#a78bfa" }} />
        ) : (
          <History size={13} />
        )}

        <span>
          {totalFiles === 0
            ? "Version: v1 (Baseline)"
            : currentDominantVersion >= 2
            ? "Version: v2 (AI Active)"
            : "Version: v1 (Baseline)"}
        </span>

        {totalFiles > 0 && (
          <span
            style={{
              fontSize: 10,
              padding: "1px 5px",
              borderRadius: 4,
              background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.12)",
              color: isLight ? "#334155" : "#f1f5f9",
              fontWeight: 700,
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            {totalFiles} files
          </span>
        )}

        <ChevronDown
          size={12}
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
            opacity: 0.75,
          }}
        />
      </button>

      {/* ── Popover Dropdown Card ── */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: 410,
            maxWidth: "92vw",
            background: isLight ? "#ffffff" : "#11161d",
            border: isLight ? "1px solid #cbd5e1" : "1px solid #29313d",
            borderRadius: 10,
            boxShadow: isLight
              ? "0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)"
              : "0 14px 30px -4px rgba(0, 0, 0, 0.6), 0 6px 12px -4px rgba(0, 0, 0, 0.4)",
            zIndex: 60,
            overflow: "hidden",
            color: isLight ? "#0f172a" : "#f8fafc",
            fontFamily: "var(--font-sans, system-ui, sans-serif)",
          }}
          className="animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Header */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid #1e293b",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: isLight ? "#f8fafc" : "#0d1117",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  background: isLight ? "#ede9fe" : "rgba(139, 92, 246, 0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#8b5cf6",
                }}
              >
                <History size={14} />
              </div>
              <div>
                <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>
                  Unit Test Version History
                </h3>
                <p style={{ fontSize: 11, margin: 0, color: isLight ? "#64748b" : "#94a3b8" }}>
                  {totalFiles > 0
                    ? `${totalFiles} test files tracked`
                    : "No test modifications yet"}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 4,
                borderRadius: 4,
                color: isLight ? "#64748b" : "#94a3b8",
              }}
              className="hover:bg-slate-200 dark:hover:bg-slate-800"
            >
              <X size={15} />
            </button>
          </div>

          {/* Body Content */}
          <div style={{ maxHeight: 420, overflowY: "auto", padding: 14 }}>
            {/* Quick 1-Click Action Bar */}
            {onSwitchVersion && totalFiles > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 14,
                  paddingBottom: 12,
                  borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid #1e293b",
                }}
              >
                <button
                  type="button"
                  disabled={isSwitchingVersion || !anyOnV2}
                  onClick={() => onSwitchVersion({ allFiles: true, targetVersion: 1 })}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    borderRadius: 6,
                    fontSize: 11.5,
                    fontWeight: 650,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    cursor: (!anyOnV2 || isSwitchingVersion) ? "not-allowed" : "pointer",
                    opacity: (!anyOnV2 || isSwitchingVersion) ? 0.55 : 1,
                    background: isLight ? "#fff1f2" : "rgba(244, 63, 94, 0.12)",
                    border: isLight ? "1px solid #fecdd3" : "1px solid rgba(244, 63, 94, 0.3)",
                    color: isLight ? "#e11d48" : "#fb7185",
                  }}
                  title="Rollback all test files to Version 1 (Baseline)"
                >
                  {isSwitchingVersion && switchingVersionFile === "all" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RotateCcw size={12} />
                  )}
                  <span>Revert to v1 (All)</span>
                </button>

                <button
                  type="button"
                  disabled={isSwitchingVersion || !anyOnV1WithV2}
                  onClick={() => onSwitchVersion({ allFiles: true, targetVersion: 2 })}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    borderRadius: 6,
                    fontSize: 11.5,
                    fontWeight: 650,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    cursor: (!anyOnV1WithV2 || isSwitchingVersion) ? "not-allowed" : "pointer",
                    opacity: (!anyOnV1WithV2 || isSwitchingVersion) ? 0.55 : 1,
                    background: isLight ? "#f5f3ff" : "rgba(139, 92, 246, 0.12)",
                    border: isLight ? "1px solid #ddd6fe" : "1px solid rgba(139, 92, 246, 0.3)",
                    color: isLight ? "#7c3aed" : "#c4b5fd",
                  }}
                  title="Switch all files to Version 2 (AI Suggest)"
                >
                  {isSwitchingVersion && switchingVersionFile === "all" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Zap size={12} />
                  )}
                  <span>To v2 (All)</span>
                </button>
              </div>
            )}

            {/* Zero state: when no suggestions have run */}
            {totalFiles === 0 ? (
              <div
                style={{
                  padding: "20px 14px",
                  textAlign: "center",
                  background: isLight ? "#f8fafc" : "#0d1117",
                  borderRadius: 8,
                  border: isLight ? "1px dashed #cbd5e1" : "1px dashed #29313d",
                }}
              >
                <Info size={22} style={{ color: "#64748b", margin: "0 auto 8px auto" }} />
                <h4 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 4px 0" }}>
                  Currently at Version 1 (Baseline)
                </h4>
                <p style={{ fontSize: 11.5, color: isLight ? "#64748b" : "#94a3b8", margin: 0, lineHeight: 1.5 }}>
                  The project is using baseline test code. When you run <b>Suggest Tests</b> (Stage 2) or apply tests, Version 2 will be automatically preserved here for seamless switching.
                </p>
              </div>
            ) : (
              /* Version Timeline List */
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {versionsMap.map((verItem) => {
                  const isFullyActive = verItem.activeCount === totalFiles && totalFiles > 0;
                  const isPartiallyActive = verItem.activeCount > 0 && !isFullyActive;
                  const isVersionSwitching = isSwitchingVersion && switchingVersionFile === "all";

                  return (
                    <div
                      key={verItem.version}
                      style={{
                        padding: "11px 13px",
                        borderRadius: 8,
                        background: isFullyActive
                          ? (isLight ? "#f5f3ff" : "rgba(139, 92, 246, 0.08)")
                          : (isLight ? "#f8fafc" : "#0d1117"),
                        border: isFullyActive
                          ? (isLight ? "1px solid #c4b5fd" : "1px solid rgba(139, 92, 246, 0.35)")
                          : (isLight ? "1px solid #e2e8f0" : "1px solid #1e293b"),
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        transition: "all 0.15s ease",
                      }}
                    >
                      {/* Version Header */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              fontFamily: "var(--font-mono, monospace)",
                              padding: "2px 7px",
                              borderRadius: 4,
                              background: verItem.version >= 2 ? "#8b5cf6" : "#64748b",
                              color: "#ffffff",
                            }}
                          >
                            v{verItem.version}
                          </span>

                          <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                            {verItem.version === 1
                              ? "Baseline Version"
                              : `Version ${verItem.version} (AI Suggest)`}
                          </span>
                        </div>

                        {/* Status / Active Tag */}
                        <div>
                          {isFullyActive ? (
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 700,
                                color: "#16a34a",
                                background: isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.15)",
                                border: isLight ? "1px solid #bbf7d0" : "1px solid rgba(34, 197, 94, 0.3)",
                                padding: "2px 6px",
                                borderRadius: 4,
                                display: "flex",
                                alignItems: "center",
                                gap: 3,
                              }}
                            >
                              <Check size={11} strokeWidth={3} />
                              <span>Active</span>
                            </span>
                          ) : isPartiallyActive ? (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 650,
                                color: "#d97706",
                                background: isLight ? "#fffbeb" : "rgba(245, 158, 11, 0.12)",
                                border: isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.3)",
                                padding: "2px 6px",
                                borderRadius: 4,
                              }}
                            >
                              {verItem.activeCount}/{totalFiles} file
                            </span>
                          ) : (
                            <span style={{ fontSize: 10.5, color: isLight ? "#94a3b8" : "#64748b" }}>
                              {verItem.latestTime ? formatTimestamp(verItem.latestTime) : ""}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Description */}
                      <p style={{ fontSize: 11, margin: 0, color: isLight ? "#475569" : "#94a3b8", lineHeight: 1.4 }}>
                        {sanitizeSummary(Array.from(verItem.summaries)[0], verItem.version)}
                      </p>

                      {/* Footer: Stats & Switch Button */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: 4,
                          paddingTop: 6,
                          borderTop: isLight ? "1px solid #f1f5f9" : "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        <span style={{ fontSize: 10.5, color: isLight ? "#64748b" : "#94a3b8", display: "flex", alignItems: "center", gap: 4 }}>
                          <Layers size={11} />
                          <span>{verItem.count} files have this version</span>
                        </span>

                        {onSwitchVersion && !isFullyActive && (
                          <button
                            type="button"
                            disabled={isSwitchingVersion}
                            onClick={() => onSwitchVersion({ allFiles: true, targetVersion: verItem.version })}
                            style={{
                              padding: "3px 10px",
                              borderRadius: 5,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: isSwitchingVersion ? "wait" : "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              background: verItem.version >= 2
                                ? (isLight ? "#f5f3ff" : "rgba(139, 92, 246, 0.15)")
                                : (isLight ? "#fff1f2" : "rgba(244, 63, 94, 0.12)"),
                              border: verItem.version >= 2
                                ? (isLight ? "1px solid #ddd6fe" : "1px solid rgba(139, 92, 246, 0.35)")
                                : (isLight ? "1px solid #fecdd3" : "1px solid rgba(244, 63, 94, 0.35)"),
                              color: verItem.version >= 2
                                ? (isLight ? "#7c3aed" : "#c4b5fd")
                                : (isLight ? "#e11d48" : "#fb7185"),
                            }}
                            className="hover:opacity-90"
                          >
                            {isVersionSwitching ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : verItem.version >= 2 ? (
                              <Zap size={11} />
                            ) : (
                              <RotateCcw size={11} />
                            )}
                            <span>{verItem.version >= 2 ? "Switch to v2" : "Revert to v1"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Per-File Breakdown Accordion */}
            {totalFiles > 0 && (
              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => setShowFileBreakdown((prev) => !prev)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    background: isLight ? "#f1f5f9" : "#161b22",
                    border: isLight ? "1px solid #e2e8f0" : "1px solid #21262d",
                    borderRadius: 6,
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                    color: isLight ? "#334155" : "#c9d1d9",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <FileCode2 size={13} style={{ color: "#6366f1" }} />
                    <span>Per-file test details ({totalFiles})</span>
                  </span>
                  <ChevronRight
                    size={13}
                    style={{
                      transform: showFileBreakdown ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.15s ease",
                    }}
                  />
                </button>

                {showFileBreakdown && (
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      padding: "4px 2px",
                    }}
                  >
                    {filesList.map((fRec, idx) => {
                      const curVer = fRec.currentVersion || 1;
                      const hasMultiVers = (fRec.versions?.length || 0) > 1;
                      const isFileSwitching = isSwitchingVersion && (switchingVersionFile === "all" || switchingVersionFile === fRec.sourceFile || switchingVersionFile === fRec.testFile);
                      const targetVer = curVer === 1 ? 2 : 1;
                      const displayPath = fRec.sourceFile || fRec.testFile || `File #${idx + 1}`;

                      return (
                        <div
                          key={fRec.testFile || idx}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            background: isLight ? "#ffffff" : "#0d1117",
                            border: isLight ? "1px solid #e2e8f0" : "1px solid #1e293b",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            fontSize: 11,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>
                            <span
                              style={{
                                fontSize: 9.5,
                                fontWeight: 800,
                                fontFamily: "var(--font-mono, monospace)",
                                padding: "1px 5px",
                                borderRadius: 3,
                                background: curVer >= 2 ? "#8b5cf6" : "#64748b",
                                color: "#ffffff",
                                flexShrink: 0,
                              }}
                            >
                              v{curVer}
                            </span>
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                color: isLight ? "#1e293b" : "#e2e8f0",
                              }}
                              title={displayPath}
                            >
                              {displayPath}
                            </span>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                            {onReviewDiff && (
                              <button
                                type="button"
                                onClick={() => onReviewDiff(fRec.sourceFile || fRec.testFile)}
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: isLight ? "#f1f5f9" : "rgba(255,255,255,0.06)",
                                  border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255,255,255,0.15)",
                                  color: isLight ? "#475569" : "#cbd5e1",
                                  fontSize: 10,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 3,
                                }}
                                title="View diff between versions"
                              >
                                <FileDiff size={10} style={{ color: "#6366f1" }} />
                                <span>Diff</span>
                              </button>
                            )}

                            {onSwitchVersion && hasMultiVers && (
                              <button
                                type="button"
                                disabled={isSwitchingVersion}
                                onClick={() => onSwitchVersion({ filePath: fRec.sourceFile || fRec.testFile, targetVersion: targetVer })}
                                style={{
                                  padding: "2px 7px",
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  cursor: isSwitchingVersion ? "wait" : "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 3,
                                  background: curVer === 1
                                    ? (isLight ? "#f5f3ff" : "rgba(139, 92, 246, 0.15)")
                                    : (isLight ? "#fff1f2" : "rgba(244, 63, 94, 0.12)"),
                                  border: curVer === 1
                                    ? (isLight ? "1px solid #ddd6fe" : "1px solid rgba(139, 92, 246, 0.35)")
                                    : (isLight ? "1px solid #fecdd3" : "1px solid rgba(244, 63, 94, 0.35)"),
                                  color: curVer === 1
                                    ? (isLight ? "#7c3aed" : "#c4b5fd")
                                    : (isLight ? "#e11d48" : "#fb7185"),
                                }}
                                title={curVer === 1 ? "Switch this file to Version 2" : "Revert this file to Version 1"}
                              >
                                {isFileSwitching ? (
                                  <Loader2 size={10} className="animate-spin" />
                                ) : curVer === 1 ? (
                                  <Zap size={10} />
                                ) : (
                                  <RotateCcw size={10} />
                                )}
                                <span>{curVer === 1 ? "v2" : "v1"}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer invariant info note */}
          <div
            style={{
              padding: "8px 14px",
              background: isLight ? "#f8fafc" : "#0d1117",
              borderTop: isLight ? "1px solid #e2e8f0" : "1px solid #1e293b",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10.5,
              color: isLight ? "#64748b" : "#94a3b8",
            }}
          >
            <Sparkles size={11} style={{ color: "#8b5cf6", flexShrink: 0 }} />
            <span>
              Automatically re-runs test runner to recalculate coverage upon switching versions.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

