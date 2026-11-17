import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProjectsPortfolio } from "../../../hooks/useProjectsPortfolio.js";
import { PortfolioCommandHeader } from "./zones/PortfolioCommandHeader.jsx";
import { PortfolioExecutiveKpiRow } from "./zones/PortfolioExecutiveKpiRow.jsx";
import { PortfolioBenchmarkAndRiskZone } from "./zones/PortfolioBenchmarkAndRiskZone.jsx";
import { ProjectDirectoryWorkspaceZone } from "./zones/ProjectDirectoryWorkspaceZone.jsx";
import { PortfolioActivityAndInfraZone } from "./zones/PortfolioActivityAndInfraZone.jsx";
import { CompareProjectsModal } from "./modals/CompareProjectsModal.jsx";
import { ExportPortfolioReportModal } from "./modals/ExportPortfolioReportModal.jsx";
import { SlideOverInspectorDrawer } from "../unified/inspector/SlideOverInspectorDrawer.jsx";
import { ZoneErrorBoundary } from "../unified/primitives/ZoneErrorBoundary.jsx";

export function ProjectsPortfolioDashboard({
  favorites = [],
  onTogglePin,
  onOpenProjectOverview,
  onNavigateWorkspace,
  onDeleteProject,
  onAddProject,
  onAskAi,
  className = "",
}) {
  const { vm, isFetching, isInitialLoading, refetch, forceRefresh } =
    useProjectsPortfolio({
      favorites,
    });

  const [highlightedProjectId, setHighlightedProjectId] = useState(null);
  const [selectedForCompareIds, setSelectedForCompareIds] = useState([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [inspectedRunItem, setInspectedRunItem] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const queryClient = useQueryClient();

  const handleStatusChange = useCallback(() => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  }, [refetch, queryClient]);

  const handleToggleCompare = useCallback((projectId) => {
    setSelectedForCompareIds((prev) => {
      if (prev.includes(projectId)) {
        return prev.filter((id) => id !== projectId);
      }
      if (prev.length >= 3) {
        return [prev[1], prev[2], projectId];
      }
      return [...prev, projectId];
    });
  }, []);

  const handleFocusAttentionQueue = useCallback(() => {
    const el = document.getElementById("portfolio-attention-queue");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const handleSelectBenchmarkProject = useCallback((projectId) => {
    setHighlightedProjectId(projectId);
    if (projectId) {
      setTimeout(() => {
        const cardEl =
          document.getElementById(`project-card-${projectId}`) ||
          document.getElementById("project-directory-workspace-zone");
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 40);
    }
  }, []);

  const handleInspectRun = useCallback((runEvent) => {
    setInspectedRunItem({
      id: runEvent.id,
      runId: runEvent.runId || runEvent.id,
      snapshotId: runEvent.snapshotId,
      projectId: runEvent.projectId,
      inspectorType: "run",
      title: `${runEvent.projectName} • ${runEvent.type}`,
      pillar: runEvent.pillar,
      type: runEvent.type,
      startedAt: runEvent.timestamp || new Date().toISOString(),
      outcome: runEvent.outcome,
      durationMs: runEvent.durationMs || 4000,
      timestamp: runEvent.timestamp,
      summary: runEvent.summary,
      rawItem: runEvent,
    });
  }, []);

  const handleAskAiAboutProject = useCallback(
    (project) => {
      onAskAi?.(
        `Please analyze the testing status and release readiness of project "${project.name}" (Health Score: ${project.healthScore}/100, Gate: ${project.gateStatus}). Identify the primary coverage gaps across Unit, Integration, and System testing layers.`
      );
    },
    [onAskAi]
  );

  const handleAskAiDiagnose = useCallback(
    (attentionItem) => {
      onAskAi?.(
        `Diagnose this priority cross-project bottleneck for "${attentionItem.projectName}": ${attentionItem.title}. Description: ${attentionItem.description}`
      );
    },
    [onAskAi]
  );

  if (isInitialLoading) {
    return (
      <div
        className={`unified-dashboard portfolio-dashboard bg-[var(--ud-bg)] text-[var(--ud-text)] w-full min-h-full font-sans transition-colors duration-150 ${className}`}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6 animate-pulse">
          <div className="h-14 rounded-lg bg-[var(--ud-surface)] border border-[var(--ud-border)]" />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-[var(--ud-surface)] border border-[var(--ud-border)]" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-64 rounded-lg bg-[var(--ud-surface)] border border-[var(--ud-border)]" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`unified-dashboard portfolio-dashboard bg-[var(--ud-bg)] text-[var(--ud-text)] w-full min-h-full font-sans transition-colors duration-150 ${className}`}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ── ZONE 1: Portfolio Command Header (NO duplicate "+ Project" buttons) ── */}
        <ZoneErrorBoundary zoneTitle="Portfolio Command Header" onRetry={refetch}>
          <PortfolioCommandHeader
            vm={vm}
            onOpenCompareModal={() => setIsCompareModalOpen(true)}
            onOpenExportModal={() => setIsExportModalOpen(true)}
            onSelectStatusFilter={setStatusFilter}
            onBatchRunCompleted={refetch}
            isSyncing={isFetching}
            onForceRefresh={forceRefresh}
          />
        </ZoneErrorBoundary>

        {/* ── ZONE 2: Portfolio Executive KPI Row ────────────────────────────── */}
        <ZoneErrorBoundary zoneTitle="Executive KPIs" onRetry={refetch}>
          <PortfolioExecutiveKpiRow
            kpis={vm?.kpis}
            lifecycleCounts={vm?.lifecycleCounts}
            onSelectStatusFilter={setStatusFilter}
            onFocusAttentionQueue={handleFocusAttentionQueue}
          />
        </ZoneErrorBoundary>

        {/* ── ZONE 3 (Promoted Above the Fold): Project Directory Workspace ──── */}
        <ZoneErrorBoundary zoneTitle="Project Directory Workspace" onRetry={refetch}>
          <ProjectDirectoryWorkspaceZone
            projects={vm?.projects}
            favorites={favorites}
            highlightedProjectId={highlightedProjectId}
            onClearHighlight={() => setHighlightedProjectId(null)}
            selectedForCompareIds={selectedForCompareIds}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            onTogglePin={onTogglePin}
            onToggleCompare={handleToggleCompare}
            onOpenOverview={onOpenProjectOverview}
            onNavigateWorkspace={onNavigateWorkspace}
            onDeleteProject={onDeleteProject}
            onExportProject={(proj) => {
              handleAskAiAboutProject?.(proj);
            }}
            onAskAiAboutProject={handleAskAiAboutProject}
            onAddProject={onAddProject}
            onStatusChange={handleStatusChange}
          />
        </ZoneErrorBoundary>

        {/* ── ZONE 4 (Below Directory): Benchmark Visualizer & Risk Radar ────── */}
        <ZoneErrorBoundary zoneTitle="Benchmark & Risk Radar" onRetry={refetch}>
          <PortfolioBenchmarkAndRiskZone
            analytics={vm?.analytics}
            attentionQueue={vm?.attentionQueue}
            projects={vm?.projects}
            timeRoiAnalytics={vm?.timeRoiAnalytics}
            selectedProjectId={highlightedProjectId}
            onSelectProject={handleSelectBenchmarkProject}
            onNavigateProjectWorkspace={(projId, pillar, focus) =>
              onNavigateWorkspace?.(projId, pillar, focus)
            }
            onAskAiDiagnose={handleAskAiDiagnose}
          />
        </ZoneErrorBoundary>

        {/* ── ZONE 5: Activity Stream & Runner Infrastructure Status ───────── */}
        <ZoneErrorBoundary zoneTitle="Activity & Runner Infrastructure" onRetry={refetch}>
          <PortfolioActivityAndInfraZone
            activityFeed={vm?.activityFeed}
            runnerInfrastructure={vm?.runnerInfrastructure}
            onInspectRun={handleInspectRun}
          />
        </ZoneErrorBoundary>
      </div>

      {/* ── Overlays: Modals & Slide-Over Drawers ───────────────────────────── */}
      {/* 1. Side-by-Side Comparison Modal */}
      <CompareProjectsModal
        isOpen={isCompareModalOpen}
        onClose={() => setIsCompareModalOpen(false)}
        projects={vm?.projects || []}
        initialSelectedIds={selectedForCompareIds}
        onOpenOverview={onOpenProjectOverview}
        onNavigateWorkspace={onNavigateWorkspace}
      />

      {/* 2. Account-Wide Portfolio Report Modal */}
      <ExportPortfolioReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        vm={vm}
      />

      {/* 3. Slide-Over Run Inspector Drawer */}
      <SlideOverInspectorDrawer
        item={inspectedRunItem}
        onClose={() => setInspectedRunItem(null)}
        onNavigateWorkspace={(pillar) => {
          if (inspectedRunItem?.rawItem?.projectId) {
            onNavigateWorkspace?.(inspectedRunItem.rawItem.projectId, pillar);
          }
        }}
        onAskAi={onAskAi}
      />
    </div>
  );
}

export default ProjectsPortfolioDashboard;

