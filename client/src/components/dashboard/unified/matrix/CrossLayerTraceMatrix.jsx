import { useState, useMemo } from "react";
import { Search, ChevronRight, ChevronDown, ExternalLink } from "lucide-react";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { SegmentedFilter } from "../primitives/SegmentedFilter.jsx";
import { ZonePanel } from "../primitives/ZonePanel.jsx";

export function CrossLayerTraceMatrix({ matrixData, onNavigateWorkspace }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterState, setFilterState] = useState("all"); // 'all' | 'failure' | 'low_coverage'
  const [expandedRows, setExpandedRows] = useState(new Set());

  const rows = useMemo(() => matrixData?.rows || [], [matrixData?.rows]);
  const source = matrixData?.source || "demo";

  // Toggle row expansion
  const toggleExpand = (rowId) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  // Filter rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      // Search text
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (r.moduleName || "").toLowerCase().includes(q);
        const matchDesc = (r.description || "").toLowerCase().includes(q);
        const matchDiagnosis = (r.rootCause?.diagnosis || "").toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchDiagnosis) return false;
      }

      // Filter state
      if (filterState === "failure") {
        return (
          r.unit.status === "fail" ||
          r.integration.status === "fail" ||
          r.system.status === "fail"
        );
      }
      if (filterState === "low_coverage") {
        return (
          r.unit.status === "untested" ||
          r.integration.status === "warn" ||
          r.system.status === "untested"
        );
      }
      return true;
    });
  }, [rows, searchQuery, filterState]);

  return (
    <ZonePanel
      id="ud-zone-matrix"
      title="Cross-Layer Traceability Matrix"
      description="Business feature alignment & root cause diagnosis"
      source={source}
      contentClassName="p-0"
      className="h-full"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ud-text-muted)] pointer-events-none" />
            <input
              id="ud-matrix-search"
              type="text"
              placeholder="Search module or root cause..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-2.5 py-1 text-xs rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text)] placeholder-[var(--ud-text-muted)] focus:outline-hidden focus:border-[var(--color-focus)] w-48 sm:w-56"
            />
          </div>

          {/* Filter Group */}
          <SegmentedFilter
            idPrefix="ud-matrix-filter"
            options={[
              { label: "All", value: "all", count: rows.length },
              {
                label: "Has Failure",
                value: "failure",
                count: rows.filter((r) => r.unit.status === "fail" || r.integration.status === "fail" || r.system.status === "fail").length,
              },
              {
                label: "Coverage Gap",
                value: "low_coverage",
                count: rows.filter((r) => r.unit.status === "untested" || r.integration.status === "warn" || r.system.status === "untested").length,
              },
            ]}
            value={filterState}
            onChange={setFilterState}
            size="sm"
          />
        </div>
      }
    >
      {/* Table Container */}
      <div className="w-full overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 text-[var(--ud-text-muted)] font-medium select-none sticky top-0 z-10">
              <th className="py-2.5 px-4 w-10 text-center"></th>
              <th className="py-2.5 px-3 min-w-[180px]">Module / Feature</th>
              <th className="py-2.5 px-3 min-w-[140px]">
                <div className="flex items-center gap-1.5">
                  <PillarBadge pillar="unit" size="sm" />
                  <span>Functions</span>
                </div>
              </th>
              <th className="py-2.5 px-3 min-w-[140px]">
                <div className="flex items-center gap-1.5">
                  <PillarBadge pillar="integration" size="sm" />
                  <span>API / DB</span>
                </div>
              </th>
              <th className="py-2.5 px-3 min-w-[140px]">
                <div className="flex items-center gap-1.5">
                  <PillarBadge pillar="system" size="sm" />
                  <span>UI Flow</span>
                </div>
              </th>
              <th className="py-2.5 px-4 min-w-[220px]">Root Cause Diagnosis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ud-border)]">
            {filteredRows.length > 0 ? (
              filteredRows.map((row) => {
                const isExpanded = expandedRows.has(row.id);
                return (
                  <tr
                    key={row.id}
                    className="group hover:bg-[var(--ud-surface-2)] transition-colors"
                  >
                    {/* Expand Toggle */}
                    <td className="py-3 px-3 text-center align-top">
                      <button
                        type="button"
                        onClick={() => toggleExpand(row.id)}
                        className="p-1 rounded text-[var(--ud-text-muted)] hover:text-[var(--ud-text)] transition-colors cursor-pointer"
                        aria-expanded={isExpanded}
                        title={isExpanded ? "Collapse module details" : "Expand module details"}
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>

                    {/* Module Name & Summary */}
                    <td className="py-3 px-3 align-top">
                      <div className="font-semibold text-[var(--ud-text)]">{row.moduleName}</div>
                      <div className="text-[11px] text-[var(--ud-text-muted)] line-clamp-1 mt-0.5 font-sans">
                        {row.description}
                      </div>

                      {/* Expanded Child Items */}
                      {isExpanded && (
                        <div className="mt-3 pt-2.5 border-t border-[var(--ud-border)] space-y-1.5 font-mono text-[11px]">
                          <span className="text-[10px] uppercase font-bold text-[var(--ud-text-muted)] tracking-wider font-sans block mb-1">
                            Associated Test Artifacts:
                          </span>
                          {(row.items || []).map((it, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-2 py-0.5">
                              <span className="flex items-center gap-1.5 truncate">
                                <PillarBadge pillar={it.type} size="sm" showIcon={false} />
                                <span className="text-[var(--ud-text)] truncate">{it.name}</span>
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigateWorkspace(
                                    it.type,
                                    it.path
                                      ? { focusFile: it.path }
                                      : it.endpoint
                                      ? { focusEndpoint: it.endpoint }
                                      : { focusScenario: it.scenarioId }
                                  )
                                }
                                className="inline-flex items-center gap-1 text-[10px] text-[var(--ud-unit)] hover:underline shrink-0 cursor-pointer"
                              >
                                <span>Inspect</span>
                                <ExternalLink size={10} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Unit Cell */}
                    <td className="py-3 px-3 align-top">
                      <StatusPill status={row.unit.status} label={row.unit.label} size="sm" />
                      {row.unit.path && (
                        <div className="text-[10px] font-mono text-[var(--ud-text-muted)] truncate max-w-[130px] mt-1">
                          {row.unit.path.split("/").pop()}
                        </div>
                      )}
                    </td>

                    {/* Integration Cell */}
                    <td className="py-3 px-3 align-top">
                      <StatusPill status={row.integration.status} label={row.integration.label} size="sm" />
                      {row.integration.endpoint && (
                        <div className="text-[10px] font-mono text-[var(--ud-text-muted)] truncate max-w-[130px] mt-1">
                          {row.integration.endpoint}
                        </div>
                      )}
                    </td>

                    {/* System Cell */}
                    <td className="py-3 px-3 align-top">
                      <StatusPill status={row.system.status} label={row.system.label} size="sm" />
                      {row.system.scenarioId && (
                        <div className="text-[10px] font-mono text-[var(--ud-text-muted)] truncate max-w-[130px] mt-1">
                          {row.system.scenarioId}
                        </div>
                      )}
                    </td>

                    {/* Root Cause Diagnosis */}
                    <td className="py-3 px-4 align-top">
                      <div className="flex items-start gap-1.5">
                        {row.rootCause.suspectLayer !== "none" && (
                          <PillarBadge pillar={row.rootCause.suspectLayer} size="sm" showIcon={false} />
                        )}
                        <span className="font-semibold text-[var(--ud-text)] font-sans">
                          {row.rootCause.summary}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--ud-text-muted)] mt-1 font-sans leading-relaxed">
                        {row.rootCause.diagnosis}
                      </p>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[var(--ud-text-muted)]">
                  No modules match the current filter or search criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </ZonePanel>
  );
}

export default CrossLayerTraceMatrix;
