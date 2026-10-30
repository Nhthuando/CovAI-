import { useState, useCallback, useEffect, useRef } from "react";
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
import { AlertTriangle, RefreshCw } from "lucide-react";

const EMPTY_PROJECTS = [];
const EMPTY_SNAPSHOTS = [];

export function UnifiedDashboard({
  projectId,
  project,
  projects = EMPTY_PROJECTS,
  onSelectProject = null,
  snapshotId,
  onNavigateWorkspace = null,
  onAskAi = null,
  onSummaryChange = null,
  className = "",
}) {
  const location = useLocation();
  const navigate = useNavigate();

  // Track active snapshot selection (allows switching snapshots interactively)
  const [activeSnapshotId, setActiveSnapshotId] = useState(
    () => snapshotId || project?.snapshots?.[0]?.id || ""
  );

  useEffect(() => {
    if (snapshotId) {
      setActiveSnapshotId(snapshotId);
    } else if (project?.snapshots?.[0]?.id) {
      setActiveSnapshotId(project.snapshots[0].id);
    }
  }, [snapshotId, project?.snapshots]);

  // Cross-filtering state (triggered from Zone 3 Pyramid or Pillar Failure Breakdowns)
  const [activeCrossFilter, setActiveCrossFilter] = useState(null);

  // Slide-over inspector drawer state (triggered from Zone 4 Matrix/Actions or Zone 5 Recent Runs)
  const [inspectedItem, setInspectedItem] = useState(null);

  const projectName = project?.name || "CovAI Project";
  const snapshots = project?.snapshots || EMPTY_SNAPSHOTS;

  // 1. Fetch & Adapt Real Multi-Tier Data
  const { vm, isLoading, isError, error, refetch } = useUnifiedDashboard({
    snapshotId: activeSnapshotId,
    projectId,
    projectName,
    snapshots,
  });

  // Publish live unified quality summary to parent / COV AI Agent context (guarded against duplicate emissions)
  const lastSummaryJsonRef = useRef("");
  useEffect(() => {
    if (!vm) return;
    const summaryPayload = {
      projectId: vm.context?.projectId,
      projectName: vm.context?.projectName,
      snapshotId: vm.context?.snapshotId,
      healthScore: vm.health?.score ?? null,
      healthGrade: vm.health?.grade ?? "--",
      qualityGateStatus: vm.qualityGate?.status ?? "UNVERIFIED",
      qualityGateLabel: vm.qualityGate?.label ?? "UNVERIFIED",
      totalExecutedTests: vm.execution?.total ?? 0,
      passedTests: vm.execution?.passed ?? 0,
      failedTests: vm.execution?.failed ?? 0,
      uncoveredApis: vm.execution?.uncoveredApis ?? 0,
      overallCoveragePct: vm.coverage?.overall ?? null,
      coverageOverallPct: vm.coverage?.overall ?? null,
      unitLinesPct: vm.coverage?.codePct ?? null,
      unitBranchesPct: vm.coverage?.branchPct ?? null,
      apiCoveragePct: vm.coverage?.apiPct ?? null,
      systemFlowPct: vm.coverage?.flowPct ?? null,
      flowCoveragePct: vm.coverage?.flowPct ?? null,
      pyramidShape: vm.pyramid?.badgeTitle ?? null,
      lowBranchCoverageFiles: (vm.pillars?.unit?.lowCoverageItems || []).slice(0, 4),
      failingModules: (vm.matrix?.rows || [])
        .filter(
          (r) =>
            r.unit?.status === "fail" ||
            r.integration?.status === "fail" ||
            r.system?.status === "fail"
        )
        .map((r) => ({
          moduleName: r.moduleName,
          suspectLayer: r.rootCause?.suspectLayer,
          summary: r.rootCause?.summary,
          diagnosis: r.rootCause?.diagnosis,
          endpoint: r.integration?.endpoint,
          unitFile: r.unit?.path,
        })),
      topActions: (vm.actions?.items || []).slice(0, 5).map((a) => ({
        priority: a.priority,
        pillar: a.pillar,
        title: a.title,
        targetName: a.targetName,
        description: a.description,
      })),
    };

    const serialized = JSON.stringify(summaryPayload);
    if (serialized === lastSummaryJsonRef.current) return;
    lastSummaryJsonRef.current = serialized;

    if (onSummaryChange) {
      onSummaryChange(summaryPayload);
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("covai:unified-summary-updated", { detail: summaryPayload })
      );
    }
  }, [vm, onSummaryChange]);

  // 2. Multi-Suite Sequential Run
  const runAllState = useRunAllSuites({
    snapshotId: activeSnapshotId,
    projectId,
    onCompleted: () => refetch(),
  });

  // 3. Snapshot Selection Handler
  const handleSelectSnapshot = useCallback(
    (newSnapshotId) => {
      if (!newSnapshotId) return;
      setActiveSnapshotId(newSnapshotId);
      setActiveCrossFilter(null);
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

  // 5. Cross-Filter Handler (scrolls smoothly to Zone 4 when activated)
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

  return (
    <div
      className={`unified-dashboard bg-[var(--ud-bg)] text-[var(--ud-text)] w-full min-h-full font-sans transition-colors duration-150 ${className}`}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ZONE 1: Global Context & Command Header */}
        <ZoneErrorBoundary zoneTitle="Command Header" onRetry={refetch}>
          <GlobalCommandHeader
            vm={vm}
            projects={projects}
            onSelectProject={onSelectProject}
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
          />
        </ZoneErrorBoundary>

        {/* ZONE 5: Trends & Execution History (6 cols + 6 cols) */}
        <ZoneErrorBoundary zoneTitle="Trends & Execution History" onRetry={refetch}>
          <TrendsAndHistoryZone
            vm={vm}
            onNavigateWorkspace={handleNavigate}
            onInspectItem={setInspectedItem}
          />
        </ZoneErrorBoundary>
      </div>

      {/* Slide-Over Diagnostic & Run Inspector Drawer */}
      <SlideOverInspectorDrawer
        item={inspectedItem}
        snapshotId={activeSnapshotId}
        onClose={() => setInspectedItem(null)}
        onNavigateWorkspace={handleNavigate}
        onAskAi={onAskAi}
      />
    </div>
  );
}

export default UnifiedDashboard;
