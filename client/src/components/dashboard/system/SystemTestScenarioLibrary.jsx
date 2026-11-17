import { useState } from 'react';
import { scenarioIdentity } from './systemReportModel.js';
import SystemAssessmentEvidence from './SystemAssessmentEvidence.jsx';

const values = (title, items) => <section><h5 className="mb-2 text-xs font-semibold text-[var(--color-text-secondary)]">{title}</h5>{items?.length ? <ul className="space-y-1 text-sm">{items.map((item, index) => <li key={index} className="break-words">{item}</li>)}</ul> : <p className="text-xs text-[var(--color-text-muted)]">Not captured</p>}</section>;

export default function SystemTestScenarioLibrary({ scenarios = [], verdicts = [], runs = [], presentation, onOpenFile, onRunScenario }) {
  const [selected, setSelected] = useState(null);
  const rows = presentation?.scenarios || scenarios.map(row => {
    const verdict = verdicts.find(item => scenarioIdentity(item) === scenarioIdentity(row));
    const attempts = runs.map(run => ({ runIndex: run.index, ...run.testRun?.scenarios?.find(item => scenarioIdentity(item) === scenarioIdentity(row)) }));
    return { ...row, executionStatus: verdict?.executionStatus || 'NOT_RUN', qualityStatus: verdict?.qualityStatus || row.reviewState, flow: row.flowJson, inputs: row.inputJson, expected: row.expectedJson, attempts };
  });
  const active = rows.find(row => scenarioIdentity(row) === selected) || rows[0];
  if (!active) return <p className="py-6 text-sm text-[var(--color-text-muted)]">No saved scenarios in this assessment.</p>;
  return <div className="grid overflow-hidden rounded-xl border border-[var(--color-border)] lg:grid-cols-[minmax(220px,1fr)_2fr]">
    <div className="max-h-[580px] overflow-y-auto border-b border-[var(--color-border)] lg:border-r lg:border-b-0">{rows.map(row => <button key={scenarioIdentity(row)} type="button" onClick={() => setSelected(scenarioIdentity(row))} aria-pressed={row === active} className={`block w-full border-b border-[var(--color-border)] p-4 text-left hover:bg-[var(--color-surface-secondary)] ${row === active ? 'bg-[var(--color-surface-secondary)]' : ''}`}><span className="block text-sm font-medium">{row.title}</span><span className="mt-1 block text-xs text-[var(--color-text-muted)]">{row.executionStatus} / {row.filePath}</span></button>)}</div>
    <div className="space-y-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold">{active.title}</h4><p className="mt-1 text-xs text-[var(--color-text-muted)]">{active.reviewState || active.qualityStatus || 'Unreviewed'}</p></div><div className="flex gap-3 text-xs">{active.filePath && onOpenFile && <button type="button" className="underline" onClick={() => onOpenFile?.(active.filePath)}>Open test</button>}{onRunScenario && <button type="button" className="underline" onClick={() => onRunScenario(active)}>Run scenario</button>}</div></header>
      {values('Flow', active.flow)}{values('Input', active.inputs)}{values('Expected', active.expected)}
      <section><h5 className="mb-2 text-xs font-semibold text-[var(--color-text-secondary)]">Actual / independent runs</h5>{active.attempts?.map(attempt => <div key={attempt.runIndex} className="mb-2 rounded-lg bg-[var(--color-surface-secondary)] p-3 text-xs"><strong>Run {attempt.runIndex}: {attempt.status || 'Not run'}</strong>{(attempt.errors || attempt.failureMessages || []).map((error, index) => <pre key={index} className="mt-2 whitespace-pre-wrap break-words">{error}</pre>)}{attempt.apiCalls?.length > 0 && <details className="mt-2"><summary>Captured API calls ({attempt.apiCalls.length})</summary>{attempt.apiCalls.map((call, index) => <p key={index}>{call.method} {call.path} / {call.status}</p>)}</details>}</div>)}</section>
      <p className="text-xs text-[var(--color-text-muted)]">Scenario-specific code paths and database changes: Not captured.</p>
      {presentation && <SystemAssessmentEvidence key={active.scenarioKey} snapshotId={presentation.identity.snapshotId} scenario={active} />}
    </div>
  </div>;
}
