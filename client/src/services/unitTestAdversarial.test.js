import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTargetTestFile,
  cleanDisplayPath,
  checkSyntaxSanity,
} from './unitTestResolution.js';
import {
  testReviewDiff,
  resolveCandidateCode,
  buildUnitTestReviewFiles,
} from './unitTestReview.js';

describe('Adversarial Path Resolution Stress Tests', () => {
  describe('Extreme & Malformed File Paths', () => {
    it('handles path traversal attempts (../../)', () => {
      const p1 = '../../server/src/auth.service.js';
      const clean1 = cleanDisplayPath(p1);
      const res1 = resolveTargetTestFile(p1, []);
      // Path traversal must not result in leading ../../ in the resolved test path
      assert.ok(!res1.startsWith('tests/../../'), `Path traversal escaped tests dir: ${res1}`);
    });

    it('handles Windows backslashes and drive letters with project folders', () => {
      const p = 'D:\\NCKH\\CovAI-\\server\\src\\services\\user.service.js';
      const clean = cleanDisplayPath(p);
      const res = resolveTargetTestFile(p, []);
      // Should cleanly identify server/ subproject and not preserve drive or project prefix
      assert.ok(clean.includes('server/src/services/user.service.js'), `Expected clean path to contain subproject: ${clean}`);
      assert.ok(!clean.startsWith('D:'), `Drive letter was not stripped: ${clean}`);

      // Single-folder wrapper with Windows drive letter:
      const pDrive = 'C:/my-app/server/src/auth.js';
      const cleanDrive = cleanDisplayPath(pDrive);
      assert.equal(cleanDrive, 'server/src/auth.js', `Failed to strip wrapper project folder when drive letter is present: ${cleanDrive}`);
    });

    it('handles Windows UNC and mixed slash variations', () => {
      const p = 'server/src\\services/util\\helper.js';
      const clean = cleanDisplayPath(p);
      assert.equal(clean, 'server/src/services/util/helper.js');
      const res = resolveTargetTestFile(p, []);
      assert.ok(!res.includes('\\'), `Resolved path contains backslashes: ${res}`);
      assert.ok(!res.includes('//'), `Resolved path contains double slashes: ${res}`);
    });

    it('handles missing extensions and multiple dots in filenames', () => {
      const p1 = 'server/src/config.prod.service.js';
      const res1 = resolveTargetTestFile(p1, []);
      assert.equal(res1, 'server/tests/config.prod.service.test.js');

      const p2 = 'server/src/no_extension_file';
      const res2 = resolveTargetTestFile(p2, []);
      assert.ok(res2.endsWith('.test.js'), `Missing extension did not fall back to .test.js: ${res2}`);
    });

    it('handles non-string or empty inputs without crashing', () => {
      assert.equal(cleanDisplayPath(null), '');
      assert.equal(cleanDisplayPath(undefined), '');
      assert.equal(cleanDisplayPath(''), '');
      assert.equal(cleanDisplayPath('   '), '');

      assert.equal(resolveTargetTestFile(null), 'tests/sample.test.js');
      assert.equal(resolveTargetTestFile(''), 'tests/sample.test.js');
      assert.equal(resolveTargetTestFile('   '), 'tests/sample.test.js');
    });

    it('handles spaces and URL encoded characters in file paths', () => {
      const p = 'server/src/services/my payment service.js';
      const clean = cleanDisplayPath(p);
      assert.equal(clean, 'server/src/services/my payment service.js');
      const res = resolveTargetTestFile(p, []);
      assert.equal(res, 'server/tests/services/my payment service.test.js');
    });
  });

  describe('Subproject Cross-Contamination Stress Tests', () => {
    it('strictly forbids mapping server source code to client test suites', () => {
      const suites = [
        { filePath: 'client/tests/auth.test.js', fileName: 'auth.test.js', framework: 'vitest' },
        { filePath: 'client/src/components/auth.test.jsx', fileName: 'auth.test.jsx', framework: 'vitest' },
      ];
      const res = resolveTargetTestFile('server/src/services/auth.service.js', suites, { framework: 'jest' });
      assert.ok(res.startsWith('server/'), `Cross-contamination: server mapped to client: ${res}`);
      assert.ok(!res.startsWith('client/'), `Cross-contamination: server mapped to client: ${res}`);
    });

    it('strictly forbids mapping client source code to server test suites', () => {
      const suites = [
        { filePath: 'server/tests/unit/login.test.js', fileName: 'login.test.js', framework: 'jest' },
      ];
      const res = resolveTargetTestFile('client/src/components/login.jsx', suites, { framework: 'vitest' });
      assert.ok(res.startsWith('client/'), `Cross-contamination: client mapped to server: ${res}`);
      assert.ok(!res.startsWith('server/'), `Cross-contamination: client mapped to server: ${res}`);
    });

    it('prevents cross-contamination when source file path is src/server/... without leading server/', () => {
      const suites = [
        { filePath: 'client/tests/user.test.js', fileName: 'user.test.js', framework: 'vitest' },
      ];
      // When a project has src/server/..., does it cross-contaminate to client?
      const res = resolveTargetTestFile('src/server/user.js', suites);
      assert.ok(!res.startsWith('client/'), `Cross-contamination occurred: ${res}`);
    });

    it('prevents cross-contamination in packages/ or apps/ monorepo layouts', () => {
      const suites = [
        { filePath: 'packages/client/tests/auth.test.js', fileName: 'auth.test.js', framework: 'vitest' },
      ];
      const res = resolveTargetTestFile('packages/server/src/auth.service.js', suites, { framework: 'jest' });
      assert.ok(!res.includes('client/'), `Cross-contamination in packages monorepo: server mapped to client: ${res}`);
    });
  });
});

