import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBatchResultToSuggestionsMap,
  buildUnitTestReviewFiles,
  collectUnappliedReviewSuggestions,
  evaluateUnitTestApplyResponse,
  normalizeReviewTestFile,
  summarizeApplyBatchResult,
} from './unitTestReview.js';

test('normalizeReviewTestFile normalizes slashes, dot segments, storage/repo prefixes, and casing', () => {
  const variants = [
    './tests/unit/payment.test.js',
    'tests\\unit\\payment.test.js',
    'tests/unit/sub/../payment.test.js',
    'Tests/Unit/Payment.test.js',
    'C:\\app\\storage\\projects\\proj_1\\repo\\tests\\unit\\payment.test.js',
    '/app/uploads/snapshots/snap_1/proj_1/tests/unit/payment.test.js',
  ];

  for (const variant of variants) {
    const res = normalizeReviewTestFile(variant);
    assert.equal(res.groupKey, 'tests/unit/payment.test.js');
  }

  assert.deepEqual(normalizeReviewTestFile(''), { displayPath: '', groupKey: '' });
  assert.deepEqual(normalizeReviewTestFile(null), { displayPath: '', groupKey: '' });
});

test('buildUnitTestReviewFiles flags mixed-framework proposals targeting the same normalized testFile', () => {
  const files = buildUnitTestReviewFiles([
    {
      suggestionId: 's1',
      sourceFile: 'src/math.js',
      testFile: './tests/math.test.js',
      framework: 'jest',
      originalCode: '',
      suggestedTestCode: 'test("a", () => {});',
    },
    {
      suggestionId: 's2',
      sourceFile: 'src/math.js',
      testFile: 'tests\\sub\\..\\math.test.js',
      framework: 'vitest',
      originalCode: '',
      suggestedTestCode: 'test("a", () => {});',
    },
  ]);

  assert.equal(files.length, 1);
  assert.equal(files[0].suggestions.length, 2);
  assert.match(files[0].reviewError, /different frameworks/i);
});

test('buildUnitTestReviewFiles detects same-framework conflicts across candidate, originalCode, and testRepairs', () => {
  const diffCandidate = buildUnitTestReviewFiles([
    {
      suggestionId: 's1',
      sourceFile: 'src/a.js',
      testFile: 'tests/a.test.js',
      framework: 'jest',
      originalCode: 'const x = 1;',
      suggestedTestCode: 'test("1", () => {});',
    },
    {
      suggestionId: 's2',
      sourceFile: 'src/b.js',
      testFile: 'Tests/a.test.js',
      framework: 'jest',
      originalCode: 'const x = 1;',
      suggestedTestCode: 'test("2", () => {});',
    },
  ]);
  assert.equal(diffCandidate.length, 1);
  assert.match(diffCandidate[0].reviewError, /Conflicting proposals share this test file/i);

  const diffOriginal = buildUnitTestReviewFiles([
    {
      suggestionId: 's1',
      sourceFile: 'src/a.js',
      testFile: 'tests/a.test.js',
      framework: 'jest',
      originalCode: 'const x = 1;',
      suggestedTestCode: 'test("1", () => {});',
    },
    {
      suggestionId: 's2',
      sourceFile: 'src/a.js',
      testFile: 'tests/a.test.js',
      framework: 'jest',
      baseContent: 'const x = 2;',
      suggestedTestCode: 'test("1", () => {});',
    },
  ]);
  assert.equal(diffOriginal.length, 1);
  assert.match(diffOriginal[0].reviewError, /Conflicting proposals share this test file/i);

  const diffRepairs = buildUnitTestReviewFiles([
    {
      suggestionId: 's1',
      sourceFile: 'src/a.js',
      testFile: 'tests/a.test.js',
      framework: 'jest',
      originalCode: '',
      suggestedTestCode: 'test("1", () => {});',
      testRepairs: [{ kind: 'mock' }],
    },
    {
      suggestionId: 's2',
      sourceFile: 'src/a.js',
      testFile: 'tests/a.test.js',
      framework: 'jest',
      originalCode: '',
      suggestedTestCode: 'test("1", () => {});',
      testRepairs: [{ kind: 'import' }],
    },
  ]);
  assert.equal(diffRepairs.length, 1);
  assert.match(diffRepairs[0].reviewError, /Conflicting proposals share this test file/i);
});

