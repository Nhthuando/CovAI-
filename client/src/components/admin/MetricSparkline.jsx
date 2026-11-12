import React, { useId } from "react";

/**
 * MetricSparkline — Pure SVG Sparkline Chart with gradient fill
 * Zero external libraries, high performance, responsive.
 */
export function MetricSparkline({
  data = [10, 15, 8, 22, 18, 30, 25, 42, 38, 55],
  width = 120,
  height = 36,
  strokeColor = "var(--admin-accent-primary)",
  fillColor = "rgba(0, 229, 153, 0.15)",
  className = "",
}) {
  const gradientId = useId();

  if (!data || data.length === 0) {
    return <div className={`h-[${height}px] w-[${width}px] bg-transparent ${className}`} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min === 0 ? 1 : max - min;
  const paddingY = 4;
  const usableHeight = height - paddingY * 2;

  // Build SVG Points
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - paddingY - ((val - min) / range) * usableHeight;
    return { x, y };
  });

  const pathD = points.reduce((acc, curr, idx) => {
    return `${acc} ${idx === 0 ? "M" : "L"} ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }, "");

  // Area path closing under the sparkline
  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  const lastPoint = points[points.length - 1];

  return (
    <div className={`relative inline-block overflow-hidden ${className}`}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillColor} stopOpacity="0.8" />
            <stop offset="100%" stopColor={fillColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Gradient Area */}
        <path d={areaD} fill={`url(#${gradientId})`} />

        {/* Trend Line */}
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Pulsing head dot on the latest point */}
        {lastPoint && (
          <circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            r="2.5"
            fill={strokeColor}
            className="admin-live-pulse"
          />
        )}
      </svg>
    </div>
  );
}
