import { useState, useMemo } from "react";
import {
  Search,
  X,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  FileCode,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Filter,
  CheckCircle2,
  List
} from "lucide-react";

const METHOD_STYLES = {
  GET: "bg-blue-500/10 text-blue-500 dark:text-blue-400 border-blue-500/20",
  POST: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  PUT: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  PATCH: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  DELETE: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
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
  activeScopeFilter = { type: "ALL", value: null },
  onSelectScopeFilter,
  isCollapsed = false,
  onToggleCollapse,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [facetMode, setFacetMode] = useState("MODULE"); // "MODULE" | "FILE"
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

  // Discovery Summary stats
  const totalCount = endpoints.length;

  // Filtered endpoints by search query
  const filteredEndpoints = useMemo(() => {
    if (!searchQuery.trim()) return endpoints;
    const query = searchQuery.trim().toLowerCase();
    return endpoints.filter((ep) => {
      const pathMatches = (ep.path || "").toLowerCase().includes(query);
      const methodMatches = (ep.method || "").toLowerCase().includes(query);
      const modMatches = getEndpointModule(ep.path).toLowerCase().includes(query);
      const fileMatches = (ep.source?.sourceFile || "").toLowerCase().includes(query);
      return pathMatches || methodMatches || modMatches || fileMatches;
    });
  }, [endpoints, searchQuery]);

  // Grouped by Module
  const groupedByModule = useMemo(() => {
    const map = new Map();
    filteredEndpoints.forEach((ep) => {
      const mod = getEndpointModule(ep.path);
      if (!map.has(mod)) map.set(mod, []);
      map.get(mod).push(ep);
    });

    const sorted = Array.from(map.keys()).sort((a, b) => {
      if (a === "ROOT" || a === "GENERAL") return 1;
      if (b === "ROOT" || b === "GENERAL") return -1;
      return a.localeCompare(b);
    });

    return sorted.map((name) => ({
      name,
      endpoints: sortEndpoints(map.get(name)),
      totalCount: map.get(name).length,
    }));
  }, [filteredEndpoints]);

  // Grouped by Source File
  const groupedByFile = useMemo(() => {
    const map = new Map();
    filteredEndpoints.forEach((ep) => {
      const fullPath = ep.source?.sourceFile || "unknown.js";
      const fileName = fullPath.split("/").pop() || fullPath;
      if (!map.has(fileName)) map.set(fileName, { fileName, fullPath, endpoints: [] });
      map.get(fileName).endpoints.push(ep);
    });

    const sorted = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    return sorted.map((name) => {
      const data = map.get(name);
      return {
        name: data.fileName,
        fullPath: data.fullPath,
        endpoints: sortEndpoints(data.endpoints),
        totalCount: data.endpoints.length,
      };
    });
  }, [filteredEndpoints]);

  const activeGroups = facetMode === "MODULE" ? groupedByModule : groupedByFile;

  const toggleGroupCollapse = (groupName) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  // If collapsed into slim rail
  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center justify-between h-full py-3 bg-[var(--color-surface)] border-r border-[var(--color-border)] select-none">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-2 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
          title="Expand API Explorer"
        >
          <PanelLeftOpen size={16} />
        </button>
        <div
          className="text-[11px] font-mono font-bold uppercase tracking-widest text-[var(--color-text-muted)] rotate-180"
          style={{ writingMode: "vertical-rl" }}
        >
          API Explorer ({totalCount})
        </div>
        <div className="text-[10px] font-mono text-[var(--color-text-muted)]">
          {totalCount}
        </div>
      </div>
    );
  }

  // Empty state when unanalyzed (clean muted note, zero duplicate buttons)
  if (!hasAnalysis) {
    return (
      <div className="p-6 text-center text-xs text-[var(--color-text-secondary)] font-sans flex flex-col items-center justify-center h-full">
        <p className="font-semibold text-[var(--color-text)] mb-1">
          No integration targets
        </p>
        <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
          Run project analysis from the main canvas to discover API endpoints.
        </p>
      </div>
    );
  }

  if (!endpoints || endpoints.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-[var(--color-text-secondary)] font-sans flex flex-col items-center justify-center h-full">
        <p className="font-semibold text-[var(--color-text)] mb-1">
          No endpoints found
        </p>
        <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
          Check that your project defines Express route controllers.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 font-sans text-[var(--color-text)] select-none overflow-hidden bg-[var(--color-surface)]">
      {/* 1. Header with Collapse Button */}
      <div className="px-3.5 py-3 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
            API Explorer
          </h3>
          <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
            {filteredEndpoints.length} of {totalCount} endpoints
          </span>
        </div>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
            title="Collapse explorer panel"
          >
            <PanelLeftClose size={15} />
          </button>
        )}
      </div>

      {/* 2. Facet Mode Switcher: Modules vs Source Files */}
      <div className="p-2 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => setFacetMode("MODULE")}
          className={`flex-1 py-1 text-center text-xs font-semibold rounded-[var(--radius-sm)] transition-colors cursor-pointer border ${
            facetMode === "MODULE"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] shadow-xs"
              : "text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text)]"
          }`}
        >
          By Module
        </button>
        <button
          type="button"
          onClick={() => setFacetMode("FILE")}
          className={`flex-1 py-1 text-center text-xs font-semibold rounded-[var(--radius-sm)] transition-colors cursor-pointer border ${
            facetMode === "FILE"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] shadow-xs"
              : "text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text)]"
          }`}
        >
          By File
        </button>
      </div>

      {/* 3. Search Filter */}
      <div className="p-2 border-b border-[var(--color-border)] shrink-0">
        <div className="relative flex items-center">
          <Search size={13} className="absolute left-2.5 text-[var(--color-text-muted)] pointer-events-none" />
          <input
            type="text"
            placeholder={facetMode === "MODULE" ? "Filter by route or module..." : "Filter by route or file..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-7 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] font-mono transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* 4. Explorer Tree Hierarchy */}
      <div className="flex-1 min-h-0 overflow-y-auto py-1 custom-scrollbar">
        {/* All APIs master filter item */}
        <div
          onClick={() => {
            if (onSelectScopeFilter) onSelectScopeFilter({ type: "ALL", value: null });
            if (onSelectEndpoint) onSelectEndpoint(null);
          }}
          className={`px-3 py-1.5 cursor-pointer transition-colors text-xs flex items-center justify-between mx-1 my-0.5 rounded-sm ${
            (!activeScopeFilter || activeScopeFilter.type === "ALL") && !selectedEndpointId
              ? "bg-[var(--color-primary-light)]/40 text-[var(--color-primary)] font-semibold border-l-2 border-[var(--color-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] border-l-2 border-transparent"
          }`}
        >
          <div className="flex items-center gap-2">
            <Layers size={13} className="text-[var(--color-text-muted)]" />
            <span className="font-semibold text-xs">All API Routes</span>
          </div>
          <span className="text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-secondary)] px-1.5 py-0.2 rounded">
            {totalCount}
          </span>
        </div>

        {/* Grouped Folders */}
        {activeGroups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.name);
          const isScopeActive =
            activeScopeFilter &&
            ((facetMode === "MODULE" && activeScopeFilter.type === "MODULE" && activeScopeFilter.value === group.name) ||
             (facetMode === "FILE" && activeScopeFilter.type === "FILE" && activeScopeFilter.value === group.name));

          const allGroupSelected = group.endpoints.every((ep) =>
            selectedTargetEndpoints.has(`${ep.method} ${ep.path}`)
          );

          return (
            <div key={group.name} className="my-0.5">
              {/* Folder Row */}
              <div
                onClick={() => {
                  if (onSelectScopeFilter) {
                    onSelectScopeFilter({
                      type: facetMode,
                      value: isScopeActive ? null : group.name,
                    });
                  }
                }}
                className={`group px-2 py-1.5 flex items-center justify-between cursor-pointer transition-colors mx-1 rounded-sm text-xs ${
                  isScopeActive
                    ? "bg-[var(--color-primary-light)]/30 text-[var(--color-primary)] font-semibold border-l-2 border-[var(--color-primary)]"
                    : "text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] border-l-2 border-transparent"
                }`}
                title={`Filter main table by ${facetMode === "MODULE" ? "module" : "file"}: ${group.name}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleGroupCollapse(group.name);
                    }}
                    className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {/* Batch Selection for this folder */}
                  {onToggleSelectModule && (
                    <input
                      type="checkbox"
                      checked={allGroupSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleSelectModule(group.endpoints);
                      }}
                      className="rounded cursor-pointer accent-[var(--color-primary)] shrink-0 w-3.5 h-3.5"
                      title={allGroupSelected ? "Deselect folder endpoints" : "Select all in folder"}
                    />
                  )}

                  {facetMode === "MODULE" ? (
                    isCollapsed ? (
                      <Folder size={13} className="text-amber-500/80 shrink-0" />
                    ) : (
                      <FolderOpen size={13} className="text-amber-500 shrink-0" />
                    )
                  ) : (
                    <FileCode size={13} className="text-[var(--color-primary)] shrink-0" />
                  )}

                  <span className="font-mono text-xs truncate font-medium">
                    {group.name}
                  </span>
                </div>

                <span className="text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-secondary)] px-1.5 py-0.2 rounded shrink-0">
                  {group.totalCount}
                </span>
              </div>

              {/* Children Endpoint Leaves */}
              {!isCollapsed && (
                <div className="ml-5 pl-2 border-l border-[var(--color-border)]/50 flex flex-col gap-0.5 my-0.5">
                  {group.endpoints.map((ep) => {
                    const id = `${ep.method} ${ep.path}`;
                    const isSelected = selectedEndpointId === id;
                    const isChecked = selectedTargetEndpoints.has(id);
                    const methodClass = METHOD_STYLES[ep.method] || METHOD_STYLES.DEFAULT;

                    return (
                      <div
                        key={id}
                        onClick={() => onSelectEndpoint(id)}
                        className={`group px-2 py-1 flex items-center justify-between text-xs cursor-pointer rounded-sm transition-colors ${
                          isSelected
                            ? "bg-[var(--color-primary-light)]/40 text-[var(--color-primary)] font-semibold border-l-2 border-[var(--color-primary)]"
                            : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] border-l-2 border-transparent"
                        }`}
                        title={ep.path}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {onToggleSelectEndpoint && (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                e.stopPropagation();
                                onToggleSelectEndpoint(id);
                              }}
                              className="rounded cursor-pointer accent-[var(--color-primary)] shrink-0 w-3 h-3"
                            />
                          )}
                          <span className={`px-1 py-0.2 rounded text-[9px] font-mono font-bold border tracking-tight shrink-0 ${methodClass}`}>
                            {ep.method}
                          </span>
                          <span className="font-mono text-[11px] truncate">
                            {ep.path}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 5. Footer Selection Status */}
      {selectedTargetEndpoints && selectedTargetEndpoints.size > 0 && (
        <div className="px-3 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 flex items-center justify-between text-xs font-mono shrink-0">
          <span className="text-[11px] font-semibold text-[var(--color-primary)]">
            {selectedTargetEndpoints.size} selected
          </span>
          {onClearSelectedEndpoints && (
            <button
              type="button"
              onClick={onClearSelectedEndpoints}
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
