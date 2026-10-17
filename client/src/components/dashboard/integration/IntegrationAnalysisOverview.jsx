import React, { useMemo, useState } from "react";
import {
  Search,
  Filter,
  CheckCircle2,
  FileCode,
  Layers,
  ArrowRight,
  Zap,
  Check,
  X,
  RefreshCw,
  Code2
} from "lucide-react";

const METHOD_STYLES = {
  GET: "bg-blue-500/10 text-blue-500 dark:text-blue-400 border-blue-500/20",
  POST: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  PUT: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  PATCH: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  DELETE: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  DEFAULT: "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
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

export default function IntegrationAnalysisOverview({
  endpoints = [],
  snapshotId,
  selectedEndpointId,
  onSelectEndpoint,
  onGenerateSelected,
  onRunAnalysis,
  isAnalyzing = false,
  selectedTargetEndpoints = new Set(),
  onToggleSelectEndpoint,
  activeScopeFilter = { type: "ALL", value: null },
  onClearScopeFilter,
}) {
  const [filterMethod, setFilterMethod] = useState("ALL");
  const [search, setSearch] = useState("");

  const totalEndpoints = endpoints.length;
  const fullyResolved = useMemo(
    () => endpoints.filter((e) => e.provenance?.resolutionStatus === "FULLY_RESOLVED").length,
    [endpoints]
  );
  const totalFiles = useMemo(
    () => new Set(endpoints.map((e) => e.source?.sourceFile).filter(Boolean)).size,
    [endpoints]
  );

  const methodCounts = useMemo(() => {
    const counts = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 };
    endpoints.forEach((e) => {
      if (counts[e.method] !== undefined) counts[e.method]++;
    });
    return counts;
  }, [endpoints]);

  // Scope + Method + Text filtering
  const filtered = useMemo(() => {
    return endpoints.filter((e) => {
      // 1. Scope filter from left explorer
      if (activeScopeFilter && activeScopeFilter.type === "MODULE" && activeScopeFilter.value) {
        const mod = getEndpointModule(e.path);
        if (mod !== activeScopeFilter.value) return false;
      } else if (activeScopeFilter && activeScopeFilter.type === "FILE" && activeScopeFilter.value) {
        const sf = e.source?.sourceFile || "";
        if (!sf.includes(activeScopeFilter.value)) return false;
      }

      // 2. HTTP Method filter
      if (filterMethod !== "ALL" && e.method !== filterMethod) return false;

      // 3. Search text filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const pMatch = (e.path || "").toLowerCase().includes(q);
        const mMatch = (e.source?.controllerMethod || "").toLowerCase().includes(q);
        const fMatch = (e.source?.sourceFile || "").toLowerCase().includes(q);
        if (!pMatch && !mMatch && !fMatch) return false;
      }
      return true;
    });
  }, [endpoints, activeScopeFilter, filterMethod, search]);

  const allFilteredSelected = useMemo(() => {
    if (filtered.length === 0) return false;
    return filtered.every((e) => selectedTargetEndpoints.has(`${e.method} ${e.path}`));
  }, [filtered, selectedTargetEndpoints]);

  const handleToggleSelectAllFiltered = () => {
    if (!onToggleSelectEndpoint) return;
    if (allFilteredSelected) {
      filtered.forEach((e) => {
        const id = `${e.method} ${e.path}`;
        if (selectedTargetEndpoints.has(id)) {
          onToggleSelectEndpoint(id);
        }
      });
    } else {
      filtered.forEach((e) => {
        const id = `${e.method} ${e.path}`;
        if (!selectedTargetEndpoints.has(id)) {
          onToggleSelectEndpoint(id);
        }
      });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 sm:p-5 font-sans text-[var(--color-text)] custom-scrollbar">
      {/* 1. Flat Header & Streamlined Metadata Strip (Accurate capability wording, non-redundant metrics) */}
      <div className="flex flex-col gap-2.5 mb-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-bold tracking-tight text-[var(--color-text)] m-0">
                API Endpoint Inventory
              </h2>
              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-success)] font-medium font-sans">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
                AST Parsed — Ready for Test Generation
              </span>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 font-mono">
              Static Route Extraction • Express Router • Snapshot #{snapshotId?.substring(0, 8) || "active"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onRunAnalysis && (
              <button
                type="button"
                onClick={onRunAnalysis}
                disabled={isAnalyzing}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                title="Run AST parser again to re-discover endpoints"
              >
                <RefreshCw size={12} className={isAnalyzing ? "animate-spin text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"} />
                <span>{isAnalyzing ? "Analyzing..." : "Re-analyze"}</span>
              </button>
            )}
            {onGenerateSelected && (
              <button
                type="button"
                onClick={() => onGenerateSelected()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
              >
                <Zap size={13} />
                <span>
                  {selectedTargetEndpoints.size > 0
                    ? `Generate Selected (${selectedTargetEndpoints.size})`
                    : "Generate All Scenarios"}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Flatter, purposeful summary strip with hairline separators (zero duplicate method counts) */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2 border-y border-[var(--color-border)]/60 text-xs text-[var(--color-text-secondary)]">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold font-mono text-[var(--color-text)]">{totalEndpoints}</span>
            <span className="text-[11px] text-[var(--color-text-muted)]">Discovered Endpoints</span>
          </div>
          <div className="w-px h-3 bg-[var(--color-border)]/80" />
          <div className="flex items-baseline gap-1.5" title="AST parsing fidelity of discovered route declarations">
            <span className="text-sm font-bold font-mono text-[var(--color-success)]">
              {totalEndpoints > 0 ? Math.round((fullyResolved / totalEndpoints) * 100) : 0}%
            </span>
            <span className="text-[11px] text-[var(--color-text-muted)]">AST Fidelity ({fullyResolved}/{totalEndpoints} routes)</span>
          </div>
          <div className="w-px h-3 bg-[var(--color-border)]/80" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold font-mono text-[var(--color-text)]">{totalFiles}</span>
            <span className="text-[11px] text-[var(--color-text-muted)]">Source Files</span>
          </div>
        </div>
      </div>

      {/* 2. Interactive Search, Method Filter & Data Grid */}
      <div className="border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)] overflow-hidden flex flex-col flex-1 shadow-xs">
        {/* Table Workspace Toolbar */}
        <div className="px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
            <div className="relative w-full">
              <Search size={13} className="absolute left-2.5 top-2 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder="Filter routes, handlers, source files..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-7 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] font-mono"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Active Scope Filter Badge (From Left Explorer) */}
            {activeScopeFilter && activeScopeFilter.value && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 text-[11px] font-mono">
                <span className="text-[10px] font-bold uppercase text-[var(--color-text-muted)]">Scope:</span>
                <span className="font-semibold">{activeScopeFilter.value}</span>
                {onClearScopeFilter && (
                  <button
                    type="button"
                    onClick={onClearScopeFilter}
                    className="ml-0.5 hover:opacity-80 cursor-pointer"
                    title="Clear scope filter"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )}

            {/* Segmented HTTP Method Filter with Counts */}
            <div className="flex items-center gap-0.5 text-xs">
              {["ALL", "GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => {
                const count = m === "ALL" ? totalEndpoints : (methodCounts[m] || 0);
                const isActive = filterMethod === m;
                return (
                  <button
                    key={m}
                    onClick={() => setFilterMethod(m)}
                    className={`px-1.5 py-0.5 rounded-[var(--radius-sm)] font-mono text-[10px] font-semibold transition-colors cursor-pointer border ${
                      isActive
                        ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] border-[var(--color-primary)]"
                        : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    <span>{m}</span>
                    <span className="ml-0.5 text-[9px] opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Responsive Table (Strict 100% distribution, balanced columns, zero truncation on actions) */}
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse table-fixed">
            <colgroup>
              <col style={{ width: "4%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "34%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "11%" }} />
            </colgroup>
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] sticky top-0 z-10">
                <th className="py-2.5 px-2 text-center" style={{ width: "4%" }}>
                  {onToggleSelectEndpoint && filtered.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={handleToggleSelectAllFiltered}
                      className="rounded cursor-pointer accent-[var(--color-primary)] w-3.5 h-3.5"
                      title={allFilteredSelected ? "Deselect all filtered" : "Select all filtered"}
                    />
                  )}
                </th>
                <th className="py-2.5 px-2 text-center" style={{ width: "11%" }}>Method</th>
                <th className="py-2.5 pl-4 pr-3" style={{ width: "34%" }}>Endpoint Route</th>
                <th className="py-2.5 px-3" style={{ width: "20%" }}>Handler</th>
                <th className="py-2.5 px-3" style={{ width: "20%" }}>Source File</th>
                <th className="py-2.5 px-3 text-right" style={{ width: "11%" }}>Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]/60">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-xs text-[var(--color-text-muted)] font-mono">
                    <div className="flex flex-col items-center justify-center gap-1.5">
                      <Search size={18} className="opacity-40" />
                      <p className="m-0 font-medium">No API routes matched current filters</p>
                      {(search || filterMethod !== "ALL" || (activeScopeFilter && activeScopeFilter.value)) && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearch("");
                            setFilterMethod("ALL");
                            if (onClearScopeFilter) onClearScopeFilter();
                          }}
                          className="text-xs text-[var(--color-primary)] hover:underline mt-0.5 cursor-pointer"
                        >
                          Clear all filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((ep) => {
                  const id = `${ep.method} ${ep.path}`;
                  const isChecked = selectedTargetEndpoints.has(id);
                  const isSelected = selectedEndpointId === id;
                  const methodClass = METHOD_STYLES[ep.method] || METHOD_STYLES.DEFAULT;

                  return (
                    <tr
                      key={id}
                      onClick={() => onSelectEndpoint(id)}
                      className={`transition-colors cursor-pointer group ${
                        isSelected
                          ? "bg-[var(--color-primary-light)]/40 border-l-2 border-[var(--color-primary)] font-medium"
                          : "hover:bg-[var(--color-surface-hover)] border-l-2 border-transparent"
                      }`}
                    >
                      <td className="py-2.5 px-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                        {onToggleSelectEndpoint && (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => onToggleSelectEndpoint(id)}
                            className="rounded cursor-pointer accent-[var(--color-primary)] w-3.5 h-3.5"
                          />
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold border tracking-tight ${methodClass}`}>
                          {ep.method}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-xs text-[var(--color-text)] group-hover:text-[var(--color-primary)] transition-colors whitespace-nowrap truncate" title={ep.path}>
                        {ep.path}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-[var(--color-text-secondary)] whitespace-nowrap truncate" title={ep.source?.controllerMethod ? `#${ep.source.controllerMethod}` : "Inline Handler"}>
                        {ep.source?.controllerMethod ? (
                          <span className="text-[var(--color-primary)] text-[11px] inline-flex items-center gap-1">
                            <Code2 size={11} className="opacity-70 shrink-0" />
                            <span>#{ep.source.controllerMethod}</span>
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-muted)] italic text-[11px]">Inline Handler</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-[var(--color-text-muted)] whitespace-nowrap truncate" title={ep.source?.sourceFile}>
                        <span className="inline-flex items-center gap-1">
                          <FileCode size={11} className="text-[var(--color-text-muted)] opacity-60 shrink-0" />
                          <span>{ep.source?.sourceFile ? ep.source.sourceFile.split("/").pop() : "app.js"}</span>
                          {ep.source?.sourceLine && <span className="text-[var(--color-text-secondary)]">:{ep.source.sourceLine}</span>}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectEndpoint(id);
                          }}
                          className="text-xs text-[var(--color-primary)] font-medium inline-flex items-center gap-0.5 hover:underline cursor-pointer group-hover:translate-x-0.5 transition-transform"
                        >
                          <span>Inspect</span>
                          <ArrowRight size={11} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
