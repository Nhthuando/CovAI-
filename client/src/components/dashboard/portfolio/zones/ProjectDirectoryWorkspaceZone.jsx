import { useState, useMemo } from "react";
import {
  Search,
  X,
  SlidersHorizontal,
  Grid,
  List,
  Star,
  GitBranch,
  ArrowRight,
  ExternalLink,
  Trash2,
  FolderGit2,
  ArrowLeftRight,
} from "lucide-react";
import { ProjectQualityCard } from "../cards/ProjectQualityCard.jsx";
import { filterAndSortPortfolioProjects } from "../../../../services/portfolioDashboard/portfolioDashboard.selectors.js";
import { PORTFOLIO_CONFIG } from "../../../../services/portfolioDashboard/portfolioDashboard.config.js";

export function ProjectDirectoryWorkspaceZone({
  projects = [],
  favorites = [],
  highlightedProjectId = null,
  onClearHighlight,
  selectedForCompareIds = [],
  statusFilter = "all",
  onStatusFilterChange,
  onTogglePin,
  onToggleCompare,
  onOpenOverview,
  onNavigateWorkspace,
  onDeleteProject,
  onExportProject,
  onAskAiAboutProject,
  onAddProject,
  className = "",
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [layerDeficit, setLayerDeficit] = useState("all");
  const [sortBy, setSortBy] = useState("health-desc");
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "table"

  // Filter & Sort Projects
  const filteredProjects = useMemo(() => {
    return filterAndSortPortfolioProjects(projects, {
      searchQuery,
      statusFilter,
      layerDeficit,
      sortBy,
      favorites,
    });
  }, [projects, searchQuery, statusFilter, layerDeficit, sortBy, favorites]);

  // Compute status pill counts
  const statusCounts = useMemo(() => {
    const counts = { all: projects.length, pinned: 0, PASSED: 0, AT_RISK: 0, BLOCKED: 0, UNTESTED: 0 };
    for (const p of projects) {
      if (favorites.includes(p.id) || p.isPinned) counts.pinned++;
      const gate = (p.gateStatus || "").toUpperCase();
      if (counts[gate] !== undefined) counts[gate]++;
    }
    return counts;
  }, [projects, favorites]);

  return (
    <section
      id="project-directory-workspace-zone"
      aria-label="Project Directory Workspace"
      className={`space-y-4 ${className}`}
    >
      {/* ── Multi-Dimensional Directory Toolbar ────────────────────────────── */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-3 sm:p-4 shadow-xs space-y-3">
        {/* Top Toolbar Row: Search + Layer Deficit + Sort + View Toggle */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Instant Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ud-text-muted)] pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by project name, branch, snapshot ID, or tech stack..."
              className="w-full h-8 pl-9 pr-8 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] text-xs text-[var(--ud-text)] placeholder:text-[var(--ud-text-muted)] outline-none focus:border-[var(--color-primary)] font-mono transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] cursor-pointer"
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Controls: Layer Deficit Filter + Sort + Grid/Table Toggle */}
          <div className="flex flex-wrap items-center gap-2.5 justify-between lg:justify-end text-xs font-mono">
            {/* Layer Deficit Filter Dropdown */}
            <div className="flex items-center gap-1.5 text-[var(--ud-text-muted)]">
              <span className="hidden sm:inline">Deficit:</span>
              <select
                value={layerDeficit}
                onChange={(e) => setLayerDeficit(e.target.value)}
                className="bg-[var(--ud-surface-2)] border border-[var(--ud-border)] rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--ud-text)] outline-none cursor-pointer focus:border-[var(--color-primary)]"
              >
                {PORTFOLIO_CONFIG.layerDeficitOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort Selector */}
            <div className="flex items-center gap-1.5 text-[var(--ud-text-muted)]">
              <SlidersHorizontal size={13} className="shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-[var(--ud-surface-2)] border border-[var(--ud-border)] rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--ud-text)] outline-none cursor-pointer focus:border-[var(--color-primary)]"
              >
                {PORTFOLIO_CONFIG.sortOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Grid / Comparison Table View Toggle */}
            <div className="flex items-center p-0.5 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)]">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-[var(--ud-surface)] text-[var(--ud-text)] shadow-xs"
                    : "text-[var(--ud-text-muted)] hover:text-[var(--ud-text)]"
                }`}
                title="Grid Cards View (3 per row)"
                aria-label="Grid Cards View"
              >
                <Grid size={13} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                  viewMode === "table"
                    ? "bg-[var(--ud-surface)] text-[var(--ud-text)] shadow-xs"
                    : "text-[var(--ud-text-muted)] hover:text-[var(--ud-text)]"
                }`}
                title="Comparison Table View"
                aria-label="Comparison Table View"
              >
                <List size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Toolbar Row: Status Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[var(--ud-border)] font-mono text-xs">
          {[
            { id: "all", label: `All (${statusCounts.all})` },
            { id: "pinned", label: `★ Pinned (${statusCounts.pinned})` },
            { id: "PASSED", label: `Passed (${statusCounts.PASSED})`, color: "var(--ud-pass)" },
            { id: "AT_RISK", label: `At Risk (${statusCounts.AT_RISK})`, color: "var(--ud-warn)" },
            { id: "BLOCKED", label: `Blocked (${statusCounts.BLOCKED})`, color: "var(--ud-fail)" },
            { id: "UNTESTED", label: `Untested (${statusCounts.UNTESTED})`, color: "var(--ud-neutral)" },
          ].map((pill) => {
            const isActive = statusFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => onStatusFilterChange?.(pill.id)}
                className={`px-2.5 py-1 rounded-[var(--radius-md)] transition-colors cursor-pointer text-[11px] ${
                  isActive
                    ? "bg-[var(--ud-text)] text-[var(--ud-bg)] font-bold shadow-xs"
                    : "bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] border border-[var(--ud-border)]"
                }`}
              >
                {pill.label}
              </button>
            );
          })}

          {highlightedProjectId && (
            <button
              type="button"
              onClick={() => onClearHighlight?.()}
              className="px-2.5 py-1 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 text-[11px] text-[var(--color-primary)] font-semibold inline-flex items-center gap-1 cursor-pointer hover:bg-[var(--color-primary)]/15 transition-colors"
              title="Clear focused project highlight"
            >
              <span>
                Focused: {projects.find((p) => p.id === highlightedProjectId)?.name || highlightedProjectId}
              </span>
              <X size={11} />
            </button>
          )}

          {selectedForCompareIds.length > 0 && (
            <span className="ml-auto text-[11px] text-[var(--color-primary)] font-semibold flex items-center gap-1">
              <ArrowLeftRight size={11} />
              {selectedForCompareIds.length} selected for comparison
            </span>
          )}
        </div>
      </div>

      {/* ── Content View ───────────────────────────────────────────────────── */}
      {filteredProjects.length === 0 ? (
        /* Empty State */
        <div className="py-16 border border-dashed border-[var(--ud-border)] rounded-[var(--radius-lg)] text-center bg-[var(--ud-surface)] flex flex-col items-center justify-center p-8">
          <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] flex items-center justify-center text-[var(--ud-text-muted)] mb-3">
            <FolderGit2 size={24} />
          </div>
          <h3 className="text-sm font-semibold text-[var(--ud-text)]">
            No matching projects found
          </h3>
          <p className="text-xs text-[var(--ud-text-muted)] mt-1 max-w-sm">
            {searchQuery
              ? `No projects match "${searchQuery}". Clear your search term or adjust status filters.`
              : "No projects in this category. Reset filters or import a new project."}
          </p>
          <div className="flex items-center gap-2 mt-4">
            {(searchQuery || statusFilter !== "all" || layerDeficit !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  onStatusFilterChange?.("all");
                  setLayerDeficit("all");
                }}
                className="px-3 py-1.5 rounded-[var(--radius-md)] border border-[var(--ud-border)] text-xs font-mono font-medium hover:bg-[var(--ud-surface-2)] cursor-pointer"
              >
                Reset All Filters
              </button>
            )}
            <button
              type="button"
              onClick={onAddProject}
              className="px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-mono font-medium hover:opacity-90 cursor-pointer"
            >
              Import Project
            </button>
          </div>
        </div>
      ) : viewMode === "grid" ? (
        /* ── Grid Cards View (3 per row on desktop) ───────────────────────── */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProjects.map((p) => (
            <ProjectQualityCard
              key={p.id}
              project={p}
              isPinned={favorites.includes(p.id) || p.isPinned}
              isSelectedForCompare={selectedForCompareIds.includes(p.id)}
              isHighlighted={highlightedProjectId === p.id}
              onTogglePin={onTogglePin}
              onToggleCompare={onToggleCompare}
              onOpenOverview={onOpenOverview}
              onNavigateWorkspace={onNavigateWorkspace}
              onDeleteProject={onDeleteProject}
              onExportProject={onExportProject}
              onAskAiAboutProject={onAskAiAboutProject}
            />
          ))}
        </div>
      ) : (
        /* ── Comparison Table View ────────────────────────────────────────── */
        <div className="rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] overflow-x-auto shadow-xs">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[10px] text-[var(--ud-text-muted)] uppercase tracking-wider">
                <th className="py-2.5 px-3 w-8 text-center">★</th>
                <th className="py-2.5 px-2 w-8 text-center">⇄</th>
                <th className="py-2.5 px-3 font-sans font-semibold">Project & Branch</th>
                <th className="py-2.5 px-3 text-center">Gate & Score</th>
                <th className="py-2.5 px-3 text-right">Unit Cov</th>
                <th className="py-2.5 px-3 text-right">API Cov</th>
                <th className="py-2.5 px-3 text-right">Flow Cov</th>
                <th className="py-2.5 px-3 text-center">Pass / Fail</th>
                <th className="py-2.5 px-3 text-right">Gaps</th>
                <th className="py-2.5 px-3 text-right">Last Sync</th>
                <th className="py-2.5 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ud-border)]">
              {filteredProjects.map((p) => {
                const isFav = favorites.includes(p.id) || p.isPinned;
                const isCompared = selectedForCompareIds.includes(p.id);

                const unitTests = (p.pillars?.unit?.totalTests ?? 0);
                const intTests = (p.pillars?.integration?.totalTests ?? 0);
                const sysTests = (p.pillars?.system?.totalTests ?? 0);
                const totalTests = unitTests + intTests + sysTests;

                const unitPass = (p.pillars?.unit?.passedTests ?? 0);
                const intPass = (p.pillars?.integration?.passedTests ?? 0);
                const sysPass = (p.pillars?.system?.passedTests ?? 0);
                const totalPass = unitPass + intPass + sysPass;
                const totalFail = totalTests - totalPass;

                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-[var(--ud-surface-2)]/60 transition-colors ${
                      highlightedProjectId === p.id ? "bg-[var(--color-primary)]/10" : ""
                    }`}
                  >
                    {/* Pin Star */}
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => onTogglePin?.(p.id)}
                        className={`cursor-pointer ${
                          isFav ? "text-amber-500" : "text-[var(--ud-text-muted)] hover:text-amber-500"
                        }`}
                      >
                        <Star size={13} fill={isFav ? "currentColor" : "none"} />
                      </button>
                    </td>

                    {/* Compare Checkbox */}
                    <td className="py-2 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={isCompared}
                        onChange={() => onToggleCompare?.(p.id)}
                        className="rounded border-[var(--ud-border)] text-[var(--color-primary)] cursor-pointer"
                        title="Select for side-by-side comparison"
                      />
                    </td>

                    {/* Project & Branch */}
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        onClick={() => onOpenOverview?.(p.id)}
                        className="font-sans font-bold text-xs text-[var(--ud-text)] hover:text-[var(--color-primary)] transition-colors text-left truncate max-w-[200px] block cursor-pointer"
                      >
                        {p.name}
                      </button>
                      <span className="text-[10px] text-[var(--ud-text-muted)] flex items-center gap-1 mt-0.5">
                        <GitBranch size={10} className="text-[var(--color-primary)]" />
                        {p.branch} • {p.snapshotId?.slice(0, 7)}
                      </span>
                    </td>

                    {/* Gate & Score */}
                    <td className="py-2 px-3 text-center">
                      <span
                        className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-bold ${
                          p.gateStatus === "PASSED"
                            ? "bg-[var(--ud-pass)]/15 text-[var(--ud-pass)]"
                            : p.gateStatus === "BLOCKED"
                            ? "bg-[var(--ud-fail)]/15 text-[var(--ud-fail)]"
                            : p.gateStatus === "UNTESTED"
                            ? "bg-[var(--ud-neutral)]/15 text-[var(--ud-neutral)]"
                            : "bg-[var(--ud-warn)]/15 text-[var(--ud-warn)]"
                        }`}
                      >
                        {p.gateLabel}
                      </span>
                      <div className="font-bold text-xs text-[var(--ud-text)] mt-0.5">
                        {p.healthScore}/100
                      </div>
                    </td>

                    {/* Unit Coverage */}
                    <td className="py-2 px-3 text-right font-medium text-[var(--ud-unit)]">
                      {p.pillars?.unit?.coveragePct ?? 0}%
                    </td>

                    {/* API Coverage */}
                    <td className="py-2 px-3 text-right font-medium text-[var(--ud-integration)]">
                      {p.pillars?.integration?.coveragePct ?? 0}%
                    </td>

                    {/* Flow Coverage */}
                    <td className="py-2 px-3 text-right font-medium text-[var(--ud-system)]">
                      {p.pillars?.system?.coveragePct ?? 0}%
                    </td>

                    {/* Total Pass / Fail */}
                    <td className="py-2 px-3 text-center">
                      <span className="text-[var(--ud-pass)] font-bold">{totalPass}P</span>
                      <span className="text-[var(--ud-text-muted)]"> / </span>
                      <span className={totalFail > 0 ? "text-[var(--ud-fail)] font-bold" : "text-[var(--ud-text-muted)]"}>
                        {totalFail}F
                      </span>
                    </td>

                    {/* Gaps */}
                    <td className="py-2 px-3 text-right text-[var(--ud-warn)] font-medium">
                      {p.aiMetrics?.uncoveredGaps ?? 0}
                    </td>

                    {/* Last Sync */}
                    <td className="py-2 px-3 text-right text-[11px] text-[var(--ud-text-muted)]">
                      {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : "Recent"}
                    </td>

                    {/* Quick Actions */}
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => onOpenOverview?.(p.id)}
                          className="px-2 py-0.5 rounded bg-[var(--color-primary)] text-white hover:opacity-90 font-sans font-medium cursor-pointer"
                        >
                          Overview
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigateWorkspace?.(p.id, "unit")}
                          className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] text-[var(--ud-unit)] border border-[var(--ud-border)] hover:bg-[var(--ud-unit)]/20 cursor-pointer"
                          title="Unit Tests"
                        >
                          U
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigateWorkspace?.(p.id, "integration")}
                          className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] text-[var(--ud-integration)] border border-[var(--ud-border)] hover:bg-[var(--ud-integration)]/20 cursor-pointer"
                          title="Integration Tests"
                        >
                          I
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigateWorkspace?.(p.id, "system")}
                          className="px-1.5 py-0.5 rounded bg-[var(--ud-surface-2)] text-[var(--ud-system)] border border-[var(--ud-border)] hover:bg-[var(--ud-system)]/20 cursor-pointer"
                          title="System E2E Tests"
                        >
                          S
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default ProjectDirectoryWorkspaceZone;
