import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { SegmentedFilter } from "../primitives/SegmentedFilter.jsx";
import { fmtDuration, fmtCount } from "../../../../services/unifiedDashboard/format.js";

export function TestPyramidVisualizer({
  pyramid,
  activeCrossFilter = null,
  onSelectCrossFilter = null,
  className = "",
}) {
  const [metricMode, setMetricMode] = useState("count"); // 'count' | 'duration'

  const {
    shape = "insufficient",
    badgeTitle = null,
    tone = "neutral",
    warning = null,
    layers = [],
  } = pyramid || {};

  // Find layer by pillar
  const systemLayer = layers.find((l) => l.pillar === "system") || {
    pillar: "system",
    label: "System (E2E)",
    count: 0,
    pctOfTotal: 0,
    durationMs: 0,
  };
  const intLayer = layers.find((l) => l.pillar === "integration") || {
    pillar: "integration",
    label: "Integration",
    count: 0,
    pctOfTotal: 0,
    durationMs: 0,
  };
  const unitLayer = layers.find((l) => l.pillar === "unit") || {
    pillar: "unit",
    label: "Unit Tests",
    count: 0,
    pctOfTotal: 0,
    durationMs: 0,
  };

  const totalCount =
    (unitLayer.count || 0) + (intLayer.count || 0) + (systemLayer.count || 0);
  const totalDuration =
    (unitLayer.durationMs || 0) +
    (intLayer.durationMs || 0) +
    (systemLayer.durationMs || 0);

  const getLayerValue = (l) =>
    metricMode === "duration" ? Number(l.durationMs || 0) : Number(l.count || 0);

  const maxVal = Math.max(
    1,
    getLayerValue(systemLayer),
    getLayerValue(intLayer),
    getLayerValue(unitLayer)
  );

  // Compute true visual widths for each tier so 0-test tiers look empty/collapsed
  const computeTierWidths = (layer, idealTop, idealBot) => {
    const val = getLayerValue(layer);
    const hasTests = Number(layer.count || 0) > 0;
    if (!hasTests || val <= 0) {
      return {
        topW: 108,
        botW: 120,
        isEmpty: true,
      };
    }

    if (shape === "pyramid" && metricMode === "count") {
      return {
        topW: idealTop,
        botW: idealBot,
        isEmpty: false,
      };
    }

    // Proportional width based on actual share relative to max layer
    const ratio = Math.max(0.28, Math.min(1.0, val / maxVal));
    const baseW = Math.round(96 + ratio * 184);
    return {
      topW: Math.max(88, baseW - 16),
      botW: baseW,
      isEmpty: false,
    };
  };

  const sysDim = computeTierWidths(systemLayer, 68, 124);
  const intDim = computeTierWidths(intLayer, 132, 200);
  const unitDim = computeTierWidths(unitLayer, 208, 284);

  const svgWidth = 320;
  const svgHeight = 160;
  const cx = svgWidth / 2;

  const topY1 = 12,
    topY2 = 54;
  const midY1 = 58,
    midY2 = 104;
  const botY1 = 108,
    botY2 = 152;

  const handleTierClick = (pillar, label) => {
    onSelectCrossFilter?.({
      pillar,
      category: null,
      label: `${label} Pillar`,
    });
  };

  const resolvedTitle =
    badgeTitle ||
    (shape === "pyramid"
      ? "Balanced Pyramid"
      : shape === "missing-unit"
      ? "Unbalanced Pyramid — Missing Unit Test Foundation"
      : shape === "ice-cream-cone"
      ? "Inverted Pyramid (Ice-Cream Cone Anti-Pattern)"
      : shape === "hourglass"
      ? "Hourglass Distribution"
      : shape === "insufficient"
      ? "No Tests Executed — Run suites or enable Demo Mode"
      : "Unbalanced Pyramid");

  const resolvedTone =
    tone ||
    (shape === "pyramid"
      ? "pass"
      : shape === "insufficient"
      ? "neutral"
      : shape === "ice-cream-cone"
      ? "fail"
      : "warn");

  const bannerStyles = {
    pass: "border-[var(--ud-pass)]/30 bg-[var(--ud-pass)]/10 text-[var(--ud-pass)]",
    warn: "border-[var(--ud-warn)]/40 bg-[var(--ud-warn)]/10 text-[var(--ud-warn)]",
    fail: "border-[var(--ud-fail)]/40 bg-[var(--ud-fail)]/10 text-[var(--ud-fail)]",
    neutral: "border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)]",
  };

  return (
    <div className={`flex flex-col justify-between h-full space-y-4 ${className}`}>
      {/* Visualizer Header & Mode Switch */}
      <div className="flex items-center justify-between gap-2">
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

      {/* SVG Pyramid Visualization (Interactive Tiers for Cross-Filtering) */}
      <div className="relative flex items-center justify-center my-1 select-none">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full max-w-[320px] h-auto drop-shadow-xs"
          role="img"
          aria-label={`Test Pyramid representing ${unitLayer.count} unit tests, ${intLayer.count} integration tests, and ${systemLayer.count} system tests`}
        >
          {/* Top Tier: System (Teal) */}
          <g
            onClick={() => handleTierClick("system", "System (E2E)")}
            className="cursor-pointer group"
          >
            <polygon
              points={`${cx - sysDim.topW / 2},${topY1} ${cx + sysDim.topW / 2},${topY1} ${cx + sysDim.botW / 2},${topY2} ${cx - sysDim.botW / 2},${topY2}`}
              fill="var(--ud-system)"
              fillOpacity={
                activeCrossFilter?.pillar === "system"
                  ? "0.34"
                  : sysDim.isEmpty
                  ? "0.04"
                  : "0.20"
              }
              stroke="var(--ud-system)"
              strokeOpacity={sysDim.isEmpty ? "0.4" : "1"}
              strokeDasharray={sysDim.isEmpty ? "4 3" : undefined}
              strokeWidth={activeCrossFilter?.pillar === "system" ? "2.2" : "1.5"}
              strokeLinejoin="round"
            />
            <text
              x={cx}
              y={(topY1 + topY2) / 2 + 4}
              textAnchor="middle"
              fill={sysDim.isEmpty ? "var(--ud-text-muted)" : "var(--ud-system)"}
              fontSize="11"
              fontFamily="var(--font-mono)"
              fontWeight="bold"
            >
              E2E ({metricMode === "duration" ? fmtDuration(systemLayer.durationMs) : systemLayer.count})
            </text>
          </g>

          {/* Middle Tier: Integration (Purple) */}
          <g
            onClick={() => handleTierClick("integration", "Integration")}
            className="cursor-pointer group"
          >
            <polygon
              points={`${cx - intDim.topW / 2},${midY1} ${cx + intDim.topW / 2},${midY1} ${cx + intDim.botW / 2},${midY2} ${cx - intDim.botW / 2},${midY2}`}
              fill="var(--ud-integration)"
              fillOpacity={
                activeCrossFilter?.pillar === "integration"
                  ? "0.34"
                  : intDim.isEmpty
                  ? "0.04"
                  : "0.22"
              }
              stroke="var(--ud-integration)"
              strokeOpacity={intDim.isEmpty ? "0.4" : "1"}
              strokeDasharray={intDim.isEmpty ? "4 3" : undefined}
              strokeWidth={activeCrossFilter?.pillar === "integration" ? "2.2" : "1.5"}
              strokeLinejoin="round"
            />
            <text
              x={cx}
              y={(midY1 + midY2) / 2 + 4}
              textAnchor="middle"
              fill={intDim.isEmpty ? "var(--ud-text-muted)" : "var(--ud-integration)"}
              fontSize="11"
              fontFamily="var(--font-mono)"
              fontWeight="bold"
            >
              Integration ({metricMode === "duration" ? fmtDuration(intLayer.durationMs) : intLayer.count})
            </text>
          </g>

          {/* Base Tier: Unit Tests (Blue) */}
          <g
            onClick={() => handleTierClick("unit", "Unit Tests")}
            className="cursor-pointer group"
          >
            <polygon
              points={`${cx - unitDim.topW / 2},${botY1} ${cx + unitDim.topW / 2},${botY1} ${cx + unitDim.botW / 2},${botY2} ${cx - unitDim.botW / 2},${botY2}`}
              fill="var(--ud-unit)"
              fillOpacity={
                activeCrossFilter?.pillar === "unit"
                  ? "0.34"
                  : unitDim.isEmpty
                  ? "0.04"
                  : "0.22"
              }
              stroke="var(--ud-unit)"
              strokeOpacity={unitDim.isEmpty ? "0.4" : "1"}
              strokeDasharray={unitDim.isEmpty ? "4 3" : undefined}
              strokeWidth={activeCrossFilter?.pillar === "unit" ? "2.2" : "1.5"}
              strokeLinejoin="round"
            />
            <text
              x={cx}
              y={(botY1 + botY2) / 2 + 4}
              textAnchor="middle"
              fill={unitDim.isEmpty ? "var(--ud-text-muted)" : "var(--ud-unit)"}
              fontSize="11"
              fontFamily="var(--font-mono)"
              fontWeight="bold"
            >
              Unit Tests ({metricMode === "duration" ? fmtDuration(unitLayer.durationMs) : unitLayer.count})
            </text>
          </g>
        </svg>
      </div>

      {/* Layer Metrics Summary List (Clickable for Cross-Filtering) */}
      <div className="space-y-1 text-xs font-mono pt-2 border-t border-[var(--ud-border)]">
        {[
          {
            pillar: "system",
            title: "Top: System (E2E)",
            color: "bg-[var(--ud-system)]",
            layer: systemLayer,
          },
          {
            pillar: "integration",
            title: "Middle: Integration",
            color: "bg-[var(--ud-integration)]",
            layer: intLayer,
          },
          {
            pillar: "unit",
            title: "Base: Unit Tests",
            color: "bg-[var(--ud-unit)]",
            layer: unitLayer,
          },
        ].map((row) => {
          const isSelected =
            activeCrossFilter?.pillar === row.pillar && !activeCrossFilter?.category;
          return (
            <button
              key={row.pillar}
              type="button"
              onClick={() => handleTierClick(row.pillar, row.layer.label)}
              className={`w-full flex items-center justify-between px-2 py-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer text-left ${
                isSelected
                  ? "bg-[var(--ud-surface-2)] text-[var(--ud-text)] ring-1 ring-[var(--ud-border)]"
                  : "text-[var(--ud-text-muted)] hover:bg-[var(--ud-surface-2)]/60"
              }`}
              title={`Click to filter Zone 4 by ${row.layer.label}`}
            >
              <span className="flex items-center gap-1.5 font-sans">
                <span className={`w-2 h-2 rounded-full ${row.color} shrink-0`} />
                <span>{row.title}</span>
              </span>
              <span className="tabular-nums font-semibold text-[var(--ud-text)]">
                {fmtCount(row.layer.count)} tests • {fmtDuration(row.layer.durationMs)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Shape Assessment & Warning Banner */}
      <div
        className={`rounded-[var(--radius-sm)] border p-2.5 text-xs flex items-start gap-2 ${
          bannerStyles[resolvedTone] || bannerStyles.neutral
        }`}
      >
        {resolvedTone === "pass" ? (
          <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-[var(--ud-pass)]" />
        ) : resolvedTone === "neutral" ? (
          <Info size={14} className="shrink-0 mt-0.5 text-[var(--ud-text-muted)]" />
        ) : (
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        )}
        <div className="space-y-0.5 font-sans leading-relaxed">
          <span className="font-semibold block">{resolvedTitle}</span>
          <p className="text-[11px] opacity-90">
            {warning ||
              (totalCount > 0 || totalDuration > 0
                ? "Fast unit foundation with targeted integration and reliable system tests."
                : "Execute test suites or switch to Demo Showcase to inspect multi-tier balance.")}
          </p>
        </div>
      </div>
    </div>
  );
}

export default TestPyramidVisualizer;
