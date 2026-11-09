import React from "react";

/**
 * DonutChart - Pure SVG 360° Donut Chart for Test Executions & Outcomes.
 */
export function DonutChart({
  segments = [],
  size = 76,
  strokeWidth = 9,
  centerLabel = null,
  centerSub = null,
  showLegend = false,
  className = "",
  ariaLabel = "Test execution distribution",
}) {
  const sum = segments.reduce((acc, s) => acc + (Number(s.value) || 0), 0);

  const toneColors = {
    pass: "var(--ud-pass)",
    fail: "var(--ud-fail)",
    warn: "var(--ud-warn)",
    neutral: "var(--ud-neutral)",
    unit: "var(--ud-unit)",
    integration: "var(--ud-integration)",
    system: "var(--ud-system)",
  };

  const radius = 28;
  const cx = 38;
  const cy = 38;
  const circumference = 2 * Math.PI * radius; // ~ 175.93

  let accumulatedPct = 0;
  const processedSegments = segments
    .filter((s) => (Number(s.value) || 0) > 0)
    .map((s) => {
      const val = Number(s.value) || 0;
      const pct = sum > 0 ? val / sum : 0;
      const dash = pct * circumference;
      const offset = circumference * (1 - accumulatedPct);
      accumulatedPct += pct;
      return {
        ...s,
        val,
        pct: pct * 100,
        dash,
        offset,
        color: toneColors[s.tone] || s.color || "var(--ud-neutral)",
      };
    });

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      {/* SVG Donut */}
      <div
        className="relative shrink-0 flex items-center justify-center"
        style={{ width: size, height: size }}
        role="img"
        aria-label={ariaLabel}
      >
        <svg
          viewBox="0 0 76 76"
          className="w-full h-full -rotate-90 overflow-visible"
          aria-hidden="true"
        >
          {/* Base Track */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--ud-surface-2)"
            strokeWidth={strokeWidth}
          />

          {/* Slices */}
          {sum > 0 ? (
            processedSegments.map((seg, idx) => (
              <circle
                key={seg.key || idx}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${seg.dash} ${circumference}`}
                strokeDashoffset={seg.offset}
                strokeLinecap={processedSegments.length === 1 ? "round" : "butt"}
                className="transition-all duration-300"
              >
                <title>{`${seg.label || seg.key}: ${seg.val} (${seg.pct.toFixed(1)}%)`}</title>
              </circle>
            ))
          ) : (
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke="var(--ud-border)"
              strokeWidth={strokeWidth}
              strokeDasharray="2 3"
            />
          )}
        </svg>

        {/* Center Label Overlay */}
        {(centerLabel || centerSub) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            {centerLabel && (
              <span className="font-mono text-sm font-bold text-[var(--ud-text)] leading-none">
                {centerLabel}
              </span>
            )}
            {centerSub && (
              <span className="text-[9px] font-mono text-[var(--ud-text-muted)] mt-0.5 leading-none">
                {centerSub}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Optional Side Legend */}
      {showLegend && (
        <div className="flex flex-col gap-1 min-w-0 text-xs">
          {segments.map((seg, idx) => {
            const val = Number(seg.value) || 0;
            const color = toneColors[seg.tone] || seg.color || "var(--ud-neutral)";
            return (
              <div key={seg.key || idx} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-[11px] text-[var(--ud-text-muted)] truncate">
                    {seg.label || seg.key}
                  </span>
                </div>
                <span className="font-mono text-xs font-semibold text-[var(--ud-text)] tabular-nums">
                  {val}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default DonutChart;

