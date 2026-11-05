import React from "react";
import { Activity, CheckCircle2, ShieldCheck, Sparkles, ArrowRight } from "lucide-react";
import { KpiCard } from "../primitives/KpiCard.jsx";
import { DeltaIndicator } from "../primitives/DeltaIndicator.jsx";
import { SemiDonutGauge } from "../primitives/charts/SemiDonutGauge.jsx";
import { DonutChart } from "../primitives/charts/DonutChart.jsx";
import { ProgressRing } from "../primitives/charts/ProgressRing.jsx";
import { fmtPct, fmtCount } from "../../../../services/unifiedDashboard/format.js";

export function ExecutiveKpiRow({ vm, loading = false, onJumpToActions = null, className = "" }) {
  const health = vm?.health || {};
  const execution = vm?.execution || {};
  const coverage = vm?.coverage || {};
  const ai = vm?.ai || {};
  const actionsCount = Array.isArray(vm?.actions?.items) ? vm.actions.items.length : 0;

  const totalExecuted = Number(execution.total || 0);
  const hasBaseline = totalExecuted > 0 && health.score !== null && health.score !== undefined;

  const handleScrollToActions = () => {
    if (onJumpToActions) {
      onJumpToActions();
      return;
    }
    const el = document.getElementById("ud-action-alerts") || document.getElementById("ud-analysis-tabs");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Execution segments for DonutChart: Strictly executed test outcomes only (zero Uncovered APIs pollution)
  const execSegments = [
    { key: "Passed", value: execution.passed || 0, tone: "pass", label: "Passed" },
    { key: "Failed", value: execution.failed || 0, tone: "fail", label: "Failed" },
    { key: "Skipped", value: (execution.skipped || 0) + (execution.flaky || 0), tone: "neutral", label: "Skipped" },
  ];

  return (
    <div className={`grid grid-cols-12 gap-4 ${className}`}>
      {/* 1. Quality Health Score with Semi-Donut Radial Gauge */}
      <KpiCard
        id="ud-kpi-health"
        className="col-span-12 sm:col-span-6 xl:col-span-3"
        label="Quality Health Score"
        icon={Activity}
        loading={loading}
        delta={<DeltaIndicator delta={health.delta} />}
        supporting={
          <div
            className="flex items-center justify-center pt-1"
            title="Composite score weighted: Unit (50%) + Integration (30%) + System (20%)"
          >
            <SemiDonutGauge
              score={health.score}
              max={100}
              grade={health.grade || "--"}
              hasBaseline={hasBaseline}
              size={120}
              title="Quality Health Score"
            />
          </div>
        }
        footer={
          <>
            <span>Health Standard</span>
            <span className="font-mono text-xs font-semibold text-[var(--ud-text)]">
              {!hasBaseline
                ? "No Baseline"
                : (vm?.qualityGate?.status === "WARNING" || vm?.qualityGate?.status === "FAILED" || (execution.failed || 0) > 0) && health.score >= 80
                ? "At Risk (Gate Warning)"
                : health.score >= 80
                ? "Healthy"
                : health.score >= 60
                ? "Warning"
                : "Needs Review"}
            </span>
          </>
        }
      />

      {/* 2. Total Test Execution with Visual Donut Chart */}
      <KpiCard
        id="ud-kpi-execution"
        className="col-span-12 sm:col-span-6 xl:col-span-3"
        label="Total Test Execution"
        icon={CheckCircle2}
        loading={loading}
        supporting={
          <div className="flex items-center justify-between pt-1 gap-2">
            <DonutChart
              segments={execSegments}
              size={68}
              centerLabel={fmtCount(execution.total || 0)}
              centerSub="tests"
              showLegend={true}
              ariaLabel="Test execution breakdown"
            />
          </div>
        }
        footer={
          <>
            <span>Pass Rate</span>
            {totalExecuted > 0 ? (
              <span className="font-mono text-xs font-semibold text-[var(--ud-pass)]">
                {execution.passRate ?? 0}%
              </span>
            ) : (
              <span className="font-mono text-xs font-semibold text-[var(--ud-text-muted)]">
                --
              </span>
            )}
          </>
        }
      />

      {/* 3. Unified Coverage Index with 3 Circular Progress Rings */}
      <KpiCard
        id="ud-kpi-coverage"
        className="col-span-12 sm:col-span-6 xl:col-span-3"
        label="Unified Coverage Index"
        value={fmtPct(coverage.overall)}
        icon={ShieldCheck}
        loading={loading}
        supporting={
          <div className="grid grid-cols-3 gap-2 pt-2 items-center text-center">
            <ProgressRing
              pct={coverage.codePct || 0}
              label="Code"
              tone="unit"
              size={42}
            />
            <ProgressRing
              pct={coverage.apiPct || 0}
              label="API"
              tone="integration"
              size={42}
            />
            <ProgressRing
              pct={coverage.flowPct || 0}
              label="Flow"
              tone="system"
              size={42}
            />
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

      {/* 4. Open Actions & AI Contribution (Preserving AI Metrics, removing duplicate gaps) */}
      <KpiCard
        id="ud-kpi-ai"
        className="col-span-12 sm:col-span-6 xl:col-span-3"
        label="Prioritized Actions"
        value={fmtCount(actionsCount)}
        unit={actionsCount === 1 ? "action" : "actions"}
        icon={Sparkles}
        loading={loading}
        supporting={
          <div className="mt-2 space-y-1.5 text-xs text-[var(--ud-text-muted)] font-mono">
            <div className="flex items-center justify-between">
              <span>AI Generated:</span>
              <span className="text-[var(--ud-text)] font-semibold">{ai.aiGenerated || 0} tests</span>
            </div>
            <div className="flex items-center justify-between">
              <span>AI Repaired:</span>
              <span className="text-[var(--ud-text)] font-semibold">{ai.aiRepaired || 0} tests</span>
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
