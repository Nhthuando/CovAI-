import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLiveRunState, contiguousCursor } from './systemLiveRunModel.js';
test('run one ending does not finish a two-run assessment', () => {
  assert.equal(deriveLiveRunState({ events: [{ type: 'RUN_ENDED', runIndex: 1 }], jobStatus: 'RUNNING' }).isTerminal, false);
  assert.equal(deriveLiveRunState({ jobStatus: 'COMPLETED' }).canStop, false);
});
test('out of order socket events do not skip replay gaps', () => {
  assert.equal(contiguousCursor(6, [9]), 6);
  assert.equal(contiguousCursor(6, [9, 8, 7, 7]), 9);
});
