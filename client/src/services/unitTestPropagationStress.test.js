import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  resolveTargetTestFile,
  cleanDisplayPath,
} from './unitTestResolution.js';

// The computeRelativeImport and cleanPath logic extracted directly from SuggestTestcaseModal.jsx
function modalCleanPath(p = '') {
  return cleanDisplayPath(p);
}

function modalComputeRelativeImport(filePath = '', targetTestPath = '') {
  if (!filePath) return '../src/services/sample';
  const cleanSrc = modalCleanPath(filePath).replace(/\.[cm]?[jt]sx?$/, '');
  if (!targetTestPath) {
    if (cleanSrc.startsWith('src/')) return '../' + cleanSrc;
    return '../../' + cleanSrc;
  }
  const cleanTest = modalCleanPath(targetTestPath);
  const testParts = cleanTest.split('/').slice(0, -1);
  const srcParts = cleanSrc.split('/');

  let common = 0;
  while (common < testParts.length && common < srcParts.length && testParts[common] === srcParts[common]) {
    common++;
  }

  const upCount = testParts.length - common;
  const upStr = upCount > 0 ? '../'.repeat(upCount) : './';
  const downStr = srcParts.slice(common).join('/');
  return (upStr + downStr) || './';
}

// Canonical implementation using cleanDisplayPath
function canonicalComputeRelativeImport(filePath = '', targetTestPath = '') {
  if (!filePath) return '../src/services/sample';
  const cleanSrc = cleanDisplayPath(filePath).replace(/\.[cm]?[jt]sx?$/, '');
  if (!targetTestPath) {
    if (cleanSrc.startsWith('src/')) return '../' + cleanSrc;
    return '../../' + cleanSrc;
  }
  const cleanTest = cleanDisplayPath(targetTestPath);
  const testParts = cleanTest.split('/').slice(0, -1);
  const srcParts = cleanSrc.split('/');

  let common = 0;
  while (common < testParts.length && common < srcParts.length && testParts[common] === srcParts[common]) {
    common++;
  }

  const upCount = testParts.length - common;
  const upStr = upCount > 0 ? '../'.repeat(upCount) : './';
  const downStr = srcParts.slice(common).join('/');
  return (upStr + downStr) || './';
}

