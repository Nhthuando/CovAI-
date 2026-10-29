import { useState, useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUnifiedDashboard } from "../../../hooks/useUnifiedDashboard.js";
import { useRunAllSuites } from "../../../hooks/useRunAllSuites.js";
import { buildWorkspaceUrl } from "../../../services/unifiedDashboard/workspaceNavigation.js";

import { ZoneErrorBoundary } from "./primitives/ZoneErrorBoundary.jsx";
import { UnifiedDashboardSkeleton } from "./skeletons/UnifiedDashboardSkeleton.jsx";
import { GlobalCommandHeader } from "./zones/GlobalCommandHeader.jsx";
import { ExecutiveKpiRow } from "./zones/ExecutiveKpiRow.jsx";
import { PyramidAndPillarsZone } from "./zones/PyramidAndPillarsZone.jsx";
import { TraceAndActionsZone } from "./zones/TraceAndActionsZone.jsx";
import { TrendsAndHistoryZone } from "./zones/TrendsAndHistoryZone.jsx";
import { SlideOverInspectorDrawer } from "./inspector/SlideOverInspectorDrawer.jsx";
import { AlertTriangle, RefreshCw, FlaskConical, Play, Info } from "lucide-react";

export function UnifiedDashboard({
  projectId,
  project,
  snapshotId,
  onNavigateWorkspace = null,
  onAskAi = null,
  className = "",
}) {
  const location = useLocation();
  const navigate = useNavigate();

  // Initialize dataMode from URL query parameter (?mode=demo or ?mode=live)
  const [dataMode, setDataMode] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get("mode") === "demo" ? "demo" : "live";
  });

  // Track active snapshot selection (allows switching snapshots interactively)
  const [activeSnapshotId, setActiveSnapshotId] = useState(
    () => snapshotId || "cmvs3749"
  );

  useEffect(() => {
    if (snapshotId) {
      setActiveSnapshotId(snapshotId);
    }
  }, [snapshotId]);

  // Cross-filtering state (triggered from Zone 3 Pyramid or Pillar Failure Breakdowns)
  const [activeCrossFilter, setActiveCrossFilter] = useState(null);

  // Slide-over inspector drawer state (triggered from Zone 4 Matrix/Actions or Zone 5 Recent Runs)
  const [inspectedItem, setInspectedItem] = useState(null);

  const projectName = project?.name || "CovAI Project";
  const snapshots = project?.snapshots || [];

  // 1. Fetch & Adapt Multi-Tier Data
  const { vm, isLoading, isError, error, refetch } = useUnifiedDashboard({
    snapshotId: activeSnapshotId,
    projectId,
    projectName,
    snapshots,
    dataMode,
  });

  // 2. Multi-Suite Sequential Run
  const runAllState = useRunAllSuites({
    snapshotId: activeSnapshotId,
    projectId,
    onCompleted: () => refetch(),
  });

  // 3. Data Mode Switch Handler
  const handleChangeDataMode = useCallback(
    (nextMode) => {
      const normalized = nextMode === "demo" ? "demo" : "live";
      setDataMode(normalized);
      setActiveCrossFilter(null);
      const params = new URLSearchParams(location.search);
      params.set("mode", normalized);
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    },
    [location, navigate]
  );

  // 4. Snapshot Selection Handler
  const handleSelectSnapshot = useCallback(
    (newSnapshotId) => {
      setActiveSnapshotId(newSnapshotId);
      const params = new URLSearchParams(location.search);
      params.set("snapshotId", newSnapshotId);
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    },
    [location, navigate]
  );

  // 5. Workspace Navigation Handler with deep-link focus
  const handleNavigate = useCallback(
    (pillar, focusParams = {}) => {
      if (onNavigateWorkspace) {
        onNavigateWorkspace(pillar, focusParams);
        return;
      }
      const targetUrl = buildWorkspaceUrl(location, pillar, focusParams);
      navigate(targetUrl);
    },
    [onNavigateWorkspace, location, navigate]
  );

  // 6. Cross-Filter Handler (scrolls smoothly to Zone 4 when activated)
  const handleSelectCrossFilter = useCallback((filterPayload) => {
    setActiveCrossFilter(filterPayload);
    if (filterPayload && typeof document !== "undefined") {
      const matrixEl = document.getElementById("ud-zone-matrix");
      if (matrixEl) {
        matrixEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, []);

  if (isLoading && !vm) {
    return (
      <div className="unified-dashboard bg-[var(--ud-bg)] text-[var(--ud-text)] w-full min-h-full p-4 sm:p-6">
        <div className="max-w-[1440px] mx-auto">
          <UnifiedDashboardSkeleton />
        </div>
      </div>
    );
  }

  if (isError && !vm) {
    return (
      <div className="unified-dashboard bg-[var(--ud-bg)] text-[var(--ud-text)] w-full min-h-full p-4 sm:p-6 flex items-center justify-center">
        <div className="rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-8 max-w-md w-full text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-[var(--ud-fail)]/10 text-[var(--ud-fail)] flex items-center justify-center mx-auto">
            <AlertTriangle size={24} />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[var(--ud-text)]">
              Dashboard Initialization Failed
            </h2>
            <p className="text-xs text-[var(--ud-text-muted)] font-mono">
              {error?.message || "Could not retrieve unified testing metrics."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity cursor-pointer mx-auto"
          >
            <RefreshCw size={13} />
            <span>Reload Overview</span>
          </button>
        </div>
      </div>
    );
  }

  const isLiveNoTests =
    dataMode === "live" && (vm?.execution?.total || 0) === 0;

  return (
    <div
      className={`unified-dashboard bg-[var(--ud-bg)] text-[var(--ud-text)] w-full min-h-full font-sans transition-colors duration-150 ${className}`}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ZONE 1: Global Context & Command Header */}
        <ZoneErrorBoundary zoneTitle="Command Header" onRetry={refetch}>
          <GlobalCommandHeader
            vm={vm}
            dataMode={dataMode}
            onChangeDataMode={handleChangeDataMode}
            onSelectSnapshot={handleSelectSnapshot}
            runAllState={runAllState}
            onNavigateWorkspace={handleNavigate}
          />
        </ZoneErrorBoundary>

        {/* Live Empty State Callout Banner when 0 tests have been executed */}
        {isLiveNoTests && (
          <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ud-no-print">
            <div className="flex items-start sm:items-center gap-2.5 text-xs">
              <Info
                size={16}
                className="text-[var(--ud-unit)] shrink-0 mt-0.5 sm:mt-0"
              />
              <div>
                <span className="font-semibold text-[var(--ud-text)]">
                  Live State Active — 0 Executed Tests Recorded
                </span>
                <span className="text-[var(--ud-text-muted)] ml-1.5">
                  {vm?.execution?.uncoveredApis > 0
                    ? `(${vm.execution.uncoveredApis} uncovered API endpoints discovered; 0 failure counts across all breakdown layers).`
                    : "Run your project test suites or switch to Demo Showcase to explore a 100% mathematically unified dataset."}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => runAllState?.runAll?.()}
                disabled={runAllState?.isRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-xs font-mono font-medium text-[var(--ud-text)] hover:border-[var(--ud-text-muted)] transition-colors cursor-pointer"
              >
                <Play size={12} className="text-[var(--ud-pass)]" />
                <span>Run All Suites</span>
              </button>
              <button
                type="button"
                onClick={() => handleChangeDataMode("demo")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--ud-warn)]/40 bg-[var(--ud-warn)]/15 text-xs font-mono font-semibold text-[var(--ud-warn)] hover:bg-[var(--ud-warn)]/25 transition-colors cursor-pointer"
              >
                <FlaskConical size={13} />
                <span>Switch to Demo Showcase</span>
              </button>
            </div>
          </div>
        )}

        {/* ZONE 2: Executive KPI Cards (4 x 3 cols) */}
        <ZoneErrorBoundary zoneTitle="Executive KPIs" onRetry={refetch}>
          <ExecutiveKpiRow vm={vm} loading={isLoading} />
        </ZoneErrorBoundary>

        {/* ZONE 3: Test Pyramid & 3 Pillar Cards (4 cols + 8 cols) */}
        <ZoneErrorBoundary zoneTitle="Pyramid & Pillars" onRetry={refetch}>
          <PyramidAndPillarsZone
            vm={vm}
            onNavigateWorkspace={handleNavigate}
            activeCrossFilter={activeCrossFilter}
            onSelectCrossFilter={handleSelectCrossFilter}
          />
        </ZoneErrorBoundary>

        {/* ZONE 4: Cross-Layer Traceability Matrix & Action Center (8 cols + 4 cols) */}
        <ZoneErrorBoundary zoneTitle="Traceability Matrix & Actions" onRetry={refetch}>
          <TraceAndActionsZone
            vm={vm}
            onNavigateWorkspace={handleNavigate}
            onInspectItem={setInspectedItem}
            onAskAi={onAskAi}
            activeCrossFilter={activeCrossFilter}
            onClearCrossFilter={() => setActiveCrossFilter(null)}
            onSwitchToDemo={() => handleChangeDataMode("demo")}
          />
        </ZoneErrorBoundary>

        {/* ZONE 5: Trends & Execution History (6 cols + 6 cols) */}
        <ZoneErrorBoundary zoneTitle="Trends & Execution History" onRetry={refetch}>
          <TrendsAndHistoryZone
            vm={vm}
            onNavigateWorkspace={handleNavigate}
            onInspectItem={setInspectedItem}
            onSwitchToDemo={() => handleChangeDataMode("demo")}
          />
        </ZoneErrorBoundary>
      </div>

      {/* Slide-Over Diagnostic & Run Inspector Drawer */}
      <SlideOverInspectorDrawer
        item={inspectedItem}
        onClose={() => setInspectedItem(null)}
        onNavigateWorkspace={handleNavigate}
        onAskAi={onAskAi}
      />
    </div>
  );
}

export default UnifiedDashboard;
