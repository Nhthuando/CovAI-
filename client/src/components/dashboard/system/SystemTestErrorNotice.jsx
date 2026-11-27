import { AlertCircle, ListOrdered, Settings2, X } from "lucide-react";
import { Button } from "../../ui/button.jsx";

// Splits "System test job failed: Full system setup failed: <cause>" into a
// short title and the actionable cause, so long runtime errors stay readable.
function splitMessage(message) {
  const text = String(message || "").trim();
  const parts = text.split(/:\s+/);
  if (parts.length < 2) return { title: "System Test could not continue", detail: text };
  const detail = parts.slice(1).join(": ");
  return { title: parts[0].length <= 60 ? parts[0] : "System Test could not continue", detail: parts[0].length <= 60 ? detail : text };
}

export default function SystemTestErrorNotice({ message, onDismiss, onOpenLogs, onOpenSetup, messageOnly, primaryAction, className = "" }) {
  if (!message) return null;
  const { title, detail: fullDetail } = messageOnly ? { title: message, detail: "" } : splitMessage(message);
  // Runtime failures append raw process output after "Details:"; keep the
  // readable cause visible and fold the stack trace away.
  const detailsAt = fullDetail.indexOf(" Details: ");
  const detail = detailsAt >= 0 ? fullDetail.slice(0, detailsAt) : fullDetail;
  const technical = detailsAt >= 0 ? fullDetail.slice(detailsAt + " Details: ".length) : "";
  const setupRelated = /setup|dependenc|install|environment|database|port|start|health/i.test(message);
  return (
    <div role="alert" className={`w-full rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <AlertCircle size={16} className="shrink-0 text-[var(--color-danger)]" aria-hidden="true" />
        <p className={`min-w-0 flex-1 text-[var(--color-text-secondary)] ${messageOnly ? "" : "truncate"}`} title={detail || title}>
          <strong className="text-[var(--color-text)]">{title}</strong>
          {detail && ` · ${detail}`}
        </p>
        {primaryAction}
        {onOpenLogs && <Button size="sm" variant="outline" onClick={onOpenLogs}><ListOrdered aria-hidden="true" />View job logs</Button>}
        {onOpenSetup && setupRelated && <Button size="sm" variant="outline" onClick={onOpenSetup}><Settings2 aria-hidden="true" />Review setup</Button>}
        {onDismiss && (
          <Button size="icon-sm" variant="ghost" aria-label="Dismiss error" onClick={onDismiss}>
            <X />
          </Button>
        )}
      </div>
      {technical && (
        <details className="mt-1 text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer select-none hover:text-[var(--color-text-secondary)]">Technical details</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-2 font-mono text-[11px]">{technical}</pre>
        </details>
      )}
    </div>
  );
}
