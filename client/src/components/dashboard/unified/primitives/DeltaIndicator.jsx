import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { fmtDelta } from "../../../../services/unifiedDashboard/format.js";

export function DeltaIndicator({
  delta,
  decimals = 1,
  showLabel = true,
  className = "",
  invertColor = false, // if true, positive is bad (e.g. failure rate)
}) {
  if (delta === null || delta === undefined || Number.isNaN(Number(delta))) {
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ud-text-muted)] ${className}`}>
        <Minus size={11} />
        <span>No baseline</span>
      </span>
    );
  }

  const num = Number(delta);
  const formatted = fmtDelta(num, decimals);

  const isPositive = num > 0;
  const isNegative = num < 0;
  const isZero = num === 0;

  let tone = "text-[var(--ud-text-muted)]";
  if (!isZero) {
    if (invertColor) {
      tone = isPositive ? "text-[var(--ud-fail)]" : "text-[var(--ud-pass)]";
    } else {
      tone = isPositive ? "text-[var(--ud-pass)]" : "text-[var(--ud-fail)]";
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-mono font-medium ${tone} ${className}`}
      title={`${formatted} compared to previous snapshot`}
    >
      {isPositive && <ArrowUpRight size={13} className="shrink-0" />}
      {isNegative && <ArrowDownRight size={13} className="shrink-0" />}
      {isZero && <Minus size={12} className="shrink-0" />}
      <span className="tabular-nums font-semibold">{formatted}</span>
      {showLabel && (
        <span className="text-[10px] text-[var(--ud-text-muted)] ml-0.5 font-sans font-normal">
          vs prev
        </span>
      )}
    </span>
  );
}

export default DeltaIndicator;
