import { useState, useCallback, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import "./portfolio.css";
import { useProjectsPortfolio } from "../../../hooks/useProjectsPortfolio.js";
import { PortfolioCommandHeader } from "./zones/PortfolioCommandHeader.jsx";
import { PortfolioExecutiveKpiRow } from "./zones/PortfolioExecutiveKpiRow.jsx";
import { PortfolioBenchmarkAndRiskZone } from "./zones/PortfolioBenchmarkAndRiskZone.jsx";
import { ProjectDirectoryWorkspaceZone } from "./zones/ProjectDirectoryWorkspaceZone.jsx";
import { PortfolioActivityAndInfraZone } from "./zones/PortfolioActivityAndInfraZone.jsx";
import { ExportPortfolioReportModal } from "./modals/ExportPortfolioReportModal.jsx";
import QuickProjectSettingsModal from "./modals/QuickProjectSettingsModal.jsx";
import { SlideOverInspectorDrawer } from "../unified/inspector/SlideOverInspectorDrawer.jsx";
import { ZoneErrorBoundary } from "../unified/primitives/ZoneErrorBoundary.jsx";
import { deriveFilteredPortfolioVm } from "../../../services/portfolioDashboard/portfolioDashboard.selectors.js";
import { resolvePortfolioLifecycleSummary } from "../../../services/portfolioDashboard/portfolioLifecycleSummary.js";

export function ProjectsPortfolioDashboard({
  favorites = [],
  onTogglePin,
  onOpenProjectOverview,
  onNavigateWorkspace,
  onOpenWorkspaceSettings = null,
  onDeleteProject,
  onAddProject,
  onAskAi,
  onProjectsLoaded = null,
  className = "",
}) {
  const queryClient = useQueryClient();
  const { vm, isFetching, isInitialLoading, refetch, forceRefresh } =
    useProjectsPortfolio({
      favorites,
    });

  useEffect(() => {
    if (vm?.projects) {
      onProjectsLoaded?.(vm.projects);
    }
  }, [vm?.projects, onProjectsLoaded]);

  const [highlightedProjectId, setHighlightedProjectId] = useState(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [settingsProjectId, setSettingsProjectId] = useState(null);
  const [inspectedRunItem, setInspectedRunItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [lifecycleTab, setLifecycleTab] = useState("open");
  const [statusFilter, setStatusFilter] = useState("all");
  const [layerDeficit, setLayerDeficit] = useState("all");
  const [sortBy, setSortBy] = useState("health-desc");

  const settingsProject = useMemo(
    () => (vm?.projects || []).find((p) => p.id === settingsProjectId) || null,
    [vm?.projects, settingsProjectId],
  );

  const {
    filteredVm,
    filteredProjects,
    kpiScopeProjects,
    lifecycleFilteredProjects,
    allLifecycleCounts,
    isFiltered,
    activeFilterTags,
  } = useMemo(
    () =>
      deriveFilteredPortfolioVm(vm, {
        searchQuery,
        lifecycleTab,
        statusFilter,
        layerDeficit,
        sortBy,
        favorites,
      }),
    [vm, searchQuery, lifecycleTab, statusFilter, layerDeficit, sortBy, favorites]
  );

  const lifecycleSummary = useMemo(
    () =>
      resolvePortfolioLifecycleSummary({
        isFiltered,
        filteredCounts: filteredVm?.directoryLifecycleCounts,
        allCounts: allLifecycleCounts,
      }),
    [isFiltered, filteredVm?.directoryLifecycleCounts, allLifecycleCounts]
  );

  const handleProjectSettingsSaved = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["projectsPortfolio"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["unifiedDashboard"] });
  }, [queryClient]);

  const pinnedCount = useMemo(
    () =>
      lifecycleFilteredProjects.filter(
        (p) => favorites.includes(p.id) || p.isPinned
      ).length,
    [lifecycleFilteredProjects, favorites]
  );

  const effectiveHighlightedProjectId = useMemo(
    () =>
      highlightedProjectId &&
      filteredProjects.some((p) => p.id === highlightedProjectId)
        ? highlightedProjectId
        : null,
    [highlightedProjectId, filteredProjects]
  );

  const handleResetFilters = useCallback(() => {
    setSearchQuery("");
    setLifecycleTab("open");
    setStatusFilter("all");
    setLayerDeficit("all");
  }, []);

  const handleRemoveFilterTag = useCallback((key) => {
    if (key === "search") setSearchQuery("");
    else if (key === "lifecycle") setLifecycleTab("open");
    else if (key === "status") setStatusFilter("all");
    else if (key === "layerDeficit") setLayerDeficit("all");
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
        `Analyze the testing status and coverage profile of project "${project.name}" (Health Score: ${project.healthScore}/100, Coverage: ${project.unifiedCoveragePct ?? 0}%). Identify coverage gaps across Unit, Integration, and System testing layers.`,
        {
          projectId: project.id,
          snapshotId: project.snapshotId || project.activeSnapshotId || null,
          projectName: project.name,
        }
      );
    },
    [onAskAi]
  );

  const handleAskAiDiagnose = useCallback(
    (attentionItem) => {
      const matched = (vm?.projects || []).find(
        (p) => p.id === attentionItem.projectId
      );
      onAskAi?.(
        `Diagnose this bottleneck for "${attentionItem.projectName}": ${attentionItem.title}. ${attentionItem.description || ""}`,
        {
          projectId: attentionItem.projectId || matched?.id || null,
          snapshotId: attentionItem.snapshotId || matched?.snapshotId || null,
          projectName: attentionItem.projectName || matched?.name || "",
        }
      );
    },
    [onAskAi, vm?.projects]
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
            vm={filteredVm}
            onOpenExportModal={() => setIsExportModalOpen(true)}
            isSyncing={isFetching}
            onForceRefresh={forceRefresh}
            isFiltered={isFiltered}
            activeFilterTags={activeFilterTags}
            onRemoveFilterTag={handleRemoveFilterTag}
            onResetFilters={handleResetFilters}
          />
        </ZoneErrorBoundary>

        {/* ── 2. Visual Executive Metrics Strip ────────────────────────── */}
        <ZoneErrorBoundary zoneTitle="Portfolio Metrics" onRetry={refetch}>
          <PortfolioExecutiveKpiRow
            kpis={filteredVm?.kpis}
            lifecycleCounts={lifecycleSummary.displayCounts}
            scopeBadge={lifecycleSummary.scopeBadge}
            excludedCount={lifecycleSummary.excludedFromActiveCount}
            isFiltered={isFiltered}
          />
        </ZoneErrorBoundary>

        {/* ── 3. Imported Projects Workspace (High Priority Above Fold) ─── */}
        <ZoneErrorBoundary zoneTitle="Projects Directory" onRetry={refetch}>
          <ProjectDirectoryWorkspaceZone
            projects={filteredProjects}
            allProjects={vm?.projects}
            allLifecycleCounts={allLifecycleCounts}
            lifecycleFilteredCount={lifecycleFilteredProjects.length}
            pinnedCount={pinnedCount}
            favorites={favorites}
            highlightedProjectId={effectiveHighlightedProjectId}
            onClearHighlight={() => setHighlightedProjectId(null)}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            lifecycleTab={lifecycleTab}
            onLifecycleTabChange={setLifecycleTab}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            layerDeficit={layerDeficit}
            onLayerDeficitChange={setLayerDeficit}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            isFiltered={isFiltered}
            onResetFilters={handleResetFilters}
            onTogglePin={onTogglePin}
            onOpenOverview={onOpenProjectOverview}
            onNavigateWorkspace={onNavigateWorkspace}
            onDeleteProject={onDeleteProject}
            onAskAiAboutProject={handleAskAiAboutProject}
            onOpenProjectSettings={(proj) => setSettingsProjectId(proj?.id || null)}
            onAddProject={onAddProject}
          />
        </ZoneErrorBoundary>

        {/* ── 4. Multi-Diagram Analytics Suite ─────────────────────────── */}
        <ZoneErrorBoundary zoneTitle="Quality Analytics" onRetry={refetch}>
          <PortfolioBenchmarkAndRiskZone
            kpis={filteredVm?.kpis}
            lifecycleCounts={lifecycleSummary.displayCounts}
            lifecycleScopeLabel={lifecycleSummary.donutScopeLabel}
            analytics={filteredVm?.analytics}
            attentionQueue={filteredVm?.attentionQueue}
            projects={kpiScopeProjects}
            timeRoiAnalytics={filteredVm?.timeRoiAnalytics}
            selectedProjectId={effectiveHighlightedProjectId}
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
            activityFeed={filteredVm?.activityFeed}
            runnerInfrastructure={filteredVm?.runnerInfrastructure}
            onInspectRun={handleInspectRun}
          />
        </ZoneErrorBoundary>
      </div>

      {/* Quick Project Settings Modal (Hybrid Lifecycle Flow) */}
      <QuickProjectSettingsModal
        isOpen={Boolean(settingsProject)}
        project={settingsProject}
        onClose={() => setSettingsProjectId(null)}
        onSaved={handleProjectSettingsSaved}
        onOpenFullSettings={(projectId) => {
          setSettingsProjectId(null);
          onOpenWorkspaceSettings?.(projectId);
        }}
      />

      {/* Portfolio Report Export Modal */}
      <ExportPortfolioReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        allVm={vm}
        filteredVm={filteredVm}
        isFiltered={isFiltered}
        activeFilterTags={activeFilterTags}
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
        onAskAi={(promptText) =>
          onAskAi?.(promptText, {
            projectId:
              inspectedRunItem?.projectId ||
              inspectedRunItem?.rawItem?.projectId ||
              null,
            snapshotId:
              inspectedRunItem?.snapshotId ||
              inspectedRunItem?.rawItem?.snapshotId ||
              null,
            projectName: inspectedRunItem?.rawItem?.projectName || "",
          })
        }
      />
    </div>
  );
}

export default ProjectsPortfolioDashboard;
