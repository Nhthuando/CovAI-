import React, { useState, useMemo } from "react";
import {
  History,
  RotateCcw,
  Zap,
  Check,
  Clock,
  Calendar,
  FileCode2,
  FileDiff,
  ArrowRight,
  Info,
  Loader2,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Layers,
  ShieldCheck
} from "lucide-react";

/**
 * Clean & sanitize version summary to English, healing legacy strings
 */
function sanitizeSummary(summary, version) {
  if (!summary) {
    return version === 1
      ? "Baseline unit test suite captured before AI suggestions"
      : "AI-generated unit test suite covering untested branches and logic";
  }
  if (typeof summary !== "string") return "";
  if (summary.includes("Bộ unit tests") || summary.includes("chưa phủ") || summary.includes("AI tạo")) {
    return "AI-generated unit test suite covering untested branches and logic";
  }
  if (summary.includes("File chưa tồn tại") || summary.includes("Chưa có file")) {
    return "Test file did not exist prior to AI test generation (created as new)";
  }
  if (summary.includes("Gốc") || summary.includes("ban đầu")) {
    return "Baseline / Original repository unit test suite";
  }
  return summary;
}

/**
 * Format timestamp into detailed readable date & time string
 */
function formatDetailedDateTime(isoStr) {
  if (!isoStr) return "Initial (Baseline)";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "Initial (Baseline)";
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const dateStr = d.toLocaleDateString([], { year: "numeric", month: "2-digit", day: "2-digit" });

    // Relative time calculation
    const now = Date.now();
    const diffSec = Math.floor((now - d.getTime()) / 1000);
    let relative = "";
    if (diffSec < 60) relative = "just now";
    else if (diffSec < 3600) relative = `${Math.floor(diffSec / 60)} min ago`;
    else if (diffSec < 86400) relative = `${Math.floor(diffSec / 3600)} hr ago`;
    else relative = `${Math.floor(diffSec / 86400)} days ago`;

    return `${timeStr} · ${dateStr} (${relative})`;
  } catch (_) {
    return "Initial (Baseline)";
  }
}

/**
 * UnitTestVersionHistoryView
 * 
 * Full dedicated view displayed below the tab bar when user clicks "Version History".
 * Displays detailed timeline cards of each version:
 * - Exact creation timestamp
 * - Full explanation of what the version is (origin, purpose, target coverage)
 * - File list and diff review
 * - Prominent "Rollback / Fast-Forward" action buttons to switch version
 */
