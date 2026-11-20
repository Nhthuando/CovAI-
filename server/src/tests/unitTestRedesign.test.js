import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  classifyUnitTestCase,
  getRequiredUnitCasesForFile,
  annotateFileUnitTests,
  getFileUnitCaseCoverage,
  summarizeUnitFailure,
} from '../../../shared/unitTestCaseCoverage.js';

const mockGenerateText = jest.fn();
jest.unstable_mockModule('../services/gemini.service.js', () => ({
  generateText: mockGenerateText,
  withGeminiChannel: async (_ch, fn) => fn(),
}));

const {
  extractUnitTestBlocks,
  getUnitTestCaseDetail,
  addUnitTestCase,
  updateUnitTestCase,
  deleteUnitTestCase,
  aiFixUnitTestCase,
} = await import('../services/unitTestCaseOperations.service.js');

describe('shared/unitTestCaseCoverage', () => {
  test('derives required unit test cases from file branches and function metrics', () => {
    const simpleCases = getRequiredUnitCasesForFile(
      { funcsTotal: 1, branchesTotal: 0, linesTotal: 10 },
      [{ functionName: 'sum', cyclomatic: 1 }],
    );
    expect(simpleCases.map((c) => c.key)).toEqual(['HAPPY', 'BOUNDARY']);

    const complexCases = getRequiredUnitCasesForFile(
      { funcsTotal: 3, branchesTotal: 6, linesTotal: 40 },
      [{ functionName: 'processOrder', cyclomatic: 4 }],
    );
    expect(complexCases.map((c) => c.key)).toEqual(['HAPPY', 'BOUNDARY', 'BRANCH', 'ERROR']);
  });

  test('annotates primary passing case vs duplicate and optional tests', () => {
    const file = { funcsTotal: 1, branchesTotal: 0, linesTotal: 10 };
    const fns = [{ functionName: 'calc', cyclomatic: 1 }];
    const tests = [
      { id: 't1', title: 'returns sum for positive numbers', status: 'passed', origin: 'PROJECT_EXISTING' },
      { id: 't2', title: 'computes result for standard input', status: 'passed', origin: 'AI_DRAFT' },
      { id: 't3', title: 'handles empty input gracefully', status: 'failed', origin: 'PROJECT_EXISTING' },
      { id: 't4', title: 'throws validation error on bad payload', status: 'passed', origin: 'PROJECT_EXISTING' },
    ];

    const cov = getFileUnitCaseCoverage(file, fns, tests);
    expect(cov.coveredCount).toBe(2); // HAPPY & BOUNDARY from required [HAPPY, BOUNDARY]
    expect(cov.redundantCount).toBe(1); // t2 duplicates HAPPY
    expect(cov.extraCount).toBe(1); // t4 is ERROR (optional when funcsTotal=1, branchesTotal=0)
    expect(cov.scenarioAnnotations.t1.badgeType).toBe('PRIMARY_PASS');
    expect(cov.scenarioAnnotations.t2.badgeType).toBe('DUPLICATE');
    expect(cov.scenarioAnnotations.t3.badgeType).toBe('PRIMARY_FAIL');
    expect(cov.scenarioAnnotations.t4.badgeType).toBe('OPTIONAL');
  });

  test('strips ANSI codes and distills unit failure summary', () => {
    const raw = '\u001b[31mTypeError: Cannot read properties of undefined (reading \'id\')\u001b[39m\n    at Object.<anonymous> (tests/unit/user.test.js:12:5)';
    const summary = summarizeUnitFailure([raw]);
    expect(summary).toContain("TypeError: Cannot read properties of undefined (reading 'id')");
    expect(summary).not.toContain('\u001b[');
  });
});

describe('unitTestCaseOperations.service', () => {
  let tmpRoot;
  let snapshot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-unit-ops-'));
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'tests', 'unit'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify({ name: 'unit-ops-fixture', devDependencies: { jest: '^29.0.0' } }),
    );
    fs.writeFileSync(
      path.join(tmpRoot, 'src', 'math.js'),
      'export function add(a, b) { return a + b; }\n',
    );
    fs.writeFileSync(
      path.join(tmpRoot, 'tests', 'unit', 'math.test.js'),
      [
        "import { add } from '../../src/math.js';",
        "describe('math', () => {",
        "  it('adds two numbers', () => {",
        '    expect(add(1, 2)).toBe(3);',
        '  });',
        '});',
        '',
      ].join('\n'),
    );
    snapshot = { id: 'snap-unit-1', projectId: 'proj-unit-1', rootDir: tmpRoot };
    mockGenerateText.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('extracts, reads, adds, updates, and deletes test blocks while maintaining syntax', async () => {
    const initial = fs.readFileSync(path.join(tmpRoot, 'tests', 'unit', 'math.test.js'), 'utf8');
    const blocks = extractUnitTestBlocks(initial);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('adds two numbers');

    const detail = await getUnitTestCaseDetail({
      snapshot,
      testFile: 'tests/unit/math.test.js',
      testName: 'adds two numbers',
    });
    expect(detail.isSingleBlock).toBe(true);
    expect(detail.code).toContain('expect(add(1, 2)).toBe(3)');

    await addUnitTestCase({
      snapshot,
      sourceFile: 'src/math.js',
      testFile: 'tests/unit/math.test.js',
      testName: 'handles zero',
      code: "it('handles zero', () => {\n  expect(add(0, 5)).toBe(5);\n});",
    });

    await updateUnitTestCase({
      snapshot,
      sourceFile: 'src/math.js',
      testFile: 'tests/unit/math.test.js',
      testName: 'handles zero',
      code: "it('handles zero', () => {\n  expect(add(0, 9)).toBe(9);\n});",
    });

    const afterUpdate = fs.readFileSync(path.join(tmpRoot, 'tests', 'unit', 'math.test.js'), 'utf8');
    expect(afterUpdate).toContain('expect(add(0, 9)).toBe(9)');
    expect(afterUpdate).toContain("it('adds two numbers'");

    await deleteUnitTestCase({
      snapshot,
      sourceFile: 'src/math.js',
      testFile: 'tests/unit/math.test.js',
      testName: 'handles zero',
    });

    const afterDelete = fs.readFileSync(path.join(tmpRoot, 'tests', 'unit', 'math.test.js'), 'utf8');
    expect(afterDelete).not.toContain('handles zero');
    expect(afterDelete).toContain("it('adds two numbers'");
  });

  test('aiFixUnitTestCase repairs a failing test block via Gemini and saves version history', async () => {
    mockGenerateText.mockResolvedValueOnce(
      "```javascript\nit('adds two numbers', () => {\n  expect(add(2, 3)).toBe(5);\n});\n```",
    );

    const fixed = await aiFixUnitTestCase({
      snapshot,
      sourceFile: 'src/math.js',
      testFile: 'tests/unit/math.test.js',
      testName: 'adds two numbers',
      failureMessage: 'Expected: 4, Received: 3',
      framework: 'jest',
    });

    expect(fixed.fixedBlock).toContain('expect(add(2, 3)).toBe(5)');
    const onDisk = fs.readFileSync(path.join(tmpRoot, 'tests', 'unit', 'math.test.js'), 'utf8');
    expect(onDisk).toContain('expect(add(2, 3)).toBe(5)');
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });
});
