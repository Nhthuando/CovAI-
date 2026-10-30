import { useState, useRef, useEffect } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ShieldAlert, ChevronDown } from "lucide-react";

const DEFAULT_CHECKLIST = [
  { id: "chk-unit-branch", label: "Unit Branch Coverage >= 75%", currentValue: "0.0%", passed: false },
  { id: "chk-api-endpoint", label: "API Endpoint Coverage >= 80%", currentValue: "0.0%", passed: false },
  { id: "chk-e2e-passing", label: "Critical E2E Journeys Passing = 100%", currentValue: "0/0 Journeys", passed: false },
  { id: "chk-zero-defects", label: "Zero High-Severity Cross-Layer Defects", currentValue: "Unverified", passed: false },
];

export function QualityGateBadge({
  status = "PASSED",
  label = null,
  reasons = [],
  checklist = null,
  className = "",
  id = "ud-quality-gate-badge",
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const configs = {
    PASSED: {
      defaultLabel: "READY TO RELEASE",
      icon: CheckCircle2,
      border: "border-[var(--ud-pass)]/40",
      bg: "bg-[var(--ud-pass)]/10",
      text: "text-[var(--ud-pass)]",
      dot: "bg-[var(--ud-pass)]",
    },
    WARNING: {
      defaultLabel: "AT RISK",
      icon: AlertTriangle,
      border: "border-[var(--ud-warn)]/40",
      bg: "bg-[var(--ud-warn)]/10",
      text: "text-[var(--ud-warn)]",
      dot: "bg-[var(--ud-warn)]",
    },
    FAILED: {
      defaultLabel: "BLOCKED",
      icon: XCircle,
      border: "border-[var(--ud-fail)]/40",
      bg: "bg-[var(--ud-fail)]/10",
      text: "text-[var(--ud-fail)]",
      dot: "bg-[var(--ud-fail)]",
    },
    UNVERIFIED: {
      defaultLabel: "UNVERIFIED",
      icon: ShieldAlert,
      border: "border-[var(--ud-border-strong)]",
      bg: "bg-[var(--ud-surface-2)]",
      text: "text-[var(--ud-text-muted)]",
      dot: "bg-[var(--ud-text-muted)]",
    },
  };

  const current = configs[status] || configs.WARNING;
  const displayLabel = label || current.defaultLabel;
  const Icon = current.icon;
  const items = Array.isArray(checklist) && checklist.length > 0 ? checklist : DEFAULT_CHECKLIST;
  const passedCount = items.filter((c) => c.passed).length;

  return (
    <div className={`relative inline-flex items-center ${className}`} ref={containerRef}>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] border text-xs font-semibold tracking-wide select-none transition-colors cursor-pointer hover:opacity-90 ${current.border} ${current.bg} ${current.text}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Click to inspect Quality Gate Prerequisite Checklist"
      >
        <Icon size={14} className="shrink-0" />
        <span>{displayLabel}</span>
        <span className="font-mono text-[10px] opacity-85 px-1 py-0.2 rounded bg-black/15">
          {passedCount}/{items.length}
        </span>
        <ChevronDown
          size={12}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Quality Gate Prerequisite Checklist"
          className="absolute right-0 sm:left-0 top-full mt-1.5 z-50 w-80 sm:w-96 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-3.5 text-[var(--ud-text)] shadow-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-[var(--ud-border)]">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ud-text)]">
              <ShieldAlert size={14} className={current.text} />
              <span>Quality Gate Prerequisite Checklist</span>
            </div>
            <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border ${current.border} ${current.bg} ${current.text}`}>
              {passedCount}/{items.length} PASSED
            </span>
          </div>

          {/* 4-Condition Checklist Table */}
          <div className="space-y-1.5 mb-3">
            {items.map((chk) => (
              <div
                key={chk.id}
                className="flex items-center justify-between gap-2 p-2 rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)]/70 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {chk.passed ? (
                    <CheckCircle2 size={14} className="shrink-0 text-[var(--ud-pass)]" />
                  ) : (
                    <XCircle size={14} className="shrink-0 text-[var(--ud-fail)]" />
                  )}
                  <span className="font-sans text-[11px] font-medium text-[var(--ud-text)] leading-tight">
                    {chk.label}
                  </span>
                </div>
                <span
                  className={`font-mono text-[11px] font-semibold tabular-nums shrink-0 px-1.5 py-0.5 rounded border ${
                    chk.passed
                      ? "border-[var(--ud-pass)]/30 bg-[var(--ud-pass)]/10 text-[var(--ud-pass)]"
                      : "border-[var(--ud-fail)]/30 bg-[var(--ud-fail)]/10 text-[var(--ud-fail)]"
                  }`}
                >
                  {chk.currentValue}
                </span>
              </div>
            ))}
          </div>

          {/* Diagnostic Notes */}
          {Array.isArray(reasons) && reasons.length > 0 && (
            <div className="pt-2 border-t border-[var(--ud-border)]">
              <span className="block text-[10px] font-mono uppercase tracking-wider text-[var(--ud-text-muted)] mb-1.5">
                Gate Evaluation Notes
              </span>
              <ul className="space-y-1 text-[11px] text-[var(--ud-text-muted)]">
                {reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 font-sans">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${current.dot}`} />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default QualityGateBadge;