test('buildUnitTestReviewFiles deduplicates exact 4-tuple duplicates and preserves reviewError: null', () => {
  const files = buildUnitTestReviewFiles([
    {
      suggestionId: 's1',
      sourceFile: 'src/a.js',
      testFile: './tests/a.test.js',
      framework: 'jest',
      originalCode: 'const orig = true;',
      suggestedTestCode: 'test("ok", () => {});',
      testRepairs: null,
    },
    {
      suggestionId: 's2',
      sourceFile: 'src/a.js',
      testFile: 'tests\\a.test.js',
      framework: 'jest',
      baseContent: 'const orig = true;',
      generatedCode: 'test("ok", () => {});',
    },
  ]);

  assert.equal(files.length, 1);
  assert.equal(files[0].suggestions.length, 2);
  assert.equal(files[0].reviewError, null);
  assert.equal(files[0].hasChanges, true);
});

test('buildUnitTestReviewFiles keeps missing-candidate error with non-empty originalContent and flags partial missing conflict', () => {
  const allMissing = buildUnitTestReviewFiles([
    {
      suggestionId: 's1',
      sourceFile: 'src/a.js',
      testFile: 'tests/a.test.js',
      framework: 'jest',
      originalCode: 'existing content',
      suggestedTestCode: '',
    },
    {
      suggestionId: 's2',
      sourceFile: 'src/a.js',
      testFile: 'tests/a.test.js',
      framework: 'jest',
      originalCode: 'existing content',
      suggestedTestCode: null,
    },
  ]);
  assert.equal(allMissing.length, 1);
  assert.match(allMissing[0].reviewError, /candidate is missing/i);

  const mixedMissing = buildUnitTestReviewFiles([
    {
      suggestionId: 's1',
      sourceFile: 'src/a.js',
      testFile: 'tests/a.test.js',
      framework: 'jest',
      originalCode: 'existing content',
      suggestedTestCode: '',
    },
    {
      suggestionId: 's2',
      sourceFile: 'src/a.js',
      testFile: 'tests/a.test.js',
      framework: 'jest',
      originalCode: 'existing content',
      suggestedTestCode: 'test("valid", () => {});',
    },
  ]);
  assert.equal(mixedMissing.length, 1);
  assert.match(mixedMissing[0].reviewError, /Conflicting proposals share this test file/i);
});

test('buildUnitTestReviewFiles aggregates applied across all suggestions and surfaces isolatedDefects', () => {
  const files = buildUnitTestReviewFiles([
    {
      suggestionId: 's1',
      sourceFile: 'src/payment.js',
      testFile: 'tests/payment.test.js',
      framework: 'jest',
      status: 'PASSED',
      applied: true,
      originalCode: '',
      suggestedTestCode: 'test("verifyPayment", () => {});',
      isolatedDefects: [
        {
          symbol: 'placeOrder',
          file: 'controllers/paymentController.js',
          line: 42,
          diagnostic: 'Exported symbol placeOrder is not declared',
        },
      ],
    },
    {
      suggestionId: 's2',
      sourceFile: 'src/payment.js',
      testFile: 'tests/payment.test.js',
      framework: 'jest',
      status: 'GENERATED',
      applied: false,
      originalCode: '',
      suggestedTestCode: 'test("verifyPayment", () => {});',
    },
  ]);

  assert.equal(files.length, 1);
  assert.equal(files[0].applied, false);
  assert.equal(files[0].isolatedDefects.length, 1);
  assert.match(files[0].reviewNotice, /placeOrder.*controllers\/paymentController\.js:42/);
});

