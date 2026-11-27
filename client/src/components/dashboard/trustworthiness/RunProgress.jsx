import { useEffect, useState } from 'react';
import { Check, Loader2, Square } from 'lucide-react';
import { Button } from '../../ui/button';
import ConfirmDialog from '../../common/ConfirmDialog';
import { cn } from '../../../lib/utils';

const steps = [
  ['Starting your chatbot', ['BOOTING_CHATBOT']],
  ['Checking it knows your documents', ['PROBING_KNOWLEDGE']],
  ['Asking the test questions', ['RUNNING_SCENARIO', 'SCENARIO_COMPLETED']],
  ['Grading the answers', ['JUDGING_SCENARIO']],
  ['Shutting down', ['SHUTTING_DOWN']],
];

const secondsUntil = iso => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 1000)) || 0;

function RateLimitCountdown({ until }) {
  const [seconds, setSeconds] = useState(() => secondsUntil(until));
  useEffect(() => {
    const interval = setInterval(() => {
      const left = secondsUntil(until);
      setSeconds(left);
      if (left === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [until]);
  if (!seconds) return null;
  return (
    <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
      <span aria-hidden="true" className="relative flex size-2.5 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-70" />
        <span className="relative inline-flex size-2.5 rounded-full bg-sky-500" />
      </span>
      <span>Waiting for your chatbot's AI request limit to reset (about {seconds} s)</span>
    </p>
  );
}

export default function RunProgress({ run, progress, api, act, busy }) {
  const [confirm, setConfirm] = useState(false);
  const waitingUntil = progress?.waitingReason === 'RATE_LIMIT' ? progress.waitingUntil : undefined;
  const completed = progress?.completed ?? 0;
  const total = progress?.total ?? 0;
  const active = steps.findIndex(([, phases]) => phases.includes(progress?.phase));
  const percent = total > 0 ? Math.min(100, Math.max(0, completed / total * 100)) : 0;
  const current = progress?.title || progress?.caseTitle || progress?.caseKey;
  return (
    <section className="overflow-hidden rounded-lg border border-sky-500/25 bg-[var(--color-surface)]">
      <div className="space-y-4 border-b border-[var(--color-border)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-70" />
              <span className="relative inline-flex size-2.5 rounded-full bg-sky-500" />
            </span>
            <h2 className="text-lg font-semibold tracking-tight">Evaluation in progress</h2>
          </div>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirm(true)}>
            <Square aria-hidden="true" />Stop
          </Button>
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">Questions answered</span>
            <span className="font-mono tabular-nums">{completed}<span className="text-[var(--color-text-muted)]">/{total || '—'}</span></span>
          </div>
          <div role="progressbar" aria-label="Questions completed" aria-valuemin={0}
            aria-valuemax={total || 100} aria-valuenow={total ? Math.min(completed, total) : 0}
            className="h-2 overflow-hidden rounded-md bg-[var(--color-surface-muted)]">
            <div className="h-full bg-sky-400 transition-colors duration-500" style={{ width: `${percent}%` }} />
          </div>
          {current && <p className="truncate text-xs text-[var(--color-text-muted)]">Now: {current}</p>}
          {waitingUntil && <RateLimitCountdown key={waitingUntil} until={waitingUntil} />}
        </div>
      </div>
      <ol aria-label="Evaluation phases" className="p-5">
        {!progress?.phase && <p className="pb-3 text-sm text-[var(--color-text-muted)]">Waiting for the evaluation to start…</p>}
        {steps.map(([label], index) => {
          const done = active > index;
          const now = active === index;
          return (
            <li key={label} aria-current={now ? 'step' : undefined} className="relative flex items-center gap-3 py-2.5">
              {index < steps.length - 1 && <span aria-hidden="true" className={cn('absolute left-[11px] top-9 h-[calc(100%-20px)] w-px', done ? 'bg-emerald-500/40' : 'bg-[var(--color-border)]')} />}
              <span className={cn('relative z-[1] flex size-6 shrink-0 items-center justify-center rounded-md border',
                done ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : now ? 'border-sky-500/40 bg-sky-500/10 text-sky-400'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-disabled)]')}>
                {done ? <Check className="size-3.5" aria-hidden="true" /> : now ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <span className="font-mono text-[10px] tabular-nums">{index + 1}</span>}
              </span>
              <span className={cn('text-sm', now ? 'font-medium text-[var(--color-text)]' : done ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]')}>{label}</span>
            </li>
          );
        })}
      </ol>
      <ConfirmDialog isOpen={confirm} onClose={() => setConfirm(false)} loading={busy}
        title="Stop this evaluation?" message="The run stops now. Answers collected so far are kept."
        confirmText="Stop run" onConfirm={() => act(async () => {
          await api(`/runs/${run.id}/cancel`, 'POST', {});
          setConfirm(false);
        })} />
    </section>
  );
}
