import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { Button } from '../../ui/button.jsx';

const buttonMotion = 'transition-colors duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/40';

export default function GenerationProgressStrip({ task, onCancel, onReview, onRetry, onDismiss, onApply, applying = false, fillAction }) {
  const running = task.state === 'RUNNING';
  const [now, setNow] = useState(Date.now);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (running) {
    const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : now;
    const seconds = Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
    const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const percent = Math.max(0, Math.min(100, task.percent ?? 0));

    return (
      <div role="status" aria-live="polite" className="w-full rounded-lg border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/5 px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Loader2 size={16} className="shrink-0 animate-spin text-[var(--color-primary)]" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate" title={task.message}>
            <strong className="font-semibold">Generating tests</strong>
            {task.message && <span className="text-[var(--color-text-secondary)]"> · {task.message}</span>}
          </p>
          <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--color-text-secondary)]" aria-live="off">{elapsed}</span>
          <Button
            size="sm"
            variant="ghost"
            className={buttonMotion}
            disabled={canceling}
            onClick={async () => {
              setCanceling(true);
              try {
                await onCancel();
              } finally {
                setCanceling(false);
              }
            }}
          >
            Cancel
          </Button>
        </div>
        <div className="mt-2 h-0.5 bg-[var(--color-border)]" aria-hidden="true">
          <div className="h-full bg-[var(--color-primary)] transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }

  const succeeded = task.state === 'SUCCEEDED';
  const message = task.error?.code === 'AI_PROVIDER_BUSY'
    ? 'The AI service is busy. Try again in a minute.'
    : task.error?.message;
  const tone = succeeded
    ? 'bg-emerald-500/10 border-emerald-500/25'
    : 'bg-rose-500/10 border-rose-500/25';
  const Icon = succeeded ? CheckCircle2 : AlertCircle;

  return (
    <div role="status" aria-live="polite" className={`w-full rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon size={16} className={succeeded ? 'shrink-0 text-[color:color-mix(in_srgb,var(--color-text)_65%,#10b981)]' : 'shrink-0 text-[var(--color-danger)]'} aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate" title={succeeded ? undefined : message}>
          <strong className="font-semibold">{succeeded ? `${task.scenarioCount} ${task.scenarioCount === 1 ? "test" : "tests"} ready` : 'Generation failed'}</strong>
          {!succeeded && message && ` · ${message}`}
        </p>
        <Button size="sm" variant={succeeded && !onApply ? 'default' : 'outline'} className={buttonMotion} onClick={succeeded ? onReview : onRetry}>
          {succeeded ? 'Review' : 'Try again'}
        </Button>
        {succeeded && fillAction}
        {succeeded && onApply && <Button size="sm" loading={applying} onClick={onApply}>Apply</Button>}
        <Button size="icon-sm" variant="ghost" onClick={onDismiss} aria-label="Dismiss generation notice">
          <X size={16} aria-hidden="true" />
        </Button>
      </div>
      {task.state === 'FAILED' && Boolean(task.error?.scenarios?.length) && (
        <details className="mt-1 break-words text-xs text-[var(--color-text-secondary)]">
          <summary className="cursor-pointer">Why it failed</summary>
          <ul className="mt-1 list-disc pl-4">
            {task.error.scenarios.map(({ title, reason }) => <li key={title}>{title} — {reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
