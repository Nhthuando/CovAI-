import React from "react";
import { AlertTriangle, Sparkles, ArrowRight } from "lucide-react";
import { PillarBadge } from "../primitives/PillarBadge.jsx";

/**
 * ActionAlertStrip - Compact single-line horizontal alert strip for top priority quality blockers.
 * Replaces the multi-column card grid to eliminate dead space and vertical clutter.
 */
export function ActionAlertStrip({
  actions = [],
  onNavigateWorkspace,
  onInspectItem,
  onAskAi,
  className = "",
}) {
  const topActions = Array.isArray(actions) ? actions.slice(0, 3) : [];

  if (topActions.length === 0) {
    return null;
  }

  const priorityColors = {
    P0: "bg-[var(--ud-fail)]/15 border-[var(--ud-fail)]/40 text-[var(--ud-fail)]",
    P1: "bg-[var(--ud-warn)]/15 border-[var(--ud-warn)]/40 text-[var(--ud-warn)]",
    P2: "bg-[var(--ud-surface-2)] border-[var(--ud-border)] text-[var(--ud-text-muted)]",
    CRITICAL: "bg-[var(--ud-fail)]/15 border-[var(--ud-fail)]/40 text-[var(--ud-fail)]",
    HIGH: "bg-[var(--ud-warn)]/15 border-[var(--ud-warn)]/40 text-[var(--ud-warn)]",
    MEDIUM: "bg-blue-500/15 border-blue-500/40 text-blue-400",
    LOW: "bg-[var(--ud-surface-2)] border-[var(--ud-border)] text-[var(--ud-text-muted)]",
  };

  return (
    <div
      id="ud-action-alerts"
      className={`rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-2.5 space-y-1.5 shadow-xs ${className}`}
    >
      <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-[var(--ud-text-muted)]">
        <div className="flex items-center gap-1.5 text-xs text-[var(--ud-text)]">
          <AlertTriangle size={13} className="text-[var(--ud-warn)] shrink-0" />
          <span>Prioritized Quality Actions ({topActions.length})</span>
        </div>
        <span className="font-mono text-[10px] hidden sm:inline text-[var(--ud-text-muted)]">
          Top blocker recommendations
        </span>
      </div>

      <div className="space-y-1.5">
        {topActions.map((action, idx) => {
          const prio = action.priority || "MEDIUM";
          const badgeClass = priorityColors[prio] || priorityColors.MEDIUM || priorityColors.P1;

          return (
            <div
              key={action.id || idx}
              className="rounded-[var(--radius-sm)] border border-[var(--ud-border)]/80 bg-[var(--ud-surface-2)]/60 px-3 py-1.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 hover:border-[var(--ud-border)] transition-colors text-xs"
            >
              {/* Left: Badges + Short Title + Description in single line */}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${badgeClass}`}>
                  {prio}
                </span>
                <PillarBadge pillar={action.pillar || "unit"} size="sm" showIcon={false} className="shrink-0" />
                <span className="font-semibold text-[var(--ud-text)] shrink-0 truncate max-w-[220px]" title={action.title}>
                  {action.title}
                </span>
                <span className="text-[var(--ud-border)] hidden lg:inline select-none">—</span>
                <span className="text-[11px] text-[var(--ud-text-muted)] truncate hidden lg:inline flex-1" title={action.description}>
                  {action.description}
                </span>
              </div>

              {/* Right: Inline Resolve & Ask AI */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigateWorkspace?.(action.pillar || "unit", action.focusParams)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-[var(--radius-sm)] bg-[var(--ud-unit)]/15 border border-[var(--ud-unit)]/30 text-[var(--ud-unit)] hover:bg-[var(--ud-unit)]/25 transition-colors cursor-pointer"
                >
                  <span>Resolve</span>
                  <ArrowRight size={11} />
                </button>

                {onAskAi && (
                  <button
                    type="button"
                    onClick={() => onAskAi(action)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] transition-colors cursor-pointer"
                    title="Ask AI to analyze this action"
                  >
                    <Sparkles size={11} className="text-[var(--ud-unit)]" />
                    <span className="hidden sm:inline">Ask AI</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ActionAlertStrip;
