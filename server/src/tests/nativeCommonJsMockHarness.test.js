import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import { describeNativeCommonJsDependencies, validateAndNormalizeMocks } from '../services/mockValidation.service.js';
import { renderNativeCommonJsMockHarness } from '../services/nativeCommonJsMockHarness.service.js';
import { buildStandardUnitTestPrompt } from '../services/unitTestGenerator.service.js';

const server = fileURLToPath(new URL('../../', import.meta.url));
let rootDir;
function write(file, content) {
    const absolute = path.join(rootDir, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
}

beforeEach(() => {
    const directory = path.join(server, '.covai-temp');
    fs.mkdirSync(directory, { recursive: true });
    rootDir = fs.mkdtempSync(path.join(directory, 'native-mock-contract-'));
    write('package.json', '{"type":"commonjs"}');
});
afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

test('reports loader mismatch with exact module and source line, independent of project names', () => {
    const filePath = 'tests/discounts.vitest.test.mjs';
    const sourceFile = 'services/discounts.cjs';
    const source = "const { lookup: getOffer } = require('./inventory.cjs');\nmodule.exports = () => getOffer('winter');";
    write(sourceFile, source);
    write('services/inventory.cjs', "exports.lookup = () => 'real';");
    const inventory = describeNativeCommonJsDependencies(source, sourceFile, rootDir);
    expect(inventory).toEqual([{ specifier: './inventory.cjs', line: 1, named: ['lookup'], wholeModule: false }]);
    const code = "import { vi as mockRunner } from 'vitest'; mockRunner.mock('../services/inventory.cjs', () => ({ lookup: mockRunner.fn() }));";
    const result = validateAndNormalizeMocks({ code, rootDir, sourceFile, filePath, framework: 'vitest' });
    expect(result.diagnostics).toEqual([expect.objectContaining({ rule: 'VITEST_NATIVE_REQUIRE_MOCK', sourceLine: 1 })]);

    write('services/inventory.mjs', 'export const lookup = () => null;');
    expect(validateAndNormalizeMocks({ code: code.replace('inventory.cjs', 'inventory.mjs'),
        rootDir, sourceFile, filePath, framework: 'vitest' }).diagnostics).toEqual([]);

    const jestCode = "jest.mock('../services/inventory.cjs', () => ({ lookup: jest.fn() }));";
    expect(validateAndNormalizeMocks({ code: jestCode, rootDir, sourceFile, filePath, framework: 'jest' }).diagnostics).toEqual([]);
});

test('sends the generic generator paths and bindings derived from CommonJS source', () => {
    const prompt = buildStandardUnitTestPrompt({
        framework: 'vitest', cleanSource: 'services/discounts.cjs',
        cleanImportPath: '../services/discounts.cjs',
        testFileInfo: { relativePath: 'tests/discounts.vitest.test.mjs' },
        coverageDetails: {}, unitTestContext: {},
        sourceCode: "const { lookup: getOffer } = require('./inventory.cjs');\nmodule.exports = () => getOffer('winter');",
    });
    expect(prompt).toContain('"named":["lookup"]');
    expect(prompt).toContain('[require.resolve("../services/inventory.cjs"), dependencyDouble]');
    expect(prompt).toContain('subject = require("../services/discounts.cjs")');
});

test('runs a generic Vitest CommonJS harness with both destructured and whole-module requires', () => {
    const sourceFile = 'billing/quote.cjs';
    write(sourceFile, `const { lookup } = require('./prices.cjs');
const surcharge = require('./surcharge.cjs');
module.exports = sku => lookup(sku) + surcharge(sku);`);
    write('billing/prices.cjs', 'exports.lookup = () => 100;');
    write('billing/surcharge.cjs', 'module.exports = () => 200;');
    const loading = renderNativeCommonJsMockHarness('"../billing/quote.cjs"', [
        { module: '"../billing/prices.cjs"', binding: 'prices' },
        { module: '"../billing/surcharge.cjs"', binding: 'surcharge' },
    ]);
    const filePath = 'tests/quote.vitest.test.mjs';
    write(filePath, `import { createRequire } from 'node:module';
import { expect, test, vi } from 'vitest';
const require = createRequire(import.meta.url);
const prices = { lookup: vi.fn(() => 15) };
const surcharge = vi.fn(() => 2);
${loading}
test('quotes using the exact mock references', () => {
    expect(subject('sku-7')).toBe(17);
    expect(prices.lookup).toHaveBeenCalledWith('sku-7');
    expect(surcharge).toHaveBeenCalledWith('sku-7');
    expect(require('../billing/quote.cjs')('sku-7')).toBe(300);
});`);
    const run = spawnSync(process.execPath, [path.join(server, 'node_modules/vitest/vitest.mjs'), 'run', filePath, '--maxWorkers=1'],
        { cwd: rootDir, encoding: 'utf8', timeout: 30000 });
    if (run.status !== 0) throw new Error(run.error?.message || run.stderr + run.stdout);
    expect(run.stdout).toContain('1 passed');
}, 35000);
