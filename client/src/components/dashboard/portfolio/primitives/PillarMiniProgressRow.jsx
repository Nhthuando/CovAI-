import { useState } from "react";

export function PillarMiniProgressRow({
  label = "Unit",
  subLabel = "",
  accentColor = "var(--ud-unit)",
  coveragePct = 0,
  tooltipText = "",
  className = "",
}) {
  const [hovered, setHovered] = useState(false);
  const clampedPct = Math.min(100, Math.max(0, Number(coveragePct) || 0));

  return (
    <div
      className={`relative space-y-1 font-mono text-xs select-none ${className}`}
      title={tooltipText}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: accentColor }}
          />
          <span className="font-semibold text-[var(--ud-text)] shrink-0">
            {label}
          </span>
          {subLabel && (
            <span className="text-[var(--ud-text-muted)] text-[10px] truncate">
              · {subLabel}
            </span>
          )}
        </div>

        <div className="flex items-center shrink-0">
          <span className="font-bold tabular-nums text-[var(--ud-text)]">
            {clampedPct}%
          </span>
        </div>
      </div>

      {/* Progress Bar Track */}
      <div className="h-1.5 w-full rounded-full bg-[var(--ud-surface-2)] overflow-hidden">
        <div
          style={{
            width: `${clampedPct}%`,
            backgroundColor: accentColor,
          }}
          className="h-full rounded-full transition-all duration-300"
        />
      </div>

      {/* Clean Hover Tooltip for Pass/Fail Counts */}
      {hovered && tooltipText && (
        <div className="absolute right-0 -top-7 px-2 py-0.5 rounded bg-[var(--ud-surface)] border border-[var(--ud-border)] shadow-md text-[10px] font-mono tabular-nums text-[var(--ud-text)] whitespace-nowrap z-20 pointer-events-none">
          {tooltipText}
        </div>
      )}
    </div>
  );
}

export default PillarMiniProgressRow;

