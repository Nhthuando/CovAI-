import { useState, useMemo, memo } from "react";
import ContextualMetricTooltip from "../primitives/ContextualMetricTooltip.jsx";

/**
 * Deterministic bounding-box label placement solver so scatter plot node labels
 * never collide with each other, with other dots, with plot edges, or with watermarks.
 */
function computeCollisionFreeLabels(
  nodes,
  { toX, toY, padLeft, padTop, padBottom, width, height, target80X },
) {
  const placedBoxes = [
    { x1: target80X - 28, y1: padTop - 16, x2: target80X + 28, y2: padTop - 1 },
  ];

  const circleObstacles = nodes.map((n) => ({
    projectId: n.projectId,
    cx: toX(n.x),
    cy: toY(n.y),
  }));

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

      if (x1 < padLeft + 3) penalty += 6000 + (padLeft + 3 - x1) * 50;
      if (x2 > width - 6) penalty += 6000 + (x2 - (width - 6)) * 50;
      if (y1 < 4) penalty += 6000 + (4 - y1) * 50;
      if (y2 > height - padBottom - 2) {
        penalty += 6000 + (y2 - (height - padBottom - 2)) * 50;
      }

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

const CHART_WIDTH = 520;
const CHART_HEIGHT = 310;
const PAD_LEFT = 45;
const PAD_RIGHT = 24;
const PAD_TOP = 28;
const PAD_BOTTOM = 36;
const PLOT_WIDTH = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

const toX = (val) =>
  PAD_LEFT + (Math.max(0, Math.min(100, val)) / 100) * PLOT_WIDTH;
const toY = (val) =>
  PAD_TOP + PLOT_HEIGHT - (Math.max(0, Math.min(100, val)) / 100) * PLOT_HEIGHT;
const TARGET_80_X = toX(80);

export function RiskQuadrantScatterPlot({
  quadrantNodes = [],
  coverageCutoff = 70,
  passRateCutoff = 85,
  selectedProjectId = null,
  onSelectProject,
  className = "",
}) {
  const [hoveredNode, setHoveredNode] = useState(null);

  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const padLeft = PAD_LEFT;
  const padRight = PAD_RIGHT;
  const padTop = PAD_TOP;
  const padBottom = PAD_BOTTOM;
  const plotWidth = PLOT_WIDTH;
  const plotHeight = PLOT_HEIGHT;
  const target80X = TARGET_80_X;

  const cutoffX = toX(coverageCutoff);
  const cutoffY = toY(passRateCutoff);

  // Isolate untested nodes from the scatter plot so they never land on (0,0) Critical Risk
  const plottedNodes = useMemo(
    () =>
      (quadrantNodes || []).filter(
        (n) =>
          !n?.isUntested &&
          n?.quadrantId !== "untested" &&
          n?.x !== null &&
          n?.x !== undefined &&
          n?.y !== null &&
          n?.y !== undefined &&
          Number.isFinite(Number(n.x)) &&
          Number.isFinite(Number(n.y)),
      ),
    [quadrantNodes],
  );

  const untestedNodes = useMemo(
    () =>
      (quadrantNodes || []).filter(
        (n) =>
          n?.isUntested ||
          n?.quadrantId === "untested" ||
          n?.x === null ||
          n?.x === undefined ||
          n?.y === null ||
          n?.y === undefined,
      ),
    [quadrantNodes],
  );

  const labelPlacements = useMemo(() => {
    return computeCollisionFreeLabels(plottedNodes, {
      toX,
      toY,
      padLeft: PAD_LEFT,
      padTop: PAD_TOP,
      padBottom: PAD_BOTTOM,
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      target80X: TARGET_80_X,
    });
  }, [plottedNodes]);

  return (
    <div className={`relative space-y-2 font-sans ${className}`}>
      {/* Minimal Header with Contextual Quadrant Guide */}
      <div className="flex items-center justify-between text-xs px-1">
        <span className="text-[11px] font-mono text-[var(--ud-text-muted)]">
          Correlation: Unified Coverage vs. Test Pass Rate
        </span>
        <ContextualMetricTooltip
          title="Risk Quadrant Guide"
          meaning="Segments tested Doing projects into 4 quality maturity quadrants. Untested projects are listed separately."
          formula={`★ Healthy Stars: Cov ≥ ${coverageCutoff}% & Pass ≥ ${passRateCutoff}%\n▲ Blind Spot: Cov < ${coverageCutoff}% & Pass ≥ ${passRateCutoff}%\n▼ Regressions: Cov ≥ ${coverageCutoff}% & Pass < ${passRateCutoff}%\n✖ Critical Risk: Cov < ${coverageCutoff}% & Pass < ${passRateCutoff}%`}
          provenance="Live PostgreSQL TestRun & CoverageSummary aggregates (Doing KPI scope)"
          tip="Click on any circle or untested chip to highlight that project card."
          placement="bottom-right"
        >
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--ud-surface-2)] border border-[var(--ud-border)] text-[10px] text-[var(--ud-text-muted)] hover:text-[var(--ud-unit)] hover:border-[var(--ud-unit)]/40 transition-colors cursor-pointer"
          >
            <span>ⓘ Quadrant Guide</span>
          </button>
        </ContextualMetricTooltip>
      </div>

      {/* SVG Canvas */}
      <div className="relative rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/40 p-2 overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
        >
          <rect
            x={cutoffX}
            y={padTop}
            width={width - padRight - cutoffX}
            height={cutoffY - padTop}
            fill="var(--ud-pass)"
            fillOpacity="0.025"
          />
          <rect
            x={padLeft}
            y={padTop}
            width={cutoffX - padLeft}
            height={cutoffY - padTop}
            fill="var(--ud-warn)"
            fillOpacity="0.025"
          />
          <rect
            x={cutoffX}
            y={cutoffY}
            width={width - padRight - cutoffX}
            height={height - padBottom - cutoffY}
            fill="var(--ud-warn)"
            fillOpacity="0.025"
          />
          <rect
            x={padLeft}
            y={cutoffY}
            width={cutoffX - padLeft}
            height={height - padBottom - cutoffY}
            fill="var(--ud-fail)"
            fillOpacity="0.025"
          />

          <text
            x={width - padRight - 6}
            y={cutoffY - 5}
            textAnchor="end"
            className="text-[8px] font-mono fill-[var(--ud-text-muted)] opacity-60 pointer-events-none"
          >
            ★ Healthy Stars
          </text>
          <text
            x={padLeft + 8}
            y={padTop + 13}
            textAnchor="start"
            className="text-[8px] font-mono fill-[var(--ud-text-muted)] opacity-60 pointer-events-none"
          >
            ▲ Blind Spot / Low Coverage
          </text>
          <text
            x={width - padRight - 6}
            y={height - padBottom - 8}
            textAnchor="end"
            className="text-[8px] font-mono fill-[var(--ud-text-muted)] opacity-60 pointer-events-none"
          >
            ▼ Active Regressions
          </text>
          <text
            x={padLeft + 8}
            y={cutoffY + 14}
            textAnchor="start"
            className="text-[8px] font-mono fill-[var(--ud-text-muted)] opacity-60 pointer-events-none"
          >
            ✖ Critical Risk
          </text>

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
            className="text-[8px] font-mono fill-[var(--ud-pass)] opacity-85 pointer-events-none"
          >
            80% Target
          </text>

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

          {plottedNodes.length === 0 && (
            <text
              x={padLeft + plotWidth / 2}
              y={padTop + plotHeight / 2}
              textAnchor="middle"
              className="text-[11px] font-mono fill-[var(--ud-text-muted)] pointer-events-none"
            >
              {untestedNodes.length > 0
                ? "Active (Doing) projects have no executed test runs yet"
                : "No active (Doing) projects in KPI scope"}
            </text>
          )}

          {plottedNodes.map((node) => {
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

            const strokeColor = node.color;
            const fillColor = node.color;

            return (
              <g
                key={node.projectId}
                className="cursor-pointer transition-transform"
                onClick={() => onSelectProject?.(isSelected ? null : node.projectId)}
                onMouseEnter={() => setHoveredNode(node)}
                onMouseLeave={() => setHoveredNode(null)}
              >
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

                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 6 : 5}
                  fill={fillColor}
                  stroke="var(--ud-surface)"
                  strokeWidth="1.5"
                />

                <rect
                  x={labelPos.box.x1}
                  y={labelPos.box.y1}
                  width={labelPos.box.x2 - labelPos.box.x1}
                  height={labelPos.box.y2 - labelPos.box.y1}
                  rx="2.5"
                  fill="var(--ud-surface)"
                  fillOpacity="0.88"
                  className="pointer-events-none"
                />

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

        {hoveredNode && (
          <div className="absolute bottom-3 right-3 p-2.5 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] text-[var(--ud-text)] shadow-lg z-20 font-mono text-[11px] tabular-nums pointer-events-none min-w-[205px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-xs font-sans text-[var(--ud-text)] truncate max-w-[180px]">
                {hoveredNode.name}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-[var(--ud-text-muted)]">
              Health Score:{" "}
              <span className="font-bold text-[var(--ud-text)]">
                {hoveredNode.healthScore ?? "—"} / 100 (Grade {hoveredNode.grade || "—"})
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

      {/* Separated Untested Active Projects Strip (never plotted at 0,0 Critical Risk) */}
      {untestedNodes.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] px-3 py-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--ud-text-muted)] shrink-0">
            Not Yet Tested ({untestedNodes.length}):
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {untestedNodes.map((n) => {
              const isSelected = selectedProjectId === n.projectId;
              return (
                <button
                  key={n.projectId}
                  type="button"
                  onClick={() => onSelectProject?.(isSelected ? null : n.projectId)}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-[var(--color-primary)]/12 border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
                      : "bg-[var(--ud-surface-2)] border-[var(--ud-border)] text-[var(--ud-text-secondary)] hover:text-[var(--ud-text)]"
                  }`}
                  title="Untested — excluded from Risk Quadrant until first test execution"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--ps-neutral)] shrink-0" />
                  <span className="truncate max-w-[160px]">{n.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(RiskQuadrantScatterPlot);
