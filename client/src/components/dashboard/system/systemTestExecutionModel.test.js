import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionTimeline, executionDuration, executionScenarios, filterExecutionScenarios, scenarioProgress } from './systemTestExecutionModel.js';
const start = '2026-10-12T00:00:00.000Z';
test('failed test reports 70% from seven completed steps out of ten planned steps', () => {
  const plan = Array.from({ length: 10 }, (_, index) => `Step ${index + 1}`);
  const result = scenarioProgress({ status: 'failed', executionDetails: { plannedSteps: plan, attempts: [{ status: 'failed', errors: ['Expected receipt'], steps: [
    ...plan.slice(0, 7).map(title => ({ title, category: 'test.step', status: 'completed' })),
    { title: plan[7], category: 'test.step', status: 'failed', error: 'Expected receipt' },
  ] }] } });
  assert.equal(result.percent, 70);
  assert.equal(result.completed, 7);
  assert.equal(result.total, 10);
  assert.equal(result.failedStep, 'Step 8');
  assert.deepEqual(result.errors, ['Expected receipt']);
});
test('missing or truncated plans never yield guessed failure percentages', () => {
  assert.equal(scenarioProgress({ status: 'failed', failureMessages: ['Browser missing'] }).percent, null);
  assert.deepEqual(scenarioProgress({ status: 'failed', failureMessages: ['Browser missing'] }).errors, ['Browser missing']);
  assert.equal(scenarioProgress({ status: 'failed', executionDetails: { truncated: true, plannedSteps: ['A'], attempts: [{ status: 'failed', steps: [] }] } }).percent, null);
});
test('retry progress uses the selected attempt without blending earlier failures', () => {
  const failed = { status: 'failed', steps: [{ title: 'A', status: 'failed', error: 'Timeout' }] };
  const passed = { status: 'passed', steps: [{ title: 'A', status: 'completed' }] };
  const sc = { status: 'flaky', executionDetails: { plannedSteps: ['A'], attempts: [failed, passed] } };
  assert.equal(scenarioProgress(sc).percent, 100);
  assert.equal(scenarioProgress(sc).failed, false);
  assert.equal(scenarioProgress(sc, failed).percent, 0);
});
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