test('collectUnappliedReviewSuggestions excludes applied, errored, unchanged, isolated, and non-pending suggestions', () => {
  const reviewFiles = [
    {
      filePath: 'src/a.js',
      testFilePath: 'tests/a.test.js',
      applied: false,
      reviewError: null,
      hasChanges: true,
      suggestions: [
        { suggestionId: 's-pending', suggestedTestCode: 'test("p", () => {});', status: 'GENERATED' },
        { suggestionId: 's-isolated', suggestedTestCode: 'test("i", () => {});', status: 'ISOLATED' },
        { suggestionId: 's-no-change', suggestedTestCode: 'test("n", () => {});', status: 'NO_CHANGES' },
        { suggestionId: 's-passed', suggestedTestCode: 'test("ok", () => {});', status: 'PASSED' },
        { suggestionId: 's-applied-flag', suggestedTestCode: 'test("af", () => {});', applied: true },
      ],
    },
    {
      filePath: 'src/b.js',
      testFilePath: 'tests/b.test.js',
      applied: true,
      reviewError: null,
      hasChanges: true,
      suggestions: [{ suggestionId: 's-file-applied', suggestedTestCode: 'test("b", () => {});' }],
    },
    {
      filePath: 'src/c.js',
      testFilePath: 'tests/c.test.js',
      applied: false,
      reviewError: 'Conflicting proposals share this test file.',
      hasChanges: true,
      suggestions: [{ suggestionId: 's-conflict', suggestedTestCode: 'test("c", () => {});' }],
    },
    {
      filePath: 'src/d.js',
      testFilePath: 'tests/d.test.js',
      applied: false,
      reviewError: null,
      hasChanges: false,
      suggestions: [{ suggestionId: 's-unchanged', suggestedTestCode: 'test("d", () => {});' }],
    },
  ];

  const unapplied = collectUnappliedReviewSuggestions(reviewFiles);
  assert.equal(unapplied.length, 1);
  assert.equal(unapplied[0].suggestionId, 's-pending');
  assert.equal(unapplied[0].sourceFile, 'src/a.js');
  assert.equal(unapplied[0].testFile, 'tests/a.test.js');
});

test('applyBatchResultToSuggestionsMap and summarizeApplyBatchResult handle full pass, partial pass+fail, isolated defects, and NO_CHANGES', () => {
  const prevMap = {
    'src/a.js': [
      { suggestionId: 's1', sourceFile: 'src/a.js', testFile: 'tests/a.test.js', status: 'APPLYING' },
    ],
    'src/b.js': [
      { suggestionId: 's2', sourceFile: 'src/b.js', testFile: 'tests/b.test.js', status: 'APPLYING' },
    ],
    'src/c.js': [
      { suggestionId: 's3', sourceFile: 'src/c.js', testFile: 'tests/c.test.js', status: 'APPLYING' },
    ],
    'src/untouched.js': [
      { suggestionId: 's4', sourceFile: 'src/untouched.js', testFile: 'tests/u.test.js', status: 'GENERATED' },
    ],
  };
  const batchIds = new Set(['s1', 's2', 's3']);

  // 1. Partial pass + fail + isolated on HTTP 200 { success: false }
  const partialResult = {
    success: false,
    status: 'PARTIAL',
    fileUpdated: true,
    errorDetail: 'One or more test suggestions failed verification.',
    missingDependency: 'supertest',
    qualityGate: {
      status: 'PARTIAL',
      isolatedDefects: [
        {
          symbol: 'placeOrder',
          file: 'src/c.js',
          line: 18,
          testFile: 'tests/c.test.js',
          diagnostic: 'Undeclared export placeOrder',
        },
      ],
    },
    appliedSuggestions: [
      { suggestionId: 's1', testFile: 'tests/a.test.js', status: 'PASSED' },
      { suggestionId: 's2', testFile: 'tests/b.test.js', status: 'FAILED', error: 'Cannot find module supertest', missingDependency: 'supertest' },
      { suggestionId: 's3', testFile: 'tests/c.test.js', status: 'ISOLATED' },
    ],
  };

  const mappedPartial = applyBatchResultToSuggestionsMap(prevMap, batchIds, partialResult);
  assert.equal(mappedPartial['src/a.js'][0].status, 'PASSED');
  assert.equal(mappedPartial['src/a.js'][0].applied, true);
  assert.equal(mappedPartial['src/a.js'][0].testRunError, null);

  assert.equal(mappedPartial['src/b.js'][0].status, 'FAILED');
  assert.equal(mappedPartial['src/b.js'][0].applied, false);
  assert.equal(mappedPartial['src/b.js'][0].testRunError, 'Cannot find module supertest');
  assert.equal(mappedPartial['src/b.js'][0].missingDependency, 'supertest');

  assert.equal(mappedPartial['src/c.js'][0].status, 'ISOLATED');
  assert.equal(mappedPartial['src/c.js'][0].applied, false);
  assert.equal(mappedPartial['src/c.js'][0].isolatedDefects.length, 1);
  assert.match(mappedPartial['src/c.js'][0].testRunError, /placeOrder.*Undeclared export placeOrder/);

  assert.equal(mappedPartial['src/untouched.js'][0].status, 'GENERATED');

  const partialSummary = summarizeApplyBatchResult(partialResult, 3);
  assert.equal(partialSummary.passedCount, 1);
  assert.equal(partialSummary.failedCount, 1);
  assert.equal(partialSummary.isolatedCount, 1);
  assert.equal(partialSummary.isPartial, true);
  assert.equal(partialSummary.hasIsolatedDefects, true);
  assert.match(partialSummary.message, /Applied 1 of 3/);
  assert.match(partialSummary.message, /placeOrder/);

  // 2. NO_CHANGES response leaves applied: false and status: NO_CHANGES
  const noChangesResult = {
    success: true,
    status: 'NO_CHANGES',
    fileUpdated: false,
    message: 'Existing tests already satisfy 100% coverage.',
    appliedSuggestions: [
      { suggestionId: 's1', testFile: 'tests/a.test.js', status: 'PASSED', changed: false },
    ],
  };
  const mappedNoChanges = applyBatchResultToSuggestionsMap(prevMap, new Set(['s1']), noChangesResult);
  assert.equal(mappedNoChanges['src/a.js'][0].status, 'NO_CHANGES');
  assert.equal(mappedNoChanges['src/a.js'][0].applied, false);

  const noChangesSummary = summarizeApplyBatchResult(noChangesResult, 1);
  assert.equal(noChangesSummary.isNoChanges, true);
  assert.equal(noChangesSummary.errorMessage, null);
  assert.equal(noChangesSummary.message, 'Existing tests already satisfy 100% coverage.');

  // 3. Full pass
  const fullPassResult = {
    success: true,
    status: 'PASSED',
    fileUpdated: true,
    coverageGoalStatus: 'MET',
    appliedSuggestions: [
      { suggestionId: 's1', testFile: 'tests/a.test.js', status: 'PASSED' },
    ],
  };
  const fullPassSummary = summarizeApplyBatchResult(fullPassResult, 1);
  assert.equal(fullPassSummary.isOverallSuccess, true);
  assert.equal(fullPassSummary.isPartial, false);
  assert.match(fullPassSummary.message, /100% coverage goal/i);
});

