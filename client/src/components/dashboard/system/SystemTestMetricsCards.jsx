import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Activity,
  Layers,
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

/**
 * Helper to determine badge color by pass rate
 */
function getPassRateColor(rate) {
  if (rate >= 90) return "text-[var(--color-success)]";
  if (rate >= 70) return "text-[var(--color-warning)]";
  return "text-[var(--color-danger)]";
}

export default function SystemTestMetricsCards({ summary }) {
  const total = summary?.totalTests || 0;
  const passed = summary?.passedTests || 0;
  const failed = summary?.failedTests || 0;
  const flaky = summary?.flakyTests || 0;
  const skipped = summary?.skippedTests || 0;
  const durationMs = summary?.durationMs || 0;
  const stability = summary?.stabilityScorePct ?? (total > 0 ? Math.round((passed / total) * 100) : 100);

  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const cov = summary?.coverageSummary || null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* 1. Pass Rate Card */}
      <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] font-medium mb-1">
          <span>Test Pass Rate</span>
          <ShieldCheck size={16} className="text-[var(--color-primary)]" />
        </div>
        <div className="flex items-baseline gap-2 my-1">
          <span className={`text-2xl font-bold tracking-tight ${getPassRateColor(passRate)}`}>
            {passRate}%
          </span>
          <span className="text-xs text-[var(--color-text-secondary)] font-mono">
            {passed}/{total} passed
          </span>
        </div>
        <div className="w-full bg-[var(--color-surface-secondary)] h-1.5 rounded-full overflow-hidden mt-2">
          <div
            className={`h-full transition-all duration-300 ${
              passRate >= 90
                ? "bg-[var(--color-success)]"
                : passRate >= 70
                ? "bg-[var(--color-warning)]"
                : "bg-[var(--color-danger)]"
            }`}
            style={{ width: `${passRate}%` }}
          />
        </div>
      </div>

      {/* 2. Code Coverage Card */}
      <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] font-medium mb-1">
          <span>Overall System Coverage</span>
          <Activity size={16} className="text-[var(--color-primary)]" />
        </div>
        <div className="flex items-baseline gap-2 my-1">
          <span className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
            {cov?.lines !== undefined ? `${Math.round(cov.lines)}%` : "N/A"}
          </span>
          <span className="text-xs text-[var(--color-text-secondary)] font-mono">
            line coverage
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 pt-1 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)] font-mono">
          <div>
            Stmt:{" "}
            <span className="text-[var(--color-text)] font-semibold">
              {cov?.statements !== undefined ? `${Math.round(cov.statements)}%` : "-"}
            </span>
          </div>
          <div>
            Branch:{" "}
            <span className="text-[var(--color-text)] font-semibold">
              {cov?.branches !== undefined ? `${Math.round(cov.branches)}%` : "-"}
            </span>
          </div>
          <div>
            Func:{" "}
            <span className="text-[var(--color-text)] font-semibold">
              {cov?.functions !== undefined ? `${Math.round(cov.functions)}%` : "-"}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Scenario Status Breakdown */}
      <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] font-medium mb-1">
          <span>Scenarios Breakdown</span>
          <Layers size={16} className="text-[var(--color-primary)]" />
        </div>
        <div className="flex items-center gap-3 my-1">
          <div className="flex items-center gap-1 text-xs font-semibold text-[var(--color-success)]">
            <CheckCircle2 size={14} />
            <span>{passed}</span>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-[var(--color-danger)]">
            <XCircle size={14} />
            <span>{failed}</span>
          </div>
          {flaky > 0 && (
            <div className="flex items-center gap-1 text-xs font-semibold text-[var(--color-warning)]">
              <AlertTriangle size={14} />
              <span>{flaky} flaky</span>
            </div>
          )}
          {skipped > 0 && (
            <div className="flex items-center gap-1 text-xs font-semibold text-[var(--color-text-muted)]">
              <span>{skipped} skip</span>
            </div>
          )}
        </div>
        <div className="text-[11px] text-[var(--color-text-secondary)] font-mono pt-1 border-t border-[var(--color-border)] flex justify-between">
          <span>Stability Score</span>
          <span className="font-semibold text-[var(--color-text)]">{stability}%</span>
        </div>
      </div>

      {/* 4. Execution Duration Card */}
      <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] font-medium mb-1">
          <span>Execution Duration</span>
          <Clock size={16} className="text-[var(--color-primary)]" />
        </div>
        <div className="flex items-baseline gap-2 my-1">
          <span className="text-2xl font-bold tracking-tight text-[var(--color-text)] font-mono">
            {formatDuration(durationMs)}
          </span>
        </div>
        <div className="text-[11px] text-[var(--color-text-secondary)] pt-1 border-t border-[var(--color-border)] flex justify-between">
          <span>Runner Engine</span>
          <span className="font-mono font-medium uppercase text-[var(--color-primary)]">
            {summary?.runner || "Playwright"}
          </span>
        </div>
      </div>
    </div>
  );
}

