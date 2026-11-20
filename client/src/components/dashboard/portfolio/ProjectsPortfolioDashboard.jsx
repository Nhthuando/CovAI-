import { useState, useCallback } from "react";
import "./portfolio.css";
import { useProjectsPortfolio } from "../../../hooks/useProjectsPortfolio.js";
import { PortfolioCommandHeader } from "./zones/PortfolioCommandHeader.jsx";
import { PortfolioExecutiveKpiRow } from "./zones/PortfolioExecutiveKpiRow.jsx";
import { PortfolioBenchmarkAndRiskZone } from "./zones/PortfolioBenchmarkAndRiskZone.jsx";
import { ProjectDirectoryWorkspaceZone } from "./zones/ProjectDirectoryWorkspaceZone.jsx";
import { PortfolioActivityAndInfraZone } from "./zones/PortfolioActivityAndInfraZone.jsx";
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
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [inspectedRunItem, setInspectedRunItem] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");

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
        `Analyze the testing status and coverage profile of project "${project.name}" (Health Score: ${project.healthScore}/100, Coverage: ${project.unifiedCoveragePct ?? 0}%). Identify coverage gaps across Unit, Integration, and System testing layers.`
      );
    },
    [onAskAi]
  );

  const handleAskAiDiagnose = useCallback(
    (attentionItem) => {
      onAskAi?.(
        `Diagnose this bottleneck for "${attentionItem.projectName}": ${attentionItem.title}. ${attentionItem.description || ""}`
      );
    },
    [onAskAi]
  );

  if (isInitialLoading) {
    return (
      <div
        className={`portfolio-studio bg-[var(--ps-bg)] text-[var(--ps-ink)] w-full min-h-full font-sans transition-colors duration-150 ${className}`}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-5 animate-pulse">
          <div className="h-12 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-line)]" />
          <div className="h-32 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-line)]" />
          <div className="h-64 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-line)]" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`portfolio-studio bg-[var(--ps-bg)] text-[var(--ps-ink)] w-full min-h-full font-sans transition-colors duration-150 ${className}`}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ── 1. Compact Header ────────────────────────────────────────── */}
        <ZoneErrorBoundary zoneTitle="Portfolio Header" onRetry={refetch}>
          <PortfolioCommandHeader
            vm={vm}
            onOpenExportModal={() => setIsExportModalOpen(true)}
            isSyncing={isFetching}
            onForceRefresh={forceRefresh}
          />
        </ZoneErrorBoundary>

        {/* ── 2. Visual Executive Metrics Strip ────────────────────────── */}
        <ZoneErrorBoundary zoneTitle="Portfolio Metrics" onRetry={refetch}>
          <PortfolioExecutiveKpiRow
            kpis={vm?.kpis}
            lifecycleCounts={vm?.lifecycleCounts}
          />
        </ZoneErrorBoundary>

        {/* ── 3. Imported Projects Workspace (High Priority Above Fold) ─── */}
        <ZoneErrorBoundary zoneTitle="Projects Directory" onRetry={refetch}>
          <ProjectDirectoryWorkspaceZone
            projects={vm?.projects}
            favorites={favorites}
            highlightedProjectId={highlightedProjectId}
            onClearHighlight={() => setHighlightedProjectId(null)}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            onTogglePin={onTogglePin}
            onOpenOverview={onOpenProjectOverview}
            onNavigateWorkspace={onNavigateWorkspace}
            onDeleteProject={onDeleteProject}
            onAskAiAboutProject={handleAskAiAboutProject}
            onAddProject={onAddProject}
          />
        </ZoneErrorBoundary>

        {/* ── 4. Multi-Diagram Analytics Suite ─────────────────────────── */}
        <ZoneErrorBoundary zoneTitle="Quality Analytics" onRetry={refetch}>
          <PortfolioBenchmarkAndRiskZone
            kpis={vm?.kpis}
            lifecycleCounts={vm?.lifecycleCounts}
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

        {/* ── 5. Recent Runs & Runner Status ───────────────────────────── */}
        <ZoneErrorBoundary zoneTitle="Recent Runs" onRetry={refetch}>
          <PortfolioActivityAndInfraZone
            activityFeed={vm?.activityFeed}
            runnerInfrastructure={vm?.runnerInfrastructure}
            onInspectRun={handleInspectRun}
          />
        </ZoneErrorBoundary>
      </div>

      {/* Single PDF Report Modal */}
      <ExportPortfolioReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        vm={vm}
      />

      {/* Slide-Over Run Inspector */}
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
