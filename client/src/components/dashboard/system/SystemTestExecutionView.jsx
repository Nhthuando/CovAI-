import { useMemo, useState } from 'react';
import SystemTestExecutionDetail, { ExecutionStatus } from './SystemTestExecutionDetail.jsx';
import { buildExecutionTimeline, executionDuration, executionScenarios, filterExecutionScenarios } from './systemTestExecutionModel.js';

const attemptColor = status => ['failed', 'timedOut', 'interrupted'].includes(status) ? 'bg-[var(--color-danger)]'
  : status === 'passed' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]';

export default function SystemTestExecutionView({ summary, testFiles, snapshotId, onInspect, onOpenEditor }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const scenarios = useMemo(() => executionScenarios(testFiles), [testFiles]);
  const filtered = useMemo(() => filterExecutionScenarios(scenarios, query, status), [scenarios, query, status]);
  // Keep the full run's scale stable while filtering its visible rows.
  const timeline = useMemo(() => buildExecutionTimeline(scenarios, summary.latestRun), [scenarios, summary.latestRun]);
  const ids = new Set(filtered.map(scenario => scenario.id));
  const rows = timeline.rows.filter(row => ids.has(row.scenario.id));
  const unavailable = timeline.unavailable.filter(scenario => ids.has(scenario.id));
  const selected = filtered.find(scenario => scenario.id === selectedId) || null;
  const select = id => setSelectedId(id);

  return <div className="space-y-4" aria-label="System test execution visualization">
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
      <p>Completed report · Run elapsed: <strong className="text-[var(--color-text)]">{executionDuration(timeline.elapsedMs)}</strong></p>
      <p>{summary.passedTests || 0} passed · {summary.failedTests || 0} failed · {summary.flakyTests || 0} flaky · {summary.skippedTests || 0} skipped</p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex min-w-48 flex-1 items-center gap-2 text-xs">Search
        <input aria-label="Search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Scenario, suite or file" className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]" />
      </label>
      <label className="flex items-center gap-2 text-xs">Outcome
        <select aria-label="Outcome" value={status} onChange={event => setStatus(event.target.value)} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)]">
          {['all', 'passed', 'failed', 'flaky', 'skipped'].map(value => <option key={value} value={value}>{value === 'all' ? 'All outcomes' : value}</option>)}
        </select>
      </label>
      <span className="text-xs text-[var(--color-text-muted)]" role="status">{filtered.length} of {scenarios.length} scenarios</span>
    </div>
    {!filtered.length ? <p className="rounded border border-[var(--color-border)] p-6 text-sm text-[var(--color-text-muted)]">{scenarios.length ? 'No scenarios match these filters.' : 'No scenario details recorded for this run.'}</p>
      : <div className={`grid items-start gap-4 ${selected ? 'xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]' : ''}`}>
        <section className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]" aria-label="Execution timeline">
          <div className="border-b border-[var(--color-border)] p-4">
            <h4 className="text-sm font-semibold">Attempt timeline</h4>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Shared recorded time axis. Parallel attempts overlap. Select a row to inspect its scenario.</p>
          </div>
          {!!rows.length && <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="grid grid-cols-[240px_1fr] border-b border-[var(--color-border)] px-4 py-2 text-[11px] text-[var(--color-text-muted)]">
                <span>Scenario / attempt</span><div className="flex justify-between font-mono">{[0, .25, .5, .75, 1].map(fraction => <span key={fraction}>{executionDuration((timeline.spanMs || 0) * fraction)}</span>)}</div>
              </div>
              {rows.map(({ scenario, attempt, offsetMs, leftPct, widthPct, durationMs }) => <button type="button" key={`${scenario.id}:${attempt.index}`} onClick={() => select(scenario.id)} aria-pressed={selectedId === scenario.id}
                className={`grid w-full grid-cols-[240px_1fr] items-center gap-0 border-b border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] ${selectedId === scenario.id ? 'bg-[var(--color-surface-secondary)]' : ''}`}>
                <div className="pr-4 text-xs"><span className="block truncate" title={scenario.title}>{scenario.title}</span><span className="text-[var(--color-text-muted)]">Attempt {attempt.index + 1} · </span><ExecutionStatus status={attempt.status} /></div>
                <div className="relative h-10 border-l border-[var(--color-border)]">
                  <div className={`absolute top-1 h-3 rounded-sm ${attemptColor(attempt.status)}`} style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 2, transform: leftPct >= 100 ? 'translateX(-2px)' : undefined }} />
                  <span className="absolute bottom-0 left-1 text-[10px] text-[var(--color-text-muted)]">+{executionDuration(offsetMs)} · {executionDuration(durationMs)}{durationMs === null ? ' duration (start marker only)' : ''}</span>
                </div>
              </button>)}
            </div>
          </div>}
          {!!unavailable.length && <div className="space-y-2 p-4">
            <h5 className="text-xs font-semibold">Timing / execution detail unavailable</h5>
            <p className="text-xs text-[var(--color-text-muted)]">These scenarios have attempts without timestamps or historical results without execution detail. No position is estimated.</p>
            {unavailable.map(scenario => <button type="button" key={scenario.id} onClick={() => select(scenario.id)} aria-pressed={selectedId === scenario.id} className={`flex w-full items-center justify-between gap-3 rounded border border-[var(--color-border)] px-3 py-2 text-left text-xs focus-visible:outline-2 ${selectedId === scenario.id ? 'bg-[var(--color-surface-secondary)]' : ''}`}>
              <span className="min-w-0 break-words">{scenario.title}</span><span className="shrink-0"><ExecutionStatus status={scenario.status?.toLowerCase()} /> · {executionDuration(scenario.durationMs)}</span>
            </button>)}
          </div>}
        </section>
        {selected ? <SystemTestExecutionDetail key={selected.id} scenario={selected} snapshotId={snapshotId} onInspect={onInspect} onOpenEditor={onOpenEditor} />
          : <p className="text-xs text-[var(--color-text-muted)]">Select a scenario to see attempts, reported steps and screenshot evidence.</p>}
      </div>}
  </div>;
}
