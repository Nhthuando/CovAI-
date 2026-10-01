import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useRunningProcess } from "../contexts/RunningProcessContext";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  X,
  ChevronDown,
  ChevronUp,
  Zap,
  Activity,
} from "lucide-react";

export default function GlobalProcessIndicator() {
  const { processes, hasActiveProcess, recentlyCompleted, dismissProcess } = useRunningProcess();
  const navigate = useNavigate();
  const location = useLocation();
  const [minimized, setMinimized] = useState(false);

  const { analysis, suggestion, bulkApply } = processes;

  if (!hasActiveProcess && !recentlyCompleted) {
    return null;
  }

  const navigateToCoverage = (coverageType = "unit") => {
    const params = new URLSearchParams(location.search);
    params.set("tab", "coverage");
    params.set("type", coverageType);
    if (location.pathname === "/main-editor") {
      navigate(`${location.pathname}?${params.toString()}`);
    } else {
      navigate(`/main-editor?${params.toString()}`);
    }
  };

  // Determine current active item or recently completed item to show
  let content = null;

  if (suggestion.isGenerating) {
    const total = suggestion.totalFiles || 1;
    const completed = suggestion.completedFiles || 0;
    const pct = Math.min(100, Math.round((completed / total) * 100));

    content = {
      type: "suggestion",
      badgeColor: "#38bdf8",
      borderColor: "rgba(56, 189, 248, 0.4)",
      glowColor: "rgba(56, 189, 248, 0.15)",
      icon: <Sparkles size={16} className="text-sky-400 animate-pulse" />,
      title: "Generating Inline Unit Tests",
      progressPct: pct,
      stats: `${completed}/${total} files (${pct}%)`,
      subtitle: suggestion.currentFile ? `Analyzing: ${suggestion.currentFile}` : suggestion.message,
      actionLabel: "View in Coverage",
      onAction: () => navigateToCoverage(suggestion.type || "unit"),
    };
  } else if (analysis.isRunning) {
    content = {
      type: "analysis",
      badgeColor: "#a855f7",
      borderColor: "rgba(168, 85, 247, 0.4)",
      glowColor: "rgba(168, 85, 247, 0.15)",
      icon: <Activity size={16} className="text-purple-400 animate-spin" />,
      title: "Running Coverage Analysis",
      progressPct: analysis.progress || 10,
      stats: `${analysis.progress || 10}%`,
      subtitle: analysis.step || "Running test suites in background...",
      actionLabel: "View in Coverage",
      onAction: () => navigateToCoverage(analysis.type || "unit"),
    };
  } else if (bulkApply.isApplying) {
    content = {
      type: "bulkApply",
      badgeColor: "#22c55e",
      borderColor: "rgba(34, 197, 94, 0.4)",
      glowColor: "rgba(34, 197, 94, 0.15)",
      icon: <Zap size={16} className="text-green-400 animate-bounce" />,
      title: `Applying ${bulkApply.totalCount || ""} Test Suggestions`,
      progressPct: null,
      stats: "Applying...",
      subtitle: bulkApply.step || "Writing to disk & running test verification...",
      actionLabel: "View in Coverage",
      onAction: () => navigateToCoverage(bulkApply.type || "unit"),
    };
  } else if (suggestion.completedMessage && suggestion.completedAt && Date.now() - suggestion.completedAt < 12000) {
    content = {
      type: "completed_suggestion",
      badgeColor: "#22c55e",
      borderColor: "rgba(34, 197, 94, 0.5)",
      glowColor: "rgba(34, 197, 94, 0.2)",
      icon: <CheckCircle2 size={16} className="text-green-400" />,
      title: "Test Generation Complete",
      progressPct: 100,
      stats: "Done",
      subtitle: suggestion.completedMessage,
      actionLabel: "View & Apply All",
      onAction: () => {
        navigateToCoverage(suggestion.type || "unit");
        dismissProcess("suggestion");
      },
      onDismiss: () => dismissProcess("suggestion"),
    };
  } else if (analysis.error && analysis.completedAt && Date.now() - analysis.completedAt < 12000) {
    content = {
      type: "error_analysis",
      badgeColor: "#ef4444",
      borderColor: "rgba(239, 68, 68, 0.5)",
      glowColor: "rgba(239, 68, 68, 0.2)",
      icon: <AlertTriangle size={16} className="text-red-400" />,
      title: "Coverage Analysis Error",
      progressPct: null,
      stats: "Failed",
      subtitle: analysis.error,
      actionLabel: "View Details",
      onAction: () => {
        navigateToCoverage(analysis.type || "unit");
        dismissProcess("analysis");
      },
      onDismiss: () => dismissProcess("analysis"),
    };
  } else if (analysis.completedAt && !analysis.error && Date.now() - analysis.completedAt < 8000) {
    content = {
      type: "completed_analysis",
      badgeColor: "#22c55e",
      borderColor: "rgba(34, 197, 94, 0.5)",
      glowColor: "rgba(34, 197, 94, 0.2)",
      icon: <CheckCircle2 size={16} className="text-green-400" />,
      title: "Analysis Succeeded",
      progressPct: 100,
      stats: "100%",
      subtitle: "Fresh coverage metrics updated and ready to view.",
      actionLabel: "View Results",
      onAction: () => {
        navigateToCoverage(analysis.type || "unit");
        dismissProcess("analysis");
      },
      onDismiss: () => dismissProcess("analysis"),
    };
  }

  if (!content) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        maxWidth: minimized ? 260 : 380,
        width: "calc(100vw - 48px)",
        background: "rgba(11, 15, 25, 0.95)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: `1px solid ${content.borderColor}`,
        boxShadow: `0 12px 32px rgba(0, 0, 0, 0.6), 0 0 20px ${content.glowColor}`,
        borderRadius: 12,
        overflow: "hidden",
        transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "rgba(255, 255, 255, 0.03)",
          borderBottom: minimized ? "none" : "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {content.icon}
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#f1f5f9",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {content.title}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 10,
              background: `${content.badgeColor}22`,
              color: content.badgeColor,
              border: `1px solid ${content.badgeColor}44`,
            }}
          >
            {content.stats}
          </span>

          <button
            onClick={() => setMinimized((m) => !m)}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: 2,
              display: "flex",
              alignItems: "center",
            }}
            className="hover:text-white"
            title={minimized ? "Expand" : "Minimize"}
          >
            {minimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {content.onDismiss && (
            <button
              onClick={content.onDismiss}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                padding: 2,
                display: "flex",
                alignItems: "center",
              }}
              className="hover:text-white"
              title="Close"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded Body */}
      {!minimized && (
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Subtitle / Current file */}
          <div
            style={{
              fontSize: 11,
              color: "#94a3b8",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {content.subtitle}
          </div>

          {/* Progress bar */}
          {content.progressPct !== null && (
            <div
              style={{
                height: 4,
                width: "100%",
                background: "rgba(255, 255, 255, 0.08)",
                borderRadius: 9999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${content.progressPct}%`,
                  background: `linear-gradient(90deg, ${content.badgeColor}, #c084fc)`,
                  borderRadius: 9999,
                  transition: "width 0.35s ease",
                }}
              />
            </div>
          )}

          {/* Action Button */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
            <button
              onClick={content.onAction}
              style={{
                padding: "5px 12px",
                background: `linear-gradient(135deg, ${content.badgeColor}22, ${content.badgeColor}33)`,
                border: `1px solid ${content.badgeColor}66`,
                borderRadius: 6,
                color: "#ffffff",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                transition: "all 0.15s ease",
              }}
              className="hover:brightness-125"
            >
              <span>{content.actionLabel}</span>
              <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
