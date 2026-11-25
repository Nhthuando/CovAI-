import { useState } from 'react';
import { ArrowLeftRight, DatabaseZap, FileDown, FileJson, History, Play, Plus, RefreshCcw, RotateCw, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Hint } from '../../ui/tooltip';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../ui/sheet';
import { Skeleton } from '../../common/Skeleton';
import ConfirmDialog from '../../common/ConfirmDialog';
import { cn } from '../../../lib/utils';
import { isEvaluationActive, useTrustworthinessQuery } from '../../../hooks/useTrustworthinessQuery';
import { downloadEvaluation } from '../../../services/trustworthiness.service';
import { EmptyState, Field, SecretInput } from './ui';
import { inputClass, numberText } from './evaluationTheme';
import RunProgress from './RunProgress';
import RunReport from './RunReport';
import { representativeScore, runDate, runStatus } from './reportHelpers';

const effectiveStatus = (record, live) => (record && !isEvaluationActive(record.executionStatus) ? record.executionStatus : live?.executionStatus || record?.executionStatus);

const dotTone = {
  emerald: 'bg-emerald-400',
  rose: 'bg-rose-400',
  amber: 'bg-amber-400',
  sky: 'bg-sky-400',
};

export default function LiveRunScreen({
  projectId, data, api, act, busy, runId: requestedRunId, navigateView, progressByRun,
}) {
  const [startOpen, setStartOpen] = useState(false);
  const runId = requestedRunId || data.runs[0]?.id || null;
  const report = useTrustworthinessQuery(projectId, `/runs/${runId}`, { enabled: !!runId, poll: true });
  const run = report.data;
  const live = progressByRun[runId];
  const active = run && isEvaluationActive(effectiveStatus(run, live));
  const completedRuns = data.runs.filter(item => item.executionStatus === 'COMPLETED');
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] xl:sticky xl:top-4">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <History className="size-4 text-[var(--color-text-muted)]" aria-hidden="true" />Runs
          </h2>
          <Button size="sm" onClick={() => setStartOpen(true)}><Plus aria-hidden="true" />New run</Button>
        </div>
        {!data.runs.length && <p className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">No runs yet.</p>}
        <ul className="max-h-[min(560px,60vh)] divide-y divide-[var(--color-border)] overflow-y-auto">
          {data.runs.map(item => {
            const progress = progressByRun[item.id];
            const status = runStatus(item, progress && { ...progress, executionStatus: effectiveStatus(item, progress) });
            const selected = runId === item.id;
            return (
              <li key={item.id}>
                <button type="button" aria-current={selected ? 'true' : undefined}
                  onClick={() => navigateView('run', { runId: item.id })}
                  className={cn('flex w-full cursor-pointer items-center gap-3 border-l-2 px-4 py-3 text-left transition-colors duration-150 outline-none focus-visible:bg-[var(--color-surface-secondary)]',
                    selected ? 'border-l-[var(--color-primary)] bg-[var(--color-surface-secondary)]' : 'border-l-transparent hover:bg-[var(--color-surface-secondary)]/60')}>
                  <span className="relative flex size-2 shrink-0">
                    {status.running && <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-70" />}
                    <span className={cn('relative inline-flex size-2 rounded-full', dotTone[status.tone] || 'bg-[var(--color-text-disabled)]')} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[var(--color-text)]">{status.label}
                      {status.running && Number.isFinite(progress?.total) && <span className="ml-1.5 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{progress.completed ?? 0}/{progress.total}</span>}
                    </span>
                    <span className="block font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{runDate(item.createdAt)}</span>
                  </span>
                  <RunScore summary={item.summary} className="font-mono text-sm tabular-nums text-[var(--color-text-secondary)]" />
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="min-w-0 space-y-5">
        {!runId && (
          <EmptyState icon={Play} title={data.runs.length ? 'Pick a run' : 'Run your first evaluation'}
            description="CovAI asks your chatbot every test question, grades the answers and shows the results here."
            action={<Button onClick={() => setStartOpen(true)}><Play aria-hidden="true" />Start evaluation</Button>} />
        )}
        {runId && report.isPending && (
          <div role="status" aria-label="Loading run report" className="space-y-4">
            <Skeleton rounded="rounded-lg" className="h-36 w-full" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map(index => <Skeleton key={index} rounded="rounded-lg" className="h-28 w-full" />)}
            </div>
            <Skeleton rounded="rounded-lg" className="h-80 w-full" />
          </div>
        )}
        {report.error && <p role="alert" className="rounded-md border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">The run could not be loaded. Try again later.</p>}
        {run && (active ? (
          <RunProgress key={run.id} run={run} progress={live} api={api} act={act} busy={busy} />
        ) : (
          <RunReport key={run.id} run={run} api={api} act={act} busy={busy}
            actions={<RunToolbar run={run} data={data} projectId={projectId} api={api} act={act} busy={busy} navigateView={navigateView} />}
            notices={<RunNotices run={run} data={data} api={api} act={act} busy={busy} navigateView={navigateView} live={live} />} />
        ))}
        {completedRuns.length >= 2 && <RunComparison runs={completedRuns} api={api} act={act} busy={busy} />}
      </div>

      <StartRunSheet open={startOpen} onOpenChange={setStartOpen} data={data} api={api} act={act} busy={busy} navigateView={navigateView} />
    </div>
  );
}

function StartRunSheet({ open, onOpenChange, data, api, act, busy, navigateView }) {
  const [selectedTargetVersionId, setTargetVersionId] = useState(null);
  const [selectedProfileVersionId, setProfileVersionId] = useState(null);
  const [llmApiKey, setLlmApiKey] = useState('');
  const [targetAuthToken, setTargetAuthToken] = useState('');
  const targetVersions = data.targets.filter(target => !target.archivedAt)
    .flatMap(target => target.versions.map(version => ({ ...version, name: target.name })));
  const approvedVersions = data.profiles.filter(profile => !profile.archivedAt)
    .flatMap(profile => profile.versions.filter(version => version.status === 'APPROVED')
      .map(version => ({ ...version, name: profile.name })));
  const targetVersionId = selectedTargetVersionId ?? (targetVersions.length === 1 ? targetVersions[0].id : '');
  const profileVersionId = selectedProfileVersionId ?? (approvedVersions.length === 1 ? approvedVersions[0].id : '');
  const managed = targetVersions.find(version => version.id === targetVersionId)
    ?.config?.executionMode === 'MANAGED_PROJECT';
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New evaluation run</SheetTitle>
          <SheetDescription>Pick the chatbot and the approved questions to ask it.</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form id="start-run-form" className="space-y-5" onSubmit={event => {
            event.preventDefault();
            act(async () => {
              try {
                const result = await api('/runs', 'POST', {
                  targetVersionId,
                  profileVersionId,
                  idempotencyKey: crypto.randomUUID(),
                  ...(managed && llmApiKey ? { llmApiKey } : {}),
                  ...(targetAuthToken ? { targetAuthToken } : {}),
                });
                onOpenChange(false);
                navigateView('run', { runId: result.id });
              } finally {
                setLlmApiKey('');
                setTargetAuthToken('');
              }
            }, 'Evaluation queued.');
          }}>
            <Field label="Chatbot">
              <select className={inputClass} required value={targetVersionId} onChange={event => {
                setTargetVersionId(event.target.value);
                setLlmApiKey('');
                setTargetAuthToken('');
              }}>
                <option value="">Select chatbot</option>
                {targetVersions.map(version => (
                  <option key={version.id} value={version.id}>{version.name} · v{version.version}</option>
                ))}
              </select>
            </Field>
            <Field label="Test questions">
              <select className={inputClass} required value={profileVersionId}
                onChange={event => setProfileVersionId(event.target.value)}>
                <option value="">Select test questions</option>
                {approvedVersions.map(version => (
                  <option key={version.id} value={version.id}>{version.name} · v{version.version}</option>
                ))}
              </select>
            </Field>
            {!approvedVersions.length && <p className="text-sm text-amber-400">Approve a set of test questions first (step 3).</p>}
            {managed && (
              <SecretInput label="LLM provider API key" value={llmApiKey} onChange={setLlmApiKey}
                hint="Held in RAM only and cleared after the request." />
            )}
            <details className="rounded-md border border-[var(--color-border)] px-3 py-2.5">
              <summary className="cursor-pointer text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">Chatbot access token (optional)</summary>
              <div className="mt-3">
                <SecretInput label="Access token" value={targetAuthToken} onChange={setTargetAuthToken}
                  hint="Cleared after the request." />
              </div>
            </details>
            <Button type="submit" className="w-full" disabled={busy}><Play aria-hidden="true" />Start evaluation</Button>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function useRerun({ run, data, api, act, navigateView }) {
  const [llmApiKey, setLlmApiKey] = useState('');
  const [targetAuthToken, setTargetAuthToken] = useState('');
  const managed = data.targets.flatMap(target => target.versions)
    .find(version => version.id === run.targetVersionId)?.config?.executionMode === 'MANAGED_PROJECT';
  const rerun = (skipKnowledgeProbe, onDone) => act(async () => {
    try {
      const result = await api(`/runs/${run.id}/rerun`, 'POST', {
        idempotencyKey: crypto.randomUUID(),
        ...(skipKnowledgeProbe ? { skipKnowledgeProbe: true } : {}),
        ...(managed && llmApiKey ? { llmApiKey } : {}),
        ...(targetAuthToken ? { targetAuthToken } : {}),
      });
      onDone?.();
      navigateView('run', { runId: result.id });
    } finally {
      setLlmApiKey('');
      setTargetAuthToken('');
    }
  });
  const credentials = (
    <div className="space-y-4">
      {managed && <SecretInput label="LLM provider API key" value={llmApiKey} onChange={setLlmApiKey}
        hint="Re-enter it for the new run. Cleared after the request." />}
      <SecretInput label="Chatbot access token (optional)" value={targetAuthToken} onChange={setTargetAuthToken}
        hint="Cleared after the request." />
    </div>
  );
  return { rerun, credentials };
}

function RunToolbar({ run, data, projectId, api, act, busy, navigateView }) {
  const [remove, setRemove] = useState(false);
  const [rerunOpen, setRerunOpen] = useState(false);
  const { rerun, credentials } = useRerun({ run, data, api, act, navigateView });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => setRerunOpen(true)}><RotateCw aria-hidden="true" />Run again</Button>
      <Hint text="Download PDF report">
        <Button variant="ghost" size="icon" aria-label="Download PDF" disabled={busy}
          onClick={() => act(() => downloadEvaluation(projectId, run.id, 'pdf'))}><FileDown aria-hidden="true" /></Button>
      </Hint>
      <Hint text="Download raw JSON">
        <Button variant="ghost" size="icon" aria-label="Download JSON" disabled={busy}
          onClick={() => act(() => downloadEvaluation(projectId, run.id, 'json'))}><FileJson aria-hidden="true" /></Button>
      </Hint>
      <Hint text="Delete run">
        <Button variant="ghost" size="icon" aria-label="Delete run" disabled={busy} className="hover:text-rose-400"
          onClick={() => setRemove(true)}><Trash2 aria-hidden="true" /></Button>
      </Hint>
      <Sheet open={rerunOpen} onOpenChange={setRerunOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Run again</SheetTitle>
            <SheetDescription>Ask the same questions again with the same settings.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {credentials}
            <Button className="w-full" disabled={busy} onClick={() => rerun(false, () => setRerunOpen(false))}>
              <Play aria-hidden="true" />Start run
            </Button>
          </SheetBody>
        </SheetContent>
      </Sheet>
      <ConfirmDialog isOpen={remove} onClose={() => setRemove(false)} loading={busy}
        title="Delete evaluation run?" confirmText="Delete"
        message="The results, evidence and human reviews for this run will be deleted."
        onConfirm={() => act(async () => {
          await api(`/runs/${run.id}`, 'DELETE');
          setRemove(false);
          navigateView('run', { runId: null });
        })} />
    </div>
  );
}

function RunNotices({ run, data, api, act, busy, navigateView, live }) {
  const [regradeRequested, setRegradeRequested] = useState(false);
  const [proceed, setProceed] = useState(false);
  const { rerun, credentials } = useRerun({ run, data, api, act, navigateView });
  const ungraded = run.executionStatus === 'COMPLETED' ? Number(run.errorCriteriaCount) || 0 : 0;
  const regrading = live?.phase === 'REGRADING' || (regradeRequested && live?.phase !== 'REGRADE_DONE' && live?.phase !== 'REGRADE_FAILED');
  const probe = run.summary?.knowledgeProbe || run.summary?.errorDetails;
  const probeFailed = run.errorCode === 'KNOWLEDGE_NOT_READY' || probe?.status === 'KNOWLEDGE_EMPTY_OR_UNSEEDED';
  if (!probeFailed && !ungraded && !regrading) return null;
  return (
    <div className="space-y-3">
      {probeFailed && (
        <div className="space-y-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <DatabaseZap className="mt-0.5 size-5 shrink-0 text-amber-400" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold text-amber-300">Your chatbot doesn't seem to know your documents</h3>
              <p className="text-sm text-[var(--color-text-muted)]">Check that it can read them before running again.</p>
            </div>
          </div>
          {(probe?.probes || []).map((item, index) => (
            <div key={item.caseKey || index} className="space-y-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
              <p className="break-words text-[var(--color-text)]">{item.question}</p>
              <p className="whitespace-pre-wrap break-words text-[var(--color-text-muted)]">{item.answerExcerpt}</p>
            </div>
          ))}
          {proceed && credentials}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigateView('connect')}>Check chatbot</Button>
            {proceed
              ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => rerun(true)}>Confirm: run anyway</Button>
              : <Button size="sm" variant="ghost" disabled={busy} onClick={() => setProceed(true)}>Run anyway</Button>}
          </div>
        </div>
      )}
      {(ungraded > 0 || regrading) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-sky-500/25 bg-sky-500/5 px-4 py-3">
          <RefreshCcw className={cn('size-5 shrink-0 text-sky-400', regrading && 'animate-spin')} aria-hidden="true" />
          <div className="min-w-[220px] flex-1">
            {regrading ? (
              <p role="status" className="text-sm font-medium text-sky-300">
                Grading again…{Number.isFinite(live?.completed) && Number.isFinite(live?.total)
                  && <span className="ml-1.5 font-mono tabular-nums">{live.completed}/{live.total}</span>}
              </p>
            ) : (
              <>
                <p className="text-sm font-medium text-[var(--color-text)]"><span className="font-mono tabular-nums">{ungraded}</span> checks weren't graded</p>
                <p className="text-xs text-[var(--color-text-muted)]">The grading AI was busy. Grade them again from the saved answers — your chatbot isn't called again.</p>
              </>
            )}
            {live?.phase === 'REGRADE_FAILED' && <p role="alert" className="mt-1 text-xs text-rose-400">Grading again didn't finish. Try again later.</p>}
          </div>
          {!regrading && (
            <Button disabled={busy} onClick={() => act(async () => {
              await api(`/runs/${run.id}/regrade`, 'POST');
              setRegradeRequested(true);
            })}><RefreshCcw aria-hidden="true" />Grade again</Button>
          )}
        </div>
      )}
    </div>
  );
}

function RunScore({ summary, className, outOf100 = false }) {
  const { value, hidden, partial, scored, applicable } = representativeScore(summary);
  return (
    <span className={className} title={hidden ? `Only ${scored} of ${applicable} checks graded` : undefined}>
      {hidden ? '—' : outOf100 ? `${numberText(value)}/100` : numberText(value, 0)}
      {!hidden && partial && <span className="text-[var(--color-text-muted)]"> partial</span>}
    </span>
  );
}

function RunComparison({ runs, api, act, busy }) {
  const [ids, setIds] = useState([]);
  const [comparison, setComparison] = useState(null);
  return (
    <details className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
        <ArrowLeftRight className="size-4" aria-hidden="true" />Compare runs
      </summary>
      <div className="mt-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {runs.map(run => (
            <label key={run.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-surface-secondary)]/60">
              <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={ids.includes(run.id)}
                onChange={event => {
                  setComparison(null);
                  setIds(event.target.checked ? [...ids, run.id].slice(-4) : ids.filter(id => id !== run.id));
                }} />
              <span className="font-mono text-xs tabular-nums text-[var(--color-text-secondary)]">{runDate(run.createdAt)}</span>
              <Badge variant="outline" className="ml-auto font-mono tabular-nums"><RunScore summary={run.summary} /></Badge>
            </label>
          ))}
        </div>
        <Button variant="secondary" size="sm" disabled={busy || ids.length < 2}
          onClick={() => act(async () => setComparison(await api('/comparisons', 'POST', { runIds: ids })))}>
          Compare selected
        </Button>
        {comparison && (
          <div className="space-y-2 text-sm">
            <p className={comparison.warning ? 'text-amber-400' : 'text-[var(--color-text-muted)]'}>
              {comparison.warning ? 'These runs used different settings, so compare with care.' : 'These runs used the same settings.'}
            </p>
            {comparison.runs.map(run => (
              <p key={run.id} className="flex gap-3 font-mono tabular-nums">
                <span className="text-[var(--color-text-muted)]">{run.id.slice(-6)}</span>
                <RunScore summary={run.summary} outOf100 />
                <span className="text-[var(--color-text-muted)]">{runStatus(run).label}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
