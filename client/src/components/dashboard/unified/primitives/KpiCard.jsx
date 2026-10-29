import { Skeleton } from "../../../common/Skeleton.jsx";

export function KpiCard({
  label,
  value,
  unit = null,
  icon: Icon = null,
  delta = null,
  grade = null,
  badge = null,
  supporting = null,
  children = null,
  footer = null,
  loading = false,
  className = "",
  id = null,
}) {
  if (loading) {
    return (
      <div
        id={id}
        className={`rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between min-h-[140px] ${className}`}
      >
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
        <div className="space-y-2 my-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-3 w-full mt-3" />
      </div>
    );
  }

  return (
    <div
      id={id}
      className={`rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between min-h-[140px] transition-colors hover:border-[var(--ud-border)]/80 ${className}`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between text-xs text-[var(--ud-text-muted)] font-medium mb-1">
        <span className="font-sans tracking-wide truncate">{label}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {badge}
          {Icon && <Icon size={16} className="text-[var(--ud-text-muted)]" />}
        </div>
      </div>

      {/* Main Metric Value & Supporting info */}
      <div className="my-1.5">
        <div className="flex items-baseline gap-2.5">
          {value !== undefined && value !== null && (
            <div className="flex items-baseline font-mono tabular-nums font-bold text-2xl tracking-tight text-[var(--ud-text)]">
              <span>{value}</span>
              {unit && (
                <span className="ml-1 text-xs font-normal text-[var(--ud-text-muted)]">
                  {unit}
                </span>
              )}
            </div>
          )}
          {grade && (
            <span
              className={`inline-flex items-center justify-center w-7 h-7 text-xs font-mono font-bold rounded-[var(--radius-sm)] border ${
                grade === "A"
                  ? "border-[var(--ud-pass)]/40 bg-[var(--ud-pass)]/10 text-[var(--ud-pass)]"
                  : grade === "B"
                  ? "border-[var(--ud-unit)]/40 bg-[var(--ud-unit)]/10 text-[var(--ud-unit)]"
                  : grade === "C"
                  ? "border-[var(--ud-warn)]/40 bg-[var(--ud-warn)]/10 text-[var(--ud-warn)]"
                  : "border-[var(--ud-fail)]/40 bg-[var(--ud-fail)]/10 text-[var(--ud-fail)]"
              }`}
              title={`Health Grade: ${grade}`}
            >
              {grade}
            </span>
          )}
          {delta}
        </div>

        {supporting && (
          <div className="text-xs text-[var(--ud-text-muted)] mt-1 font-sans">
            {supporting}
          </div>
        )}

        {children}
      </div>

      {/* Footer / Context Line */}
      {footer && (
        <div className="pt-2 mt-2 border-t border-[var(--ud-border)] text-[11px] text-[var(--ud-text-muted)] flex items-center justify-between">
          {footer}
        </div>
      )}
    </div>
  );
}

export default KpiCard;
