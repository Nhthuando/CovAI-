import React from "react";

/**
 * HorizontalBarList - Pure SVG / CSS horizontal proportional bars for metrics & failure breakdown.
 */
export function HorizontalBarList({
  items = [], // [ { key, label, value, max, pct, tone, subLabel } ]
  height = 5,
  onItemClick = null,
  activeKey = null,
  className = "",
}) {
  const toneColors = {
    pass: "var(--ud-pass)",
    fail: "var(--ud-fail)",
    warn: "var(--ud-warn)",
    neutral: "var(--ud-neutral)",
    unit: "var(--ud-unit)",
    integration: "var(--ud-integration)",
    system: "var(--ud-system)",
  };

  return (
    <div className={`space-y-2 w-full ${className}`}>
      {items.map((item, idx) => {
        const val = Number(item.value) || 0;
        const max = item.max !== undefined ? Number(item.max) : 100;
        const pct = item.pct !== undefined ? Number(item.pct) : max > 0 ? (val / max) * 100 : 0;
        const safePct = Math.max(0, Math.min(100, pct));
        const color = toneColors[item.tone] || item.color || "var(--ud-unit)";
        const isClickable = Boolean(onItemClick);
        const isActive = activeKey && activeKey === (item.key || item.label);

        return (
          <div
            key={item.key || idx}
            onClick={() => isClickable && onItemClick(item)}
            className={`group text-xs transition-colors rounded-[var(--radius-sm)] p-1 ${
              isClickable ? "cursor-pointer hover:bg-[var(--ud-surface-2)]" : ""
            } ${isActive ? "bg-[var(--ud-surface-2)] ring-1 ring-[var(--ud-border)]" : ""}`}
            title={item.tooltip || `${item.label}: ${item.valueText || val}`}
          >
            {/* Header: Label & Value */}
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[11px] text-[var(--ud-text-muted)] group-hover:text-[var(--ud-text)] transition-colors truncate">
                {item.label}
              </span>
              <div className="flex items-center gap-1 shrink-0 font-mono text-[11px] font-semibold text-[var(--ud-text)] tabular-nums">
                <span>{item.valueText !== undefined ? item.valueText : `${safePct.toFixed(1)}%`}</span>
                {item.subLabel && (
                  <span className="text-[10px] text-[var(--ud-text-muted)] font-normal">
                    {item.subLabel}
                  </span>
                )}
              </div>
            </div>

            {/* Progress Track */}
            <div
              className="w-full bg-[var(--ud-surface-2)] rounded-full overflow-hidden border border-[var(--ud-border)]/40"
              style={{ height }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${safePct}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default HorizontalBarList;