test('evaluateUnitTestApplyResponse handles HTTP 200 failures, ISOLATED, NO_CHANGES, PARTIAL, PASSED, and malformed payloads', () => {
  const suggestion = { suggestionId: 's1', targetTestFile: 'tests/payment.test.js', framework: 'jest' };

  const http200Fail = evaluateUnitTestApplyResponse(
    {
      success: true,
      data: {
        success: false,
        status: 'FAILED',
        fileUpdated: false,
        errorDetail: 'Quality gate blocked test suite',
      },
    },
    suggestion,
  );
  assert.equal(http200Fail.ok, false);
  assert.equal(http200Fail.outcome, 'FAILED');
  assert.equal(http200Fail.applied, false);
  assert.equal(http200Fail.error, 'Quality gate blocked test suite');

  const itemErrorFail = evaluateUnitTestApplyResponse(
    {
      success: true,
      data: {
        success: false,
        status: 'FAILED',
        message: 'Coverage gain unverified',
        appliedSuggestions: [
          { suggestionId: 's1', status: 'FAILED', error: 'Targeted coverage gain was not verified.' },
        ],
      },
    },
    suggestion,
  );
  assert.equal(itemErrorFail.ok, false);
  assert.equal(itemErrorFail.error, 'Targeted coverage gain was not verified.');

  const isolatedOnly = evaluateUnitTestApplyResponse(
    {
      success: true,
      data: {
        success: false,
        status: 'ISOLATED',
        fileUpdated: false,
        appliedSuggestions: [
          {
            suggestionId: 's1',
            status: 'ISOLATED',
            isolatedDefects: [{ symbol: 'placeOrder', file: 'controllers/paymentController.js', line: 10, diagnostic: 'Unbound export' }],
          },
        ],
      },
    },
    suggestion,
  );
  assert.equal(isolatedOnly.ok, false);
  assert.equal(isolatedOnly.outcome, 'ISOLATED');
  assert.equal(isolatedOnly.applied, false);
  assert.equal(isolatedOnly.isolatedDefects.length, 1);

  const noChanges = evaluateUnitTestApplyResponse(
    {
      success: true,
      data: {
        success: true,
        status: 'NO_CHANGES',
        fileUpdated: false,
        message: 'Already covered.',
      },
    },
    suggestion,
  );
  assert.equal(noChanges.ok, true);
  assert.equal(noChanges.outcome, 'NO_CHANGES');
  assert.equal(noChanges.applied, false);

  const partial = evaluateUnitTestApplyResponse(
    {
      success: true,
      data: {
        success: true,
        status: 'PARTIAL',
        fileUpdated: true,
        appliedSuggestions: [{ suggestionId: 's1', status: 'PASSED' }],
        qualityGate: { isolatedDefects: [{ symbol: 'placeOrder', diagnostic: 'Unbound export' }] },
      },
    },
    suggestion,
  );
  assert.equal(partial.ok, true);
  assert.equal(partial.outcome, 'PARTIAL');
  assert.equal(partial.applied, true);
  assert.equal(partial.isolatedDefects.length, 1);
  assert.match(partial.warning, /placeOrder/);

  const passed = evaluateUnitTestApplyResponse(
    {
      success: true,
      data: {
        success: true,
        status: 'PASSED',
        fileUpdated: true,
      },
    },
    suggestion,
  );
  assert.equal(passed.ok, true);
  assert.equal(passed.outcome, 'APPLIED');
  assert.equal(passed.applied, true);

  for (const malformed of [{}, null, undefined, { success: true, data: null }]) {
    const evalMalformed = evaluateUnitTestApplyResponse(malformed, suggestion);
    assert.equal(evalMalformed.ok, false);
    assert.equal(evalMalformed.applied, false);
  }
});

