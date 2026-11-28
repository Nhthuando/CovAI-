import { Timer } from "lucide-react";
import { ZonePanel } from "../primitives/ZonePanel.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { fmtCount, fmtDuration, fmtRelativeTime } from "../../../../services/unifiedDashboard/format.js";

function statusPillProps(lastStatus) {
  const s = String(lastStatus || "").toUpperCase();
  if (s === "SUCCESS") return { status: "pass", label: "Success" };
  if (s === "FAILED") return { status: "fail", label: "Failed" };
  return { status: "not_run", label: "Not Run" };
}

export function FeatureExecutionDurationsPanel({
  featureDurations = [],
  loading = false,
  className = "",
}) {
  const rows = Array.isArray(featureDurations) ? featureDurations : [];
  const executedRows = rows.filter((r) => Number(r?.runCount || 0) > 0);
  const cumulativeTotalMs = executedRows.reduce(
    (sum, r) => sum + (Number.isFinite(Number(r?.totalDurationMs)) ? Number(r.totalDurationMs) : 0),
    0,
  );

  return (
    <ZonePanel
      id="ud-zone-feature-durations"
      title="Per-Feature Execution Durations"
      description="Latest run, cumulative total, and average duration across project jobs"
      className={className}
      contentClassName="p-0"
      actions={
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)]">
            <Timer size={12} className="text-[var(--ud-unit)]" />
            <span>
              {loading ? "--/--" : `${executedRows.length}/${rows.length} active`}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text)]">
            <span className="text-[var(--ud-text-muted)]">Cumulative:</span>
            <span className="font-semibold">
              {loading ? "--" : executedRows.length > 0 ? fmtDuration(cumulativeTotalMs) : "—"}
            </span>
          </span>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50 text-[11px] font-semibold uppercase tracking-wider text-[var(--ud-text-muted)]">
              <th className="py-2.5 px-4">Feature</th>
              <th className="py-2.5 px-3 text-right">Runs</th>
              <th className="py-2.5 px-3 text-right">Latest</th>
              <th className="py-2.5 px-3 text-right">Cumulative Total</th>
              <th className="py-2.5 px-3 text-right">Average</th>
              <th className="py-2.5 px-3">Last Run</th>
              <th className="py-2.5 px-4 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ud-border)] text-xs">
            {rows.map((row) => {
              const hasRuns = Number(row?.runCount || 0) > 0;
              const pill = statusPillProps(row?.lastStatus);
              return (
                <tr
                  key={row.key}
                  className="hover:bg-[var(--ud-surface-2)]/50 transition-colors duration-150"
                >
                  <td className="py-2.5 px-4 font-medium text-[var(--ud-text)]">
                    <div className="flex flex-col">
                      <span>{row.label}</span>
                      <span className="text-[10px] font-mono text-[var(--ud-text-muted)] truncate max-w-[280px]">
                        {(row.jobTypes || []).join(", ")}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[var(--ud-text)]">
                    {hasRuns ? fmtCount(row.runCount) : "0"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[var(--ud-text)]">
                    {hasRuns ? fmtDuration(row.latestDurationMs) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[var(--ud-text)]">
                    {hasRuns ? fmtDuration(row.totalDurationMs) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[var(--ud-text-muted)]">
                    {hasRuns ? fmtDuration(row.avgDurationMs) : "—"}
                  </td>
                  <td className="py-2.5 px-3 font-mono tabular-nums text-[11px] text-[var(--ud-text-muted)] whitespace-nowrap">
                    {hasRuns && row.lastRunAt ? fmtRelativeTime(row.lastRunAt) : "Not Run"}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <StatusPill status={pill.status} label={pill.label} size="sm" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ZonePanel>
  );
}

export default FeatureExecutionDurationsPanel;
