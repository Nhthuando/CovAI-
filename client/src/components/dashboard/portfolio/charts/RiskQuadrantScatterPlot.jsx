import { useState, useMemo } from "react";

/**
 * Deterministic bounding-box label placement solver so scatter plot node labels
 * never collide with each other, with other dots, with plot edges, or with watermarks.
 */
function computeCollisionFreeLabels(nodes, { toX, toY, padLeft, padRight, padTop, padBottom, width, height, target80X }) {
  const placedBoxes = [
    // Reserve the "80% Target" header label box so node labels don't overlap it
    { x1: target80X - 28, y1: padTop - 16, x2: target80X + 28, y2: padTop - 1 },
  ];

  const circleObstacles = nodes.map((n) => ({
    projectId: n.projectId,
    cx: toX(n.x),
    cy: toY(n.y),
  }));

  // Candidate offsets around (cx, cy)
  const CANDIDATES = [
    { id: "right", dx: 9, dy: 3, anchor: "start" },
    { id: "left", dx: -9, dy: 3, anchor: "end" },
    { id: "above", dx: 0, dy: -9, anchor: "middle" },
    { id: "below", dx: 0, dy: 15, anchor: "middle" },
    { id: "below-left", dx: -4, dy: 15, anchor: "end" },
    { id: "above-left", dx: -4, dy: -9, anchor: "end" },
    { id: "right-above", dx: 9, dy: -5, anchor: "start" },
    { id: "right-below", dx: 9, dy: 12, anchor: "start" },
    { id: "left-below", dx: -9, dy: 12, anchor: "end" },
    { id: "left-above", dx: -9, dy: -5, anchor: "end" },
  ];

  const boxesOverlap = (a, b, marginX = 4, marginY = 2) => {
    return (
      a.x1 - marginX < b.x2 &&
      a.x2 + marginX > b.x1 &&
      a.y1 - marginY < b.y2 &&
      a.y2 + marginY > b.y1
    );
  };

  const overlapArea = (a, b) => {
    const ox = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
    const oy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
    return ox * oy;
  };

  // Sort by X descending then Y descending so dense top-right corner resolves deterministically
  const sorted = [...nodes].sort((a, b) => b.x - a.x || b.y - a.y);
  const placements = {};

  for (const node of sorted) {
    const cx = toX(node.x);
    const cy = toY(node.y);
    const shortText =
      node.name.length > 16 ? `${node.name.slice(0, 14)}…` : node.name;
    const labelW = shortText.length * 5.1 + 8;
    const labelH = 12;

    let bestCandidate = null;
    let bestScore = Infinity;

    for (const cand of CANDIDATES) {
      let x1;
      let x2;
      if (cand.anchor === "start") {
        x1 = cx + cand.dx - 2;
        x2 = x1 + labelW;
      } else if (cand.anchor === "end") {
        x2 = cx + cand.dx + 2;
        x1 = x2 - labelW;
      } else {
        x1 = cx + cand.dx - labelW / 2;
        x2 = cx + cand.dx + labelW / 2;
      }
      const y1 = cy + cand.dy - 9;
      const y2 = y1 + labelH;
      const box = { x1, y1, x2, y2 };

      let penalty = 0;

      // 1. Keep strictly inside plot / SVG boundaries
      if (x1 < padLeft + 3) penalty += 6000 + (padLeft + 3 - x1) * 50;
      if (x2 > width - 6) penalty += 6000 + (x2 - (width - 6)) * 50;
      if (y1 < 4) penalty += 6000 + (4 - y1) * 50;
      if (y2 > height - padBottom - 2) {
        penalty += 6000 + (y2 - (height - padBottom - 2)) * 50;
      }

      // 2. Avoid covering any project node dot
      for (const dot of circleObstacles) {
        const dotBox = {
          x1: dot.cx - 6,
          y1: dot.cy - 6,
          x2: dot.cx + 6,
          y2: dot.cy + 6,
        };
        if (boxesOverlap(box, dotBox, 1, 1)) {
          penalty += 3000;
        }
      }

      // 3. Avoid overlapping already-placed labels
      for (const placed of placedBoxes) {
        if (boxesOverlap(box, placed, 4, 2)) {
          penalty += 10000 + overlapArea(box, placed) * 20;
        }
      }

      if (penalty < bestScore) {
        bestScore = penalty;
        bestCandidate = {
          text: shortText,
          x: cx + cand.dx,
          y: cy + cand.dy,
          anchor: cand.anchor,
          box,
        };
        if (penalty === 0) break;
      }
    }

    placedBoxes.push(bestCandidate.box);
    placements[node.projectId] = bestCandidate;
  }

  return placements;
}