export default function UnitTestVersionHistoryView({
  unitTestVersions = {},
  onSwitchVersion = null,
  isSwitchingVersion = false,
  switchingVersionFile = null,
  onReviewDiff = null,
  isLight = false,
  snapshotId = null,
  projectId = null,
}) {
  const [expandedVersionFiles, setExpandedVersionFiles] = useState(new Set([1, 2]));

  const toggleExpand = (verNum) => {
    setExpandedVersionFiles((prev) => {
      const next = new Set(prev);
      if (next.has(verNum)) next.delete(verNum);
      else next.add(verNum);
      return next;
    });
  };

  const filesList = useMemo(() => {
    return Object.values(unitTestVersions || {});
  }, [unitTestVersions]);

  const totalFiles = filesList.length;

  // Aggregate all versions into structured timeline data
  const { versionsTimeline, currentDominantVersion, anyOnV2, anyOnV1WithV2 } = useMemo(() => {
    const map = {}; // verNum -> { version, label, files: [], count, activeCount, latestTime, summaries: Set, isBaseline }
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
            label: num === 1
              ? "Version 1: Baseline / Initial State"
              : num === 2
                ? "Version 2: AI-Generated Unit Tests (Applied)"
                : `Version ${num}: Incremental Suggestions & Refinement`,
            isBaseline: num === 1,
            type: v.type,
            status: v.status,
            files: [],
            count: 0,
            activeCount: 0,
            latestTime: v.createdAt || "",
            summaries: new Set()
          };
        }

        map[num].files.push({
          sourceFile: fileRec.sourceFile,
          testFile: fileRec.testFile,
          framework: fileRec.framework || "jest",
          isNewFile: v.isNewFile,
          isActive: v.version === curVer,
          status: v.status,
          createdAt: v.createdAt,
          summary: v.summary,
        });

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

    const sortedTimeline = Object.values(map).sort((a, b) => b.version - a.version);

    let dominant = 1;
    if (v2Count > 0 && v2Count >= (totalFiles / 2)) {
      dominant = 2;
    }

    return {
      versionsTimeline: sortedTimeline,
      currentDominantVersion: dominant,
      anyOnV2: v2Count > 0,
      anyOnV1WithV2: v1WithV2Count > 0
    };
  }, [filesList, totalFiles]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        paddingBottom: 24,
      }}
    >
      {/* ── Top Header Banner ── */}
      <div
        style={{
          background: isLight ? "#ffffff" : "var(--color-surface, #11161d)",
          border: isLight ? "1px solid #e2e8f0" : "1px solid var(--color-border, #29313d)",
          borderRadius: 10,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 14,
          boxShadow: isLight ? "0 1px 3px rgba(0,0,0,0.04)" : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: isLight ? "#ede9fe" : "rgba(139, 92, 246, 0.18)",
              border: isLight ? "1px solid #ddd6fe" : "1px solid rgba(139, 92, 246, 0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#8b5cf6",
              flexShrink: 0,
            }}
          >
            <History size={20} />
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 15, fontWeight: 750, margin: 0, color: isLight ? "#0f172a" : "#f8fafc" }}>
                Unit Test Version Management & History
              </h2>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 5,
                  background: currentDominantVersion >= 2
                    ? (isLight ? "#f5f3ff" : "rgba(139, 92, 246, 0.2)")
                    : (isLight ? "#f0f9ff" : "rgba(2, 132, 199, 0.2)"),
                  border: currentDominantVersion >= 2
                    ? (isLight ? "1px solid #ddd6fe" : "1px solid rgba(139, 92, 246, 0.4)")
                    : (isLight ? "1px solid #bae6fd" : "1px solid rgba(2, 132, 199, 0.4)"),
                  color: currentDominantVersion >= 2
                    ? (isLight ? "#7c3aed" : "#c4b5fd")
                    : (isLight ? "#0284c7" : "#7dd3fc"),
                }}
              >
                Active: Version {currentDominantVersion}
              </span>
            </div>
            <p style={{ fontSize: 12, margin: "4px 0 0 0", color: isLight ? "#64748b" : "#94a3b8" }}>
              Track creation timestamps and test objectives for each version with seamless rollback and fast-forward switching.
            </p>
          </div>
        </div>

        {/* Global Quick Action Buttons */}
        {onSwitchVersion && totalFiles > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={isSwitchingVersion || !anyOnV2}
              onClick={() => onSwitchVersion({ allFiles: true, targetVersion: 1 })}
              style={{
                padding: "8px 14px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 650,
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: (!anyOnV2 || isSwitchingVersion) ? "not-allowed" : "pointer",
                opacity: (!anyOnV2 || isSwitchingVersion) ? 0.55 : 1,
                background: isLight ? "#fff1f2" : "rgba(244, 63, 94, 0.12)",
                border: isLight ? "1px solid #fecdd3" : "1px solid rgba(244, 63, 94, 0.3)",
                color: isLight ? "#e11d48" : "#fb7185",
                transition: "all 0.15s ease",
              }}
              title="Revert all project test files to Version 1 (Baseline)"
            >
              {isSwitchingVersion && switchingVersionFile === "all" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RotateCcw size={13} />
              )}
              <span>Revert to Version 1 (Baseline)</span>
            </button>

            <button
              type="button"
              disabled={isSwitchingVersion || !anyOnV1WithV2}
              onClick={() => onSwitchVersion({ allFiles: true, targetVersion: 2 })}
              style={{
                padding: "8px 14px",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 650,
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: (!anyOnV1WithV2 || isSwitchingVersion) ? "not-allowed" : "pointer",
                opacity: (!anyOnV1WithV2 || isSwitchingVersion) ? 0.55 : 1,
                background: isLight ? "#f5f3ff" : "rgba(139, 92, 246, 0.12)",
                border: isLight ? "1px solid #ddd6fe" : "1px solid rgba(139, 92, 246, 0.3)",
                color: isLight ? "#7c3aed" : "#c4b5fd",
                transition: "all 0.15s ease",
              }}
              title="Switch all test files to Version 2 (AI-Generated)"
            >
              {isSwitchingVersion && switchingVersionFile === "all" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Zap size={13} />
              )}
              <span>Switch to Version 2 (AI New)</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Zero State: When no AI tests suggested yet ── */}
      {totalFiles === 0 ? (
        <div
          style={{
            background: isLight ? "#ffffff" : "var(--color-surface, #11161d)",
            border: isLight ? "1px solid #e2e8f0" : "1px solid var(--color-border, #29313d)",
            borderRadius: 10,
            padding: "36px 24px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: isLight ? "#f1f5f9" : "rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 14px auto",
              color: "#64748b",
            }}
          >
            <Info size={26} />
          </div>

          <h3 style={{ fontSize: 15, fontWeight: 750, margin: "0 0 6px 0", color: isLight ? "#0f172a" : "#f8fafc" }}>
            Project is currently at Version 1: Baseline
          </h3>
          <p
            style={{
              fontSize: 12.5,
              color: isLight ? "#64748b" : "#94a3b8",
              maxWidth: 580,
              margin: "0 auto 18px auto",
              lineHeight: 1.6,
            }}
          >
            No AI versions created yet. When you click <b>&quot;Suggest Tests&quot;</b> in Stage 2 or apply tests in Stage 3, the system automatically creates and preserves <b>Version 2 (AI Suggest)</b> for instant diff comparison and rollback.
          </p>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              background: isLight ? "#f8fafc" : "#0d1117",
              border: isLight ? "1px solid #cbd5e1" : "1px solid #29313d",
              borderRadius: 6,
              fontSize: 12,
              color: isLight ? "#475569" : "#cbd5e1",
            }}
          >
            <Clock size={14} style={{ color: "#8b5cf6" }} />
            <span>Baseline recorded at: <b>Initial project import</b></span>
          </div>
        </div>
      ) : (
        /* ── Detailed Timeline Cards List ── */
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {versionsTimeline.map((verItem) => {
            const isFullyActive = verItem.activeCount === totalFiles && totalFiles > 0;
            const isPartiallyActive = verItem.activeCount > 0 && !isFullyActive;
            const isExpanded = expandedVersionFiles.has(verItem.version);
            const isAllSwitching = isSwitchingVersion && switchingVersionFile === "all";

            return (
              <div
                key={verItem.version}
                style={{
                  background: isLight ? "#ffffff" : "var(--color-surface, #11161d)",
                  border: isFullyActive
                    ? (isLight ? "2px solid #8b5cf6" : "2px solid rgba(139, 92, 246, 0.6)")
                    : (isLight ? "1px solid #e2e8f0" : "1px solid var(--color-border, #29313d)"),
                  borderRadius: 10,
                  overflow: "hidden",
                  boxShadow: isFullyActive
                    ? (isLight ? "0 4px 14px rgba(139, 92, 246, 0.12)" : "0 4px 14px rgba(139, 92, 246, 0.25)")
                    : (isLight ? "0 1px 3px rgba(0,0,0,0.04)" : "none"),
                  transition: "all 0.2s ease",
                }}
              >
                {/* ── Card Header ── */}
                <div
                  style={{
                    padding: "16px 20px",
                    background: isFullyActive
                      ? (isLight ? "#fbf9ff" : "rgba(139, 92, 246, 0.08)")
                      : (isLight ? "#f8fafc" : "#0d1117"),
                    borderBottom: isLight ? "1px solid #f1f5f9" : "1px solid #1e293b",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        padding: "6px 12px",
                        borderRadius: 7,
                        fontWeight: 850,
                        fontSize: 14,
                        fontFamily: "var(--font-mono, monospace)",
                        background: verItem.version >= 2
                          ? "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)"
                          : (isLight ? "#64748b" : "#475569"),
                        color: "#ffffff",
                        boxShadow: verItem.version >= 2 ? "0 2px 6px rgba(139, 92, 246, 0.35)" : "none",
                      }}
                    >
                      Version {verItem.version}
                    </div>

                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <h3 style={{ fontSize: 14.5, fontWeight: 750, margin: 0, color: isLight ? "#0f172a" : "#f8fafc" }}>
                          {verItem.version === 1
                            ? "Baseline / Initial State"
                            : `AI-Generated Test Suite (Cycle ${verItem.version})`}
                        </h3>

                        {isFullyActive ? (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 750,
                              color: "#16a34a",
                              background: isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.18)",
                              border: isLight ? "1px solid #bbf7d0" : "1px solid rgba(34, 197, 94, 0.4)",
                              padding: "2px 8px",
                              borderRadius: 5,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <Check size={12} strokeWidth={3} />
                            <span>CURRENT ACTIVE</span>
                          </span>
                        ) : isPartiallyActive ? (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#d97706",
                              background: isLight ? "#fffbeb" : "rgba(245, 158, 11, 0.15)",
                              border: isLight ? "1px solid #fde68a" : "1px solid rgba(245, 158, 11, 0.35)",
                              padding: "2px 8px",
                              borderRadius: 5,
                            }}
                          >
                            Active on {verItem.activeCount}/{totalFiles} files
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 650,
                              color: isLight ? "#64748b" : "#94a3b8",
                              background: isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.06)",
                              padding: "2px 7px",
                              borderRadius: 5,
                            }}
                          >
                            Archived (Inactive)
                          </span>
                        )}
                      </div>

                      {/* Detailed creation timestamp */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 11.5,
                          color: isLight ? "#64748b" : "#94a3b8",
                          marginTop: 4,
                        }}
                      >
                        <Clock size={12} style={{ color: "#8b5cf6" }} />
                        <span>Created: <b>{formatDetailedDateTime(verItem.latestTime)}</b></span>
                      </div>
                    </div>
                  </div>

                  {/* Main action button: Revert to this Version */}
                  <div>
                    {isFullyActive ? (
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#16a34a",
                          padding: "6px 14px",
                          borderRadius: 6,
                          background: isLight ? "#f0fdf4" : "rgba(34, 197, 94, 0.12)",
                          border: isLight ? "1px solid #bbf7d0" : "1px solid rgba(34, 197, 94, 0.3)",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Check size={14} strokeWidth={2.5} />
                        <span>Current Version</span>
                      </div>
                    ) : onSwitchVersion && (
                      <button
                        type="button"
                        disabled={isSwitchingVersion}
                        onClick={() => onSwitchVersion({ allFiles: true, targetVersion: verItem.version })}
                        style={{
                          padding: "8px 18px",
                          borderRadius: 7,
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor: isSwitchingVersion ? "wait" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          background: verItem.version >= 2
                            ? "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)"
                            : (isLight ? "#e11d48" : "#f43f5e"),
                          border: "none",
                          color: "#ffffff",
                          boxShadow: verItem.version >= 2
                            ? "0 2px 6px rgba(139, 92, 246, 0.3)"
                            : "0 2px 6px rgba(244, 63, 94, 0.3)",
                          transition: "all 0.15s ease",
                        }}
                        className="hover:opacity-95 active:scale-[0.98]"
                        title={`Revert entire project to Version ${verItem.version}`}
                      >
                        {isAllSwitching ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : verItem.version >= 2 ? (
                          <Zap size={13} />
                        ) : (
                          <RotateCcw size={13} />
                        )}
                        <span>
                          {verItem.version === 1
                            ? "Revert to Version 1 (Baseline)"
                            : `Switch to Version ${verItem.version}`}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Card Body ── */}
                <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* ── Version Overview Grid (2 Columns) ── */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {/* Left Box: Version Nature / AI Test Matrix */}
                    <div
                      style={{
                        background: isLight ? "#fbfbfe" : "rgba(139, 92, 246, 0.04)",
                        border: isLight ? "1px solid #ede9fe" : "1px solid rgba(139, 92, 246, 0.2)",
                        borderRadius: 8,
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          color: isLight ? "#7c3aed" : "#a78bfa",
                        }}
                      >
                        <Sparkles size={13} />
                        <span>VERSION ESSENCE (AI TEST MATRIX)</span>
                      </div>
                      <p
                        style={{
                          fontSize: 12,
                          lineHeight: 1.6,
                          margin: 0,
                          color: isLight ? "#334155" : "#cbd5e1",
                        }}
                      >
                        {verItem.version === 1
                          ? "Original baseline unit test state captured from initial repository analysis prior to AI test generation and branch coverage expansion."
                          : "AI-synthesized test suite with AST-driven coverage targeting conditional branches (if/else, ternary, nullish coalescing), functions, and statements structured across the 4-Category Decision Table Matrix (Happy Path, Boundary Values, Branch Toggling, Error Handling)."}
                      </p>
                    </div>

                    {/* Right Box: Scope & Statistics */}
                    <div
                      style={{
                        background: isLight ? "#f8fafc" : "rgba(2, 132, 199, 0.04)",
                        border: isLight ? "1px solid #e0f2fe" : "1px solid rgba(2, 132, 199, 0.2)",
                        borderRadius: 8,
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          color: isLight ? "#0284c7" : "#38bdf8",
                        }}
                      >
                        <Layers size={13} />
                        <span>SCOPE & STATISTICS</span>
                      </div>
                      <ul
                        style={{
                          fontSize: 12,
                          lineHeight: 1.6,
                          margin: 0,
                          paddingLeft: 16,
                          color: isLight ? "#334155" : "#cbd5e1",
                        }}
                      >
                        <li>
                          Files in this version: <b>{verItem.count} test file{verItem.count !== 1 ? "s" : ""}</b>
                        </li>
                        <li>
                          Synchronization status: <b>{verItem.activeCount}/{totalFiles} file{totalFiles !== 1 ? "s" : ""} currently active</b>
                        </li>
                        <li>
                          Summary: <i>{sanitizeSummary([...verItem.summaries][0], verItem.version)}</i>
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* ── Storage Immutability & Runner Banner ── */}
                  <div
                    style={{
                      background: isLight ? "#faf5ff" : "rgba(139, 92, 246, 0.07)",
                      border: isLight ? "1px solid #f3e8ff" : "1px solid rgba(139, 92, 246, 0.25)",
                      borderRadius: 8,
                      padding: "10px 14px",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      fontSize: 11.5,
                      lineHeight: 1.5,
                      color: isLight ? "#475569" : "#cbd5e1",
                    }}
                  >
                    <ShieldCheck size={16} style={{ color: "#8b5cf6", flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <b style={{ color: isLight ? "#6b21a8" : "#d8b4fe" }}>
                        Storage Immutability & Background Runner Guard:
                      </b>{" "}
                      Reverting to any version operates strictly on the <code>tests/</code> directory, leaving original project source code under <code>storage/</code> completely immutable. The background runner automatically re-executes to update exact 4-metric coverage for the selected version.
                    </div>
                  </div>

                  {/* ── File Breakdown List ── */}
                  <div
                    style={{
                      border: isLight ? "1px solid #e2e8f0" : "1px solid #1e293b",
                      borderRadius: 8,
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(verItem.version)}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        background: isLight ? "#f1f5f9" : "#161b22",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: 12,
                        fontWeight: 700,
                        color: isLight ? "#1e293b" : "#f1f5f9",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <FileCode2 size={14} style={{ color: "#6366f1" }} />
                        <span>{verItem.files.length} files in Version {verItem.version}</span>
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, color: isLight ? "#64748b" : "#94a3b8", fontSize: 11 }}>
                        <span>{isExpanded ? "Collapse" : "View details"}</span>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6, background: isLight ? "#ffffff" : "#0d1117" }}>
                        {verItem.files.map((fileObj, fIdx) => {
                          const displayPath = fileObj.testFile || fileObj.sourceFile || `File #${fIdx + 1}`;
                          const isThisFileSwitching = isSwitchingVersion && (switchingVersionFile === "all" || switchingVersionFile === fileObj.sourceFile || switchingVersionFile === fileObj.testFile);

                          return (
                            <div
                              key={displayPath}
                              style={{
                                padding: "8px 12px",
                                borderRadius: 6,
                                background: isLight ? "#f8fafc" : "#161b22",
                                border: isLight ? "1px solid #e2e8f0" : "1px solid #21262d",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                flexWrap: "wrap",
                                gap: 8,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 800,
                                    fontFamily: "var(--font-mono, monospace)",
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    background: fileObj.isActive
                                      ? "#16a34a"
                                      : (isLight ? "#cbd5e1" : "#334155"),
                                    color: "#ffffff",
                                    flexShrink: 0,
                                  }}
                                >
                                  {fileObj.isActive ? "ACTIVE" : `v${verItem.version}`}
                                </span>

                                <span style={{ fontSize: 12, fontWeight: 600, color: isLight ? "#0f172a" : "#f8fafc" }} title={displayPath}>
                                  {displayPath}
                                </span>

                                {fileObj.isNewFile && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 650,
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      background: isLight ? "#fef3c7" : "rgba(245, 158, 11, 0.15)",
                                      color: "#d97706",
                                    }}
                                  >
                                    New File
                                  </span>
                                )}
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                {onReviewDiff && (
                                  <button
                                    type="button"
                                    onClick={() => onReviewDiff(fileObj.sourceFile || fileObj.testFile)}
                                    style={{
                                      padding: "4px 9px",
                                      borderRadius: 5,
                                      background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.08)",
                                      border: isLight ? "1px solid #cbd5e1" : "1px solid rgba(255, 255, 255, 0.2)",
                                      color: isLight ? "#334155" : "#e2e8f0",
                                      fontSize: 11,
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 4,
                                    }}
                                    title="View diff comparison for this file"
                                  >
                                    <FileDiff size={12} style={{ color: "#6366f1" }} />
                                    <span>Diff</span>
                                  </button>
                                )}

                                {onSwitchVersion && !fileObj.isActive && (
                                  <button
                                    type="button"
                                    disabled={isSwitchingVersion}
                                    onClick={() => onSwitchVersion({ filePath: fileObj.sourceFile || fileObj.testFile, targetVersion: verItem.version })}
                                    style={{
                                      padding: "4px 10px",
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
                                    title={`Switch this file to Version ${verItem.version}`}
                                  >
                                    {isThisFileSwitching ? (
                                      <Loader2 size={11} className="animate-spin" />
                                    ) : verItem.version >= 2 ? (
                                      <Zap size={11} />
                                    ) : (
                                      <RotateCcw size={11} />
                                    )}
                                    <span>{verItem.version === 1 ? "To v1" : `To v${verItem.version}`}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

