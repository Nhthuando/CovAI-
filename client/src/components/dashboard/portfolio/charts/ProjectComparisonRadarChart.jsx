import { memo } from "react";

const AXES = [
  { key: "unitCov", label: "Unit Cov", fullLabel: "Unit Line Coverage (%)" },
  { key: "apiCov", label: "API Cov", fullLabel: "API Endpoint Coverage (%)" },
  { key: "systemCov", label: "System Cov", fullLabel: "System Flow Coverage (%)" },
  { key: "passRate", label: "Pass Rate", fullLabel: "Execution Pass Rate (%)" },
  { key: "efficiency", label: "Time Eff", fullLabel: "Time ROI & Speedup Efficiency (0-100)" },
];

const COLORS = [
  { stroke: "#58a6ff", fill: "rgba(88, 166, 255, 0.25)", text: "#58a6ff" },
  { stroke: "#3fb950", fill: "rgba(63, 185, 80, 0.25)", text: "#3fb950" },
  { stroke: "#bc8cff", fill: "rgba(188, 140, 255, 0.25)", text: "#bc8cff" },
];

function getCoordinates(value, index, total, radius, cx, cy) {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const r = (clamped / 100) * radius;
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  };
}

function ProjectComparisonRadarChart({
  projects = [],
  size = 320,
  className = "",
}) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;
  const numAxes = AXES.length;
  const levels = [20, 40, 60, 80, 100];

  return (
    <div className={`flex flex-col items-center select-none font-mono ${className}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        {/* Background Grid Rings */}
        {levels.map((level) => {
          const points = Array.from({ length: numAxes })
            .map((_, i) => {
              const { x, y } = getCoordinates(level, i, numAxes, radius, cx, cy);
              return `${x},${y}`;
            })
            .join(" ");

          return (
            <polygon
              key={level}
              points={points}
              fill="none"
              stroke="var(--ud-border)"
              strokeDasharray={level === 100 ? "none" : "2,2"}
              strokeWidth={level === 100 ? 1.2 : 0.8}
            />
          );
        })}

        {/* Axis Spokes from Center */}
        {AXES.map((axis, i) => {
          const { x, y } = getCoordinates(100, i, numAxes, radius, cx, cy);
          const labelCoord = getCoordinates(120, i, numAxes, radius, cx, cy);

          return (
            <g key={axis.key}>
              <line
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke="var(--ud-border)"
                strokeWidth={1}
              />
              <text
                x={labelCoord.x}
                y={labelCoord.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-[var(--ud-text-muted)] text-[10px] font-semibold"
              >
                {axis.label}
              </text>
            </g>
          );
        })}

        {/* Project Polygons */}
        {projects.slice(0, 3).map((project, pIdx) => {
          const color = COLORS[pIdx % COLORS.length];

          // Compute 5 axis values from project
          const values = [
            project.radarScores?.unitCov ?? project.pillars?.unit?.coveragePct ?? 0,
            project.radarScores?.apiCov ?? project.pillars?.integration?.coveragePct ?? 0,
            project.radarScores?.systemCov ?? project.pillars?.system?.coveragePct ?? 0,
            project.radarScores?.passRate ?? project.passRatePct ?? 0,
            project.radarScores?.efficiency ?? project.timeRoi?.efficiencyScore ?? 50,
          ];

          const polygonPoints = values
            .map((val, i) => {
              const { x, y } = getCoordinates(val, i, numAxes, radius, cx, cy);
              return `${x},${y}`;
            })
            .join(" ");

          return (
            <g key={project.id || pIdx}>
              {/* Shaded Area */}
              <polygon
                points={polygonPoints}
                fill={color.fill}
                stroke={color.stroke}
                strokeWidth={2}
                className="transition-all duration-300"
              />
              {/* Vertex Dots */}
              {values.map((val, i) => {
                const { x, y } = getCoordinates(val, i, numAxes, radius, cx, cy);
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={3.5}
                    fill={color.stroke}
                    stroke="var(--ud-surface)"
                    strokeWidth={1.5}
                  >
                    <title>{`${project.name} - ${AXES[i].fullLabel}: ${val}%`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 mt-2 text-xs">
        {projects.slice(0, 3).map((project, pIdx) => {
          const color = COLORS[pIdx % COLORS.length];
          return (
            <div key={project.id || pIdx} className="flex items-center gap-1.5 font-medium">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: color.stroke }}
              />
              <span className="text-[var(--ud-text)] truncate max-w-[140px]">{project.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(ProjectComparisonRadarChart);

