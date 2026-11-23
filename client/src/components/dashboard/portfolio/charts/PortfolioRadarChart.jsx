import { memo } from "react";

const AXES = [
  { key: "unit", label: "Unit" },
  { key: "api", label: "API" },
  { key: "e2e", label: "E2E" },
  { key: "pass", label: "Pass" },
  { key: "health", label: "Health" },
];

function polarToCartesian(cx, cy, r, angleRad) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function buildPolygonPoints(values, cx, cy, maxR) {
  return values
    .map((v, idx) => {
      const angle = (Math.PI * 2 * idx) / values.length - Math.PI / 2;
      const r = (Math.max(0, Math.min(100, v)) / 100) * maxR;
      const pt = polarToCartesian(cx, cy, r, angle);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    })
    .join(" ");
}

export function PortfolioRadarChart({
  kpis = {},
  selectedProject = null,
  className = "",
}) {
  const c1 = kpis.card1Health || {};
  const c2 = kpis.card2Coverage || {};
  const c3 = kpis.card3Scale || {};

  const portfolioValues = [
    c2.avgUnitCoveragePct ?? 0,
    c2.avgIntegrationCoveragePct ?? 0,
    c2.avgSystemCoveragePct ?? 0,
    c3.overallPassRatePct ?? 0,
    c1.avgHealthScore ?? 0,
  ];

  const targetValues = [80, 80, 80, 90, 80];

  const projectValues = selectedProject
    ? [
        selectedProject.pillars?.unit?.coveragePct ?? 0,
        selectedProject.pillars?.integration?.coveragePct ?? 0,
        selectedProject.pillars?.system?.coveragePct ?? 0,
        selectedProject.passRatePct ?? 0,
        selectedProject.healthScore ?? 0,
      ]
    : null;

  const size = 240;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const maxR = 76;

  return (
    <div className={`flex flex-col items-center justify-between ${className}`}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full max-w-[235px] h-auto select-none overflow-visible"
        aria-label="5-Axis Quality Radar"
      >
        {/* Concentric Pentagon Rings */}
        {[25, 50, 75, 100].map((pct) => (
          <polygon
            key={pct}
            points={buildPolygonPoints([pct, pct, pct, pct, pct], cx, cy, maxR)}
            fill="none"
            stroke="var(--ud-border)"
            strokeWidth="1"
            strokeDasharray={pct === 75 ? "2 2" : undefined}
          />
        ))}

        {/* Axis Spokes & Labels */}
        {AXES.map((axis, idx) => {
          const angle = (Math.PI * 2 * idx) / AXES.length - Math.PI / 2;
          const outer = polarToCartesian(cx, cy, maxR, angle);
          const labelPt = polarToCartesian(cx, cy, maxR + 18, angle);
          const val = portfolioValues[idx];
          return (
            <g key={axis.key}>
              <line
                x1={cx}
                y1={cy}
                x2={outer.x}
                y2={outer.y}
                stroke="var(--ud-border)"
                strokeWidth="1"
              />
              <text
                x={labelPt.x}
                y={labelPt.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-[9.5px] font-mono fill-[var(--ud-text-muted)]"
              >
                {axis.label} ({val}%)
              </text>
            </g>
          );
        })}

        {/* 80% Target Polygon */}
        <polygon
          points={buildPolygonPoints(targetValues, cx, cy, maxR)}
          fill="none"
          stroke="var(--ud-pass)"
          strokeWidth="1.2"
          strokeDasharray="3 3"
          strokeOpacity="0.6"
        />

        {/* Portfolio Average Polygon */}
        <polygon
          points={buildPolygonPoints(portfolioValues, cx, cy, maxR)}
          fill="var(--ud-unit)"
          fillOpacity="0.18"
          stroke="var(--ud-unit)"
          strokeWidth="2"
        />

        {/* Highlighted Project Overlay */}
        {projectValues && (
          <polygon
            points={buildPolygonPoints(projectValues, cx, cy, maxR)}
            fill="var(--ud-integration)"
            fillOpacity="0.22"
            stroke="var(--ud-integration)"
            strokeWidth="2"
          />
        )}
      </svg>

      <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] font-mono text-[var(--ud-text-muted)] mt-1">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-xs bg-[var(--ud-unit)]" />
          Portfolio Avg
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-0 border-t border-dashed border-[var(--ud-pass)]" />
          Target
        </span>
        {selectedProject && (
          <span className="inline-flex items-center gap-1 text-[var(--ud-integration)]">
            <span className="w-2 h-2 rounded-xs bg-[var(--ud-integration)]" />
            {selectedProject.name}
          </span>
        )}
      </div>
    </div>
  );
}

export default memo(PortfolioRadarChart);
