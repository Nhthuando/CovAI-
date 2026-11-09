import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSuggestionSourceFiles, needsUnitTestSuggestion } from './unitTestSuggestionQueue.js';

const covered = {linesPct: 100, stmtsPct: 100, funcsPct: 100, branchesPct: 100};
test('includes gaps in every metric and unknown coverage', () => {
    assert.equal(needsUnitTestSuggestion(covered), false);
    for (const key of Object.keys(covered)) {
        for (const value of [0, 99.99, null, undefined, '', NaN]) {
            assert.equal(needsUnitTestSuggestion({...covered, [key]: value}), true);
        }
    }
    assert.equal(needsUnitTestSuggestion({}), true);
});

test('loads every page instead of stopping at the 200-file view and refreshes stale metrics', async () => {
    const requested = [];
    const files = await loadSuggestionSourceFiles(async page => {
        requested.push(page);
        return {data: {pagination: {totalPages: 3}, files: Array.from({length: 200}, (_, i) => ({filePath: `src/file${(page - 1) * 200 + i}.js`, ...covered, funcsPct: 0}))}};
    }, [{filePath: 'src/file0.js', ...covered}]);
    assert.deepEqual(requested, [1, 2, 3]);
    assert.equal(files.length, 600);
    assert.equal(files.filter(needsUnitTestSuggestion).length, 600);
});

test('does not silently accept a partial file list when a later page fails', async () => {
    await assert.rejects(loadSuggestionSourceFiles(async page => {
        if (page === 2) throw new Error('network failed');
        return {data: {pagination: {totalPages: 2}, files: []}};
    }), /network failed/);
});
