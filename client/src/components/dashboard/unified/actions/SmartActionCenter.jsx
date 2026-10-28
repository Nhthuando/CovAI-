import { useState } from "react";
import { ArrowUpRight, CheckCircle2, ChevronDown } from "lucide-react";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { ZonePanel } from "../primitives/ZonePanel.jsx";
import { Button } from "../../../common/Button.jsx";

export function SmartActionCenter({ actionsData, onNavigateWorkspace }) {
  const [showAll, setShowAll] = useState(false);
  const items = actionsData?.items || [];
  const source = actionsData?.source || "live";

  const initialLimit = 6;
  const visibleItems = showAll ? items : items.slice(0, initialLimit);

  const priorityStyles = {
    HIGH: "border-[var(--ud-fail)]/40 bg-[var(--ud-fail)]/10 text-[var(--ud-fail)]",
    MEDIUM: "border-[var(--ud-warn)]/40 bg-[var(--ud-warn)]/10 text-[var(--ud-warn)]",
    LOW: "border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)]",
  };

  return (
    <ZonePanel
      id="ud-smart-actions"
      title="Smart Action Center"
      description="Prioritized test fixes & coverage generation"
      source={source}
      contentClassName="p-4"
      className="h-full"
      actions={
        <span className="text-[11px] font-mono font-medium text-[var(--ud-text-muted)]">
          {items.length} items
        </span>
      }
    >
      {items.length > 0 ? (
        <div className="space-y-3">
          {visibleItems.map((act) => (
            <div
              key={act.id}
              className="p-3 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/40 hover:bg-[var(--ud-surface-2)] transition-colors flex flex-col justify-between gap-2.5"
            >
              {/* Header: Priority + Pillar + Title */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-[var(--radius-sm)] border ${
                        priorityStyles[act.priority] || priorityStyles.LOW
                      }`}
                    >
                      {act.priority}
                    </span>
                    <PillarBadge pillar={act.pillar} size="sm" />
                  </div>
                  <span className="font-mono text-[10px] text-[var(--ud-text-muted)] truncate max-w-[130px]">
                    {act.targetName}
                  </span>
                </div>
                <h4 className="text-xs font-semibold text-[var(--ud-text)] leading-snug">
                  {act.title}
                </h4>
                <p className="text-[11px] text-[var(--ud-text-muted)] mt-1 font-sans leading-relaxed line-clamp-2">
                  {act.description}
                </p>
              </div>

              {/* Action Button */}
              <div className="pt-2 border-t border-[var(--ud-border)]/60 flex items-center justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  icon={ArrowUpRight}
                  iconPosition="right"
                  onClick={() => onNavigateWorkspace(act.pillar, act.focusParams)}
                >
                  {act.ctaLabel || "Resolve"}
                </Button>
              </div>
            </div>
          ))}

          {/* Show All Toggle */}
          {items.length > initialLimit && (
            <button
              type="button"
              onClick={() => setShowAll((prev) => !prev)}
              className="w-full py-2 text-xs font-mono text-[var(--ud-unit)] hover:underline flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>{showAll ? "Show less" : `Show all (${items.length} items)`}</span>
              <ChevronDown
                size={13}
                className={`transition-transform duration-150 ${showAll ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-8 text-center gap-2">
          <CheckCircle2 size={24} className="text-[var(--ud-pass)] opacity-80" />
          <p className="text-xs font-semibold text-[var(--ud-text)]">
            No pending actions
          </p>
          <p className="text-[11px] text-[var(--ud-text-muted)] max-w-xs font-sans">
            All test suites pass successfully and meet coverage thresholds across all 3 testing tiers.
          </p>
        </div>
      )}
    </ZonePanel>
  );
}

export default SmartActionCenter;
