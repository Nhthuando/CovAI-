const time = value => {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function executionScenarios(testFiles = []) {
  return testFiles.flatMap(file => (file.scenarios || []).map(scenario => ({ ...scenario, testFile: scenario.testFile || file.filePath })));
}

export function filterExecutionScenarios(scenarios, query, status) {
  const search = query.trim().toLowerCase();
  return scenarios.filter(scenario => (status === 'all' || scenario.status?.toLowerCase() === status)
    && `${scenario.title} ${scenario.suiteName || ''} ${scenario.testFile || ''}`.toLowerCase().includes(search));
}

/** A shared axis derived only from recorded timestamps; no sequential offsets. */
export function buildExecutionTimeline(scenarios, run = {}) {
  const attempts = scenarios.flatMap(scenario => scenario.executionDetails?.version === 1
    ? (scenario.executionDetails.attempts || []).map(attempt => ({ scenario, attempt, start: time(attempt.startTime), durationMs: duration(attempt.durationMs) })) : []);
  const timed = attempts.filter(row => row.start !== null);
  const runStart = time(run.startedAt);
  const runEnd = time(run.finishedAt);
  const starts = timed.map(row => row.start);
  const ends = timed.map(row => row.start + (row.durationMs ?? 0));
  const origin = starts.length || runStart !== null ? starts.reduce((min, start) => Math.min(min, start), runStart ?? Infinity) : null;
  const end = ends.length || runEnd !== null ? ends.reduce((max, end) => Math.max(max, end), runEnd ?? -Infinity) : null;
  const spanMs = origin !== null && end !== null && end >= origin ? end - origin : null;
  const elapsedMs = runStart !== null && runEnd !== null && runEnd >= runStart ? runEnd - runStart : null;
  return {
    origin, spanMs, elapsedMs,
    rows: timed.map(row => ({ ...row, offsetMs: row.start - origin,
      leftPct: spanMs > 0 ? ((row.start - origin) / spanMs) * 100 : 0,
      widthPct: spanMs > 0 && row.durationMs !== null ? (row.durationMs / spanMs) * 100 : 0,
    })),
    unavailable: scenarios.filter(scenario => scenario.executionDetails?.version !== 1
      || !scenario.executionDetails.attempts?.length
      || scenario.executionDetails.attempts.some(attempt => time(attempt.startTime) === null)),
  };
}

export function executionDuration(ms) {
  if (duration(ms) === null) return 'Unavailable';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}
