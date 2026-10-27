import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { SegmentedFilter } from "../primitives/SegmentedFilter.jsx";
import { fmtDuration, fmtCount } from "../../../../services/unifiedDashboard/format.js";

export function TestPyramidVisualizer({ pyramid, className = "" }) {
  const [metricMode, setMetricMode] = useState("count"); // 'count' | 'duration'

  const { shape = "pyramid", warning = null, layers = [] } = pyramid || {};

  // Find layer by pillar
  const systemLayer = layers.find((l) => l.pillar === "system") || { count: 0, pctOfTotal: 0, durationMs: 0 };
  const intLayer = layers.find((l) => l.pillar === "integration") || { count: 0, pctOfTotal: 0, durationMs: 0 };
  const unitLayer = layers.find((l) => l.pillar === "unit") || { count: 0, pctOfTotal: 0, durationMs: 0 };

  const totalCount = (unitLayer.count || 0) + (intLayer.count || 0) + (systemLayer.count || 0);
  const totalDuration = (unitLayer.durationMs || 0) + (intLayer.durationMs || 0) + (systemLayer.durationMs || 0);

  // Calculate relative SVG polygon widths based on chosen mode
  const getWeight = (l) => {
    if (metricMode === "duration") {
      return totalDuration > 0 ? (l.durationMs || 0) / totalDuration : 0.33;
    }
    return totalCount > 0 ? (l.count || 0) / totalCount : 0.33;
  };

  const sysWeight = Math.max(0.18, Math.min(0.9, getWeight(systemLayer)));
  const intWeight = Math.max(0.3, Math.min(0.95, getWeight(intLayer)));
  const unitWeight = Math.max(0.4, Math.min(1.0, getWeight(unitLayer)));

  const svgWidth = 320;
  const svgHeight = 160;
  const cx = svgWidth / 2;

  // Trapezoid dimensions
  // Top tier (System)
  const topTopW = Math.round(sysWeight * 70);
  const topBotW = Math.round(sysWeight * 130);
  const topY1 = 12;
  const topY2 = 54;

  // Mid tier (Integration)
  const midTopW = Math.max(topBotW + 4, Math.round(intWeight * 140));
  const midBotW = Math.round(intWeight * 210);
  const midY1 = 58;
  const midY2 = 104;

  // Base tier (Unit)
  const botTopW = Math.max(midBotW + 4, Math.round(unitWeight * 220));
  const botBotW = Math.max(botTopW + 10, Math.round(unitWeight * 290));
  const botY1 = 108;
  const botY2 = 152;

  return (
    <div className={`flex flex-col justify-between h-full space-y-4 ${className}`}>
      {/* Visualizer Header & Mode Switch */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--ud-text)] tracking-tight">
          Test Pyramid Architecture
        </span>
        <SegmentedFilter
          idPrefix="ud-pyramid-mode"
          options={[
            { label: "Count", value: "count" },
            { label: "Duration", value: "duration" },
          ]}
          value={metricMode}
          onChange={setMetricMode}
          size="sm"
        />
      </div>

      {/* SVG Pyramid Visualization */}
      <div className="relative flex items-center justify-center my-1 select-none">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full max-w-[320px] h-auto drop-shadow-xs"
          role="img"
          aria-label={`Test Pyramid representing ${unitLayer.count} unit tests, ${intLayer.count} integration tests, and ${systemLayer.count} system tests`}
        >
          {/* Top Tier: System (Teal) */}
          <polygon
            points={`${cx - topTopW / 2},${topY1} ${cx + topTopW / 2},${topY1} ${cx + topBotW / 2},${topY2} ${cx - topBotW / 2},${topY2}`}
            fill="var(--ud-system)"
            fillOpacity="0.16"
            stroke="var(--ud-system)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <text
            x={cx}
            y={(topY1 + topY2) / 2 + 4}
            textAnchor="middle"
            fill="var(--ud-system)"
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="bold"
          >
            E2E ({metricMode === "duration" ? fmtDuration(systemLayer.durationMs) : systemLayer.count})
          </text>

          {/* Middle Tier: Integration (Purple) */}
          <polygon
            points={`${cx - midTopW / 2},${midY1} ${cx + midTopW / 2},${midY1} ${cx + midBotW / 2},${midY2} ${cx - midBotW / 2},${midY2}`}
            fill="var(--ud-integration)"
            fillOpacity="0.16"
            stroke="var(--ud-integration)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <text
            x={cx}
            y={(midY1 + midY2) / 2 + 4}
            textAnchor="middle"
            fill="var(--ud-integration)"
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="bold"
          >
            Integration ({metricMode === "duration" ? fmtDuration(intLayer.durationMs) : intLayer.count})
          </text>

          {/* Base Tier: Unit Tests (Blue) */}
          <polygon
            points={`${cx - botTopW / 2},${botY1} ${cx + botTopW / 2},${botY1} ${cx + botBotW / 2},${botY2} ${cx - botBotW / 2},${botY2}`}
            fill="var(--ud-unit)"
            fillOpacity="0.16"
            stroke="var(--ud-unit)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <text
            x={cx}
            y={(botY1 + botY2) / 2 + 4}
            textAnchor="middle"
            fill="var(--ud-unit)"
            fontSize="11"
            fontFamily="var(--font-mono)"
            fontWeight="bold"
          >
            Unit Tests ({metricMode === "duration" ? fmtDuration(unitLayer.durationMs) : unitLayer.count})
          </text>
        </svg>
      </div>

      {/* Layer Metrics Summary List */}
      <div className="space-y-1.5 text-xs font-mono pt-2 border-t border-[var(--ud-border)]">
        <div className="flex items-center justify-between text-[var(--ud-text-muted)]">
          <span className="flex items-center gap-1.5 font-sans">
            <span className="w-2 h-2 rounded-full bg-[var(--ud-system)] shrink-0" />
            <span>Top: System (E2E)</span>
          </span>
          <span className="tabular-nums font-semibold text-[var(--ud-text)]">
            {fmtCount(systemLayer.count)} tests • {fmtDuration(systemLayer.durationMs)}
          </span>
        </div>
        <div className="flex items-center justify-between text-[var(--ud-text-muted)]">
          <span className="flex items-center gap-1.5 font-sans">
            <span className="w-2 h-2 rounded-full bg-[var(--ud-integration)] shrink-0" />
            <span>Middle: Integration</span>
          </span>
          <span className="tabular-nums font-semibold text-[var(--ud-text)]">
            {fmtCount(intLayer.count)} tests • {fmtDuration(intLayer.durationMs)}
          </span>
        </div>
        <div className="flex items-center justify-between text-[var(--ud-text-muted)]">
          <span className="flex items-center gap-1.5 font-sans">
            <span className="w-2 h-2 rounded-full bg-[var(--ud-unit)] shrink-0" />
            <span>Base: Unit Tests</span>
          </span>
          <span className="tabular-nums font-semibold text-[var(--ud-text)]">
            {fmtCount(unitLayer.count)} tests • {fmtDuration(unitLayer.durationMs)}
          </span>
        </div>
      </div>

      {/* Shape Assessment & Warning Banner */}
      <div
        className={`rounded-[var(--radius-sm)] border p-2 text-xs flex items-start gap-2 ${
          shape === "pyramid"
            ? "border-[var(--ud-pass)]/30 bg-[var(--ud-pass)]/10 text-[var(--ud-pass)]"
            : shape === "insufficient"
            ? "border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)]"
            : "border-[var(--ud-warn)]/30 bg-[var(--ud-warn)]/10 text-[var(--ud-warn)]"
        }`}
      >
        {shape === "pyramid" ? (
          <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-[var(--ud-pass)]" />
        ) : (
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        )}
        <div className="space-y-0.5 font-sans leading-relaxed">
          <span className="font-semibold capitalize">
            {shape === "pyramid"
              ? "Balanced Pyramid"
              : shape === "ice-cream-cone"
              ? "Ice-Cream Cone Warning"
              : shape === "hourglass"
              ? "Hourglass Distribution"
              : "Insufficient Data"}
          </span>
          <p className="text-[11px] opacity-90">
            {warning || "Fast unit foundation with targeted integration and reliable system tests."}
          </p>
        </div>
      </div>
    </div>
  );
}

export default TestPyramidVisualizer;
