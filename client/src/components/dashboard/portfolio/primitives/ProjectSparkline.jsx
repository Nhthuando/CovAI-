export function ProjectSparkline({
  data = [0, 0, 0, 0, 0],
  width = 64,
  height = 20,
  strokeColor = "var(--color-primary)",
  className = "",
}) {
  const points = Array.isArray(data) && data.length > 0 ? data : [0, 0, 0, 0, 0];
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

