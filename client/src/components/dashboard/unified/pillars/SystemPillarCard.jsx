import { PillarCardShell } from "./PillarCardShell.jsx";
import { MeterBar } from "../primitives/MeterBar.jsx";
import { fmtPct, fmtDuration } from "../../../../services/unifiedDashboard/format.js";

export function SystemPillarCard({ pillarData, onNavigateWorkspace }) {
  const p = pillarData || {};
  const cov = p.coverageMetrics || {};
  const status = p.failedTests > 0 ? "fail" : p.totalTests > 0 ? "pass" : "untested";
  const dist = p.failureDistribution || { selectorNotFound: 0, networkTimeout: 0, assertion: 0, flaky: 0 };

  return (
    <PillarCardShell
      pillar="system"
      framework={p.framework || "Playwright"}
      status={status}
      counts={`${p.passedTests || 0}/${p.totalTests || 0} journeys`}
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
            <span className="text-sm font-bold text-[var(--ud-pass)]">{p.passedTests || 0}</span>
          </div>
          <div className="p-2 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60">
            <span className="block text-[10px] text-[var(--ud-text-muted)] font-sans">Failed</span>
            <span className="text-sm font-bold text-[var(--ud-fail)]">{p.failedTests || 0}</span>
          </div>
          <div className="p-2 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60">
            <span className="block text-[10px] text-[var(--ud-text-muted)] font-sans">Flaky</span>
            <span className="text-sm font-bold text-[var(--ud-warn)]">{p.flakyTests || 0}</span>
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

      {/* Failure Category Classification Breakdown */}
      <div>
        <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider block mb-1.5">
          Failure Classification Breakdown
        </span>
        <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
          <div className="flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)]">
            <span className="text-[var(--ud-text-muted)] text-[11px] font-sans">Selector Not Found:</span>
            <span className="font-semibold text-[var(--ud-text)]">{dist.selectorNotFound || 0}</span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)]">
            <span className="text-[var(--ud-text-muted)] text-[11px] font-sans">API/Net Timeout:</span>
            <span className="font-semibold text-[var(--ud-text)]">{dist.networkTimeout || 0}</span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)]">
            <span className="text-[var(--ud-text-muted)] text-[11px] font-sans">Visual/Assertion:</span>
            <span className="font-semibold text-[var(--ud-text)]">{dist.assertion || 0}</span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)]">
            <span className="text-[var(--ud-text-muted)] text-[11px] font-sans">Flaky Scenario:</span>
            <span className="font-semibold text-[var(--ud-text)]">{dist.flaky || 0}</span>
          </div>
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