describe('Adversarial Review Pipeline Stress Tests', () => {
  describe('Collision Matrices & Multiple Proposals', () => {
    it('handles 3-way suggestion collision (identical proposals merge cleanly)', () => {
      const code = 'test("a", () => {});\n';
      const suggestions = [
        { id: '1', sourceFile: 's.js', testFile: 't.test.js', generatedCode: code },
        { id: '2', sourceFile: 's.js', testFile: 't.test.js', fullUpdatedContent: code },
        { id: '3', sourceFile: 's.js', testFile: 't.test.js', suggestedTestCode: code },
      ];
      const res = buildUnitTestReviewFiles(suggestions);
      assert.equal(res.length, 1);
      assert.equal(res[0].suggestions.length, 3);
      assert.equal(res[0].reviewError, null);
      assert.equal(res[0].candidateContent, code);
    });

    it('flags conflict when 2nd proposal differs from 1st proposal', () => {
      const suggestions = [
        { id: '1', sourceFile: 's.js', testFile: 't.test.js', generatedCode: 'test("1");' },
        { id: '2', sourceFile: 's.js', testFile: 't.test.js', generatedCode: 'test("2");' },
      ];
      const res = buildUnitTestReviewFiles(suggestions);
      assert.equal(res.length, 1);
      assert.ok(res[0].reviewError);
      assert.match(res[0].reviewError, /Conflicting proposals/);
    });

    it('recovers from empty 1st proposal when 2nd proposal is valid, but flags conflict on 3rd conflicting proposal', () => {
      const suggestions = [
        { id: '1', sourceFile: 's.js', testFile: 't.test.js', generatedCode: '' },
        { id: '2', sourceFile: 's.js', testFile: 't.test.js', generatedCode: 'test("valid");' },
        { id: '3', sourceFile: 's.js', testFile: 't.test.js', generatedCode: 'test("conflict");' },
      ];
      const res = buildUnitTestReviewFiles(suggestions);
      assert.equal(res.length, 1);
      assert.ok(res[0].reviewError);
      assert.match(res[0].reviewError, /Conflicting proposals/);
    });

    it('separates review files when proposals target different frameworks for the same file', () => {
      const suggestions = [
        { id: '1', sourceFile: 's.js', testFile: 't.test.js', framework: 'jest', generatedCode: 'jest code' },
        { id: '2', sourceFile: 's.js', testFile: 't.test.js', framework: 'vitest', generatedCode: 'vitest code' },
      ];
      const res = buildUnitTestReviewFiles(suggestions);
      assert.equal(res.length, 2);
      assert.equal(res[0].framework, 'jest');
      assert.equal(res[1].framework, 'vitest');
    });
  });

  describe('Malformed & Circular Candidate Objects', () => {
    it('handles circular references in suggestion objects without infinite recursion', () => {
      const circularSug = {
        sourceFile: 's.js',
        testFile: 't.test.js',
        generatedCode: 'test("circular");',
      };
      circularSug.self = circularSug;
      const res = buildUnitTestReviewFiles([circularSug]);
      assert.equal(res.length, 1);
      assert.equal(res[0].candidateContent, 'test("circular");');
    });

    it('handles non-string originalContent or originalCode without throwing', () => {
      const suggestion = {
        sourceFile: 's.js',
        testFile: 't.test.js',
        originalContent: 12345, // invalid non-string
        generatedCode: 'test("valid");',
      };
      // Should safely handle non-string originalContent
      let error = null;
      try {
        buildUnitTestReviewFiles([suggestion]);
      } catch (err) {
        error = err;
      }
      assert.equal(error, null, `buildUnitTestReviewFiles threw on non-string originalContent: ${error?.message}`);
    });

    it('handles all falsy, whitespace, and non-string candidate code permutations', () => {
      const testCases = [
        { fullUpdatedContent: null, generatedCode: undefined, suggestedTestCode: 0 },
        { fullUpdatedContent: '', generatedCode: '   \n\t  ', testCode: false },
        { fullUpdatedContent: [], code: {} },
      ];
      for (const tc of testCases) {
        assert.equal(resolveCandidateCode(tc), null);
      }
    });
  });
});



