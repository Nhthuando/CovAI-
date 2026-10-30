import { useState } from "react";
import { SegmentedFilter } from "../primitives/SegmentedFilter.jsx";
import { ZonePanel } from "../primitives/ZonePanel.jsx";
import { fmtPct } from "../../../../services/unifiedDashboard/format.js";

export function CoverageTrendChart({
  trendData,
  className = "",
}) {
  const [viewMode, setViewMode] = useState("trend"); // 'trend' | 'before_after'
  const [activeMetric, setActiveMetric] = useState("coverage"); // 'coverage' | 'pass_rate'
  const [hoveredPoint, setHoveredPoint] = useState(null);

  const series = trendData?.series || [];
  const beforeAfter = trendData?.beforeAfter || {
    before: { unit: 0, integration: 0, system: 0, unitPassRate: 0, integrationPassRate: 0, systemPassRate: 0 },
    after: { unit: 0, integration: 0, system: 0, unitPassRate: 0, integrationPassRate: 0, systemPassRate: 0 },
  };

  // SVG dimensions — padRight increased to 48px (+28px) to prevent right-most X-axis label clipping
  const svgWidth = 540;
  const svgHeight = 220;
  const padLeft = 42;
  const padRight = 48;
  const padTop = 20;
  const padBottom = 32;

  const chartW = svgWidth - padLeft - padRight;
  const chartH = svgHeight - padTop - padBottom;

  // Coordinate scaling: Y-axis 0% - 100%
  const getY = (val) => {
    const safe = Math.max(0, Math.min(100, Number(val) || 0));
    return padTop + chartH - (safe / 100) * chartH;
  };

  const getX = (idx, total) => {
    if (total <= 1) return padLeft + chartW / 2;
    return padLeft + (idx / (total - 1)) * chartW;
  };

  // Build SVG path string for a line
  const makePath = (accessor) => {
    if (series.length === 0) return "";
    return series
      .map((pt, i) => {
        const x = getX(i, series.length);
        const y = getY(accessor(pt));
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  };

  const unitPath = makePath((d) => d.unitCoverage);
  const intPath = makePath((d) => d.integrationCoverage);
  const sysPath = makePath((d) => d.systemCoverage);
  const passPath = makePath((d) => d.passRate);

  return (
    <ZonePanel
      id="ud-zone-trend"
      title="Coverage & Quality Trends"
      description="Historical trajectory & Before / After comparison"
      contentClassName="p-4"
      className={`h-full ${className}`}
      actions={
        <div className="flex items-center gap-2 ud-no-print">
          <SegmentedFilter
            idPrefix="ud-trend-view"
            options={[
              { label: "Trend", value: "trend" },
              { label: "Before / After", value: "before_after" },
            ]}
            value={viewMode}
            onChange={setViewMode}
            size="sm"
          />
          <SegmentedFilter
            idPrefix="ud-trend-metric"
            options={[
              { label: "Coverage", value: "coverage" },
              { label: "Pass Rate", value: "pass_rate" },
            ]}
            value={activeMetric}
            onChange={setActiveMetric}
            size="sm"
          />
        </div>
      }
    >
      {series.length === 0 ? (
        <div className="h-[220px] flex flex-col items-center justify-center text-center p-4 gap-2.5">
          <p className="text-xs font-semibold text-[var(--ud-text)]">
            No Historical Trend Points Recorded Yet
          </p>
          <p className="text-[11px] text-[var(--ud-text-muted)] max-w-xs font-sans">
            Execute Unit, Integration, or System E2E test suites to record chronological coverage and pass rate trend points.
          </p>
        </div>
      ) : viewMode === "trend" ? (
        <div className="space-y-3">
          {/* SVG Trend Line Chart */}
          <div className="relative w-full overflow-hidden">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-auto select-none"
              role="img"
              aria-label="Multi-tier coverage trend chart over recent test runs"
            >
              {/* Horizontal grid lines & Y-axis labels */}
              {[0, 25, 50, 75, 100].map((tick) => {
                const y = getY(tick);
                return (
                  <g key={tick}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={svgWidth - padRight}
                      y2={y}
                      stroke="var(--ud-border)"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3}
                      textAnchor="end"
                      fill="var(--ud-text-muted)"
                      fontSize="10"
                      fontFamily="var(--font-mono)"
                    >
                      {tick}%
                    </text>
                  </g>
                );
              })}

              {/* X-axis run labels — last label anchored slightly inward or end-aligned so '#6 (Current)' is never clipped */}
              {series.map((pt, i) => {
                const isLast = i === series.length - 1;
                const isFirst = i === 0 && series.length > 1;
                const x = getX(i, series.length);
                return (
                  <text
                    key={i}
                    x={isLast ? x + 12 : x}
                    y={svgHeight - 8}
                    textAnchor={isLast ? "end" : isFirst ? "start" : "middle"}
                    fill="var(--ud-text-muted)"
                    fontSize="10"
                    fontFamily="var(--font-mono)"
                  >
                    {pt.runLabel?.replace("Run ", "")}
                  </text>
                );
              })}

              {/* Data Lines */}
              {activeMetric === "coverage" ? (
                <>
                  {/* System (Teal) */}
                  <path
                    d={sysPath}
                    fill="none"
                    stroke="var(--ud-system)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  {/* Integration (Purple) */}
                  <path
                    d={intPath}
                    fill="none"
                    stroke="var(--ud-integration)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  {/* Unit (Blue) */}
                  <path
                    d={unitPath}
                    fill="none"
                    stroke="var(--ud-unit)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />

                  {/* Interactive Points */}
                  {series.map((pt, i) => {
                    const x = getX(i, series.length);
                    const yUnit = getY(pt.unitCoverage);
                    const yInt = getY(pt.integrationCoverage);
                    const ySys = getY(pt.systemCoverage);

                    return (
                      <g key={i}>
                        <circle
                          cx={x}
                          cy={yUnit}
                          r="3.5"
                          fill="var(--ud-surface)"
                          stroke="var(--ud-unit)"
                          strokeWidth="2"
                          onMouseEnter={() =>
                            setHoveredPoint({
                              label: pt.runLabel,
                              value: `Unit: ${fmtPct(pt.unitCoverage)}`,
                            })
                          }
                          onMouseLeave={() => setHoveredPoint(null)}
                          className="cursor-pointer"
                        />
                        <circle
                          cx={x}
                          cy={yInt}
                          r="3"
                          fill="var(--ud-surface)"
                          stroke="var(--ud-integration)"
                          strokeWidth="2"
                          onMouseEnter={() =>
                            setHoveredPoint({
                              label: pt.runLabel,
                              value: `Integration: ${fmtPct(pt.integrationCoverage)}`,
                            })
                          }
                          onMouseLeave={() => setHoveredPoint(null)}
                          className="cursor-pointer"
                        />
                        <circle
                          cx={x}
                          cy={ySys}
                          r="3"
                          fill="var(--ud-surface)"
                          stroke="var(--ud-system)"
                          strokeWidth="2"
                          onMouseEnter={() =>
                            setHoveredPoint({
                              label: pt.runLabel,
                              value: `System: ${fmtPct(pt.systemCoverage)}`,
                            })
                          }
                          onMouseLeave={() => setHoveredPoint(null)}
                          className="cursor-pointer"
                        />
                      </g>
                    );
                  })}
                </>
              ) : (
                <>
                  {/* Overall Pass Rate Line (Green) */}
                  <path
                    d={passPath}
                    fill="none"
                    stroke="var(--ud-pass)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  {series.map((pt, i) => {
                    const x = getX(i, series.length);
                    const y = getY(pt.passRate);
                    return (
                      <circle
                        key={i}
                        cx={x}
                        cy={y}
                        r="3.5"
                        fill="var(--ud-surface)"
                        stroke="var(--ud-pass)"
                        strokeWidth="2"
                        onMouseEnter={() =>
                          setHoveredPoint({
                            label: pt.runLabel,
                            value: `Pass Rate: ${fmtPct(pt.passRate)}`,
                          })
                        }
                        onMouseLeave={() => setHoveredPoint(null)}
                        className="cursor-pointer"
                      />
                    );
                  })}
                </>
              )}
            </svg>
          </div>

          {/* Interactive Legend & Tooltip readout */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1 border-t border-[var(--ud-border)]">
            <div className="flex items-center gap-3">
              {activeMetric === "coverage" ? (
                <>
                  <div className="flex items-center gap-1.5 font-sans text-xs">
                    <span className="w-2.5 h-1 bg-[var(--ud-unit)] rounded-full" />
                    <span className="text-[var(--ud-text-muted)]">Unit Coverage</span>
                  </div>
                  <div className="flex items-center gap-1.5 font-sans text-xs">
                    <span className="w-2.5 h-1 bg-[var(--ud-integration)] rounded-full" />
                    <span className="text-[var(--ud-text-muted)]">
                      Integration Coverage
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 font-sans text-xs">
                    <span className="w-2.5 h-1 bg-[var(--ud-system)] rounded-full" />
                    <span className="text-[var(--ud-text-muted)]">System Flow</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-1.5 font-sans text-xs">
                  <span className="w-2.5 h-1 bg-[var(--ud-pass)] rounded-full" />
                  <span className="text-[var(--ud-text-muted)]">
                    Multi-Suite Pass Rate %
                  </span>
                </div>
              )}
            </div>

            {/* Hovered point value readout */}
            <div className="font-mono text-xs text-[var(--ud-text)] font-semibold h-4">
              {hoveredPoint ? `${hoveredPoint.label}: ${hoveredPoint.value}` : ""}
            </div>
          </div>
        </div>
      ) : (
        /* Before / After Clustered Comparison View */
        <div className="space-y-4 py-2">
          <p className="text-xs text-[var(--ud-text-muted)] font-sans">
            {activeMetric === "pass_rate"
              ? "Comparison of test suite pass rates between initial baseline run and latest run."
              : "Comparison of coverage metrics between initial baseline run and latest run."}
          </p>

          <div className="space-y-3">
            {(activeMetric === "pass_rate"
              ? [
                  {
                    label: "Unit Suite Pass Rate",
                    before: beforeAfter.before.unitPassRate ?? beforeAfter.before.unit ?? 0,
                    after: beforeAfter.after.unitPassRate ?? beforeAfter.after.unit ?? 0,
                    color: "var(--ud-unit)",
                  },
                  {
                    label: "Integration API Pass Rate",
                    before:
                      beforeAfter.before.integrationPassRate ??
                      beforeAfter.before.integration ??
                      0,
                    after:
                      beforeAfter.after.integrationPassRate ??
                      beforeAfter.after.integration ??
                      0,
                    color: "var(--ud-integration)",
                  },
                  {
                    label: "System E2E Pass Rate",
                    before: beforeAfter.before.systemPassRate ?? beforeAfter.before.system ?? 0,
                    after: beforeAfter.after.systemPassRate ?? beforeAfter.after.system ?? 0,
                    color: "var(--ud-system)",
                  },
                ]
              : [
                  {
                    label: "Unit Code Coverage",
                    before: beforeAfter.before.unit ?? 0,
                    after: beforeAfter.after.unit ?? 0,
                    color: "var(--ud-unit)",
                  },
                  {
                    label: "API Endpoint Coverage",
                    before: beforeAfter.before.integration ?? 0,
                    after: beforeAfter.after.integration ?? 0,
                    color: "var(--ud-integration)",
                  },
                  {
                    label: "System Flow Coverage",
                    before: beforeAfter.before.system ?? 0,
                    after: beforeAfter.after.system ?? 0,
                    color: "var(--ud-system)",
                  },
                ]
            ).map((row, idx) => {
              const diff = Number(((Number(row.after) || 0) - (Number(row.before) || 0)).toFixed(1));
              return (
                <div key={idx} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[var(--ud-text)]">
                      {row.label}
                    </span>
                    <span
                      className={`font-mono text-xs tabular-nums font-semibold ${
                        diff > 0
                          ? "text-[var(--ud-pass)]"
                          : diff < 0
                          ? "text-[var(--ud-fail)]"
                          : "text-[var(--ud-text-muted)]"
                      }`}
                    >
                      {diff > 0 ? `+${diff}%` : `${diff}%`}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {/* Before */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-[var(--ud-text-muted)] font-mono">
                        <span>Baseline:</span>
                        <span>{fmtPct(row.before)}</span>
                      </div>
                      <div className="w-full bg-[var(--ud-surface-2)] h-2 rounded-full overflow-hidden border border-[var(--ud-border)]">
                        <div
                          className="h-full bg-[var(--ud-text-muted)]/50 rounded-full"
                          style={{ width: `${Math.min(100, Math.max(0, Number(row.before) || 0))}%` }}
                        />
                      </div>
                    </div>

                    {/* After */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-[var(--ud-text)] font-mono font-semibold">
                        <span>Current:</span>
                        <span>{fmtPct(row.after)}</span>
                      </div>
                      <div className="w-full bg-[var(--ud-surface-2)] h-2 rounded-full overflow-hidden border border-[var(--ud-border)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.max(0, Number(row.after) || 0))}%`,
                            backgroundColor: row.color,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ZonePanel>
  );
}

export default CoverageTrendChart;
