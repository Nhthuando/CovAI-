import { useState, useMemo } from "react";
import {
  Search,
  X,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Filter,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Layers,
  List
} from "lucide-react";

const methodBadges = {
  GET: "bg-[var(--color-info)]/10 text-[var(--color-info)] border-[var(--color-info)]/20",
  POST: "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20",
  PUT: "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/20",
  PATCH: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  DELETE: "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/20",
  DEFAULT: "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

const METHOD_ORDER = {
  GET: 1,
  POST: 2,
  PUT: 3,
  PATCH: 4,
  DELETE: 5,
};

function getEndpointModule(path) {
  if (!path) return "GENERAL";
  const segments = path.split("/").filter(Boolean);
  let idx = 0;
  // Skip API version prefixes like v1, v2, api
  while (idx < segments.length && /^(api|v\d+)$/i.test(segments[idx])) {
    idx++;
  }
  if (idx < segments.length) {
    const rawSeg = segments[idx].replace(/^:/, "");
    return rawSeg.toUpperCase();
  }
  return "ROOT";
}

function sortEndpoints(list) {
  return [...list].sort((a, b) => {
    const pathA = a.path || "";
    const pathB = b.path || "";
    const pathCmp = pathA.localeCompare(pathB);
    if (pathCmp !== 0) return pathCmp;

    const mA = METHOD_ORDER[a.method] || 99;
    const mB = METHOD_ORDER[b.method] || 99;
    return mA - mB;
  });
}

export default function IntegrationTargetsPane({
  endpoints = [],
  selectedEndpointId,
  onSelectEndpoint,
  hasAnalysis,
  selectedTargetEndpoints = new Set(),
  onToggleSelectEndpoint,
  onToggleSelectModule,
  onSelectAllEndpoints,
  onClearSelectedEndpoints,
  onGenerateSelected,
  isGenerating = false,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMethod, setSelectedMethod] = useState("ALL");
  const [isGroupedView, setIsGroupedView] = useState(true);
  const [collapsedModules, setCollapsedModules] = useState(new Set());

  // Discovery Summary stats
  const totalCount = endpoints.length;
  const fullyResolvedCount = useMemo(
    () => endpoints.filter((ep) => ep.provenance?.resolutionStatus === "FULLY_RESOLVED").length,
    [endpoints]
  );
  const totalFiles = useMemo(
    () => new Set(endpoints.map((ep) => ep.source?.sourceFile).filter(Boolean)).size,
    [endpoints]
  );

  // Available methods in the dataset for quick filter buttons
  const availableMethods = useMemo(() => {
    const methods = new Set(endpoints.map((ep) => ep.method).filter(Boolean));
    return ["ALL", ...["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => methods.has(m))];
  }, [endpoints]);

  // Filtered & Sorted endpoints
  const filteredEndpoints = useMemo(() => {
    return endpoints.filter((ep) => {
      // 1. Method filter
      if (selectedMethod !== "ALL" && ep.method !== selectedMethod) {
        return false;
      }
      // 2. Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const pathMatches = (ep.path || "").toLowerCase().includes(query);
        const methodMatches = (ep.method || "").toLowerCase().includes(query);
        const moduleMatches = getEndpointModule(ep.path).toLowerCase().includes(query);
        if (!pathMatches && !methodMatches && moduleMatches === false) {
          return false;
        }
      }
      return true;
    });
  }, [endpoints, selectedMethod, searchQuery]);

  // Grouped by Module
  const groupedModules = useMemo(() => {
    if (!isGroupedView) return [];

    const map = new Map();
    filteredEndpoints.forEach((ep) => {
      const mod = getEndpointModule(ep.path);
      if (!map.has(mod)) {
        map.set(mod, []);
      }
      map.get(mod).push(ep);
    });

    // Sort module names alphabetically, keeping ROOT or GENERAL at the end
    const sortedModNames = Array.from(map.keys()).sort((a, b) => {
      if (a === "ROOT" || a === "GENERAL") return 1;
      if (b === "ROOT" || b === "GENERAL") return -1;
      return a.localeCompare(b);
    });

    return sortedModNames.map((modName) => {
      const items = sortEndpoints(map.get(modName));
      const testedCount = items.filter(
        (ep) => (ep.passedCount > 0 || ep.failedCount > 0)
      ).length;
      return {
        name: modName,
        endpoints: items,
        testedCount,
        totalCount: items.length,
      };
    });
  }, [filteredEndpoints, isGroupedView]);

  const toggleModuleCollapse = (modName) => {
    setCollapsedModules((prev) => {
      const next = new Set(prev);
      if (next.has(modName)) {
        next.delete(modName);
      } else {
        next.add(modName);
      }
      return next;
    });
  };

  const toggleAllCollapse = () => {
    if (collapsedModules.size > 0) {
      setCollapsedModules(new Set());
    } else {
      setCollapsedModules(new Set(groupedModules.map((g) => g.name)));
    }
  };

  if (!hasAnalysis) {
    return (
      <div className="p-6 text-center text-xs text-[var(--color-text-secondary)] font-sans">
        <p className="font-semibold text-[var(--color-text)] mb-1">
          No integration targets available.
        </p>
        <p>
          Run <strong>Analyze Project</strong> to discover API endpoints.
        </p>
      </div>
    );
  }

  if (!endpoints || endpoints.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-[var(--color-text-secondary)] font-sans">
        <p>Analysis complete, but no endpoints were found.</p>
      </div>
    );
  }

  const renderEndpointRow = (ep) => {
    const badgeClass = methodBadges[ep.method] || methodBadges.DEFAULT;
    const id = `${ep.method} ${ep.path}`;
    const isSelected = selectedEndpointId === id;
    const isChecked = selectedTargetEndpoints?.has(id);

    return (
      <div
        key={id}
        onClick={() => onSelectEndpoint(id)}
        className={`px-3 py-2 cursor-pointer transition-colors flex flex-col gap-1 rounded-sm mx-1 my-0.5 ${
          isSelected
            ? "bg-[var(--color-primary-light)]/40 text-[var(--color-text)] border-l-2 border-[var(--color-primary)] font-medium"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] border-l-2 border-transparent"
        }`}
      >
        <div className="flex items-center gap-2">
          {onToggleSelectEndpoint && (
            <input
              type="checkbox"
              checked={isChecked || false}
              onChange={(e) => {
                e.stopPropagation();
                onToggleSelectEndpoint(id);
              }}
              title={isChecked ? "Deselect endpoint" : "Select endpoint for test generation"}
              className="rounded cursor-pointer accent-[var(--color-primary)] shrink-0 w-3.5 h-3.5"
            />
          )}
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold min-w-[42px] text-center border font-mono tracking-tight shrink-0 ${badgeClass}`}
          >
            {ep.method}
          </span>
          <span
            className="font-mono text-xs truncate flex-1"
            title={ep.path}
          >
            {ep.path}
          </span>
        </div>

        <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] pl-[50px] font-mono">
          {ep.executedCount > 0 ? (
            <div className="flex items-center gap-2">
              <span
                className={
                  ep.passedCount > 0
                    ? "text-[var(--color-success)] font-medium"
                    : "text-[var(--color-text-muted)]"
                }
              >
                ✓ {ep.passedCount || 0}
              </span>
              {ep.failedCount > 0 && (
                <span className="text-[var(--color-danger)] font-medium">
                  ✕ {ep.failedCount}
                </span>
              )}
              {ep.skippedCount > 0 && (
                <span className="text-yellow-400 opacity-80">
                  ○ {ep.skippedCount}
                </span>
              )}
            </div>
          ) : (
            <span>{ep.generatedCount || 0} scenarios</span>
          )}

          {ep.status === "Covered" && (
            <span className="text-[var(--color-success)] text-[9px] uppercase tracking-wider font-semibold">
              Covered
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 font-sans text-[var(--color-text)] select-none overflow-hidden">
      {/* 1. Header & Discovery Summary */}
      <div className="px-3.5 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
            Discovery Evidence
          </h3>
          <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
            {filteredEndpoints.length}/{totalCount} APIs
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-[var(--color-text-secondary)]">
          <div className="bg-[var(--color-surface-secondary)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
            <span className="font-semibold text-[var(--color-text)]">{totalCount}</span> Endpoints
          </div>
          <div className="bg-[var(--color-surface-secondary)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
            <span className="font-semibold text-[var(--color-text)]">{fullyResolvedCount}</span> Resolved
          </div>
          <div className="bg-[var(--color-surface-secondary)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
            <span className="font-semibold text-[var(--color-text)]">{totalFiles}</span> Files
          </div>
        </div>
      </div>

      {/* 2. Search & Filter Bar */}
      <div className="p-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col gap-2 shrink-0">
        {/* Search input */}
        <div className="relative flex items-center">
          <Search
            size={13}
            className="absolute left-2.5 text-[var(--color-text-muted)] pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search API route, method..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-7 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Method filter pills + Grouping Mode toggle */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto pb-0.5">
          <div className="flex items-center gap-1">
            {availableMethods.map((m) => {
              const isActive = selectedMethod === m;
              return (
                <button
                  key={m}
                  onClick={() => setSelectedMethod(m)}
                  className={`px-1.5 py-0.5 text-[9px] font-bold rounded font-mono transition-colors border ${
                    isActive
                      ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                      : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setIsGroupedView(!isGroupedView)}
              title={isGroupedView ? "Switch to Flat List" : "Switch to Grouped Modules"}
              className={`p-1 rounded border text-[10px] transition-colors ${
                isGroupedView
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30"
                  : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
              }`}
            >
              {isGroupedView ? <Layers size={12} /> : <List size={12} />}
            </button>
          </div>
        </div>
      </div>

      {/* 3. Endpoint Targets List */}
      <div className="flex-1 min-h-0 overflow-y-auto py-1 custom-scrollbar">
        {/* Selection Banner if any APIs are selected */}
        {selectedTargetEndpoints && selectedTargetEndpoints.size > 0 && (
          <div className="mx-2 my-1 px-2.5 py-1.5 bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 rounded flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--color-primary)] font-mono text-[11px]">
              {selectedTargetEndpoints.size} {selectedTargetEndpoints.size === 1 ? "API" : "APIs"} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClearSelectedEndpoints}
                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline cursor-pointer"
              >
                Clear
              </button>
              {onGenerateSelected && (
                <button
                  type="button"
                  onClick={onGenerateSelected}
                  disabled={isGenerating}
                  className="px-2 py-0.5 bg-[var(--color-primary)] text-white text-[10px] font-bold rounded shadow-xs hover:bg-[var(--color-primary)]/90 cursor-pointer disabled:opacity-50"
                >
                  {isGenerating ? "Generating..." : "Generate"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* "View All Targets" Master Item */}
        <div
          onClick={() => onSelectEndpoint(null)}
          className={`px-3 py-2 cursor-pointer transition-colors text-xs flex items-center justify-between mx-1 my-0.5 rounded-sm ${
            selectedEndpointId === null
              ? "bg-[var(--color-primary-light)]/40 text-[var(--color-primary)] font-semibold border-l-2 border-[var(--color-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] border-l-2 border-transparent"
          }`}
        >
          <div className="flex items-center gap-2">
            {onSelectAllEndpoints && endpoints.length > 0 && (
              <input
                type="checkbox"
                checked={selectedTargetEndpoints?.size === endpoints.length}
                onChange={(e) => {
                  e.stopPropagation();
                  if (selectedTargetEndpoints?.size === endpoints.length) {
                    onClearSelectedEndpoints?.();
                  } else {
                    onSelectAllEndpoints?.(endpoints);
                  }
                }}
                title={selectedTargetEndpoints?.size === endpoints.length ? "Deselect All" : "Select All for generation"}
                className="rounded cursor-pointer accent-[var(--color-primary)] shrink-0 w-3.5 h-3.5"
              />
            )}
            <span>View All Targets</span>
          </div>
          <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
            {totalCount}
          </span>
        </div>

        {filteredEndpoints.length === 0 ? (
          <div className="p-6 text-center text-xs text-[var(--color-text-secondary)]">
            <p>No endpoints match your filter.</p>
            {(searchQuery || selectedMethod !== "ALL") && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedMethod("ALL");
                }}
                className="mt-2 text-[11px] text-[var(--color-primary)] hover:underline"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : isGroupedView ? (
          /* GROUPED ACCORDION VIEW */
          <div className="flex flex-col gap-1 mt-1">
            {groupedModules.map((group) => {
              const isCollapsed = collapsedModules.has(group.name);
              const isGroupActive = group.endpoints.some(
                (ep) => `${ep.method} ${ep.path}` === selectedEndpointId
              );
              const isModuleFullySelected = group.endpoints.length > 0 && group.endpoints.every(ep => selectedTargetEndpoints?.has(`${ep.method} ${ep.path}`));

              return (
                <div key={group.name} className="flex flex-col">
                  {/* Module Header */}
                  <div
                    onClick={() => toggleModuleCollapse(group.name)}
                    className={`px-2.5 py-1.5 mx-1 flex items-center justify-between cursor-pointer rounded text-[11px] font-semibold transition-colors ${
                      isGroupActive
                        ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)]"
                        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]/60 hover:text-[var(--color-text)]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      {isCollapsed ? (
                        <ChevronRight size={13} className="text-[var(--color-text-muted)] shrink-0" />
                      ) : (
                        <ChevronDown size={13} className="text-[var(--color-text-muted)] shrink-0" />
                      )}
                      {onToggleSelectModule && (
                        <input
                          type="checkbox"
                          checked={isModuleFullySelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            onToggleSelectModule(group.endpoints);
                          }}
                          title={`Select/Deselect all ${group.name} endpoints`}
                          className="rounded cursor-pointer accent-[var(--color-primary)] shrink-0 w-3.5 h-3.5"
                        />
                      )}
                      {isCollapsed ? (
                        <Folder size={13} className="text-amber-400/80 shrink-0" />
                      ) : (
                        <FolderOpen size={13} className="text-amber-400 shrink-0" />
                      )}
                      <span className="font-mono uppercase tracking-wider text-[11px] truncate">
                        {group.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono">
                      {group.testedCount > 0 ? (
                        <span className="text-[var(--color-success)] bg-[var(--color-success)]/10 px-1 py-0.2 rounded border border-[var(--color-success)]/20">
                          {group.testedCount}/{group.totalCount}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-muted)] bg-[var(--color-surface-secondary)] px-1 py-0.2 rounded border border-[var(--color-border)]">
                          {group.totalCount}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Module Endpoints */}
                  {!isCollapsed && (
                    <div className="pl-1 flex flex-col">
                      {group.endpoints.map(renderEndpointRow)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* FLAT SORTED LIST VIEW */
          <div className="flex flex-col mt-1">
            {sortEndpoints(filteredEndpoints).map(renderEndpointRow)}
          </div>
        )}
      </div>
    </div>
  );
}