test('normalizeReviewTestFile preserves known root dirs under uploads/snapshots and in-project src/repo subdirs', () => {
  assert.deepEqual(
    normalizeReviewTestFile('D:\\proj\\uploads\\snapshots\\123\\tests\\order.test.js'),
    { displayPath: 'tests/order.test.js', groupKey: 'tests/order.test.js' },
  );
  assert.deepEqual(
    normalizeReviewTestFile('src/repo/tests/order.test.js'),
    { displayPath: 'src/repo/tests/order.test.js', groupKey: 'src/repo/tests/order.test.js' },
  );
  assert.deepEqual(
    normalizeReviewTestFile('/repo/tests/order.test.js'),
    { displayPath: 'tests/order.test.js', groupKey: 'tests/order.test.js' },
  );
  assert.deepEqual(
    normalizeReviewTestFile('C:\\work\\repo\\tests\\order.test.js'),
    { displayPath: 'tests/order.test.js', groupKey: 'tests/order.test.js' },
  );
  assert.deepEqual(normalizeReviewTestFile('repo/'), { displayPath: '', groupKey: '' });
});

test('buildUnitTestReviewFiles rejects container-only/non-string targets, locks FRAMEWORK_CONFLICT_ERROR, and updates hasChanges/reviewNotice on conflict after no-op', () => {
  const invalidTargets = buildUnitTestReviewFiles([
    { sourceFile: 'src/a.js', testFile: 'repo/', suggestedTestCode: 'test("a", () => {});' },
    { sourceFile: 'src/b.js', testFile: 123, suggestedTestCode: 'test("b", () => {});' },
    { sourceFile: 'src/c.js', testFile: {}, suggestedTestCode: 'test("c", () => {});' },
  ]);
  assert.equal(invalidTargets.length, 0);

  const threeItemFrameworkConflict = buildUnitTestReviewFiles([
    {
      suggestionId: 's1',
      sourceFile: 'src/order.js',
      testFile: 'tests\\unit\\order.test.js',
      framework: 'jest',
      originalCode: '',
      suggestedTestCode: 'test("1", () => {});',
    },
    {
      suggestionId: 's2',
      sourceFile: 'src/order.js',
      testFile: './Tests/Unit/../unit/order.test.js',
      framework: 'vitest',
      originalCode: '',
      suggestedTestCode: 'test("1", () => {});',
    },
    {
      suggestionId: 's3',
      sourceFile: 'src/order.js',
      testFile: 'tests/unit/order.test.js',
      framework: 'jest',
      originalCode: '',
      suggestedTestCode: 'test("2", () => {});',
    },
  ]);
  assert.equal(threeItemFrameworkConflict.length, 1);
  assert.match(threeItemFrameworkConflict[0].reviewError, /different frameworks/i);

  const conflictAfterNoOp = buildUnitTestReviewFiles([
    {
      suggestionId: 's1',
      sourceFile: 'src/a.js',
      testFile: 'tests/a.test.js',
      framework: 'jest',
      originalCode: 'same',
      suggestedTestCode: 'same',
    },
    {
      suggestionId: 's2',
      sourceFile: 'src/a.js',
      testFile: 'tests/a.test.js',
      framework: 'jest',
      originalCode: 'same',
      suggestedTestCode: 'different',
    },
  ]);
  assert.equal(conflictAfterNoOp.length, 1);
  assert.equal(conflictAfterNoOp[0].hasChanges, true);
  assert.match(conflictAfterNoOp[0].reviewError, /Conflicting proposals share this test file/i);
  assert.equal(conflictAfterNoOp[0].reviewNotice, null);
});

