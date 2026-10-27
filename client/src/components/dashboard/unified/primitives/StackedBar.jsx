export function StackedBar({
  segments = [],
  total = null,
  height = 8,
  showLegend = true,
  className = "",
  ariaLabel = "Test execution distribution",
}) {
  const sum = total !== null ? total : segments.reduce((acc, s) => acc + (Number(s.value) || 0), 0);

  const toneColors = {
    pass: "var(--ud-pass)",
    fail: "var(--ud-fail)",
    warn: "var(--ud-warn)",
    neutral: "var(--ud-neutral)",
    unit: "var(--ud-unit)",
    integration: "var(--ud-integration)",
    system: "var(--ud-system)",
  };

  const calculatedSegments = segments.map((seg) => {
    const val = Number(seg.value) || 0;
    const pct = sum > 0 ? (val / sum) * 100 : 0;
    return {
      ...seg,
      pct,
      color: toneColors[seg.tone] || seg.color || "var(--ud-neutral)",
    };
  });

  return (
    <div className={`w-full space-y-1.5 ${className}`}>
      {/* Visual Stacked Progress Bar */}
      <div
        role="progressbar"
        aria-label={ariaLabel}
        className="w-full overflow-hidden rounded-full bg-[var(--ud-surface-2)] flex border border-[var(--ud-border)]/60"
        style={{ height }}
      >
        {sum > 0 ? (
          calculatedSegments.map((seg, idx) => {
            if (seg.pct <= 0) return null;
            return (
              <div
                key={seg.key || idx}
                style={{
                  width: `${seg.pct}%`,
                  backgroundColor: seg.color,
                }}
                title={`${seg.label || seg.key}: ${seg.value} (${seg.pct.toFixed(1)}%)`}
                className="h-full transition-all duration-200"
              />
            );
          })
        ) : (
          <div className="w-full h-full bg-[var(--ud-surface-2)] opacity-50" />
        )}
      </div>

      {/* Text Legend */}
      {showLegend && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {calculatedSegments.map((seg, idx) => (
            <div key={seg.key || idx} className="inline-flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              <span className="text-[var(--ud-text-muted)] text-[11px] font-sans">
                {seg.label || seg.key}
              </span>
              <span className="font-mono tabular-nums text-xs font-semibold text-[var(--ud-text)]">
                {seg.value ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default StackedBar;
