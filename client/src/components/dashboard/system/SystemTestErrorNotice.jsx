import { AlertCircle, ListOrdered, Settings2, X } from "lucide-react";

// Splits "System test job failed: Full system setup failed: <cause>" into a
// short title and the actionable cause, so long runtime errors stay readable.
function splitMessage(message) {
  const text = String(message || "").trim();
  const parts = text.split(/:\s+/);
  if (parts.length < 2) return { title: "System Test could not continue", detail: text };
  const detail = parts.slice(1).join(": ");
  return { title: parts[0].length <= 60 ? parts[0] : "System Test could not continue", detail: parts[0].length <= 60 ? detail : text };
}

const actionClass =
  "inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors duration-150 hover:border-[var(--color-text-muted)] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)]/40";

export default function SystemTestErrorNotice({ message, onDismiss, onOpenLogs, onOpenSetup, className = "" }) {
  if (!message) return null;
  const { title, detail: fullDetail } = splitMessage(message);
  // Runtime failures append raw process output after "Details:"; keep the
  // readable cause visible and fold the stack trace away.
  const detailsAt = fullDetail.indexOf(" Details: ");
  const detail = detailsAt >= 0 ? fullDetail.slice(0, detailsAt) : fullDetail;
  const technical = detailsAt >= 0 ? fullDetail.slice(detailsAt + " Details: ".length) : "";
  const setupRelated = /setup|dependenc|install|environment|database|port|start|health/i.test(message);
  return (
    <div role="alert" className={`w-full rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 text-sm ${className}`}>
      <div className="flex items-start gap-3">
        <AlertCircle size={18} className="mt-0.5 shrink-0 text-rose-400" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold text-[var(--color-text)]">{title}</p>
          {detail && <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--color-text-secondary)]">{detail}</p>}
          {technical && (
            <details className="text-xs text-[var(--color-text-muted)]">
              <summary className="cursor-pointer select-none hover:text-[var(--color-text-secondary)]">Technical details</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-2 font-mono text-[11px]">{technical}</pre>
            </details>
          )}
          {(onOpenLogs || (onOpenSetup && setupRelated)) && (
            <div className="flex flex-wrap gap-2 pt-2">
              {onOpenLogs && <button type="button" className={actionClass} onClick={onOpenLogs}><ListOrdered size={13} aria-hidden="true" />View job logs</button>}
              {onOpenSetup && setupRelated && <button type="button" className={actionClass} onClick={onOpenSetup}><Settings2 size={13} aria-hidden="true" />Review setup</button>}
            </div>
          )}
        </div>
        {onDismiss && (
          <button type="button" aria-label="Dismiss error" onClick={onDismiss} className="rounded-md p-1 text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)]">
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
