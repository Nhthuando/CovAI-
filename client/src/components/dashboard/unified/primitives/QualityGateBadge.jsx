import { useState, useRef, useEffect } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ShieldAlert, ChevronDown } from "lucide-react";

export function QualityGateBadge({
  status = "PASSED",
  label = null,
  reasons = [],
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
  };

  const current = configs[status] || configs.WARNING;
  const displayLabel = label || current.defaultLabel;
  const Icon = current.icon;
  const hasReasons = Array.isArray(reasons) && reasons.length > 0;

  return (
    <div className={`relative inline-flex items-center ${className}`} ref={containerRef}>
      <button
        type="button"
        id={id}
        onClick={() => hasReasons && setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] border text-xs font-semibold tracking-wide select-none transition-colors ${current.border} ${current.bg} ${current.text} ${hasReasons ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}
        aria-expanded={open}
        aria-haspopup={hasReasons ? "dialog" : undefined}
      >
        <Icon size={14} className="shrink-0" />
        <span>{displayLabel}</span>
        {hasReasons && (
          <ChevronDown
            size={12}
            className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && hasReasons && (
        <div
          role="dialog"
          className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-3 text-[var(--ud-text)] shadow-lg"
        >
          <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-[var(--ud-border)] text-xs font-semibold text-[var(--ud-text-muted)]">
            <ShieldAlert size={14} className={current.text} />
            <span>Quality Gate Conditions</span>
          </div>
          <ul className="space-y-1.5 text-xs">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-[var(--ud-text)] font-sans">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${current.dot}`} />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default QualityGateBadge;