export function RiskQuadrantScatterPlot({
  quadrantNodes = [],
  coverageCutoff = 70,
  passRateCutoff = 85,
  selectedProjectId = null,
  onSelectProject,
  className = "",
}) {
  const [hoveredNode, setHoveredNode] = useState(null);

  // SVG Chart Dimensions
  const width = 520;
  const height = 310;
  const padLeft = 45;
  const padRight = 24;
  const padTop = 28;
  const padBottom = 36;

  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  // Coordinate transforms (X: 0 - 100%, Y: 0 - 100%)
  const toX = (val) => padLeft + (Math.max(0, Math.min(100, val)) / 100) * plotWidth;
  const toY = (val) => padTop + plotHeight - (Math.max(0, Math.min(100, val)) / 100) * plotHeight;

  const cutoffX = toX(coverageCutoff);
  const cutoffY = toY(passRateCutoff);
  const target80X = toX(80);

  const labelPlacements = useMemo(
    () =>
      computeCollisionFreeLabels(quadrantNodes, {
        toX,
        toY,
        padLeft,
        padRight,
        padTop,
        padBottom,
        width,
        height,
        target80X,
      }),
    [quadrantNodes, coverageCutoff, passRateCutoff]
  );

  return (
    <div className={`relative space-y-3 font-sans ${className}`}>
      {/* Quadrant Legend Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono tabular-nums">
        <div className="p-1.5 rounded bg-[var(--ud-pass)]/10 border border-[var(--ud-pass)]/30 text-[var(--ud-pass)]">
          <div className="font-bold">★ Healthy Stars</div>
          <div className="text-[9px] text-[var(--ud-text-muted)]">Cov ≥{coverageCutoff}% • Pass ≥{passRateCutoff}%</div>
        </div>
        <div className="p-1.5 rounded bg-[var(--ud-warn)]/10 border border-[var(--ud-warn)]/30 text-[var(--ud-warn)]">
          <div className="font-bold">▲ Blind Spot / Low Cov</div>
          <div className="text-[9px] text-[var(--ud-text-muted)]">Cov &lt;{coverageCutoff}% • Pass ≥{passRateCutoff}%</div>
        </div>
        <div className="p-1.5 rounded bg-[#fb8500]/10 border border-[#fb8500]/30 text-[#fb8500]">
          <div className="font-bold">▼ Active Regressions</div>
          <div className="text-[9px] text-[var(--ud-text-muted)]">Cov ≥{coverageCutoff}% • Pass &lt;{passRateCutoff}%</div>
        </div>
        <div className="p-1.5 rounded bg-[var(--ud-fail)]/10 border border-[var(--ud-fail)]/30 text-[var(--ud-fail)]">
          <div className="font-bold">✖ Critical Risk</div>
          <div className="text-[9px] text-[var(--ud-text-muted)]">Cov &lt;{coverageCutoff}% • Pass &lt;{passRateCutoff}%</div>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="relative rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/40 p-2 overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
        >
          {/* Subtle Quadrant Background Tints */}
          {/* Top-Right: Healthy Stars */}
          <rect
            x={cutoffX}
            y={padTop}
            width={width - padRight - cutoffX}
            height={cutoffY - padTop}
            fill="var(--ud-pass)"
            fillOpacity="0.04"
          />
          {/* Top-Left: Blind Spot / Low Coverage */}
          <rect
            x={padLeft}
            y={padTop}
            width={cutoffX - padLeft}
            height={cutoffY - padTop}
            fill="var(--ud-warn)"
            fillOpacity="0.04"
          />
          {/* Bottom-Right: Active Regressions */}
          <rect
            x={cutoffX}
            y={cutoffY}
            width={width - padRight - cutoffX}
            height={height - padBottom - cutoffY}
            fill="#fb8500"
            fillOpacity="0.04"
          />
          {/* Bottom-Left: Critical Risk */}
          <rect
            x={padLeft}
            y={cutoffY}
            width={cutoffX - padLeft}
            height={height - padBottom - cutoffY}
            fill="var(--ud-fail)"
            fillOpacity="0.04"
          />

          {/* Subtle Quadrant Watermarks — positioned in safe zones away from (0%,0%) and (100%,100%) data points */}
          <text
            x={width - padRight - 6}
            y={cutoffY - 5}
            textAnchor="end"
            className="text-[8px] font-mono fill-[var(--ud-pass)] opacity-45 pointer-events-none"
          >
            ★ Healthy Stars
          </text>
          <text
            x={padLeft + 8}
            y={padTop + 13}
            textAnchor="start"
            className="text-[8px] font-mono fill-[var(--ud-warn)] opacity-45 pointer-events-none"
          >
            ▲ Blind Spot / Low Coverage
          </text>
          <text
            x={width - padRight - 6}
            y={height - padBottom - 8}
            textAnchor="end"
            className="text-[8px] font-mono fill-[#fb8500] opacity-45 pointer-events-none"
          >
            ▼ Active Regressions
          </text>
          <text
            x={padLeft + 8}
            y={cutoffY + 14}
            textAnchor="start"
            className="text-[8px] font-mono fill-[var(--ud-fail)] opacity-45 pointer-events-none"
          >
            ✖ Critical Risk
          </text>

          {/* 80% Quality Target Dashed Reference Line */}
          <line
            x1={target80X}
            y1={padTop}
            x2={target80X}
            y2={height - padBottom}
            stroke="var(--ud-pass)"
            strokeWidth="1"
            strokeDasharray="2 3"
            strokeOpacity="0.45"
          />
          <text
            x={target80X}
            y={padTop - 6}
            textAnchor="middle"
            className="text-[8px] font-mono fill-[var(--ud-pass)] opacity-80 pointer-events-none"
          >
            80% Target
          </text>

          {/* Quadrant Divider Lines */}
          <line
            x1={cutoffX}
            y1={padTop}
            x2={cutoffX}
            y2={height - padBottom}
            stroke="var(--ud-border)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <line
            x1={padLeft}
            y1={cutoffY}
            x2={width - padRight}
            y2={cutoffY}
            stroke="var(--ud-border)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />

          {/* Axes */}
          <line
            x1={padLeft}
            y1={height - padBottom}
            x2={width - padRight}
            y2={height - padBottom}
            stroke="var(--ud-border-strong)"
            strokeWidth="1"
          />
          <line
            x1={padLeft}
            y1={padTop}
            x2={padLeft}
            y2={height - padBottom}
            stroke="var(--ud-border-strong)"
            strokeWidth="1"
          />

          {/* Axis Labels & Ticks */}
          {/* X Ticks: 0, 50, 70 (cutoff), 80 (target), 100 */}
          {[0, 50, 70, 80, 100].map((t) => (
            <text
              key={`xtick-${t}`}
              x={toX(t)}
              y={height - padBottom + 16}
              textAnchor="middle"
              className={`text-[9px] font-mono tabular-nums ${
                t === coverageCutoff
                  ? "fill-[var(--color-primary)] font-bold"
                  : t === 80
                  ? "fill-[var(--ud-pass)] font-semibold"
                  : "fill-[var(--ud-text-muted)]"
              }`}
            >
              {t}%
            </text>
          ))}
          <text
            x={padLeft + plotWidth / 2}
            y={height - 5}
            textAnchor="middle"
            className="text-[10px] font-mono fill-[var(--ud-text-muted)]"
          >
            Unified Coverage Index →
          </text>

          {/* Y Ticks: 0, 50, 85 (cutoff), 100 */}
          {[0, 50, 85, 100].map((t) => (
            <text
              key={`ytick-${t}`}
              x={padLeft - 8}
              y={toY(t) + 3}
              textAnchor="end"
              className={`text-[9px] font-mono tabular-nums ${
                t === passRateCutoff
                  ? "fill-[var(--color-primary)] font-bold"
                  : "fill-[var(--ud-text-muted)]"
              }`}
            >
              {t}%
            </text>
          ))}
          <text
            x={10}
            y={padTop + plotHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${padTop + plotHeight / 2})`}
            className="text-[10px] font-mono fill-[var(--ud-text-muted)]"
          >
            Pass Rate % →
          </text>

          {/* Project Scatter Nodes & Collision-Free Labels */}
          {quadrantNodes.map((node) => {
            const isHovered = hoveredNode?.projectId === node.projectId;
            const isSelected = selectedProjectId === node.projectId;
            const cx = toX(node.x);
            const cy = toY(node.y);
            const labelPos = labelPlacements[node.projectId] || {
              text: node.name,
              x: cx,
              y: cy - 9,
              anchor: "middle",
              box: { x1: cx - 30, y1: cy - 18, x2: cx + 30, y2: cy - 6 },
            };

            let strokeColor = node.color;
            let fillColor = node.color;

            if (node.isUntested) {
              fillColor = "var(--ud-neutral)";
              strokeColor = "var(--ud-neutral)";
            }

            return (
              <g
                key={node.projectId}
                className="cursor-pointer transition-transform"
                onClick={() => onSelectProject?.(isSelected ? null : node.projectId)}
                onMouseEnter={() => setHoveredNode(node)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {/* Node Aura / Selection Ring */}
                {(isHovered || isSelected) && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 12 : 9}
                    fill={fillColor}
                    fillOpacity="0.25"
                    stroke={strokeColor}
                    strokeWidth="1.5"
                  />
                )}

                {/* Core Node Circle */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 6 : 5}
                  fill={fillColor}
                  stroke="var(--ud-surface)"
                  strokeWidth="1.5"
                />

                {/* Pill backdrop behind label for crisp legibility over grid lines */}
                <rect
                  x={labelPos.box.x1}
                  y={labelPos.box.y1}
                  width={labelPos.box.x2 - labelPos.box.x1}
                  height={labelPos.box.y2 - labelPos.box.y1}
                  rx="2.5"
                  fill="var(--ud-surface)"
                  fillOpacity="0.82"
                  className="pointer-events-none"
                />

                {/* Collision-Free Node Label */}
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor={labelPos.anchor}
                  className={`text-[8.5px] font-mono font-medium pointer-events-none ${
                    isSelected || isHovered
                      ? "fill-[var(--color-primary)] font-bold"
                      : "fill-[var(--ud-text)]"
                  }`}
                >
                  {labelPos.text}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredNode && (
          <div
            className="absolute bottom-3 right-3 p-2.5 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text)] shadow-lg z-20 font-mono text-[11px] tabular-nums pointer-events-none min-w-[205px]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-xs font-sans text-[var(--ud-text)] truncate max-w-[130px]">
                {hoveredNode.name}
              </span>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                  hoveredNode.gateStatus === "PASSED"
                    ? "bg-[var(--ud-pass)]/15 text-[var(--ud-pass)] border-[var(--ud-pass)]/30"
                    : hoveredNode.gateStatus === "BLOCKED"
                    ? "bg-[var(--ud-fail)]/15 text-[var(--ud-fail)] border-[var(--ud-fail)]/30"
                    : hoveredNode.gateStatus === "UNTESTED"
                    ? "bg-[var(--ud-neutral)]/15 text-[var(--ud-neutral)] border-[var(--ud-neutral)]/30"
                    : "bg-[var(--ud-warn)]/15 text-[var(--ud-warn)] border-[var(--ud-warn)]/30"
                }`}
              >
                {hoveredNode.gateLabel || hoveredNode.gateStatus}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-[var(--ud-text-muted)]">
              Health Score:{" "}
              <span className="font-bold text-[var(--ud-text)]">
                {hoveredNode.healthScore ?? 0} / 100 (Grade {hoveredNode.grade || "—"})
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 mt-1 text-[10px]">
              <div>
                <span className="text-[var(--ud-text-muted)]">Coverage: </span>
                <span className="font-bold text-[var(--ud-text)]">{hoveredNode.x}%</span>
              </div>
              <div>
                <span className="text-[var(--ud-text-muted)]">Pass Rate: </span>
                <span className="font-bold text-[var(--ud-text)]">{hoveredNode.y}%</span>
              </div>
            </div>
            <div className="mt-1 text-[10px] font-semibold" style={{ color: hoveredNode.color }}>
              ● {hoveredNode.quadrantLabel}
            </div>
            <div className="mt-1 pt-1 border-t border-[var(--ud-border)] text-[9px] text-[var(--ud-text-muted)]">
              Click to highlight project card ↑
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default RiskQuadrantScatterPlot;