test('collectUnappliedReviewSuggestions and applyBatchResultToSuggestionsMap scope duplicate suggestionIds by testFile and ignore undefined ids', () => {
  const reviewFiles = [
    {
      filePath: 'src/a.js',
      testFilePath: 'tests/a.test.js',
      applied: false,
      reviewError: null,
      hasChanges: true,
      suggestions: [
        { suggestionId: 'dup-1', sourceFile: 'src/a.js', testFile: 'tests/a.test.js', suggestedTestCode: 'test("a", () => {});', status: 'GENERATED' },
      ],
    },
    {
      filePath: 'src/b.js',
      testFilePath: 'tests/b.test.js',
      applied: false,
      reviewError: null,
      hasChanges: true,
      suggestions: [
        { suggestionId: 'dup-1', sourceFile: 'src/b.js', testFile: 'tests/b.test.js', suggestedTestCode: 'test("b", () => {});', status: 'GENERATED' },
      ],
    },
  ];

  const unapplied = collectUnappliedReviewSuggestions(reviewFiles);
  assert.equal(unapplied.length, 2);
  assert.deepEqual(
    unapplied.map((s) => s.testFile),
    ['tests/a.test.js', 'tests/b.test.js'],
  );

  const prevMap = {
    'src/a.js': [
      { suggestionId: 'dup-1', sourceFile: 'src/a.js', testFile: 'tests/a.test.js', status: 'APPLYING' },
    ],
    'src/b.js': [
      { suggestionId: 'dup-1', sourceFile: 'src/b.js', testFile: 'tests/b.test.js', status: 'APPLYING' },
    ],
    'src/untouched.js': [
      { sourceFile: 'src/untouched.js', testFile: 'tests/untouched.test.js', status: 'GENERATED' },
    ],
  };

  const mappedOnlyA = applyBatchResultToSuggestionsMap(
    prevMap,
    new Set(['dup-1']),
    {
      success: true,
      status: 'PASSED',
      fileUpdated: true,
      appliedSuggestions: [
        { suggestionId: 'dup-1', testFile: 'tests/a.test.js', status: 'PASSED' },
      ],
    },
  );
  assert.equal(mappedOnlyA['src/a.js'][0].status, 'PASSED');
  assert.equal(mappedOnlyA['src/a.js'][0].applied, true);
  assert.notEqual(mappedOnlyA['src/b.js'][0].status, 'PASSED');
  assert.equal(mappedOnlyA['src/b.js'][0].applied, false);
  assert.equal(mappedOnlyA['src/untouched.js'][0].status, 'GENERATED');

  const mappedUndefinedIds = applyBatchResultToSuggestionsMap(
    prevMap,
    new Set([undefined]),
    { success: false, status: 'FAILED', errorDetail: 'Batch failed' },
  );
  assert.equal(mappedUndefinedIds['src/untouched.js'][0].status, 'GENERATED');
});

