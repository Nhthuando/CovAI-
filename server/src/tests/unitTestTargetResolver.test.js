import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, expect, test } from '@jest/globals';
import { assertUnitTestTarget, suggestUnitTestTarget } from '../services/unitTestFilePolicy.service.js';
import { mergeUnitTestSuggestions } from '../services/unitTestSuggestionBatch.service.js';

let root;
beforeEach(() => {
    const parent = fileURLToPath(new URL('../../.covai-temp/', import.meta.url));
    fs.mkdirSync(parent, { recursive: true });
    root = fs.mkdtempSync(path.join(parent, 'test-target-policy-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function write(file, value) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, value);
}

test('uses conventional discovery, preserves a dotted source stem and reuses an existing suite', () => {
    const suite = 'tests/middleware/auth.guard_v2.test.js';
    write(suite, "test('works', () => expect(true).toBe(true));");
    expect(suggestUnitTestTarget(root, 'src\\middleware\\auth.guard_v2.js', 'jest', suite.replaceAll('/', '\\'))).toBe(suite);
    expect(suggestUnitTestTarget(root, 'src/helpers/unique.module.js', 'jest')).toBe('tests/helpers/unique.module.test.js');
    expect(() => assertUnitTestTarget(root, '..\\other\\unit.test.js', 'jest')).toThrow(/escapes the workspace/);
});

test('honors Jest roots, custom testMatch, ignore patterns, and package script configuration', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'jest --config ./unit-config.json' } }));
    write('unit-config.json', JSON.stringify({
        roots: ['<rootDir>/quality'], testMatch: ['<rootDir>/quality/**/*.check.js'],
        testPathIgnorePatterns: ['/fixtures/'], testEnvironment: 'node',
    }));
    expect(suggestUnitTestTarget(root, 'src/math.js', 'jest')).toBe('quality/math.check.js');
    expect(assertUnitTestTarget(root, 'quality/math.check.js', 'jest')).toMatchObject({
        configFile: 'unit-config.json', testEnvironment: 'node',
    });
    expect(() => assertUnitTestTarget(root, 'quality/fixtures/math.check.js', 'jest')).toThrow(/testPathIgnorePatterns.*unit-config/);
    expect(() => assertUnitTestTarget(root, 'tests/math.check.js', 'jest')).toThrow(/Excluded by roots/);
});

test('uses a custom Jest testRegex suffix', () => {
    write('jest.config.json', JSON.stringify({ roots: ['<rootDir>/qa'], testRegex: '/qa/.*\\.unit\\.ts$' }));
    expect(suggestUnitTestTarget(root, 'src/math.ts', 'jest')).toBe('qa/math.unit.ts');
    expect(() => assertUnitTestTarget(root, 'qa/math.test.ts', 'jest')).toThrow(/testRegex/);
});

test('resolves inline Jest and Vitest projects without sharing test discovery', () => {
    write('jest.config.json', JSON.stringify({
        projects: [{ rootDir: '<rootDir>/packages/api', testMatch: ['<rootDir>/spec/**/*.check.js'] }],
    }));
    write('vitest.config.js', "export default { test: { projects: [{ root: 'packages/api', test: { include: ['vitest/**/*.test.js'], exclude: ['**/fixtures/**'] } }] } };");
    expect(assertUnitTestTarget(root, 'packages/api/spec/token.check.js', 'jest').writable).toBe(true);
    expect(assertUnitTestTarget(root, 'packages/api/vitest/token.test.js', 'vitest').writable).toBe(true);
    expect(suggestUnitTestTarget(root, 'packages/api/src/token.js', 'jest')).toBe('packages/api/spec/token.check.js');
    expect(suggestUnitTestTarget(root, 'packages/api/src/token.js', 'vitest')).toBe('packages/api/vitest/token.test.js');
    expect(() => assertUnitTestTarget(root, 'packages/api/vitest/token.test.js', 'jest')).toThrow(/projects.*testMatch/);
    expect(() => assertUnitTestTarget(root, 'packages/api/vitest/fixtures/token.test.js', 'vitest')).toThrow(/projects.*exclude/);
});

test('separates a conflicted new candidate only at a verified path and reports rejected targets independently', () => {
    write('jest.config.json', JSON.stringify({ testMatch: ['<rootDir>/tests/**/*.test.js'] }));
    const testFile = 'tests/check.test.js';
    const candidate = (sourceFile, title) => ({
        testFile, sourceFile, framework: 'jest',
        generatedCode: "const check = require('../" + sourceFile + "'); test('" + title + "', () => expect(check()).toBe(true));",
    });
    const rejected = [];
    const drafts = mergeUnitTestSuggestions(root, [
        candidate('middleware/check.js', 'HTTP'),
        candidate('socket/middleware/check.js', 'socket'),
        { ...candidate('src/invalid.js', 'bad target'), testFile: 'tests/check.test.socket_middleware_check_js.js' },
    ], rejected);
    expect(drafts.map(item => item.testFile)).toHaveLength(2);
    expect(new Set(drafts.map(item => item.testFile)).size).toBe(2);
    for (const item of drafts) expect(assertUnitTestTarget(root, item.testFile, 'jest').writable).toBe(true);
    expect(rejected).toEqual([expect.objectContaining({ classification: 'INVALID_TEST_TARGET',
        message: expect.stringContaining('testMatch') })]);
});
