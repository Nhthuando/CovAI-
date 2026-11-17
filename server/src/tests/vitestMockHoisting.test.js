import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@jest/globals';
import { parseJavaScriptCode } from '../services/babelParser.service.js';
import { hoistGeneratedVitestMocks, vitestHoistingFindings } from '../services/vitestMockHoisting.service.js';
import { validateAndNormalizeMocks } from '../services/mockValidation.service.js';

const inspect = code => vitestHoistingFindings(parseJavaScriptCode(code).ast);

test.each(['const', 'let'])('hoists a stable %s mock while preserving the factory and assertions', declaration => {
    const raw = `import { vi } from 'vitest';
${declaration} categoryModelMock = { find: vi.fn() };
vi.mock('./categories', () => ({ default: categoryModelMock, find: categoryModelMock.find }));
test('uses the mock', () => expect(categoryModelMock.find).toHaveBeenCalled());`;
    expect(inspect(raw)[0].evidence).toEqual(['categoryModelMock']);
    const healed = hoistGeneratedVitestMocks(raw, { framework: 'vitest' });
    expect(healed).toContain('const { categoryModelMock } = vi.hoisted');
    expect(inspect(healed)).toEqual([]);
    expect(healed).toContain("expect(categoryModelMock.find).toHaveBeenCalled()");
    expect(hoistGeneratedVitestMocks(raw, { framework: 'jest' })).toBe(raw);
});

test('keeps unsafe imports and mutable mock state for review', () => {
    const raw = `import { vi } from 'vitest';
import model from './actual';
let mock = { find: vi.fn() };
vi.mock('./categories', () => ({ default: mock, model }));
mock = { find: vi.fn() };`;
    expect(inspect(raw)[0].evidence).toEqual(['mock', 'model']);
    expect(hoistGeneratedVitestMocks(raw, { framework: 'vitest' })).toBe(raw);
    expect(inspect("vi.mock('./mod', () => ({ value })); const { value } = vi.hoisted(() => ({ value: 1 }));")).toHaveLength(1);
    expect(inspect("const normal = 'a'; const mock = vi.hoisted(() => normal);")).toHaveLength(1);
});

test('reports the missing default or named export without inventing a new mock function', () => {
    const result = validateAndNormalizeMocks({ framework: 'vitest', filePath: 'tests/example.vitest.test.js',
        code: "import { vi } from 'vitest'; import model, { find } from './category'; vi.mock('./category', () => ({ unrelated: vi.fn() }));" });
    expect(result.diagnostics.filter(issue => issue.rule === 'MOCK_MISSING_EXPORT').map(issue => issue.message))
        .toEqual([expect.stringContaining("'default'"), expect.stringContaining("'find'")]);
    expect(result.code).not.toContain('default: vi.fn()');
});

test('Vitest executes two factories sharing one hoisted mock and assertion reference', () => {
    const server = fileURLToPath(new URL('../../', import.meta.url));
    const parent = path.join(server, '.covai-temp');
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'vitest-hoisted-factory-'));
    try {
        for (const file of ['first.mjs', 'second.mjs']) fs.writeFileSync(path.join(root, file), 'export default {}; export const find = () => null;');
        const raw = `import { vi, test, expect } from 'vitest';
import first, { find } from './first.mjs';
import second from './second.mjs';
const model = { find: vi.fn().mockReturnValue('found') };
vi.mock('./first.mjs', () => ({ default: model, find: model.find }));
vi.mock('./second.mjs', () => ({ default: model }));
test('shares one mock through named and default exports', () => {
    expect(first).toBe(second);
    expect(find).toBe(model.find);
    expect(find()).toBe('found');
    expect(model.find).toHaveBeenCalledTimes(1);
});`;
        const file = 'shared.vitest.test.mjs';
        fs.writeFileSync(path.join(root, file), hoistGeneratedVitestMocks(raw, { framework: 'vitest' }));
        const run = spawnSync(process.execPath, [path.join(server, 'node_modules/vitest/vitest.mjs'), 'run', file, '--maxWorkers=1'],
            { cwd: root, encoding: 'utf8', timeout: 30000 });
        if (run.status !== 0) throw new Error(run.error?.message || run.stderr + run.stdout);
        expect(run.stdout).toContain('1 passed');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}, 35000);
