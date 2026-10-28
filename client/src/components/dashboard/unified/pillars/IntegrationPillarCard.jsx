import { PillarCardShell } from "./PillarCardShell.jsx";
import { StackedBar } from "../primitives/StackedBar.jsx";
import { MeterBar } from "../primitives/MeterBar.jsx";
import { fmtPct, fmtDuration } from "../../../../services/unifiedDashboard/format.js";

export function IntegrationPillarCard({ pillarData, onNavigateWorkspace }) {
  const p = pillarData || {};
  const cov = p.coverageMetrics || {};
  const status = p.failedTests > 0 ? "fail" : p.totalTests > 0 ? "pass" : "untested";
  const dist = p.failureDistribution || { route: 0, middlewareAuth: 0, controller: 0, database: 0 };

  const endpointSegments = [
    { key: "passed", value: p.passedTests || 0, tone: "pass", label: "Covered" },
    { key: "failed", value: p.failedTests || 0, tone: "fail", label: "Failed" },
    { key: "uncovered", value: cov.uncoveredApis || 0, tone: "neutral", label: "Uncovered" },
  ];

  return (
    <PillarCardShell
      pillar="integration"
      framework={p.framework || "Supertest"}
      status={status}
      counts={`${p.passedTests || 0}/${p.totalTests || 0} APIs`}
      buttonLabel="Open Integration Workspace"
      buttonId="ud-pillar-integration-open"
      onOpenWorkspace={() => onNavigateWorkspace("integration")}
    >
      {/* Endpoint Coverage Breakdown */}
      <div>
        <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider block mb-2">
          API Endpoint Distribution
        </span>
        <StackedBar segments={endpointSegments} height={6} showLegend={true} />
      </div>

      {/* Dual Coverage Gauges */}
      <div className="space-y-2 pt-1">
        {/* API Coverage */}
        <div className="rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 p-2 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--ud-text-muted)] text-[11px]">API Endpoint Coverage</span>
            <span className="font-mono tabular-nums font-semibold text-[var(--ud-text)]">
              {fmtPct(cov.apiEndpoint)}
            </span>
          </div>
          <MeterBar value={cov.apiEndpoint || 0} tone="integration" height={4} />
        </div>

        {/* Backend Code Coverage */}
        <div className="rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 p-2 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--ud-text-muted)] text-[11px]">Backend Code Coverage</span>
            <span className="font-mono tabular-nums font-semibold text-[var(--ud-text)]">
              {fmtPct(cov.lines)}
            </span>
          </div>
          <MeterBar value={cov.lines || 0} tone="integration" height={4} />
        </div>
      </div>

      {/* Failure Layer Breakdown */}
      <div>
        <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider block mb-1.5">
          Failure Layer Breakdown
        </span>
        <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
          <div className="flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)]">
            <span className="text-[var(--ud-text-muted)] text-[11px] font-sans">Route:</span>
            <span className="font-semibold text-[var(--ud-text)]">{dist.route || 0}</span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)]">
            <span className="text-[var(--ud-text-muted)] text-[11px] font-sans">Middleware/Auth:</span>
            <span className="font-semibold text-[var(--ud-text)]">{dist.middlewareAuth || 0}</span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)]">
            <span className="text-[var(--ud-text-muted)] text-[11px] font-sans">Controller:</span>
            <span className="font-semibold text-[var(--ud-text)]">{dist.controller || 0}</span>
          </div>
          <div className="flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)]">
            <span className="text-[var(--ud-text-muted)] text-[11px] font-sans">Database:</span>
            <span className="font-semibold text-[var(--ud-text)]">{dist.database || 0}</span>
          </div>
        </div>
      </div>

      {/* Runtime Meta */}
      <div className="pt-2 border-t border-[var(--ud-border)] text-[11px] text-[var(--ud-text-muted)] flex items-center justify-between font-mono">
        <span>Average Latency:</span>
        <span className="text-[var(--ud-text)] font-semibold">{fmtDuration(p.avgDurationMs)}</span>
      </div>
    </PillarCardShell>
  );
}

export default IntegrationPillarCard;
