import { useState } from "react";
import { ZonePanel } from "../primitives/ZonePanel.jsx";
import { SegmentedFilter } from "../primitives/SegmentedFilter.jsx";
import { CoverageTrendChart } from "../charts/CoverageTrendChart.jsx";
import { fmtPct, fmtCount, fmtDuration } from "../../../../services/unifiedDashboard/format.js";
import { getPassRate } from "../../../../services/unifiedDashboard/unifiedDashboard.selectors.js";

/**
 * TierComparisonBarChart
 * Crisp SVG grouped bar chart comparing Coverage % vs Pass Rate % across Unit, Integration, and System tiers
 * against the 80% quality target threshold.
 */
function TierComparisonBarChart({ vm, loading = false, onNavigateWorkspace }) {
  const [hoveredTier, setHoveredTier] = useState(null);
  const [chartMode, setChartMode] = useState("both"); // "both" | "coverage" | "pass_rate"

  const unitPillar = vm?.pillars?.unit || {};
  const intPillar = vm?.pillars?.integration || {};
  const sysPillar = vm?.pillars?.system || {};
  const coverage = vm?.coverage || {};

  const computePassRate = (p) => {
    if (p.passRate !== undefined && p.passRate !== null && Number(p.totalTests || 0) > 0) {
      return Number(p.passRate);
    }
    return getPassRate(p.passedTests, p.failedTests) ?? 0;
  };

  const tiers = [
    {
      key: "unit",
      label: "Unit",
      subLabel: unitPillar.framework || "Jest",
      coveragePct: Number(coverage.codePct ?? unitPillar.coverageMetrics?.lines ?? 0),
      passRatePct: computePassRate(unitPillar),
      passed: Number(unitPillar.passedTests || 0),
      failed: Number(unitPillar.failedTests || 0),
      total: Number(unitPillar.totalTests || 0),
      durationMs: Number(unitPillar.durationMs || 0),
      color: "var(--ud-unit)",
    },
    {
      key: "integration",
      label: "Integration",
      subLabel: intPillar.framework || "Supertest",
      coveragePct: Number(coverage.apiPct ?? intPillar.coverageMetrics?.apiEndpoint ?? 0),
      passRatePct: computePassRate(intPillar),
      passed: Number(intPillar.passedTests || 0),
      failed: Number(intPillar.failedTests || 0),
      total: Number(intPillar.totalTests || 0),
      durationMs: Number(intPillar.durationMs || 0),
      color: "var(--ud-integration)",
    },
    {
      key: "system",
      label: "System E2E",
      subLabel: sysPillar.framework || "Playwright",
      coveragePct: Number(coverage.flowPct ?? sysPillar.coverageMetrics?.flow ?? 0),
      passRatePct: computePassRate(sysPillar),
      passed: Number(sysPillar.passedTests || 0),
      failed: Number(sysPillar.failedTests || 0),
      total: Number(sysPillar.totalTests || 0),
      durationMs: Number(sysPillar.durationMs || 0),
      color: "var(--ud-system)",
    },
  ];

  const svgWidth = 540;
  const svgHeight = 220;
  const padLeft = 40;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 38;
  const chartW = svgWidth - padLeft - padRight;
  const chartH = svgHeight - padTop - padBottom;

  const getY = (val) => {
    const safe = Math.max(0, Math.min(100, Number(val) || 0));
    return padTop + chartH - (safe / 100) * chartH;
  };

  const targetY = getY(80);
  const groupWidth = chartW / tiers.length;

  return (
    <ZonePanel
      id="ud-zone-tier-chart"
      title="Multi-Tier Coverage & Pass Rate"
      description="Live comparison across testing layers vs 80% target"
      contentClassName="p-4"
      className="h-full"
      actions={
        <SegmentedFilter
          idPrefix="ud-tier-chart-mode"
          options={[
            { label: "Both", value: "both" },
            { label: "Coverage", value: "coverage" },
            { label: "Pass Rate", value: "pass_rate" },
          ]}
          value={chartMode}
          onChange={setChartMode}
          size="sm"
        />
      }
    >
      <div className="space-y-3">
        <div className="relative w-full overflow-hidden">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-auto select-none"
            role="img"
            aria-label="Grouped bar chart comparing Coverage and Pass Rate across Unit, Integration, and System tiers"
          >
            {/* Horizontal grid lines & Y-axis */}
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
                    strokeDasharray={tick === 0 ? undefined : "3 3"}
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

            {/* 80% Quality Target Threshold Line */}
            <line
              x1={padLeft}
              y1={targetY}
              x2={svgWidth - padRight}
              y2={targetY}
              stroke="var(--ud-pass)"
              strokeOpacity="0.45"
              strokeDasharray="5 4"
              strokeWidth="1.2"
            />
            <text
              x={svgWidth - padRight - 2}
              y={targetY - 5}
              textAnchor="end"
              fill="var(--ud-text-muted)"
              fontSize="9.5"
              fontFamily="var(--font-mono)"
              fontWeight="600"
            >
              Target 80%
            </text>

            {/* Tier Bar Groups */}
            {tiers.map((tier, idx) => {
              const centerX = padLeft + groupWidth * idx + groupWidth / 2;
              const isHovered = hoveredTier?.key === tier.key;

              const showCov = chartMode === "both" || chartMode === "coverage";
              const showPass = chartMode === "both" || chartMode === "pass_rate";
              const barW = chartMode === "both" ? 28 : 42;
              const gap = chartMode === "both" ? 8 : 0;

              const covX = chartMode === "both" ? centerX - barW - gap / 2 : centerX - barW / 2;
              const passX = chartMode === "both" ? centerX + gap / 2 : centerX - barW / 2;

              const covVal = loading ? 0 : Math.max(0, Math.min(100, tier.coveragePct));
              const passVal = loading ? 0 : Math.max(0, Math.min(100, tier.passRatePct));

              const covY = getY(covVal);
              const covH = Math.max(covVal > 0 ? 3 : 2, padTop + chartH - covY);

              const passY = getY(passVal);
              const passH = Math.max(passVal > 0 ? 3 : 2, padTop + chartH - passY);

              return (
                <g
                  key={tier.key}
                  onMouseEnter={() => !loading && setHoveredTier(tier)}
                  onMouseLeave={() => setHoveredTier(null)}
                  onClick={() => !loading && onNavigateWorkspace?.(tier.key)}
                  className={loading ? "" : "cursor-pointer"}
                >
                  {/* Subtle hover column highlight */}
                  <rect
                    x={padLeft + groupWidth * idx + 12}
                    y={padTop}
                    width={groupWidth - 24}
                    height={chartH}
                    rx="4"
                    fill="var(--ud-surface-2)"
                    fillOpacity={isHovered ? "0.55" : "0"}
                  />

                  {/* Coverage Bar */}
                  {showCov && (
                    <g>
                      <rect
                        x={covX}
                        y={padTop}
                        width={barW}
                        height={chartH}
                        rx="3"
                        fill="var(--ud-surface-2)"
                        fillOpacity="0.45"
                      />
                      {!loading && (
                        <rect
                          x={covX}
                          y={covVal > 0 ? covY : padTop + chartH - 2}
                          width={barW}
                          height={covVal > 0 ? covH : 2}
                          rx="3"
                          fill={tier.color}
                          fillOpacity={covVal > 0 ? "0.85" : "0.35"}
                        />
                      )}
                      <text
                        x={covX + barW / 2}
                        y={Math.max(padTop - 6, (covVal > 0 ? covY : padTop + chartH) - 6)}
                        textAnchor="middle"
                        fill={!loading && covVal > 0 ? "var(--ud-text)" : "var(--ud-text-muted)"}
                        fontSize="10"
                        fontFamily="var(--font-mono)"
                        fontWeight="600"
                      >
                        {loading ? "--" : `${covVal.toFixed(0)}%`}
                      </text>
                    </g>
                  )}

                  {/* Pass Rate Bar */}
                  {showPass && (
                    <g>
                      <rect
                        x={passX}
                        y={padTop}
                        width={barW}
                        height={chartH}
                        rx="3"
                        fill="var(--ud-surface-2)"
                        fillOpacity="0.45"
                      />
                      {!loading && (
                        <rect
                          x={passX}
                          y={passVal > 0 ? passY : padTop + chartH - 2}
                          width={barW}
                          height={passVal > 0 ? passH : 2}
                          rx="3"
                          fill={
                            tier.total === 0
                              ? "var(--ud-text-muted)"
                              : passVal >= 80
                              ? "var(--ud-pass)"
                              : passVal >= 50
                              ? "var(--ud-warn)"
                              : "var(--ud-fail)"
                          }
                          fillOpacity={tier.total > 0 ? "0.82" : "0.25"}
                        />
                      )}
                      <text
                        x={passX + barW / 2}
                        y={Math.max(padTop - 6, (passVal > 0 ? passY : padTop + chartH) - 6)}
                        textAnchor="middle"
                        fill={!loading && tier.total > 0 ? "var(--ud-text)" : "var(--ud-text-muted)"}
                        fontSize="10"
                        fontFamily="var(--font-mono)"
                        fontWeight="600"
                      >
                        {!loading && tier.total > 0 ? `${passVal.toFixed(0)}%` : "--"}
                      </text>
                    </g>
                  )}

                  {/* X-Axis Tier Label */}
                  <text
                    x={centerX}
                    y={svgHeight - 18}
                    textAnchor="middle"
                    fill="var(--ud-text)"
                    fontSize="11"
                    fontWeight="600"
                  >
                    {tier.label}
                  </text>
                  <text
                    x={centerX}
                    y={svgHeight - 5}
                    textAnchor="middle"
                    fill="var(--ud-text-muted)"
                    fontSize="9.5"
                    fontFamily="var(--font-mono)"
                  >
                    {loading
                      ? tier.subLabel
                      : tier.total > 0
                      ? `${tier.passed}/${tier.total} pass`
                      : `${tier.subLabel} · Not Run`}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Footer Legend & Hover Details */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--ud-border)] text-[11px]">
          <div className="flex flex-wrap items-center gap-3 text-[var(--ud-text-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[var(--ud-unit)] inline-block" />
              <span>Coverage %</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[var(--ud-pass)] inline-block" />
              <span>Pass Rate %</span>
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono">
              <span className="w-3 border-t border-dashed border-[var(--ud-pass)] inline-block" />
              <span>80% Gate</span>
            </span>
          </div>

          {hoveredTier ? (
            <div className="font-mono text-[var(--ud-text)] tabular-nums">
              {hoveredTier.label}: <span className="font-semibold">{fmtPct(hoveredTier.coveragePct)}</span> cov ·{" "}
              {fmtCount(hoveredTier.passed)}/{fmtCount(hoveredTier.total)} pass ·{" "}
              {fmtDuration(hoveredTier.durationMs)}
            </div>
          ) : (
            <div className="font-mono text-[var(--ud-text-muted)]">
              Click any tier bar group to open workspace
            </div>
          )}
        </div>
      </div>
    </ZonePanel>
  );
}

export function QualityChartsRow({ vm, loading = false, onNavigateWorkspace, className = "" }) {
  const trend = vm?.trend || {};

  return (
    <div className={`grid grid-cols-12 gap-4 ${className}`}>
      <div className="col-span-12 xl:col-span-6">
        <TierComparisonBarChart
          vm={vm}
          loading={loading}
          onNavigateWorkspace={onNavigateWorkspace}
        />
      </div>
      <div className="col-span-12 xl:col-span-6">
        <CoverageTrendChart trendData={trend} vm={vm} loading={loading} />
      </div>
    </div>
  );
}

export default QualityChartsRow;
