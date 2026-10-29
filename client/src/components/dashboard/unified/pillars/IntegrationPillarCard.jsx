import { PillarCardShell } from "./PillarCardShell.jsx";
import { StackedBar } from "../primitives/StackedBar.jsx";
import { MeterBar } from "../primitives/MeterBar.jsx";
import { fmtPct, fmtDuration } from "../../../../services/unifiedDashboard/format.js";

const FAILURE_LAYERS = [
  { key: "route", label: "Route" },
  { key: "middlewareAuth", label: "Middleware/Auth" },
  { key: "controller", label: "Controller" },
  { key: "database", label: "Database" },
];

export function IntegrationPillarCard({
  pillarData,
  onNavigateWorkspace,
  activeCrossFilter = null,
  onSelectCrossFilter = null,
}) {
  const p = pillarData || {};
  const cov = p.coverageMetrics || {};

  const passedTests = Number(p.passedTests || 0);
  const failedTests = Number(p.failedTests || 0);
  const uncoveredApis = Number(cov.uncoveredApis || 0);
  const totalApis = Number(
    cov.totalApis ?? (passedTests + failedTests + uncoveredApis || p.totalTests || 0)
  );

  // Never show green "Passed" when Covered = 0 and Uncovered > 0!
  let status = "untested";
  if (failedTests > 0) {
    status = "fail";
  } else if (passedTests === 0 && uncoveredApis > 0) {
    status = "warn";
  } else if (passedTests > 0 && uncoveredApis > 0 && (cov.apiEndpoint ?? 0) < 80) {
    status = "warn";
  } else if (passedTests > 0) {
    status = "pass";
  }

  const statusLabel = `${passedTests}/${totalApis} Covered`;

  const dist = p.failureDistribution || {
    route: 0,
    middlewareAuth: 0,
    controller: 0,
    database: 0,
  };

  const endpointSegments = [
    { key: "passed", value: passedTests, tone: "pass", label: "Covered" },
    { key: "failed", value: failedTests, tone: "fail", label: "Failed" },
    { key: "uncovered", value: uncoveredApis, tone: "neutral", label: "Uncovered" },
  ];

  return (
    <PillarCardShell
      pillar="integration"
      framework={p.framework || "Supertest"}
      status={status}
      statusLabel={statusLabel}
      buttonLabel="Open Integration Workspace"
      buttonId="ud-pillar-integration-open"
      onOpenWorkspace={() => onNavigateWorkspace("integration")}
    >
      {/* Endpoint Coverage Breakdown */}
      <div>
        <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider block mb-2">
          API Endpoint Distribution
        </span>
        <StackedBar
          segments={endpointSegments}
          total={totalApis}
          height={6}
          showLegend={true}
        />
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

      {/* Failure Layer Breakdown (Interactive Cross-Filter Trigger) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider">
            Failure Layer Breakdown
          </span>
          <span className="text-[10px] font-mono text-[var(--ud-text-muted)]">Click to filter</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
          {FAILURE_LAYERS.map((layer) => {
            const count = Number(dist[layer.key] || 0);
            const isSelected =
              activeCrossFilter?.pillar === "integration" &&
              activeCrossFilter?.category === layer.key;
            return (
              <button
                key={layer.key}
                type="button"
                onClick={() =>
                  onSelectCrossFilter?.({
                    pillar: "integration",
                    category: layer.key,
                    label: `Integration • ${layer.label} Layer`,
                  })
                }
                className={`flex items-center justify-between p-1.5 rounded-[var(--radius-sm)] border transition-colors cursor-pointer text-left ${
                  isSelected
                    ? "border-[var(--ud-integration)] bg-[var(--ud-integration)]/15"
                    : "border-transparent bg-[var(--ud-surface-2)] hover:border-[var(--ud-border)]"
                }`}
                title={`Filter Matrix & Actions by ${layer.label} failures`}
              >
                <span className="text-[var(--ud-text-muted)] text-[11px] font-sans truncate">
                  {layer.label}:
                </span>
                <span
                  className={`font-semibold tabular-nums ${
                    count > 0 ? "text-[var(--ud-fail)]" : "text-[var(--ud-text)]"
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
        <span>Average Latency:</span>
        <span className="text-[var(--ud-text)] font-semibold">{fmtDuration(p.avgDurationMs)}</span>
      </div>
    </PillarCardShell>
  );
}

export default IntegrationPillarCard;
