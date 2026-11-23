import { CheckCircle2, Zap } from "lucide-react";
import { PillarCardShell } from "./PillarCardShell.jsx";
import { StackedBar } from "../primitives/StackedBar.jsx";
import { MeterBar } from "../primitives/MeterBar.jsx";
import { HorizontalBarList } from "../primitives/charts/HorizontalBarList.jsx";
import { fmtPct } from "../../../../services/unifiedDashboard/format.js";

const FAILURE_LAYER_LABELS = {
  route: "Route / Endpoint",
  middlewareAuth: "Middleware / Auth",
  controller: "Controller Logic",
  database: "Database / Model",
};

export function IntegrationPillarCard({
  pillarData,
  loading = false,
  onNavigateWorkspace,
  activeCrossFilter = null,
  onSelectCrossFilter = null,
}) {
  const p = pillarData || {};
  const cov = p.coverageMetrics || {};

  const passedTests = Number(p.passedTests || 0);
  const failedTests = Number(p.failedTests || 0);
  const totalTests = Number(p.totalTests ?? passedTests + failedTests);
  const uncoveredApis = Number(cov.uncoveredApis || 0);
  const totalApis = Number(cov.totalApis ?? 0);
  const coveredApis =
    cov.coveredApis !== undefined
      ? Math.min(totalApis, Number(cov.coveredApis))
      : totalApis > 0
        ? Math.max(0, totalApis - uncoveredApis)
        : 0;
  const failedApis =
    cov.failedApis !== undefined
      ? Math.min(Math.max(0, totalApis - coveredApis), Number(cov.failedApis))
      : failedTests > 0 && totalApis > 0
        ? Math.min(Math.max(0, totalApis - coveredApis), failedTests)
        : 0;
  const notTestedApis = Math.max(0, totalApis - coveredApis - failedApis);

  const state = loading
    ? "LOADING"
    : p.state || (passedTests + failedTests === 0 ? "NOT_RUN" : failedTests > 0 ? "HAS_FAILURES" : "ALL_PASSING");

  // Status computation
  let status = "untested";
  if (!loading) {
    if (failedTests > 0 || failedApis > 0) {
      status = "fail";
    } else if (passedTests === 0 && uncoveredApis > 0) {
      status = "warn";
    } else if (passedTests > 0 && uncoveredApis > 0 && (cov.apiEndpoint ?? 0) < 80) {
      status = "warn";
    } else if (passedTests > 0) {
      status = "pass";
    }
  }

  const statusLabel = loading
    ? "--"
    : totalApis > 0
      ? `${coveredApis}/${totalApis} Covered`
      : totalTests > 0
        ? `${passedTests}/${totalTests} Passed`
        : "0/0 Covered";

  const dist = p.failureDistribution || {};
  const activeFailureLayers = Object.entries(dist)
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => ({
      key,
      label: FAILURE_LAYER_LABELS[key] || key,
      value: Number(count),
      valueText: `${count} failed`,
      tone: "fail",
    }));

  const barTotal = loading ? 0 : totalApis > 0 ? totalApis : totalTests;
  const endpointSegments =
    totalApis > 0 || totalTests === 0
      ? [
          { key: "passed", value: loading ? 0 : coveredApis, displayValue: loading ? "--" : coveredApis, tone: "pass", label: "Covered" },
          { key: "failed", value: loading ? 0 : failedApis, displayValue: loading ? "--" : failedApis, tone: "fail", label: "Failed" },
          { key: "uncovered", value: loading ? 0 : notTestedApis, displayValue: loading ? "--" : notTestedApis, tone: "warn", label: "Uncovered" },
        ]
      : [
          { key: "passed", value: loading ? 0 : passedTests, displayValue: loading ? "--" : passedTests, tone: "pass", label: "Passed" },
          { key: "failed", value: loading ? 0 : failedTests, displayValue: loading ? "--" : failedTests, tone: "fail", label: "Failed" },
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
      {/* Endpoint Coverage Breakdown (Sole source of truth for API Endpoints) */}
      <div>
        <span className="text-[11px] font-semibold text-[var(--ud-text-muted)] uppercase tracking-wider block mb-2">
          API Endpoint Distribution
        </span>
        <StackedBar
          segments={endpointSegments}
          total={barTotal}
          height={6}
          showLegend={true}
        />
      </div>

      {/* State 1: NOT RUN -> Empty state with direct action, vertically centered */}
      {state === "NOT_RUN" && (
        <div className="flex-1 flex flex-col justify-center items-center rounded-[var(--radius-md)] border border-dashed border-[var(--ud-border)] bg-[var(--ud-surface-2)]/40 p-5 text-center space-y-2.5 my-auto">
          <p className="text-xs text-[var(--ud-text-muted)]">
            <span className="font-semibold text-[var(--ud-warn)]">{uncoveredApis || totalApis} APIs</span> discovered from AST — not tested yet.
          </p>
          <button
            type="button"
            onClick={() => onNavigateWorkspace("integration")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--ud-integration)]/20 border border-[var(--ud-integration)]/50 text-xs font-semibold text-[var(--ud-integration)] hover:bg-[var(--ud-integration)]/30 transition-colors cursor-pointer"
          >
            <Zap size={13} />
            <span>Generate & Run Tests</span>
          </button>
        </div>
      )}

      {/* State 2: ALL PASSING -> Clean green badge */}
      {state === "ALL_PASSING" && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--ud-pass)]/30 bg-[var(--ud-pass)]/10 text-[var(--ud-pass)] text-xs font-semibold">
          <CheckCircle2 size={13} className="shrink-0" />
          <span>
            {totalApis > 0
              ? `All ${coveredApis} covered endpoint(s) passing (${passedTests} tests) — 0 failures`
              : `All ${passedTests} integration tests passing — 0 failures`}
          </span>
        </div>
      )}

      {/* Backend Code Coverage */}
      {state !== "NOT_RUN" && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/60 p-2.5 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--ud-text-muted)] text-[11px]">Backend Code Coverage</span>
            <span className="font-mono tabular-nums font-semibold text-[var(--ud-text)]">
              {loading ? "--%" : fmtPct(cov.lines)}
            </span>
          </div>
          <MeterBar value={loading ? 0 : cov.lines || 0} tone="integration" height={4} />
        </div>
      )}

      {state === "LOADING" && (
        <div className="mt-auto text-[11px] font-mono text-[var(--ud-text-muted)] p-2 rounded-[var(--radius-sm)] bg-[var(--ud-surface-2)]/50 text-center">
          Loading API integration metrics...
        </div>
      )}

      {/* State 3: HAS FAILURES -> HorizontalBarList for active failure layers only */}
      {state === "HAS_FAILURES" && activeFailureLayers.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-[var(--ud-fail)] uppercase tracking-wider">
              Failure Layer Breakdown
            </span>
            <span className="text-[10px] font-mono text-[var(--ud-text-muted)]">Click to filter</span>
          </div>
          <HorizontalBarList
            items={activeFailureLayers}
            height={4}
            activeKey={activeCrossFilter?.category}
            onItemClick={(item) =>
              onSelectCrossFilter?.({
                pillar: "integration",
                category: item.key,
                label: `Integration • ${item.label}`,
              })
            }
          />
        </div>
      )}
    </PillarCardShell>
  );
}

export default IntegrationPillarCard;
