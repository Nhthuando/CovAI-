import { Activity, CheckCircle2, ShieldCheck, Sparkles, ArrowRight } from "lucide-react";
import { KpiCard } from "../primitives/KpiCard.jsx";
import { DeltaIndicator } from "../primitives/DeltaIndicator.jsx";
import { StackedBar } from "../primitives/StackedBar.jsx";
import { MeterBar } from "../primitives/MeterBar.jsx";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { DemoDataBadge } from "../primitives/DemoDataBadge.jsx";
import { fmtPct, fmtCount, fmtDuration } from "../../../../services/unifiedDashboard/format.js";

export function ExecutiveKpiRow({ vm, loading = false, className = "" }) {
  const health = vm?.health || {};
  const execution = vm?.execution || {};
  const coverage = vm?.coverage || {};
  const ai = vm?.ai || {};

  const handleScrollToActions = () => {
    const el = document.getElementById("ud-smart-actions");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const uncoveredApis = Number(execution.uncoveredApis ?? 0);

  const execSegments = [
    { key: "Passed", value: execution.passed || 0, tone: "pass", label: "Passed" },
    { key: "Failed", value: execution.failed || 0, tone: "fail", label: "Failed" },
    { key: "Skipped", value: (execution.skipped || 0) + (execution.flaky || 0), tone: "neutral", label: "Skip/Flaky" },
    ...(uncoveredApis > 0
      ? [{ key: "Uncovered", value: uncoveredApis, tone: "warn", label: "Uncovered APIs" }]
      : []),
  ];

  const barTotal = (execution.total || 0) + uncoveredApis;

  return (
    <div className={`grid grid-cols-12 gap-4 ${className}`}>
      {/* 1. Quality Health Score */}
      <KpiCard
        id="ud-kpi-health"
        className="col-span-12 sm:col-span-6 xl:col-span-3"
        label="Quality Health Score"
        value={health.score !== null && health.score !== undefined ? health.score : "—"}
        unit="/100"
        grade={health.grade}
        icon={Activity}
        loading={loading}
        delta={<DeltaIndicator delta={health.delta} />}
        supporting="Weighted: Unit 50% · Int 30% · Sys 20%"
        footer={
          <>
            <span>Health Standard</span>
            <span className="font-mono text-xs font-semibold text-[var(--ud-text)]">
              {health.score === null || health.score === undefined
                ? "No Runs Yet"
                : health.score >= 80
                ? "Healthy"
                : health.score >= 60
                ? "Warning"
                : "Needs Review"}
            </span>
          </>
        }
      />

      {/* 2. Total Test Execution (Strictly separates Executed Failed vs. Uncovered APIs) */}
      <KpiCard
        id="ud-kpi-execution"
        className="col-span-12 sm:col-span-6 xl:col-span-3"
        label="Total Test Execution"
        value={fmtCount(execution.total || 0)}
        unit={`(${execution.passRate ?? 0}% pass)`}
        icon={CheckCircle2}
        loading={loading}
        supporting={
          <div className="mt-2 space-y-1.5">
            <StackedBar
              segments={execSegments}
              total={barTotal}
              height={6}
              showLegend={true}
            />
          </div>
        }
        footer={
          <>
            <span>Total Runtime</span>
            <span className="font-mono text-xs font-semibold text-[var(--ud-text)]">
              {fmtDuration(execution.durationMs)}
            </span>
          </>
        }
      />

      {/* 3. Unified Coverage Index */}
      <KpiCard
        id="ud-kpi-coverage"
        className="col-span-12 sm:col-span-6 xl:col-span-3"
        label="Unified Coverage Index"
        value={fmtPct(coverage.overall)}
        icon={ShieldCheck}
        loading={loading}
        supporting={
          <div className="mt-2 space-y-2">
            {/* Unit line coverage */}
            <div className="flex items-center justify-between text-xs gap-2">
              <PillarBadge pillar="unit" size="sm" showIcon={false} label="Code" />
              <div className="flex-1 mx-2">
                <MeterBar value={coverage.codePct || 0} tone="unit" height={5} />
              </div>
              <span className="font-mono text-xs tabular-nums text-[var(--ud-text)] font-semibold w-10 text-right">
                {fmtPct(coverage.codePct)}
              </span>
            </div>

            {/* Integration API coverage */}
            <div className="flex items-center justify-between text-xs gap-2">
              <PillarBadge pillar="integration" size="sm" showIcon={false} label="API" />
              <div className="flex-1 mx-2">
                <MeterBar value={coverage.apiPct || 0} tone="integration" height={5} />
              </div>
              <span className="font-mono text-xs tabular-nums text-[var(--ud-text)] font-semibold w-10 text-right">
                {fmtPct(coverage.apiPct)}
              </span>
            </div>

            {/* System E2E Flow coverage */}
            <div className="flex items-center justify-between text-xs gap-2">
              <PillarBadge pillar="system" size="sm" showIcon={false} label="Flow" />
              <div className="flex-1 mx-2">
                <MeterBar value={coverage.flowPct || 0} tone="system" height={5} />
              </div>
              <span className="font-mono text-xs tabular-nums text-[var(--ud-text)] font-semibold w-10 text-right">
                {fmtPct(coverage.flowPct)}
              </span>
            </div>
          </div>
        }
        footer={
          <>
            <span>Multi-Layer Target</span>
            <span className="font-mono text-xs font-semibold text-[var(--ud-text)]">
              {coverage.overall >= 75 ? "Target Met" : "Target: 75%+"}
            </span>
          </>
        }
      />

      {/* 4. AI Optimization & Coverage Gaps */}
      <KpiCard
        id="ud-kpi-ai"
        className="col-span-12 sm:col-span-6 xl:col-span-3"
        label="AI Tests & Coverage Gaps"
        badge={ai.source === "demo" ? <DemoDataBadge /> : null}
        value={fmtCount(ai.aiGenerated || 0)}
        unit="generated"
        icon={Sparkles}
        loading={loading}
        supporting={
          <div className="mt-2 space-y-1.5 text-xs text-[var(--ud-text-muted)] font-mono">
            <div className="flex items-center justify-between">
              <span>AI Repaired Tests:</span>
              <span className="text-[var(--ud-text)] font-semibold">{ai.aiRepaired || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Uncovered Gaps:</span>
              <span className="text-[var(--ud-warn)] font-bold">{ai.gaps || 0} gaps</span>
            </div>
          </div>
        }
        footer={
          <>
            <span>Action Center</span>
            <button
              type="button"
              onClick={handleScrollToActions}
              className="inline-flex items-center gap-1 text-xs text-[var(--ud-unit)] font-medium hover:underline cursor-pointer"
            >
              <span>View actions</span>
              <ArrowRight size={12} />
            </button>
          </>
        }
      />
    </div>
  );
}

export default ExecutiveKpiRow;
