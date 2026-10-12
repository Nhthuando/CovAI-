import SystemTestEvidencePreview from './SystemTestEvidencePreview.jsx';
import { executionDuration } from './systemTestExecutionModel.js';

export function ExecutionStatus({ status }) {
  const color = ['failed', 'timedOut', 'interrupted'].includes(status) ? 'text-[var(--color-danger)]'
    : status === 'passed' ? 'text-[var(--color-success)]' : status === 'flaky' ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-secondary)]';
  return <span className={`font-mono text-xs ${color}`}>{status || 'unknown'}</span>;
}

function StepTree({ steps }) {
  return <ol className="space-y-2 border-l border-[var(--color-border)] pl-3">
    {steps.map((step, index) => <li key={index}>
      <details open={step.status === 'failed'}>
        <summary className="cursor-pointer rounded px-1 py-1 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]">
          <span className="break-words text-xs">{step.title || 'Unnamed step'}</span>{' '}
          <ExecutionStatus status={step.status} /> <span className="text-xs text-[var(--color-text-muted)]">· {executionDuration(step.durationMs)}</span>
        </summary>
        <div className="space-y-2 py-2 pl-3 text-xs text-[var(--color-text-secondary)]">
          {step.category && <p>Category: {step.category}</p>}
          {step.startTime ? <p>Started: {new Date(step.startTime).toLocaleTimeString()}</p> : <p>Step start time not reported.</p>}
          {step.location && <p className="break-all font-mono">{step.location.file}{step.location.line ? `:${step.location.line}` : ''}</p>}
          {step.error && <pre className="whitespace-pre-wrap break-words text-[var(--color-danger)]">{step.error}</pre>}
          {!!step.steps?.length && <StepTree steps={step.steps} />}
        </div>
      </details>
    </li>)}
  </ol>;
}

export default function SystemTestExecutionDetail({ scenario, snapshotId, onInspect, onOpenEditor }) {
  const details = scenario.executionDetails?.version === 1 ? scenario.executionDetails : null;
  return <section aria-label="Selected execution details" className="min-w-0 space-y-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
    <div className="space-y-1">
      <h4 className="break-words text-sm font-semibold">{scenario.title}</h4>
      <p className="break-all text-xs text-[var(--color-text-muted)]">{scenario.testFile}</p>
      <p className="text-xs"><ExecutionStatus status={scenario.status?.toLowerCase()} /> · Total attempt duration: {executionDuration(scenario.durationMs)}</p>
      {details?.expectedStatus === 'failed' && <p className="text-xs text-[var(--color-text-secondary)]">Expected failure: the attempt may fail while the scenario meets its expectation.</p>}
    </div>
    <div className="flex flex-wrap gap-3 text-xs">
      <button type="button" onClick={() => onInspect(scenario)} className="rounded text-[var(--color-primary)] underline focus-visible:outline-2">Inspect evidence / breakpoint</button>
      {scenario.testFile && scenario.testFile !== 'unknown' && <button type="button" onClick={() => onOpenEditor({ filePath: scenario.testFile, scenarioId: scenario.id })} className="rounded text-[var(--color-primary)] underline focus-visible:outline-2">Open test editor</button>}
    </div>
    {!details?.attempts.length ? <p className="text-xs text-[var(--color-text-muted)]">Execution detail unavailable for this result. Run tests again to collect report details.</p>
      : <div className="space-y-4">
        {details.truncated && <p role="status" className="text-xs text-[var(--color-warning)]">Report detail was truncated to the storage limit.</p>}
        {details.attempts.map(attempt => <section key={attempt.index} aria-label={`Attempt ${attempt.index + 1}`} className="space-y-2 border-t border-[var(--color-border)] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <h5 className="font-semibold">Attempt {attempt.index + 1}{attempt.retry > 0 ? ` · Retry ${attempt.retry}` : ''}</h5>
            <span><ExecutionStatus status={attempt.status} /> · {executionDuration(attempt.durationMs)}</span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">{attempt.startTime ? `Started: ${new Date(attempt.startTime).toLocaleString()}` : 'Attempt start time not reported; no timeline position assigned.'}</p>
          {!!attempt.errors?.length && <details className="text-xs text-[var(--color-danger)]">
            <summary className="cursor-pointer py-1">Attempt failure details</summary>
            <pre className="whitespace-pre-wrap break-words py-2">{attempt.errors.join('\n')}</pre>
          </details>}
          {attempt.steps?.length ? <StepTree steps={attempt.steps} /> : <p className="text-xs text-[var(--color-text-muted)]">No individual steps in this runner report. Playwright JSON includes named test.step blocks; Cypress depends on its reporter.</p>}
        </section>)}
      </div>}
    <div className="border-t border-[var(--color-border)] pt-3">
      <h5 className="mb-2 text-xs font-semibold">Scenario screenshot</h5>
      <p className="mb-2 text-xs text-[var(--color-text-muted)]">Existing scenario evidence, when captured. This image is not a screenshot for every step or retry.</p>
      <SystemTestEvidencePreview key={scenario.id} snapshotId={snapshotId} scenario={scenario} onEnlarge={() => onInspect(scenario)} />
    </div>
  </section>;
}
