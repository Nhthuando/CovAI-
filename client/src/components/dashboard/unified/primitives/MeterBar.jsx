export function MeterBar({
  value = 0,
  threshold = null,
  tone = "auto", // auto | pass | fail | warn | unit | integration | system
  height = 6,
  className = "",
  label = "Coverage",
}) {
  const safeVal = Math.max(0, Math.min(100, Number(value) || 0));

  let fillColor = "var(--ud-pass)";
  if (tone === "auto") {
    if (safeVal >= 80) fillColor = "var(--ud-pass)";
    else if (safeVal >= 60) fillColor = "var(--ud-warn)";
    else fillColor = "var(--ud-fail)";
  } else if (tone === "pass") fillColor = "var(--ud-pass)";
  else if (tone === "fail") fillColor = "var(--ud-fail)";
  else if (tone === "warn") fillColor = "var(--ud-warn)";
  else if (tone === "unit") fillColor = "var(--ud-unit)";
  else if (tone === "integration") fillColor = "var(--ud-integration)";
  else if (tone === "system") fillColor = "var(--ud-system)";
  else if (tone === "neutral") fillColor = "var(--ud-neutral)";

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={safeVal}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`relative w-full overflow-hidden rounded-full bg-[var(--ud-surface-2)] border border-[var(--ud-border)]/50 ${className}`}
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{
          width: `${safeVal}%`,
          backgroundColor: fillColor,
        }}
      />
      {threshold !== null && threshold >= 0 && threshold <= 100 && (
        <div
          title={`Target: ${threshold}%`}
          className="absolute top-0 bottom-0 w-0.5 bg-[var(--ud-text-muted)] opacity-70 pointer-events-none"
          style={{ left: `${threshold}%` }}
        />
      )}
    </div>
  );
}

export default MeterBar;
