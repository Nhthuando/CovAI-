import { describe, it, expect } from '@jest/globals';
import babel from '@babel/core';
import transformCommonJsPlugin from '@babel/plugin-transform-modules-commonjs';
import _generate from '@babel/generator';
import { parseCode, findScenarioPath } from '../services/scenarioManager.service.js';
import { deduplicateAstDeclarations } from '../services/testHelperRegistry.service.js';

const generate = _generate.default?.default || _generate.default || _generate;

const MULTI_BLOCK_PLAYWRIGHT_CODE = `
import { test, expect } from '@playwright/test';

test.describe('App Health Endpoint', () => {
  test('GET / returns 200', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
  });
});

import { test, expect } from '@playwright/test';

test.describe('Summarize Endpoint', () => {
  test('POST /summarize returns 200', async ({ request }) => {
    const res = await request.post('/summarize', { data: { content: 'hello' } });
    expect(res.status()).toBe(200);
  });
});
`.trim();

describe('Integration duplicate declaration deduplication', () => {
  it('deduplicates repeated top-level Playwright test/expect imports cleanly', () => {
    const res = deduplicateAstDeclarations(MULTI_BLOCK_PLAYWRIGHT_CODE, {
      filePath: 'tests/api/api-integration.spec.js',
    });

    expect(res.changed).toBe(true);
    expect(res.code.match(/import\s+\{\s*test\s*,\s*expect\s*\}\s+from\s+['"]@playwright\/test['"]/g)).toHaveLength(1);
    expect(() =>
      babel.transformSync(res.code, {
        plugins: [transformCommonJsPlugin],
        sourceType: 'module',
      }),
    ).not.toThrow();
  });

  it('parseCode + findScenarioPath + generate + Babel CJS transform succeed on legacy multi-import AiTest content', () => {
    const ast = parseCode(MULTI_BLOCK_PLAYWRIGHT_CODE, 'tests/api/api-integration.spec.js');
    const scenarioPath = findScenarioPath(ast, 'POST /summarize returns 200', 0);
    expect(scenarioPath).toBeTruthy();

    const { code } = generate(ast);
    const transformed = babel.transformSync(code, {
      plugins: [transformCommonJsPlugin],
      sourceType: 'module',
    });
    expect(transformed.code).toContain('POST /summarize returns 200');
  });
});