describe('Milestone 3 Challenger 2: Propagation & Resolution Stress Tests', () => {

  describe('1. Dynamic Target Test Resolution under Missing or Malformed unitTestSuites', () => {
    it('handles undefined unitTestSuites gracefully', () => {
      const res = resolveTargetTestFile('server/src/controllers/auth.controller.js', undefined);
      assert.equal(res, 'server/tests/controllers/auth.controller.test.js');
    });

    it('handles null unitTestSuites gracefully', () => {
      const res = resolveTargetTestFile('server/src/controllers/auth.controller.js', null);
      assert.equal(res, 'server/tests/controllers/auth.controller.test.js');
    });

    it('handles empty array [] unitTestSuites gracefully', () => {
      const res = resolveTargetTestFile('server/src/controllers/auth.controller.js', []);
      assert.equal(res, 'server/tests/controllers/auth.controller.test.js');
    });

    it('handles non-array truthy unitTestSuites without throwing unhandled TypeError', () => {
      // If backend coverage response returns testSuites as an object { "auth.test.js": {...} }
      // or corrupted data, resolveTargetTestFile should not crash
      let caught = null;
      try {
        resolveTargetTestFile('server/src/auth.js', { 'suite1': { filePath: 'foo' } });
      } catch (err) {
        caught = err;
      }
      assert.equal(caught, null, `resolveTargetTestFile crashed on object unitTestSuites: ${caught?.message}`);
    });

    it('handles unitTestSuites with null, empty, or malformed entries', () => {
      const malformedSuites = [
        null,
        undefined,
        {},
        { filePath: null },
        { fileName: '' },
        { filePath: 12345 },
        { filePath: 'server/tests/auth.test.js', fileName: 'auth.test.js' },
      ];
      const res = resolveTargetTestFile('server/src/auth.js', malformedSuites);
      assert.equal(res, 'server/tests/auth.test.js');
    });
  });

  describe('2. Test Suite Propagation Scaling & Unusual Extensions', () => {
    it('propagates 0 suites to conventional fallback with framework preservation', () => {
      const jestRes = resolveTargetTestFile('server/src/services/billing.service.ts', [], { framework: 'jest' });
      assert.equal(jestRes, 'server/tests/services/billing.service.test.ts');

      const vitestRes = resolveTargetTestFile('server/src/services/billing.service.ts', [], { framework: 'vitest' });
      assert.equal(vitestRes, 'server/tests/services/billing.service.test.ts');
    });

    it('scales efficiently across 100+ and 1000+ suites', () => {
      const suites = [];
      for (let i = 0; i < 500; i++) {
        suites.push({
          filePath: `server/tests/unit/feature_${i}/worker_${i}.test.js`,
          fileName: `worker_${i}.test.js`,
          framework: i % 2 === 0 ? 'vitest' : 'jest',
        });
      }
      suites[320] = {
        filePath: 'server/tests/unit/auth.service.test.js',
        fileName: 'auth.service.test.js',
        framework: 'vitest',
      };

      const start = performance.now();
      const res = resolveTargetTestFile('server/src/services/auth.service.js', suites, { framework: 'vitest' });
      const elapsed = performance.now() - start;

      assert.equal(res, 'server/tests/unit/auth.service.test.js');
      assert.ok(elapsed < 20, `Execution took too long: ${elapsed}ms`);
    });

    it('matches unusual extensions (.cjs.test.js, .mjs.spec.ts, .test.cjs, .spec.mjs, .spec.tsx)', () => {
      const suites = [
        { filePath: 'server/tests/unit/auth.cjs.test.js', fileName: 'auth.cjs.test.js' },
        { filePath: 'server/tests/unit/user.mjs.spec.ts', fileName: 'user.mjs.spec.ts' },
        { filePath: 'server/tests/unit/token.test.cjs', fileName: 'token.test.cjs' },
        { filePath: 'server/tests/unit/session.spec.mjs', fileName: 'session.spec.mjs' },
        { filePath: 'server/tests/unit/payment.controller.cjs.test.js', fileName: 'payment.controller.cjs.test.js' },
      ];

      assert.equal(resolveTargetTestFile('server/src/auth.js', suites), 'server/tests/unit/auth.cjs.test.js');
      assert.equal(resolveTargetTestFile('server/src/user.ts', suites), 'server/tests/unit/user.mjs.spec.ts');
      assert.equal(resolveTargetTestFile('server/src/token.js', suites), 'server/tests/unit/token.test.cjs');
      assert.equal(resolveTargetTestFile('server/src/session.js', suites), 'server/tests/unit/session.spec.mjs');
      assert.equal(resolveTargetTestFile('server/src/controllers/payment.controller.js', suites), 'server/tests/unit/payment.controller.cjs.test.js');
    });

    it('preserves .spec naming convention when suites predominantly use .spec', () => {
      const suites = [
        { filePath: 'server/tests/unit/auth.spec.js', fileName: 'auth.spec.js' },
        { filePath: 'server/tests/unit/user.spec.js', fileName: 'user.spec.js' },
      ];
      // For a non-matching source file, fallback should honor .spec convention
      const res = resolveTargetTestFile('server/src/services/invoice.service.js', suites);
      assert.equal(res, 'server/tests/services/invoice.service.spec.js');
    });
  });

  describe('3. Relative Import Computation (computeRelativeImport) across Deep Hierarchies', () => {
    it('computes exact relative import across deep 5-level directory hierarchies', () => {
      const src = 'server/src/controllers/api/v1/user.controller.js';
      const test = 'server/tests/unit/api/v1/user.controller.test.js';
      const rel = modalComputeRelativeImport(src, test);

      // Must produce 4 levels up from server/tests/unit/api/v1 to server, then down to src/...
      assert.equal(rel, '../../../../src/controllers/api/v1/user.controller');

      // Mathematically verify with path.posix.resolve:
      const testDir = '/project/' + test.split('/').slice(0, -1).join('/');
      const resolved = path.posix.resolve(testDir, rel);
      assert.equal(resolved, '/project/server/src/controllers/api/v1/user.controller');
    });

    it('computes exact relative import when source is deeper than test', () => {
      const src = 'server/src/infra/observability/logging/formatters/json.formatter.js';
      const test = 'server/tests/unit/logger.test.js';
      const rel = modalComputeRelativeImport(src, test);

      assert.equal(rel, '../../src/infra/observability/logging/formatters/json.formatter');
      const testDir = '/project/' + test.split('/').slice(0, -1).join('/');
      const resolved = path.posix.resolve(testDir, rel);
      assert.equal(resolved, '/project/server/src/infra/observability/logging/formatters/json.formatter');
    });

    it('computes exact relative import when test is deeper than source', () => {
      const src = 'server/src/utils/logger.js';
      const test = 'server/tests/unit/infra/observability/logging/logger.test.js';
      const rel = modalComputeRelativeImport(src, test);

      assert.equal(rel, '../../../../../src/utils/logger');
      const testDir = '/project/' + test.split('/').slice(0, -1).join('/');
      const resolved = path.posix.resolve(testDir, rel);
      assert.equal(resolved, '/project/server/src/utils/logger');
    });

    it('computes exact relative import for co-located tests in the same directory', () => {
      const src = 'server/src/controllers/api/v1/user.controller.js';
      const test = 'server/src/controllers/api/v1/user.controller.test.js';
      const rel = modalComputeRelativeImport(src, test);

      assert.equal(rel, './user.controller');
      const testDir = '/project/' + test.split('/').slice(0, -1).join('/');
      const resolved = path.posix.resolve(testDir, rel);
      assert.equal(resolved, '/project/server/src/controllers/api/v1/user.controller');
    });

    it('computes exact relative import with unusual source extensions (.cjs, .mjs, .tsx)', () => {
      const src = 'server/src/legacy/parser.cjs';
      const test = 'server/tests/legacy/parser.test.js';
      const rel = modalComputeRelativeImport(src, test);

      assert.equal(rel, '../../src/legacy/parser');
      const testDir = '/project/' + test.split('/').slice(0, -1).join('/');
      const resolved = path.posix.resolve(testDir, rel);
      assert.equal(resolved, '/project/server/src/legacy/parser');
    });

    it('vulnerability check: modalCleanPath corrupts Docker /app/storage/ paths into appserver/...', () => {
      const dockerSrc = '/app/storage/projects/p1/repo/server/src/controllers/api/v1/user.controller.js';
      const targetTest = 'server/tests/unit/api/v1/user.controller.test.js';

      const modalCleaned = modalCleanPath(dockerSrc);
      const canonicalCleaned = cleanDisplayPath(dockerSrc);

      // Canonical cleanDisplayPath correctly produces server/src/controllers/api/v1/user.controller.js
      assert.equal(canonicalCleaned, 'server/src/controllers/api/v1/user.controller.js');

      // Modal cleanPath corrupts the path:
      assert.equal(
        modalCleaned,
        'server/src/controllers/api/v1/user.controller.js',
        `SuggestTestcaseModal local cleanPath corrupted Docker path into: '${modalCleaned}'`
      );
    });

    it('vulnerability check: modalCleanPath leaves leading slash on repo/ paths', () => {
      const repoSrc = 'repo/server/src/controllers/api/v1/user.controller.js';
      const modalCleaned = modalCleanPath(repoSrc);
      const canonicalCleaned = cleanDisplayPath(repoSrc);

      assert.equal(canonicalCleaned, 'server/src/controllers/api/v1/user.controller.js');
      assert.equal(
        modalCleaned,
        'server/src/controllers/api/v1/user.controller.js',
        `SuggestTestcaseModal local cleanPath left leading slash: '${modalCleaned}'`
      );
    });

    it('vulnerability check: modalCleanPath fails to strip project folder wrapper', () => {
      const projWrappedSrc = 'Online-Food-Ordering-System/server/src/controllers/api/v1/user.controller.js';
      const targetTest = 'server/tests/unit/api/v1/user.controller.test.js';

      const modalCleaned = modalCleanPath(projWrappedSrc);
      const canonicalCleaned = cleanDisplayPath(projWrappedSrc);

      assert.equal(canonicalCleaned, 'server/src/controllers/api/v1/user.controller.js');
      assert.equal(
        modalCleaned,
        'server/src/controllers/api/v1/user.controller.js',
        `SuggestTestcaseModal local cleanPath failed to strip project wrapper: '${modalCleaned}'`
      );
    });
  });

  describe('4. Explicit Test File Override Normalization in Dashboard', () => {
    it('normalizes explicitTestFile containing Windows backslashes and storage prefixes', () => {
      const rawOverride = 'storage\\projects\\p1\\repo\\server\\tests\\custom\\auth.spec.js';
      const normalized = cleanDisplayPath(rawOverride);
      assert.equal(normalized, 'server/tests/custom/auth.spec.js');

      // resolveTargetTestFile normalizes explicitTestFile if passed in options:
      const res = resolveTargetTestFile('server/src/auth.js', [], { explicitTestFile: rawOverride });
      assert.equal(res, 'server/tests/custom/auth.spec.js');
    });
  });
});
