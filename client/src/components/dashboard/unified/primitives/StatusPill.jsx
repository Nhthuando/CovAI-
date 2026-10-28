import { CheckCircle2, XCircle, AlertTriangle, MinusCircle, HelpCircle } from "lucide-react";

export function StatusPill({
  status = "pass",
  label = null,
  counts = null,
  size = "md",
  className = "",
}) {
  const norm = String(status || "").toLowerCase();

  let tone;
  let Icon;
  let defaultLabel;

  if (["pass", "passed", "healthy", "covered", "ready"].includes(norm)) {
    tone = "pass";
    Icon = CheckCircle2;
    defaultLabel = "Passed";
  } else if (["fail", "failed", "critical", "blocked", "error"].includes(norm)) {
    tone = "fail";
    Icon = XCircle;
    defaultLabel = "Failed";
  } else if (["warn", "warning", "flaky", "at_risk", "low_coverage"].includes(norm)) {
    tone = "warn";
    Icon = AlertTriangle;
    defaultLabel = "Warning";
  } else if (["untested", "uncovered", "pending", "skipped", "not_run"].includes(norm)) {
    tone = "neutral";
    Icon = MinusCircle;
    defaultLabel = "Untested";
  } else {
    tone = "neutral";
    Icon = HelpCircle;
    defaultLabel = norm || "Unknown";
  }

  const toneStyles = {
    pass: "border-[var(--ud-pass)]/30 bg-[var(--ud-pass)]/10 text-[var(--ud-pass)]",
    fail: "border-[var(--ud-fail)]/30 bg-[var(--ud-fail)]/10 text-[var(--ud-fail)]",
    warn: "border-[var(--ud-warn)]/30 bg-[var(--ud-warn)]/10 text-[var(--ud-warn)]",
    neutral: "border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)]",
  };

  const sizeStyles = {
    sm: "text-[10px] px-1.5 py-0.5 gap-1",
    md: "text-xs px-2 py-0.5 gap-1.5",
    lg: "text-sm px-2.5 py-1 gap-2",
  };

  return (
    <span
      className={`inline-flex items-center font-mono font-medium rounded-[var(--radius-sm)] border select-none whitespace-nowrap ${toneStyles[tone]} ${sizeStyles[size] || sizeStyles.md} ${className}`}
    >
      <Icon size={size === "sm" ? 11 : 13} className="shrink-0" />
      <span>{label || defaultLabel}</span>
      {counts && (
        <span className="tabular-nums font-semibold opacity-90 ml-0.5">({counts})</span>
      )}
    </span>
  );
}

export default StatusPill;
