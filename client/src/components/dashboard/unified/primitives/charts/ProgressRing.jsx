import React from "react";

/**
 * ProgressRing - Pure SVG Compact Circular Progress Ring for Layer Coverage (0 - 100%).
 */
export function ProgressRing({
  pct = 0,
  label = "",
  size = 46,
  strokeWidth = 5,
  tone = "unit", // 'unit' | 'integration' | 'system' | 'pass' | 'warn' | 'fail'
  className = "",
  showLabel = true,
}) {
  const safePct = Math.max(0, Math.min(100, Number(pct) || 0));

  const toneColors = {
    unit: "var(--ud-unit)",
    integration: "var(--ud-integration)",
    system: "var(--ud-system)",
    pass: "var(--ud-pass)",
    warn: "var(--ud-warn)",
    fail: "var(--ud-fail)",
  };

  const strokeColor = toneColors[tone] || "var(--ud-unit)";

  // SVG Geometry
  const radius = 17;
  const cx = 23;
  const cy = 23;
  const circumference = 2 * Math.PI * radius; // ~ 106.81
  const strokeDashoffset = circumference * (1 - safePct / 100);

  return (
    <div
      className={`inline-flex flex-col items-center gap-1 ${className}`}
      title={`${label}: ${safePct.toFixed(1)}%`}
      role="progressbar"
      aria-valuenow={safePct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${label} coverage: ${safePct.toFixed(1)}%`}
    >
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg
          viewBox="0 0 46 46"
          className="w-full h-full -rotate-90 overflow-visible"
          aria-hidden="true"
        >
          {/* Background circle */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--ud-surface-2)"
            strokeWidth={strokeWidth}
          />

          {/* Active progress arc */}
          {safePct > 0 && (
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-300"
            />
          )}
        </svg>

        {/* Centered Percentage */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-mono text-[11px] font-bold text-[var(--ud-text)] tabular-nums leading-none">
            {Math.round(safePct)}%
          </span>
        </div>
      </div>

      {/* Label */}
      {showLabel && label && (
        <span
          className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--ud-text-muted)] truncate max-w-[56px] text-center"
          style={{ color: safePct > 0 ? strokeColor : undefined }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

export default ProgressRing;

