import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { SegmentedFilter } from "../primitives/SegmentedFilter.jsx";
import { ZonePanel } from "../primitives/ZonePanel.jsx";
import { fmtDuration, fmtPct, fmtRelativeTime } from "../../../../services/unifiedDashboard/format.js";

export function UnifiedRecentRunsTable({ historyData, onNavigateWorkspace }) {
  const [pillarFilter, setPillarFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5; // Compact rows fitting alongside trend chart

  const runs = useMemo(() => historyData?.runs || [], [historyData?.runs]);
  const source = historyData?.source || "demo";

  // Filter runs
  const filteredRuns = useMemo(() => {
    if (pillarFilter === "all") return runs;
    return runs.filter((r) => r.type === pillarFilter);
  }, [runs, pillarFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredRuns.length / pageSize));
  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRuns.slice(start, start + pageSize);
  }, [filteredRuns, currentPage, pageSize]);

  return (
    <ZonePanel
      id="ud-zone-history"
      title="Recent Test Executions"
      description="Unified multi-suite run log"
      source={source}
      contentClassName="p-0 flex flex-col justify-between"
      className="h-full"
      actions={
        <SegmentedFilter
          idPrefix="ud-history-filter"
          options={[
            { label: "All", value: "all" },
            { label: "Unit", value: "unit" },
            { label: "Integration", value: "integration" },
            { label: "System", value: "system" },
          ]}
          value={pillarFilter}
          onChange={(val) => {
            setPillarFilter(val);
            setCurrentPage(1);
          }}
          size="sm"
        />
      }
    >
      {/* Table */}
      <div className="w-full overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 text-[var(--ud-text-muted)] font-medium select-none">
              <th className="py-2.5 px-3">Run ID</th>
              <th className="py-2.5 px-3">Suite</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3">Pass / Fail</th>
              <th className="py-2.5 px-3">Coverage</th>
              <th className="py-2.5 px-3">Duration</th>
              <th className="py-2.5 px-3">Executed</th>
              <th className="py-2.5 px-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ud-border)] font-mono text-[11px]">
            {pageItems.length > 0 ? (
              pageItems.map((run) => (
                <tr
                  key={run.id}
                  className="hover:bg-[var(--ud-surface-2)] transition-colors group"
                >
                  {/* Run ID */}
                  <td className="py-2.5 px-3 font-semibold text-[var(--ud-text)]">
                    {run.id}
                  </td>

                  {/* Suite Type */}
                  <td className="py-2.5 px-3">
                    <PillarBadge pillar={run.type} size="sm" showIcon={false} />
                  </td>

                  {/* Status */}
                  <td className="py-2.5 px-3">
                    <StatusPill status={run.status} size="sm" />
                  </td>

                  {/* Pass / Fail */}
                  <td className="py-2.5 px-3 text-[var(--ud-text)] tabular-nums">
                    <span className="text-[var(--ud-pass)] font-semibold">{run.passed}</span>
                    <span className="text-[var(--ud-text-muted)]"> / </span>
                    <span className={run.failed > 0 ? "text-[var(--ud-fail)] font-semibold" : "text-[var(--ud-text-muted)]"}>
                      {run.failed}
                    </span>
                  </td>

                  {/* Coverage */}
                  <td className="py-2.5 px-3 tabular-nums font-semibold text-[var(--ud-text)]">
                    {fmtPct(run.coveragePct)}
                  </td>

                  {/* Duration */}
                  <td className="py-2.5 px-3 tabular-nums text-[var(--ud-text-muted)]">
                    {fmtDuration(run.durationMs)}
                  </td>

                  {/* Started At */}
                  <td className="py-2.5 px-3 font-sans text-[var(--ud-text-muted)] text-[11px]">
                    {fmtRelativeTime(run.startedAt)}
                  </td>

                  {/* Action */}
                  <td className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => onNavigateWorkspace(run.type)}
                      className="inline-flex items-center gap-1 text-[11px] font-sans text-[var(--ud-unit)] hover:underline cursor-pointer"
                    >
                      <span>View</span>
                      <ExternalLink size={11} />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="py-8 text-center text-[var(--ud-text-muted)] font-sans">
                  No test executions recorded for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-3 border-t border-[var(--ud-border)] flex items-center justify-between text-xs font-mono text-[var(--ud-text-muted)]">
        <span>
          Page {currentPage} of {totalPages} ({filteredRuns.length} runs)
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="p-1 rounded border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer hover:border-[var(--ud-text-muted)]"
            title="Previous Page"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="p-1 rounded border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer hover:border-[var(--ud-text-muted)]"
            title="Next Page"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </ZonePanel>
  );
}

export default UnifiedRecentRunsTable;
