import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@jest/globals';
import { proposeEmptyArrayFallbackTest } from '../services/logicalFallbackTest.service.js';
import { assembleUnitTestCandidate } from '../services/unitTestChangeSet.service.js';
import { evaluateUncoverageDiagnostics } from '../services/uncoverageDiagnostic.service.js';

const require = createRequire(import.meta.url);
const sourceFile = 'controllers/example.js';
const testFile = '__tests__/unit/example.test.js';
const sourceCode = [
    'exports.check = async (req, res) => {',
    '  const values = req.body.values || [];',
    '  res.json({ values });',
    '};',
].join('\n');
const original = [
    "const controller = require('../../controllers/example');",
    "describe('check', () => {",
    "  beforeEach(() => { req = {body: {}}; });",
    "  test('accepts an empty array', async () => {",
    "    req.body = { values: [] };",
    "    await controller.check(req, res);",
    "    expect(res.json).toHaveBeenCalledWith({ values: [] });",
    "  });",
    "});",
].join('\n');
const gap = { type: 'binary-expr', line: 2, status: 'partial', counts: [1, 0] };

test('adds an omitted-field test using the original assertion and hook', () => {
    const proposal = proposeEmptyArrayFallbackTest({ sourceCode, sourceFile, testFile, original, coverageDetails: { branches: [gap] } });
    expect(proposal.fullUpdatedContent).toContain('req.body = {};');
    expect(proposal.fullUpdatedContent.match(/beforeEach/g)).toHaveLength(1);
    expect(proposal.fullUpdatedContent.match(/toHaveBeenCalledWith\(\{ values: \[\] \}\)/g)).toHaveLength(2);
    const candidate = assembleUnitTestCandidate({ original, proposed: proposal.fullUpdatedContent, testFile });
    expect(candidate.additions).toEqual([expect.objectContaining({ type: 'ADD_TEST' })]);
    expect(proposeEmptyArrayFallbackTest({ sourceCode, sourceFile, testFile, original: candidate.content,
        coverageDetails: { branches: [gap] } })).toBeNull();
});

test('reports short-circuit operands rather than a false assignment', () => {
    const result = evaluateUncoverageDiagnostics({ sourceCode, branches: [{ ...gap }] });
    expect(result.branches[0]).toMatchObject({
        uncoveredPath: 'Right operand',
        reason: expect.stringContaining("Set the left operand 'req.body.values' to falsy"),
    });
});

const imported = process.env.COVAI_IMPORTED_CART;
(imported ? test : test.skip)('covers the final branch in the imported Cart Controller with real Jest counters', () => {
    const parent = fileURLToPath(new URL('../../.covai-temp/', import.meta.url));
    fs.mkdirSync(parent, { recursive: true });
    const rootDir = fs.mkdtempSync(path.join(parent, 'cart-logical-branch-'));
    const importedSource = 'controllers/cartController.js';
    const importedTest = '__tests__/unit/cartController.test.js';
    try {
        for (const file of [importedSource, importedTest]) {
            const to = path.join(rootDir, file);
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(path.join(imported, file), to);
        }
        const config = { rootDir, transform: { '^.+\\.js$': [require.resolve('babel-jest'), { babelrc: false, configFile: false }] } };
        const run = () => {
            execFileSync(process.execPath, [require.resolve('jest/bin/jest'), '--config', JSON.stringify(config),
                '--runInBand', '--runTestsByPath', path.join(rootDir, importedTest), '--coverage',
                '--collectCoverageFrom=' + importedSource, '--coverageReporters=json', '--coverageReporters=json-summary'],
                { cwd: rootDir, stdio: 'pipe', timeout: 30000 });
            return JSON.parse(fs.readFileSync(path.join(rootDir, 'coverage/coverage-final.json'), 'utf8'))[path.join(rootDir, importedSource)];
        };
        const source = fs.readFileSync(path.join(rootDir, importedSource), 'utf8');
        const originalTest = fs.readFileSync(path.join(rootDir, importedTest), 'utf8');
        const before = run();
        const branches = Object.entries(before.branchMap).map(([id, info]) => ({
            type: info.type, line: info.line, counts: before.b[id],
            status: before.b[id].every(Boolean) ? 'fully_covered' : 'partial',
        }));
        const uncovered = branches.filter(branch => branch.status !== 'fully_covered');
        expect(uncovered).toHaveLength(1);
        expect(uncovered[0].counts[1]).toBe(0);
        const proposal = proposeEmptyArrayFallbackTest({ sourceCode: source, sourceFile: importedSource, testFile: importedTest,
            original: originalTest, coverageDetails: { branches, uncoveredLines: [] } });
        const candidate = assembleUnitTestCandidate({ original: originalTest, proposed: proposal.fullUpdatedContent, testFile: importedTest });
        expect(candidate.additions).toHaveLength(1);
        fs.writeFileSync(path.join(rootDir, importedTest), candidate.content);
        const after = run();
        expect(Object.values(after.b).flat().every(hit => hit > 0)).toBe(true);
        expect(fs.readFileSync(path.join(rootDir, importedSource), 'utf8')).toBe(source);
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
}, 60000);
