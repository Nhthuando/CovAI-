import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTargetTestFile,
  cleanDisplayPath,
} from './unitTestResolution.js';
import {
  testReviewDiff,
  resolveCandidateCode,
  buildUnitTestReviewFiles,
} from './unitTestReview.js';

describe('unitTestReview service', () => {
  describe('testReviewDiff', () => {
    it('calculates added and removed line counts correctly', () => {
      const original = 'line 1\nline 2\nline 3\n';
      const candidate = 'line 1\nline 2 modified\nline 3\nline 4\n';
      const result = testReviewDiff(original, candidate);
      assert.equal(result.added, 2);
      assert.equal(result.removed, 1);
    });

    it('returns zero added and removed when contents are identical', () => {
      const content = 'const a = 1;\n';
      const result = testReviewDiff(content, content);
      assert.equal(result.added, 0);
      assert.equal(result.removed, 0);
    });

    it('handles diff against empty original content (new file creation)', () => {
      const candidate = 'test("hello", () => {});\n';
      const result = testReviewDiff('', candidate);
      assert.equal(result.added, 1);
      assert.equal(result.removed, 0);
    });
  });

  describe('resolveCandidateCode', () => {
    it('prefers fullUpdatedContent when present and non-empty', () => {
      const suggestion = {
        fullUpdatedContent: 'const full = true;',
        generatedCode: 'const gen = true;',
        suggestedTestCode: 'const sug = true;',
      };
      assert.equal(resolveCandidateCode(suggestion), 'const full = true;');
    });

    it('falls back to generatedCode when fullUpdatedContent is undefined', () => {
      const suggestion = {
        generatedCode: 'test("gen", () => {});',
        suggestedTestCode: 'test("sug", () => {});',
      };
      assert.equal(resolveCandidateCode(suggestion), 'test("gen", () => {});');
    });

    it('falls back to generatedCode when fullUpdatedContent is empty string or whitespace', () => {
      const suggestion = {
        fullUpdatedContent: '   ',
        generatedCode: 'test("gen", () => {});',
      };
      assert.equal(resolveCandidateCode(suggestion), 'test("gen", () => {});');
    });

    it('falls back to suggestedTestCode when fullUpdatedContent and generatedCode are missing', () => {
      const suggestion = {
        suggestedTestCode: 'test("sug", () => {});',
      };
      assert.equal(resolveCandidateCode(suggestion), 'test("sug", () => {});');
    });

    it('falls back to testCode or code when higher priority fields are missing', () => {
      assert.equal(resolveCandidateCode({ testCode: 'test("tc", () => {});' }), 'test("tc", () => {});');
      assert.equal(resolveCandidateCode({ code: 'test("c", () => {});' }), 'test("c", () => {});');
    });

    it('returns null when no candidate code is present or all are empty', () => {
      assert.equal(resolveCandidateCode({}), null);
      assert.equal(resolveCandidateCode({ fullUpdatedContent: null }), null);
      assert.equal(resolveCandidateCode({ fullUpdatedContent: '', generatedCode: '   ' }), null);
      assert.equal(resolveCandidateCode(null), null);
    });
  });

  describe('buildUnitTestReviewFiles', () => {
    it('handles empty or non-array inputs gracefully', () => {
      assert.deepEqual(buildUnitTestReviewFiles([]), []);
      assert.deepEqual(buildUnitTestReviewFiles(null), []);
      assert.deepEqual(buildUnitTestReviewFiles(undefined), []);
    });

    it('skips suggestions missing source or target file paths', () => {
      const suggestions = [
        { sourceFile: 'src/a.js' },
        { testFile: 'tests/b.test.js' },
      ];
      assert.deepEqual(buildUnitTestReviewFiles(suggestions), []);
    });

    it('resolves candidate from generatedCode when fullUpdatedContent is missing without reviewError', () => {
      const suggestions = [
        {
          sourceFile: 'src/calculator.js',
          testFile: 'tests/calculator.test.js',
          framework: 'vitest',
          originalContent: '// existing tests\n',
          generatedCode: '// existing tests\ntest("add", () => {});\n',
        },
      ];
      const result = buildUnitTestReviewFiles(suggestions);
      assert.equal(result.length, 1);
      const file = result[0];
      assert.equal(file.fileName, 'tests/calculator.test.js');
      assert.equal(file.framework, 'vitest');
      assert.equal(file.candidateContent, '// existing tests\ntest("add", () => {});\n');
      assert.equal(file.fullUpdatedContent, '// existing tests\ntest("add", () => {});\n');
      assert.equal(file.reviewError, null);
      assert.equal(file.hasChanges, true);
      assert.equal(file.linesAdded, 1);
      assert.equal(file.linesRemoved, 0);
    });

    it('resolves candidate from suggestedTestCode when other fields are missing without reviewError', () => {
      const suggestions = [
        {
          filePath: 'src/math.js',
          targetTestFile: 'tests/math.test.js',
          suggestedTestCode: 'test("multiply", () => {});\n',
        },
      ];
      const result = buildUnitTestReviewFiles(suggestions);
      assert.equal(result.length, 1);
      const file = result[0];
      assert.equal(file.candidateContent, 'test("multiply", () => {});\n');
      assert.equal(file.reviewError, null);
      assert.equal(file.hasChanges, true);
    });

    it('sets reviewError only when absolutely no candidate code is present', () => {
      const suggestions = [
        {
          sourceFile: 'src/empty.js',
          testFile: 'tests/empty.test.js',
          originalContent: '// original\n',
          fullUpdatedContent: null,
          generatedCode: '',
          suggestedTestCode: undefined,
        },
      ];
      const result = buildUnitTestReviewFiles(suggestions);
      assert.equal(result.length, 1);
      const file = result[0];
      assert.ok(file.reviewError);
      assert.match(file.reviewError, /complete test candidate is missing/);
      assert.equal(file.hasChanges, false);
      assert.equal(file.linesAdded, 0);
      assert.equal(file.linesRemoved, 0);
    });

    it('sets reviewNotice and hasChanges:false when candidate matches original code', () => {
      const code = 'describe("suite", () => {});\n';
      const suggestions = [
        {
          sourceFile: 'src/same.js',
          testFile: 'tests/same.test.js',
          originalCode: code,
          fullUpdatedContent: code,
        },
      ];
      const result = buildUnitTestReviewFiles(suggestions);
      assert.equal(result.length, 1);
      assert.equal(result[0].hasChanges, false);
      assert.equal(result[0].reviewError, null);
      assert.ok(result[0].reviewNotice);
      assert.match(result[0].reviewNotice, /No changes are proposed/);
    });

    it('merges multiple suggestions targeting the same test file with identical candidate code', () => {
      const candidate = 'describe("all", () => { it("a"); it("b"); });\n';
      const suggestions = [
        {
          id: 'sug-1',
          sourceFile: 'src/service.js',
          testFile: 'tests/service.test.js',
          framework: 'jest',
          originalContent: '',
          fullUpdatedContent: candidate,
        },
        {
          id: 'sug-2',
          sourceFile: 'src/service.js',
          testFile: 'tests/service.test.js',
          framework: 'jest',
          originalContent: '',
          fullUpdatedContent: candidate,
        },
      ];
      const result = buildUnitTestReviewFiles(suggestions);
      assert.equal(result.length, 1);
      assert.equal(result[0].suggestions.length, 2);
      assert.equal(result[0].reviewError, null);
    });

    it('recovers from initially empty suggestion when subsequent suggestion provides candidate code', () => {
      const suggestions = [
        {
          id: 'sug-empty',
          sourceFile: 'src/service.js',
          testFile: 'tests/service.test.js',
          framework: 'jest',
          originalContent: '',
          fullUpdatedContent: '',
        },
        {
          id: 'sug-valid',
          sourceFile: 'src/service.js',
          testFile: 'tests/service.test.js',
          framework: 'jest',
          originalContent: '',
          generatedCode: 'test("valid", () => {});\n',
        },
      ];
      const result = buildUnitTestReviewFiles(suggestions);
      assert.equal(result.length, 1);
      assert.equal(result[0].reviewError, null);
      assert.equal(result[0].candidateContent, 'test("valid", () => {});\n');
    });

    it('sets reviewError when proposals for the same test file have conflicting candidate codes', () => {
      const suggestions = [
        {
          id: 'sug-1',
          sourceFile: 'src/service.js',
          testFile: 'tests/service.test.js',
          framework: 'jest',
          originalContent: '',
          generatedCode: 'test("proposal 1", () => {});\n',
        },
        {
          id: 'sug-2',
          sourceFile: 'src/service.js',
          testFile: 'tests/service.test.js',
          framework: 'jest',
          originalContent: '',
          generatedCode: 'test("proposal 2", () => {});\n',
        },
      ];
      const result = buildUnitTestReviewFiles(suggestions);
      assert.equal(result.length, 1);
      assert.ok(result[0].reviewError);
      assert.match(result[0].reviewError, /Conflicting proposals share this test file/);
    });

    it('correctly marks applied status for PASSED, APPLIED, or boolean applied', () => {
      const s1 = { sourceFile: 's.js', testFile: 't1.test.js', status: 'PASSED', generatedCode: 'code' };
      const s2 = { sourceFile: 's.js', testFile: 't2.test.js', status: 'APPLIED', generatedCode: 'code' };
      const s3 = { sourceFile: 's.js', testFile: 't3.test.js', applied: true, generatedCode: 'code' };
      const s4 = { sourceFile: 's.js', testFile: 't4.test.js', status: 'GENERATED', generatedCode: 'code' };
      const res = buildUnitTestReviewFiles([s1, s2, s3, s4]);
      assert.equal(res[0].applied, true);
      assert.equal(res[1].applied, true);
      assert.equal(res[2].applied, true);
      assert.equal(res[3].applied, false);
    });
  });
});

