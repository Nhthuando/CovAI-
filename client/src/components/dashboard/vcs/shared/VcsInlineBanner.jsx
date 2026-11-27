import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from "lucide-react";

const TONE_STYLES = Object.freeze({
  warning: {
    stripe: "border-l-[var(--color-warning)]",
    iconColor: "text-[var(--color-warning)]",
    dot: "bg-[var(--color-warning)]",
    DefaultIcon: AlertTriangle,
  },
  danger: {
    stripe: "border-l-[var(--color-danger)]",
    iconColor: "text-[var(--color-danger)]",
    dot: "bg-[var(--color-danger)]",
    DefaultIcon: AlertCircle,
  },
  success: {
    stripe: "border-l-[var(--color-success)]",
    iconColor: "text-[var(--color-success)]",
    dot: "bg-[var(--color-success)]",
    DefaultIcon: CheckCircle2,
  },
  info: {
    stripe: "border-l-[var(--color-secondary)]",
    iconColor: "text-[var(--color-secondary)]",
    dot: "bg-[var(--color-secondary)]",
    DefaultIcon: Info,
  },
});

/**
 * Restrained VS Code / Linear style inline status banner.
 * Uses neutral surfaces with a subtle 2px semantic left stripe so banners remain
 * crisp in both Dark and Light themes without heavy full-box tinted highlights.
 */
export default function VcsInlineBanner({
  tone = "info",
  icon: CustomIcon = null,
  pulsing = false,
  title = "",
  detail = "",
  meta = "",
  mono = false,
  actions = null,
  onDismiss = null,
  dismissLabel = "Dismiss notification",
  className = "",
  "data-testid": testId,
}) {
  const style = TONE_STYLES[tone] || TONE_STYLES.info;
  const Icon = CustomIcon || style.DefaultIcon;

  return (
    <div
      data-testid={testId}
      className={`flex flex-wrap items-center justify-between gap-2.5 px-3 py-2 rounded-md border border-[var(--color-border)] border-l-2 ${style.stripe} bg-[var(--color-surface)] text-xs shrink-0 ${className}`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {pulsing ? (
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-70 ${style.dot}`}
            />
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${style.dot}`}
            />
          </span>
        ) : (
          <Icon size={14} className={`${style.iconColor} shrink-0`} />
        )}

        <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {title && (
            <span
              className={`font-medium text-[var(--color-text)] ${mono ? "font-mono" : ""}`}
            >
              {title}
            </span>
          )}
          {detail && (
            <span className="text-[var(--color-text-secondary)]">
              {detail}
            </span>
          )}
          {meta && (
            <span className="text-[11px] font-mono tabular-nums text-[var(--color-text-muted)]">
              {meta}
            </span>
          )}
        </div>
      </div>

      {(actions || onDismiss) && (
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {actions}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label={dismissLabel}
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] cursor-pointer transition-colors duration-150"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
