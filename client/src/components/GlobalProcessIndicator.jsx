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
      badgeColor: "var(--color-primary)",
      icon: <Sparkles size={16} className="text-[var(--color-primary)]" />,
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
      badgeColor: "var(--color-primary)",
      icon: <Activity size={16} className="text-[var(--color-primary)] animate-spin" />,
      title: "Running Coverage Analysis",
      progressPct: analysis.progress || 10,
      stats: `${analysis.progress || 10}%`,
      subtitle: analysis.step || "Running test suites in background...",
      actionLabel: "View in Coverage",
      onAction: () => navigateToCoverage(analysis.type || "unit"),
    };
  } else if (bulkApply.isApplying) {
    const statsText = bulkApply.stats || (bulkApply.totalCount ? `${bulkApply.completedCount || 0}/${bulkApply.totalCount}` : "Applying...");
    const progressPct = bulkApply.progressPct !== undefined && bulkApply.progressPct !== null
      ? bulkApply.progressPct
      : (bulkApply.totalCount ? Math.round(((bulkApply.completedCount || 0) / bulkApply.totalCount) * 100) : null);

    content = {
      type: "bulkApply",
      badgeColor: "var(--color-success)",
      icon: <Zap size={16} className="text-[var(--color-success)]" />,
      title: `Applying ${bulkApply.totalCount || ""} Test Suggestions`,
      progressPct: progressPct,
      stats: statsText,
      subtitle: bulkApply.step || "Writing to disk & running test verification...",
      actionLabel: "View in Coverage",
      onAction: () => navigateToCoverage(bulkApply.type || "unit"),
    };
  } else if (bulkApply.completedAt && Date.now() - bulkApply.completedAt < 12000) {
    content = {
      type: "completed_bulkApply",
      badgeColor: "var(--color-success)",
      icon: <CheckCircle2 size={16} className="text-[var(--color-success)]" />,
      title: "Test Application Complete",
      progressPct: 100,
      stats: "Done",
      subtitle: bulkApply.step || "✓ Successfully applied test suggestions and updated coverage!",
      actionLabel: "View in Coverage",
      onAction: () => {
        navigateToCoverage(bulkApply.type || "unit");
        dismissProcess("bulkApply");
      },
      onDismiss: () => dismissProcess("bulkApply"),
    };
  } else if (suggestion.completedMessage && suggestion.completedAt && Date.now() - suggestion.completedAt < 12000) {
    content = {
      type: "completed_suggestion",
      badgeColor: "var(--color-success)",
      icon: <CheckCircle2 size={16} className="text-[var(--color-success)]" />,
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
      badgeColor: "var(--color-danger)",
      icon: <AlertTriangle size={16} className="text-[var(--color-danger)]" />,
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
      badgeColor: "var(--color-success)",
      icon: <CheckCircle2 size={16} className="text-[var(--color-success)]" />,
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
        background: "var(--color-surface-raised)",
        border: "1px solid var(--color-border)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
        borderRadius: 8,
        overflow: "hidden",
        transition: "all 0.2s ease",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "var(--color-surface-secondary)",
          borderBottom: minimized ? "none" : "1px solid var(--color-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {content.icon}
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-text)",
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
              borderRadius: 4,
              background: "var(--color-surface)",
              color: content.badgeColor,
              border: "1px solid var(--color-border)",
            }}
          >
            {content.stats}
          </span>

          <button
            onClick={() => setMinimized((m) => !m)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              padding: 2,
              display: "flex",
              alignItems: "center",
            }}
            className="hover:text-[var(--color-text)]"
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
                color: "var(--color-text-secondary)",
                cursor: "pointer",
                padding: 2,
                display: "flex",
                alignItems: "center",
              }}
              className="hover:text-[var(--color-text)]"
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
              color: "var(--color-text-secondary)",
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
                background: "var(--color-surface-secondary)",
                borderRadius: 2,
                overflow: "hidden",
                border: "1px solid var(--color-border)",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${content.progressPct}%`,
                  background: content.badgeColor,
                  borderRadius: 2,
                  transition: "width 0.3s ease",
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
                background: "var(--color-primary)",
                border: "1px solid var(--color-primary)",
                borderRadius: 4,
                color: "var(--color-primary-foreground)",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                transition: "opacity 0.15s ease",
              }}
              className="hover:opacity-90"
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
