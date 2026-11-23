import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import { Field } from './ui';
import { inputClass, statusText, verdicts } from './evaluationTheme';

const blindChoices = [
  { value: 'PASSED', label: 'Meets this', icon: Check, active: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' },
  { value: 'FAILED', label: "Doesn't meet this", icon: X, active: 'border-rose-500/40 bg-rose-500/10 text-rose-400' },
];
const verdictLabel = value => statusText(value).toLowerCase().replace(/^./, letter => letter.toUpperCase());

export default function ReviewForm({ criterionId, api, act, busy, onSaved, onSkip, blind = false }) {
  const [verdict, setVerdict] = useState(blind ? '' : 'PASSED');
  const [score, setScore] = useState(blind ? '100' : '');
  const [rationale, setRationale] = useState('');
  const numeric = ['PASSED', 'FAILED'].includes(verdict);
  const noteField = (
    <Field label={blind ? 'Note (optional)' : 'Why?'} hint={blind ? undefined : 'Required. Up to 10,000 characters.'}>
      <textarea className={inputClass} required={!blind} minLength={1} maxLength={10000} rows={blind ? 2 : 3}
        disabled={busy} value={rationale} onChange={event => setRationale(event.target.value)} />
    </Field>
  );
  return (
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault();
      if (!verdict || (!blind && !rationale.trim())) return;
      act(async () => {
        await api(`/criterion-results/${criterionId}/reviews`, 'POST', {
          verdict,
          score: numeric && score !== '' ? Number(score) : null,
          rationale: rationale.trim() || (verdict === 'PASSED' ? 'Meets this' : "Doesn't meet this"),
        });
        setRationale('');
        if (blind) setVerdict('');
        await onSaved?.();
      }, 'Review saved.');
    }}>
      {blind ? (
        <div role="group" aria-label="Your grade" className="grid gap-3 sm:grid-cols-2">
          {blindChoices.map(({ value, label, icon: Icon, active }) => (
            <button key={value} type="button" aria-pressed={verdict === value} disabled={busy}
              onClick={() => { setVerdict(value); setScore(value === 'PASSED' ? '100' : '0'); }}
              className={cn('flex h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-all duration-150 outline-none active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50 disabled:opacity-50',
                verdict === value ? active : 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]')}>
              <Icon className="size-4" aria-hidden="true" />{label}
            </button>
          ))}
        </div>
      ) : (
        <div role="group" aria-label="Reviewer verdict" className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-[3px]">
          {verdicts.map(value => (
            <button key={value} type="button" aria-pressed={verdict === value} disabled={busy} onClick={() => setVerdict(value)}
              className={cn('h-7 flex-1 cursor-pointer whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50',
                verdict === value ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]')}>
              {verdictLabel(value)}
            </button>
          ))}
        </div>
      )}

      {blind ? (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Add a partial score or note</summary>
          <div className="mt-3 space-y-3">
            <div role="group" aria-label="Score" className="flex gap-2">
              {[[0, 'Not at all'], [50, 'Partly'], [100, 'Fully']].map(([value, label]) => (
                <Button key={value} type="button" size="sm" variant={numeric && Number(score) === value ? 'secondary' : 'ghost'}
                  disabled={busy || !numeric} aria-pressed={numeric && Number(score) === value}
                  onClick={() => setScore(String(value))}>{label}</Button>
              ))}
            </div>
            {noteField}
          </div>
        </details>
      ) : (
        <>
          {numeric && (
            <Field label="Score (optional)">
              <input className={`${inputClass} w-32 font-mono tabular-nums`} type="number" min={0} max={100}
                disabled={busy} value={score} onChange={event => setScore(event.target.value)} />
            </Field>
          )}
          {noteField}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !verdict || (!blind && !rationale.trim())}>
          {blind ? 'Submit and next' : 'Save review'}
        </Button>
        {onSkip && <Button type="button" variant="ghost" disabled={busy} onClick={onSkip}>Skip</Button>}
      </div>
    </form>
  );
}
