import { memo } from "react";

function getGaugeColor(score, isTested) {
  if (!isTested || score === 0) return "#484f58";
  if (score >= 80) return "#3fb950";
  if (score >= 65) return "#d29922";
  return "#f85149";
}

function RadialHealthGauge({
  score = 0,
  grade = "—",
  size = 54,
  strokeWidth = 4.5,
  isTested = true,
  className = "",
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.max(0, Math.min(100, Number(score) || 0));
  const strokeDashoffset = isTested
    ? circumference - (clampedScore / 100) * circumference
    : circumference;

  const color = getGaugeColor(clampedScore, isTested);

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
      title={`Quality Health: ${clampedScore}/100 (Grade ${grade})`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#21262d"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Active progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          className="transition-all duration-500 ease-out"
        />
      </svg>

      {/* Center Score & Grade */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span
          className="text-xs font-mono font-bold leading-none tracking-tight tabular-nums"
          style={{ color: isTested ? "#f0f6fc" : "#8b949e" }}
        >
          {isTested ? clampedScore : "—"}
        </span>
        <span
          className="text-[9px] font-mono font-semibold uppercase leading-none mt-0.5"
          style={{ color }}
        >
          {isTested ? grade : "NEW"}
        </span>
      </div>
    </div>
  );
}

export default memo(RadialHealthGauge);

