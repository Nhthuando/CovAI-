import { ArrowRight, BotOff, Check, Code2, FileStack, KeyRound, ListChecks, MessageSquare, Play, Plug, ScanSearch } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { ProgressCircle } from '../../ui/tremor';
import { cn } from '../../../lib/utils';
import { numberText, percentText } from './evaluationTheme';
import { getStepStatus, nextStep } from './evaluationSteps';
import { representativeScore } from './reportHelpers';

const steps = [
  { key: 'connect', title: 'Connect your chatbot', action: 'Connect chatbot', icon: Plug },
  { key: 'documents', title: 'Add business documents', action: 'Add documents', icon: FileStack },
  { key: 'questions', title: 'Review test questions', action: 'Review questions', icon: ListChecks },
  { key: 'run', title: 'Run the evaluation', action: 'Start evaluation', icon: Play },
];

function ToolCard({ icon: Icon, title, description, meta, action, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="group flex w-full cursor-pointer items-start gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-left transition-colors duration-150 outline-none hover:border-[var(--color-primary)]/40 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50">
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight"><Icon className="size-4 text-[var(--color-text-muted)]" aria-hidden="true" />{title}{meta}</span>
        <span className="block text-sm text-[var(--color-text-muted)]">{description}</span>
        <span className="inline-flex items-center gap-1 pt-1 text-xs font-medium text-[var(--color-primary)]">
          {action}<ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}

export default function HomeScreen({ data, capabilities, navigateView }) {
  const audit = data.designAudit;
  if (audit?.status === 'READY' && audit.detected === false) {
    return (
      <section className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <div className="grid size-10 place-items-center rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
          <BotOff className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">No chatbot found in this project</h2>
          <p className="max-w-prose text-sm text-[var(--color-text-muted)]">CovAI scanned the code and found no AI SDK or chat endpoint. Chatbot evaluation tests apps that answer questions with an AI model, so there is nothing to test here.</p>
        </div>
        <div className="space-y-2 text-sm">
          <h3 className="font-medium text-[var(--color-text)]">What CovAI looked for</h3>
          <ul className="space-y-2 text-[var(--color-text-secondary)]">
            <li className="flex items-start gap-2"><Code2 className="mt-0.5 size-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />AI SDKs such as OpenAI, Gemini or Anthropic</li>
            <li className="flex items-start gap-2"><MessageSquare className="mt-0.5 size-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />A chat API route that sends messages to a model</li>
            <li className="flex items-start gap-2"><KeyRound className="mt-0.5 size-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" /><span>An LLM API key read from <code>process.env</code></span></li>
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigateView('connect', { mode: 'external' })}>My chatbot runs elsewhere</Button>
          <Button variant="ghost" onClick={() => navigateView('audit')}>Scan again</Button>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">Testing a normal web app? Use System Test instead.</p>
      </section>
    );
  }

  const status = getStepStatus(data);
  const next = nextStep(status);
  const quota = capabilities?.quota;
  const estimate = quota?.bestCaseRunEstimate;
  const quotaSummary = quota && estimate?.min != null && estimate?.max != null
    && quota.remaining != null && quota.limit != null
    ? `Uses about ${estimate.min}–${estimate.max} AI requests · ${quota.remaining} of ${quota.limit} left today` : null;
  const result = [...(data.runs || [])]
    .filter(run => ['COMPLETED', 'ERROR', 'FAILED'].includes(run.executionStatus))
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))[0];
  const failed = result && ['ERROR', 'FAILED'].includes(result.executionStatus);
  const verdict = result?.summary?.verdict || result?.verdict;
  const label = failed ? 'Run failed' : verdict === 'PASSED' ? 'Passed' : verdict === 'FAILED' ? "Didn't pass" : 'No verdict yet';
  const tone = label === 'Passed' ? 'success' : label === 'No verdict yet' ? 'warning' : 'danger';
  const explanation = failed ? 'The evaluation stopped before a report could be completed.'
    : verdict === 'PASSED' ? 'Your chatbot passed the evaluation checks.'
      : verdict === 'FAILED' ? 'Your chatbot did not pass the evaluation checks.'
        : "Some checks couldn't be graded, so there's no final verdict.";
  const latency = result?.summary?.latency?.avgMs;
  const { value: score, hidden, partial, scored, applicable } = representativeScore(result?.summary);
  const doneCount = steps.filter(step => status[step.key].done).length;
  return (
    <div className="space-y-5">
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
            <h2 className="text-sm font-semibold tracking-tight">Get ready in 4 steps</h2>
            <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{doneCount}/4 done</span>
          </div>
          <ol className="px-5 py-2">
            {steps.map((step, index) => {
              const done = status[step.key].done;
              const current = step.key === next;
              const Icon = step.icon;
              return (
                <li key={step.key} className="relative flex gap-4 py-4">
                  {index < steps.length - 1 && <span aria-hidden="true" className={cn('absolute left-[15px] top-12 bottom-[-8px] w-px', done ? 'bg-emerald-500/40' : 'bg-[var(--color-border)]')} />}
                  <span className={cn('relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-md border',
                    done ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : current ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)]')}>
                    {done ? <Check className="size-4" aria-label="Done" /> : <Icon className="size-4" aria-hidden="true" />}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <h3 className={cn('text-sm font-medium', !done && !current && 'text-[var(--color-text-secondary)]')}>{step.title}</h3>
                      <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
                        {step.key === 'run' && quotaSummary && !done ? quotaSummary : status[step.key].summary}
                      </p>
                    </div>
                    <Button size="sm" variant={current ? 'default' : 'ghost'} onClick={() => navigateView(step.key)}>
                      {current ? <>{step.action}<ArrowRight aria-hidden="true" /></> : done ? (step.key === 'run' ? 'Open' : 'Edit') : step.action}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="border-b border-[var(--color-border)] px-5 py-4">
            <h2 className="text-sm font-semibold tracking-tight">Latest result</h2>
          </div>
          {!result ? (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)]">
                <Play className="size-5 text-[var(--color-text-muted)]" aria-hidden="true" />
              </span>
              <p className="text-sm font-medium">No results yet</p>
              <p className="max-w-xs text-sm text-[var(--color-text-muted)]">Run your first evaluation to see how your chatbot does.</p>
            </div>
          ) : (
            <div className="space-y-5 p-5">
              <div className="flex items-center gap-5">
                <ProgressCircle value={score ?? 0} radius={38} strokeWidth={6} color={tone}>
                  <span className="font-mono text-xl font-semibold tabular-nums" title={hidden ? `Only ${scored} of ${applicable} checks graded` : undefined}>
                    {hidden ? '—' : numberText(score, 0)}
                    {!hidden && partial && <span className="text-xs font-normal text-[var(--color-text-muted)]"> partial</span>}
                  </span>
                </ProgressCircle>
                <div className="min-w-0 space-y-1.5">
                  <Badge variant={tone}>{label}</Badge>
                  <p className="text-sm text-[var(--color-text-muted)]">{explanation}</p>
                </div>
              </div>
              <dl className="grid grid-cols-2 divide-x divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
                <div className="px-4 py-3">
                  <dt className="text-xs text-[var(--color-text-muted)]">Questions passed</dt>
                  <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{percentText(result.summary?.scenarioPassRate?.wilson95?.rate)}</dd>
                </div>
                <div className="px-4 py-3">
                  <dt className="text-xs text-[var(--color-text-muted)]">Avg reply time</dt>
                  <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{Number.isFinite(latency) ? `${(latency / 1000).toFixed(1)}s` : '—'}</dd>
                </div>
              </dl>
              <Button variant="secondary" className="w-full" onClick={() => navigateView('run', { runId: result.id })}>
                Open full report<ArrowRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <ToolCard icon={ScanSearch} title="Check the grading AI" onClick={() => navigateView('review')}
          description="Grade a few answers yourself to see if the grading AI agrees with you."
          action="Start checking" />
        <ToolCard icon={Code2} title="Code review" onClick={() => navigateView('audit')}
          description="Scan your chatbot's source code for common safety and design issues."
          meta={audit && <Badge variant="outline" className="font-mono tabular-nums">{audit.designScore ?? '—'}/100 · {audit.findings?.length ?? 0} findings</Badge>}
          action={audit ? 'Open code review' : 'Scan code'} />
      </div>
    </div>
  );
}
