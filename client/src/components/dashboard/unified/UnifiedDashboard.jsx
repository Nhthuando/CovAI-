import { useCallback } from "react";
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
import { AlertTriangle, RefreshCw } from "lucide-react";

export function UnifiedDashboard({
  projectId,
  project,
  snapshotId,
  onNavigateWorkspace = null,
  className = "",
}) {
  const location = useLocation();
  const navigate = useNavigate();

  const projectName = project?.name || "CovAI Project";
  const snapshots = project?.snapshots || [];

  // 1. Fetch Multi-Tier Data
  const { vm, isLoading, isError, error, refetch } = useUnifiedDashboard({
    snapshotId,
    projectId,
    projectName,
    snapshots,
  });

  // 2. Multi-Suite Sequential Run
  const runAllState = useRunAllSuites({
    snapshotId,
    projectId,
    onCompleted: () => refetch(),
  });

  // 3. Snapshot Selection Handler
  const handleSelectSnapshot = useCallback(
    (newSnapshotId) => {
      const params = new URLSearchParams(location.search);
      params.set("snapshotId", newSnapshotId);
      navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    },
    [location, navigate]
  );

  // 4. Workspace Navigation Handler with deep-link focus
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

  return (
    <div
      className={`unified-dashboard bg-[var(--ud-bg)] text-[var(--ud-text)] w-full min-h-full font-sans transition-colors duration-150 ${className}`}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ZONE 1: Global Context & Command Header */}
        <ZoneErrorBoundary zoneTitle="Command Header" onRetry={refetch}>
          <GlobalCommandHeader
            vm={vm}
            onSelectSnapshot={handleSelectSnapshot}
            runAllState={runAllState}
            onNavigateWorkspace={handleNavigate}
          />
        </ZoneErrorBoundary>

        {/* ZONE 2: Executive KPI Cards (4 x 3 cols) */}
        <ZoneErrorBoundary zoneTitle="Executive KPIs" onRetry={refetch}>
          <ExecutiveKpiRow vm={vm} loading={isLoading} />
        </ZoneErrorBoundary>

        {/* ZONE 3: Test Pyramid & 3 Pillar Cards (4 cols + 8 cols) */}
        <ZoneErrorBoundary zoneTitle="Pyramid & Pillars" onRetry={refetch}>
          <PyramidAndPillarsZone
            vm={vm}
            onNavigateWorkspace={handleNavigate}
          />
        </ZoneErrorBoundary>

        {/* ZONE 4: Cross-Layer Traceability Matrix & Action Center (8 cols + 4 cols) */}
        <ZoneErrorBoundary zoneTitle="Traceability Matrix & Actions" onRetry={refetch}>
          <TraceAndActionsZone
            vm={vm}
            onNavigateWorkspace={handleNavigate}
          />
        </ZoneErrorBoundary>

        {/* ZONE 5: Trends & Execution History (6 cols + 6 cols) */}
        <ZoneErrorBoundary zoneTitle="Trends & Execution History" onRetry={refetch}>
          <TrendsAndHistoryZone
            vm={vm}
            onNavigateWorkspace={handleNavigate}
          />
        </ZoneErrorBoundary>
      </div>
    </div>
  );
}

export default UnifiedDashboard;
