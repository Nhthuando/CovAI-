import { PillarCardShell } from "./PillarCardShell.jsx";
import { MeterBar } from "../primitives/MeterBar.jsx";
import { fmtPct, fmtDuration } from "../../../../services/unifiedDashboard/format.js";

const SYSTEM_FAILURE_KINDS = [
  { key: "selectorNotFound", label: "Selector Not Found" },
  { key: "networkTimeout", label: "API/Net Timeout" },
  { key: "assertion", label: "Visual/Assertion" },
  { key: "flaky", label: "Flaky Scenario" },
];

export function SystemPillarCard({
  pillarData,
  onNavigateWorkspace,
  activeCrossFilter = null,
  onSelectCrossFilter = null,
}) {
  const p = pillarData || {};
  const cov = p.coverageMetrics || {};
  const totalTests = Number(p.totalTests || 0);
  const passedTests = Number(p.passedTests || 0);
  const failedTests = Number(p.failedTests || 0);
  const flakyTests = Number(p.flakyTests || 0);

  const status = failedTests > 0 ? "fail" : totalTests > 0 ? "pass" : "untested";
  const statusLabel = `${passedTests}/${totalTests} Journeys`;

  const dist = p.failureDistribution || {
    selectorNotFound: 0,
    networkTimeout: 0,
    assertion: 0,
    flaky: 0,
  };

  return (
    <PillarCardShell
      pillar="system"
      framework={p.framework || "Playwright"}
      status={status}
      statusLabel={statusLabel}
      buttonLabel="Open System Workspace"
      buttonId="ud-pillar-system-open"
      onOpenWorkspace={() => onNavigateWorkspace("system")}
    >
      {/* User Journey Execution Stats */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider block">
          E2E Journey Outcomes
        </span>
        <div className="grid grid-cols-3 gap-1.5 text-xs font-mono text-center">
          <div className="p-2 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60">
            <span className="block text-[10px] text-[var(--ud-text-muted)] font-sans">Passed</span>
            <span className="text-sm font-bold text-[var(--ud-pass)]">{passedTests}</span>
          </div>
          <div className="p-2 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60">
            <span className="block text-[10px] text-[var(--ud-text-muted)] font-sans">Failed</span>
            <span className="text-sm font-bold text-[var(--ud-fail)]">{failedTests}</span>
          </div>
          <div className="p-2 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60">
            <span className="block text-[10px] text-[var(--ud-text-muted)] font-sans">Flaky</span>
            <span className="text-sm font-bold text-[var(--ud-warn)]">{flakyTests}</span>
          </div>
        </div>
      </div>

      {/* User Flow Coverage Gauge */}
      <div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 p-2 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--ud-text-muted)] text-[11px]">User Flow Coverage</span>
            <span className="font-mono tabular-nums font-semibold text-[var(--ud-text)]">
              {fmtPct(cov.flow ?? cov.lines)}
            </span>
          </div>
          <MeterBar value={cov.flow ?? cov.lines ?? 0} tone="system" height={4} />
        </div>
      </div>

      {/* Failure Category Classification Breakdown (Interactive Cross-Filter Trigger) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider">
            Failure Classification Breakdown
          </span>
          <span className="text-[10px] font-mono text-[var(--ud-text-muted)]">Click to filter</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
          {SYSTEM_FAILURE_KINDS.map((kind) => {
            const count = Number(dist[kind.key] || 0);
            const isSelected =
              activeCrossFilter?.pillar === "system" &&
              activeCrossFilter?.category === kind.key;
            return (
              <button
                key={kind.key}
                type="button"
                onClick={() =>
                  onSelectCrossFilter?.({
                    pillar: "system",
                    category: kind.key,
                    label: `System (E2E) • ${kind.label}`,
                  })
                }
                className={`flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] border transition-colors cursor-pointer text-left ${
                  isSelected
                    ? "border-[var(--ud-system)] bg-[var(--ud-system)]/15"
                    : "border-transparent bg-[var(--ud-surface-2)] hover:border-[var(--ud-border)]"
                }`}
                title={`Filter Matrix & Actions by ${kind.label}`}
              >
                <span className="text-[var(--ud-text-muted)] text-[11px] font-sans truncate">
                  {kind.label}:
                </span>
                <span
                  className={`font-semibold tabular-nums ${
                    count > 0
                      ? kind.key === "flaky"
                        ? "text-[var(--ud-warn)]"
                        : "text-[var(--ud-fail)]"
                      : "text-[var(--ud-text)]"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Runtime Meta */}
      <div className="pt-2 border-t border-[var(--ud-border)] text-[11px] text-[var(--ud-text-muted)] flex items-center justify-between font-mono">
        <span>Total Execution:</span>
        <span className="text-[var(--ud-text)] font-semibold">{fmtDuration(p.durationMs)}</span>
      </div>
    </PillarCardShell>
  );
}

export default SystemPillarCard;