describe('unitTestResolution service', () => {
  it('matches exact stem in unitTestSuites with positional and object args', () => {
    const suites = [
      { filePath: 'server/tests/unit/auth.test.js', fileName: 'auth.test.js', framework: 'jest' },
      { filePath: 'server/tests/unit/payment.test.js', fileName: 'payment.test.js', framework: 'jest' },
    ];
    const resolvedPos = resolveTargetTestFile('server/src/services/auth.service.js', suites, { framework: 'jest' });
    assert.equal(resolvedPos, 'server/tests/unit/auth.test.js');

    const resolvedObj = resolveTargetTestFile({
      sourceFile: 'server/src/services/auth.service.js',
      unitTestSuites: suites,
      preferredFramework: 'jest',
    });
    assert.equal(resolvedObj, 'server/tests/unit/auth.test.js');
  });

  it('matches co-located test in __tests__', () => {
    const suites = [
      { filePath: 'src/utils/__tests__/math.spec.ts', fileName: 'math.spec.ts', framework: 'vitest' },
    ];
    const resolved = resolveTargetTestFile('src/utils/math.ts', suites, { framework: 'vitest' });
    assert.equal(resolved, 'src/utils/__tests__/math.spec.ts');
  });

  it('prioritizes matching framework when multiple exist', () => {
    const suites = [
      { filePath: 'tests/calc.test.js', fileName: 'calc.test.js', framework: 'jest' },
      { filePath: 'tests/calc.vitest.test.js', fileName: 'calc.vitest.test.js', framework: 'vitest' },
    ];
    const resolvedVitest = resolveTargetTestFile('src/calc.js', suites, { framework: 'vitest' });
    assert.equal(resolvedVitest, 'tests/calc.vitest.test.js');

    const resolvedJest = resolveTargetTestFile('src/calc.js', suites, { framework: 'jest' });
    assert.equal(resolvedJest, 'tests/calc.test.js');
  });

  it('does not cross subproject boundaries (server vs client)', () => {
    const suites = [
      { filePath: 'client/tests/cart.test.js', fileName: 'cart.test.js', framework: 'vitest' },
    ];
    const resolved = resolveTargetTestFile('server/src/services/cart.service.js', suites, { framework: 'jest' });
    assert.equal(resolved, 'server/tests/services/cart.service.test.js');
  });

  it('falls back cleanly when no suite matches', () => {
    const suites = [
      { filePath: 'tests/unit/other.test.js', fileName: 'other.test.js' },
    ];
    const resolved = resolveTargetTestFile('src/services/billing.js', suites);
    assert.equal(resolved, 'tests/services/billing.test.js');
  });

  it('falls back to .ts for TypeScript sources', () => {
    const resolved = resolveTargetTestFile('src/helpers/date.ts', []);
    assert.equal(resolved, 'tests/helpers/date.test.ts');
  });

  it('honors explicit test file override', () => {
    const resolved = resolveTargetTestFile('src/helpers/date.ts', [], { explicitTestFile: 'custom/path/my-test.spec.ts' });
    assert.equal(resolved, 'custom/path/my-test.spec.ts');
  });

  it('cleanDisplayPath strips storage and repo prefixes and protects subprojects', () => {
    assert.equal(
      cleanDisplayPath('storage/projects/123/repo/server/src/auth.js'),
      'server/src/auth.js'
    );
    assert.equal(
      cleanDisplayPath('server/tests/unit/auth.test.js'),
      'server/tests/unit/auth.test.js'
    );
    assert.equal(
      cleanDisplayPath('Online-Food-Ordering-System/server/src/auth.js'),
      'server/src/auth.js'
    );
    assert.equal(
      cleanDisplayPath('uploads/snapshots/s1/p1/src/index.ts'),
      'src/index.ts'
    );
  });
});
