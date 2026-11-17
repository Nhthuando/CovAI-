import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { SegmentedFilter } from "../primitives/SegmentedFilter.jsx";
import { ActionAlertStrip } from "../actions/ActionAlertStrip.jsx";
import { CrossLayerTraceMatrix } from "../matrix/CrossLayerTraceMatrix.jsx";
import { CoverageTrendChart } from "../charts/CoverageTrendChart.jsx";
import { UnifiedRecentRunsTable } from "../history/UnifiedRecentRunsTable.jsx";
import { Layers, History } from "lucide-react";

/**
 * AnalysisTabsZone - Progressive Disclosure Tab Container.
 * Consolidates Traceability (Matrix + Alert Strip) and Trends/History into a clean tabbed view,
 * eliminating vertical scrolling overload and giving 100% width to the Trace Matrix.
 * Synced to URL parameter `?panel=trace|history`.
 */
export function AnalysisTabsZone({
  vm,
  onNavigateWorkspace,
  onInspectItem,
  onAskAi,
  activeCrossFilter = null,
  onClearCrossFilter,
  className = "",
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPanel = searchParams.get("panel");
  const activeTab = rawPanel === "history" ? "history" : "trace";

  // Auto-switch to trace tab if user activates a cross-filter from Pyramid or Pillars
  useEffect(() => {
    if (activeCrossFilter && activeTab !== "trace") {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("panel", "trace");
          return next;
        },
        { replace: true }
      );
    }
  }, [activeCrossFilter, activeTab, setSearchParams]);

  const handleTabChange = (newTab) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (newTab === "trace") {
          next.delete("panel"); // Keep URL clean for default tab
        } else {
          next.set("panel", newTab);
        }
        return next;
      },
      { replace: true }
    );
  };

  const matrix = vm?.matrix || {};
  const actions = vm?.actions || {};
  const trend = vm?.trend || {};
  const history = vm?.history || {};

  const matrixRowCount = matrix?.rows?.length ?? 0;
  const historyRunCount = history?.runs?.length ?? 0;

  return (
    <section className={`space-y-4 ${className}`} aria-label="Deep Quality Analysis and History">
      {/* Tab Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ud-border)] pb-3">
        <div className="flex items-center gap-2">
          <SegmentedFilter
            idPrefix="ud-analysis-tab"
            options={[
              {
                label: "Cross-Layer Traceability",
                value: "trace",
                icon: Layers,
                count: matrixRowCount,
              },
              {
                label: "Trends & Execution History",
                value: "history",
                icon: History,
                count: historyRunCount,
              },
            ]}
            value={activeTab}
            onChange={handleTabChange}
            size="md"
          />
        </div>

        <div className="text-xs text-[var(--ud-text-muted)] font-mono hidden sm:block">
          {activeTab === "trace"
            ? `${matrixRowCount} domain modules mapped across 3 tiers`
            : `${historyRunCount} recent execution runs tracked`}
        </div>
      </div>

      {/* Tab 1: Cross-Layer Traceability Flow (Alert Strip + 12-col Full Width Matrix) */}
      {activeTab === "trace" && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <ActionAlertStrip
            actions={actions?.items}
            onNavigateWorkspace={onNavigateWorkspace}
            onInspectItem={onInspectItem}
            onAskAi={onAskAi}
          />

          <CrossLayerTraceMatrix
            matrixData={matrix}
            onNavigateWorkspace={onNavigateWorkspace}
            onInspectItem={onInspectItem}
            onAskAi={onAskAi}
            activeCrossFilter={activeCrossFilter}
            onClearCrossFilter={onClearCrossFilter}
          />
        </div>
      )}

      {/* Tab 2: Trends & Execution History (Side-by-side 6 cols + 6 cols) */}
      {activeTab === "history" && (
        <div className="grid grid-cols-12 gap-4 animate-in fade-in duration-150">
          <div className="col-span-12 xl:col-span-6">
            <CoverageTrendChart trendData={trend} />
          </div>
          <div className="col-span-12 xl:col-span-6">
            <UnifiedRecentRunsTable
              historyData={history}
              onNavigateWorkspace={onNavigateWorkspace}
              onInspectItem={onInspectItem}
            />
          </div>
        </div>
      )}
    </section>
  );
}

export default AnalysisTabsZone;

