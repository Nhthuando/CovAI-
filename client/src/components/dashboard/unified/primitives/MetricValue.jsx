export function MetricValue({
  value,
  unit = null,
  size = "md",
  tone = "default",
  className = "",
}) {
  const isNil = value === null || value === undefined || value === "—" || value === "";

  const sizeStyles = {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-2xl",
    xl: "text-3xl font-extrabold",
  };

  const toneStyles = {
    default: "text-[var(--ud-text)]",
    muted: "text-[var(--ud-text-muted)]",
    pass: "text-[var(--ud-pass)]",
    fail: "text-[var(--ud-fail)]",
    warn: "text-[var(--ud-warn)]",
    unit: "text-[var(--ud-unit)]",
    integration: "text-[var(--ud-integration)]",
    system: "text-[var(--ud-system)]",
  };

  return (
    <span
      className={`inline-flex items-baseline font-mono tabular-nums font-bold tracking-tight select-text ${toneStyles[tone] || toneStyles.default} ${sizeStyles[size] || sizeStyles.md} ${className}`}
    >
      <span>{isNil ? "—" : value}</span>
      {!isNil && unit && (
        <span className="ml-1 text-xs font-normal text-[var(--ud-text-muted)] select-none">
          {unit}
        </span>
      )}
    </span>
  );
}

export default MetricValue;
