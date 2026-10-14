import { scenarioProgress } from './systemTestExecutionModel.js';

export default function SystemTestProgress({ scenario, attempt, showErrors = false, compact = false }) {
  const progress = scenarioProgress(scenario, attempt);
  return <div className="space-y-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <span className={`font-medium ${progress.failed ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'}`}>
        {progress.percent === null ? 'Progress unavailable' : `${progress.percent}% completed`}
      </span>
      {progress.total !== null && <span className="text-[var(--color-text-muted)]">{progress.completed}/{progress.total} {compact ? 'steps' : 'named steps completed'}</span>}
    </div>
    {progress.percent !== null && <div role="progressbar" aria-label="Test step completion" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-full overflow-hidden rounded bg-[var(--color-surface-secondary)]">
      <div className={`h-full ${progress.failed ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-success)]'}`} style={{ width: `${progress.percent}%` }} />
    </div>}
    {showErrors && progress.failed && <div className="space-y-2 rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3">
      <p className="font-medium text-[var(--color-danger)]">{progress.failedStep ? `Failed at: ${progress.failedStep}` : 'Test failed'}</p>
      {progress.percent === null && <p className="text-[var(--color-text-muted)]">The report does not contain a complete step plan. No percentage was estimated.</p>}
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--color-danger)]">{progress.errors.length ? progress.errors.join('\n\n') : 'No error log was recorded for this result.'}</pre>
    </div>}
  </div>;
}
