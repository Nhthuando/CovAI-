import { memo, useState } from "react";
import { Zap, Clock, TrendingUp, Info } from "lucide-react";
import ContextualMetricTooltip from "../primitives/ContextualMetricTooltip.jsx";

function TimeSavedRoiChart({
  projects = [],
  timeRoiAnalytics = null,
  onHighlightProject,
  className = "",
}) {
  const [hoveredProjectId, setHoveredProjectId] = useState(null);

  // Filter only active projects that have run or test metrics
  const activeProjects = (projects || []).filter(
    (p) => !p.isExcludedFromActiveKpis && p.lifecycleStatus === "DOING"
  );

  // Compute summary values if timeRoiAnalytics is not already provided
  const totalAutoSeconds =
    timeRoiAnalytics?.totalAutoExecutionSeconds ??
    activeProjects.reduce((acc, p) => acc + (p.timeRoi?.actualAutoDurationMs || 0) / 1000, 0);

  const totalManualHours =
    timeRoiAnalytics?.totalManualExecutionHours ??
    activeProjects.reduce((acc, p) => acc + (p.timeRoi?.estimatedManualDurationMs || 0) / 3600000, 0);

  const totalHoursSaved =
    timeRoiAnalytics?.totalQaHoursSaved ??
    activeProjects.reduce((acc, p) => acc + (p.timeRoi?.totalHoursSaved || 0), 0);

  const avgSpeedup =
    timeRoiAnalytics?.averageSpeedupMultiplier ??
    (totalAutoSeconds > 0
      ? Number(((totalManualHours * 3600) / totalAutoSeconds).toFixed(1))
      : 0);

  // Maximum manual duration among projects to scale the horizontal bars
  const maxManualMs = Math.max(
    1,
    ...activeProjects.map((p) => p.timeRoi?.estimatedManualDurationMs || 0)
  );

  return (
    <div className={`relative space-y-4 font-sans ${className}`}>
      {/* ── Summary KPI Strip ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
        <div className="p-2 rounded bg-[var(--ud-surface-2)]/70 border border-[var(--ud-border)]">
          <div className="text-[10px] text-[var(--ud-text-muted)] uppercase font-bold flex items-center justify-between">
            <span>Auto Duration</span>
            <Zap className="w-3 h-3 text-[var(--ud-unit)]" />
          </div>
          <div className="text-sm font-bold text-[var(--ud-text)] mt-1 tabular-nums">
            {totalAutoSeconds.toFixed(1)}s
          </div>
          <div className="text-[10px] text-[var(--ud-text-muted)]">Across active suites</div>
        </div>

        <div className="p-2 rounded bg-[var(--ud-surface-2)]/70 border border-[var(--ud-border)]">
          <div className="text-[10px] text-[var(--ud-text-muted)] uppercase font-bold flex items-center justify-between">
            <span>Manual Benchmark</span>
            <Clock className="w-3 h-3 text-[var(--ud-warn)]" />
          </div>
          <div className="text-sm font-bold text-[var(--ud-text)] mt-1 tabular-nums">
            {totalManualHours.toFixed(1)} hrs
          </div>
          <div className="text-[10px] text-[var(--ud-text-muted)]">Standard QA effort</div>
        </div>

        <div className="p-2 rounded bg-[var(--ud-surface-2)]/70 border border-[var(--ud-border)]">
          <div className="text-[10px] text-[var(--ud-text-muted)] uppercase font-bold flex items-center justify-between">
            <span>Net QA Saved</span>
            <TrendingUp className="w-3 h-3 text-[var(--ud-pass)]" />
          </div>
          <div className="text-sm font-bold text-[var(--ud-pass)] mt-1 tabular-nums">
            +{totalHoursSaved.toFixed(1)} hrs
          </div>
          <div className="text-[10px] text-[var(--ud-text-muted)]">Dev & QA hours</div>
        </div>

        <div className="p-2 rounded bg-[var(--ud-surface-2)]/70 border border-[var(--ud-border)]">
          <div className="text-[10px] text-[var(--ud-text-muted)] uppercase font-bold flex items-center justify-between">
            <span>Avg Speedup</span>
            <span className="text-[10px] text-[var(--ud-unit)] font-bold">⚡ ROI</span>
          </div>
          <div className="text-sm font-bold text-[var(--ud-unit)] mt-1 tabular-nums">
            {avgSpeedup > 0 ? `${avgSpeedup}x` : "—"}
          </div>
          <div className="text-[10px] text-[var(--ud-text-muted)]">Execution velocity</div>
        </div>
      </div>

      {/* ── Header with Guidance Tooltip ───────────────────────────────────── */}
      <div className="flex items-center justify-between text-xs px-1">
        <span className="text-[11px] font-mono text-[var(--ud-text-muted)]">
          Project Execution Efficiency (Machine vs. Manual QA Effort)
        </span>
        <ContextualMetricTooltip
          title="Time & QA ROI Calculation"
          meaning="Measures test execution time reduction and AI authoring savings vs. industry standard manual test execution benchmarks."
          formula="Manual = Unit*120s + API*300s + E2E*480s | AI Saved = 15m/test | Speedup = Manual / Auto"
          provenance="Industry QA norms (IEEE 829 / Capers Jones QA baseline) calibrated with live PostgreSQL TestRuns"
          tip="Click any project row to inspect its quality details."
          placement="bottom-right"
        >
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--ud-surface-2)] border border-[var(--ud-border)] text-[10px] text-[var(--ud-text-muted)] hover:text-[var(--ud-unit)] hover:border-[var(--ud-unit)]/40 transition-colors cursor-pointer"
          >
            <Info className="w-3 h-3" />
            <span>Benchmark Formula</span>
          </button>
        </ContextualMetricTooltip>
      </div>

      {/* ── Project Horizontal Bars ────────────────────────────────────────── */}
      <div className="space-y-2.5 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-3 max-h-[380px] overflow-y-auto">
        {activeProjects.length === 0 ? (
          <div className="py-8 text-center text-xs text-[var(--ud-text-muted)] font-mono">
            No active DOING projects with execution data available.
          </div>
        ) : (
          activeProjects.map((p) => {
            const timeRoi = p.timeRoi || {};
            const speedup = timeRoi.speedupMultiplier || 0;
            const autoMs = timeRoi.actualAutoDurationMs || 0;
            const manualMs = timeRoi.estimatedManualDurationMs || 0;
            const hours = timeRoi.totalHoursSaved || 0;

            const barWidthPct = Math.min(100, Math.max(4, Math.round((manualMs / maxManualMs) * 100)));
            const isHovered = hoveredProjectId === p.id;

            return (
              <div
                key={p.id}
                onMouseEnter={() => setHoveredProjectId(p.id)}
                onMouseLeave={() => setHoveredProjectId(null)}
                onClick={() => onHighlightProject?.(p.id)}
                className={`p-2 rounded border transition-all cursor-pointer ${
                  isHovered
                    ? "bg-[var(--ud-surface-2)] border-[var(--ud-unit)]/40 shadow-xs"
                    : "bg-[var(--ud-surface-2)]/50 border-[var(--ud-border)] hover:border-[var(--ud-border-strong)]"
                }`}
              >
                {/* Row Header */}
                <div className="flex items-center justify-between text-xs mb-1.5 font-mono">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-[var(--ud-text)] truncate">{p.name}</span>
                    <span className="text-[10px] text-[var(--ud-text-muted)]">
                      {timeRoi.actualAutoDurationFormatted || `${(autoMs / 1000).toFixed(1)}s`} auto
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-[var(--ud-text-muted)]">
                      Est Manual: {timeRoi.estimatedManualDurationFormatted || "0s"}
                    </span>
                    {speedup > 1 && (
                      <span className="px-1.5 py-0.5 rounded bg-[var(--ud-unit)]/10 border border-[var(--ud-unit)]/30 text-[10px] text-[var(--ud-unit)] font-bold">
                        ⚡ {speedup}x ({hours}h saved)
                      </span>
                    )}
                  </div>
                </div>

                {/* Comparative Bar */}
                <div className="w-full bg-[var(--ud-surface)] rounded-full h-2 overflow-hidden flex border border-[var(--ud-border)]/50">
                  {/* Auto duration (green portion) */}
                  <div
                    className="bg-[var(--ud-pass)] h-full transition-all duration-500 rounded-l-full"
                    style={{ width: `${Math.max(2, (autoMs / (manualMs || 1)) * barWidthPct)}%` }}
                    title={`Auto: ${(autoMs / 1000).toFixed(1)}s`}
                  />
                  {/* Saved duration (blue portion) */}
                  <div
                    className="bg-[var(--ud-unit)] h-full transition-all duration-500 rounded-r-full"
                    style={{
                      width: `${Math.max(0, barWidthPct - (autoMs / (manualMs || 1)) * barWidthPct)}%`,
                    }}
                    title={`Time Saved: ${hours} hrs`}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default memo(TimeSavedRoiChart);

