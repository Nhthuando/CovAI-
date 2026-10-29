import { useState, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  FlaskConical,
} from "lucide-react";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { SegmentedFilter } from "../primitives/SegmentedFilter.jsx";
import { ZonePanel } from "../primitives/ZonePanel.jsx";
import {
  fmtDuration,
  fmtPct,
  fmtRelativeTime,
} from "../../../../services/unifiedDashboard/format.js";

export function UnifiedRecentRunsTable({
  historyData,
  onNavigateWorkspace,
  onInspectItem,
  onSwitchToDemo,
}) {
  const [pillarFilter, setPillarFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5;

  const runs = useMemo(() => historyData?.runs || [], [historyData?.runs]);
  const source = historyData?.source || "live";

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

  const handleViewRun = (run) => {
    if (onInspectItem) {
      onInspectItem({
        id: run.id,
        title: `Test Run ${run.id} — ${run.type.toUpperCase()} Suite`,
        pillar: run.type,
        status: run.status,
        targetName: run.id,
        summary:
          run.summary ||
          `Executed ${run.total} tests (${run.passed} passed, ${run.failed} failed) with ${fmtPct(
            run.coveragePct
          )} coverage in ${fmtDuration(run.durationMs)}.`,
        failureLayer:
          run.failureLayer ||
          (run.failed > 0
            ? `${run.type.toUpperCase()} Test Execution Failure`
            : "All Assertions Passed"),
        durationMs: run.durationMs,
        stackTrace: run.stackTrace || null,
        testCases:
          run.testCases ||
          [
            {
              name: `${run.type} suite execution (${run.passed}/${run.total} passed)`,
              status: run.status,
              durationMs: run.durationMs || 500,
              step: run.failed > 0 ? "Failed assertion step" : "Completed",
            },
          ],
        focusParams: {},
        aiPrompt:
          run.aiPrompt ||
          `Analyze test execution run ${run.id} (${run.type} suite): ${run.passed}/${run.total} passed, ${run.failed} failed, coverage ${fmtPct(
            run.coveragePct
          )}. Help me inspect and resolve any failures or coverage gaps.`,
      });
      return;
    }
    if (onNavigateWorkspace) {
      onNavigateWorkspace(run.type);
    }
  };

  return (
    <ZonePanel
      id="ud-zone-history"
      title="Recent Test Executions"
      description="Unified multi-suite run log — click View to inspect run steps & stack traces"
      source={source}
      contentClassName="p-0 flex flex-col justify-between"
      className="h-full"
      actions={
        <div className="ud-no-print">
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
        </div>
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
              <th className="py-2.5 px-3 text-right ud-no-print">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ud-border)] font-mono text-[11px]">
            {pageItems.length > 0 ? (
              pageItems.map((run) => (
                <tr
                  key={run.id}
                  onClick={() => handleViewRun(run)}
                  className="hover:bg-[var(--ud-surface-2)] transition-colors group cursor-pointer"
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
                    <span className="text-[var(--ud-pass)] font-semibold">
                      {run.passed}
                    </span>
                    <span className="text-[var(--ud-text-muted)]"> / </span>
                    <span
                      className={
                        run.failed > 0
                          ? "text-[var(--ud-fail)] font-semibold"
                          : "text-[var(--ud-text-muted)]"
                      }
                    >
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
                  <td className="py-2.5 px-3 text-right ud-no-print">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewRun(run);
                      }}
                      className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[11px] font-sans font-medium text-[var(--ud-unit)] hover:border-[var(--ud-unit)]/50 transition-colors cursor-pointer"
                    >
                      <span>View</span>
                      <ArrowUpRight size={11} />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={8}
                  className="py-10 px-4 text-center text-[var(--ud-text-muted)] font-sans"
                >
                  <div className="max-w-xs mx-auto space-y-2">
                    <p className="text-xs font-semibold text-[var(--ud-text)]">
                      {runs.length === 0
                        ? "No Test Executions Recorded in Live State"
                        : "No test executions match this filter"}
                    </p>
                    <p className="text-[11px] text-[var(--ud-text-muted)]">
                      {runs.length === 0
                        ? "Run a test suite or switch to Demo Showcase mode to inspect execution logs and step timings."
                        : "Select 'All' to view runs across all testing suites."}
                    </p>
                    {runs.length === 0 && onSwitchToDemo && (
                      <button
                        type="button"
                        onClick={onSwitchToDemo}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--ud-warn)]/40 bg-[var(--ud-warn)]/15 text-xs font-mono font-semibold text-[var(--ud-warn)] hover:bg-[var(--ud-warn)]/25 cursor-pointer mt-1"
                      >
                        <FlaskConical size={13} />
                        <span>Enable Demo Showcase</span>
                      </button>
                    )}
                  </div>
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
        <div className="flex items-center gap-1 ud-no-print">
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
