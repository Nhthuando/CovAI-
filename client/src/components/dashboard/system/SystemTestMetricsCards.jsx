import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Layers,
  BarChart2,
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
        <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] font-medium">
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
            <span className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
              {passRate === null ? "—" : `${passRate}%`}
            </span>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {total ? `${passed}/${total} passed` : "No test results yet"}
            </span>
          </div>
          <div className="w-full h-1 rounded-sm bg-[var(--color-surface-secondary)] overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                passRate !== null && passRate >= 90 ? "bg-emerald-500/65" : "bg-[var(--color-primary)]/75"
              }`}
              style={{ width: `${passRate ?? 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. Scenarios Breakdown */}
      <div className="px-4 py-3.5 bg-[var(--color-surface)] flex flex-col justify-between gap-2.5">
        <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] font-medium">
          <span className="inline-flex items-center gap-1.5">
            <Layers size={13} className="text-[var(--color-text-muted)]" />
            Scenarios ({total})
          </span>
          <span className="text-[11px] font-mono tabular-nums text-[var(--color-text-muted)]">
            E2E suite
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-xs">
          <span className="inline-flex items-center gap-1 text-[var(--color-text)] font-semibold">
            <CheckCircle2 size={13} className="text-emerald-500/75" />
            <span>{passed}</span>
            <span className="font-normal text-[var(--color-text-muted)]">passed</span>
          </span>
          <span className={`inline-flex items-center gap-1 font-semibold ${failed > 0 ? "text-rose-400" : "text-[var(--color-text-muted)]"}`}>
            <XCircle size={13} />
            <span>{failed}</span>
            <span className="font-normal text-[var(--color-text-muted)]">failed</span>
          </span>
          {flaky > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-400 font-semibold">
              <AlertTriangle size={13} />
              <span>{flaky}</span>
            </span>
          )}
        </div>

        <div className="text-[11px] text-[var(--color-text-muted)] font-mono tabular-nums pt-1.5 border-t border-[var(--color-border)] flex justify-between">
          <span>Skipped / flaky</span>
          <span className="text-[var(--color-text-secondary)]">{skipped} / {flaky}</span>
        </div>
      </div>

      {/* 3. Measured Tier Coverage */}
      <div className="px-4 py-3.5 bg-[var(--color-surface)] flex flex-col justify-between gap-2.5">
        <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] font-medium">
          <span className="inline-flex items-center gap-1.5">
            <BarChart2 size={13} className="text-[var(--color-text-muted)]" />
            Measured Coverage
          </span>
          <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
            Lines
          </span>
        </div>

        <div className="text-sm font-mono font-semibold tabular-nums text-[var(--color-text)] truncate" title={measuredTiers.length ? measuredTiers.map(([name, tier]) => `${name} ${tier.counters.lines.pct}%`).join(" · ") : "—"}>
          {measuredTiers.length
            ? measuredTiers.map(([name, tier]) => `${name} ${tier.counters.lines.pct}%`).join(" · ")
            : "—"}
        </div>

        <div className="text-[11px] text-[var(--color-text-muted)] pt-1.5 border-t border-[var(--color-border)] flex justify-between">
          <span>Coverage instrumentation</span>
          <span className="font-mono text-[var(--color-text-secondary)]">
            {measuredTiers.length ? `${measuredTiers.length} tier(s)` : "Pending"}
          </span>
        </div>
      </div>

      {/* 4. Execution Duration */}
      <div className="px-4 py-3.5 bg-[var(--color-surface)] flex flex-col justify-between gap-2.5">
        <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] font-medium">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={13} className="text-[var(--color-text-muted)]" />
            Execution Duration
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-[var(--color-text)] font-mono tabular-nums">
            {summary?.hasRun ? formatDuration(durationMs) : "—"}
          </span>
        </div>

        <div className="text-[11px] text-[var(--color-text-muted)] pt-1.5 border-t border-[var(--color-border)] flex justify-between">
          <span>Runner Engine</span>
          <span className="font-mono font-medium uppercase text-[var(--color-text-secondary)]">
            {summary?.runner || "Playwright"}
          </span>
        </div>
      </div>
    </div>
  );
}
