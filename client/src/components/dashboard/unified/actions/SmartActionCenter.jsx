import { useState, useMemo } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  ExternalLink,
  Filter,
} from "lucide-react";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { ZonePanel } from "../primitives/ZonePanel.jsx";
import { Button } from "../../../common/Button.jsx";

function matchesActionCrossFilter(act, cf) {
  if (!cf) return true;

  if (cf.file) {
    const file = cf.file.toLowerCase();
    const target = (act.targetName || "").toLowerCase();
    const title = (act.title || "").toLowerCase();
    if (target.includes(file) || title.includes(file)) return true;
  }

  if (cf.category) {
    const cat = cf.category.toLowerCase();
    const actCat = (act.failureCategory || "").toLowerCase();
    const desc = (act.description || "").toLowerCase();
    const title = (act.title || "").toLowerCase();
    if (
      (actCat && (actCat.includes(cat) || cat.includes(actCat))) ||
      desc.includes(cat) ||
      title.includes(cat)
    ) {
      return true;
    }
    return false;
  }

  if (cf.pillar) {
    return act.pillar === cf.pillar;
  }

  return true;
}

export function SmartActionCenter({
  actionsData,
  onNavigateWorkspace,
  onInspectItem,
  onAskAi,
  activeCrossFilter = null,
}) {
  const [showAll, setShowAll] = useState(false);
  const allItems = useMemo(() => actionsData?.items || [], [actionsData?.items]);
  const source = actionsData?.source || "live";

  const filteredItems = useMemo(() => {
    if (!activeCrossFilter) return allItems;
    return allItems.filter((act) => matchesActionCrossFilter(act, activeCrossFilter));
  }, [allItems, activeCrossFilter]);

  const initialLimit = 5;
  const visibleItems = showAll ? filteredItems : filteredItems.slice(0, initialLimit);

  const priorityStyles = {
    HIGH: "border-[var(--ud-fail)]/40 bg-[var(--ud-fail)]/10 text-[var(--ud-fail)]",
    MEDIUM: "border-[var(--ud-warn)]/40 bg-[var(--ud-warn)]/10 text-[var(--ud-warn)]",
    LOW: "border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)]",
  };

  const handleDiagnoseClick = (act) => {
    if (onInspectItem) {
      onInspectItem({
        id: act.id,
        title: act.title,
        pillar: act.pillar,
        status: act.priority === "HIGH" ? "fail" : "warn",
        targetName: act.targetName,
        summary: act.description,
        failureLayer:
          act.diagnostics?.failureLayer || act.failureCategory || `${act.pillar.toUpperCase()} Layer`,
        httpStatus: act.diagnostics?.httpStatus || null,
        durationMs: act.diagnostics?.durationMs || null,
        stackTrace: act.diagnostics?.stackTrace || null,
        testCases: act.diagnostics?.testCases || [],
        focusParams: act.focusParams,
        aiPrompt: act.aiPrompt,
      });
      return;
    }
    if (onNavigateWorkspace) {
      onNavigateWorkspace(act.pillar, act.focusParams);
    }
  };

  const handleQuickAskAi = (act, e) => {
    e.stopPropagation();
    const promptText =
      act.aiPrompt ||
      `Diagnose ${act.priority} priority ${act.pillar} issue "${act.title}" on target ${act.targetName}: ${act.description}. Provide root cause analysis and recommended fix.`;
    if (onAskAi) {
      onAskAi(promptText);
    } else if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("covai:prefill-prompt", { detail: { prompt: promptText } })
      );
    }
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
        <div className="flex items-center gap-1.5">
          {activeCrossFilter && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--ud-unit)]/15 text-[var(--ud-unit)] text-[10px] font-mono">
              <Filter size={10} />
              <span>Filtered</span>
            </span>
          )}
          <span className="text-[11px] font-mono font-medium text-[var(--ud-text-muted)]">
            {filteredItems.length} {filteredItems.length === 1 ? "item" : "items"}
          </span>
        </div>
      }
    >
      {filteredItems.length > 0 ? (
        <div className="space-y-3">
          {visibleItems.map((act) => (
            <div
              key={act.id}
              onClick={() => handleDiagnoseClick(act)}
              className="p-3 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/40 hover:bg-[var(--ud-surface-2)] hover:border-[var(--ud-text-muted)]/50 transition-colors flex flex-col justify-between gap-2.5 cursor-pointer"
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
                  <span
                    className="font-mono text-[10px] text-[var(--ud-text-muted)] truncate max-w-[130px]"
                    title={act.targetName}
                  >
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

              {/* Action Footer */}
              <div className="pt-2 border-t border-[var(--ud-border)]/60 flex items-center justify-between gap-2 ud-no-print">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => handleQuickAskAi(act, e)}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ud-unit)] hover:underline cursor-pointer"
                    title="Send diagnostic prompt to COV AI Agent"
                  >
                    <Sparkles size={11} />
                    <span>Ask AI</span>
                  </button>
                  <span className="text-[var(--ud-border)]">•</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateWorkspace(act.pillar, act.focusParams);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] cursor-pointer"
                    title="Open in testing workspace"
                  >
                    <span>Workspace</span>
                    <ExternalLink size={10} />
                  </button>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  icon={ArrowUpRight}
                  iconPosition="right"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDiagnoseClick(act);
                  }}
                >
                  {act.ctaLabel || "Diagnose"}
                </Button>
              </div>
            </div>
          ))}

          {/* Show All Toggle */}
          {filteredItems.length > initialLimit && (
            <button
              type="button"
              onClick={() => setShowAll((prev) => !prev)}
              className="w-full py-2 text-xs font-mono text-[var(--ud-unit)] hover:underline flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>
                {showAll ? "Show less" : `Show all (${filteredItems.length} items)`}
              </span>
              <ChevronDown
                size={13}
                className={`transition-transform duration-150 ${
                  showAll ? "rotate-180" : ""
                }`}
              />
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-8 text-center gap-2">
          <CheckCircle2 size={24} className="text-[var(--ud-pass)] opacity-80" />
          <p className="text-xs font-semibold text-[var(--ud-text)]">
            {activeCrossFilter ? "No matching action items" : "No pending actions"}
          </p>
          <p className="text-[11px] text-[var(--ud-text-muted)] max-w-xs font-sans">
            {activeCrossFilter
              ? "No action items match the selected cross-filter criteria."
              : "All test suites pass successfully and meet coverage thresholds across all 3 testing tiers."}
          </p>
        </div>
      )}
    </ZonePanel>
  );
}

export default SmartActionCenter;
