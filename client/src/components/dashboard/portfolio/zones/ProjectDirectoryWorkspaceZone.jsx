import { useState, useMemo, useEffect, memo } from "react";
import {
  Search,
  X,
  SlidersHorizontal,
  Grid,
  List,
  Star,
  GitBranch,
  ExternalLink,
  FolderGit2,
  ArrowLeftRight,
  AlertTriangle,
} from "lucide-react";
import { ProjectQualityCard } from "../cards/ProjectQualityCard.jsx";
import LifecycleStatusSelect from "../primitives/LifecycleStatusSelect.jsx";
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
  onStatusChange,
  className = "",
}) {
  const [immediateSearch, setImmediateSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [lifecycleTab, setLifecycleTab] = useState("active"); // "active" | "DOING" | "NOT_STARTED" | "COMPLETED" | "PAUSED" | "CANCELLED" | "all"
  const [layerDeficit, setLayerDeficit] = useState("all");
  const [sortBy, setSortBy] = useState("health-desc");
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "table"

  // Debounce search input by 200ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(immediateSearch);
    }, 200);
    return () => clearTimeout(handler);
  }, [immediateSearch]);

  // Compute counts per lifecycle state
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

  // 1. Filter by Lifecycle Scope
  // Note: "active" tab shows working projects (both DOING and NOT_STARTED) so newly imported
  // projects are immediately visible in the directory, while KPIs strictly count only DOING projects.
  const lifecycleFilteredProjects = useMemo(() => {
    if (lifecycleTab === "active") {
      return projects.filter(
        (p) =>
          p.lifecycleStatus === "DOING" || p.lifecycleStatus === "NOT_STARTED" || !p.lifecycleStatus
      );
    }
    if (lifecycleTab === "all") return projects;
    return projects.filter((p) => (p.lifecycleStatus || "NOT_STARTED") === lifecycleTab);
  }, [projects, lifecycleTab]);

  // 2. Filter & Sort Projects based on search, gate status, deficit, sorting
  const filteredProjects = useMemo(() => {
    return filterAndSortPortfolioProjects(lifecycleFilteredProjects, {
      searchQuery: debouncedSearch,
      statusFilter,
      layerDeficit,
      sortBy,
      favorites,
    });
  }, [lifecycleFilteredProjects, debouncedSearch, statusFilter, layerDeficit, sortBy, favorites]);

  // Compute status pill counts within current lifecycle scope
  const statusCounts = useMemo(() => {
    const counts = {
      all: lifecycleFilteredProjects.length,
      pinned: 0,
      PASSED: 0,
      AT_RISK: 0,
      BLOCKED: 0,
      UNTESTED: 0,
    };
    for (const p of lifecycleFilteredProjects) {
      if (favorites.includes(p.id) || p.isPinned) counts.pinned++;
      const gate = (p.gateStatus || "").toUpperCase();
      if (counts[gate] !== undefined) counts[gate]++;
    }
    return counts;
  }, [lifecycleFilteredProjects, favorites]);

  const isIsolatedScope = ["COMPLETED", "PAUSED", "CANCELLED"].includes(lifecycleTab);

  return (
    <section
      id="project-directory-workspace-zone"
      aria-label="Project Directory Workspace"
      className={`space-y-4 ${className}`}
    >
      {/* ── Lifecycle Scope Tabs Navigation ─────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-[#30363d] text-xs font-mono">
        {[
          { id: "active", label: `Active Scope (${lifecycleCounts.active})` },
          { id: "DOING", label: `Doing (${lifecycleCounts.DOING})` },
          { id: "NOT_STARTED", label: `Not Started (${lifecycleCounts.NOT_STARTED})` },
          { id: "COMPLETED", label: `Completed / Delivered (${lifecycleCounts.COMPLETED})` },
          { id: "PAUSED", label: `Paused (${lifecycleCounts.PAUSED})` },
          { id: "CANCELLED", label: `Cancelled (${lifecycleCounts.CANCELLED})` },
          { id: "all", label: `All States (${lifecycleCounts.all})` },
        ].map((tab) => {
          const isActive = lifecycleTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setLifecycleTab(tab.id)}
              className={`px-3 py-1.5 rounded-t-md font-medium transition-colors shrink-0 cursor-pointer ${
                isActive
                  ? "bg-[#161b22] text-[#58a6ff] border-t-2 border-[#58a6ff] font-bold"
                  : "text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#161b22]/50"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Isolation Warning Banner if in Completed / Paused / Cancelled ── */}
      {isIsolatedScope && (
        <div className="p-3 rounded-md bg-[#bb8009]/10 border border-[#bb8009]/30 text-xs text-[#d29922] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#d29922] shrink-0" />
            <span>
              Projects in this view ({lifecycleTab}) are isolated from portfolio KPIs to preserve active engineering precision. You can still inspect their full Unified Overview and history.
            </span>
          </div>
        </div>
      )}

      {/* ── Multi-Dimensional Directory Toolbar ────────────────────────────── */}
      <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3 sm:p-4 shadow-sm space-y-3">
        {/* Top Toolbar Row: Search + Layer Deficit + Sort + View Toggle */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Instant Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b949e] pointer-events-none"
            />
            <input
              type="text"
              value={immediateSearch}
              onChange={(e) => setImmediateSearch(e.target.value)}
              placeholder="Search by project name, branch, snapshot ID, or tech stack..."
              className="w-full h-8 pl-9 pr-8 rounded-md bg-[#0d1117] border border-[#30363d] text-xs text-[#f0f6fc] placeholder:text-[#8b949e] outline-none focus:border-[#58a6ff] font-mono transition-colors"
            />
            {immediateSearch && (
              <button
                type="button"
                onClick={() => setImmediateSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8b949e] hover:text-[#f0f6fc] cursor-pointer"
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Controls: Layer Deficit Filter + Sort + Grid/Table Toggle */}
          <div className="flex flex-wrap items-center gap-2.5 justify-between lg:justify-end text-xs font-mono">
            {/* Layer Deficit Filter Dropdown */}
            <div className="flex items-center gap-1.5 text-[#8b949e]">
              <span className="hidden sm:inline">Deficit:</span>
              <select
                value={layerDeficit}
                onChange={(e) => setLayerDeficit(e.target.value)}
                className="bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-[#f0f6fc] outline-none cursor-pointer focus:border-[#58a6ff]"
              >
                {PORTFOLIO_CONFIG.layerDeficitOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort Selector */}
            <div className="flex items-center gap-1.5 text-[#8b949e]">
              <SlidersHorizontal size={13} className="shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-[#f0f6fc] outline-none cursor-pointer focus:border-[#58a6ff]"
              >
                {PORTFOLIO_CONFIG.sortOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Grid / Comparison Table View Toggle */}
            <div className="flex items-center p-0.5 rounded bg-[#0d1117] border border-[#30363d]">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded transition-colors cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-[#21262d] text-[#f0f6fc] shadow-sm"
                    : "text-[#8b949e] hover:text-[#f0f6fc]"
                }`}
                title="Grid Cards View"
                aria-label="Grid Cards View"
              >
                <Grid size={13} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded transition-colors cursor-pointer ${
                  viewMode === "table"
                    ? "bg-[#21262d] text-[#f0f6fc] shadow-sm"
                    : "text-[#8b949e] hover:text-[#f0f6fc]"
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
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#30363d] font-mono text-xs">
          {[
            { id: "all", label: `All (${statusCounts.all})` },
            { id: "pinned", label: `★ Pinned (${statusCounts.pinned})` },
            { id: "PASSED", label: `Passed (${statusCounts.PASSED})` },
            { id: "AT_RISK", label: `At Risk (${statusCounts.AT_RISK})` },
            { id: "BLOCKED", label: `Blocked (${statusCounts.BLOCKED})` },
            { id: "UNTESTED", label: `Untested (${statusCounts.UNTESTED})` },
          ].map((pill) => {
            const isActive = statusFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => onStatusFilterChange?.(pill.id)}
                className={`px-2.5 py-1 rounded text-[11px] transition-colors cursor-pointer ${
                  isActive
                    ? "bg-[#f0f6fc] text-[#0d1117] font-bold shadow-sm"
                    : "bg-[#0d1117] text-[#8b949e] hover:text-[#f0f6fc] border border-[#30363d]"
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
              className="px-2.5 py-1 rounded bg-[#388bfd]/10 border border-[#1f6feb]/30 text-[11px] text-[#58a6ff] font-semibold inline-flex items-center gap-1 cursor-pointer hover:bg-[#388bfd]/20 transition-colors"
              title="Clear focused project highlight"
            >
              <span>
                Focused: {projects.find((p) => p.id === highlightedProjectId)?.name || highlightedProjectId}
              </span>
              <X size={11} />
            </button>
          )}

          {selectedForCompareIds.length > 0 && (
            <span className="ml-auto text-[11px] text-[#58a6ff] font-semibold flex items-center gap-1">
              <ArrowLeftRight size={11} />
              {selectedForCompareIds.length} selected for comparison
            </span>
          )}
        </div>
      </div>

      {/* ── Content View ───────────────────────────────────────────────────── */}
      {filteredProjects.length === 0 ? (
        /* Empty State */
        <div className="py-16 border border-dashed border-[#30363d] rounded-lg text-center bg-[#161b22] flex flex-col items-center justify-center p-8">
          <div className="w-12 h-12 rounded bg-[#0d1117] border border-[#30363d] flex items-center justify-center text-[#8b949e] mb-3">
            <FolderGit2 size={24} />
          </div>
          <h3 className="text-sm font-semibold text-[#f0f6fc]">No matching projects found</h3>
          <p className="text-xs text-[#8b949e] mt-1 max-w-sm">
            {debouncedSearch
              ? `No projects match "${debouncedSearch}". Clear your search term or adjust status filters.`
              : "No projects in this category. Reset filters or import a new project."}
          </p>
          <div className="flex items-center gap-2 mt-4">
            {(debouncedSearch || statusFilter !== "all" || layerDeficit !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setImmediateSearch("");
                  setDebouncedSearch("");
                  onStatusFilterChange?.("all");
                  setLayerDeficit("all");
                }}
                className="px-3 py-1.5 rounded border border-[#30363d] text-xs font-mono font-medium hover:bg-[#21262d] cursor-pointer text-[#c9d1d9]"
              >
                Reset All Filters
              </button>
            )}
            <button
              type="button"
              onClick={() => onAddProject?.()}
              className="px-3 py-1.5 rounded bg-[#1f6feb] hover:bg-[#388bfd] border border-[#58a6ff]/40 text-white text-xs font-mono font-medium transition-colors cursor-pointer"
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
              isPinned={favorites.includes(p.id) || Boolean(p.isPinned)}
              isSelectedForCompare={selectedForCompareIds.includes(p.id)}
              isHighlighted={highlightedProjectId === p.id}
              onTogglePin={onTogglePin}
              onToggleCompare={onToggleCompare}
              onOpenOverview={onOpenOverview}
              onNavigateWorkspace={onNavigateWorkspace}
              onDeleteProject={onDeleteProject}
              onExportProject={onExportProject}
              onAskAiAboutProject={onAskAiAboutProject}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      ) : (
        /* ── Comparison Table View ────────────────────────────────────────── */
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] overflow-x-auto shadow-sm">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#30363d] bg-[#0d1117] text-[10px] text-[#8b949e] uppercase tracking-wider">
                <th className="py-2.5 px-3 w-8 text-center">★</th>
                <th className="py-2.5 px-2 w-8 text-center">⇄</th>
                <th className="py-2.5 px-3 font-sans font-semibold">Project & Branch</th>
                <th className="py-2.5 px-3 text-center">Lifecycle</th>
                <th className="py-2.5 px-3 text-center">Gate & Score</th>
                <th className="py-2.5 px-3 text-right">Unit Cov</th>
                <th className="py-2.5 px-3 text-right">API Cov</th>
                <th className="py-2.5 px-3 text-right">Flow Cov</th>
                <th className="py-2.5 px-3 text-center">Pass / Fail</th>
                <th className="py-2.5 px-3 text-right">Time Saved</th>
                <th className="py-2.5 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {filteredProjects.map((p) => {
                const isFav = favorites.includes(p.id) || p.isPinned;
                const isCompared = selectedForCompareIds.includes(p.id);

                const unitTests = p.pillars?.unit?.totalTests ?? 0;
                const intTests = p.pillars?.integration?.totalTests ?? 0;
                const sysTests = p.pillars?.system?.totalTests ?? 0;
                const totalTests = unitTests + intTests + sysTests;

                const unitPass = p.pillars?.unit?.passedTests ?? 0;
                const intPass = p.pillars?.integration?.passedTests ?? 0;
                const sysPass = p.pillars?.system?.passedTests ?? 0;
                const totalPass = unitPass + intPass + sysPass;
                const totalFail = totalTests - totalPass;

                const speedup = p.timeRoi?.speedupMultiplier || 0;
                const hours = p.timeRoi?.totalHoursSaved || 0;

                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-[#21262d]/60 transition-colors ${
                      highlightedProjectId === p.id ? "bg-[#388bfd]/10" : ""
                    }`}
                  >
                    {/* Pin Star */}
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => onTogglePin?.(p.id)}
                        className={`cursor-pointer ${
                          isFav ? "text-amber-400" : "text-[#8b949e] hover:text-amber-400"
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
                        className="rounded border-[#30363d] text-[#58a6ff] cursor-pointer"
                        title="Select for side-by-side comparison"
                      />
                    </td>

                    {/* Project & Branch */}
                    <td className="py-2 px-3 font-sans">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenOverview?.(p.id)}
                          className="font-bold text-[#f0f6fc] hover:text-[#58a6ff] transition-colors truncate text-left cursor-pointer"
                        >
                          {p.name}
                        </button>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-[#8b949e] font-mono mt-0.5">
                        <GitBranch size={10} className="text-[#58a6ff]" />
                        <span>{p.branch || "main"}</span>
                        {p.snapshotId && (
                          <span className="opacity-60">• {p.snapshotId.slice(0, 7)}</span>
                        )}
                      </div>
                    </td>

                    {/* Lifecycle Status Select */}
                    <td className="py-2 px-3 text-center">
                      <LifecycleStatusSelect
                        projectId={p.id}
                        currentStatus={p.lifecycleStatus || "NOT_STARTED"}
                        onStatusChange={onStatusChange}
                      />
                    </td>

                    {/* Gate & Score */}
                    <td className="py-2 px-3 text-center">
                      <span className="font-bold text-[#f0f6fc]">{p.healthScore}</span>
                      <span className="text-[10px] text-[#8b949e]">/100</span>
                      <span className="ml-1 text-[10px] font-bold text-[#58a6ff]">
                        ({p.grade || "—"})
                      </span>
                    </td>

                    {/* Unit Cov */}
                    <td className="py-2 px-3 text-right">
                      <span className="text-[#58a6ff]">
                        {p.pillars?.unit?.coveragePct ?? 0}%
                      </span>
                    </td>

                    {/* API Cov */}
                    <td className="py-2 px-3 text-right">
                      <span className="text-[#bc8cff]">
                        {p.pillars?.integration?.coveragePct ?? 0}%
                      </span>
                    </td>

                    {/* Flow Cov */}
                    <td className="py-2 px-3 text-right">
                      <span className="text-[#3fb950]">
                        {p.pillars?.system?.coveragePct ?? 0}%
                      </span>
                    </td>

                    {/* Pass / Fail */}
                    <td className="py-2 px-3 text-center">
                      {totalTests > 0 ? (
                        <span>
                          <span className="text-[#3fb950] font-bold">{totalPass}</span>
                          <span className="text-[#8b949e]"> / </span>
                          <span
                            className={totalFail > 0 ? "text-[#f85149] font-bold" : "text-[#8b949e]"}
                          >
                            {totalFail}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[#8b949e]">—</span>
                      )}
                    </td>

                    {/* Time Saved ROI */}
                    <td className="py-2 px-3 text-right">
                      {speedup > 1 ? (
                        <span className="text-[#58a6ff] font-bold">
                          {speedup}x (+{hours}h)
                        </span>
                      ) : (
                        <span className="text-[#8b949e]">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => onOpenOverview?.(p.id)}
                        className="p-1 rounded text-[#58a6ff] hover:bg-[#21262d] transition-colors cursor-pointer"
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

export default memo(ProjectDirectoryWorkspaceZone);
