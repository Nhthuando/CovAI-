import {
  Clock,
  ShieldCheck,
  Layers,
  BarChart2,
  PlugZap,
} from "lucide-react";

/**
 * Format duration ms into human-readable string
 */
function formatDuration(ms) {
  if (!ms || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = (ms / 1000).toFixed(1);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = Math.round(seconds % 60);
  return `${minutes}m ${remainingSecs}s`;
}

export default function SystemTestMetricsCards({ summary, coverageTiers }) {
  const total = summary?.totalTests || 0;
  const passed = summary?.passedTests || 0;
  const failed = summary?.failedTests || 0;
  const blockedByExternal = summary?.blockedByExternal || 0;
  const externalServiceLabels = summary?.externalServices?.map(service => service.label).filter(Boolean).join(', ');
  const flaky = summary?.flakyTests || 0;
  const skipped = summary?.skippedTests || 0;
  const durationMs = summary?.durationMs || 0;
  const measuredTiers = Object.entries(coverageTiers || {}).filter(([, tier]) => tier?.counters?.lines?.pct != null);

  const passRate = total > 0 ? Math.round((passed / total) * 100) : null;
  const rateDot =
    passRate === null
      ? "bg-[var(--color-text-muted)]/50"
      : passRate >= 90
        ? "bg-emerald-500/70"
        : passRate >= 70
          ? "bg-amber-500/70"
          : "bg-rose-400/80";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      {/* 1. Test Pass Rate */}
      <div className="px-4 py-3.5 bg-[var(--color-surface)] flex flex-col justify-between gap-2.5">
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)] font-medium">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-[var(--color-text-muted)]" />
            Test Pass Rate
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[var(--color-text-muted)]">
            <span className={`w-1.5 h-1.5 rounded-full ${rateDot}`} />
            <span>{passRate === null ? "Pending" : passRate >= 90 ? "Healthy" : passRate >= 70 ? "Fair" : "Low"}</span>
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums">
            <span className="text-2xl font-medium text-[var(--color-text)]">
              {passRate === null ? "—" : `${passRate}%`}
            </span>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {total ? `${passed}/${total} passed` : "No test results yet"}
            </span>
          </div>
          <div className="w-full h-1 rounded-md bg-[var(--color-surface-secondary)] overflow-hidden">
            <div
              className={`h-full transition-colors duration-300 ${
                passRate !== null && passRate >= 90 ? "bg-emerald-500/65" : "bg-[var(--color-primary)]/75"
              }`}
              style={{ width: `${passRate ?? 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. Scenarios Breakdown */}
      <div className="px-4 py-3.5 bg-[var(--color-surface)] flex flex-col justify-between gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-muted)] font-medium">
          <span className="inline-flex items-center gap-1.5">
            <Layers size={13} className="text-[var(--color-text-muted)]" />
            Scenarios
          </span>
          {blockedByExternal > 0 && (
            <span title={externalServiceLabels || 'External services'} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <PlugZap size={12} aria-hidden="true" />
              <span className="font-mono tabular-nums">{blockedByExternal}</span> need keys
            </span>
          )}
        </div>

        <div className="space-y-1">
          <div className="text-2xl font-medium font-mono tabular-nums">{total}</div>
          <div className="flex gap-x-2 overflow-x-auto whitespace-nowrap text-[11px] text-[var(--color-text-muted)]">
            <span><span className="font-mono tabular-nums">{passed}</span> passed</span>
            <span><span className="font-mono tabular-nums">{failed}</span> failed</span>
            <span><span className="font-mono tabular-nums">{skipped}</span> skipped</span>
            <span><span className="font-mono tabular-nums">{flaky}</span> flaky</span>
          </div>
        </div>
      </div>

      {/* 3. Measured Tier Coverage */}
      <div className="px-4 py-3.5 bg-[var(--color-surface)] flex flex-col justify-between gap-2.5">
        <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] font-medium">
          <span className="inline-flex items-center gap-1.5">
            <BarChart2 size={13} className="text-[var(--color-text-muted)]" />
            Line coverage
          </span>
        </div>

        {measuredTiers.length ? (
          <div className="flex gap-3 overflow-x-auto">
            {measuredTiers.map(([name, tier]) => (
              <div key={name} className="shrink-0 space-y-1">
                <div className="text-2xl font-medium font-mono tabular-nums">{tier.counters.lines.pct}%</div>
                <div className="text-[11px] text-[var(--color-text-muted)]">{name}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-2xl font-medium font-mono tabular-nums">—</div>
            <div className="text-[11px] text-[var(--color-text-muted)]">Pending</div>
          </div>
        )}
      </div>

      {/* 4. Execution Duration */}
      <div className="px-4 py-3.5 bg-[var(--color-surface)] flex flex-col justify-between gap-2.5">
        <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] font-medium">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={13} className="text-[var(--color-text-muted)]" />
            Execution Duration
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-medium text-[var(--color-text)] font-mono tabular-nums">
            {summary?.hasRun ? formatDuration(durationMs) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
