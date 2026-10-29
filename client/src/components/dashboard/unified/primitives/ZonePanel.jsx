import { RefreshCw, AlertTriangle, Inbox } from "lucide-react";
import { DemoDataBadge } from "./DemoDataBadge.jsx";

export function ZonePanel({
  title,
  description = null,
  source = "live", // live | demo | unavailable
  state = "ready", // ready | loading | empty | error
  emptyMessage = "No data available for this section.",
  errorMessage = "Failed to load data.",
  onRetry = null,
  actions = null,
  children,
  className = "",
  contentClassName = "p-5",
  id = null,
}) {
  return (
    <section
      id={id}
      className={`rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] flex flex-col transition-colors ${className}`}
    >
      {/* Panel Header */}
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--ud-border)] min-h-[48px]">
          <div className="flex items-center gap-2.5 min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-[var(--ud-text)] truncate">
              {title}
            </h3>
            {source === "demo" && <DemoDataBadge />}
            {description && (
              <span className="text-xs text-[var(--ud-text-muted)] hidden sm:inline">
                • {description}
              </span>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}

      {/* Content depending on state */}
      <div className={`flex-1 min-h-0 ${contentClassName}`}>
        {state === "error" ? (
          <div
            role="alert"
            className="flex flex-col items-center justify-center p-8 text-center gap-3"
          >
            <div className="w-9 h-9 rounded-full bg-[var(--ud-fail)]/10 text-[var(--ud-fail)] flex items-center justify-center">
              <AlertTriangle size={18} />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[var(--ud-text)]">
                {errorMessage}
              </p>
              <p className="text-[11px] text-[var(--ud-text-muted)] font-mono">
                Unable to retrieve section metrics.
              </p>
            </div>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] text-[var(--ud-text)] hover:border-[var(--ud-text-muted)] transition-colors cursor-pointer"
              >
                <RefreshCw size={12} />
                <span>Retry</span>
              </button>
            )}
          </div>
        ) : state === "empty" ? (
          <div className="flex flex-col items-center justify-center p-8 text-center gap-2 text-[var(--ud-text-muted)]">
            <Inbox size={24} className="opacity-50" />
            <p className="text-xs font-sans">{emptyMessage}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

export default ZonePanel;