describe('Adversarial Syntax Sanity Checker Stress Tests', () => {
  it('correctly handles line comments containing unbalanced brackets', () => {
    const code = `
      // Step 1: Arrange ({[
      const a = 1;
      // Step 2: Act )]}
      const b = 2;
    `;
    const res = checkSyntaxSanity(code);
    assert.equal(res.valid, true, `Line comments falsely triggered syntax error: ${res.error}`);
  });

  it('correctly handles block comments containing unbalanced brackets', () => {
    const code = `
      /*
       * Arrange section ({[
       */
      const a = 1;
    `;
    const res = checkSyntaxSanity(code);
    assert.equal(res.valid, true, `Block comments falsely triggered syntax error: ${res.error}`);
  });

  it('correctly handles string literals with comment markers inside', () => {
    const code = `
      const url = "http://localhost:3000//api";
      const commentInStr = "/* not a comment */ {";
      const closed = "}";
    `;
    const res = checkSyntaxSanity(code);
    assert.equal(res.valid, true, `String literal with comment syntax falsely triggered error: ${res.error}`);
  });

  it('correctly handles escaped quotes within strings', () => {
    const code = `
      const str1 = 'It\\'s a test with {';
      const str2 = "He said \\"hello\\" with [";
      const str3 = \`Template with \\\` and (\`;
    `;
    const res = checkSyntaxSanity(code);
    assert.equal(res.valid, true, `Escaped quotes falsely triggered syntax error: ${res.error}`);
  });

  it('handles regex literals with brackets without falsely flagging bracket errors', () => {
    const code = [
      'test("validates regex matching", () => {',
      '  expect(str).toMatch(/\\(\\d+\\)/);',
      '  expect(str).toMatch(/\\{[a-z]+\\}/);',
      '  expect(str).toMatch(/\\[[0-9]+\\]/);',
      '  expect(str).toMatch(/\\(/);',
      '});',
    ].join('\n');
    const res = checkSyntaxSanity(code);
    assert.equal(res.valid, true, `Regex literal falsely triggered syntax error: ${res.error}`);
  });

  it('handles complex template literals with expressions and objects', () => {
    const code = [
      'test("complex template literals", () => {',
      '  const msg1 = `value is: ${JSON.stringify({ a: [1, 2, 3] })}`;',
      '  const msg2 = `status: ${user ? "active" : \'inactive\'}`;',
      '  const msg3 = `line 1',
      '    line 2 ${calc(1 + 2)}',
      '    line 3`;',
      '  expect(msg1).toBeDefined();',
      '});',
    ].join('\n');
    const res = checkSyntaxSanity(code);
    assert.equal(res.valid, true, `Complex template literal falsely triggered error: ${res.error}`);
  });

  it('correctly catches real syntax errors (unclosed brackets)', () => {
    const code = `
      describe("suite", () => {
        it("test", () => {
          expect(1).toBe(1);
      });
    `;
    const res = checkSyntaxSanity(code);
    assert.equal(res.valid, false, 'Expected syntax check to catch unclosed bracket');
    assert.ok(res.error.includes("Unclosed bracket '{'"));
  });

  it('correctly catches real syntax errors (mismatched brackets)', () => {
    const code = `
      const arr = [1, 2, 3);
    `;
    const res = checkSyntaxSanity(code);
    assert.equal(res.valid, false, 'Expected syntax check to catch mismatched bracket');
    assert.ok(res.error.includes("Mismatched bracket"));
  });
});
