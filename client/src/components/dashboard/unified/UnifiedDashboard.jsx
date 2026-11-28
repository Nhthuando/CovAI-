import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUnifiedDashboard } from "../../../hooks/useUnifiedDashboard.js";
import { useRunAllSuites } from "../../../hooks/useRunAllSuites.js";
import { useDashboardSocket } from "../../../hooks/useDashboardSocket.js";
import { buildWorkspaceUrl, buildTrustworthinessUrl } from "../../../services/unifiedDashboard/workspaceNavigation.js";

import { ZoneErrorBoundary } from "./primitives/ZoneErrorBoundary.jsx";
import { GlobalCommandHeader } from "./zones/GlobalCommandHeader.jsx";
import { ExecutiveKpiRow } from "./zones/ExecutiveKpiRow.jsx";
import { QualityChartsRow } from "./zones/QualityChartsRow.jsx";
import { PyramidAndPillarsZone } from "./zones/PyramidAndPillarsZone.jsx";
import { FeatureExecutionDurationsPanel } from "./execution/FeatureExecutionDurationsPanel.jsx";
import { AiTrustworthinessSummaryPanel } from "./trustworthiness/AiTrustworthinessSummaryPanel.jsx";
import { AnalysisTabsZone } from "./zones/AnalysisTabsZone.jsx";
import { SlideOverInspectorDrawer } from "./inspector/SlideOverInspectorDrawer.jsx";
import { AlertTriangle, RefreshCw } from "lucide-react";
import "../portfolio/portfolio.css";

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

  // Resolved effective snapshot ID derived directly from props without lagging state sync
  const effectiveSnapshotId =
    snapshotId ||
    project?.activeSnapshotId ||
    project?.latestSnapshotId ||
    project?.snapshots?.[0]?.id ||
    "";

  // Cross-filtering state (triggered from Zone 3 Pyramid or Pillar Failure Breakdowns)
  const [activeCrossFilter, setActiveCrossFilter] = useState(null);

  // Slide-over inspector drawer state (triggered from Zone 4 Matrix/Actions or Zone 5 Recent Runs)
  const [inspectedItem, setInspectedItem] = useState(null);

  const projectName = project?.name || "CovAI Project";
  const projectBranch = project?.defaultBranch || "";
  const snapshots = project?.snapshots || EMPTY_SNAPSHOTS;

  // 1. Fetch & Adapt Real Multi-Tier Data
  const { vm, isLoading, isFetching, isError, error, refetch, forceRefresh } = useUnifiedDashboard({
    snapshotId: effectiveSnapshotId,
    projectId,
    projectName,
    branch: projectBranch,
    snapshots,
  });

  // Real-time telemetry via Socket.IO
  const effectiveProjectId = projectId || project?.id || vm?.context?.projectId;
  const { isConnected: isSocketConnected, liveRuns } = useDashboardSocket({
    projectId: effectiveProjectId,
    snapshotId: effectiveSnapshotId,
  });

  // Publish live unified quality summary to parent / COV AI Agent context (guarded against duplicate emissions)
  const lastSummaryJsonRef = useRef("");
  useEffect(() => {
    if (!vm) {
      if (effectiveProjectId && effectiveSnapshotId) {
        onSummaryChange?.({
          projectId: effectiveProjectId,
          snapshotId: effectiveSnapshotId,
          state: isError ? "unavailable" : "loading",
        });
      }
      lastSummaryJsonRef.current = "";
      return;
    }
    const summaryPayload = {
      projectId: vm.context?.projectId,
      projectName: vm.context?.projectName,
      lifecycleStatus: vm.context?.lifecycleStatus || null,
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
  }, [vm, onSummaryChange, effectiveProjectId, effectiveSnapshotId, isError]);

  // 2. Multi-Suite Sequential Run (reuses activeSuiteRun from unified-dashboard payload — 0 extra HTTP requests on mount)
  const runAllState = useRunAllSuites({
    snapshotId: effectiveSnapshotId,
    projectId,
    initialActiveSuiteRun: vm?.context?.activeSuiteRun,
    skipInitialFetch: true,
    onCompleted: () => refetch(),
  });

  // 3. Snapshot Selection Handler
  const handleSelectSnapshot = useCallback(
    (newSnapshotId) => {
      if (!newSnapshotId) return;
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

  const handleOpenTrustworthiness = useCallback(() => {
    const targetUrl = buildTrustworthinessUrl(location, effectiveProjectId);
    navigate(targetUrl);
  }, [location, effectiveProjectId, navigate]);

  // Jump from Executive KPI Action Items card to Action Alert Strip (switching away from history tab if needed)
  const handleJumpToActions = useCallback(() => {
    const params = new URLSearchParams(location.search);
    const wasHistory = params.get("panel") === "history";
    if (wasHistory) {
      params.delete("panel");
      const qs = params.toString();
      navigate(qs ? `${location.pathname}?${qs}` : location.pathname, { replace: true });
    }
    const scrollToTargets = () => {
      if (typeof document === "undefined") return;
      const el =
        document.getElementById("ud-action-alerts") ||
        document.getElementById("ud-analysis-tabs");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    if (wasHistory) {
      setTimeout(scrollToTargets, 60);
    } else {
      scrollToTargets();
    }
  }, [location, navigate]);

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

  // Keep full dashboard chrome visible from t=0ms; only metric values hydrate once loaded
  const isInitialWaiting = (!projectId && !project) || !effectiveSnapshotId;
  const isDashboardLoading = isInitialWaiting || (!vm && (isLoading || isFetching));

  if (isError && !vm) {
    return (
      <div className="portfolio-studio unified-dashboard bg-[var(--ud-bg)] text-[var(--ud-text)] w-full min-h-full p-4 sm:p-6 flex items-center justify-center">
        <div className="rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-8 max-w-md w-full text-center space-y-4">
          <div className="w-12 h-12 rounded-lg bg-[var(--ud-fail)]/10 text-[var(--ud-fail)] flex items-center justify-center mx-auto">
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
            className="ps-btn-contrast inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-[var(--radius-md)] cursor-pointer mx-auto"
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
      className={`portfolio-studio unified-dashboard bg-[var(--ud-bg)] text-[var(--ud-text)] w-full min-h-full font-sans transition-colors duration-150 ${className}`}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ZONE 1: Global Context & Command Header */}
        <ZoneErrorBoundary zoneTitle="Command Header" onRetry={refetch}>
          <GlobalCommandHeader
            vm={vm}
            loading={isDashboardLoading}
            fallbackProject={project}
            fallbackSnapshotId={effectiveSnapshotId}
            projects={projects}
            onSelectProject={onSelectProject}
            onSelectSnapshot={handleSelectSnapshot}
            runAllState={runAllState}
            onAskAi={onAskAi}
            isSyncing={isFetching}
            onForceRefresh={forceRefresh}
            liveRuns={liveRuns}
            isSocketConnected={isSocketConnected}
          />
        </ZoneErrorBoundary>

        {/* ZONE 2: Executive KPI Cards (4 x 3 cols) */}
        <ZoneErrorBoundary zoneTitle="Executive KPIs" onRetry={refetch}>
          <ExecutiveKpiRow
            vm={vm}
            loading={isDashboardLoading}
            onJumpToActions={handleJumpToActions}
          />
        </ZoneErrorBoundary>

        {/* ZONE 2.5: Multi-Tier Bar Chart & Coverage Trend Chart */}
        <ZoneErrorBoundary zoneTitle="Quality Charts" onRetry={refetch}>
          <QualityChartsRow
            vm={vm}
            loading={isDashboardLoading}
            onNavigateWorkspace={handleNavigate}
          />
        </ZoneErrorBoundary>

        {/* ZONE 3: Test Pyramid & 3 Pillar Cards (4 cols + 8 cols) */}
        <ZoneErrorBoundary zoneTitle="Pyramid & Pillars" onRetry={refetch}>
          <PyramidAndPillarsZone
            vm={vm}
            loading={isDashboardLoading}
            onNavigateWorkspace={handleNavigate}
            activeCrossFilter={activeCrossFilter}
            onSelectCrossFilter={handleSelectCrossFilter}
          />
        </ZoneErrorBoundary>

        {/* ZONE 3.5: Per-Feature Execution Durations (R2) & AI Trustworthiness Evaluation (R3) */}
        <ZoneErrorBoundary zoneTitle="Per-Feature Execution Durations" onRetry={refetch}>
          <FeatureExecutionDurationsPanel
            featureDurations={vm?.featureDurations}
            loading={isDashboardLoading}
          />
        </ZoneErrorBoundary>

        <ZoneErrorBoundary zoneTitle="AI Trustworthiness Evaluation" onRetry={refetch}>
          <AiTrustworthinessSummaryPanel
            aiTrustworthiness={vm?.aiTrustworthiness}
            onOpenWorkspace={handleOpenTrustworthiness}
          />
        </ZoneErrorBoundary>

        {/* ZONE 4: Unified Analysis Tabs (Traceability Matrix & Action Strip vs Trends & History) */}
        <ZoneErrorBoundary zoneTitle="Deep Quality Analysis" onRetry={refetch}>
          <AnalysisTabsZone
            vm={vm}
            loading={isDashboardLoading}
            onNavigateWorkspace={handleNavigate}
            onInspectItem={setInspectedItem}
            onAskAi={onAskAi}
            activeCrossFilter={activeCrossFilter}
            onClearCrossFilter={() => setActiveCrossFilter(null)}
          />
        </ZoneErrorBoundary>
      </div>

      {/* Slide-Over Diagnostic & Run Inspector Drawer */}
      <SlideOverInspectorDrawer
        item={inspectedItem}
        snapshotId={effectiveSnapshotId}
        onClose={() => setInspectedItem(null)}
        onNavigateWorkspace={handleNavigate}
        onAskAi={onAskAi}
      />
    </div>
  );
}

export default UnifiedDashboard;
