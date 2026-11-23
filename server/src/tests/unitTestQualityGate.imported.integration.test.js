import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, jest, test } from '@jest/globals';

const prisma = {
    projectSnapshot: { findUnique: jest.fn() },
    coverageFile: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
    coverageSummary: { upsert: jest.fn() },
};
await jest.unstable_mockModule('../config/prisma.js', () => ({ default: prisma, prisma }));
await jest.unstable_mockModule('../controllers/coverage.controller.js', () => ({ invalidateCoverageCache: jest.fn() }));
const { applyUnitTestSuggestion } = await import('../services/applyTestSuggestion.service.js');
const require = createRequire(import.meta.url);
const importedSource = process.env.COVAI_QUALITY_IMPORTED_SOURCE;
const integration = importedSource ? test : test.skip;

integration('verifies an imported Vitest draft and rejects unrelated coverage before publication', async () => {
    const source = fs.readFileSync(importedSource, 'utf8');
    const parent = fileURLToPath(new URL('../../.covai-temp/', import.meta.url));
    fs.mkdirSync(parent, { recursive: true });
    const rootDir = fs.mkdtempSync(path.join(parent, 'imported-quality-'));
    const sourceFile = 'src/historyNormalizer.js';
    const testFile = 'tests/historyNormalizer.vitest.test.js';
    const sourcePath = path.join(rootDir, sourceFile);
    try {
        fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
        fs.writeFileSync(sourcePath, source);
        fs.writeFileSync(path.join(rootDir, 'package.json'), '{"name":"imported-quality-fixture","type":"module","devDependencies":{"vitest":"3.2.7"}}');
        prisma.projectSnapshot.findUnique.mockResolvedValue({ id: 'snapshot', projectId: 'project', rootDir });
        const code = [
            "import { test, expect } from 'vitest';",
            "import { normalizeHistory } from '../src/historyNormalizer.js';",
            "test('keeps the valid conversation after filtering malformed turns', () => {",
            "  const history = [null, 7, { role: 'user', text: 'hello' }, { role: 'assistant', content: 'reply' }];",
            "  expect(normalizeHistory(history)).toEqual([{ role: 'user', text: 'hello' }, { role: 'model', text: 'reply' }]);",
            "});",
        ].join('\n');
        const runner = jest.fn(({ sealedRunDir }) => {
            const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
            execFileSync(process.execPath, [vitest, 'run', testFile, '--root', rootDir, '--maxWorkers=1', '--minWorkers=1',
                '--reporter=json', '--outputFile=' + path.join(sealedRunDir, 'vitest-results.json'),
                '--coverage', '--coverage.include=' + sourceFile, '--coverage.reporter=json-summary',
                '--coverage.reporter=json', '--coverage.reportsDirectory=' + sealedRunDir],
            { cwd: rootDir, stdio: 'pipe', timeout: 30000 });
            return { exitCode: 0 };
        });
        const apply = (targetLine, runCoverageFn = runner) => applyUnitTestSuggestion({
            projectId: 'project', snapshotId: 'snapshot', runCoverageFn,
            suggestion: { status: 'GENERATED', sourceFile, testFile, framework: 'vitest', generatedCode: code, targetLines: [targetLine] },
        });
        const unrelated = await apply(99999);
        expect(unrelated).toMatchObject({ success: false, fileUpdated: false,
            qualityGate: { coverage: [expect.objectContaining({ verified: false })], accepted: 0 } });
        expect(fs.existsSync(path.join(rootDir, testFile))).toBe(false);
        expect(prisma.coverageSummary.upsert).not.toHaveBeenCalled();

        const line = source.split(/\r?\n/).findIndex(text => text.includes('normalized.push')) + 1;
        await expect(apply(line, context => {
            const result = runner(context);
            fs.appendFileSync(sourcePath, '\n// simulated runner write\n');
            return result;
        })).rejects.toMatchObject({ code: 'SOURCE_INTEGRITY_FAILED' });
        expect(prisma.coverageSummary.upsert).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(rootDir, testFile))).toBe(false);
        fs.writeFileSync(sourcePath, source);

        const accepted = await apply(line);
        expect(accepted).toMatchObject({ success: true, status: 'PASSED',
            qualityGate: { status: 'ACCEPTED', accepted: 1, coverage: [expect.objectContaining({ verified: true })] } });
        expect(fs.readFileSync(sourcePath, 'utf8')).toBe(source);
        expect(prisma.coverageSummary.upsert).toHaveBeenCalledTimes(1);
        expect(runner).toHaveBeenCalledTimes(3);
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
}, 60000);
