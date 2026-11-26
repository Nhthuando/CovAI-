import { useState, useMemo, memo } from "react";
import {
  Search,
  X,
  Grid,
  List,
  Star,
  GitBranch,
  ExternalLink,
  FolderGit2,
} from "lucide-react";
import { ProjectQualityCard } from "../cards/ProjectQualityCard.jsx";
import LifecycleStatusSelect from "../primitives/LifecycleStatusSelect.jsx";
import {
  computePortfolioLifecycleCounts,
  filterAndSortPortfolioProjects,
  filterProjectsByLifecycle,
} from "../../../../services/portfolioDashboard/portfolioDashboard.selectors.js";
import { PORTFOLIO_CONFIG } from "../../../../services/portfolioDashboard/portfolioDashboard.config.js";

function ProjectDirectoryWorkspaceZoneComponent({
  projects = [],
  allProjects = null,
  allLifecycleCounts = null,
  lifecycleFilteredCount = null,
  pinnedCount: controlledPinnedCount = null,
  favorites = [],
  highlightedProjectId = null,
  onClearHighlight,
  searchQuery: controlledSearchQuery,
  onSearchQueryChange,
  lifecycleTab: controlledLifecycleTab,
  onLifecycleTabChange,
  statusFilter = "all",
  onStatusFilterChange,
  layerDeficit: controlledLayerDeficit,
  onLayerDeficitChange,
  sortBy: controlledSortBy,
  onSortByChange,
  isFiltered: controlledIsFiltered,
  onResetFilters,
  onTogglePin,
  onOpenOverview,
  onNavigateWorkspace,
  onDeleteProject,
  onAskAiAboutProject,
  onLifecycleStatusChange = null,
  onLifecycleStatusCommitted = null,
  onAddProject,
  className = "",
}) {
  const isControlled =
    typeof onSearchQueryChange === "function" &&
    typeof onLifecycleTabChange === "function";

  const [localSearch, setLocalSearch] = useState("");
  const [localLifecycleTab, setLocalLifecycleTab] = useState("active");
  const [localLayerDeficit, setLocalLayerDeficit] = useState("all");
  const [localSortBy, setLocalSortBy] = useState("health-desc");
  const [viewMode, setViewMode] = useState("grid");

  const searchQuery =
    controlledSearchQuery !== undefined ? controlledSearchQuery : localSearch;
  const lifecycleTab =
    controlledLifecycleTab !== undefined
      ? controlledLifecycleTab
      : localLifecycleTab;
  const layerDeficit =
    controlledLayerDeficit !== undefined
      ? controlledLayerDeficit
      : localLayerDeficit;
  const sortBy =
    controlledSortBy !== undefined ? controlledSortBy : localSortBy;

  const handleSearchChange = (val) => {
    if (onSearchQueryChange) onSearchQueryChange(val);
    else setLocalSearch(val);
  };

  const handleLifecycleChange = (val) => {
    if (onLifecycleTabChange) onLifecycleTabChange(val);
    else setLocalLifecycleTab(val);
  };

  const handleLayerDeficitChange = (val) => {
    if (onLayerDeficitChange) onLayerDeficitChange(val);
    else setLocalLayerDeficit(val);
  };

  const handleSortByChange = (val) => {
    if (onSortByChange) onSortByChange(val);
    else setLocalSortBy(val);
  };

  const countsSourceProjects = allProjects || projects;
  const lifecycleCounts = useMemo(() => {
    if (allLifecycleCounts) return allLifecycleCounts;
    return computePortfolioLifecycleCounts(countsSourceProjects);
  }, [allLifecycleCounts, countsSourceProjects]);

  const fallbackLifecycleFiltered = useMemo(() => {
    if (isControlled) return projects;
    return filterProjectsByLifecycle(projects, lifecycleTab);
  }, [isControlled, projects, lifecycleTab]);

  const filteredProjects = useMemo(() => {
    if (isControlled) return projects;
    return filterAndSortPortfolioProjects(fallbackLifecycleFiltered, {
      searchQuery,
      statusFilter,
      layerDeficit,
      sortBy,
      favorites,
    });
  }, [
    isControlled,
    projects,
    fallbackLifecycleFiltered,
    searchQuery,
    statusFilter,
    layerDeficit,
    sortBy,
    favorites,
  ]);

  const totalInScopeCount =
    lifecycleFilteredCount ?? fallbackLifecycleFiltered.length;

  const pinnedCount = useMemo(() => {
    if (controlledPinnedCount !== null && controlledPinnedCount !== undefined) {
      return controlledPinnedCount;
    }
    return fallbackLifecycleFiltered.filter(
      (p) => favorites.includes(p.id) || p.isPinned
    ).length;
  }, [controlledPinnedCount, fallbackLifecycleFiltered, favorites]);

  const isFiltered =
    controlledIsFiltered !== undefined
      ? controlledIsFiltered
      : Boolean(
          searchQuery.trim() ||
            statusFilter !== "all" ||
            layerDeficit !== "all" ||
            lifecycleTab !== "active"
        );

  const handleReset = () => {
    if (onResetFilters) {
      onResetFilters();
    } else {
      handleSearchChange("");
      handleLifecycleChange("active");
      onStatusFilterChange?.("all");
      handleLayerDeficitChange("all");
    }
  };

  return (
    <section
      id="project-directory-workspace-zone"
      data-guide="portfolio-directory"
      aria-label="Projects Directory"
      className={`space-y-3.5 ${className}`}
    >
      {/* ── Clean Section Header + Dropbox Toolbar ─────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="ps-display text-base font-bold text-[var(--ps-ink)]">
            Projects
          </h2>
          <span className="text-xs ps-mono text-[var(--ps-ink-muted)] tabular-nums">
            {filteredProjects.length} shown
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[180px] sm:w-56">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ps-ink-muted)] pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search projects..."
              className="w-full h-8 pl-8 pr-7 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-line)] text-xs text-[var(--ps-ink)] placeholder:text-[var(--ps-ink-muted)] outline-none focus:border-[var(--ps-cobalt)] ps-mono transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] cursor-pointer"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Scope Dropbox */}
          <select
            aria-label="Filter by lifecycle state"
            value={lifecycleTab}
            onChange={(e) => handleLifecycleChange(e.target.value)}
            className="ps-select"
          >
            <option value="active">Active ({lifecycleCounts.active})</option>
            <option value="DOING">Doing ({lifecycleCounts.DOING})</option>
            <option value="NOT_STARTED">
              Not Started ({lifecycleCounts.NOT_STARTED})
            </option>
            <option value="COMPLETED">
              Completed ({lifecycleCounts.COMPLETED})
            </option>
            <option value="PAUSED">Paused ({lifecycleCounts.PAUSED})</option>
            <option value="CANCELLED">
              Cancelled ({lifecycleCounts.CANCELLED})
            </option>
            <option value="all">All States ({lifecycleCounts.all})</option>
          </select>

          {/* Pinned Filter Dropbox */}
          <select
            aria-label="Filter pinned projects"
            value={statusFilter === "pinned" ? "pinned" : "all"}
            onChange={(e) => onStatusFilterChange?.(e.target.value)}
            className="ps-select"
          >
            <option value="all">All ({totalInScopeCount})</option>
            <option value="pinned">★ Pinned ({pinnedCount})</option>
          </select>

          {/* Layer Deficit Dropbox */}
          <select
            aria-label="Filter by coverage layer deficit"
            value={layerDeficit}
            onChange={(e) => handleLayerDeficitChange(e.target.value)}
            className="ps-select"
          >
            {PORTFOLIO_CONFIG.layerDeficitOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Sort Dropbox */}
          <select
            aria-label="Sort projects"
            value={sortBy}
            onChange={(e) => handleSortByChange(e.target.value)}
            className="ps-select"
          >
            {PORTFOLIO_CONFIG.sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {highlightedProjectId && (
            <button
              type="button"
              onClick={() => onClearHighlight?.()}
              className="h-8 px-2.5 rounded-lg bg-[var(--ps-cobalt)]/12 border border-[var(--ps-cobalt)]/35 text-[11px] text-[var(--ps-cobalt)] ps-mono font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <span>
                {filteredProjects.find((p) => p.id === highlightedProjectId)
                  ?.name || "Focused"}
              </span>
              <X size={11} />
            </button>
          )}

          {/* View Mode Toggle */}
          <div className="flex items-center p-0.5 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-line)] h-8">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === "grid"
                  ? "bg-[var(--ps-surface-2)] text-[var(--ps-ink)]"
                  : "text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)]"
              }`}
              title="Grid View"
              aria-label="Grid View"
            >
              <Grid size={13} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === "table"
                  ? "bg-[var(--ps-surface-2)] text-[var(--ps-ink)]"
                  : "text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)]"
              }`}
              title="Table View"
              aria-label="Table View"
            >
              <List size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Directory Content ────────────────────────────────────────── */}
      {filteredProjects.length === 0 ? (
        <div className="py-12 border border-dashed border-[var(--ps-line-strong)] rounded-xl text-center bg-[var(--ps-surface)] flex flex-col items-center justify-center p-6">
          <div className="w-10 h-10 rounded-lg bg-[var(--ps-surface-2)] border border-[var(--ps-line)] flex items-center justify-center text-[var(--ps-ink-muted)] mb-3">
            <FolderGit2 size={19} />
          </div>
          <h3 className="text-sm font-semibold text-[var(--ps-ink)]">
            No projects found
          </h3>
          <div className="flex items-center gap-2 mt-4">
            {isFiltered && (
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-1.5 rounded-lg border border-[var(--ps-line)] text-xs ps-mono hover:bg-[var(--ps-surface-2)] cursor-pointer text-[var(--ps-ink)]"
              >
                Reset filters
              </button>
            )}
            <button
              type="button"
              onClick={() => onAddProject?.()}
              className="ps-btn-contrast px-3.5 py-1.5 text-xs cursor-pointer"
            >
              Import project
            </button>
          </div>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProjects.map((p) => (
            <ProjectQualityCard
              key={p.id}
              project={p}
              isPinned={favorites.includes(p.id) || Boolean(p.isPinned)}
              isHighlighted={highlightedProjectId === p.id}
              onTogglePin={onTogglePin}
              onOpenOverview={onOpenOverview}
              onNavigateWorkspace={onNavigateWorkspace}
              onDeleteProject={onDeleteProject}
              onAskAiAboutProject={onAskAiAboutProject}
              onLifecycleStatusChange={onLifecycleStatusChange}
              onLifecycleStatusCommitted={onLifecycleStatusCommitted}
            />
          ))}
        </div>
      ) : (
        <div className="ps-panel overflow-x-auto">
          <table className="w-full text-left ps-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--ps-line)] bg-[var(--ps-surface-2)]/60 text-[10px] text-[var(--ps-ink-muted)] uppercase tracking-wider">
                <th className="py-2.5 px-3 w-8 text-center">★</th>
                <th className="py-2.5 px-3 font-sans font-semibold">Project</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-center">Health</th>
                <th className="py-2.5 px-3 text-right">Unit</th>
                <th className="py-2.5 px-3 text-right">API</th>
                <th className="py-2.5 px-3 text-right">E2E</th>
                <th className="py-2.5 px-3 text-center">Pass / Fail</th>
                <th className="py-2.5 px-3 text-right">Saved</th>
                <th className="py-2.5 px-3 text-center">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-line)]">
              {filteredProjects.map((p) => {
                const isFav = favorites.includes(p.id) || p.isPinned;
                const unitTests = p.pillars?.unit?.totalTests ?? 0;
                const intTests = p.pillars?.integration?.totalTests ?? 0;
                const sysTests = p.pillars?.system?.totalTests ?? 0;
                const totalTests = unitTests + intTests + sysTests;

                const unitPass = p.pillars?.unit?.passedTests ?? 0;
                const intPass = p.pillars?.integration?.passedTests ?? 0;
                const sysPass = p.pillars?.system?.passedTests ?? 0;
                const totalPass = unitPass + intPass + sysPass;
                const totalFail = totalTests - totalPass;

                const hours = p.timeRoi?.totalHoursSaved || 0;

                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-[var(--ps-surface-2)]/50 transition-colors ${
                      highlightedProjectId === p.id
                        ? "bg-[var(--ps-cobalt)]/10"
                        : ""
                    }`}
                  >
                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => onTogglePin?.(p.id)}
                        className={`cursor-pointer ${
                          isFav
                            ? "text-[var(--ps-amber)]"
                            : "text-[var(--ps-ink-muted)] hover:text-[var(--ps-amber)]"
                        }`}
                      >
                        <Star size={13} fill={isFav ? "currentColor" : "none"} />
                      </button>
                    </td>

                    <td className="py-2.5 px-3 font-sans">
                      <button
                        type="button"
                        onClick={() => onOpenOverview?.(p.id, p)}
                        className="font-semibold text-[var(--ps-ink)] hover:text-[var(--ps-cobalt)] transition-colors truncate text-left cursor-pointer"
                      >
                        {p.name}
                      </button>
                      <div className="flex items-center gap-1 text-[10px] text-[var(--ps-ink-muted)] ps-mono mt-0.5">
                        <GitBranch size={10} className="text-[var(--ps-cobalt)]" />
                        <span>{p.branch || "main"}</span>
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-center font-sans">
                      <LifecycleStatusSelect
                        projectId={p.id}
                        currentStatus={p.lifecycleStatus || "NOT_STARTED"}
                        onStatusChange={(newStatus) =>
                          onLifecycleStatusChange?.(p.id, newStatus)
                        }
                        onStatusCommitted={(newStatus) =>
                          onLifecycleStatusCommitted?.(p.id, newStatus)
                        }
                      />
                    </td>

                    <td className="py-2.5 px-3 text-center">
                      <span className="font-bold text-[var(--ps-ink)]">
                        {p.healthScore}
                      </span>
                      <span className="text-[10px] text-[var(--ps-ink-muted)]">
                        /100
                      </span>
                    </td>

                    <td className="py-2.5 px-3 text-right text-[var(--ps-cobalt)]">
                      {p.pillars?.unit?.coveragePct ?? 0}%
                    </td>
                    <td className="py-2.5 px-3 text-right text-[var(--ps-indigo)]">
                      {p.pillars?.integration?.coveragePct ?? 0}%
                    </td>
                    <td className="py-2.5 px-3 text-right text-[var(--ps-teal)]">
                      {p.pillars?.system?.coveragePct ?? 0}%
                    </td>

                    <td className="py-2.5 px-3 text-center">
                      {totalTests > 0 ? (
                        <span>
                          <span className="text-[var(--ps-emerald)] font-bold">
                            {totalPass}
                          </span>
                          <span className="text-[var(--ps-ink-muted)]"> / </span>
                          <span
                            className={
                              totalFail > 0
                                ? "text-[var(--ps-rose)] font-bold"
                                : "text-[var(--ps-ink-muted)]"
                            }
                          >
                            {totalFail}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[var(--ps-ink-muted)]">—</span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right text-[var(--ps-emerald)]">
                      {hours > 0 ? `+${hours}h` : "—"}
                    </td>

                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => onOpenOverview?.(p.id, p)}
                        className="p-1 rounded text-[var(--ps-cobalt)] hover:bg-[var(--ps-surface-2)] transition-colors cursor-pointer"
                        title="Open Overview"
                      >
                        <ExternalLink size={13} />
                      </button>
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

export const ProjectDirectoryWorkspaceZone = memo(
  ProjectDirectoryWorkspaceZoneComponent
);
export default ProjectDirectoryWorkspaceZone;
