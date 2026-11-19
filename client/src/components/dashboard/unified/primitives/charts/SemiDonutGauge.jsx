import React from "react";

/**
 * SemiDonutGauge - Pure SVG 180° Radial Gauge for Health Score (0 - 100).
 * Supports `hasBaseline = false` / unverified states by displaying `-- / 100` with gray `UNVERIFIED` badge.
 */
export function SemiDonutGauge({
  score = null,
  max = 100,
  grade = "--",
  hasBaseline = true,
  loading = false,
  size = 110,
  strokeWidth = 10,
  title = "Quality Health Score",
  className = "",
}) {
  const isUnverified = loading || !hasBaseline || score === null || score === undefined;
  const safeScore = isUnverified ? 0 : Math.max(0, Math.min(max, Number(score) || 0));
  const ratio = max > 0 && !isUnverified ? safeScore / max : 0;

  // Geometry
  const radius = 42;
  const cx = 55;
  const cy = 50;
  const circumference = Math.PI * radius; // Half-circle arc length ~ 131.95
  const strokeDashoffset = circumference * (1 - ratio);

  // Dynamic Color by Score / Grade
  const getToneColor = () => {
    if (isUnverified) return "var(--ud-text-muted)";
    if (safeScore >= 80) return "var(--ud-pass)";
    if (safeScore >= 60) return "var(--ud-warn)";
    return "var(--ud-fail)";
  };

  const strokeColor = getToneColor();

  return (
    <div
      className={`relative inline-flex flex-col items-center justify-center ${className}`}
      style={{ width: size, height: size * 0.65 }}
      role="meter"
      aria-valuenow={isUnverified ? undefined : safeScore}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={`${title}: ${loading ? "Loading" : isUnverified ? "Unverified" : `${safeScore}/${max} (Grade ${grade})`}`}
      title={`${title}: ${loading ? "Loading..." : isUnverified ? "Unverified (No Baseline)" : `${safeScore} / ${max} · Grade ${grade}`}`}
    >
      <svg
        viewBox="0 0 110 65"
        className="w-full h-full overflow-visible"
        aria-hidden="true"
      >
        {/* Background Arc (180deg) */}
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="var(--ud-surface-2)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Active Arc (flat color, only rendered when loaded with baseline and score > 0) */}
        {!isUnverified && safeScore > 0 && (
          <path
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            fill="none"
            stroke={strokeColor}
            strokeOpacity="0.9"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-500 ease-out"
          />
        )}
      </svg>

      {/* Centered Score & Grade Overlay */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-end text-center pointer-events-none">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-2xl font-bold tracking-tight text-[var(--ud-text)] leading-none tabular-nums">
            {isUnverified ? "--" : safeScore}
          </span>
          <span className="text-[10px] font-mono text-[var(--ud-text-muted)]">
            /{max}
          </span>
        </div>
        <span
          className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-[var(--radius-sm)] mt-1"
          style={{
            backgroundColor: isUnverified ? "var(--ud-surface-2)" : `color-mix(in srgb, ${strokeColor} 12%, transparent)`,
            color: strokeColor,
            border: isUnverified ? "1px solid var(--ud-border)" : `1px solid color-mix(in srgb, ${strokeColor} 28%, transparent)`,
          }}
        >
          {loading ? "--" : isUnverified ? "UNVERIFIED" : `Grade ${grade}`}
        </span>
      </div>
    </div>
  );
}

export default SemiDonutGauge;
