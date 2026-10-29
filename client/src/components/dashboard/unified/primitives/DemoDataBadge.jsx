import { Info } from "lucide-react";

export function DemoDataBadge({ className = "", message = "Sample preview data while unified API is in development" }) {
  return (
    <span
      title={message}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-medium rounded-[var(--radius-sm)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text-muted)] cursor-help select-none ${className}`}
    >
      <Info size={10} className="shrink-0 text-[var(--ud-text-muted)]" />
      <span>Demo data</span>
    </span>
  );
}

export default DemoDataBadge;
