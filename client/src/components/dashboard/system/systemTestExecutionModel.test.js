import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionTimeline, executionDuration, executionScenarios, filterExecutionScenarios } from './systemTestExecutionModel.js';
const start = '2026-10-12T00:00:00.000Z';
const scenario = (id, status, attempts) => ({ id, title: id, status, executionDetails: { version: 1, attempts } });
test('parallel attempts share an axis and elapsed is not summed test duration', () => {
  const model = buildExecutionTimeline([
    scenario('A', 'passed', [{ startTime: start, durationMs: 1500 }]),
    scenario('B', 'flaky', [{ startTime: start, durationMs: 1000 }, { startTime: '2026-10-12T00:00:01.000Z', durationMs: 1000 }]),
  ], { startedAt: start, finishedAt: '2026-10-12T00:00:02.000Z' });
  assert.equal(model.elapsedMs, 2000);
  assert.deepEqual(model.rows.map(row => row.offsetMs), [0, 0, 1000]);
  assert.deepEqual(model.rows.map(row => row.widthPct), [75, 50, 50]);
});
test('unknown timestamps and historical detail never get invented positions', () => {
  const model = buildExecutionTimeline([
    scenario('untimed', 'passed', [{ durationMs: 50 }]), { id: 'old', title: 'old', executionDetails: null },
  ]);
  assert.equal(model.rows.length, 0);
  assert.equal(model.unavailable.length, 2);
  assert.equal(model.spanMs, null);
  assert.equal(model.elapsedMs, null);
});
test('zero and missing durations stay distinct', () => {
  assert.equal(executionDuration(0), '0ms');
  assert.equal(executionDuration(null), 'Unavailable');
  const model = buildExecutionTimeline([scenario('zero', 'skipped', [{ startTime: start, durationMs: 0 }])]);
  assert.equal(model.rows[0].durationMs, 0);
  assert.equal(model.rows[0].widthPct, 0);
});
test('filters retain scenario semantics including both attempts of a flaky test', () => {
  const list = executionScenarios([{ filePath: 'login.spec.js', scenarios: [scenario('Login', 'flaky', [{ status: 'failed' }, { status: 'passed' }]), scenario('Home', 'passed', [])] }]);
  const filtered = filterExecutionScenarios(list, 'login.spec', 'flaky');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].executionDetails.attempts.length, 2);
  assert.equal(filterExecutionScenarios(list, 'missing', 'all').length, 0);
});
