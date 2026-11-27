import { memo } from "react";
import { LIFECYCLE_META } from "../../../../../../shared/portfolioGovernance.js";

const BADGE_STYLES = {
  DOING: {
    container:
      "bg-[var(--color-primary)]/12 text-[var(--color-primary)] border-[var(--color-primary)]/30",
    dot: "bg-[var(--color-primary)]",
  },
  NOT_STARTED: {
    container:
      "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
    dot: "bg-[var(--color-text-muted)]",
  },
  PAUSED: {
    container:
      "bg-[var(--color-warning)]/12 text-[var(--color-warning)] border-[var(--color-warning)]/35",
    dot: "bg-[var(--color-warning)]",
  },
  COMPLETED: {
    container:
      "bg-[var(--color-success)]/12 text-[var(--color-success)] border-[var(--color-success)]/35",
    dot: "bg-[var(--color-success)]",
  },
  CANCELLED: {
    container:
      "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30",
    dot: "bg-[var(--color-danger)]",
  },
};

const SIZE_CLASSES = {
  xs: "px-1.5 py-0.5 text-[10px] gap-1",
  sm: "px-2 py-0.5 text-[11px] gap-1.5",
};

/**
 * Read-only static lifecycle status pill with high contrast across Dark & Light themes.
 */
function LifecycleStatusBadge({
  status = "NOT_STARTED",
  size = "sm",
  showIsolatedHint = false,
  className = "",
}) {
  const normalized = LIFECYCLE_META[status] ? status : "NOT_STARTED";
  const meta = LIFECYCLE_META[normalized];
  const style = BADGE_STYLES[normalized] || BADGE_STYLES.NOT_STARTED;
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.sm;

  return (
    <span
      className={`inline-flex items-center rounded-md border font-mono font-medium whitespace-nowrap select-none leading-tight ${style.container} ${sizeClass} ${className}`}
      title={`${meta.label} — ${meta.description}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
      <span>{meta.label}</span>
      {showIsolatedHint && !meta.includedInKpis && (
        <span className="text-[9px] opacity-75">· Isolated</span>
      )}
    </span>
  );
}

export default memo(LifecycleStatusBadge);
