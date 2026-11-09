import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmationCandidates, confirmExpectedBatch } from './systemScenarioReviewModel.js';

const scenario = (id, extra = {}) => ({ id, title: id, scenarioHash: id, reviewState: 'STALE', expectedJson: ['Text "Receipt" is visible.'], ...extra });
test('explicit bulk review includes stale mocked scenarios while excluding vague or approved outcomes', async () => {
  const rows = [scenario('stale', { fullStackCompatible: false }), scenario('draft', { reviewState: 'DRAFT' }), scenario('vague', { expectedJson: ['Visible'] }), scenario('approved', { reviewState: 'EXPECTED_CONFIRMED' })];
  assert.deepEqual(confirmationCandidates(rows).map(row => row.id), ['stale', 'draft']);
  const calls = [];
  const result = await confirmExpectedBatch(rows, async row => calls.push(row.scenarioHash));
  assert.deepEqual(calls, ['stale', 'draft']);
  assert.deepEqual(result, { confirmed: 2, skipped: 1, failures: [] });
});
test('partial failures report actual confirmed counts and do not abandon later rows', async () => {
  const result = await confirmExpectedBatch([scenario('first'), scenario('changed'), scenario('last')], async row => {
    if (row.id === 'changed') throw new Error('Test changed; sync before confirming');
  });
  assert.equal(result.confirmed, 2);
  assert.deepEqual(result.failures, [{ title: 'changed', message: 'Test changed; sync before confirming' }]);
});
