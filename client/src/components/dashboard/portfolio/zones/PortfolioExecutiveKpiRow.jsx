import { memo } from "react";
import { PORTFOLIO_ROI_BASELINE } from "../../../../../../shared/portfolioGovernance.js";
import RadialHealthGauge from "../primitives/RadialHealthGauge.jsx";

export function PortfolioExecutiveKpiRow({
  kpis = {},
  lifecycleCounts = null,
  scopeBadge = null,
  excludedCount = 0,
  className = "",
}) {
  const card1 = kpis.card1Health || {};
  const card2 = kpis.card2Coverage || {};
  const card3 = kpis.card3Scale || {};
  const card4 = kpis.card4AiImpact || {};
  const timeRoi = kpis.timeRoi || {};

  const doingCount = lifecycleCounts?.DOING ?? card1.totalProjects ?? 0;
  const notStartedCount = lifecycleCounts?.NOT_STARTED ?? 0;
  const completedCount = lifecycleCounts?.COMPLETED ?? 0;
  const pausedOrCancelled =
    (lifecycleCounts?.PAUSED ?? 0) + (lifecycleCounts?.CANCELLED ?? 0);
  const totalCount =
    doingCount + notStartedCount + completedCount + pausedOrCancelled;

  const doingPct = totalCount > 0 ? Math.round((doingCount / totalCount) * 100) : 0;
  const notStartedPct =
    totalCount > 0 ? Math.round((notStartedCount / totalCount) * 100) : 0;
  const completedPct =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const pausedPct =
    totalCount > 0
      ? Math.max(0, 100 - doingPct - notStartedPct - completedPct)
      : 0;

  const hasHealthScore =
    card1.avgHealthScore !== null && card1.avgHealthScore !== undefined;
  const unifiedCoveragePct = card2.unifiedCoveragePct;
  const hasUnifiedCoverage =
    unifiedCoveragePct !== null && unifiedCoveragePct !== undefined;

  const layerMeta = card2.layerCoverageMeta || {};
  const coverageLayers = [
    {
      key: "unit",
      label: "Unit",
      val: card2.avgUnitCoveragePct,
      meta: layerMeta.unit,
      color: "var(--ps-cobalt)",
    },
    {
      key: "integration",
      label: "API",
      val: card2.avgIntegrationCoveragePct,
      meta: layerMeta.integration,
      color: "var(--ps-indigo)",
    },
    {
      key: "system",
      label: "E2E",
      val: card2.avgSystemCoveragePct,
      meta: layerMeta.system,
      color: "var(--ps-teal)",
    },
  ];

  const totalTests = card3.totalExecutedTests ?? 0;
  const totalFailed = card3.totalFailedTests ?? 0;
  const passRate = card3.overallPassRatePct;
  const hasPassRate = passRate !== null && passRate !== undefined;
  const speedup = timeRoi.averageSpeedupMultiplier || 0;
  const autoDuration =
    timeRoi.totalAutoExecutionDurationFormatted || card3.cumulativeDurationStr || "0ms";
  const manualDuration = timeRoi.totalManualExecutionDurationFormatted || "0 mins";

  const totalQaHoursSaved = timeRoi.totalQaHoursSaved ?? 0;
  const aiGenerated = card4.aiGeneratedCount ?? 0;
  const aiRepaired = card4.aiRepairedCount ?? 0;
  const aiGaps = card4.uncoveredGapsCount ?? 0;
  const aiSum = Math.max(1, aiGenerated + aiRepaired + aiGaps);

  return (
    <section
      id="portfolio-executive-kpi-row"
      data-guide="portfolio-kpis"
      aria-label="Portfolio Metrics Overview"
      className={`ps-panel overflow-hidden grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--ps-line)] ${className}`}
    >
      {/* ── Col 1: Health Gauge & Lifecycle Distribution ─────────────── */}
      <div className="p-4 sm:p-5 flex flex-col justify-between gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-xs text-[var(--ps-ink-muted)]">
              Health score
            </span>
            {scopeBadge && (
              <div className="text-[10px] ps-mono text-[var(--ps-ink-muted)] tabular-nums mt-0.5">
                {scopeBadge}
              </div>
            )}
            <div className="flex items-baseline gap-1.5 mt-1 ps-mono">
              <span className="text-2xl font-bold text-[var(--ps-ink)] tabular-nums">
                {hasHealthScore ? card1.avgHealthScore : "—"}
              </span>
              {hasHealthScore ? (
                <span className="text-xs text-[var(--ps-ink-muted)]">/ 100</span>
              ) : (
                <span className="text-[11px] text-[var(--ps-ink-muted)]">
                  No runs yet
                </span>
              )}
            </div>
          </div>

          <RadialHealthGauge
            score={card1.avgHealthScore ?? 0}
            grade={card1.grade || "—"}
            isTested={hasHealthScore}
            size={48}
            strokeWidth={4}
          />
        </div>

        <div className="space-y-2.5">
          <div className="h-1.5 w-full rounded-full bg-[var(--ps-surface-2)] overflow-hidden flex gap-0.5">
            {doingPct > 0 && (
              <div style={{ width: `${doingPct}%` }} className="bg-[var(--ps-cobalt)]" />
            )}
            {completedPct > 0 && (
              <div style={{ width: `${completedPct}%` }} className="bg-[var(--ps-emerald)]" />
            )}
            {notStartedPct > 0 && (
              <div style={{ width: `${notStartedPct}%` }} className="bg-[var(--ps-neutral)]" />
            )}
            {pausedPct > 0 && (
              <div style={{ width: `${pausedPct}%` }} className="bg-[var(--ps-amber)]" />
            )}
          </div>

          <div className="grid grid-cols-4 gap-1 text-center ps-mono text-[11px]">
            {[
              {
                label: "Doing",
                val: doingCount,
                dot: "bg-[var(--ps-cobalt)]",
                title: "Included in Portfolio KPIs",
              },
              {
                label: "Done",
                val: completedCount,
                dot: "bg-[var(--ps-emerald)]",
                title:
                  excludedCount > 0 ? "Completed — Excluded from Active KPIs" : undefined,
              },
              {
                label: "New",
                val: notStartedCount,
                dot: "bg-[var(--ps-neutral)]",
                title: "Not Started — Excluded from Active KPIs until executed",
              },
              {
                label: "Hold",
                val: pausedOrCancelled,
                dot: "bg-[var(--ps-amber)]",
                title:
                  excludedCount > 0
                    ? "Paused / Cancelled — Excluded from Active KPIs"
                    : undefined,
              },
            ].map((item) => (
              <div key={item.label} title={item.title} className="py-0.5">
                <div className="font-semibold text-[var(--ps-ink)] tabular-nums">
                  {item.val}
                </div>
                <div className="text-[10px] text-[var(--ps-ink-muted)] inline-flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${item.dot}`} />
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Col 2: 3-Layer Coverage Column Diagram ───────────────────── */}
      <div className="p-4 sm:p-5 flex flex-col justify-between gap-3">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs text-[var(--ps-ink-muted)]">
              Unified coverage
            </span>
            <div className="text-2xl font-bold ps-mono tabular-nums text-[var(--ps-ink)] mt-1">
              {hasUnifiedCoverage ? `${unifiedCoveragePct}%` : "—"}
            </div>
          </div>
          <span
            className="text-[11px] ps-mono text-[var(--ps-ink-muted)]"
            title="Weighted average re-normalized over measured layers (Unit 50% / API 30% / E2E 20%)"
          >
            80% goal
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 items-end h-16 relative pt-1">
          <div
            style={{ bottom: "76%" }}
            className="absolute inset-x-0 border-t border-dashed border-[var(--ps-line-strong)] pointer-events-none"
          />
          {coverageLayers.map((col) => {
            const isMeasured = col.val !== null && col.val !== undefined;
            const totalKpi = col.meta?.totalKpiProjects ?? card1.totalProjects ?? 0;
            const measuredCount = col.meta?.measuredCount ?? 0;
            const measuredHint =
              totalKpi > 0 && measuredCount < totalKpi
                ? `${measuredCount}/${totalKpi}`
                : null;
            const tooltip =
              totalKpi > 0
                ? `${col.label}: ${isMeasured ? `${col.val}%` : "Unmeasured"} (${measuredCount}/${totalKpi} active projects measured)`
                : `${col.label}: ${isMeasured ? `${col.val}%` : "Unmeasured"}`;

            return (
              <div
                key={col.label}
                title={tooltip}
                className="flex flex-col items-center gap-0.5 h-full justify-end"
              >
                <span className="text-[10px] ps-mono font-medium tabular-nums text-[var(--ps-ink-secondary)]">
                  {isMeasured ? `${col.val}%` : "—"}
                </span>
                <div className="w-full max-w-[30px] h-7 rounded-sm bg-[var(--ps-surface-2)] overflow-hidden flex items-end">
                  <div
                    style={{
                      height: isMeasured
                        ? `${Math.max(4, Math.min(100, Number(col.val)))}%`
                        : "0%",
                      backgroundColor: col.color,
                    }}
                    className="w-full rounded-t-sm transition-all duration-300"
                  />
                </div>
                <span className="text-[10px] ps-mono text-[var(--ps-ink-muted)] leading-none">
                  {col.label}
                </span>
                {measuredHint && (
                  <span className="text-[9px] ps-mono tabular-nums text-[var(--ps-ink-muted)] leading-none">
                    {measuredHint}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Col 3: Execution Scale & Pass/Fail Ratio ─────────────────── */}
      <div className="p-4 sm:p-5 flex flex-col justify-between gap-4">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs text-[var(--ps-ink-muted)]">
              Executed tests
            </span>
            <div className="flex items-baseline gap-2 mt-1 ps-mono tabular-nums">
              <span className="text-2xl font-bold text-[var(--ps-ink)]">
                {totalTests}
              </span>
              <span className="text-xs text-[var(--ps-ink-secondary)]">
                {hasPassRate ? `${passRate}% pass` : "No runs"}
              </span>
            </div>
          </div>
          {speedup > 1 && (
            <span className="text-[11px] ps-mono tabular-nums text-[var(--ps-ink-secondary)]">
              {speedup}x faster
            </span>
          )}
        </div>

        <div className="space-y-2.5">
          <div className="h-1.5 w-full rounded-full bg-[var(--ps-surface-2)] overflow-hidden flex">
            {hasPassRate && (
              <div
                style={{ width: `${Math.min(100, passRate)}%` }}
                className="bg-[var(--ps-emerald)]"
              />
            )}
            {totalTests > 0 && totalFailed > 0 && (
              <div
                style={{ width: `${Math.max(0, 100 - (passRate ?? 0))}%` }}
                className="bg-[var(--ps-rose)]"
              />
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] ps-mono tabular-nums">
            <span className="text-[var(--ps-ink-muted)]">
              Auto <strong className="text-[var(--ps-ink)]">{autoDuration}</strong>
            </span>
            <span className="text-[var(--ps-ink-muted)]">
              Est. Manual{" "}
              <strong className="text-[var(--ps-ink-secondary)]">{manualDuration}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* ── Col 4: QA Time Saved (Est.) & Synthesis Breakdown ────────── */}
      <div className="p-4 sm:p-5 flex flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-xs text-[var(--ps-ink-muted)]">
              QA time saved (Est.)
            </span>
            <div className="text-2xl font-bold ps-mono tabular-nums text-[var(--ps-ink)] mt-1">
              +{totalQaHoursSaved.toFixed(1)}h
            </div>
          </div>
          <span
            className="text-[10px] ps-mono text-[var(--ps-ink-muted)] px-1.5 py-0.5 rounded bg-[var(--ps-surface-2)] border border-[var(--ps-line)] shrink-0"
            title={PORTFOLIO_ROI_BASELINE.methodologyNote}
          >
            {PORTFOLIO_ROI_BASELINE.label}
          </span>
        </div>

        <div className="space-y-2.5">
          <div className="h-1.5 w-full rounded-full bg-[var(--ps-surface-2)] overflow-hidden flex gap-0.5">
            {aiGenerated > 0 && (
              <div
                style={{ width: `${(aiGenerated / aiSum) * 100}%` }}
                className="bg-[var(--ps-cobalt)]"
              />
            )}
            {aiRepaired > 0 && (
              <div
                style={{ width: `${(aiRepaired / aiSum) * 100}%` }}
                className="bg-[var(--ps-emerald)]"
              />
            )}
            {aiGaps > 0 && (
              <div
                style={{ width: `${(aiGaps / aiSum) * 100}%` }}
                className="bg-[var(--ps-amber)]"
              />
            )}
          </div>

          <div className="grid grid-cols-3 gap-1 text-center ps-mono text-[11px] tabular-nums">
            <div title="AI-generated test specs & scenarios on active snapshot">
              <div className="font-semibold text-[var(--ps-ink)]">{aiGenerated}</div>
              <div className="text-[10px] text-[var(--ps-ink-muted)]">Generated</div>
            </div>
            <div title="Self-healed / regenerated tests & applied system proposals">
              <div className="font-semibold text-[var(--ps-ink)]">{aiRepaired}</div>
              <div className="text-[10px] text-[var(--ps-ink-muted)]">Healed</div>
            </div>
            <div title="Uncovered API endpoints + low-branch unit files across Doing projects">
              <div className="font-semibold text-[var(--ps-ink)]">{aiGaps}</div>
              <div className="text-[10px] text-[var(--ps-ink-muted)]">Gaps</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default memo(PortfolioExecutiveKpiRow);
