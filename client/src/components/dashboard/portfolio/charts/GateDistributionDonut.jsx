import { memo } from "react";

export function GateDistributionDonut({
  lifecycleCounts = null,
  projects = [],
  className = "",
}) {
  const counts = lifecycleCounts || {
    DOING: projects.filter((p) => p.lifecycleStatus === "DOING").length,
    NOT_STARTED: projects.filter(
      (p) => !p.lifecycleStatus || p.lifecycleStatus === "NOT_STARTED"
    ).length,
    COMPLETED: projects.filter((p) => p.lifecycleStatus === "COMPLETED").length,
    PAUSED: projects.filter((p) => p.lifecycleStatus === "PAUSED").length,
    CANCELLED: projects.filter((p) => p.lifecycleStatus === "CANCELLED").length,
  };

  const doing = counts.DOING || 0;
  const completed = counts.COMPLETED || 0;
  const notStarted = counts.NOT_STARTED || 0;
  const onHold = (counts.PAUSED || 0) + (counts.CANCELLED || 0);
  const total = doing + completed + notStarted + onHold;

  const segments = [
    { key: "DOING", label: "Doing", count: doing, color: "var(--ps-cobalt)" },
    { key: "COMPLETED", label: "Completed", count: completed, color: "var(--ps-emerald)" },
    { key: "NOT_STARTED", label: "Not Started", count: notStarted, color: "var(--ps-neutral)" },
    { key: "HOLD", label: "Paused / Cancel", count: onHold, color: "var(--ps-amber)" },
  ];

  const size = 148;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  const activeSegments = segments.filter((s) => s.count > 0);
  const arcs = activeSegments.reduce((acc, seg) => {
    const prevOffset = acc.length > 0 ? acc[acc.length - 1].nextOffset : 0;
    const len = total > 0 ? (seg.count / total) * circ : 0;
    acc.push({
      ...seg,
      len,
      offset: prevOffset,
      nextOffset: prevOffset + len,
    });
    return acc;
  }, []);

  return (
    <div className={`flex flex-col sm:flex-row items-center gap-5 ${className}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--ps-surface-2)"
            strokeWidth={stroke}
          />
          {arcs.map((seg) => (
            <circle
              key={seg.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeDasharray={`${seg.len} ${circ - seg.len}`}
              strokeDashoffset={-seg.offset}
              className="transition-all duration-500"
            />
          ))}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none ps-mono">
          <span className="text-2xl font-bold text-[var(--ps-ink)]">
            {total}
          </span>
          <span className="text-[10px] text-[var(--ps-ink-muted)]">
            Total
          </span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-2 ps-mono text-xs">
        {segments.map((seg) => {
          const pct = total > 0 ? Math.round((seg.count / total) * 100) : 0;
          return (
            <div
              key={seg.key}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[var(--ps-inset)] border border-[var(--ps-line)]"
            >
              <span className="flex items-center gap-2 text-[var(--ps-ink-secondary)]">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: seg.color }}
                />
                <span>{seg.label}</span>
              </span>
              <span className="text-[var(--ps-ink-muted)]">
                <strong className="text-[var(--ps-ink)]">{seg.count}</strong> ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(GateDistributionDonut);
