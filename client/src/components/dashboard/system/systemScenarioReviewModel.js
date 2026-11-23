import { isVagueExpectedOutcome } from '../../../../../shared/systemExpectedOutcome.js';

const pending = row => !['EXPECTED_CONFIRMED', 'REVIEWED'].includes(row.reviewState);
export const confirmationCandidates = rows => rows.filter(row => pending(row) &&
  Array.isArray(row.expectedJson) && row.expectedJson.length > 0 &&
  row.expectedJson.every(value => typeof value === 'string' && value.trim() && !isVagueExpectedOutcome(value)));

// STALE requires explicit renewed approval, not exclusion. The API remains the
// authority for current scenario/test hashes and project permissions.
export const confirmExpectedBatch = async (rows, confirm, onProgress = () => {}) => {
  const targets = confirmationCandidates(rows);
  const result = { confirmed: 0, skipped: rows.filter(pending).length - targets.length, failures: [] };
  for (const [index, row] of targets.entries()) {
    onProgress({ current: index + 1, total: targets.length });
    try { await confirm(row); result.confirmed++; }
    catch (error) { result.failures.push({ title: row.title, message: error.response?.data?.message || error.message || 'Confirmation failed' }); }
  }
  return result;
};