test('VERIFIED_DRAFT and fileUpdated: false never lock out re-apply or claim files were applied', () => {
  const prevMap = {
    'src/a.js': [
      { suggestionId: 's1', sourceFile: 'src/a.js', testFile: 'tests/a.test.js', suggestedTestCode: 'test("a", () => {});', status: 'APPLYING' },
    ],
  };
  const verifiedDraftResult = {
    success: true,
    status: 'VERIFIED_DRAFT',
    fileUpdated: false,
    appliedSuggestions: [
      { suggestionId: 's1', testFile: 'tests/a.test.js', status: 'PASSED' },
    ],
  };

  const mapped = applyBatchResultToSuggestionsMap(prevMap, new Set(['s1']), verifiedDraftResult);
  assert.equal(mapped['src/a.js'][0].status, 'VERIFIED_DRAFT');
  assert.equal(mapped['src/a.js'][0].applied, false);

  const reviewFiles = buildUnitTestReviewFiles(mapped['src/a.js']);
  assert.equal(reviewFiles.length, 1);
  assert.equal(reviewFiles[0].applied, false);
  const reApplyCandidates = collectUnappliedReviewSuggestions(reviewFiles);
  assert.equal(reApplyCandidates.length, 1);

  const summary = summarizeApplyBatchResult(verifiedDraftResult, 1);
  assert.equal(summary.isOverallSuccess, false);
  assert.equal(summary.isVerifiedDraft, true);
  assert.match(summary.message, /Verified draft only; files were not written/i);
  assert.doesNotMatch(summary.message, /Applied the entire batch/i);

  const evalDraft = evaluateUnitTestApplyResponse(
    { success: true, data: verifiedDraftResult },
    { suggestionId: 's1', targetTestFile: 'tests/a.test.js' },
  );
  assert.equal(evalDraft.ok, true);
  assert.equal(evalDraft.applied, false);
});

test('evaluateUnitTestApplyResponse and summarizeApplyBatchResult catch ISOLATED in PARTIAL, NO_CHANGES failures, and mismatched single-item fallbacks', () => {
  const isolatedInPartial = evaluateUnitTestApplyResponse(
    {
      success: true,
      data: {
        success: true,
        status: 'PARTIAL',
        fileUpdated: true,
        appliedSuggestions: [
          { suggestionId: 's2', testFile: 'tests/b.test.js', status: 'PASSED' },
          { suggestionId: 's1', testFile: 'tests/a.test.js', status: 'ISOLATED', error: 's1 was isolated' },
        ],
      },
    },
    { suggestionId: 's1', targetTestFile: 'tests/a.test.js' },
  );
  assert.equal(isolatedInPartial.ok, false);
  assert.equal(isolatedInPartial.outcome, 'ISOLATED');
  assert.equal(isolatedInPartial.applied, false);
  assert.equal(isolatedInPartial.error, 's1 was isolated');

  const noChangesFail = evaluateUnitTestApplyResponse(
    {
      success: true,
      data: {
        success: false,
        status: 'NO_CHANGES',
        errorDetail: 'Gate failed before diff check',
      },
    },
    { suggestionId: 's1', targetTestFile: 'tests/a.test.js' },
  );
  assert.equal(noChangesFail.ok, false);
  assert.equal(noChangesFail.outcome, 'FAILED');
  assert.equal(noChangesFail.error, 'Gate failed before diff check');

  const noChangesItemFailSummary = summarizeApplyBatchResult(
    {
      success: false,
      status: 'NO_CHANGES',
      appliedSuggestions: [
        { suggestionId: 's1', status: 'FAILED', error: 'Unexpected error' },
      ],
    },
    1,
  );
  assert.equal(noChangesItemFailSummary.isOverallSuccess, false);
  assert.equal(noChangesItemFailSummary.failedCount, 1);
  assert.ok(noChangesItemFailSummary.errorMessage);

  const mismatchedSingleFallback = evaluateUnitTestApplyResponse(
    {
      success: true,
      data: {
        success: true,
        status: 'PARTIAL',
        fileUpdated: true,
        appliedSuggestions: [
          { suggestionId: 'other', testFile: 'tests/completely-different.test.js', status: 'FAILED', error: 'Other failed' },
        ],
      },
    },
    { suggestionId: 's1', targetTestFile: 'tests/payment.test.js' },
  );
  assert.equal(mismatchedSingleFallback.ok, true);
  assert.equal(mismatchedSingleFallback.outcome, 'PARTIAL');
});
