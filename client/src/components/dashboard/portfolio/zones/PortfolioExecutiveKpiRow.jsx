import { memo } from "react";
import RadialHealthGauge from "../primitives/RadialHealthGauge.jsx";

export function PortfolioExecutiveKpiRow({
  kpis = {},
  lifecycleCounts = null,
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

  const unitCov = card2.avgUnitCoveragePct ?? 0;
  const intCov = card2.avgIntegrationCoveragePct ?? 0;
  const sysCov = card2.avgSystemCoveragePct ?? 0;

  const totalTests = card3.totalExecutedTests ?? 0;
  const passRate = card3.overallPassRatePct ?? 0;
  const speedup = timeRoi.averageSpeedupMultiplier || 0;
  const autoDuration =
    timeRoi.totalAutoExecutionDurationFormatted || card3.cumulativeDurationStr || "0s";
  const manualDuration = timeRoi.totalManualExecutionDurationFormatted || "0s";

  const totalQaHoursSaved = timeRoi.totalQaHoursSaved ?? 0;
  const aiTests = card4.totalAiTests ?? 0;
  const aiRepaired = card4.aiRepairedCount ?? 0;
  const aiGaps = card4.uncoveredGapsCount ?? 0;
  const aiSum = Math.max(1, aiTests + aiRepaired + aiGaps);

  return (
    <section
      id="portfolio-executive-kpi-row"
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
            <div className="flex items-baseline gap-1.5 mt-1 ps-mono">
              <span className="text-2xl font-bold text-[var(--ps-ink)]">
                {card1.avgHealthScore ?? 0}
              </span>
              <span className="text-xs text-[var(--ps-ink-muted)]">/ 100</span>
            </div>
          </div>

          <RadialHealthGauge
            score={card1.avgHealthScore ?? 0}
            grade={card1.grade || "—"}
            isTested={(card1.totalProjects || 0) > 0 && (card1.avgHealthScore ?? 0) > 0}
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
              { label: "Doing", val: doingCount, dot: "bg-[var(--ps-cobalt)]" },
              { label: "Done", val: completedCount, dot: "bg-[var(--ps-emerald)]" },
              { label: "New", val: notStartedCount, dot: "bg-[var(--ps-neutral)]" },
              { label: "Hold", val: pausedOrCancelled, dot: "bg-[var(--ps-amber)]" },
            ].map((item) => (
              <div key={item.label} className="py-0.5">
                <div className="font-semibold text-[var(--ps-ink)]">{item.val}</div>
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
            <div className="text-2xl font-bold ps-mono text-[var(--ps-ink)] mt-1">
              {card2.unifiedCoveragePct ?? 0}%
            </div>
          </div>
          <span className="text-[11px] ps-mono text-[var(--ps-ink-muted)]">
            80% goal
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 items-end h-14 relative pt-1">
          <div
            style={{ bottom: "76%" }}
            className="absolute inset-x-0 border-t border-dashed border-[var(--ps-line-strong)] pointer-events-none"
          />
          {[
            { label: "Unit", val: unitCov, color: "var(--ps-cobalt)" },
            { label: "API", val: intCov, color: "var(--ps-indigo)" },
            { label: "E2E", val: sysCov, color: "var(--ps-teal)" },
          ].map((col) => (
            <div key={col.label} className="flex flex-col items-center gap-1 h-full justify-end">
              <span className="text-[10px] ps-mono font-medium text-[var(--ps-ink-secondary)]">
                {col.val}%
              </span>
              <div className="w-full max-w-[30px] h-8 rounded-sm bg-[var(--ps-surface-2)] overflow-hidden flex items-end">
                <div
                  style={{
                    height: `${Math.max(5, Math.min(100, col.val))}%`,
                    backgroundColor: col.color,
                  }}
                  className="w-full rounded-t-sm transition-all duration-300"
                />
              </div>
              <span className="text-[10px] ps-mono text-[var(--ps-ink-muted)]">
                {col.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Col 3: Execution Scale & Pass/Fail Ratio ─────────────────── */}
      <div className="p-4 sm:p-5 flex flex-col justify-between gap-4">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs text-[var(--ps-ink-muted)]">
              Executed tests
            </span>
            <div className="flex items-baseline gap-2 mt-1 ps-mono">
              <span className="text-2xl font-bold text-[var(--ps-ink)]">
                {totalTests}
              </span>
              <span className="text-xs text-[var(--ps-ink-secondary)]">
                {passRate}% pass
              </span>
            </div>
          </div>
          {speedup > 1 && (
            <span className="text-[11px] ps-mono text-[var(--ps-ink-secondary)]">
              {speedup}x faster
            </span>
          )}
        </div>

        <div className="space-y-2.5">
          <div className="h-1.5 w-full rounded-full bg-[var(--ps-surface-2)] overflow-hidden flex">
            <div
              style={{ width: `${Math.min(100, passRate)}%` }}
              className="bg-[var(--ps-emerald)]"
            />
            {totalTests > 0 && passRate < 100 && (
              <div
                style={{ width: `${Math.max(0, 100 - passRate)}%` }}
                className="bg-[var(--ps-rose)]"
              />
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] ps-mono">
            <span className="text-[var(--ps-ink-muted)]">
              Auto <strong className="text-[var(--ps-ink)]">{autoDuration}</strong>
            </span>
            <span className="text-[var(--ps-ink-muted)]">
              Manual <strong className="text-[var(--ps-ink-secondary)]">{manualDuration}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* ── Col 4: QA Time Saved & Synthesis Breakdown ───────────────── */}
      <div className="p-4 sm:p-5 flex flex-col justify-between gap-4">
        <div>
          <span className="text-xs text-[var(--ps-ink-muted)]">
            QA time saved
          </span>
          <div className="text-2xl font-bold ps-mono text-[var(--ps-ink)] mt-1">
            +{totalQaHoursSaved.toFixed(1)}h
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="h-1.5 w-full rounded-full bg-[var(--ps-surface-2)] overflow-hidden flex gap-0.5">
            {aiTests > 0 && (
              <div
                style={{ width: `${(aiTests / aiSum) * 100}%` }}
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

          <div className="grid grid-cols-3 gap-1 text-center ps-mono text-[11px]">
            <div>
              <div className="font-semibold text-[var(--ps-ink)]">{aiTests}</div>
              <div className="text-[10px] text-[var(--ps-ink-muted)]">Generated</div>
            </div>
            <div>
              <div className="font-semibold text-[var(--ps-ink)]">{aiRepaired}</div>
              <div className="text-[10px] text-[var(--ps-ink-muted)]">Healed</div>
            </div>
            <div>
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
