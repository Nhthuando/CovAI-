import { memo } from "react";
import { Sparkles, ArrowDownRight } from "lucide-react";
import ContextualMetricTooltip from "../primitives/ContextualMetricTooltip.jsx";

export function PortfolioExecutiveKpiRow({
  kpis = {},
  lifecycleCounts = null,
  onSelectStatusFilter,
  onFocusAttentionQueue,
  className = "",
}) {
  const card1 = kpis.card1Health || {};
  const card2 = kpis.card2Coverage || {};
  const card3 = kpis.card3Scale || {};
  const card4 = kpis.card4AiImpact || {};
  const timeRoi = kpis.timeRoi || {};

  const total = card1.totalProjects || 0;
  const passed = card1.passedProjects || 0;
  const atRisk = card1.atRiskProjects || 0;
  const blocked = card1.blockedProjects || 0;
  const untested = card1.untestedProjects || 0;

  const passedPct = total > 0 ? Math.round((passed / total) * 100) : 0;
  const atRiskPct = total > 0 ? Math.round((atRisk / total) * 100) : 0;
  const blockedPct = total > 0 ? Math.round((blocked / total) * 100) : 0;
  const untestedPct = total > 0 ? Math.max(0, 100 - passedPct - atRiskPct - blockedPct) : 0;

  // Isolated projects count
  const isolatedCount =
    (lifecycleCounts?.COMPLETED || 0) +
    (lifecycleCounts?.PAUSED || 0) +
    (lifecycleCounts?.CANCELLED || 0);

  const speedup = timeRoi.averageSpeedupMultiplier || 0;
  const autoDuration = timeRoi.totalAutoExecutionDurationFormatted || card3.cumulativeDurationStr || "0s";
  const manualDuration = timeRoi.totalManualExecutionDurationFormatted || "0s";
  const totalQaHoursSaved = timeRoi.totalQaHoursSaved ?? 0;

  return (
    <section
      id="portfolio-executive-kpi-row"
      aria-label="Portfolio Executive KPIs"
      className={`grid grid-cols-12 gap-4 ${className}`}
    >
      {/* ── Card 1: Portfolio Release Readiness & Health ─────── */}
      <div className="col-span-12 sm:col-span-6 xl:col-span-3 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between shadow-xs transition-colors">
        <div>
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[var(--ud-text)]">
              <span>Release Readiness</span>
              <ContextualMetricTooltip
                title="Release Readiness & Health"
                meaning="Portfolio health score calculated strictly across active projects in DOING state."
                formula="Health = 0.5 * UnitScore + 0.3 * IntScore + 0.2 * SysScore (where each PillarScore = 50% PassRate + 50% Coverage)"
                provenance="PostgreSQL TestRun & CoverageSummary tables"
                tip="Click on Passed, At Risk, or Blocked counts below to filter the directory."
              />
            </div>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                card1.grade === "A"
                  ? "bg-[var(--ud-pass)]/15 text-[var(--ud-pass)] border border-[var(--ud-pass)]/30"
                  : card1.grade === "B"
                  ? "bg-[var(--ud-unit)]/15 text-[var(--ud-unit)] border border-[var(--ud-unit)]/30"
                  : card1.grade === "C"
                  ? "bg-[var(--ud-warn)]/15 text-[var(--ud-warn)] border border-[var(--ud-warn)]/30"
                  : "bg-[var(--ud-fail)]/15 text-[var(--ud-fail)] border border-[var(--ud-fail)]/30"
              }`}
            >
              Grade {card1.grade || "—"}
            </span>
          </div>

          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold font-mono tracking-tight text-[var(--ud-text)] tabular-nums">
              {card1.avgHealthScore ?? 0}
            </span>
            <span className="text-xs font-mono text-[var(--ud-text-muted)]">/ 100 Health</span>
            <span className="ml-auto text-xs font-mono font-medium text-[var(--ud-text-muted)]">
              {total} Active {total !== 1 ? "Projects" : "Project"}
            </span>
          </div>

          {/* Segmented Breakdown Bar */}
          <div className="h-2 w-full rounded-full bg-[var(--ud-surface-2)] overflow-hidden flex gap-0.5 mt-3 select-none">
            {passedPct > 0 && (
              <div
                style={{ width: `${passedPct}%` }}
                className="bg-[var(--ud-pass)] transition-all"
                title={`Passed: ${passed} (${passedPct}%)`}
              />
            )}
            {atRiskPct > 0 && (
              <div
                style={{ width: `${atRiskPct}%` }}
                className="bg-[var(--ud-warn)] transition-all"
                title={`At Risk: ${atRisk} (${atRiskPct}%)`}
              />
            )}
            {blockedPct > 0 && (
              <div
                style={{ width: `${blockedPct}%` }}
                className="bg-[var(--ud-fail)] transition-all"
                title={`Blocked: ${blocked} (${blockedPct}%)`}
              />
            )}
            {untestedPct > 0 && (
              <div
                style={{ width: `${untestedPct}%` }}
                className="bg-[var(--ud-neutral)] transition-all"
                title={`Untested: ${untested} (${untestedPct}%)`}
              />
            )}
          </div>
        </div>

        {/* Legend counts (Clickable filters) */}
        <div>
          <div className="grid grid-cols-4 gap-1 pt-3 mt-3 border-t border-[var(--ud-border)] text-center font-mono text-[11px]">
            <button
              type="button"
              onClick={() => onSelectStatusFilter?.("PASSED")}
              className="hover:opacity-80 transition-opacity cursor-pointer"
              title="Filter by Passed"
            >
              <div className="text-[var(--ud-pass)] font-bold">{passed}</div>
              <div className="text-[10px] text-[var(--ud-text-muted)]">Passed</div>
            </button>
            <button
              type="button"
              onClick={() => onSelectStatusFilter?.("AT_RISK")}
              className="hover:opacity-80 transition-opacity cursor-pointer"
              title="Filter by At Risk"
            >
              <div className="text-[var(--ud-warn)] font-bold">{atRisk}</div>
              <div className="text-[10px] text-[var(--ud-text-muted)]">At Risk</div>
            </button>
            <button
              type="button"
              onClick={() => onSelectStatusFilter?.("BLOCKED")}
              className="hover:opacity-80 transition-opacity cursor-pointer"
              title="Filter by Blocked"
            >
              <div className="text-[var(--ud-fail)] font-bold">{blocked}</div>
              <div className="text-[10px] text-[var(--ud-text-muted)]">Blocked</div>
            </button>
            <button
              type="button"
              onClick={() => onSelectStatusFilter?.("UNTESTED")}
              className="hover:opacity-80 transition-opacity cursor-pointer"
              title="Filter by Untested"
            >
              <div className="text-[var(--ud-text-muted)] font-bold">{untested}</div>
              <div className="text-[10px] text-[var(--ud-text-muted)]">Untested</div>
            </button>
          </div>
          {isolatedCount > 0 && (
            <div className="text-[10px] text-[var(--ud-text-muted)] text-center mt-1.5 font-mono">
              *{isolatedCount} completed/paused projects isolated
            </div>
          )}
        </div>
      </div>

      {/* ── Card 2: Global Unified Coverage Index ─────────────── */}
      <div className="col-span-12 sm:col-span-6 xl:col-span-3 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between shadow-xs transition-colors">
        <div>
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[var(--ud-text)]">
              <span>Unified Coverage</span>
              <ContextualMetricTooltip
                title="Unified Coverage Index"
                meaning="Harmonized cross-layer coverage index across Unit, Integration and System layers."
                formula="Index = 50% Unit Lines + 30% Integration APIs + 20% System Flows"
                provenance="Istanbul/c8 coverage + OpenAPI contract analysis + Playwright AST parser"
                tip="Aim for 80%+ unified coverage for confident continuous deployment."
              />
            </div>
            <span className="text-[10px] text-[var(--ud-pass)] font-bold">Target 80%+</span>
          </div>

          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold font-mono tracking-tight text-[var(--ud-text)] tabular-nums">
              {card2.unifiedCoveragePct ?? 0}%
            </span>
            <span className="text-xs font-mono text-[var(--ud-text-muted)]">Weighted Avg</span>
          </div>
        </div>

        {/* 3 Horizontal Mini Progress Bars */}
        <div className="space-y-2 pt-3 mt-3 border-t border-[var(--ud-border)]">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[var(--ud-unit)] font-medium">Unit Line Cov</span>
              <span className="text-[var(--ud-text)] font-semibold tabular-nums">
                {card2.avgUnitCoveragePct ?? 0}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--ud-surface-2)] overflow-hidden">
              <div
                style={{ width: `${Math.min(100, card2.avgUnitCoveragePct ?? 0)}%` }}
                className="h-full bg-[var(--ud-unit)] transition-all"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[var(--ud-integration)] font-medium">API Endpoint Cov</span>
              <span className="text-[var(--ud-text)] font-semibold tabular-nums">
                {card2.avgIntegrationCoveragePct ?? 0}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--ud-surface-2)] overflow-hidden">
              <div
                style={{ width: `${Math.min(100, card2.avgIntegrationCoveragePct ?? 0)}%` }}
                className="h-full bg-[var(--ud-integration)] transition-all"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[var(--ud-system)] font-medium">System Flow Cov</span>
              <span className="text-[var(--ud-text)] font-semibold tabular-nums">
                {card2.avgSystemCoveragePct ?? 0}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--ud-surface-2)] overflow-hidden">
              <div
                style={{ width: `${Math.min(100, card2.avgSystemCoveragePct ?? 0)}%` }}
                className="h-full bg-[var(--ud-system)] transition-all"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Card 3: Execution Scale & Time Efficiency ─────────── */}
      <div className="col-span-12 sm:col-span-6 xl:col-span-3 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between shadow-xs transition-colors">
        <div>
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[var(--ud-text)]">
              <span>Execution & Velocity</span>
              <ContextualMetricTooltip
                title="Execution & Velocity Efficiency"
                meaning="Measures the total executed test suite scale and compares machine run time against manual execution."
                formula={`Speedup = Manual (${manualDuration}) / Auto (${autoDuration})`}
                provenance="PostgreSQL TestRun execution duration logs"
                tip="Automated parallel runs accelerate release cycles by replacing manual testing."
              />
            </div>
            {speedup > 1 ? (
              <span className="px-1.5 py-0.5 rounded bg-[var(--ud-unit)]/10 border border-[var(--ud-unit)]/30 text-[10px] text-[var(--ud-unit)] font-bold">
                ⚡ {speedup}x Faster
              </span>
            ) : (
              <span className="text-[10px] text-[var(--ud-pass)] font-bold">
                {card3.overallPassRatePct ?? 0}% Pass
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold font-mono tracking-tight text-[var(--ud-text)] tabular-nums">
              {card3.totalExecutedTests ?? 0}
            </span>
            <span className="text-xs font-mono text-[var(--ud-text-muted)]">Executed Tests</span>
          </div>
        </div>

        {/* 2x2 Sub-metrics Grid */}
        <div className="grid grid-cols-2 gap-2 pt-3 mt-3 border-t border-[var(--ud-border)] font-mono text-xs">
          <div className="p-1.5 rounded bg-[var(--ud-surface-2)]/70 border border-[var(--ud-border)]">
            <div className="text-[10px] text-[var(--ud-text-muted)]">Auto Runtime</div>
            <div className="font-bold text-[var(--ud-text)] truncate">{autoDuration}</div>
          </div>
          <div className="p-1.5 rounded bg-[var(--ud-surface-2)]/70 border border-[var(--ud-border)]">
            <div className="text-[10px] text-[var(--ud-text-muted)]">Manual Benchmark</div>
            <div className="font-bold text-[var(--ud-warn)] truncate">{manualDuration}</div>
          </div>
          <div className="p-1.5 rounded bg-[var(--ud-surface-2)]/70 border border-[var(--ud-border)]">
            <div className="text-[10px] text-[var(--ud-text-muted)]">Unit Passed</div>
            <div className="font-bold text-[var(--ud-text)]">{card3.unitPassedStr || "0/0"}</div>
          </div>
          <div className="p-1.5 rounded bg-[var(--ud-surface-2)]/70 border border-[var(--ud-border)]">
            <div className="text-[10px] text-[var(--ud-text-muted)]">APIs Covered</div>
            <div className="font-bold text-[var(--ud-text)]">{card3.apiCoveredStr || "0/0"}</div>
          </div>
        </div>
      </div>

      {/* ── Card 4: Global AI Impact & QA Hours Saved ─────────── */}
      <div className="col-span-12 sm:col-span-6 xl:col-span-3 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between shadow-xs transition-colors">
        <div>
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[var(--ud-text)]">
              <span>AI Impact & QA Saved</span>
              <ContextualMetricTooltip
                title="AI Synthesis & Net QA Hours Saved"
                meaning="Total engineering hours saved combining automated execution and AI-assisted test authoring and healing."
                formula="Total Saved = Execution Hours Saved + (AI Generated + Healed Tests * 15 min)"
                provenance="PostgreSQL AiTest & AiSuggestion tables"
                tip="Check Attention Queue to view uncovered endpoints needing AI test generation."
              />
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--ud-unit)]">
              <Sparkles size={11} />
              COV AI
            </span>
          </div>

          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold font-mono tracking-tight text-[var(--ud-pass)] tabular-nums">
              +{totalQaHoursSaved.toFixed(1)}h
            </span>
            <span className="text-xs font-mono text-[var(--ud-text-muted)]">Net QA Saved</span>
          </div>
        </div>

        {/* Sub-metrics & Focus Link */}
        <div className="pt-3 mt-3 border-t border-[var(--ud-border)] space-y-1.5 text-xs font-mono">
          <div className="flex items-center justify-between">
            <span className="text-[var(--ud-text-muted)]">AI Synthesized:</span>
            <span className="font-bold text-[var(--ud-text)]">{card4.totalAiTests ?? 0} tests</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--ud-text-muted)]">Healed / Repaired:</span>
            <span className="font-bold text-[var(--ud-pass)]">{card4.aiRepairedCount ?? 0} healed</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--ud-text-muted)]">Remaining Gaps:</span>
            <span className="font-bold text-[var(--ud-warn)]">{card4.uncoveredGapsCount ?? 0} uncovered</span>
          </div>
          <button
            type="button"
            onClick={() => onFocusAttentionQueue?.()}
            className="w-full mt-1 pt-1 text-center text-[11px] font-sans text-[var(--ud-unit)] hover:underline flex items-center justify-center gap-1 cursor-pointer"
          >
            <span>View in Attention Queue</span>
            <ArrowDownRight size={12} />
          </button>
        </div>
      </div>
    </section>
  );
}

export default memo(PortfolioExecutiveKpiRow);
