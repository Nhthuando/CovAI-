export function ProjectSparkline({
  data = [],
  width = 64,
  height = 20,
  strokeColor = "var(--color-primary)",
  className = "",
}) {
  const points = Array.isArray(data)
    ? data.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    : [];

  if (points.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={`overflow-visible shrink-0 ${className}`}
        aria-label="No trend data yet"
      >
        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke="var(--ud-border-strong)"
          strokeWidth="1.2"
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  if (points.length === 1) {
    const midY = height / 2;
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={`overflow-visible shrink-0 ${className}`}
        aria-label="Single run trend"
      >
        <line
          x1={2}
          y1={midY}
          x2={width - 2}
          y2={midY}
          stroke={strokeColor}
          strokeOpacity="0.35"
          strokeWidth="1.2"
        />
        <circle
          cx={width / 2}
          cy={midY}
          r={2.5}
          fill={strokeColor}
          stroke="var(--ud-surface)"
          strokeWidth="1"
        />
      </svg>
    );
  }

  const max = Math.max(...points, 100);
  const min = Math.min(...points, 0);
  const range = max - min || 1;

  const padX = 2;
  const padY = 2;
  const drawWidth = width - padX * 2;
  const drawHeight = height - padY * 2;

  const coords = points.map((val, idx) => {
    const x = padX + (idx / (points.length - 1 || 1)) * drawWidth;
    const y = padY + drawHeight - ((val - min) / range) * drawHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const lastCoord = coords[coords.length - 1].split(",");
  const lastX = parseFloat(lastCoord[0]);
  const lastY = parseFloat(lastCoord[1]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`overflow-visible shrink-0 ${className}`}
      aria-label="Trend sparkline"
    >
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={coords.join(" ")}
      />
      <circle
        cx={lastX}
        cy={lastY}
        r={2.5}
        fill={strokeColor}
        stroke="var(--ud-surface)"
        strokeWidth="1"
      />
    </svg>
  );
}

export default ProjectSparkline;
