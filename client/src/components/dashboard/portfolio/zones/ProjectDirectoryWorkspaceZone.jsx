import { useState, useMemo, useEffect, memo } from "react";
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
import { filterAndSortPortfolioProjects } from "../../../../services/portfolioDashboard/portfolioDashboard.selectors.js";
import { PORTFOLIO_CONFIG } from "../../../../services/portfolioDashboard/portfolioDashboard.config.js";

const LIFECYCLE_LABELS = {
  DOING: { label: "Doing", dot: "bg-[var(--ps-cobalt)]" },
  NOT_STARTED: { label: "Not Started", dot: "bg-[var(--ps-neutral)]" },
  COMPLETED: { label: "Completed", dot: "bg-[var(--ps-emerald)]" },
  PAUSED: { label: "Paused", dot: "bg-[var(--ps-amber)]" },
  CANCELLED: { label: "Cancelled", dot: "bg-[var(--ps-rose)]" },
};

function ProjectDirectoryWorkspaceZoneComponent({
  projects = [],
  favorites = [],
  highlightedProjectId = null,
  onClearHighlight,
  statusFilter = "all",
  onStatusFilterChange,
  onTogglePin,
  onOpenOverview,
  onNavigateWorkspace,
  onDeleteProject,
  onAskAiAboutProject,
  onAddProject,
  className = "",
}) {
  const [immediateSearch, setImmediateSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [lifecycleTab, setLifecycleTab] = useState("active");
  const [layerDeficit, setLayerDeficit] = useState("all");
  const [sortBy, setSortBy] = useState("health-desc");
  const [viewMode, setViewMode] = useState("grid");

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(immediateSearch);
    }, 200);
    return () => clearTimeout(handler);
  }, [immediateSearch]);

  const lifecycleCounts = useMemo(() => {
    const counts = {
      active: 0,
      DOING: 0,
      NOT_STARTED: 0,
      COMPLETED: 0,
      PAUSED: 0,
      CANCELLED: 0,
      all: projects.length,
    };
    for (const p of projects) {
      const status = p.lifecycleStatus || "NOT_STARTED";
      if (counts[status] !== undefined) counts[status]++;
      if (status === "DOING" || status === "NOT_STARTED") counts.active++;
    }
    return counts;
  }, [projects]);

  const lifecycleFilteredProjects = useMemo(() => {
    if (lifecycleTab === "active") {
      return projects.filter(
        (p) =>
          p.lifecycleStatus === "DOING" ||
          p.lifecycleStatus === "NOT_STARTED" ||
          !p.lifecycleStatus
      );
    }
    if (lifecycleTab === "all") return projects;
    return projects.filter(
      (p) => (p.lifecycleStatus || "NOT_STARTED") === lifecycleTab
    );
  }, [projects, lifecycleTab]);

  const filteredProjects = useMemo(() => {
    return filterAndSortPortfolioProjects(lifecycleFilteredProjects, {
      searchQuery: debouncedSearch,
      statusFilter,
      layerDeficit,
      sortBy,
      favorites,
    });
  }, [
    lifecycleFilteredProjects,
    debouncedSearch,
    statusFilter,
    layerDeficit,
    sortBy,
    favorites,
  ]);

  const pinnedCount = useMemo(() => {
    return lifecycleFilteredProjects.filter(
      (p) => favorites.includes(p.id) || p.isPinned
    ).length;
  }, [lifecycleFilteredProjects, favorites]);

  return (
    <section
      id="project-directory-workspace-zone"
      aria-label="Projects Directory"
      className={`space-y-3.5 ${className}`}
    >
      {/* ── Clean Section Header + Dropbox Toolbar ─────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="ps-display text-base font-bold text-[var(--ps-ink)]">
            Projects
          </h2>
          <span className="text-xs ps-mono text-[var(--ps-ink-muted)]">
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
              value={immediateSearch}
              onChange={(e) => setImmediateSearch(e.target.value)}
              placeholder="Search projects..."
              className="w-full h-8 pl-8 pr-7 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-line)] text-xs text-[var(--ps-ink)] placeholder:text-[var(--ps-ink-muted)] outline-none focus:border-[var(--ps-cobalt)] ps-mono transition-colors"
            />
            {immediateSearch && (
              <button
                type="button"
                onClick={() => setImmediateSearch("")}
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
            onChange={(e) => setLifecycleTab(e.target.value)}
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
            <option value="all">All ({lifecycleFilteredProjects.length})</option>
            <option value="pinned">★ Pinned ({pinnedCount})</option>
          </select>

          {/* Layer Deficit Dropbox */}
          <select
            aria-label="Filter by coverage layer deficit"
            value={layerDeficit}
            onChange={(e) => setLayerDeficit(e.target.value)}
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
            onChange={(e) => setSortBy(e.target.value)}
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
                {projects.find((p) => p.id === highlightedProjectId)?.name ||
                  "Focused"}
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
            {(debouncedSearch ||
              statusFilter !== "all" ||
              layerDeficit !== "all" ||
              lifecycleTab !== "active") && (
              <button
                type="button"
                onClick={() => {
                  setImmediateSearch("");
                  setDebouncedSearch("");
                  setLifecycleTab("active");
                  onStatusFilterChange?.("all");
                  setLayerDeficit("all");
                }}
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
                const lifecycleMeta =
                  LIFECYCLE_LABELS[p.lifecycleStatus || "NOT_STARTED"] ||
                  LIFECYCLE_LABELS.NOT_STARTED;
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
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border border-[var(--ps-line)] bg-[var(--ps-inset)] text-[var(--ps-ink-secondary)]">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${lifecycleMeta.dot}`}
                        />
                        <span>{lifecycleMeta.label}</span>
                      </span>
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
